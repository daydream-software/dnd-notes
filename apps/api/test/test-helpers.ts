import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DataType, newDb } from 'pg-mem'
import type { IMemoryDb } from 'pg-mem'
import type TestAgent from 'supertest/lib/agent.js'
import type { Test } from 'supertest'
import { createApp } from '../src/app.js'
import {
  createControlState,
  type ControlState,
} from '../src/control-state.js'
import {
  KeycloakTokenValidationError,
  type KeycloakIdentity,
  type TenantRuntimeAuth,
} from '../src/keycloak-auth.js'
import {
  createNoteStore,
  type NoteStore,
} from '../src/note-store.js'
import type { PostgresPoolLike } from '../src/note-store-database.js'

/**
 * In-process Keycloak stand-in for tests that need an authenticated user
 * without standing up a real Keycloak server (or even the fake-keycloak HTTP
 * server). `issueToken` registers an identity and returns a bearer token;
 * `authenticateBearerToken` (called from middleware) looks it up.
 *
 * Tests exercising the real signature/issuer/audience verification path
 * should still use fake-keycloak via createTenantRuntimeAuth — see
 * keycloak-runtime-auth.test.ts.
 */
export function createTestRuntimeAuth() {
  const identities = new Map<string, KeycloakIdentity>()

  const runtimeAuth: TenantRuntimeAuth = {
    authConfig: {
      keycloak: {
        url: 'http://test-keycloak.invalid',
        realm: 'test',
        clientId: 'test',
      },
    },
    async authenticateBearerToken(token) {
      const identity = identities.get(token)
      if (!identity) {
        throw new KeycloakTokenValidationError(
          401,
          'Owner access token is invalid or expired.',
        )
      }
      return identity
    },
  }

  function issueToken(identity: KeycloakIdentity): string {
    const token = `test-token-${randomUUID()}`
    identities.set(token, identity)
    return token
  }

  return { runtimeAuth, issueToken }
}

export interface CreateTestAppOptions {
  siteAdminEmails?: readonly string[]
  publicWebUrl?: string
  allowedOrigins?: string | readonly string[]
  isShuttingDown?: () => boolean
  runtimeAuth?: TenantRuntimeAuth
  serveWeb?: boolean
  webDistPath?: string
  controlPlaneToken?: string | null
  appVersion?: string
  schemaVersion?: string
  tenantId?: string | null
  maintenanceDrainGraceMs?: number
  controlState?: ControlState
}

export interface RegisterPgMemMigrationSupportOptions {
  tryAdvisoryLockImpl?: (key1: unknown, key2: unknown) => boolean
  advisoryUnlockImpl?: (key1: unknown, key2: unknown) => boolean
}

export function registerPgMemMigrationSupport(
  db: IMemoryDb,
  options: RegisterPgMemMigrationSupportOptions = {},
): void {
  const tryAdvisoryLockImpl = options.tryAdvisoryLockImpl ?? (() => true)
  const advisoryUnlockImpl = options.advisoryUnlockImpl ?? (() => true)

  db.public.registerFunction({
    name: 'pg_try_advisory_lock',
    args: [DataType.integer, DataType.integer],
    returns: DataType.bool,
    implementation: tryAdvisoryLockImpl,
  })
  db.public.registerFunction({
    name: 'pg_advisory_unlock',
    args: [DataType.integer, DataType.integer],
    returns: DataType.bool,
    implementation: advisoryUnlockImpl,
  })
}

export function createTestPgMemDb(): IMemoryDb {
  const db = newDb({
    autoCreateForeignKeyIndices: true,
  })
  registerPgMemMigrationSupport(db)
  return db
}

export function createTestPgMemPool() {
  const db = createTestPgMemDb()
  const { Pool } = db.adapters.createPg()
  const pool = new Pool() as PostgresPoolLike

  return { db, pool }
}

export async function createTestApp(options: CreateTestAppOptions = {}) {
  const { db, pool } = createTestPgMemPool()
  let noteStore = await createNoteStore({
    postgresPool: pool,
    siteAdminEmails: options.siteAdminEmails,
  })
  const controlState = options.controlState ?? createControlState()
  let noteStoreClosed = false
  let poolClosed = false

  const testAuth = options.runtimeAuth ? null : createTestRuntimeAuth()
  const runtimeAuth = options.runtimeAuth ?? testAuth!.runtimeAuth

  const app = createApp({
    noteStore,
    publicWebUrl: options.publicWebUrl,
    allowedOrigins:
      typeof options.allowedOrigins === 'string'
        ? options.allowedOrigins
        : options.allowedOrigins?.join(','),
    runtimeAuth,
    isShuttingDown: options.isShuttingDown,
    serveWeb: options.serveWeb,
    webDistPath: options.webDistPath,
    controlPlaneToken: options.controlPlaneToken ?? null,
    appVersion: options.appVersion,
    schemaVersion: options.schemaVersion,
    tenantId: options.tenantId ?? null,
    maintenanceDrainGraceMs: options.maintenanceDrainGraceMs,
    controlState,
  })

  const closeNoteStore = async () => {
    if (noteStoreClosed) {
      return
    }

    await noteStore.close()
    noteStoreClosed = true
  }

  const closePool = async () => {
    if (poolClosed) {
      return
    }

    await pool.end()
    poolClosed = true
  }

  return {
    app,
    db,
    pool,
    controlState,
    /**
     * Token issuer for the default in-process test auth. Returns `null` if
     * the caller supplied their own `runtimeAuth` (e.g., fake-keycloak).
     */
    issueToken: testAuth?.issueToken ?? null,
    get noteStore(): NoteStore {
      return noteStore
    },
    closeNoteStore,
    closePool,
    async reopenNoteStore() {
      await closeNoteStore()
      noteStore = await createNoteStore({
        postgresPool: pool,
        siteAdminEmails: options.siteAdminEmails,
      })
      noteStoreClosed = false
      return noteStore
    },
    async cleanup() {
      await closeNoteStore()
      await closePool()
    },
  }
}

/**
 * Provision an owner via the in-process test runtime auth: mint a token
 * tied to the desired Keycloak identity, then hit /api/auth/session so the
 * tenant API auto-provisions the owner row (the same path production
 * Keycloak users take). Returns the bearer token and the resulting owner.
 *
 * Requires the testApp's default (createTestRuntimeAuth) runtimeAuth — if
 * a test passed its own `runtimeAuth`, mint the token yourself instead.
 */
export async function registerOwner(
  app: TestAgent<Test>,
  issueToken: (identity: KeycloakIdentity) => string,
  overrides: Partial<{
    displayName: string
    email: string
    keycloakSub: string
  }> = {},
) {
  const payload = {
    displayName: overrides.displayName ?? 'Aela',
    email: overrides.email ?? 'aela@example.com',
    keycloakSub: overrides.keycloakSub ?? `keycloak-sub-${randomUUID()}`,
  }

  const token = issueToken({
    keycloakSub: payload.keycloakSub,
    email: payload.email,
    displayName: payload.displayName,
  })

  const response = await app
    .get('/api/auth/session')
    .set('Authorization', `Bearer ${token}`)

  assert.equal(response.status, 200)

  return {
    token,
    owner: response.body.owner as {
      id: string
      email: string
      displayName: string
      isSiteAdmin: boolean
    },
    payload,
  }
}

export function withAuth(app: TestAgent<Test>, token: string) {
  return {
    get(path: string) {
      return app.get(path).set('Authorization', `Bearer ${token}`)
    },
    post(path: string) {
      return app.post(path).set('Authorization', `Bearer ${token}`)
    },
    put(path: string) {
      return app.put(path).set('Authorization', `Bearer ${token}`)
    },
    delete(path: string) {
      return app.delete(path).set('Authorization', `Bearer ${token}`)
    },
  }
}

export function withGuest(app: TestAgent<Test>, guestToken: string) {
  return {
    get(path: string) {
      return app.get(path).set('X-Guest-Token', guestToken)
    },
    post(path: string) {
      return app.post(path).set('X-Guest-Token', guestToken)
    },
    put(path: string) {
      return app.put(path).set('X-Guest-Token', guestToken)
    },
    delete(path: string) {
      return app.delete(path).set('X-Guest-Token', guestToken)
    },
  }
}

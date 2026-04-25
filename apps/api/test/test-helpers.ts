import assert from 'node:assert/strict'
import { DataType, newDb } from 'pg-mem'
import type { IMemoryDb } from 'pg-mem'
import type { SuperTest, Test } from 'supertest'
import { createApp } from '../src/app.js'
import type { TenantRuntimeAuth } from '../src/keycloak-auth.js'
import {
  createNoteStore,
  type NoteStore,
} from '../src/note-store.js'
import type { PostgresPoolLike } from '../src/note-store-database.js'

export interface CreateTestAppOptions {
  siteAdminEmails?: readonly string[]
  publicWebUrl?: string
  allowedOrigins?: string | readonly string[]
  isShuttingDown?: () => boolean
  runtimeAuth?: TenantRuntimeAuth
  serveWeb?: boolean
  webDistPath?: string
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
  let noteStoreClosed = false
  let poolClosed = false

  const app = createApp({
    noteStore,
    publicWebUrl: options.publicWebUrl,
    allowedOrigins:
      typeof options.allowedOrigins === 'string'
        ? options.allowedOrigins
        : options.allowedOrigins?.join(','),
    runtimeAuth: options.runtimeAuth,
    isShuttingDown: options.isShuttingDown,
    serveWeb: options.serveWeb,
    webDistPath: options.webDistPath,
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

export async function registerOwner(
  app: SuperTest<Test>,
  overrides: Partial<{
    displayName: string
    email: string
    password: string
  }> = {},
) {
  const payload = {
    displayName: overrides.displayName ?? 'Aela',
    email: overrides.email ?? 'aela@example.com',
    password: overrides.password ?? 'moonlit-secret',
  }

  const response = await app.post('/api/auth/register').send(payload)

  assert.equal(response.status, 201)

  return {
    token: response.body.token as string,
    owner: response.body.owner as {
      id: string
      email: string
      displayName: string
      isSiteAdmin: boolean
    },
    payload,
  }
}

export function withAuth(app: SuperTest<Test>, token: string) {
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

export function withGuest(app: SuperTest<Test>, guestToken: string) {
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

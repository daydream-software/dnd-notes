import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SuperTest, Test } from 'supertest'
import { createApp } from '../src/app.js'
import type { TenantRuntimeAuth } from '../src/keycloak-auth.js'
import {
  createNoteStore,
  restoreNoteStoreFromBackup,
  type NoteStore,
} from '../src/note-store.js'

export interface CreateTestAppOptions {
  siteAdminEmails?: readonly string[]
  publicWebUrl?: string
  allowedOrigins?: string | readonly string[]
  directoryPrefix?: string
  isShuttingDown?: () => boolean
  runtimeAuth?: TenantRuntimeAuth
  serveWeb?: boolean
  webDistPath?: string
}

export async function createTestApp(options: CreateTestAppOptions = {}) {
  const directory = await mkdtemp(
    join(tmpdir(), options.directoryPrefix ?? 'dnd-notes-api-'),
  )
  const dbPath = join(directory, 'notes.sqlite')
  let noteStore = await createNoteStore({
    dbPath,
    siteAdminEmails: options.siteAdminEmails,
  })
  let noteStoreClosed = false

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
    async restoreNoteStore(sourcePath) {
      noteStore = await restoreNoteStoreFromBackup(sourcePath, {
        dbPath,
        siteAdminEmails: options.siteAdminEmails,
      })
      noteStoreClosed = false
      return noteStore
    },
  })

  const closeNoteStore = async () => {
    if (noteStoreClosed) {
      return
    }

    await noteStore.close()
    noteStoreClosed = true
  }

  return {
    app,
    dbPath,
    get noteStore(): NoteStore {
      return noteStore
    },
    closeNoteStore,
    async cleanup() {
      await closeNoteStore()
      await rm(directory, { recursive: true, force: true })
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

export function withGuest(app: SuperTest<Test>, token: string) {
  return {
    get(path: string) {
      return app.get(path).set('X-Guest-Token', token)
    },
    post(path: string) {
      return app.post(path).set('X-Guest-Token', token)
    },
    put(path: string) {
      return app.put(path).set('X-Guest-Token', token)
    },
    delete(path: string) {
      return app.delete(path).set('X-Guest-Token', token)
    },
  }
}

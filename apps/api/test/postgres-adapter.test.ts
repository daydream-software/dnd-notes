import assert from 'node:assert/strict'
import test from 'node:test'
import { newDb } from 'pg-mem'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { defaultCampaignId } from '../src/campaign.js'
import {
  createNoteStore,
  createRuntimeNoteStore,
  initializeDatabaseOrClose,
  resolveNoteStoreBackend,
} from '../src/note-store.js'
import { registerOwner, withAuth } from './test-helpers.js'

function createPostgresMemDb() {
  return newDb({
    autoCreateForeignKeyIndices: true,
  })
}

async function createPostgresTestStore() {
  const db = createPostgresMemDb()
  const { Pool } = db.adapters.createPg()
  const pool = new Pool()
  const noteStore = await createNoteStore({
    postgresPool: pool,
  })

  return {
    db,
    pool,
    noteStore,
    async cleanup() {
      await noteStore.close()
      await pool.end()
    },
  }
}

test('postgres-backed app supports owner auth and note CRUD workflows', async (t) => {
  const { noteStore, cleanup } = await createPostgresTestStore()
  t.after(cleanup)

  const app = createApp({ noteStore })
  const { token } = await registerOwner(request(app))
  const authed = withAuth(request(app), token)

  const createResponse = await authed.post('/api/notes').send({
    campaignId: defaultCampaignId,
    title: 'Postgres clue',
    body: 'The sigil was etched beneath the bridge.',
    tags: ['sigil'],
    status: 'active',
    sessionName: 'Session PG-1',
  })

  assert.equal(createResponse.status, 201)
  const noteId = createResponse.body.note.id as string

  const listResponse = await authed.get('/api/notes').query({ campaignId: defaultCampaignId })
  assert.equal(listResponse.status, 200)
  assert.equal(listResponse.body.notes[0].id, noteId)

  const updateResponse = await authed.put(`/api/notes/${noteId}`).send({
    title: 'Postgres clue',
    body: 'The sigil was etched beneath the bridge after midnight.',
    tags: ['sigil', 'bridge'],
    status: 'active',
    sessionName: 'Session PG-1',
  })

  assert.equal(updateResponse.status, 200)
  assert.deepEqual(updateResponse.body.note.tags, ['sigil', 'bridge'])
})

test('postgres-backed stores support inline references and backlinks', async (t) => {
  const { noteStore, cleanup } = await createPostgresTestStore()
  t.after(cleanup)

  const target = await noteStore.createNote({
    campaignId: defaultCampaignId,
    title: 'Anchor',
    body: 'Central note.',
    tags: [],
    status: 'active',
    sessionName: null,
  })
  const source = await noteStore.createNote({
    campaignId: defaultCampaignId,
    title: 'Caller',
    body: `See ![[${target.id}|Anchor]].`,
    tags: [],
    status: 'draft',
    sessionName: null,
  })

  const reloaded = await noteStore.getNote(source.id)
  assert.ok(reloaded)
  assert.deepEqual(reloaded.linkedNoteIds, [target.id])

  const backlinks = await noteStore.getBacklinks(target.id)
  assert.deepEqual(backlinks.map((note) => note.id), [source.id])
})

test('initializeDatabaseOrClose closes the database before rethrowing init failures', async () => {
  let closeCalls = 0
  const database = {
    async close() {
      closeCalls += 1
    },
  }

  const failure = new Error('initialize failed')
  await assert.rejects(
    () => initializeDatabaseOrClose(database, async () => {
      throw failure
    }),
    failure,
  )

  assert.equal(closeCalls, 1)
})

test('resolveNoteStoreBackend always returns postgres in the postgres-only runtime', () => {
  assert.equal(resolveNoteStoreBackend(), 'postgres')
})

test('runtime note store requires postgres configuration', async (t) => {
  const originalDatabaseUrl = process.env.DATABASE_URL

  t.after(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl
    }
  })

  delete process.env.DATABASE_URL

  await assert.rejects(
    () => createRuntimeNoteStore(),
    /DATABASE_URL is required when the Postgres note store is selected\./,
  )
})

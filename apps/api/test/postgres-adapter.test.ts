import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { newDb } from 'pg-mem'
import request from 'supertest'
import { fileURLToPath } from 'node:url'
import { createApp } from '../src/app.js'
import { defaultCampaignId } from '../src/campaign.js'
import { createNoteStore, restoreNoteStoreFromBackup } from '../src/note-store.js'
import { registerOwner, withAuth } from './test-helpers.js'

const runtimeDirectory = join(dirname(fileURLToPath(import.meta.url)), '.runtime')

async function createPostgresTestStore() {
  const db = newDb({
    autoCreateForeignKeyIndices: true,
  })
  const { Pool } = db.adapters.createPg()
  const pool = new Pool()
  const noteStore = await createNoteStore({
    backend: 'postgres',
    postgresPool: pool,
  })

  return {
    db,
    noteStore,
    async cleanup() {
      await noteStore.close()
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

test('postgres-backed backups export a SQLite-compatible snapshot', async (t) => {
  const { noteStore, cleanup } = await createPostgresTestStore()
  t.after(cleanup)

  await mkdir(runtimeDirectory, { recursive: true })
  const backupPath = join(runtimeDirectory, `postgres-export-${randomUUID()}.sqlite`)
  t.after(async () => {
    await rm(backupPath, { force: true })
  })

  await noteStore.createNote({
    campaignId: defaultCampaignId,
    title: 'Snapshot note',
    body: 'Export me.',
    tags: ['snapshot'],
    status: 'active',
    sessionName: null,
  })

  await noteStore.backupDatabase(backupPath)

  const snapshotStore = await createNoteStore({
    backend: 'sqlite',
    dbPath: backupPath,
  })

  try {
    const notes = await snapshotStore.listNotes(defaultCampaignId)
    assert.equal(notes.some((note) => note.title === 'Snapshot note'), true)
  } finally {
    await snapshotStore.close()
  }
})

test('postgres-backed backups roll back partial snapshot writes when export fails', async (t) => {
  const db = newDb({
    autoCreateForeignKeyIndices: true,
  })
  const { Pool } = db.adapters.createPg()
  const pool = new Pool()
  const noteStore = await createNoteStore({
    backend: 'postgres',
    postgresPool: pool,
  })
  t.after(async () => {
    await noteStore.close()
  })

  await noteStore.createOwnerAccount({
    displayName: 'Snapshot owner',
    email: 'snapshot-owner@example.com',
    password: 'moonlit-secret',
  })
  await noteStore.createNote({
    campaignId: defaultCampaignId,
    title: 'Mid-export failure',
    body: 'This note should never land in a partial snapshot.',
    tags: [],
    status: 'active',
    sessionName: null,
  })

  await mkdir(runtimeDirectory, { recursive: true })
  const backupPath = join(runtimeDirectory, `postgres-export-failure-${randomUUID()}.sqlite`)
  t.after(async () => {
    await rm(backupPath, { force: true })
  })

  const queryLog: string[] = []
  const originalConnect = pool.connect.bind(pool)
  pool.connect = async () => {
    const client = await originalConnect()
    const originalQuery = client.query.bind(client)

    return {
      async query(text, values) {
        const sql = typeof text === 'string' ? text : text.text
        queryLog.push(sql)

        if (sql.includes('FROM notes')) {
          throw new Error('Simulated export failure')
        }

        return originalQuery(text as never, values)
      },
      release() {
        client.release()
      },
    }
  }

  await assert.rejects(() => noteStore.backupDatabase(backupPath), /Simulated export failure/)
  assert.equal(queryLog[0], 'BEGIN')
  assert.equal(queryLog.at(-1), 'ROLLBACK')

  const snapshotDatabase = new Database(backupPath, { readonly: true })
  try {
    const ownerCount = snapshotDatabase
      .prepare('SELECT COUNT(*) AS count FROM owner_accounts')
      .get() as { count: number }
    const noteCount = snapshotDatabase.prepare('SELECT COUNT(*) AS count FROM notes').get() as {
      count: number
    }

    assert.equal(ownerCount.count, 0)
    assert.equal(noteCount.count, 0)
  } finally {
    snapshotDatabase.close()
  }
})

test('postgres restore fails fast when no pool or DATABASE_URL is configured', async (t) => {
  await mkdir(runtimeDirectory, { recursive: true })
  const sourceDbPath = join(runtimeDirectory, `restore-source-${randomUUID()}.sqlite`)
  const backupPath = join(runtimeDirectory, `restore-backup-${randomUUID()}.sqlite`)
  t.after(async () => {
    await rm(sourceDbPath, { force: true })
    await rm(backupPath, { force: true })
  })

  const sourceStore = await createNoteStore({
    backend: 'sqlite',
    dbPath: sourceDbPath,
  })

  try {
    await sourceStore.backupDatabase(backupPath)
  } finally {
    await sourceStore.close()
  }

  await assert.rejects(
    () =>
      restoreNoteStoreFromBackup(backupPath, {
        backend: 'postgres',
      }),
    /DATABASE_URL is required when the Postgres note store is selected\./,
  )
})

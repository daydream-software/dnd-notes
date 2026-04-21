import assert from 'node:assert/strict'
import test from 'node:test'
import { chmod, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { newDb } from 'pg-mem'
import request from 'supertest'
import { fileURLToPath } from 'node:url'
import { createApp } from '../src/app.js'
import { defaultCampaignId } from '../src/campaign.js'
import {
  copySnapshotTables,
  createNoteStore,
  initializeDatabaseOrClose,
  resolveNoteStoreBackend,
  restoreNoteStoreFromBackup,
} from '../src/note-store.js'
import { createSqliteDatabase } from '../src/note-store-database.js'
import { registerOwner, withAuth } from './test-helpers.js'

const runtimeDirectory = join(dirname(fileURLToPath(import.meta.url)), '.runtime')

function createPostgresMemDb() {
  const db = newDb({
    autoCreateForeignKeyIndices: true,
  })

  // Register Postgres functions used by the runtime
  db.public.registerFunction({
    name: 'has_schema_privilege',
    args: ['text', 'text'],
    returns: 'boolean',
    implementation: () => true,
  })

  return db
}

async function createPostgresTestStore() {
  const db = createPostgresMemDb()
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

test('postgres-backed backups tighten restrictive permissions on snapshot files', async (t) => {
  const { noteStore, cleanup } = await createPostgresTestStore()
  t.after(cleanup)

  await mkdir(runtimeDirectory, { recursive: true })
  const backupPath = join(runtimeDirectory, `postgres-export-permissions-${randomUUID()}.sqlite`)
  t.after(async () => {
    await rm(backupPath, { force: true })
  })

  const placeholderDatabase = new Database(backupPath)
  placeholderDatabase.close()
  await chmod(backupPath, 0o666)

  await noteStore.backupDatabase(backupPath)

  const backupStats = await stat(backupPath)
  assert.equal(backupStats.mode & 0o777, 0o600)
})

test('postgres-backed backups copy snapshot tables in bounded batches', async (t) => {
  const db = createPostgresMemDb()
  const { Pool } = db.adapters.createPg()
  const pool = new Pool()
  const noteStore = await createNoteStore({
    backend: 'postgres',
    postgresPool: pool,
  })
  t.after(async () => {
    await noteStore.close()
    await pool.end()
  })

  const notes = Array.from({ length: 105 }, (_value, index) => ({
    campaignId: defaultCampaignId,
    title: `Snapshot note ${index + 1}`,
    body: `Export note ${index + 1}`,
    tags: ['snapshot'],
    status: 'active' as const,
    sessionName: null,
  }))
  await noteStore.resetNotes(notes, defaultCampaignId)

  await mkdir(runtimeDirectory, { recursive: true })
  const backupPath = join(runtimeDirectory, `postgres-export-batched-${randomUUID()}.sqlite`)
  t.after(async () => {
    await rm(backupPath, { force: true })
  })

  const queryLog: string[] = []
  const originalQuery = pool.query.bind(pool)
  pool.query = async (text, values) => {
    const sql = typeof text === 'string' ? text : text.text
    queryLog.push(sql)
    return originalQuery(text as never, values)
  }

  await noteStore.backupDatabase(backupPath)

  const noteSelectQueries = queryLog.filter((sql) => sql.includes('FROM notes'))
  assert.ok(
    noteSelectQueries.length >= 2,
    `expected batched notes export queries, saw ${noteSelectQueries.length}`,
  )
  for (const sql of noteSelectQueries) {
    assert.match(sql, /ORDER BY id ASC/i)
    assert.match(sql, /LIMIT \$\d+/i)
  }
})

test('postgres-backed backups roll back partial snapshot writes when export fails', async (t) => {
  const db = createPostgresMemDb()
  const { Pool } = db.adapters.createPg()
  const pool = new Pool()
  const noteStore = await createNoteStore({
    backend: 'postgres',
    postgresPool: pool,
  })
  t.after(async () => {
    await noteStore.close()
    await pool.end()
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

test('postgres restore does not require write access to the configured sqlite directory', async (t) => {
  await mkdir(runtimeDirectory, { recursive: true })
  const sourceDbPath = join(runtimeDirectory, `restore-source-${randomUUID()}.sqlite`)
  const backupPath = join(runtimeDirectory, `restore-backup-${randomUUID()}.sqlite`)
  const readonlyDirectory = join(runtimeDirectory, `restore-readonly-${randomUUID()}`)
  const unusedDbPath = join(readonlyDirectory, 'notes.sqlite')
  t.after(async () => {
    await chmod(readonlyDirectory, 0o755).catch(() => undefined)
    await rm(readonlyDirectory, { recursive: true, force: true })
    await rm(sourceDbPath, { force: true })
    await rm(backupPath, { force: true })
  })

  const sourceStore = await createNoteStore({
    backend: 'sqlite',
    dbPath: sourceDbPath,
  })

  try {
    await sourceStore.createNote({
      campaignId: defaultCampaignId,
      title: 'Restored without sqlite writes',
      body: 'Postgres restore should only need a temp working copy.',
      tags: ['restore'],
      status: 'active',
      sessionName: null,
    })
    await sourceStore.backupDatabase(backupPath)
  } finally {
    await sourceStore.close()
  }

  await mkdir(readonlyDirectory, { recursive: true })
  await chmod(readonlyDirectory, 0o555)

  await assert.rejects(
    () =>
      restoreNoteStoreFromBackup(backupPath, {
        backend: 'postgres',
        dbPath: unusedDbPath,
      }),
    /DATABASE_URL is required when the Postgres note store is selected\./,
  )
  assert.deepEqual(await readdir(readonlyDirectory), [])
})

test('snapshot copy batches note inserts instead of issuing one INSERT per row', async (t) => {
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
    await sourceStore.resetNotes(
      Array.from({ length: 105 }, (_value, index) => ({
        campaignId: defaultCampaignId,
        title: `Snapshot note ${index + 1}`,
        body: `Snapshot note ${index + 1}`,
        tags: ['snapshot'],
        status: 'active' as const,
        sessionName: null,
      })),
      defaultCampaignId,
    )
    await sourceStore.backupDatabase(backupPath)
  } finally {
    await sourceStore.close()
  }

  const sourceDatabase = createSqliteDatabase(backupPath, { readonly: true })
  t.after(async () => {
    await sourceDatabase.close()
  })
  const noteInsertBatchSizes: number[] = []

  await copySnapshotTables(sourceDatabase, {
    kind: 'postgres',
    prepare(sql) {
      return {
        async get() {
          return undefined
        },
        async all() {
          return []
        },
        async run(...args) {
          if (/INSERT INTO notes/i.test(sql)) {
            const valuesClause = sql.split(/VALUES/i)[1] ?? ''
            const rowCount = (valuesClause.match(/\(/g) ?? []).length
            noteInsertBatchSizes.push(rowCount)
            assert.match(valuesClause, /\)\s*,\s*\(/)
            assert.equal((args[0] as unknown[]).length % rowCount, 0)
          }

          return { changes: 0 }
        },
      }
    },
    async exec() {},
    transaction(callback) {
      return callback
    },
    async close() {},
  })

  assert.equal(noteInsertBatchSizes.reduce((total, batchSize) => total + batchSize, 0), 105)
  assert.equal(noteInsertBatchSizes.every((batchSize) => batchSize > 1), true)
  assert.equal(noteInsertBatchSizes.every((batchSize) => batchSize <= 75), true)
  assert.ok(noteInsertBatchSizes.length < 10, `expected a handful of batched INSERTs, saw ${noteInsertBatchSizes.length}`)
})

test('sqlite restore cleanup removes working copies when restore validation fails', async (t) => {
  await mkdir(runtimeDirectory, { recursive: true })
  const sourcePath = join(runtimeDirectory, `restore-invalid-${randomUUID()}.sqlite`)
  const destinationPath = join(runtimeDirectory, `restore-destination-${randomUUID()}.sqlite`)
  const workingCopyPrefix = `${basename(destinationPath)}.restore-working-`
  t.after(async () => {
    await rm(sourcePath, { force: true })
    await rm(destinationPath, { force: true })
    const runtimeFiles = await readdir(runtimeDirectory)
    await Promise.all(
      runtimeFiles
        .filter((fileName) => fileName.startsWith(workingCopyPrefix))
        .map((fileName) => rm(join(runtimeDirectory, fileName), { force: true })),
    )
  })

  const sourceDatabase = new Database(sourcePath)
  try {
    sourceDatabase.exec(`
      CREATE TABLE owner_accounts (id TEXT PRIMARY KEY);
      CREATE TABLE owner_sessions (id TEXT PRIMARY KEY);
      CREATE TABLE campaigns (id TEXT PRIMARY KEY);
      CREATE TABLE campaign_memberships (id TEXT PRIMARY KEY);
      CREATE TABLE campaign_share_links (id TEXT PRIMARY KEY);
      CREATE TABLE notes (id TEXT PRIMARY KEY);
    `)
  } finally {
    sourceDatabase.close()
  }

  await assert.rejects(
    () =>
      restoreNoteStoreFromBackup(sourcePath, {
        backend: 'sqlite',
        dbPath: destinationPath,
      }),
    /could not be opened as a dnd-notes backup/,
  )

  const runtimeFiles = await readdir(runtimeDirectory)
  const leakedWorkingCopies = runtimeFiles.filter((fileName) =>
    fileName.startsWith(workingCopyPrefix),
  )

  assert.deepEqual(leakedWorkingCopies, [])
})

test('sqlite restore reapplies restrictive permissions to the restored database file', async (t) => {
  await mkdir(runtimeDirectory, { recursive: true })
  const sourceDbPath = join(runtimeDirectory, `restore-source-${randomUUID()}.sqlite`)
  const backupPath = join(runtimeDirectory, `restore-backup-${randomUUID()}.sqlite`)
  const destinationPath = join(runtimeDirectory, `restore-destination-${randomUUID()}.sqlite`)
  t.after(async () => {
    await rm(sourceDbPath, { force: true })
    await rm(backupPath, { force: true })
    await rm(destinationPath, { force: true })
  })

  const sourceStore = await createNoteStore({
    backend: 'sqlite',
    dbPath: sourceDbPath,
  })

  try {
    await sourceStore.createNote({
      campaignId: defaultCampaignId,
      title: 'Restored permissions note',
      body: 'Permission checks should stay tight.',
      tags: [],
      status: 'active',
      sessionName: null,
      linkedNoteIds: [],
    })
    await sourceStore.backupDatabase(backupPath)
  } finally {
    await sourceStore.close()
  }

  await writeFile(destinationPath, 'placeholder')
  await chmod(destinationPath, 0o666)

  const restoredStore = await restoreNoteStoreFromBackup(backupPath, {
    backend: 'sqlite',
    dbPath: destinationPath,
  })

  try {
    const notes = await restoredStore.listNotes(defaultCampaignId)
    assert.equal(notes.some((note) => note.title === 'Restored permissions note'), true)
  } finally {
    await restoredStore.close()
  }

  const destinationStats = await stat(destinationPath)
  assert.equal(destinationStats.mode & 0o777, 0o600)
})

test('initializeDatabaseOrClose closes the database before rethrowing init failures', async () => {
  const calls: string[] = []
  const database = {
    async close() {
      calls.push('close')
    },
  }
  const initializationError = new Error('init failed')

  await assert.rejects(
    () =>
      initializeDatabaseOrClose(database, async () => {
        calls.push('initialize')
        throw initializationError
      }),
    initializationError,
  )
  assert.deepEqual(calls, ['initialize', 'close'])
})

test('explicit sqlite dbPath beats an ambient DATABASE_URL', () => {
  assert.equal(
    resolveNoteStoreBackend(
      { dbPath: ':memory:' },
      { DATABASE_URL: 'postgresql://ambient.example/dnd-notes' } as NodeJS.ProcessEnv,
    ),
    'sqlite',
  )
})

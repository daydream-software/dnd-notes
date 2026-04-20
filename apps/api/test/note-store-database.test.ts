import assert from 'node:assert/strict'
import test from 'node:test'
import { chmod, mkdir, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createPostgresDatabase,
  createSqliteDatabase,
  type PostgresPoolLike,
} from '../src/note-store-database.js'

function createDeferred() {
  let resolve!: () => void
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve
  })

  return { promise, resolve }
}

const runtimeDirectory = join(dirname(fileURLToPath(import.meta.url)), '.runtime')

test('sqlite async transactions keep unrelated reads and writes queued until commit', async () => {
  const database = createSqliteDatabase(':memory:')

  try {
    await database.exec(`
      CREATE TABLE notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL
      )
    `)

    const insertNote = database.prepare<{ id: number; title: string }>(
      'INSERT INTO notes (title) VALUES (?) RETURNING id, title',
    )
    const listNotes = database.prepare<{ title: string }>('SELECT title FROM notes ORDER BY id ASC')
    const releaseTransaction = createDeferred()
    const transactionEntered = createDeferred()

    const createNotesInTransaction = database.transaction(async () => {
      await insertNote.get('before-await')
      transactionEntered.resolve()
      await releaseTransaction.promise
      await insertNote.get('after-await')
    })

    const transactionPromise = createNotesInTransaction()
    await transactionEntered.promise

    let queuedReadResolved = false
    let queuedReadTitles: string[] = []
    const queuedReadPromise = listNotes.all().then((rows) => {
      queuedReadResolved = true
      queuedReadTitles = rows.map((row) => row.title)
    })

    let queuedInsertResolved = false
    const queuedInsertPromise = insertNote.get('outside').then(() => {
      queuedInsertResolved = true
    })

    await Promise.resolve()
    await Promise.resolve()
    assert.equal(queuedReadResolved, false)
    assert.equal(queuedInsertResolved, false)

    releaseTransaction.resolve()
    await transactionPromise
    await queuedReadPromise
    await queuedInsertPromise

    assert.deepEqual(queuedReadTitles, ['before-await', 'after-await'])
    const notes = await listNotes.all()
    assert.deepEqual(
      notes.map((note) => note.title),
      ['before-await', 'after-await', 'outside'],
    )
  } finally {
    await database.close()
  }
})

test('sqlite async transactions roll back before queued readers resume', async () => {
  const database = createSqliteDatabase(':memory:')

  try {
    await database.exec(`
      CREATE TABLE notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL
      )
    `)

    const insertNote = database.prepare('INSERT INTO notes (title) VALUES (?)')
    const listNotes = database.prepare<{ title: string }>('SELECT title FROM notes ORDER BY id ASC')
    const releaseTransaction = createDeferred()
    const transactionEntered = createDeferred()
    const rollbackError = new Error('rollback requested')

    const createNotesInTransaction = database.transaction(async () => {
      await insertNote.run('before-rollback')
      transactionEntered.resolve()
      await releaseTransaction.promise
      throw rollbackError
    })

    const transactionPromise = createNotesInTransaction()
    await transactionEntered.promise

    let queuedReadResolved = false
    let queuedReadTitles: string[] = []
    const queuedReadPromise = listNotes.all().then((rows) => {
      queuedReadResolved = true
      queuedReadTitles = rows.map((row) => row.title)
    })

    await Promise.resolve()
    await Promise.resolve()
    assert.equal(queuedReadResolved, false)

    releaseTransaction.resolve()
    await assert.rejects(() => transactionPromise, rollbackError)
    await queuedReadPromise

    assert.deepEqual(queuedReadTitles, [])
    const notes = await listNotes.all()
    assert.deepEqual(notes, [])
  } finally {
    await database.close()
  }
})

test('createPostgresDatabase rejects missing pool and connection string', () => {
  assert.throws(
    () => createPostgresDatabase({ connectionString: '   ' }),
    /Postgres pool or connection string is required to create the Postgres note store database\./,
  )
})

test('createPostgresDatabase close preserves a provided external pool', async () => {
  let endCallCount = 0
  const pool: PostgresPoolLike = {
    async query() {
      throw new Error('query should not be called during close()')
    },
    async connect() {
      throw new Error('connect should not be called during close()')
    },
    async end() {
      endCallCount += 1
    },
  }

  const database = createPostgresDatabase({ pool })
  await database.close()

  assert.equal(endCallCount, 0)
})

test('createSqliteDatabase can open a read-only snapshot without write access', async (t) => {
  await mkdir(runtimeDirectory, { recursive: true })
  const dbPath = join(runtimeDirectory, `readonly-snapshot-${randomUUID()}.sqlite`)
  t.after(async () => {
    await chmod(dbPath, 0o666).catch(() => undefined)
    await rm(dbPath, { force: true })
  })

  const writableDatabase = createSqliteDatabase(dbPath)

  try {
    await writableDatabase.exec(`
      CREATE TABLE notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL
      )
    `)
    await writableDatabase.prepare('INSERT INTO notes (title) VALUES (?)').run('Snapshot note')
  } finally {
    await writableDatabase.close()
  }

  await chmod(dbPath, 0o444)

  const readonlyDatabase = createSqliteDatabase(dbPath, { readonly: true })

  try {
    const notes = await readonlyDatabase
      .prepare<{ title: string }>('SELECT title FROM notes ORDER BY id ASC')
      .all()
    assert.deepEqual(notes.map((note) => note.title), ['Snapshot note'])
    await assert.rejects(
      () => readonlyDatabase.prepare('INSERT INTO notes (title) VALUES (?)').run('Nope'),
      /readonly/i,
    )
  } finally {
    await readonlyDatabase.close()
  }
})

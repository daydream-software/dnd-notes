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

test('sqlite close waits for queued work before closing the database', async () => {
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

    const createNotesInTransaction = database.transaction(async () => {
      await insertNote.run('before-close')
      transactionEntered.resolve()
      await releaseTransaction.promise
      await insertNote.run('after-close')
    })

    const transactionPromise = createNotesInTransaction()
    await transactionEntered.promise

    const queuedReadPromise = listNotes.all()
    const closePromise = database.close()

    await Promise.resolve()
    await Promise.resolve()

    releaseTransaction.resolve()

    await transactionPromise
    assert.deepEqual(
      (await queuedReadPromise).map((row) => row.title),
      ['before-close', 'after-close'],
    )
    await closePromise
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

test('createPostgresDatabase preserves callback errors when rollback also fails', async () => {
  let released = false
  const queries: string[] = []
  const callbackError = new Error('callback failed')
  const rollbackError = new Error('rollback failed')
  const pool: PostgresPoolLike = {
    async query() {
      throw new Error('pool.query should not be called')
    },
    async connect() {
      return {
        async query(text) {
          queries.push(text)

          if (text === 'ROLLBACK') {
            throw rollbackError
          }

          return { rows: [], rowCount: 0 }
        },
        release() {
          released = true
        },
      }
    },
    async end() {
      throw new Error('pool.end should not be called')
    },
  }

  const database = createPostgresDatabase({ pool })
  const transaction = database.transaction(async () => {
    throw callbackError
  })

  await assert.rejects(() => transaction(), callbackError)
  assert.deepEqual(queries, ['BEGIN', 'ROLLBACK'])
  assert.equal(released, true)
})

test('createPostgresDatabase preserves BEGIN errors when rollback also fails', async () => {
  let callbackRan = false
  let released = false
  const queries: string[] = []
  const beginError = new Error('begin failed')
  const rollbackError = new Error('rollback failed')
  const pool: PostgresPoolLike = {
    async query() {
      throw new Error('pool.query should not be called')
    },
    async connect() {
      return {
        async query(text) {
          queries.push(text)

          if (text === 'BEGIN') {
            throw beginError
          }

          if (text === 'ROLLBACK') {
            throw rollbackError
          }

          return { rows: [], rowCount: 0 }
        },
        release() {
          released = true
        },
      }
    },
    async end() {
      throw new Error('pool.end should not be called')
    },
  }

  const database = createPostgresDatabase({ pool })
  const transaction = database.transaction(async () => {
    callbackRan = true
    return 'unreachable'
  })

  await assert.rejects(() => transaction(), beginError)
  assert.equal(callbackRan, false)
  assert.deepEqual(queries, ['BEGIN', 'ROLLBACK'])
  assert.equal(released, true)
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

test('createSqliteDatabase keeps writable file-backed stores on rollback journals', async (t) => {
  await mkdir(runtimeDirectory, { recursive: true })
  const dbPath = join(runtimeDirectory, `journal-mode-${randomUUID()}.sqlite`)
  t.after(async () => {
    await rm(dbPath, { force: true })
    await rm(`${dbPath}-wal`, { force: true })
    await rm(`${dbPath}-shm`, { force: true })
  })

  const seededDatabase = createSqliteDatabase(dbPath)
  try {
    const seededJournalMode = await seededDatabase
      .prepare<{ journal_mode: string }>('PRAGMA journal_mode = WAL')
      .get()
    assert.equal(seededJournalMode?.journal_mode, 'wal')
    await seededDatabase.exec(`
      CREATE TABLE notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL
      );

      INSERT INTO notes (title) VALUES ('WAL seed');
    `)
  } finally {
    await seededDatabase.close()
  }

  const writableDatabase = createSqliteDatabase(dbPath)
  try {
    const journalMode = await writableDatabase
      .prepare<{ journal_mode: string }>('PRAGMA journal_mode')
      .get()
    assert.equal(journalMode?.journal_mode, 'delete')
  } finally {
    await writableDatabase.close()
  }

  const readonlyDatabase = createSqliteDatabase(dbPath, { readonly: true })
  try {
    const journalMode = await readonlyDatabase
      .prepare<{ journal_mode: string }>('PRAGMA journal_mode')
      .get()
    assert.equal(journalMode?.journal_mode, 'delete')
  } finally {
    await readonlyDatabase.close()
  }
})

test('createSqliteDatabase exec rejects readonly multi-statement writes', async (t) => {
  await mkdir(runtimeDirectory, { recursive: true })
  const dbPath = join(runtimeDirectory, `readonly-multi-${randomUUID()}.sqlite`)
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
      );

      INSERT INTO notes (title) VALUES ('Seed');
    `)
  } finally {
    await writableDatabase.close()
  }

  await chmod(dbPath, 0o444)

  const readonlyDatabase = createSqliteDatabase(dbPath, { readonly: true })
  try {
    await assert.rejects(
      () =>
        readonlyDatabase.exec(`
          SELECT title FROM notes ORDER BY id ASC;
          INSERT INTO notes (title) VALUES ('Blocked');
        `),
      /readonly/i,
    )
  } finally {
    await readonlyDatabase.close()
  }
})

test('createSqliteDatabase exec persists multi-statement writes to disk', async (t) => {
  await mkdir(runtimeDirectory, { recursive: true })
  const dbPath = join(runtimeDirectory, `persist-multi-${randomUUID()}.sqlite`)
  t.after(async () => {
    await rm(dbPath, { force: true })
  })

  const database = createSqliteDatabase(dbPath)
  try {
    await database.exec(`
      CREATE TABLE notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL
      );

      SELECT 1;
      INSERT INTO notes (title) VALUES ('Persisted');
    `)
  } finally {
    await database.close()
  }

  const reopenedDatabase = createSqliteDatabase(dbPath, { readonly: true })
  try {
    const notes = await reopenedDatabase
      .prepare<{ title: string }>('SELECT title FROM notes ORDER BY id ASC')
      .all()
    assert.deepEqual(notes.map((note) => note.title), ['Persisted'])
  } finally {
    await reopenedDatabase.close()
  }
})

test('sqlite close handles multiple concurrent close() calls safely', async () => {
  const database = createSqliteDatabase(':memory:')
  
  await database.exec(`
    CREATE TABLE notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL
    )
  `)
  
  // Call close multiple times concurrently - should be idempotent
  await Promise.all([
    database.close(),
    database.close(),
    database.close()
  ])
  
  // All should complete without error (test passes if no exception thrown)
})

test('sqlite operations after close throw appropriate error', async () => {
  const database = createSqliteDatabase(':memory:')
  
  await database.exec(`
    CREATE TABLE notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL
    )
  `)
  
  await database.close()
  
  await assert.rejects(
    async () => await database.exec(`INSERT INTO notes (title) VALUES ('test')`),
    { message: 'SQLite database is closed.' }
  )
})

test('sqlite close called from within a transaction should wait', async () => {
  const database = createSqliteDatabase(':memory:')
  
  try {
    await database.exec(`
      CREATE TABLE notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL
      )
    `)
    
    const insertNote = database.prepare('INSERT INTO notes (title) VALUES (?)')
    let closeCalled = false
    let transactionCompleted = false
    
    const transactionFn = database.transaction(async () => {
      await insertNote.run('test-note')
      
      // Try to close the database from within the transaction
      const closePromise = database.close()
      closeCalled = true
      
      // Do more work after calling close
      await insertNote.run('after-close-call')
      transactionCompleted = true
      
      // Wait for close to complete
      await closePromise
    })
    
    await transactionFn()
    
    assert.ok(closeCalled, 'close should have been called')
    assert.ok(transactionCompleted, 'transaction should have completed')
  } finally {
    await database.close()
  }
})

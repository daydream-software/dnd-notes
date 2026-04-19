import assert from 'node:assert/strict'
import test from 'node:test'
import { createSqliteDatabase } from '../src/note-store-database.js'

function createDeferred() {
  let resolve!: () => void
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve
  })

  return { promise, resolve }
}

test('sqlite transactions keep unrelated statements queued until commit', async () => {
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

    let queuedInsertResolved = false
    const queuedInsertPromise = insertNote.get('outside').then(() => {
      queuedInsertResolved = true
    })

    await Promise.resolve()
    await Promise.resolve()
    assert.equal(queuedInsertResolved, false)

    releaseTransaction.resolve()
    await transactionPromise
    await queuedInsertPromise

    const notes = await listNotes.all()
    assert.deepEqual(
      notes.map((note) => note.title),
      ['before-await', 'after-await', 'outside'],
    )
  } finally {
    await database.close()
  }
})

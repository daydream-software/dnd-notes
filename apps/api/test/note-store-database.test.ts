import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createPostgresDatabase,
  type PostgresPoolLike,
} from '../src/note-store-database.js'

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

test('createPostgresDatabase exec splits same-line multi-statement SQL outside quotes and comments', async () => {
  const queries: string[] = []
  const pool: PostgresPoolLike = {
    async query(text) {
      queries.push(text)
      return { rows: [], rowCount: 0 }
    },
    async connect() {
      throw new Error('connect should not be called')
    },
    async end() {
      throw new Error('pool.end should not be called')
    },
  }

  const database = createPostgresDatabase({ pool })
  await database.exec(
    "SELECT 1; SELECT 'two;still string'; SELECT $$three;still dollar$$; SELECT 4 /* keep ; inside comment */",
  )

  assert.deepEqual(queries, [
    'SELECT 1',
    "SELECT 'two;still string'",
    'SELECT $$three;still dollar$$',
    'SELECT 4 /* keep ; inside comment */',
  ])
})

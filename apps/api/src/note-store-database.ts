import Database from 'better-sqlite3'
import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  Pool,
  type PoolConfig,
  type QueryResult,
  type QueryResultRow,
} from 'pg'

export interface DatabaseStatement<Row> {
  get(...params: unknown[]): Promise<Row | undefined>
  all(...params: unknown[]): Promise<Row[]>
  run(...params: unknown[]): Promise<{ changes: number }>
}

export interface NoteStoreDatabase {
  kind: 'sqlite' | 'postgres'
  prepare<Row extends QueryResultRow = QueryResultRow>(sql: string): DatabaseStatement<Row>
  exec(sql: string): Promise<void>
  transaction<Args extends unknown[], Result>(
    callback: (...args: Args) => Promise<Result>,
  ): (...args: Args) => Promise<Result>
  close(): Promise<void>
  backup?(destinationPath: string): Promise<void>
}

export interface CreateSqliteDatabaseOptions {
  readonly?: boolean
}

export interface PostgresQueryable {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>
}

export interface PostgresPoolLike extends PostgresQueryable {
  connect(): Promise<PostgresClientLike>
  end(): Promise<void>
}

export interface PostgresClientLike extends PostgresQueryable {
  release(): void
}

interface SqliteTransactionContext {
  readonly holdsExclusiveAccess: true
}

function isNamedParameterObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeStatementParameters(args: unknown[]) {
  if (args.length === 0) {
    return undefined
  }

  if (args.length === 1 && (Array.isArray(args[0]) || isNamedParameterObject(args[0]))) {
    return args[0] as unknown[] | Record<string, unknown>
  }

  return args
}

function compileNamedParameters(sql: string, values: Record<string, unknown>) {
  const orderedValues: unknown[] = []
  const indexes = new Map<string, number>()

  const text = sql.replace(/@([a-zA-Z_][a-zA-Z0-9_]*)/g, (_match, name: string) => {
    if (!indexes.has(name)) {
      orderedValues.push(values[name])
      indexes.set(name, orderedValues.length)
    }

    return `$${indexes.get(name)}`
  })

  return { text, values: orderedValues }
}

function compilePositionalParameters(sql: string, values: readonly unknown[]) {
  let index = 0
  const text = sql.replace(/\?/g, () => {
    index += 1
    return `$${index}`
  })

  return { text, values: [...values] }
}

function compilePostgresQuery(sql: string, params?: unknown[] | Record<string, unknown>) {
  if (!params) {
    return { text: sql, values: [] as unknown[] }
  }

  if (Array.isArray(params)) {
    return compilePositionalParameters(sql, params)
  }

  return compileNamedParameters(sql, params)
}

export function createSqliteDatabase(
  dbPath: string,
  options: CreateSqliteDatabaseOptions = {},
): NoteStoreDatabase {
  if (!options.readonly && dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true })
  }

  const database = options.readonly
    ? new Database(dbPath, {
        readonly: true,
        fileMustExist: true,
      })
    : new Database(dbPath)

  if (!options.readonly) {
    if (dbPath !== ':memory:') {
      const journalMode = String(
        database.pragma('journal_mode = DELETE', { simple: true }) ?? '',
      ).toLowerCase()
      if (journalMode !== 'delete') {
        throw new Error(
          `Failed to set SQLite journal_mode to DELETE for ${dbPath}; current mode is ${journalMode || 'unknown'}`,
        )
      }
    }
    database.pragma('foreign_keys = ON')
  }
  const transactionExecutor = new AsyncLocalStorage<SqliteTransactionContext>()
  let operationQueue = Promise.resolve()

  async function runSerialized<Result>(operation: () => Result | Promise<Result>) {
    const activeTransaction = transactionExecutor.getStore()
    if (activeTransaction?.holdsExclusiveAccess) {
      return operation()
    }

    let releaseQueue = () => {}
    const previousOperation = operationQueue
    operationQueue = new Promise<void>((resolve) => {
      releaseQueue = resolve
    })

    await previousOperation

    try {
      // SQLite shares one connection here. Keep the queue lease until the full async
      // operation settles so other requests cannot observe half-finished transaction work.
      return await operation()
    } finally {
      releaseQueue()
    }
  }

  return {
    kind: 'sqlite',
    prepare<Row>(sql: string): DatabaseStatement<Row> {
      const statement = database.prepare(sql)

      return {
        async get(...args: unknown[]) {
          const params = normalizeStatementParameters(args)

          return runSerialized(() => {
            if (params === undefined) {
              return statement.get() as Row | undefined
            }

            return statement.get(params as never) as Row | undefined
          })
        },
        async all(...args: unknown[]) {
          const params = normalizeStatementParameters(args)

          return runSerialized(() => {
            if (params === undefined) {
              return statement.all() as Row[]
            }

            return statement.all(params as never) as Row[]
          })
        },
        async run(...args: unknown[]) {
          const params = normalizeStatementParameters(args)

          return runSerialized(() => {
            const result =
              params === undefined
                ? statement.run()
                : statement.run(params as never)

            return { changes: result.changes }
          })
        },
      }
    },
    async exec(sql: string) {
      await runSerialized(() => {
        database.exec(sql)
      })
    },
    transaction<Args extends unknown[], Result>(
      callback: (...args: Args) => Promise<Result>,
    ) {
      return async (...args: Args) => {
        return runSerialized(async () => {
          if (transactionExecutor.getStore()) {
            return callback(...args)
          }

          database.exec('BEGIN IMMEDIATE')

          try {
            const result = await transactionExecutor.run(
              { holdsExclusiveAccess: true },
              () => callback(...args),
            )
            database.exec('COMMIT')
            return result
          } catch (error) {
            if (database.inTransaction) {
              database.exec('ROLLBACK')
            }

            throw error
          }
        })
      }
    },
    async close() {
      await runSerialized(() => {
        database.close()
      })
    },
    async backup(destinationPath: string) {
      await runSerialized(() => database.backup(destinationPath))
    },
  }
}

function parseIntegerSetting(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback
  }

  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}

function createOwnedPostgresPool(connectionString: string): PostgresPoolLike {
  const config: PoolConfig = {
    connectionString,
    min: parseIntegerSetting(process.env.NOTES_DB_POOL_MIN, 0),
    max: parseIntegerSetting(process.env.NOTES_DB_POOL_MAX, 20),
    idleTimeoutMillis: parseIntegerSetting(process.env.NOTES_DB_IDLE_TIMEOUT_MS, 30_000),
    connectionTimeoutMillis: parseIntegerSetting(
      process.env.NOTES_DB_CONNECTION_TIMEOUT_MS,
      10_000,
    ),
    statement_timeout: parseIntegerSetting(process.env.NOTES_DB_STATEMENT_TIMEOUT_MS, 30_000),
  }

  return new Pool(config)
}

function resolvePostgresPool(options: {
  connectionString?: string
  pool?: PostgresPoolLike
}) {
  if (options.pool) {
    return {
      pool: options.pool,
      ownedPool: undefined,
    }
  }

  const connectionString = options.connectionString?.trim()

  if (!connectionString) {
    throw new Error(
      'Postgres pool or connection string is required to create the Postgres note store database.',
    )
  }

  const ownedPool = createOwnedPostgresPool(connectionString)

  return {
    pool: ownedPool,
    ownedPool,
  }
}

export function createPostgresDatabase(options: {
  connectionString?: string
  pool?: PostgresPoolLike
}): NoteStoreDatabase {
  const { pool, ownedPool } = resolvePostgresPool(options)
  const transactionExecutor = new AsyncLocalStorage<PostgresQueryable>()

  function getExecutor() {
    return transactionExecutor.getStore() ?? pool
  }

  return {
    kind: 'postgres',
    prepare<Row extends QueryResultRow = QueryResultRow>(sql: string): DatabaseStatement<Row> {
      return {
        async get(...args: unknown[]) {
          const params = normalizeStatementParameters(args)
          const compiled = compilePostgresQuery(sql, params)
          const result = await getExecutor().query<Row>(
            compiled.text,
            compiled.values,
          )
          return result.rows[0]
        },
        async all(...args: unknown[]) {
          const params = normalizeStatementParameters(args)
          const compiled = compilePostgresQuery(sql, params)
          const result = await getExecutor().query<Row>(
            compiled.text,
            compiled.values,
          )
          return result.rows
        },
        async run(...args: unknown[]) {
          const params = normalizeStatementParameters(args)
          const compiled = compilePostgresQuery(sql, params)
          const result = await getExecutor().query(compiled.text, compiled.values)
          return { changes: result.rowCount ?? 0 }
        },
      }
    },
    async exec(sql: string) {
      const statements = sql
        .split(/;\s*(?:\r?\n|$)/)
        .map((statement) => statement.trim())
        .filter((statement) => statement.length > 0)

      for (const statement of statements) {
        await getExecutor().query(statement)
      }
    },
    transaction<Args extends unknown[], Result>(
      callback: (...args: Args) => Promise<Result>,
    ) {
      return async (...args: Args) => {
        const client = await pool.connect()

        try {
          await client.query('BEGIN')

          const result = await transactionExecutor.run(client, () => callback(...args))

          await client.query('COMMIT')
          return result
        } catch (error) {
          try {
            await client.query('ROLLBACK')
          } catch {
            // Preserve the original failure so rollback errors do not mask the real cause.
          }
          throw error
        } finally {
          client.release()
        }
      }
    },
    async close() {
      await ownedPool?.end()
    },
  }
}

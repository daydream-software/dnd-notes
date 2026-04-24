import { randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import initSqlJs from 'sql.js'
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

type SqliteBindScalar = number | string | Uint8Array | null | boolean
type SqliteBindParams = SqliteBindScalar[] | Record<string, SqliteBindScalar>

interface SqliteStatementLike {
  bind(values?: SqliteBindParams | null): boolean
  free(): boolean
  getAsObject(values?: SqliteBindParams | null): Record<string, unknown>
  run(values?: SqliteBindParams | null): void
  step(): boolean
}

interface SqliteExecResult {
  columns: string[]
  values: unknown[][]
}

interface SqliteDatabaseLike {
  close(): void
  exec(sql: string, params?: SqliteBindParams | null): SqliteExecResult[]
  export(): Uint8Array
  getRowsModified(): number
  prepare(sql: string, params?: SqliteBindParams | null): SqliteStatementLike
  run(sql: string, params?: SqliteBindParams | null): SqliteDatabaseLike
}

interface SqliteModuleLike {
  Database: new (data?: ArrayLike<number> | null) => SqliteDatabaseLike
}

interface LoadedSqliteDatabase {
  database: SqliteDatabaseLike
  dbPath: string
  readonly: boolean
  closed: boolean
  persistedBytes: Buffer | null
}

const sqliteModulePromise: Promise<SqliteModuleLike> = initSqlJs()

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

function normalizeSqliteParameters(
  params?: unknown[] | Record<string, unknown>,
): SqliteBindParams | undefined {
  if (!params) {
    return undefined
  }

  if (Array.isArray(params)) {
    return params as SqliteBindScalar[]
  }

  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key.startsWith('@') || key.startsWith(':') || key.startsWith('$') ? key : `@${key}`,
      value as SqliteBindScalar,
    ]),
  )
}

function stripLeadingSqlComments(sql: string) {
  let remaining = sql.trimStart()

  while (remaining.startsWith('--') || remaining.startsWith('/*')) {
    if (remaining.startsWith('--')) {
      const lineBreakIndex = remaining.indexOf('\n')
      remaining =
        lineBreakIndex === -1 ? '' : remaining.slice(lineBreakIndex + 1).trimStart()
      continue
    }

    const blockCommentEnd = remaining.indexOf('*/')
    if (blockCommentEnd === -1) {
      return ''
    }
    remaining = remaining.slice(blockCommentEnd + 2).trimStart()
  }

  return remaining
}

function isSqliteMutationSql(sql: string) {
  const normalizedSql = stripLeadingSqlComments(sql)
  const firstToken = normalizedSql.match(/^[A-Za-z]+/)?.[0]?.toUpperCase()

  if (!firstToken) {
    return false
  }

  if (firstToken === 'PRAGMA') {
    return /=/.test(normalizedSql)
  }

  return [
    'ALTER',
    'ANALYZE',
    'BEGIN',
    'COMMIT',
    'CREATE',
    'DELETE',
    'DROP',
    'INSERT',
    'REINDEX',
    'RELEASE',
    'REPLACE',
    'ROLLBACK',
    'SAVEPOINT',
    'UPDATE',
    'VACUUM',
  ].includes(firstToken)
}

function splitSqlStatements(sql: string) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
}

function ensureSqliteDatabaseOpen(state: LoadedSqliteDatabase) {
  if (state.closed) {
    throw new Error('SQLite database is closed.')
  }
}

function ensureSqliteDatabaseWritable(state: LoadedSqliteDatabase) {
  if (state.readonly) {
    throw new Error('attempt to write a readonly database')
  }
}

function persistSqliteDatabase(state: LoadedSqliteDatabase) {
  if (state.readonly || state.dbPath === ':memory:') {
    return
  }

  mkdirSync(dirname(state.dbPath), { recursive: true })
  const snapshotBytes = Buffer.from(state.database.export())
  const tempPath = `${state.dbPath}.tmp-${randomUUID()}`

  try {
    writeFileSync(tempPath, snapshotBytes, { mode: 0o600 })
    renameSync(tempPath, state.dbPath)
    state.persistedBytes = snapshotBytes
  } finally {
    rmSync(tempPath, { force: true })
  }
}

function readSqlitePragmaString(database: SqliteDatabaseLike, sql: string, columnName: string) {
  const statement = database.prepare(sql)

  try {
    if (!statement.step()) {
      return ''
    }

    const row = statement.getAsObject()
    const value = row[columnName]
    return value === undefined || value === null ? '' : String(value).toLowerCase()
  } finally {
    statement.free()
  }
}

async function loadSqliteDatabase(
  dbPath: string,
  options: CreateSqliteDatabaseOptions,
): Promise<LoadedSqliteDatabase> {
  const SQL = await sqliteModulePromise

  if (options.readonly && dbPath !== ':memory:' && !existsSync(dbPath)) {
    throw new Error(`SQLite snapshot does not exist at ${dbPath}.`)
  }

  if (!options.readonly && dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true })
  }

  const data =
    dbPath !== ':memory:' && existsSync(dbPath) ? readFileSync(dbPath) : undefined
  const database = new SQL.Database(data)
  const state: LoadedSqliteDatabase = {
    database,
    dbPath,
    readonly: Boolean(options.readonly),
    closed: false,
    persistedBytes: data ? Buffer.from(data) : null,
  }

  if (!state.readonly) {
    const journalMode = readSqlitePragmaString(database, 'PRAGMA journal_mode = DELETE', 'journal_mode')

    if (dbPath !== ':memory:' && journalMode !== 'delete') {
      throw new Error(
        `Failed to set SQLite journal_mode to DELETE for ${dbPath}; current mode is ${journalMode || 'unknown'}`,
      )
    }

    database.exec('PRAGMA foreign_keys = ON')
    persistSqliteDatabase(state)
  }

  return state
}

async function refreshSqliteDatabaseFromDisk(state: LoadedSqliteDatabase) {
  if (state.closed || state.dbPath === ':memory:') {
    return
  }

  const nextBytes = existsSync(state.dbPath) ? readFileSync(state.dbPath) : null
  const currentBytes = state.persistedBytes

  if (
    (currentBytes === null && nextBytes === null) ||
    (currentBytes !== null && nextBytes !== null && currentBytes.equals(nextBytes))
  ) {
    return
  }

  const SQL = await sqliteModulePromise
  const nextDatabase = new SQL.Database(nextBytes ?? undefined)

  if (!state.readonly) {
    nextDatabase.exec('PRAGMA foreign_keys = ON')
  }

  state.database.close()
  state.database = nextDatabase
  state.persistedBytes = nextBytes ? Buffer.from(nextBytes) : null
}

function finalizeSqliteClose(state: LoadedSqliteDatabase) {
  if (state.closed) {
    return
  }

  if (!state.readonly) {
    persistSqliteDatabase(state)
  }

  state.database.close()
  state.closed = true
}

export function createSqliteDatabase(
  dbPath: string,
  options: CreateSqliteDatabaseOptions = {},
): NoteStoreDatabase {
  const transactionExecutor = new AsyncLocalStorage<SqliteTransactionContext>()
  const databaseStatePromise = loadSqliteDatabase(dbPath, options)
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
      return await operation()
    } finally {
      releaseQueue()
    }
  }

  async function withLoadedDatabase<Result>(
    callback: (state: LoadedSqliteDatabase) => Result | Promise<Result>,
  ) {
    const state = await databaseStatePromise
    ensureSqliteDatabaseOpen(state)
    if (!transactionExecutor.getStore()) {
      await refreshSqliteDatabaseFromDisk(state)
    }
    return callback(state)
  }

  async function persistMutationIfNeeded(state: LoadedSqliteDatabase, sql: string) {
    if (transactionExecutor.getStore() || !isSqliteMutationSql(sql)) {
      return
    }

    persistSqliteDatabase(state)
  }

  return {
    kind: 'sqlite',
    prepare<Row>(sql: string): DatabaseStatement<Row> {
      return {
        async get(...args: unknown[]) {
          const params = normalizeSqliteParameters(normalizeStatementParameters(args))

          return runSerialized(async () => {
            return withLoadedDatabase(async (state) => {
              if (state.readonly && isSqliteMutationSql(sql)) {
                ensureSqliteDatabaseWritable(state)
              }

              const statement = state.database.prepare(sql)

              try {
                if (params !== undefined) {
                  statement.bind(params)
                }

                const row = statement.step() ? (statement.getAsObject() as Row) : undefined
                await persistMutationIfNeeded(state, sql)
                return row
              } finally {
                statement.free()
              }
            })
          })
        },
        async all(...args: unknown[]) {
          const params = normalizeSqliteParameters(normalizeStatementParameters(args))

          return runSerialized(async () => {
            return withLoadedDatabase(async (state) => {
              if (state.readonly && isSqliteMutationSql(sql)) {
                ensureSqliteDatabaseWritable(state)
              }

              const statement = state.database.prepare(sql)

              try {
                if (params !== undefined) {
                  statement.bind(params)
                }

                const rows: Row[] = []
                while (statement.step()) {
                  rows.push(statement.getAsObject() as Row)
                }
                await persistMutationIfNeeded(state, sql)
                return rows
              } finally {
                statement.free()
              }
            })
          })
        },
        async run(...args: unknown[]) {
          const params = normalizeSqliteParameters(normalizeStatementParameters(args))

          return runSerialized(async () => {
            return withLoadedDatabase(async (state) => {
              if (state.readonly) {
                ensureSqliteDatabaseWritable(state)
              }

              const statement = state.database.prepare(sql)

              try {
                statement.run(params)
                const result = { changes: state.database.getRowsModified() }
                await persistMutationIfNeeded(state, sql)
                return result
              } finally {
                statement.free()
              }
            })
          })
        },
      }
    },
    async exec(sql: string) {
      await runSerialized(async () => {
        await withLoadedDatabase(async (state) => {
          const statements = splitSqlStatements(sql)
          const mutationStatement = statements.find((statement) =>
            isSqliteMutationSql(statement),
          )

          if (state.readonly && mutationStatement) {
            ensureSqliteDatabaseWritable(state)
          }

          state.database.exec(sql)

          if (mutationStatement) {
            await persistMutationIfNeeded(state, mutationStatement)
          }
        })
      })
    },
    transaction<Args extends unknown[], Result>(
      callback: (...args: Args) => Promise<Result>,
    ) {
      return async (...args: Args) => {
        return runSerialized(async () => {
          return withLoadedDatabase(async (state) => {
            if (transactionExecutor.getStore()) {
              return callback(...args)
            }

            ensureSqliteDatabaseWritable(state)
            state.database.run('BEGIN IMMEDIATE')

            try {
              const result = await transactionExecutor.run(
                { holdsExclusiveAccess: true },
                () => callback(...args),
              )
              state.database.run('COMMIT')
              persistSqliteDatabase(state)
              return result
            } catch (error) {
              try {
                state.database.run('ROLLBACK')
              } catch {
                // Preserve the original failure so rollback errors do not mask it.
              }

              throw error
            }
          })
        })
      }
    },
    async close() {
      if (transactionExecutor.getStore()?.holdsExclusiveAccess) {
        throw new Error('Cannot close the database from within an active transaction.')
      }

      await runSerialized(async () => {
        await databaseStatePromise.then(
          (state) => {
            finalizeSqliteClose(state)
          },
          () => undefined,
        )
      })
    },
    async backup(destinationPath: string) {
      await runSerialized(async () => {
        await withLoadedDatabase(async (state) => {
          mkdirSync(dirname(destinationPath), { recursive: true })
          writeFileSync(destinationPath, Buffer.from(state.database.export()))
        })
      })
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

import { AsyncLocalStorage } from 'node:async_hooks'
import {
  Pool,
  type PoolConfig,
  type QueryResultRow,
} from 'pg'

export interface DatabaseStatement<Row> {
  get(...params: unknown[]): Promise<Row | undefined>
  all(...params: unknown[]): Promise<Row[]>
  run(...params: unknown[]): Promise<{ changes: number }>
}

export interface NoteStoreDatabase {
  kind: 'postgres'
  prepare<Row extends QueryResultRow = QueryResultRow>(sql: string): DatabaseStatement<Row>
  exec(sql: string): Promise<void>
  transaction<Args extends unknown[], Result>(
    callback: (...args: Args) => Promise<Result>,
  ): (...args: Args) => Promise<Result>
  close(): Promise<void>
}

export interface PostgresQueryable {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Row[]; rowCount: number | null }>
}

export interface PostgresPoolLike extends PostgresQueryable {
  connect(): Promise<PostgresClientLike>
  end(): Promise<void>
}

export interface PostgresClientLike extends PostgresQueryable {
  release(): void
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

function isNamedParameterObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

function parseIntegerSetting(rawValue: string | undefined, defaultValue: number) {
  if (!rawValue) {
    return defaultValue
  }

  const parsed = Number.parseInt(rawValue, 10)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : defaultValue
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

function splitSqlStatements(sql: string) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
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
          const result = await getExecutor().query<Row>(compiled.text, compiled.values)
          return result.rows[0]
        },
        async all(...args: unknown[]) {
          const params = normalizeStatementParameters(args)
          const compiled = compilePostgresQuery(sql, params)
          const result = await getExecutor().query<Row>(compiled.text, compiled.values)
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
      const statements = splitSqlStatements(sql)

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

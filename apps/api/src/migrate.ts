import fs from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { Umzug, type MigrationParams, type UmzugStorage } from 'umzug'

export interface MigrationPoolLike {
  connect(): Promise<MigrationClientLike>
}

export interface MigrationClientLike {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }>
  release(error?: Error): void
}

export interface MigrationLogger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

const defaultLogger: MigrationLogger = {
  info(message) {
    console.log(`[migrate] ${message}`)
  },
  warn(message) {
    console.warn(`[migrate] ${message}`)
  },
  error(message) {
    console.error(`[migrate] ${message}`)
  },
}

const schemaMigrationsTablePrefix = 'schema_migrations_'
const schemaMigrationsIndexPrefix = 'sm_'
const defaultLockAcquireTimeoutMs = 30_000
const defaultLockRetryDelayMs = 250
const maxLockRetryDelayMs = 1_000

export interface RunMigrationsOptions {
  pool: MigrationPoolLike
  migrationsDir: string
  /**
   * Unique identifier for the service/migration set. Used to namespace the
   * migration ledger table so different services can share a database without
   * colliding on `0001_*.sql` filenames.
   */
  migrationSet: string
  /**
   * Two-integer namespace key used with Postgres advisory locks to serialize
   * concurrent migration runs across pods. Use a different namespace per
   * service (control-plane vs tenant API) so they don't block each other.
   */
  lockKey: readonly [number, number]
  logger?: MigrationLogger
}

interface MigrationContext {
  client: MigrationClientLike
}

/**
 * Apply all pending SQL migrations in `migrationsDir` against `pool`.
 *
 * Concurrency is guarded by a session-level Postgres advisory lock acquired on
 * the migration client. Each migration runs in its own transaction that also
 * writes to a namespaced schema_migrations ledger, so a crashed pod leaves the
 * database either fully migrated or fully unchanged for that file.
 */
export async function runMigrations(options: RunMigrationsOptions): Promise<string[]> {
  const logger = options.logger ?? defaultLogger
  const lockKey = options.lockKey
  const ledgerTable = resolveMigrationLedgerTableName(options.migrationSet)
  const ledgerIndex = resolveMigrationLedgerIndexName(options.migrationSet)

  const client = await options.pool.connect()
  let lockAcquired = false

  try {
    await acquireMigrationLock(client, lockKey, logger)
    lockAcquired = true

    await ensureMigrationLedgerTable(client, ledgerTable, ledgerIndex)

    const umzug = new Umzug<MigrationContext>({
      context: { client },
      migrations: {
        glob: ['*.sql', { cwd: options.migrationsDir }],
        resolve: ({ name, path: filePath }) =>
          createSqlMigration({
            name,
            filePath: filePath ?? '',
            ledgerTable,
          }),
      },
      storage: createPostgresStorage(client, ledgerTable),
      logger: {
        info: (event) => logger.info(formatUmzugEvent(event)),
        warn: (event) => logger.warn(formatUmzugEvent(event)),
        error: (event) => logger.error(formatUmzugEvent(event)),
        debug: () => {
          // Debug events are too chatty for service boot logs.
        },
      },
    })

    const applied = await umzug.up()
    return applied.map((entry) => entry.name)
  } finally {
    if (lockAcquired) {
      try {
        await client.query(
          'SELECT pg_advisory_unlock($1::integer, $2::integer)',
          lockKey,
        )
      } catch (error) {
        logger.warn(
          `Failed to release migration advisory lock: ${formatUnknownError(error)}`,
        )
      }
    }

    client.release()
  }
}

function createPostgresStorage(
  client: MigrationClientLike,
  ledgerTable: string,
): UmzugStorage<MigrationContext> {
  return {
    async logMigration({ name }: MigrationParams<MigrationContext>) {
      // The migration's up() already inserts within its transaction so the
      // post-hook is best-effort and idempotent.
      await client.query(
        `INSERT INTO ${ledgerTable} (name) VALUES ($1)
         ON CONFLICT (name) DO NOTHING`,
        [name],
      )
    },
    async unlogMigration({ name }: MigrationParams<MigrationContext>) {
      await client.query(`DELETE FROM ${ledgerTable} WHERE name = $1`, [name])
    },
    async executed() {
      const result = (await client.query(
        `SELECT name FROM ${ledgerTable} ORDER BY name`,
      )) as { rows: Array<{ name: string }> }
      return result.rows.map((row) => row.name)
    },
  }
}

function createSqlMigration({
  name,
  filePath,
  ledgerTable,
}: {
  name: string
  filePath: string
  ledgerTable: string
}) {
  return {
    name,
    path: filePath,
    up: async ({ context }: MigrationParams<MigrationContext>) => {
      const sql = await fs.readFile(filePath, 'utf8')
      const client = context.client

      await client.query('BEGIN')
      try {
        if (sql.trim().length > 0) {
          await client.query(sql)
        }
        await client.query(
          `INSERT INTO ${ledgerTable} (name) VALUES ($1)
           ON CONFLICT (name) DO NOTHING`,
          [name],
        )
        await client.query('COMMIT')
      } catch (error) {
        try {
          await client.query('ROLLBACK')
        } catch {
          // Preserve the original failure.
        }
        throw error
      }
    },
    down: async () => {
      throw new Error(
        `Down migrations are disabled by policy (roll-forward only); refused to revert ${name}.`,
      )
    },
  }
}

async function acquireMigrationLock(
  client: MigrationClientLike,
  lockKey: readonly [number, number],
  logger: MigrationLogger,
): Promise<void> {
  const startedAt = Date.now()
  let attempt = 0

  while (true) {
    attempt += 1

    const lockResult = (await client.query(
      'SELECT pg_try_advisory_lock($1::integer, $2::integer) AS locked',
      lockKey,
    )) as { rows: Array<{ locked: boolean }> }

    if (lockResult.rows[0]?.locked) {
      return
    }

    const elapsedMs = Date.now() - startedAt
    if (elapsedMs >= defaultLockAcquireTimeoutMs) {
      throw new Error(
        `Timed out waiting for migration advisory lock (${lockKey[0]}, ${lockKey[1]}) after ${defaultLockAcquireTimeoutMs}ms.`,
      )
    }

    const waitMs = Math.min(
      defaultLockRetryDelayMs * 2 ** (attempt - 1),
      maxLockRetryDelayMs,
      defaultLockAcquireTimeoutMs - elapsedMs,
    )

    if (attempt === 1) {
      logger.info(
        `Migration advisory lock busy; waiting for lock (${lockKey[0]}, ${lockKey[1]}).`,
      )
    }

    await delay(waitMs)
  }
}

async function ensureMigrationLedgerTable(
  client: MigrationClientLike,
  ledgerTable: string,
  ledgerIndex: string,
): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${ledgerTable} (
      name TEXT
    )
  `)
  await client.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS ${ledgerIndex} ON ${ledgerTable}(name)`,
  )
}

function resolveMigrationLedgerTableName(migrationSet: string): string {
  const normalized = normalizeMigrationSetName(migrationSet)
  const tableName = `${schemaMigrationsTablePrefix}${normalized}`

  if (tableName.length > 63) {
    throw new Error(
      `Migration ledger table name "${tableName}" exceeds Postgres's 63-character identifier limit.`,
    )
  }

  return tableName
}

function resolveMigrationLedgerIndexName(migrationSet: string): string {
  const normalized = normalizeMigrationSetName(migrationSet)
  const indexName = `${schemaMigrationsIndexPrefix}${normalized}_name_idx`

  if (indexName.length > 63) {
    throw new Error(
      `Migration ledger index name "${indexName}" exceeds Postgres's 63-character identifier limit.`,
    )
  }

  return indexName
}

function normalizeMigrationSetName(migrationSet: string): string {
  const normalized = migrationSet.trim().toLowerCase()

  if (!/^[a-z][a-z0-9_]*$/.test(normalized)) {
    throw new Error(
      `Invalid migration set "${migrationSet}". Use lowercase letters, numbers, and underscores only.`,
    )
  }

  return normalized
}

function formatUmzugEvent(event: unknown): string {
  if (typeof event === 'string') {
    return event
  }

  if (event && typeof event === 'object') {
    const record = event as { event?: string; name?: string; message?: string }

    if (record.event && record.name) {
      return `${record.event}: ${record.name}`
    }

    if (record.message) {
      return record.message
    }

    try {
      return JSON.stringify(event)
    } catch {
      return String(event)
    }
  }

  return String(event)
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

/**
 * List the migration files present on disk in apply order. Useful for tests
 * that assert against the expected migration set.
 */
export async function listMigrationFiles(migrationsDir: string): Promise<string[]> {
  const entries = await fs.readdir(migrationsDir)
  return entries.filter((entry) => entry.endsWith('.sql')).sort()
}

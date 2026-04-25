import fs from 'node:fs/promises'
import path from 'node:path'
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

const SCHEMA_MIGRATIONS_TABLE = 'schema_migrations'

export interface RunMigrationsOptions {
  pool: MigrationPoolLike
  migrationsDir: string
  /**
   * Two-integer namespace key used with `pg_try_advisory_lock` to serialize
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
 * Concurrency is guarded by a session-level Postgres advisory lock acquired
 * on the migration client. Each migration runs in its own transaction that
 * also writes to `schema_migrations`, so a crashed pod leaves the database
 * either fully migrated or fully unchanged for that file.
 */
export async function runMigrations(options: RunMigrationsOptions): Promise<string[]> {
  const logger = options.logger ?? defaultLogger
  const lockKey = options.lockKey

  const client = await options.pool.connect()
  let lockAcquired = false

  try {
    const lockResult = (await client.query(
      'SELECT pg_try_advisory_lock($1::integer, $2::integer) AS locked',
      lockKey,
    )) as { rows: Array<{ locked: boolean }> }

    if (!lockResult.rows[0]?.locked) {
      throw new Error(
        `Could not acquire migration advisory lock (${lockKey[0]}, ${lockKey[1]}).`,
      )
    }

    lockAcquired = true

    const tableExists = (await client.query(
      `SELECT 1 AS present
       FROM information_schema.tables
       WHERE table_schema = current_schema()
         AND table_name = $1`,
      [SCHEMA_MIGRATIONS_TABLE],
    )) as { rows: Array<{ present: number }> }

    if (tableExists.rows.length === 0) {
      await client.query(`
        CREATE TABLE ${SCHEMA_MIGRATIONS_TABLE} (
          name TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `)
    }

    const umzug = new Umzug<MigrationContext>({
      context: { client },
      migrations: {
        glob: ['*.sql', { cwd: options.migrationsDir }],
        resolve: ({ name, path: filePath }) =>
          createSqlMigration({ name, filePath: filePath ?? '' }),
      },
      storage: createPostgresStorage(client),
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
): UmzugStorage<MigrationContext> {
  return {
    async logMigration({ name }: MigrationParams<MigrationContext>) {
      // The migration's up() already inserts within its transaction so the
      // post-hook is best-effort and idempotent.
      await client.query(
        `INSERT INTO ${SCHEMA_MIGRATIONS_TABLE} (name) VALUES ($1)
         ON CONFLICT (name) DO NOTHING`,
        [name],
      )
    },
    async unlogMigration({ name }: MigrationParams<MigrationContext>) {
      await client.query(
        `DELETE FROM ${SCHEMA_MIGRATIONS_TABLE} WHERE name = $1`,
        [name],
      )
    },
    async executed() {
      const result = (await client.query(
        `SELECT name FROM ${SCHEMA_MIGRATIONS_TABLE} ORDER BY name`,
      )) as { rows: Array<{ name: string }> }
      return result.rows.map((row) => row.name)
    },
  }
}

function createSqlMigration({
  name,
  filePath,
}: {
  name: string
  filePath: string
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
          `INSERT INTO ${SCHEMA_MIGRATIONS_TABLE} (name) VALUES ($1)
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
  return entries
    .filter((entry) => entry.endsWith('.sql'))
    .sort()
    .map((entry) => path.parse(entry).name)
}

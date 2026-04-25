import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import {
  listMigrationFiles,
  runMigrations,
  type MigrationLogger,
  type MigrationPoolLike,
} from './migrate.js'

/**
 * Advisory-lock keyspace for tenant API migrations. Different namespace from
 * the control-plane (930, 1) so the two services never block each other when
 * pointed at the same database for development convenience.
 */
const TENANT_API_MIGRATION_LOCK_KEY = [931, 1] as const
const TENANT_API_MIGRATION_SET = 'tenant_api'

const moduleDir = path.dirname(fileURLToPath(import.meta.url))

export const tenantApiMigrationsDir = path.resolve(moduleDir, '..', 'migrations')
export const tenantApiMigrationLedgerTable =
  `schema_migrations_${TENANT_API_MIGRATION_SET}`

function deriveTenantApiSchemaVersion() {
  const latestMigration = fs
    .readdirSync(tenantApiMigrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort()
    .at(-1)

  if (!latestMigration) {
    throw new Error(
      `Expected at least one tenant API migration in ${tenantApiMigrationsDir}.`,
    )
  }

  return latestMigration.replace(/\.sql$/i, '')
}

export const tenantApiSchemaVersion = deriveTenantApiSchemaVersion()

export interface RunTenantApiMigrationsOptions {
  pool: MigrationPoolLike
  lockAcquireTimeoutMs?: number
  logger?: MigrationLogger
}

export async function runTenantApiMigrations(
  options: RunTenantApiMigrationsOptions,
): Promise<string[]> {
  return runMigrations({
    pool: options.pool,
    migrationsDir: tenantApiMigrationsDir,
    migrationSet: TENANT_API_MIGRATION_SET,
    lockKey: TENANT_API_MIGRATION_LOCK_KEY,
    lockAcquireTimeoutMs: options.lockAcquireTimeoutMs,
    logger: options.logger,
  })
}

export async function listTenantApiMigrations(): Promise<string[]> {
  return listMigrationFiles(tenantApiMigrationsDir)
}

/**
 * Entry point for `npm run db:migrate`. Runs the tenant API migrations
 * against `DATABASE_URL`.
 */
export async function runMigrationsCli(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim()

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to run tenant API migrations.')
  }

  const pool = new Pool({ connectionString: databaseUrl })

  try {
    const applied = await runTenantApiMigrations({ pool })

    if (applied.length === 0) {
      console.log('[migrate] tenant-api: no pending migrations')
    } else {
      console.log(
        `[migrate] tenant-api: applied ${applied.length} migration(s): ${applied.join(', ')}`,
      )
    }
  } finally {
    await pool.end()
  }
}

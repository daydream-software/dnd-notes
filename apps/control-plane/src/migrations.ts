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
 * Advisory-lock keyspace for control-plane registry migrations. A different
 * pair than tenant API migrations so the two services never block each other.
 */
const CONTROL_PLANE_MIGRATION_LOCK_KEY = [930, 1] as const
const TENANT_API_MIGRATION_LOCK_KEY = [931, 1] as const
const CONTROL_PLANE_MIGRATION_SET = 'control_plane'
const TENANT_API_MIGRATION_SET = 'tenant_api'

const moduleDir = path.dirname(fileURLToPath(import.meta.url))

export const controlPlaneMigrationsDir = path.resolve(moduleDir, '..', 'migrations')
export const tenantApiMigrationsDir = path.resolve(moduleDir, '..', '..', 'api', 'migrations')

export const controlPlaneMigrationLedgerTable =
  `schema_migrations_${CONTROL_PLANE_MIGRATION_SET}`
export const tenantApiMigrationLedgerTable =
  `schema_migrations_${TENANT_API_MIGRATION_SET}`

export interface RunControlPlaneMigrationsOptions {
  pool: MigrationPoolLike
  lockAcquireTimeoutMs?: number
  logger?: MigrationLogger
}

export async function runControlPlaneMigrations(
  options: RunControlPlaneMigrationsOptions,
): Promise<string[]> {
  return runMigrations({
    pool: options.pool,
    migrationsDir: controlPlaneMigrationsDir,
    migrationSet: CONTROL_PLANE_MIGRATION_SET,
    lockKey: CONTROL_PLANE_MIGRATION_LOCK_KEY,
    lockAcquireTimeoutMs: options.lockAcquireTimeoutMs,
    logger: options.logger,
  })
}

export interface RunTenantApiMigrationsOptions {
  pool: MigrationPoolLike
  lockAcquireTimeoutMs?: number
  logger?: MigrationLogger
}

/**
 * Apply the authoritative tenant API migrations against a tenant database
 * during control-plane orchestration, before least-privilege runtime grants
 * take effect for the tenant workload.
 */
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

export async function listControlPlaneMigrations(): Promise<string[]> {
  return listMigrationFiles(controlPlaneMigrationsDir)
}

/**
 * Entry point for `npm run db:migrate`. Runs the control-plane registry
 * migrations against `CONTROL_PLANE_DATABASE_URL`.
 */
export async function runMigrationsCli(): Promise<void> {
  const databaseUrl = process.env.CONTROL_PLANE_DATABASE_URL?.trim()

  if (!databaseUrl) {
    throw new Error(
      'CONTROL_PLANE_DATABASE_URL is required to run control-plane migrations.',
    )
  }

  const pool = new Pool({ connectionString: databaseUrl })

  try {
    const applied = await runControlPlaneMigrations({ pool })

    if (applied.length === 0) {
      console.log('[migrate] control-plane: no pending migrations')
    } else {
      console.log(
        `[migrate] control-plane: applied ${applied.length} migration(s): ${applied.join(', ')}`,
      )
    }
  } finally {
    await pool.end()
  }
}

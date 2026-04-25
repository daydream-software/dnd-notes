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
const TENANT_BOOTSTRAP_MIGRATION_LOCK_KEY = [930, 2] as const

const moduleDir = path.dirname(fileURLToPath(import.meta.url))

export const controlPlaneMigrationsDir = path.resolve(
  moduleDir,
  '..',
  'migrations',
)

export const tenantBootstrapMigrationsDir = path.resolve(
  moduleDir,
  '..',
  'migrations-tenant',
)

export interface RunControlPlaneMigrationsOptions {
  pool: MigrationPoolLike
  logger?: MigrationLogger
}

export async function runControlPlaneMigrations(
  options: RunControlPlaneMigrationsOptions,
): Promise<string[]> {
  return runMigrations({
    pool: options.pool,
    migrationsDir: controlPlaneMigrationsDir,
    lockKey: CONTROL_PLANE_MIGRATION_LOCK_KEY,
    logger: options.logger,
  })
}

export interface RunTenantBootstrapMigrationsOptions {
  pool: MigrationPoolLike
  logger?: MigrationLogger
}

/**
 * Apply the tenant API baseline migrations against a freshly provisioned
 * tenant database. Called from the control-plane during tenant provisioning,
 * not at control-plane boot.
 */
export async function runTenantBootstrapMigrations(
  options: RunTenantBootstrapMigrationsOptions,
): Promise<string[]> {
  return runMigrations({
    pool: options.pool,
    migrationsDir: tenantBootstrapMigrationsDir,
    lockKey: TENANT_BOOTSTRAP_MIGRATION_LOCK_KEY,
    logger: options.logger,
  })
}

export async function listControlPlaneMigrations(): Promise<string[]> {
  return listMigrationFiles(controlPlaneMigrationsDir)
}

export async function listTenantBootstrapMigrations(): Promise<string[]> {
  return listMigrationFiles(tenantBootstrapMigrationsDir)
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

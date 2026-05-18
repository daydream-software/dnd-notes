import { DataType, newDb, type IMemoryDb } from 'pg-mem'
import { TenantRegistry, type TenantRegistryPoolLike } from '../src/tenant-registry.js'

export interface RegisterPgMemTenantRegistrySupportOptions {
  tryAdvisoryLockImpl?: (key1: unknown, key2: unknown) => boolean
  advisoryUnlockImpl?: (key1: unknown, key2: unknown) => boolean
}

/**
 * pg-mem does not fully handle DROP COLUMN when the column has a named CHECK
 * constraint — the constraint is not removed and subsequent INSERTs fail.
 * This wrapper intercepts the migration SQL for 0005_remove_local_auth and
 * emits an explicit DROP CONSTRAINT before the DROP COLUMN so pg-mem can
 * keep up with the real migration.
 *
 * pg-mem also does not support COMMENT ON COLUMN; those statements are
 * stripped (they are metadata-only and safe to omit in tests).
 */
function rewriteSqlForPgMem(sql: string): string {
  return sql
    .replace(
      /ALTER TABLE portal_accounts\s+DROP COLUMN IF EXISTS auth_provider/gi,
      [
        'ALTER TABLE portal_accounts DROP CONSTRAINT IF EXISTS portal_accounts_constraint_1',
        'ALTER TABLE portal_accounts DROP COLUMN IF EXISTS auth_provider',
      ].join(';\n  '),
    )
    // Strip COMMENT ON COLUMN — pg-mem does not implement it.
    // Use a multiline match so the value string (which may span lines) is captured.
    // FRAGILITY: each COMMENT ON COLUMN match is replaced with a standalone SELECT 1.
    // If a future migration contains multiple COMMENT ON COLUMN statements in a single
    // SQL file, the replacements will be joined without semicolons between them.
    // Fix if that happens: replace the trailing comment token with 'SELECT 1;' (with semicolon).
    .replace(/COMMENT\s+ON\s+COLUMN\s+[\s\S]*?;/gi, 'SELECT 1 /* pg-mem: COMMENT ON COLUMN stripped */')
}

export function wrapPoolForPgMem(pool: TenantRegistryPoolLike): TenantRegistryPoolLike {
  return {
    async query(text: string, values?: readonly unknown[]) {
      return pool.query(rewriteSqlForPgMem(text), values)
    },
    async connect() {
      const client = await pool.connect()
      return {
        query(text: string, values?: readonly unknown[]) {
          return client.query(rewriteSqlForPgMem(text), values)
        },
        release(error?: Error) {
          client.release(error)
        },
      }
    },
    async end() {
      await pool.end()
    },
  }
}

export function registerPgMemTenantRegistrySupport(
  db: IMemoryDb,
  options: RegisterPgMemTenantRegistrySupportOptions = {},
) {
  let statementTimeout = '30s'
  const tryAdvisoryLockImpl = options.tryAdvisoryLockImpl ?? (() => true)
  const advisoryUnlockImpl = options.advisoryUnlockImpl ?? (() => true)
  db.public.registerFunction({
    name: 'pg_try_advisory_lock',
    args: [DataType.integer, DataType.integer],
    returns: DataType.bool,
    implementation: tryAdvisoryLockImpl,
  })
  db.public.registerFunction({
    name: 'pg_advisory_unlock',
    args: [DataType.integer, DataType.integer],
    returns: DataType.bool,
    implementation: advisoryUnlockImpl,
  })
  db.public.registerFunction({
    name: 'current_setting',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (settingName: string) => {
      if (settingName === 'statement_timeout') {
        return statementTimeout
      }

      throw new Error(`Unsupported current_setting(${settingName}) in pg-mem helper`)
    },
  })
  db.public.registerFunction({
    name: 'set_config',
    args: [DataType.text, DataType.text, DataType.bool],
    returns: DataType.text,
    implementation: (
      settingName: string,
      settingValue: string,
      isLocal: boolean,
    ) => {
      if (settingName === 'statement_timeout' && isLocal === false) {
        statementTimeout = settingValue
        return statementTimeout
      }

      throw new Error(`Unsupported set_config(${settingName}) in pg-mem helper`)
    },
  })
}

export function createTestTenantRegistry() {
  const db = newDb({
    autoCreateForeignKeyIndices: true,
  })
  registerPgMemTenantRegistrySupport(db)
  const { Pool } = db.adapters.createPg()
  const pool = new Pool()
  const tenantRegistry = new TenantRegistry(
    'postgresql://control-plane.test/tenant-registry',
    { pool: wrapPoolForPgMem(pool) },
  )

  return {
    db,
    pool,
    tenantRegistry,
    async cleanup() {
      await tenantRegistry.close()
      await pool.end()
    },
  }
}

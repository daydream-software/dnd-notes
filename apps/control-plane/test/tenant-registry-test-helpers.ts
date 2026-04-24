import { DataType, newDb } from 'pg-mem'
import { TenantRegistry } from '../src/tenant-registry.js'

export function createTestTenantRegistry() {
  const db = newDb({
    autoCreateForeignKeyIndices: true,
  })
  let statementTimeout = '30s'
  db.public.registerFunction({
    name: 'pg_advisory_lock',
    args: [DataType.integer, DataType.integer],
    returns: DataType.bool,
    implementation: () => true,
  })
  db.public.registerFunction({
    name: 'pg_advisory_unlock',
    args: [DataType.integer, DataType.integer],
    returns: DataType.bool,
    implementation: () => true,
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
  const { Pool } = db.adapters.createPg()
  const pool = new Pool()
  const tenantRegistry = new TenantRegistry(
    'postgresql://control-plane.test/tenant-registry',
    { pool },
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

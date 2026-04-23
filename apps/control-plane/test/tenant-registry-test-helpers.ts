import { newDb } from 'pg-mem'
import { TenantRegistry } from '../src/tenant-registry.js'

export function createTestTenantRegistry() {
  const db = newDb({
    autoCreateForeignKeyIndices: true,
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

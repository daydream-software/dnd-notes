import assert from 'node:assert/strict'
import test from 'node:test'
import { newDb } from 'pg-mem'
import { tenantApiMigrationLedgerTable } from '../src/migrations.js'
import { initializeTenantNoteStoreDatabase } from '../src/tenant-database-bootstrap.js'
import { registerPgMemTenantRegistrySupport } from './tenant-registry-test-helpers.js'

const retiredTenantBootstrapLedgerTable = 'schema_migrations_control_plane_tenant_bootstrap'

test('tenant database bootstrap applies the baseline migration including owner_accounts.keycloak_sub', async () => {
  const db = newDb({ autoCreateForeignKeyIndices: true })
  registerPgMemTenantRegistrySupport(db)
  const { Pool } = db.adapters.createPg()
  const pool = new Pool()

  try {
    await initializeTenantNoteStoreDatabase(pool)

    const ownerAccountsTable = db.public.getTable('owner_accounts')
    assert.ok(ownerAccountsTable, 'owner_accounts table exists after migrations')

    const columns = await pool.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'owner_accounts'
    `)
    const columnNames = columns.rows.map((row) => row.column_name)
    assert.ok(columnNames.includes('keycloak_sub'))
    assert.ok(columnNames.includes('is_site_admin'))

    assert.ok(
      ownerAccountsTable.constraintsByName.has('idx_owner_accounts_email_lower'),
    )
    assert.ok(
      ownerAccountsTable.constraintsByName.has('idx_owner_accounts_keycloak_sub'),
    )

    const migrations = await pool.query<{ name: string }>(
      `SELECT name FROM ${tenantApiMigrationLedgerTable} ORDER BY name`,
    )
    assert.deepEqual(
      migrations.rows.map((row) => row.name),
      ['0001_baseline.sql'],
    )

    const legacyLedger = await pool.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = '${retiredTenantBootstrapLedgerTable}'
    `)
    assert.equal(legacyLedger.rows.length, 0)
  } finally {
    await pool.end()
  }
})

test('tenant database bootstrap is idempotent across repeated invocations', async () => {
  const db = newDb({ autoCreateForeignKeyIndices: true })
  registerPgMemTenantRegistrySupport(db)
  const { Pool } = db.adapters.createPg()
  const pool = new Pool()

  try {
    await initializeTenantNoteStoreDatabase(pool)
    await initializeTenantNoteStoreDatabase(pool)

    const migrations = await pool.query<{ name: string }>(
      `SELECT name FROM ${tenantApiMigrationLedgerTable} ORDER BY name`,
    )
    assert.equal(migrations.rows.length, 1)
  } finally {
    await pool.end()
  }
})

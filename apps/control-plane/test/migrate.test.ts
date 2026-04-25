import assert from 'node:assert/strict'
import test from 'node:test'
import { newDb } from 'pg-mem'
import {
  controlPlaneMigrationLedgerTable,
  listControlPlaneMigrations,
  listTenantBootstrapMigrations,
  runControlPlaneMigrations,
  runTenantBootstrapMigrations,
  tenantBootstrapMigrationLedgerTable,
} from '../src/migrations.js'
import { registerPgMemTenantRegistrySupport } from './tenant-registry-test-helpers.js'

const expectedTenantStateSignature =
  'provisioning,ready,maintenance,upgrading,restoring,failed,deprovisioned'

test('control-plane migrations seed schema metadata and use a namespaced ledger', async () => {
  const db = newDb({ autoCreateForeignKeyIndices: true })
  registerPgMemTenantRegistrySupport(db)
  const { Pool } = db.adapters.createPg()
  const pool = new Pool()

  try {
    await runControlPlaneMigrations({ pool })

    const migrations = await pool.query<{ name: string }>(
      `SELECT name FROM ${controlPlaneMigrationLedgerTable} ORDER BY name`,
    )
    assert.deepEqual(
      migrations.rows.map((row) => row.name),
      ['0001_baseline.sql'],
    )

    const metadata = await pool.query<{ value: string }>(
      `SELECT value FROM schema_metadata WHERE key = 'tenant_state_signature'`,
    )
    assert.equal(metadata.rows[0]?.value, expectedTenantStateSignature)

    const legacyLedger = await pool.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = 'schema_migrations'
    `)
    assert.equal(legacyLedger.rows.length, 0)

    assert.deepEqual(await listControlPlaneMigrations(), ['0001_baseline.sql'])
  } finally {
    await pool.end()
  }
})

test('tenant bootstrap migrations keep their own namespaced ledger and filenames', async () => {
  const db = newDb({ autoCreateForeignKeyIndices: true })
  registerPgMemTenantRegistrySupport(db)
  const { Pool } = db.adapters.createPg()
  const pool = new Pool()

  try {
    await runTenantBootstrapMigrations({ pool })

    const migrations = await pool.query<{ name: string }>(
      `SELECT name FROM ${tenantBootstrapMigrationLedgerTable} ORDER BY name`,
    )
    assert.deepEqual(
      migrations.rows.map((row) => row.name),
      ['0001_baseline.sql'],
    )

    const registryLedger = await pool.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = '${controlPlaneMigrationLedgerTable}'
    `)
    assert.equal(registryLedger.rows.length, 0)

    assert.deepEqual(await listTenantBootstrapMigrations(), ['0001_baseline.sql'])
  } finally {
    await pool.end()
  }
})

test('control-plane migrations retry until the advisory lock becomes available', async () => {
  const db = newDb({ autoCreateForeignKeyIndices: true })
  let lockAttempts = 0
  registerPgMemTenantRegistrySupport(db, {
    tryAdvisoryLockImpl: (key1) => {
      if (Number(key1) !== 930) {
        return true
      }

      lockAttempts += 1
      return lockAttempts > 1
    },
  })
  const { Pool } = db.adapters.createPg()
  const pool = new Pool()

  try {
    await runControlPlaneMigrations({ pool })
    assert.equal(lockAttempts, 2)
  } finally {
    await pool.end()
  }
})

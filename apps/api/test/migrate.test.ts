import assert from 'node:assert/strict'
import test from 'node:test'
import { newDb } from 'pg-mem'
import {
  listTenantApiMigrations,
  runTenantApiMigrations,
  tenantApiMigrationLedgerTable,
} from '../src/migrations.js'
import { registerPgMemMigrationSupport } from './test-helpers.js'

test('tenant API migrations keep the .sql filename and use a namespaced ledger', async () => {
  const db = newDb({ autoCreateForeignKeyIndices: true })
  registerPgMemMigrationSupport(db)
  const { Pool } = db.adapters.createPg()
  const pool = new Pool()

  try {
    await runTenantApiMigrations({ pool })

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
        AND table_name = 'schema_migrations'
    `)
    assert.equal(legacyLedger.rows.length, 0)

    assert.deepEqual(await listTenantApiMigrations(), ['0001_baseline.sql'])
  } finally {
    await pool.end()
  }
})

test('tenant API migrations retry until the advisory lock becomes available', async () => {
  const db = newDb({ autoCreateForeignKeyIndices: true })
  let lockAttempts = 0
  registerPgMemMigrationSupport(db, {
    tryAdvisoryLockImpl: () => {
      lockAttempts += 1
      return lockAttempts > 1
    },
  })
  const { Pool } = db.adapters.createPg()
  const pool = new Pool()

  try {
    await runTenantApiMigrations({ pool })
    assert.equal(lockAttempts, 2)
  } finally {
    await pool.end()
  }
})

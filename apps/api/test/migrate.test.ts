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

    const migrations = await pool.query<{ applied_at: Date | null; name: string }>(
      `SELECT name, applied_at FROM ${tenantApiMigrationLedgerTable} ORDER BY name`,
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

    const ledgerColumns = await pool.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = '${tenantApiMigrationLedgerTable}'
      ORDER BY ordinal_position
    `)
    assert.deepEqual(
      ledgerColumns.rows.map((row) => row.column_name),
      ['name', 'applied_at'],
    )
    await pool.query(`INSERT INTO ${tenantApiMigrationLedgerTable} (name) VALUES ('0002_manual.sql')`)
    await assert.rejects(
      pool.query(`INSERT INTO ${tenantApiMigrationLedgerTable} (name) VALUES ('0002_manual.sql')`),
      /duplicate|already exists|unique|primary key/i,
    )

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

test('tenant API migrations honor a custom advisory lock timeout', async () => {
  const db = newDb({ autoCreateForeignKeyIndices: true })
  registerPgMemMigrationSupport(db, {
    tryAdvisoryLockImpl: () => false,
  })
  const { Pool } = db.adapters.createPg()
  const pool = new Pool()

  try {
    await assert.rejects(
      runTenantApiMigrations({ pool, lockAcquireTimeoutMs: 5 }),
      /after 5ms/,
    )
  } finally {
    await pool.end()
  }
})

test('tenant API migrations issue the ledger contract DDL', async () => {
  const queries: string[] = []
  const client = {
    async query(text: string) {
      queries.push(text.trim())

      if (text.includes('pg_try_advisory_lock')) {
        return { rows: [{ locked: true }] }
      }

      if (text.includes(`SELECT name FROM ${tenantApiMigrationLedgerTable} ORDER BY name`)) {
        return { rows: [] }
      }

      return { rows: [], rowCount: 0 }
    },
    release() {},
  }

  await runTenantApiMigrations({
    pool: {
      async connect() {
        return client
      },
    },
    logger: {
      info() {},
      warn() {},
      error() {},
    },
  })

  const ddl = queries.join('\n')
  assert.match(ddl, /ALTER TABLE schema_migrations_tenant_api ALTER COLUMN name SET NOT NULL/)
  assert.match(
    ddl,
    /ALTER TABLE schema_migrations_tenant_api ALTER COLUMN applied_at SET DEFAULT CURRENT_TIMESTAMP/,
  )
  assert.match(ddl, /ALTER TABLE schema_migrations_tenant_api ALTER COLUMN applied_at SET NOT NULL/)
  assert.match(ddl, /ALTER TABLE schema_migrations_tenant_api ADD PRIMARY KEY \(name\)/)
})

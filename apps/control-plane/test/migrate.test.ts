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

    const migrations = await pool.query<{ applied_at: Date | null; name: string }>(
      `SELECT name, applied_at FROM ${controlPlaneMigrationLedgerTable} ORDER BY name`,
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

    const ledgerColumns = await pool.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = '${controlPlaneMigrationLedgerTable}'
      ORDER BY ordinal_position
    `)
    assert.deepEqual(
      ledgerColumns.rows.map((row) => row.column_name),
      ['name', 'applied_at'],
    )
    await pool.query(`INSERT INTO ${controlPlaneMigrationLedgerTable} (name) VALUES ('0002_manual.sql')`)
    await assert.rejects(
      pool.query(`INSERT INTO ${controlPlaneMigrationLedgerTable} (name) VALUES ('0002_manual.sql')`),
      /duplicate|already exists|unique|primary key/i,
    )

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

    const migrations = await pool.query<{ applied_at: Date | null; name: string }>(
      `SELECT name, applied_at FROM ${tenantBootstrapMigrationLedgerTable} ORDER BY name`,
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

test('control-plane migrations honor a custom advisory lock timeout', async () => {
  const db = newDb({ autoCreateForeignKeyIndices: true })
  registerPgMemTenantRegistrySupport(db, {
    tryAdvisoryLockImpl: () => false,
  })
  const { Pool } = db.adapters.createPg()
  const pool = new Pool()

  try {
    await assert.rejects(
      runControlPlaneMigrations({ pool, lockAcquireTimeoutMs: 5 }),
      /after 5ms/,
    )
  } finally {
    await pool.end()
  }
})

test('control-plane migrations issue the ledger contract DDL', async () => {
  const queries: string[] = []
  const client = {
    async query(text: string) {
      queries.push(text.trim())

      if (text.includes('pg_try_advisory_lock')) {
        return { rows: [{ locked: true }] }
      }

      if (text.includes(`SELECT name FROM ${controlPlaneMigrationLedgerTable} ORDER BY name`)) {
        return { rows: [] }
      }

      if (text.includes('FROM pg_index')) {
        return { rows: [{ '?column?': 1 }] }
      }

      return { rows: [], rowCount: 0 }
    },
    release() {},
  }

  await runControlPlaneMigrations({
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
  assert.match(ddl, /ALTER TABLE schema_migrations_control_plane ALTER COLUMN name SET NOT NULL/)
  assert.match(
    ddl,
    /ALTER TABLE schema_migrations_control_plane ALTER COLUMN applied_at SET DEFAULT CURRENT_TIMESTAMP/,
  )
  assert.match(
    ddl,
    /ALTER TABLE schema_migrations_control_plane ALTER COLUMN applied_at SET NOT NULL/,
  )
  assert.match(ddl, /ALTER TABLE schema_migrations_control_plane ADD PRIMARY KEY \(name\)/)
  assert.doesNotMatch(
    ddl,
    /CREATE UNIQUE INDEX IF NOT EXISTS sm_control_plane_name_idx ON schema_migrations_control_plane\(name\)/,
  )
  assert.match(ddl, /DROP INDEX IF EXISTS sm_control_plane_name_idx/)
})

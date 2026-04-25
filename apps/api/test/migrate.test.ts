import assert from 'node:assert/strict'
import test from 'node:test'
import { newDb } from 'pg-mem'
import {
  listTenantApiMigrations,
  runTenantApiMigrations,
  tenantApiMigrationLedgerTable,
} from '../src/migrations.js'
import { registerPgMemMigrationSupport } from './test-helpers.js'

const legacyOwnerAccountsCreatePattern =
  /CREATE TABLE IF NOT EXISTS owner_accounts \([\s\S]*?\);\s*/i

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

      if (text.includes('FROM pg_index')) {
        return { rows: [{ '?column?': 1 }] }
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
  assert.doesNotMatch(
    ddl,
    /CREATE UNIQUE INDEX IF NOT EXISTS sm_tenant_api_name_idx ON schema_migrations_tenant_api\(name\)/,
  )
  assert.match(ddl, /DROP INDEX IF EXISTS sm_tenant_api_name_idx/)
})

test('tenant API migrations widen legacy owner_accounts tables before creating the keycloak index', async () => {
  const db = newDb({ autoCreateForeignKeyIndices: true })
  registerPgMemMigrationSupport(db)
  const { Pool } = db.adapters.createPg()
  const pool = new Pool()

  try {
    await pool.query(`
      CREATE TABLE owner_accounts (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        is_site_admin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)

    await runTenantApiMigrations({
      pool: {
        async connect() {
          const client = await pool.connect()

          return {
            async query(text: string, values?: readonly unknown[]) {
              const rewritten = text.replace(legacyOwnerAccountsCreatePattern, '').trim()

              if (rewritten.length === 0) {
                return { rows: [], rowCount: 0 }
              }

              return await client.query(rewritten, values as unknown[])
            },
            release(error?: Error) {
              client.release(error)
            },
          }
        },
      },
    })

    const columns = await pool.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'owner_accounts'
      ORDER BY ordinal_position
    `)

    assert.equal(
      columns.rows.some((column) => column.column_name === 'keycloak_sub'),
      true,
    )
    assert.equal(
      db.public
        .getTable('owner_accounts')
        .constraintsByName.has('idx_owner_accounts_keycloak_sub'),
      true,
    )
  } finally {
    await pool.end()
  }
})

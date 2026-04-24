import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DataType, newDb } from 'pg-mem'
import { maxTenantSubdomainLength } from '../src/tenant-subdomain.js'
import { createTenantRegistryPoolConfig } from '../src/tenant-registry-postgres.js'
import { TenantRegistry } from '../src/tenant-registry.js'
import { createTestTenantRegistry } from './tenant-registry-test-helpers.js'

describe('TenantRegistry', () => {
  it('bootstraps the Postgres registry schema with the expected columns', async () => {
    const { db, tenantRegistry, pool, cleanup } = createTestTenantRegistry()

    try {
      await tenantRegistry.checkHealth()

      const tenantColumns = await pool.query<{ column_name: string }>(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_name = 'tenants'`,
      )
      const portalAccountColumns = await pool.query<{ column_name: string }>(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_name = 'portal_accounts'`,
      )

      assert.equal(
        tenantColumns.rows.some((column) => column.column_name === 'display_name'),
        true,
      )
      assert.equal(
        tenantColumns.rows.some((column) => column.column_name === 'plan_tier'),
        true,
      )
      assert.equal(
        tenantColumns.rows.some(
          (column) => column.column_name === 'initial_admin_email',
        ),
        true,
      )
      assert.equal(
        tenantColumns.rows.some((column) => column.column_name === 'storage_mode'),
        true,
      )
      assert.equal(
        tenantColumns.rows.some(
          (column) => column.column_name === 'storage_migration_status',
        ),
        true,
      )
      assert.equal(
        tenantColumns.rows.some(
          (column) => column.column_name === 'storage_migration_failure_reason',
        ),
        true,
      )
      assert.equal(
        tenantColumns.rows.some(
          (column) => column.column_name === 'storage_migration_updated_at',
        ),
        true,
      )
      assert.equal(
        portalAccountColumns.rows.some(
          (column) => column.column_name === 'password_hash',
        ),
        true,
      )

      const portalSessionTable = db.public.getTable('portal_sessions')

      assert.equal(
        portalSessionTable.constraintsByName.has('idx_portal_sessions_expires_at'),
        true,
      )
      assert.equal(
        portalSessionTable.constraintsByName.has(
          'idx_portal_sessions_expires_at_datetime',
        ),
        false,
      )
    } finally {
      await cleanup()
    }
  })

  it('reserves and persists an opaque subdomain while retrying on collisions', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()

    try {
      await tenantRegistry.createTenant({
        id: 'tenant-1',
        slug: 'tenant-one',
        ownerId: 'owner-1',
        version: '1.0.0',
      })
      await tenantRegistry.createTenant({
        id: 'tenant-2',
        slug: 'tenant-two',
        ownerId: 'owner-2',
        version: '1.0.0',
      })
      await tenantRegistry.updateTenantSubdomain('tenant-1', 't-collision')

      const candidates = ['t-collision', 't-fresh']
      const reserved = await tenantRegistry.reserveTenantSubdomain(
        'tenant-2',
        () => candidates.shift() ?? 't-fallback',
      )

      assert.equal(reserved, 't-fresh')
      assert.equal((await tenantRegistry.getTenant('tenant-2'))?.subdomain, 't-fresh')
    } finally {
      await cleanup()
    }
  })

  it('returns the persisted subdomain when another writer wins the race', async () => {
    const db = newDb({
      autoCreateForeignKeyIndices: true,
    })
    const { Pool } = db.adapters.createPg()
    const pool = new Pool()
    let injectedConcurrentWrite = false
    const wrappedPool = {
      async query(text: string, values?: readonly unknown[]) {
        return await pool.query(text, values as unknown[])
      },
      async connect() {
        const client = await pool.connect()

        return {
          async query(text: string, values?: readonly unknown[]) {
            if (
              !injectedConcurrentWrite &&
              text.includes('SELECT subdomain') &&
              text.includes('FOR UPDATE')
            ) {
              injectedConcurrentWrite = true
              await pool.query(
                `UPDATE tenants
                 SET subdomain = $1
                 WHERE id = $2`,
                ['t-raced', 'tenant-1'],
              )
            }

            return await client.query(text, values as unknown[])
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
    const tenantRegistry = new TenantRegistry('postgres://control-plane.test/tenant-registry', {
      pool: wrappedPool,
    })

    try {
      await tenantRegistry.createTenant({
        id: 'tenant-1',
        slug: 'tenant-one',
        ownerId: 'owner-1',
        version: '1.0.0',
      })

      const reserved = await tenantRegistry.reserveTenantSubdomain(
        'tenant-1',
        () => 't-fresh',
      )

      assert.equal(reserved, 't-raced')
      assert.equal((await tenantRegistry.getTenant('tenant-1'))?.subdomain, 't-raced')
    } finally {
      await tenantRegistry.close()
      await pool.end()
    }
  })

  it('preserves empty-string subdomains for inspection but rejects them for reservation', async () => {
    const { tenantRegistry, pool, cleanup } = createTestTenantRegistry()

    try {
      await tenantRegistry.createTenant({
        id: 'tenant-1',
        slug: 'tenant-one',
        ownerId: 'owner-1',
        version: '1.0.0',
      })
      await pool.query(
        `UPDATE tenants
         SET subdomain = ''
         WHERE id = $1`,
        ['tenant-1'],
      )

      assert.equal((await tenantRegistry.getTenant('tenant-1'))?.subdomain, '')
      await assert.rejects(
        () => tenantRegistry.reserveTenantSubdomain('tenant-1', () => 't-fresh'),
        /invalid persisted subdomain ""/i,
      )
    } finally {
      await cleanup()
    }
  })

  it('rejects overly long persisted subdomains during reservation', async () => {
    const { tenantRegistry, pool, cleanup } = createTestTenantRegistry()
    const invalidSubdomain = `t-${'a'.repeat(maxTenantSubdomainLength - 1)}`

    try {
      await tenantRegistry.createTenant({
        id: 'tenant-1',
        slug: 'tenant-one',
        ownerId: 'owner-1',
        version: '1.0.0',
      })
      await pool.query(
        `UPDATE tenants
         SET subdomain = $1
         WHERE id = $2`,
        [invalidSubdomain, 'tenant-1'],
      )

      assert.equal(
        (await tenantRegistry.getTenant('tenant-1'))?.subdomain,
        invalidSubdomain,
      )
      await assert.rejects(
        () => tenantRegistry.reserveTenantSubdomain('tenant-1', () => 't-fresh'),
        /invalid persisted subdomain/i,
      )
    } finally {
      await cleanup()
    }
  })

  it('returns the latest recorded transition for each tenant in one snapshot', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()

    try {
      await tenantRegistry.createTenant({
        id: 'tenant-1',
        slug: 'tenant-one',
        ownerId: 'owner-1',
        version: '1.0.0',
      })
      await tenantRegistry.createTenant({
        id: 'tenant-2',
        slug: 'tenant-two',
        ownerId: 'owner-2',
        version: '1.0.0',
      })

      await tenantRegistry.updateTenantState('tenant-1', 'ready', 'test-suite')
      await tenantRegistry.updateTenantState('tenant-2', 'failed', 'test-suite')
      await tenantRegistry.updateTenantState('tenant-2', 'ready', 'test-suite')

      const latestTransitions = await tenantRegistry.getLatestStateTransitions()

      assert.equal(latestTransitions.size, 2)
      assert.equal(latestTransitions.get('tenant-1')?.toState, 'ready')
      assert.equal(latestTransitions.get('tenant-2')?.toState, 'ready')
    } finally {
      await cleanup()
    }
  })

  it('persists tenant storage mode and migration status separately from the storage reference', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()

    try {
      await tenantRegistry.createTenant({
        id: 'tenant-1',
        slug: 'tenant-one',
        ownerId: 'owner-1',
        version: '1.0.0',
      })
      await tenantRegistry.updateTenantStorageReference('tenant-1', 'pvc-tenant-one')
      await tenantRegistry.updateTenantStorageProfile('tenant-1', {
        mode: 'sqlite-pvc',
        migrationStatus: 'failed',
        failureReason: 'Synthetic cutover failure',
      })

      const storage = await tenantRegistry.getTenantStorageSnapshot('tenant-1')

      assert.ok(storage)
      assert.equal(storage.storageReference, 'pvc-tenant-one')
      assert.equal(storage.mode, 'sqlite-pvc')
      assert.equal(storage.migrationStatus, 'failed')
      assert.equal(storage.lastMigrationFailure, 'Synthetic cutover failure')
      assert.ok(storage.migrationUpdatedAt)
    } finally {
      await cleanup()
    }
  })

  it('preserves the migration timestamp when only the storage mode is refreshed', async () => {
    const { tenantRegistry, pool, cleanup } = createTestTenantRegistry()
    const pinnedMigrationTimestamp = '2026-04-24T00:00:00.000Z'

    try {
      await tenantRegistry.createTenant({
        id: 'tenant-1',
        slug: 'tenant-one',
        ownerId: 'owner-1',
        version: '1.0.0',
      })
      await tenantRegistry.updateTenantStorageProfile('tenant-1', {
        mode: 'sqlite-pvc',
        migrationStatus: 'failed',
        failureReason: 'Synthetic cutover failure',
      })

      const initialStorage = await tenantRegistry.getTenantStorageSnapshot('tenant-1')

      assert.ok(initialStorage?.migrationUpdatedAt)
      await pool.query(
        `UPDATE tenants
         SET storage_migration_updated_at = $1
         WHERE id = $2`,
        [pinnedMigrationTimestamp, 'tenant-1'],
      )

      await tenantRegistry.updateTenantStorageProfile('tenant-1', {
        mode: 'postgres-dedicated-user',
        migrationStatus: 'failed',
        failureReason: 'Synthetic cutover failure',
      })

      const refreshedStorage = await tenantRegistry.getTenantStorageSnapshot('tenant-1')

      assert.ok(refreshedStorage)
      assert.equal(refreshedStorage.mode, 'postgres-dedicated-user')
      assert.equal(
        refreshedStorage.migrationUpdatedAt,
        pinnedMigrationTimestamp,
      )
    } finally {
      await cleanup()
    }
  })

  it('takes a tenant advisory lock before running serialized work', async () => {
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

        throw new Error(`Unsupported current_setting(${settingName}) in test`)
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

        throw new Error(`Unsupported set_config(${settingName}) in test`)
      },
    })
    const { Pool } = db.adapters.createPg()
    const pool = new Pool()
    let observedTenantLock = false
    let observedTenantUnlock = false
    let observedStatementTimeoutDisable = false
    let observedStatementTimeoutRestore = false
    const wrappedPool = {
      async query(text: string, values?: readonly unknown[]) {
        return await pool.query(text, values as unknown[])
      },
      async connect() {
        const client = await pool.connect()

        return {
          async query(text: string, values?: readonly unknown[]) {
            if (text.includes('pg_advisory_lock')) {
              observedTenantLock = true
            }
            if (text.includes('pg_advisory_unlock')) {
              observedTenantUnlock = true
            }
            if (text.includes('set_config') && values?.[0] === 'statement_timeout') {
              if (values[1] === '0') {
                observedStatementTimeoutDisable = true
              } else if (values[1] === '30s') {
                observedStatementTimeoutRestore = true
              }
            }

            return await client.query(text, values as unknown[])
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
    const tenantRegistry = new TenantRegistry('postgres://control-plane.test/tenant-registry', {
      pool: wrappedPool,
    })

    try {
      await tenantRegistry.createTenant({
        id: 'tenant-1',
        slug: 'tenant-one',
        ownerId: 'owner-1',
        version: '1.0.0',
      })

      let operationRan = false
      await tenantRegistry.withTenantLock('tenant-1', async () => {
        operationRan = true
        assert.equal(observedTenantLock, true)
        assert.equal(observedTenantUnlock, false)
        assert.equal(observedStatementTimeoutDisable, true)
        assert.equal(observedStatementTimeoutRestore, false)
      })

      assert.equal(operationRan, true)
      assert.equal(observedTenantUnlock, true)
      assert.equal(observedStatementTimeoutRestore, true)
    } finally {
      await tenantRegistry.close()
      await pool.end()
    }
  })

  it('discards the client and surfaces cleanup failures when a locked operation also fails', async () => {
    const operationFailure = new Error('synthetic operation failure')
    const unlockFailure = new Error('synthetic unlock failure')
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

        throw new Error(`Unsupported current_setting(${settingName}) in test`)
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

        throw new Error(`Unsupported set_config(${settingName}) in test`)
      },
    })
    const { Pool } = db.adapters.createPg()
    const pool = new Pool()
    let releasedWithError: Error | undefined
    const tenantRegistry = new TenantRegistry('postgres://control-plane.test/tenant-registry', {
      pool: {
        async query(text: string, values?: readonly unknown[]) {
          return await pool.query(text, values as unknown[])
        },
        async connect() {
          const client = await pool.connect()

          return {
            async query(text: string, values?: readonly unknown[]) {
              if (text.includes('pg_advisory_unlock')) {
                throw unlockFailure
              }

              return await client.query(text, values as unknown[])
            },
            release(error?: Error) {
              releasedWithError = error
              client.release(error)
            },
          }
        },
        async end() {
          await pool.end()
        },
      },
    })

    try {
      await tenantRegistry.createTenant({
        id: 'tenant-1',
        slug: 'tenant-one',
        ownerId: 'owner-1',
        version: '1.0.0',
      })

      await assert.rejects(
        () =>
          tenantRegistry.withTenantLock('tenant-1', async () => {
            throw operationFailure
          }),
        (error) => {
          assert.ok(error instanceof AggregateError)
          assert.equal(error.errors.length, 2)
          assert.equal(error.errors[0], operationFailure)
          assert.equal(error.errors[1], unlockFailure)
          return true
        },
      )
      assert.equal(releasedWithError, unlockFailure)
    } finally {
      await tenantRegistry.close()
      await pool.end()
    }
  })

  it('wraps non-Error tenant lock failures before rethrowing them', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()
    const thrownValue = {
      client: 'synthetic-client',
      queryable: false,
    }

    try {
      await tenantRegistry.createTenant({
        id: 'tenant-1',
        slug: 'tenant-one',
        ownerId: 'owner-1',
        version: '1.0.0',
      })

      await assert.rejects(
        () =>
          tenantRegistry.withTenantLock('tenant-1', async () => {
            throw thrownValue
          }),
        (error) => {
          assert.ok(error instanceof Error)
          assert.match(
            error.message,
            /Tenant registry operation failed: Object with keys: client, queryable/,
          )
          assert.equal(error.cause, thrownValue)
          return true
        },
      )
    } finally {
      await cleanup()
    }
  })

  it('keeps migrated pre-v7 tenants conservative when storage_reference only hints at postgres', async () => {
    const db = newDb({
      autoCreateForeignKeyIndices: true,
    })
    const { Pool } = db.adapters.createPg()
    const pool = new Pool()
    await pool.query(`
      CREATE TABLE tenants (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        subdomain TEXT,
        owner_id TEXT NOT NULL,
        display_name TEXT,
        plan_tier TEXT,
        initial_admin_email TEXT,
        desired_state TEXT NOT NULL,
        current_state TEXT NOT NULL,
        version TEXT NOT NULL,
        storage_reference TEXT,
        backup_metadata TEXT,
        storage_mode TEXT,
        storage_migration_status TEXT,
        storage_migration_failure_reason TEXT,
        storage_migration_updated_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `)
    await pool.query(`
      INSERT INTO tenants (
        id,
        slug,
        subdomain,
        owner_id,
        desired_state,
        current_state,
        version,
        storage_reference,
        storage_mode,
        storage_migration_status
      )
      VALUES (
        'tenant-1',
        'tenant-one',
        't-tenantone',
        'owner-1',
        'ready',
        'ready',
        '1.0.0',
        'tenant_existing_reference',
        'unknown',
        'not-started'
      )
    `)
    let schemaVersionInjected = false
    const wrappedPool = {
      async query(text: string, values?: readonly unknown[]) {
        if (
          !schemaVersionInjected &&
          text.includes('SELECT version') &&
          text.includes('FROM schema_version')
        ) {
          schemaVersionInjected = true
          return {
            rowCount: 1,
            rows: [{ version: 6 }],
          }
        }

        if (text.includes('CREATE TABLE IF NOT EXISTS tenants')) {
          return {
            rowCount: null,
            rows: [],
          }
        }

        return await pool.query(text, values as unknown[])
      },
      async connect() {
        return await pool.connect()
      },
      async end() {
        await pool.end()
      },
    }
    const tenantRegistry = new TenantRegistry('postgres://control-plane.test/tenant-registry', {
      pool: wrappedPool,
    })

    try {
      const storage = await tenantRegistry.getTenantStorageSnapshot('tenant-1')

      assert.ok(storage)
      assert.equal(storage.mode, 'unknown')
      assert.equal(storage.migrationStatus, 'not-started')
      assert.equal(storage.lastMigrationFailure, null)
      assert.equal(storage.storageReference, 'tenant_existing_reference')
    } finally {
      await tenantRegistry.close()
      await pool.end()
    }
  })

  it('persists initial admin email on the tenant record', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()

    try {
      const tenant = await tenantRegistry.createTenant({
        id: 'tenant-1',
        slug: 'tenant-one',
        ownerId: 'owner-1',
        initialAdminEmail: 'admin@tenant-one.example',
        version: '1.0.0',
      })

      assert.equal(tenant.initialAdminEmail, 'admin@tenant-one.example')
      assert.equal(
        (await tenantRegistry.getTenant('tenant-1'))?.initialAdminEmail,
        'admin@tenant-one.example',
      )
    } finally {
      await cleanup()
    }
  })

  it('does not end an injected pool when the registry closes', async () => {
    const db = newDb({
      autoCreateForeignKeyIndices: true,
    })
    const { Pool } = db.adapters.createPg()
    const pool = new Pool()
    const tenantRegistry = new TenantRegistry('postgres://control-plane.test/tenant-registry', {
      pool,
    })

    try {
      await tenantRegistry.checkHealth()
      await tenantRegistry.close()

      const result = await pool.query<{ value: number }>('SELECT 1 AS value')
      assert.equal(result.rows[0]?.value, 1)
    } finally {
      await pool.end()
    }
  })

  it('builds the owned Postgres pool config from control-plane env settings', () => {
    const config = createTenantRegistryPoolConfig(
      'postgres://control-plane.test/tenant-registry',
      {
        CONTROL_PLANE_DATABASE_POOL_MIN: '2',
        CONTROL_PLANE_DATABASE_POOL_MAX: '12',
        CONTROL_PLANE_DATABASE_IDLE_TIMEOUT_MS: '45000',
        CONTROL_PLANE_DATABASE_CONNECTION_TIMEOUT_MS: '15000',
        CONTROL_PLANE_DATABASE_STATEMENT_TIMEOUT_MS: '60000',
      },
    )

    assert.equal(config.connectionString, 'postgres://control-plane.test/tenant-registry')
    assert.equal(config.min, 2)
    assert.equal(config.max, 12)
    assert.equal(config.idleTimeoutMillis, 45_000)
    assert.equal(config.connectionTimeoutMillis, 15_000)
    assert.equal(config.statement_timeout, 60_000)
  })

  it('rejects invalid control-plane pool settings', () => {
    assert.throws(
      () =>
        createTenantRegistryPoolConfig('postgres://control-plane.test/tenant-registry', {
          CONTROL_PLANE_DATABASE_POOL_MIN: '5',
          CONTROL_PLANE_DATABASE_POOL_MAX: '4',
        }),
      /CONTROL_PLANE_DATABASE_POOL_MAX \(4\) must be >= CONTROL_PLANE_DATABASE_POOL_MIN \(5\)/,
    )

    assert.throws(
      () =>
        createTenantRegistryPoolConfig('postgres://control-plane.test/tenant-registry', {
          CONTROL_PLANE_DATABASE_CONNECTION_TIMEOUT_MS: 'fast',
        }),
      /Invalid CONTROL_PLANE_DATABASE_CONNECTION_TIMEOUT_MS value: fast/,
    )
  })

  it('persists portal accounts and bearer-token sessions while purging expired sessions', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()

    try {
      const account = await tenantRegistry.createPortalAccount({
        id: 'account-1',
        email: 'owner@example.com',
        displayName: 'Alyx',
        passwordHash: 'salt:hash',
        billingEmail: 'billing@example.com',
        billingProvider: 'stripe',
      })

      await tenantRegistry.createPortalSession({
        id: 'session-expired',
        accountId: account.id,
        tokenHash: 'expired-token',
        expiresAt: '2000-01-01T00:00:00.000Z',
      })
      await tenantRegistry.createPortalSession({
        id: 'session-1',
        accountId: account.id,
        tokenHash: 'hashed-token',
        expiresAt: '2999-01-01T00:00:00.000Z',
      })

      const storedAccount = await tenantRegistry.getPortalAccountByEmail(
        'owner@example.com',
      )
      const authRecord = await tenantRegistry.getPortalAccountAuthByEmail(
        'owner@example.com',
      )
      const storedSession = await tenantRegistry.getPortalSessionByTokenHash(
        'hashed-token',
      )

      assert.ok(storedAccount)
      assert.equal(storedAccount.displayName, 'Alyx')
      assert.equal(storedAccount.billingProvider, 'stripe')
      assert.ok(authRecord)
      assert.equal(authRecord.passwordHash, 'salt:hash')
      assert.equal(await tenantRegistry.getPortalSessionByTokenHash('expired-token'), null)
      assert.ok(storedSession)
      assert.equal(storedSession.accountId, account.id)

      await tenantRegistry.deletePortalSessionByTokenHash('hashed-token')
      assert.equal(
        await tenantRegistry.getPortalSessionByTokenHash('hashed-token'),
        null,
      )

      await tenantRegistry.deletePortalAccount(account.id)
      assert.equal(await tenantRegistry.getPortalAccount(account.id), null)
    } finally {
      await cleanup()
    }
  })
})

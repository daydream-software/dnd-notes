import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { newDb } from 'pg-mem'
import { maxTenantSubdomainLength } from '../src/tenant-subdomain.js'
import { createTenantRegistryPoolConfig } from '../src/tenant-registry-postgres.js'
import { TenantRegistry } from '../src/tenant-registry.js'
import { createTestTenantRegistry } from './tenant-registry-test-helpers.js'

describe('TenantRegistry', () => {
  it('bootstraps the Postgres registry schema with the expected columns', async () => {
    const { tenantRegistry, pool, cleanup } = createTestTenantRegistry()

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
        portalAccountColumns.rows.some(
          (column) => column.column_name === 'password_hash',
        ),
        true,
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
          release() {
            client.release()
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

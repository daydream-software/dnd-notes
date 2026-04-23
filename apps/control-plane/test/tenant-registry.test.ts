import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { maxTenantSubdomainLength } from '../src/tenant-subdomain.js'
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

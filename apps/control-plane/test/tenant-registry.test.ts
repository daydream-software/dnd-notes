import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { maxTenantSubdomainLength } from '../src/tenant-subdomain.js'
import { TenantRegistry } from '../src/tenant-registry.js'

describe('TenantRegistry', () => {
  it('migrates a v1 registry database to v3 by adding subdomain and initial-admin columns', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'control-plane-registry-'))
    const databasePath = join(directory, 'registry.sqlite')
    const rawDb = new Database(databasePath)

    rawDb.exec(`
      CREATE TABLE schema_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE tenants (
        id TEXT PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        owner_id TEXT NOT NULL,
        desired_state TEXT NOT NULL,
        current_state TEXT NOT NULL,
        version TEXT NOT NULL,
        storage_reference TEXT,
        backup_metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE state_transitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        from_state TEXT NOT NULL,
        to_state TEXT NOT NULL,
        triggered_by TEXT NOT NULL,
        reason TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT INTO schema_metadata (key, value)
      VALUES ('tenant_state_signature', 'provisioning,ready,maintenance,upgrading,restoring,failed,deprovisioned');

      INSERT INTO tenants (id, slug, owner_id, desired_state, current_state, version)
      VALUES ('tenant-1', 'tenant-one', 'owner-1', 'ready', 'ready', '1.0.0');

      PRAGMA user_version = 1;
    `)
    rawDb.close()

    try {
      const tenantRegistry = new TenantRegistry(databasePath)
      const migratedTenant = tenantRegistry.getTenant('tenant-1')
      const migratedDb = new Database(databasePath, { readonly: true })
      const columns = migratedDb
        .prepare(`PRAGMA table_info(tenants)`)
        .all() as Array<{ name: string }>
      const indexes = migratedDb
        .prepare(`PRAGMA index_list(tenants)`)
        .all() as Array<{ name: string }>
      migratedDb.close()
      tenantRegistry.close()

      assert.equal(migratedTenant?.subdomain, null)
      assert.equal(migratedTenant?.initialAdminEmail, null)
      assert.ok(columns.some((column) => column.name === 'subdomain'))
      assert.ok(columns.some((column) => column.name === 'initial_admin_email'))
      assert.ok(indexes.some((index) => index.name === 'idx_tenants_subdomain'))
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('reserves and persists an opaque subdomain while retrying on collisions', () => {
    const tenantRegistry = new TenantRegistry(':memory:')

    try {
      tenantRegistry.createTenant({
        id: 'tenant-1',
        slug: 'tenant-one',
        ownerId: 'owner-1',
        version: '1.0.0',
      })
      tenantRegistry.createTenant({
        id: 'tenant-2',
        slug: 'tenant-two',
        ownerId: 'owner-2',
        version: '1.0.0',
      })
      tenantRegistry.updateTenantSubdomain('tenant-1', 't-collision')

      const candidates = ['t-collision', 't-fresh']
      const reserved = tenantRegistry.reserveTenantSubdomain(
        'tenant-2',
        () => candidates.shift() ?? 't-fallback',
      )

      assert.equal(reserved, 't-fresh')
      assert.equal(tenantRegistry.getTenant('tenant-2')?.subdomain, 't-fresh')
    } finally {
      tenantRegistry.close()
    }
  })

  it('migrates a v2 registry database by adding initial-admin email and recreating the subdomain index', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'control-plane-registry-'))
    const databasePath = join(directory, 'registry.sqlite')
    const rawDb = new Database(databasePath)

    rawDb.exec(`
      CREATE TABLE schema_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE tenants (
        id TEXT PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        subdomain TEXT,
        owner_id TEXT NOT NULL,
        desired_state TEXT NOT NULL,
        current_state TEXT NOT NULL,
        version TEXT NOT NULL,
        storage_reference TEXT,
        backup_metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE state_transitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        from_state TEXT NOT NULL,
        to_state TEXT NOT NULL,
        triggered_by TEXT NOT NULL,
        reason TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT INTO schema_metadata (key, value)
      VALUES ('tenant_state_signature', 'provisioning,ready,maintenance,upgrading,restoring,failed,deprovisioned');

      PRAGMA user_version = 2;
    `)
    rawDb.close()

    try {
      const tenantRegistry = new TenantRegistry(databasePath)
      const migratedDb = new Database(databasePath, { readonly: true })
      const columns = migratedDb
        .prepare(`PRAGMA table_info(tenants)`)
        .all() as Array<{ name: string }>
      const indexes = migratedDb
        .prepare(`PRAGMA index_list(tenants)`)
        .all() as Array<{ name: string }>
      migratedDb.close()
      tenantRegistry.close()

      assert.ok(columns.some((column) => column.name === 'initial_admin_email'))
      assert.ok(indexes.some((index) => index.name === 'idx_tenants_subdomain'))
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('preserves empty-string subdomains for inspection but rejects them for reservation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'control-plane-registry-'))
    const databasePath = join(directory, 'registry.sqlite')
    const tenantRegistry = new TenantRegistry(databasePath)

    try {
      tenantRegistry.createTenant({
        id: 'tenant-1',
        slug: 'tenant-one',
        ownerId: 'owner-1',
        version: '1.0.0',
      })
      tenantRegistry.close()

      const rawDb = new Database(databasePath)
      rawDb
        .prepare(
          `UPDATE tenants
           SET subdomain = ''
           WHERE id = ?`,
        )
        .run('tenant-1')
      rawDb.close()

      const reopenedRegistry = new TenantRegistry(databasePath)

      try {
        assert.equal(reopenedRegistry.getTenant('tenant-1')?.subdomain, '')
        assert.throws(
          () => reopenedRegistry.reserveTenantSubdomain('tenant-1', () => 't-fresh'),
          /invalid persisted subdomain ""/,
        )
      } finally {
        reopenedRegistry.close()
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rejects overly long persisted subdomains during reservation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'control-plane-registry-'))
    const databasePath = join(directory, 'registry.sqlite')
    const tenantRegistry = new TenantRegistry(databasePath)
    const invalidSubdomain = `t-${'a'.repeat(maxTenantSubdomainLength - 1)}`

    try {
      tenantRegistry.createTenant({
        id: 'tenant-1',
        slug: 'tenant-one',
        ownerId: 'owner-1',
        version: '1.0.0',
      })
      tenantRegistry.close()

      const rawDb = new Database(databasePath)
      rawDb
        .prepare(
          `UPDATE tenants
           SET subdomain = ?
           WHERE id = ?`,
        )
        .run(invalidSubdomain, 'tenant-1')
      rawDb.close()

      const reopenedRegistry = new TenantRegistry(databasePath)

      try {
        assert.equal(reopenedRegistry.getTenant('tenant-1')?.subdomain, invalidSubdomain)
        assert.throws(
          () => reopenedRegistry.reserveTenantSubdomain('tenant-1', () => 't-fresh'),
          /invalid persisted subdomain/,
        )
      } finally {
        reopenedRegistry.close()
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('returns the latest recorded transition for each tenant in one snapshot', () => {
    const tenantRegistry = new TenantRegistry(':memory:')

    try {
      tenantRegistry.createTenant({
        id: 'tenant-1',
        slug: 'tenant-one',
        ownerId: 'owner-1',
        version: '1.0.0',
      })
      tenantRegistry.createTenant({
        id: 'tenant-2',
        slug: 'tenant-two',
        ownerId: 'owner-2',
        version: '1.0.0',
      })

      tenantRegistry.updateTenantState('tenant-1', 'ready', 'test-suite')
      tenantRegistry.updateTenantState('tenant-2', 'failed', 'test-suite')
      tenantRegistry.updateTenantState('tenant-2', 'ready', 'test-suite')

      const latestTransitions = tenantRegistry.getLatestStateTransitions()

      assert.equal(latestTransitions.size, 2)
      assert.equal(latestTransitions.get('tenant-1')?.toState, 'ready')
      assert.equal(latestTransitions.get('tenant-2')?.toState, 'ready')
    } finally {
      tenantRegistry.close()
    }
  })

  it('migrates a v4 registry database to v5 by adding portal account password hashes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'control-plane-registry-'))
    const databasePath = join(directory, 'registry.sqlite')
    const rawDb = new Database(databasePath)

    rawDb.exec(`
      CREATE TABLE schema_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE tenants (
        id TEXT PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        subdomain TEXT,
        owner_id TEXT NOT NULL,
        initial_admin_email TEXT,
        desired_state TEXT NOT NULL,
        current_state TEXT NOT NULL,
        version TEXT NOT NULL,
        storage_reference TEXT,
        backup_metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE state_transitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        from_state TEXT NOT NULL,
        to_state TEXT NOT NULL,
        triggered_by TEXT NOT NULL,
        reason TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE portal_accounts (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        billing_email TEXT,
        billing_provider TEXT,
        auth_provider TEXT NOT NULL,
        keycloak_sub TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE portal_sessions (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES portal_accounts(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT INTO schema_metadata (key, value)
      VALUES ('tenant_state_signature', 'provisioning,ready,maintenance,upgrading,restoring,failed,deprovisioned');

      PRAGMA user_version = 4;
    `)
    rawDb.close()

    try {
      const tenantRegistry = new TenantRegistry(databasePath)
      const migratedDb = new Database(databasePath, { readonly: true })
      const portalAccountColumns = migratedDb
        .prepare(`PRAGMA table_info(portal_accounts)`)
        .all() as Array<{ name: string }>
      migratedDb.close()
      tenantRegistry.close()

      assert.ok(
        portalAccountColumns.some((column) => column.name === 'password_hash'),
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('persists initial admin email on the tenant record', () => {
    const tenantRegistry = new TenantRegistry(':memory:')

    try {
      const tenant = tenantRegistry.createTenant({
        id: 'tenant-1',
        slug: 'tenant-one',
        ownerId: 'owner-1',
        initialAdminEmail: 'admin@tenant-one.example',
        version: '1.0.0',
      })

      assert.equal(tenant.initialAdminEmail, 'admin@tenant-one.example')
      assert.equal(
        tenantRegistry.getTenant('tenant-1')?.initialAdminEmail,
        'admin@tenant-one.example',
      )
    } finally {
      tenantRegistry.close()
    }
  })

  it('persists portal accounts and bearer-token sessions', () => {
    const tenantRegistry = new TenantRegistry(':memory:')

    try {
      const account = tenantRegistry.createPortalAccount({
        id: 'account-1',
        email: 'owner@example.com',
        displayName: 'Alyx',
        passwordHash: 'salt:hash',
        billingEmail: 'billing@example.com',
        billingProvider: 'stripe',
      })

      tenantRegistry.createPortalSession({
        id: 'session-1',
        accountId: account.id,
        tokenHash: 'hashed-token',
        expiresAt: '2999-01-01 00:00:00',
      })

      const storedAccount = tenantRegistry.getPortalAccountByEmail('owner@example.com')
      const authRecord = tenantRegistry.getPortalAccountAuthByEmail('owner@example.com')
      const storedSession = tenantRegistry.getPortalSessionByTokenHash('hashed-token')

      assert.ok(storedAccount)
      assert.equal(storedAccount.displayName, 'Alyx')
      assert.equal(storedAccount.billingProvider, 'stripe')
      assert.ok(authRecord)
      assert.equal(authRecord.passwordHash, 'salt:hash')
      assert.ok(storedSession)
      assert.equal(storedSession.accountId, account.id)

      tenantRegistry.deletePortalSessionByTokenHash('hashed-token')
      assert.equal(tenantRegistry.getPortalSessionByTokenHash('hashed-token'), null)
    } finally {
      tenantRegistry.close()
    }
  })
})

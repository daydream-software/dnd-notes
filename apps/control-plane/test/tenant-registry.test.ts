import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { maxTenantSubdomainLength } from '../src/tenant-subdomain.js'
import { TenantRegistry } from '../src/tenant-registry.js'

describe('TenantRegistry', () => {
  it('migrates a v1 registry database to v2 by adding the subdomain column and index', async () => {
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
      assert.ok(columns.some((column) => column.name === 'subdomain'))
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

  it('recreates the subdomain index when an existing v2 registry is missing it', async () => {
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
      const indexes = migratedDb
        .prepare(`PRAGMA index_list(tenants)`)
        .all() as Array<{ name: string }>
      migratedDb.close()
      tenantRegistry.close()

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
})

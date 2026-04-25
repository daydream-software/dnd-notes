import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DataType, newDb } from 'pg-mem'
import { maxTenantSubdomainLength } from '../src/tenant-subdomain.js'
import {
  createTenantRegistryPoolConfig,
  TenantRegistryLockTimeoutError,
} from '../src/tenant-registry-postgres.js'
import { TenantRegistry } from '../src/tenant-registry.js'
import {
  createTestTenantRegistry,
  registerPgMemTenantRegistrySupport,
} from './tenant-registry-test-helpers.js'

const expectedTenantStateSignature =
  'provisioning,ready,maintenance,upgrading,restoring,failed,deprovisioned'
const tenantStateCheckSqlList = expectedTenantStateSignature
  .split(',')
  .map((state) => `'${state}'`)
  .join(', ')
const legacyRegistryCreatePatterns = [
  /CREATE TABLE IF NOT EXISTS tenants \([\s\S]*?\);\s*/i,
  /CREATE TABLE IF NOT EXISTS state_transitions \([\s\S]*?\);\s*/i,
  /CREATE TABLE IF NOT EXISTS portal_accounts \([\s\S]*?\);\s*/i,
  /CREATE TABLE IF NOT EXISTS portal_sessions \([\s\S]*?\);\s*/i,
  /CREATE TABLE IF NOT EXISTS schema_metadata \([\s\S]*?\);\s*/i,
]

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
      const restoreLogTable = db.public.getTable('restore_log')

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
      assert.equal(
        restoreLogTable.constraintsByName.has('idx_restore_log_tenant_requested_at'),
        true,
      )
      assert.equal(
        restoreLogTable.constraintsByName.has('idx_restore_log_tenant_completed_at'),
        false,
      )
    } finally {
      await cleanup()
    }
  })

  it('filters latest backup and restore summaries to the requested tenant ids', async () => {
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

      await tenantRegistry.createBackupRun({
        id: 'backup-1',
        tenantId: 'tenant-1',
        triggeredBy: 'test-suite',
      })
      await tenantRegistry.markBackupRunCompleted('backup-1', {
        location: 'blob://backups/tenant-1',
        completedAt: '2026-04-25T00:00:00Z',
      })
      await tenantRegistry.createBackupRun({
        id: 'backup-2',
        tenantId: 'tenant-2',
        triggeredBy: 'test-suite',
      })
      await tenantRegistry.markBackupRunCompleted('backup-2', {
        location: 'blob://backups/tenant-2',
        completedAt: '2026-04-25T01:00:00Z',
      })

      await tenantRegistry.createRestoreRun({
        id: 'restore-1',
        tenantId: 'tenant-1',
        backupId: 'backup-1',
        backupLocation: 'blob://backups/tenant-1',
        triggeredBy: 'test-suite',
      })
      await tenantRegistry.markRestoreRunCompleted('restore-1', {
        completedAt: '2026-04-25T02:00:00Z',
      })
      await tenantRegistry.createRestoreRun({
        id: 'restore-2',
        tenantId: 'tenant-2',
        backupId: 'backup-2',
        backupLocation: 'blob://backups/tenant-2',
        triggeredBy: 'test-suite',
      })
      await tenantRegistry.markRestoreRunCompleted('restore-2', {
        completedAt: '2026-04-25T03:00:00Z',
      })

      const backupSummaries =
        await tenantRegistry.getLatestSuccessfulBackupSummariesForTenantIds([
          'tenant-1',
        ])
      const restoreSummaries = await tenantRegistry.getLatestRestoreSummariesForTenantIds([
        'tenant-1',
      ])

      assert.equal(backupSummaries.size, 1)
      assert.equal(backupSummaries.get('tenant-1')?.backupId, 'backup-1')
      assert.equal(backupSummaries.has('tenant-2'), false)
      assert.equal(restoreSummaries.size, 1)
      assert.equal(restoreSummaries.get('tenant-1')?.restoreId, 'restore-1')
      assert.equal(restoreSummaries.has('tenant-2'), false)
      assert.equal(
        (await tenantRegistry.getLatestSuccessfulBackupSummariesForTenantIds([])).size,
        0,
      )
      assert.equal(
        (await tenantRegistry.getLatestRestoreSummariesForTenantIds([])).size,
        0,
      )
    } finally {
      await cleanup()
    }
  })

  it('uses deterministic tie-breakers for latest backup and restore lookups', async () => {
    const { tenantRegistry, pool, cleanup } = createTestTenantRegistry()

    try {
      await tenantRegistry.createTenant({
        id: 'tenant-1',
        slug: 'tenant-one',
        ownerId: 'owner-1',
        version: '1.0.0',
      })

      await tenantRegistry.createBackupRun({
        id: 'backup-a',
        tenantId: 'tenant-1',
        triggeredBy: 'test-suite',
      })
      await tenantRegistry.markBackupRunCompleted('backup-a', {
        location: 'blob://backups/tenant-1/a',
        completedAt: '2026-04-25T04:00:00Z',
      })
      await tenantRegistry.createBackupRun({
        id: 'backup-b',
        tenantId: 'tenant-1',
        triggeredBy: 'test-suite',
      })
      await tenantRegistry.markBackupRunCompleted('backup-b', {
        location: 'blob://backups/tenant-1/b',
        completedAt: '2026-04-25T04:00:00Z',
      })

      await tenantRegistry.createRestoreRun({
        id: 'restore-a',
        tenantId: 'tenant-1',
        backupId: 'backup-a',
        backupLocation: 'blob://backups/tenant-1/a',
        triggeredBy: 'test-suite',
      })
      await tenantRegistry.createRestoreRun({
        id: 'restore-b',
        tenantId: 'tenant-1',
        backupId: 'backup-b',
        backupLocation: 'blob://backups/tenant-1/b',
        triggeredBy: 'test-suite',
      })
      await tenantRegistry.createRestoreRun({
        id: 'restore-c',
        tenantId: 'tenant-1',
        backupId: 'backup-b',
        backupLocation: 'blob://backups/tenant-1/b',
        triggeredBy: 'test-suite',
      })

      await pool.query(
        `UPDATE restore_log
         SET requested_at = $1,
             created_at = CASE id
               WHEN 'restore-a' THEN $2
               ELSE $3
             END
         WHERE id IN ('restore-a', 'restore-b', 'restore-c')`,
        [
          '2026-04-25T05:00:00Z',
          '2026-04-25T05:01:00Z',
          '2026-04-25T05:02:00Z',
        ],
      )

      const backupSummary = await tenantRegistry.getLatestSuccessfulBackupSummariesForTenantIds([
        'tenant-1',
      ])
      const restoreSummary = await tenantRegistry.getLatestRestoreSummariesForTenantIds([
        'tenant-1',
      ])
      const restores = await tenantRegistry.listTenantRestores('tenant-1', 10)

      assert.equal(backupSummary.get('tenant-1')?.backupId, 'backup-b')
      assert.equal(restoreSummary.get('tenant-1')?.restoreId, 'restore-c')
      assert.deepEqual(
        restores.map((restore) => restore.id),
        ['restore-c', 'restore-b', 'restore-a'],
      )
    } finally {
      await cleanup()
    }
  })

  it('preserves audit log ids as strings', () => {
    const registry = Object.create(TenantRegistry.prototype) as TenantRegistry & {
      mapRowToAuditLogEntry(row: {
        id: string
        tenant_id: string | null
        actor: string
        action: string
        resource_type: string
        resource_id: string | null
        outcome: 'requested' | 'succeeded' | 'failed'
        details: string | null
        created_at: string
      }): { id: string }
    }

    const entry = registry.mapRowToAuditLogEntry({
      id: '9007199254740993',
      tenant_id: 'tenant-audit',
      actor: 'test-suite',
      action: 'tenant.test',
      resource_type: 'tenant',
      resource_id: 'tenant-audit',
      outcome: 'requested',
      details: null,
      created_at: '2026-04-25T00:00:00Z',
    })

    assert.equal(entry.id, '9007199254740993')
  })

  it('re-seeds tenant_state_signature when the baseline ledger is already applied', async () => {
    const db = newDb({ autoCreateForeignKeyIndices: true })
    registerPgMemTenantRegistrySupport(db)
    const { Pool } = db.adapters.createPg()
    const pool = new Pool()
    const firstRegistry = new TenantRegistry('postgres://control-plane.test/tenant-registry', {
      pool,
    })

    try {
      await firstRegistry.whenReady()
      await pool.query(`DELETE FROM schema_metadata WHERE key = 'tenant_state_signature'`)
      await firstRegistry.close()

      const secondRegistry = new TenantRegistry(
        'postgres://control-plane.test/tenant-registry',
        { pool },
      )

      try {
        await secondRegistry.whenReady()

        const metadata = await pool.query<{ value: string }>(
          `SELECT value FROM schema_metadata WHERE key = 'tenant_state_signature'`,
        )
        assert.equal(metadata.rows[0]?.value, expectedTenantStateSignature)
      } finally {
        await secondRegistry.close()
      }
    } finally {
      await pool.end()
    }
  })

  it('upgrades legacy registry schemas through the migration runner before serving traffic', async () => {
    const db = newDb({ autoCreateForeignKeyIndices: true })
    registerPgMemTenantRegistrySupport(db)
    const { Pool } = db.adapters.createPg()
    const pool = new Pool()

    try {
      await pool.query(`
        CREATE TABLE schema_version (
          key TEXT PRIMARY KEY,
          version INTEGER NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        INSERT INTO schema_version (key, version)
        VALUES ('tenant_registry', 4);

        CREATE TABLE schema_metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE tenants (
          id TEXT PRIMARY KEY,
          slug TEXT NOT NULL UNIQUE,
          owner_id TEXT NOT NULL,
          desired_state TEXT NOT NULL CHECK (desired_state IN (${tenantStateCheckSqlList})),
          current_state TEXT NOT NULL CHECK (current_state IN (${tenantStateCheckSqlList})),
          version TEXT NOT NULL,
          storage_reference TEXT,
          backup_metadata TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE state_transitions (
          id SERIAL PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          from_state TEXT NOT NULL CHECK (from_state IN (${tenantStateCheckSqlList})),
          to_state TEXT NOT NULL CHECK (to_state IN (${tenantStateCheckSqlList})),
          triggered_by TEXT NOT NULL,
          reason TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE portal_accounts (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          display_name TEXT NOT NULL,
          billing_email TEXT,
          billing_provider TEXT,
          auth_provider TEXT NOT NULL CHECK (auth_provider IN ('local', 'keycloak')),
          keycloak_sub TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE portal_sessions (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES portal_accounts(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL UNIQUE,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX idx_portal_sessions_expires_at_datetime
          ON portal_sessions(expires_at);
      `)

      const tenantRegistry = new TenantRegistry(
        'postgres://control-plane.test/tenant-registry',
        {
          pool: {
            async query(text: string, values?: readonly unknown[]) {
              return await pool.query(text, values as unknown[])
            },
            async connect() {
              const client = await pool.connect()

              return {
                async query(text: string, values?: readonly unknown[]) {
                  const rewritten = legacyRegistryCreatePatterns
                    .reduce(
                      (sql, pattern) => sql.replace(pattern, ''),
                      text,
                    )
                    .trim()

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
            async end() {
              await pool.end()
            },
          },
        },
      )

      try {
        await tenantRegistry.whenReady()

        const tenantColumns = await pool.query<{ column_name: string }>(`
          SELECT column_name
          FROM information_schema.columns
          WHERE table_name = 'tenants'
        `)
        const portalAccountColumns = await pool.query<{ column_name: string }>(`
          SELECT column_name
          FROM information_schema.columns
          WHERE table_name = 'portal_accounts'
        `)
        const portalSessionTable = db.public.getTable('portal_sessions')

        assert.equal(
          tenantColumns.rows.some((column) => column.column_name === 'subdomain'),
          true,
        )
        assert.equal(
          tenantColumns.rows.some((column) => column.column_name === 'storage_mode'),
          true,
        )
        assert.equal(
          portalAccountColumns.rows.some(
            (column) => column.column_name === 'password_hash',
          ),
          true,
        )
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
        await tenantRegistry.close()
      }
    } finally {
      await pool.end()
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
    registerPgMemTenantRegistrySupport(db)
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
      await tenantRegistry.updateTenantStorageReference('tenant-1', 'tenant_tenant_one')
      await tenantRegistry.updateTenantStorageProfile('tenant-1', {
        mode: 'postgres-dedicated-user',
        migrationStatus: 'failed',
        failureReason: 'Synthetic cutover failure',
      })

      const storage = await tenantRegistry.getTenantStorageSnapshot('tenant-1')

      assert.ok(storage)
      assert.equal(storage.storageReference, 'tenant_tenant_one')
      assert.equal(storage.mode, 'postgres-dedicated-user')
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
        mode: 'postgres-dedicated-user',
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

  it('casts nullable storage failure reasons to text in the profile update SQL', async () => {
    const db = newDb({
      autoCreateForeignKeyIndices: true,
    })
    registerPgMemTenantRegistrySupport(db)
    db.public.registerFunction({
      name: 'pg_try_advisory_lock',
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
    const { Pool } = db.adapters.createPg()
    const pool = new Pool()
    let capturedUpdateSql = ''
    const wrappedPool = {
      async query(text: string, values?: readonly unknown[]) {
        if (text.includes('storage_migration_failure_reason')) {
          capturedUpdateSql = text
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
      await tenantRegistry.createTenant({
        id: 'tenant-1',
        slug: 'tenant-one',
        ownerId: 'owner-1',
        version: '1.0.0',
      })

      await tenantRegistry.updateTenantStorageProfile('tenant-1', {
        mode: 'postgres-dedicated-user',
        migrationStatus: 'not-required',
        failureReason: null,
      })

      assert.match(capturedUpdateSql, /storage_migration_failure_reason = CAST\(\$3 AS TEXT\)/)
      assert.match(capturedUpdateSql, /CAST\(\$3 AS TEXT\) IS NOT NULL/)
      assert.match(capturedUpdateSql, /CAST\(\$3 AS TEXT\) IS NULL/)
      assert.match(
        capturedUpdateSql,
        /storage_migration_failure_reason <> CAST\(\$3 AS TEXT\)/,
      )
    } finally {
      await tenantRegistry.close()
      await pool.end()
    }
  })

  it('reuses the locked registry session for tenant work without extra pool checkouts', async () => {
    const db = newDb({
      autoCreateForeignKeyIndices: true,
    })
    registerPgMemTenantRegistrySupport(db)
    db.public.registerFunction({
      name: 'pg_try_advisory_lock',
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
    const { Pool } = db.adapters.createPg()
    const pool = new Pool()
    let connectCount = 0
    let observedTenantLock = false
    let observedTenantUnlock = false
    const wrappedPool = {
      async query(text: string, values?: readonly unknown[]) {
        return await pool.query(text, values as unknown[])
      },
      async connect() {
        connectCount += 1
        const client = await pool.connect()

        return {
          async query(text: string, values?: readonly unknown[]) {
            if (text.includes('pg_try_advisory_lock')) {
              observedTenantLock = true
            }
            if (text.includes('pg_advisory_unlock')) {
              observedTenantUnlock = true
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
      connectCount = 0
      observedTenantLock = false
      observedTenantUnlock = false

      let operationRan = false
      await tenantRegistry.withTenantLock('tenant-1', async (registryClient) => {
        operationRan = true
        assert.equal(observedTenantLock, true)
        assert.equal(observedTenantUnlock, false)
        assert.equal(
          (await tenantRegistry.getTenant('tenant-1', registryClient))?.currentState,
          'provisioning',
        )

        await tenantRegistry.updateTenantDesiredState(
          'tenant-1',
          'ready',
          registryClient,
        )
        await tenantRegistry.updateTenantState(
          'tenant-1',
          'ready',
          'test-suite',
          undefined,
          registryClient,
        )

        const updatedTenant = await tenantRegistry.getTenant('tenant-1', registryClient)
        assert.equal(updatedTenant?.desiredState, 'ready')
        assert.equal(updatedTenant?.currentState, 'ready')
        assert.equal(connectCount, 1)
      })

      assert.equal(operationRan, true)
      assert.equal(observedTenantUnlock, true)
      assert.equal(connectCount, 1)
    } finally {
      await tenantRegistry.close()
      await pool.end()
    }
  })

  it('fails fast when a tenant advisory lock stays busy', async () => {
    const db = newDb({
      autoCreateForeignKeyIndices: true,
    })
    registerPgMemTenantRegistrySupport(db, {
      tryAdvisoryLockImpl: (key1) => {
        const ns = Number(key1)
        return ns === 930 || ns === 931
      },
    })
    const { Pool } = db.adapters.createPg()
    const pool = new Pool()
    const tenantRegistry = new TenantRegistry('postgres://control-plane.test/tenant-registry', {
      pool,
      tenantLockAcquireTimeoutMs: 20,
      tenantLockRetryDelayMs: 1,
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
            throw new Error('locked operation should not run')
          }),
        (error) => {
          assert.ok(error instanceof TenantRegistryLockTimeoutError)
          assert.equal(error.tenantId, 'tenant-1')
          assert.equal(error.timeoutMs, 20)
          return true
        },
      )
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
    registerPgMemTenantRegistrySupport(db)
    db.public.registerFunction({
      name: 'pg_try_advisory_lock',
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

  it('discards the client when rollback fails after a transaction error', async () => {
    const rollbackFailure = new Error('synthetic rollback failure')
    const db = newDb({
      autoCreateForeignKeyIndices: true,
    })
    registerPgMemTenantRegistrySupport(db)
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
              if (text === 'ROLLBACK') {
                throw rollbackFailure
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
          tenantRegistry.createTenant({
            id: 'tenant-1',
            slug: 'tenant-duplicate',
            ownerId: 'owner-1',
            version: '1.0.0',
          }),
        /duplicate key value/i,
      )
      assert.equal(releasedWithError, rollbackFailure)
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
    registerPgMemTenantRegistrySupport(db)
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

    const singleConnectionConfig = createTenantRegistryPoolConfig(
      'postgres://control-plane.test/tenant-registry',
      {
        CONTROL_PLANE_DATABASE_POOL_MAX: '1',
      },
    )

    assert.equal(singleConnectionConfig.max, 1)
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

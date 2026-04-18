import Database, { type Database as DatabaseType } from 'better-sqlite3'
import { tenantStates, type Tenant, type TenantState, type StateTransition } from './types.js'

const tenantStateSqlList = tenantStates.map((state) => `'${state}'`).join(', ')

export class TenantRegistry {
  private db: DatabaseType

  constructor(databasePath: string) {
    this.db = new Database(databasePath)
    this.db.pragma('foreign_keys = ON')
    this.bootstrap()
  }

  private bootstrap(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        owner_id TEXT NOT NULL,
        desired_state TEXT NOT NULL CHECK (desired_state IN (${tenantStateSqlList})),
        current_state TEXT NOT NULL CHECK (current_state IN (${tenantStateSqlList})),
        version TEXT NOT NULL,
        storage_reference TEXT,
        backup_metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS state_transitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        from_state TEXT NOT NULL CHECK (from_state IN (${tenantStateSqlList})),
        to_state TEXT NOT NULL CHECK (to_state IN (${tenantStateSqlList})),
        triggered_by TEXT NOT NULL,
        reason TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_state_transitions_tenant_id ON state_transitions(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_state_transitions_created_at ON state_transitions(created_at DESC);
    `)
  }

  listTenants(): Tenant[] {
    const rows = this.db
      .prepare(
        `SELECT id, slug, owner_id, desired_state, current_state, version,
                storage_reference, backup_metadata, created_at, updated_at
         FROM tenants
         ORDER BY created_at DESC`,
      )
      .all()

    return rows.map((row: unknown) => this.mapRowToTenant(row))
  }

  getTenant(tenantId: string): Tenant | null {
    const row = this.db
      .prepare(
        `SELECT id, slug, owner_id, desired_state, current_state, version,
                storage_reference, backup_metadata, created_at, updated_at
         FROM tenants
         WHERE id = ?`,
      )
      .get(tenantId)

    return row ? this.mapRowToTenant(row) : null
  }

  getTenantBySlug(slug: string): Tenant | null {
    const row = this.db
      .prepare(
        `SELECT id, slug, owner_id, desired_state, current_state, version,
                storage_reference, backup_metadata, created_at, updated_at
         FROM tenants
         WHERE slug = ?`,
      )
      .get(slug)

    return row ? this.mapRowToTenant(row) : null
  }

  createTenant(params: {
    id: string
    slug: string
    ownerId: string
    version: string
  }): Tenant {
    const { id, slug, ownerId, version } = params

    const createTenantTransaction = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO tenants (id, slug, owner_id, desired_state, current_state, version)
           VALUES (?, ?, ?, 'provisioning', 'provisioning', ?)`,
        )
        .run(id, slug, ownerId, version)

      this.recordTransition({
        tenantId: id,
        fromState: 'provisioning',
        toState: 'provisioning',
        triggeredBy: 'system',
        reason: 'Tenant creation',
      })

      const tenant = this.getTenant(id)
      if (!tenant) {
        throw new Error('Failed to retrieve created tenant')
      }

      return tenant
    })

    return createTenantTransaction()
  }

  updateTenantState(
    tenantId: string,
    newState: TenantState,
    triggeredBy: string,
    reason?: string,
  ): void {
    const tenant = this.getTenant(tenantId)
    if (!tenant) {
      throw new Error(`Tenant ${tenantId} not found`)
    }

    const updateTenantStateTransaction = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE tenants
           SET current_state = ?, updated_at = datetime('now')
           WHERE id = ?`,
        )
        .run(newState, tenantId)

      this.recordTransition({
        tenantId,
        fromState: tenant.currentState,
        toState: newState,
        triggeredBy,
        reason: reason || null,
      })
    })

    updateTenantStateTransaction()
  }

  updateTenantDesiredState(
    tenantId: string,
    desiredState: TenantState,
  ): void {
    this.db
      .prepare(
        `UPDATE tenants
         SET desired_state = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(desiredState, tenantId)
  }

  updateTenantStorageReference(
    tenantId: string,
    storageReference: string,
  ): void {
    this.db
      .prepare(
        `UPDATE tenants
         SET storage_reference = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(storageReference, tenantId)
  }

  updateTenantBackupMetadata(tenantId: string, metadata: string): void {
    this.db
      .prepare(
        `UPDATE tenants
         SET backup_metadata = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(metadata, tenantId)
  }

  getStateTransitions(tenantId: string): StateTransition[] {
    const rows = this.db
      .prepare(
        `SELECT id, tenant_id, from_state, to_state, triggered_by, reason, created_at
         FROM state_transitions
         WHERE tenant_id = ?
         ORDER BY id DESC`,
      )
      .all(tenantId)

    return rows.map((row: unknown) => this.mapRowToStateTransition(row))
  }

  private recordTransition(params: {
    tenantId: string
    fromState: TenantState
    toState: TenantState
    triggeredBy: string
    reason: string | null
  }): void {
    const { tenantId, fromState, toState, triggeredBy, reason } = params

    this.db
      .prepare(
        `INSERT INTO state_transitions (tenant_id, from_state, to_state, triggered_by, reason)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(tenantId, fromState, toState, triggeredBy, reason)
  }

  private mapRowToTenant(row: unknown): Tenant {
    const r = row as Record<string, string>
    return {
      id: r.id,
      slug: r.slug,
      ownerId: r.owner_id,
      desiredState: r.desired_state as TenantState,
      currentState: r.current_state as TenantState,
      version: r.version,
      storageReference: r.storage_reference || null,
      backupMetadata: r.backup_metadata || null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }
  }

  private mapRowToStateTransition(row: unknown): StateTransition {
    const r = row as Record<string, string | number>
    return {
      id: r.id as number,
      tenantId: r.tenant_id as string,
      fromState: r.from_state as TenantState,
      toState: r.to_state as TenantState,
      triggeredBy: r.triggered_by as string,
      reason: (r.reason as string) || null,
      createdAt: r.created_at as string,
    }
  }

  close(): void {
    this.db.close()
  }
}

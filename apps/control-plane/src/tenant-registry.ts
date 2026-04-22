import Database, { type Database as DatabaseType } from 'better-sqlite3'
import {
  assertGeneratedTenantSubdomain,
  assertPersistedTenantSubdomain,
} from './tenant-subdomain.js'
import {
  tenantStates,
  type PortalAccount,
  type PortalBillingProvider,
  type PortalSession,
  type Tenant,
  type TenantState,
  type StateTransition,
} from './types.js'

const tenantStateSqlList = tenantStates.map((state) => `'${state}'`).join(', ')
const CURRENT_SCHEMA_VERSION = 5
const CURRENT_TENANT_STATE_SIGNATURE = tenantStates.join(',')

export class TenantRegistry {
  private db: DatabaseType

  constructor(databasePath: string) {
    this.db = new Database(databasePath)
    this.db.pragma('foreign_keys = ON')
    this.migrateSchema()
  }

  private migrateSchema(): void {
    const currentSchemaVersion = this.db.pragma('user_version', {
      simple: true,
    }) as number

    this.bootstrap()

    if (currentSchemaVersion === 0) {
      this.ensureSubdomainIndex()
      this.ensurePortalIndexes()
      this.setSchemaMetadata(
        'tenant_state_signature',
        CURRENT_TENANT_STATE_SIGNATURE,
      )
      this.db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`)
      return
    }

    if (currentSchemaVersion === 1) {
      this.migrateFromV1ToV5()
    } else if (currentSchemaVersion === 2) {
      this.migrateFromV2ToV5()
    } else if (currentSchemaVersion === 3) {
      this.migrateFromV3ToV5()
    } else if (currentSchemaVersion === 4) {
      this.migrateFromV4ToV5()
    } else if (currentSchemaVersion !== CURRENT_SCHEMA_VERSION) {
      throw new Error(
        `Unsupported control-plane schema version ${currentSchemaVersion}`,
      )
    }

    this.ensureSubdomainIndex()
    this.ensurePortalIndexes()

    const storedStateSignature = this.getSchemaMetadata('tenant_state_signature')
    if (!storedStateSignature) {
      this.setSchemaMetadata(
        'tenant_state_signature',
        CURRENT_TENANT_STATE_SIGNATURE,
      )
      return
    }

    if (storedStateSignature !== CURRENT_TENANT_STATE_SIGNATURE) {
      throw new Error(
        'Tenant state constraints changed; explicit schema migration required',
      )
    }
  }

  private bootstrap(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        subdomain TEXT,
        owner_id TEXT NOT NULL,
        display_name TEXT,
        plan_tier TEXT,
        initial_admin_email TEXT,
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

      CREATE TABLE IF NOT EXISTS portal_accounts (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        billing_email TEXT,
        billing_provider TEXT,
        password_hash TEXT,
        auth_provider TEXT NOT NULL CHECK (auth_provider IN ('local', 'keycloak')),
        keycloak_sub TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS portal_sessions (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES portal_accounts(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)
  }

  private migrateFromV1ToV5(): void {
    const columnNames = this.db
      .prepare(`PRAGMA table_info(tenants)`)
      .all() as Array<{ name: string }>

    const hasSubdomainColumn = columnNames.some((column) => column.name === 'subdomain')

    if (!hasSubdomainColumn) {
      this.db.exec(`ALTER TABLE tenants ADD COLUMN subdomain TEXT`)
    }

    const hasInitialAdminEmailColumn = columnNames.some(
      (column) => column.name === 'initial_admin_email',
    )

    if (!hasInitialAdminEmailColumn) {
      this.db.exec(`ALTER TABLE tenants ADD COLUMN initial_admin_email TEXT`)
    }

    const hasDisplayNameColumn = columnNames.some(
      (column) => column.name === 'display_name',
    )

    if (!hasDisplayNameColumn) {
      this.db.exec(`ALTER TABLE tenants ADD COLUMN display_name TEXT`)
    }

    const hasPlanTierColumn = columnNames.some((column) => column.name === 'plan_tier')

    if (!hasPlanTierColumn) {
      this.db.exec(`ALTER TABLE tenants ADD COLUMN plan_tier TEXT`)
    }

    this.db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`)
  }

  private migrateFromV2ToV5(): void {
    const columnNames = this.db
      .prepare(`PRAGMA table_info(tenants)`)
      .all() as Array<{ name: string }>

    const hasInitialAdminEmailColumn = columnNames.some(
      (column) => column.name === 'initial_admin_email',
    )

    if (!hasInitialAdminEmailColumn) {
      this.db.exec(`ALTER TABLE tenants ADD COLUMN initial_admin_email TEXT`)
    }

    const hasDisplayNameColumn = columnNames.some(
      (column) => column.name === 'display_name',
    )

    if (!hasDisplayNameColumn) {
      this.db.exec(`ALTER TABLE tenants ADD COLUMN display_name TEXT`)
    }

    const hasPlanTierColumn = columnNames.some((column) => column.name === 'plan_tier')

    if (!hasPlanTierColumn) {
      this.db.exec(`ALTER TABLE tenants ADD COLUMN plan_tier TEXT`)
    }

    this.db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`)
  }

  private migrateFromV3ToV5(): void {
    const columnNames = this.db
      .prepare(`PRAGMA table_info(tenants)`)
      .all() as Array<{ name: string }>

    const hasDisplayNameColumn = columnNames.some(
      (column) => column.name === 'display_name',
    )

    if (!hasDisplayNameColumn) {
      this.db.exec(`ALTER TABLE tenants ADD COLUMN display_name TEXT`)
    }

    const hasPlanTierColumn = columnNames.some((column) => column.name === 'plan_tier')

    if (!hasPlanTierColumn) {
      this.db.exec(`ALTER TABLE tenants ADD COLUMN plan_tier TEXT`)
    }

    this.db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`)
  }

  private migrateFromV4ToV5(): void {
    const portalAccountColumns = this.db
      .prepare(`PRAGMA table_info(portal_accounts)`)
      .all() as Array<{ name: string }>

    const hasPasswordHashColumn = portalAccountColumns.some(
      (column) => column.name === 'password_hash',
    )

    if (!hasPasswordHashColumn) {
      this.db.exec(`ALTER TABLE portal_accounts ADD COLUMN password_hash TEXT`)
    }

    this.db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`)
  }

  private ensureSubdomainIndex(): void {
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_subdomain
      ON tenants(subdomain)
      WHERE subdomain IS NOT NULL;
    `)
  }

  private ensurePortalIndexes(): void {
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_accounts_keycloak_sub
      ON portal_accounts(keycloak_sub)
      WHERE keycloak_sub IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_portal_sessions_account_id
      ON portal_sessions(account_id);

      DROP INDEX IF EXISTS idx_portal_sessions_expires_at;

      CREATE INDEX IF NOT EXISTS idx_portal_sessions_expires_at_datetime
      ON portal_sessions(datetime(expires_at));
    `)
  }

  checkHealth(): void {
    this.db.prepare('SELECT 1').get()
  }

  listTenants(): Tenant[] {
    const rows = this.db
      .prepare(
        `SELECT id, slug, subdomain, owner_id, display_name, plan_tier, desired_state, current_state, version,
                initial_admin_email, storage_reference, backup_metadata, created_at, updated_at
         FROM tenants
         ORDER BY created_at DESC`,
      )
      .all()

    return rows.map((row: unknown) => this.mapRowToTenant(row))
  }

  listTenantsByOwnerId(ownerId: string): Tenant[] {
    const rows = this.db
      .prepare(
        `SELECT id, slug, subdomain, owner_id, display_name, plan_tier, desired_state, current_state, version,
                initial_admin_email, storage_reference, backup_metadata, created_at, updated_at
         FROM tenants
         WHERE owner_id = ?
         ORDER BY created_at DESC`,
      )
      .all(ownerId)

    return rows.map((row: unknown) => this.mapRowToTenant(row))
  }

  getTenant(tenantId: string): Tenant | null {
    const row = this.db
      .prepare(
        `SELECT id, slug, subdomain, owner_id, display_name, plan_tier, desired_state, current_state, version,
                initial_admin_email, storage_reference, backup_metadata, created_at, updated_at
         FROM tenants
         WHERE id = ?`,
      )
      .get(tenantId)

    return row ? this.mapRowToTenant(row) : null
  }

  getTenantBySlug(slug: string): Tenant | null {
    const row = this.db
      .prepare(
        `SELECT id, slug, subdomain, owner_id, display_name, plan_tier, desired_state, current_state, version,
                initial_admin_email, storage_reference, backup_metadata, created_at, updated_at
         FROM tenants
         WHERE slug = ?`,
      )
      .get(slug)

    return row ? this.mapRowToTenant(row) : null
  }

  getTenantBySubdomain(subdomain: string): Tenant | null {
    const row = this.db
      .prepare(
        `SELECT id, slug, subdomain, owner_id, display_name, plan_tier, desired_state, current_state, version,
                initial_admin_email, storage_reference, backup_metadata, created_at, updated_at
         FROM tenants
         WHERE subdomain = ?`,
      )
      .get(subdomain)

    return row ? this.mapRowToTenant(row) : null
  }

  reserveTenantSubdomain(
    tenantId: string,
    createCandidate: () => string,
    maxAttempts = 10,
  ): string {
    const reserveTransaction = this.db.transaction(() => {
      const existingTenant = this.db
        .prepare(
          `SELECT subdomain
           FROM tenants
           WHERE id = ?`,
        )
        .get(tenantId) as { subdomain: string | null } | undefined

      if (!existingTenant) {
        throw new Error(`Tenant ${tenantId} not found`)
      }

      if (existingTenant.subdomain != null) {
        return assertPersistedTenantSubdomain(
          tenantId,
          existingTenant.subdomain,
          'provisioning or deprovisioning tenant resources',
        )
      }

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const candidate = assertGeneratedTenantSubdomain(createCandidate())

        try {
          const result = this.db
            .prepare(
              `UPDATE tenants
               SET subdomain = ?, updated_at = datetime('now')
               WHERE id = ?
                 AND subdomain IS NULL`,
            )
            .run(candidate, tenantId)

          if (result.changes === 1) {
            return candidate
          }

          const updatedTenant = this.getTenant(tenantId)
          if (updatedTenant?.subdomain != null) {
            return assertPersistedTenantSubdomain(
              tenantId,
              updatedTenant.subdomain,
              'provisioning or deprovisioning tenant resources',
            )
          }
        } catch (error) {
          if (isSqliteUniqueConstraintError(error)) {
            continue
          }

          throw error
        }
      }

      throw new Error('Could not allocate an opaque tenant subdomain')
    })

    return reserveTransaction.immediate()
  }

  createTenant(params: {
    id: string
    slug: string
    ownerId: string
    displayName?: string
    planTier?: string
    initialAdminEmail?: string
    version: string
  }): Tenant {
    const { id, slug, ownerId, displayName, planTier, initialAdminEmail, version } = params

    const createTenantTransaction = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO tenants (
             id,
             slug,
             owner_id,
             display_name,
             plan_tier,
             initial_admin_email,
             desired_state,
             current_state,
             version
           )
           VALUES (?, ?, ?, ?, ?, ?, 'provisioning', 'provisioning', ?)`,
        )
        .run(
          id,
          slug,
          ownerId,
          displayName ?? null,
          planTier ?? null,
          initialAdminEmail ?? null,
          version,
        )

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

  deleteTenant(tenantId: string): void {
    const result = this.db
      .prepare(
        `DELETE FROM tenants
         WHERE id = ?`,
      )
      .run(tenantId)

    this.assertTenantUpdated(result, tenantId)
  }

  createPortalAccount(params: {
    id: string
    email: string
    displayName: string
    passwordHash?: string | null
    billingEmail?: string | null
    billingProvider?: PortalBillingProvider | null
    authProvider?: 'local' | 'keycloak'
    keycloakSub?: string | null
  }): PortalAccount {
    const {
      id,
      email,
      displayName,
      passwordHash,
      billingEmail,
      billingProvider,
      authProvider = 'local',
      keycloakSub,
    } = params

    const createAccountTransaction = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO portal_accounts (
             id,
             email,
             display_name,
             billing_email,
             billing_provider,
             password_hash,
             auth_provider,
             keycloak_sub
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          email,
          displayName,
          billingEmail ?? null,
          billingProvider ?? null,
          passwordHash ?? null,
          authProvider,
          keycloakSub ?? null,
        )

      const account = this.getPortalAccount(id)
      if (!account) {
        throw new Error('Failed to retrieve created portal account')
      }

      return account
    })

    return createAccountTransaction()
  }

  getPortalAccount(accountId: string): PortalAccount | null {
    const row = this.db
      .prepare(
        `SELECT id,
                email,
                display_name,
                billing_email,
                billing_provider,
                password_hash,
                auth_provider,
                keycloak_sub,
                created_at,
                updated_at
         FROM portal_accounts
         WHERE id = ?`,
      )
      .get(accountId)

    return row ? this.mapRowToPortalAccount(row) : null
  }

  getPortalAccountByEmail(email: string): PortalAccount | null {
    const row = this.db
      .prepare(
        `SELECT id,
                email,
                display_name,
                billing_email,
                billing_provider,
                password_hash,
                auth_provider,
                keycloak_sub,
                created_at,
                updated_at
         FROM portal_accounts
         WHERE email = ?`,
      )
      .get(email)

    return row ? this.mapRowToPortalAccount(row) : null
  }

  getPortalAccountAuthByEmail(email: string): {
    account: PortalAccount
    passwordHash: string | null
  } | null {
    const row = this.db
      .prepare(
        `SELECT id,
                email,
                display_name,
                billing_email,
                billing_provider,
                password_hash,
                auth_provider,
                keycloak_sub,
                created_at,
                updated_at
         FROM portal_accounts
         WHERE email = ?`,
      )
      .get(email)

    if (!row) {
      return null
    }

    const account = this.mapRowToPortalAccount(row)
    const authRow = row as Record<string, string | null>

    return {
      account,
      passwordHash: authRow.password_hash ?? null,
    }
  }

  updatePortalAccount(accountId: string, params: {
    displayName: string
    billingEmail?: string | null
    billingProvider?: PortalBillingProvider | null
  }): PortalAccount {
    const result = this.db
      .prepare(
        `UPDATE portal_accounts
         SET display_name = ?,
             billing_email = ?,
             billing_provider = ?,
             updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(
        params.displayName,
        params.billingEmail ?? null,
        params.billingProvider ?? null,
        accountId,
      )

    if (result.changes === 0) {
      throw new Error(`Portal account ${accountId} not found`)
    }

    const account = this.getPortalAccount(accountId)
    if (!account) {
      throw new Error(`Portal account ${accountId} not found`)
    }

    return account
  }

  createPortalSession(params: {
    id: string
    accountId: string
    tokenHash: string
    expiresAt: string
  }): PortalSession {
    const { id, accountId, tokenHash, expiresAt } = params

    this.purgeExpiredPortalSessions()

    const createSessionTransaction = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO portal_sessions (id, account_id, token_hash, expires_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(id, accountId, tokenHash, expiresAt)

      const session = this.getPortalSessionByTokenHash(tokenHash)
      if (!session) {
        throw new Error('Failed to retrieve created portal session')
      }

      return session
    })

    return createSessionTransaction()
  }

  getPortalSessionByTokenHash(tokenHash: string): PortalSession | null {
    this.purgeExpiredPortalSessions()

    const row = this.db
      .prepare(
        `SELECT id, account_id, token_hash, expires_at, created_at
         FROM portal_sessions
         WHERE token_hash = ?
           AND datetime(expires_at) > datetime('now')`,
      )
      .get(tokenHash)

    return row ? this.mapRowToPortalSession(row) : null
  }

  deletePortalSessionByTokenHash(tokenHash: string): void {
    this.db
      .prepare(
        `DELETE FROM portal_sessions
         WHERE token_hash = ?`,
      )
      .run(tokenHash)
  }

  updateTenantState(
    tenantId: string,
    newState: TenantState,
    triggeredBy: string,
    reason?: string,
  ): void {
    const updateTenantStateTransaction = this.db.transaction(() => {
      const existingTenant = this.db
        .prepare(
          `SELECT current_state
           FROM tenants
           WHERE id = ?`,
        )
        .get(tenantId) as { current_state: TenantState } | undefined

      if (!existingTenant) {
        throw new Error(`Tenant ${tenantId} not found`)
      }

      const result = this.db
        .prepare(
          `UPDATE tenants
           SET current_state = ?, updated_at = datetime('now')
           WHERE id = ?`,
        )
        .run(newState, tenantId)

      this.assertTenantUpdated(result, tenantId)

      this.recordTransition({
        tenantId,
        fromState: existingTenant.current_state,
        toState: newState,
        triggeredBy,
        reason: reason ?? null,
      })
    })

    updateTenantStateTransaction.immediate()
  }

  updateTenantDesiredState(
    tenantId: string,
    desiredState: TenantState,
  ): void {
    const result = this.db
      .prepare(
        `UPDATE tenants
         SET desired_state = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(desiredState, tenantId)

    this.assertTenantUpdated(result, tenantId)
  }

  updateTenantStorageReference(
    tenantId: string,
    storageReference: string | null,
  ): void {
    const result = this.db
      .prepare(
        `UPDATE tenants
         SET storage_reference = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(storageReference, tenantId)

    this.assertTenantUpdated(result, tenantId)
  }

  updateTenantSubdomain(tenantId: string, subdomain: string): void {
    const result = this.db
      .prepare(
        `UPDATE tenants
         SET subdomain = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(subdomain, tenantId)

    this.assertTenantUpdated(result, tenantId)
  }

  updateTenantVersion(tenantId: string, version: string): void {
    const result = this.db
      .prepare(
        `UPDATE tenants
         SET version = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(version, tenantId)

    this.assertTenantUpdated(result, tenantId)
  }

  updateTenantBackupMetadata(tenantId: string, metadata: string): void {
    const result = this.db
      .prepare(
        `UPDATE tenants
         SET backup_metadata = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(metadata, tenantId)

    this.assertTenantUpdated(result, tenantId)
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

  getLatestStateTransitions(): Map<string, StateTransition> {
    const rows = this.db
      .prepare(
        `SELECT state_transitions.id,
                state_transitions.tenant_id,
                state_transitions.from_state,
                state_transitions.to_state,
                state_transitions.triggered_by,
                state_transitions.reason,
                state_transitions.created_at
         FROM state_transitions
         INNER JOIN (
           SELECT tenant_id, MAX(id) AS latest_id
           FROM state_transitions
           GROUP BY tenant_id
         ) latest_transition
           ON latest_transition.tenant_id = state_transitions.tenant_id
          AND latest_transition.latest_id = state_transitions.id
         ORDER BY state_transitions.id DESC`,
      )
      .all()

    return new Map(
      rows.map((row: unknown) => {
        const transition = this.mapRowToStateTransition(row)
        return [transition.tenantId, transition] as const
      }),
    )
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

  private getSchemaMetadata(key: string): string | null {
    const row = this.db
      .prepare(
        `SELECT value
         FROM schema_metadata
         WHERE key = ?`,
      )
      .get(key) as { value: string } | undefined

    return row?.value ?? null
  }

  private setSchemaMetadata(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO schema_metadata (key, value)
         VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value)
  }

  private assertTenantUpdated(
    result: { changes: number },
    tenantId: string,
  ): void {
    if (result.changes === 0) {
      throw new Error(`Tenant ${tenantId} not found`)
    }
  }

  private mapRowToTenant(row: unknown): Tenant {
    const r = row as Record<string, string>
    return {
      id: r.id,
      slug: r.slug,
      subdomain: r.subdomain ?? null,
      ownerId: r.owner_id,
      displayName: r.display_name ?? null,
      planTier: r.plan_tier ?? null,
      initialAdminEmail: r.initial_admin_email ?? null,
      desiredState: r.desired_state as TenantState,
      currentState: r.current_state as TenantState,
      version: r.version,
      storageReference: r.storage_reference ?? null,
      backupMetadata: r.backup_metadata ?? null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }
  }

  private mapRowToPortalAccount(row: unknown): PortalAccount {
    const r = row as Record<string, string>
    return {
      id: r.id,
      email: r.email,
      displayName: r.display_name,
      billingEmail: r.billing_email ?? null,
      billingProvider: (r.billing_provider as PortalBillingProvider | null) ?? null,
      authProvider: r.auth_provider as 'local' | 'keycloak',
      keycloakSub: r.keycloak_sub ?? null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }
  }

  private mapRowToPortalSession(row: unknown): PortalSession {
    const r = row as Record<string, string>
    return {
      id: r.id,
      accountId: r.account_id,
      tokenHash: r.token_hash,
      expiresAt: r.expires_at,
      createdAt: r.created_at,
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
      reason: (r.reason as string | null) ?? null,
      createdAt: r.created_at as string,
    }
  }

  close(): void {
    this.db.close()
  }

  private purgeExpiredPortalSessions(): void {
    this.db
      .prepare(
        `DELETE FROM portal_sessions
         WHERE datetime(expires_at) <= datetime('now')`,
      )
      .run()
  }
}

function isSqliteUniqueConstraintError(error: unknown): error is Error & { code?: string } {
  if (!(error instanceof Error)) {
    return false
  }

  const sqliteCode = (error as Error & { code?: string }).code

  return (
    sqliteCode === 'SQLITE_CONSTRAINT_UNIQUE' ||
    sqliteCode === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
    (sqliteCode === 'SQLITE_CONSTRAINT' &&
      error.message.includes('UNIQUE constraint failed'))
  )
}

import { Pool, type PoolConfig, type QueryResultRow } from 'pg'
import {
  assertGeneratedTenantSubdomain,
  assertPersistedTenantSubdomain,
} from './tenant-subdomain.js'
import {
  tenantStates,
  type PortalAccount,
  type PortalBillingProvider,
  type PortalSession,
  type StateTransition,
  type Tenant,
  type TenantState,
} from './types.js'

const tenantStateSqlList = tenantStates.map((state) => `'${state}'`).join(', ')
const CURRENT_SCHEMA_VERSION = 5
const CURRENT_TENANT_STATE_SIGNATURE = tenantStates.join(',')
const tenantSelectColumns = `id, slug, subdomain, owner_id, display_name, plan_tier,
  initial_admin_email, desired_state, current_state, version, storage_reference,
  backup_metadata, created_at, updated_at`
const portalAccountSelectColumns = `id, email, display_name, billing_email,
  billing_provider, password_hash, auth_provider, keycloak_sub, created_at, updated_at`
const portalSessionSelectColumns = `id, account_id, token_hash, expires_at, created_at`
const stateTransitionSelectColumns = `id, tenant_id, from_state, to_state,
  triggered_by, reason, created_at`
const tenantRegistrySchemaVersionKey = 'tenant_registry'

export interface TenantRegistryQueryable {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rowCount: number | null; rows: Row[] }>
}

export interface TenantRegistryPoolLike extends TenantRegistryQueryable {
  connect(): Promise<TenantRegistryClientLike>
  end(): Promise<void>
}

export interface TenantRegistryClientLike extends TenantRegistryQueryable {
  release(): void
}

interface TenantRegistryOptions {
  pool?: TenantRegistryPoolLike
}

interface SchemaVersionRow {
  version: number
}

interface SchemaMetadataRow {
  value: string
}

interface TenantRow {
  id: string
  slug: string
  subdomain: string | null
  owner_id: string
  display_name: string | null
  plan_tier: string | null
  initial_admin_email: string | null
  desired_state: TenantState
  current_state: TenantState
  version: string
  storage_reference: string | null
  backup_metadata: string | null
  created_at: Date | string
  updated_at: Date | string
}

interface PortalAccountRow {
  id: string
  email: string
  display_name: string
  billing_email: string | null
  billing_provider: PortalBillingProvider | null
  password_hash: string | null
  auth_provider: 'local' | 'keycloak'
  keycloak_sub: string | null
  created_at: Date | string
  updated_at: Date | string
}

interface PortalSessionRow {
  id: string
  account_id: string
  token_hash: string
  expires_at: Date | string
  created_at: Date | string
}

interface StateTransitionRow {
  id: number
  tenant_id: string
  from_state: TenantState
  to_state: TenantState
  triggered_by: string
  reason: string | null
  created_at: Date | string
}

function createOwnedTenantRegistryPool(connectionString: string): TenantRegistryPoolLike {
  const config: PoolConfig = {
    connectionString,
    min: 0,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
  }

  return new Pool(config)
}

function resolveTenantRegistryPool(
  connectionString: string,
  options: TenantRegistryOptions,
) {
  if (options.pool) {
    return {
      pool: options.pool,
      ownedPool: undefined,
    }
  }

  const normalizedConnectionString = connectionString.trim()

  if (!normalizedConnectionString) {
    throw new Error(
      'Control-plane Postgres pool or CONTROL_PLANE_DATABASE_URL is required.',
    )
  }

  const ownedPool = createOwnedTenantRegistryPool(normalizedConnectionString)

  return {
    pool: ownedPool,
    ownedPool,
  }
}

function normalizeTimestamp(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString()
  }

  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? value : new Date(parsed).toISOString()
}

function isUniqueConstraintError(error: unknown): error is Error & { code?: string } {
  return error instanceof Error && (error as Error & { code?: string }).code === '23505'
}

export class TenantRegistry {
  private readonly pool: TenantRegistryPoolLike
  private readonly ready: Promise<void>
  private closed = false

  constructor(connectionString: string, options: TenantRegistryOptions = {}) {
    const { pool } = resolveTenantRegistryPool(connectionString, options)
    this.pool = pool
    this.ready = this.migrateSchema()
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error('Tenant registry unavailable')
    }
  }

  private async migrateSchema(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS schema_version (
        key TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS schema_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)

    const currentSchemaVersionResult = await this.pool.query<SchemaVersionRow>(
      `SELECT version
       FROM schema_version
       WHERE key = $1`,
      [tenantRegistrySchemaVersionKey],
    )
    const currentSchemaVersion = currentSchemaVersionResult.rows[0]?.version ?? 0

    if (
      currentSchemaVersion !== 0 &&
      currentSchemaVersion !== 1 &&
      currentSchemaVersion !== 2 &&
      currentSchemaVersion !== 3 &&
      currentSchemaVersion !== 4 &&
      currentSchemaVersion !== CURRENT_SCHEMA_VERSION
    ) {
      throw new Error(
        `Unsupported control-plane schema version ${currentSchemaVersion}`,
      )
    }

    await this.bootstrap()

    if (currentSchemaVersion !== CURRENT_SCHEMA_VERSION) {
      await this.pool.query(
        `INSERT INTO schema_version (key, version)
         VALUES ($1, $2)
         ON CONFLICT(key) DO UPDATE
           SET version = EXCLUDED.version,
               updated_at = CURRENT_TIMESTAMP`,
        [tenantRegistrySchemaVersionKey, CURRENT_SCHEMA_VERSION],
      )
    }

    const storedStateSignature = await this.getSchemaMetadata('tenant_state_signature')
    if (!storedStateSignature) {
      await this.setSchemaMetadata(
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

  private async bootstrap(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
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
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS state_transitions (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        from_state TEXT NOT NULL CHECK (from_state IN (${tenantStateSqlList})),
        to_state TEXT NOT NULL CHECK (to_state IN (${tenantStateSqlList})),
        triggered_by TEXT NOT NULL,
        reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS portal_accounts (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        billing_email TEXT,
        billing_provider TEXT,
        password_hash TEXT,
        auth_provider TEXT NOT NULL CHECK (auth_provider IN ('local', 'keycloak')),
        keycloak_sub TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS portal_sessions (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES portal_accounts(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)

    await this.pool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subdomain TEXT`)
    await this.pool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS display_name TEXT`)
    await this.pool.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan_tier TEXT`)
    await this.pool.query(
      `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS initial_admin_email TEXT`,
    )
    await this.pool.query(`ALTER TABLE portal_accounts ADD COLUMN IF NOT EXISTS password_hash TEXT`)

    await this.pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_subdomain
      ON tenants(subdomain)
      WHERE subdomain IS NOT NULL
    `)
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_tenants_owner_id
      ON tenants(owner_id)
    `)
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_state_transitions_tenant_id
      ON state_transitions(tenant_id)
    `)
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_state_transitions_created_at
      ON state_transitions(created_at DESC)
    `)
    await this.pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_accounts_keycloak_sub
      ON portal_accounts(keycloak_sub)
      WHERE keycloak_sub IS NOT NULL
    `)
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_portal_sessions_account_id
      ON portal_sessions(account_id)
    `)
    await this.pool.query(`
      DROP INDEX IF EXISTS idx_portal_sessions_expires_at
    `)
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_portal_sessions_expires_at_datetime
      ON portal_sessions(expires_at)
    `)
  }

  private async withTransaction<Result>(
    operation: (client: TenantRegistryClientLike) => Promise<Result>,
  ): Promise<Result> {
    this.assertOpen()
    await this.ready
    const client = await this.pool.connect()

    try {
      await client.query('BEGIN')
      const result = await operation(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      try {
        await client.query('ROLLBACK')
      } catch {
        // Ignore rollback failures and keep the original error.
      }
      throw error
    } finally {
      client.release()
    }
  }

  private async run<Row extends QueryResultRow = QueryResultRow>(
    sql: string,
    values: readonly unknown[] = [],
    executor: TenantRegistryQueryable = this.pool,
  ) {
    this.assertOpen()
    await this.ready
    return executor.query<Row>(sql, values)
  }

  async checkHealth(): Promise<void> {
    await this.run('SELECT 1')
  }

  async listTenants(): Promise<Tenant[]> {
    const rows = await this.run<TenantRow>(
      `SELECT ${tenantSelectColumns}
       FROM tenants
       ORDER BY created_at DESC`,
    )

    return rows.rows.map((row) => this.mapRowToTenant(row))
  }

  async listTenantsByOwnerId(ownerId: string): Promise<Tenant[]> {
    const rows = await this.run<TenantRow>(
      `SELECT ${tenantSelectColumns}
       FROM tenants
       WHERE owner_id = $1
       ORDER BY created_at DESC`,
      [ownerId],
    )

    return rows.rows.map((row) => this.mapRowToTenant(row))
  }

  async getTenant(tenantId: string): Promise<Tenant | null> {
    const row = await this.run<TenantRow>(
      `SELECT ${tenantSelectColumns}
       FROM tenants
       WHERE id = $1`,
      [tenantId],
    )

    return row.rows[0] ? this.mapRowToTenant(row.rows[0]) : null
  }

  async getTenantBySlug(slug: string): Promise<Tenant | null> {
    const row = await this.run<TenantRow>(
      `SELECT ${tenantSelectColumns}
       FROM tenants
       WHERE slug = $1`,
      [slug],
    )

    return row.rows[0] ? this.mapRowToTenant(row.rows[0]) : null
  }

  async getTenantBySubdomain(subdomain: string): Promise<Tenant | null> {
    const row = await this.run<TenantRow>(
      `SELECT ${tenantSelectColumns}
       FROM tenants
       WHERE subdomain = $1`,
      [subdomain],
    )

    return row.rows[0] ? this.mapRowToTenant(row.rows[0]) : null
  }

  async reserveTenantSubdomain(
    tenantId: string,
    createCandidate: () => string,
    maxAttempts = 10,
  ): Promise<string> {
    this.assertOpen()
    await this.ready
    const existingTenant = await this.getTenant(tenantId)

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
      const conflictingTenant = await this.getTenantBySubdomain(candidate)

      if (conflictingTenant && conflictingTenant.id !== tenantId) {
        continue
      }

      try {
        const updatedTenant = await this.run<{ subdomain: string }>(
          `UPDATE tenants
           SET subdomain = $1,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $2
           RETURNING subdomain`,
          [candidate, tenantId],
        )

        if ((updatedTenant.rowCount ?? updatedTenant.rows.length) === 1) {
          return updatedTenant.rows[0].subdomain
        }

        const refreshedTenant = await this.getTenant(tenantId)
        if (refreshedTenant?.subdomain != null) {
          return assertPersistedTenantSubdomain(
            tenantId,
            refreshedTenant.subdomain,
            'provisioning or deprovisioning tenant resources',
          )
        }
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          continue
        }

        throw error
      }
    }

    throw new Error('Could not allocate an opaque tenant subdomain')
  }

  async createTenant(params: {
    id: string
    slug: string
    ownerId: string
    displayName?: string
    planTier?: string
    initialAdminEmail?: string
    version: string
  }): Promise<Tenant> {
    const { id, slug, ownerId, displayName, planTier, initialAdminEmail, version } = params

    return this.withTransaction(async (client) => {
      const result = await client.query<TenantRow>(
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
         VALUES ($1, $2, $3, $4, $5, $6, 'provisioning', 'provisioning', $7)
         RETURNING ${tenantSelectColumns}`,
        [
          id,
          slug,
          ownerId,
          displayName ?? null,
          planTier ?? null,
          initialAdminEmail ?? null,
          version,
        ],
      )
      const row = result.rows[0]

      if (!row) {
        throw new Error('Failed to retrieve created tenant')
      }

      await this.recordTransition(
        {
          tenantId: id,
          fromState: 'provisioning',
          toState: 'provisioning',
          triggeredBy: 'system',
          reason: 'Tenant creation',
        },
        client,
      )

      return this.mapRowToTenant(row)
    })
  }

  async deleteTenant(tenantId: string): Promise<void> {
    const result = await this.run(
      `DELETE FROM tenants
       WHERE id = $1`,
      [tenantId],
    )

    this.assertTenantUpdated(result.rowCount ?? 0, tenantId)
  }

  async createPortalAccount(params: {
    id: string
    email: string
    displayName: string
    passwordHash?: string | null
    billingEmail?: string | null
    billingProvider?: PortalBillingProvider | null
    authProvider?: 'local' | 'keycloak'
    keycloakSub?: string | null
  }): Promise<PortalAccount> {
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

    const result = await this.run<PortalAccountRow>(
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
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${portalAccountSelectColumns}`,
      [
        id,
        email,
        displayName,
        billingEmail ?? null,
        billingProvider ?? null,
        passwordHash ?? null,
        authProvider,
        keycloakSub ?? null,
      ],
    )
    const row = result.rows[0]

    if (!row) {
      throw new Error('Failed to retrieve created portal account')
    }

    return this.mapRowToPortalAccount(row)
  }

  async deletePortalAccount(accountId: string): Promise<void> {
    const result = await this.run(
      `DELETE FROM portal_accounts
       WHERE id = $1`,
      [accountId],
    )

    if ((result.rowCount ?? 0) === 0) {
      throw new Error(`Portal account ${accountId} not found`)
    }
  }

  async getPortalAccount(accountId: string): Promise<PortalAccount | null> {
    const row = await this.run<PortalAccountRow>(
      `SELECT ${portalAccountSelectColumns}
       FROM portal_accounts
       WHERE id = $1`,
      [accountId],
    )

    return row.rows[0] ? this.mapRowToPortalAccount(row.rows[0]) : null
  }

  async getPortalAccountByEmail(email: string): Promise<PortalAccount | null> {
    const row = await this.run<PortalAccountRow>(
      `SELECT ${portalAccountSelectColumns}
       FROM portal_accounts
       WHERE email = $1`,
      [email],
    )

    return row.rows[0] ? this.mapRowToPortalAccount(row.rows[0]) : null
  }

  async getPortalAccountAuthByEmail(email: string): Promise<{
    account: PortalAccount
    passwordHash: string | null
  } | null> {
    const row = await this.run<PortalAccountRow>(
      `SELECT ${portalAccountSelectColumns}
       FROM portal_accounts
       WHERE email = $1`,
      [email],
    )
    const record = row.rows[0]

    if (!record) {
      return null
    }

    return {
      account: this.mapRowToPortalAccount(record),
      passwordHash: record.password_hash ?? null,
    }
  }

  async updatePortalAccount(accountId: string, params: {
    displayName: string
    billingEmail?: string | null
    billingProvider?: PortalBillingProvider | null
  }): Promise<PortalAccount> {
    const result = await this.run<PortalAccountRow>(
      `UPDATE portal_accounts
       SET display_name = $1,
           billing_email = $2,
           billing_provider = $3,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING ${portalAccountSelectColumns}`,
      [
        params.displayName,
        params.billingEmail ?? null,
        params.billingProvider ?? null,
        accountId,
      ],
    )
    const row = result.rows[0]

    if (!row) {
      throw new Error(`Portal account ${accountId} not found`)
    }

    return this.mapRowToPortalAccount(row)
  }

  async createPortalSession(params: {
    id: string
    accountId: string
    tokenHash: string
    expiresAt: string
  }): Promise<PortalSession> {
    const { id, accountId, tokenHash, expiresAt } = params

    await this.purgeExpiredPortalSessions()
    const result = await this.run<PortalSessionRow>(
      `INSERT INTO portal_sessions (id, account_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING ${portalSessionSelectColumns}`,
      [id, accountId, tokenHash, expiresAt],
    )
    const row = result.rows[0]

    if (!row) {
      throw new Error('Failed to retrieve created portal session')
    }

    return this.mapRowToPortalSession(row)
  }

  async getPortalSessionByTokenHash(tokenHash: string): Promise<PortalSession | null> {
    await this.purgeExpiredPortalSessions()
    const now = new Date().toISOString()

    const row = await this.run<PortalSessionRow>(
      `SELECT ${portalSessionSelectColumns}
       FROM portal_sessions
       WHERE token_hash = $1
         AND expires_at > $2`,
      [tokenHash, now],
    )

    return row.rows[0] ? this.mapRowToPortalSession(row.rows[0]) : null
  }

  async deletePortalSessionByTokenHash(tokenHash: string): Promise<void> {
    await this.run(
      `DELETE FROM portal_sessions
       WHERE token_hash = $1`,
      [tokenHash],
    )
  }

  async updateTenantState(
    tenantId: string,
    newState: TenantState,
    triggeredBy: string,
    reason?: string,
  ): Promise<void> {
    await this.withTransaction(async (client) => {
      const existingTenant = await client.query<{ current_state: TenantState }>(
        `SELECT current_state
         FROM tenants
         WHERE id = $1
         FOR UPDATE`,
        [tenantId],
      )
      const currentTenant = existingTenant.rows[0]

      if (!currentTenant) {
        throw new Error(`Tenant ${tenantId} not found`)
      }

      const result = await client.query(
        `UPDATE tenants
         SET current_state = $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [newState, tenantId],
      )

      this.assertTenantUpdated(result.rowCount ?? 0, tenantId)
      await this.recordTransition(
        {
          tenantId,
          fromState: currentTenant.current_state,
          toState: newState,
          triggeredBy,
          reason: reason ?? null,
        },
        client,
      )
    })
  }

  async updateTenantDesiredState(
    tenantId: string,
    desiredState: TenantState,
  ): Promise<void> {
    const result = await this.run(
      `UPDATE tenants
       SET desired_state = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [desiredState, tenantId],
    )

    this.assertTenantUpdated(result.rowCount ?? 0, tenantId)
  }

  async updateTenantStorageReference(
    tenantId: string,
    storageReference: string | null,
  ): Promise<void> {
    const result = await this.run(
      `UPDATE tenants
       SET storage_reference = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [storageReference, tenantId],
    )

    this.assertTenantUpdated(result.rowCount ?? 0, tenantId)
  }

  async updateTenantSubdomain(tenantId: string, subdomain: string): Promise<void> {
    const result = await this.run(
      `UPDATE tenants
       SET subdomain = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [subdomain, tenantId],
    )

    this.assertTenantUpdated(result.rowCount ?? 0, tenantId)
  }

  async updateTenantVersion(tenantId: string, version: string): Promise<void> {
    const result = await this.run(
      `UPDATE tenants
       SET version = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [version, tenantId],
    )

    this.assertTenantUpdated(result.rowCount ?? 0, tenantId)
  }

  async updateTenantBackupMetadata(
    tenantId: string,
    metadata: string,
  ): Promise<void> {
    const result = await this.run(
      `UPDATE tenants
       SET backup_metadata = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [metadata, tenantId],
    )

    this.assertTenantUpdated(result.rowCount ?? 0, tenantId)
  }

  async getStateTransitions(tenantId: string): Promise<StateTransition[]> {
    const rows = await this.run<StateTransitionRow>(
      `SELECT ${stateTransitionSelectColumns}
       FROM state_transitions
       WHERE tenant_id = $1
       ORDER BY id DESC`,
      [tenantId],
    )

    return rows.rows.map((row) => this.mapRowToStateTransition(row))
  }

  async getLatestStateTransitions(): Promise<Map<string, StateTransition>> {
    const rows = await this.run<StateTransitionRow>(
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

    return new Map(
      rows.rows.map((row) => {
        const transition = this.mapRowToStateTransition(row)
        return [transition.tenantId, transition] as const
      }),
    )
  }

  private async recordTransition(
    params: {
      tenantId: string
      fromState: TenantState
      toState: TenantState
      triggeredBy: string
      reason: string | null
    },
    executor: TenantRegistryQueryable = this.pool,
  ): Promise<void> {
    const { tenantId, fromState, toState, triggeredBy, reason } = params

    await executor.query(
      `INSERT INTO state_transitions (
         tenant_id,
         from_state,
         to_state,
         triggered_by,
         reason
       )
       VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, fromState, toState, triggeredBy, reason],
    )
  }

  private async getSchemaMetadata(key: string): Promise<string | null> {
    const result = await this.pool.query<SchemaMetadataRow>(
      `SELECT value
       FROM schema_metadata
       WHERE key = $1`,
      [key],
    )

    return result.rows[0]?.value ?? null
  }

  private async setSchemaMetadata(key: string, value: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO schema_metadata (key, value)
       VALUES ($1, $2)
       ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value`,
      [key, value],
    )
  }

  private assertTenantUpdated(changes: number, tenantId: string): void {
    if (changes === 0) {
      throw new Error(`Tenant ${tenantId} not found`)
    }
  }

  private mapRowToTenant(row: TenantRow): Tenant {
    return {
      id: row.id,
      slug: row.slug,
      subdomain: row.subdomain ?? null,
      ownerId: row.owner_id,
      displayName: row.display_name ?? null,
      planTier: row.plan_tier ?? null,
      initialAdminEmail: row.initial_admin_email ?? null,
      desiredState: row.desired_state,
      currentState: row.current_state,
      version: row.version,
      storageReference: row.storage_reference ?? null,
      backupMetadata: row.backup_metadata ?? null,
      createdAt: normalizeTimestamp(row.created_at),
      updatedAt: normalizeTimestamp(row.updated_at),
    }
  }

  private mapRowToPortalAccount(row: PortalAccountRow): PortalAccount {
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      billingEmail: row.billing_email ?? null,
      billingProvider: row.billing_provider ?? null,
      authProvider: row.auth_provider,
      keycloakSub: row.keycloak_sub ?? null,
      createdAt: normalizeTimestamp(row.created_at),
      updatedAt: normalizeTimestamp(row.updated_at),
    }
  }

  private mapRowToPortalSession(row: PortalSessionRow): PortalSession {
    return {
      id: row.id,
      accountId: row.account_id,
      tokenHash: row.token_hash,
      expiresAt: normalizeTimestamp(row.expires_at),
      createdAt: normalizeTimestamp(row.created_at),
    }
  }

  private mapRowToStateTransition(row: StateTransitionRow): StateTransition {
    return {
      id: Number(row.id),
      tenantId: row.tenant_id,
      fromState: row.from_state,
      toState: row.to_state,
      triggeredBy: row.triggered_by,
      reason: row.reason ?? null,
      createdAt: normalizeTimestamp(row.created_at),
    }
  }

  async close(): Promise<void> {
    if (this.closed) {
      return
    }

    this.closed = true

    try {
      await this.ready
    } catch {
      // Allow cleanup to proceed even if bootstrap failed.
    }

    await this.pool.end()
  }

  private async purgeExpiredPortalSessions(): Promise<void> {
    const now = new Date().toISOString()
    await this.run(
      `DELETE FROM portal_sessions
       WHERE expires_at <= $1`,
      [now],
    )
  }
}

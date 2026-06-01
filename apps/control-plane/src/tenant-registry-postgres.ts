import { setTimeout as delay } from 'node:timers/promises'
import { Pool, type PoolConfig, type QueryResultRow } from 'pg'
import { normalizeUnknownError } from './error-formatting.js'
import { runControlPlaneMigrations } from './migrations.js'
import {
  assertGeneratedTenantSubdomain,
  assertPersistedTenantSubdomain,
} from './tenant-subdomain.js'
import {
  backupRunStatuses,
  tenantStates,
  type AuditLogEntry,
  type AuditOutcome,
  type BackupRun,
  type BackupRunStatus,
  type BackupVerificationStatus,
  type PortalAccount,
  type PortalBillingProvider,
  type RestoreRun,
  type RoleSyncStatus,
  type StateTransition,
  type Tenant,
  type TenantBackupSummary,
  type TenantRestoreSummary,
  type TenantStorageMigrationStatus,
  type TenantStorageMode,
  type TenantStorageSnapshot,
  type TenantState,
  type TenantUptime,
} from './types.js'

const tenantLockNamespaceKey = 101
const CURRENT_TENANT_STATE_SIGNATURE = tenantStates.join(',')
const defaultTenantLockAcquireTimeoutMs = 30_000
const defaultTenantLockRetryDelayMs = 250
const tenantSelectColumns = `id, slug, subdomain, owner_id, display_name, plan_tier,
  initial_admin_email, desired_state, current_state, version, storage_reference,
  created_at, updated_at`
const tenantStorageSelectColumns = `id, desired_state, current_state, storage_reference,
  storage_mode, storage_migration_status,
  storage_migration_failure_reason, storage_migration_updated_at`
const portalAccountSelectColumns = `id, email, display_name, billing_email,
  billing_provider, keycloak_sub, role_sync_status,
  created_at, updated_at`
const stateTransitionSelectColumns = `id, tenant_id, from_state, to_state,
  triggered_by, reason, created_at`
const backupCatalogSelectColumns = `id, tenant_id, status, format, location, location_deleted,
  size_bytes, checksum, failure_reason, triggered_by, reason, requested_at, started_at, completed_at,
  last_verified_at, last_verification_status, last_verification_details, scratch_target,
  created_at, updated_at`
const restoreLogSelectColumns = `id, tenant_id, backup_id, backup_location, status,
  failure_reason, safety_snapshot_id, triggered_by, reason, requested_at, started_at,
  completed_at, created_at, updated_at`
const auditLogSelectColumns = `id, tenant_id, actor, action, resource_type, resource_id,
  outcome, details, created_at`

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
  release(error?: Error): void
}

interface TenantRegistryOptions {
  pool?: TenantRegistryPoolLike
  tenantLockAcquireTimeoutMs?: number
  tenantLockRetryDelayMs?: number
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
  created_at: Date | string
  updated_at: Date | string
}

interface TenantStorageRow {
  id: string
  desired_state: TenantState
  current_state: TenantState
  storage_reference: string | null
  storage_mode: TenantStorageMode
  storage_migration_status: TenantStorageMigrationStatus
  storage_migration_failure_reason: string | null
  storage_migration_updated_at: Date | string | null
}

interface PortalAccountRow {
  id: string
  email: string
  display_name: string
  billing_email: string | null
  billing_provider: PortalBillingProvider | null
  keycloak_sub: string | null
  role_sync_status: RoleSyncStatus
  created_at: Date | string
  updated_at: Date | string
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

interface BackupCatalogRow {
  id: string
  tenant_id: string
  status: BackupRunStatus
  format: string
  location: string | null
  location_deleted: boolean
  size_bytes: number | string | null
  checksum: string | null
  failure_reason: string | null
  triggered_by: string
  reason: string | null
  requested_at: Date | string
  started_at: Date | string | null
  completed_at: Date | string | null
  last_verified_at: Date | string | null
  last_verification_status: BackupVerificationStatus | null
  last_verification_details: string | null
  scratch_target: string | null
  created_at: Date | string
  updated_at: Date | string
}

interface RestoreLogRow {
  id: string
  tenant_id: string
  backup_id: string | null
  backup_location: string
  status: BackupRunStatus
  failure_reason: string | null
  safety_snapshot_id: string | null
  triggered_by: string
  reason: string | null
  requested_at: Date | string
  started_at: Date | string | null
  completed_at: Date | string | null
  created_at: Date | string
  updated_at: Date | string
}

interface AuditLogRow {
  id: bigint | number | string
  tenant_id: string | null
  actor: string
  action: string
  resource_type: string
  resource_id: string | null
  outcome: AuditOutcome
  details: string | null
  created_at: Date | string
}

function parseNonNegativeIntegerSetting(
  name: string,
  rawValue: string | undefined,
  defaultValue: number,
): number {
  if (rawValue === undefined || rawValue.trim() === '') {
    return defaultValue
  }

  if (!/^\d+$/.test(rawValue.trim())) {
    throw new Error(`Invalid ${name} value: ${rawValue}`)
  }

  return Number(rawValue)
}

function parsePositiveIntegerSetting(
  name: string,
  rawValue: string | undefined,
  defaultValue: number,
): number {
  const parsedValue = parseNonNegativeIntegerSetting(name, rawValue, defaultValue)

  if (parsedValue < 1) {
    throw new Error(`Invalid ${name} value: ${rawValue}`)
  }

  return parsedValue
}

function normalizePositiveIntegerOption(
  name: string,
  value: number | undefined,
  defaultValue: number,
): number {
  if (value === undefined) {
    return defaultValue
  }

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Invalid ${name} value: ${value}`)
  }

  return value
}

function normalizeNonNegativeIntegerOption(
  name: string,
  value: number | undefined,
  defaultValue: number,
): number {
  if (value === undefined) {
    return defaultValue
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${name} value: ${value}`)
  }

  return value
}

export function createTenantRegistryPoolConfig(
  connectionString: string,
  env: NodeJS.ProcessEnv = process.env,
): PoolConfig {
  const config: PoolConfig = {
    connectionString,
    min: parseNonNegativeIntegerSetting(
      'CONTROL_PLANE_DATABASE_POOL_MIN',
      env.CONTROL_PLANE_DATABASE_POOL_MIN,
      0,
    ),
    max: parsePositiveIntegerSetting(
      'CONTROL_PLANE_DATABASE_POOL_MAX',
      env.CONTROL_PLANE_DATABASE_POOL_MAX,
      10,
    ),
    idleTimeoutMillis: parseNonNegativeIntegerSetting(
      'CONTROL_PLANE_DATABASE_IDLE_TIMEOUT_MS',
      env.CONTROL_PLANE_DATABASE_IDLE_TIMEOUT_MS,
      30_000,
    ),
    connectionTimeoutMillis: parseNonNegativeIntegerSetting(
      'CONTROL_PLANE_DATABASE_CONNECTION_TIMEOUT_MS',
      env.CONTROL_PLANE_DATABASE_CONNECTION_TIMEOUT_MS,
      10_000,
    ),
    statement_timeout: parseNonNegativeIntegerSetting(
      'CONTROL_PLANE_DATABASE_STATEMENT_TIMEOUT_MS',
      env.CONTROL_PLANE_DATABASE_STATEMENT_TIMEOUT_MS,
      30_000,
    ),
  }

  if ((config.max ?? 0) < (config.min ?? 0)) {
    throw new Error(
      `Invalid control-plane pool settings: CONTROL_PLANE_DATABASE_POOL_MAX (${config.max}) must be >= CONTROL_PLANE_DATABASE_POOL_MIN (${config.min}).`,
    )
  }

  return config
}

function createOwnedTenantRegistryPool(connectionString: string): TenantRegistryPoolLike {
  return new Pool(createTenantRegistryPoolConfig(connectionString))
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

function hashTenantLockKey(tenantId: string): bigint {
  const hashInput = `${tenantLockNamespaceKey}:${tenantId}`
  let hash = 0xcbf29ce484222325n

  for (let index = 0; index < hashInput.length; index += 1) {
    hash ^= BigInt(hashInput.charCodeAt(index))
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }

  return hash
}

function createTenantLockKeys(tenantId: string): readonly [number, number] {
  const hash = hashTenantLockKey(tenantId)
  return [
    Number(BigInt.asIntN(32, hash >> 32n)),
    Number(BigInt.asIntN(32, hash & 0xffff_ffffn)),
  ] as const
}

function toCleanupReleaseError(error: unknown): Error | undefined {
  if (error === undefined) {
    return undefined
  }

  return error instanceof Error
    ? error
    : new Error('Tenant registry session cleanup failed', { cause: error })
}

function isTenantRegistryClientLike(
  executor: TenantRegistryPoolLike | TenantRegistryClientLike,
): executor is TenantRegistryClientLike {
  return 'release' in executor && typeof executor.release === 'function'
}

export class TenantRegistryLockTimeoutError extends Error {
  readonly tenantId: string
  readonly timeoutMs: number

  constructor(tenantId: string, timeoutMs: number) {
    super(
      `Timed out after ${timeoutMs}ms waiting for the advisory lock on tenant ${tenantId}. ` +
        `Another operation is holding the lock. ` +
        `If no provisioning or deprovision is actively running, restart the control-plane ` +
        `to flush the connection pool and release the orphaned lock.`,
    )
    this.name = 'TenantRegistryLockTimeoutError'
    this.tenantId = tenantId
    this.timeoutMs = timeoutMs
  }
}

export class TenantRegistry {
  private readonly pool: TenantRegistryPoolLike
  private readonly ownsPool: boolean
  private readonly ready: Promise<void>
  private readonly tenantLockAcquireTimeoutMs: number
  private readonly tenantLockRetryDelayMs: number
  private closed = false

  constructor(connectionString: string, options: TenantRegistryOptions = {}) {
    const { pool, ownedPool } = resolveTenantRegistryPool(connectionString, options)
    this.pool = pool
    this.ownsPool = ownedPool !== undefined
    this.tenantLockAcquireTimeoutMs = normalizePositiveIntegerOption(
      'tenantLockAcquireTimeoutMs',
      options.tenantLockAcquireTimeoutMs,
      defaultTenantLockAcquireTimeoutMs,
    )
    this.tenantLockRetryDelayMs = normalizeNonNegativeIntegerOption(
      'tenantLockRetryDelayMs',
      options.tenantLockRetryDelayMs,
      defaultTenantLockRetryDelayMs,
    )
    this.ready = this.migrateSchema()
  }

  /**
   * Resolves once the control-plane schema has been migrated. Service boot
   * code should await this before binding the HTTP listener so that any
   * migration failure is surfaced before traffic is accepted.
   */
  whenReady(): Promise<void> {
    this.assertOpen()
    return this.ready
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error('Tenant registry unavailable')
    }
  }

  private async migrateSchema(): Promise<void> {
    // The baseline migration is also the forward-only replacement for the
    // retired schema_version upgrade chain, so older registries are widened
    // here before the runtime-only metadata validation below.
    await runControlPlaneMigrations({ pool: this.pool })

    let storedStateSignature = await this.getSchemaMetadata('tenant_state_signature')
    if (!storedStateSignature) {
      await this.setSchemaMetadata(
        'tenant_state_signature',
        CURRENT_TENANT_STATE_SIGNATURE,
      )
      storedStateSignature = CURRENT_TENANT_STATE_SIGNATURE
    }

    if (storedStateSignature !== CURRENT_TENANT_STATE_SIGNATURE) {
      throw new Error(
        'Tenant state constraints changed; explicit schema migration required',
      )
    }
  }

  private async withTransaction<Result>(
    operation: (client: TenantRegistryClientLike) => Promise<Result>,
    executor: TenantRegistryPoolLike | TenantRegistryClientLike = this.pool,
  ): Promise<Result> {
    this.assertOpen()
    await this.ready
    const ownsClient = !isTenantRegistryClientLike(executor)
    const client = ownsClient ? await executor.connect() : executor
    let releaseError: Error | undefined

    try {
      await client.query('BEGIN')
      const result = await operation(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      try {
        await client.query('ROLLBACK')
      } catch (rollbackError) {
        releaseError = toCleanupReleaseError(rollbackError)
      }
      throw error
    } finally {
      if (ownsClient) {
        client.release(releaseError)
      }
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

  async withTenantLock<Result>(
    tenantId: string,
    operation: (executor: TenantRegistryClientLike) => Promise<Result>,
  ): Promise<Result> {
    this.assertOpen()
    await this.ready

    const client = await this.pool.connect()
    const lockValues = createTenantLockKeys(tenantId)
    let result: Result | undefined
    let operationError: unknown
    let lockAcquired = false
    let unlockError: unknown

    try {
      await this.acquireTenantLock(client, tenantId, lockValues)
      lockAcquired = true

      if ((await this.getTenant(tenantId, client)) === null) {
        throw new Error(`Tenant ${tenantId} not found`)
      }

      result = await operation(client)
    } catch (error) {
      operationError = error
    } finally {
      if (lockAcquired) {
        try {
          const unlockResult = await client.query<{ unlocked: boolean }>(
            'SELECT pg_advisory_unlock($1::integer, $2::integer) AS unlocked',
            lockValues,
          )

          if (!unlockResult.rows[0]?.unlocked) {
            unlockError = new Error(`Tenant ${tenantId} advisory unlock did not succeed`)
          }
        } catch (error) {
          unlockError = error
        }
      }

      const cleanupError = toCleanupReleaseError(unlockError)
      client.release(cleanupError)
    }

    const errors = [
      operationError === undefined
        ? undefined
        : normalizeUnknownError(operationError, 'Tenant registry operation failed'),
      unlockError === undefined
        ? undefined
        : normalizeUnknownError(unlockError, 'Tenant registry advisory unlock failed'),
    ].filter((error): error is NonNullable<typeof error> => error !== undefined)

    if (errors.length === 1) {
      throw errors[0]
    }

    if (errors.length > 1) {
      throw new AggregateError(
        errors,
        'Tenant registry operation failed and one or more session cleanup steps also failed',
      )
    }

    return result as Result
  }

  private async acquireTenantLock(
    executor: TenantRegistryQueryable,
    tenantId: string,
    lockValues: readonly [number, number],
  ): Promise<void> {
    const startedAt = Date.now()

    while (true) {
      const result = await executor.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock($1::integer, $2::integer) AS locked',
        lockValues,
      )

      if (result.rows[0]?.locked) {
        return
      }

      const elapsedMs = Date.now() - startedAt
      const remainingMs = this.tenantLockAcquireTimeoutMs - elapsedMs

      if (remainingMs <= 0) {
        throw new TenantRegistryLockTimeoutError(
          tenantId,
          this.tenantLockAcquireTimeoutMs,
        )
      }

      await delay(Math.min(this.tenantLockRetryDelayMs, remainingMs))
    }
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

  async getTenant(
    tenantId: string,
    executor: TenantRegistryQueryable = this.pool,
  ): Promise<Tenant | null> {
    const row = await this.run<TenantRow>(
      `SELECT ${tenantSelectColumns}
       FROM tenants
       WHERE id = $1`,
      [tenantId],
      executor,
    )

    return row.rows[0] ? this.mapRowToTenant(row.rows[0]) : null
  }

  async getTenantBySlug(
    slug: string,
    executor: TenantRegistryQueryable = this.pool,
  ): Promise<Tenant | null> {
    const row = await this.run<TenantRow>(
      `SELECT ${tenantSelectColumns}
       FROM tenants
       WHERE slug = $1`,
      [slug],
      executor,
    )

    return row.rows[0] ? this.mapRowToTenant(row.rows[0]) : null
  }

  async getTenantBySubdomain(
    subdomain: string,
    executor: TenantRegistryQueryable = this.pool,
  ): Promise<Tenant | null> {
    const row = await this.run<TenantRow>(
      `SELECT ${tenantSelectColumns}
       FROM tenants
       WHERE subdomain = $1`,
      [subdomain],
      executor,
    )

    return row.rows[0] ? this.mapRowToTenant(row.rows[0]) : null
  }

  async getTenantStorageSnapshot(
    tenantId: string,
    executor: TenantRegistryQueryable = this.pool,
  ): Promise<TenantStorageSnapshot | null> {
    const row = await this.run<TenantStorageRow>(
      `SELECT ${tenantStorageSelectColumns}
       FROM tenants
       WHERE id = $1`,
      [tenantId],
      executor,
    )

    return row.rows[0] ? this.mapRowToTenantStorageSnapshot(row.rows[0]) : null
  }

  async reserveTenantSubdomain(
    tenantId: string,
    createCandidate: () => string,
    maxAttempts = 10,
    executor: TenantRegistryPoolLike | TenantRegistryClientLike = this.pool,
  ): Promise<string> {
    this.assertOpen()
    await this.ready
    const existingTenant = await this.getTenant(tenantId, executor)

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
      const conflictingTenant = await this.getTenantBySubdomain(candidate, executor)

      if (conflictingTenant && conflictingTenant.id !== tenantId) {
        continue
      }

      try {
        return await this.withTransaction(async (client) => {
          const lockedTenant = await client.query<{ subdomain: string | null }>(
            `SELECT subdomain
             FROM tenants
             WHERE id = $1
             FOR UPDATE`,
            [tenantId],
          )

          if ((lockedTenant.rowCount ?? lockedTenant.rows.length) !== 1) {
            throw new Error(`Tenant ${tenantId} not found`)
          }

          const persistedSubdomain = lockedTenant.rows[0]?.subdomain
          if (persistedSubdomain != null) {
            return assertPersistedTenantSubdomain(
              tenantId,
              persistedSubdomain,
              'provisioning or deprovisioning tenant resources',
            )
          }

          const updatedTenant = await client.query<{ subdomain: string }>(
            `UPDATE tenants
             SET subdomain = $1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $2
             RETURNING subdomain`,
            [candidate, tenantId],
          )

          if ((updatedTenant.rowCount ?? updatedTenant.rows.length) !== 1) {
            throw new Error(`Tenant ${tenantId} not found`)
          }

          return updatedTenant.rows[0].subdomain
        }, executor)
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
    /** @deprecated Phase 2 local-auth relic; will be removed once no callers send it. */
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
    billingEmail?: string | null
    billingProvider?: PortalBillingProvider | null
    keycloakSub?: string | null
  }): Promise<PortalAccount> {
    const {
      id,
      email,
      displayName,
      billingEmail,
      billingProvider,
      keycloakSub,
    } = params

    const result = await this.run<PortalAccountRow>(
      `INSERT INTO portal_accounts (
         id,
         email,
         display_name,
         billing_email,
         billing_provider,
         keycloak_sub
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${portalAccountSelectColumns}`,
      [
        id,
        email,
        displayName,
        billingEmail ?? null,
        billingProvider ?? null,
        keycloakSub ?? null,
      ],
    )
    const row = result.rows[0]

    if (!row) {
      throw new Error('Failed to retrieve created portal account')
    }

    return this.mapRowToPortalAccount(row)
  }

  /**
   * Provisions a portal_accounts row for a user that authenticated via
   * Keycloak but has no existing local account. Idempotent: if a concurrent
   * request already created the row (23505 on email or keycloak_sub), re-reads
   * by keycloakSub and returns the winner. If the re-read still returns nothing,
   * propagates the original error so the caller sees a 500 (not a silent swallow).
   *
   * Display-name derivation order: claims.name -> given_name + family_name ->
   * email local-part (everything before the first @).
   */
  async createPortalAccountFromKeycloak(params: {
    id: string
    keycloakSub: string
    email: string
    displayName: string
  }): Promise<PortalAccount> {
    const { id, keycloakSub, email, displayName } = params

    try {
      const result = await this.run<PortalAccountRow>(
        `INSERT INTO portal_accounts (
           id,
           email,
           display_name,
           billing_email,
           billing_provider,
           keycloak_sub
         )
         VALUES ($1, $2, $3, NULL, NULL, $4)
         RETURNING ${portalAccountSelectColumns}`,
        [id, email, displayName, keycloakSub],
      )
      const row = result.rows[0]

      if (!row) {
        throw new Error('Failed to retrieve created portal account')
      }

      return this.mapRowToPortalAccount(row)
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error
      }

      // Race: another concurrent first-login already created the row. Re-read
      // by keycloakSub — the winner will have written both email and sub
      // atomically, so this is the safe discriminator.
      const existing = await this.getPortalAccountByKeycloakSub(keycloakSub)

      if (existing) {
        return existing
      }

      // The conflict was on email but the keycloak_sub index returned nothing.
      // This means the email belongs to a pre-existing local account without a
      // sub. The middleware should route to the email-link path instead.
      // Re-throw so the caller sees it as a 500 rather than silent corruption.
      throw error
    }
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

  async getPortalAccount(
    accountId: string,
    executor: TenantRegistryQueryable = this.pool,
  ): Promise<PortalAccount | null> {
    const row = await this.run<PortalAccountRow>(
      `SELECT ${portalAccountSelectColumns}
       FROM portal_accounts
       WHERE id = $1`,
      [accountId],
      executor,
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

  async getPortalAccountByKeycloakSub(keycloakSub: string): Promise<PortalAccount | null> {
    const row = await this.run<PortalAccountRow>(
      `SELECT ${portalAccountSelectColumns}
       FROM portal_accounts
       WHERE keycloak_sub = $1`,
      [keycloakSub],
    )

    return row.rows[0] ? this.mapRowToPortalAccount(row.rows[0]) : null
  }

  /**
   * Conditionally binds a Keycloak `sub` to an account that has no existing
   * binding. Uses a conditional UPDATE (`WHERE COALESCE(keycloak_sub, '') = ''`)
   * so concurrent first-login requests for the same account converge atomically.
   *
   * The UPDATE also sets `role_sync_status = 'pending'` in the same statement.
   * This is intentional: the link and the pending marker land atomically, so the
   * background retry loop can always recover from a process crash that occurs
   * between the link write and the in-request role-assignment sweep.
   *
   * Note: the condition uses COALESCE rather than `keycloak_sub IS NULL` because
   * pg-mem (the in-memory Postgres used in tests) does not evaluate `IS NULL` in
   * UPDATE WHERE clauses correctly. `COALESCE(col, '') = ''` is semantically
   * equivalent in real Postgres for this column: no code path writes an empty
   * string sub, so NULL and empty string are indistinguishable in practice.
   *
   * Returns the account state after the attempt:
   * - If the link was written (or already matches), returns the updated account.
   * - If the account is already bound to a *different* sub, returns null so the
   *   caller can issue a 401.
   */
  async linkPortalAccountKeycloakSub(
    accountId: string,
    keycloakSub: string,
  ): Promise<PortalAccount | null> {
    const updateResult = await this.run<PortalAccountRow>(
      `UPDATE portal_accounts
       SET keycloak_sub = $1, role_sync_status = 'pending', updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND COALESCE(keycloak_sub, '') = ''
       RETURNING ${portalAccountSelectColumns}`,
      [keycloakSub, accountId],
    )

    if (updateResult.rows[0]) {
      return this.mapRowToPortalAccount(updateResult.rows[0])
    }

    // The conditional UPDATE matched zero rows. Either the account already has
    // a keycloak_sub set (race or pre-existing binding) or the accountId is
    // invalid. Re-read to disambiguate.
    const current = await this.getPortalAccount(accountId)

    if (!current) {
      return null
    }

    // Idempotent: the account was already linked to the same sub.
    if (current.keycloakSub === keycloakSub) {
      return current
    }

    // Bound to a different identity — do not overwrite.
    return null
  }

  /**
   * Marks a portal account's role-sync state as 'pending', indicating that
   * the per-tenant Keycloak role sweep ran but at least one assignment may
   * not have completed. The background retry loop picks up 'pending' rows
   * and re-attempts role assignment until all succeed.
   *
   * No-op if the account does not exist (returns false). Returns true on
   * a successful update.
   */
  async markRoleSyncPending(accountId: string): Promise<boolean> {
    const result = await this.run(
      `UPDATE portal_accounts
       SET role_sync_status = 'pending', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [accountId],
    )

    return (result.rowCount ?? 0) > 0
  }

  /**
   * Marks a portal account's role-sync state as 'complete'. Called by the
   * background retry loop after all per-tenant role assignments succeed, and
   * by the in-request sweep when every assignment in the loop succeeds at the
   * auto-link moment.
   *
   * No-op if the account does not exist (returns false). Returns true on
   * a successful update.
   */
  async markRoleSyncComplete(accountId: string): Promise<boolean> {
    const result = await this.run(
      `UPDATE portal_accounts
       SET role_sync_status = 'complete', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [accountId],
    )

    return (result.rowCount ?? 0) > 0
  }

  /**
   * Returns all portal accounts whose role-sync state is 'pending'. Used by
   * the background retry loop to find accounts that need another attempt.
   *
   * Only accounts with a non-null keycloak_sub are returned — an account
   * without a sub cannot have Keycloak roles assigned.
   */
  async getPortalAccountsPendingRoleSync(): Promise<PortalAccount[]> {
    const result = await this.run<PortalAccountRow>(
      `SELECT ${portalAccountSelectColumns}
       FROM portal_accounts
       WHERE role_sync_status = 'pending'
         AND keycloak_sub IS NOT NULL`,
    )

    return result.rows.map((row) => this.mapRowToPortalAccount(row))
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

  async updateTenantState(
    tenantId: string,
    newState: TenantState,
    triggeredBy: string,
    reason?: string,
    executor: TenantRegistryPoolLike | TenantRegistryClientLike = this.pool,
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
    }, executor)
  }

  /**
   * Whether the activator has ever observed this tenant — i.e. a
   * tenant_activity row exists with seen_by_activator = TRUE. The activator
   * stamps this flag on every request it proxies, so it is the registry's
   * proxy for "the activator is in this tenant's request path".
   *
   * Used to gate the operator state API's sleeping transition (#373): only a
   * tenant the activator can wake on demand may be safely put to sleep.
   * Tenants with no activity row (never seen) return false.
   */
  async hasBeenSeenByActivator(
    tenantId: string,
    executor: TenantRegistryQueryable = this.pool,
  ): Promise<boolean> {
    const result = await this.run<{ seen_by_activator: boolean }>(
      `SELECT seen_by_activator
       FROM tenant_activity
       WHERE tenant_id = $1`,
      [tenantId],
      executor,
    )
    return result.rows[0]?.seen_by_activator === true
  }

  async updateTenantDesiredState(
    tenantId: string,
    desiredState: TenantState,
    executor: TenantRegistryQueryable = this.pool,
  ): Promise<void> {
    const result = await this.run(
      `UPDATE tenants
       SET desired_state = $1,
            updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [desiredState, tenantId],
      executor,
    )

    this.assertTenantUpdated(result.rowCount ?? 0, tenantId)
  }

  async updateTenantStorageReference(
    tenantId: string,
    storageReference: string | null,
    executor: TenantRegistryQueryable = this.pool,
  ): Promise<void> {
    const result = await this.run(
      `UPDATE tenants
       SET storage_reference = $1,
            updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [storageReference, tenantId],
      executor,
    )

    this.assertTenantUpdated(result.rowCount ?? 0, tenantId)
  }

  async updateTenantStorageProfile(
    tenantId: string,
    params: {
      mode: TenantStorageMode
      migrationStatus: TenantStorageMigrationStatus
      failureReason?: string | null
    },
    executor: TenantRegistryQueryable = this.pool,
  ): Promise<void> {
    const nextFailureReason = params.failureReason ?? null
    const result = await this.run(
      `UPDATE tenants
       SET storage_mode = $1,
           storage_migration_status = $2,
           storage_migration_failure_reason = CAST($3 AS TEXT),
           storage_migration_updated_at = COALESCE(
             CASE
               WHEN current_profile.storage_migration_status <> $2
                 OR (
                    current_profile.storage_migration_failure_reason IS NULL
                    AND CAST($3 AS TEXT) IS NOT NULL
                  )
                  OR (
                    current_profile.storage_migration_failure_reason IS NOT NULL
                    AND CAST($3 AS TEXT) IS NULL
                  )
                  OR current_profile.storage_migration_failure_reason <> CAST($3 AS TEXT)
               THEN CAST(CURRENT_TIMESTAMP AS TIMESTAMPTZ)
               ELSE CAST(NULL AS TIMESTAMPTZ)
             END,
             current_profile.storage_migration_updated_at
            ),
           updated_at = CURRENT_TIMESTAMP
       FROM tenants AS current_profile
       WHERE tenants.id = $4
         AND current_profile.id = tenants.id`,
      [
        params.mode,
        params.migrationStatus,
        nextFailureReason,
        tenantId,
      ],
      executor,
    )

    this.assertTenantUpdated(result.rowCount ?? 0, tenantId)
  }

  async updateTenantSubdomain(
    tenantId: string,
    subdomain: string,
    executor: TenantRegistryQueryable = this.pool,
  ): Promise<void> {
    const result = await this.run(
      `UPDATE tenants
       SET subdomain = $1,
            updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [subdomain, tenantId],
      executor,
    )

    this.assertTenantUpdated(result.rowCount ?? 0, tenantId)
  }

  async updateTenantVersion(
    tenantId: string,
    version: string,
    executor: TenantRegistryQueryable = this.pool,
  ): Promise<void> {
    const result = await this.run(
      `UPDATE tenants
       SET version = $1,
            updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [version, tenantId],
      executor,
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

  /**
   * Compute per-tenant uptime metrics for all given tenants derived from
   * state_transitions and tenant_activity.
   *
   * The window is [now - windowHours * 1h, now]. Tenants with no
   * state_transitions rows get sensible defaults (uptimePct 100 if ready,
   * 0 otherwise).
   *
   * Runs four bulk SQL queries in parallel (no N+1) and combines in TypeScript.
   * Duration arithmetic is done in TypeScript because pg-mem does not support
   * TIMESTAMPTZ - TIMESTAMPTZ subtraction or EXTRACT(EPOCH FROM interval).
   * Window functions (OVER/LAG) and correlated subqueries are avoided to stay
   * within pg-mem's supported SQL subset.
   *
   * uptimePct is % of window spent in `ready` state (not just "not sleeping").
   * A provisioning-only tenant has uptimePct = 0 even with no sleep spans.
   */
  async getFleetUptimes(
    tenants: ReadonlyArray<{ id: string; currentState: TenantState; createdAt: string }>,
    windowHours: number,
  ): Promise<Map<string, TenantUptime>> {
    if (tenants.length === 0) {
      return new Map()
    }

    const tenantIds = tenants.map((t) => t.id)
    const windowMs = windowHours * 3600 * 1000
    const now = new Date()
    const windowStart = new Date(now.getTime() - windowMs)
    const windowStartIso = windowStart.toISOString()
    const windowEndIso = now.toISOString()

    // Tenant-id placeholders. Each query uses $1...$N = tenantIds, or
    // $1 = windowStart, $2 = windowEnd, $3...$N+2 = tenantIds.
    const tenantPlaceholders1 = tenantIds.map((_, i) => `$${i + 1}`).join(', ')
    const tenantPlaceholders3 = tenantIds.map((_, i) => `$${i + 3}`).join(', ')

    const [inWindowResult, latestTransResult, preWindowResult, wakeAndActivityResult] =
      await Promise.all([
        // Query A: All transitions WITHIN the window for all tenants, ordered by
        // created_at ASC (with id as tiebreaker for same-timestamp transitions).
        // We fetch ALL transitions (not just sleeping) so TypeScript can compute
        // state intervals and uptimePct = % of window in `ready`.
        this.run<{ tenant_id: string; from_state: string; to_state: string; created_at: string }>(
          `SELECT tenant_id, from_state, to_state, created_at
           FROM state_transitions
           WHERE tenant_id IN (${tenantPlaceholders3})
             AND created_at >= $1::timestamptz
             AND created_at < $2::timestamptz
           ORDER BY tenant_id, created_at, id`,
          [windowStartIso, windowEndIso, ...tenantIds],
        ),

        // Query B: Latest transition per tenant (for currentStateSince).
        // INNER JOIN on MAX(id) — same pattern as getLatestStateTransitions.
        this.run<{ tenant_id: string; current_state_since: string }>(
          `SELECT st.tenant_id, st.created_at AS current_state_since
           FROM state_transitions st
           INNER JOIN (
             SELECT tenant_id, MAX(id) AS latest_id
             FROM state_transitions
             WHERE tenant_id IN (${tenantPlaceholders1})
             GROUP BY tenant_id
           ) latest ON latest.tenant_id = st.tenant_id
                   AND latest.latest_id = st.id`,
          tenantIds,
        ),

        // Query C: Last transition BEFORE the window per tenant (state-at-window-start).
        // INNER JOIN on MAX(id) with created_at < windowStart — no correlated subquery.
        // Uses tenantPlaceholders3 ($3+) to keep the same positional layout as Queries
        // A and D so all four queries bind ($1=windowStart, $2=windowEnd, $3+tenantIds).
        // $2 (windowEnd) is unused in this query but kept to preserve placeholder alignment.
        this.run<{ tenant_id: string; state_at_window_start: string }>(
          `SELECT st.tenant_id, st.to_state AS state_at_window_start
           FROM state_transitions st
           INNER JOIN (
             SELECT tenant_id, MAX(id) AS latest_id
             FROM state_transitions
             WHERE tenant_id IN (${tenantPlaceholders3})
               AND created_at < $1::timestamptz
             GROUP BY tenant_id
           ) pre ON pre.tenant_id = st.tenant_id
               AND pre.latest_id = st.id`,
          [windowStartIso, windowEndIso, ...tenantIds],
        ),

        // Query D: sleeping→ready wake counts + seenByActivator.
        // Uses a base-set-of-tenants-with-transitions derived from DISTINCT, then
        // LEFT JOINs for wake events and activator flag.
        this.run<{
          tenant_id: string
          wake_count: string
          last_wake_at: string | null
          seen_by_activator: boolean | null
        }>(
          `SELECT
             base.tenant_id,
             COUNT(wk.id)        AS wake_count,
             MAX(wk.created_at)  AS last_wake_at,
             ta.seen_by_activator
           FROM (
             SELECT DISTINCT tenant_id FROM state_transitions
             WHERE tenant_id IN (${tenantPlaceholders3})
           ) base
           LEFT JOIN state_transitions wk
             ON wk.tenant_id = base.tenant_id
            AND wk.from_state = 'sleeping'
            AND wk.to_state = 'ready'
            AND wk.created_at >= $1::timestamptz
            AND wk.created_at < $2::timestamptz
           LEFT JOIN tenant_activity ta
             ON ta.tenant_id = base.tenant_id
           GROUP BY base.tenant_id, ta.seen_by_activator`,
          [windowStartIso, windowEndIso, ...tenantIds],
        ),
      ])

    // Index results by tenant_id
    const latestTransByTenant = new Map(
      latestTransResult.rows.map((r) => [r.tenant_id, r.current_state_since]),
    )
    const preWindowByTenant = new Map(
      preWindowResult.rows.map((r) => [r.tenant_id, r.state_at_window_start]),
    )
    const wakeByTenant = new Map(wakeAndActivityResult.rows.map((r) => [r.tenant_id, r]))

    // Group in-window transitions by tenant
    const inWindowByTenant = new Map<string, Array<{ fromState: string; toState: string; at: Date }>>()
    for (const row of inWindowResult.rows) {
      const entry = { fromState: row.from_state, toState: row.to_state, at: new Date(row.created_at) }
      const existing = inWindowByTenant.get(row.tenant_id)
      if (existing) {
        existing.push(entry)
      } else {
        inWindowByTenant.set(row.tenant_id, [entry])
      }
    }

    const result = new Map<string, TenantUptime>()

    for (const tenant of tenants) {
      const currentStateSince = latestTransByTenant.get(tenant.id) ?? tenant.createdAt
      const hasAnyTransitions = latestTransByTenant.has(tenant.id)
      const wakeRow = wakeByTenant.get(tenant.id)

      // In-window transitions, already ordered by id (chronological).
      const inWindowTrans = inWindowByTenant.get(tenant.id) ?? []

      // State at window start: prefer the pre-window lookback (Query C).
      // If no pre-window transition exists and there are in-window transitions,
      // use the fromState of the earliest in-window transition — that is the
      // state the tenant was actually in before its first recorded transition.
      // Final fallback to tenant.currentState for tenants with zero transitions.
      const stateAtWindowStart =
        preWindowByTenant.get(tenant.id) ??
        inWindowTrans[0]?.fromState ??
        tenant.currentState

      // Build state timeline within the window: [windowStart, t1, t2, ..., now]
      // Each interval is [start, end) with a known state.
      let totalReadyMs = 0
      let totalSleepMs = 0
      let lastSleepMs: number | null = null
      let lastCompletedSleepEnd: Date | null = null

      // Walk intervals: currentIntervalState tracks what state we're in
      let currentIntervalState = stateAtWindowStart
      let currentIntervalStart = windowStart.getTime()

      for (const trans of inWindowTrans) {
        const intervalEnd = trans.at.getTime()
        const durationMs = Math.max(0, intervalEnd - currentIntervalStart)

        if (currentIntervalState === 'ready') {
          totalReadyMs += durationMs
        } else if (currentIntervalState === 'sleeping') {
          totalSleepMs += durationMs
        }

        // Closing a sleeping interval that just ended (trans into next state)
        if (currentIntervalState === 'sleeping') {
          const sleepEnd = trans.at
          if (
            lastCompletedSleepEnd === null ||
            sleepEnd.getTime() > lastCompletedSleepEnd.getTime()
          ) {
            lastCompletedSleepEnd = sleepEnd
            lastSleepMs = durationMs
          }
        }

        currentIntervalState = trans.toState
        currentIntervalStart = intervalEnd
      }

      // Last interval: from last transition to now
      {
        const durationMs = Math.max(0, now.getTime() - currentIntervalStart)
        if (currentIntervalState === 'ready') {
          totalReadyMs += durationMs
        } else if (currentIntervalState === 'sleeping') {
          totalSleepMs += durationMs
          // Ongoing sleep — does NOT count as lastSleepMs (not a completed span)
        }
      }

      // uptimePct: % of window spent in ready.
      // For tenants with no transitions at all, apply spec defaults.
      let uptimePct: number
      if (!hasAnyTransitions) {
        uptimePct = tenant.currentState === 'ready' ? 100 : 0
      } else {
        uptimePct = Math.max(0, Math.min(100, (totalReadyMs / windowMs) * 100))
      }

      const wakeCount = wakeRow ? Number(wakeRow.wake_count) : 0
      const lastWakeAt = wakeRow?.last_wake_at ?? null
      const seenByActivator = wakeRow?.seen_by_activator === true

      result.set(tenant.id, {
        currentStateSince,
        uptimePct,
        totalSleepMs,
        lastSleepMs,
        wakeCount,
        lastWakeAt,
        seenByActivator,
      })
    }

    return result
  }

  async createBackupRun(params: {
    id: string
    tenantId: string
    triggeredBy: string
    reason?: string | null
    format?: string
    scratchTarget?: string | null
  }): Promise<BackupRun> {
    const result = await this.run<BackupCatalogRow>(
      `INSERT INTO backup_catalog (
         id, tenant_id, status, format, triggered_by, reason, scratch_target
       )
       VALUES ($1, $2, 'queued', $3, $4, $5, $6)
       RETURNING ${backupCatalogSelectColumns}`,
      [
        params.id,
        params.tenantId,
        params.format ?? 'custom',
        params.triggeredBy,
        params.reason ?? null,
        params.scratchTarget ?? null,
      ],
    )
    const row = result.rows[0]

    if (!row) {
      throw new Error('Failed to retrieve created backup run')
    }

    return this.mapRowToBackupRun(row)
  }

  async markBackupRunRunning(id: string): Promise<BackupRun> {
    return this.assertBackupRunReturned(
      await this.run<BackupCatalogRow>(
        `UPDATE backup_catalog
         SET status = 'running',
             started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING ${backupCatalogSelectColumns}`,
        [id],
      ),
      id,
    )
  }

  async markBackupRunCompleted(
    id: string,
    params: {
      location: string
      sizeBytes?: number | null
      checksum?: string | null
      completedAt?: string
    },
  ): Promise<BackupRun> {
    return this.assertBackupRunReturned(
      await this.run<BackupCatalogRow>(
        `UPDATE backup_catalog
         SET status = 'completed',
             location = $1,
             size_bytes = $2,
             checksum = $3,
             completed_at = COALESCE($4::timestamptz, CURRENT_TIMESTAMP),
             failure_reason = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $5
         RETURNING ${backupCatalogSelectColumns}`,
        [
          params.location,
          params.sizeBytes ?? null,
          params.checksum ?? null,
          params.completedAt ?? null,
          id,
        ],
      ),
      id,
    )
  }

  async markBackupRunFailed(
    id: string,
    failureReason: string,
  ): Promise<BackupRun> {
    return this.assertBackupRunReturned(
      await this.run<BackupCatalogRow>(
        `UPDATE backup_catalog
         SET status = 'failed',
             failure_reason = $1,
             completed_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING ${backupCatalogSelectColumns}`,
        [failureReason, id],
      ),
      id,
    )
  }

  async recordBackupVerification(
    id: string,
    params: {
      status: BackupVerificationStatus
      verifiedAt?: string
      details?: string | null
      scratchTarget?: string | null
    },
  ): Promise<BackupRun> {
    return this.assertBackupRunReturned(
      await this.run<BackupCatalogRow>(
        `UPDATE backup_catalog
         SET last_verification_status = $1,
             last_verified_at = COALESCE($2::timestamptz, CURRENT_TIMESTAMP),
             last_verification_details = $3,
             scratch_target = COALESCE($4, scratch_target),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $5
         RETURNING ${backupCatalogSelectColumns}`,
        [
          params.status,
          params.verifiedAt ?? null,
          params.details ?? null,
          params.scratchTarget ?? null,
          id,
        ],
      ),
      id,
    )
  }

  /**
   * Marks all backup_catalog rows whose `location` ends with `/<blobName>` as
   * deleted. Called by the retention sweep immediately after deleteBlob()
   * succeeds for a given blob. Returns the number of rows updated (usually 1;
   * 0 is a warning-worthy drift between catalog and blob store).
   *
   * The match uses `location LIKE '%/' || blobName` so the blob name must be
   * the full path component (e.g. `tenant-foo/2026-01-01T00-00-00-000Z-backup.dump`).
   *
   * `blobName` is rejected if it contains a LIKE metacharacter (`%`, `_`,
   * `\`). Today's blob names are derived from UUIDs and ISO timestamps and
   * never contain those characters, so this is a defensive guard rather
   * than a hot-path concern. Rejecting at the boundary avoids the
   * accidental-widening risk that a raw LIKE pattern would create if
   * naming conventions ever changed, while keeping the query itself
   * compatible with our pg-mem test harness (which does not implement
   * `LIKE ... ESCAPE`).
   *
   * Only rows with `location_deleted = false` are touched so re-runs are
   * idempotent and do not bump `updated_at` unnecessarily.
   */
  async markBackupCatalogLocationDeletedForBlob(blobName: string): Promise<number> {
    if (/[%_\\]/.test(blobName)) {
      throw new Error(
        `markBackupCatalogLocationDeletedForBlob: blobName contains a LIKE metacharacter (%, _, or \\): ${blobName}`,
      )
    }
    const result = await this.run(
      `UPDATE backup_catalog
       SET location_deleted = true,
           updated_at = CURRENT_TIMESTAMP
       WHERE location LIKE '%/' || $1
         AND location_deleted = false`,
      [blobName],
    )

    return result.rowCount ?? 0
  }

  async getBackupRun(id: string): Promise<BackupRun | null> {
    const result = await this.run<BackupCatalogRow>(
      `SELECT ${backupCatalogSelectColumns}
       FROM backup_catalog
       WHERE id = $1`,
      [id],
    )

    return result.rows[0] ? this.mapRowToBackupRun(result.rows[0]) : null
  }

  async listTenantBackups(tenantId: string, limit = 50): Promise<BackupRun[]> {
    const result = await this.run<BackupCatalogRow>(
      `SELECT ${backupCatalogSelectColumns}
       FROM backup_catalog
       WHERE tenant_id = $1
       ORDER BY requested_at DESC, created_at DESC, id DESC
       LIMIT $2`,
      [tenantId, limit],
    )

    return result.rows.map((row) => this.mapRowToBackupRun(row))
  }

  async getLatestSuccessfulBackupSummaries(): Promise<Map<string, TenantBackupSummary>> {
    return this.getLatestSuccessfulBackupSummariesForTenantIds()
  }

  async getLatestSuccessfulBackupSummariesForTenantIds(
    tenantIds?: readonly string[],
  ): Promise<Map<string, TenantBackupSummary>> {
    if (tenantIds?.length === 0) {
      return new Map()
    }

    const tenantIdValues = tenantIds ? [...tenantIds] : []
    const tenantFilter = tenantIds
      ? ` AND bc.tenant_id IN (${tenantIdValues.map((_, index) => `$${index + 1}`).join(', ')})`
      : ''
    const result = await this.run<BackupCatalogRow>(
      `SELECT DISTINCT ON (bc.tenant_id) ${backupCatalogSelectColumns
        .split(',')
        .map((column) => `bc.${column.trim()}`)
        .join(', ')}
       FROM backup_catalog bc
       WHERE bc.status = 'completed'
         AND bc.location_deleted = false
       ${tenantFilter}
       ORDER BY bc.tenant_id, bc.completed_at DESC NULLS LAST, bc.id DESC`,
      tenantIdValues,
    )

    return new Map(
      result.rows.map((row) => {
        const run = this.mapRowToBackupRun(row)
        const summary: TenantBackupSummary = {
          backupId: run.id,
          location: run.location,
          lastBackupAt: run.completedAt,
          lastBackupStatus: 'succeeded',
          lastVerifiedAt: run.lastVerifiedAt,
          lastVerificationStatus: run.lastVerificationStatus,
          sizeBytes: run.sizeBytes,
          checksum: run.checksum,
        }
        return [run.tenantId, summary] as const
      }),
    )
  }

  async getLatestRestoreSummaries(): Promise<Map<string, TenantRestoreSummary>> {
    return this.getLatestRestoreSummariesForTenantIds()
  }

  async getLatestRestoreSummariesForTenantIds(
    tenantIds?: readonly string[],
  ): Promise<Map<string, TenantRestoreSummary>> {
    if (tenantIds?.length === 0) {
      return new Map()
    }

    const tenantIdValues = tenantIds ? [...tenantIds] : []
    const tenantFilter = tenantIds
      ? `WHERE rl.tenant_id IN (${tenantIdValues.map((_, index) => `$${index + 1}`).join(', ')})`
      : ''
    const result = await this.run<RestoreLogRow>(
      `SELECT DISTINCT ON (rl.tenant_id) ${restoreLogSelectColumns
        .split(',')
        .map((column) => `rl.${column.trim()}`)
        .join(', ')}
       FROM restore_log rl
       ${tenantFilter}
       ORDER BY rl.tenant_id, rl.requested_at DESC, rl.created_at DESC, rl.id DESC`,
      tenantIdValues,
    )

    return new Map(
      result.rows.map((row) => {
        const run = this.mapRowToRestoreRun(row)
        const summary: TenantRestoreSummary = {
          restoreId: run.id,
          backupId: run.backupId,
          backupLocation: run.backupLocation,
          status: run.status,
          requestedAt: run.requestedAt,
          completedAt: run.completedAt,
          failureReason: run.failureReason,
        }
        return [run.tenantId, summary] as const
      }),
    )
  }

  async createRestoreRun(params: {
    id: string
    tenantId: string
    backupId?: string | null
    backupLocation: string
    triggeredBy: string
    reason?: string | null
  }): Promise<RestoreRun> {
    const result = await this.run<RestoreLogRow>(
      `INSERT INTO restore_log (
         id, tenant_id, backup_id, backup_location, status, triggered_by, reason
       )
       VALUES ($1, $2, $3, $4, 'queued', $5, $6)
       RETURNING ${restoreLogSelectColumns}`,
      [
        params.id,
        params.tenantId,
        params.backupId ?? null,
        params.backupLocation,
        params.triggeredBy,
        params.reason ?? null,
      ],
    )
    const row = result.rows[0]

    if (!row) {
      throw new Error('Failed to retrieve created restore run')
    }

    return this.mapRowToRestoreRun(row)
  }

  async markRestoreRunRunning(id: string): Promise<RestoreRun> {
    return this.assertRestoreRunReturned(
      await this.run<RestoreLogRow>(
        `UPDATE restore_log
         SET status = 'running',
             started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING ${restoreLogSelectColumns}`,
        [id],
      ),
      id,
    )
  }

  async markRestoreRunCompleted(
    id: string,
    params: { safetySnapshotId?: string | null; completedAt?: string } = {},
  ): Promise<RestoreRun> {
    return this.assertRestoreRunReturned(
      await this.run<RestoreLogRow>(
        `UPDATE restore_log
         SET status = 'completed',
             safety_snapshot_id = COALESCE($1, safety_snapshot_id),
             completed_at = COALESCE($2::timestamptz, CURRENT_TIMESTAMP),
             failure_reason = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3
         RETURNING ${restoreLogSelectColumns}`,
        [params.safetySnapshotId ?? null, params.completedAt ?? null, id],
      ),
      id,
    )
  }

  async markRestoreRunFailed(
    id: string,
    failureReason: string,
  ): Promise<RestoreRun> {
    return this.assertRestoreRunReturned(
      await this.run<RestoreLogRow>(
        `UPDATE restore_log
         SET status = 'failed',
             failure_reason = $1,
             completed_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING ${restoreLogSelectColumns}`,
        [failureReason, id],
      ),
      id,
    )
  }

  async listTenantRestores(tenantId: string, limit = 50): Promise<RestoreRun[]> {
    const result = await this.run<RestoreLogRow>(
      `SELECT ${restoreLogSelectColumns}
       FROM restore_log
       WHERE tenant_id = $1
       ORDER BY requested_at DESC, created_at DESC, id DESC
       LIMIT $2`,
      [tenantId, limit],
    )

    return result.rows.map((row) => this.mapRowToRestoreRun(row))
  }

  async appendAuditLogEntry(params: {
    tenantId?: string | null
    actor: string
    action: string
    resourceType: string
    resourceId?: string | null
    outcome: AuditOutcome
    details?: string | null
  }): Promise<AuditLogEntry> {
    const result = await this.run<AuditLogRow>(
      `INSERT INTO control_plane_audit_log (
         tenant_id, actor, action, resource_type, resource_id, outcome, details
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${auditLogSelectColumns}`,
      [
        params.tenantId ?? null,
        params.actor,
        params.action,
        params.resourceType,
        params.resourceId ?? null,
        params.outcome,
        params.details ?? null,
      ],
    )
    const row = result.rows[0]

    if (!row) {
      throw new Error('Failed to retrieve created audit log entry')
    }

    return this.mapRowToAuditLogEntry(row)
  }

  async listTenantAuditLog(
    tenantId: string,
    limit = 100,
  ): Promise<AuditLogEntry[]> {
    const result = await this.run<AuditLogRow>(
      `SELECT ${auditLogSelectColumns}
       FROM control_plane_audit_log
       WHERE tenant_id = $1
       ORDER BY id DESC
       LIMIT $2`,
      [tenantId, limit],
    )

    return result.rows.map((row) => this.mapRowToAuditLogEntry(row))
  }

  private assertBackupRunReturned(
    result: { rows: BackupCatalogRow[] },
    id: string,
  ): BackupRun {
    const row = result.rows[0]

    if (!row) {
      throw new Error(`Backup run ${id} not found`)
    }

    return this.mapRowToBackupRun(row)
  }

  private assertRestoreRunReturned(
    result: { rows: RestoreLogRow[] },
    id: string,
  ): RestoreRun {
    const row = result.rows[0]

    if (!row) {
      throw new Error(`Restore run ${id} not found`)
    }

    return this.mapRowToRestoreRun(row)
  }

  private mapRowToBackupRun(row: BackupCatalogRow): BackupRun {
    if (!backupRunStatuses.includes(row.status)) {
      throw new Error(`Unexpected backup run status: ${row.status}`)
    }

    return {
      id: row.id,
      tenantId: row.tenant_id,
      status: row.status,
      format: row.format,
      location: row.location ?? null,
      locationDeleted: row.location_deleted === true,
      sizeBytes:
        row.size_bytes === null || row.size_bytes === undefined
          ? null
          : Number(row.size_bytes),
      checksum: row.checksum ?? null,
      failureReason: row.failure_reason ?? null,
      triggeredBy: row.triggered_by,
      reason: row.reason ?? null,
      requestedAt: normalizeTimestamp(row.requested_at),
      startedAt: row.started_at ? normalizeTimestamp(row.started_at) : null,
      completedAt: row.completed_at
        ? normalizeTimestamp(row.completed_at)
        : null,
      lastVerifiedAt: row.last_verified_at
        ? normalizeTimestamp(row.last_verified_at)
        : null,
      lastVerificationStatus: row.last_verification_status ?? null,
      lastVerificationDetails: row.last_verification_details ?? null,
      scratchTarget: row.scratch_target ?? null,
      createdAt: normalizeTimestamp(row.created_at),
      updatedAt: normalizeTimestamp(row.updated_at),
    }
  }

  private mapRowToRestoreRun(row: RestoreLogRow): RestoreRun {
    if (!backupRunStatuses.includes(row.status)) {
      throw new Error(`Unexpected restore run status: ${row.status}`)
    }

    return {
      id: row.id,
      tenantId: row.tenant_id,
      backupId: row.backup_id ?? null,
      backupLocation: row.backup_location,
      status: row.status,
      failureReason: row.failure_reason ?? null,
      safetySnapshotId: row.safety_snapshot_id ?? null,
      triggeredBy: row.triggered_by,
      reason: row.reason ?? null,
      requestedAt: normalizeTimestamp(row.requested_at),
      startedAt: row.started_at ? normalizeTimestamp(row.started_at) : null,
      completedAt: row.completed_at
        ? normalizeTimestamp(row.completed_at)
        : null,
      createdAt: normalizeTimestamp(row.created_at),
      updatedAt: normalizeTimestamp(row.updated_at),
    }
  }

  private mapRowToAuditLogEntry(row: AuditLogRow): AuditLogEntry {
    return {
      id: String(row.id),
      tenantId: row.tenant_id ?? null,
      actor: row.actor,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id ?? null,
      outcome: row.outcome,
      details: row.details ?? null,
      createdAt: normalizeTimestamp(row.created_at),
    }
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
      createdAt: normalizeTimestamp(row.created_at),
      updatedAt: normalizeTimestamp(row.updated_at),
    }
  }

  private mapRowToTenantStorageSnapshot(row: TenantStorageRow): TenantStorageSnapshot {
    return {
      tenantId: row.id,
      currentState: row.current_state,
      desiredState: row.desired_state,
      storageReference: row.storage_reference ?? null,
      mode: row.storage_mode,
      migrationStatus: row.storage_migration_status,
      lastMigrationFailure: row.storage_migration_failure_reason ?? null,
      migrationUpdatedAt: row.storage_migration_updated_at
        ? normalizeTimestamp(row.storage_migration_updated_at)
        : null,
    }
  }

  private mapRowToPortalAccount(row: PortalAccountRow): PortalAccount {
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      billingEmail: row.billing_email ?? null,
      billingProvider: row.billing_provider ?? null,
      keycloakSub: row.keycloak_sub ?? null,
      roleSyncStatus: row.role_sync_status ?? 'complete',
      createdAt: normalizeTimestamp(row.created_at),
      updatedAt: normalizeTimestamp(row.updated_at),
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

    if (this.ownsPool) {
      await this.pool.end()
    }
  }

}

/**
 * Fleet rolling-update orchestrator (#415).
 *
 * Advisory-lock key reservation:
 *   (0, 1) is reserved exclusively for the fleet-rollout orchestrator.
 *   Existing tenant-level locks use namespace 101 (see tenant-registry-postgres.ts).
 *   Migration lock keys are 930 and 931 (see migrations.ts).
 *
 * Design decisions:
 * - The advisory lock is held on a DEDICATED pool connection for the entire
 *   rollout lifetime (not via withTenantLock, which would return the connection
 *   to the pool between calls). This prevents concurrent rollouts and avoids
 *   lock-loss between tenant provisions.
 * - pg_try_advisory_lock is used (not pg_advisory_lock) so the start endpoint
 *   returns 409 immediately instead of blocking.
 * - The orchestrator runs as a fire-and-forget async task. POST /internal/fleet/rollout
 *   returns 201 once the row is inserted and the lock is acquired.
 * - triggered_by is taken from the request body to match the pattern of
 *   POST /internal/tenants/:id/provision (which also takes triggeredBy in the body).
 *   The internal admin middleware does not attach Keycloak claims, so reading from
 *   auth context would require a larger refactor with no real security gain.
 * - skipSleeping default is true (spec requirement): sleeping tenants are skipped
 *   by default during a version bump (they pick up the new version on next wake).
 * - Between tenants the abort flag is re-read from the DB. The tenant currently
 *   mid-provision finishes normally (provision cannot be safely interrupted).
 * - On any per-tenant provision failure the rollout halts immediately (no auto-retry,
 *   no auto-skip) per spec.
 * - Process-restart safety: on boot, call markOrphanRunningRolloutsFailed() to
 *   finalize any rollout row that was running when the process died. The advisory
 *   lock is session-scoped and dies with the process, so no manual unlock is needed
 *   before the next rollout can start. The 60-second grace window is defensive —
 *   in practice there is no race on a fresh boot, but it avoids prematurely killing
 *   a rollout started in the same process within the grace window.
 */

import { randomBytes } from 'node:crypto'
import { formatUnknownError } from './error-formatting.js'
import type {
  TenantRegistryPoolLike,
  TenantRegistryClientLike,
} from './tenant-registry.js'
import type { TenantProvisioningPort } from './provisioning.js'
import type {
  FleetRollout,
  FleetRolloutStatus,
} from './types.js'

// ---------------------------------------------------------------------------
// Lock key
// ---------------------------------------------------------------------------

/**
 * Stable advisory-lock key pair for the fleet-rollout orchestrator.
 * Key (0, 1): namespace 0, resource 1.
 * Do not reuse this key anywhere else in the control-plane.
 */
const FLEET_ROLLOUT_LOCK_KEY = [0, 1] as const

// ---------------------------------------------------------------------------
// DB row shapes
// ---------------------------------------------------------------------------

interface FleetRolloutRow {
  id: string
  target_version: string
  status: FleetRolloutStatus
  triggered_by: string
  started_at: Date | string
  ended_at: Date | string | null
  abort_reason: string | null
  failed_tenant: string | null
  failed_error: string | null
}

interface RolloutCountsRow {
  total: string
  completed: string
  failed: string
  skipped: string
  pending: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toIsoString(d: Date | string | null | undefined): string | null {
  if (d == null) return null
  if (d instanceof Date) return d.toISOString()
  return d
}

function mapRolloutRow(
  row: FleetRolloutRow,
  counts: RolloutCountsRow,
  currentTenant: string | null,
): FleetRollout {
  const startedAt = toIsoString(row.started_at) ?? new Date().toISOString()
  const endedAt = toIsoString(row.ended_at)

  const startMs = new Date(startedAt).getTime()
  const endMs = endedAt != null ? new Date(endedAt).getTime() : Date.now()
  const elapsedSeconds = Math.round((endMs - startMs) / 1000)

  return {
    id: row.id,
    targetVersion: row.target_version,
    status: row.status,
    triggeredBy: row.triggered_by,
    startedAt,
    endedAt,
    abortReason: row.abort_reason,
    failedTenant: row.failed_tenant,
    failedError: row.failed_error,
    total: Number(counts.total),
    completed: Number(counts.completed),
    failed: Number(counts.failed),
    skipped: Number(counts.skipped),
    pending: Number(counts.pending),
    currentTenant,
    elapsedSeconds,
  }
}

// ---------------------------------------------------------------------------
// Rollout ID generation
// ---------------------------------------------------------------------------

function generateRolloutId(): string {
  return `rl_${randomBytes(8).toString('hex')}`
}

// ---------------------------------------------------------------------------
// Orchestrator port — the provisioning service we delegate to
// ---------------------------------------------------------------------------

export interface FleetRolloutPort {
  pool: TenantRegistryPoolLike
  provisioningService: TenantProvisioningPort
}

// ---------------------------------------------------------------------------
// Core orchestrator function (internal, fire-and-forget)
// ---------------------------------------------------------------------------

async function runRollout(params: {
  rolloutId: string
  targetVersion: string
  triggeredBy: string
  tenantIds: string[]
  client: TenantRegistryClientLike
  pool: TenantRegistryPoolLike
  provisioningService: TenantProvisioningPort
}): Promise<void> {
  const {
    rolloutId,
    targetVersion,
    triggeredBy,
    tenantIds,
    pool,
    provisioningService,
  } = params

  let currentTenantId: string | null = null

  try {
    for (const tenantId of tenantIds) {
      // Between tenants, re-read the rollout row to check the abort flag.
      const abortCheck = await pool.query<{ abort_reason: string | null; status: string }>(
        `SELECT abort_reason, status FROM fleet_rollouts WHERE id = $1`,
        [rolloutId],
      )
      const rolloutRow = abortCheck.rows[0]

      if (!rolloutRow) {
        // Row disappeared — treat as fatal.
        throw new Error(`Rollout row ${rolloutId} disappeared mid-run`)
      }

      // If an abort was requested between tenants, mark remaining pending tenants
      // as skipped and finalize the rollout as aborted.
      if (rolloutRow.abort_reason != null) {
        await markRemainingTenantsSkipped(pool, rolloutId, tenantId, tenantIds, 'aborted')
        await finalizeRollout(pool, rolloutId, 'aborted', {})
        return
      }

      // Mark this tenant as started.
      currentTenantId = tenantId
      await pool.query(
        `UPDATE fleet_rollout_tenants
         SET started_at = NOW()
         WHERE rollout_id = $1 AND tenant_id = $2`,
        [rolloutId, tenantId],
      )

      try {
        await provisioningService.provisionTenant({
          tenantId,
          triggeredBy: `fleet-rollout:${rolloutId}:${triggeredBy}`,
          reason: `Fleet rolling update to version ${targetVersion} (rollout ${rolloutId})`,
          version: targetVersion,
        })
      } catch (error) {
        // Per-tenant failure: mark tenant failed, halt rollout.
        const errorMessage = formatUnknownError(error)
        await pool.query(
          `UPDATE fleet_rollout_tenants
           SET status = 'failed', reason = $1, ended_at = NOW()
           WHERE rollout_id = $2 AND tenant_id = $3`,
          [errorMessage, rolloutId, tenantId],
        )
        await finalizeRollout(pool, rolloutId, 'failed', {
          failedTenant: tenantId,
          failedError: errorMessage,
        })
        currentTenantId = null
        return
      }

      // Tenant succeeded.
      await pool.query(
        `UPDATE fleet_rollout_tenants
         SET status = 'succeeded', ended_at = NOW()
         WHERE rollout_id = $1 AND tenant_id = $2`,
        [rolloutId, tenantId],
      )
      currentTenantId = null
    }

    // All tenants processed — complete the rollout.
    await finalizeRollout(pool, rolloutId, 'completed', {})
  } catch (error) {
    // Unexpected error from the orchestrator itself (e.g. DB failure, lock lost).
    const errorMessage = formatUnknownError(error)
    console.error(
      `[fleet-rollout] Unexpected orchestrator error for rollout ${rolloutId}:`,
      error,
    )
    try {
      await finalizeRollout(pool, rolloutId, 'failed', {
        failedTenant: currentTenantId ?? undefined,
        failedError: errorMessage,
      })
    } catch (finalizeError) {
      console.error(
        `[fleet-rollout] Failed to finalize rollout ${rolloutId} after error:`,
        finalizeError,
      )
    }
  } finally {
    // Release the fleet advisory lock and return the connection to the pool.
    try {
      await params.client.query(
        `SELECT pg_advisory_unlock($1::integer, $2::integer)`,
        FLEET_ROLLOUT_LOCK_KEY,
      )
    } catch (unlockError) {
      console.error(
        `[fleet-rollout] Failed to release advisory lock for rollout ${rolloutId}:`,
        unlockError,
      )
    }
    params.client.release()
  }
}

async function markRemainingTenantsSkipped(
  pool: TenantRegistryPoolLike,
  rolloutId: string,
  fromTenantId: string,
  allTenantIds: string[],
  reason: string,
): Promise<void> {
  const idx = allTenantIds.indexOf(fromTenantId)
  const remaining = idx >= 0 ? allTenantIds.slice(idx) : []

  if (remaining.length === 0) return

  // Use parameterized ANY() — pg-mem does not have unnest support, but
  // the real Postgres path uses direct $1, $2, ... which gets unwieldy.
  // Use individual UPDATEs to remain pg-mem compatible.
  for (const tenantId of remaining) {
    await pool.query(
      `UPDATE fleet_rollout_tenants
       SET status = 'skipped', reason = $1, ended_at = NOW()
       WHERE rollout_id = $2 AND tenant_id = $3 AND status = 'pending'`,
      [reason, rolloutId, tenantId],
    )
  }
}

async function finalizeRollout(
  pool: TenantRegistryPoolLike,
  rolloutId: string,
  status: FleetRolloutStatus,
  opts: {
    failedTenant?: string | null
    failedError?: string | null
  },
): Promise<void> {
  await pool.query(
    `UPDATE fleet_rollouts
     SET status = $1, ended_at = NOW(),
         failed_tenant = COALESCE($2::text, failed_tenant),
         failed_error  = COALESCE($3::text, failed_error)
     WHERE id = $4`,
    [
      status,
      opts.failedTenant ?? null,
      opts.failedError ?? null,
      rolloutId,
    ],
  )
}

// ---------------------------------------------------------------------------
// Exported surface
// ---------------------------------------------------------------------------

export class FleetRolloutAlreadyRunningError extends Error {
  readonly name = 'FleetRolloutAlreadyRunningError'
  constructor() {
    super('A fleet rollout is already running.')
  }
}

export class FleetRolloutAlreadyEndedError extends Error {
  readonly name = 'FleetRolloutAlreadyEndedError'
  constructor(rolloutId: string) {
    super(`Fleet rollout ${rolloutId} has already ended.`)
  }
}

export class FleetRolloutNotFoundError extends Error {
  readonly name = 'FleetRolloutNotFoundError'
  constructor(rolloutId: string) {
    super(`Fleet rollout ${rolloutId} not found.`)
  }
}

/**
 * Start a new fleet rolling update.
 *
 * Acquires the fleet advisory lock on a dedicated DB client (never returned
 * to the pool until the rollout finishes). If the lock is already held, throws
 * FleetRolloutAlreadyRunningError (mapped to 409 by the caller).
 *
 * Returns immediately after the rollout row + tenant rows are inserted.
 * The orchestrator continues as a background async task.
 */
export async function startFleetRollout(params: {
  pool: TenantRegistryPoolLike
  provisioningService: TenantProvisioningPort
  targetVersion: string
  triggeredBy: string
  skipSleeping?: boolean
}): Promise<{ id: string; status: FleetRolloutStatus; startedAt: string }> {
  const skipSleeping = params.skipSleeping ?? true
  const rolloutId = generateRolloutId()

  // Acquire a dedicated connection for the lock + orchestrator lifetime.
  const client = await params.pool.connect()

  try {
    // Use pg_try_advisory_lock for fail-fast semantics.
    const lockResult = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock($1::integer, $2::integer) AS locked`,
      FLEET_ROLLOUT_LOCK_KEY,
    )

    if (!lockResult.rows[0]?.locked) {
      client.release()
      throw new FleetRolloutAlreadyRunningError()
    }

    // Fetch all tenants and snapshot their eligibility.
    const allTenantsResult = await params.pool.query<{
      id: string
      slug: string
      current_state: string
    }>(
      `SELECT id, slug, current_state FROM tenants ORDER BY created_at ASC`,
    )

    const allTenants = allTenantsResult.rows

    // Determine which tenants will be processed vs. ineligible at snapshot time.
    const eligibleTenantIds: string[] = []
    const ineligibleTenants: Array<{ id: string; reason: string }> = []

    for (const tenant of allTenants) {
      const state = tenant.current_state

      // Determine eligibility based on current state.
      const isSleeping = state === 'sleeping'
      const isReady = state === 'ready'

      if (isReady || (isSleeping && !skipSleeping)) {
        eligibleTenantIds.push(tenant.id)
      } else if (isSleeping && skipSleeping) {
        ineligibleTenants.push({ id: tenant.id, reason: 'sleeping (skipped by policy)' })
      } else {
        ineligibleTenants.push({ id: tenant.id, reason: `ineligible state: ${state}` })
      }
    }

    // Insert the rollout row.
    const insertResult = await params.pool.query<{ started_at: Date }>(
      `INSERT INTO fleet_rollouts
         (id, target_version, status, triggered_by, started_at)
       VALUES ($1, $2, 'running', $3, NOW())
       RETURNING started_at`,
      [rolloutId, params.targetVersion, params.triggeredBy],
    )

    const startedAt =
      insertResult.rows[0]?.started_at instanceof Date
        ? insertResult.rows[0].started_at.toISOString()
        : String(insertResult.rows[0]?.started_at ?? new Date().toISOString())

    // Insert pending rows for eligible tenants.
    for (const tenantId of eligibleTenantIds) {
      await params.pool.query(
        `INSERT INTO fleet_rollout_tenants
           (rollout_id, tenant_id, status)
         VALUES ($1, $2, 'pending')`,
        [rolloutId, tenantId],
      )
    }

    // Insert skipped rows for ineligible tenants.
    for (const { id: tenantId, reason } of ineligibleTenants) {
      await params.pool.query(
        `INSERT INTO fleet_rollout_tenants
           (rollout_id, tenant_id, status, reason, ended_at)
         VALUES ($1, $2, 'skipped', $3, NOW())`,
        [rolloutId, tenantId, reason],
      )
    }

    // If there are no eligible tenants, finalize immediately (no background task needed).
    if (eligibleTenantIds.length === 0) {
      await finalizeRollout(params.pool, rolloutId, 'completed', {})
      // Release lock and client immediately.
      await client.query(
        `SELECT pg_advisory_unlock($1::integer, $2::integer)`,
        FLEET_ROLLOUT_LOCK_KEY,
      )
      client.release()
      return { id: rolloutId, status: 'completed', startedAt }
    }

    // Fire-and-forget: the orchestrator owns the client and will release it when done.
    void runRollout({
      rolloutId,
      targetVersion: params.targetVersion,
      triggeredBy: params.triggeredBy,
      tenantIds: eligibleTenantIds,
      client,
      pool: params.pool,
      provisioningService: params.provisioningService,
    }).catch((unexpectedError) => {
      // Belt-and-suspenders: runRollout has its own try/finally, so this should
      // only fire on an unhandled rejection from the finalizer itself.
      console.error(
        `[fleet-rollout] Unhandled rejection from orchestrator for rollout ${rolloutId}:`,
        unexpectedError,
      )
    })

    return { id: rolloutId, status: 'running', startedAt }
  } catch (error) {
    // If anything after the lock acquisition fails synchronously (e.g. INSERT fails),
    // we may still hold the lock. Attempt to release it before re-throwing.
    if (!(error instanceof FleetRolloutAlreadyRunningError)) {
      try {
        await client.query(
          `SELECT pg_advisory_unlock($1::integer, $2::integer)`,
          FLEET_ROLLOUT_LOCK_KEY,
        )
      } catch {
        // Best-effort; if unlock fails the lock dies with the session.
      }
      client.release()
    }
    throw error
  }
}

/**
 * Get the current (running) fleet rollout, or null if none is active.
 */
export async function getCurrentFleetRollout(
  pool: TenantRegistryPoolLike,
): Promise<FleetRollout | null> {
  const result = await pool.query<FleetRolloutRow>(
    `SELECT id, target_version, status, triggered_by, started_at,
            ended_at, abort_reason, failed_tenant, failed_error
     FROM fleet_rollouts
     WHERE status = 'running'
     ORDER BY started_at DESC
     LIMIT 1`,
  )

  const row = result.rows[0]
  if (!row) return null

  return buildRolloutWithCounts(pool, row)
}

/**
 * Get a specific fleet rollout by ID (historical snapshot).
 */
export async function getFleetRollout(
  pool: TenantRegistryPoolLike,
  rolloutId: string,
): Promise<FleetRollout | null> {
  const result = await pool.query<FleetRolloutRow>(
    `SELECT id, target_version, status, triggered_by, started_at,
            ended_at, abort_reason, failed_tenant, failed_error
     FROM fleet_rollouts
     WHERE id = $1`,
    [rolloutId],
  )

  const row = result.rows[0]
  if (!row) return null

  return buildRolloutWithCounts(pool, row)
}

async function buildRolloutWithCounts(
  pool: TenantRegistryPoolLike,
  row: FleetRolloutRow,
): Promise<FleetRollout> {
  const [countsResult, currentResult] = await Promise.all([
    pool.query<RolloutCountsRow>(
      `SELECT
         COUNT(*)                                                             AS total,
         SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END)              AS completed,
         SUM(CASE WHEN status = 'failed'    THEN 1 ELSE 0 END)              AS failed,
         SUM(CASE WHEN status = 'skipped'   THEN 1 ELSE 0 END)              AS skipped,
         SUM(CASE WHEN status = 'pending'   THEN 1 ELSE 0 END)              AS pending
       FROM fleet_rollout_tenants
       WHERE rollout_id = $1`,
      [row.id],
    ),
    pool.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM fleet_rollout_tenants
       WHERE rollout_id = $1 AND started_at IS NOT NULL AND ended_at IS NULL
       LIMIT 1`,
      [row.id],
    ),
  ])

  const counts = countsResult.rows[0] ?? {
    total: '0',
    completed: '0',
    failed: '0',
    skipped: '0',
    pending: '0',
  }
  const currentTenant = currentResult.rows[0]?.tenant_id ?? null

  return mapRolloutRow(row, counts, currentTenant)
}

/**
 * Request abort of an active fleet rollout.
 * Sets abort_reason on the rollout row. The orchestrator will read this flag
 * between tenant provisions and finalize the rollout as 'aborted'.
 *
 * Throws FleetRolloutNotFoundError if the rollout does not exist.
 * Throws FleetRolloutAlreadyEndedError if the rollout has already ended.
 */
export async function abortFleetRollout(
  pool: TenantRegistryPoolLike,
  rolloutId: string,
  reason: string | null,
): Promise<void> {
  const existing = await pool.query<{ status: FleetRolloutStatus }>(
    `SELECT status FROM fleet_rollouts WHERE id = $1`,
    [rolloutId],
  )

  if (!existing.rows[0]) {
    throw new FleetRolloutNotFoundError(rolloutId)
  }

  const currentStatus = existing.rows[0].status

  if (currentStatus !== 'running') {
    throw new FleetRolloutAlreadyEndedError(rolloutId)
  }

  await pool.query(
    `UPDATE fleet_rollouts
     SET abort_reason = $1
     WHERE id = $2 AND status = 'running'`,
    [reason ?? 'Aborted by operator', rolloutId],
  )
}

/**
 * Called on control-plane startup to mark any rollout rows stuck in 'running'
 * as 'failed'. This handles the case where the process was killed mid-rollout.
 *
 * The advisory lock is session-scoped and dies with the process, so a follow-up
 * rollout can be started immediately after this cleanup runs.
 *
 * The 60-second grace window (gracePeriodSeconds, default 60) is defensive:
 * it avoids marking a rollout started in the same process restart window as
 * failed before its orchestrator has had a chance to run. In practice, on a
 * fresh boot, no orchestrator is alive, so the grace window is rarely relevant.
 * V1 trade-off: there is no resume logic. Tenants that were 'pending' will need
 * to be re-rolled via a new rollout invocation.
 */
export async function markOrphanRunningRolloutsFailed(
  pool: TenantRegistryPoolLike,
  gracePeriodSeconds = 60,
): Promise<number> {
  const result = await pool.query<{ id: string }>(
    `UPDATE fleet_rollouts
     SET status = 'failed',
         ended_at = NOW(),
         failed_error = 'control-plane restart'
     WHERE status = 'running'
       AND started_at < NOW() - ($1 || ' seconds')::interval
     RETURNING id`,
    [String(gracePeriodSeconds)],
  )

  if (result.rows.length > 0) {
    console.warn(
      `[fleet-rollout] Marked ${result.rows.length} orphaned running rollout(s) as failed on startup: ${result.rows.map((r) => r.id).join(', ')}`,
    )
  }

  return result.rows.length
}

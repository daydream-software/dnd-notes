/**
 * Tests for the fleet rolling-update orchestrator (#415).
 *
 * Uses pg-mem for all DB operations.
 *
 * pg-mem limitations to be aware of:
 * - Partial indexes (WHERE status = 'running') are not supported; the migration
 *   SQL is rewritten to drop the WHERE clause in tests.
 * - pg_try_advisory_lock / pg_advisory_unlock must be registered as custom functions.
 * - FILTER (WHERE ...) in COUNT() is not supported in older pg-mem; replaced with
 *   CASE WHEN ... equivalents in test-only queries.
 */

import assert from 'node:assert/strict'
import { describe, it, beforeEach } from 'node:test'
import { DataType, newDb } from 'pg-mem'
import {
  startFleetRollout,
  getCurrentFleetRollout,
  getFleetRollout,
  abortFleetRollout,
  markOrphanRunningRolloutsFailed,
  FleetRolloutAlreadyRunningError,
  FleetRolloutAlreadyEndedError,
  FleetRolloutNotFoundError,
} from '../src/fleet-rollout-orchestrator.js'
import {
  rewriteSqlForPgMem,
  registerPgMemTenantRegistrySupport,
} from './tenant-registry-test-helpers.js'
import type { TenantRegistryPoolLike } from '../src/tenant-registry.js'
import { runControlPlaneMigrations } from '../src/migrations.js'

// ---------------------------------------------------------------------------
// pg-mem SQL rewriter for fleet rollout tables
// ---------------------------------------------------------------------------

/**
 * Extend the existing pg-mem SQL rewriter to strip the partial-index WHERE
 * clause from the fleet_rollouts migration (pg-mem does not support it).
 */
function rewriteFleetRolloutSqlForPgMem(sql: string): string {
  return rewriteSqlForPgMem(sql)
    .replace(
      // Remove the WHERE clause from the partial index definition.
      /CREATE INDEX fleet_rollouts_status_running ON fleet_rollouts \(status\) WHERE status = 'running'/gi,
      `CREATE INDEX fleet_rollouts_status_running ON fleet_rollouts (status)`,
    )
}

// ---------------------------------------------------------------------------
// Test pool factory
// ---------------------------------------------------------------------------

interface TestFleetPool {
  pool: TenantRegistryPoolLike
  cleanup: () => Promise<void>
  /**
   * Override the advisory-lock result for the next call.
   * null = reset (always return true).
   */
  setNextLockResult: (result: boolean) => void
  rawPool: ReturnType<ReturnType<typeof newDb>['adapters']['createPg']>['Pool']
}

function createTestFleetPool(): TestFleetPool {
  let nextLockResult: boolean | null = null
  let advisoryLocked = false

  const db = newDb({ autoCreateForeignKeyIndices: true })

  // Register advisory lock functions that track state.
  db.public.registerFunction({
    name: 'pg_try_advisory_lock',
    args: [DataType.integer, DataType.integer],
    returns: DataType.bool,
    implementation: () => {
      if (nextLockResult !== null) {
        const result = nextLockResult
        nextLockResult = null
        if (result) advisoryLocked = true
        return result
      }
      if (advisoryLocked) return false
      advisoryLocked = true
      return true
    },
  })
  db.public.registerFunction({
    name: 'pg_advisory_unlock',
    args: [DataType.integer, DataType.integer],
    returns: DataType.bool,
    implementation: () => {
      advisoryLocked = false
      return true
    },
  })

  registerPgMemTenantRegistrySupport(db, {
    // Override the default try-lock to use our state tracker.
    tryAdvisoryLockImpl: () => {
      if (advisoryLocked) return false
      advisoryLocked = true
      return true
    },
    advisoryUnlockImpl: () => {
      advisoryLocked = false
      return true
    },
  })

  const { Pool } = db.adapters.createPg()
  const rawPool = new Pool()

  const wrappedPool = wrapPoolWithFleetRewriter(rawPool)

  return {
    pool: wrappedPool,
    rawPool: rawPool as unknown as ReturnType<ReturnType<typeof newDb>['adapters']['createPg']>['Pool'],
    async cleanup() {
      await rawPool.end()
    },
    setNextLockResult(result: boolean) {
      nextLockResult = result
    },
  }
}

/**
 * Wrap a pool to apply both the standard pg-mem rewrites and the fleet
 * rollout-specific rewrites (partial index stripping).
 */
function wrapPoolWithFleetRewriter(pool: TenantRegistryPoolLike): TenantRegistryPoolLike {
  return {
    async query(text: string, values?: readonly unknown[]) {
      return pool.query(rewriteFleetRolloutSqlForPgMem(text), values)
    },
    async connect() {
      const client = await pool.connect()
      return {
        query(text: string, values?: readonly unknown[]) {
          return client.query(rewriteFleetRolloutSqlForPgMem(text), values)
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
}

// ---------------------------------------------------------------------------
// Migration helper
// ---------------------------------------------------------------------------

async function runMigrationsOnPool(pool: TenantRegistryPoolLike): Promise<void> {
  await runControlPlaneMigrations({ pool })
}

// ---------------------------------------------------------------------------
// Stub provision service
// ---------------------------------------------------------------------------

interface ProvisionCall {
  tenantId: string
  version: string
}

function createStubProvisioningService(opts: {
  /**
   * Map of tenantId -> error to throw on provision (undefined = succeed).
   */
  failOn?: Map<string, Error>
  /**
   * Callback invoked when provision is called.
   */
  onCall?: (call: ProvisionCall) => void | Promise<void>
}) {
  const calls: ProvisionCall[] = []

  return {
    calls,
    service: {
      async provisionTenant(params: {
        tenantId: string
        triggeredBy: string
        reason?: string
        version?: string
      }) {
        const call: ProvisionCall = {
          tenantId: params.tenantId,
          version: params.version ?? '',
        }
        calls.push(call)
        await opts.onCall?.(call)

        const err = opts.failOn?.get(params.tenantId)
        if (err) throw err

        return {
          tenant: { id: params.tenantId, slug: params.tenantId } as never,
          resources: {} as never,
        }
      },
      deprovisionTenant: async () => { throw new Error('not implemented') },
      getTenantResources: () => { throw new Error('not implemented') },
      close: async () => {},
    },
  }
}

// ---------------------------------------------------------------------------
// Seed helper: insert tenant rows directly
// ---------------------------------------------------------------------------

async function seedTenants(
  pool: TenantRegistryPoolLike,
  tenants: Array<{ id: string; state: string }>,
): Promise<void> {
  for (const t of tenants) {
    await pool.query(
      `INSERT INTO tenants (id, slug, owner_id, desired_state, current_state, version, created_at, updated_at)
       VALUES ($1, $2, 'owner', $3, $4, '1.0.0', NOW(), NOW())`,
      [t.id, t.id, t.state, t.state],
    )
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fleet-rollout migration', () => {
  it('creates fleet_rollouts and fleet_rollout_tenants tables', async () => {
    const { pool, cleanup } = createTestFleetPool()

    try {
      await runMigrationsOnPool(pool)

      // Verify tables exist by querying each directly.
      const rolloutResult = await pool.query(
        `SELECT id FROM fleet_rollouts WHERE 1=0`,
      )
      assert.ok(rolloutResult, 'fleet_rollouts table should be queryable')

      const tenantResult = await pool.query(
        `SELECT rollout_id FROM fleet_rollout_tenants WHERE 1=0`,
      )
      assert.ok(tenantResult, 'fleet_rollout_tenants table should be queryable')
    } finally {
      await cleanup()
    }
  })
})

describe('startFleetRollout', () => {
  let pool: TenantRegistryPoolLike
  let setNextLockResult: (r: boolean) => void
  let doCleanup: () => Promise<void>

  beforeEach(async () => {
    const ctx = createTestFleetPool()
    pool = ctx.pool
    setNextLockResult = ctx.setNextLockResult
    doCleanup = ctx.cleanup
    await runMigrationsOnPool(pool)
  })

  it('returns 201 shape with running rollout when tenants are present', async () => {
    await seedTenants(pool, [
      { id: 'tenant-a', state: 'ready' },
      { id: 'tenant-b', state: 'ready' },
    ])

    const stub = createStubProvisioningService({})

    const result = await startFleetRollout({
      pool,
      provisioningService: stub.service,
      targetVersion: '2.0.0',
      triggeredBy: 'operator-1',
    })

    assert.match(result.id, /^rl_/)
    assert.equal(result.status, 'running')
    assert.ok(result.startedAt)

    await doCleanup()
  })

  it('throws FleetRolloutAlreadyRunningError if lock cannot be acquired', async () => {
    await seedTenants(pool, [{ id: 'tenant-a', state: 'ready' }])

    const stub = createStubProvisioningService({})

    // Start the first rollout (which fires off the orchestrator in background).
    await startFleetRollout({
      pool,
      provisioningService: stub.service,
      targetVersion: '2.0.0',
      triggeredBy: 'operator-1',
    })

    // Force the next lock attempt to fail (simulate already locked).
    setNextLockResult(false)

    await assert.rejects(
      () =>
        startFleetRollout({
          pool,
          provisioningService: stub.service,
          targetVersion: '2.0.0',
          triggeredBy: 'operator-2',
        }),
      FleetRolloutAlreadyRunningError,
    )

    await doCleanup()
  })

  it('skips sleeping tenants by default (skipSleeping=true)', async () => {
    await seedTenants(pool, [
      { id: 'tenant-ready', state: 'ready' },
      { id: 'tenant-sleeping', state: 'sleeping' },
    ])

    const stub = createStubProvisioningService({})

    await startFleetRollout({
      pool,
      provisioningService: stub.service,
      targetVersion: '2.0.0',
      triggeredBy: 'operator-1',
    })

    // Check snapshot: sleeping tenant should be skipped.
    const tenantsResult = await pool.query<{ tenant_id: string; status: string }>(
      `SELECT tenant_id, status FROM fleet_rollout_tenants ORDER BY tenant_id`,
    )
    const byId = Object.fromEntries(tenantsResult.rows.map((r) => [r.tenant_id, r.status]))
    assert.equal(byId['tenant-ready'], 'pending')
    assert.equal(byId['tenant-sleeping'], 'skipped')

    await doCleanup()
  })

  it('includes sleeping tenants when skipSleeping=false', async () => {
    await seedTenants(pool, [
      { id: 'tenant-ready', state: 'ready' },
      { id: 'tenant-sleeping', state: 'sleeping' },
    ])

    const stub = createStubProvisioningService({})

    await startFleetRollout({
      pool,
      provisioningService: stub.service,
      targetVersion: '2.0.0',
      triggeredBy: 'operator-1',
      skipSleeping: false,
    })

    const tenantsResult = await pool.query<{ tenant_id: string; status: string }>(
      `SELECT tenant_id, status FROM fleet_rollout_tenants ORDER BY tenant_id`,
    )
    const byId = Object.fromEntries(tenantsResult.rows.map((r) => [r.tenant_id, r.status]))
    // Both should be pending (sleeping not skipped).
    assert.equal(byId['tenant-ready'], 'pending')
    assert.equal(byId['tenant-sleeping'], 'pending')

    await doCleanup()
  })

  it('skips ineligible states (provisioning, failed, deprovisioned, etc.)', async () => {
    await seedTenants(pool, [
      { id: 'tenant-ready', state: 'ready' },
      { id: 'tenant-provisioning', state: 'provisioning' },
      { id: 'tenant-failed', state: 'failed' },
      { id: 'tenant-deprovisioned', state: 'deprovisioned' },
      { id: 'tenant-upgrading', state: 'upgrading' },
      { id: 'tenant-maintenance', state: 'maintenance' },
    ])

    const stub = createStubProvisioningService({})

    await startFleetRollout({
      pool,
      provisioningService: stub.service,
      targetVersion: '2.0.0',
      triggeredBy: 'operator-1',
    })

    const tenantsResult = await pool.query<{ tenant_id: string; status: string }>(
      `SELECT tenant_id, status FROM fleet_rollout_tenants ORDER BY tenant_id`,
    )
    const byId = Object.fromEntries(tenantsResult.rows.map((r) => [r.tenant_id, r.status]))
    assert.equal(byId['tenant-ready'], 'pending')
    assert.equal(byId['tenant-provisioning'], 'skipped')
    assert.equal(byId['tenant-failed'], 'skipped')
    assert.equal(byId['tenant-deprovisioned'], 'skipped')
    assert.equal(byId['tenant-upgrading'], 'skipped')
    assert.equal(byId['tenant-maintenance'], 'skipped')

    await doCleanup()
  })

  it('completes immediately and returns completed status when no eligible tenants', async () => {
    await seedTenants(pool, [
      { id: 'tenant-sleeping', state: 'sleeping' },
      { id: 'tenant-failed', state: 'failed' },
    ])

    const stub = createStubProvisioningService({})

    const result = await startFleetRollout({
      pool,
      provisioningService: stub.service,
      targetVersion: '2.0.0',
      triggeredBy: 'operator-1',
      skipSleeping: true,
    })

    assert.equal(result.status, 'completed')

    await doCleanup()
  })
})

describe('abort semantics (integration)', () => {
  it('marks remaining tenants skipped and rollout aborted when abort is requested between tenants', async () => {
    const { pool, cleanup } = createTestFleetPool()

    try {
      await runMigrationsOnPool(pool)

      // Use a single sleeping tenant that would normally be skipped by default
      // — but with skipSleeping=false, so it's eligible.
      // We seed only 2 tenants: the first will succeed and then we abort.
      // Using a deterministic insertion order so the first provision call is
      // predictable — we seed both with the same state but rely on abort-after-first.
      await seedTenants(pool, [
        { id: 'tenant-abort-a', state: 'ready' },
        { id: 'tenant-abort-b', state: 'ready' },
      ])

      let callCount = 0
      let rolloutId: string | null = null

      // After the first tenant succeeds, abort the rollout (by directly updating the DB).
      const stub = createStubProvisioningService({
        onCall: async () => {
          callCount += 1
          if (callCount === 1 && rolloutId) {
            await pool.query(
              `UPDATE fleet_rollouts SET abort_reason = 'test abort' WHERE id = $1`,
              [rolloutId],
            )
          }
        },
      })

      const startResult = await startFleetRollout({
        pool,
        provisioningService: stub.service,
        targetVersion: '2.0.0',
        triggeredBy: 'operator-1',
      })
      rolloutId = startResult.id

      // Wait for the orchestrator to finish.
      await waitForRolloutToEnd(pool, rolloutId, 2000)

      const finalRollout = await getFleetRollout(pool, rolloutId)
      assert.ok(finalRollout, 'Rollout should exist')
      assert.equal(finalRollout.status, 'aborted')

      const tenantsResult = await pool.query<{ tenant_id: string; status: string }>(
        `SELECT tenant_id, status FROM fleet_rollout_tenants ORDER BY tenant_id`,
      )
      const byId = Object.fromEntries(tenantsResult.rows.map((r) => [r.tenant_id, r.status]))

      // Exactly one tenant should have succeeded (the one provisioned before abort).
      const succeededCount = Object.values(byId).filter((s) => s === 'succeeded').length
      assert.equal(succeededCount, 1, 'exactly one tenant should have succeeded before abort')

      // No tenant should have been provisioned after the abort.
      assert.equal(callCount, 1, 'only one provision call should have been made')

      // The remaining tenant must be marked 'skipped' (not 'pending') with reason 'aborted'.
      const remainingTenantId = Object.keys(byId).find((id) => byId[id] !== 'succeeded')
      assert.ok(remainingTenantId, 'There should be a remaining tenant')
      assert.equal(byId[remainingTenantId], 'skipped', 'Remaining tenant should be skipped')

      const reasonResult = await pool.query<{ reason: string | null }>(
        `SELECT reason FROM fleet_rollout_tenants WHERE rollout_id = $1 AND status = 'skipped'`,
        [rolloutId],
      )
      assert.equal(
        reasonResult.rows[0]?.reason,
        'aborted',
        'Skipped tenant should have reason "aborted"',
      )
    } finally {
      await cleanup()
    }
  })

  it('halts rollout at the failing tenant and marks rollout failed', async () => {
    const { pool, cleanup } = createTestFleetPool()

    try {
      await runMigrationsOnPool(pool)

      await seedTenants(pool, [
        { id: 'tenant-a', state: 'ready' },
        { id: 'tenant-b', state: 'ready' },
        { id: 'tenant-c', state: 'ready' },
      ])

      const failError = new Error('provision failed: image pull error')
      const stub = createStubProvisioningService({
        failOn: new Map([['tenant-b', failError]]),
      })

      const startResult = await startFleetRollout({
        pool,
        provisioningService: stub.service,
        targetVersion: '2.0.0',
        triggeredBy: 'operator-1',
      })

      await waitForRolloutToEnd(pool, startResult.id, 2000)

      const finalRollout = await getFleetRollout(pool, startResult.id)
      assert.ok(finalRollout)
      assert.equal(finalRollout.status, 'failed')
      assert.equal(finalRollout.failedTenant, 'tenant-b')
      assert.ok(finalRollout.failedError?.includes('provision failed'))

      // tenant-a succeeded, tenant-b failed, tenant-c should remain pending
      // (not skipped, not succeeded — the rollout halted, no auto-skip).
      const tenantsResult = await pool.query<{ tenant_id: string; status: string }>(
        `SELECT tenant_id, status FROM fleet_rollout_tenants ORDER BY tenant_id`,
      )
      const byId = Object.fromEntries(tenantsResult.rows.map((r) => [r.tenant_id, r.status]))
      assert.equal(byId['tenant-a'], 'succeeded')
      assert.equal(byId['tenant-b'], 'failed')
      // tenant-c was not reached, so it stays pending.
      assert.equal(byId['tenant-c'], 'pending')
    } finally {
      await cleanup()
    }
  })
})

describe('abortFleetRollout', () => {
  it('sets abort_reason on a running rollout', async () => {
    const { pool, cleanup } = createTestFleetPool()

    try {
      await runMigrationsOnPool(pool)

      // Insert a rollout row directly.
      const rolloutId = 'rl_test0001'
      await pool.query(
        `INSERT INTO fleet_rollouts (id, target_version, status, triggered_by, started_at)
         VALUES ($1, '2.0.0', 'running', 'operator-1', NOW())`,
        [rolloutId],
      )

      await abortFleetRollout(pool, rolloutId, 'manual stop')

      const result = await pool.query<{ abort_reason: string }>(
        `SELECT abort_reason FROM fleet_rollouts WHERE id = $1`,
        [rolloutId],
      )
      assert.equal(result.rows[0]?.abort_reason, 'manual stop')
    } finally {
      await cleanup()
    }
  })

  it('throws FleetRolloutNotFoundError for unknown rollout', async () => {
    const { pool, cleanup } = createTestFleetPool()

    try {
      await runMigrationsOnPool(pool)

      await assert.rejects(
        () => abortFleetRollout(pool, 'rl_notexist', null),
        FleetRolloutNotFoundError,
      )
    } finally {
      await cleanup()
    }
  })

  it('throws FleetRolloutAlreadyEndedError for a completed rollout', async () => {
    const { pool, cleanup } = createTestFleetPool()

    try {
      await runMigrationsOnPool(pool)

      const rolloutId = 'rl_test0002'
      await pool.query(
        `INSERT INTO fleet_rollouts (id, target_version, status, triggered_by, started_at, ended_at)
         VALUES ($1, '2.0.0', 'completed', 'operator-1', NOW(), NOW())`,
        [rolloutId],
      )

      await assert.rejects(
        () => abortFleetRollout(pool, rolloutId, null),
        FleetRolloutAlreadyEndedError,
      )
    } finally {
      await cleanup()
    }
  })
})

describe('getCurrentFleetRollout', () => {
  it('returns null when no rollout is running', async () => {
    const { pool, cleanup } = createTestFleetPool()

    try {
      await runMigrationsOnPool(pool)
      const current = await getCurrentFleetRollout(pool)
      assert.equal(current, null)
    } finally {
      await cleanup()
    }
  })

  it('returns the running rollout with progress counts', async () => {
    const { pool, cleanup } = createTestFleetPool()

    try {
      await runMigrationsOnPool(pool)

      const rolloutId = 'rl_test0003'
      await pool.query(
        `INSERT INTO fleet_rollouts (id, target_version, status, triggered_by, started_at)
         VALUES ($1, '2.0.0', 'running', 'operator-1', NOW())`,
        [rolloutId],
      )
      await pool.query(
        `INSERT INTO fleet_rollout_tenants (rollout_id, tenant_id, status) VALUES ($1, 'tenant-a', 'succeeded')`,
        [rolloutId],
      )
      await pool.query(
        `INSERT INTO fleet_rollout_tenants (rollout_id, tenant_id, status) VALUES ($1, 'tenant-b', 'pending')`,
        [rolloutId],
      )

      const current = await getCurrentFleetRollout(pool)
      assert.ok(current)
      assert.equal(current.id, rolloutId)
      assert.equal(current.status, 'running')
      assert.equal(current.total, 2)
      assert.equal(current.completed, 1)
      assert.equal(current.pending, 1)
    } finally {
      await cleanup()
    }
  })
})

describe('getFleetRollout', () => {
  it('returns null for unknown rollout', async () => {
    const { pool, cleanup } = createTestFleetPool()

    try {
      await runMigrationsOnPool(pool)
      const rollout = await getFleetRollout(pool, 'rl_notexist')
      assert.equal(rollout, null)
    } finally {
      await cleanup()
    }
  })

  it('returns historical snapshot for a completed rollout', async () => {
    const { pool, cleanup } = createTestFleetPool()

    try {
      await runMigrationsOnPool(pool)

      const rolloutId = 'rl_test0004'
      await pool.query(
        `INSERT INTO fleet_rollouts (id, target_version, status, triggered_by, started_at, ended_at)
         VALUES ($1, '2.0.0', 'completed', 'operator-1', NOW(), NOW())`,
        [rolloutId],
      )

      const rollout = await getFleetRollout(pool, rolloutId)
      assert.ok(rollout)
      assert.equal(rollout.id, rolloutId)
      assert.equal(rollout.status, 'completed')
      assert.ok(rollout.endedAt)
    } finally {
      await cleanup()
    }
  })
})

describe('markOrphanRunningRolloutsFailed', () => {
  it('marks stale running rollouts as failed on startup', async () => {
    const { pool, cleanup } = createTestFleetPool()

    try {
      await runMigrationsOnPool(pool)

      // Insert a rollout that appears to have started 120 seconds ago.
      const rolloutId = 'rl_orphan01'
      await pool.query(
        `INSERT INTO fleet_rollouts (id, target_version, status, triggered_by, started_at)
         VALUES ($1, '2.0.0', 'running', 'operator-1', NOW() - INTERVAL '120 seconds')`,
        [rolloutId],
      )

      const marked = await markOrphanRunningRolloutsFailed(pool, 60)
      assert.equal(marked, 1)

      const result = await pool.query<{ status: string; failed_error: string }>(
        `SELECT status, failed_error FROM fleet_rollouts WHERE id = $1`,
        [rolloutId],
      )
      assert.equal(result.rows[0]?.status, 'failed')
      assert.equal(result.rows[0]?.failed_error, 'control-plane restart')
    } finally {
      await cleanup()
    }
  })

  it('does not mark recent running rollouts (within grace period)', async () => {
    const { pool, cleanup } = createTestFleetPool()

    try {
      await runMigrationsOnPool(pool)

      const rolloutId = 'rl_recent01'
      await pool.query(
        `INSERT INTO fleet_rollouts (id, target_version, status, triggered_by, started_at)
         VALUES ($1, '2.0.0', 'running', 'operator-1', NOW() - INTERVAL '10 seconds')`,
        [rolloutId],
      )

      const marked = await markOrphanRunningRolloutsFailed(pool, 60)
      assert.equal(marked, 0)

      const result = await pool.query<{ status: string }>(
        `SELECT status FROM fleet_rollouts WHERE id = $1`,
        [rolloutId],
      )
      assert.equal(result.rows[0]?.status, 'running')
    } finally {
      await cleanup()
    }
  })

  it('does not affect completed or aborted rollouts', async () => {
    const { pool, cleanup } = createTestFleetPool()

    try {
      await runMigrationsOnPool(pool)

      await pool.query(
        `INSERT INTO fleet_rollouts (id, target_version, status, triggered_by, started_at, ended_at)
         VALUES ('rl_comp01', '2.0.0', 'completed', 'op', NOW() - INTERVAL '120 seconds', NOW())`,
      )
      await pool.query(
        `INSERT INTO fleet_rollouts (id, target_version, status, triggered_by, started_at, ended_at)
         VALUES ('rl_abort01', '2.0.0', 'aborted', 'op', NOW() - INTERVAL '120 seconds', NOW())`,
      )

      const marked = await markOrphanRunningRolloutsFailed(pool, 60)
      assert.equal(marked, 0)
    } finally {
      await cleanup()
    }
  })
})

// ---------------------------------------------------------------------------
// Utility: poll until rollout ends (for fire-and-forget integration tests)
// ---------------------------------------------------------------------------

async function waitForRolloutToEnd(
  pool: TenantRegistryPoolLike,
  rolloutId: string,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now()
  const pollIntervalMs = 20

  while (true) {
    const result = await pool.query<{ status: string }>(
      `SELECT status FROM fleet_rollouts WHERE id = $1`,
      [rolloutId],
    )
    const status = result.rows[0]?.status

    if (status && status !== 'running') {
      return
    }

    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Timed out waiting for rollout ${rolloutId} to end (last status: ${status})`,
      )
    }

    await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs))
  }
}

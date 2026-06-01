/**
 * Unit tests for TenantRegistry.getFleetUptimes (#413).
 *
 * All tests run against pg-mem through the real TenantRegistry contract via
 * createTestTenantRegistry(). No real Postgres connection required.
 *
 * pg-mem constraints respected throughout:
 *   - No OVER/window functions
 *   - No TIMESTAMPTZ - TIMESTAMPTZ arithmetic
 *   - No GREATEST/LEAST on timestamps
 *   - No correlated subqueries where the subquery WHERE references outer aliases
 *   - Nullable parameters cast explicitly (e.g. $1::timestamptz)
 *
 * Test setup note: TenantRegistry.createTenant() always records a
 * provisioning→provisioning transition with CURRENT_TIMESTAMP. Tests that need
 * a clean timeline insert state_transitions directly via pool.query() with
 * explicit past timestamps and skip createTenant where that transition would
 * pollute the timeline.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createTestTenantRegistry } from './tenant-registry-test-helpers.js'

type TestPool = Awaited<ReturnType<typeof createTestTenantRegistry>>['pool']

/**
 * Insert a tenant directly into the tenants table (bypassing createTenant which
 * records a transition with CURRENT_TIMESTAMP that pollutes timeline tests).
 */
async function insertTenantDirect(
  pool: TestPool,
  id: string,
  currentState: string = 'ready',
) {
  await pool.query(
    `INSERT INTO tenants (id, slug, owner_id, desired_state, current_state, version)
     VALUES ($1, $1, 'owner-test', $2, $2, '1.0.0')`,
    [id, currentState],
  )
}

/**
 * Insert a state_transition row with an explicit timestamp.
 */
async function insertTransition(
  pool: TestPool,
  params: {
    tenantId: string
    fromState: string
    toState: string
    createdAt: string
    triggeredBy?: string
  },
) {
  await pool.query(
    `INSERT INTO state_transitions (tenant_id, from_state, to_state, triggered_by, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      params.tenantId,
      params.fromState,
      params.toState,
      params.triggeredBy ?? 'test-suite',
      params.createdAt,
    ],
  )
}

/**
 * Insert a tenant_activity row for seen_by_activator testing.
 */
async function insertTenantActivity(
  pool: TestPool,
  tenantId: string,
  seenByActivator: boolean,
) {
  await pool.query(
    `INSERT INTO tenant_activity (tenant_id, last_request_at, seen_by_activator)
     VALUES ($1, NOW(), $2)
     ON CONFLICT (tenant_id) DO UPDATE SET seen_by_activator = $2`,
    [tenantId, seenByActivator],
  )
}

describe('TenantRegistry.getFleetUptimes', () => {
  it('returns an empty map when given no tenants', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()
    try {
      const result = await tenantRegistry.getFleetUptimes([], 24)
      assert.equal(result.size, 0)
    } finally {
      await cleanup()
    }
  })

  it('spec default: uptimePct 100 for tenant with no transitions and currentState=ready', async () => {
    // Insert tenant directly (no createTenant) so there are truly zero transitions.
    const { tenantRegistry, pool, cleanup } = createTestTenantRegistry()
    try {
      await tenantRegistry.checkHealth()
      await insertTenantDirect(pool, 'ready-notrans', 'ready')

      const result = await tenantRegistry.getFleetUptimes(
        [{ id: 'ready-notrans', currentState: 'ready', createdAt: new Date().toISOString() }],
        24,
      )

      const uptime = result.get('ready-notrans')
      assert.ok(uptime, 'uptime block should be present')
      assert.equal(uptime.uptimePct, 100)
      assert.equal(uptime.wakeCount, 0)
      assert.equal(uptime.lastWakeAt, null)
      assert.equal(uptime.seenByActivator, false)
    } finally {
      await cleanup()
    }
  })

  it('spec default: uptimePct 0 for tenant with no transitions and currentState=provisioning', async () => {
    const { tenantRegistry, pool, cleanup } = createTestTenantRegistry()
    try {
      await tenantRegistry.checkHealth()
      await insertTenantDirect(pool, 'prov-notrans', 'provisioning')

      const result = await tenantRegistry.getFleetUptimes(
        [{ id: 'prov-notrans', currentState: 'provisioning', createdAt: new Date().toISOString() }],
        24,
      )

      const uptime = result.get('prov-notrans')
      assert.ok(uptime)
      assert.equal(uptime.uptimePct, 0)
      assert.equal(uptime.totalSleepMs, 0)
      assert.equal(uptime.lastSleepMs, null)
    } finally {
      await cleanup()
    }
  })

  it('tenant only ever in ready state: uptimePct 100, no sleep', async () => {
    // Tenant has a provisioning→ready transition long before the window, and
    // stays ready throughout. uptimePct should be 100.
    const { tenantRegistry, pool, cleanup } = createTestTenantRegistry()
    try {
      await tenantRegistry.checkHealth()
      const now = Date.now()
      await insertTenantDirect(pool, 'always-ready', 'ready')
      // Single transition 48h ago (outside 24h window)
      await insertTransition(pool, {
        tenantId: 'always-ready',
        fromState: 'provisioning',
        toState: 'ready',
        createdAt: new Date(now - 48 * 3600000).toISOString(),
      })

      const result = await tenantRegistry.getFleetUptimes(
        [{ id: 'always-ready', currentState: 'ready', createdAt: new Date(now - 48 * 3600000).toISOString() }],
        24,
      )

      const uptime = result.get('always-ready')
      assert.ok(uptime, 'uptime block should be present')
      assert.equal(uptime.totalSleepMs, 0)
      assert.equal(uptime.uptimePct, 100)
      assert.equal(uptime.wakeCount, 0)
      assert.equal(uptime.lastSleepMs, null)
      assert.equal(uptime.lastWakeAt, null)
    } finally {
      await cleanup()
    }
  })

  it('tenant flapped 3 times in window: counts all sleep spans correctly', async () => {
    const { tenantRegistry, pool, cleanup } = createTestTenantRegistry()
    try {
      await tenantRegistry.checkHealth()
      const now = Date.now()
      await insertTenantDirect(pool, 'flapper', 'ready')

      // Initial: provisioning→ready 48h ago (before 24h window)
      await insertTransition(pool, {
        tenantId: 'flapper',
        fromState: 'provisioning',
        toState: 'ready',
        createdAt: new Date(now - 48 * 3600000).toISOString(),
      })

      // 3 sleep/wake cycles within the 24h window, each sleep is 1h
      const cycles = [
        { sleepAt: new Date(now - 20 * 3600000), wakeAt: new Date(now - 19 * 3600000) },
        { sleepAt: new Date(now - 15 * 3600000), wakeAt: new Date(now - 14 * 3600000) },
        { sleepAt: new Date(now - 5 * 3600000), wakeAt: new Date(now - 4 * 3600000) },
      ]

      for (const cycle of cycles) {
        await insertTransition(pool, {
          tenantId: 'flapper',
          fromState: 'ready',
          toState: 'sleeping',
          createdAt: cycle.sleepAt.toISOString(),
        })
        await insertTransition(pool, {
          tenantId: 'flapper',
          fromState: 'sleeping',
          toState: 'ready',
          createdAt: cycle.wakeAt.toISOString(),
        })
      }

      const result = await tenantRegistry.getFleetUptimes(
        [{ id: 'flapper', currentState: 'ready', createdAt: new Date(now - 48 * 3600000).toISOString() }],
        24,
      )

      const uptime = result.get('flapper')
      assert.ok(uptime, 'uptime block should be present')
      assert.equal(uptime.wakeCount, 3)
      // Each sleep is 1h = 3600000ms; 3 total = 10800000
      assert.equal(uptime.totalSleepMs, 3 * 3600000)
      assert.ok(uptime.lastSleepMs !== null, 'lastSleepMs should be set')
      assert.equal(uptime.lastSleepMs, 3600000, 'last sleep was 1h')
      assert.ok(uptime.lastWakeAt !== null, 'lastWakeAt should be set')
      // uptimePct: (24h - 3h) / 24h * 100 = 87.5
      const expectedPct = ((24 - 3) / 24) * 100
      assert.ok(
        Math.abs(uptime.uptimePct - expectedPct) < 0.01,
        `uptimePct should be ~${expectedPct}, got ${uptime.uptimePct}`,
      )
    } finally {
      await cleanup()
    }
  })

  it('window shorter than full history: only counts sleep within window', async () => {
    const { tenantRegistry, pool, cleanup } = createTestTenantRegistry()
    try {
      await tenantRegistry.checkHealth()
      const now = Date.now()
      await insertTenantDirect(pool, 'historic', 'ready')

      await insertTransition(pool, {
        tenantId: 'historic',
        fromState: 'provisioning',
        toState: 'ready',
        createdAt: new Date(now - 48 * 3600000).toISOString(),
      })

      // Sleep 30h ago (before 24h window), wake 25h ago (also before window)
      await insertTransition(pool, {
        tenantId: 'historic',
        fromState: 'ready',
        toState: 'sleeping',
        createdAt: new Date(now - 30 * 3600000).toISOString(),
      })
      await insertTransition(pool, {
        tenantId: 'historic',
        fromState: 'sleeping',
        toState: 'ready',
        createdAt: new Date(now - 25 * 3600000).toISOString(),
      })
      // Sleep 10h ago (inside 24h window), wake 8h ago
      await insertTransition(pool, {
        tenantId: 'historic',
        fromState: 'ready',
        toState: 'sleeping',
        createdAt: new Date(now - 10 * 3600000).toISOString(),
      })
      await insertTransition(pool, {
        tenantId: 'historic',
        fromState: 'sleeping',
        toState: 'ready',
        createdAt: new Date(now - 8 * 3600000).toISOString(),
      })

      const result = await tenantRegistry.getFleetUptimes(
        [{ id: 'historic', currentState: 'ready', createdAt: new Date(now - 48 * 3600000).toISOString() }],
        24,
      )

      const uptime = result.get('historic')
      assert.ok(uptime, 'uptime block should be present')
      // Only the in-window sleep (2h) should count
      assert.equal(uptime.totalSleepMs, 2 * 3600000)
      assert.equal(uptime.wakeCount, 1, 'only 1 wake in window')
    } finally {
      await cleanup()
    }
  })

  it('window longer than full history: counts all sleep spans in transitions', async () => {
    const { tenantRegistry, pool, cleanup } = createTestTenantRegistry()
    try {
      await tenantRegistry.checkHealth()
      const now = Date.now()
      await insertTenantDirect(pool, 'young', 'ready')

      // Tenant only has 6h of history, queried against a 24h window
      await insertTransition(pool, {
        tenantId: 'young',
        fromState: 'provisioning',
        toState: 'ready',
        createdAt: new Date(now - 6 * 3600000).toISOString(),
      })
      await insertTransition(pool, {
        tenantId: 'young',
        fromState: 'ready',
        toState: 'sleeping',
        createdAt: new Date(now - 4 * 3600000).toISOString(),
      })
      await insertTransition(pool, {
        tenantId: 'young',
        fromState: 'sleeping',
        toState: 'ready',
        createdAt: new Date(now - 2 * 3600000).toISOString(),
      })

      const result = await tenantRegistry.getFleetUptimes(
        [{ id: 'young', currentState: 'ready', createdAt: new Date(now - 6 * 3600000).toISOString() }],
        24,
      )

      const uptime = result.get('young')
      assert.ok(uptime, 'uptime block should be present')
      // Sleep was 2h out of 24h window
      assert.equal(uptime.totalSleepMs, 2 * 3600000)
      assert.equal(uptime.wakeCount, 1)
    } finally {
      await cleanup()
    }
  })

  it('seen_by_activator false when no tenant_activity row', async () => {
    const { tenantRegistry, pool, cleanup } = createTestTenantRegistry()
    try {
      await tenantRegistry.checkHealth()
      await insertTenantDirect(pool, 'no-activator', 'ready')
      await insertTransition(pool, {
        tenantId: 'no-activator',
        fromState: 'provisioning',
        toState: 'ready',
        createdAt: new Date(Date.now() - 48 * 3600000).toISOString(),
      })

      const result = await tenantRegistry.getFleetUptimes(
        [{ id: 'no-activator', currentState: 'ready', createdAt: new Date().toISOString() }],
        24,
      )

      const uptime = result.get('no-activator')
      assert.ok(uptime)
      assert.equal(uptime.seenByActivator, false)
    } finally {
      await cleanup()
    }
  })

  it('seen_by_activator reflects tenant_activity.seen_by_activator = true', async () => {
    const { tenantRegistry, pool, cleanup } = createTestTenantRegistry()
    try {
      await tenantRegistry.checkHealth()
      await insertTenantDirect(pool, 'seen-tenant', 'ready')
      await insertTransition(pool, {
        tenantId: 'seen-tenant',
        fromState: 'provisioning',
        toState: 'ready',
        createdAt: new Date(Date.now() - 48 * 3600000).toISOString(),
      })
      await insertTenantActivity(pool, 'seen-tenant', true)

      const result = await tenantRegistry.getFleetUptimes(
        [{ id: 'seen-tenant', currentState: 'ready', createdAt: new Date().toISOString() }],
        24,
      )

      const uptime = result.get('seen-tenant')
      assert.ok(uptime)
      assert.equal(uptime.seenByActivator, true)
    } finally {
      await cleanup()
    }
  })

  it('seen_by_activator = false when tenant_activity.seen_by_activator = false', async () => {
    const { tenantRegistry, pool, cleanup } = createTestTenantRegistry()
    try {
      await tenantRegistry.checkHealth()
      await insertTenantDirect(pool, 'not-seen', 'ready')
      await insertTransition(pool, {
        tenantId: 'not-seen',
        fromState: 'provisioning',
        toState: 'ready',
        createdAt: new Date(Date.now() - 48 * 3600000).toISOString(),
      })
      await insertTenantActivity(pool, 'not-seen', false)

      const result = await tenantRegistry.getFleetUptimes(
        [{ id: 'not-seen', currentState: 'ready', createdAt: new Date().toISOString() }],
        24,
      )

      const uptime = result.get('not-seen')
      assert.ok(uptime)
      assert.equal(uptime.seenByActivator, false)
    } finally {
      await cleanup()
    }
  })

  it('currentState provisioning yields sensible uptimePct 0', async () => {
    // A tenant in provisioning state (no sleep, no ready) should show 0% uptime.
    const { tenantRegistry, pool, cleanup } = createTestTenantRegistry()
    try {
      await tenantRegistry.checkHealth()
      const now = Date.now()
      await insertTenantDirect(pool, 'prov-tenant', 'provisioning')
      // Has one transition: started provisioning 2h ago (within 24h window)
      await insertTransition(pool, {
        tenantId: 'prov-tenant',
        fromState: 'provisioning',
        toState: 'provisioning',
        createdAt: new Date(now - 2 * 3600000).toISOString(),
      })

      const result = await tenantRegistry.getFleetUptimes(
        [{ id: 'prov-tenant', currentState: 'provisioning', createdAt: new Date(now - 2 * 3600000).toISOString() }],
        24,
      )

      const uptime = result.get('prov-tenant')
      assert.ok(uptime)
      // Provisioning state throughout → 0% uptime
      assert.equal(uptime.uptimePct, 0)
    } finally {
      await cleanup()
    }
  })

  it('tenant currently sleeping: ongoing sleep counted in totalSleepMs', async () => {
    const { tenantRegistry, pool, cleanup } = createTestTenantRegistry()
    try {
      await tenantRegistry.checkHealth()
      const now = Date.now()
      await insertTenantDirect(pool, 'sleeping-now', 'sleeping')

      // Was ready, went to sleep 2h ago, still sleeping
      await insertTransition(pool, {
        tenantId: 'sleeping-now',
        fromState: 'provisioning',
        toState: 'ready',
        createdAt: new Date(now - 48 * 3600000).toISOString(),
      })
      await insertTransition(pool, {
        tenantId: 'sleeping-now',
        fromState: 'ready',
        toState: 'sleeping',
        createdAt: new Date(now - 2 * 3600000).toISOString(),
      })

      const result = await tenantRegistry.getFleetUptimes(
        [{ id: 'sleeping-now', currentState: 'sleeping', createdAt: new Date(now - 48 * 3600000).toISOString() }],
        24,
      )

      const uptime = result.get('sleeping-now')
      assert.ok(uptime)
      // Slept for ~2h → totalSleepMs >= 1.9h (small timing delta tolerated)
      assert.ok(
        uptime.totalSleepMs >= 1.9 * 3600000,
        `totalSleepMs should be at least ~2h, got ${uptime.totalSleepMs}`,
      )
      // Ongoing sleep is NOT a completed span → lastSleepMs = null
      assert.equal(uptime.lastSleepMs, null, 'ongoing sleep is not a completed span')
      assert.equal(uptime.wakeCount, 0, 'no wakes yet')
    } finally {
      await cleanup()
    }
  })

  it('currentStateSince falls back to tenant.createdAt when no transitions', async () => {
    const { tenantRegistry, pool, cleanup } = createTestTenantRegistry()
    try {
      await tenantRegistry.checkHealth()
      const createdAt = '2025-01-01T00:00:00.000Z'
      await insertTenantDirect(pool, 'no-trans-since', 'provisioning')
      // No transitions inserted — zero state_transitions rows for this tenant

      const result = await tenantRegistry.getFleetUptimes(
        [{ id: 'no-trans-since', currentState: 'provisioning', createdAt }],
        24,
      )

      const uptime = result.get('no-trans-since')
      assert.ok(uptime)
      assert.equal(uptime.currentStateSince, createdAt)
    } finally {
      await cleanup()
    }
  })

  it('sleep span that started before the window is clipped to window start', async () => {
    // Window: 4h. Tenant went to sleep 6h ago (2h before window start), woke 2h ago.
    // Expected: sleep overlap with window = 2h (from window start to wake).
    const { tenantRegistry, pool, cleanup } = createTestTenantRegistry()
    try {
      await tenantRegistry.checkHealth()
      const now = Date.now()
      const windowHours = 4
      await insertTenantDirect(pool, 'pre-sleep', 'ready')

      // provisioning→ready 48h ago
      await insertTransition(pool, {
        tenantId: 'pre-sleep',
        fromState: 'provisioning',
        toState: 'ready',
        createdAt: new Date(now - 48 * 3600000).toISOString(),
      })
      // ready→sleeping 6h ago (2h before the 4h window starts)
      await insertTransition(pool, {
        tenantId: 'pre-sleep',
        fromState: 'ready',
        toState: 'sleeping',
        createdAt: new Date(now - 6 * 3600000).toISOString(),
      })
      // sleeping→ready 2h ago (2h into the 4h window)
      await insertTransition(pool, {
        tenantId: 'pre-sleep',
        fromState: 'sleeping',
        toState: 'ready',
        createdAt: new Date(now - 2 * 3600000).toISOString(),
      })

      const result = await tenantRegistry.getFleetUptimes(
        [{ id: 'pre-sleep', currentState: 'ready', createdAt: new Date(now - 48 * 3600000).toISOString() }],
        windowHours,
      )

      const uptime = result.get('pre-sleep')
      assert.ok(uptime)
      // Sleep overlaps window by 2h: from w_start (now-4h) to wake_at (now-2h)
      assert.ok(
        Math.abs(uptime.totalSleepMs - 2 * 3600000) < 5000,
        `totalSleepMs should be ~2h, got ${uptime.totalSleepMs}`,
      )
      assert.equal(uptime.wakeCount, 1)
    } finally {
      await cleanup()
    }
  })

  it('backwards compat: getFleetUptimes with empty tenants list returns empty map', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()
    try {
      const result = await tenantRegistry.getFleetUptimes([], 24)
      assert.equal(result.size, 0)
    } finally {
      await cleanup()
    }
  })
})

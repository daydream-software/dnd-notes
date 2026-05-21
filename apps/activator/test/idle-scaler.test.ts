/**
 * Tests for queryIdleEligibleTenants (#364 — idle-scaler guard).
 *
 * Acceptance criterion: only tenants with seen_by_activator=TRUE that are
 * idle past the threshold are returned. Tenants backfilled FALSE (pre-activator
 * provisioning) and tenants with no activity row must never be returned.
 *
 * Uses an injected fake DB client — no real Postgres or K8s connection required.
 * The fake DB records which rows were queried and returns only rows that match
 * the three-bucket fixture:
 *   (a) seen_by_activator=TRUE + idle past threshold  → eligible, must appear
 *   (b) seen_by_activator=FALSE (backfill)            → not eligible, must NOT appear
 *   (c) no activity row at all                        → not eligible, must NOT appear
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { queryIdleEligibleTenants, type IdleScalerDbClient } from '../src/idle-scaler.js'

interface FakeTenantActivityRow {
  tenantId: string
  subdomain: string
  currentState: string
  seenByActivator: boolean
  idleMinutes: number // how many minutes ago last_request_at was set
}

/**
 * Build a fake DB client that emulates the queryIdleEligibleTenants SQL logic.
 *
 * The query uses:
 *   JOIN tenant_activity ON seen_by_activator = TRUE
 *   AND last_request_at < NOW() - threshold interval
 *
 * This fake replicates that logic in JS so the test proves the exported function
 * passes correct parameters and returns the filtered result.
 */
function makeIdleScalerDb(
  rows: FakeTenantActivityRow[],
  capturedParams: unknown[][] = [],
): IdleScalerDbClient {
  return {
    async query<T extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> {
      capturedParams.push(params ?? [])

      // Only handle the idle-eligible SELECT; reject anything unexpected.
      assert.ok(
        sql.includes('seen_by_activator') && sql.includes('JOIN tenant_activity'),
        `Unexpected query in idle-scaler fake DB: ${sql.slice(0, 80)}`,
      )

      const thresholdMinutes = Number(params?.[0] ?? 30)

      // Filter rows the same way the real SQL would:
      //   - current_state = 'ready'
      //   - desired_state NOT IN ('deprovisioned', 'failed')  (all test rows are 'ready')
      //   - seen_by_activator = TRUE
      //   - last_request_at < NOW() - threshold (idleMinutes > thresholdMinutes)
      const eligible = rows.filter(
        (r) =>
          r.currentState === 'ready' &&
          r.seenByActivator === true &&
          r.idleMinutes > thresholdMinutes,
      )

      return {
        rows: eligible.map((r) => ({
          tenantId: r.tenantId,
          subdomain: r.subdomain,
          currentState: r.currentState,
        })) as unknown as T[],
      }
    },
  }
}

describe('queryIdleEligibleTenants', () => {
  it('mixed-fixture: only seen_by_activator=TRUE idle tenants are returned', async () => {
    // Three buckets per acceptance criterion #364:
    //   (a) seen=TRUE, idle past threshold → eligible
    //   (b) seen=FALSE (backfill) → NOT eligible even though idle
    //   (c) no activity row → represented here as a row with seen=FALSE and
    //       idleMinutes > threshold — both match the INNER JOIN absence semantics
    const fixture: FakeTenantActivityRow[] = [
      // (a) seen=TRUE, idle past threshold — MUST be returned
      { tenantId: 'tenant-seen-idle-1', subdomain: 'seen-idle-1', currentState: 'ready', seenByActivator: true, idleMinutes: 60 },
      { tenantId: 'tenant-seen-idle-2', subdomain: 'seen-idle-2', currentState: 'ready', seenByActivator: true, idleMinutes: 35 },

      // seen=TRUE but NOT idle (still active) — must NOT be returned
      { tenantId: 'tenant-seen-active', subdomain: 'seen-active', currentState: 'ready', seenByActivator: true, idleMinutes: 10 },

      // (b) seen=FALSE (backfill from 0008), idle — must NOT be returned
      { tenantId: 'tenant-backfill-1', subdomain: 'backfill-1', currentState: 'ready', seenByActivator: false, idleMinutes: 60 },
      { tenantId: 'tenant-backfill-2', subdomain: 'backfill-2', currentState: 'ready', seenByActivator: false, idleMinutes: 120 },

      // (c) no activity row equivalent — in the real DB, no row means the INNER JOIN
      // excludes the tenant. Here represented as seen=FALSE so the fake filter agrees.
      { tenantId: 'tenant-no-activity', subdomain: 'no-activity', currentState: 'ready', seenByActivator: false, idleMinutes: 200 },
    ]

    const capturedParams: unknown[][] = []
    const db = makeIdleScalerDb(fixture, capturedParams)
    const thresholdMinutes = 30

    const result = await queryIdleEligibleTenants(db, thresholdMinutes)

    // Only bucket (a) tenants should appear
    const returnedIds = result.map((r) => r.tenantId).sort()
    assert.deepEqual(returnedIds, ['tenant-seen-idle-1', 'tenant-seen-idle-2'])

    // Bucket (b) and (c) must not appear
    for (const id of ['tenant-backfill-1', 'tenant-backfill-2', 'tenant-no-activity']) {
      assert.equal(
        result.some((r) => r.tenantId === id),
        false,
        `tenant ${id} must not be returned — not seen by activator`,
      )
    }

    // The still-active seen tenant must also not appear
    assert.equal(
      result.some((r) => r.tenantId === 'tenant-seen-active'),
      false,
      'tenant-seen-active is not idle past threshold — must not be returned',
    )
  })

  it('passes the threshold as the first query parameter', async () => {
    const capturedParams: unknown[][] = []
    const db = makeIdleScalerDb([], capturedParams)

    await queryIdleEligibleTenants(db, 45)

    assert.equal(capturedParams.length, 1, 'exactly one query must be issued')
    assert.equal(capturedParams[0]?.[0], 45, 'first parameter must be the threshold in minutes')
  })

  it('returns an empty array when no tenants are eligible', async () => {
    const fixture: FakeTenantActivityRow[] = [
      // All backfilled, none seen by activator
      { tenantId: 'backfill-only', subdomain: 'backfill-only', currentState: 'ready', seenByActivator: false, idleMinutes: 60 },
    ]
    const db = makeIdleScalerDb(fixture)

    const result = await queryIdleEligibleTenants(db, 30)
    assert.deepEqual(result, [])
  })

  it('the query uses INNER JOIN (not LEFT JOIN) to exclude tenants with no activity row', async () => {
    // This is a static assertion on the SQL string emitted by the function.
    // The key invariant: queryIdleEligibleTenants must use JOIN, not LEFT JOIN,
    // so that tenants without a tenant_activity row are excluded by the join itself
    // (not only by the seen_by_activator filter).
    let capturedSql = ''
    const db: IdleScalerDbClient = {
      async query(sql) {
        capturedSql = sql
        return { rows: [] }
      },
    }

    await queryIdleEligibleTenants(db, 30)

    // Must contain JOIN but not LEFT JOIN
    assert.ok(
      capturedSql.includes('JOIN tenant_activity'),
      'query must JOIN tenant_activity',
    )
    assert.ok(
      !capturedSql.match(/LEFT\s+JOIN\s+tenant_activity/i),
      'query must not use LEFT JOIN — tenants with no activity row must be excluded',
    )
    assert.ok(
      capturedSql.includes('seen_by_activator = TRUE'),
      'query must filter on seen_by_activator = TRUE',
    )
  })
})

/**
 * Tests for queryIdleEligibleTenants (#364 — idle-scaler guard).
 *
 * Acceptance criterion: only tenants with seen_by_activator=TRUE that are
 * idle past the threshold are returned. Tenants backfilled FALSE (pre-activator
 * provisioning) and tenants with no activity row must never be returned.
 *
 * Two test suites:
 *
 * 1. Fake-DB suite — fast, verifies function interface (parameter passing,
 *    return shape, SQL structural assertions). The fake re-implements the
 *    filter in JS so it proves the function contract, not SQL correctness.
 *
 * 2. pg-mem SQL-execution suite — actually runs the SELECT SQL against an
 *    in-memory Postgres engine. Proves that the seen_by_activator guard and
 *    the ($1 || ' minutes')::INTERVAL threshold cast are syntactically and
 *    semantically correct. A SQL typo (e.g. seen_by_activator = FALSE) would
 *    be caught here.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { newDb } from 'pg-mem'
import { hasActivitySince, queryIdleEligibleTenants, type IdleScalerDbClient } from '../src/idle-scaler.js'

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

/**
 * pg-mem SQL-execution suite.
 *
 * Builds a minimal in-memory schema (tenants + tenant_activity with the
 * seen_by_activator column from migration 0009) and executes the real SELECT
 * SQL from queryIdleEligibleTenants. This proves:
 *
 *  - The ($1 || ' minutes')::INTERVAL threshold cast is syntactically valid
 *    under pg-mem (proxy for real Postgres compatibility).
 *  - The seen_by_activator = TRUE guard correctly excludes backfill FALSE rows.
 *  - The INNER JOIN excludes tenants with no activity row.
 *  - The threshold arithmetic (last_request_at < NOW() - interval) is correct.
 *
 * A SQL typo that the fake-DB suite would miss (e.g., seen_by_activator = FALSE,
 * LEFT JOIN instead of JOIN, wrong column name) will cause a real SQL error or
 * wrong result set here.
 */
/**
 * Build a pg-mem pool with the minimal schema needed for idle-scaler queries.
 * Inline DDL is used to keep the activator package self-contained (no cross-
 * package import from control-plane migrations). Shared by all pg-mem suites
 * in this file.
 */
async function buildPgMemPool() {
  const db = newDb({ autoCreateForeignKeyIndices: true })
  const { Pool } = db.adapters.createPg()
  const pool = new Pool()

  // Minimal tenants table — only the columns the idle-scaler SELECT reads.
  // No CHECK constraints on states so we can INSERT any string without pg-mem
  // constraint naming friction.
  await pool.query(`
    CREATE TABLE tenants (
      id          TEXT PRIMARY KEY,
      subdomain   TEXT,
      current_state TEXT NOT NULL,
      desired_state TEXT NOT NULL
    )
  `)

  // tenant_activity as it exists after migration 0009.
  await pool.query(`
    CREATE TABLE tenant_activity (
      tenant_id        TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
      last_request_at  TIMESTAMPTZ NOT NULL,
      seen_by_activator BOOLEAN NOT NULL DEFAULT FALSE
    )
  `)

  return pool
}

describe('queryIdleEligibleTenants — pg-mem SQL execution', () => {
  it('pg-mem: seen=TRUE idle tenants are returned; backfill FALSE and active tenants are excluded', async () => {
    const pool = await buildPgMemPool()

    try {
      // Tenant A: seen=TRUE, idle 60 minutes → eligible
      await pool.query(
        `INSERT INTO tenants (id, subdomain, current_state, desired_state) VALUES ('t-a', 'sub-a', 'ready', 'ready')`,
      )
      await pool.query(
        `INSERT INTO tenant_activity (tenant_id, last_request_at, seen_by_activator)
         VALUES ('t-a', NOW() - INTERVAL '60 minutes', TRUE)`,
      )

      // Tenant B: seen=TRUE, idle 10 minutes — still active, NOT eligible
      await pool.query(
        `INSERT INTO tenants (id, subdomain, current_state, desired_state) VALUES ('t-b', 'sub-b', 'ready', 'ready')`,
      )
      await pool.query(
        `INSERT INTO tenant_activity (tenant_id, last_request_at, seen_by_activator)
         VALUES ('t-b', NOW() - INTERVAL '10 minutes', TRUE)`,
      )

      // Tenant C: seen=FALSE (backfill), idle 60 minutes — NOT eligible (#364 guard)
      await pool.query(
        `INSERT INTO tenants (id, subdomain, current_state, desired_state) VALUES ('t-c', 'sub-c', 'ready', 'ready')`,
      )
      await pool.query(
        `INSERT INTO tenant_activity (tenant_id, last_request_at, seen_by_activator)
         VALUES ('t-c', NOW() - INTERVAL '60 minutes', FALSE)`,
      )

      // Tenant D: no activity row at all — INNER JOIN must exclude it
      await pool.query(
        `INSERT INTO tenants (id, subdomain, current_state, desired_state) VALUES ('t-d', 'sub-d', 'ready', 'ready')`,
      )

      // Tenant E: desired_state=deprovisioned — must be excluded regardless of seen flag
      await pool.query(
        `INSERT INTO tenants (id, subdomain, current_state, desired_state) VALUES ('t-e', 'sub-e', 'ready', 'deprovisioned')`,
      )
      await pool.query(
        `INSERT INTO tenant_activity (tenant_id, last_request_at, seen_by_activator)
         VALUES ('t-e', NOW() - INTERVAL '60 minutes', TRUE)`,
      )

      const result = await queryIdleEligibleTenants(pool as unknown as IdleScalerDbClient, 30)

      const returnedIds = result.map((r) => r.tenantId).sort()
      assert.deepEqual(returnedIds, ['t-a'], 'only the seen+idle tenant must be returned')

      assert.equal(
        result.some((r) => r.tenantId === 't-b'),
        false,
        't-b is not idle past threshold — must not be returned',
      )
      assert.equal(
        result.some((r) => r.tenantId === 't-c'),
        false,
        't-c has seen_by_activator=FALSE — must not be returned (#364 guard)',
      )
      assert.equal(
        result.some((r) => r.tenantId === 't-d'),
        false,
        't-d has no activity row — INNER JOIN must exclude it',
      )
      assert.equal(
        result.some((r) => r.tenantId === 't-e'),
        false,
        't-e has desired_state=deprovisioned — must not be returned',
      )
    } finally {
      await pool.end()
    }
  })

  it('pg-mem: the ($1 || \' minutes\')::INTERVAL threshold cast works with integer parameter', async () => {
    // Directly verifies that the parameterized interval syntax does not throw
    // under pg-mem. A failure here means the production SQL needs adjustment
    // (e.g., switch to MAKE_INTERVAL or a different cast) before deploying.
    const pool = await buildPgMemPool()

    try {
      await pool.query(
        `INSERT INTO tenants (id, subdomain, current_state, desired_state) VALUES ('t-interval', 'sub-int', 'ready', 'ready')`,
      )
      await pool.query(
        `INSERT INTO tenant_activity (tenant_id, last_request_at, seen_by_activator)
         VALUES ('t-interval', NOW() - INTERVAL '45 minutes', TRUE)`,
      )

      // Threshold 30: row at 45 min idle should be returned
      const result30 = await queryIdleEligibleTenants(pool as unknown as IdleScalerDbClient, 30)
      assert.equal(result30.length, 1, 'threshold=30: tenant idle 45 min must be returned')

      // Threshold 60: row at 45 min idle should NOT be returned
      const result60 = await queryIdleEligibleTenants(pool as unknown as IdleScalerDbClient, 60)
      assert.equal(result60.length, 0, 'threshold=60: tenant idle only 45 min must not be returned')
    } finally {
      await pool.end()
    }
  })
})

/**
 * pg-mem suite for the SELECT->PATCH race guard (#354). Proves the re-read
 * comparison is syntactically valid under pg-mem and returns the right boolean.
 */
describe('hasActivitySince — pg-mem SQL execution (#354)', () => {
  it('returns false when activity has not advanced past the snapshot, true once it does', async () => {
    const pool = await buildPgMemPool()
    try {
      await pool.query(
        `INSERT INTO tenants (id, subdomain, current_state, desired_state) VALUES ('t-r', 'sub-r', 'ready', 'ready')`,
      )
      await pool.query(
        `INSERT INTO tenant_activity (tenant_id, last_request_at, seen_by_activator)
         VALUES ('t-r', NOW() - INTERVAL '40 minutes', TRUE)`,
      )

      // Snapshot taken at idle-SELECT time.
      const snapshot = (
        await pool.query(`SELECT last_request_at FROM tenant_activity WHERE tenant_id = 't-r'`)
      ).rows[0].last_request_at as Date

      // No wake happened: last_request_at == snapshot, strict > is false.
      assert.equal(
        await hasActivitySince(pool as unknown as IdleScalerDbClient, 't-r', snapshot),
        false,
        'no activity advance — must not skip scale-down',
      )

      // Activator wakes the tenant after the SELECT: last_request_at moves forward.
      await pool.query(`UPDATE tenant_activity SET last_request_at = NOW() WHERE tenant_id = 't-r'`)
      assert.equal(
        await hasActivitySince(pool as unknown as IdleScalerDbClient, 't-r', snapshot),
        true,
        'activity advanced past the snapshot — must skip scale-down',
      )
    } finally {
      await pool.end()
    }
  })

  it('returns false for a tenant with no activity row', async () => {
    const pool = await buildPgMemPool()
    try {
      assert.equal(
        await hasActivitySince(pool as unknown as IdleScalerDbClient, 't-missing', new Date(0)),
        false,
      )
    } finally {
      await pool.end()
    }
  })
})

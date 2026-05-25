/**
 * Tests for TenantActivityStore subdomain → tenants.id resolution.
 *
 * The activator knows only the URL subdomain at proxy time. tenant_activity.tenant_id
 * is a FK to tenants.id (not tenants.subdomain). The store must resolve the subdomain to
 * the opaque id before upserting, cache the result, and degrade gracefully when
 * the subdomain has no matching tenant row.
 *
 * Uses injected fake DB clients — no real Postgres connection required.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createTenantActivityStoreWithClient, type DbClient } from '../src/tenant-activity.js'

/** Build a fake DbClient. queries is called with (sql, params) for every db.query invocation. */
function makeDb(queries: (sql: string, params?: unknown[]) => { rows: Record<string, unknown>[] }): DbClient & { endCalled: boolean } {
  let endCalled = false
  return {
    async query(sql, params) {
      return queries(sql, params)
    },
    async end() {
      endCalled = true
    },
    get endCalled() {
      return endCalled
    },
  }
}

describe('TenantActivityStore', () => {
  it('first request for a subdomain performs a SELECT and then upserts using tenants.id', async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = []

    const db = makeDb((sql, params) => {
      calls.push({ sql, params })
      if (sql.includes('SELECT id FROM tenants')) {
        return { rows: [{ id: 'uuid-abc-123' }] }
      }
      // INSERT ... ON CONFLICT upsert
      return { rows: [] }
    })

    const store = createTenantActivityStoreWithClient({ db })
    await store.recordActivity('t-e895a46196df')

    // First call should be the SELECT
    assert.ok(calls[0] !== undefined, 'expected at least one query')
    assert.ok(calls[0].sql.includes('SELECT id FROM tenants'), 'first query must resolve subdomain to id')
    assert.deepEqual(calls[0].params, ['t-e895a46196df'])

    // Second call should be the upsert
    assert.ok(calls[1] !== undefined, 'expected upsert query')
    assert.ok(calls[1].sql.includes('INSERT INTO tenant_activity'), 'second query must be the upsert')
    // The upsert must use tenants.id, not the subdomain
    assert.deepEqual(calls[1].params, ['uuid-abc-123'], 'upsert must use tenants.id, not subdomain')
  })

  it('second request for the same subdomain hits the cache — no second SELECT', async () => {
    let selectCount = 0
    let upsertCount = 0

    const db = makeDb((sql) => {
      if (sql.includes('SELECT id FROM tenants')) {
        selectCount += 1
        return { rows: [{ id: 'uuid-abc-123' }] }
      }
      upsertCount += 1
      return { rows: [] }
    })

    const store = createTenantActivityStoreWithClient({ db })

    await store.recordActivity('t-e895a46196df')
    await store.recordActivity('t-e895a46196df')

    assert.equal(selectCount, 1, 'SELECT must only run once — second call must use cache')
    assert.equal(upsertCount, 2, 'both requests must upsert')
  })

  it('a subdomain that does not exist in tenants does not crash and does not call upsert', async () => {
    let upsertCalled = false

    const db = makeDb((sql) => {
      if (sql.includes('SELECT id FROM tenants')) {
        return { rows: [] }  // no matching tenant
      }
      upsertCalled = true
      return { rows: [] }
    })

    const store = createTenantActivityStoreWithClient({ db })

    // Must resolve without throwing
    await assert.doesNotReject(() => store.recordActivity('ghost-subdomain'))
    assert.equal(upsertCalled, false, 'upsert must not be called when tenant is not found')
  })

  it('concurrent first-hit requests for the same subdomain share a single SELECT', async () => {
    // Use a manually controlled deferred so we can fire two recordActivity calls
    // before the SELECT resolves, proving the second one waits on the same Promise
    // rather than issuing its own query.
    let resolveSelect!: (value: { rows: Record<string, unknown>[] }) => void
    const selectDeferred = new Promise<{ rows: Record<string, unknown>[] }>((resolve) => {
      resolveSelect = resolve
    })

    let selectCount = 0
    let upsertCount = 0

    const db: DbClient = {
      async query(sql) {
        if (sql.includes('SELECT id FROM tenants')) {
          selectCount += 1
          return selectDeferred
        }
        upsertCount += 1
        return { rows: [] }
      },
      async end() {},
    }

    const store = createTenantActivityStoreWithClient({ db })

    // Fire two concurrent calls without awaiting between them.
    const p1 = store.recordActivity('concurrent-subdomain')
    const p2 = store.recordActivity('concurrent-subdomain')

    // Unblock the SELECT — both outstanding calls should resolve with it.
    resolveSelect({ rows: [{ id: 'shared-tenant-id' }] })

    await Promise.all([p1, p2])

    assert.equal(selectCount, 1, 'both concurrent calls must share a single SELECT')
    assert.equal(upsertCount, 2, 'each call must still issue its own upsert')
  })

  it('the upsert uses tenants.id value, not the subdomain, as tenant_id', async () => {
    const upsertParams: unknown[][] = []

    const db = makeDb((sql, params) => {
      if (sql.includes('SELECT id FROM tenants')) {
        return { rows: [{ id: 'opaque-tenant-id-999' }] }
      }
      if (sql.includes('INSERT INTO tenant_activity')) {
        upsertParams.push(params ?? [])
      }
      return { rows: [] }
    })

    const store = createTenantActivityStoreWithClient({ db })
    await store.recordActivity('some-subdomain')

    assert.equal(upsertParams.length, 1, 'upsert should have been called once')
    // The first (and only) param to the upsert must be the id, not the subdomain
    assert.equal(upsertParams[0]?.[0], 'opaque-tenant-id-999', 'upsert param must be tenants.id')
    assert.notEqual(upsertParams[0]?.[0], 'some-subdomain', 'upsert must not use the subdomain as tenant_id')
  })

  it('the upsert sets seen_by_activator=TRUE in both VALUES and DO UPDATE SET (#364 guard)', async () => {
    // This is the hinge of the #364 fix: a backfilled tenant (seen_by_activator=FALSE)
    // must flip to TRUE on the first real activator write. If the DO UPDATE SET branch
    // is omitted, the tenant stays FALSE and is never eligible for scale-to-zero.
    let capturedUpsertSql = ''

    const db = makeDb((sql) => {
      if (sql.includes('SELECT id FROM tenants')) {
        return { rows: [{ id: 'tenant-id-abc' }] }
      }
      if (sql.includes('INSERT INTO tenant_activity')) {
        capturedUpsertSql = sql
      }
      return { rows: [] }
    })

    const store = createTenantActivityStoreWithClient({ db })
    await store.recordActivity('t-some-subdomain')

    // Values clause must include the column
    assert.ok(
      capturedUpsertSql.includes('seen_by_activator'),
      'upsert SQL must include seen_by_activator column',
    )

    // Must set TRUE in the INSERT VALUES list
    assert.ok(
      capturedUpsertSql.match(/VALUES\s*\([^)]*TRUE[^)]*\)/i) ??
      capturedUpsertSql.match(/VALUES\s*\(\$1::text,\s*CURRENT_TIMESTAMP,\s*TRUE\)/i),
      'VALUES clause must pass TRUE for seen_by_activator',
    )

    // Must set TRUE in the DO UPDATE SET branch (the hinge)
    const doUpdatePart = capturedUpsertSql.split(/DO UPDATE/i)[1] ?? ''
    assert.ok(
      doUpdatePart.includes('seen_by_activator') && doUpdatePart.includes('TRUE'),
      'DO UPDATE SET must also set seen_by_activator = TRUE (backfill-flip hinge)',
    )
  })
})

describe('TenantActivityStore.markReady (#385)', () => {
  it('resolves the subdomain, flips sleeping->ready guarded, and records the transition', async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = []

    const db = makeDb((sql, params) => {
      calls.push({ sql, params })
      if (sql.includes('SELECT id FROM tenants')) {
        return { rows: [{ id: 'uuid-woken' }] }
      }
      if (sql.includes('UPDATE tenants')) {
        // Tenant was sleeping — the guarded UPDATE transitions one row.
        return { rows: [{ id: 'uuid-woken' }] }
      }
      return { rows: [] } // state_transitions INSERT
    })

    const store = createTenantActivityStoreWithClient({ db })
    await store.markReady('sub-woken')

    assert.ok(calls[0]?.sql.includes('SELECT id FROM tenants'), 'first query resolves subdomain to id')

    const update = calls[1]
    assert.ok(update?.sql.includes('UPDATE tenants'), 'second query is the state UPDATE')
    assert.ok(update.sql.includes("current_state = 'ready'"), 'UPDATE sets current_state to ready')
    assert.ok(update.sql.includes("current_state = 'sleeping'"), 'UPDATE is guarded on the sleeping state')
    assert.ok(
      update.sql.includes("desired_state NOT IN ('deprovisioned', 'failed')"),
      'UPDATE must not resurrect a tenant mid-teardown (desired_state guard)',
    )
    assert.ok(update.sql.includes('RETURNING'), 'UPDATE uses RETURNING to detect whether it transitioned')
    assert.deepEqual(update.params, ['uuid-woken'], 'UPDATE keys on tenants.id, not the subdomain')

    const insert = calls[2]
    assert.ok(insert?.sql.includes('INSERT INTO state_transitions'), 'third query records the transition')
    assert.ok(insert.sql.includes("'sleeping', 'ready', 'activator'"), 'transition is sleeping->ready by activator')
    assert.deepEqual(insert.params, ['uuid-woken'])
  })

  it('does not record a transition when the tenant was not sleeping (no row updated)', async () => {
    let transitionInserted = false

    const db = makeDb((sql) => {
      if (sql.includes('SELECT id FROM tenants')) {
        return { rows: [{ id: 'uuid-already-ready' }] }
      }
      if (sql.includes('UPDATE tenants')) {
        return { rows: [] } // guard matched nothing — already ready / other state
      }
      if (sql.includes('INSERT INTO state_transitions')) {
        transitionInserted = true
      }
      return { rows: [] }
    })

    const store = createTenantActivityStoreWithClient({ db })
    await store.markReady('sub-already-ready')

    assert.equal(transitionInserted, false, 'no transition row when the guarded UPDATE changed nothing')
  })

  it('does not touch the registry when the subdomain has no tenant row', async () => {
    let mutated = false

    const db = makeDb((sql) => {
      if (sql.includes('SELECT id FROM tenants')) {
        return { rows: [] } // no matching tenant
      }
      if (sql.includes('UPDATE tenants') || sql.includes('INSERT INTO state_transitions')) {
        mutated = true
      }
      return { rows: [] }
    })

    const store = createTenantActivityStoreWithClient({ db })
    await assert.doesNotReject(() => store.markReady('ghost-subdomain'))
    assert.equal(mutated, false, 'unknown subdomain must not UPDATE or INSERT')
  })

  it('shares the subdomain->id cache with recordActivity (single SELECT)', async () => {
    let selectCount = 0

    const db = makeDb((sql) => {
      if (sql.includes('SELECT id FROM tenants')) {
        selectCount += 1
        return { rows: [{ id: 'uuid-shared' }] }
      }
      if (sql.includes('UPDATE tenants')) {
        return { rows: [{ id: 'uuid-shared' }] }
      }
      return { rows: [] }
    })

    const store = createTenantActivityStoreWithClient({ db })
    await store.recordActivity('sub-shared')
    await store.markReady('sub-shared')

    assert.equal(selectCount, 1, 'recordActivity and markReady must share one subdomain->id resolution')
  })
})

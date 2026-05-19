/**
 * Tests for TenantActivityStore slug → tenants.id resolution.
 *
 * The activator knows only the URL slug at proxy time. tenant_activity.tenant_id
 * is a FK to tenants.id (not tenants.slug). The store must resolve the slug to
 * the opaque id before upserting, cache the result, and degrade gracefully when
 * the slug has no matching tenant row.
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
  it('first request for a slug performs a SELECT and then upserts using tenants.id', async () => {
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
    assert.ok(calls[0].sql.includes('SELECT id FROM tenants'), 'first query must resolve slug to id')
    assert.deepEqual(calls[0].params, ['t-e895a46196df'])

    // Second call should be the upsert
    assert.ok(calls[1] !== undefined, 'expected upsert query')
    assert.ok(calls[1].sql.includes('INSERT INTO tenant_activity'), 'second query must be the upsert')
    // The upsert must use tenants.id, not the slug
    assert.deepEqual(calls[1].params, ['uuid-abc-123'], 'upsert must use tenants.id, not slug')
  })

  it('second request for the same slug hits the cache — no second SELECT', async () => {
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

  it('a slug that does not exist in tenants does not crash and does not call upsert', async () => {
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
    await assert.doesNotReject(() => store.recordActivity('ghost-slug'))
    assert.equal(upsertCalled, false, 'upsert must not be called when tenant is not found')
  })

  it('the upsert uses tenants.id value, not the slug, as tenant_id', async () => {
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
    await store.recordActivity('some-slug')

    assert.equal(upsertParams.length, 1, 'upsert should have been called once')
    // The first (and only) param to the upsert must be the id, not the slug
    assert.equal(upsertParams[0]?.[0], 'opaque-tenant-id-999', 'upsert param must be tenants.id')
    assert.notEqual(upsertParams[0]?.[0], 'some-slug', 'upsert must not use the slug as tenant_id')
  })
})

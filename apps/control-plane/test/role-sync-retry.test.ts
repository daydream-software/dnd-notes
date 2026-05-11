/**
 * Tests for the role-sync pending state (#201):
 *   1. Registry methods: markRoleSyncPending, markRoleSyncComplete,
 *      getPortalAccountsPendingRoleSync
 *   2. Middleware: marks pending at sweep entry, marks complete when all
 *      assignments succeed, leaves pending when any assignment fails
 *   3. Retry loop: idempotent (runs twice, ends complete), transient failure
 *      followed by success marks complete, 404 on KC client is a resolved slot
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { startRoleSyncRetryLoop } from '../src/role-sync-retry.js'
import { createTestTenantRegistry } from './tenant-registry-test-helpers.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePortalAccountParams(overrides?: Partial<{
  id: string
  email: string
  displayName: string
  keycloakSub: string | null
}>) {
  return {
    id: overrides?.id ?? 'account-1',
    email: overrides?.email ?? 'owner@example.com',
    displayName: overrides?.displayName ?? 'Owner',
    keycloakSub: overrides?.keycloakSub ?? null,
  }
}

type AssignFn = (userId: string, clientId: string, roleName: string) => Promise<void>

function makeAdminClient(assignFn: AssignFn = async () => {}) {
  return { assignClientRoleToUser: assignFn }
}

// Tick the retry loop manually by driving the setTimeout with fake timers.
// Because node:test does not expose fake timer control, we use a very short
// interval and let the real timer fire.
async function driveLoop(
  fn: () => Promise<ReturnType<typeof startRoleSyncRetryLoop>>,
  waitMs = 50,
): Promise<ReturnType<typeof startRoleSyncRetryLoop>> {
  const loop = await fn()

  await new Promise<void>((resolve) => setTimeout(resolve, waitMs))
  loop.stop()
  return loop
}

// ---------------------------------------------------------------------------
// Section 1 — Registry methods
// ---------------------------------------------------------------------------

describe('TenantRegistry role-sync methods', () => {
  it('markRoleSyncPending sets role_sync_status to pending', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()

    try {
      await tenantRegistry.createPortalAccount(makePortalAccountParams())
      const marked = await tenantRegistry.markRoleSyncPending('account-1')

      assert.equal(marked, true)

      const account = await tenantRegistry.getPortalAccount('account-1')

      assert.ok(account)
      assert.equal(account.roleSyncStatus, 'pending')
    } finally {
      await cleanup()
    }
  })

  it('markRoleSyncComplete sets role_sync_status to complete', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()

    try {
      await tenantRegistry.createPortalAccount(makePortalAccountParams())
      await tenantRegistry.markRoleSyncPending('account-1')
      const marked = await tenantRegistry.markRoleSyncComplete('account-1')

      assert.equal(marked, true)

      const account = await tenantRegistry.getPortalAccount('account-1')

      assert.ok(account)
      assert.equal(account.roleSyncStatus, 'complete')
    } finally {
      await cleanup()
    }
  })

  it('new portal accounts default to role_sync_status = complete', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()

    try {
      await tenantRegistry.createPortalAccount(makePortalAccountParams())
      const account = await tenantRegistry.getPortalAccount('account-1')

      assert.ok(account)
      assert.equal(account.roleSyncStatus, 'complete')
    } finally {
      await cleanup()
    }
  })

  it('getPortalAccountsPendingRoleSync returns only pending accounts with a keycloak_sub', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()

    try {
      // pending + has sub → should appear
      await tenantRegistry.createPortalAccount(makePortalAccountParams({ id: 'a1', email: 'a1@example.com', keycloakSub: 'kc-sub-1' }))
      await tenantRegistry.markRoleSyncPending('a1')

      // pending + no sub → should NOT appear
      await tenantRegistry.createPortalAccount(makePortalAccountParams({ id: 'a2', email: 'a2@example.com', keycloakSub: null }))
      await tenantRegistry.markRoleSyncPending('a2')

      // complete + has sub → should NOT appear
      await tenantRegistry.createPortalAccount(makePortalAccountParams({ id: 'a3', email: 'a3@example.com', keycloakSub: 'kc-sub-3' }))
      // (default is already complete)

      const pending = await tenantRegistry.getPortalAccountsPendingRoleSync()

      assert.equal(pending.length, 1)
      assert.equal(pending[0].id, 'a1')
    } finally {
      await cleanup()
    }
  })

  it('markRoleSyncPending returns false for a non-existent account', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()

    try {
      const result = await tenantRegistry.markRoleSyncPending('does-not-exist')

      assert.equal(result, false)
    } finally {
      await cleanup()
    }
  })

  it('linkPortalAccountKeycloakSub atomically sets role_sync_status to pending', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()

    try {
      await tenantRegistry.createPortalAccount(makePortalAccountParams({ id: 'a1', email: 'a1@example.com' }))

      // Confirm default is complete before the link
      const before = await tenantRegistry.getPortalAccount('a1')
      assert.ok(before)
      assert.equal(before.roleSyncStatus, 'complete')

      const linked = await tenantRegistry.linkPortalAccountKeycloakSub('a1', 'kc-sub-a1')

      // The returned account must already carry pending — no separate call needed
      assert.ok(linked)
      assert.equal(linked.roleSyncStatus, 'pending')

      // Re-read to confirm the DB row was written, not just an in-memory artifact
      const after = await tenantRegistry.getPortalAccount('a1')
      assert.ok(after)
      assert.equal(after.roleSyncStatus, 'pending')
    } finally {
      await cleanup()
    }
  })

  it('linkPortalAccountKeycloakSub called again with the same sub does not change an existing complete status', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()

    try {
      await tenantRegistry.createPortalAccount(makePortalAccountParams({ id: 'a1', email: 'a1@example.com' }))
      await tenantRegistry.linkPortalAccountKeycloakSub('a1', 'kc-sub-a1')

      // Simulate the sweep completing successfully
      await tenantRegistry.markRoleSyncComplete('a1')

      const afterComplete = await tenantRegistry.getPortalAccount('a1')
      assert.ok(afterComplete)
      assert.equal(afterComplete.roleSyncStatus, 'complete')

      // Second call with same sub — conditional UPDATE WHERE matches nothing (sub already set),
      // so the re-read path returns the current row without overwriting it
      const linkedAgain = await tenantRegistry.linkPortalAccountKeycloakSub('a1', 'kc-sub-a1')

      assert.ok(linkedAgain)
      assert.equal(linkedAgain.roleSyncStatus, 'complete')
    } finally {
      await cleanup()
    }
  })
})

// ---------------------------------------------------------------------------
// Section 2 — Retry loop correctness
// ---------------------------------------------------------------------------

describe('startRoleSyncRetryLoop', () => {
  it('marks an account complete when all tenant role assignments succeed', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()

    try {
      await tenantRegistry.createPortalAccount(
        makePortalAccountParams({ id: 'a1', email: 'a1@example.com', keycloakSub: 'kc-1' }),
      )
      await tenantRegistry.createTenant({
        id: 'tenant-1',
        slug: 'tenant-one',
        ownerId: 'a1',
        version: '1.0.0',
      })
      await tenantRegistry.markRoleSyncPending('a1')

      const assignCalls: Array<[string, string, string]> = []

      await driveLoop(async () =>
        startRoleSyncRetryLoop({
          tenantRegistry,
          keycloakAdminClient: makeAdminClient(async (userId, clientId, roleName) => {
            assignCalls.push([userId, clientId, roleName])
          }),
          baseIntervalMs: 10,
          maxIntervalMs: 100,
        }),
      )

      const account = await tenantRegistry.getPortalAccount('a1')

      assert.ok(account)
      assert.equal(account.roleSyncStatus, 'complete')
      assert.equal(assignCalls.length >= 1, true)
      assert.equal(assignCalls[0][0], 'kc-1')
      assert.equal(assignCalls[0][1], 'dnd-notes-tenant-tenant-1')
    } finally {
      await cleanup()
    }
  })

  it('is idempotent — running the loop twice with a succeeding admin client leaves account complete', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()

    try {
      await tenantRegistry.createPortalAccount(
        makePortalAccountParams({ id: 'a1', email: 'a1@example.com', keycloakSub: 'kc-1' }),
      )
      await tenantRegistry.createTenant({
        id: 'tenant-1',
        slug: 'tenant-one',
        ownerId: 'a1',
        version: '1.0.0',
      })
      await tenantRegistry.markRoleSyncPending('a1')

      let assignCallCount = 0

      const adminClient = makeAdminClient(async () => {
        assignCallCount++
      })

      // First loop run
      await driveLoop(async () =>
        startRoleSyncRetryLoop({
          tenantRegistry,
          keycloakAdminClient: adminClient,
          baseIntervalMs: 10,
          maxIntervalMs: 100,
        }),
      )

      const afterFirstRun = await tenantRegistry.getPortalAccount('a1')

      assert.ok(afterFirstRun)
      assert.equal(afterFirstRun.roleSyncStatus, 'complete')
      const callsAfterFirst = assignCallCount

      // Second loop run — account is already complete, no pending rows
      await driveLoop(async () =>
        startRoleSyncRetryLoop({
          tenantRegistry,
          keycloakAdminClient: adminClient,
          baseIntervalMs: 10,
          maxIntervalMs: 100,
        }),
      )

      const afterSecondRun = await tenantRegistry.getPortalAccount('a1')

      assert.ok(afterSecondRun)
      assert.equal(afterSecondRun.roleSyncStatus, 'complete')
      // No additional assigns because there are no pending rows
      assert.equal(assignCallCount, callsAfterFirst)
    } finally {
      await cleanup()
    }
  })

  it('leaves account pending when assignment fails, marks complete after subsequent successful tick', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()

    try {
      await tenantRegistry.createPortalAccount(
        makePortalAccountParams({ id: 'a1', email: 'a1@example.com', keycloakSub: 'kc-1' }),
      )
      await tenantRegistry.createTenant({
        id: 'tenant-1',
        slug: 'tenant-one',
        ownerId: 'a1',
        version: '1.0.0',
      })
      await tenantRegistry.markRoleSyncPending('a1')

      let callCount = 0

      // First loop: always-failing admin client
      await driveLoop(async () =>
        startRoleSyncRetryLoop({
          tenantRegistry,
          keycloakAdminClient: makeAdminClient(async () => {
            callCount++
            throw new Error('Simulated transient Keycloak error')
          }),
          baseIntervalMs: 10,
          maxIntervalMs: 100,
        }),
      )

      const afterFailedTick = await tenantRegistry.getPortalAccount('a1')

      assert.ok(afterFailedTick)
      assert.equal(afterFailedTick.roleSyncStatus, 'pending')
      assert.equal(callCount >= 1, true)

      // Second loop: succeeding admin client
      await driveLoop(async () =>
        startRoleSyncRetryLoop({
          tenantRegistry,
          keycloakAdminClient: makeAdminClient(async () => {}),
          baseIntervalMs: 10,
          maxIntervalMs: 100,
        }),
      )

      const afterSuccessfulTick = await tenantRegistry.getPortalAccount('a1')

      assert.ok(afterSuccessfulTick)
      assert.equal(afterSuccessfulTick.roleSyncStatus, 'complete')
    } finally {
      await cleanup()
    }
  })

  it('treats a 404 KeycloakAdminError as a resolved slot and marks complete when no other failures remain', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()

    try {
      await tenantRegistry.createPortalAccount(
        makePortalAccountParams({ id: 'a1', email: 'a1@example.com', keycloakSub: 'kc-1' }),
      )
      await tenantRegistry.createTenant({
        id: 'tenant-deprovisioned',
        slug: 'deprovisioned-tenant',
        ownerId: 'a1',
        version: '1.0.0',
      })
      await tenantRegistry.markRoleSyncPending('a1')

      // Import the error class dynamically to avoid circular-in-test issues
      const { KeycloakAdminError } = await import('../src/keycloak-admin-client.js')

      await driveLoop(async () =>
        startRoleSyncRetryLoop({
          tenantRegistry,
          keycloakAdminClient: makeAdminClient(async (_userId, clientId) => {
            if (clientId === 'dnd-notes-tenant-tenant-deprovisioned') {
              throw new KeycloakAdminError(404, `Client "${clientId}" not found`)
            }
          }),
          baseIntervalMs: 10,
          maxIntervalMs: 100,
        }),
      )

      const account = await tenantRegistry.getPortalAccount('a1')

      assert.ok(account)
      assert.equal(account.roleSyncStatus, 'complete')
    } finally {
      await cleanup()
    }
  })
})

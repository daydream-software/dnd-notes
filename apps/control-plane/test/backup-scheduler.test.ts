import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  nextScheduledTime,
  startBackupScheduler,
} from '../src/backup-scheduler.js'
import type { TenantBackupArtifact, TenantRestoreResult } from '../src/tenant-backup-runner.js'
import type { TenantBackupDispatcher } from '../src/tenant-backup-dispatcher.js'
import type { Tenant } from '../src/types.js'
import {
  createTestTenantRegistry,
} from './tenant-registry-test-helpers.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class FakeDispatcher implements TenantBackupDispatcher {
  calls: Array<{ tenantId: string }> = []
  errors: Map<string, Error> = new Map()
  capturedAt = '2026-05-18T03:00:01.000Z'

  async executeBackup(params: { tenant: Tenant }): Promise<TenantBackupArtifact> {
    this.calls.push({ tenantId: params.tenant.id })
    const err = this.errors.get(params.tenant.id)
    if (err) throw err
    return {
      tenantId: params.tenant.id,
      databaseName: params.tenant.storageReference ?? 'db',
      format: 'custom',
      location: `https://account.blob.core.windows.net/tenant-backups/${params.tenant.id}/backup.dump`,
      sha256: 'abc123',
      sizeBytes: 512,
      capturedAt: this.capturedAt,
    }
  }

  async executeRestore(): Promise<TenantRestoreResult> {
    throw new Error('Not implemented in FakeDispatcher')
  }
}

interface BlobEntry {
  name: string
  lastModified: Date
}

class FakeArtifactStore {
  blobs: BlobEntry[] = []
  deletedBlobs: string[] = []

  async listBlobsOlderThan(cutoff: Date): Promise<BlobEntry[]> {
    return this.blobs.filter((b) => b.lastModified < cutoff)
  }

  async deleteBlob(name: string): Promise<void> {
    this.deletedBlobs.push(name)
    this.blobs = this.blobs.filter((b) => b.name !== name)
  }
}

// ---------------------------------------------------------------------------
// nextScheduledTime unit tests
// ---------------------------------------------------------------------------

describe('nextScheduledTime', () => {
  it('returns the next 03:00 UTC when called before 03:00 today', () => {
    const from = new Date('2026-05-18T02:00:00.000Z')
    const next = nextScheduledTime('0 3 * * *', from)
    assert.equal(next.toISOString(), '2026-05-18T03:00:00.000Z')
  })

  it('advances to next day when called exactly at the scheduled time', () => {
    const from = new Date('2026-05-18T03:00:00.000Z')
    const next = nextScheduledTime('0 3 * * *', from)
    assert.equal(next.toISOString(), '2026-05-19T03:00:00.000Z')
  })

  it('advances to next day when called after the scheduled time', () => {
    const from = new Date('2026-05-18T04:00:00.000Z')
    const next = nextScheduledTime('0 3 * * *', from)
    assert.equal(next.toISOString(), '2026-05-19T03:00:00.000Z')
  })

  it('supports minute-level granularity (e.g. 30 4 * * *)', () => {
    const from = new Date('2026-05-18T04:29:00.000Z')
    const next = nextScheduledTime('30 4 * * *', from)
    assert.equal(next.toISOString(), '2026-05-18T04:30:00.000Z')
  })

  it('throws for invalid expressions', () => {
    assert.throws(
      () => nextScheduledTime('not-a-cron', new Date()),
      /invalid cron expression/i,
    )

    assert.throws(
      () => nextScheduledTime('99 3 * * *', new Date()),
      /invalid cron field/i,
    )
  })

  it('accepts wildcard in minute field', () => {
    const from = new Date('2026-05-18T02:15:00.000Z')
    const next = nextScheduledTime('* 3 * * *', from)
    // Wildcard minute = 0.
    assert.equal(next.toISOString(), '2026-05-18T03:00:00.000Z')
  })
})

// ---------------------------------------------------------------------------
// Scheduler integration tests with pg-mem registry
// ---------------------------------------------------------------------------

describe('startBackupScheduler', () => {
  it('calls dispatcher.executeBackup for each ready tenant on tick', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()

    try {
      await tenantRegistry.whenReady()

      await tenantRegistry.createTenant({
        id: 'tenant-a',
        slug: 'tenant-a',
        ownerId: 'owner-1',
        version: '1.0.0',
      })
      await tenantRegistry.updateTenantStorageReference('tenant-a', 'tenant_a_t_a')
      await tenantRegistry.updateTenantState('tenant-a', 'ready', 'test')

      await tenantRegistry.createTenant({
        id: 'tenant-b',
        slug: 'tenant-b',
        ownerId: 'owner-2',
        version: '1.0.0',
      })
      await tenantRegistry.updateTenantStorageReference('tenant-b', 'tenant_b_t_b')
      await tenantRegistry.updateTenantState('tenant-b', 'ready', 'test')

      const dispatcher = new FakeDispatcher()

      // now() returns a pre-tick time for the first two calls:
      //   call 0: validation in startBackupScheduler
      //   call 1: scheduleNext() → delay ≈ 50ms → tick fires
      // call 2+: post-tick → next scheduled 23h away, never fires in test window.
      let callCount = 0
      const preTick = new Date('2026-05-18T02:59:59.950Z')   // 50ms before 03:00
      const postTick = new Date('2026-05-18T04:00:00.000Z')  // 1h after 03:00

      const loop = startBackupScheduler({
        tenantRegistry,
        tenantBackupDispatcher: dispatcher,
        scheduleExpression: '0 3 * * *',
        now: () => (callCount++ < 2 ? preTick : postTick),
      })

      // Wait 300ms — the tick fires at ~50ms, next is 23h away.
      await new Promise<void>((resolve) => setTimeout(resolve, 300))
      loop.stop()

      const backupIds = dispatcher.calls.map((c) => c.tenantId).sort()
      assert.deepEqual(backupIds, ['tenant-a', 'tenant-b'])

      // Verify backup_catalog rows were written.
      const backupsA = await tenantRegistry.listTenantBackups('tenant-a')
      const backupsB = await tenantRegistry.listTenantBackups('tenant-b')
      assert.equal(backupsA.length, 1)
      assert.equal(backupsB.length, 1)
      assert.equal(backupsA[0]?.status, 'completed')
      assert.equal(backupsB[0]?.status, 'completed')
    } finally {
      await cleanup()
    }
  })

  it('skips tenants without a storage reference', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()

    try {
      await tenantRegistry.whenReady()

      // Tenant with no storageReference.
      await tenantRegistry.createTenant({
        id: 'tenant-noref',
        slug: 'tenant-noref',
        ownerId: 'owner-1',
        version: '1.0.0',
      })
      await tenantRegistry.updateTenantState('tenant-noref', 'ready', 'test')

      const dispatcher = new FakeDispatcher()
      let callCountNoRef = 0
      const loop = startBackupScheduler({
        tenantRegistry,
        tenantBackupDispatcher: dispatcher,
        scheduleExpression: '0 3 * * *',
        now: () =>
          callCountNoRef++ < 2
            ? new Date('2026-05-18T02:59:59.950Z')
            : new Date('2026-05-18T04:00:00.000Z'),
      })

      await new Promise<void>((resolve) => setTimeout(resolve, 300))
      loop.stop()

      assert.equal(dispatcher.calls.length, 0)
    } finally {
      await cleanup()
    }
  })

  it('continues backing up other tenants when one tenant backup fails', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()

    try {
      await tenantRegistry.whenReady()

      for (const id of ['tenant-fail', 'tenant-ok']) {
        await tenantRegistry.createTenant({
          id,
          slug: id,
          ownerId: 'owner-1',
          version: '1.0.0',
        })
        await tenantRegistry.updateTenantStorageReference(id, `tenant_${id.replace(/-/g, '_')}`)
        await tenantRegistry.updateTenantState(id, 'ready', 'test')
      }

      const dispatcher = new FakeDispatcher()
      dispatcher.errors.set('tenant-fail', new Error('pg_dump failed'))

      let callCount2 = 0
      const preTick2 = new Date('2026-05-18T02:59:59.950Z')
      const postTick2 = new Date('2026-05-18T04:00:00.000Z')
      const loop = startBackupScheduler({
        tenantRegistry,
        tenantBackupDispatcher: dispatcher,
        scheduleExpression: '0 3 * * *',
        now: () => (callCount2++ < 2 ? preTick2 : postTick2),
      })

      await new Promise<void>((resolve) => setTimeout(resolve, 300))
      loop.stop()

      // Both tenants should have been attempted.
      const attemptedIds = dispatcher.calls.map((c) => c.tenantId).sort()
      assert.deepEqual(attemptedIds, ['tenant-fail', 'tenant-ok'])

      // Failed tenant has a 'failed' backup row; ok tenant has 'completed'.
      const failedBackups = await tenantRegistry.listTenantBackups('tenant-fail')
      const okBackups = await tenantRegistry.listTenantBackups('tenant-ok')
      assert.equal(failedBackups[0]?.status, 'failed')
      assert.equal(okBackups[0]?.status, 'completed')
    } finally {
      await cleanup()
    }
  })

  it('does not back up tenants in non-ready states', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()

    try {
      await tenantRegistry.whenReady()

      // Provisioning tenant — should be skipped.
      await tenantRegistry.createTenant({
        id: 'tenant-prov',
        slug: 'tenant-prov',
        ownerId: 'owner-1',
        version: '1.0.0',
      })
      await tenantRegistry.updateTenantStorageReference('tenant-prov', 'tenant_prov_t_prov')
      // Leave currentState as 'pending' (default from createTenant).

      const dispatcher = new FakeDispatcher()
      let callCountNonReady = 0
      const loop = startBackupScheduler({
        tenantRegistry,
        tenantBackupDispatcher: dispatcher,
        scheduleExpression: '0 3 * * *',
        now: () =>
          callCountNonReady++ < 2
            ? new Date('2026-05-18T02:59:59.950Z')
            : new Date('2026-05-18T04:00:00.000Z'),
      })

      await new Promise<void>((resolve) => setTimeout(resolve, 300))
      loop.stop()

      assert.equal(dispatcher.calls.length, 0)
    } finally {
      await cleanup()
    }
  })

  it('stop() prevents subsequent ticks from firing', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()

    try {
      await tenantRegistry.whenReady()

      const dispatcher = new FakeDispatcher()
      // Schedule at a time far in the future so the tick never fires.
      const fakeNow = new Date('2026-05-18T00:00:00.000Z')
      const loop = startBackupScheduler({
        tenantRegistry,
        tenantBackupDispatcher: dispatcher,
        scheduleExpression: '0 23 * * *',
        now: () => fakeNow,
      })

      loop.stop()

      // Wait a bit — no tick should fire.
      await new Promise<void>((resolve) => setTimeout(resolve, 100))

      assert.equal(dispatcher.calls.length, 0)
    } finally {
      await cleanup()
    }
  })

  it('runs retention sweep after backup pass and deletes old blobs', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()

    try {
      await tenantRegistry.whenReady()

      await tenantRegistry.createTenant({
        id: 'tenant-ret',
        slug: 'tenant-ret',
        ownerId: 'owner-1',
        version: '1.0.0',
      })
      await tenantRegistry.updateTenantStorageReference('tenant-ret', 'tenant_ret_t_ret')
      await tenantRegistry.updateTenantState('tenant-ret', 'ready', 'test')

      const dispatcher = new FakeDispatcher()
      const fakeStore = new FakeArtifactStore()

      // Add a stale blob that should be deleted.
      fakeStore.blobs.push({
        name: 'tenant-ret/old-backup.dump',
        lastModified: new Date('2026-01-01T00:00:00.000Z'),
      })
      // Add a newer blob within retention window — should NOT be deleted.
      fakeStore.blobs.push({
        name: 'tenant-ret/recent-backup.dump',
        lastModified: new Date('2026-05-18T01:00:00.000Z'),
      })

      let callCountRet = 0
      const loop = startBackupScheduler({
        tenantRegistry,
        tenantBackupDispatcher: dispatcher,
        artifactStore: fakeStore as never,
        scheduleExpression: '0 3 * * *',
        retentionDays: 14,
        now: () =>
          callCountRet++ < 2
            ? new Date('2026-05-18T02:59:59.950Z')
            : new Date('2026-05-18T04:00:00.000Z'),
      })

      await new Promise<void>((resolve) => setTimeout(resolve, 300))
      loop.stop()

      // The old blob should be deleted.
      assert.ok(
        fakeStore.deletedBlobs.includes('tenant-ret/old-backup.dump'),
        'Expected old blob to be deleted',
      )
      // The recent blob should NOT be deleted (newer than cutoff).
      assert.ok(
        !fakeStore.deletedBlobs.includes('tenant-ret/recent-backup.dump'),
        'Expected recent blob to be retained',
      )
    } finally {
      await cleanup()
    }
  })

  it('throws at startup when the cron expression is invalid', () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()

    try {
      const dispatcher = new FakeDispatcher()
      assert.throws(
        () =>
          startBackupScheduler({
            tenantRegistry,
            tenantBackupDispatcher: dispatcher,
            scheduleExpression: 'not-valid',
            now: () => new Date(),
          }),
        /invalid cron expression/i,
      )
    } finally {
      void cleanup()
    }
  })
})

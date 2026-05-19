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

  it('backs up sleeping (scale-to-zero) tenants the same as ready tenants', async () => {
    // The backup runner connects directly to Postgres via the admin credential
    // and never touches the tenant pod, so a tenant scaled to zero replicas
    // (currentState === 'sleeping') must receive its nightly backup.
    const { tenantRegistry, cleanup } = createTestTenantRegistry()

    try {
      await tenantRegistry.whenReady()

      await tenantRegistry.createTenant({
        id: 'tenant-sleeping',
        slug: 'tenant-sleeping',
        ownerId: 'owner-1',
        version: '1.0.0',
      })
      await tenantRegistry.updateTenantStorageReference('tenant-sleeping', 'tenant_sleeping_t_sl')
      await tenantRegistry.updateTenantState('tenant-sleeping', 'ready', 'test')
      await tenantRegistry.updateTenantState('tenant-sleeping', 'sleeping', 'idle-scaler')

      const dispatcher = new FakeDispatcher()
      let callCountSleep = 0
      const loop = startBackupScheduler({
        tenantRegistry,
        tenantBackupDispatcher: dispatcher,
        scheduleExpression: '0 3 * * *',
        now: () =>
          callCountSleep++ < 2
            ? new Date('2026-05-18T02:59:59.950Z')
            : new Date('2026-05-18T04:00:00.000Z'),
      })

      await new Promise<void>((resolve) => setTimeout(resolve, 300))
      loop.stop()

      assert.equal(dispatcher.calls.length, 1)
      assert.equal(dispatcher.calls[0]?.tenantId, 'tenant-sleeping')
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

  it('throws at startup when cron has non-wildcard day/month/weekday fields', () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()

    try {
      const dispatcher = new FakeDispatcher()
      // "0 3 * * 0" is Sunday-only intent — must be rejected at boot.
      assert.throws(
        () =>
          startBackupScheduler({
            tenantRegistry,
            tenantBackupDispatcher: dispatcher,
            scheduleExpression: '0 3 * * 0',
            now: () => new Date(),
          }),
        /only daily schedules are supported/i,
      )
    } finally {
      void cleanup()
    }
  })

  it('retains the last-known blob when the backup for that tenant fails', async () => {
    // Regression for the inverted protectedPrefixes bug: readyTenants was used
    // to build protectedPrefixes, so a failed backup still "protected" the
    // prefix — which caused the retention sweep to delete the stale blob,
    // leaving the tenant with zero recoverable backups.
    const { tenantRegistry, cleanup } = createTestTenantRegistry()

    try {
      await tenantRegistry.whenReady()

      await tenantRegistry.createTenant({
        id: 'tenant-failret',
        slug: 'tenant-failret',
        ownerId: 'owner-1',
        version: '1.0.0',
      })
      await tenantRegistry.updateTenantStorageReference('tenant-failret', 'tenant_failret')
      await tenantRegistry.updateTenantState('tenant-failret', 'ready', 'test')

      const dispatcher = new FakeDispatcher()
      // Simulate a backup failure for this tenant.
      dispatcher.errors.set('tenant-failret', new Error('pg_dump timeout'))

      const fakeStore = new FakeArtifactStore()
      // The tenant's only blob is past the retention cutoff.
      fakeStore.blobs.push({
        name: 'tenant-failret/only-backup.dump',
        lastModified: new Date('2026-01-01T00:00:00.000Z'),
      })

      let callCountFailRet = 0
      const loop = startBackupScheduler({
        tenantRegistry,
        tenantBackupDispatcher: dispatcher,
        artifactStore: fakeStore as never,
        scheduleExpression: '0 3 * * *',
        retentionDays: 14,
        now: () =>
          callCountFailRet++ < 2
            ? new Date('2026-05-18T02:59:59.950Z')
            : new Date('2026-05-18T04:00:00.000Z'),
      })

      await new Promise<void>((resolve) => setTimeout(resolve, 300))
      loop.stop()

      // The stale blob MUST NOT be deleted: the backup failed, so deleting
      // it would leave the tenant with zero recoverable backups.
      assert.ok(
        !fakeStore.deletedBlobs.includes('tenant-failret/only-backup.dump'),
        'Stale blob must be retained when the backup for that tenant failed',
      )
      assert.ok(
        fakeStore.blobs.some((b) => b.name === 'tenant-failret/only-backup.dump'),
        'Stale blob must still be present in the store after a failed backup tick',
      )

      // The backup run should be marked failed in the catalog.
      const backups = await tenantRegistry.listTenantBackups('tenant-failret')
      assert.equal(backups[0]?.status, 'failed')
    } finally {
      await cleanup()
    }
  })

  it('marks backup_catalog location_deleted after a successful blob delete', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()

    try {
      await tenantRegistry.whenReady()

      await tenantRegistry.createTenant({
        id: 'tenant-purgemark',
        slug: 'tenant-purgemark',
        ownerId: 'owner-1',
        version: '1.0.0',
      })
      await tenantRegistry.updateTenantStorageReference(
        'tenant-purgemark',
        'tenant_purgemark',
      )
      await tenantRegistry.updateTenantState('tenant-purgemark', 'ready', 'test')

      // Seed a completed backup whose location URL ends with the blob name.
      const blobName = 'tenant-purgemark/2026-01-01T00-00-00-000Z-backup.dump'
      const blobUrl = `https://account.blob.core.windows.net/tenant-backups/${blobName}`
      await tenantRegistry.createBackupRun({
        id: 'backup-purgemark-stale',
        tenantId: 'tenant-purgemark',
        triggeredBy: 'test',
      })
      await tenantRegistry.markBackupRunCompleted('backup-purgemark-stale', {
        location: blobUrl,
      })

      const dispatcher = new FakeDispatcher()
      // Override the dispatcher location so a new blob from this tick doesn't
      // collide with the stale blob name above.
      dispatcher.capturedAt = '2026-05-18T03:00:01.000Z'

      const fakeStore = new FakeArtifactStore()
      // Register the stale blob as past the retention cutoff.
      fakeStore.blobs.push({
        name: blobName,
        lastModified: new Date('2026-01-01T00:00:00.000Z'),
      })

      let callCountPm = 0
      const loop = startBackupScheduler({
        tenantRegistry,
        tenantBackupDispatcher: dispatcher,
        artifactStore: fakeStore as never,
        scheduleExpression: '0 3 * * *',
        retentionDays: 14,
        now: () =>
          callCountPm++ < 2
            ? new Date('2026-05-18T02:59:59.950Z')
            : new Date('2026-05-18T04:00:00.000Z'),
      })

      await new Promise<void>((resolve) => setTimeout(resolve, 300))
      loop.stop()

      // The blob was deleted.
      assert.ok(
        fakeStore.deletedBlobs.includes(blobName),
        `Expected blob "${blobName}" to be deleted`,
      )

      // The catalog row should now have locationDeleted = true.
      const backups = await tenantRegistry.listTenantBackups('tenant-purgemark')
      const staleBackup = backups.find((b) => b.id === 'backup-purgemark-stale')
      assert.ok(staleBackup, 'Stale backup row must exist in the catalog')
      assert.equal(
        staleBackup.locationDeleted,
        true,
        'location_deleted must be true after the blob was deleted',
      )
    } finally {
      await cleanup()
    }
  })

  it('does NOT mark location_deleted when deleteBlob throws', async () => {
    // The backup for the tenant must SUCCEED so the prefix enters
    // successfullyBackedUpPrefixes and the retention sweep actually calls
    // deleteBlob (rather than hitting the "retain last known blob" branch).
    // deleteBlob then throws a transient error, and the catalog row must NOT
    // be marked location_deleted.
    const { tenantRegistry, cleanup } = createTestTenantRegistry()

    try {
      await tenantRegistry.whenReady()

      await tenantRegistry.createTenant({
        id: 'tenant-deletefail',
        slug: 'tenant-deletefail',
        ownerId: 'owner-1',
        version: '1.0.0',
      })
      await tenantRegistry.updateTenantStorageReference(
        'tenant-deletefail',
        'tenant_deletefail',
      )
      await tenantRegistry.updateTenantState('tenant-deletefail', 'ready', 'test')

      const blobName = 'tenant-deletefail/2026-01-01T00-00-00-000Z-backup.dump'
      const blobUrl = `https://account.blob.core.windows.net/tenant-backups/${blobName}`
      await tenantRegistry.createBackupRun({
        id: 'backup-deletefail-stale',
        tenantId: 'tenant-deletefail',
        triggeredBy: 'test',
      })
      await tenantRegistry.markBackupRunCompleted('backup-deletefail-stale', {
        location: blobUrl,
      })

      // Backup dispatcher succeeds — this puts the prefix into
      // successfullyBackedUpPrefixes, which allows the sweep to proceed past
      // the "retain last known blob" guard and actually call deleteBlob.
      const dispatcher = new FakeDispatcher()
      dispatcher.capturedAt = '2026-05-18T03:00:01.000Z'

      class ErroringArtifactStore extends FakeArtifactStore {
        override async deleteBlob(name: string): Promise<void> {
          throw new Error(`Transient Azure error deleting ${name}`)
        }
      }

      const fakeStore = new ErroringArtifactStore()
      // Stale blob: past retention cutoff and not the newest for the prefix
      // after a fresh backup succeeds this tick.
      fakeStore.blobs.push({
        name: blobName,
        lastModified: new Date('2026-01-01T00:00:00.000Z'),
      })

      let callCountDf = 0
      const loop = startBackupScheduler({
        tenantRegistry,
        tenantBackupDispatcher: dispatcher,
        artifactStore: fakeStore as never,
        scheduleExpression: '0 3 * * *',
        retentionDays: 14,
        now: () =>
          callCountDf++ < 2
            ? new Date('2026-05-18T02:59:59.950Z')
            : new Date('2026-05-18T04:00:00.000Z'),
      })

      await new Promise<void>((resolve) => setTimeout(resolve, 300))
      loop.stop()

      // deleteBlob was called (no "deleted" entry because it threw, but the
      // blob list is unchanged since the override doesn't remove it).
      assert.equal(
        fakeStore.deletedBlobs.length,
        0,
        'deleteBlob threw — blob must not appear in deletedBlobs list',
      )

      // Blob delete threw — the catalog row must NOT be marked deleted.
      const backups = await tenantRegistry.listTenantBackups('tenant-deletefail')
      const staleBackup = backups.find((b) => b.id === 'backup-deletefail-stale')
      assert.ok(staleBackup, 'Stale backup row must exist')
      assert.equal(
        staleBackup.locationDeleted,
        false,
        'location_deleted must remain false when deleteBlob threw',
      )
    } finally {
      await cleanup()
    }
  })
})

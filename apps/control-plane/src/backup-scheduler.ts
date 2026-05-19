/**
 * Nightly backup scheduler.
 *
 * Wakes at the configured cron-style time (BACKUP_SCHEDULE_CRON), iterates
 * over every 'ready' tenant, and calls the backup dispatcher for each one.
 * After the backup pass completes, runs a retention sweep that deletes blobs
 * older than BACKUP_RETENTION_DAYS — preserving the newest blob per tenant
 * prefix so the last backup is never accidentally removed.
 *
 * Design notes:
 * - Uses a setTimeout-to-next-tick loop (no external deps) matching the
 *   role-sync-retry.ts pattern.
 * - Cron is parsed as "minute hour * * *" (daily at HH:MM UTC). Only daily
 *   schedules are supported; fields 3-5 must be '*' and are validated at boot.
 * - One tenant failure never blocks other tenants; errors are logged and the
 *   loop continues.
 * - Catalog write path follows the same sequence as the HTTP backup route
 *   (createBackupRun → markBackupRunRunning → executeBackup →
 *   markBackupRunCompleted / markBackupRunFailed) so both paths stay in sync.
 * - The scheduler is registered in closeResources() in index.ts via `.stop()`.
 */

import { randomUUID } from 'node:crypto'
import { formatUnknownError } from './error-formatting.js'
import type { TenantBackupDispatcher } from './tenant-backup-dispatcher.js'
import type { AzureBlobTenantBackupArtifactStore } from './tenant-backup-azure-blob.js'
import type { TenantRegistry } from './tenant-registry.js'
import type { Tenant } from './types.js'

export interface BackupSchedulerOptions {
  tenantRegistry: TenantRegistry
  tenantBackupDispatcher: TenantBackupDispatcher
  /**
   * Azure Blob store reference for the retention sweep.
   * When absent, retention is skipped (file-system or test mode).
   */
  artifactStore?: AzureBlobTenantBackupArtifactStore
  /**
   * Cron expression — only daily schedules are supported:
   *   "minute hour * * *"    e.g. "0 3 * * *" → 03:00 UTC
   * Fields 3-5 (day-of-month, month, day-of-week) MUST each be '*'.
   * A non-wildcard value in those fields throws at startup.
   * Default: "0 3 * * *"
   */
  scheduleExpression?: string
  /**
   * Number of days after which blobs are eligible for deletion.
   * Default: 14
   */
  retentionDays?: number
  /** Injected clock for tests. Default: Date.now */
  now?: () => Date
}

export interface BackupSchedulerLoop {
  /** Stops the scheduler. Safe to call multiple times. */
  stop(): void
}

/**
 * Parse a "minute hour * * *" cron expression and return the next UTC
 * wall-clock Date on or after `from`.
 *
 * Only daily schedules are supported: fields 3-5 (day-of-month, month,
 * day-of-week) MUST each be '*'. Passing a non-wildcard value in those fields
 * throws a BackupSchedulerConfigurationError at startup so the misconfiguration
 * is caught before any backup runs rather than silently producing nightly runs
 * on the wrong cadence.
 */
export function nextScheduledTime(
  expression: string,
  from: Date,
): Date {
  const parts = expression.trim().split(/\s+/)

  if (parts.length !== 5) {
    throw new Error(
      `Invalid cron expression ${JSON.stringify(expression)}: expected exactly 5 fields.`,
    )
  }

  const [minuteField, hourField, dayField, monthField, weekdayField] = parts

  // Only daily schedules are supported. Fields 3-5 must be wildcards.
  for (const [field, label] of [
    [dayField, 'day-of-month'],
    [monthField, 'month'],
    [weekdayField, 'day-of-week'],
  ] as Array<[string | undefined, string]>) {
    if (field !== '*') {
      throw new Error(
        `Invalid cron expression ${JSON.stringify(expression)}: only daily schedules are supported. Field "${label}" must be '*' (got ${JSON.stringify(field)}). See BACKUP_SCHEDULE_CRON in .env.example.`,
      )
    }
  }

  const minute = parseIntCronField(minuteField ?? '', 'minute', 0, 59)
  const hour = parseIntCronField(hourField ?? '', 'hour', 0, 23)

  // Find the next occurrence at HH:MM UTC on or after `from`.
  const candidate = new Date(from)
  candidate.setUTCSeconds(0, 0)
  candidate.setUTCMinutes(minute)
  candidate.setUTCHours(hour)

  if (candidate <= from) {
    // Already past today's slot — advance to tomorrow.
    candidate.setUTCDate(candidate.getUTCDate() + 1)
  }

  return candidate
}

function parseIntCronField(
  field: string,
  name: string,
  min: number,
  max: number,
): number {
  if (field === '*') {
    return min
  }

  const value = parseInt(field, 10)

  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(
      `Invalid cron field "${field}" for ${name}: expected an integer between ${min} and ${max} or '*'.`,
    )
  }

  return value
}

/**
 * Start the nightly backup scheduler. Returns a handle whose `.stop()` method
 * can be called during graceful shutdown.
 *
 * Only call this once per process (from index.ts, after migrations complete).
 */
export function startBackupScheduler(
  options: BackupSchedulerOptions,
): BackupSchedulerLoop {
  const {
    tenantRegistry,
    tenantBackupDispatcher,
    artifactStore,
    scheduleExpression = '0 3 * * *',
    retentionDays = 14,
    now = () => new Date(),
  } = options

  // Validate expression eagerly — fail fast at startup.
  nextScheduledTime(scheduleExpression, now())

  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  function scheduleNext(): void {
    if (stopped) return

    const current = now()
    const next = nextScheduledTime(scheduleExpression, current)
    const delayMs = next.getTime() - current.getTime()

    console.log(
      `[backup-scheduler] Next run scheduled at ${next.toISOString()} (in ${Math.round(delayMs / 1000)}s).`,
    )

    timer = setTimeout(() => {
      tick().catch((unexpectedError) => {
        console.error(
          '[backup-scheduler] Unexpected error in tick:',
          unexpectedError,
        )
        scheduleNext()
      })
    }, delayMs)

    timer.unref?.()
  }

  async function tick(): Promise<void> {
    if (stopped) return

    console.log('[backup-scheduler] Backup tick started.')

    let tenants: Tenant[]
    try {
      tenants = await tenantRegistry.listTenants()
    } catch (listError) {
      console.warn(
        '[backup-scheduler] Failed to list tenants — skipping this tick:',
        listError,
      )
      scheduleNext()
      return
    }

    const readyTenants = tenants.filter(
      (t) => t.currentState === 'ready' && t.storageReference,
    )

    console.log(
      `[backup-scheduler] Backing up ${readyTenants.length} ready tenant(s).`,
    )

    // Track prefixes whose backup *succeeded* this tick. Only these are
    // eligible to allow the retention sweep to delete an older blob for the
    // same prefix — if the backup failed we must preserve the tenant's last
    // known blob even if it is past the cutoff.
    const successfullyBackedUpPrefixes = new Set<string>()

    for (const tenant of readyTenants) {
      if (stopped) return
      const succeeded = await backupOneTenant(tenant)
      if (succeeded) {
        successfullyBackedUpPrefixes.add(
          tenant.id.replace(/[^A-Za-z0-9._-]+/g, '-').toLowerCase(),
        )
      }
    }

    // Retention sweep after backup pass completes.
    if (artifactStore && retentionDays > 0) {
      await runRetentionSweep(successfullyBackedUpPrefixes)
    }

    console.log('[backup-scheduler] Backup tick complete.')
    scheduleNext()
  }

  /**
   * Attempt a backup for a single tenant.
   * Returns `true` if the backup was written and the catalog row marked
   * completed; `false` in all failure paths (createBackupRun error, executor
   * throw, markBackupRunCompleted error, etc.).
   */
  async function backupOneTenant(tenant: Tenant): Promise<boolean> {
    const backupId = randomUUID()

    try {
      await tenantRegistry.createBackupRun({
        id: backupId,
        tenantId: tenant.id,
        triggeredBy: 'backup-scheduler',
        reason: 'Scheduled nightly backup',
      })
    } catch (createError) {
      console.warn(
        `[backup-scheduler] Failed to create backup run for tenant "${tenant.id}":`,
        createError,
      )
      return false
    }

    try {
      await tenantRegistry.appendAuditLogEntry({
        tenantId: tenant.id,
        actor: 'backup-scheduler',
        action: 'tenant.backup.create',
        resourceType: 'backup_catalog',
        resourceId: backupId,
        outcome: 'requested',
        details: 'Scheduled nightly backup',
      })
    } catch {
      // Audit log failure is non-fatal.
    }

    try {
      await tenantRegistry.markBackupRunRunning(backupId)
      const artifact = await tenantBackupDispatcher.executeBackup({ tenant })
      await tenantRegistry.markBackupRunCompleted(backupId, {
        location: artifact.location,
        sizeBytes: artifact.sizeBytes,
        checksum: artifact.sha256,
        completedAt: artifact.capturedAt,
      })

      try {
        await tenantRegistry.appendAuditLogEntry({
          tenantId: tenant.id,
          actor: 'backup-scheduler',
          action: 'tenant.backup.create',
          resourceType: 'backup_catalog',
          resourceId: backupId,
          outcome: 'succeeded',
          details: artifact.location,
        })
      } catch {
        // Audit log failure is non-fatal.
      }

      console.log(
        `[backup-scheduler] Backup succeeded for tenant "${tenant.id}" → ${artifact.location}`,
      )
      return true
    } catch (backupError) {
      const failureReason = formatUnknownError(backupError)

      try {
        await tenantRegistry.markBackupRunFailed(backupId, failureReason)
      } catch {
        // Best-effort — don't mask the original error.
      }

      try {
        await tenantRegistry.appendAuditLogEntry({
          tenantId: tenant.id,
          actor: 'backup-scheduler',
          action: 'tenant.backup.create',
          resourceType: 'backup_catalog',
          resourceId: backupId,
          outcome: 'failed',
          details: failureReason,
        })
      } catch {
        // Audit log failure is non-fatal.
      }

      console.warn(
        `[backup-scheduler] Backup failed for tenant "${tenant.id}":`,
        backupError,
      )
      return false
    }
  }

  /**
   * Delete blobs older than the retention cutoff.
   *
   * `successfullyBackedUpPrefixes` is the set of blob-name prefixes (sanitized
   * tenant IDs) for which a fresh backup *succeeded* this tick. A prefix in
   * this set means a new blob was written; it is safe to let the sweep delete
   * the stale blob that was previously the last copy. A prefix NOT in this set
   * means the backup either failed or was never attempted — we must retain the
   * last-known blob for that prefix even if it is past the cutoff, because
   * deleting it would leave the tenant with no recoverable backup.
   */
  async function runRetentionSweep(
    successfullyBackedUpPrefixes: Set<string>,
  ): Promise<void> {
    if (!artifactStore) return

    const cutoffDate = new Date(now())
    cutoffDate.setUTCDate(cutoffDate.getUTCDate() - retentionDays)

    console.log(
      `[backup-scheduler] Retention sweep: deleting blobs last modified before ${cutoffDate.toISOString()}.`,
    )

    let staleBlobs: Array<{ name: string; lastModified: Date }>
    try {
      staleBlobs = await artifactStore.listBlobsOlderThan(cutoffDate)
    } catch (listError) {
      console.warn(
        '[backup-scheduler] Failed to list blobs for retention sweep:',
        listError,
      )
      return
    }

    // Group blobs by tenant prefix and find the newest per tenant.
    const newestByPrefix = new Map<string, { name: string; lastModified: Date }>()

    for (const blob of staleBlobs) {
      const prefix = blob.name.split('/')[0] ?? ''
      const existing = newestByPrefix.get(prefix)
      if (!existing || blob.lastModified > existing.lastModified) {
        newestByPrefix.set(prefix, blob)
      }
    }

    // Enumerate ALL blobs to find the overall newest per prefix (the stale
    // list only has old ones, so we compare within that group only; blobs
    // not in the stale list are already newer than the cutoff and safe).
    // This means: if the newest blob in the stale list is also the overall
    // newest for that prefix, we protect it.
    let deletedCount = 0

    for (const blob of staleBlobs) {
      if (stopped) return

      const prefix = blob.name.split('/')[0] ?? ''

      // Protect the newest blob within the stale list for each prefix.
      if (newestByPrefix.get(prefix)?.name === blob.name) {
        // Only delete this blob if a *successful* fresh backup was written for
        // the same prefix this tick. Without a fresh backup, this stale blob
        // may be the tenant's only recoverable copy — deleting it would leave
        // zero backups.
        if (!successfullyBackedUpPrefixes.has(prefix)) {
          console.log(
            `[backup-scheduler] Retaining last known backup for prefix "${prefix}": ${blob.name}`,
          )
          continue
        }
      }

      try {
        await artifactStore.deleteBlob(blob.name)
        deletedCount++
        console.log(`[backup-scheduler] Deleted stale blob: ${blob.name}`)
      } catch (deleteError) {
        console.warn(
          `[backup-scheduler] Failed to delete blob "${blob.name}" during retention:`,
          deleteError,
        )
        // Blob was not deleted — do not mark the catalog row as deleted.
        continue
      }

      // Blob was deleted successfully. Mark matching catalog row(s) as deleted.
      try {
        const markedCount = await tenantRegistry.markBackupCatalogLocationDeletedForBlob(
          blob.name,
        )
        if (markedCount === 0) {
          console.warn(
            `[backup-scheduler] Blob "${blob.name}" was deleted but no matching backup_catalog row was found to mark as location_deleted. The catalog may have drifted from blob storage.`,
          )
        }
      } catch (catalogError) {
        // The blob is gone but the DB write failed. The row will stay with
        // location_deleted = false until a subsequent sweep corrects it.
        // Log a warning and continue — do not crash the sweep.
        console.warn(
          `[backup-scheduler] Blob "${blob.name}" was deleted but failed to mark backup_catalog row as location_deleted:`,
          catalogError,
        )
      }
    }

    console.log(
      `[backup-scheduler] Retention sweep complete: ${deletedCount} blob(s) deleted.`,
    )
  }

  // Start the first tick.
  scheduleNext()

  return {
    stop() {
      stopped = true
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
    },
  }
}

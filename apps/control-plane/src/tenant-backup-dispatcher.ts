import type {
  PostgresTenantBackupRunner,
  TenantBackupArtifact,
  TenantRestoreResult,
} from './tenant-backup-runner.js'
import type { Tenant } from './types.js'

/**
 * Seam that the control plane uses to drive the underlying backup/restore work.
 *
 * Issue #89 owns the API + catalog/audit layer. Issue #100 owns the actual
 * pg_dump/pg_restore implementation. The dispatcher decouples those layers so
 * the control-plane API can:
 *   - Drive request validation, catalog row lifecycle, and tenant-state
 *     transitions without needing access to pg tooling.
 *   - Surface a clean 501 in environments where the runner isn't wired.
 *
 * Implementations must be idempotent w.r.t. catalog rows (i.e. they only do
 * the dump/restore — they do NOT write to backup_catalog/restore_log
 * directly). The control plane manages catalog state.
 */
export interface TenantBackupDispatcher {
  executeBackup(params: { tenant: Tenant }): Promise<TenantBackupArtifact>
  executeRestore(params: {
    tenant: Tenant
    backupLocation: string
  }): Promise<TenantRestoreResult>
}

/**
 * Thrown when the control plane is asked to dispatch a backup/restore in an
 * environment where no real runner has been wired (e.g. tests, dry-run
 * deploys). The API layer translates this to HTTP 501.
 */
export class BackupDispatchUnavailableError extends Error {
  constructor(message = 'Tenant backup runner is not configured.') {
    super(message)
    this.name = 'BackupDispatchUnavailableError'
  }
}

export class ThrowingTenantBackupDispatcher implements TenantBackupDispatcher {
  async executeBackup(): Promise<TenantBackupArtifact> {
    throw new BackupDispatchUnavailableError()
  }

  async executeRestore(): Promise<TenantRestoreResult> {
    throw new BackupDispatchUnavailableError()
  }
}

export function createPostgresTenantBackupDispatcher(
  runner: PostgresTenantBackupRunner,
): TenantBackupDispatcher {
  return {
    async executeBackup({ tenant }) {
      return runner.backupTenant(tenant)
    },
    async executeRestore({ tenant, backupLocation }) {
      return runner.restoreTenant({ tenant, backupLocation })
    },
  }
}

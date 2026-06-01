export const tenantStates = [
  'provisioning',
  'ready',
  'sleeping',
  'maintenance',
  'upgrading',
  'restoring',
  'failed',
  'deprovisioned',
] as const

export type TenantState = (typeof tenantStates)[number]

export const tenantStorageModes = [
  'unknown',
  'sqlite-pvc',
  'postgres-shared-user',
  'postgres-dedicated-user',
] as const

export type TenantStorageMode = (typeof tenantStorageModes)[number]

export const tenantStorageMigrationStatuses = [
  'not-started',
  'in-progress',
  'failed',
  'completed',
  'not-required',
] as const

export type TenantStorageMigrationStatus =
  (typeof tenantStorageMigrationStatuses)[number]

export interface Tenant {
  id: string
  slug: string
  subdomain: string | null
  ownerId: string
  displayName: string | null
  planTier: string | null
  /** @deprecated Phase 2 local-auth relic; will be removed once no callers send it. */
  initialAdminEmail: string | null
  desiredState: TenantState
  currentState: TenantState
  version: string
  storageReference: string | null
  createdAt: string
  updatedAt: string
}

export interface StateTransition {
  id: number
  tenantId: string
  fromState: TenantState
  toState: TenantState
  triggeredBy: string
  reason: string | null
  createdAt: string
}

export interface TenantListResponse {
  tenants: Tenant[]
}

export interface TenantDetailResponse {
  tenant: Tenant
  resources?: TenantProvisioningResources
}

export interface TenantProvisioningResources {
  namespace: string
  deploymentName: string
  serviceName: string
  pvcName: string | null
  configMapName: string
  secretName: string
  hostname: string
  databaseName: string
  image: string
}

export interface TenantProvisioningResponse {
  tenant: Tenant
  resources: TenantProvisioningResources
}

export interface TenantDeprovisionResponse {
  tenant: Tenant
  deprovisioned: true
}

export interface StateTransitionHistoryResponse {
  transitions: StateTransition[]
}

export interface FleetDependencyHealth {
  status: 'healthy' | 'disabled'
  details?: string
}

export interface FleetTenantBackupStatus {
  rawMetadata: string | null
  lastRestoreDrillAt: string | null
  lastRestoreDrillStatus: string | null
  backupId: string | null
  location: string | null
  lastBackupAt: string | null
  lastBackupStatus: string | null
  lastVerifiedAt: string | null
  lastVerificationStatus: BackupVerificationStatus | null
  sizeBytes: number | null
  checksum: string | null
  lastRestoreAt: string | null
  lastRestoreStatus: BackupRunStatus | null
}

export interface FleetTenantStatus {
  tenant: Tenant
  health: 'healthy' | 'attention'
  backup: FleetTenantBackupStatus
  latestTransition: StateTransition | null
  resources?: TenantProvisioningResources
}

export interface FleetStatusSummary {
  totalTenants: number
  tenantsByCurrentState: Record<TenantState, number>
  tenantsByDesiredState: Record<TenantState, number>
  tenantsByVersion: Record<string, number>
  tenantsWithBackup: number
  tenantsMissingBackup: number
  tenantsNeedingAttention: number
}

export interface FleetStatusResponse {
  generatedAt: string
  controlPlane: HealthResponse
  dependencies: {
    tenantRegistry: FleetDependencyHealth
    tenantProvisioning: FleetDependencyHealth
  }
  summary: FleetStatusSummary
  tenants: FleetTenantStatus[]
}

export interface TenantStorageSnapshot {
  tenantId: string
  currentState: TenantState
  desiredState: TenantState
  storageReference: string | null
  mode: TenantStorageMode
  migrationStatus: TenantStorageMigrationStatus
  lastMigrationFailure: string | null
  migrationUpdatedAt: string | null
}

export interface TenantStorageBackupReadiness extends FleetTenantBackupStatus {
  status: 'missing' | 'invalid' | 'ready'
  details: string
}

export interface TenantStorageStatus {
  tenantId: string
  currentState: TenantState
  desiredState: TenantState
  storageReference: string | null
  mode: TenantStorageMode
  migrationStatus: TenantStorageMigrationStatus
  lastMigrationFailure: string | null
  migrationUpdatedAt: string | null
  cutoverReady: boolean
  blockers: string[]
  backup: TenantStorageBackupReadiness
}

export interface TenantStorageStatusResponse {
  storage: TenantStorageStatus
}

export const portalBillingProviders = ['stripe', 'square', 'manual-review'] as const

export type PortalBillingProvider = (typeof portalBillingProviders)[number]

export const roleSyncStatuses = ['pending', 'complete'] as const
export type RoleSyncStatus = (typeof roleSyncStatuses)[number]

export interface PortalAccount {
  id: string
  email: string
  displayName: string
  billingEmail: string | null
  billingProvider: PortalBillingProvider | null
  keycloakSub: string | null
  roleSyncStatus: RoleSyncStatus
  createdAt: string
  updatedAt: string
}

export interface PortalPlan {
  id: string
  name: string
  priceLabel: string
  description: string
  features: string[]
}

export interface PortalCatalogResponse {
  defaultTenantVersion: string
  provisioningConfigured: boolean
  slugPolicy: {
    pattern: string
    maxLength: number
    example: string
  }
  plans: PortalPlan[]
  placeholders: {
    billingStatus: 'placeholder'
    teamInvites: 'coming-soon'
    usageAnalytics: 'coming-soon'
  }
}

export interface PortalTenantSummary {
  tenant: Tenant
  latestTransition: StateTransition | null
  backup: FleetTenantBackupStatus
  appUrl: string | null
  settingsPath: string
}

export interface PortalDashboardResponse {
  account: PortalAccount
  catalog: PortalCatalogResponse
  tenants: PortalTenantSummary[]
}

export interface PortalCreateTenantRequest {
  tenantName: string
  tenantSlug: string
  planTier: string
  paymentProvider: PortalBillingProvider
  billingEmail?: string
}

export interface PortalLogoutResponse {
  signedOut: true
}

export interface ErrorResponse {
  code?: string
  error: string
  details?: string
}

export interface HealthResponse {
  status: 'healthy'
  uptime: number
  version: string
}

export const backupRunStatuses = [
  'queued',
  'running',
  'completed',
  'failed',
  'canceled',
] as const

export type BackupRunStatus = (typeof backupRunStatuses)[number]

export const backupVerificationStatuses = ['passed', 'failed'] as const

export type BackupVerificationStatus =
  (typeof backupVerificationStatuses)[number]

export const auditOutcomes = ['requested', 'succeeded', 'failed'] as const

export type AuditOutcome = (typeof auditOutcomes)[number]

export interface BackupRun {
  id: string
  tenantId: string
  status: BackupRunStatus
  format: string
  location: string | null
  /**
   * True when the blob at `location` has been removed by the retention sweep.
   * The row is kept for audit; a deleted-blob backup cannot be restored.
   */
  locationDeleted: boolean
  sizeBytes: number | null
  checksum: string | null
  failureReason: string | null
  triggeredBy: string
  reason: string | null
  requestedAt: string
  startedAt: string | null
  completedAt: string | null
  lastVerifiedAt: string | null
  lastVerificationStatus: BackupVerificationStatus | null
  lastVerificationDetails: string | null
  scratchTarget: string | null
  createdAt: string
  updatedAt: string
}

export interface RestoreRun {
  id: string
  tenantId: string
  backupId: string | null
  backupLocation: string
  status: BackupRunStatus
  failureReason: string | null
  safetySnapshotId: string | null
  triggeredBy: string
  reason: string | null
  requestedAt: string
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface AuditLogEntry {
  id: string
  tenantId: string | null
  actor: string
  action: string
  resourceType: string
  resourceId: string | null
  outcome: AuditOutcome
  details: string | null
  createdAt: string
}

/**
 * Compact summary of the latest successful backup for a tenant. Used by fleet
 * status / storage status views so they don't have to fetch every catalog row.
 */
export interface TenantBackupSummary {
  backupId: string
  location: string | null
  lastBackupAt: string | null
  lastBackupStatus: 'succeeded'
  lastVerifiedAt: string | null
  lastVerificationStatus: BackupVerificationStatus | null
  sizeBytes: number | null
  checksum: string | null
}

export interface TenantRestoreSummary {
  restoreId: string
  backupId: string | null
  backupLocation: string
  status: BackupRunStatus
  requestedAt: string
  completedAt: string | null
  failureReason: string | null
}

export interface BackupRunResponse {
  backup: BackupRun
}

export interface BackupRunListResponse {
  backups: BackupRun[]
}

export interface RestoreRunResponse {
  restore: RestoreRun
}

export interface RestoreRunListResponse {
  restores: RestoreRun[]
}

export interface TenantAuditLogResponse {
  entries: AuditLogEntry[]
}

// ---------------------------------------------------------------------------
// Fleet rolling-update types (#415)
// ---------------------------------------------------------------------------

export type FleetRolloutStatus = 'running' | 'completed' | 'aborted' | 'failed'

export type FleetRolloutTenantStatus = 'pending' | 'succeeded' | 'failed' | 'skipped'

export interface FleetRollout {
  id: string
  targetVersion: string
  status: FleetRolloutStatus
  triggeredBy: string
  startedAt: string
  endedAt: string | null
  abortReason: string | null
  failedTenant: string | null
  failedError: string | null
  total: number
  completed: number
  failed: number
  skipped: number
  pending: number
  currentTenant: string | null
  elapsedSeconds: number
}

export interface FleetRolloutTenantRecord {
  rolloutId: string
  tenantId: string
  status: FleetRolloutTenantStatus
  reason: string | null
  startedAt: string | null
  endedAt: string | null
}

export interface StartFleetRolloutResponse {
  id: string
  status: FleetRolloutStatus
  startedAt: string
}

export interface AbortFleetRolloutResponse {
  status: 'aborted'
}

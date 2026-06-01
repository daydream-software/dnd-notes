export const tenantStates = [
  'provisioning',
  'ready',
  'maintenance',
  'upgrading',
  'restoring',
  'failed',
  'deprovisioned',
] as const

export type TenantState = (typeof tenantStates)[number]

export interface Tenant {
  id: string
  slug: string
  subdomain: string | null
  ownerId: string
  desiredState: TenantState
  currentState: TenantState
  version: string
  storageReference: string | null
  backupMetadata: string | null
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

export interface CreateTenantRequest {
  id: string
  slug: string
  ownerId: string
  version: string
}

export interface TenantDetailResponse {
  tenant: Tenant
}

export interface ProvisionTenantRequest {
  triggeredBy: string
  reason?: string
  version?: string
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

export interface DeprovisionTenantRequest {
  triggeredBy: string
  reason?: string
}

export interface TenantDeprovisionResponse {
  tenant: Tenant
  deprovisioned: true
}

export interface FleetDependencyHealth {
  status: 'healthy' | 'disabled'
  details?: string
}

export interface FleetTenantBackupStatus {
  rawMetadata: string | null
  location: string | null
  lastBackupAt: string | null
  lastBackupStatus: string | null
  lastRestoreDrillAt: string | null
  lastRestoreDrillStatus: string | null
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
  tenantsWithBackupMetadata: number
  tenantsMissingBackupMetadata: number
  tenantsNeedingAttention: number
}

export interface FleetStatusResponse {
  generatedAt: string
  controlPlane: {
    status: 'healthy'
    uptime: number
    version: string
  }
  dependencies: {
    tenantRegistry: FleetDependencyHealth
    tenantProvisioning: FleetDependencyHealth
  }
  summary: FleetStatusSummary
  tenants: FleetTenantStatus[]
}

export interface OperatorKeycloakConfig {
  url: string
  realm: string
  clientId: string
}

export interface ErrorResponse {
  code?: string
  error: string
  details?: string | string[]
}

// ---------------------------------------------------------------------------
// Fleet rollout types — mirrored from apps/control-plane/src/types.ts.
// Keep in sync with the server-side source; do not import across packages.
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

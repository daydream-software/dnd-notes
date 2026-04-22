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
  initialAdminEmail: string | null
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

export interface TenantListResponse {
  tenants: Tenant[]
}

export interface TenantDetailResponse {
  tenant: Tenant
}

export interface TenantProvisioningResources {
  namespace: string
  deploymentName: string
  serviceName: string
  pvcName: string
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
  controlPlane: HealthResponse
  dependencies: {
    tenantRegistry: FleetDependencyHealth
    tenantProvisioning: FleetDependencyHealth
  }
  summary: FleetStatusSummary
  tenants: FleetTenantStatus[]
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

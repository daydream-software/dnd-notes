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

export interface TenantStorageSnapshot {
  tenantId: string
  currentState: TenantState
  desiredState: TenantState
  storageReference: string | null
  backupMetadata: string | null
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

export interface PortalAccount {
  id: string
  email: string
  displayName: string
  billingEmail: string | null
  billingProvider: PortalBillingProvider | null
  authProvider: 'local' | 'keycloak'
  keycloakSub: string | null
  createdAt: string
  updatedAt: string
}

export interface PortalSession {
  id: string
  accountId: string
  tokenHash: string
  expiresAt: string
  createdAt: string
}

export interface PortalPlan {
  id: string
  name: string
  priceLabel: string
  description: string
  features: string[]
}

export interface PortalCatalogResponse {
  authMode: 'local' | 'keycloak'
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

export interface PortalSessionResponse {
  token: string
  dashboard: PortalDashboardResponse
}

export interface PortalSignupRequest {
  email: string
  displayName: string
  password: string
  billingEmail?: string
  paymentProvider: PortalBillingProvider
  tenantName: string
  tenantSlug: string
  planTier: string
  acceptTerms: true
}

export interface PortalLoginRequest {
  email: string
  password: string
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

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

export interface FleetTenantBackupStatus {
  rawMetadata: string | null
  location: string | null
  lastBackupAt: string | null
  lastBackupStatus: string | null
  lastRestoreDrillAt: string | null
  lastRestoreDrillStatus: string | null
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

export interface PortalAccount {
  id: string
  email: string
  displayName: string
  billingEmail: string | null
  billingProvider: 'stripe' | 'square' | 'manual-review' | null
  authProvider: 'local' | 'keycloak'
  keycloakSub: string | null
  createdAt: string
  updatedAt: string
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
  paymentProvider: 'stripe' | 'square' | 'manual-review'
  tenantName: string
  tenantSlug: string
  planTier: string
  acceptTerms: true
}

export interface PortalCreateTenantRequest {
  tenantName: string
  tenantSlug: string
  planTier: string
  paymentProvider: 'stripe' | 'square' | 'manual-review'
  billingEmail?: string
}

export interface PortalLoginRequest {
  email: string
  password: string
}

export interface PortalLogoutResponse {
  signedOut: true
}

export interface ErrorResponse {
  code?: string
  error: string
  details?: string | string[]
}

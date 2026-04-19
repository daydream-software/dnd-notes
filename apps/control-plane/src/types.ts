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

export interface TenantListResponse {
  tenants: Tenant[]
}

export interface TenantDetailResponse {
  tenant: Tenant
}

export interface StateTransitionHistoryResponse {
  transitions: StateTransition[]
}

export interface ErrorResponse {
  error: string
  details?: string
}

export interface HealthResponse {
  status: 'healthy'
  uptime: number
  version: string
}

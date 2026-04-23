import { TenantRegistry as PostgresTenantRegistryBackend } from './tenant-registry-postgres.js'
import type {
  PortalAccount,
  PortalBillingProvider,
  PortalSession,
  StateTransition,
  Tenant,
  TenantState,
} from './types.js'
import type { TenantRegistryPoolLike } from './tenant-registry-postgres.js'

interface TenantRegistryOptions {
  pool?: TenantRegistryPoolLike
}

export class TenantRegistry {
  private readonly backend: PostgresTenantRegistryBackend

  constructor(connectionString: string, options: TenantRegistryOptions = {}) {
    this.backend = new PostgresTenantRegistryBackend(connectionString, options)
  }

  async checkHealth(): Promise<void> {
    await this.backend.checkHealth()
  }

  async listTenants(): Promise<Tenant[]> {
    return await this.backend.listTenants()
  }

  async listTenantsByOwnerId(ownerId: string): Promise<Tenant[]> {
    return await this.backend.listTenantsByOwnerId(ownerId)
  }

  async getTenant(tenantId: string): Promise<Tenant | null> {
    return await this.backend.getTenant(tenantId)
  }

  async getTenantBySlug(slug: string): Promise<Tenant | null> {
    return await this.backend.getTenantBySlug(slug)
  }

  async getTenantBySubdomain(subdomain: string): Promise<Tenant | null> {
    return await this.backend.getTenantBySubdomain(subdomain)
  }

  async reserveTenantSubdomain(
    tenantId: string,
    createCandidate: () => string,
    maxAttempts = 10,
  ): Promise<string> {
    return await this.backend.reserveTenantSubdomain(
      tenantId,
      createCandidate,
      maxAttempts,
    )
  }

  async createTenant(params: {
    id: string
    slug: string
    ownerId: string
    displayName?: string
    planTier?: string
    initialAdminEmail?: string
    version: string
  }): Promise<Tenant> {
    return await this.backend.createTenant(params)
  }

  async deleteTenant(tenantId: string): Promise<void> {
    await this.backend.deleteTenant(tenantId)
  }

  async createPortalAccount(params: {
    id: string
    email: string
    displayName: string
    passwordHash?: string | null
    billingEmail?: string | null
    billingProvider?: PortalBillingProvider | null
    authProvider?: 'local' | 'keycloak'
    keycloakSub?: string | null
  }): Promise<PortalAccount> {
    return await this.backend.createPortalAccount(params)
  }

  async deletePortalAccount(accountId: string): Promise<void> {
    await this.backend.deletePortalAccount(accountId)
  }

  async getPortalAccount(accountId: string): Promise<PortalAccount | null> {
    return await this.backend.getPortalAccount(accountId)
  }

  async getPortalAccountByEmail(email: string): Promise<PortalAccount | null> {
    return await this.backend.getPortalAccountByEmail(email)
  }

  async getPortalAccountAuthByEmail(email: string): Promise<{
    account: PortalAccount
    passwordHash: string | null
  } | null> {
    return await this.backend.getPortalAccountAuthByEmail(email)
  }

  async updatePortalAccount(accountId: string, params: {
    displayName: string
    billingEmail?: string | null
    billingProvider?: PortalBillingProvider | null
  }): Promise<PortalAccount> {
    return await this.backend.updatePortalAccount(accountId, params)
  }

  async createPortalSession(params: {
    id: string
    accountId: string
    tokenHash: string
    expiresAt: string
  }): Promise<PortalSession> {
    return await this.backend.createPortalSession(params)
  }

  async getPortalSessionByTokenHash(tokenHash: string): Promise<PortalSession | null> {
    return await this.backend.getPortalSessionByTokenHash(tokenHash)
  }

  async deletePortalSessionByTokenHash(tokenHash: string): Promise<void> {
    await this.backend.deletePortalSessionByTokenHash(tokenHash)
  }

  async updateTenantState(
    tenantId: string,
    newState: TenantState,
    triggeredBy: string,
    reason?: string,
  ): Promise<void> {
    await this.backend.updateTenantState(tenantId, newState, triggeredBy, reason)
  }

  async updateTenantDesiredState(
    tenantId: string,
    desiredState: TenantState,
  ): Promise<void> {
    await this.backend.updateTenantDesiredState(tenantId, desiredState)
  }

  async updateTenantStorageReference(
    tenantId: string,
    storageReference: string | null,
  ): Promise<void> {
    await this.backend.updateTenantStorageReference(tenantId, storageReference)
  }

  async updateTenantSubdomain(tenantId: string, subdomain: string): Promise<void> {
    await this.backend.updateTenantSubdomain(tenantId, subdomain)
  }

  async updateTenantVersion(tenantId: string, version: string): Promise<void> {
    await this.backend.updateTenantVersion(tenantId, version)
  }

  async updateTenantBackupMetadata(
    tenantId: string,
    metadata: string,
  ): Promise<void> {
    await this.backend.updateTenantBackupMetadata(tenantId, metadata)
  }

  async getStateTransitions(tenantId: string): Promise<StateTransition[]> {
    return await this.backend.getStateTransitions(tenantId)
  }

  async getLatestStateTransitions(): Promise<Map<string, StateTransition>> {
    return await this.backend.getLatestStateTransitions()
  }

  async close(): Promise<void> {
    await this.backend.close()
  }
}

import {
  ApiException,
  KubeConfig,
  KubernetesObjectApi,
  type KubernetesObject,
  type V1ConfigMap,
  type V1DeleteOptions,
  type V1Deployment,
  type V1Ingress,
  type V1Namespace,
  type V1PodDisruptionBudget,
  type V1Secret,
  type V1Service,
  type V1ServicePort,
} from '@kubernetes/client-node'
import { createHash, randomBytes } from 'node:crypto'
import { Pool } from 'pg'
import {
  applyLeastPrivilegeTenantGrants,
  initializeTenantNoteStoreDatabase,
} from './tenant-database-bootstrap.js'
import { KeycloakAdminError, type KeycloakAdminClient } from './keycloak-admin-client.js'
import { assertPersistedTenantSubdomain } from './tenant-subdomain.js'
import type {
  Tenant,
  TenantDeprovisionResponse,
  TenantProvisioningResources,
  TenantProvisioningResponse,
} from './types.js'
import type { TenantRegistry, TenantRegistryClientLike } from './tenant-registry.js'

const opaqueSubdomainPrefix = 't'
const defaultTenantPort = 3000
export const defaultTenantReadyTimeoutMs = 240_000
const defaultReadyPollIntervalMs = 2_000
const defaultDeleteTimeoutMs = 120_000
const maxKubernetesLabelValueLength = 63
const containerImageTagPattern = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/

/**
 * Per-tenant client role used by the tenant API to gate access. The role is
 * created on the per-tenant Keycloak client (`dnd-notes-tenant-{tenantId}`)
 * at provision time and assigned to the tenant creator's Keycloak user. The
 * tenant API checks `resource_access[clientId].roles` for this role on every
 * authenticated request (#196).
 */
export const tenantMemberRoleName = 'tenant-member'

type KubernetesObjectClient = Pick<
  KubernetesObjectApi,
  'create' | 'delete' | 'read' | 'replace'
>

interface PostgresPoolLike {
  connect(): Promise<PostgresClientLike>
  end(): Promise<void>
}

interface PostgresClientLike {
  query<Row extends { [key: string]: unknown } = Record<string, never>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Row[] }>
  release(): void
}

interface TenantDatabase {
  databaseName: string
  roleName: string | null
  runtimeConnectionString: string
}

interface EnsureTenantDatabaseOptions {
  existingRuntimeConnectionString?: string | null
  requireExistingRuntimeConnectionString?: boolean
}

interface TenantDatabaseManager {
  ensureTenantDatabase(
    tenant: Tenant,
    subdomain: string,
    options?: EnsureTenantDatabaseOptions,
  ): Promise<TenantDatabase>
  deleteTenantDatabase(tenant: Tenant, subdomain: string): Promise<void>
  close(): Promise<void>
}

interface TenantInfrastructureBundle {
  namespace: V1Namespace
  configMap: V1ConfigMap
  secret: V1Secret
  podDisruptionBudget?: V1PodDisruptionBudget
  service: V1Service
  ingress: V1Ingress
  deployment: V1Deployment
  resources: TenantProvisioningResources
}

interface TenantInfrastructureManager {
  applyTenantResources(bundle: TenantInfrastructureBundle): Promise<void>
  getTenantRuntimeConnectionString(
    resources: TenantProvisioningResources,
  ): Promise<string | null>
  waitForTenantReady(
    resources: TenantProvisioningResources,
    timeoutMs?: number,
  ): Promise<void>
  deleteTenantResources(resources: TenantProvisioningResources): Promise<void>
}

export interface TenantProvisioningPort {
  provisionTenant(params: {
    tenantId: string
    triggeredBy: string
    reason?: string
    version?: string
  }): Promise<TenantProvisioningResponse>
  deprovisionTenant(params: {
    tenantId: string
    triggeredBy: string
    reason?: string
  }): Promise<TenantDeprovisionResponse>
  getTenantResources(tenant: Tenant): TenantProvisioningResources
  close(): Promise<void>
}

export type TenantProvisioningErrorCode =
  | 'invalid_target_version'
  | 'unsupported_target_version'
  | 'tenant_rollout_in_progress'
  | 'tenant_rollout_disallowed'
  | 'tenant_rollout_failed'

interface TenantProvisioningServiceOptions {
  tenantRegistry: TenantRegistry
  infrastructureManager: TenantInfrastructureManager
  databaseManager: TenantDatabaseManager
  tenantRuntimeAuth?: TenantRuntimeAuthConfig
  /** Optional Keycloak admin client. When provided, a per-tenant Keycloak client is created on provision and deleted on deprovision. When absent, the step is silently skipped. */
  keycloakAdminClient?: KeycloakAdminClient
  baseDomain: string
  ingressClassName?: string
  imageRepository: string
  imagePullSecretName?: string
  publicScheme?: 'http' | 'https'
  tenantPort?: number
  readyTimeoutMs?: number
  controlPlaneToken?: string
  /** cert-manager ClusterIssuer name for TLS on tenant ingresses (e.g. 'dev-ca' in k3d, 'letsencrypt-prod' in hosted). When undefined, no TLS annotation or spec.tls block is added (back-compat with setups without cert-manager). */
  tlsClusterIssuer?: string
}

interface BuildTenantInfrastructureBundleOptions {
  tenant: Tenant
  subdomain: string
  database: TenantDatabase
  tenantRuntimeAuth?: TenantRuntimeAuthConfig
  baseDomain: string
  ingressClassName?: string
  imageRepository: string
  imagePullSecretName?: string
  publicScheme: 'http' | 'https'
  tenantPort: number
  controlPlaneToken?: string
  /** cert-manager ClusterIssuer name for TLS on the tenant ingress. When undefined, no TLS configuration is applied. */
  tlsClusterIssuer?: string
}

export class TenantProvisioningValidationError extends Error {
  readonly code: TenantProvisioningErrorCode

  constructor(
    message: string,
    code: TenantProvisioningErrorCode = 'invalid_target_version',
  ) {
    super(message)
    this.name = 'TenantProvisioningValidationError'
    this.code = code
  }
}

export class TenantProvisioningConflictError extends Error {
  readonly code: TenantProvisioningErrorCode

  constructor(message: string, code: TenantProvisioningErrorCode) {
    super(message)
    this.name = 'TenantProvisioningConflictError'
    this.code = code
  }
}

interface TenantRuntimeAuthConfig {
  keycloakJwksUrl?: string
  keycloakRealm?: string
  keycloakUrl?: string
}

function normalizeTenantVersionOverride(version?: string): string | undefined {
  if (version === undefined) {
    return undefined
  }

  const normalizedVersion = version.trim()

  if (normalizedVersion.length === 0) {
    throw new TenantProvisioningValidationError(
      'Tenant version must be a non-empty string',
    )
  }

  if (!containerImageTagPattern.test(normalizedVersion)) {
    throw new TenantProvisioningValidationError(
      'Tenant version must be a valid container image tag',
    )
  }

  return normalizedVersion
}

export class TenantProvisioningService implements TenantProvisioningPort {
  private readonly tenantRegistry: TenantRegistry
  private readonly infrastructureManager: TenantInfrastructureManager
  private readonly databaseManager: TenantDatabaseManager
  private readonly tenantRuntimeAuth: TenantRuntimeAuthConfig | undefined
  private readonly keycloakAdminClient?: KeycloakAdminClient
  private readonly baseDomain: string
  private readonly ingressClassName: string
  private readonly imageRepository: string
  private readonly imagePullSecretName?: string
  private readonly publicScheme: 'http' | 'https'
  private readonly tenantPort: number
  private readonly readyTimeoutMs: number
  private readonly controlPlaneToken?: string
  private readonly tlsClusterIssuer?: string

  constructor(options: TenantProvisioningServiceOptions) {
    this.tenantRegistry = options.tenantRegistry
    this.infrastructureManager = options.infrastructureManager
    this.databaseManager = options.databaseManager
    this.tenantRuntimeAuth = options.tenantRuntimeAuth
    this.keycloakAdminClient = options.keycloakAdminClient
    this.baseDomain = options.baseDomain
    this.ingressClassName = options.ingressClassName ?? 'nginx'
    this.imageRepository = options.imageRepository
    this.imagePullSecretName = options.imagePullSecretName
    this.publicScheme = options.publicScheme ?? 'https'
    this.tenantPort = options.tenantPort ?? defaultTenantPort
    this.readyTimeoutMs = options.readyTimeoutMs ?? defaultTenantReadyTimeoutMs
    this.controlPlaneToken = options.controlPlaneToken
    this.tlsClusterIssuer = options.tlsClusterIssuer
  }

  getTenantResources(tenant: Tenant): TenantProvisioningResources {
    if (!tenant.subdomain) {
      throw new Error(`Tenant ${tenant.id} has no subdomain; resources cannot be derived.`)
    }

    return buildTenantResourceNames({
      tenant,
      subdomain: tenant.subdomain,
      baseDomain: this.baseDomain,
      imageRepository: this.imageRepository,
    })
  }

  async provisionTenant(params: {
    tenantId: string
    triggeredBy: string
    reason?: string
    version?: string
  }): Promise<TenantProvisioningResponse> {
    const requestedVersion = normalizeTenantVersionOverride(params.version)
    return this.tenantRegistry.withTenantLock(params.tenantId, async (registryClient) => {
      const tenant = await this.getExistingTenant(params.tenantId, registryClient)
      const isExistingRolloutState =
        tenant.currentState === 'ready' ||
        tenant.currentState === 'upgrading' ||
        tenant.currentState === 'maintenance' ||
        tenant.currentState === 'restoring'

      const isVersionRollout =
        requestedVersion !== undefined && requestedVersion !== tenant.version


      if (requestedVersion !== undefined && tenant.currentState === 'upgrading') {
        throw new TenantProvisioningConflictError(
          `Tenant ${tenant.id} already has a rolling update in progress. Wait for it to return to ready before starting another rollout.`,
          'tenant_rollout_in_progress',
        )
      }

      if (isVersionRollout && tenant.currentState !== 'ready' && tenant.currentState !== 'deprovisioned' && tenant.currentState !== 'failed') {
        throw new TenantProvisioningConflictError(
          `Tenant ${tenant.id} cannot start a rolling update from state ${tenant.currentState}. Rolling updates are only supported for ready tenants.`,
          'tenant_rollout_disallowed',
        )
      }

      if (
        requestedVersion !== undefined &&
        requestedVersion === tenant.version &&
        isExistingRolloutState
      ) {
        throw new TenantProvisioningValidationError(
          `Tenant ${tenant.id} is already running version ${tenant.version}. Choose a different target version for a rolling update.`,
          'unsupported_target_version',
        )
      }

      if (requestedVersion !== undefined && requestedVersion !== tenant.version) {
        await this.tenantRegistry.updateTenantVersion(
          tenant.id,
          requestedVersion,
          registryClient,
        )
      }

      const refreshedTenant = await this.getExistingTenant(tenant.id, registryClient)
      const hadPersistedSubdomain = refreshedTenant.subdomain != null
      const shouldMarkUpgrading =
        isVersionRollout &&
        hadPersistedSubdomain &&
        refreshedTenant.currentState === 'ready'

      const shouldMarkProvisioning =
        !hadPersistedSubdomain ||
        refreshedTenant.currentState === 'deprovisioned' ||
        refreshedTenant.currentState === 'failed'

      try {
        await this.tenantRegistry.updateTenantDesiredState(
          refreshedTenant.id,
          'ready',
          registryClient,
        )
        if (shouldMarkUpgrading) {
          await this.tenantRegistry.updateTenantState(
            refreshedTenant.id,
            'upgrading',
            params.triggeredBy,
            params.reason ?? 'Tenant rolling update started',
            registryClient,
          )
        } else if (shouldMarkProvisioning) {
          await this.tenantRegistry.updateTenantState(
            refreshedTenant.id,
            'provisioning',
            params.triggeredBy,
            params.reason ?? 'Tenant provisioning started',
            registryClient,
          )
        }
        const subdomain = assertPersistedTenantSubdomain(
          refreshedTenant.id,
          await this.tenantRegistry.reserveTenantSubdomain(
            refreshedTenant.id,
            () => this.createOpaqueSubdomainCandidate(),
            10,
            registryClient,
          ),
          'provisioning tenant resources',
        )
        const existingResources = buildTenantResourceNames({
          tenant: await this.getExistingTenant(refreshedTenant.id, registryClient),
          subdomain,
          baseDomain: this.baseDomain,
          imageRepository: this.imageRepository,
        })
        const existingRuntimeConnectionString = hadPersistedSubdomain
          ? await this.infrastructureManager.getTenantRuntimeConnectionString(
              existingResources,
            )
          : null
        const wasSuccessfullyProvisioned =
          refreshedTenant.currentState === 'ready' ||
          refreshedTenant.currentState === 'upgrading' ||
          refreshedTenant.currentState === 'maintenance' ||
          refreshedTenant.currentState === 'restoring'
        const database = await this.databaseManager.ensureTenantDatabase(
          refreshedTenant,
          subdomain,
          {
            existingRuntimeConnectionString,
            requireExistingRuntimeConnectionString: wasSuccessfullyProvisioned,
          },
        )

        const bundle = buildTenantInfrastructureBundle({
          tenant: await this.getExistingTenant(refreshedTenant.id, registryClient),
          subdomain,
          database,
          tenantRuntimeAuth: this.tenantRuntimeAuth,
          baseDomain: this.baseDomain,
          ingressClassName: this.ingressClassName,
          imageRepository: this.imageRepository,
          imagePullSecretName: this.imagePullSecretName,
          publicScheme: this.publicScheme,
          tenantPort: this.tenantPort,
          controlPlaneToken: this.controlPlaneToken,
          tlsClusterIssuer: this.tlsClusterIssuer,
        })
        const currentStorage = await this.tenantRegistry.getTenantStorageSnapshot(
          refreshedTenant.id,
          registryClient,
        )
        if (!currentStorage) {
          throw new Error(`Tenant ${refreshedTenant.id} not found`)
        }
        const nextStorageMode =
          database.roleName === null
            ? 'postgres-shared-user'
            : 'postgres-dedicated-user'
        const shouldInitializeNotRequiredMigrationStatus =
          nextStorageMode === 'postgres-dedicated-user' &&
          currentStorage.mode === 'unknown' &&
          currentStorage.migrationStatus === 'not-started' &&
          currentStorage.lastMigrationFailure === null &&
          refreshedTenant.storageReference === null

        await this.tenantRegistry.updateTenantStorageReference(
          refreshedTenant.id,
          database.databaseName,
          registryClient,
        )
        await this.tenantRegistry.updateTenantStorageProfile(
          refreshedTenant.id,
          {
            mode: nextStorageMode,
            migrationStatus: shouldInitializeNotRequiredMigrationStatus
              ? 'not-required'
              : currentStorage.migrationStatus,
            failureReason: shouldInitializeNotRequiredMigrationStatus
              ? null
              : currentStorage.lastMigrationFailure,
          },
          registryClient,
        )

        // Ensure a per-tenant Keycloak client exists before the SPA pod boots.
        // The KC step runs before applyTenantResources so the client is in place
        // when the pod first initialises. Failure here is intentionally fatal for
        // provisioning — the tenant SPA cannot authenticate without it.
        //
        if (this.keycloakAdminClient) {
          const hostname = bundle.resources.hostname
          const tenantClientId = `dnd-notes-tenant-${refreshedTenant.id}`
          await this.keycloakAdminClient.ensureClient({
            clientId: tenantClientId,
            enabled: true,
            publicClient: true,
            standardFlowEnabled: true,
            implicitFlowEnabled: false,
            // Direct-access grants stay enabled for local dev tooling (e.g.
            // manual token inspection) but are not used by the smoke test or the
            // SPA. The smoke fetches tenant tokens via the auth-code + PKCE flow;
            // the SPA negotiates PKCE via keycloak-js at runtime. Server-side
            // PKCE enforcement (pkce.code.challenge.method) is now active — any
            // token request without a valid code_verifier will be rejected.
            directAccessGrantsEnabled: true,
            redirectUris: [
              `https://${hostname}/*`,
              `http://${hostname}/*`,
            ],
            webOrigins: [
              `https://${hostname}`,
              `http://${hostname}`,
            ],
            attributes: {
              'pkce.code.challenge.method': 'S256',
              // Always include tenant_display_name so that flipping displayName
              // non-null -> null on re-sync clears the stale Keycloak attribute.
              // The FTL template guards with `?has_content`, which treats an
              // empty string as falsy -- the heading falls back to
              // "Sign in to D&D Notes" when displayName is null (#248).
              tenant_display_name: refreshedTenant.displayName ?? '',
            },
          })

          // Create the per-tenant member role on the per-tenant client. The
          // tenant API gates access on this role (#196) and the absence of it
          // for an otherwise valid Keycloak token returns 403. Failure here
          // is fatal for the same reason ensureClient is fatal — the tenant
          // is unusable in keycloak mode without it.
          await this.keycloakAdminClient.ensureClientRole(
            tenantClientId,
            tenantMemberRoleName,
          )

          // Assign the role to the tenant creator's Keycloak user so the
          // first member can actually access the tenant.
          //
          // Resolution order:
          //   1. portal_account.keycloak_sub — the canonical link, populated
          //      after the customer signs in through the portal Keycloak
          //      flow at least once.
          //   2. tenant.initialAdminEmail — admin-created tenants (control-
          //      plane API or operator portal) record the intended owner's
          //      email at create time. We resolve it to a Keycloak user id
          //      via the admin REST API. This is the path the k3d smoke
          //      and operator-portal flows depend on, since they create the
          //      tenant before any portal sign-in has produced a sub.
          //
          // If neither resolution yields a user, or if the email lookup
          // returns more than one Keycloak user (ambiguous match in realms
          // that allow duplicate emails), the assignment is deferred to the
          // portal middleware, which retries the sweep on first Keycloak
          // login (#200 transition path). Skipping is safe — re-provisioning
          // after the owner has signed in once will pick up the sub via the
          // canonical portal_account.keycloak_sub link and assign the role.
          const ownerKeycloakSub = await this.resolveTenantOwnerKeycloakSub(
            refreshedTenant,
            registryClient,
          )

          if (ownerKeycloakSub) {
            await this.keycloakAdminClient.assignClientRoleToUser(
              ownerKeycloakSub,
              tenantClientId,
              tenantMemberRoleName,
            )
          }
        }

        await this.infrastructureManager.applyTenantResources(bundle)
        await this.infrastructureManager.waitForTenantReady(
          bundle.resources,
          this.readyTimeoutMs,
        )

        const currentTenant = await this.getExistingTenant(
          refreshedTenant.id,
          registryClient,
        )
        if (currentTenant.currentState !== 'ready') {
          await this.tenantRegistry.updateTenantState(
            refreshedTenant.id,
            'ready',
            params.triggeredBy,
            params.reason ?? 'Tenant resources provisioned',
            registryClient,
          )
        }

        return {
          tenant: await this.getExistingTenant(refreshedTenant.id, registryClient),
          resources: bundle.resources,
        }
      } catch (error) {
        const failedTenant = await this.getExistingTenant(
          refreshedTenant.id,
          registryClient,
        )
        if (failedTenant.currentState !== 'failed') {
          await this.tenantRegistry.updateTenantState(
            refreshedTenant.id,
            'failed',
            params.triggeredBy,
            params.reason ?? 'Tenant provisioning failed',
            registryClient,
          )
        }
        throw error
      }
    })
  }

  async deprovisionTenant(params: {
    tenantId: string
    triggeredBy: string
    reason?: string
  }): Promise<TenantDeprovisionResponse> {
    return this.tenantRegistry.withTenantLock(params.tenantId, async (registryClient) => {
      const tenant = await this.getExistingTenant(params.tenantId, registryClient)

      if (tenant.currentState === 'deprovisioned') {
        return {
          tenant,
          deprovisioned: true,
        }
      }

      if (tenant.subdomain != null) {
        const subdomain = assertPersistedTenantSubdomain(
          tenant.id,
          tenant.subdomain,
          'deprovisioning tenant resources',
        )
        const resources = buildTenantResourceNames({
          tenant,
          subdomain,
          baseDomain: this.baseDomain,
          imageRepository: this.imageRepository,
        })

        await this.infrastructureManager.deleteTenantResources(resources)
        await this.databaseManager.deleteTenantDatabase(tenant, subdomain)
      }

      if (tenant.storageReference) {
        await this.tenantRegistry.updateTenantStorageReference(
          tenant.id,
          null,
          registryClient,
        )
      }

      // Delete the per-tenant Keycloak client. A failure here is a warning, not
      // a blocker — an orphaned KC client is recoverable manually, and we must
      // not block the full deprovision because of it.
      if (this.keycloakAdminClient) {
        try {
          await this.keycloakAdminClient.deleteClient(`dnd-notes-tenant-${tenant.id}`)
        } catch (error) {
          console.warn(
            `Keycloak client deletion failed for tenant "${tenant.id}" — continuing deprovision:`,
            error,
          )
        }
      }

      await this.tenantRegistry.updateTenantDesiredState(
        tenant.id,
        'deprovisioned',
        registryClient,
      )
      await this.tenantRegistry.updateTenantState(
        tenant.id,
        'deprovisioned',
        params.triggeredBy,
        params.reason ?? 'Tenant resources deleted',
        registryClient,
      )

      return {
        tenant: await this.getExistingTenant(tenant.id, registryClient),
        deprovisioned: true,
      }
    })
  }

  async close(): Promise<void> {
    await this.databaseManager.close()
  }

  private createOpaqueSubdomainCandidate(): string {
    return `${opaqueSubdomainPrefix}-${randomBytes(6).toString('hex')}`
  }

  private async getExistingTenant(
    tenantId: string,
    executor?: TenantRegistryClientLike,
  ): Promise<Tenant> {
    const tenant = await this.tenantRegistry.getTenant(tenantId, executor)
    if (!tenant) {
      throw new Error(`Tenant ${tenantId} not found`)
    }

    return tenant
  }

  /**
   * Returns the Keycloak `sub` of the tenant's owner using the resolution
   * order documented at the call site:
   *
   *   1. portal_account.keycloak_sub (canonical, populated after the first
   *      portal Keycloak sign-in).
   *   2. tenant.initialAdminEmail looked up via the admin REST API.
   *
   * Returns null when neither path produces a *unique* user. An ambiguous
   * email match (multiple Keycloak users with the same email) is treated
   * the same as "not found" — we log a warning and defer the role
   * assignment to the next provisioning sweep, where the canonical
   * portal_account.keycloak_sub link should be in place. Other admin-API
   * errors surface as `KeycloakAdminError` so the caller can treat them
   * the same as any other provisioning failure.
   *
   * Caller is expected to have already verified that
   * `this.keycloakAdminClient` is defined. The `registryClient`
   * argument MUST be the lock-scoped client passed into `withTenantLock`,
   * so the portal-account read participates in the same locked transaction
   * as the rest of provisioning (no fresh registry connection while the
   * tenant lock is held).
   */
  private async resolveTenantOwnerKeycloakSub(
    tenant: Tenant,
    registryClient: TenantRegistryClientLike,
  ): Promise<string | null> {
    const ownerAccount = await this.tenantRegistry.getPortalAccount(
      tenant.ownerId,
      registryClient,
    )

    if (ownerAccount?.keycloakSub) {
      return ownerAccount.keycloakSub
    }

    const fallbackEmail = tenant.initialAdminEmail
    if (!fallbackEmail || fallbackEmail.trim() === '') {
      return null
    }

    // Caller-side guard already ensured keycloakAdminClient exists; the cast
    // here keeps TypeScript happy without re-checking at the call site.
    const keycloakAdminClient = this.keycloakAdminClient
    if (!keycloakAdminClient) {
      return null
    }

    try {
      const user = await keycloakAdminClient.findUserByEmail(fallbackEmail)
      return user?.id ?? null
    } catch (error) {
      // Ambiguous email match — Keycloak returned more than one user for
      // this address. We refuse to guess; assignment is deferred to the
      // portal-login sweep on first sign-in. Other KeycloakAdminError
      // codes (auth failures, 5xx) keep propagating and fail provisioning.
      if (error instanceof KeycloakAdminError && error.statusCode === 409) {
        console.warn(
          `[provisioning] Keycloak email "${fallbackEmail}" matched multiple users for tenant "${tenant.id}"; deferring tenant-member role assignment.`,
        )
        return null
      }
      throw error
    }
  }
}

export class PostgresTenantDatabaseManager implements TenantDatabaseManager {
  private readonly pool: PostgresPoolLike
  private readonly adminDatabaseUrl: string
  private readonly runtimeDatabaseUrl: string
  private readonly createTenantPool: (connectionString: string) => PostgresPoolLike
  private readonly generatePassword: () => string

  constructor(
    adminDatabaseUrl: string,
    runtimeDatabaseUrl?: string,
    options?: {
      pool?: PostgresPoolLike
      createTenantPool?: (connectionString: string) => PostgresPoolLike
      generatePassword?: () => string
    },
  ) {
    this.adminDatabaseUrl = adminDatabaseUrl
    this.runtimeDatabaseUrl =
      runtimeDatabaseUrl && runtimeDatabaseUrl.length > 0
        ? runtimeDatabaseUrl
        : adminDatabaseUrl
    this.pool =
      options?.pool ??
      new Pool({
        connectionString: adminDatabaseUrl,
        max: 1,
      })
    this.createTenantPool =
      options?.createTenantPool ??
      ((connectionString) =>
        new Pool({
          connectionString,
          max: 1,
        }))
    this.generatePassword =
      options?.generatePassword ?? (() => randomBytes(24).toString('base64url'))
  }

  async ensureTenantDatabase(
    tenant: Tenant,
    subdomain: string,
    options: EnsureTenantDatabaseOptions = {},
  ): Promise<TenantDatabase> {
    const databaseName = buildTenantDatabaseName(tenant.id, subdomain)
    const roleName = buildTenantDatabaseRoleName(tenant.id, subdomain)
    const existingRuntimeIdentity = resolveExistingTenantRuntimeIdentity({
      existingRuntimeConnectionString: options.existingRuntimeConnectionString,
      databaseName,
      expectedRoleName: roleName,
      runtimeDatabaseUrl: this.runtimeDatabaseUrl,
      tenantId: tenant.id,
    })

    if (
      options.requireExistingRuntimeConnectionString &&
      !existingRuntimeIdentity &&
      !hasRuntimeConnectionString(options.existingRuntimeConnectionString)
    ) {
      throw new Error(
        `Tenant ${tenant.id} is already provisioned but its runtime database secret is missing; explicit credential migration is required before reprovisioning.`,
      )
    }

    const runtimeIdentity =
      existingRuntimeIdentity ??
      createDedicatedTenantRuntimeIdentity({
        databaseName,
        roleName,
        runtimeDatabaseUrl: this.runtimeDatabaseUrl,
        password: this.generatePassword(),
      })
    const client = await this.pool.connect()

    try {
      const existing = await client.query<{ exists: boolean }>(
        'SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS exists',
        [databaseName],
      )

      if (!existing.rows[0]?.exists) {
        await client.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`)
      }

      if (runtimeIdentity.mode === 'dedicated') {
        await client.query(
          `REVOKE ALL ON DATABASE ${quoteIdentifier(databaseName)} FROM PUBLIC`,
        )

        const existingRole = await client.query<{ exists: boolean }>(
          'SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists',
          [runtimeIdentity.roleName],
        )

        if (existingRole.rows[0]?.exists) {
          await client.query(
            `ALTER ROLE ${quoteIdentifier(runtimeIdentity.roleName)} WITH LOGIN PASSWORD ${quoteLiteral(runtimeIdentity.password)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION`,
          )
        } else {
          await client.query(
            `CREATE ROLE ${quoteIdentifier(runtimeIdentity.roleName)} WITH LOGIN PASSWORD ${quoteLiteral(runtimeIdentity.password)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION`,
          )
        }

        await client.query(
          `GRANT CONNECT ON DATABASE ${quoteIdentifier(databaseName)} TO ${quoteIdentifier(runtimeIdentity.roleName)}`,
        )
      }
    } finally {
      client.release()
    }

    const tenantPool = this.createTenantPool(
      buildTenantDatabaseConnectionString(this.adminDatabaseUrl, databaseName),
    )

    try {
      await initializeTenantNoteStoreDatabase(tenantPool)

      if (runtimeIdentity.mode === 'dedicated') {
        const tenantClient = await tenantPool.connect()

        try {
          await applyLeastPrivilegeTenantGrants(
            tenantClient,
            runtimeIdentity.roleName,
          )
        } finally {
          tenantClient.release()
        }
      }
    } finally {
      await tenantPool.end()
    }

    return {
      databaseName,
      roleName: runtimeIdentity.mode === 'dedicated' ? runtimeIdentity.roleName : null,
      runtimeConnectionString: runtimeIdentity.runtimeConnectionString,
    }
  }

  async deleteTenantDatabase(tenant: Tenant, subdomain: string): Promise<void> {
    const databaseName = buildTenantDatabaseName(tenant.id, subdomain)
    const roleName = buildTenantDatabaseRoleName(tenant.id, subdomain)
    const client = await this.pool.connect()

    try {
      const existing = await client.query<{ exists: boolean }>(
        'SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS exists',
        [databaseName],
      )

      await client.query(
        `SELECT pg_terminate_backend(pid)
           FROM pg_stat_activity
          WHERE (datname = $1 OR usename = $2)
            AND pid <> pg_backend_pid()`,
        [databaseName, roleName],
      )

      if (existing.rows[0]?.exists) {
        await client.query(`DROP DATABASE ${quoteIdentifier(databaseName)}`)
      }

      await client.query(`DROP ROLE IF EXISTS ${quoteIdentifier(roleName)}`)
    } finally {
      client.release()
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

export class KubernetesTenantInfrastructureManager
  implements TenantInfrastructureManager
{
  private readonly client: KubernetesObjectClient
  private readonly readyPollIntervalMs: number
  private readonly deleteTimeoutMs: number

  constructor(options?: {
    client?: KubernetesObjectClient
    kubeConfig?: KubeConfig
    readyPollIntervalMs?: number
    deleteTimeoutMs?: number
  }) {
    if (options?.client) {
      this.client = options.client
    } else {
      const kubeConfig = options?.kubeConfig ?? new KubeConfig()
      kubeConfig.loadFromDefault()
      this.client = KubernetesObjectApi.makeApiClient(kubeConfig)
    }
    this.readyPollIntervalMs =
      options?.readyPollIntervalMs ?? defaultReadyPollIntervalMs
    this.deleteTimeoutMs = options?.deleteTimeoutMs ?? defaultDeleteTimeoutMs
  }

  async applyTenantResources(bundle: TenantInfrastructureBundle): Promise<void> {
    await upsertKubernetesObject(this.client, bundle.namespace)
    await upsertKubernetesObject(this.client, bundle.configMap)
    await upsertKubernetesObject(this.client, bundle.secret)
    if (bundle.podDisruptionBudget) {
      await upsertKubernetesObject(this.client, bundle.podDisruptionBudget)
    }
    await upsertKubernetesObject(this.client, bundle.service)
    await upsertKubernetesObject(this.client, bundle.ingress)
    await upsertKubernetesObject(this.client, bundle.deployment)
  }

  async getTenantRuntimeConnectionString(
    resources: TenantProvisioningResources,
  ): Promise<string | null> {
    try {
      const secret = await this.client.read<V1Secret>({
        apiVersion: 'v1',
        kind: 'Secret',
        metadata: {
          name: resources.secretName,
          namespace: resources.namespace,
        },
      })

      const encodedConnectionString = secret.data?.DATABASE_URL

      if (!encodedConnectionString) {
        return null
      }

      return Buffer.from(encodedConnectionString, 'base64').toString('utf8')
    } catch (error) {
      if (isApiException(error, 404)) {
        return null
      }

      throw error
    }
  }

  async waitForTenantReady(
    resources: TenantProvisioningResources,
    timeoutMs = defaultTenantReadyTimeoutMs,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs

    while (Date.now() < deadline) {
      const deployment = await this.client.read<V1Deployment>({
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: {
          name: resources.deploymentName,
          namespace: resources.namespace,
        },
      })

      const generation = deployment.metadata?.generation ?? 0
      const observedGeneration = deployment.status?.observedGeneration ?? 0
      const specReplicas = deployment.spec?.replicas ?? 0
      const updatedReplicas = deployment.status?.updatedReplicas ?? 0
      const availableReplicas = deployment.status?.availableReplicas ?? 0
      const replicas = deployment.status?.replicas ?? 0
      const unavailableReplicas = deployment.status?.unavailableReplicas ?? 0

      const isFullyRolledOut =
        observedGeneration >= generation &&
        updatedReplicas === specReplicas &&
        availableReplicas === specReplicas &&
        replicas === specReplicas &&
        unavailableReplicas === 0 &&
        deployment.status?.conditions?.some(
          (condition) =>
            condition.type === 'Available' && condition.status === 'True',
        ) === true

      if (isFullyRolledOut) {
        return
      }

      await sleep(this.readyPollIntervalMs)
    }

    throw new Error(
      `Tenant workload ${resources.deploymentName} did not become ready within ${timeoutMs}ms`,
    )
  }

  async deleteTenantResources(resources: TenantProvisioningResources): Promise<void> {
    try {
      await this.client.delete(
        {
          apiVersion: 'v1',
          kind: 'Namespace',
          metadata: {
            name: resources.namespace,
          },
        },
        undefined,
        undefined,
        undefined,
        undefined,
        'Foreground',
        {
          apiVersion: 'v1',
          kind: 'DeleteOptions',
        } as V1DeleteOptions,
      )
    } catch (error) {
      if (isApiException(error, 404)) {
        return
      }
      throw error
    }

    const deadline = Date.now() + this.deleteTimeoutMs

    while (Date.now() < deadline) {
      try {
        await this.client.read<V1Namespace>({
          apiVersion: 'v1',
          kind: 'Namespace',
          metadata: {
            name: resources.namespace,
          },
        })
      } catch (error) {
        if (isApiException(error, 404)) {
          return
        }
        throw error
      }

      await sleep(this.readyPollIntervalMs)
    }

    throw new Error(
      `Tenant namespace ${resources.namespace} did not terminate within ${this.deleteTimeoutMs}ms`,
    )
  }
}

export function createLiveTenantProvisioningService(params: {
  tenantRegistry: TenantRegistry
  baseDomain: string
  imageRepository: string
  ingressClassName?: string
  databaseAdminUrl: string
  databaseRuntimeUrl?: string
  tenantRuntimeAuth?: TenantRuntimeAuthConfig
  keycloakAdminClient?: KeycloakAdminClient
  imagePullSecretName?: string
  publicScheme?: 'http' | 'https'
  tenantPort?: number
  readyTimeoutMs?: number
  controlPlaneToken?: string
  tlsClusterIssuer?: string
}): TenantProvisioningService {
  return new TenantProvisioningService({
    tenantRegistry: params.tenantRegistry,
    infrastructureManager: new KubernetesTenantInfrastructureManager(),
    databaseManager: new PostgresTenantDatabaseManager(
      params.databaseAdminUrl,
      params.databaseRuntimeUrl,
    ),
    tenantRuntimeAuth: params.tenantRuntimeAuth,
    keycloakAdminClient: params.keycloakAdminClient,
    baseDomain: params.baseDomain,
    ingressClassName: params.ingressClassName,
    imageRepository: params.imageRepository,
    imagePullSecretName: params.imagePullSecretName,
    publicScheme: params.publicScheme,
    tenantPort: params.tenantPort,
    readyTimeoutMs: params.readyTimeoutMs,
    controlPlaneToken: params.controlPlaneToken,
    tlsClusterIssuer: params.tlsClusterIssuer,
  })
}

export function buildTenantInfrastructureBundle(
  options: BuildTenantInfrastructureBundleOptions,
): TenantInfrastructureBundle {
  const resources = {
    ...buildTenantResourceNames({
      tenant: options.tenant,
      subdomain: options.subdomain,
      baseDomain: options.baseDomain,
      imageRepository: options.imageRepository,
    }),
    databaseName: options.database.databaseName,
  }
  const runtimeUrl = `${options.publicScheme}://${resources.hostname}`
  const namespaceLabels = buildTenantLabels(options.tenant, options.subdomain)

  const configMapData: Record<string, string> = {
    PORT: String(options.tenantPort),
    SERVE_WEB: 'true',
    APP_VERSION: options.tenant.version,
    PUBLIC_WEB_URL: runtimeUrl,
    ALLOWED_ORIGINS: runtimeUrl,
  }
  const secretData: Record<string, string> = {
    DATABASE_URL: encodeSecretValue(options.database.runtimeConnectionString),
  }

  if (options.controlPlaneToken && options.controlPlaneToken.length > 0) {
    secretData.CONTROL_PLANE_TOKEN = encodeSecretValue(options.controlPlaneToken)
  }

  configMapData.TENANT_ID = options.tenant.id
  if (options.tenantRuntimeAuth) {
    if (
      !options.tenantRuntimeAuth.keycloakUrl ||
      !options.tenantRuntimeAuth.keycloakRealm
    ) {
      throw new TenantProvisioningValidationError(
        'Keycloak tenant runtime auth requires KEYCLOAK_URL and KEYCLOAK_REALM.',
      )
    }

    // The per-tenant Keycloak client ID is always derived from the tenant ID.
    // It is not configurable at the auth-config level — the canonical name is
    // `dnd-notes-tenant-{tenantId}` and is created by ensureClient during
    // provisioning.
    configMapData.AUTH_MODE = 'keycloak'
    configMapData.KEYCLOAK_URL = options.tenantRuntimeAuth.keycloakUrl
    configMapData.KEYCLOAK_REALM = options.tenantRuntimeAuth.keycloakRealm
    configMapData.KEYCLOAK_TENANT_CLIENT_ID = `dnd-notes-tenant-${options.tenant.id}`
    if (options.tenantRuntimeAuth.keycloakJwksUrl) {
      configMapData.KEYCLOAK_JWKS_URL = options.tenantRuntimeAuth.keycloakJwksUrl
    }
  }

  return {
    resources,
    namespace: {
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: {
        name: resources.namespace,
        labels: namespaceLabels,
      },
    },
    configMap: {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: {
        name: resources.configMapName,
        namespace: resources.namespace,
        labels: namespaceLabels,
      },
      data: configMapData,
    },
    secret: {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        name: resources.secretName,
        namespace: resources.namespace,
        labels: namespaceLabels,
      },
      type: 'Opaque',
      data: secretData,
    },
    podDisruptionBudget: {
      apiVersion: 'policy/v1',
      kind: 'PodDisruptionBudget',
      metadata: {
        name: resources.deploymentName,
        namespace: resources.namespace,
        labels: namespaceLabels,
      },
      spec: {
        maxUnavailable: 1,
        selector: {
          matchLabels: buildTenantSelectorLabels(options.tenant),
        },
      },
    },
    service: {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: {
        name: resources.serviceName,
        namespace: resources.namespace,
        labels: namespaceLabels,
      },
      spec: {
        selector: buildTenantSelectorLabels(options.tenant),
        ports: [
          {
            name: 'http',
            port: options.tenantPort,
            targetPort: options.tenantPort,
          },
        ],
      },
    },
    ingress: {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'Ingress',
      metadata: {
        name: resources.serviceName,
        namespace: resources.namespace,
        labels: namespaceLabels,
        ...(options.tlsClusterIssuer
          ? { annotations: { 'cert-manager.io/cluster-issuer': options.tlsClusterIssuer } }
          : {}),
      },
      spec: {
        ingressClassName: options.ingressClassName ?? 'nginx',
        ...(options.tlsClusterIssuer
          ? {
              tls: [
                {
                  hosts: [resources.hostname],
                  secretName: `${resources.serviceName}-tls`,
                },
              ],
            }
          : {}),
        rules: [
          {
            host: resources.hostname,
            http: {
              paths: [
                {
                  path: '/',
                  pathType: 'Prefix',
                  backend: {
                    service: {
                      name: resources.serviceName,
                      port: {
                        name: 'http',
                      },
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    },
    deployment: {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: {
        name: resources.deploymentName,
        namespace: resources.namespace,
        labels: namespaceLabels,
      },
      spec: {
        replicas: 1,
        minReadySeconds: 5,
        strategy: {
          type: 'RollingUpdate',
          rollingUpdate: {
            maxSurge: 1,
            maxUnavailable: 0,
          },
        },
        selector: {
          matchLabels: buildTenantSelectorLabels(options.tenant),
        },
        template: {
          metadata: {
            labels: namespaceLabels,
          },
          spec: {
            terminationGracePeriodSeconds: 30,
            imagePullSecrets: options.imagePullSecretName
              ? [{ name: options.imagePullSecretName }]
              : undefined,
            containers: [
              {
                name: 'tenant-app',
                image: resources.image,
                imagePullPolicy: 'IfNotPresent',
                ports: [
                  {
                    containerPort: options.tenantPort,
                    name: 'http',
                  },
                ],
                envFrom: [
                  {
                    configMapRef: { name: resources.configMapName },
                  },
                  {
                    secretRef: { name: resources.secretName },
                  },
                ],
                livenessProbe: {
                  httpGet: {
                    path: '/healthz',
                    port: options.tenantPort,
                  },
                  initialDelaySeconds: 10,
                  periodSeconds: 10,
                  timeoutSeconds: 3,
                  failureThreshold: 3,
                },
                readinessProbe: {
                  httpGet: {
                    path: '/ready',
                    port: options.tenantPort,
                  },
                  initialDelaySeconds: 5,
                  periodSeconds: 5,
                  timeoutSeconds: 2,
                  failureThreshold: 2,
                },
              },
            ],
          },
        },
      },
    },
  }
}

type TenantRuntimeIdentity =
  | {
      mode: 'dedicated'
      roleName: string
      password: string
      runtimeConnectionString: string
    }
  | {
      mode: 'legacy'
      runtimeConnectionString: string
    }

function createDedicatedTenantRuntimeIdentity(params: {
  databaseName: string
  roleName: string
  runtimeDatabaseUrl: string
  password: string
}): TenantRuntimeIdentity {
  return {
    mode: 'dedicated',
    roleName: params.roleName,
    password: params.password,
    runtimeConnectionString: buildTenantDatabaseConnectionString(
      params.runtimeDatabaseUrl,
      params.databaseName,
      {
        username: params.roleName,
        password: params.password,
      },
    ),
  }
}

function resolveExistingTenantRuntimeIdentity(params: {
  existingRuntimeConnectionString?: string | null
  databaseName: string
  expectedRoleName: string
  runtimeDatabaseUrl: string
  tenantId?: string
}): TenantRuntimeIdentity | null {
  if (!hasRuntimeConnectionString(params.existingRuntimeConnectionString)) {
    return null
  }

  const existingRuntimeConnectionString = params.existingRuntimeConnectionString
  let existingConnectionString: URL
  try {
    existingConnectionString = new URL(existingRuntimeConnectionString)
  } catch (error) {
    const tenantContext = params.tenantId ? ` for tenant ${params.tenantId}` : ''
    throw new Error(
      `Invalid DATABASE_URL in runtime secret${tenantContext}: must be a valid PostgreSQL connection string`,
      { cause: error },
    )
  }
  const username = decodeURIComponent(existingConnectionString.username)
  const password = decodeURIComponent(existingConnectionString.password)

  if (username === params.expectedRoleName && password.length > 0) {
    return createDedicatedTenantRuntimeIdentity({
      databaseName: params.databaseName,
      roleName: params.expectedRoleName,
      runtimeDatabaseUrl: params.runtimeDatabaseUrl,
      password,
    })
  }

  return {
    mode: 'legacy',
    runtimeConnectionString: buildTenantDatabaseConnectionString(
      existingRuntimeConnectionString,
      params.databaseName,
    ),
  }
}

export function buildTenantDatabaseConnectionString(
  baseDatabaseUrl: string,
  databaseName: string,
  options?: {
    username?: string
    password?: string
  },
): string {
  const connectionString = new URL(baseDatabaseUrl)
  connectionString.pathname = `/${databaseName}`

  if (options?.username !== undefined) {
    connectionString.username = options.username
  }

  if (options?.password !== undefined) {
    connectionString.password = options.password
  }

  return connectionString.toString()
}

function hasRuntimeConnectionString(connectionString?: string | null): connectionString is string {
  return connectionString != null && connectionString.trim() !== ''
}

export function buildTenantResourceNames(params: {
  tenant: Tenant
  subdomain: string
  baseDomain: string
  imageRepository: string
}): TenantProvisioningResources {
  const namespace = `tenant-${params.subdomain}`
  return {
    namespace,
    deploymentName: 'dnd-notes',
    serviceName: 'dnd-notes',
    pvcName: null,
    configMapName: 'dnd-notes-runtime',
    secretName: 'dnd-notes-runtime-secret',
    hostname: `${params.subdomain}.${params.baseDomain}`,
    databaseName: buildTenantDatabaseName(params.tenant.id, params.subdomain),
    image: `${params.imageRepository}:${params.tenant.version}`,
  }
}

function buildTenantSelectorLabels(tenant: Tenant): Record<string, string> {
  return {
    'app.kubernetes.io/name': 'dnd-notes',
    'app.kubernetes.io/component': 'tenant-app',
    'dnd-notes.dev/tenant-id': normalizeKubernetesLabelValue(tenant.id),
  }
}

function buildTenantLabels(
  tenant: Tenant,
  subdomain: string,
): Record<string, string> {
  return {
    ...buildTenantSelectorLabels(tenant),
    'app.kubernetes.io/managed-by': 'dnd-notes-control-plane',
    'dnd-notes.dev/tenant-slug': tenant.slug,
    'dnd-notes.dev/subdomain': subdomain,
  }
}

function buildTenantDatabaseName(tenantId: string, subdomain: string): string {
  const normalizedTenantId = tenantId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20)
  const normalizedSubdomain = subdomain.replace(/-/g, '_')
  return buildUniqueDatabaseIdentifier(
    `tenant_${normalizedTenantId}_${normalizedSubdomain}`,
  )
}

function normalizeKubernetesLabelValue(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')

  if (normalized === '') {
    return `tenant-${createHash('sha256').update(value).digest('hex').slice(0, 12)}`
  }

  if (normalized.length <= maxKubernetesLabelValueLength) {
    return normalized
  }

  const digest = createHash('sha256').update(value).digest('hex').slice(0, 8)
  const maxPrefixLength = maxKubernetesLabelValueLength - digest.length - 1
  const trimmedPrefix = normalized
    .slice(0, maxPrefixLength)
    .replace(/[^a-z0-9]+$/g, '')

  return `${trimmedPrefix}-${digest}`
}

function buildTenantDatabaseRoleName(tenantId: string, subdomain: string): string {
  const normalizedTenantId = tenantId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 18)
  const normalizedSubdomain = subdomain.replace(/-/g, '_')
  return buildUniqueDatabaseIdentifier(
    `tenant_rt_${normalizedTenantId}_${normalizedSubdomain}`,
  )
}

function buildUniqueDatabaseIdentifier(identifier: string): string {
  const maxIdentifierLength = 63

  if (identifier.length <= maxIdentifierLength) {
    return identifier.replace(/_+$/g, '')
  }

  const digest = createHash('sha256').update(identifier).digest('hex').slice(0, 8)
  const maxPrefixLength = maxIdentifierLength - digest.length - 1
  const trimmedPrefix = identifier
    .slice(0, maxPrefixLength)
    .replace(/_+$/g, '')

  return `${trimmedPrefix}_${digest}`
}

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z0-9_]+$/.test(identifier)) {
    throw new Error(`Unsafe database identifier: ${identifier}`)
  }

  return `"${identifier.replace(/"/g, '""')}"`
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function encodeSecretValue(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64')
}

async function upsertKubernetesObject<T extends KubernetesObject>(
  client: KubernetesObjectClient,
  spec: T,
): Promise<void> {
  try {
    const existing = await client.read<T>({
      apiVersion: spec.apiVersion,
      kind: spec.kind,
      metadata: {
        name: spec.metadata!.name!,
        namespace: spec.metadata?.namespace,
      },
    })
    const specForReplace = prepareKubernetesObjectForReplace(spec, existing)
    specForReplace.metadata = {
      ...specForReplace.metadata,
      resourceVersion: existing.metadata?.resourceVersion,
    }
    await client.replace(specForReplace)
  } catch (error) {
    if (isApiException(error, 404)) {
      await client.create(spec)
      return
    }

    throw error
  }
}

function prepareKubernetesObjectForReplace<T extends KubernetesObject>(
  spec: T,
  existing: T,
): T {
  if (spec.kind === 'Service' && existing.kind === 'Service') {
    const desiredService = spec as T & V1Service
    const existingService = existing as T & V1Service

    return {
      ...desiredService,
      metadata: {
        ...desiredService.metadata,
      },
      spec: {
        ...desiredService.spec,
        clusterIP: desiredService.spec?.clusterIP ?? existingService.spec?.clusterIP,
        clusterIPs: desiredService.spec?.clusterIPs ?? existingService.spec?.clusterIPs,
        healthCheckNodePort:
          desiredService.spec?.healthCheckNodePort ??
          existingService.spec?.healthCheckNodePort,
        ipFamilies:
          desiredService.spec?.ipFamilies ?? existingService.spec?.ipFamilies,
        ipFamilyPolicy:
          desiredService.spec?.ipFamilyPolicy ??
          existingService.spec?.ipFamilyPolicy,
        ports: mergeServicePorts(desiredService.spec?.ports, existingService.spec?.ports),
      },
    }
  }

  return {
    ...spec,
    metadata: {
      ...spec.metadata,
    },
  }
}

function mergeServicePorts(
  desiredPorts: V1ServicePort[] | undefined,
  existingPorts: V1ServicePort[] | undefined,
): V1ServicePort[] | undefined {
  if (!desiredPorts) {
    return desiredPorts
  }

  return desiredPorts.map((desiredPort) => {
    const matchingExistingPort = existingPorts?.find((existingPort) => {
      if (desiredPort.name && existingPort.name) {
        return desiredPort.name === existingPort.name
      }

      return (
        desiredPort.port === existingPort.port &&
        (desiredPort.protocol ?? 'TCP') === (existingPort.protocol ?? 'TCP')
      )
    })

    if (!matchingExistingPort?.nodePort) {
      return desiredPort
    }

    return {
      ...desiredPort,
      nodePort: desiredPort.nodePort ?? matchingExistingPort.nodePort,
    }
  })
}

function isApiException(error: unknown, statusCode: number): error is ApiException<unknown> {
  return error instanceof ApiException && error.code === statusCode
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs)
  })
}

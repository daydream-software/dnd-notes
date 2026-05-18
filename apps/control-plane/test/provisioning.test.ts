import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ApiException, type KubernetesObject, type V1Status } from '@kubernetes/client-node'
import { DataType, newDb } from 'pg-mem'
import {
  KubernetesTenantInfrastructureManager,
  PostgresTenantDatabaseManager,
  TenantProvisioningConflictError,
  TenantProvisioningService,
  TenantProvisioningValidationError,
  buildTenantDatabaseConnectionString,
  buildTenantInfrastructureBundle,
  buildTenantResourceNames,
  type TenantProvisioningPort,
} from '../src/provisioning.js'
import { TenantRegistry } from '../src/tenant-registry.js'
import { maxTenantSubdomainLength } from '../src/tenant-subdomain.js'
import { createTestTenantRegistry } from './tenant-registry-test-helpers.js'
import type { Tenant, TenantProvisioningResources } from '../src/types.js'
import { KeycloakAdminError } from '../src/keycloak-admin-client.js'

class FakeDatabaseManager {
  createdDatabaseNames: string[] = []
  deletedDatabaseNames: string[] = []
  ensureCalls: Array<{
    existingRuntimeConnectionString?: string | null
    requireExistingRuntimeConnectionString?: boolean
    subdomain: string
  }> = []

  async ensureTenantDatabase(
    _tenant: { id: string },
    subdomain: string,
    options?: {
      existingRuntimeConnectionString?: string | null
      requireExistingRuntimeConnectionString?: boolean
    },
  ) {
    const databaseName = `tenant_demo_${subdomain.replace(/-/g, '_')}`
    const roleName = `tenant_rt_demo_${subdomain.replace(/-/g, '_')}`
    this.ensureCalls.push({
      existingRuntimeConnectionString: options?.existingRuntimeConnectionString,
      requireExistingRuntimeConnectionString:
        options?.requireExistingRuntimeConnectionString,
      subdomain,
    })
    this.createdDatabaseNames.push(databaseName)
    return {
      databaseName,
      roleName,
      runtimeConnectionString: buildTenantDatabaseConnectionString(
        'postgresql://postgres:postgres@postgres.default:5432/postgres',
        databaseName,
        {
          username: roleName,
          password: 'generated-runtime-password',
        },
      ),
    }
  }

  async deleteTenantDatabase(tenant: { id: string }, subdomain: string) {
    this.deletedDatabaseNames.push(`tenant_${tenant.id.replace(/-/g, '_')}_${subdomain.replace(/-/g, '_')}`)
  }

  async close() {}
}

class FakeInfrastructureManager {
  bundles: Array<{
    resources: TenantProvisioningResources
    authMode: string | undefined
    deploymentReadinessPath: string | undefined
    ingressBackendServiceName: string | undefined
    ingressClassName: string | undefined
    ingressHost: string | undefined
    ingressPath: string | undefined
    keycloakClientId: string | undefined
    keycloakJwksUrl: string | undefined
    keycloakRealm: string | undefined
    keycloakUrl: string | undefined
    deploymentStrategyType: string | undefined
    maxSurge: number | string | undefined
    maxUnavailable: number | string | undefined
    minReadySeconds: number | undefined
    podDisruptionBudgetMaxUnavailable: number | string | undefined
    podDisruptionBudgetName: string | undefined
    runtimeConnectionString: string | undefined
  }> = []
  deletedResources: TenantProvisioningResources[] = []
  shouldThrow = false
  runtimeConnectionStrings = new Map<string, string>()

  async applyTenantResources(bundle: {
    resources: TenantProvisioningResources
    configMap?: {
      data?: {
        AUTH_MODE?: string
        KEYCLOAK_JWKS_URL?: string
        KEYCLOAK_REALM?: string
        KEYCLOAK_TENANT_CLIENT_ID?: string
        KEYCLOAK_URL?: string
      }
    }
    secret?: {
      data?: {
        DATABASE_URL?: string
      }
    }
    podDisruptionBudget?: {
      metadata?: {
        name?: string
      }
      spec?: {
        maxUnavailable?: number | string
      }
    }
    ingress?: {
      spec?: {
        ingressClassName?: string
        rules?: Array<{
          host?: string
          http?: {
            paths?: Array<{
              path?: string
              backend?: {
                service?: {
                  name?: string
                }
              }
            }>
          }
        }>
      }
    }
    deployment: {
      spec?: {
        minReadySeconds?: number
        strategy?: {
          type?: string
          rollingUpdate?: {
            maxSurge?: number | string
            maxUnavailable?: number | string
          }
        }
        template?: {
          spec?: {
            containers?: Array<{
              readinessProbe?: {
                httpGet?: {
                  path?: string
                }
              }
            }>
          }
        }
      }
    }
  }) {
    this.bundles.push({
      resources: bundle.resources,
      authMode: bundle.configMap?.data?.AUTH_MODE,
      deploymentReadinessPath:
        bundle.deployment.spec?.template?.spec?.containers?.[0]?.readinessProbe
          ?.httpGet?.path,
      ingressBackendServiceName:
        bundle.ingress?.spec?.rules?.[0]?.http?.paths?.[0]?.backend?.service?.name,
      ingressClassName: bundle.ingress?.spec?.ingressClassName,
      ingressHost: bundle.ingress?.spec?.rules?.[0]?.host,
      ingressPath: bundle.ingress?.spec?.rules?.[0]?.http?.paths?.[0]?.path,
      keycloakClientId: bundle.configMap?.data?.KEYCLOAK_TENANT_CLIENT_ID,
      keycloakJwksUrl: bundle.configMap?.data?.KEYCLOAK_JWKS_URL,
      keycloakRealm: bundle.configMap?.data?.KEYCLOAK_REALM,
      keycloakUrl: bundle.configMap?.data?.KEYCLOAK_URL,
      deploymentStrategyType: bundle.deployment.spec?.strategy?.type,
      maxSurge: bundle.deployment.spec?.strategy?.rollingUpdate?.maxSurge,
      maxUnavailable:
        bundle.deployment.spec?.strategy?.rollingUpdate?.maxUnavailable,
      minReadySeconds: bundle.deployment.spec?.minReadySeconds,
      podDisruptionBudgetMaxUnavailable:
        bundle.podDisruptionBudget?.spec?.maxUnavailable,
      podDisruptionBudgetName: bundle.podDisruptionBudget?.metadata?.name,
      runtimeConnectionString: bundle.secret?.data?.DATABASE_URL
        ? Buffer.from(bundle.secret.data.DATABASE_URL, 'base64').toString('utf8')
        : undefined,
    })

    if (bundle.secret?.data?.DATABASE_URL) {
      this.runtimeConnectionStrings.set(
        this.secretKey(bundle.resources),
        Buffer.from(bundle.secret.data.DATABASE_URL, 'base64').toString('utf8'),
      )
    }

    if (this.shouldThrow) {
      throw new Error('synthetic infrastructure failure')
    }
  }

  async getTenantRuntimeConnectionString(resources: TenantProvisioningResources) {
    return this.runtimeConnectionStrings.get(this.secretKey(resources)) ?? null
  }

  async waitForTenantReady() {}

  async deleteTenantResources(resources: TenantProvisioningResources) {
    this.runtimeConnectionStrings.delete(this.secretKey(resources))
    this.deletedResources.push(resources)
  }

  private secretKey(resources: TenantProvisioningResources) {
    return `${resources.namespace}/${resources.secretName}`
  }
}

class FakeKeycloakAdminClient {
  ensureCalls: Array<Record<string, unknown>> = []
  deleteCalls: string[] = []
  ensureClientRoleCalls: Array<{ clientId: string; roleName: string }> = []
  assignClientRoleCalls: Array<{
    userId: string
    clientId: string
    roleName: string
  }> = []
  findUserByEmailCalls: string[] = []
  /**
   * In-memory map of email → Keycloak user id. Tests configure this to
   * exercise the email-fallback path used by tenant provisioning when the
   * portal_account row has no `keycloak_sub` yet (#196 / #200).
   */
  usersByEmail = new Map<string, { id: string }>()
  /**
   * Emails for which `findUserByEmail` should simulate an ambiguous match
   * (Keycloak realm allows duplicate emails and returned more than one
   * user). Mirrors the real client's 409 behaviour added for #200.
   */
  ambiguousEmails = new Set<string>()
  shouldThrowOnDelete = false
  shouldThrowOnAssign = false

  async ensureClient(spec: Record<string, unknown>): Promise<void> {
    this.ensureCalls.push(spec)
  }

  async ensureClientRole(clientId: string, roleName: string): Promise<void> {
    this.ensureClientRoleCalls.push({ clientId, roleName })
  }

  async assignClientRoleToUser(
    userId: string,
    clientId: string,
    roleName: string,
  ): Promise<void> {
    if (this.shouldThrowOnAssign) {
      throw new Error('synthetic Keycloak role-assignment failure')
    }

    this.assignClientRoleCalls.push({ userId, clientId, roleName })
  }

  async findUserByEmail(email: string): Promise<{ id: string } | null> {
    this.findUserByEmailCalls.push(email)
    if (this.ambiguousEmails.has(email)) {
      throw new KeycloakAdminError(
        409,
        `Keycloak admin GET users by email returned 2 users for "${email}"; refusing to pick one.`,
      )
    }
    return this.usersByEmail.get(email) ?? null
  }

  async deleteClient(clientId: string): Promise<void> {
    if (this.shouldThrowOnDelete) {
      throw new Error('synthetic Keycloak delete failure')
    }

    this.deleteCalls.push(clientId)
  }
}

/**
 * Default `tenantRuntimeAuth` for provisioning tests that exercise the
 * Keycloak path.
 */
const keycloakTenantRuntimeAuth = {
  keycloakUrl: 'https://auth.example.com',
  keycloakJwksUrl:
    'http://platform-keycloak.dnd-notes-platform.svc.cluster.local:8080/realms/dnd-notes-prod/protocol/openid-connect/certs',
  keycloakRealm: 'dnd-notes-prod',
}

function createTenantRecord(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: 'tenant-demo',
    slug: 'demo',
    subdomain: null,
    ownerId: 'owner-1',
    desiredState: 'provisioning',
    currentState: 'provisioning',
    version: '1.0.0',
    storageReference: null,
    createdAt: '2026-04-21T00:00:00.000Z',
    updatedAt: '2026-04-21T00:00:00.000Z',
    ...overrides,
  }
}

describe('TenantProvisioningService', () => {
  it('provisions tenant resources, allocates an opaque subdomain, and marks tenant ready', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()
    const databaseManager = new FakeDatabaseManager()
    const infrastructureManager = new FakeInfrastructureManager()
    const originalWithTenantLock = tenantRegistry.withTenantLock.bind(tenantRegistry)
    const tenantLockCalls: string[] = []
    tenantRegistry.withTenantLock = async (tenantId, operation) => {
      tenantLockCalls.push(tenantId)
      return await originalWithTenantLock(tenantId, operation)
    }
    const provisioningService: TenantProvisioningPort =
      new TenantProvisioningService({
        tenantRegistry,
        databaseManager,
        infrastructureManager,
        baseDomain: 'dnd-notes.test',
        imageRepository: 'ghcr.io/daydream-software/dnd-notes',
      })

    try {
      await tenantRegistry.createTenant({
        id: 'tenant-demo',
        slug: 'demo',
        ownerId: 'owner-1',
        version: '1.0.0',
      })

      const result = await provisioningService.provisionTenant({
        tenantId: 'tenant-demo',
        triggeredBy: 'control-plane',
      })
      const runtimeDatabaseUrl = new URL(
        infrastructureManager.bundles[0].runtimeConnectionString ?? '',
      )

      assert.equal(result.tenant.currentState, 'ready')
      assert.equal(result.tenant.desiredState, 'ready')
      assert.match(result.tenant.subdomain ?? '', /^t-[0-9a-f]{12}$/)
      assert.equal(
        result.tenant.storageReference,
        runtimeDatabaseUrl.pathname.slice(1),
      )
      assert.equal(result.resources.databaseName, runtimeDatabaseUrl.pathname.slice(1))
      const storage = await tenantRegistry.getTenantStorageSnapshot('tenant-demo')
      assert.ok(storage)
      assert.equal(storage.mode, 'postgres-dedicated-user')
      assert.equal(storage.migrationStatus, 'not-required')
      assert.equal(storage.lastMigrationFailure, null)
      assert.deepEqual(tenantLockCalls, ['tenant-demo'])
      assert.equal(infrastructureManager.bundles.length, 1)
      assert.equal(infrastructureManager.bundles[0].deploymentReadinessPath, '/ready')
      assert.equal(infrastructureManager.bundles[0].ingressClassName, 'nginx')
      assert.equal(
        infrastructureManager.bundles[0].ingressBackendServiceName,
        result.resources.serviceName,
      )
      assert.equal(infrastructureManager.bundles[0].ingressHost, result.resources.hostname)
      assert.equal(infrastructureManager.bundles[0].ingressPath, '/')
      assert.equal(infrastructureManager.bundles[0].deploymentStrategyType, 'RollingUpdate')
      assert.equal(infrastructureManager.bundles[0].maxSurge, 1)
      assert.equal(infrastructureManager.bundles[0].maxUnavailable, 0)
      assert.equal(infrastructureManager.bundles[0].minReadySeconds, 5)
      assert.equal(infrastructureManager.bundles[0].podDisruptionBudgetName, 'dnd-notes')
      assert.equal(
        infrastructureManager.bundles[0].podDisruptionBudgetMaxUnavailable,
        1,
      )
      assert.equal(
        infrastructureManager.bundles[0].resources.hostname,
        `${result.tenant.subdomain}.dnd-notes.test`,
      )
      assert.equal(
        decodeURIComponent(runtimeDatabaseUrl.username).startsWith('tenant_rt_'),
        true,
      )
      assert.equal(
        runtimeDatabaseUrl.pathname,
        `/${databaseManager.createdDatabaseNames[0]}`,
      )
      assert.equal(
        databaseManager.ensureCalls[0]?.requireExistingRuntimeConnectionString,
        false,
      )
    } finally {
      await provisioningService.close()
      await cleanup()
    }
  })

  it('reuses the locked tenant-registry client throughout provisioning', async () => {
    const db = newDb({
      autoCreateForeignKeyIndices: true,
    })
    db.public.registerFunction({
      name: 'pg_try_advisory_lock',
      args: [DataType.integer, DataType.integer],
      returns: DataType.bool,
      implementation: () => true,
    })
    db.public.registerFunction({
      name: 'pg_advisory_unlock',
      args: [DataType.integer, DataType.integer],
      returns: DataType.bool,
      implementation: () => true,
    })
    const { Pool } = db.adapters.createPg()
    const pool = new Pool()
    let connectCount = 0
    const wrappedPool = {
      async query(text: string, values?: readonly unknown[]) {
        return await pool.query(text, values as unknown[])
      },
      async connect() {
        connectCount += 1
        const client = await pool.connect()

        return {
          async query(text: string, values?: readonly unknown[]) {
            return await client.query(text, values as unknown[])
          },
          release(error?: Error) {
            client.release(error)
          },
        }
      },
      async end() {
        await pool.end()
      },
    }
    const tenantRegistry = new TenantRegistry(
      'postgres://control-plane.test/tenant-registry',
      { pool: wrappedPool },
    )
    const databaseManager = new FakeDatabaseManager()
    const infrastructureManager = new FakeInfrastructureManager()
    const provisioningService: TenantProvisioningPort =
      new TenantProvisioningService({
        tenantRegistry,
        databaseManager,
        infrastructureManager,
        baseDomain: 'dnd-notes.test',
        imageRepository: 'ghcr.io/daydream-software/dnd-notes',
      })

    try {
      await tenantRegistry.createTenant({
        id: 'tenant-demo',
        slug: 'demo',
        ownerId: 'owner-1',
        version: '1.0.0',
      })
      connectCount = 0

      const result = await provisioningService.provisionTenant({
        tenantId: 'tenant-demo',
        triggeredBy: 'control-plane',
      })

      assert.equal(result.tenant.currentState, 'ready')
      assert.equal(connectCount, 1)
    } finally {
      await provisioningService.close()
      await tenantRegistry.close()
      await pool.end()
    }
  })

  it('injects tenant Keycloak runtime auth settings into provisioned tenant resources', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()
    const databaseManager = new FakeDatabaseManager()
    const infrastructureManager = new FakeInfrastructureManager()
    const provisioningService: TenantProvisioningPort =
      new TenantProvisioningService({
        tenantRegistry,
        databaseManager,
        infrastructureManager,
        tenantRuntimeAuth: {
          keycloakUrl: 'https://auth.example.com',
          keycloakJwksUrl: 'http://platform-keycloak.dnd-notes-platform.svc.cluster.local:8080/realms/dnd-notes-prod/protocol/openid-connect/certs',
          keycloakRealm: 'dnd-notes-prod',
        },
        baseDomain: 'dnd-notes.test',
        imageRepository: 'ghcr.io/daydream-software/dnd-notes',
      })

    try {
      await tenantRegistry.createTenant({
        id: 'tenant-demo',
        slug: 'demo',
        ownerId: 'owner-1',
        version: '1.0.0',
      })

      await provisioningService.provisionTenant({
        tenantId: 'tenant-demo',
        triggeredBy: 'control-plane',
      })

      assert.equal(infrastructureManager.bundles.length, 1)
      assert.equal(infrastructureManager.bundles[0].authMode, 'keycloak')
      assert.equal(
        infrastructureManager.bundles[0].keycloakUrl,
        'https://auth.example.com',
      )
      assert.equal(
        infrastructureManager.bundles[0].keycloakRealm,
        'dnd-notes-prod',
      )
      assert.equal(
        infrastructureManager.bundles[0].keycloakJwksUrl,
        'http://platform-keycloak.dnd-notes-platform.svc.cluster.local:8080/realms/dnd-notes-prod/protocol/openid-connect/certs',
      )
      // The per-tenant Keycloak client ID is always derived from the tenant ID,
      // not from a configurable field.
      assert.equal(
        infrastructureManager.bundles[0].keycloakClientId,
        'dnd-notes-tenant-tenant-demo',
      )
    } finally {
      await provisioningService.close()
      await cleanup()
    }
  })

  it('uses a configurable ingress class for provisioned tenant routes', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()
    const databaseManager = new FakeDatabaseManager()
    const infrastructureManager = new FakeInfrastructureManager()
    const provisioningService: TenantProvisioningPort =
      new TenantProvisioningService({
        tenantRegistry,
        databaseManager,
        infrastructureManager,
        baseDomain: 'dnd-notes.test',
        ingressClassName: 'custom-nginx',
        imageRepository: 'ghcr.io/daydream-software/dnd-notes',
      })

    try {
      await tenantRegistry.createTenant({
        id: 'tenant-demo',
        slug: 'demo',
        ownerId: 'owner-1',
        version: '1.0.0',
      })

      await provisioningService.provisionTenant({
        tenantId: 'tenant-demo',
        triggeredBy: 'control-plane',
      })

      assert.equal(infrastructureManager.bundles.length, 1)
      assert.equal(infrastructureManager.bundles[0].ingressClassName, 'custom-nginx')
    } finally {
      await provisioningService.close()
      await cleanup()
    }
  })

  it('normalizes and reconciles a version override before building the rollout image', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()
    const databaseManager = new FakeDatabaseManager()
    const infrastructureManager = new FakeInfrastructureManager()
    const provisioningService: TenantProvisioningPort =
      new TenantProvisioningService({
        tenantRegistry,
        databaseManager,
        infrastructureManager,
        baseDomain: 'dnd-notes.test',
        imageRepository: 'ghcr.io/daydream-software/dnd-notes',
      })

    try {
      await tenantRegistry.createTenant({
        id: 'tenant-demo',
        slug: 'demo',
        ownerId: 'owner-1',
        version: '1.0.0',
      })
      await tenantRegistry.updateTenantSubdomain('tenant-demo', 't-existing123456')
      await tenantRegistry.updateTenantDesiredState('tenant-demo', 'ready')
      await tenantRegistry.updateTenantState(
        'tenant-demo',
        'ready',
        'control-plane',
        'Provisioned already',
      )
      infrastructureManager.runtimeConnectionStrings.set(
        'tenant-t-existing123456/dnd-notes-runtime-secret',
        'postgresql://shared-runtime:shared-password@postgres.default:5432/tenant_demo_t_existing123456',
      )

      const result = await provisioningService.provisionTenant({
        tenantId: 'tenant-demo',
        triggeredBy: 'control-plane',
        version: ' 1.1.0 ',
      })

      assert.equal(result.tenant.version, '1.1.0')
      assert.equal(
        infrastructureManager.bundles[0].resources.image,
        'ghcr.io/daydream-software/dnd-notes:1.1.0',
      )
      assert.equal(result.tenant.subdomain, 't-existing123456')
      assert.equal(result.tenant.currentState, 'ready')
      assert.equal(
        (await tenantRegistry.getStateTransitions('tenant-demo')).some(
          (transition) => transition.toState === 'upgrading',
        ),
        true,
      )
      assert.equal(
        databaseManager.ensureCalls[0]?.existingRuntimeConnectionString,
        'postgresql://shared-runtime:shared-password@postgres.default:5432/tenant_demo_t_existing123456',
      )
      assert.equal(
        databaseManager.ensureCalls[0]?.requireExistingRuntimeConnectionString,
        true,
      )
    } finally {
      await provisioningService.close()
      await cleanup()
    }
  })

  it('rejects blank version overrides before starting a rollout', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()
    const databaseManager = new FakeDatabaseManager()
    const infrastructureManager = new FakeInfrastructureManager()
    const provisioningService: TenantProvisioningPort =
      new TenantProvisioningService({
        tenantRegistry,
        databaseManager,
        infrastructureManager,
        baseDomain: 'dnd-notes.test',
        imageRepository: 'ghcr.io/daydream-software/dnd-notes',
      })

    try {
      await tenantRegistry.createTenant({
        id: 'tenant-demo',
        slug: 'demo',
        ownerId: 'owner-1',
        version: '1.0.0',
      })
      await tenantRegistry.updateTenantSubdomain('tenant-demo', 't-existing123456')
      await tenantRegistry.updateTenantDesiredState('tenant-demo', 'ready')
      await tenantRegistry.updateTenantState(
        'tenant-demo',
        'ready',
        'control-plane',
        'Provisioned already',
      )

      await assert.rejects(
        provisioningService.provisionTenant({
          tenantId: 'tenant-demo',
          triggeredBy: 'control-plane',
          version: '',
        }),
        /Tenant version must be a non-empty string/,
      )

      assert.equal((await tenantRegistry.getTenant('tenant-demo'))?.version, '1.0.0')
      assert.equal(infrastructureManager.bundles.length, 0)
      assert.equal(
        (await tenantRegistry.getStateTransitions('tenant-demo')).some(
          (transition) => transition.toState === 'upgrading',
        ),
        false,
      )
    } finally {
      await provisioningService.close()
      await cleanup()
    }
  })

  it('rejects version overrides that are not safe container image tags', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()
    const databaseManager = new FakeDatabaseManager()
    const infrastructureManager = new FakeInfrastructureManager()
    const provisioningService: TenantProvisioningPort =
      new TenantProvisioningService({
        tenantRegistry,
        databaseManager,
        infrastructureManager,
        baseDomain: 'dnd-notes.test',
        imageRepository: 'ghcr.io/daydream-software/dnd-notes',
      })

    try {
      await tenantRegistry.createTenant({
        id: 'tenant-demo',
        slug: 'demo',
        ownerId: 'owner-1',
        version: '1.0.0',
      })
      await tenantRegistry.updateTenantSubdomain('tenant-demo', 't-existing123456')
      await tenantRegistry.updateTenantDesiredState('tenant-demo', 'ready')
      await tenantRegistry.updateTenantState(
        'tenant-demo',
        'ready',
        'control-plane',
        'Provisioned already',
      )

      await assert.rejects(
        provisioningService.provisionTenant({
          tenantId: 'tenant-demo',
          triggeredBy: 'control-plane',
          version: '1.1.0 release',
        }),
        /Tenant version must be a valid container image tag/,
      )

      assert.equal((await tenantRegistry.getTenant('tenant-demo'))?.version, '1.0.0')
      assert.equal(infrastructureManager.bundles.length, 0)
      assert.equal(
        (await tenantRegistry.getStateTransitions('tenant-demo')).some(
          (transition) => transition.toState === 'upgrading',
        ),
        false,
      )
    } finally {
      await provisioningService.close()
      await cleanup()
    }
  })

  it('rejects rolling updates that target the tenant version already in service', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()
    const databaseManager = new FakeDatabaseManager()
    const infrastructureManager = new FakeInfrastructureManager()
    const provisioningService: TenantProvisioningPort =
      new TenantProvisioningService({
        tenantRegistry,
        databaseManager,
        infrastructureManager,
        baseDomain: 'dnd-notes.test',
        imageRepository: 'ghcr.io/daydream-software/dnd-notes',
      })

    try {
      await tenantRegistry.createTenant({
        id: 'tenant-demo',
        slug: 'demo',
        ownerId: 'owner-1',
        version: '1.0.0',
      })
      await tenantRegistry.updateTenantSubdomain('tenant-demo', 't-existing123456')
      await tenantRegistry.updateTenantDesiredState('tenant-demo', 'ready')
      await tenantRegistry.updateTenantState(
        'tenant-demo',
        'ready',
        'control-plane',
        'Provisioned already',
      )

      await assert.rejects(
        provisioningService.provisionTenant({
          tenantId: 'tenant-demo',
          triggeredBy: 'control-plane',
          version: '1.0.0',
        }),
        (error: Error) => {
          assert.ok(error instanceof TenantProvisioningValidationError)
          assert.equal(error.code, 'unsupported_target_version')
          assert.match(
            error.message,
            /already running version 1.0.0.*different target version/,
          )
          return true
        },
      )

      assert.equal((await tenantRegistry.getTenant('tenant-demo'))?.version, '1.0.0')
      assert.equal(infrastructureManager.bundles.length, 0)
    } finally {
      await provisioningService.close()
      await cleanup()
    }
  })

  it('rejects concurrent rolling updates when a tenant is already upgrading', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()
    const databaseManager = new FakeDatabaseManager()
    const infrastructureManager = new FakeInfrastructureManager()
    const provisioningService: TenantProvisioningPort =
      new TenantProvisioningService({
        tenantRegistry,
        databaseManager,
        infrastructureManager,
        baseDomain: 'dnd-notes.test',
        imageRepository: 'ghcr.io/daydream-software/dnd-notes',
      })

    try {
      await tenantRegistry.createTenant({
        id: 'tenant-demo',
        slug: 'demo',
        ownerId: 'owner-1',
        version: '1.0.0',
      })
      await tenantRegistry.updateTenantSubdomain('tenant-demo', 't-existing123456')
      await tenantRegistry.updateTenantDesiredState('tenant-demo', 'ready')
      await tenantRegistry.updateTenantState(
        'tenant-demo',
        'upgrading',
        'control-plane',
        'Rolling update already in flight',
      )

      await assert.rejects(
        provisioningService.provisionTenant({
          tenantId: 'tenant-demo',
          triggeredBy: 'control-plane',
          version: '1.1.0',
        }),
        (error: Error) => {
          assert.ok(error instanceof TenantProvisioningConflictError)
          assert.equal(error.code, 'tenant_rollout_in_progress')
          assert.match(error.message, /already has a rolling update in progress/)
          return true
        },
      )

      assert.equal((await tenantRegistry.getTenant('tenant-demo'))?.version, '1.0.0')
      assert.equal(infrastructureManager.bundles.length, 0)
      assert.equal(
        (await tenantRegistry.getStateTransitions('tenant-demo')).filter(
          (transition) => transition.toState === 'upgrading',
        ).length,
        1,
      )
    } finally {
      await provisioningService.close()
      await cleanup()
    }
  })

  it('rejects rolling updates for tenants that are not ready', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()
    const databaseManager = new FakeDatabaseManager()
    const infrastructureManager = new FakeInfrastructureManager()
    const provisioningService: TenantProvisioningPort =
      new TenantProvisioningService({
        tenantRegistry,
        databaseManager,
        infrastructureManager,
        baseDomain: 'dnd-notes.test',
        imageRepository: 'ghcr.io/daydream-software/dnd-notes',
      })

    try {
      await tenantRegistry.createTenant({
        id: 'tenant-demo',
        slug: 'demo',
        ownerId: 'owner-1',
        version: '1.0.0',
      })
      await tenantRegistry.updateTenantSubdomain('tenant-demo', 't-existing123456')
      await tenantRegistry.updateTenantDesiredState('tenant-demo', 'maintenance')
      await tenantRegistry.updateTenantState(
        'tenant-demo',
        'maintenance',
        'control-plane',
        'Database restore rehearsal in progress',
      )

      await assert.rejects(
        provisioningService.provisionTenant({
          tenantId: 'tenant-demo',
          triggeredBy: 'control-plane',
          version: '1.1.0',
        }),
        (error: Error) => {
          assert.ok(error instanceof TenantProvisioningConflictError)
          assert.equal(error.code, 'tenant_rollout_disallowed')
          assert.match(
            error.message,
            /cannot start a rolling update from state maintenance/,
          )
          return true
        },
      )

      assert.equal((await tenantRegistry.getTenant('tenant-demo'))?.version, '1.0.0')
      assert.equal(
        (await tenantRegistry.getTenant('tenant-demo'))?.currentState,
        'maintenance',
      )
      assert.equal(infrastructureManager.bundles.length, 0)
    } finally {
      await provisioningService.close()
      await cleanup()
    }
  })

  it('marks tenant failed when infrastructure application throws', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()
    const databaseManager = new FakeDatabaseManager()
    const infrastructureManager = new FakeInfrastructureManager()
    infrastructureManager.shouldThrow = true
    const provisioningService: TenantProvisioningPort =
      new TenantProvisioningService({
        tenantRegistry,
        databaseManager,
        infrastructureManager,
        baseDomain: 'dnd-notes.test',
        imageRepository: 'ghcr.io/daydream-software/dnd-notes',
      })

    try {
      await tenantRegistry.createTenant({
        id: 'tenant-demo',
        slug: 'demo',
        ownerId: 'owner-1',
        version: '1.0.0',
      })

      await assert.rejects(
        provisioningService.provisionTenant({
          tenantId: 'tenant-demo',
          triggeredBy: 'control-plane',
        }),
        /synthetic infrastructure failure/,
      )

      const tenant = await tenantRegistry.getTenant('tenant-demo')
      assert.equal(tenant?.currentState, 'failed')
      assert.equal(tenant?.desiredState, 'ready')
      assert.ok(tenant?.subdomain)
    } finally {
      await provisioningService.close()
      await cleanup()
    }
  })

  it('marks tenant failed when a persisted subdomain is invalid', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()
    const databaseManager = new FakeDatabaseManager()
    const infrastructureManager = new FakeInfrastructureManager()
    const provisioningService: TenantProvisioningPort =
      new TenantProvisioningService({
        tenantRegistry,
        databaseManager,
        infrastructureManager,
        baseDomain: 'dnd-notes.test',
        imageRepository: 'ghcr.io/daydream-software/dnd-notes',
      })

    try {
      await tenantRegistry.createTenant({
        id: 'tenant-demo',
        slug: 'demo',
        ownerId: 'owner-1',
        version: '1.0.0',
      })
      await tenantRegistry.updateTenantSubdomain('tenant-demo', '')

      await assert.rejects(
        provisioningService.provisionTenant({
          tenantId: 'tenant-demo',
          triggeredBy: 'control-plane',
        }),
        /invalid persisted subdomain ""/,
      )

      const tenant = await tenantRegistry.getTenant('tenant-demo')
      assert.equal(tenant?.currentState, 'failed')
      assert.equal(tenant?.desiredState, 'ready')
      assert.deepEqual(databaseManager.createdDatabaseNames, [])
      assert.equal(infrastructureManager.bundles.length, 0)
    } finally {
      await provisioningService.close()
      await cleanup()
    }
  })

  it('allows provisioning retry for tenants stuck in failed state with persisted subdomain but no runtime secret', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()
    const databaseManager = new FakeDatabaseManager()
    const infrastructureManager = new FakeInfrastructureManager()
    const provisioningService: TenantProvisioningPort =
      new TenantProvisioningService({
        tenantRegistry,
        databaseManager,
        infrastructureManager,
        baseDomain: 'dnd-notes.test',
        imageRepository: 'ghcr.io/daydream-software/dnd-notes',
      })

    try {
      await tenantRegistry.createTenant({
        id: 'tenant-demo',
        slug: 'demo',
        ownerId: 'owner-1',
        version: '1.0.0',
      })
      await tenantRegistry.updateTenantSubdomain('tenant-demo', 't-failed123456')
      await tenantRegistry.updateTenantState(
        'tenant-demo',
        'failed',
        'control-plane',
        'Previous provisioning attempt failed mid-flight',
      )

      const result = await provisioningService.provisionTenant({
        tenantId: 'tenant-demo',
        triggeredBy: 'control-plane',
      })

      assert.equal(result.tenant.currentState, 'ready')
      assert.equal(result.tenant.subdomain, 't-failed123456')
      assert.equal(
        databaseManager.ensureCalls[0]?.requireExistingRuntimeConnectionString,
        false,
      )
      const runtimeDatabaseUrl = new URL(
        infrastructureManager.bundles[0].runtimeConnectionString ?? '',
      )
      assert.equal(
        decodeURIComponent(runtimeDatabaseUrl.username).startsWith('tenant_rt_'),
        true,
      )
    } finally {
      await provisioningService.close()
      await cleanup()
    }
  })

  it('allows re-provisioning a deprovisioned tenant', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()
    const databaseManager = new FakeDatabaseManager()
    const infrastructureManager = new FakeInfrastructureManager()
    const provisioningService: TenantProvisioningPort =
      new TenantProvisioningService({
        tenantRegistry,
        databaseManager,
        infrastructureManager,
        baseDomain: 'dnd-notes.test',
        imageRepository: 'ghcr.io/daydream-software/dnd-notes',
      })

    try {
      await tenantRegistry.createTenant({
        id: 'tenant-demo',
        slug: 'demo',
        ownerId: 'owner-1',
        version: '1.0.0',
      })
      await tenantRegistry.updateTenantSubdomain('tenant-demo', 't-deprovisioned123456')
      await tenantRegistry.updateTenantState(
        'tenant-demo',
        'deprovisioned',
        'control-plane',
        'Tenant was deprovisioned',
      )

      const result = await provisioningService.provisionTenant({
        tenantId: 'tenant-demo',
        triggeredBy: 'control-plane',
      })

      assert.equal(result.tenant.currentState, 'ready')
      assert.equal(result.tenant.subdomain, 't-deprovisioned123456')
      assert.equal(
        databaseManager.ensureCalls[0]?.requireExistingRuntimeConnectionString,
        false,
      )
      assert(
        infrastructureManager.bundles.length > 0,
        'expected infrastructure bundle to have been created',
      )
    } finally {
      await provisioningService.close()
      await cleanup()
    }
  })

  it('deprovisions tenant resources and clears the storage reference', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()
    const databaseManager = new FakeDatabaseManager()
    const infrastructureManager = new FakeInfrastructureManager()
    const provisioningService: TenantProvisioningPort =
      new TenantProvisioningService({
        tenantRegistry,
        databaseManager,
        infrastructureManager,
        baseDomain: 'dnd-notes.test',
        imageRepository: 'ghcr.io/daydream-software/dnd-notes',
      })

    try {
      await tenantRegistry.createTenant({
        id: 'tenant-demo',
        slug: 'demo',
        ownerId: 'owner-1',
        version: '1.0.0',
      })
      await tenantRegistry.updateTenantSubdomain('tenant-demo', 't-existing123456')
      await tenantRegistry.updateTenantStorageReference(
        'tenant-demo',
        'dnd-notes-data-t-existing123456',
      )
      await tenantRegistry.updateTenantState(
        'tenant-demo',
        'ready',
        'control-plane',
        'Provisioned already',
      )
      await tenantRegistry.updateTenantDesiredState('tenant-demo', 'ready')

      const result = await provisioningService.deprovisionTenant({
        tenantId: 'tenant-demo',
        triggeredBy: 'control-plane',
      })

      assert.equal(result.deprovisioned, true)
      assert.equal(result.tenant.currentState, 'deprovisioned')
      assert.equal(result.tenant.desiredState, 'deprovisioned')
      assert.equal(result.tenant.storageReference, null)
      assert.deepEqual(databaseManager.deletedDatabaseNames, [
        buildTenantResourceNames({
          tenant: (await tenantRegistry.getTenant('tenant-demo'))!,
          subdomain: 't-existing123456',
          baseDomain: 'dnd-notes.test',
          imageRepository: 'ghcr.io/daydream-software/dnd-notes',
        }).databaseName,
      ])
      assert.equal(infrastructureManager.deletedResources.length, 1)
      assert.equal(
        infrastructureManager.deletedResources[0].namespace,
        'tenant-t-existing123456',
      )
    } finally {
      await provisioningService.close()
      await cleanup()
    }
  })

  it('fails deprovisioning when a persisted subdomain is invalid', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()
    const databaseManager = new FakeDatabaseManager()
    const infrastructureManager = new FakeInfrastructureManager()
    const provisioningService: TenantProvisioningPort =
      new TenantProvisioningService({
        tenantRegistry,
        databaseManager,
        infrastructureManager,
        baseDomain: 'dnd-notes.test',
        imageRepository: 'ghcr.io/daydream-software/dnd-notes',
      })

    try {
      await tenantRegistry.createTenant({
        id: 'tenant-demo',
        slug: 'demo',
        ownerId: 'owner-1',
        version: '1.0.0',
      })
      await tenantRegistry.updateTenantSubdomain('tenant-demo', '')
      await tenantRegistry.updateTenantStorageReference('tenant-demo', 'broken-storage-handle')
      await tenantRegistry.updateTenantState(
        'tenant-demo',
        'ready',
        'control-plane',
        'Provisioned already',
      )
      await tenantRegistry.updateTenantDesiredState('tenant-demo', 'ready')

      await assert.rejects(
        provisioningService.deprovisionTenant({
          tenantId: 'tenant-demo',
          triggeredBy: 'control-plane',
        }),
        /invalid persisted subdomain ""/,
      )

      assert.equal(infrastructureManager.deletedResources.length, 0)
      assert.deepEqual(databaseManager.deletedDatabaseNames, [])
      assert.equal(
        (await tenantRegistry.getTenant('tenant-demo'))?.storageReference,
        'broken-storage-handle',
      )
      assert.equal((await tenantRegistry.getTenant('tenant-demo'))?.currentState, 'ready')
    } finally {
      await provisioningService.close()
      await cleanup()
    }
  })

  it('does not fabricate tenant resources when deprovisioning a tenant that was never provisioned', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()
    const databaseManager = new FakeDatabaseManager()
    const infrastructureManager = new FakeInfrastructureManager()
    const provisioningService: TenantProvisioningPort =
      new TenantProvisioningService({
        tenantRegistry,
        databaseManager,
        infrastructureManager,
        baseDomain: 'dnd-notes.test',
        imageRepository: 'ghcr.io/daydream-software/dnd-notes',
      })

    try {
      await tenantRegistry.createTenant({
        id: 'tenant-demo',
        slug: 'demo',
        ownerId: 'owner-1',
        version: '1.0.0',
      })

      const result = await provisioningService.deprovisionTenant({
        tenantId: 'tenant-demo',
        triggeredBy: 'control-plane',
      })

      assert.equal(result.deprovisioned, true)
      assert.equal(infrastructureManager.deletedResources.length, 0)
      assert.deepEqual(databaseManager.deletedDatabaseNames, [])
      assert.equal(result.tenant.subdomain, null)
    } finally {
      await provisioningService.close()
      await cleanup()
    }
  })

  it('builds a postgres-only workload for newly provisioned tenants', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()

    try {
      const tenant = await tenantRegistry.createTenant({
        id: 'tenant-demo',
        slug: 'demo',
        ownerId: 'owner-1',
        version: '1.0.0',
      })
      const bundle = buildTenantInfrastructureBundle({
        tenant,
        subdomain: 't-opaque123456',
        database: {
          databaseName: 'tenant_demo_t_opaque123456',
          roleName: 'tenant_rt_demo_t_opaque123456',
          runtimeConnectionString:
            'postgresql://tenant_rt_demo_t_opaque123456:generated-runtime-password@postgres.default:5432/tenant_demo_t_opaque123456',
        },
        baseDomain: 'dnd-notes.test',
        imageRepository: 'ghcr.io/daydream-software/dnd-notes',
        publicScheme: 'https',
        tenantPort: 3000,
      })

      assert.equal(bundle.podDisruptionBudget?.metadata?.name, bundle.resources.deploymentName)
      assert.equal(bundle.podDisruptionBudget?.spec?.maxUnavailable, 1)
      assert.equal(bundle.ingress.metadata?.name, bundle.resources.serviceName)
      assert.equal(bundle.ingress.spec?.ingressClassName, 'nginx')
      assert.equal(bundle.ingress.spec?.rules?.[0]?.host, bundle.resources.hostname)
      assert.equal(bundle.ingress.spec?.rules?.[0]?.http?.paths?.[0]?.path, '/')
      assert.equal(
        bundle.ingress.spec?.rules?.[0]?.http?.paths?.[0]?.backend?.service?.name,
        bundle.resources.serviceName,
      )
      assert.equal(bundle.deployment.spec?.template?.spec?.volumes, undefined)
      assert.equal(
        bundle.deployment.spec?.template?.spec?.containers?.[0]?.volumeMounts,
        undefined,
      )
      assert.equal(bundle.configMap.data?.APP_VERSION, tenant.version)
      assert.equal(bundle.configMap.data?.TENANT_ID, tenant.id)
      assert.equal(bundle.secret?.data?.CONTROL_PLANE_TOKEN, undefined)
    } finally {
      await cleanup()
    }
  })

  it('injects the control-plane token into the tenant secret when provided', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()

    try {
      const tenant = await tenantRegistry.createTenant({
        id: 'tenant-demo',
        slug: 'demo',
        ownerId: 'owner-1',
        version: '1.0.0',
      })
      const bundle = buildTenantInfrastructureBundle({
        tenant,
        subdomain: 't-opaque123456',
        database: {
          databaseName: 'tenant_demo_t_opaque123456',
          roleName: 'tenant_rt_demo_t_opaque123456',
          runtimeConnectionString:
            'postgresql://tenant_rt_demo_t_opaque123456:generated-runtime-password@postgres.default:5432/tenant_demo_t_opaque123456',
        },
        baseDomain: 'dnd-notes.test',
        imageRepository: 'ghcr.io/daydream-software/dnd-notes',
        publicScheme: 'https',
        tenantPort: 3000,
        controlPlaneToken: 'super-secret-token',
      })

      const encoded = bundle.secret?.data?.CONTROL_PLANE_TOKEN
      assert.ok(encoded, 'expected CONTROL_PLANE_TOKEN to be present')
      assert.equal(
        Buffer.from(encoded!, 'base64').toString('utf8'),
        'super-secret-token',
      )
      assert.equal(bundle.configMap.data?.APP_VERSION, tenant.version)
      assert.equal(bundle.configMap.data?.TENANT_ID, tenant.id)
    } finally {
      await cleanup()
    }
  })

  it('keeps derived resource names within kubernetes limits for max-length subdomains', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()
    const maxLengthSubdomain = `t-${'a'.repeat(maxTenantSubdomainLength - 2)}`

    try {
      const tenant = await tenantRegistry.createTenant({
        id: 'tenant-demo',
        slug: 'demo',
        ownerId: 'owner-1',
        version: '1.0.0',
      })
      const bundle = buildTenantInfrastructureBundle({
        tenant,
        subdomain: maxLengthSubdomain,
        database: {
          databaseName: 'tenant_demo',
          roleName: 'tenant_rt_demo',
          runtimeConnectionString:
            'postgresql://tenant_rt_demo:generated-runtime-password@postgres.default:5432/tenant_demo',
        },
        baseDomain: 'dnd-notes.test',
        imageRepository: 'ghcr.io/daydream-software/dnd-notes',
        publicScheme: 'https',
        tenantPort: 3000,
      })

      assert.equal(maxLengthSubdomain.length, maxTenantSubdomainLength)
      assert.ok(bundle.resources.namespace.length <= 63)
      assert.equal(bundle.podDisruptionBudget?.metadata?.name, bundle.resources.deploymentName)
      assert.equal(bundle.resources.hostname, `${maxLengthSubdomain}.dnd-notes.test`)
    } finally {
      await cleanup()
    }
  })

  it('normalizes tenant IDs before using them in kubernetes labels', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()

    try {
      const tenant = await tenantRegistry.createTenant({
        id: 'Tenant ID With Spaces / UPPERCASE / punctuation / '.repeat(3),
        slug: 'demo',
        ownerId: 'owner-1',
        version: '1.0.0',
      })
      const bundle = buildTenantInfrastructureBundle({
        tenant,
        subdomain: 't-opaque123456',
        database: {
          databaseName: 'tenant_demo_t_opaque123456',
          roleName: 'tenant_rt_demo_t_opaque123456',
          runtimeConnectionString:
            'postgresql://tenant_rt_demo_t_opaque123456:generated-runtime-password@postgres.default:5432/tenant_demo_t_opaque123456',
        },
        baseDomain: 'dnd-notes.test',
        imageRepository: 'ghcr.io/daydream-software/dnd-notes',
        publicScheme: 'https',
        tenantPort: 3000,
      })

      const labelValue = bundle.namespace.metadata?.labels?.['dnd-notes.dev/tenant-id']

      assert.ok(labelValue)
      assert.match(labelValue, /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/)
      assert.ok(labelValue.length <= 63)
      assert.equal(bundle.service.spec?.selector?.['dnd-notes.dev/tenant-id'], labelValue)
      assert.equal(
        bundle.deployment.spec?.selector?.matchLabels?.['dnd-notes.dev/tenant-id'],
        labelValue,
      )
      assert.equal(
        bundle.deployment.spec?.template?.metadata?.labels?.['dnd-notes.dev/tenant-id'],
        labelValue,
      )
    } finally {
      await cleanup()
    }
  })

  it('can derive tenant runtime database URLs separately from the admin URL', () => {
    assert.equal(
      buildTenantDatabaseConnectionString(
        'postgresql://postgres:postgres@platform-postgres.dnd-notes-platform.svc.cluster.local:5432/postgres?sslmode=disable',
        'tenant_demo_t_opaque123456',
      ),
      'postgresql://postgres:postgres@platform-postgres.dnd-notes-platform.svc.cluster.local:5432/tenant_demo_t_opaque123456?sslmode=disable',
    )
  })

  it('creates a per-tenant Keycloak client on provision with correct clientId and redirectUris', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()
    const databaseManager = new FakeDatabaseManager()
    const infrastructureManager = new FakeInfrastructureManager()
    const keycloakAdminClient = new FakeKeycloakAdminClient()

    const provisioningService = new TenantProvisioningService({
      tenantRegistry,
      databaseManager,
      infrastructureManager,
      keycloakAdminClient,
      tenantRuntimeAuth: keycloakTenantRuntimeAuth,
      baseDomain: 'dnd-notes.test',
      imageRepository: 'ghcr.io/daydream-software/dnd-notes',
    })

    try {
      await tenantRegistry.createTenant({
        id: 'tenant-demo',
        slug: 'demo',
        ownerId: 'owner-1',
        version: '1.0.0',
      })

      const result = await provisioningService.provisionTenant({
        tenantId: 'tenant-demo',
        triggeredBy: 'control-plane',
      })

      assert.equal(result.tenant.currentState, 'ready')
      assert.equal(keycloakAdminClient.ensureCalls.length, 1)
      const ensureCall = keycloakAdminClient.ensureCalls[0]
      assert.equal(ensureCall.clientId, 'dnd-notes-tenant-tenant-demo')
      assert.equal(ensureCall.publicClient, true)
      assert.equal(ensureCall.standardFlowEnabled, true)
      assert.equal(ensureCall.directAccessGrantsEnabled, true)
      const hostname = result.resources.hostname
      assert.deepEqual(ensureCall.redirectUris, [`https://${hostname}/*`, `http://${hostname}/*`])
      assert.deepEqual(ensureCall.webOrigins, [`https://${hostname}`, `http://${hostname}`])
      // pkce.code.challenge.method must be S256 — the smoke now uses the auth-code
      // + PKCE flow so server-side enforcement is safe to re-enable (#183).
      const attrs = ensureCall.attributes as Record<string, string> | undefined
      assert.equal(attrs?.['pkce.code.challenge.method'], 'S256')
    } finally {
      await provisioningService.close()
      await cleanup()
    }
  })

  it('sets tenant_display_name attribute on ensureClient when tenant has a displayName', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()
    const databaseManager = new FakeDatabaseManager()
    const infrastructureManager = new FakeInfrastructureManager()
    const keycloakAdminClient = new FakeKeycloakAdminClient()

    const provisioningService = new TenantProvisioningService({
      tenantRegistry,
      databaseManager,
      infrastructureManager,
      keycloakAdminClient,
      tenantRuntimeAuth: keycloakTenantRuntimeAuth,
      baseDomain: 'dnd-notes.test',
      imageRepository: 'ghcr.io/daydream-software/dnd-notes',
    })

    try {
      await tenantRegistry.createTenant({
        id: 'tenant-demo',
        slug: 'demo',
        ownerId: 'owner-1',
        displayName: 'Acme Notes',
        version: '1.0.0',
      })

      await provisioningService.provisionTenant({
        tenantId: 'tenant-demo',
        triggeredBy: 'control-plane',
      })

      assert.equal(keycloakAdminClient.ensureCalls.length, 1)
      const ensureCall = keycloakAdminClient.ensureCalls[0]
      const attrs = ensureCall.attributes as Record<string, string> | undefined
      assert.equal(attrs?.['tenant_display_name'], 'Acme Notes')
    } finally {
      await provisioningService.close()
      await cleanup()
    }
  })

  it('sets tenant_display_name to empty string on ensureClient when tenant has no displayName', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()
    const databaseManager = new FakeDatabaseManager()
    const infrastructureManager = new FakeInfrastructureManager()
    const keycloakAdminClient = new FakeKeycloakAdminClient()

    const provisioningService = new TenantProvisioningService({
      tenantRegistry,
      databaseManager,
      infrastructureManager,
      keycloakAdminClient,
      tenantRuntimeAuth: keycloakTenantRuntimeAuth,
      baseDomain: 'dnd-notes.test',
      imageRepository: 'ghcr.io/daydream-software/dnd-notes',
    })

    try {
      // No displayName set — null by default
      await tenantRegistry.createTenant({
        id: 'tenant-demo',
        slug: 'demo',
        ownerId: 'owner-1',
        version: '1.0.0',
      })

      await provisioningService.provisionTenant({
        tenantId: 'tenant-demo',
        triggeredBy: 'control-plane',
      })

      assert.equal(keycloakAdminClient.ensureCalls.length, 1)
      const ensureCall = keycloakAdminClient.ensureCalls[0]
      const attrs = ensureCall.attributes as Record<string, string> | undefined
      // No displayName means tenant_display_name is sent as '' — the FTL `?has_content` guard
      // treats an empty string as falsy, so the heading falls back to 'Sign in to D&D Notes'.
      assert.equal(attrs?.['tenant_display_name'], '')
    } finally {
      await provisioningService.close()
      await cleanup()
    }
  })

  it('clears tenant_display_name attribute on ensureClient when displayName flips non-null to null', async () => {
    const { tenantRegistry, pool, cleanup } = createTestTenantRegistry()
    const databaseManager = new FakeDatabaseManager()
    const infrastructureManager = new FakeInfrastructureManager()
    const keycloakAdminClient = new FakeKeycloakAdminClient()

    const provisioningService = new TenantProvisioningService({
      tenantRegistry,
      databaseManager,
      infrastructureManager,
      keycloakAdminClient,
      tenantRuntimeAuth: keycloakTenantRuntimeAuth,
      baseDomain: 'dnd-notes.test',
      imageRepository: 'ghcr.io/daydream-software/dnd-notes',
    })

    try {
      // First provision: tenant has a displayName — attribute is set.
      await tenantRegistry.createTenant({
        id: 'tenant-demo',
        slug: 'demo',
        ownerId: 'owner-1',
        displayName: 'My Workspace',
        version: '1.0.0',
      })

      await provisioningService.provisionTenant({
        tenantId: 'tenant-demo',
        triggeredBy: 'control-plane',
      })

      const firstCall = keycloakAdminClient.ensureCalls[0]
      const firstAttrs = firstCall.attributes as Record<string, string> | undefined
      assert.equal(firstAttrs?.['tenant_display_name'], 'My Workspace')

      // Simulate displayName flipping to null (e.g. via a future "edit tenant" API).
      await pool.query("UPDATE tenants SET display_name = NULL WHERE id = 'tenant-demo'")

      // Second provision: displayName is now null — attribute must be cleared to ''.
      await provisioningService.provisionTenant({
        tenantId: 'tenant-demo',
        triggeredBy: 'control-plane',
      })

      assert.equal(keycloakAdminClient.ensureCalls.length, 2)
      const secondCall = keycloakAdminClient.ensureCalls[1]
      const secondAttrs = secondCall.attributes as Record<string, string> | undefined
      // tenant_display_name must be '' so the FTL `?has_content` guard triggers
      // the fallback heading "Sign in to D&D Notes" (#248).
      assert.equal(secondAttrs?.['tenant_display_name'], '')
    } finally {
      await provisioningService.close()
      await cleanup()
    }
  })

  it('is idempotent when provisioning the same tenant twice (ensureClient called each time)', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()
    const databaseManager = new FakeDatabaseManager()
    const infrastructureManager = new FakeInfrastructureManager()
    const keycloakAdminClient = new FakeKeycloakAdminClient()

    const provisioningService = new TenantProvisioningService({
      tenantRegistry,
      databaseManager,
      infrastructureManager,
      keycloakAdminClient,
      tenantRuntimeAuth: keycloakTenantRuntimeAuth,
      baseDomain: 'dnd-notes.test',
      imageRepository: 'ghcr.io/daydream-software/dnd-notes',
    })

    try {
      await tenantRegistry.createTenant({
        id: 'tenant-demo',
        slug: 'demo',
        ownerId: 'owner-1',
        version: '1.0.0',
      })

      // First provision
      await provisioningService.provisionTenant({
        tenantId: 'tenant-demo',
        triggeredBy: 'control-plane',
      })
      const firstCall = keycloakAdminClient.ensureCalls[0]

      // Second provision (re-provision of existing ready tenant — new version)
      const result = await provisioningService.provisionTenant({
        tenantId: 'tenant-demo',
        triggeredBy: 'control-plane',
        version: '1.1.0',
      })

      assert.equal(result.tenant.currentState, 'ready')
      assert.equal(keycloakAdminClient.ensureCalls.length, 2)
      const secondCall = keycloakAdminClient.ensureCalls[1]
      // Both calls target the same derived clientId — re-provision is idempotent
      // at the call-site level; the wrapper handles the actual no-op.
      assert.equal(firstCall.clientId, secondCall.clientId)
      assert.deepEqual(firstCall.redirectUris, secondCall.redirectUris)
    } finally {
      await provisioningService.close()
      await cleanup()
    }
  })

  it('deletes the per-tenant Keycloak client on deprovision', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()
    const databaseManager = new FakeDatabaseManager()
    const infrastructureManager = new FakeInfrastructureManager()
    const keycloakAdminClient = new FakeKeycloakAdminClient()

    const provisioningService = new TenantProvisioningService({
      tenantRegistry,
      databaseManager,
      infrastructureManager,
      keycloakAdminClient,
      tenantRuntimeAuth: keycloakTenantRuntimeAuth,
      baseDomain: 'dnd-notes.test',
      imageRepository: 'ghcr.io/daydream-software/dnd-notes',
    })

    try {
      await tenantRegistry.createTenant({
        id: 'tenant-demo',
        slug: 'demo',
        ownerId: 'owner-1',
        version: '1.0.0',
      })

      await provisioningService.provisionTenant({
        tenantId: 'tenant-demo',
        triggeredBy: 'control-plane',
      })

      assert.equal(keycloakAdminClient.deleteCalls.length, 0)

      const result = await provisioningService.deprovisionTenant({
        tenantId: 'tenant-demo',
        triggeredBy: 'control-plane',
      })

      assert.equal(result.tenant.currentState, 'deprovisioned')
      assert.equal(keycloakAdminClient.deleteCalls.length, 1)
      assert.equal(keycloakAdminClient.deleteCalls[0], 'dnd-notes-tenant-tenant-demo')
    } finally {
      await provisioningService.close()
      await cleanup()
    }
  })

  it('does not block deprovision when Keycloak client deletion fails', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()
    const databaseManager = new FakeDatabaseManager()
    const infrastructureManager = new FakeInfrastructureManager()
    const keycloakAdminClient = new FakeKeycloakAdminClient()
    keycloakAdminClient.shouldThrowOnDelete = true

    const provisioningService = new TenantProvisioningService({
      tenantRegistry,
      databaseManager,
      infrastructureManager,
      keycloakAdminClient,
      tenantRuntimeAuth: keycloakTenantRuntimeAuth,
      baseDomain: 'dnd-notes.test',
      imageRepository: 'ghcr.io/daydream-software/dnd-notes',
    })

    try {
      await tenantRegistry.createTenant({
        id: 'tenant-demo',
        slug: 'demo',
        ownerId: 'owner-1',
        version: '1.0.0',
      })

      await provisioningService.provisionTenant({
        tenantId: 'tenant-demo',
        triggeredBy: 'control-plane',
      })

      // Deprovision must succeed even though the KC client deletion throws
      const result = await provisioningService.deprovisionTenant({
        tenantId: 'tenant-demo',
        triggeredBy: 'control-plane',
      })

      assert.equal(result.tenant.currentState, 'deprovisioned')
      assert.equal(result.deprovisioned, true)
    } finally {
      await provisioningService.close()
      await cleanup()
    }
  })

  it('skips per-tenant Keycloak steps when no keycloakAdminClient is configured', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()
    const databaseManager = new FakeDatabaseManager()
    const infrastructureManager = new FakeInfrastructureManager()

    // No keycloakAdminClient passed — auth-disabled path
    const provisioningService = new TenantProvisioningService({
      tenantRegistry,
      databaseManager,
      infrastructureManager,
      baseDomain: 'dnd-notes.test',
      imageRepository: 'ghcr.io/daydream-software/dnd-notes',
    })

    try {
      await tenantRegistry.createTenant({
        id: 'tenant-demo',
        slug: 'demo',
        ownerId: 'owner-1',
        version: '1.0.0',
      })

      const result = await provisioningService.provisionTenant({
        tenantId: 'tenant-demo',
        triggeredBy: 'control-plane',
      })

      assert.equal(result.tenant.currentState, 'ready')

      const depResult = await provisioningService.deprovisionTenant({
        tenantId: 'tenant-demo',
        triggeredBy: 'control-plane',
      })

      assert.equal(depResult.tenant.currentState, 'deprovisioned')
    } finally {
      await provisioningService.close()
      await cleanup()
    }
  })

  it('creates the tenant-member client role on provision (#196 role gate)', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()
    const databaseManager = new FakeDatabaseManager()
    const infrastructureManager = new FakeInfrastructureManager()
    const keycloakAdminClient = new FakeKeycloakAdminClient()

    const provisioningService = new TenantProvisioningService({
      tenantRegistry,
      databaseManager,
      infrastructureManager,
      keycloakAdminClient,
      tenantRuntimeAuth: keycloakTenantRuntimeAuth,
      baseDomain: 'dnd-notes.test',
      imageRepository: 'ghcr.io/daydream-software/dnd-notes',
    })

    try {
      await tenantRegistry.createTenant({
        id: 'tenant-demo',
        slug: 'demo',
        ownerId: 'owner-1',
        version: '1.0.0',
      })

      const result = await provisioningService.provisionTenant({
        tenantId: 'tenant-demo',
        triggeredBy: 'control-plane',
      })

      assert.equal(result.tenant.currentState, 'ready')
      assert.equal(keycloakAdminClient.ensureClientRoleCalls.length, 1)
      assert.deepEqual(keycloakAdminClient.ensureClientRoleCalls[0], {
        clientId: 'dnd-notes-tenant-tenant-demo',
        roleName: 'tenant-member',
      })
    } finally {
      await provisioningService.close()
      await cleanup()
    }
  })

  it('is idempotent on the role-creation step — re-provisioning calls ensureClientRole again', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()
    const databaseManager = new FakeDatabaseManager()
    const infrastructureManager = new FakeInfrastructureManager()
    const keycloakAdminClient = new FakeKeycloakAdminClient()

    const provisioningService = new TenantProvisioningService({
      tenantRegistry,
      databaseManager,
      infrastructureManager,
      keycloakAdminClient,
      tenantRuntimeAuth: keycloakTenantRuntimeAuth,
      baseDomain: 'dnd-notes.test',
      imageRepository: 'ghcr.io/daydream-software/dnd-notes',
    })

    try {
      await tenantRegistry.createTenant({
        id: 'tenant-demo',
        slug: 'demo',
        ownerId: 'owner-1',
        version: '1.0.0',
      })

      await provisioningService.provisionTenant({
        tenantId: 'tenant-demo',
        triggeredBy: 'control-plane',
      })
      await provisioningService.provisionTenant({
        tenantId: 'tenant-demo',
        triggeredBy: 'control-plane',
        version: '1.1.0',
      })

      assert.equal(keycloakAdminClient.ensureClientRoleCalls.length, 2)
      // Both calls target the same role on the same per-tenant client.
      assert.equal(
        keycloakAdminClient.ensureClientRoleCalls[0]?.clientId,
        keycloakAdminClient.ensureClientRoleCalls[1]?.clientId,
      )
      assert.equal(
        keycloakAdminClient.ensureClientRoleCalls[0]?.roleName,
        keycloakAdminClient.ensureClientRoleCalls[1]?.roleName,
      )
    } finally {
      await provisioningService.close()
      await cleanup()
    }
  })

  it('assigns the tenant-member role to the creator when their portal_account has a keycloak_sub', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()
    const databaseManager = new FakeDatabaseManager()
    const infrastructureManager = new FakeInfrastructureManager()
    const keycloakAdminClient = new FakeKeycloakAdminClient()

    const provisioningService = new TenantProvisioningService({
      tenantRegistry,
      databaseManager,
      infrastructureManager,
      keycloakAdminClient,
      tenantRuntimeAuth: keycloakTenantRuntimeAuth,
      baseDomain: 'dnd-notes.test',
      imageRepository: 'ghcr.io/daydream-software/dnd-notes',
    })

    try {
      // Owner has signed in via Keycloak before creating the tenant — sub is set.
      await tenantRegistry.createPortalAccount({
        id: 'owner-1',
        email: 'creator@example.com',
        displayName: 'Tenant Creator',
        authProvider: 'keycloak',
        keycloakSub: 'creator-keycloak-sub',
      })
      await tenantRegistry.createTenant({
        id: 'tenant-demo',
        slug: 'demo',
        ownerId: 'owner-1',
        version: '1.0.0',
      })

      await provisioningService.provisionTenant({
        tenantId: 'tenant-demo',
        triggeredBy: 'control-plane',
      })

      assert.equal(keycloakAdminClient.assignClientRoleCalls.length, 1)
      assert.deepEqual(keycloakAdminClient.assignClientRoleCalls[0], {
        userId: 'creator-keycloak-sub',
        clientId: 'dnd-notes-tenant-tenant-demo',
        roleName: 'tenant-member',
      })
    } finally {
      await provisioningService.close()
      await cleanup()
    }
  })

  it('skips role assignment when the tenant creator has no keycloak_sub yet (transition path)', async () => {
    // Owner exists in portal_accounts but has not signed in via Keycloak yet —
    // happens when the tenant was created in `local` mode and is being
    // provisioned/re-provisioned. The role-assignment step is deliberately
    // deferred to the /portal/me auto-link sweep (or the next re-provision
    // after the owner's first KC login).
    const { tenantRegistry, cleanup } = createTestTenantRegistry()
    const databaseManager = new FakeDatabaseManager()
    const infrastructureManager = new FakeInfrastructureManager()
    const keycloakAdminClient = new FakeKeycloakAdminClient()

    const provisioningService = new TenantProvisioningService({
      tenantRegistry,
      databaseManager,
      infrastructureManager,
      keycloakAdminClient,
      tenantRuntimeAuth: keycloakTenantRuntimeAuth,
      baseDomain: 'dnd-notes.test',
      imageRepository: 'ghcr.io/daydream-software/dnd-notes',
    })

    try {
      await tenantRegistry.createPortalAccount({
        id: 'owner-1',
        email: 'creator@example.com',
        displayName: 'Tenant Creator',
        // No keycloakSub.
        authProvider: 'local',
      })
      await tenantRegistry.createTenant({
        id: 'tenant-demo',
        slug: 'demo',
        ownerId: 'owner-1',
        version: '1.0.0',
      })

      const result = await provisioningService.provisionTenant({
        tenantId: 'tenant-demo',
        triggeredBy: 'control-plane',
      })

      assert.equal(result.tenant.currentState, 'ready')
      // Role created, but no assignment fired — owner has no sub.
      assert.equal(keycloakAdminClient.ensureClientRoleCalls.length, 1)
      assert.equal(keycloakAdminClient.assignClientRoleCalls.length, 0)
    } finally {
      await provisioningService.close()
      await cleanup()
    }
  })

  it('falls back to a Keycloak user-by-email lookup when no portal_account.keycloak_sub is recorded (admin-created tenant path)', async () => {
    // Admin-created tenant: the control-plane API was called with an
    // `initialAdminEmail` but the owner has not signed in through the
    // portal yet, so portal_accounts has no row (or no keycloak_sub) for
    // them. The provisioner must still assign the per-tenant role to the
    // intended owner — the smoke and operator-portal flows depend on it.
    // We resolve the email to a Keycloak user id via the admin REST API
    // and assign the role to that id.
    const { tenantRegistry, cleanup } = createTestTenantRegistry()
    const databaseManager = new FakeDatabaseManager()
    const infrastructureManager = new FakeInfrastructureManager()
    const keycloakAdminClient = new FakeKeycloakAdminClient()
    keycloakAdminClient.usersByEmail.set('admin-owner@example.com', {
      id: 'kc-user-id-admin-owner',
    })

    const provisioningService = new TenantProvisioningService({
      tenantRegistry,
      databaseManager,
      infrastructureManager,
      keycloakAdminClient,
      tenantRuntimeAuth: keycloakTenantRuntimeAuth,
      baseDomain: 'dnd-notes.test',
      imageRepository: 'ghcr.io/daydream-software/dnd-notes',
    })

    try {
      // No portal_accounts row created for the owner — the only signal we
      // have is the tenant.initialAdminEmail recorded at create time.
      await tenantRegistry.createTenant({
        id: 'tenant-demo',
        slug: 'demo',
        ownerId: 'admin-owner-account-id',
        initialAdminEmail: 'admin-owner@example.com',
        version: '1.0.0',
      })

      await provisioningService.provisionTenant({
        tenantId: 'tenant-demo',
        triggeredBy: 'control-plane',
      })

      assert.deepEqual(keycloakAdminClient.findUserByEmailCalls, [
        'admin-owner@example.com',
      ])
      assert.equal(keycloakAdminClient.assignClientRoleCalls.length, 1)
      assert.deepEqual(keycloakAdminClient.assignClientRoleCalls[0], {
        userId: 'kc-user-id-admin-owner',
        clientId: 'dnd-notes-tenant-tenant-demo',
        roleName: 'tenant-member',
      })
    } finally {
      await provisioningService.close()
      await cleanup()
    }
  })

  it('skips role assignment when the email-fallback finds no matching Keycloak user', async () => {
    // Admin-created tenant whose initialAdminEmail does not (yet) correspond
    // to a Keycloak user. The provisioner must not throw — the role is
    // simply not assigned, and the next re-provision (after the owner has
    // self-registered in Keycloak) will pick it up.
    const { tenantRegistry, cleanup } = createTestTenantRegistry()
    const databaseManager = new FakeDatabaseManager()
    const infrastructureManager = new FakeInfrastructureManager()
    const keycloakAdminClient = new FakeKeycloakAdminClient()
    // Intentionally do NOT add the email to usersByEmail.

    const provisioningService = new TenantProvisioningService({
      tenantRegistry,
      databaseManager,
      infrastructureManager,
      keycloakAdminClient,
      tenantRuntimeAuth: keycloakTenantRuntimeAuth,
      baseDomain: 'dnd-notes.test',
      imageRepository: 'ghcr.io/daydream-software/dnd-notes',
    })

    try {
      await tenantRegistry.createTenant({
        id: 'tenant-demo',
        slug: 'demo',
        ownerId: 'admin-owner-account-id',
        initialAdminEmail: 'unknown@example.com',
        version: '1.0.0',
      })

      const result = await provisioningService.provisionTenant({
        tenantId: 'tenant-demo',
        triggeredBy: 'control-plane',
      })

      assert.equal(result.tenant.currentState, 'ready')
      assert.equal(keycloakAdminClient.assignClientRoleCalls.length, 0)
      assert.deepEqual(keycloakAdminClient.findUserByEmailCalls, [
        'unknown@example.com',
      ])
    } finally {
      await provisioningService.close()
      await cleanup()
    }
  })

  it('defers tenant-member role assignment when the email lookup is ambiguous (CodeRabbit #200)', async () => {
    // Realms that allow duplicate emails can return more than one Keycloak
    // user for a single address. findUserByEmail throws KeycloakAdminError
    // with statusCode === 409 in that case (it refuses to guess), and the
    // provisioner must catch it, log a warning, and continue — assignment
    // is deferred to the next provisioning sweep, where the canonical
    // portal_account.keycloak_sub link should be in place.
    const { tenantRegistry, cleanup } = createTestTenantRegistry()
    const databaseManager = new FakeDatabaseManager()
    const infrastructureManager = new FakeInfrastructureManager()
    const keycloakAdminClient = new FakeKeycloakAdminClient()
    keycloakAdminClient.ambiguousEmails.add('shared@example.com')

    const provisioningService = new TenantProvisioningService({
      tenantRegistry,
      databaseManager,
      infrastructureManager,
      keycloakAdminClient,
      tenantRuntimeAuth: keycloakTenantRuntimeAuth,
      baseDomain: 'dnd-notes.test',
      imageRepository: 'ghcr.io/daydream-software/dnd-notes',
    })

    try {
      await tenantRegistry.createTenant({
        id: 'tenant-demo',
        slug: 'demo',
        ownerId: 'admin-owner-account-id',
        initialAdminEmail: 'shared@example.com',
        version: '1.0.0',
      })

      const result = await provisioningService.provisionTenant({
        tenantId: 'tenant-demo',
        triggeredBy: 'control-plane',
      })

      // Provisioning must succeed — the ambiguity is non-fatal.
      assert.equal(result.tenant.currentState, 'ready')
      // The role is created but not assigned to anyone.
      assert.equal(keycloakAdminClient.ensureClientRoleCalls.length, 1)
      assert.equal(keycloakAdminClient.assignClientRoleCalls.length, 0)
      // The lookup was attempted exactly once.
      assert.deepEqual(keycloakAdminClient.findUserByEmailCalls, [
        'shared@example.com',
      ])
    } finally {
      await provisioningService.close()
      await cleanup()
    }
  })

})

function extractQuotedIdentifier(sql: string) {
  const match = sql.match(/"([^"]+)"/)

  if (!match) {
    throw new Error(`Expected quoted identifier in SQL: ${sql}`)
  }

  return match[1]
}

function createPostgresManagerHarness() {
  const databases = new Set<string>()
  const roles = new Set<string>()
  const adminQueries: Array<{ sql: string; values?: readonly unknown[] }> = []
  const tenantQueries: string[] = []
  let adminPoolEnded = false
  const tenantPoolEndCalls: string[] = []

  const adminPool = {
    async connect() {
      return {
        async query<Row extends { [key: string]: unknown } = Record<string, never>>(
          sql: string,
          values?: readonly unknown[],
        ) {
          adminQueries.push({ sql, values })

          if (sql.includes('FROM pg_database')) {
            return {
              rows: [
                {
                  exists: databases.has(String(values?.[0] ?? '')),
                },
              ] as Row[],
            }
          }

          if (sql.includes('FROM pg_roles')) {
            return {
              rows: [
                {
                  exists: roles.has(String(values?.[0] ?? '')),
                },
              ] as Row[],
            }
          }

          if (sql.startsWith('CREATE DATABASE ')) {
            databases.add(extractQuotedIdentifier(sql))
          } else if (
            sql.startsWith('CREATE ROLE ') ||
            sql.startsWith('ALTER ROLE ')
          ) {
            roles.add(extractQuotedIdentifier(sql))
          } else if (sql.startsWith('DROP DATABASE ')) {
            databases.delete(extractQuotedIdentifier(sql))
          } else if (sql.startsWith('DROP ROLE IF EXISTS ')) {
            roles.delete(extractQuotedIdentifier(sql))
          }

          return { rows: [] as Row[] }
        },
        release() {},
      }
    },
    async end() {
      adminPoolEnded = true
    },
  }

  const manager = new PostgresTenantDatabaseManager(
    'postgresql://admin:admin@platform-postgres.dnd-notes-platform.svc.cluster.local:5432/postgres?sslmode=disable',
    'postgresql://runtime-template:placeholder@platform-postgres.dnd-notes-platform.svc.cluster.local:5432/postgres?sslmode=disable',
    {
      pool: adminPool,
      createTenantPool(connectionString: string) {
        return {
          async connect() {
            return {
              async query(sql: string) {
                tenantQueries.push(sql)
                if (sql.includes('pg_try_advisory_lock')) {
                  return { rows: [{ locked: true }] }
                }
                return { rows: [] }
              },
              release() {},
            }
          },
          async end() {
            tenantPoolEndCalls.push(connectionString)
          },
        }
      },
      generatePassword: () => 'generated-runtime-password',
    },
  )

  return {
    adminPoolEnded: () => adminPoolEnded,
    adminQueries,
    databases,
    manager,
    roles,
    tenantPoolEndCalls,
    tenantQueries,
  }
}

describe('PostgresTenantDatabaseManager', () => {
  it('creates per-tenant runtime roles and grants least-privilege access for new tenants', async () => {
    const harness = createPostgresManagerHarness()

    const database = await harness.manager.ensureTenantDatabase(
      createTenantRecord(),
      't-opaque123456',
    )

    const runtimeDatabaseUrl = new URL(database.runtimeConnectionString)

    assert.equal(database.roleName, decodeURIComponent(runtimeDatabaseUrl.username))
    assert.equal(
      decodeURIComponent(runtimeDatabaseUrl.password),
      'generated-runtime-password',
    )
    assert.equal(runtimeDatabaseUrl.pathname, `/${database.databaseName}`)
    assert.equal(runtimeDatabaseUrl.searchParams.get('sslmode'), 'disable')
    assert.equal(
      harness.adminQueries.some((query) => query.sql.startsWith('CREATE ROLE ')),
      true,
    )
    const createRoleQuery = harness.adminQueries.find((query) =>
      query.sql.startsWith('CREATE ROLE '),
    )
    assert.ok(createRoleQuery)
    assert.equal(createRoleQuery.values, undefined)
    assert.match(createRoleQuery.sql, /PASSWORD 'generated-runtime-password'/)
    assert.equal(
      harness.adminQueries.some((query) =>
        query.sql.startsWith('GRANT CONNECT ON DATABASE '),
      ),
      true,
    )
    assert.equal(
      harness.tenantQueries.some((sql) =>
        sql.includes('CREATE TABLE IF NOT EXISTS owner_accounts'),
      ),
      true,
    )
    assert.equal(
      harness.tenantQueries.some((sql) => sql.includes('schema_migrations_tenant_api')),
      true,
    )
    assert.equal(
      harness.tenantQueries.some((sql) =>
        sql.includes('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES'),
      ),
      true,
    )

    await harness.manager.close()
    assert.equal(harness.adminPoolEnded(), true)
    assert.equal(harness.tenantPoolEndCalls.length, 1)
  })

  it('preserves legacy runtime credentials during existing-tenant reprovisioning', async () => {
    const harness = createPostgresManagerHarness()
    const legacyRuntimeUrl =
      'postgresql://shared-runtime:shared-password@platform-postgres.dnd-notes-platform.svc.cluster.local:5432/postgres?sslmode=disable'

    const database = await harness.manager.ensureTenantDatabase(
      createTenantRecord({ subdomain: 't-existing123456', currentState: 'ready' }),
      't-existing123456',
      {
        existingRuntimeConnectionString: legacyRuntimeUrl,
        requireExistingRuntimeConnectionString: true,
      },
    )

    const runtimeDatabaseUrl = new URL(database.runtimeConnectionString)

    assert.equal(database.roleName, null)
    assert.equal(decodeURIComponent(runtimeDatabaseUrl.username), 'shared-runtime')
    assert.equal(decodeURIComponent(runtimeDatabaseUrl.password), 'shared-password')
    assert.equal(runtimeDatabaseUrl.pathname, `/${database.databaseName}`)
    assert.equal(
      harness.adminQueries.some((query) => query.sql.startsWith('CREATE ROLE ')),
      false,
    )
    assert.equal(
      harness.tenantQueries.some((sql) =>
        sql.includes('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES'),
      ),
      false,
    )
  })

  it('fails existing-tenant reprovisioning when the runtime secret is missing', async () => {
    const harness = createPostgresManagerHarness()

    await assert.rejects(
      harness.manager.ensureTenantDatabase(
        createTenantRecord({ subdomain: 't-existing123456', currentState: 'ready' }),
        't-existing123456',
        {
          requireExistingRuntimeConnectionString: true,
        },
      ),
      /runtime database secret is missing/,
    )
  })

  it('fails existing-tenant reprovisioning when the runtime secret is blank', async () => {
    const harness = createPostgresManagerHarness()

    await assert.rejects(
      harness.manager.ensureTenantDatabase(
        createTenantRecord({ subdomain: 't-existing123456', currentState: 'ready' }),
        't-existing123456',
        {
          existingRuntimeConnectionString: '   ',
          requireExistingRuntimeConnectionString: true,
        },
      ),
      /runtime database secret is missing/,
    )
  })

  it('rejects existing-tenant reprovisioning with actionable error when DATABASE_URL is malformed', async () => {
    const harness = createPostgresManagerHarness()
    const malformedRuntimeUrl = 'postgresql://tenant-user:super-secret password@['

    await assert.rejects(
      harness.manager.ensureTenantDatabase(
        createTenantRecord({ id: 'tenant-demo', subdomain: 't-existing123456', currentState: 'ready' }),
        't-existing123456',
        {
          existingRuntimeConnectionString: malformedRuntimeUrl,
          requireExistingRuntimeConnectionString: true,
        },
      ),
      (error: Error) => {
        assert.match(error.message, /Invalid DATABASE_URL in runtime secret/)
        assert.match(error.message, /tenant-demo/)
        assert.match(error.message, /must be a valid PostgreSQL connection string/)
        assert.equal(error.message.includes('super-secret'), false)
        assert.equal(error.message.includes(malformedRuntimeUrl), false)
        return true
      },
    )
  })

  it('keeps long tenant database and role names unique when truncation is required', async () => {
    const harness = createPostgresManagerHarness()
    const sharedPrefix = `t-${'a'.repeat(maxTenantSubdomainLength - 3)}`
    const firstDatabase = await harness.manager.ensureTenantDatabase(
      createTenantRecord({ id: 'tenant-demo' }),
      `${sharedPrefix}b`,
    )
    const secondDatabase = await harness.manager.ensureTenantDatabase(
      createTenantRecord({ id: 'tenant-demo' }),
      `${sharedPrefix}c`,
    )

    assert.notEqual(firstDatabase.databaseName, secondDatabase.databaseName)
    assert.notEqual(firstDatabase.roleName, secondDatabase.roleName)
    assert.ok(firstDatabase.databaseName.length <= 63)
    assert.ok(secondDatabase.databaseName.length <= 63)
    assert.ok((firstDatabase.roleName ?? '').length <= 63)
    assert.ok((secondDatabase.roleName ?? '').length <= 63)
  })

  it('drops tenant sessions, the database, and the dedicated runtime role on deprovision', async () => {
    const harness = createPostgresManagerHarness()
    harness.databases.add('tenant_tenant_demo_t_existing123456')
    harness.roles.add('tenant_rt_tenant_demo_t_existing123456')

    await harness.manager.deleteTenantDatabase(
      createTenantRecord({ subdomain: 't-existing123456', currentState: 'ready' }),
      't-existing123456',
    )

    assert.equal(
      harness.adminQueries.some((query) =>
        query.sql.includes('SELECT pg_terminate_backend(pid)'),
      ),
      true,
    )
    assert.equal(
      harness.adminQueries.some((query) =>
        query.sql.startsWith('DROP DATABASE "tenant_tenant_demo_t_existing123456"'),
      ),
      true,
    )
    assert.equal(
      harness.adminQueries.some((query) =>
        query.sql.startsWith(
          'DROP ROLE IF EXISTS "tenant_rt_tenant_demo_t_existing123456"',
        ),
      ),
      true,
    )
  })
})

class FakeKubernetesClient {
  readonly createCalls: KubernetesObject[] = []
  readonly replaceCalls: KubernetesObject[] = []
  readonly deleteCalls: KubernetesObject[] = []
  namespaceReadCountdown = 0
  private readonly objects = new Map<string, KubernetesObject>()

  seed(object: KubernetesObject & { metadata: { name: string; namespace?: string } }) {
    this.objects.set(this.keyFor(object), structuredClone(object))
  }

  async create<T extends KubernetesObject>(spec: T): Promise<T> {
    this.createCalls.push(structuredClone(spec))
    this.objects.set(this.keyFor(spec), structuredClone(spec))
    return structuredClone(spec)
  }

  async read<T extends KubernetesObject>(spec: {
    apiVersion: string
    kind: string
    metadata: { name: string; namespace?: string }
  }): Promise<T> {
    if (spec.kind === 'Namespace' && this.namespaceReadCountdown > 0) {
      this.namespaceReadCountdown -= 1
      return {
        apiVersion: 'v1',
        kind: 'Namespace',
        metadata: { name: spec.metadata.name },
      } as T
    }

    const existing = this.objects.get(this.keyFor(spec))
    if (!existing) {
      throw new ApiException(404, 'Not Found', { reason: 'NotFound' }, {})
    }

    return structuredClone(existing) as T
  }

  async replace<T extends KubernetesObject>(spec: T): Promise<T> {
    this.replaceCalls.push(structuredClone(spec))
    this.objects.set(this.keyFor(spec), structuredClone(spec))
    return structuredClone(spec)
  }

  async delete(spec: KubernetesObject): Promise<V1Status> {
    this.deleteCalls.push(structuredClone(spec))
    const deleted = this.objects.delete(this.keyFor(spec))

    if (!deleted && spec.kind === 'Namespace' && this.namespaceReadCountdown === 0) {
      throw new ApiException(404, 'Not Found', { reason: 'NotFound' }, {})
    }

    return {
      apiVersion: 'v1',
      kind: 'Status',
      status: 'Success',
    }
  }

  private keyFor(spec: {
    apiVersion: string
    kind: string
    metadata: { name: string; namespace?: string }
  }): string {
    return [
      spec.apiVersion,
      spec.kind,
      spec.metadata.namespace ?? '',
      spec.metadata.name,
    ].join('::')
  }
}

describe('KubernetesTenantInfrastructureManager', () => {
  it('preserves service-assigned fields when replacing an existing Service', async () => {
    const { tenantRegistry, cleanup } = createTestTenantRegistry()
    const tenant = await tenantRegistry.createTenant({
      id: 'tenant-demo',
      slug: 'demo',
      ownerId: 'owner-1',
      version: '1.0.0',
    })
    await tenantRegistry.updateTenantStorageReference(
      tenant.id,
      'tenant_demo_t_opaque123456',
    )
    const legacyTenant = (await tenantRegistry.getTenant(tenant.id))!
    const bundle = buildTenantInfrastructureBundle({
      tenant: legacyTenant,
      subdomain: 't-opaque123456',
      database: {
        databaseName: 'tenant_demo_t_opaque123456',
        roleName: 'tenant_rt_demo_t_opaque123456',
        runtimeConnectionString:
          'postgresql://tenant_rt_demo_t_opaque123456:generated-runtime-password@postgres.default:5432/tenant_demo_t_opaque123456',
      },
      baseDomain: 'dnd-notes.test',
      imageRepository: 'ghcr.io/daydream-software/dnd-notes',
      publicScheme: 'https',
      tenantPort: 3000,
    })
    const client = new FakeKubernetesClient()

    try {
      for (const object of [
        bundle.namespace,
        bundle.configMap,
        bundle.secret,
        bundle.ingress,
        bundle.deployment,
      ]) {
        client.seed({
          ...object,
          metadata: {
            ...object.metadata!,
            resourceVersion: '1',
          },
        })
      }

      client.seed({
        ...bundle.service,
        metadata: {
          ...bundle.service.metadata!,
          resourceVersion: '1',
        },
        spec: {
          ...bundle.service.spec,
          clusterIP: '10.43.0.10',
          clusterIPs: ['10.43.0.10'],
          ipFamilies: ['IPv4'],
          ipFamilyPolicy: 'SingleStack',
        },
      })

      const manager = new KubernetesTenantInfrastructureManager({ client })
      await manager.applyTenantResources(bundle)

      const replacedService = client.replaceCalls.find(
        (object) => object.kind === 'Service',
      ) as
        | (KubernetesObject & {
            spec?: {
              clusterIP?: string
              clusterIPs?: string[]
            }
          })
        | undefined

      assert.ok(replacedService)
      assert.equal(replacedService.spec?.clusterIP, '10.43.0.10')
      assert.deepEqual(replacedService.spec?.clusterIPs, ['10.43.0.10'])
    } finally {
      await cleanup()
    }
  })

  it('waits for namespace termination before finishing tenant deletion', async () => {
    const client = new FakeKubernetesClient()
    client.namespaceReadCountdown = 2
    client.seed({
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: {
        name: 'tenant-t-opaque123456',
      },
    })

    const manager = new KubernetesTenantInfrastructureManager({
      client,
      readyPollIntervalMs: 1,
      deleteTimeoutMs: 200,
    })

    await manager.deleteTenantResources({
      namespace: 'tenant-t-opaque123456',
      deploymentName: 'dnd-notes',
      serviceName: 'dnd-notes',
      configMapName: 'dnd-notes-runtime',
      secretName: 'dnd-notes-runtime-secret',
      hostname: 't-opaque123456.dnd-notes.test',
      databaseName: 'tenant_demo_t_opaque123456',
      image: 'ghcr.io/daydream-software/dnd-notes:1.0.0',
    })

    assert.deepEqual(
      client.deleteCalls.map((call) => call.kind),
      ['Namespace'],
    )
    assert.equal(client.namespaceReadCountdown, 0)
  })
})

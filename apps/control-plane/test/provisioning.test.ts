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
    backupMetadata: null,
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
          mode: 'keycloak',
          keycloakUrl: 'https://auth.example.com',
          keycloakJwksUrl: 'http://platform-keycloak.dnd-notes-platform.svc.cluster.local:8080/realms/dnd-notes-prod/protocol/openid-connect/certs',
          keycloakRealm: 'dnd-notes-prod',
          keycloakClientId: 'dnd-notes-tenant-app',
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
      assert.equal(
        infrastructureManager.bundles[0].keycloakClientId,
        'dnd-notes-tenant-app',
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

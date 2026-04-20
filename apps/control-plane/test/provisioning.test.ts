import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ApiException, type KubernetesObject, type V1Status } from '@kubernetes/client-node'
import {
  KubernetesTenantInfrastructureManager,
  TenantProvisioningService,
  buildTenantInfrastructureBundle,
  buildTenantResourceNames,
  type TenantProvisioningPort,
} from '../src/provisioning.js'
import { TenantRegistry } from '../src/tenant-registry.js'
import type { TenantProvisioningResources } from '../src/types.js'

class FakeDatabaseManager {
  createdDatabaseNames: string[] = []
  deletedDatabaseNames: string[] = []

  async ensureTenantDatabase(_tenant: { id: string }, subdomain: string) {
    const databaseName = `tenant_demo_${subdomain.replace(/-/g, '_')}`
    this.createdDatabaseNames.push(databaseName)
    return {
      databaseName,
      connectionString: `postgresql://postgres:postgres@postgres.default:5432/${databaseName}`,
    }
  }

  async deleteTenantDatabase(databaseName: string) {
    this.deletedDatabaseNames.push(databaseName)
  }

  async close() {}
}

class FakeInfrastructureManager {
  bundles: Array<{
    resources: TenantProvisioningResources
    deploymentReadinessPath: string | undefined
  }> = []
  deletedResources: TenantProvisioningResources[] = []
  shouldThrow = false

  async applyTenantResources(bundle: {
    resources: TenantProvisioningResources
    deployment: {
      spec?: {
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
      deploymentReadinessPath:
        bundle.deployment.spec?.template?.spec?.containers?.[0]?.readinessProbe
          ?.httpGet?.path,
    })

    if (this.shouldThrow) {
      throw new Error('synthetic infrastructure failure')
    }
  }

  async waitForTenantReady() {}

  async deleteTenantResources(resources: TenantProvisioningResources) {
    this.deletedResources.push(resources)
  }
}

describe('TenantProvisioningService', () => {
  it('provisions tenant resources, allocates an opaque subdomain, and marks tenant ready', async () => {
    const tenantRegistry = new TenantRegistry(':memory:')
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
      tenantRegistry.createTenant({
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
      assert.equal(result.tenant.desiredState, 'ready')
      assert.match(result.tenant.subdomain ?? '', /^t-[0-9a-f]{12}$/)
      assert.equal(
        result.tenant.storageReference,
        result.resources.pvcName,
      )
      assert.equal(infrastructureManager.bundles.length, 1)
      assert.equal(infrastructureManager.bundles[0].deploymentReadinessPath, '/ready')
      assert.equal(
        infrastructureManager.bundles[0].resources.hostname,
        `${result.tenant.subdomain}.dnd-notes.test`,
      )
    } finally {
      await provisioningService.close()
      tenantRegistry.close()
    }
  })

  it('reconciles an updated version when provision is called with a version override', async () => {
    const tenantRegistry = new TenantRegistry(':memory:')
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
      tenantRegistry.createTenant({
        id: 'tenant-demo',
        slug: 'demo',
        ownerId: 'owner-1',
        version: '1.0.0',
      })
      tenantRegistry.updateTenantSubdomain('tenant-demo', 't-existing123456')

      const result = await provisioningService.provisionTenant({
        tenantId: 'tenant-demo',
        triggeredBy: 'control-plane',
        version: '1.1.0',
      })

      assert.equal(result.tenant.version, '1.1.0')
      assert.equal(
        infrastructureManager.bundles[0].resources.image,
        'ghcr.io/daydream-software/dnd-notes:1.1.0',
      )
      assert.equal(result.tenant.subdomain, 't-existing123456')
    } finally {
      await provisioningService.close()
      tenantRegistry.close()
    }
  })

  it('marks tenant failed when infrastructure application throws', async () => {
    const tenantRegistry = new TenantRegistry(':memory:')
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
      tenantRegistry.createTenant({
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

      const tenant = tenantRegistry.getTenant('tenant-demo')
      assert.equal(tenant?.currentState, 'failed')
      assert.equal(tenant?.desiredState, 'ready')
      assert.ok(tenant?.subdomain)
    } finally {
      await provisioningService.close()
      tenantRegistry.close()
    }
  })

  it('deprovisions tenant resources and clears the storage reference', async () => {
    const tenantRegistry = new TenantRegistry(':memory:')
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
      tenantRegistry.createTenant({
        id: 'tenant-demo',
        slug: 'demo',
        ownerId: 'owner-1',
        version: '1.0.0',
      })
      tenantRegistry.updateTenantSubdomain('tenant-demo', 't-existing123456')
      tenantRegistry.updateTenantStorageReference(
        'tenant-demo',
        'dnd-notes-data-t-existing123456',
      )
      tenantRegistry.updateTenantState(
        'tenant-demo',
        'ready',
        'control-plane',
        'Provisioned already',
      )
      tenantRegistry.updateTenantDesiredState('tenant-demo', 'ready')

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
          tenant: tenantRegistry.getTenant('tenant-demo')!,
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
      tenantRegistry.close()
    }
  })

  it('does not fabricate tenant resources when deprovisioning a tenant that was never provisioned', async () => {
    const tenantRegistry = new TenantRegistry(':memory:')
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
      tenantRegistry.createTenant({
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
      tenantRegistry.close()
    }
  })

  it('builds a tenant PVC and mounts it into the workload', () => {
    const tenantRegistry = new TenantRegistry(':memory:')

    try {
      const tenant = tenantRegistry.createTenant({
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
          connectionString:
            'postgresql://postgres:postgres@postgres.default:5432/tenant_demo_t_opaque123456',
        },
        baseDomain: 'dnd-notes.test',
        imageRepository: 'ghcr.io/daydream-software/dnd-notes',
        publicScheme: 'https',
        tenantPort: 3000,
      })

      assert.equal(bundle.resources.pvcName, 'dnd-notes-data-t-opaque123456')
      assert.equal(bundle.persistentVolumeClaim.metadata?.name, bundle.resources.pvcName)
      assert.equal(
        bundle.configMap.data?.NOTES_DB_PATH,
        '/app/data/dnd-notes.sqlite',
      )
      assert.deepEqual(bundle.persistentVolumeClaim.spec?.accessModes, ['ReadWriteOnce'])
      assert.deepEqual(bundle.deployment.spec?.template?.spec?.volumes, [
        {
          name: 'tenant-data',
          persistentVolumeClaim: {
            claimName: bundle.resources.pvcName,
          },
        },
      ])
      assert.deepEqual(
        bundle.deployment.spec?.template?.spec?.containers?.[0]?.volumeMounts,
        [
          {
            name: 'tenant-data',
            mountPath: '/app/data',
          },
        ],
      )
    } finally {
      tenantRegistry.close()
    }
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
    const tenantRegistry = new TenantRegistry(':memory:')
    const tenant = tenantRegistry.createTenant({
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
        connectionString:
          'postgresql://postgres:postgres@postgres.default:5432/tenant_demo_t_opaque123456',
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
        bundle.persistentVolumeClaim,
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
      tenantRegistry.close()
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
      deleteTimeoutMs: 50,
    })

    await manager.deleteTenantResources({
      namespace: 'tenant-t-opaque123456',
      deploymentName: 'dnd-notes',
      serviceName: 'dnd-notes',
      pvcName: 'dnd-notes-data-t-opaque123456',
      configMapName: 'dnd-notes-runtime',
      secretName: 'dnd-notes-runtime-secret',
      hostname: 't-opaque123456.dnd-notes.test',
      databaseName: 'tenant_demo_t_opaque123456',
      image: 'ghcr.io/daydream-software/dnd-notes:1.0.0',
    })

    assert.deepEqual(
      client.deleteCalls.map((call) => call.kind),
      ['PersistentVolumeClaim', 'Namespace'],
    )
    assert.equal(client.namespaceReadCountdown, 0)
  })
})

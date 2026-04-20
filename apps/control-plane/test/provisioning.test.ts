import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  TenantProvisioningService,
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
        `tenant_demo_${result.tenant.subdomain?.replace(/-/g, '_')}`,
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
        'tenant_demo_t_existing123456',
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
        'tenant_demo_t_existing123456',
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
})

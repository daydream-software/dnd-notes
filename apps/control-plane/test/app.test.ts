import assert from 'node:assert'
import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, it } from 'node:test'
import request from 'supertest'
import { createApp } from '../src/app.js'
import type { TenantProvisioningPort } from '../src/provisioning.js'
import { TenantRegistry } from '../src/tenant-registry.js'

const require = createRequire(import.meta.url)
const { version: appVersion } = require('../package.json') as { version: string }

describe('Control Plane API', () => {
  const adminToken = 'test-control-plane-token'
  const tenantsPath = '/internal/tenants'
  const tenantPath = (tenantId: string) => `${tenantsPath}/${tenantId}`
  let tenantRegistry: TenantRegistry
  let app: ReturnType<typeof createApp>
  let tenantProvisioningService: TenantProvisioningPort | undefined

  const authedGet = (path: string) =>
    request(app).get(path).set('Authorization', `Bearer ${adminToken}`)

  const authedPost = (path: string) =>
    request(app).post(path).set('Authorization', `Bearer ${adminToken}`)

  const authedPatch = (path: string) =>
    request(app).patch(path).set('Authorization', `Bearer ${adminToken}`)

  beforeEach(() => {
    tenantRegistry = new TenantRegistry(':memory:')
    tenantProvisioningService = undefined
    app = createApp({ tenantRegistry, adminToken, tenantProvisioningService })
  })

  afterEach(() => {
    tenantRegistry.close()
  })

  describe('GET /health', () => {
    it('returns healthy status', async () => {
      const response = await request(app).get('/health').expect(200)

      assert.strictEqual(response.body.status, 'healthy')
      assert.strictEqual(typeof response.body.uptime, 'number')
      assert.strictEqual(response.body.version, appVersion)
      assert.strictEqual(response.headers['x-content-type-options'], 'nosniff')
      assert.strictEqual(response.headers['x-frame-options'], 'DENY')
      assert.strictEqual(
        response.headers['referrer-policy'],
        'strict-origin-when-cross-origin',
      )
    })
  })

  describe('POST /internal/tenants', () => {
    it('rejects unauthenticated API requests', async () => {
      const response = await request(app).post(tenantsPath).send({
        id: 'tenant-123',
        slug: 'test-tenant',
        ownerId: 'owner-456',
        version: '1.0.0',
      })
        .expect(401)

      assert.strictEqual(response.body.error, 'Unauthorized')
    })

    it('does not expose the legacy /api tenant route prefix', async () => {
      await request(app)
        .post('/api/tenants')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          id: 'tenant-123',
          slug: 'test-tenant',
          ownerId: 'owner-456',
          version: '1.0.0',
        })
        .expect(404)
    })

    it('creates a new tenant', async () => {
      const response = await authedPost(tenantsPath)
        .send({
          id: 'tenant-123',
          slug: 'test-tenant',
          ownerId: 'owner-456',
          version: '1.0.0',
        })
        .expect(201)

      assert.strictEqual(response.body.tenant.id, 'tenant-123')
      assert.strictEqual(response.body.tenant.slug, 'test-tenant')
      assert.strictEqual(response.body.tenant.ownerId, 'owner-456')
      assert.strictEqual(response.body.tenant.subdomain, null)
      assert.strictEqual(response.body.tenant.version, '1.0.0')
      assert.strictEqual(response.body.tenant.currentState, 'provisioning')
      assert.strictEqual(response.body.tenant.desiredState, 'provisioning')
    })

    it('rejects duplicate tenant ID', async () => {
      await authedPost(tenantsPath).send({
        id: 'tenant-123',
        slug: 'test-tenant',
        ownerId: 'owner-456',
        version: '1.0.0',
      })

      const response = await authedPost(tenantsPath)
        .send({
          id: 'tenant-123',
          slug: 'another-slug',
          ownerId: 'owner-456',
          version: '1.0.0',
        })
        .expect(409)

      assert.strictEqual(response.body.error, 'Tenant ID already exists')
    })

    it('rejects duplicate tenant slug', async () => {
      await authedPost(tenantsPath).send({
        id: 'tenant-123',
        slug: 'test-tenant',
        ownerId: 'owner-456',
        version: '1.0.0',
      })

      const response = await authedPost(tenantsPath)
        .send({
          id: 'tenant-456',
          slug: 'test-tenant',
          ownerId: 'owner-456',
          version: '1.0.0',
        })
        .expect(409)

      assert.strictEqual(response.body.error, 'Tenant slug already exists')
    })

    it('validates slug format', async () => {
      const response = await authedPost(tenantsPath)
        .send({
          id: 'tenant-123',
          slug: '-invalid-slug',
          ownerId: 'owner-456',
          version: '1.0.0',
        })
        .expect(400)

      assert.strictEqual(response.body.error, 'Invalid request body')
    })
  })

  describe('GET /internal/tenants', () => {
    it('returns empty list when no tenants exist', async () => {
      const response = await authedGet(tenantsPath).expect(200)

      assert.deepStrictEqual(response.body.tenants, [])
    })

    it('returns list of tenants', async () => {
      await authedPost(tenantsPath).send({
        id: 'tenant-1',
        slug: 'tenant-one',
        ownerId: 'owner-1',
        version: '1.0.0',
      })

      await authedPost(tenantsPath).send({
        id: 'tenant-2',
        slug: 'tenant-two',
        ownerId: 'owner-2',
        version: '1.0.0',
      })

      const response = await authedGet(tenantsPath).expect(200)

      assert.strictEqual(response.body.tenants.length, 2)
      const ids = response.body.tenants.map((t: { id: string }) => t.id).sort()
      assert.deepStrictEqual(ids, ['tenant-1', 'tenant-2'])
    })
  })

  describe('GET /internal/tenants/:tenantId', () => {
    it('returns tenant details', async () => {
      await authedPost(tenantsPath).send({
        id: 'tenant-123',
        slug: 'test-tenant',
        ownerId: 'owner-456',
        version: '1.0.0',
      })

      const response = await authedGet(tenantPath('tenant-123')).expect(200)

      assert.strictEqual(response.body.tenant.id, 'tenant-123')
      assert.strictEqual(response.body.tenant.slug, 'test-tenant')
    })

    it('returns 404 for non-existent tenant', async () => {
      const response = await authedGet(tenantPath('non-existent')).expect(404)

      assert.strictEqual(response.body.error, 'Tenant not found')
    })
  })

  describe('PATCH /internal/tenants/:tenantId/state', () => {
    it('updates tenant state and records transition', async () => {
      await authedPost(tenantsPath).send({
        id: 'tenant-123',
        slug: 'test-tenant',
        ownerId: 'owner-456',
        version: '1.0.0',
      })

      const response = await authedPatch(`${tenantPath('tenant-123')}/state`)
        .send({
          state: 'ready',
          triggeredBy: 'provisioner',
          reason: 'Resources created successfully',
        })
        .expect(200)

      assert.strictEqual(response.body.tenant.currentState, 'ready')

      const transitions = await authedGet(
        `${tenantPath('tenant-123')}/transitions`,
      ).expect(200)

      assert.strictEqual(transitions.body.transitions.length, 2)
      assert.strictEqual(transitions.body.transitions[0].toState, 'ready')
      assert.strictEqual(
        transitions.body.transitions[0].triggeredBy,
        'provisioner',
      )
    })

    it('rejects an empty reason when provided', async () => {
      await authedPost(tenantsPath).send({
        id: 'tenant-123',
        slug: 'test-tenant',
        ownerId: 'owner-456',
        version: '1.0.0',
      })

      const response = await authedPatch(`${tenantPath('tenant-123')}/state`)
        .send({
          state: 'ready',
          triggeredBy: 'provisioner',
          reason: '',
        })
        .expect(400)

      assert.strictEqual(response.body.error, 'Invalid request body')
    })

    it('returns 404 when updating state of non-existent tenant', async () => {
      const response = await authedPatch(`${tenantPath('non-existent')}/state`)
        .send({
          state: 'ready',
          triggeredBy: 'test',
        })
        .expect(404)

      assert.strictEqual(response.body.error, 'Tenant not found')
    })
  })

  describe('PATCH /internal/tenants/:tenantId/desired-state', () => {
    it('updates desired state', async () => {
      await authedPost(tenantsPath).send({
        id: 'tenant-123',
        slug: 'test-tenant',
        ownerId: 'owner-456',
        version: '1.0.0',
      })

      const response = await authedPatch(
        `${tenantPath('tenant-123')}/desired-state`,
      ).send({
          desiredState: 'ready',
        })
        .expect(200)

      assert.strictEqual(response.body.tenant.desiredState, 'ready')
    })

    it('returns 404 when updating desired state of non-existent tenant', async () => {
      const response = await authedPatch(
        `${tenantPath('non-existent')}/desired-state`,
      ).send({
          desiredState: 'ready',
        })
        .expect(404)

      assert.strictEqual(response.body.error, 'Tenant not found')
    })
  })

  describe('PATCH /internal/tenants/:tenantId/storage', () => {
    it('updates storage reference', async () => {
      await authedPost(tenantsPath).send({
        id: 'tenant-123',
        slug: 'test-tenant',
        ownerId: 'owner-456',
        version: '1.0.0',
      })

      const response = await authedPatch(`${tenantPath('tenant-123')}/storage`)
        .send({
          storageReference: 'pvc-abc123',
        })
        .expect(200)

      assert.strictEqual(response.body.tenant.storageReference, 'pvc-abc123')
    })

    it('returns 404 when updating storage for non-existent tenant', async () => {
      const response = await authedPatch(`${tenantPath('non-existent')}/storage`)
        .send({
          storageReference: 'pvc-abc123',
        })
        .expect(404)

      assert.strictEqual(response.body.error, 'Tenant not found')
    })
  })

  describe('PATCH /internal/tenants/:tenantId/backup', () => {
    it('updates backup metadata', async () => {
      await authedPost(tenantsPath).send({
        id: 'tenant-123',
        slug: 'test-tenant',
        ownerId: 'owner-456',
        version: '1.0.0',
      })

      const metadata = JSON.stringify({
        lastBackup: '2026-04-18T22:00:00Z',
        location: 'blob://backups/tenant-123',
      })

      const response = await authedPatch(`${tenantPath('tenant-123')}/backup`)
        .send({
          backupMetadata: metadata,
        })
        .expect(200)

      assert.strictEqual(response.body.tenant.backupMetadata, metadata)
    })

    it('returns 404 when updating backup metadata for non-existent tenant', async () => {
      const response = await authedPatch(`${tenantPath('non-existent')}/backup`)
        .send({
          backupMetadata: '{"location":"blob://missing"}',
        })
        .expect(404)

      assert.strictEqual(response.body.error, 'Tenant not found')
    })
  })

  describe('POST /internal/tenants/:tenantId/provision', () => {
    it('returns 501 when provisioning is not configured', async () => {
      await authedPost(tenantsPath).send({
        id: 'tenant-123',
        slug: 'test-tenant',
        ownerId: 'owner-456',
        version: '1.0.0',
      })

      const response = await authedPost(`${tenantPath('tenant-123')}/provision`)
        .send({
          triggeredBy: 'test-suite',
        })
        .expect(501)

      assert.strictEqual(response.body.error, 'Tenant provisioning is not configured')
    })

    it('returns provisioned tenant metadata from the provisioning service', async () => {
      await authedPost(tenantsPath).send({
        id: 'tenant-123',
        slug: 'test-tenant',
        ownerId: 'owner-456',
        version: '1.0.0',
      })

      tenantProvisioningService = {
        async provisionTenant() {
          tenantRegistry.updateTenantSubdomain('tenant-123', 't-opaque123456')
          tenantRegistry.updateTenantStorageReference('tenant-123', 'tenant_db')
          tenantRegistry.updateTenantDesiredState('tenant-123', 'ready')
          tenantRegistry.updateTenantState(
            'tenant-123',
            'ready',
            'test-suite',
            'Provisioned in test',
          )

          return {
            tenant: tenantRegistry.getTenant('tenant-123')!,
            resources: {
              namespace: 'tenant-t-opaque123456',
              deploymentName: 'dnd-notes',
              serviceName: 'dnd-notes',
              configMapName: 'dnd-notes-runtime',
              secretName: 'dnd-notes-runtime-secret',
              hostname: 't-opaque123456.dnd-notes.test',
              databaseName: 'tenant_db',
              image: 'ghcr.io/daydream-software/dnd-notes:1.0.0',
            },
          }
        },
        async deprovisionTenant() {
          throw new Error('not used')
        },
        async close() {},
      }

      app = createApp({ tenantRegistry, adminToken, tenantProvisioningService })

      const response = await authedPost(`${tenantPath('tenant-123')}/provision`)
        .send({
          triggeredBy: 'test-suite',
        })
        .expect(200)

      assert.strictEqual(response.body.tenant.currentState, 'ready')
      assert.strictEqual(response.body.tenant.subdomain, 't-opaque123456')
      assert.strictEqual(response.body.tenant.storageReference, 'tenant_db')
      assert.strictEqual(response.body.resources.namespace, 'tenant-t-opaque123456')
    })
  })

  describe('POST /internal/tenants/:tenantId/deprovision', () => {
    it('returns deprovisioned tenant metadata from the provisioning service', async () => {
      await authedPost(tenantsPath).send({
        id: 'tenant-123',
        slug: 'test-tenant',
        ownerId: 'owner-456',
        version: '1.0.0',
      })
      tenantRegistry.updateTenantSubdomain('tenant-123', 't-opaque123456')
      tenantRegistry.updateTenantStorageReference('tenant-123', 'tenant_db')
      tenantRegistry.updateTenantDesiredState('tenant-123', 'ready')
      tenantRegistry.updateTenantState(
        'tenant-123',
        'ready',
        'test-suite',
        'Provisioned in test',
      )

      tenantProvisioningService = {
        async provisionTenant() {
          throw new Error('not used')
        },
        async deprovisionTenant() {
          tenantRegistry.updateTenantStorageReference('tenant-123', null)
          tenantRegistry.updateTenantDesiredState('tenant-123', 'deprovisioned')
          tenantRegistry.updateTenantState(
            'tenant-123',
            'deprovisioned',
            'test-suite',
            'Removed in test',
          )

          return {
            tenant: tenantRegistry.getTenant('tenant-123')!,
            deprovisioned: true,
          }
        },
        async close() {},
      }

      app = createApp({ tenantRegistry, adminToken, tenantProvisioningService })

      const response = await authedPost(`${tenantPath('tenant-123')}/deprovision`)
        .send({
          triggeredBy: 'test-suite',
        })
        .expect(200)

      assert.strictEqual(response.body.deprovisioned, true)
      assert.strictEqual(response.body.tenant.currentState, 'deprovisioned')
      assert.strictEqual(response.body.tenant.storageReference, null)
    })
  })

  describe('GET /internal/tenants/:tenantId/transitions', () => {
    it('returns state transition history', async () => {
      await authedPost(tenantsPath).send({
        id: 'tenant-123',
        slug: 'test-tenant',
        ownerId: 'owner-456',
        version: '1.0.0',
      })

      await authedPatch(`${tenantPath('tenant-123')}/state`)
        .send({
          state: 'ready',
          triggeredBy: 'provisioner',
        })

      const response = await authedGet(
        `${tenantPath('tenant-123')}/transitions`,
      ).expect(200)

      assert.strictEqual(response.body.transitions.length, 2)
      assert.strictEqual(response.body.transitions[0].fromState, 'provisioning')
      assert.strictEqual(response.body.transitions[0].toState, 'ready')
    })

    it('returns 404 for non-existent tenant', async () => {
      const response = await authedGet(
        `${tenantPath('non-existent')}/transitions`,
      ).expect(404)

      assert.strictEqual(response.body.error, 'Tenant not found')
    })
  })
})

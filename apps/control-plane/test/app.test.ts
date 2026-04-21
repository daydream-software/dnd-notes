import assert from 'node:assert'
import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, it } from 'node:test'
import request from 'supertest'
import { createApp } from '../src/app.js'
import {
  TenantProvisioningValidationError,
  type TenantProvisioningPort,
} from '../src/provisioning.js'
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

  describe('GET /healthz', () => {
    it('returns the Kubernetes liveness response', async () => {
      const response = await request(app).get('/healthz').expect(200)

      assert.strictEqual(response.body.status, 'healthy')
      assert.strictEqual(response.body.version, appVersion)
    })
  })

  describe('GET /readyz', () => {
    it('returns healthy status when the tenant registry is available', async () => {
      const response = await request(app).get('/readyz').expect(200)

      assert.strictEqual(response.body.status, 'healthy')
      assert.strictEqual(response.body.version, appVersion)
    })

    it('returns service unavailable when the tenant registry is closed', async () => {
      tenantRegistry.close()

      const response = await request(app).get('/readyz').expect(503)

      assert.deepStrictEqual(response.body, {
        error: 'Tenant registry unavailable',
      })
    })
  })

  describe('GET /ready', () => {
    it('keeps the short readiness alias for in-cluster callers', async () => {
      const response = await request(app).get('/ready').expect(200)

      assert.strictEqual(response.body.status, 'healthy')
      assert.strictEqual(response.body.version, appVersion)
    })

    it('returns service unavailable when the tenant registry is closed', async () => {
      tenantRegistry.close()

      const response = await request(app).get('/ready').expect(503)

      assert.deepStrictEqual(response.body, {
        error: 'Tenant registry unavailable',
      })
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

  describe('GET /internal/fleet/status', () => {
    it('returns a fleet summary with tenant health, backup details, and dependencies', async () => {
      tenantRegistry.createTenant({
        id: 'tenant-ready',
        slug: 'tenant-ready',
        ownerId: 'owner-1',
        version: '1.0.0',
      })
      tenantRegistry.updateTenantDesiredState('tenant-ready', 'ready')
      tenantRegistry.updateTenantStorageReference('tenant-ready', 'pvc-tenant-ready')
      tenantRegistry.updateTenantState(
        'tenant-ready',
        'ready',
        'test-suite',
        'Provisioned in test',
      )
      tenantRegistry.updateTenantBackupMetadata(
        'tenant-ready',
        JSON.stringify({
          lastBackup: '2026-04-18T22:00:00Z',
          lastBackupStatus: 'succeeded',
          lastRestoreDrillAt: '2026-04-19T06:00:00Z',
          lastRestoreDrillStatus: 'passed',
          location: 'blob://backups/tenant-ready',
        }),
      )

      tenantRegistry.createTenant({
        id: 'tenant-failed',
        slug: 'tenant-failed',
        ownerId: 'owner-2',
        version: '2.0.0',
      })
      tenantRegistry.updateTenantDesiredState('tenant-failed', 'ready')
      tenantRegistry.updateTenantState(
        'tenant-failed',
        'failed',
        'test-suite',
        'Synthetic failure in test',
      )

      const response = await authedGet('/internal/fleet/status').expect(200)

      assert.strictEqual(response.body.controlPlane.status, 'healthy')
      assert.strictEqual(response.body.controlPlane.version, appVersion)
      assert.strictEqual(response.body.dependencies.tenantRegistry.status, 'healthy')
      assert.strictEqual(response.body.dependencies.tenantProvisioning.status, 'disabled')
      assert.strictEqual(response.body.summary.totalTenants, 2)
      assert.strictEqual(response.body.summary.tenantsByCurrentState.ready, 1)
      assert.strictEqual(response.body.summary.tenantsByCurrentState.failed, 1)
      assert.strictEqual(response.body.summary.tenantsByDesiredState.ready, 2)
      assert.strictEqual(response.body.summary.tenantsByVersion['1.0.0'], 1)
      assert.strictEqual(response.body.summary.tenantsByVersion['2.0.0'], 1)
      assert.strictEqual(response.body.summary.tenantsWithBackupMetadata, 1)
      assert.strictEqual(response.body.summary.tenantsMissingBackupMetadata, 1)
      assert.strictEqual(response.body.summary.tenantsNeedingAttention, 1)

      const readyTenant = response.body.tenants.find(
        (tenant: { tenant: { id: string } }) => tenant.tenant.id === 'tenant-ready',
      )
      assert.ok(readyTenant)
      assert.strictEqual(readyTenant.health, 'healthy')
      assert.strictEqual(readyTenant.backup.lastBackupAt, '2026-04-18T22:00:00Z')
      assert.strictEqual(readyTenant.backup.lastBackupStatus, 'succeeded')
      assert.strictEqual(
        readyTenant.backup.lastRestoreDrillAt,
        '2026-04-19T06:00:00Z',
      )
      assert.strictEqual(readyTenant.backup.lastRestoreDrillStatus, 'passed')
      assert.strictEqual(
        readyTenant.backup.location,
        'blob://backups/tenant-ready',
      )
      assert.strictEqual(readyTenant.latestTransition.toState, 'ready')

      const failedTenant = response.body.tenants.find(
        (tenant: { tenant: { id: string } }) => tenant.tenant.id === 'tenant-failed',
      )
      assert.ok(failedTenant)
      assert.strictEqual(failedTenant.health, 'attention')
      assert.strictEqual(failedTenant.backup.rawMetadata, null)
      assert.strictEqual(failedTenant.latestTransition.toState, 'failed')
    })

    it('keeps opaque backup metadata when it is not parseable JSON', async () => {
      tenantRegistry.createTenant({
        id: 'tenant-opaque',
        slug: 'tenant-opaque',
        ownerId: 'owner-3',
        version: '1.0.0',
      })
      tenantRegistry.updateTenantBackupMetadata('tenant-opaque', 'not-json')

      const response = await authedGet('/internal/fleet/status').expect(200)
      const tenant = response.body.tenants.find(
        (entry: { tenant: { id: string } }) => entry.tenant.id === 'tenant-opaque',
      )

      assert.ok(tenant)
      assert.strictEqual(tenant.backup.rawMetadata, 'not-json')
      assert.strictEqual(tenant.backup.lastBackupAt, null)
      assert.strictEqual(tenant.backup.lastBackupStatus, null)
      assert.strictEqual(tenant.backup.lastRestoreDrillAt, null)
      assert.strictEqual(tenant.backup.lastRestoreDrillStatus, null)
      assert.strictEqual(tenant.backup.location, null)
    })

    it('treats blank backup metadata as missing and needing attention', async () => {
      tenantRegistry.createTenant({
        id: 'tenant-blank',
        slug: 'tenant-blank',
        ownerId: 'owner-4',
        version: '1.0.0',
      })
      tenantRegistry.updateTenantDesiredState('tenant-blank', 'ready')
      tenantRegistry.updateTenantState(
        'tenant-blank',
        'ready',
        'test-suite',
        'Provisioned in test',
      )
      tenantRegistry.updateTenantBackupMetadata('tenant-blank', '   ')

      const response = await authedGet('/internal/fleet/status').expect(200)
      const tenant = response.body.tenants.find(
        (entry: { tenant: { id: string } }) => entry.tenant.id === 'tenant-blank',
      )

      assert.ok(tenant)
      assert.strictEqual(tenant.health, 'attention')
      assert.strictEqual(response.body.summary.tenantsWithBackupMetadata, 0)
      assert.strictEqual(response.body.summary.tenantsMissingBackupMetadata, 1)
      assert.strictEqual(response.body.summary.tenantsNeedingAttention, 1)
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
          tenantRegistry.updateTenantStorageReference(
            'tenant-123',
            'dnd-notes-data-t-opaque123456',
          )
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
              pvcName: 'dnd-notes-data-t-opaque123456',
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
      assert.strictEqual(
        response.body.tenant.storageReference,
        'dnd-notes-data-t-opaque123456',
      )
      assert.strictEqual(response.body.resources.namespace, 'tenant-t-opaque123456')
      assert.strictEqual(
        response.body.resources.pvcName,
        'dnd-notes-data-t-opaque123456',
      )
    })

    it('returns 400 when the provisioning service rejects an invalid version override', async () => {
      await authedPost(tenantsPath).send({
        id: 'tenant-123',
        slug: 'test-tenant',
        ownerId: 'owner-456',
        version: '1.0.0',
      })

      tenantProvisioningService = {
        async provisionTenant() {
          throw new TenantProvisioningValidationError(
            'Tenant version must be a valid container image tag',
          )
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
          version: '1.1.0 release',
        })
        .expect(400)

      assert.strictEqual(response.body.error, 'Invalid tenant provisioning request')
      assert.strictEqual(
        response.body.details,
        'Tenant version must be a valid container image tag',
      )
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

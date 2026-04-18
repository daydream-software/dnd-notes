import assert from 'node:assert'
import { afterEach, beforeEach, describe, it } from 'node:test'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { TenantRegistry } from '../src/tenant-registry.js'

describe('Control Plane API', () => {
  let tenantRegistry: TenantRegistry
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    tenantRegistry = new TenantRegistry(':memory:')
    app = createApp({ tenantRegistry })
  })

  afterEach(() => {
    tenantRegistry.close()
  })

  describe('GET /health', () => {
    it('returns healthy status', async () => {
      const response = await request(app).get('/health').expect(200)

      assert.strictEqual(response.body.status, 'healthy')
      assert.strictEqual(typeof response.body.uptime, 'number')
      assert.strictEqual(response.body.version, '0.1.0')
    })
  })

  describe('POST /api/tenants', () => {
    it('creates a new tenant', async () => {
      const response = await request(app)
        .post('/api/tenants')
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
      assert.strictEqual(response.body.tenant.version, '1.0.0')
      assert.strictEqual(response.body.tenant.currentState, 'provisioning')
      assert.strictEqual(response.body.tenant.desiredState, 'provisioning')
    })

    it('rejects duplicate tenant ID', async () => {
      await request(app).post('/api/tenants').send({
        id: 'tenant-123',
        slug: 'test-tenant',
        ownerId: 'owner-456',
        version: '1.0.0',
      })

      const response = await request(app)
        .post('/api/tenants')
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
      await request(app).post('/api/tenants').send({
        id: 'tenant-123',
        slug: 'test-tenant',
        ownerId: 'owner-456',
        version: '1.0.0',
      })

      const response = await request(app)
        .post('/api/tenants')
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
      const response = await request(app)
        .post('/api/tenants')
        .send({
          id: 'tenant-123',
          slug: 'Invalid_Slug!',
          ownerId: 'owner-456',
          version: '1.0.0',
        })
        .expect(400)

      assert.strictEqual(response.body.error, 'Invalid request body')
    })
  })

  describe('GET /api/tenants', () => {
    it('returns empty list when no tenants exist', async () => {
      const response = await request(app).get('/api/tenants').expect(200)

      assert.deepStrictEqual(response.body.tenants, [])
    })

    it('returns list of tenants', async () => {
      await request(app).post('/api/tenants').send({
        id: 'tenant-1',
        slug: 'tenant-one',
        ownerId: 'owner-1',
        version: '1.0.0',
      })

      await request(app).post('/api/tenants').send({
        id: 'tenant-2',
        slug: 'tenant-two',
        ownerId: 'owner-2',
        version: '1.0.0',
      })

      const response = await request(app).get('/api/tenants').expect(200)

      assert.strictEqual(response.body.tenants.length, 2)
      const ids = response.body.tenants.map((t: { id: string }) => t.id).sort()
      assert.deepStrictEqual(ids, ['tenant-1', 'tenant-2'])
    })
  })

  describe('GET /api/tenants/:tenantId', () => {
    it('returns tenant details', async () => {
      await request(app).post('/api/tenants').send({
        id: 'tenant-123',
        slug: 'test-tenant',
        ownerId: 'owner-456',
        version: '1.0.0',
      })

      const response = await request(app)
        .get('/api/tenants/tenant-123')
        .expect(200)

      assert.strictEqual(response.body.tenant.id, 'tenant-123')
      assert.strictEqual(response.body.tenant.slug, 'test-tenant')
    })

    it('returns 404 for non-existent tenant', async () => {
      const response = await request(app)
        .get('/api/tenants/non-existent')
        .expect(404)

      assert.strictEqual(response.body.error, 'Tenant not found')
    })
  })

  describe('PATCH /api/tenants/:tenantId/state', () => {
    it('updates tenant state and records transition', async () => {
      await request(app).post('/api/tenants').send({
        id: 'tenant-123',
        slug: 'test-tenant',
        ownerId: 'owner-456',
        version: '1.0.0',
      })

      const response = await request(app)
        .patch('/api/tenants/tenant-123/state')
        .send({
          state: 'ready',
          triggeredBy: 'provisioner',
          reason: 'Resources created successfully',
        })
        .expect(200)

      assert.strictEqual(response.body.tenant.currentState, 'ready')

      const transitions = await request(app)
        .get('/api/tenants/tenant-123/transitions')
        .expect(200)

      assert.strictEqual(transitions.body.transitions.length, 2)
      assert.strictEqual(transitions.body.transitions[0].toState, 'ready')
      assert.strictEqual(
        transitions.body.transitions[0].triggeredBy,
        'provisioner',
      )
    })
  })

  describe('PATCH /api/tenants/:tenantId/desired-state', () => {
    it('updates desired state', async () => {
      await request(app).post('/api/tenants').send({
        id: 'tenant-123',
        slug: 'test-tenant',
        ownerId: 'owner-456',
        version: '1.0.0',
      })

      const response = await request(app)
        .patch('/api/tenants/tenant-123/desired-state')
        .send({
          desiredState: 'ready',
        })
        .expect(200)

      assert.strictEqual(response.body.tenant.desiredState, 'ready')
    })
  })

  describe('PATCH /api/tenants/:tenantId/storage', () => {
    it('updates storage reference', async () => {
      await request(app).post('/api/tenants').send({
        id: 'tenant-123',
        slug: 'test-tenant',
        ownerId: 'owner-456',
        version: '1.0.0',
      })

      const response = await request(app)
        .patch('/api/tenants/tenant-123/storage')
        .send({
          storageReference: 'pvc-abc123',
        })
        .expect(200)

      assert.strictEqual(response.body.tenant.storageReference, 'pvc-abc123')
    })
  })

  describe('PATCH /api/tenants/:tenantId/backup', () => {
    it('updates backup metadata', async () => {
      await request(app).post('/api/tenants').send({
        id: 'tenant-123',
        slug: 'test-tenant',
        ownerId: 'owner-456',
        version: '1.0.0',
      })

      const metadata = JSON.stringify({
        lastBackup: '2026-04-18T22:00:00Z',
        location: 'blob://backups/tenant-123',
      })

      const response = await request(app)
        .patch('/api/tenants/tenant-123/backup')
        .send({
          backupMetadata: metadata,
        })
        .expect(200)

      assert.strictEqual(response.body.tenant.backupMetadata, metadata)
    })
  })

  describe('GET /api/tenants/:tenantId/transitions', () => {
    it('returns state transition history', async () => {
      await request(app).post('/api/tenants').send({
        id: 'tenant-123',
        slug: 'test-tenant',
        ownerId: 'owner-456',
        version: '1.0.0',
      })

      await request(app)
        .patch('/api/tenants/tenant-123/state')
        .send({
          state: 'ready',
          triggeredBy: 'provisioner',
        })

      const response = await request(app)
        .get('/api/tenants/tenant-123/transitions')
        .expect(200)

      assert.strictEqual(response.body.transitions.length, 2)
      assert.strictEqual(response.body.transitions[0].fromState, 'provisioning')
      assert.strictEqual(response.body.transitions[0].toState, 'ready')
    })

    it('returns 404 for non-existent tenant', async () => {
      const response = await request(app)
        .get('/api/tenants/non-existent/transitions')
        .expect(404)

      assert.strictEqual(response.body.error, 'Tenant not found')
    })
  })
})

import assert from 'node:assert'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, it, test } from 'node:test'
import { format as formatLog } from 'node:util'
import request from 'supertest'
import { createApp, makeRateLimiter, readPositiveIntEnv } from '../src/app.js'
import {
  ControlPlaneAuthError,
  type PortalKeycloakAuth,
  type PortalTokenClaims,
} from '../src/keycloak-auth.js'
import {
  TenantProvisioningConflictError,
  TenantProvisioningValidationError,
  type TenantProvisioningPort,
} from '../src/provisioning.js'
import { type TenantRegistry } from '../src/tenant-registry.js'
import { createTestTenantRegistry } from './tenant-registry-test-helpers.js'

/**
 * In-process portal Keycloak stand-in for tests that need an authenticated
 * portal user without standing up a real Keycloak server. `issueToken`
 * registers a set of claims and returns a bearer token; `verifyBearerToken`
 * looks it up when the middleware fires.
 */
function createTestPortalKeycloakAuth(): {
  portalKeycloakAuth: PortalKeycloakAuth
  issueToken(claims: PortalTokenClaims): string
} {
  const tokens = new Map<string, PortalTokenClaims>()

  const portalKeycloakAuth: PortalKeycloakAuth = {
    async verifyBearerToken(token) {
      const claims = tokens.get(token)
      if (!claims) {
        throw new ControlPlaneAuthError(401, 'Unauthorized')
      }
      return claims
    },
  }

  function issueToken(claims: PortalTokenClaims): string {
    const token = `test-portal-token-${randomUUID()}`
    tokens.set(token, claims)
    return token
  }

  return { portalKeycloakAuth, issueToken }
}

const require = createRequire(import.meta.url)
const { version: appVersion } = require('../package.json') as { version: string }

describe('Control Plane API', () => {
  const adminToken = 'test-control-plane-token'
  const tenantsPath = '/internal/tenants'
  const tenantPath = (tenantId: string) => `${tenantsPath}/${tenantId}`
  let tenantRegistry: TenantRegistry
  let app: ReturnType<typeof createApp>
  let tenantProvisioningService: TenantProvisioningPort | undefined
  let cleanupTenantRegistry: (() => Promise<void>) | undefined
  let issuePortalToken: (claims: PortalTokenClaims) => string
  let portalKeycloakAuth: PortalKeycloakAuth

  const authedGet = (path: string) =>
    request(app).get(path).set('Authorization', `Bearer ${adminToken}`)

  const authedPost = (path: string) =>
    request(app).post(path).set('Authorization', `Bearer ${adminToken}`)

  const authedPatch = (path: string) =>
    request(app).patch(path).set('Authorization', `Bearer ${adminToken}`)

  beforeEach(() => {
    const registry = createTestTenantRegistry()
    tenantRegistry = registry.tenantRegistry
    cleanupTenantRegistry = registry.cleanup
    tenantProvisioningService = undefined
    const testPortalAuth = createTestPortalKeycloakAuth()
    portalKeycloakAuth = testPortalAuth.portalKeycloakAuth
    issuePortalToken = testPortalAuth.issueToken
    app = createApp({ tenantRegistry, adminToken, tenantProvisioningService, portalKeycloakAuth })
  })

  afterEach(async () => {
    await cleanupTenantRegistry?.()
    cleanupTenantRegistry = undefined
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
      await cleanupTenantRegistry?.()
      cleanupTenantRegistry = undefined

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
      await cleanupTenantRegistry?.()
      cleanupTenantRegistry = undefined

      const response = await request(app).get('/ready').expect(503)

      assert.deepStrictEqual(response.body, {
        error: 'Tenant registry unavailable',
      })
    })
  })

  describe('portal routes', () => {
    const portalAuthedGet = (path: string, token: string) =>
      request(app).get(path).set('Authorization', `Bearer ${token}`)

    const portalAuthedPost = (path: string, token: string) =>
      request(app).post(path).set('Authorization', `Bearer ${token}`)

    it('returns the public portal catalog', async () => {
      app = createApp({
        tenantRegistry,
        adminToken,
        tenantProvisioningService,
        portalKeycloakAuth,
        portalDefaultTenantVersion: '9.9.9',
      })

      const response = await request(app).get('/portal/catalog').expect(200)

      assert.strictEqual(response.body.defaultTenantVersion, '9.9.9')
      assert.strictEqual(response.body.provisioningConfigured, false)
      assert.strictEqual(response.body.slugPolicy.example, 'misty-harbor')
      assert.strictEqual(response.body.plans.length, 3)
      assert.strictEqual(response.body.placeholders.billingStatus, 'placeholder')
    })

    it('auto-provisions a portal account on first Keycloak login and returns dashboard', async () => {
      const token = issuePortalToken({
        sub: 'kc-sub-alyx',
        email: 'owner@example.com',
        name: 'Alyx',
      })

      const response = await portalAuthedGet('/portal/me', token).expect(200)

      assert.ok(response.body.account)
      assert.strictEqual(response.body.account.email, 'owner@example.com')
      assert.strictEqual(response.body.account.displayName, 'Alyx')
      assert.strictEqual(response.body.tenants.length, 0)

      const account = await tenantRegistry.getPortalAccountByKeycloakSub('kc-sub-alyx')
      assert.ok(account)
      assert.strictEqual(account.email, 'owner@example.com')
    })

    it('returns dashboard for an existing account resolved via keycloakSub fast path', async () => {
      await tenantRegistry.createPortalAccount({
        id: 'acct-fast-path',
        email: 'fast@example.com',
        displayName: 'Fast',
        keycloakSub: 'kc-sub-fast',
      })
      const token = issuePortalToken({ sub: 'kc-sub-fast', email: 'fast@example.com' })

      const response = await portalAuthedGet('/portal/me', token).expect(200)

      assert.strictEqual(response.body.account.id, 'acct-fast-path')
    })

    it('returns 401 when no bearer token is provided', async () => {
      const response = await request(app).get('/portal/me').expect(401)
      assert.ok(response.body.error)
    })

    it('returns 401 for an unrecognized bearer token', async () => {
      const response = await request(app)
        .get('/portal/me')
        .set('Authorization', 'Bearer not-a-real-token')
        .expect(401)
      assert.ok(response.body.error)
    })

    // Placeholder to silence unused-variable lint for the original signup section.
    it('creates a portal account via Keycloak auto-link (email-match path)', async () => {
      // Pre-existing account from the local-auth era — no keycloakSub yet.
      await tenantRegistry.createPortalAccount({
        id: 'acct-local-era',
        email: 'owner@example.com',
        displayName: 'Alyx',
        billingEmail: 'billing@example.com',
        billingProvider: 'stripe',
      })

      const token = issuePortalToken({
        sub: 'kc-sub-new',
        email: 'owner@example.com',
        name: 'Alyx',
      })

      const response = await portalAuthedGet('/portal/me', token).expect(200)
      assert.strictEqual(response.body.account.email, 'owner@example.com')

      // Sub must be persisted after auto-link.
      const linked = await tenantRegistry.getPortalAccountByKeycloakSub('kc-sub-new')
      assert.ok(linked)
      assert.strictEqual(linked.id, 'acct-local-era')
    })

    it('restores an owner-scoped dashboard and creates another tenant', async () => {
      // Provision initial account + tenant directly (bypassing old signup route).
      const ownerAccount = await tenantRegistry.createPortalAccount({
        id: 'acct-alyx',
        email: 'owner@example.com',
        displayName: 'Alyx',
        billingEmail: 'billing@example.com',
        billingProvider: 'manual-review',
        keycloakSub: 'kc-sub-alyx',
      })
      await tenantRegistry.createTenant({
        id: 'tenant-misty-harbor',
        slug: 'misty-harbor',
        ownerId: ownerAccount.id,
        displayName: 'Misty Harbor',
        planTier: 'adventurer',
        version: '1.0.0',
      })
      await tenantRegistry.updateTenantSubdomain('tenant-misty-harbor', 't-misty-harbor')
      await tenantRegistry.updateTenantDesiredState('tenant-misty-harbor', 'ready')
      await tenantRegistry.updateTenantState('tenant-misty-harbor', 'ready', 'test-suite')

      const otherAccount = await tenantRegistry.createPortalAccount({
        id: 'account-2',
        email: 'other@example.com',
        displayName: 'Other Owner',
      })
      await tenantRegistry.createTenant({
        id: 'tenant-other',
        slug: 'other-tenant',
        ownerId: otherAccount.id,
        displayName: 'Other Tenant',
        planTier: 'guild',
        version: '1.0.0',
      })

      app = createApp({
        tenantRegistry,
        adminToken,
        tenantProvisioningService,
        portalKeycloakAuth,
        tenantBaseDomain: 'example.com',
      })

      const token = issuePortalToken({ sub: 'kc-sub-alyx', email: 'owner@example.com' })

      const dashboardResponse = await portalAuthedGet('/portal/me', token).expect(200)

      assert.strictEqual(dashboardResponse.body.account.email, 'owner@example.com')
      assert.strictEqual(dashboardResponse.body.tenants.length, 1)
      assert.strictEqual(
        dashboardResponse.body.tenants[0].tenant.slug,
        'misty-harbor',
      )
      assert.strictEqual(
        dashboardResponse.body.tenants[0].appUrl,
        'https://t-misty-harbor.example.com',
      )

      const createTenantResponse = await portalAuthedPost(
        '/portal/me/tenants',
        token,
      )
        .send({
          tenantName: 'Emberfall',
          tenantSlug: 'emberfall',
          planTier: 'guild',
          paymentProvider: 'square',
        })
        .expect(201)

      assert.strictEqual(createTenantResponse.body.tenants.length, 2)
      assert.strictEqual(
        createTenantResponse.body.account.billingEmail,
        'billing@example.com',
      )
      const emberfallTenant = createTenantResponse.body.tenants.find(
        (tenant: { tenant: { slug: string } }) => tenant.tenant.slug === 'emberfall',
      )
      assert.ok(emberfallTenant)
      assert.strictEqual(emberfallTenant.tenant.planTier, 'guild')
    })

    it('cleans up a portal tenant when account updates fail during self-serve tenant creation', async () => {
      const ownerAccount = await tenantRegistry.createPortalAccount({
        id: 'acct-alyx-cleanup',
        email: 'owner@example.com',
        displayName: 'Alyx',
        billingProvider: 'manual-review',
        keycloakSub: 'kc-sub-alyx-cleanup',
      })

      const token = issuePortalToken({
        sub: 'kc-sub-alyx-cleanup',
        email: 'owner@example.com',
      })

      const originalUpdatePortalAccount = tenantRegistry.updatePortalAccount.bind(
        tenantRegistry,
      )
      tenantRegistry.updatePortalAccount = () => {
        throw new Error('Simulated portal account update failure')
      }

      const response = await portalAuthedPost('/portal/me/tenants', token)
        .send({
          tenantName: 'Emberfall',
          tenantSlug: 'emberfall',
          planTier: 'guild',
          paymentProvider: 'square',
        })
        .expect(500)

      tenantRegistry.updatePortalAccount = originalUpdatePortalAccount

      assert.strictEqual(response.body.error, 'Failed to create portal tenant')
      assert.strictEqual(
        response.body.details,
        'An unexpected error occurred while creating the tenant. Please try again later.',
      )
      assert.strictEqual(
        await tenantRegistry.getTenantBySlug('emberfall'),
        null,
      )
      assert.strictEqual(
        (await tenantRegistry.listTenantsByOwnerId(ownerAccount.id)).length,
        0,
      )
    })

    it('returns 409 when tenant creation hits a postgres unique constraint race', async () => {
      await tenantRegistry.createPortalAccount({
        id: 'acct-alyx',
        email: 'owner@example.com',
        displayName: 'Alyx',
        keycloakSub: 'kc-sub-alyx',
      })

      const token = issuePortalToken({
        sub: 'kc-sub-alyx',
        email: 'owner@example.com',
      })
      const originalCreateTenant = tenantRegistry.createTenant.bind(tenantRegistry)
      tenantRegistry.createTenant = () => {
        const error = new Error('duplicate key value violates unique constraint "tenants_slug_key"') as Error & {
          code?: string
        }
        error.code = '23505'
        throw error
      }

      const response = await portalAuthedPost('/portal/me/tenants', token)
        .send({
          tenantName: 'Emberfall',
          tenantSlug: 'emberfall',
          planTier: 'guild',
          paymentProvider: 'square',
        })
        .expect(409)

      tenantRegistry.createTenant = originalCreateTenant

      assert.strictEqual(response.body.error, 'Portal tenant conflict')
      assert.match(response.body.details, /tenant already exists/i)
    })

    it('deprovisions portal tenant resources when account updates fail after provisioning succeeds', async () => {
      let deprovisionRequest:
        | {
            tenantId: string
            triggeredBy: string
            reason?: string
          }
        | undefined

      tenantProvisioningService = {
        async provisionTenant(request) {
          await tenantRegistry.updateTenantSubdomain(
            request.tenantId,
            `t-${request.tenantId.slice(-8)}`,
          )
          await tenantRegistry.updateTenantStorageReference(
            request.tenantId,
            'tenant_db',
          )
          await tenantRegistry.updateTenantDesiredState(request.tenantId, 'ready')
          await tenantRegistry.updateTenantState(
            request.tenantId,
            'ready',
            request.triggeredBy,
            request.reason,
          )

          return {
            tenant: (await tenantRegistry.getTenant(request.tenantId))!,
            resources: {
              namespace: `tenant-${request.tenantId.slice(-8)}`,
              deploymentName: 'dnd-notes',
              serviceName: 'dnd-notes',
              configMapName: 'dnd-notes-runtime',
              secretName: 'dnd-notes-runtime-secret',
              hostname: `${request.tenantId.slice(-8)}.dnd-notes.test`,
              databaseName: 'tenant_db',
              image: 'ghcr.io/daydream-software/dnd-notes:1.0.0',
              pvcName: null,
            },
          }
        },
        async deprovisionTenant(request) {
          deprovisionRequest = request
          await tenantRegistry.updateTenantStorageReference(request.tenantId, null)
          await tenantRegistry.updateTenantDesiredState(request.tenantId, 'deprovisioned')
          await tenantRegistry.updateTenantState(
            request.tenantId,
            'deprovisioned',
            request.triggeredBy,
            request.reason,
          )

          return {
            tenant: (await tenantRegistry.getTenant(request.tenantId))!,
            deprovisioned: true,
          }
        },
        async close() {},
      }

      app = createApp({ tenantRegistry, adminToken, tenantProvisioningService, portalKeycloakAuth })

      const ownerAccount = await tenantRegistry.createPortalAccount({
        id: 'acct-alyx-deprovision',
        email: 'owner@example.com',
        displayName: 'Alyx',
        billingProvider: 'manual-review',
        keycloakSub: 'kc-sub-alyx-deprovision',
      })

      const token = issuePortalToken({
        sub: 'kc-sub-alyx-deprovision',
        email: 'owner@example.com',
      })

      const originalUpdatePortalAccount = tenantRegistry.updatePortalAccount.bind(
        tenantRegistry,
      )
      tenantRegistry.updatePortalAccount = () => {
        throw new Error('Simulated portal account update failure')
      }

      const response = await portalAuthedPost('/portal/me/tenants', token)
        .send({
          tenantName: 'Emberfall',
          tenantSlug: 'emberfall',
          planTier: 'guild',
          paymentProvider: 'square',
        })
        .expect(500)

      tenantRegistry.updatePortalAccount = originalUpdatePortalAccount

      assert.strictEqual(response.body.error, 'Failed to create portal tenant')
      assert.strictEqual(
        response.body.details,
        'An unexpected error occurred while creating the tenant. Please try again later.',
      )
      assert.strictEqual(await tenantRegistry.getTenantBySlug('emberfall'), null)
      assert.ok(deprovisionRequest)
      assert.match(deprovisionRequest.triggeredBy, /^portal:/)
      assert.strictEqual(
        deprovisionRequest.reason,
        'Portal rollback after failed account update',
      )
      assert.strictEqual(
        (await tenantRegistry.listTenantsByOwnerId(ownerAccount.id)).length,
        0,
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
          initialAdminEmail: 'admin@example.com',
          version: '1.0.0',
        })
        .expect(201)

      assert.strictEqual(response.body.tenant.id, 'tenant-123')
      assert.strictEqual(response.body.tenant.slug, 'test-tenant')
      assert.strictEqual(response.body.tenant.ownerId, 'owner-456')
      assert.strictEqual(response.body.tenant.initialAdminEmail, 'admin@example.com')
      assert.strictEqual(response.body.tenant.subdomain, null)
      assert.strictEqual(response.body.tenant.version, '1.0.0')
      assert.strictEqual(response.body.tenant.currentState, 'provisioning')
      assert.strictEqual(response.body.tenant.desiredState, 'provisioning')
    })

    it('formats unexpected tenant creation errors consistently', async () => {
      const originalCreateTenant = tenantRegistry.createTenant.bind(tenantRegistry)
      tenantRegistry.createTenant = async () => {
        throw { message: 'registry write failed', code: 'REGISTRY_WRITE_FAILED' }
      }

      const response = await authedPost(tenantsPath)
        .send({
          id: 'tenant-123',
          slug: 'test-tenant',
          ownerId: 'owner-456',
          version: '1.0.0',
        })
        .expect(500)

      tenantRegistry.createTenant = originalCreateTenant

      assert.strictEqual(response.body.error, 'Failed to create tenant')
      assert.strictEqual(
        response.body.details,
        'Object: registry write failed (code: REGISTRY_WRITE_FAILED)',
      )
    })

    it('validates initial admin email format when provided', async () => {
      const response = await authedPost(tenantsPath)
        .send({
          id: 'tenant-123',
          slug: 'test-tenant',
          ownerId: 'owner-456',
          initialAdminEmail: 'not-an-email',
          version: '1.0.0',
        })
        .expect(400)

      assert.strictEqual(response.body.error, 'Invalid request body')
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

    it('rejects duplicate tenant ID from a postgres structured constraint', async () => {
      const originalCreateTenant = tenantRegistry.createTenant.bind(tenantRegistry)
      tenantRegistry.createTenant = async () => {
        const error = new Error('duplicate key') as Error & {
          code?: string
          constraint?: string
        }
        error.code = '23505'
        error.constraint = 'tenants_pkey'
        throw error
      }

      const response = await authedPost(tenantsPath)
        .send({
          id: 'tenant-789',
          slug: 'structured-id',
          ownerId: 'owner-456',
          version: '1.0.0',
        })
        .expect(409)

      tenantRegistry.createTenant = originalCreateTenant

      assert.strictEqual(response.body.error, 'Tenant ID already exists')
    })

    it('rejects duplicate tenant slug from a postgres structured constraint', async () => {
      const originalCreateTenant = tenantRegistry.createTenant.bind(tenantRegistry)
      tenantRegistry.createTenant = async () => {
        const error = new Error('duplicate key') as Error & {
          code?: string
          constraint?: string
        }
        error.code = '23505'
        error.constraint = 'tenants_slug_key'
        throw error
      }

      const response = await authedPost(tenantsPath)
        .send({
          id: 'tenant-790',
          slug: 'structured-slug',
          ownerId: 'owner-456',
          version: '1.0.0',
        })
        .expect(409)

      tenantRegistry.createTenant = originalCreateTenant

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
      await tenantRegistry.createTenant({
        id: 'tenant-ready',
        slug: 'tenant-ready',
        ownerId: 'owner-1',
        initialAdminEmail: 'admin@tenant-ready.example',
        version: '1.0.0',
      })
      await tenantRegistry.updateTenantDesiredState('tenant-ready', 'ready')
      await tenantRegistry.updateTenantStorageReference('tenant-ready', 'pvc-tenant-ready')
      await tenantRegistry.updateTenantState(
        'tenant-ready',
        'ready',
        'test-suite',
        'Provisioned in test',
      )
      await tenantRegistry.createBackupRun({
        id: 'backup-ready-1',
        tenantId: 'tenant-ready',
        triggeredBy: 'test-suite',
      })
      await tenantRegistry.markBackupRunCompleted('backup-ready-1', {
        location: 'blob://backups/tenant-ready',
        sizeBytes: 1024,
        checksum: 'abc123',
        completedAt: '2026-04-18T22:00:00Z',
      })
      await tenantRegistry.recordBackupVerification('backup-ready-1', {
        status: 'passed',
        verifiedAt: '2026-04-19T06:00:00Z',
        details: 'restore drill ok',
      })
      await tenantRegistry.createRestoreRun({
        id: 'restore-ready-1',
        tenantId: 'tenant-ready',
        backupId: 'backup-ready-1',
        backupLocation: 'blob://backups/tenant-ready',
        triggeredBy: 'test-suite',
      })
      await tenantRegistry.markRestoreRunCompleted('restore-ready-1', {
        completedAt: '2026-04-20T06:00:00Z',
      })

      await tenantRegistry.createTenant({
        id: 'tenant-failed',
        slug: 'tenant-failed',
        ownerId: 'owner-2',
        version: '2.0.0',
      })
      await tenantRegistry.updateTenantDesiredState('tenant-failed', 'ready')
      await tenantRegistry.updateTenantState(
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
      assert.strictEqual(response.body.summary.tenantsWithBackup, 1)
      assert.strictEqual(response.body.summary.tenantsMissingBackup, 1)
      assert.strictEqual(response.body.summary.tenantsNeedingAttention, 1)

      const readyTenant = response.body.tenants.find(
        (tenant: { tenant: { id: string } }) => tenant.tenant.id === 'tenant-ready',
      )
      assert.ok(readyTenant)
      assert.strictEqual(readyTenant.health, 'healthy')
      assert.strictEqual(
        readyTenant.tenant.initialAdminEmail,
        'admin@tenant-ready.example',
      )
      assert.strictEqual(readyTenant.backup.backupId, 'backup-ready-1')
      assert.strictEqual(readyTenant.backup.lastBackupAt, '2026-04-18T22:00:00.000Z')
      assert.strictEqual(readyTenant.backup.lastBackupStatus, 'succeeded')
      assert.strictEqual(readyTenant.backup.lastVerifiedAt, '2026-04-19T06:00:00.000Z')
      assert.strictEqual(readyTenant.backup.lastVerificationStatus, 'passed')
      assert.strictEqual(readyTenant.backup.lastRestoreAt, '2026-04-20T06:00:00.000Z')
      assert.strictEqual(readyTenant.backup.lastRestoreStatus, 'completed')
      assert.strictEqual(
        readyTenant.backup.lastRestoreDrillAt,
        '2026-04-20T06:00:00.000Z',
      )
      assert.strictEqual(readyTenant.backup.lastRestoreDrillStatus, 'completed')
      assert.strictEqual(
        readyTenant.backup.location,
        'blob://backups/tenant-ready',
      )
      assert.deepStrictEqual(JSON.parse(readyTenant.backup.rawMetadata), {
        location: 'blob://backups/tenant-ready',
        lastBackupAt: '2026-04-18T22:00:00.000Z',
        lastBackupStatus: 'succeeded',
        lastRestoreDrillAt: '2026-04-20T06:00:00.000Z',
        lastRestoreDrillStatus: 'completed',
      })
      assert.strictEqual(readyTenant.latestTransition.triggeredBy, 'test-suite')
      assert.strictEqual(readyTenant.latestTransition.reason, 'Provisioned in test')
      assert.strictEqual(readyTenant.latestTransition.toState, 'ready')

      const failedTenant = response.body.tenants.find(
        (tenant: { tenant: { id: string } }) => tenant.tenant.id === 'tenant-failed',
      )
      assert.ok(failedTenant)
      assert.strictEqual(failedTenant.health, 'attention')
      assert.strictEqual(failedTenant.backup.backupId, null)
      assert.strictEqual(failedTenant.latestTransition.triggeredBy, 'test-suite')
      assert.strictEqual(failedTenant.latestTransition.reason, 'Synthetic failure in test')
      assert.strictEqual(failedTenant.latestTransition.toState, 'failed')
    })

    it('flags tenants with only failed backups as missing a usable backup', async () => {
      await tenantRegistry.createTenant({
        id: 'tenant-only-failed',
        slug: 'tenant-only-failed',
        ownerId: 'owner-3',
        version: '1.0.0',
      })
      await tenantRegistry.updateTenantDesiredState('tenant-only-failed', 'ready')
      await tenantRegistry.updateTenantStorageReference(
        'tenant-only-failed',
        'pvc-tenant-only-failed',
      )
      await tenantRegistry.updateTenantState(
        'tenant-only-failed',
        'ready',
        'test-suite',
        'Provisioned in test',
      )
      await tenantRegistry.createBackupRun({
        id: 'backup-only-failed-1',
        tenantId: 'tenant-only-failed',
        triggeredBy: 'test-suite',
      })
      await tenantRegistry.markBackupRunFailed(
        'backup-only-failed-1',
        'pg_dump exited non-zero',
      )

      const response = await authedGet('/internal/fleet/status').expect(200)
      const tenant = response.body.tenants.find(
        (entry: { tenant: { id: string } }) =>
          entry.tenant.id === 'tenant-only-failed',
      )

      assert.ok(tenant)
      assert.strictEqual(tenant.health, 'attention')
      assert.strictEqual(tenant.backup.backupId, null)
      assert.strictEqual(response.body.summary.tenantsWithBackup, 0)
      assert.strictEqual(response.body.summary.tenantsMissingBackup, 1)
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

  describe('GET /internal/tenants/:tenantId/storage', () => {
    it('returns cutover readiness for a tenant with resumable failed storage migration state', async () => {
      await authedPost(tenantsPath).send({
        id: 'tenant-123',
        slug: 'test-tenant',
        ownerId: 'owner-456',
        version: '1.0.0',
      })
      await tenantRegistry.updateTenantDesiredState('tenant-123', 'ready')
      await tenantRegistry.updateTenantState(
        'tenant-123',
        'ready',
        'provisioner',
        'Provisioned successfully',
      )
      await tenantRegistry.updateTenantStorageReference('tenant-123', 'tenant_tenant_123')
      await tenantRegistry.updateTenantStorageProfile('tenant-123', {
        mode: 'postgres-dedicated-user',
        migrationStatus: 'failed',
        failureReason: 'Synthetic cutover failure',
      })
      await tenantRegistry.createBackupRun({
        id: 'backup-tenant-123-1',
        tenantId: 'tenant-123',
        triggeredBy: 'test-suite',
      })
      await tenantRegistry.markBackupRunCompleted('backup-tenant-123-1', {
        location: 'blob://backups/tenant-123',
        completedAt: '2026-04-24T00:00:00Z',
      })

      const response = await authedGet(`${tenantPath('tenant-123')}/storage`).expect(200)

      assert.strictEqual(response.body.storage.tenantId, 'tenant-123')
      assert.strictEqual(response.body.storage.mode, 'postgres-dedicated-user')
      assert.strictEqual(response.body.storage.migrationStatus, 'failed')
      assert.strictEqual(
        response.body.storage.lastMigrationFailure,
        'Synthetic cutover failure',
      )
      assert.strictEqual(response.body.storage.cutoverReady, true)
      assert.deepStrictEqual(response.body.storage.blockers, [])
      assert.strictEqual(response.body.storage.backup.status, 'ready')
      assert.strictEqual(
        response.body.storage.backup.location,
        'blob://backups/tenant-123',
      )
    })

    it('blocks cutover readiness when backup metadata is missing or tenant mode is unknown', async () => {
      await authedPost(tenantsPath).send({
        id: 'tenant-456',
        slug: 'second-tenant',
        ownerId: 'owner-789',
        version: '1.0.0',
      })
      await tenantRegistry.updateTenantDesiredState('tenant-456', 'ready')
      await tenantRegistry.updateTenantState(
        'tenant-456',
        'ready',
        'provisioner',
        'Provisioned successfully',
      )

      const response = await authedGet(`${tenantPath('tenant-456')}/storage`).expect(200)

      assert.strictEqual(response.body.storage.mode, 'unknown')
      assert.strictEqual(response.body.storage.migrationStatus, 'not-started')
      assert.strictEqual(response.body.storage.cutoverReady, false)
      assert.strictEqual(response.body.storage.backup.status, 'missing')
      assert.strictEqual(
        response.body.storage.backup.details,
        'Record a successful backup (POST /internal/tenants/:tenantId/backup) before tenant cutover can start.',
      )
      assert.match(
        response.body.storage.blockers.join(' '),
        /unknown|backup/i,
      )
    })

    it('blocks cutover readiness when the latest backup attempt failed', async () => {
      await authedPost(tenantsPath).send({
        id: 'tenant-789',
        slug: 'third-tenant',
        ownerId: 'owner-999',
        version: '1.0.0',
      })
      await tenantRegistry.updateTenantDesiredState('tenant-789', 'ready')
      await tenantRegistry.updateTenantState(
        'tenant-789',
        'ready',
        'provisioner',
        'Provisioned successfully',
      )
      await tenantRegistry.updateTenantStorageReference('tenant-789', 'tenant_tenant_789')
      await tenantRegistry.updateTenantStorageProfile('tenant-789', {
        mode: 'postgres-dedicated-user',
        migrationStatus: 'failed',
        failureReason: 'Synthetic cutover failure',
      })
      await tenantRegistry.createBackupRun({
        id: 'backup-tenant-789-1',
        tenantId: 'tenant-789',
        triggeredBy: 'test-suite',
      })
      await tenantRegistry.markBackupRunFailed(
        'backup-tenant-789-1',
        'pg_dump exited non-zero',
      )

      const response = await authedGet(`${tenantPath('tenant-789')}/storage`).expect(200)

      assert.strictEqual(response.body.storage.cutoverReady, false)
      assert.strictEqual(response.body.storage.backup.backupId, 'backup-tenant-789-1')
      assert.strictEqual(response.body.storage.backup.lastBackupStatus, 'failed')
      assert.strictEqual(response.body.storage.backup.status, 'invalid')
      assert.match(
        response.body.storage.blockers.join(' '),
        /completed/i,
      )
    })

    it('blocks cutover readiness when a newer failed backup exists after an older successful backup', async () => {
      await authedPost(tenantsPath).send({
        id: 'tenant-790',
        slug: 'fourth-tenant',
        ownerId: 'owner-1000',
        version: '1.0.0',
      })
      await tenantRegistry.updateTenantDesiredState('tenant-790', 'ready')
      await tenantRegistry.updateTenantState(
        'tenant-790',
        'ready',
        'provisioner',
        'Provisioned successfully',
      )
      await tenantRegistry.updateTenantStorageReference('tenant-790', 'tenant_tenant_790')
      await tenantRegistry.updateTenantStorageProfile('tenant-790', {
        mode: 'postgres-dedicated-user',
        migrationStatus: 'failed',
        failureReason: 'Synthetic cutover failure',
      })
      await tenantRegistry.createBackupRun({
        id: 'backup-tenant-790-1',
        tenantId: 'tenant-790',
        triggeredBy: 'test-suite',
      })
      await tenantRegistry.markBackupRunCompleted('backup-tenant-790-1', {
        location: 'blob://backups/tenant-790-success',
        completedAt: '2026-04-24T00:00:00Z',
      })
      await new Promise((resolve) => setTimeout(resolve, 5))
      await tenantRegistry.createBackupRun({
        id: 'backup-tenant-790-2',
        tenantId: 'tenant-790',
        triggeredBy: 'test-suite',
      })
      await tenantRegistry.markBackupRunFailed(
        'backup-tenant-790-2',
        'latest backup failed',
      )

      const response = await authedGet(`${tenantPath('tenant-790')}/storage`).expect(200)

      assert.strictEqual(response.body.storage.cutoverReady, false)
      assert.strictEqual(response.body.storage.backup.backupId, 'backup-tenant-790-2')
      assert.strictEqual(response.body.storage.backup.lastBackupStatus, 'failed')
      assert.strictEqual(response.body.storage.backup.location, null)
      assert.strictEqual(response.body.storage.backup.status, 'invalid')
      assert.match(response.body.storage.backup.details, /current status: failed/i)
    })

    it('returns 404 for non-existent tenants', async () => {
      const response = await authedGet(`${tenantPath('non-existent')}/storage`).expect(
        404,
      )

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

    it('invokes the tenant control client when transitioning ready -> maintenance and back', async () => {
      const calls: Array<{ tenantId: string; mode: 'enable' | 'disable'; reason?: string }> = []
      const tenantControlClient = {
        async setMaintenanceMode({
          tenant,
          mode,
          reason,
        }: {
          tenant: { id: string }
          mode: 'enable' | 'disable'
          reason?: string
        }) {
          calls.push({ tenantId: tenant.id, mode, reason })
          return { status: 200, body: null }
        },
      }
      app = createApp({
        tenantRegistry,
        adminToken,
        tenantProvisioningService,
        tenantControlClient,
      })

      await authedPost(tenantsPath).send({
        id: 'tenant-123',
        slug: 'test-tenant',
        ownerId: 'owner-456',
        version: '1.0.0',
      })

      await authedPatch(`${tenantPath('tenant-123')}/state`)
        .send({ state: 'ready', triggeredBy: 'provisioner' })
        .expect(200)
      assert.strictEqual(calls.length, 0)

      await authedPatch(`${tenantPath('tenant-123')}/state`)
        .send({ state: 'maintenance', triggeredBy: 'operator', reason: 'rolling restart' })
        .expect(200)

      assert.deepStrictEqual(calls, [
        { tenantId: 'tenant-123', mode: 'enable', reason: 'rolling restart' },
      ])

      await authedPatch(`${tenantPath('tenant-123')}/state`)
        .send({ state: 'ready', triggeredBy: 'operator' })
        .expect(200)

      assert.strictEqual(calls.length, 2)
      assert.strictEqual(calls[1].mode, 'disable')
      assert.strictEqual(calls[1].tenantId, 'tenant-123')
    })

    it('returns 502 when the tenant control client fails to apply maintenance', async () => {
      const tenantControlClient = {
        async setMaintenanceMode() {
          throw new Error('connection refused')
        },
      }
      app = createApp({
        tenantRegistry,
        adminToken,
        tenantProvisioningService,
        tenantControlClient,
      })

      await authedPost(tenantsPath).send({
        id: 'tenant-123',
        slug: 'test-tenant',
        ownerId: 'owner-456',
        version: '1.0.0',
      })

      await authedPatch(`${tenantPath('tenant-123')}/state`)
        .send({ state: 'ready', triggeredBy: 'provisioner' })
        .expect(200)

      const response = await authedPatch(`${tenantPath('tenant-123')}/state`)
        .send({ state: 'maintenance', triggeredBy: 'operator' })
        .expect(502)

      assert.strictEqual(
        response.body.error,
        'Failed to propagate maintenance state to tenant',
      )
      const tenant = await tenantRegistry.getTenant('tenant-123')
      assert.ok(tenant)
      assert.strictEqual(tenant.currentState, 'ready')
    })

    it('returns 503 when a maintenance transition is requested without a tenant control client', async () => {
      await authedPost(tenantsPath).send({
        id: 'tenant-123',
        slug: 'test-tenant',
        ownerId: 'owner-456',
        version: '1.0.0',
      })

      await authedPatch(`${tenantPath('tenant-123')}/state`)
        .send({ state: 'ready', triggeredBy: 'provisioner' })
        .expect(200)

      const response = await authedPatch(`${tenantPath('tenant-123')}/state`)
        .send({ state: 'maintenance', triggeredBy: 'operator' })
        .expect(503)

      assert.strictEqual(
        response.body.error,
        'Tenant maintenance propagation is not configured',
      )
      const tenant = await tenantRegistry.getTenant('tenant-123')
      assert.ok(tenant)
      assert.strictEqual(tenant.currentState, 'ready')
    })

    it('logs the full maintenance transition when propagation fails', async () => {
      const originalConsoleError = console.error
      const errorMessages: string[] = []
      let controlCallCount = 0
      const tenantControlClient = {
        async setMaintenanceMode() {
          controlCallCount += 1

          if (controlCallCount === 2) {
            throw new Error('connection refused')
          }

          return { status: 200, body: null }
        },
      }
      console.error = ((...args: unknown[]) => {
        errorMessages.push(formatLog(...(args as [unknown, ...unknown[]])))
      }) as typeof console.error

      app = createApp({
        tenantRegistry,
        adminToken,
        tenantProvisioningService,
        tenantControlClient,
      })

      try {
        await authedPost(tenantsPath).send({
          id: 'tenant-123',
          slug: 'test-tenant',
          ownerId: 'owner-456',
          version: '1.0.0',
        })

        await authedPatch(`${tenantPath('tenant-123')}/state`)
          .send({ state: 'ready', triggeredBy: 'provisioner' })
          .expect(200)

        await authedPatch(`${tenantPath('tenant-123')}/state`)
          .send({ state: 'maintenance', triggeredBy: 'operator' })
          .expect(200)

        await authedPatch(`${tenantPath('tenant-123')}/state`)
          .send({ state: 'ready', triggeredBy: 'operator' })
          .expect(502)

        assert.match(
          errorMessages[0] ?? '',
          /maintenance transition maintenance -> ready \(disable\)/,
        )
      } finally {
        console.error = originalConsoleError
      }
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

  describe('POST /internal/tenants/:tenantId/backup', () => {
    it('returns 501 when no backup runner is configured', async () => {
      await authedPost(tenantsPath).send({
        id: 'tenant-noop',
        slug: 'tenant-noop',
        ownerId: 'owner-noop',
        version: '1.0.0',
      })
      await tenantRegistry.updateTenantStorageReference(
        'tenant-noop',
        'pvc-tenant-noop',
      )
      await tenantRegistry.updateTenantState(
        'tenant-noop',
        'ready',
        'test-suite',
        'ready for backup',
      )

      const response = await authedPost(`${tenantPath('tenant-noop')}/backup`)
        .send({ triggeredBy: 'test-suite', reason: 'manual run' })
        .expect(501)

      assert.match(response.body.error, /not configured/i)

      const audit = await tenantRegistry.listTenantAuditLog('tenant-noop')
      const actions = audit.map((entry) => entry.outcome)
      assert.ok(actions.includes('requested'))
      assert.ok(actions.includes('failed'))

      const backups = await tenantRegistry.listTenantBackups('tenant-noop')
      assert.strictEqual(backups.length, 1)
      assert.strictEqual(backups[0]!.status, 'failed')
    })

    it('rejects backups for tenants without a storage reference', async () => {
      await authedPost(tenantsPath).send({
        id: 'tenant-nostorage',
        slug: 'tenant-nostorage',
        ownerId: 'owner-nostorage',
        version: '1.0.0',
      })
      await tenantRegistry.updateTenantState(
        'tenant-nostorage',
        'ready',
        'test-suite',
        'ready',
      )

      const response = await authedPost(`${tenantPath('tenant-nostorage')}/backup`)
        .send({ triggeredBy: 'test-suite' })
        .expect(409)

      assert.match(response.body.error, /storage is not provisioned/i)
    })

    it('records and returns a successful backup catalog row when a dispatcher succeeds', async () => {
      const dispatcher = {
        async executeBackup({ tenant }: { tenant: { id: string } }) {
          return {
            tenantId: tenant.id,
            databaseName: 'tenant_db',
            format: 'custom' as const,
            location: 'blob://backups/tenant-success',
            sha256: 'sha256-test',
            sizeBytes: 4096,
            capturedAt: '2026-04-25T00:00:00.000Z',
          }
        },
        async executeRestore() {
          throw new Error('not used in this test')
        },
      }
      const customRegistry = createTestTenantRegistry()
      const customApp = createApp({
        tenantRegistry: customRegistry.tenantRegistry,
        adminToken,
        tenantBackupDispatcher: dispatcher,
      })

      try {
        await customRegistry.tenantRegistry.createTenant({
          id: 'tenant-success',
          slug: 'tenant-success',
          ownerId: 'owner-success',
          version: '1.0.0',
        })
        await customRegistry.tenantRegistry.updateTenantStorageReference(
          'tenant-success',
          'pvc-tenant-success',
        )
        await customRegistry.tenantRegistry.updateTenantState(
          'tenant-success',
          'ready',
          'test-suite',
          'ready',
        )

        const response = await request(customApp)
          .post(`/internal/tenants/tenant-success/backup`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ triggeredBy: 'test-suite', reason: 'manual run' })
          .expect(201)

        assert.strictEqual(response.body.backup.status, 'completed')
        assert.strictEqual(
          response.body.backup.location,
          'blob://backups/tenant-success',
        )
        assert.strictEqual(response.body.backup.sizeBytes, 4096)
        assert.strictEqual(response.body.backup.checksum, 'sha256-test')

        const audit =
          await customRegistry.tenantRegistry.listTenantAuditLog('tenant-success')
        const outcomes = audit.map((entry) => entry.outcome)
        assert.ok(outcomes.includes('requested'))
        assert.ok(outcomes.includes('succeeded'))
      } finally {
        await customRegistry.cleanup()
      }
    })

    it('keeps successful backups working when audit writes fail', async () => {
      const dispatcher = {
        async executeBackup({ tenant }: { tenant: { id: string } }) {
          return {
            tenantId: tenant.id,
            databaseName: 'tenant_db',
            format: 'custom' as const,
            location: 'blob://backups/tenant-audit-failure',
            sha256: 'sha256-audit-failure',
            sizeBytes: 512,
            capturedAt: '2026-04-25T00:00:00.000Z',
          }
        },
        async executeRestore() {
          throw new Error('not used in this test')
        },
      }
      const customRegistry = createTestTenantRegistry()
      customRegistry.tenantRegistry.appendAuditLogEntry = async () => {
        throw new Error('synthetic audit failure')
      }
      const customApp = createApp({
        tenantRegistry: customRegistry.tenantRegistry,
        adminToken,
        tenantBackupDispatcher: dispatcher,
      })

      try {
        await customRegistry.tenantRegistry.createTenant({
          id: 'tenant-audit-failure',
          slug: 'tenant-audit-failure',
          ownerId: 'owner-audit-failure',
          version: '1.0.0',
        })
        await customRegistry.tenantRegistry.updateTenantStorageReference(
          'tenant-audit-failure',
          'pvc-tenant-audit-failure',
        )
        await customRegistry.tenantRegistry.updateTenantState(
          'tenant-audit-failure',
          'ready',
          'test-suite',
          'ready',
        )

        const response = await request(customApp)
          .post(`/internal/tenants/tenant-audit-failure/backup`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ triggeredBy: 'test-suite' })
          .expect(201)

        assert.strictEqual(response.body.backup.status, 'completed')
        assert.strictEqual(
          response.body.backup.location,
          'blob://backups/tenant-audit-failure',
        )
      } finally {
        await customRegistry.cleanup()
      }
    })
  })

  describe('GET /internal/tenants/:tenantId/backups', () => {
    it('lists backup runs in reverse-chronological order', async () => {
      await tenantRegistry.createTenant({
        id: 'tenant-list',
        slug: 'tenant-list',
        ownerId: 'owner-list',
        version: '1.0.0',
      })
      await tenantRegistry.createBackupRun({
        id: 'backup-list-1',
        tenantId: 'tenant-list',
        triggeredBy: 'test-suite',
      })
      await tenantRegistry.markBackupRunCompleted('backup-list-1', {
        location: 'blob://backups/list-1',
      })

      const response = await authedGet(
        `${tenantPath('tenant-list')}/backups`,
      ).expect(200)

      assert.strictEqual(response.body.backups.length, 1)
      assert.strictEqual(response.body.backups[0].id, 'backup-list-1')
      assert.strictEqual(response.body.backups[0].status, 'completed')
    })
  })

  describe('POST /internal/tenants/:tenantId/restore', () => {
    it('rejects restore without a backupId or backupLocation', async () => {
      await tenantRegistry.createTenant({
        id: 'tenant-restore-bad',
        slug: 'tenant-restore-bad',
        ownerId: 'owner-restore-bad',
        version: '1.0.0',
      })
      await tenantRegistry.updateTenantStorageReference(
        'tenant-restore-bad',
        'pvc-tenant-restore-bad',
      )
      await tenantRegistry.updateTenantState(
        'tenant-restore-bad',
        'ready',
        'test-suite',
        'ready',
      )

      const response = await authedPost(
        `${tenantPath('tenant-restore-bad')}/restore`,
      )
        .send({ triggeredBy: 'test-suite' })
        .expect(400)

      assert.match(response.body.error, /backupId or backupLocation/i)
    })

    it('rejects restore requests that provide both backupId and backupLocation', async () => {
      await tenantRegistry.createTenant({
        id: 'tenant-restore-ambiguous',
        slug: 'tenant-restore-ambiguous',
        ownerId: 'owner-restore-ambiguous',
        version: '1.0.0',
      })
      await tenantRegistry.updateTenantStorageReference(
        'tenant-restore-ambiguous',
        'pvc-tenant-restore-ambiguous',
      )
      await tenantRegistry.updateTenantState(
        'tenant-restore-ambiguous',
        'ready',
        'test-suite',
        'ready',
      )
      await tenantRegistry.createBackupRun({
        id: 'backup-restore-ambiguous-1',
        tenantId: 'tenant-restore-ambiguous',
        triggeredBy: 'test-suite',
      })
      await tenantRegistry.markBackupRunCompleted('backup-restore-ambiguous-1', {
        location: 'blob://backups/restore-ambiguous-1',
      })

      const response = await authedPost(`${tenantPath('tenant-restore-ambiguous')}/restore`)
        .send({
          triggeredBy: 'test-suite',
          backupId: 'backup-restore-ambiguous-1',
          backupLocation: 'blob://backups/restore-ambiguous-1',
        })
        .expect(400)

      assert.match(response.body.error, /either backupId or backupLocation/i)
    })

    it('returns 404 when the referenced backup does not belong to the tenant', async () => {
      await tenantRegistry.createTenant({
        id: 'tenant-restore-other',
        slug: 'tenant-restore-other',
        ownerId: 'owner-restore-other',
        version: '1.0.0',
      })
      await tenantRegistry.updateTenantStorageReference(
        'tenant-restore-other',
        'pvc-tenant-restore-other',
      )
      await tenantRegistry.updateTenantState(
        'tenant-restore-other',
        'ready',
        'test-suite',
        'ready',
      )

      await tenantRegistry.createTenant({
        id: 'tenant-other',
        slug: 'tenant-other',
        ownerId: 'owner-other',
        version: '1.0.0',
      })
      await tenantRegistry.createBackupRun({
        id: 'backup-other-1',
        tenantId: 'tenant-other',
        triggeredBy: 'test-suite',
      })
      await tenantRegistry.markBackupRunCompleted('backup-other-1', {
        location: 'blob://backups/other-1',
      })

      const response = await authedPost(
        `${tenantPath('tenant-restore-other')}/restore`,
      )
        .send({ triggeredBy: 'test-suite', backupId: 'backup-other-1' })
        .expect(404)

      assert.match(response.body.error, /Backup not found/i)
    })

    it('returns 501 and records audit failure when no dispatcher is configured', async () => {
      await tenantRegistry.createTenant({
        id: 'tenant-restore-noop',
        slug: 'tenant-restore-noop',
        ownerId: 'owner-restore-noop',
        version: '1.0.0',
      })
      await tenantRegistry.updateTenantStorageReference(
        'tenant-restore-noop',
        'pvc-tenant-restore-noop',
      )
      await tenantRegistry.updateTenantState(
        'tenant-restore-noop',
        'ready',
        'test-suite',
        'ready',
      )
      await tenantRegistry.createBackupRun({
        id: 'backup-restore-noop-1',
        tenantId: 'tenant-restore-noop',
        triggeredBy: 'test-suite',
      })
      await tenantRegistry.markBackupRunCompleted('backup-restore-noop-1', {
        location: 'blob://backups/restore-noop-1',
      })

      const response = await authedPost(
        `${tenantPath('tenant-restore-noop')}/restore`,
      )
        .send({
          triggeredBy: 'test-suite',
          backupId: 'backup-restore-noop-1',
        })
        .expect(501)

      assert.match(response.body.error, /not configured/i)
      assert.match(response.body.details, /not configured/i)

      const restores = await tenantRegistry.listTenantRestores(
        'tenant-restore-noop',
      )
      assert.strictEqual(restores.length, 1)
      assert.strictEqual(restores[0]!.status, 'failed')

      const tenantAfter = await tenantRegistry.getTenant('tenant-restore-noop')
      assert.ok(tenantAfter)
      assert.strictEqual(tenantAfter.currentState, 'ready')
    })

    it('returns an operation-specific restore error for unexpected dispatcher failures', async () => {
      const dispatcher = {
        async executeBackup() {
          throw new Error('not used in this test')
        },
        async executeRestore() {
          throw new Error('synthetic restore failure')
        },
      }
      const customRegistry = createTestTenantRegistry()
      const customApp = createApp({
        tenantRegistry: customRegistry.tenantRegistry,
        adminToken,
        tenantBackupDispatcher: dispatcher,
      })

      try {
        await customRegistry.tenantRegistry.createTenant({
          id: 'tenant-restore-failure',
          slug: 'tenant-restore-failure',
          ownerId: 'owner-restore-failure',
          version: '1.0.0',
        })
        await customRegistry.tenantRegistry.updateTenantStorageReference(
          'tenant-restore-failure',
          'pvc-tenant-restore-failure',
        )
        await customRegistry.tenantRegistry.updateTenantState(
          'tenant-restore-failure',
          'ready',
          'test-suite',
          'ready',
        )
        await customRegistry.tenantRegistry.createBackupRun({
          id: 'backup-restore-failure-1',
          tenantId: 'tenant-restore-failure',
          triggeredBy: 'test-suite',
        })
        await customRegistry.tenantRegistry.markBackupRunCompleted(
          'backup-restore-failure-1',
          {
            location: 'blob://backups/restore-failure-1',
          },
        )

        const response = await request(customApp)
          .post(`/internal/tenants/tenant-restore-failure/restore`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            triggeredBy: 'test-suite',
            backupId: 'backup-restore-failure-1',
          })
          .expect(500)

        assert.strictEqual(response.body.error, 'Restore runner failed')
        assert.strictEqual(response.body.details, 'synthetic restore failure')
      } finally {
        await customRegistry.cleanup()
      }
    })

    it('records a completed restore, safety snapshot, and audit trail when a dispatcher succeeds', async () => {
      const dispatcher = {
        async executeBackup() {
          throw new Error('not used in this test')
        },
        async executeRestore({ tenant }: { tenant: { id: string; currentState: string } }) {
          assert.strictEqual(tenant.id, 'tenant-restore-success')
          assert.strictEqual(tenant.currentState, 'restoring')

          return {
            tenantId: tenant.id,
            databaseName: 'tenant_restore_success',
            backupLocation: 'blob://backups/restore-success-1',
            restoredAt: '2026-04-25T02:00:00.000Z',
            safetySnapshot: {
              tenantId: tenant.id,
              databaseName: 'tenant_restore_success',
              format: 'custom' as const,
              location: 'blob://backups/restore-safety-snapshot-1',
              sha256: 'restore-safety-sha',
              sizeBytes: 2048,
              capturedAt: '2026-04-25T01:30:00.000Z',
            },
          }
        },
      }
      const customRegistry = createTestTenantRegistry()
      const customApp = createApp({
        tenantRegistry: customRegistry.tenantRegistry,
        adminToken,
        tenantBackupDispatcher: dispatcher,
      })

      try {
        await customRegistry.tenantRegistry.createTenant({
          id: 'tenant-restore-success',
          slug: 'tenant-restore-success',
          ownerId: 'owner-restore-success',
          version: '1.0.0',
        })
        await customRegistry.tenantRegistry.updateTenantStorageReference(
          'tenant-restore-success',
          'pvc-tenant-restore-success',
        )
        await customRegistry.tenantRegistry.updateTenantState(
          'tenant-restore-success',
          'maintenance',
          'test-suite',
          'maintenance window',
        )
        await customRegistry.tenantRegistry.createBackupRun({
          id: 'backup-restore-success-1',
          tenantId: 'tenant-restore-success',
          triggeredBy: 'test-suite',
        })
        await customRegistry.tenantRegistry.markBackupRunCompleted(
          'backup-restore-success-1',
          {
            location: 'blob://backups/restore-success-1',
          },
        )

        const response = await request(customApp)
          .post(`/internal/tenants/tenant-restore-success/restore`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            triggeredBy: 'test-suite',
            reason: 'restore after validation',
            backupId: 'backup-restore-success-1',
          })
          .expect(201)

        assert.strictEqual(response.body.restore.status, 'completed')
        assert.strictEqual(
          response.body.restore.completedAt,
          '2026-04-25T02:00:00.000Z',
        )
        assert.ok(response.body.restore.safetySnapshotId)

        const restores = await customRegistry.tenantRegistry.listTenantRestores(
          'tenant-restore-success',
        )
        assert.strictEqual(restores.length, 1)
        assert.strictEqual(restores[0]?.status, 'completed')
        assert.strictEqual(
          restores[0]?.safetySnapshotId,
          response.body.restore.safetySnapshotId,
        )

        const safetySnapshot = await customRegistry.tenantRegistry.getBackupRun(
          response.body.restore.safetySnapshotId,
        )
        assert.ok(safetySnapshot)
        assert.strictEqual(safetySnapshot.location, 'blob://backups/restore-safety-snapshot-1')
        assert.strictEqual(safetySnapshot.status, 'completed')
        assert.match(safetySnapshot.reason ?? '', /Safety snapshot captured before restore/)

        const tenantAfter = await customRegistry.tenantRegistry.getTenant(
          'tenant-restore-success',
        )
        assert.ok(tenantAfter)
        assert.strictEqual(tenantAfter.currentState, 'maintenance')

        const transitions = await customRegistry.tenantRegistry.getStateTransitions(
          'tenant-restore-success',
        )
        assert.strictEqual(transitions[0]?.toState, 'maintenance')
        assert.strictEqual(transitions[1]?.toState, 'restoring')

        const audit = await customRegistry.tenantRegistry.listTenantAuditLog(
          'tenant-restore-success',
        )
        const outcomes = audit.map((entry) => entry.outcome)
        assert.ok(outcomes.includes('requested'))
        assert.ok(outcomes.includes('succeeded'))
      } finally {
        await customRegistry.cleanup()
      }
    })

    it('keeps successful restores working when audit writes fail', async () => {
      const dispatcher = {
        async executeBackup() {
          throw new Error('not used in this test')
        },
        async executeRestore({ tenant }: { tenant: { id: string } }) {
          return {
            tenantId: tenant.id,
            databaseName: 'tenant_restore_audit_failure',
            backupLocation: 'blob://backups/restore-audit-failure-1',
            restoredAt: '2026-04-25T02:00:00.000Z',
            safetySnapshot: {
              tenantId: tenant.id,
              databaseName: 'tenant_restore_audit_failure',
              format: 'custom' as const,
              location: 'blob://backups/restore-audit-failure-snapshot-1',
              sha256: 'restore-audit-failure-sha',
              sizeBytes: 1024,
              capturedAt: '2026-04-25T01:30:00.000Z',
            },
          }
        },
      }
      const customRegistry = createTestTenantRegistry()
      customRegistry.tenantRegistry.appendAuditLogEntry = async () => {
        throw new Error('synthetic audit failure')
      }
      const customApp = createApp({
        tenantRegistry: customRegistry.tenantRegistry,
        adminToken,
        tenantBackupDispatcher: dispatcher,
      })

      try {
        await customRegistry.tenantRegistry.createTenant({
          id: 'tenant-restore-audit-failure',
          slug: 'tenant-restore-audit-failure',
          ownerId: 'owner-restore-audit-failure',
          version: '1.0.0',
        })
        await customRegistry.tenantRegistry.updateTenantStorageReference(
          'tenant-restore-audit-failure',
          'pvc-tenant-restore-audit-failure',
        )
        await customRegistry.tenantRegistry.updateTenantState(
          'tenant-restore-audit-failure',
          'ready',
          'test-suite',
          'ready',
        )
        await customRegistry.tenantRegistry.createBackupRun({
          id: 'backup-restore-audit-failure-1',
          tenantId: 'tenant-restore-audit-failure',
          triggeredBy: 'test-suite',
        })
        await customRegistry.tenantRegistry.markBackupRunCompleted(
          'backup-restore-audit-failure-1',
          {
            location: 'blob://backups/restore-audit-failure-1',
          },
        )

        const response = await request(customApp)
          .post(`/internal/tenants/tenant-restore-audit-failure/restore`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            triggeredBy: 'test-suite',
            backupId: 'backup-restore-audit-failure-1',
          })
          .expect(201)

        assert.strictEqual(response.body.restore.status, 'completed')
        assert.ok(response.body.restore.safetySnapshotId)
      } finally {
        await customRegistry.cleanup()
      }
    })
  })

  describe('GET /internal/tenants/:tenantId/audit', () => {
    it('returns audit log entries for a tenant', async () => {
      await tenantRegistry.createTenant({
        id: 'tenant-audit',
        slug: 'tenant-audit',
        ownerId: 'owner-audit',
        version: '1.0.0',
      })
      await tenantRegistry.appendAuditLogEntry({
        tenantId: 'tenant-audit',
        actor: 'test-suite',
        action: 'tenant.test',
        resourceType: 'tenant',
        resourceId: 'tenant-audit',
        outcome: 'requested',
      })

      const response = await authedGet(`${tenantPath('tenant-audit')}/audit`).expect(200)

      assert.strictEqual(response.body.entries.length, 1)
      assert.strictEqual(response.body.entries[0].id, '1')
      assert.strictEqual(typeof response.body.entries[0].id, 'string')
      assert.strictEqual(response.body.entries[0].action, 'tenant.test')
      assert.strictEqual(response.body.entries[0].outcome, 'requested')
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

      let receivedProvisionRequest:
        | {
            tenantId: string
            triggeredBy: string
            reason?: string
            version?: string
          }
        | undefined

      tenantProvisioningService = {
        async provisionTenant(request) {
          receivedProvisionRequest = request
          await tenantRegistry.updateTenantSubdomain('tenant-123', 't-opaque123456')
          await tenantRegistry.updateTenantStorageReference(
            'tenant-123',
            'tenant_db',
          )
          await tenantRegistry.updateTenantDesiredState('tenant-123', 'ready')
          await tenantRegistry.updateTenantState(
            'tenant-123',
            'ready',
            request.triggeredBy,
            request.reason,
          )

          return {
            tenant: (await tenantRegistry.getTenant('tenant-123'))!,
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
          triggeredBy: 'operator@example.com',
          reason: 'Provision the first operator-portal tenant',
        })
        .expect(200)

      assert.deepStrictEqual(receivedProvisionRequest, {
        tenantId: 'tenant-123',
        triggeredBy: 'operator@example.com',
        reason: 'Provision the first operator-portal tenant',
        version: undefined,
      })
      assert.strictEqual(response.body.tenant.currentState, 'ready')
      assert.strictEqual(response.body.tenant.subdomain, 't-opaque123456')
      assert.strictEqual(
        response.body.tenant.storageReference,
        'tenant_db',
      )
      assert.strictEqual(response.body.resources.namespace, 'tenant-t-opaque123456')

      const transitions = await authedGet(`${tenantPath('tenant-123')}/transitions`).expect(
        200,
      )

      assert.strictEqual(transitions.body.transitions[0].toState, 'ready')
      assert.strictEqual(
        transitions.body.transitions[0].triggeredBy,
        'operator@example.com',
      )
      assert.strictEqual(
        transitions.body.transitions[0].reason,
        'Provision the first operator-portal tenant',
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

      assert.strictEqual(response.body.code, 'invalid_target_version')
      assert.strictEqual(response.body.error, 'Invalid tenant provisioning request')
      assert.strictEqual(
        response.body.details,
        'Tenant version must be a valid container image tag',
      )
    })

    it('returns 409 when the provisioning service rejects a concurrent rolling update', async () => {
      await authedPost(tenantsPath).send({
        id: 'tenant-123',
        slug: 'test-tenant',
        ownerId: 'owner-456',
        version: '1.0.0',
      })

      tenantProvisioningService = {
        async provisionTenant() {
          throw new TenantProvisioningConflictError(
            'Tenant tenant-123 already has a rolling update in progress. Wait for it to return to ready before starting another rollout.',
            'tenant_rollout_in_progress',
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
          version: '1.1.0',
        })
        .expect(409)

      assert.strictEqual(response.body.code, 'tenant_rollout_in_progress')
      assert.strictEqual(response.body.error, 'Tenant rolling update conflict')
      assert.match(response.body.details, /already has a rolling update in progress/)
    })

    it('returns 409 when the provisioning service rejects a non-ready rolling update', async () => {
      await authedPost(tenantsPath).send({
        id: 'tenant-123',
        slug: 'test-tenant',
        ownerId: 'owner-456',
        version: '1.0.0',
      })

      tenantProvisioningService = {
        async provisionTenant() {
          throw new TenantProvisioningConflictError(
            'Tenant tenant-123 cannot start a rolling update from state maintenance. Rolling updates are only supported for ready tenants.',
            'tenant_rollout_disallowed',
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
          version: '1.1.0',
        })
        .expect(409)

      assert.strictEqual(response.body.code, 'tenant_rollout_disallowed')
      assert.strictEqual(response.body.error, 'Tenant rolling update conflict')
      assert.match(response.body.details, /only supported for ready tenants/)
    })

    it('returns 400 when the provisioning service rejects a stale no-op rollout target', async () => {
      await authedPost(tenantsPath).send({
        id: 'tenant-123',
        slug: 'test-tenant',
        ownerId: 'owner-456',
        version: '1.0.0',
      })

      tenantProvisioningService = {
        async provisionTenant() {
          throw new TenantProvisioningValidationError(
            'Tenant tenant-123 is already running version 1.1.0. Choose a different target version for a rolling update.',
            'unsupported_target_version',
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
          version: '1.1.0',
        })
        .expect(400)

      assert.strictEqual(response.body.code, 'unsupported_target_version')
      assert.strictEqual(response.body.error, 'Invalid tenant provisioning request')
      assert.match(response.body.details, /already running version 1.1.0/)
    })

    it('returns a rollout-specific operator-facing error when a versioned provision fails', async () => {
      await authedPost(tenantsPath).send({
        id: 'tenant-123',
        slug: 'test-tenant',
        ownerId: 'owner-456',
        version: '1.0.0',
      })

      tenantProvisioningService = {
        async provisionTenant() {
          throw new Error('synthetic infrastructure failure')
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
          version: '1.1.0',
        })
        .expect(500)

      assert.strictEqual(response.body.code, 'tenant_rollout_failed')
      assert.strictEqual(response.body.error, 'Tenant rolling update failed')
      assert.strictEqual(
        response.body.details,
        'Rolling update failed for tenant tenant-123. The control plane marked the tenant failed; inspect the latest transition and control-plane logs before retrying.',
      )
    })

    it('keeps the generic provisioning error shape for first-time provisioning failures', async () => {
      await authedPost(tenantsPath).send({
        id: 'tenant-123',
        slug: 'test-tenant',
        ownerId: 'owner-456',
        version: '1.0.0',
      })

      tenantProvisioningService = {
        async provisionTenant() {
          throw new Error('synthetic infrastructure failure')
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
          version: '1.0.0',
        })
        .expect(500)

      assert.strictEqual(response.body.code, undefined)
      assert.strictEqual(response.body.error, 'Failed to provision tenant resources')
      assert.strictEqual(response.body.details, 'synthetic infrastructure failure')
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
      await tenantRegistry.updateTenantSubdomain('tenant-123', 't-opaque123456')
      await tenantRegistry.updateTenantStorageReference('tenant-123', 'tenant_db')
      await tenantRegistry.updateTenantDesiredState('tenant-123', 'ready')
      await tenantRegistry.updateTenantState(
        'tenant-123',
        'ready',
        'test-suite',
        'Provisioned in test',
      )

      let receivedDeprovisionRequest:
        | {
            tenantId: string
            triggeredBy: string
            reason?: string
          }
        | undefined

      tenantProvisioningService = {
        async provisionTenant() {
          throw new Error('not used')
        },
        async deprovisionTenant(request) {
          receivedDeprovisionRequest = request
          await tenantRegistry.updateTenantStorageReference('tenant-123', null)
          await tenantRegistry.updateTenantDesiredState('tenant-123', 'deprovisioned')
          await tenantRegistry.updateTenantState(
            'tenant-123',
            'deprovisioned',
            request.triggeredBy,
            request.reason,
          )

          return {
            tenant: (await tenantRegistry.getTenant('tenant-123'))!,
            deprovisioned: true,
          }
        },
        async close() {},
      }

      app = createApp({ tenantRegistry, adminToken, tenantProvisioningService })

      const response = await authedPost(`${tenantPath('tenant-123')}/deprovision`)
        .send({
          triggeredBy: 'operator@example.com',
          reason: 'Decommission the retired tenant',
        })
        .expect(200)

      assert.deepStrictEqual(receivedDeprovisionRequest, {
        tenantId: 'tenant-123',
        triggeredBy: 'operator@example.com',
        reason: 'Decommission the retired tenant',
      })
      assert.strictEqual(response.body.deprovisioned, true)
      assert.strictEqual(response.body.tenant.currentState, 'deprovisioned')
      assert.strictEqual(response.body.tenant.storageReference, null)

      const transitions = await authedGet(`${tenantPath('tenant-123')}/transitions`).expect(
        200,
      )

      assert.strictEqual(transitions.body.transitions[0].toState, 'deprovisioned')
      assert.strictEqual(
        transitions.body.transitions[0].triggeredBy,
        'operator@example.com',
      )
      assert.strictEqual(
        transitions.body.transitions[0].reason,
        'Decommission the retired tenant',
      )
    })
    it('formats unexpected deprovisioning errors consistently', async () => {
      await authedPost(tenantsPath).send({
        id: 'tenant-123',
        slug: 'test-tenant',
        ownerId: 'owner-456',
        version: '1.0.0',
      })

      tenantProvisioningService = {
        async provisionTenant() {
          throw new Error('not used')
        },
        async deprovisionTenant() {
          throw { message: 'drain failed', code: 'DRAIN_FAILED' }
        },
        async close() {},
      }

      app = createApp({ tenantRegistry, adminToken, tenantProvisioningService })

      const response = await authedPost(`${tenantPath('tenant-123')}/deprovision`)
        .send({
          triggeredBy: 'operator@example.com',
        })
        .expect(500)

      assert.strictEqual(response.body.error, 'Failed to deprovision tenant resources')
      assert.strictEqual(
        response.body.details,
        'Object: drain failed (code: DRAIN_FAILED)',
      )
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

test('makeRateLimiter — limit=0 passes requests through instead of blocking all', (_, done) => {
  const middleware = makeRateLimiter({
    windowMs: 60_000,
    limit: 0,
    standardHeaders: 'draft-6',
    legacyHeaders: false,
  })
  const req = { ip: '127.0.0.1', headers: {}, method: 'GET', path: '/' } as unknown as Parameters<typeof middleware>[0]
  const res = {
    setHeader: () => {},
    getHeader: () => undefined,
    status: function () { return this },
    json: function () { return this },
  } as unknown as Parameters<typeof middleware>[1]
  const next: Parameters<typeof middleware>[2] = (err?: unknown) => {
    assert.strictEqual(err, undefined, 'next(err) should not be called')
    done()
  }
  middleware(req, res, next)
})

test('readPositiveIntEnv — returns fallback for float ("1.5"), confirming integer contract', () => {
  process.env['__TEST_CP_VAR__'] = '1.5'
  assert.equal(readPositiveIntEnv('__TEST_CP_VAR__', 99), 99)
  delete process.env['__TEST_CP_VAR__']
})

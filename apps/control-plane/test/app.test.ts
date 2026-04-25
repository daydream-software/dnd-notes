import assert from 'node:assert'
import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, it } from 'node:test'
import request from 'supertest'
import { createApp } from '../src/app.js'
import {
  TenantProvisioningConflictError,
  TenantProvisioningValidationError,
  type TenantProvisioningPort,
} from '../src/provisioning.js'
import { type TenantRegistry } from '../src/tenant-registry.js'
import { createTestTenantRegistry } from './tenant-registry-test-helpers.js'

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
    app = createApp({ tenantRegistry, adminToken, tenantProvisioningService })
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
        portalDefaultTenantVersion: '9.9.9',
      })

      const response = await request(app).get('/portal/catalog').expect(200)

      assert.strictEqual(response.body.authMode, 'local')
      assert.strictEqual(response.body.defaultTenantVersion, '9.9.9')
      assert.strictEqual(response.body.provisioningConfigured, false)
      assert.strictEqual(response.body.slugPolicy.example, 'misty-harbor')
      assert.strictEqual(response.body.plans.length, 3)
      assert.strictEqual(response.body.placeholders.billingStatus, 'placeholder')
    })

    it('creates a portal account, first tenant, and session via signup', async () => {
      const response = await request(app)
        .post('/portal/signup')
        .send({
          email: 'Owner@Example.com',
          displayName: 'Alyx',
          password: 'top-secret-passphrase',
          billingEmail: 'billing@example.com',
          paymentProvider: 'stripe',
          tenantName: 'Misty Harbor',
          tenantSlug: 'misty-harbor',
          planTier: 'guild',
          acceptTerms: true,
        })
        .expect(201)

      assert.strictEqual(typeof response.body.token, 'string')
      assert.ok(response.body.token.length > 0)
      assert.strictEqual(response.body.dashboard.account.email, 'owner@example.com')
      assert.strictEqual(response.body.dashboard.account.displayName, 'Alyx')
      assert.strictEqual(response.body.dashboard.account.billingProvider, 'stripe')
      assert.strictEqual(response.body.dashboard.tenants.length, 1)
      assert.strictEqual(
        response.body.dashboard.tenants[0].tenant.displayName,
        'Misty Harbor',
      )
      assert.strictEqual(response.body.dashboard.tenants[0].tenant.planTier, 'guild')
      assert.strictEqual(
        response.body.dashboard.tenants[0].tenant.initialAdminEmail,
        'owner@example.com',
      )

      const account = await tenantRegistry.getPortalAccountByEmail('owner@example.com')
      assert.ok(account)
      assert.strictEqual(account.billingEmail, 'billing@example.com')
      assert.strictEqual(account.authProvider, 'local')

      const authRecord = await tenantRegistry.getPortalAccountAuthByEmail('owner@example.com')
      assert.ok(authRecord)
      assert.ok(authRecord.passwordHash)

      const ownedTenants = await tenantRegistry.listTenantsByOwnerId(account.id)
      assert.strictEqual(ownedTenants.length, 1)
      assert.strictEqual(ownedTenants[0].slug, 'misty-harbor')
    })

    it('rejects signup when a portal account already exists for the email', async () => {
      await request(app)
        .post('/portal/signup')
        .send({
          email: 'owner@example.com',
          displayName: 'Alyx',
          password: 'top-secret-passphrase',
          paymentProvider: 'stripe',
          tenantName: 'Misty Harbor',
          tenantSlug: 'misty-harbor',
          planTier: 'guild',
          acceptTerms: true,
        })
        .expect(201)

      const response = await request(app)
        .post('/portal/signup')
        .send({
          email: 'owner@example.com',
          displayName: 'Mallory',
          password: 'another-secret-passphrase',
          paymentProvider: 'square',
          tenantName: 'Other Tenant',
          tenantSlug: 'other-tenant',
          planTier: 'guild',
          acceptTerms: true,
        })
        .expect(409)

      assert.strictEqual(response.body.error, 'Portal account already exists')
    })

    it('returns 409 when signup hits a portal account sqlite constraint race', async () => {
      const originalCreatePortalAccount = tenantRegistry.createPortalAccount.bind(tenantRegistry)
      tenantRegistry.createPortalAccount = () => {
        const error = new Error('UNIQUE constraint failed: portal_accounts.email') as Error & {
          code?: string
        }
        error.code = 'SQLITE_CONSTRAINT_UNIQUE'
        throw error
      }

      const response = await request(app)
        .post('/portal/signup')
        .send({
          email: 'owner@example.com',
          displayName: 'Alyx',
          password: 'top-secret-passphrase',
          paymentProvider: 'stripe',
          tenantName: 'Misty Harbor',
          tenantSlug: 'misty-harbor',
          planTier: 'guild',
          acceptTerms: true,
        })
        .expect(409)

      tenantRegistry.createPortalAccount = originalCreatePortalAccount

      assert.strictEqual(response.body.error, 'Portal account already exists')
      assert.match(
        response.body.details,
        /An account already exists for that email/i,
      )
    })

    it('returns 409 when signup hits a postgres constraint with a structured constraint name', async () => {
      const originalCreatePortalAccount = tenantRegistry.createPortalAccount.bind(tenantRegistry)
      tenantRegistry.createPortalAccount = () => {
        const error = new Error('duplicate key') as Error & {
          code?: string
          constraint?: string
        }
        error.code = '23505'
        error.constraint = 'portal_accounts_email_key'
        throw error
      }

      const response = await request(app)
        .post('/portal/signup')
        .send({
          email: 'owner@example.com',
          displayName: 'Alyx',
          password: 'top-secret-passphrase',
          paymentProvider: 'stripe',
          tenantName: 'Misty Harbor',
          tenantSlug: 'misty-harbor',
          planTier: 'guild',
          acceptTerms: true,
        })
        .expect(409)

      tenantRegistry.createPortalAccount = originalCreatePortalAccount

      assert.strictEqual(response.body.error, 'Portal account already exists')
      assert.match(
        response.body.details,
        /An account already exists for that email/i,
      )
    })

    it('does not reserve an email address when signup fails before account creation', async () => {
      await tenantRegistry.createTenant({
        id: 'tenant-existing',
        slug: 'misty-harbor',
        ownerId: 'owner-existing',
        displayName: 'Existing Tenant',
        version: '1.0.0',
      })

      const failedSignup = await request(app)
        .post('/portal/signup')
        .send({
          email: 'owner@example.com',
          displayName: 'Alyx',
          password: 'top-secret-passphrase',
          paymentProvider: 'stripe',
          tenantName: 'Misty Harbor',
          tenantSlug: 'misty-harbor',
          planTier: 'guild',
          acceptTerms: true,
        })
        .expect(409)

      assert.strictEqual(failedSignup.body.error, 'Portal signup conflict')
      assert.strictEqual(await tenantRegistry.getPortalAccountByEmail('owner@example.com'), null)

      const successfulSignup = await request(app)
        .post('/portal/signup')
        .send({
          email: 'owner@example.com',
          displayName: 'Alyx',
          password: 'top-secret-passphrase',
          paymentProvider: 'stripe',
          tenantName: 'Emberfall',
          tenantSlug: 'emberfall',
          planTier: 'guild',
          acceptTerms: true,
        })
        .expect(201)

      assert.strictEqual(
        successfulSignup.body.dashboard.account.email,
        'owner@example.com',
      )
      assert.strictEqual(successfulSignup.body.dashboard.tenants.length, 1)
      assert.strictEqual(
        successfulSignup.body.dashboard.tenants[0].tenant.slug,
        'emberfall',
      )
    })

    it('rolls back portal signup resources when provisioning fails after partial setup', async () => {
      let deprovisionRequest:
        | {
            tenantId: string
            triggeredBy: string
            reason?: string
          }
        | undefined

      tenantProvisioningService = {
        async provisionTenant(request) {
          await tenantRegistry.updateTenantSubdomain(request.tenantId, 't-misty-harbor')
          await tenantRegistry.updateTenantStorageReference(
            request.tenantId,
            'dnd-notes-data-t-misty-harbor',
          )
          throw new Error('synthetic infrastructure failure')
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

      app = createApp({ tenantRegistry, adminToken, tenantProvisioningService })

      const response = await request(app)
        .post('/portal/signup')
        .send({
          email: 'owner@example.com',
          displayName: 'Alyx',
          password: 'top-secret-passphrase',
          paymentProvider: 'stripe',
          tenantName: 'Misty Harbor',
          tenantSlug: 'misty-harbor',
          planTier: 'guild',
          acceptTerms: true,
        })
        .expect(500)

      assert.strictEqual(response.body.error, 'Failed to complete portal signup')
      assert.strictEqual(
        response.body.details,
        'An unexpected error occurred while creating your account. Please try again later.',
      )
      assert.strictEqual(
        await tenantRegistry.getPortalAccountByEmail('owner@example.com'),
        null,
      )
      assert.strictEqual(await tenantRegistry.getTenantBySlug('misty-harbor'), null)
      assert.ok(deprovisionRequest)
      assert.match(deprovisionRequest.triggeredBy, /^portal:/)
      assert.strictEqual(
        deprovisionRequest.reason,
        'Portal rollback after failed tenant provisioning (guild, stripe)',
      )
    })

    it('deletes the portal account even when signup rollback deprovisioning fails', async () => {
      tenantProvisioningService = {
        async provisionTenant(request) {
          await tenantRegistry.updateTenantSubdomain(request.tenantId, 't-misty-harbor')
          await tenantRegistry.updateTenantStorageReference(
            request.tenantId,
            'dnd-notes-data-t-misty-harbor',
          )
          throw new Error('synthetic infrastructure failure')
        },
        async deprovisionTenant() {
          throw new Error('synthetic deprovision failure')
        },
        async close() {},
      }

      app = createApp({ tenantRegistry, adminToken, tenantProvisioningService })

      const response = await request(app)
        .post('/portal/signup')
        .send({
          email: 'owner@example.com',
          displayName: 'Alyx',
          password: 'top-secret-passphrase',
          paymentProvider: 'stripe',
          tenantName: 'Misty Harbor',
          tenantSlug: 'misty-harbor',
          planTier: 'guild',
          acceptTerms: true,
        })
        .expect(500)

      assert.strictEqual(response.body.error, 'Failed to complete portal signup')
      assert.strictEqual(
        response.body.details,
        'An unexpected error occurred while creating your account. Please try again later.',
      )
      assert.strictEqual(
        await tenantRegistry.getPortalAccountByEmail('owner@example.com'),
        null,
      )
      assert.strictEqual(await tenantRegistry.getTenantBySlug('misty-harbor'), null)
    })

    it('restores an owner-scoped dashboard, creates another tenant, and logs out', async () => {
      const signupResponse = await request(app)
        .post('/portal/signup')
        .send({
          email: 'owner@example.com',
          displayName: 'Alyx',
          password: 'top-secret-passphrase',
          billingEmail: 'billing@example.com',
          paymentProvider: 'manual-review',
          tenantName: 'Misty Harbor',
          tenantSlug: 'misty-harbor',
          planTier: 'adventurer',
          acceptTerms: true,
        })
        .expect(201)

      const sessionToken = signupResponse.body.token as string
      const ownerAccount = await tenantRegistry.getPortalAccountByEmail('owner@example.com')
      assert.ok(ownerAccount)

      const ownerTenant = (await tenantRegistry.listTenantsByOwnerId(ownerAccount.id))[0]
      await tenantRegistry.updateTenantSubdomain(ownerTenant.id, 't-misty-harbor')
      await tenantRegistry.updateTenantDesiredState(ownerTenant.id, 'ready')
      await tenantRegistry.updateTenantState(ownerTenant.id, 'ready', 'test-suite')

      const otherAccount = await tenantRegistry.createPortalAccount({
        id: 'account-2',
        email: 'other@example.com',
        displayName: 'Other Owner',
        passwordHash: 'test-salt:test-hash',
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
        tenantBaseDomain: 'example.com',
      })

      const dashboardResponse = await portalAuthedGet('/portal/me', sessionToken).expect(
        200,
      )

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
        sessionToken,
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
      assert.strictEqual(
        (await tenantRegistry.getPortalAccountByEmail('owner@example.com'))?.billingEmail,
        'billing@example.com',
      )

      await portalAuthedPost('/portal/logout', sessionToken).send({}).expect(200)
      await portalAuthedGet('/portal/me', sessionToken).expect(401)

      const loginResponse = await request(app)
        .post('/portal/login')
        .send({
          email: 'owner@example.com',
          password: 'top-secret-passphrase',
        })
        .expect(200)

      assert.strictEqual(loginResponse.body.dashboard.account.email, 'owner@example.com')
    })

    it('cleans up a portal tenant when account updates fail during self-serve tenant creation', async () => {
      const signupResponse = await request(app)
        .post('/portal/signup')
        .send({
          email: 'owner@example.com',
          displayName: 'Alyx',
          password: 'top-secret-passphrase',
          paymentProvider: 'manual-review',
          tenantName: 'Misty Harbor',
          tenantSlug: 'misty-harbor',
          planTier: 'adventurer',
          acceptTerms: true,
        })
        .expect(201)

      const sessionToken = signupResponse.body.token as string
      const ownerAccount = await tenantRegistry.getPortalAccountByEmail('owner@example.com')
      assert.ok(ownerAccount)

      const originalUpdatePortalAccount = tenantRegistry.updatePortalAccount.bind(
        tenantRegistry,
      )
      tenantRegistry.updatePortalAccount = () => {
        throw new Error('Simulated portal account update failure')
      }

      const response = await portalAuthedPost('/portal/me/tenants', sessionToken)
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
        1,
      )
    })

    it('returns 409 when tenant creation hits a sqlite constraint race', async () => {
      const signupResponse = await request(app)
        .post('/portal/signup')
        .send({
          email: 'owner@example.com',
          displayName: 'Alyx',
          password: 'top-secret-passphrase',
          paymentProvider: 'manual-review',
          tenantName: 'Misty Harbor',
          tenantSlug: 'misty-harbor',
          planTier: 'adventurer',
          acceptTerms: true,
        })
        .expect(201)

      const sessionToken = signupResponse.body.token as string
      const originalCreateTenant = tenantRegistry.createTenant.bind(tenantRegistry)
      tenantRegistry.createTenant = () => {
        const error = new Error('UNIQUE constraint failed: tenants.slug') as Error & {
          code?: string
        }
        error.code = 'SQLITE_CONSTRAINT_UNIQUE'
        throw error
      }

      const response = await portalAuthedPost('/portal/me/tenants', sessionToken)
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
              pvcName: null,
              configMapName: 'dnd-notes-runtime',
              secretName: 'dnd-notes-runtime-secret',
              hostname: `${request.tenantId.slice(-8)}.dnd-notes.test`,
              databaseName: 'tenant_db',
              image: 'ghcr.io/daydream-software/dnd-notes:1.0.0',
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

      app = createApp({ tenantRegistry, adminToken, tenantProvisioningService })

      const signupResponse = await request(app)
        .post('/portal/signup')
        .send({
          email: 'owner@example.com',
          displayName: 'Alyx',
          password: 'top-secret-passphrase',
          paymentProvider: 'manual-review',
          tenantName: 'Misty Harbor',
          tenantSlug: 'misty-harbor',
          planTier: 'adventurer',
          acceptTerms: true,
        })
        .expect(201)

      const sessionToken = signupResponse.body.token as string
      const ownerAccount = await tenantRegistry.getPortalAccountByEmail('owner@example.com')
      assert.ok(ownerAccount)

      const originalUpdatePortalAccount = tenantRegistry.updatePortalAccount.bind(
        tenantRegistry,
      )
      tenantRegistry.updatePortalAccount = () => {
        throw new Error('Simulated portal account update failure')
      }

      const response = await portalAuthedPost('/portal/me/tenants', sessionToken)
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
        1,
      )
    })

    it('uses forwarded client IPs for portal rate limiting when trust proxy is enabled', async () => {
      app = createApp({
        tenantRegistry,
        adminToken,
        tenantProvisioningService,
        trustProxy: true,
      })

      for (let attempt = 0; attempt < 5; attempt += 1) {
        await request(app)
          .post('/portal/signup')
          .set('X-Forwarded-For', '203.0.113.10')
          .send({})
          .expect(400)
      }

      await request(app)
        .post('/portal/signup')
        .set('X-Forwarded-For', '198.51.100.24')
        .send({})
        .expect(400)
    })

    it('rejects local portal login with the wrong password', async () => {
      await request(app)
        .post('/portal/signup')
        .send({
          email: 'owner@example.com',
          displayName: 'Alyx',
          password: 'top-secret-passphrase',
          paymentProvider: 'stripe',
          tenantName: 'Misty Harbor',
          tenantSlug: 'misty-harbor',
          planTier: 'guild',
          acceptTerms: true,
        })
        .expect(201)

      const response = await request(app)
        .post('/portal/login')
        .send({
          email: 'owner@example.com',
          password: 'wrong-password',
        })
        .expect(401)

      assert.strictEqual(response.body.error, 'Unauthorized')
    })

    it('rate limits repeated portal signup attempts', async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await request(app).post('/portal/signup').send({}).expect(400)
      }

      const response = await request(app).post('/portal/signup').send({}).expect(429)

      assert.strictEqual(
        response.body.error,
        'Too many portal signup attempts. Please wait before trying again.',
      )
      assert.strictEqual(typeof response.headers['retry-after'], 'string')
    })

    it('rate limits portal signup before parsing request bodies', async () => {
      const agent = request.agent(app)

      for (let attempt = 0; attempt < 5; attempt += 1) {
        await agent.post('/portal/signup').send({}).expect(400)
      }

      const response = await agent
        .post('/portal/signup')
        .set('Content-Type', 'application/json')
        .send('{"broken":')
        .expect(429)

      assert.strictEqual(
        response.body.error,
        'Too many portal signup attempts. Please wait before trying again.',
      )

      await agent.get('/health').expect(200)
    })

    it('rate limits repeated portal login attempts', async () => {
      await request(app)
        .post('/portal/signup')
        .send({
          email: 'owner@example.com',
          displayName: 'Alyx',
          password: 'top-secret-passphrase',
          paymentProvider: 'stripe',
          tenantName: 'Misty Harbor',
          tenantSlug: 'misty-harbor',
          planTier: 'guild',
          acceptTerms: true,
        })
        .expect(201)

      for (let attempt = 0; attempt < 5; attempt += 1) {
        await request(app)
          .post('/portal/login')
          .send({
            email: 'owner@example.com',
            password: 'wrong-password',
          })
          .expect(401)
      }

      const response = await request(app)
        .post('/portal/login')
        .send({
          email: 'owner@example.com',
          password: 'wrong-password',
        })
        .expect(429)

      assert.strictEqual(
        response.body.error,
        'Too many portal login attempts. Please wait before trying again.',
      )
      assert.strictEqual(typeof response.headers['retry-after'], 'string')
    })

    it('rate limits portal login before parsing request bodies', async () => {
      const agent = request.agent(app)

      await agent
        .post('/portal/signup')
        .send({
          email: 'owner@example.com',
          displayName: 'Alyx',
          password: 'top-secret-passphrase',
          paymentProvider: 'stripe',
          tenantName: 'Misty Harbor',
          tenantSlug: 'misty-harbor',
          planTier: 'guild',
          acceptTerms: true,
        })
        .expect(201)

      for (let attempt = 0; attempt < 5; attempt += 1) {
        await agent
          .post('/portal/login')
          .send({
            email: 'owner@example.com',
            password: 'wrong-password',
          })
          .expect(401)
      }

      const response = await agent
        .post('/portal/login')
        .set('Content-Type', 'application/json')
        .send('{"broken":')
        .expect(429)

      assert.strictEqual(
        response.body.error,
        'Too many portal login attempts. Please wait before trying again.',
      )

      await agent.get('/health').expect(200)
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
      await tenantRegistry.updateTenantBackupMetadata(
        'tenant-ready',
        JSON.stringify({
          lastBackup: '2026-04-18T22:00:00Z',
          lastBackupStatus: 'succeeded',
          lastRestoreDrillAt: '2026-04-19T06:00:00Z',
          lastRestoreDrillStatus: 'passed',
          location: 'blob://backups/tenant-ready',
        }),
      )

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
      assert.strictEqual(response.body.summary.tenantsWithBackupMetadata, 1)
      assert.strictEqual(response.body.summary.tenantsMissingBackupMetadata, 1)
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
      assert.strictEqual(readyTenant.latestTransition.triggeredBy, 'test-suite')
      assert.strictEqual(readyTenant.latestTransition.reason, 'Provisioned in test')
      assert.strictEqual(readyTenant.latestTransition.toState, 'ready')

      const failedTenant = response.body.tenants.find(
        (tenant: { tenant: { id: string } }) => tenant.tenant.id === 'tenant-failed',
      )
      assert.ok(failedTenant)
      assert.strictEqual(failedTenant.health, 'attention')
      assert.strictEqual(failedTenant.backup.rawMetadata, null)
      assert.strictEqual(failedTenant.latestTransition.triggeredBy, 'test-suite')
      assert.strictEqual(failedTenant.latestTransition.reason, 'Synthetic failure in test')
      assert.strictEqual(failedTenant.latestTransition.toState, 'failed')
    })

    it('keeps opaque backup metadata when it is not parseable JSON', async () => {
      await tenantRegistry.createTenant({
        id: 'tenant-opaque',
        slug: 'tenant-opaque',
        ownerId: 'owner-3',
        version: '1.0.0',
      })
      await tenantRegistry.updateTenantBackupMetadata('tenant-opaque', 'not-json')

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
      await tenantRegistry.createTenant({
        id: 'tenant-blank',
        slug: 'tenant-blank',
        ownerId: 'owner-4',
        version: '1.0.0',
      })
      await tenantRegistry.updateTenantDesiredState('tenant-blank', 'ready')
      await tenantRegistry.updateTenantState(
        'tenant-blank',
        'ready',
        'test-suite',
        'Provisioned in test',
      )
      await tenantRegistry.updateTenantBackupMetadata('tenant-blank', '   ')

      const response = await authedGet('/internal/fleet/status').expect(200)
      const tenant = response.body.tenants.find(
        (entry: { tenant: { id: string } }) => entry.tenant.id === 'tenant-blank',
      )

      assert.ok(tenant)
      assert.strictEqual(tenant.health, 'attention')
      assert.strictEqual(tenant.backup.rawMetadata, null)
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
      await tenantRegistry.updateTenantStorageReference('tenant-123', 'pvc-tenant-123')
      await tenantRegistry.updateTenantStorageProfile('tenant-123', {
        mode: 'sqlite-pvc',
        migrationStatus: 'failed',
        failureReason: 'Synthetic cutover failure',
      })
      await tenantRegistry.updateTenantBackupMetadata(
        'tenant-123',
        JSON.stringify({
          lastBackupAt: '2026-04-24T00:00:00Z',
          lastBackupStatus: 'succeeded',
          location: 'blob://backups/tenant-123',
        }),
      )

      const response = await authedGet(`${tenantPath('tenant-123')}/storage`).expect(200)

      assert.strictEqual(response.body.storage.tenantId, 'tenant-123')
      assert.strictEqual(response.body.storage.mode, 'sqlite-pvc')
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
      assert.match(
        response.body.storage.blockers.join(' '),
        /unknown|backup/i,
      )
    })

    it('blocks cutover readiness when backup metadata omits lastBackupStatus', async () => {
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
      await tenantRegistry.updateTenantStorageReference('tenant-789', 'pvc-tenant-789')
      await tenantRegistry.updateTenantStorageProfile('tenant-789', {
        mode: 'sqlite-pvc',
        migrationStatus: 'failed',
        failureReason: 'Synthetic cutover failure',
      })
      await tenantRegistry.updateTenantBackupMetadata(
        'tenant-789',
        JSON.stringify({
          lastBackupAt: '2026-04-24T00:00:00Z',
          location: 'blob://backups/tenant-789',
        }),
      )

      const response = await authedGet(`${tenantPath('tenant-789')}/storage`).expect(200)

      assert.strictEqual(response.body.storage.cutoverReady, false)
      assert.strictEqual(response.body.storage.backup.status, 'invalid')
      assert.match(response.body.storage.backup.details, /lastBackupStatus/i)
      assert.match(response.body.storage.blockers.join(' '), /lastBackupStatus/i)
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
      console.error = ((message: unknown) => {
        errorMessages.push(String(message))
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
              pvcName: null,
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
      assert.strictEqual(response.body.resources.pvcName, null)

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

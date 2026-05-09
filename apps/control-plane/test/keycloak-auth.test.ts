import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import request from 'supertest'
import { createApp } from '../src/app.js'
import {
  createControlPlaneAdminAuth,
  createPortalKeycloakAuth,
} from '../src/keycloak-auth.js'
import { type TenantRegistry } from '../src/tenant-registry.js'
import { createTestTenantRegistry } from './tenant-registry-test-helpers.js'
import fakeKeycloakModule from '../../../tests/fake-keycloak.js'

describe('Control Plane Keycloak auth', () => {
  const keycloakRealm = 'dnd-notes-workforce'
  const clientId = 'dnd-notes-control-plane'
  const { startFakeKeycloakServer } = fakeKeycloakModule
  let tenantRegistry: TenantRegistry
  let keycloak: Awaited<ReturnType<typeof startFakeKeycloakServer>> | undefined
  let cleanupTenantRegistry: (() => Promise<void>) | undefined

  beforeEach(() => {
    const registry = createTestTenantRegistry()
    tenantRegistry = registry.tenantRegistry
    cleanupTenantRegistry = registry.cleanup
  })

  afterEach(async () => {
    await keycloak?.close()
    keycloak = undefined
    await cleanupTenantRegistry?.()
    cleanupTenantRegistry = undefined
  })

  function createKeycloakApp() {
    const adminAuth = createControlPlaneAdminAuth({
      mode: 'keycloak',
      keycloakUrl: keycloak!.baseUrl,
      keycloakRealm,
      clientId,
      requiredRoles: ['control-plane-admin', 'control-plane-workforce'],
    })

    return createApp({ tenantRegistry, adminAuth })
  }

  it('accepts workforce/admin Keycloak JWTs for /internal routes', async () => {
    keycloak = await startFakeKeycloakServer(keycloakRealm)
    const app = createKeycloakApp()
    const token = keycloak.issueToken({
      audience: 'account',
      clientId,
      roles: ['control-plane-workforce'],
    })

    const response = await request(app)
      .get('/internal/tenants')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)

    assert.deepEqual(response.body.tenants, [])
  })

  it('accepts workforce/admin Keycloak JWTs for the fleet status surface', async () => {
    keycloak = await startFakeKeycloakServer(keycloakRealm)
    const app = createKeycloakApp()
    const token = keycloak.issueToken({
      audience: 'account',
      clientId,
      roles: ['control-plane-admin'],
    })

    const response = await request(app)
      .get('/internal/fleet/status')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)

    assert.equal(response.body.controlPlane.status, 'healthy')
    assert.equal(response.body.summary.totalTenants, 0)
  })

  it('tolerates a small future nbf skew from Keycloak', async () => {
    keycloak = await startFakeKeycloakServer(keycloakRealm)
    const app = createKeycloakApp()
    const token = keycloak.issueToken({
      audience: 'account',
      clientId,
      roles: ['control-plane-admin'],
      notBeforeOffsetSeconds: 5,
    })

    const response = await request(app)
      .get('/internal/fleet/status')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)

    assert.equal(response.body.controlPlane.status, 'healthy')
  })

  it('rejects valid JWTs that lack a required workforce/admin role', async () => {
    keycloak = await startFakeKeycloakServer(keycloakRealm)
    const app = createKeycloakApp()
    const token = keycloak.issueToken({ clientId, roles: ['tenant-user'] })

    const response = await request(app)
      .get('/internal/tenants')
      .set('Authorization', `Bearer ${token}`)
      .expect(403)

    assert.equal(response.body.error, 'Forbidden')
  })

  it('rejects write-side routes when the JWT lacks a required workforce/admin role', async () => {
    keycloak = await startFakeKeycloakServer(keycloakRealm)
    await tenantRegistry.createTenant({
      id: 'tenant-123',
      slug: 'test-tenant',
      ownerId: 'owner-456',
      version: '1.0.0',
    })
    const app = createKeycloakApp()
    const token = keycloak.issueToken({ clientId, roles: ['tenant-user'] })

    const response = await request(app)
      .post('/internal/tenants/tenant-123/provision')
      .set('Authorization', `Bearer ${token}`)
      .send({
        triggeredBy: 'operator@example.com',
        reason: 'Portal smoke test',
      })
      .expect(403)

    assert.equal(response.body.error, 'Forbidden')
  })

  it('rejects tokens issued for a different client', async () => {
    keycloak = await startFakeKeycloakServer(keycloakRealm)
    const app = createKeycloakApp()
    const token = keycloak.issueToken({
      azp: 'different-client',
      clientId: 'different-client',
      audience: 'different-client',
    })

    const response = await request(app)
      .get('/internal/tenants')
      .set('Authorization', `Bearer ${token}`)
      .expect(401)

    assert.equal(response.body.error, 'Unauthorized')
  })

  it('accepts an explicit jwksUrl override', async () => {
    keycloak = await startFakeKeycloakServer(keycloakRealm)
    const jwksUrl = `${keycloak.baseUrl}/realms/${keycloakRealm}/protocol/openid-connect/certs`
    const adminAuth = createControlPlaneAdminAuth({
      mode: 'keycloak',
      keycloakUrl: 'http://keycloak.127.0.0.1.nip.io:8080',
      jwksUrl,
      issuer: `${keycloak.baseUrl}/realms/${keycloakRealm}`,
      keycloakRealm,
      clientId,
      requiredRoles: ['control-plane-admin', 'control-plane-workforce'],
    })
    const app = createApp({ tenantRegistry, adminAuth })
    const token = keycloak.issueToken({
      audience: 'account',
      clientId,
      roles: ['control-plane-admin'],
    })

    const response = await request(app)
      .get('/internal/fleet/status')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)

    assert.equal(response.body.controlPlane.status, 'healthy')
  })
})

describe('Portal Keycloak auth', () => {
  const keycloakRealm = 'dnd-notes-dev'
  const portalClientId = 'dnd-notes-customer-portal'
  const { startFakeKeycloakServer } = fakeKeycloakModule
  let tenantRegistry: TenantRegistry
  let keycloak: Awaited<ReturnType<typeof startFakeKeycloakServer>> | undefined
  let cleanupTenantRegistry: (() => Promise<void>) | undefined

  beforeEach(() => {
    const registry = createTestTenantRegistry()
    tenantRegistry = registry.tenantRegistry
    cleanupTenantRegistry = registry.cleanup
  })

  afterEach(async () => {
    await keycloak?.close()
    keycloak = undefined
    await cleanupTenantRegistry?.()
    cleanupTenantRegistry = undefined
  })

  it('rejects portal/signup when auth mode is keycloak', async () => {
    const portalKeycloakAuth = createPortalKeycloakAuth({ mode: 'local' })
    const app = createApp({
      tenantRegistry,
      adminToken: 'any-token',
      portalAuthMode: 'keycloak',
      portalKeycloakAuth,
    })

    const response = await request(app)
      .post('/portal/signup')
      .send({
        email: 'user@example.com',
        password: 'password',
        displayName: 'User',
        tenantName: 'My Campaign',
        tenantSlug: 'my-campaign',
        planTier: 'adventurer',
        paymentProvider: 'stripe',
      })
      .expect(501)

    assert.ok(response.body.error)
  })

  it('rejects portal/login when auth mode is keycloak', async () => {
    const portalKeycloakAuth = createPortalKeycloakAuth({ mode: 'local' })
    const app = createApp({
      tenantRegistry,
      adminToken: 'any-token',
      portalAuthMode: 'keycloak',
      portalKeycloakAuth,
    })

    const response = await request(app)
      .post('/portal/login')
      .send({ email: 'user@example.com', password: 'password' })
      .expect(501)

    assert.ok(response.body.error)
  })

  it('verifies a valid portal Keycloak bearer token on /portal/me', async () => {
    keycloak = await startFakeKeycloakServer(keycloakRealm)

    // Create a matching portal account
    await tenantRegistry.createPortalAccount({
      id: 'portal-account-1',
      email: 'portal-user@example.com',
      displayName: 'Portal User',
      passwordHash: null,
      billingEmail: 'portal-user@example.com',
      billingProvider: 'stripe',
    })

    const portalKeycloakAuth = createPortalKeycloakAuth({
      mode: 'keycloak',
      keycloakUrl: keycloak.baseUrl,
      keycloakRealm,
      clientId: portalClientId,
    })
    const app = createApp({
      tenantRegistry,
      adminToken: 'any-token',
      portalAuthMode: 'keycloak',
      portalKeycloakAuth,
    })
    const token = keycloak.issueToken({
      clientId: portalClientId,
      email: 'portal-user@example.com',
    })

    const response = await request(app)
      .get('/portal/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)

    assert.ok(response.body.account)
  })

  it('rejects an invalid portal Keycloak bearer token on /portal/me', async () => {
    keycloak = await startFakeKeycloakServer(keycloakRealm)
    const portalKeycloakAuth = createPortalKeycloakAuth({
      mode: 'keycloak',
      keycloakUrl: keycloak.baseUrl,
      keycloakRealm,
      clientId: portalClientId,
    })
    const app = createApp({
      tenantRegistry,
      adminToken: 'any-token',
      portalAuthMode: 'keycloak',
      portalKeycloakAuth,
    })

    const response = await request(app)
      .get('/portal/me')
      .set('Authorization', 'Bearer not-a-real-token')
      .expect(401)

    assert.ok(response.body.error)
  })

  it('returns 401 when bearer token references an unknown portal account', async () => {
    keycloak = await startFakeKeycloakServer(keycloakRealm)
    const portalKeycloakAuth = createPortalKeycloakAuth({
      mode: 'keycloak',
      keycloakUrl: keycloak.baseUrl,
      keycloakRealm,
      clientId: portalClientId,
    })
    const app = createApp({
      tenantRegistry,
      adminToken: 'any-token',
      portalAuthMode: 'keycloak',
      portalKeycloakAuth,
    })
    const token = keycloak.issueToken({
      clientId: portalClientId,
      email: 'no-account@example.com',
    })

    const response = await request(app)
      .get('/portal/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401)

    assert.ok(response.body.error)
  })
})

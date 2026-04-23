import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { createControlPlaneAdminAuth } from '../src/keycloak-auth.js'
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

import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { createControlPlaneAdminAuth } from '../src/keycloak-auth.js'
import { TenantRegistry } from '../src/tenant-registry.js'
import fakeKeycloakModule from '../../../tests/fake-keycloak.js'

describe('Control Plane Keycloak auth', () => {
  const keycloakRealm = 'dnd-notes-workforce'
  const clientId = 'dnd-notes-control-plane'
  const { startFakeKeycloakServer } = fakeKeycloakModule
  let tenantRegistry: TenantRegistry
  let keycloak: Awaited<ReturnType<typeof startFakeKeycloakServer>> | undefined

  beforeEach(() => {
    tenantRegistry = new TenantRegistry(':memory:')
  })

  afterEach(async () => {
    await keycloak?.close()
    keycloak = undefined
    tenantRegistry.close()
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
})

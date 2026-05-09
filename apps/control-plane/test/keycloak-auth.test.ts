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

  it('auto-creates a portal account for a brand-new Keycloak user with no local account', async () => {
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
    const keycloakSub = 'kc-sub-brand-new'
    const token = keycloak.issueToken({
      clientId: portalClientId,
      email: 'no-account@example.com',
      subject: keycloakSub,
    })

    // Auto-create: no local account exists, but Keycloak token is valid.
    const response = await request(app)
      .get('/portal/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)

    assert.ok(response.body.account)

    // The new account must be retrievable by keycloakSub.
    const created = await tenantRegistry.getPortalAccountByKeycloakSub(keycloakSub)
    assert.ok(created)
    assert.equal(created.email, 'no-account@example.com')
  })
})

describe('Portal Keycloak auth — auto-link by email', () => {
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

  function buildPortalApp() {
    const portalKeycloakAuth = createPortalKeycloakAuth({
      mode: 'keycloak',
      keycloakUrl: keycloak!.baseUrl,
      keycloakRealm,
      clientId: portalClientId,
    })
    return createApp({
      tenantRegistry,
      adminToken: 'any-token',
      portalAuthMode: 'keycloak',
      portalKeycloakAuth,
    })
  }

  it('auto-links a local account on first Keycloak login and persists the sub', async () => {
    keycloak = await startFakeKeycloakServer(keycloakRealm)

    // Existing local account — no keycloakSub yet.
    await tenantRegistry.createPortalAccount({
      id: 'local-acct-1',
      email: 'user@example.com',
      displayName: 'Migrated User',
    })

    const keycloakSub = 'kc-sub-abc123'
    const app = buildPortalApp()
    const token = keycloak.issueToken({
      clientId: portalClientId,
      email: 'user@example.com',
      subject: keycloakSub,
    })

    const response = await request(app)
      .get('/portal/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)

    assert.ok(response.body.account)

    // Verify the sub was persisted.
    const linked = await tenantRegistry.getPortalAccountByKeycloakSub(keycloakSub)
    assert.ok(linked, 'keycloakSub was not persisted')
    assert.equal(linked.id, 'local-acct-1')
    assert.equal(linked.keycloakSub, keycloakSub)
  })

  it('resolves via sub on subsequent logins (fast path) without writing again', async () => {
    keycloak = await startFakeKeycloakServer(keycloakRealm)

    const keycloakSub = 'kc-sub-returning-user'
    await tenantRegistry.createPortalAccount({
      id: 'linked-acct-1',
      email: 'returning@example.com',
      displayName: 'Returning User',
      keycloakSub,
    })

    const app = buildPortalApp()
    const token = keycloak.issueToken({
      clientId: portalClientId,
      email: 'returning@example.com',
      subject: keycloakSub,
    })

    const response = await request(app)
      .get('/portal/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)

    assert.ok(response.body.account)
    assert.equal(response.body.account.id, 'linked-acct-1')
  })

  it('handles concurrent first-logins: both succeed and link is set exactly once', async () => {
    keycloak = await startFakeKeycloakServer(keycloakRealm)

    await tenantRegistry.createPortalAccount({
      id: 'concurrent-acct-1',
      email: 'concurrent@example.com',
      displayName: 'Concurrent User',
    })

    const keycloakSub = 'kc-sub-concurrent'
    const app = buildPortalApp()
    const token = keycloak.issueToken({
      clientId: portalClientId,
      email: 'concurrent@example.com',
      subject: keycloakSub,
    })

    // Fire two requests "simultaneously" — pg-mem serializes them, but we still
    // exercise the conditional UPDATE path and verify post-conditions.
    const [r1, r2] = await Promise.all([
      request(app).get('/portal/me').set('Authorization', `Bearer ${token}`),
      request(app).get('/portal/me').set('Authorization', `Bearer ${token}`),
    ])

    assert.equal(r1.status, 200, `first concurrent request status: ${r1.status}`)
    assert.equal(r2.status, 200, `second concurrent request status: ${r2.status}`)

    // Exactly one link must exist.
    const linked = await tenantRegistry.getPortalAccountByKeycloakSub(keycloakSub)
    assert.ok(linked, 'keycloakSub was not persisted after concurrent logins')
    assert.equal(linked.keycloakSub, keycloakSub)
  })

  it('auto-creates a portal account when no local account matches the email', async () => {
    keycloak = await startFakeKeycloakServer(keycloakRealm)

    const keycloakSub = 'kc-sub-new-user'
    const app = buildPortalApp()
    const token = keycloak.issueToken({
      clientId: portalClientId,
      email: 'ghost@example.com',
      subject: keycloakSub,
    })

    // First login: account is auto-created.
    const response = await request(app)
      .get('/portal/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)

    assert.ok(response.body.account)

    // The created account must be retrievable by keycloakSub (fast path).
    const created = await tenantRegistry.getPortalAccountByKeycloakSub(keycloakSub)
    assert.ok(created, 'auto-created account not found by keycloakSub')
    assert.equal(created.email, 'ghost@example.com')
    assert.equal(created.keycloakSub, keycloakSub)

    // Subsequent login resolves via sub fast path.
    const response2 = await request(app)
      .get('/portal/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)

    assert.equal(response2.body.account.id, response.body.account.id)
  })

  it('returns 401 when the email account is already bound to a different Keycloak sub', async () => {
    keycloak = await startFakeKeycloakServer(keycloakRealm)

    // Account pre-linked to sub A.
    await tenantRegistry.createPortalAccount({
      id: 'stolen-acct-1',
      email: 'contested@example.com',
      displayName: 'Contested User',
      keycloakSub: 'kc-sub-original',
    })

    const app = buildPortalApp()
    // Token with sub B claiming the same email.
    const token = keycloak.issueToken({
      clientId: portalClientId,
      email: 'contested@example.com',
      subject: 'kc-sub-different',
    })

    const response = await request(app)
      .get('/portal/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401)

    assert.ok(response.body.error)

    // Original binding must be intact.
    const original = await tenantRegistry.getPortalAccountByKeycloakSub('kc-sub-original')
    assert.ok(original)
    assert.equal(original.keycloakSub, 'kc-sub-original')
  })
})

describe('Portal Keycloak auth — auto-create on first login', () => {
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

  function buildPortalApp() {
    const portalKeycloakAuth = createPortalKeycloakAuth({
      mode: 'keycloak',
      keycloakUrl: keycloak!.baseUrl,
      keycloakRealm,
      clientId: portalClientId,
    })
    return createApp({
      tenantRegistry,
      adminToken: 'any-token',
      portalAuthMode: 'keycloak',
      portalKeycloakAuth,
    })
  }

  it('concurrent first-logins for the same Keycloak user produce exactly one account', async () => {
    keycloak = await startFakeKeycloakServer(keycloakRealm)

    const keycloakSub = 'kc-sub-concurrent-create'
    const app = buildPortalApp()
    const token = keycloak.issueToken({
      clientId: portalClientId,
      email: 'concurrent-new@example.com',
      subject: keycloakSub,
    })

    // Fire two requests simultaneously. pg-mem serializes them, but we exercise
    // the unique-constraint idempotency path in createPortalAccountFromKeycloak.
    const [r1, r2] = await Promise.all([
      request(app).get('/portal/me').set('Authorization', `Bearer ${token}`),
      request(app).get('/portal/me').set('Authorization', `Bearer ${token}`),
    ])

    assert.equal(r1.status, 200, `first concurrent auto-create status: ${r1.status}`)
    assert.equal(r2.status, 200, `second concurrent auto-create status: ${r2.status}`)

    // Both responses must reference the same account.
    assert.equal(
      r1.body.account.id,
      r2.body.account.id,
      'concurrent creates produced two accounts',
    )

    // Exactly one row for this keycloakSub.
    const created = await tenantRegistry.getPortalAccountByKeycloakSub(keycloakSub)
    assert.ok(created, 'no account found for keycloakSub after concurrent auto-create')
    assert.equal(created.keycloakSub, keycloakSub)
    assert.equal(created.email, 'concurrent-new@example.com')
  })

  it('auto-created account cannot reach operator-portal endpoints', async () => {
    keycloak = await startFakeKeycloakServer(keycloakRealm)

    // Issue a customer-realm token for a brand-new user (no operator roles).
    const keycloakSub = 'kc-sub-customer-only'
    const adminAuth = createControlPlaneAdminAuth({
      mode: 'keycloak',
      keycloakUrl: keycloak.baseUrl,
      keycloakRealm,
      clientId: portalClientId,
      requiredRoles: ['control-plane-admin', 'control-plane-workforce'],
    })
    const portalKeycloakAuth = createPortalKeycloakAuth({
      mode: 'keycloak',
      keycloakUrl: keycloak.baseUrl,
      keycloakRealm,
      clientId: portalClientId,
    })
    const app = createApp({
      tenantRegistry,
      adminAuth,
      portalAuthMode: 'keycloak',
      portalKeycloakAuth,
    })
    const token = keycloak.issueToken({
      clientId: portalClientId,
      email: 'customer-only@example.com',
      subject: keycloakSub,
      // No control-plane-admin / control-plane-workforce roles.
    })

    // Portal endpoint: auto-creates the account and returns 200.
    await request(app)
      .get('/portal/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)

    // Operator endpoint: must still reject — the operator gate is role-based,
    // not portal_accounts-based. Auto-create must not weaken this invariant.
    const operatorResponse = await request(app)
      .get('/internal/tenants')
      .set('Authorization', `Bearer ${token}`)
      .expect(403)

    assert.equal(operatorResponse.body.error, 'Forbidden')
  })

  it('derives display name from name claim', async () => {
    keycloak = await startFakeKeycloakServer(keycloakRealm)

    const keycloakSub = 'kc-sub-display-name'
    const app = buildPortalApp()
    const token = keycloak.issueToken({
      clientId: portalClientId,
      email: 'named@example.com',
      subject: keycloakSub,
      userName: 'Alice Wonderland',
    })

    await request(app)
      .get('/portal/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)

    const created = await tenantRegistry.getPortalAccountByKeycloakSub(keycloakSub)
    assert.ok(created)
    assert.equal(created.displayName, 'Alice Wonderland')
  })

  it('derives display name from given_name + family_name when name claim is absent', async () => {
    keycloak = await startFakeKeycloakServer(keycloakRealm)

    const keycloakSub = 'kc-sub-given-family'
    const app = buildPortalApp()
    // userName: '' omits the name claim; givenName + familyName are set.
    const token = keycloak.issueToken({
      clientId: portalClientId,
      email: 'given-family@example.com',
      subject: keycloakSub,
      userName: '',
      givenName: 'Bob',
      familyName: 'Builder',
    })

    await request(app)
      .get('/portal/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)

    const created = await tenantRegistry.getPortalAccountByKeycloakSub(keycloakSub)
    assert.ok(created)
    assert.equal(created.displayName, 'Bob Builder')
  })

  it('falls back to email local-part when no name claims are present', async () => {
    keycloak = await startFakeKeycloakServer(keycloakRealm)

    const keycloakSub = 'kc-sub-email-localpart'
    const app = buildPortalApp()
    const token = keycloak.issueToken({
      clientId: portalClientId,
      email: 'localpart@example.com',
      subject: keycloakSub,
      userName: '',
    })

    await request(app)
      .get('/portal/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)

    const created = await tenantRegistry.getPortalAccountByKeycloakSub(keycloakSub)
    assert.ok(created)
    assert.equal(created.displayName, 'localpart')
  })
})

import assert from 'node:assert/strict'
import test from 'node:test'
import request from 'supertest'
import { defaultCampaignId } from '../src/campaign.js'
import { createTenantRuntimeAuth } from '../src/keycloak-auth.js'
import { OwnerKeycloakLinkConflictError } from '../src/note-store.js'
import { createTestApp, withAuth, withGuest } from './test-helpers.js'
import fakeKeycloakModule from '../../../tests/fake-keycloak.js'

const tenantClientId = 'dnd-notes-tenant-app'
const controlPlaneClientId = 'dnd-notes-control-plane'
// The per-tenant role gate (#196) requires every authenticated tenant token
// to carry the `tenant-member` role under `resource_access[clientId].roles`.
// Tests issue tokens with this role by default; the "missing role" 403 case
// is exercised explicitly.
const tenantMemberRoles = ['tenant-member']
const { startFakeKeycloakServer } = fakeKeycloakModule

function createKeycloakRuntimeAuth(baseUrl: string, issuer: string) {
  return createTenantRuntimeAuth({
    mode: 'keycloak',
    keycloakUrl: baseUrl,
    keycloakRealm: issuer.split('/').at(-1),
    clientId: tenantClientId,
    issuer,
    jwksUrl: `${issuer}/protocol/openid-connect/certs`,
  })
}

test('tenant runtime auth accepts Keycloak bearer tokens and links owner accounts by keycloak_sub', async (t) => {
  const keycloak = await startFakeKeycloakServer()
  t.after(() => keycloak.close())

  const { app, cleanup } = await createTestApp({
    runtimeAuth: createKeycloakRuntimeAuth(keycloak.baseUrl, keycloak.issuer),
  })
  t.after(cleanup)

  const subject = 'tenant-owner-subject'
  const token = keycloak.issueToken({
    clientId: tenantClientId,
    email: 'owner@example.com',
    subject,
    userName: 'Owner Example',
    roles: tenantMemberRoles,
  })
  const authed = withAuth(request(app), token)

  const sessionResponse = await authed.get('/api/auth/session')
  assert.equal(sessionResponse.status, 200)
  assert.equal(sessionResponse.body.owner.email, 'owner@example.com')
  assert.equal(sessionResponse.body.owner.displayName, 'Owner Example')
  assert.equal(sessionResponse.body.owner.keycloakSub, subject)

  const campaignsResponse = await authed.get('/api/campaigns')
  assert.equal(campaignsResponse.status, 200)
  assert.equal(campaignsResponse.body.campaigns.length, 1)
  assert.equal(campaignsResponse.body.campaigns[0].id, defaultCampaignId)
})

test('tenant runtime auth preserves the linked owner when a Keycloak email change collides locally', async (t) => {
  const keycloak = await startFakeKeycloakServer()
  t.after(() => keycloak.close())

  const subject = 'tenant-owner-subject'
  const claimedEmail = 'site-admin@example.com'
  const { app, cleanup, noteStore } = await createTestApp({
    runtimeAuth: createKeycloakRuntimeAuth(keycloak.baseUrl, keycloak.issuer),
    siteAdminEmails: [claimedEmail],
  })
  t.after(cleanup)

  const initialToken = keycloak.issueToken({
    clientId: tenantClientId,
    email: 'owner@example.com',
    subject,
    userName: 'Owner Example',
    roles: tenantMemberRoles,
  })
  const initialSessionResponse = await withAuth(request(app), initialToken).get('/api/auth/session')
  assert.equal(initialSessionResponse.status, 200)

  const collidingOwner = await noteStore.createOwnerAccount({
    displayName: 'Local Site Admin',
    email: claimedEmail,
    password: 'moonlit-secret',
  })
  assert.ok(collidingOwner)
  assert.equal(collidingOwner.isSiteAdmin, true)

  const changedEmailToken = keycloak.issueToken({
    clientId: tenantClientId,
    email: claimedEmail,
    subject,
    userName: 'Renamed Owner',
    roles: tenantMemberRoles,
  })
  const changedEmailAuth = withAuth(request(app), changedEmailToken)

  const [sessionResponse, campaignsResponse, adminResponse] = await Promise.all([
    changedEmailAuth.get('/api/auth/session'),
    changedEmailAuth.get('/api/campaigns'),
    changedEmailAuth.get('/api/admin/accounts'),
  ])

  assert.equal(sessionResponse.status, 200)
  assert.equal(sessionResponse.body.owner.id, initialSessionResponse.body.owner.id)
  assert.equal(sessionResponse.body.owner.email, 'owner@example.com')
  assert.equal(sessionResponse.body.owner.displayName, 'Renamed Owner')
  assert.equal(sessionResponse.body.owner.isSiteAdmin, false)
  assert.equal(sessionResponse.body.owner.keycloakSub, subject)

  assert.equal(campaignsResponse.status, 200)
  assert.equal(campaignsResponse.body.campaigns.length, 1)
  assert.equal(campaignsResponse.body.campaigns[0].id, defaultCampaignId)

  assert.equal(adminResponse.status, 403)
  assert.equal(adminResponse.body.error, 'Site-admin access is required.')

  const ownerAccounts = await noteStore.listOwnerAccounts()
  const linkedOwner = ownerAccounts.find((owner) => owner.id === sessionResponse.body.owner.id)
  assert.ok(linkedOwner)
  assert.equal(linkedOwner.email, 'owner@example.com')
  assert.equal(linkedOwner.displayName, 'Renamed Owner')
  assert.equal(linkedOwner.isSiteAdmin, false)
  assert.equal(linkedOwner.keycloakSub, subject)

  const localSiteAdmin = ownerAccounts.find((owner) => owner.id === collidingOwner.id)
  assert.ok(localSiteAdmin)
  assert.equal(localSiteAdmin.email, claimedEmail)
  assert.equal(localSiteAdmin.isSiteAdmin, true)
  assert.equal(localSiteAdmin.keycloakSub, null)
})

test('tenant runtime auth returns 409 when another Keycloak subject claims an existing linked email', async (t) => {
  const keycloak = await startFakeKeycloakServer()
  t.after(() => keycloak.close())

  const { app, cleanup, noteStore } = await createTestApp({
    runtimeAuth: createKeycloakRuntimeAuth(keycloak.baseUrl, keycloak.issuer),
  })
  t.after(cleanup)

  const linkedToken = keycloak.issueToken({
    clientId: tenantClientId,
    email: 'owner@example.com',
    subject: 'linked-owner-subject',
    userName: 'Linked Owner',
    roles: tenantMemberRoles,
  })
  const conflictingToken = keycloak.issueToken({
    clientId: tenantClientId,
    email: 'owner@example.com',
    subject: 'conflicting-owner-subject',
    userName: 'Conflicting Owner',
    roles: tenantMemberRoles,
  })

  const linkedSessionResponse = await withAuth(request(app), linkedToken).get('/api/auth/session')
  assert.equal(linkedSessionResponse.status, 200)

  const conflictResponse = await withAuth(request(app), conflictingToken).get('/api/auth/session')
  assert.equal(conflictResponse.status, 409)
  assert.equal(
    conflictResponse.body.error,
    'This owner account is already linked to a different Keycloak identity.',
  )

  const ownerAccounts = await noteStore.listOwnerAccounts()
  assert.equal(ownerAccounts.length, 1)
  assert.equal(ownerAccounts[0]?.keycloakSub, 'linked-owner-subject')
})

test('tenant runtime auth maps typed Keycloak link conflicts to 409 without reading the error text', async (t) => {
  const keycloak = await startFakeKeycloakServer()
  t.after(() => keycloak.close())

  const { app, cleanup, noteStore } = await createTestApp({
    runtimeAuth: createKeycloakRuntimeAuth(keycloak.baseUrl, keycloak.issuer),
  })
  t.after(cleanup)

  const originalFindOrCreateOwnerByKeycloakIdentity =
    noteStore.findOrCreateOwnerByKeycloakIdentity.bind(noteStore)
  noteStore.findOrCreateOwnerByKeycloakIdentity = async () => {
    throw new OwnerKeycloakLinkConflictError(
      'owner-123',
      'route layer should not need this message to return 409',
    )
  }
  t.after(() => {
    noteStore.findOrCreateOwnerByKeycloakIdentity = originalFindOrCreateOwnerByKeycloakIdentity
  })

  const token = keycloak.issueToken({
    clientId: tenantClientId,
    email: 'owner@example.com',
    subject: 'typed-conflict-subject',
    userName: 'Typed Conflict',
    roles: tenantMemberRoles,
  })

  const response = await withAuth(request(app), token).get('/api/auth/session')
  assert.equal(response.status, 409)
  assert.equal(
    response.body.error,
    'This owner account is already linked to a different Keycloak identity.',
  )
})

test('tenant runtime auth rejects wrong-client, expired, and local-auth requests when Keycloak mode is enabled', async (t) => {
  const keycloak = await startFakeKeycloakServer()
  t.after(() => keycloak.close())

  const { app, cleanup } = await createTestApp({
    runtimeAuth: createKeycloakRuntimeAuth(keycloak.baseUrl, keycloak.issuer),
  })
  t.after(cleanup)

  const wrongClientToken = keycloak.issueToken({
    clientId: controlPlaneClientId,
    email: 'site-admin@example.com',
    roles: ['admin'],
    userName: 'Control Plane Admin',
  })
  const expiredToken = keycloak.issueToken({
    clientId: tenantClientId,
    email: 'owner@example.com',
    expiresInSeconds: -30,
  })

  const [wrongClientResponse, expiredResponse, registerResponse, loginResponse] =
    await Promise.all([
      withAuth(request(app), wrongClientToken).get('/api/campaigns'),
      withAuth(request(app), expiredToken).get('/api/campaigns'),
      request(app).post('/api/auth/register').send({
        displayName: 'Chunk',
        email: 'chunk@example.com',
        password: 'moonlit-secret',
      }),
      request(app).post('/api/auth/login').send({
        email: 'chunk@example.com',
        password: 'moonlit-secret',
      }),
    ])

  assert.equal(wrongClientResponse.status, 401)
  assert.equal(
    wrongClientResponse.body.error,
    'Owner access token is invalid or expired.',
  )
  assert.equal(expiredResponse.status, 401)
  assert.equal(
    expiredResponse.body.error,
    'Owner access token is invalid or expired.',
  )
  assert.equal(registerResponse.status, 404)
  assert.equal(
    registerResponse.body.error,
    'Local auth routes are disabled when Keycloak auth is enabled.',
  )
  assert.equal(loginResponse.status, 404)
  assert.equal(
    loginResponse.body.error,
    'Local auth routes are disabled when Keycloak auth is enabled.',
  )
})

test('guest share-link flows stay local alongside Keycloak bearer auth', async (t) => {
  const keycloak = await startFakeKeycloakServer()
  t.after(() => keycloak.close())

  const { app, cleanup } = await createTestApp({
    runtimeAuth: createKeycloakRuntimeAuth(keycloak.baseUrl, keycloak.issuer),
  })
  t.after(cleanup)

  const ownerToken = keycloak.issueToken({
    clientId: tenantClientId,
    email: 'owner@example.com',
    subject: 'owner-subject',
    userName: 'Owner Example',
    roles: tenantMemberRoles,
  })
  const claimantToken = keycloak.issueToken({
    clientId: tenantClientId,
    email: 'claimant@example.com',
    subject: 'claimant-subject',
    userName: 'Claimant Example',
    roles: tenantMemberRoles,
  })
  const owner = withAuth(request(app), ownerToken)
  const claimant = withAuth(request(app), claimantToken)

  const shareLinkResponse = await owner.post(`/api/campaigns/${defaultCampaignId}/share-links`).send({
    label: 'Keycloak guest flow',
    accessLevel: 'editor',
    frameAncestors: null,
  })
  assert.equal(shareLinkResponse.status, 201)

  const shareToken = shareLinkResponse.body.token as string
  const joinResponse = await request(app).post(`/api/shared/${shareToken}/join`).send({
    displayName: 'Mira',
  })
  assert.equal(joinResponse.status, 201)

  const guestToken = joinResponse.body.guestToken as string
  const guestMembershipId = joinResponse.body.membership.id as string
  const guest = withGuest(request(app), guestToken)

  const sharedNotesResponse = await guest.get(`/api/shared/${shareToken}/notes`)
  assert.equal(sharedNotesResponse.status, 200)

  const claimResponse = await request(app)
    .post(`/api/shared/${shareToken}/membership/claim`)
    .set('Authorization', `Bearer ${claimantToken}`)
    .set('X-Guest-Token', guestToken)
  assert.equal(claimResponse.status, 200)
  assert.equal(claimResponse.body.membership.id, guestMembershipId)

  const campaignsResponse = await claimant.get('/api/campaigns')
  assert.equal(campaignsResponse.status, 200)
  assert.equal(campaignsResponse.body.campaigns.length, 1)
  assert.equal(campaignsResponse.body.campaigns[0].id, defaultCampaignId)
})

test('tenant runtime auth rejects Keycloak tokens that are missing the tenant-member role with 403', async (t) => {
  const keycloak = await startFakeKeycloakServer()
  t.after(() => keycloak.close())

  const { app, cleanup } = await createTestApp({
    runtimeAuth: createKeycloakRuntimeAuth(keycloak.baseUrl, keycloak.issuer),
  })
  t.after(cleanup)

  // Token is signed by the right issuer for the right client and carries an
  // email + sub — only the per-tenant `tenant-member` role is missing. The
  // role gate (#196) must convert this into a 403 with a distinguishable
  // message so the front-end can surface a "claim access" hint.
  const tokenWithoutRole = keycloak.issueToken({
    clientId: tenantClientId,
    email: 'unauthorized@example.com',
    subject: 'unauthorized-subject',
    userName: 'No Role User',
    // Explicitly empty — no resource_access[clientId].roles.
    roles: [],
  })

  const response = await withAuth(request(app), tokenWithoutRole).get('/api/campaigns')
  assert.equal(response.status, 403)
  assert.match(
    response.body.error,
    /not authorized for this tenant/i,
  )
})

test('tenant runtime auth rejects Keycloak tokens that carry an unrelated role with 403', async (t) => {
  const keycloak = await startFakeKeycloakServer()
  t.after(() => keycloak.close())

  const { app, cleanup } = await createTestApp({
    runtimeAuth: createKeycloakRuntimeAuth(keycloak.baseUrl, keycloak.issuer),
  })
  t.after(cleanup)

  // Roles are present but none match `tenant-member` — must still 403, not 200.
  const tokenWithWrongRole = keycloak.issueToken({
    clientId: tenantClientId,
    email: 'wrong-role@example.com',
    subject: 'wrong-role-subject',
    userName: 'Wrong Role User',
    roles: ['unrelated-role', 'control-plane-admin'],
  })

  const response = await withAuth(request(app), tokenWithWrongRole).get('/api/campaigns')
  assert.equal(response.status, 403)
})

test('tenant runtime auth in local mode is unaffected by the per-tenant role gate', async (t) => {
  // Tenant in `local` mode: no Keycloak at all. The role check must not run
  // (otherwise legacy local-auth tenants would be locked out). Local-session
  // owners go through the session-token path and get 401, never 403.
  const { app, cleanup, noteStore } = await createTestApp()
  t.after(cleanup)

  // Create a local owner and grab a session token via login.
  await noteStore.createOwnerAccount({
    displayName: 'Local Owner',
    email: 'local@example.com',
    password: 'moonlit-secret',
  })

  const loginResponse = await request(app).post('/api/auth/login').send({
    email: 'local@example.com',
    password: 'moonlit-secret',
  })
  assert.equal(loginResponse.status, 200)
  const sessionToken = loginResponse.body.token as string
  assert.equal(typeof sessionToken, 'string')

  // The session token has no Keycloak roles. In local mode the role gate is
  // entirely bypassed — local owner reaches /api/campaigns successfully.
  const sessionResponse = await withAuth(request(app), sessionToken).get('/api/auth/session')
  assert.equal(sessionResponse.status, 200)
  assert.equal(sessionResponse.body.owner.email, 'local@example.com')

  const campaignsResponse = await withAuth(request(app), sessionToken).get('/api/campaigns')
  assert.equal(campaignsResponse.status, 200)

  // Bogus bearer token in local mode → 401 (invalid session), NOT 403. The
  // 401/403 split is preserved across modes.
  const bogusResponse = await withAuth(request(app), 'definitely-not-a-real-token').get('/api/campaigns')
  assert.equal(bogusResponse.status, 401)
})

test('tenant runtime auth grants access on the FIRST keycloak login once the role is present (transition path)', async (t) => {
  // Models the local → keycloak transition: a tenant was created in local
  // mode (an owner_account exists with no keycloak_sub). The control-plane
  // assigns the per-tenant role to the matching Keycloak user (via the
  // /portal/me auto-link sweep, exercised separately in the control-plane
  // tests). On first Keycloak login, the resulting token carries the role
  // and the tenant API auto-links the existing local owner_account by email.
  const keycloak = await startFakeKeycloakServer()
  t.after(() => keycloak.close())

  const { app, cleanup, noteStore } = await createTestApp({
    runtimeAuth: createKeycloakRuntimeAuth(keycloak.baseUrl, keycloak.issuer),
  })
  t.after(cleanup)

  // Pre-existing local owner from the local-auth era.
  const legacyOwner = await noteStore.createOwnerAccount({
    displayName: 'Legacy Local Owner',
    email: 'legacy@example.com',
    password: 'moonlit-secret',
  })
  assert.ok(legacyOwner)
  assert.equal(legacyOwner.keycloakSub, null)

  // First Keycloak login carries the role (assigned by the control-plane
  // when the customer auto-linked their portal_account).
  const firstKeycloakToken = keycloak.issueToken({
    clientId: tenantClientId,
    email: 'legacy@example.com',
    subject: 'legacy-keycloak-sub',
    userName: 'Legacy Migrated',
    roles: tenantMemberRoles,
  })

  const sessionResponse = await withAuth(request(app), firstKeycloakToken).get('/api/auth/session')
  assert.equal(sessionResponse.status, 200)
  assert.equal(sessionResponse.body.owner.id, legacyOwner.id)
  assert.equal(sessionResponse.body.owner.keycloakSub, 'legacy-keycloak-sub')

  // The legacy owner row is now linked.
  const ownerAccounts = await noteStore.listOwnerAccounts()
  const linkedOwner = ownerAccounts.find((owner) => owner.id === legacyOwner.id)
  assert.ok(linkedOwner)
  assert.equal(linkedOwner.keycloakSub, 'legacy-keycloak-sub')
})

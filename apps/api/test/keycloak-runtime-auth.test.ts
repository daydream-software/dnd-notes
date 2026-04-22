import assert from 'node:assert/strict'
import test from 'node:test'
import request from 'supertest'
import { defaultCampaignId } from '../src/campaign.js'
import { createTenantRuntimeAuth } from '../src/keycloak-auth.js'
import { createTestApp, withAuth, withGuest } from './test-helpers.js'
import fakeKeycloakModule from '../../../tests/fake-keycloak.js'

const tenantClientId = 'dnd-notes-tenant-app'
const controlPlaneClientId = 'dnd-notes-control-plane'
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
  })
  const claimantToken = keycloak.issueToken({
    clientId: tenantClientId,
    email: 'claimant@example.com',
    subject: 'claimant-subject',
    userName: 'Claimant Example',
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

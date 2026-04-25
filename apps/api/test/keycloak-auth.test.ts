import assert from 'node:assert/strict'
import test from 'node:test'
import request from 'supertest'
import { createTenantRuntimeAuth } from '../src/keycloak-auth.js'
import { createTestApp, withGuest } from './test-helpers.js'
import fakeKeycloakModule from '../../../tests/fake-keycloak.js'

const keycloakRealm = 'dnd-notes'
const keycloakClientId = 'dnd-notes-web'
const { startFakeKeycloakServer } = fakeKeycloakModule

function createRuntimeAuth(baseUrl: string, issuer: string) {
  return createTenantRuntimeAuth({
    mode: 'keycloak',
    keycloakUrl: baseUrl,
    keycloakRealm,
    clientId: keycloakClientId,
    issuer,
    jwksUrl: `${issuer}/protocol/openid-connect/certs`,
  })
}

test('GET /api/auth/config reports runtime Keycloak auth settings', async (t) => {
  const keycloak = await startFakeKeycloakServer(keycloakRealm)
  t.after(() => keycloak.close())

  const { app, cleanup } = await createTestApp({
    runtimeAuth: createRuntimeAuth(keycloak.baseUrl, keycloak.issuer),
  })
  t.after(cleanup)

  const [configResponse, loginResponse, registerResponse] = await Promise.all([
    request(app).get('/api/auth/config'),
    request(app).post('/api/auth/login').send({
      email: 'owner@example.com',
      password: 'password',
    }),
    request(app).post('/api/auth/register').send({
      displayName: 'Owner',
      email: 'owner@example.com',
      password: 'password',
    }),
  ])

  assert.equal(configResponse.status, 200)
  assert.deepEqual(configResponse.body, {
    mode: 'keycloak',
    keycloak: {
      url: keycloak.baseUrl,
      realm: keycloakRealm,
      clientId: keycloakClientId,
    },
  })
  assert.equal(loginResponse.status, 404)
  assert.equal(registerResponse.status, 404)
})

test('tenant routes accept Keycloak JWTs and keep share-link guest flows local', async (t) => {
  const keycloak = await startFakeKeycloakServer(keycloakRealm)
  t.after(() => keycloak.close())

  const runtimeAuth = createRuntimeAuth(keycloak.baseUrl, keycloak.issuer)
  const { app, cleanup } = await createTestApp({ runtimeAuth })
  t.after(cleanup)

  const ownerToken = keycloak.issueToken({
    audience: 'account',
    clientId: keycloakClientId,
    subject: 'tenant-owner-sub',
    email: 'owner@example.com',
    userName: 'Tenant Owner',
  })

  const sessionResponse = await request(app)
    .get('/api/auth/session')
    .set('Authorization', `Bearer ${ownerToken}`)
  assert.equal(sessionResponse.status, 200)
  assert.equal(sessionResponse.body.owner.email, 'owner@example.com')
  assert.equal(sessionResponse.body.owner.displayName, 'Tenant Owner')
  assert.equal(sessionResponse.body.owner.keycloakSub, 'tenant-owner-sub')

  const campaignsResponse = await request(app)
    .get('/api/campaigns')
    .set('Authorization', `Bearer ${ownerToken}`)
  assert.equal(campaignsResponse.status, 200)
  assert.equal(campaignsResponse.body.campaigns.length, 1)

  const defaultCampaignId = campaignsResponse.body.campaigns[0]?.id as string | undefined
  assert.equal(typeof defaultCampaignId, 'string')

  const shareLinkResponse = await request(app)
    .post(`/api/campaigns/${defaultCampaignId}/share-links`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      label: 'Keycloak guest share',
      accessLevel: 'editor',
      frameAncestors: null,
    })
  assert.equal(shareLinkResponse.status, 201)

  const guestJoinResponse = await request(app)
    .post(`/api/shared/${shareLinkResponse.body.token}/join`)
    .send({ displayName: 'Anonymous Guest' })
  assert.equal(guestJoinResponse.status, 201)
  assert.equal(guestJoinResponse.body.membership.userId, null)
  assert.equal(typeof guestJoinResponse.body.guestToken, 'string')

  const collaboratorToken = keycloak.issueToken({
    audience: 'account',
    clientId: keycloakClientId,
    subject: 'tenant-collaborator-sub',
    email: 'ally@example.com',
    userName: 'Campaign Ally',
  })
  const claimResponse = await request(app)
    .post(`/api/shared/${shareLinkResponse.body.token}/membership/claim`)
    .set('Authorization', `Bearer ${collaboratorToken}`)
    .set('X-Guest-Token', guestJoinResponse.body.guestToken)
  assert.equal(claimResponse.status, 200)
  assert.equal(typeof claimResponse.body.membership.userId, 'string')
  assert.equal(typeof claimResponse.body.guestToken, 'string')

  const sharedOverviewResponse = await withGuest(request(app), claimResponse.body.guestToken).get(
    `/api/shared/${shareLinkResponse.body.token}/overview`,
  )
  assert.equal(sharedOverviewResponse.status, 200)
  assert.equal(sharedOverviewResponse.body.campaign.id, defaultCampaignId)
})

test('tenant routes tolerate a small future nbf skew from Keycloak', async (t) => {
  const keycloak = await startFakeKeycloakServer(keycloakRealm)
  t.after(() => keycloak.close())

  const runtimeAuth = createRuntimeAuth(keycloak.baseUrl, keycloak.issuer)
  const { app, cleanup } = await createTestApp({ runtimeAuth })
  t.after(cleanup)

  const ownerToken = keycloak.issueToken({
    audience: 'account',
    clientId: keycloakClientId,
    subject: 'tenant-owner-sub',
    email: 'owner@example.com',
    userName: 'Tenant Owner',
    notBeforeOffsetSeconds: 5,
  })

  const response = await request(app)
    .get('/api/auth/session')
    .set('Authorization', `Bearer ${ownerToken}`)

  assert.equal(response.status, 200)
  assert.equal(response.body.owner.email, 'owner@example.com')
})

test('tenant routes reject invalid Keycloak JWTs', async (t) => {
  const keycloak = await startFakeKeycloakServer(keycloakRealm)
  t.after(() => keycloak.close())

  const runtimeAuth = createRuntimeAuth(keycloak.baseUrl, keycloak.issuer)
  const { app, cleanup } = await createTestApp({ runtimeAuth })
  t.after(cleanup)

  const foreignAudienceToken = keycloak.issueToken({
    clientId: keycloakClientId,
    audience: 'different-client',
    azp: 'different-client',
  })
  const response = await request(app)
    .get('/api/auth/session')
    .set('Authorization', `Bearer ${foreignAudienceToken}`)

  assert.equal(response.status, 401)
  assert.equal(response.body.error, 'Owner access token is invalid or expired.')
})

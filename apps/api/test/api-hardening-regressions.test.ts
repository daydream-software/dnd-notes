import assert from 'node:assert/strict'
import test from 'node:test'
import request from 'supertest'
import { defaultCampaignId } from '../src/campaign.js'
import { createTestApp, registerOwner, withAuth, withGuest } from './test-helpers.js'

test('API Hardening: CORS policy enforces origin allowlist', async () => {
  const { app, cleanup } = await createTestApp()

  try {
    const allowedResponse = await request(app)
      .get('/health')
      .set('Origin', 'http://localhost:5173')

    assert.equal(allowedResponse.status, 200)
    assert.equal(
      allowedResponse.headers['access-control-allow-origin'],
      'http://localhost:5173',
    )

    const anotherAllowedResponse = await request(app)
      .get('/health')
      .set('Origin', 'http://localhost:3000')

    assert.equal(anotherAllowedResponse.status, 200)
    assert.equal(
      anotherAllowedResponse.headers['access-control-allow-origin'],
      'http://localhost:3000',
    )

    const noOriginResponse = await request(app).get('/health')

    assert.equal(noOriginResponse.status, 200)

    const disallowedResponse = await request(app)
      .options('/health')
      .set('Origin', 'https://evil.example.com')
      .set('Access-Control-Request-Method', 'GET')

    assert.equal(
      disallowedResponse.headers['access-control-allow-origin'],
      undefined,
    )
  } finally {
    await cleanup()
  }
})

test('API Hardening: Security headers are present on all responses', async () => {
  const { app, cleanup } = await createTestApp()

  try {
    const response = await request(app).get('/health')

    assert.equal(response.status, 200)
    assert.equal(response.headers['x-content-type-options'], 'nosniff')
    assert.equal(response.headers['x-frame-options'], 'DENY')
    assert.equal(response.headers['x-xss-protection'], '1; mode=block')
    assert.equal(
      response.headers['referrer-policy'],
      'strict-origin-when-cross-origin',
    )
  } finally {
    await cleanup()
  }
})

test('API Hardening: Shared routes override X-Frame-Options with CSP', async () => {
  const { app, cleanup, issueToken } = await createTestApp()

  try {
    const owner = await registerOwner(request(app), issueToken!)
    const shareLinkResponse = await withAuth(request(app), owner.token)
      .post(`/api/campaigns/${defaultCampaignId}/share-links`)
      .send({
        accessLevel: 'viewer',
        frameAncestors: "'self' https://trusted.example.com",
      })

    assert.equal(shareLinkResponse.status, 201)
    const shareToken = shareLinkResponse.body.token

    const joinResponse = await request(app)
      .post(`/api/shared/${shareToken}/join`)
      .send({ displayName: 'Guest User' })

    assert.equal(joinResponse.status, 201)
    const guestToken = joinResponse.body.guestToken

    const overviewResponse = await withGuest(request(app), guestToken).get(
      `/api/shared/${shareToken}/overview`,
    )

    assert.equal(overviewResponse.status, 200)
    assert.ok(overviewResponse.headers['content-security-policy'])
    assert.ok(
      overviewResponse.headers['content-security-policy'].includes(
        "frame-ancestors 'self' https://trusted.example.com",
      ),
    )
    assert.equal(overviewResponse.headers['x-frame-options'], undefined)
  } finally {
    await cleanup()
  }
})

test('API Hardening: Auth flows work unchanged with new CORS config', async () => {
  const { app, cleanup, issueToken } = await createTestApp()

  try {
    const configResponse = await request(app)
      .get('/api/auth/config')
      .set('Origin', 'http://localhost:5173')

    assert.equal(configResponse.status, 200)
    assert.ok(configResponse.body.keycloak)

    const { token } = await registerOwner(request(app), issueToken!, {
      email: 'test@example.com',
      displayName: 'Test User',
    })

    const sessionResponse = await request(app)
      .get('/api/auth/session')
      .set('Authorization', `Bearer ${token}`)
      .set('Origin', 'http://localhost:5173')

    assert.equal(sessionResponse.status, 200)
    assert.equal(sessionResponse.body.owner.email, 'test@example.com')

    assert.equal(
      configResponse.headers['access-control-allow-origin'],
      'http://localhost:5173',
    )
    assert.equal(
      sessionResponse.headers['access-control-allow-origin'],
      'http://localhost:5173',
    )
  } finally {
    await cleanup()
  }
})

test('API Hardening: Guest auth flows work unchanged with new CORS config', async () => {
  const { app, cleanup, issueToken } = await createTestApp()

  try {
    const owner = await registerOwner(request(app), issueToken!)
    const shareLinkResponse = await withAuth(request(app), owner.token)
      .post(`/api/campaigns/${defaultCampaignId}/share-links`)
      .send({
        accessLevel: 'editor',
        frameAncestors: "'self'",
      })

    assert.equal(shareLinkResponse.status, 201)
    const shareToken = shareLinkResponse.body.token

    const joinResponse = await request(app)
      .post(`/api/shared/${shareToken}/join`)
      .set('Origin', 'http://localhost:5173')
      .send({ displayName: 'Guest User' })

    assert.equal(joinResponse.status, 201)
    assert.ok(joinResponse.body.guestToken)

    const guestToken = joinResponse.body.guestToken

    const sessionResponse = await request(app)
      .get(`/api/shared/${shareToken}/session`)
      .set('X-Guest-Token', guestToken)
      .set('Origin', 'http://localhost:5173')

    assert.equal(sessionResponse.status, 200)
    assert.equal(sessionResponse.body.membership.displayName, 'Guest User')

    const createNoteResponse = await request(app)
      .post(`/api/shared/${shareToken}/notes`)
      .set('X-Guest-Token', guestToken)
      .set('Origin', 'http://localhost:5173')
      .send({
        title: 'Guest Note',
        body: 'Created by guest',
        tags: [],
        status: 'draft',
      })

    assert.equal(createNoteResponse.status, 201)

    assert.equal(
      joinResponse.headers['access-control-allow-origin'],
      'http://localhost:5173',
    )
    assert.equal(
      sessionResponse.headers['access-control-allow-origin'],
      'http://localhost:5173',
    )
    assert.equal(
      createNoteResponse.headers['access-control-allow-origin'],
      'http://localhost:5173',
    )
  } finally {
    await cleanup()
  }
})

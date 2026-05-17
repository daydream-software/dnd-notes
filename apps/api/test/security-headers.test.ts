import assert from 'node:assert/strict'
import test from 'node:test'
import request from 'supertest'
import { defaultCampaignId } from '../src/campaign.js'
import {
  createTestApp as createSharedTestApp,
  registerOwner,
  withAuth,
  withGuest,
} from './test-helpers.js'

/**
 * Regression tests for CORS and security header hardening.
 * 
 * Context:
 * - Current state: `app.use(cors())` is permissive (allows all origins)
 * - CSP frame-ancestors is set per share-link configuration
 * - Auth transport uses Bearer tokens in Authorization header (not cookies)
 * - Guest tokens use X-Guest-Token header
 * 
 * Goals:
 * 1. Preserve owner auth flow (Bearer token)
 * 2. Preserve guest shared-link auth flow (X-Guest-Token)
 * 3. Preserve site-admin access
 * 4. Ensure frame-ancestors is correctly applied for /share routes
 * 5. Prepare for future CORS origin whitelisting without breaking existing flows
 */

const defaultSecurityTestOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://example.com',
  'http://guest-origin.com',
  'http://admin-dashboard.com',
  'http://malicious-site.com',
  'http://monitoring-tool.com',
]

async function createTestApp(
  options: {
    siteAdminEmails?: readonly string[]
    publicWebUrl?: string
    allowedOrigins?: readonly string[]
  } = {},
) {
  return createSharedTestApp({
    siteAdminEmails: options.siteAdminEmails,
    publicWebUrl: options.publicWebUrl,
    allowedOrigins: options.allowedOrigins ?? defaultSecurityTestOrigins,
  })
}

test('CORS headers are present and permissive for authenticated requests', async () => {
  const { app, cleanup, issueToken } = await createTestApp({
    allowedOrigins: ['http://example.com'],
  })

  try {
    const agent = request(app)
    const { token } = await registerOwner(agent, issueToken!)

    // OPTIONS preflight request (simulating CORS preflight)
    const preflightResponse = await agent
      .options('/api/campaigns')
      .set('Origin', 'http://example.com')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization')

    // Should allow whitelisted origins
    assert.equal(preflightResponse.status, 204)
    assert.equal(preflightResponse.get('Access-Control-Allow-Origin'), 'http://example.com')
    assert.match(
      preflightResponse.get('Access-Control-Allow-Methods') ?? '',
      /GET/,
    )

    // Actual authenticated request from cross-origin
    const authedResponse = await withAuth(agent, token)
      .get('/api/campaigns')
      .set('Origin', 'http://example.com')

    assert.equal(authedResponse.status, 200)
    assert.equal(authedResponse.get('Access-Control-Allow-Origin'), 'http://example.com')
  } finally {
    await cleanup()
  }
})

test('CORS headers are present for guest shared-link requests', async () => {
  const { app, cleanup, issueToken } = await createTestApp({
    allowedOrigins: ['http://guest-origin.com'],
  })

  try {
    const agent = request(app)
    const { token } = await registerOwner(agent, issueToken!)

    // Create a share link
    const createShareLinkResponse = await withAuth(agent, token)
      .post(`/api/campaigns/${defaultCampaignId}/share-links`)
      .send({ accessLevel: 'editor' })

    assert.equal(createShareLinkResponse.status, 201)
    const shareToken = createShareLinkResponse.body.token

    // Join as guest
    const joinResponse = await agent
      .post(`/api/shared/${shareToken}/join`)
      .set('Origin', 'http://guest-origin.com')
      .send({ displayName: 'Guest User' })

    assert.equal(joinResponse.status, 201)
    assert.equal(joinResponse.get('Access-Control-Allow-Origin'), 'http://guest-origin.com')

    const guestToken = joinResponse.body.guestToken

    // Guest accesses shared campaign from cross-origin
    const guestOverviewResponse = await withGuest(agent, guestToken)
      .get(`/api/shared/${shareToken}/overview`)
      .set('Origin', 'http://guest-origin.com')

    assert.equal(guestOverviewResponse.status, 200)
    assert.equal(guestOverviewResponse.get('Access-Control-Allow-Origin'), 'http://guest-origin.com')
  } finally {
    await cleanup()
  }
})

test('CSP frame-ancestors header is applied for shared-link session endpoint', async () => {
  const { app, cleanup, issueToken } = await createTestApp()

  try {
    const agent = request(app)
    const { token } = await registerOwner(agent, issueToken!)

    // Create a share link with frame-ancestors
    const createShareLinkResponse = await withAuth(agent, token)
      .post(`/api/campaigns/${defaultCampaignId}/share-links`)
      .send({
        accessLevel: 'editor',
        frameAncestors: 'https://trusted-embedder.com',
      })

    assert.equal(createShareLinkResponse.status, 201)
    const shareToken = createShareLinkResponse.body.token

    // Check session endpoint for CSP header
    const sessionResponse = await agent
      .get(`/api/shared/${shareToken}/session`)

    assert.equal(sessionResponse.status, 200)
    assert.match(
      sessionResponse.get('Content-Security-Policy') ?? '',
      /frame-ancestors https:\/\/trusted-embedder\.com/,
    )
  } finally {
    await cleanup()
  }
})

test('CSP frame-ancestors defaults to none when not specified', async () => {
  const { app, cleanup, issueToken } = await createTestApp()

  try {
    const agent = request(app)
    const { token } = await registerOwner(agent, issueToken!)

    // Create a share link without frame-ancestors
    const createShareLinkResponse = await withAuth(agent, token)
      .post(`/api/campaigns/${defaultCampaignId}/share-links`)
      .send({ accessLevel: 'editor' })

    assert.equal(createShareLinkResponse.status, 201)
    const shareToken = createShareLinkResponse.body.token

    // Check session endpoint for default CSP header
    const sessionResponse = await agent
      .get(`/api/shared/${shareToken}/session`)

    assert.equal(sessionResponse.status, 200)
    assert.match(
      sessionResponse.get('Content-Security-Policy') ?? '',
      /frame-ancestors 'none'/,
    )
  } finally {
    await cleanup()
  }
})

test('site admin access works with CORS headers', async () => {
  const { app, cleanup, issueToken } = await createTestApp({
    siteAdminEmails: ['admin@example.com'],
    allowedOrigins: ['http://admin-dashboard.com'],
  })

  try {
    const agent = request(app)
    const { token } = await registerOwner(agent, issueToken!, {
      email: 'admin@example.com',
      displayName: 'Admin User',
    })

    // Admin requests from cross-origin
    const adminAccountsResponse = await withAuth(agent, token)
      .get('/api/admin/accounts')
      .set('Origin', 'http://admin-dashboard.com')

    assert.equal(adminAccountsResponse.status, 200)
    assert.equal(adminAccountsResponse.get('Access-Control-Allow-Origin'), 'http://admin-dashboard.com')

    const adminOverviewResponse = await withAuth(agent, token)
      .get('/api/admin/overview')
      .set('Origin', 'http://admin-dashboard.com')

    assert.equal(adminOverviewResponse.status, 200)
    assert.equal(adminOverviewResponse.get('Access-Control-Allow-Origin'), 'http://admin-dashboard.com')
  } finally {
    await cleanup()
  }
})

test('unauthenticated requests for protected routes fail gracefully with CORS', async () => {
  const { app, cleanup, issueToken } = await createTestApp({
    allowedOrigins: ['http://malicious-site.com'],
  })

  try {
    const agent = request(app)
    // Unauthenticated request to protected route from cross-origin
    const unauthedResponse = await agent
      .get('/api/campaigns')
      .set('Origin', 'http://malicious-site.com')

    assert.equal(unauthedResponse.status, 401)
    // CORS headers should still be present (browser enforces this before status check)
    assert.equal(unauthedResponse.get('Access-Control-Allow-Origin'), 'http://malicious-site.com')
  } finally {
    await cleanup()
  }
})

test('public health endpoint returns CORS headers', async () => {
  const { app, cleanup, issueToken } = await createTestApp({
    allowedOrigins: ['http://monitoring-tool.com'],
  })

  try {
    const agent = request(app)
    const healthResponse = await agent
      .get('/health')
      .set('Origin', 'http://monitoring-tool.com')

    assert.equal(healthResponse.status, 200)
    assert.equal(healthResponse.get('Access-Control-Allow-Origin'), 'http://monitoring-tool.com')
  } finally {
    await cleanup()
  }
})

test('guest cannot access owner-only routes even with CORS', async () => {
  const { app, cleanup, issueToken } = await createTestApp({
    allowedOrigins: ['http://guest-origin.com'],
  })

  try {
    const agent = request(app)
    const { token } = await registerOwner(agent, issueToken!)

    // Create a share link and join as guest
    const createShareLinkResponse = await withAuth(agent, token)
      .post(`/api/campaigns/${defaultCampaignId}/share-links`)
      .send({ accessLevel: 'editor' })

    assert.equal(createShareLinkResponse.status, 201)
    const shareToken = createShareLinkResponse.body.token

    const joinResponse = await agent
      .post(`/api/shared/${shareToken}/join`)
      .send({ displayName: 'Guest User' })

    assert.equal(joinResponse.status, 201)
    const guestToken = joinResponse.body.guestToken

    // Guest attempts to access owner-only route
    const guestAttemptResponse = await withGuest(agent, guestToken)
      .get('/api/campaigns')
      .set('Origin', 'http://guest-origin.com')

    // Should be 401 (guest tokens don't authenticate for owner routes)
    assert.equal(guestAttemptResponse.status, 401)
    // CORS headers should still be present
    assert.equal(guestAttemptResponse.get('Access-Control-Allow-Origin'), 'http://guest-origin.com')
  } finally {
    await cleanup()
  }
})

test('CSP frame-ancestors is applied to all shared session endpoints', async () => {
  const { app, cleanup, issueToken } = await createTestApp({
    allowedOrigins: ['http://test-origin.com'],
  })

  try {
    const agent = request(app)
    const { token } = await registerOwner(agent, issueToken!)

    // Create a share link with specific frame-ancestors
    const createShareLinkResponse = await withAuth(agent, token)
      .post(`/api/campaigns/${defaultCampaignId}/share-links`)
      .send({
        accessLevel: 'editor',
        frameAncestors: 'https://embedder-a.com https://embedder-b.com',
      })

    assert.equal(createShareLinkResponse.status, 201)
    const shareToken = createShareLinkResponse.body.token

    // Join as guest to get guest token
    const joinResponse = await agent
      .post(`/api/shared/${shareToken}/join`)
      .send({ displayName: 'Test Guest' })

    assert.equal(joinResponse.status, 201)
    const guestToken = joinResponse.body.guestToken

    const guest = withGuest(agent, guestToken)

    // Check frame-ancestors on various shared endpoints
    const endpoints = [
      `/api/shared/${shareToken}/session`,
      `/api/shared/${shareToken}/overview`,
      `/api/shared/${shareToken}/notes`,
    ]

    for (const endpoint of endpoints) {
      const response = await guest.get(endpoint)
      assert.equal(response.status, 200, `Endpoint ${endpoint} should return 200`)
      const cspHeader = response.get('Content-Security-Policy')
      assert.ok(cspHeader, `Endpoint ${endpoint} should have CSP header`)
      assert.match(
        cspHeader,
        /frame-ancestors https:\/\/embedder-a\.com https:\/\/embedder-b\.com/,
        `Endpoint ${endpoint} should have correct frame-ancestors`,
      )
    }
  } finally {
    await cleanup()
  }
})

test('OPTIONS preflight requests for share-link routes include CORS headers', async () => {
  const { app, cleanup, issueToken } = await createTestApp({
    allowedOrigins: ['http://example.com'],
  })

  try {
    const agent = request(app)
    const { token } = await registerOwner(agent, issueToken!)

    const createShareLinkResponse = await withAuth(agent, token)
      .post(`/api/campaigns/${defaultCampaignId}/share-links`)
      .send({ accessLevel: 'editor' })

    assert.equal(createShareLinkResponse.status, 201)
    const shareToken = createShareLinkResponse.body.token

    // OPTIONS preflight for share-link join
    const preflightResponse = await agent
      .options(`/api/shared/${shareToken}/join`)
      .set('Origin', 'http://example.com')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type')

    assert.equal(preflightResponse.status, 204)
    assert.equal(preflightResponse.get('Access-Control-Allow-Origin'), 'http://example.com')
    assert.match(
      preflightResponse.get('Access-Control-Allow-Methods') ?? '',
      /POST/,
    )
  } finally {
    await cleanup()
  }
})

test('CORS rejects non-whitelisted origins', async () => {
  const { app, cleanup, issueToken } = await createTestApp({
    allowedOrigins: ['http://allowed-origin.com'],
  })

  try {
    const agent = request(app)
    
    // Request from non-whitelisted origin should fail
    const response = await agent
      .get('/health')
      .set('Origin', 'http://evil-site.com')
    
    // CORS middleware should reject this
    assert.equal(response.status, 500)
    // Error text should indicate CORS rejection
    assert.match(response.text, /CORS policy/)
  } finally {
    await cleanup()
  }
})

test('requests without origin header are allowed (mobile apps, curl, Postman)', async () => {
  const { app, cleanup, issueToken } = await createTestApp({
    allowedOrigins: ['http://allowed-origin.com'],
  })

  try {
    const agent = request(app)
    const { token } = await registerOwner(agent, issueToken!)
    
    // Request without origin should be allowed (no Origin header = non-browser client)
    const response = await withAuth(agent, token)
      .get('/api/campaigns')
    
    assert.equal(response.status, 200)
  } finally {
    await cleanup()
  }
})

test('security headers are applied to all responses', async () => {
  const { app, cleanup, issueToken } = await createTestApp()

  try {
    const agent = request(app)
    const { token } = await registerOwner(agent, issueToken!)
    
    const response = await withAuth(agent, token)
      .get('/api/campaigns')
    
    assert.equal(response.status, 200)
    
    // Check for security headers
    assert.equal(response.get('X-Content-Type-Options'), 'nosniff')
    assert.equal(response.get('X-Frame-Options'), 'DENY')
    assert.equal(response.get('X-XSS-Protection'), '1; mode=block')
    assert.equal(response.get('Referrer-Policy'), 'strict-origin-when-cross-origin')
  } finally {
    await cleanup()
  }
})

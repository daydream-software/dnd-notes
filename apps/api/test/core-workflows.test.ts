import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { defaultCampaignId } from '../src/campaign.js'
import {
  createTestApp,
  registerOwner,
  withAuth,
} from './test-helpers.js'

const testFixtureWebDistPath = join(
  fileURLToPath(new URL('.', import.meta.url)),
  'fixtures',
  'web-dist',
)

test('GET /health returns service metadata', async (t) => {
  const { app, cleanup, issueToken } = await createTestApp()
  t.after(cleanup)

  const response = await request(app).get('/health')

  assert.equal(response.status, 200)
  assert.equal(response.body.status, 'ok')
  assert.equal(response.body.service, 'dnd-notes-api')
})

test('GET /healthz, /ready, and /readyz return probe metadata while the database is available', async (t) => {
  const { app, cleanup, issueToken } = await createTestApp()
  t.after(cleanup)

  const [livenessResponse, readyResponse, readinessResponse] = await Promise.all([
    request(app).get('/healthz'),
    request(app).get('/ready'),
    request(app).get('/readyz'),
  ])

  assert.equal(livenessResponse.status, 200)
  assert.deepEqual(livenessResponse.body, {
    status: 'ok',
    service: 'dnd-notes-api',
  })
  assert.equal(readyResponse.status, 200)
  assert.deepEqual(readyResponse.body, {
    status: 'ok',
    service: 'dnd-notes-api',
  })
  assert.equal(readinessResponse.status, 200)
  assert.deepEqual(readinessResponse.body, {
    status: 'ok',
    service: 'dnd-notes-api',
  })
})

test('GET /readyz returns 503 when the database is unavailable', async (t) => {
  const { app, cleanup, noteStore, issueToken } = await createTestApp()
  t.after(cleanup)

  const originalCheckHealth = noteStore.checkHealth
  noteStore.checkHealth = async () => {
    throw new Error('Database unavailable')
  }
  t.after(() => {
    noteStore.checkHealth = originalCheckHealth
  })

  const response = await request(app).get('/readyz')

  assert.equal(response.status, 503)
  assert.deepEqual(response.body, { error: 'Database unavailable' })
})

test('GET /readyz returns 503 while the server is shutting down', async (t) => {
  let shuttingDown = false
  const { app, cleanup, issueToken } = await createTestApp({
    isShuttingDown: () => shuttingDown,
  })
  t.after(cleanup)

  shuttingDown = true

  const response = await request(app).get('/readyz')

  assert.equal(response.status, 503)
  assert.deepEqual(response.body, { error: 'Shutting down' })
})

test('SERVE_WEB fallback only serves HTML navigation requests', async (t) => {
  const { app, cleanup, issueToken } = await createTestApp({
    serveWeb: true,
    webDistPath: testFixtureWebDistPath,
  })
  t.after(cleanup)

  const [navigationResponse, assetResponse, jsonResponse, apiRootResponse] = await Promise.all([
    request(app).get('/campaigns/demo').set('Accept', 'text/html'),
    request(app).get('/assets/missing.js').set('Accept', '*/*'),
    request(app).get('/missing-route').set('Accept', 'application/json'),
    request(app).get('/api').set('Accept', 'text/html'),
  ])

  assert.equal(navigationResponse.status, 200)
  assert.match(navigationResponse.text, /Fixture dnd-notes app/)

  assert.equal(assetResponse.status, 404)
  assert.doesNotMatch(assetResponse.text, /Fixture dnd-notes app/)

  assert.equal(jsonResponse.status, 404)
  assert.doesNotMatch(jsonResponse.text, /Fixture dnd-notes app/)

  assert.equal(apiRootResponse.status, 404)
  assert.doesNotMatch(apiRootResponse.text, /Fixture dnd-notes app/)
})

test('site admins can read admin overview metrics and non-admins cannot', async (t) => {
  const { app, cleanup, issueToken } = await createTestApp({
    siteAdminEmails: ['site-admin@example.com'],
  })
  t.after(cleanup)

  const nonAdmin = await registerOwner(request(app), issueToken!, {
    email: 'observer@example.com',
  })
  const nonAdminOverviewResponse = await withAuth(request(app), nonAdmin.token).get(
    '/api/admin/overview',
  )
  assert.equal(nonAdminOverviewResponse.status, 403)
  assert.equal(nonAdminOverviewResponse.body.error, 'Site-admin access is required.')

  const siteAdmin = await registerOwner(request(app), issueToken!, {
    displayName: 'Site Admin',
    email: 'site-admin@example.com',
  })

  const siteAdminAuthed = withAuth(request(app), siteAdmin.token)
  const createdCampaignResponse = await siteAdminAuthed.post('/api/campaigns').send({
    name: 'Observability Test Campaign',
    tagline: 'Track admin overview counts.',
    system: 'Dungeons & Dragons 2024',
    setting: 'Waterdeep',
    nextSession: null,
  })
  assert.equal(createdCampaignResponse.status, 201)

  const createdCampaignId = createdCampaignResponse.body.campaign.id as string
  const shareLinkResponse = await siteAdminAuthed
    .post(`/api/campaigns/${createdCampaignId}/share-links`)
    .send({
      label: 'Overview link',
      accessLevel: 'editor',
      frameAncestors: null,
    })
  assert.equal(shareLinkResponse.status, 201)

  const noteResponse = await siteAdminAuthed.post('/api/notes').send({
    campaignId: createdCampaignId,
    title: 'Observability note',
    body: 'Used to make admin metrics non-zero.',
    tags: ['admin'],
    status: 'active',
    sessionName: null,
  })
  assert.equal(noteResponse.status, 201)

  const overviewResponse = await siteAdminAuthed.get('/api/admin/overview')
  assert.equal(overviewResponse.status, 200)
  assert.match(overviewResponse.body.overview.generatedAt, /^\d{4}-\d{2}-\d{2}T/)
  assert.equal(overviewResponse.body.overview.accounts.total, 2)
  assert.equal(overviewResponse.body.overview.accounts.siteAdmins, 1)
  assert.equal(overviewResponse.body.overview.campaigns.total, 2)
  assert.equal(overviewResponse.body.overview.campaigns.archived, 0)
  assert.equal(overviewResponse.body.overview.memberships.total, 2)
  assert.equal(overviewResponse.body.overview.memberships.linkedAccounts, 2)
  assert.equal(overviewResponse.body.overview.memberships.guests, 0)
  assert.equal(overviewResponse.body.overview.shareLinks.active, 1)
  assert.equal(overviewResponse.body.overview.shareLinks.revoked, 0)
  assert.equal(overviewResponse.body.overview.notes.total, 1)
  assert.equal(overviewResponse.body.overview.notes.draft, 0)
  assert.equal(overviewResponse.body.overview.notes.active, 1)
  assert.equal(overviewResponse.body.overview.notes.archived, 0)
})

test('site admins can read the admin account directory and non-admins cannot', async (t) => {
  const { app, cleanup, issueToken } = await createTestApp({
    siteAdminEmails: ['site-admin@example.com'],
  })
  t.after(cleanup)

  const nonAdmin = await registerOwner(request(app), issueToken!, {
    displayName: 'Observer',
    email: 'observer@example.com',
  })
  const nonAdminDirectoryResponse = await withAuth(request(app), nonAdmin.token).get(
    '/api/admin/accounts',
  )
  assert.equal(nonAdminDirectoryResponse.status, 403)
  assert.equal(nonAdminDirectoryResponse.body.error, 'Site-admin access is required.')

  const siteAdmin = await registerOwner(request(app), issueToken!, {
    displayName: 'Site Admin',
    email: 'site-admin@example.com',
  })
  const siteAdminAuthed = withAuth(request(app), siteAdmin.token)
  const createdCampaignResponse = await siteAdminAuthed.post('/api/campaigns').send({
    name: 'Admin Directory Campaign',
    tagline: 'Created to verify account ownership counts.',
    system: 'Dungeons & Dragons 2024',
    setting: 'Neverwinter',
    nextSession: null,
  })
  assert.equal(createdCampaignResponse.status, 201)

  const directoryResponse = await siteAdminAuthed.get('/api/admin/accounts')
  assert.equal(directoryResponse.status, 200)
  assert.equal(directoryResponse.body.accounts.length, 2)
  assert.equal(directoryResponse.body.accounts[0].email, 'site-admin@example.com')
  assert.equal(directoryResponse.body.accounts[0].isSiteAdmin, true)
  assert.equal(directoryResponse.body.accounts[0].ownedCampaignCount, 1)
  assert.equal(directoryResponse.body.accounts[0].campaignMembershipCount, 1)
  assert.equal(directoryResponse.body.accounts[1].email, 'observer@example.com')
  assert.equal(directoryResponse.body.accounts[1].isSiteAdmin, false)
})

test('owner auth and campaign endpoints support the management workflow', async (t) => {
  const { app, cleanup, issueToken } = await createTestApp({
    publicWebUrl: 'https://notes.example.com',
  })
  t.after(cleanup)

  const unauthenticatedListResponse = await request(app).get('/api/campaigns')
  assert.equal(unauthenticatedListResponse.status, 401)

  const { token, owner, payload } = await registerOwner(request(app), issueToken!)
  const authed = withAuth(request(app), token)

  const sessionResponse = await authed.get('/api/auth/session')
  assert.equal(sessionResponse.status, 200)
  assert.equal(sessionResponse.body.owner.email, payload.email)
  assert.equal(sessionResponse.body.owner.isSiteAdmin, false)

  const campaignsResponse = await authed.get('/api/campaigns')
  assert.equal(campaignsResponse.status, 200)
  assert.equal(campaignsResponse.body.campaigns.length, 1)
  assert.equal(campaignsResponse.body.campaigns[0].id, defaultCampaignId)

  const membershipsResponse = await authed.get(
    `/api/campaigns/${defaultCampaignId}/memberships`,
  )
  assert.equal(membershipsResponse.status, 200)
  assert.equal(membershipsResponse.body.memberships.length, 1)
  assert.equal(membershipsResponse.body.memberships[0].role, 'owner')
  assert.equal(membershipsResponse.body.memberships[0].userId, owner.id)
  assert.equal(membershipsResponse.body.memberships[0].displayName, payload.displayName)

  const createDefaultShareLinkResponse = await authed
    .post(`/api/campaigns/${defaultCampaignId}/share-links`)
    .send({
      label: 'VTT link',
      accessLevel: 'editor',
      frameAncestors: 'https://owlbear.app https://roll20.net',
    })
  assert.equal(createDefaultShareLinkResponse.status, 201)
  assert.equal(createDefaultShareLinkResponse.body.shareLink.label, 'VTT link')
  assert.equal(createDefaultShareLinkResponse.body.shareLink.accessLevel, 'editor')
  assert.equal(
    createDefaultShareLinkResponse.body.url,
    `https://notes.example.com/share/${createDefaultShareLinkResponse.body.token}`,
  )

  const revealDefaultShareLinkResponse = await authed.get(
    `/api/campaigns/${defaultCampaignId}/share-links/${createDefaultShareLinkResponse.body.shareLink.id}`,
  )
  assert.equal(revealDefaultShareLinkResponse.status, 200)
  assert.equal(revealDefaultShareLinkResponse.body.token, createDefaultShareLinkResponse.body.token)
  assert.equal(
    revealDefaultShareLinkResponse.body.url,
    `https://notes.example.com/share/${createDefaultShareLinkResponse.body.token}`,
  )

  const createCampaignResponse = await authed.post('/api/campaigns').send({
    name: 'Emberfall Accord',
    tagline: 'Track alliances, betrayals, and faction leverage across the city.',
    system: 'Dungeons & Dragons 2024',
    setting: 'Emberfall',
    nextSession: '2026-05-01T19:30:00.000Z',
  })

  assert.equal(createCampaignResponse.status, 201)
  assert.equal(createCampaignResponse.body.campaign.name, 'Emberfall Accord')

  const campaignId = createCampaignResponse.body.campaign.id as string

  const updateCampaignResponse = await authed
    .put(`/api/campaigns/${campaignId}`)
    .send({
      name: 'Emberfall Accord Revised',
      tagline: 'Track alliances, betrayals, and leverage inside Emberfall.',
      system: 'Dungeons & Dragons 2024',
      setting: 'Emberfall',
      nextSession: null,
    })

  assert.equal(updateCampaignResponse.status, 200)
  assert.equal(updateCampaignResponse.body.campaign.name, 'Emberfall Accord Revised')
  assert.equal(updateCampaignResponse.body.campaign.nextSession, null)

  const createdCampaignMembershipsResponse = await authed.get(
    `/api/campaigns/${campaignId}/memberships`,
  )
  assert.equal(createdCampaignMembershipsResponse.status, 200)
  assert.equal(createdCampaignMembershipsResponse.body.memberships[0].userId, owner.id)

  const createShareLinkResponse = await authed
    .post(`/api/campaigns/${campaignId}/share-links`)
    .send({
      label: 'Read-only table view',
      accessLevel: 'viewer',
      frameAncestors: "'self'",
    })
  assert.equal(createShareLinkResponse.status, 201)

  const shareLinksResponse = await authed.get(`/api/campaigns/${campaignId}/share-links`)
  assert.equal(shareLinksResponse.status, 200)
  assert.equal(shareLinksResponse.body.shareLinks.length, 1)
  assert.equal(shareLinksResponse.body.shareLinks[0].label, 'Read-only table view')
  assert.equal(shareLinksResponse.body.shareLinks[0].token, undefined)
  assert.equal(shareLinksResponse.body.shareLinks[0].url, undefined)

  const revokeShareLinkResponse = await authed.delete(
    `/api/campaigns/${campaignId}/share-links/${createShareLinkResponse.body.shareLink.id}`,
  )
  assert.equal(revokeShareLinkResponse.status, 204)

  const shareLinksAfterRevokeResponse = await authed.get(
    `/api/campaigns/${campaignId}/share-links`,
  )
  assert.equal(shareLinksAfterRevokeResponse.status, 200)
  assert.equal(shareLinksAfterRevokeResponse.body.shareLinks.length, 0)

})

test('share link creation falls back to the request host when PUBLIC_WEB_URL is not configured', async (t) => {
  const { app, cleanup, issueToken } = await createTestApp()
  t.after(cleanup)

  const { token } = await registerOwner(request(app), issueToken!)
  const authed = withAuth(request(app), token)

  const createShareLinkResponse = await authed
    .post(`/api/campaigns/${defaultCampaignId}/share-links`)
    .set('Host', 'api.test.local:4010')
    .send({
      label: 'Fallback link',
      accessLevel: 'viewer',
      frameAncestors: null,
    })

  assert.equal(createShareLinkResponse.status, 201)
  assert.equal(
    createShareLinkResponse.body.url,
    `http://api.test.local:4010/share/${createShareLinkResponse.body.token}`,
  )

  const revealShareLinkResponse = await authed
    .get(`/api/campaigns/${defaultCampaignId}/share-links/${createShareLinkResponse.body.shareLink.id}`)
    .set('Host', 'api.test.local:4010')

  assert.equal(revealShareLinkResponse.status, 200)
  assert.equal(
    revealShareLinkResponse.body.url,
    `http://api.test.local:4010/share/${createShareLinkResponse.body.token}`,
  )
})

test('owner email lookups enforce unique lower(email) semantics', async (t) => {
  const { pool, cleanup } = await createTestApp()
  t.after(cleanup)

  await pool.query(
    `
      INSERT INTO owner_accounts (
        id,
        email,
        display_name,
        is_site_admin,
        keycloak_sub,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      'owner-one',
      'owner@example.com',
      'Owner One',
      0,
      null,
      '2026-04-24T00:00:00.000Z',
      '2026-04-24T00:00:00.000Z',
    ],
  )

  await assert.rejects(
    () =>
      pool.query(
        `
          INSERT INTO owner_accounts (
            id,
            email,
            display_name,
            is_site_admin,
            keycloak_sub,
            created_at,
            updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          'owner-two',
          'OWNER@example.com',
          'Owner Two',
          0,
          null,
          '2026-04-24T00:00:00.000Z',
          '2026-04-24T00:00:00.000Z',
        ],
      ),
    /duplicate|unique/i,
  )
})

test('authenticated owners can run the note CRUD workflow in a selected campaign', async (t) => {
  const { app, cleanup, issueToken } = await createTestApp()
  t.after(cleanup)

  const { token } = await registerOwner(request(app), issueToken!)
  const authed = withAuth(request(app), token)

  const createResponse = await authed.post('/api/notes').send({
    campaignId: defaultCampaignId,
    title: 'Track the stone circle',
    body: 'Investigate the runes before the next full moon.',
    tags: ['Mystery', 'Moonwell'],
    status: 'draft',
    sessionName: 'Session 12',
  })

  assert.equal(createResponse.status, 201)
  assert.equal(createResponse.body.note.title, 'Track the stone circle')
  assert.deepEqual(createResponse.body.note.tags, ['mystery', 'moonwell'])

  const noteId = createResponse.body.note.id as string

  const listResponse = await authed.get('/api/notes').query({ campaignId: defaultCampaignId })
  assert.equal(listResponse.status, 200)
  assert.equal(listResponse.body.notes.length, 1)

  const overviewResponse = await authed
    .get('/api/overview')
    .query({ campaignId: defaultCampaignId })
  assert.equal(overviewResponse.status, 200)
  assert.equal(overviewResponse.body.stats.totalNotes, 1)

  const updateResponse = await authed.put(`/api/notes/${noteId}`).send({
    title: 'Track the stone circle',
    body: 'The runes now point toward Moray and a hidden druid vault.',
    tags: ['moonwell'],
    status: 'active',
    sessionName: null,
  })

  assert.equal(updateResponse.status, 200)
  assert.equal(updateResponse.body.note.status, 'active')
  assert.equal(updateResponse.body.note.sessionName, null)

  const deleteResponse = await authed.delete(`/api/notes/${noteId}`)
  assert.equal(deleteResponse.status, 204)

  const finalListResponse = await authed
    .get('/api/notes')
    .query({ campaignId: defaultCampaignId })
  assert.equal(finalListResponse.body.notes.length, 0)
})

test('configured site-admin emails are promoted on first Keycloak auto-provisioning', async (t) => {
  const siteAdminEmail = 'admin@example.com'
  const { app, cleanup, issueToken } = await createTestApp({
    siteAdminEmails: [siteAdminEmail],
  })
  t.after(cleanup)

  const registration = await registerOwner(request(app), issueToken!, {
    displayName: 'Admin Aela',
    email: siteAdminEmail,
  })
  assert.equal(registration.owner.isSiteAdmin, true)

  const sessionResponse = await withAuth(request(app), registration.token).get('/api/auth/session')
  assert.equal(sessionResponse.status, 200)
  assert.equal(sessionResponse.body.owner.isSiteAdmin, true)
})

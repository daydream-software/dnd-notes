import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import request, { type SuperTest, type Test } from 'supertest'
import { createApp } from '../src/app.js'
import { defaultCampaignId } from '../src/campaign.js'
import { createNoteStore } from '../src/note-store.js'

async function createTestApp(options: { siteAdminEmails?: readonly string[] } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'dnd-notes-api-'))
  const dbPath = join(directory, 'notes.sqlite')
  const noteStore = createNoteStore({ dbPath, siteAdminEmails: options.siteAdminEmails })
  const app = createApp({ noteStore })

  return {
    app,
    noteStore,
    dbPath,
    async cleanup() {
      noteStore.close()
      await rm(directory, { recursive: true, force: true })
    },
  }
}

async function registerOwner(
  app: SuperTest<Test>,
  overrides: Partial<{
    displayName: string
    email: string
    password: string
  }> = {},
) {
  const payload = {
    displayName: overrides.displayName ?? 'Aela',
    email: overrides.email ?? 'aela@example.com',
    password: overrides.password ?? 'moonlit-secret',
  }

  const response = await app.post('/api/auth/register').send(payload)

  assert.equal(response.status, 201)

  return {
    token: response.body.token as string,
    owner: response.body.owner as {
      id: string
      email: string
      displayName: string
      isSiteAdmin: boolean
    },
    payload,
  }
}

function withAuth(app: SuperTest<Test>, token: string) {
  return {
    get(path: string) {
      return app.get(path).set('Authorization', `Bearer ${token}`)
    },
    post(path: string) {
      return app.post(path).set('Authorization', `Bearer ${token}`)
    },
    put(path: string) {
      return app.put(path).set('Authorization', `Bearer ${token}`)
    },
    delete(path: string) {
      return app.delete(path).set('Authorization', `Bearer ${token}`)
    },
  }
}

function withGuest(app: SuperTest<Test>, token: string) {
  return {
    get(path: string) {
      return app.get(path).set('X-Guest-Token', token)
    },
    post(path: string) {
      return app.post(path).set('X-Guest-Token', token)
    },
    put(path: string) {
      return app.put(path).set('X-Guest-Token', token)
    },
    delete(path: string) {
      return app.delete(path).set('X-Guest-Token', token)
    },
  }
}

function findNoteById(notes: Array<{ id: string }>, noteId: string) {
  const note = notes.find((candidate) => candidate.id === noteId)
  assert.ok(note)
  return note
}

test('GET /health returns service metadata', async (t) => {
  const { app, cleanup } = await createTestApp()
  t.after(cleanup)

  const response = await request(app).get('/health')

  assert.equal(response.status, 200)
  assert.equal(response.body.status, 'ok')
  assert.equal(response.body.service, 'dnd-notes-api')
})

test('site admins can download a SQLite backup and non-admins cannot', async (t) => {
  const { app, cleanup } = await createTestApp({
    siteAdminEmails: ['site-admin@example.com'],
  })
  t.after(cleanup)

  const nonAdmin = await registerOwner(request(app), {
    email: 'not-admin@example.com',
  })
  const nonAdminBackupResponse = await withAuth(request(app), nonAdmin.token).get(
    '/api/admin/backup',
  )
  assert.equal(nonAdminBackupResponse.status, 403)
  assert.equal(nonAdminBackupResponse.body.error, 'Site-admin access is required.')

  const siteAdmin = await registerOwner(request(app), {
    displayName: 'Site Admin',
    email: 'site-admin@example.com',
  })
  assert.equal(siteAdmin.owner.isSiteAdmin, true)

  const backupResponse = await withAuth(request(app), siteAdmin.token).get('/api/admin/backup')
  assert.equal(backupResponse.status, 200)
  assert.match(
    backupResponse.headers['content-disposition'],
    /^attachment; filename="dnd-notes-backup-.+\.sqlite"$/,
  )
  assert.equal(backupResponse.headers['content-type'], 'application/octet-stream')
  assert.ok(Buffer.isBuffer(backupResponse.body))
  assert.equal(backupResponse.body.subarray(0, 15).toString('utf8'), 'SQLite format 3')
})

test('site admins can read admin overview metrics and non-admins cannot', async (t) => {
  const { app, cleanup } = await createTestApp({
    siteAdminEmails: ['site-admin@example.com'],
  })
  t.after(cleanup)

  const nonAdmin = await registerOwner(request(app), {
    email: 'observer@example.com',
  })
  const nonAdminOverviewResponse = await withAuth(request(app), nonAdmin.token).get(
    '/api/admin/overview',
  )
  assert.equal(nonAdminOverviewResponse.status, 403)
  assert.equal(nonAdminOverviewResponse.body.error, 'Site-admin access is required.')

  const siteAdmin = await registerOwner(request(app), {
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

test('owner auth and campaign endpoints support the management workflow', async (t) => {
  const { app, cleanup } = await createTestApp()
  t.after(cleanup)

  const unauthenticatedListResponse = await request(app).get('/api/campaigns')
  assert.equal(unauthenticatedListResponse.status, 401)

  const { token, owner, payload } = await registerOwner(request(app))
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
  assert.match(createDefaultShareLinkResponse.body.url, /\/share\//)

  const revealDefaultShareLinkResponse = await authed.get(
    `/api/campaigns/${defaultCampaignId}/share-links/${createDefaultShareLinkResponse.body.shareLink.id}`,
  )
  assert.equal(revealDefaultShareLinkResponse.status, 200)
  assert.equal(revealDefaultShareLinkResponse.body.token, createDefaultShareLinkResponse.body.token)
  assert.match(
    revealDefaultShareLinkResponse.body.url,
    new RegExp(`/share/${createDefaultShareLinkResponse.body.token}$`),
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

  const logoutResponse = await authed.post('/api/auth/logout')
  assert.equal(logoutResponse.status, 204)

  const expiredSessionResponse = await authed.get('/api/auth/session')
  assert.equal(expiredSessionResponse.status, 401)
})

test('owner registration is rate limited after repeated attempts', async (t) => {
  const { app, cleanup } = await createTestApp()
  t.after(cleanup)

  for (let index = 0; index < 5; index += 1) {
    const response = await request(app).post('/api/auth/register').send({
      displayName: `Rate Limited ${index}`,
      email: `rate-limit-${index}@example.com`,
      password: 'moonlit-secret',
    })

    assert.equal(response.status, 201)
  }

  const limitedResponse = await request(app).post('/api/auth/register').send({
    displayName: 'Rate Limited Final',
    email: 'rate-limit-final@example.com',
    password: 'moonlit-secret',
  })

  assert.equal(limitedResponse.status, 429)
  assert.equal(
    limitedResponse.body.error,
    'Too many registration attempts. Please wait before trying again.',
  )
  assert.equal(typeof limitedResponse.headers['retry-after'], 'string')
})

test('owner login is rate limited after repeated attempts', async (t) => {
  const { app, cleanup } = await createTestApp()
  t.after(cleanup)

  await registerOwner(request(app), {
    email: 'login-rate-limit@example.com',
    password: 'moonlit-secret',
  })

  for (let index = 0; index < 5; index += 1) {
    const response = await request(app).post('/api/auth/login').send({
      email: 'login-rate-limit@example.com',
      password: 'wrong-password',
    })

    assert.equal(response.status, 401)
  }

  const limitedResponse = await request(app).post('/api/auth/login').send({
    email: 'login-rate-limit@example.com',
    password: 'wrong-password',
  })

  assert.equal(limitedResponse.status, 429)
  assert.equal(
    limitedResponse.body.error,
    'Too many login attempts. Please wait before trying again.',
  )
  assert.equal(typeof limitedResponse.headers['retry-after'], 'string')
})

test('authenticated owners can run the note CRUD workflow in a selected campaign', async (t) => {
  const { app, cleanup } = await createTestApp()
  t.after(cleanup)

  const { token } = await registerOwner(request(app))
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

test('configured site-admin emails are promoted through registration and login', async (t) => {
  const siteAdminEmail = 'admin@example.com'
  const { app, noteStore, dbPath, cleanup } = await createTestApp({
    siteAdminEmails: [siteAdminEmail],
  })
  t.after(cleanup)

  const registration = await registerOwner(request(app), {
    displayName: 'Admin Aela',
    email: siteAdminEmail,
  })
  assert.equal(registration.owner.isSiteAdmin, true)

  const sessionResponse = await withAuth(request(app), registration.token).get('/api/auth/session')
  assert.equal(sessionResponse.status, 200)
  assert.equal(sessionResponse.body.owner.isSiteAdmin, true)

  noteStore.close()

  const reopenedStore = createNoteStore({ dbPath, siteAdminEmails: [siteAdminEmail] })
  t.after(() => reopenedStore.close())

  const reopenedApp = createApp({ noteStore: reopenedStore })
  const loginResponse = await request(reopenedApp).post('/api/auth/login').send({
    email: siteAdminEmail,
    password: 'moonlit-secret',
  })

  assert.equal(loginResponse.status, 200)
  assert.equal(loginResponse.body.owner.isSiteAdmin, true)
})

test('quick capture creates a note with only a title using server defaults', async (t) => {
  const { app, cleanup } = await createTestApp()
  t.after(cleanup)

  const { token } = await registerOwner(request(app))
  const authed = withAuth(request(app), token)

  const createResponse = await authed.post('/api/notes').send({
    campaignId: defaultCampaignId,
    title: 'Strange runes near the harbor',
  })

  assert.equal(createResponse.status, 201)
  assert.equal(createResponse.body.note.title, 'Strange runes near the harbor')
  assert.equal(createResponse.body.note.body, '')
  assert.equal(createResponse.body.note.status, 'draft')
  assert.deepEqual(createResponse.body.note.tags, [])
  assert.equal(createResponse.body.note.sessionName, null)

  const updateResponse = await authed.put(`/api/notes/${createResponse.body.note.id}`).send({
    title: 'Strange runes near the harbor',
    body: 'The runes glow faintly at dusk and match the cipher fragment from Candlekeep.',
    tags: ['clue', 'harbor'],
    status: 'active',
    sessionName: 'Session 14',
  })

  assert.equal(updateResponse.status, 200)
  assert.equal(updateResponse.body.note.body, 'The runes glow faintly at dusk and match the cipher fragment from Candlekeep.')
  assert.equal(updateResponse.body.note.status, 'active')
  assert.deepEqual(updateResponse.body.note.tags, ['clue', 'harbor'])
  assert.equal(updateResponse.body.note.sessionName, 'Session 14')
})

test('updating a note that omits body or status returns 400 instead of silently blanking fields', async (t) => {
  const { app, cleanup } = await createTestApp()
  t.after(cleanup)

  const { token } = await registerOwner(request(app))
  const authed = withAuth(request(app), token)

  const createResponse = await authed.post('/api/notes').send({
    campaignId: defaultCampaignId,
    title: 'Harbor watch schedule',
    body: 'Guard rotations change at midnight.',
    tags: ['logistics'],
    status: 'active',
    sessionName: 'Session 8',
  })

  assert.equal(createResponse.status, 201)
  const noteId = createResponse.body.note.id as string

  const missingBodyResponse = await authed.put(`/api/notes/${noteId}`).send({
    title: 'Harbor watch schedule',
    tags: ['logistics'],
    status: 'active',
    sessionName: 'Session 8',
  })

  assert.equal(missingBodyResponse.status, 400)
  assert.equal(missingBodyResponse.body.error, 'Note payload is invalid.')

  const missingStatusResponse = await authed.put(`/api/notes/${noteId}`).send({
    title: 'Harbor watch schedule',
    body: 'Guard rotations change at midnight.',
    tags: ['logistics'],
    sessionName: 'Session 8',
  })

  assert.equal(missingStatusResponse.status, 400)
  assert.equal(missingStatusResponse.body.error, 'Note payload is invalid.')

  const verifyResponse = await authed.get('/api/notes').query({ campaignId: defaultCampaignId })
  assert.equal(verifyResponse.status, 200)
  const note = verifyResponse.body.notes.find((n: { id: string }) => n.id === noteId)
  assert.equal(note.body, 'Guard rotations change at midnight.')
  assert.equal(note.status, 'active')
})

test('authenticated note session routes list sessions and preserve percent-encoded names', async (t) => {
  const { app, cleanup } = await createTestApp()
  t.after(cleanup)

  const { token } = await registerOwner(request(app))
  const authed = withAuth(request(app), token)

  const firstResponse = await authed.post('/api/notes').send({
    campaignId: defaultCampaignId,
    title: 'Recap: 50% done',
    body: 'Half the ritual circle is mapped.',
    tags: ['ritual'],
    status: 'active',
    sessionName: '50% done',
  })
  assert.equal(firstResponse.status, 201)

  const secondResponse = await authed.post('/api/notes').send({
    campaignId: defaultCampaignId,
    title: 'Loose thread from 50% done',
    body: 'The unresolved sigils still point north.',
    tags: ['sigils'],
    status: 'draft',
    sessionName: '50% done',
  })
  assert.equal(secondResponse.status, 201)

  const ungroupedResponse = await authed.post('/api/notes').send({
    campaignId: defaultCampaignId,
    title: 'Campaign prep',
    body: 'Keep this outside session browsing.',
    tags: ['prep'],
    status: 'draft',
    sessionName: null,
  })
  assert.equal(ungroupedResponse.status, 201)

  const sessionsResponse = await authed
    .get('/api/notes/sessions')
    .query({ campaignId: defaultCampaignId })
  assert.equal(sessionsResponse.status, 200)
  assert.equal(sessionsResponse.body.sessions.length, 1)
  assert.equal(sessionsResponse.body.sessions[0].sessionName, '50% done')
  assert.equal(sessionsResponse.body.sessions[0].noteCount, 2)
  assert.match(sessionsResponse.body.sessions[0].latestActivity, /^\d{4}-\d{2}-\d{2}T/)

  const sessionNotesResponse = await authed
    .get(`/api/notes/sessions/${encodeURIComponent('50% done')}`)
    .query({ campaignId: defaultCampaignId })
  assert.equal(sessionNotesResponse.status, 200)
  assert.equal(sessionNotesResponse.body.notes.length, 2)
  assert.deepEqual(
    sessionNotesResponse.body.notes.map((note: { title: string }) => note.title),
    ['Recap: 50% done', 'Loose thread from 50% done'],
  )
  assert.ok(
    sessionNotesResponse.body.notes.every(
      (note: { sessionName: string | null }) => note.sessionName === '50% done',
    ),
  )
})

test('recent activity returns collaborator summaries, supports filters, and rejects foreign memberships', async (t) => {
  const { app, cleanup } = await createTestApp()
  t.after(cleanup)

  const { token } = await registerOwner(request(app))
  const authed = withAuth(request(app), token)

  const RealDate = Date
  const fixedIso = new RealDate().toISOString()

  class FixedDate extends RealDate {
    constructor(value?: string | number) {
      super(value ?? fixedIso)
    }

    static now() {
      return new RealDate(fixedIso).getTime()
    }

    static parse(value: string) {
      return RealDate.parse(value)
    }

    static UTC(...args: Parameters<typeof RealDate.UTC>) {
      return RealDate.UTC(...args)
    }
  }

  let ownerNoteId: string | undefined

  globalThis.Date = FixedDate as unknown as DateConstructor

  try {
    const ownerCreateResponse = await authed.post('/api/notes').send({
      campaignId: defaultCampaignId,
      title: 'Owner watch list',
      body: 'Track the city watch near the moonwell.',
      tags: ['watch'],
      status: 'draft',
      sessionName: 'Session 19',
    })
    assert.equal(ownerCreateResponse.status, 201)
    ownerNoteId = ownerCreateResponse.body.note.id as string

    const ownerUpdateResponse = await authed.put(`/api/notes/${ownerNoteId}`).send({
      title: 'Owner watch list',
      body: 'Track the city watch near the moonwell and the harbor gate.',
      tags: ['watch', 'harbor'],
      status: 'active',
      sessionName: 'Session 19',
    })
    assert.equal(ownerUpdateResponse.status, 200)
    assert.notEqual(
      ownerUpdateResponse.body.note.updatedAt,
      ownerUpdateResponse.body.note.createdAt,
    )
  } finally {
    globalThis.Date = RealDate
  }

  const shareLinkResponse = await authed
    .post(`/api/campaigns/${defaultCampaignId}/share-links`)
    .send({
      label: 'Activity link',
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

  const guestCreateResponse = await guest.post(`/api/shared/${shareToken}/notes`).send({
    title: 'Scout route update',
    body: 'The ridge path is clear until the ruined tower.',
    tags: ['scout'],
    status: 'draft',
    sessionName: 'Session 19',
  })
  assert.equal(guestCreateResponse.status, 201)

  const otherCampaignResponse = await authed.post('/api/campaigns').send({
    name: 'Second campaign',
    tagline: 'Used to validate foreign collaborator filters.',
    system: 'Dungeons & Dragons 2024',
    setting: 'The West Marches',
    nextSession: null,
  })
  assert.equal(otherCampaignResponse.status, 201)

  const otherCampaignId = otherCampaignResponse.body.campaign.id as string
  const otherMembershipsResponse = await authed.get(
    `/api/campaigns/${otherCampaignId}/memberships`,
  )
  assert.equal(otherMembershipsResponse.status, 200)
  const foreignMembershipId = otherMembershipsResponse.body.memberships[0].id as string

  const activityResponse = await authed
    .get('/api/notes/activity')
    .query({ campaignId: defaultCampaignId })
  assert.equal(activityResponse.status, 200)
  assert.equal(activityResponse.body.campaign.id, defaultCampaignId)
  assert.ok(ownerNoteId)
  assert.deepEqual(
    activityResponse.body.collaborators.map(
      (collaborator: { displayName: string; noteCount: number }) => [
        collaborator.displayName,
        collaborator.noteCount,
      ],
    ),
    [
      ['Aela', 1],
      ['Mira', 1],
    ],
  )
  assert.equal(activityResponse.body.activity.length, 2)

  const ownerActivity = findNoteById(
    activityResponse.body.activity as Array<{
      id: string
      title: string
      action: string
      createdBy: { displayName: string } | null
      lastEditedBy: { displayName: string } | null
    }>,
    ownerNoteId,
  )
  assert.equal(ownerActivity.title, 'Owner watch list')
  assert.equal(ownerActivity.action, 'edited')
  assert.equal(ownerActivity.createdBy?.displayName, 'Aela')
  assert.equal(ownerActivity.lastEditedBy?.displayName, 'Aela')

  const guestActivity = findNoteById(
    activityResponse.body.activity as Array<{
      id: string
      title: string
      action: string
      createdBy: { displayName: string } | null
    }>,
    guestCreateResponse.body.note.id as string,
  )
  assert.equal(guestActivity.title, 'Scout route update')
  assert.equal(guestActivity.action, 'created')
  assert.equal(guestActivity.createdBy?.displayName, 'Mira')

  const filteredActivityResponse = await authed.get('/api/notes/activity').query({
    campaignId: defaultCampaignId,
    membershipId: guestMembershipId,
  })
  assert.equal(filteredActivityResponse.status, 200)
  assert.equal(filteredActivityResponse.body.activity.length, 1)
  assert.equal(filteredActivityResponse.body.activity[0].title, 'Scout route update')
  assert.equal(filteredActivityResponse.body.collaborators.length, 2)

  const foreignFilterResponse = await authed.get('/api/notes/activity').query({
    campaignId: defaultCampaignId,
    membershipId: foreignMembershipId,
  })
  assert.equal(foreignFilterResponse.status, 400)
  assert.equal(
    foreignFilterResponse.body.error,
    'Activity membership filter is invalid for this campaign.',
  )
})

test('claimed collaborators can load recent activity for accessible campaigns', async (t) => {
  const { app, cleanup } = await createTestApp()
  t.after(cleanup)

  const { token } = await registerOwner(request(app))
  const authed = withAuth(request(app), token)

  const shareLinkResponse = await authed
    .post(`/api/campaigns/${defaultCampaignId}/share-links`)
    .send({
      label: 'Claimable activity link',
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

  const guestCreateResponse = await guest.post(`/api/shared/${shareToken}/notes`).send({
    title: 'Moonwell timing',
    body: 'The moonwell opens when the second bell rings.',
    tags: ['moonwell'],
    status: 'active',
    sessionName: 'Session 20',
  })
  assert.equal(guestCreateResponse.status, 201)

  const claimant = await registerOwner(request(app), {
    displayName: 'Mira Vale',
    email: 'mira.activity@example.com',
    password: 'mira-activity-claim',
  })

  const claimResponse = await request(app)
    .post(`/api/shared/${shareToken}/membership/claim`)
    .set('Authorization', `Bearer ${claimant.token}`)
    .set('X-Guest-Token', guestToken)
  assert.equal(claimResponse.status, 200)
  assert.equal(claimResponse.body.membership.id, guestMembershipId)

  const claimedAuthed = withAuth(request(app), claimant.token)
  const activityResponse = await claimedAuthed.get('/api/notes/activity').query({
    campaignId: defaultCampaignId,
    membershipId: guestMembershipId,
  })
  assert.equal(activityResponse.status, 200)
  assert.equal(activityResponse.body.campaign.id, defaultCampaignId)
  assert.equal(activityResponse.body.collaborators.length, 1)
  assert.equal(activityResponse.body.collaborators[0].membershipId, guestMembershipId)
  assert.equal(activityResponse.body.activity.length, 1)
  assert.equal(activityResponse.body.activity[0].title, 'Moonwell timing')
  assert.equal(activityResponse.body.activity[0].createdBy.membershipId, guestMembershipId)
})

test('shared links support guest join, scoped access, and editor note workflow', async (t) => {
  const { app, cleanup } = await createTestApp()
  t.after(cleanup)

  const { token } = await registerOwner(request(app))
  const authed = withAuth(request(app), token)

  const shareLinkResponse = await authed
    .post(`/api/campaigns/${defaultCampaignId}/share-links`)
    .send({
      label: 'Player notes',
      accessLevel: 'editor',
      frameAncestors: 'https://vtt.example',
    })

  assert.equal(shareLinkResponse.status, 201)
  const shareToken = shareLinkResponse.body.token as string

  const sessionResponse = await request(app).get(`/api/shared/${shareToken}/session`)
  assert.equal(sessionResponse.status, 200)
  assert.equal(sessionResponse.body.campaign.id, defaultCampaignId)
  assert.equal(sessionResponse.body.membership, null)
  assert.equal(
    sessionResponse.headers['content-security-policy'],
    'frame-ancestors https://vtt.example',
  )

  const unauthorizedNotesResponse = await request(app).get(
    `/api/shared/${shareToken}/notes`,
  )
  assert.equal(unauthorizedNotesResponse.status, 401)

  const joinResponse = await request(app).post(`/api/shared/${shareToken}/join`).send({
    displayName: 'Mira',
  })
  assert.equal(joinResponse.status, 201)
  assert.equal(joinResponse.body.membership.role, 'guest')
  assert.equal(joinResponse.body.membership.displayName, 'Mira')

  const guestToken = joinResponse.body.guestToken as string
  const guest = withGuest(request(app), guestToken)

  const restoredSessionResponse = await guest.get(`/api/shared/${shareToken}/session`)
  assert.equal(restoredSessionResponse.status, 200)
  assert.equal(restoredSessionResponse.body.membership.displayName, 'Mira')

  const createNoteResponse = await guest.post(`/api/shared/${shareToken}/notes`).send({
    title: 'Portal sequence',
    body: 'Mirror shards resonate when the lantern is turned to the harbor.',
    tags: ['clue', 'harbor'],
    status: 'draft',
    sessionName: 'Session 15',
  })
  assert.equal(createNoteResponse.status, 201)
  assert.equal(createNoteResponse.body.note.campaignId, defaultCampaignId)

  const noteId = createNoteResponse.body.note.id as string

  const updateNoteResponse = await guest.put(`/api/shared/${shareToken}/notes/${noteId}`).send({
    title: 'Portal sequence',
    body: 'Mirror shards resonate when the lantern is turned toward the drowned gate.',
    tags: ['clue'],
    status: 'active',
    sessionName: null,
  })
  assert.equal(updateNoteResponse.status, 200)
  assert.equal(updateNoteResponse.body.note.status, 'active')

  const sharedOverviewResponse = await guest.get(`/api/shared/${shareToken}/overview`)
  assert.equal(sharedOverviewResponse.status, 200)
  assert.equal(sharedOverviewResponse.body.stats.totalNotes, 1)

  const sharedNotesResponse = await guest.get(`/api/shared/${shareToken}/notes`)
  assert.equal(sharedNotesResponse.status, 200)
  assert.equal(sharedNotesResponse.body.notes.length, 1)

  const deleteNoteResponse = await guest.delete(`/api/shared/${shareToken}/notes/${noteId}`)
  assert.equal(deleteNoteResponse.status, 204)

  const readOnlyShareLinkResponse = await authed
    .post(`/api/campaigns/${defaultCampaignId}/share-links`)
    .send({
      label: 'Viewer table',
      accessLevel: 'viewer',
      frameAncestors: null,
    })
  assert.equal(readOnlyShareLinkResponse.status, 201)

  const readOnlyJoinResponse = await request(app)
    .post(`/api/shared/${readOnlyShareLinkResponse.body.token}/join`)
    .send({
      displayName: 'Bran',
    })
  assert.equal(readOnlyJoinResponse.status, 201)

  const viewer = withGuest(request(app), readOnlyJoinResponse.body.guestToken as string)
  const readOnlyCreateResponse = await viewer
    .post(`/api/shared/${readOnlyShareLinkResponse.body.token}/notes`)
    .send({
      title: 'Should fail',
      body: 'Viewer links should not write notes.',
      tags: [],
      status: 'draft',
      sessionName: null,
    })
  assert.equal(readOnlyCreateResponse.status, 403)

  const revokeShareLinkResponse = await authed.delete(
    `/api/campaigns/${defaultCampaignId}/share-links/${shareLinkResponse.body.shareLink.id}`,
  )
  assert.equal(revokeShareLinkResponse.status, 204)

  const revokedSessionResponse = await guest.get(`/api/shared/${shareToken}/session`)
  assert.equal(revokedSessionResponse.status, 404)
})

test('shared guest joins are rate limited per link after repeated attempts', async (t) => {
  const { app, cleanup } = await createTestApp()
  t.after(cleanup)

  const { token } = await registerOwner(request(app))
  const authed = withAuth(request(app), token)
  const shareLinkResponse = await authed
    .post(`/api/campaigns/${defaultCampaignId}/share-links`)
    .send({
      label: 'Rate-limited join link',
      accessLevel: 'editor',
      frameAncestors: null,
    })
  assert.equal(shareLinkResponse.status, 201)

  const shareToken = shareLinkResponse.body.token as string

  for (let index = 0; index < 10; index += 1) {
    const response = await request(app).post(`/api/shared/${shareToken}/join`).send({
      displayName: `Guest ${index}`,
    })

    assert.equal(response.status, 201)
  }

  const limitedResponse = await request(app).post(`/api/shared/${shareToken}/join`).send({
    displayName: 'Guest Final',
  })

  assert.equal(limitedResponse.status, 429)
  assert.equal(
    limitedResponse.body.error,
    'Too many guest join attempts. Please wait before trying again.',
  )
  assert.equal(typeof limitedResponse.headers['retry-after'], 'string')
})

test('guests can claim an existing membership with a real account without losing attribution', async (t) => {
  const { app, cleanup } = await createTestApp()
  t.after(cleanup)

  const { token } = await registerOwner(request(app))
  const authed = withAuth(request(app), token)

  const shareLinkResponse = await authed
    .post(`/api/campaigns/${defaultCampaignId}/share-links`)
    .send({
      label: 'Claimable editor link',
      accessLevel: 'editor',
      frameAncestors: null,
    })
  assert.equal(shareLinkResponse.status, 201)

  const shareToken = shareLinkResponse.body.token as string
  const joinResponse = await request(app).post(`/api/shared/${shareToken}/join`).send({
    displayName: 'Mira',
  })
  assert.equal(joinResponse.status, 201)
  assert.equal(joinResponse.body.membership.userId, null)

  const guestToken = joinResponse.body.guestToken as string
  const guest = withGuest(request(app), guestToken)

  const createNoteResponse = await guest.post(`/api/shared/${shareToken}/notes`).send({
    title: 'Claimed under the same actor',
    body: 'The moonwell sigil was mapped before the account upgrade.',
    tags: ['moonwell'],
    status: 'draft',
    sessionName: 'Session 18',
  })
  assert.equal(createNoteResponse.status, 201)
  assert.equal(createNoteResponse.body.note.createdBy.displayName, 'Mira')

  const noteId = createNoteResponse.body.note.id as string
  const membershipId = createNoteResponse.body.note.createdBy.membershipId as string

  const claimant = await registerOwner(request(app), {
    displayName: 'Mira Vale',
    email: 'mira@example.com',
    password: 'mira-claims-history',
  })

  const claimResponse = await request(app)
    .post(`/api/shared/${shareToken}/membership/claim`)
    .set('Authorization', `Bearer ${claimant.token}`)
    .set('X-Guest-Token', guestToken)
  assert.equal(claimResponse.status, 200)
  assert.equal(claimResponse.body.membership.id, joinResponse.body.membership.id)
  assert.equal(claimResponse.body.membership.userId, claimant.owner.id)
  assert.equal(claimResponse.body.membership.displayName, 'Mira')
  assert.equal(typeof claimResponse.body.guestToken, 'string')
  assert.notEqual(claimResponse.body.guestToken, guestToken)

  const claimedAuthed = withAuth(request(app), claimant.token)
  const claimedCampaignsResponse = await claimedAuthed.get('/api/campaigns')
  assert.equal(claimedCampaignsResponse.status, 200)
  assert.equal(claimedCampaignsResponse.body.campaigns.length, 1)
  assert.equal(claimedCampaignsResponse.body.campaigns[0].id, defaultCampaignId)

  const claimedCampaignResponse = await claimedAuthed.get(`/api/campaigns/${defaultCampaignId}`)
  assert.equal(claimedCampaignResponse.status, 200)
  assert.equal(claimedCampaignResponse.body.campaign.id, defaultCampaignId)

  const claimedOverviewResponse = await claimedAuthed.get('/api/overview')
  assert.equal(claimedOverviewResponse.status, 200)
  assert.equal(claimedOverviewResponse.body.campaign.id, defaultCampaignId)
  assert.equal(claimedOverviewResponse.body.membership.id, membershipId)
  assert.equal(claimedOverviewResponse.body.membership.role, 'guest')

  const claimedSessionsResponse = await claimedAuthed
    .get('/api/notes/sessions')
    .query({ campaignId: defaultCampaignId })
  assert.equal(claimedSessionsResponse.status, 200)
  assert.equal(claimedSessionsResponse.body.sessions.length, 1)
  assert.equal(claimedSessionsResponse.body.sessions[0].sessionName, 'Session 18')
  assert.equal(claimedSessionsResponse.body.sessions[0].noteCount, 1)
  assert.match(
    claimedSessionsResponse.body.sessions[0].latestActivity,
    /^\d{4}-\d{2}-\d{2}T/,
  )

  const claimedSessionNotesResponse = await claimedAuthed
    .get(`/api/notes/sessions/${encodeURIComponent('Session 18')}`)
    .query({ campaignId: defaultCampaignId })
  assert.equal(claimedSessionNotesResponse.status, 200)
  assert.equal(claimedSessionNotesResponse.body.notes.length, 1)
  assert.equal(claimedSessionNotesResponse.body.notes[0].id, noteId)

  const claimedCreateNoteResponse = await claimedAuthed.post('/api/notes').send({
    campaignId: defaultCampaignId,
    title: 'Follow-up under the linked account',
    body: 'Creating from the authenticated app should keep the guest membership actor.',
    tags: ['claim', 'follow-up'],
    status: 'active',
    sessionName: null,
  })
  assert.equal(claimedCreateNoteResponse.status, 201)
  assert.equal(claimedCreateNoteResponse.body.note.createdBy.membershipId, membershipId)
  assert.equal(claimedCreateNoteResponse.body.note.createdBy.role, 'guest')
  assert.equal(claimedCreateNoteResponse.body.note.createdBy.displayName, 'Mira')

  const staleSessionResponse = await guest.get(`/api/shared/${shareToken}/session`)
  assert.equal(staleSessionResponse.status, 200)
  assert.equal(staleSessionResponse.body.membership, null)
  const staleOverviewResponse = await guest.get(`/api/shared/${shareToken}/overview`)
  assert.equal(staleOverviewResponse.status, 401)

  const renewedGuestToken = claimResponse.body.guestToken as string
  const renewedGuest = withGuest(request(app), renewedGuestToken)
  const restoredSessionResponse = await renewedGuest.get(`/api/shared/${shareToken}/session`)
  assert.equal(restoredSessionResponse.status, 200)
  assert.equal(restoredSessionResponse.body.membership.userId, claimant.owner.id)

  const updateNoteResponse = await renewedGuest
    .put(`/api/shared/${shareToken}/notes/${noteId}`)
    .send({
      title: 'Claimed under the same actor',
      body: 'The moonwell sigil stayed on the same membership after linking the account.',
      tags: ['moonwell', 'claim'],
      status: 'active',
      sessionName: null,
    })
  assert.equal(updateNoteResponse.status, 200)
  assert.equal(updateNoteResponse.body.note.createdBy.membershipId, membershipId)
  assert.equal(updateNoteResponse.body.note.createdBy.displayName, 'Mira')
  assert.equal(updateNoteResponse.body.note.lastEditedBy.membershipId, membershipId)
  assert.equal(updateNoteResponse.body.note.lastEditedBy.displayName, 'Mira')
})

test('shared membership claims are rate limited after repeated attempts', async (t) => {
  const { app, cleanup } = await createTestApp()
  t.after(cleanup)

  const { token } = await registerOwner(request(app))
  const authed = withAuth(request(app), token)
  const shareLinkResponse = await authed
    .post(`/api/campaigns/${defaultCampaignId}/share-links`)
    .send({
      label: 'Rate-limited claim link',
      accessLevel: 'editor',
      frameAncestors: null,
    })
  assert.equal(shareLinkResponse.status, 201)

  const shareToken = shareLinkResponse.body.token as string
  const joinResponse = await request(app).post(`/api/shared/${shareToken}/join`).send({
    displayName: 'Claim Target',
  })
  assert.equal(joinResponse.status, 201)

  const claimant = await registerOwner(request(app), {
    displayName: 'Claimant',
    email: 'claim-rate-limit@example.com',
    password: 'claim-rate-limit-password',
  })

  let activeGuestToken = joinResponse.body.guestToken as string

  for (let index = 0; index < 5; index += 1) {
    const response = await request(app)
      .post(`/api/shared/${shareToken}/membership/claim`)
      .set('Authorization', `Bearer ${claimant.token}`)
      .set('X-Guest-Token', activeGuestToken)

    assert.equal(response.status, 200)

    if (typeof response.body.guestToken === 'string') {
      activeGuestToken = response.body.guestToken
    }
  }

  const limitedResponse = await request(app)
    .post(`/api/shared/${shareToken}/membership/claim`)
    .set('Authorization', `Bearer ${claimant.token}`)
    .set('X-Guest-Token', activeGuestToken)

  assert.equal(limitedResponse.status, 429)
  assert.equal(
    limitedResponse.body.error,
    'Too many membership claim attempts. Please wait before trying again.',
  )
  assert.equal(typeof limitedResponse.headers['retry-after'], 'string')
})

test('owners can preview and consolidate note attribution onto another membership', async (t) => {
  const { app, cleanup } = await createTestApp()
  t.after(cleanup)

  const { token } = await registerOwner(request(app))
  const authed = withAuth(request(app), token)

  const shareLinkResponse = await authed
    .post(`/api/campaigns/${defaultCampaignId}/share-links`)
    .send({
      label: 'Consolidation link',
      accessLevel: 'editor',
      frameAncestors: null,
    })
  assert.equal(shareLinkResponse.status, 201)

  const shareToken = shareLinkResponse.body.token as string

  const sourceJoinResponse = await request(app)
    .post(`/api/shared/${shareToken}/join`)
    .send({ displayName: 'Mira (Safari)' })
  assert.equal(sourceJoinResponse.status, 201)

  const targetJoinResponse = await request(app)
    .post(`/api/shared/${shareToken}/join`)
    .send({ displayName: 'Mira' })
  assert.equal(targetJoinResponse.status, 201)

  const sourceMembershipId = sourceJoinResponse.body.membership.id as string
  const targetMembershipId = targetJoinResponse.body.membership.id as string
  const sourceGuest = withGuest(request(app), sourceJoinResponse.body.guestToken as string)
  const targetGuest = withGuest(request(app), targetJoinResponse.body.guestToken as string)

  const sourceOwnedNoteResponse = await sourceGuest.post(`/api/shared/${shareToken}/notes`).send({
    title: 'Source-owned journal',
    body: 'Keep this note body exactly as written.',
    tags: ['mirror'],
    status: 'draft',
    sessionName: 'Session 20',
  })
  assert.equal(sourceOwnedNoteResponse.status, 201)
  const sourceOwnedNoteId = sourceOwnedNoteResponse.body.note.id as string

  const sourceCreatedNoteResponse = await sourceGuest
    .post(`/api/shared/${shareToken}/notes`)
    .send({
      title: 'Source-created clue',
      body: 'This started on the duplicate membership.',
      tags: ['clue'],
      status: 'draft',
      sessionName: 'Session 20',
    })
  assert.equal(sourceCreatedNoteResponse.status, 201)
  const sourceCreatedNoteId = sourceCreatedNoteResponse.body.note.id as string

  const targetEditedSourceNoteResponse = await targetGuest
    .put(`/api/shared/${shareToken}/notes/${sourceCreatedNoteId}`)
    .send({
      title: 'Source-created clue',
      body: 'Target edited this note before consolidation.',
      tags: ['clue', 'shared'],
      status: 'active',
      sessionName: null,
    })
  assert.equal(targetEditedSourceNoteResponse.status, 200)

  const targetOwnedNoteResponse = await targetGuest.post(`/api/shared/${shareToken}/notes`).send({
    title: 'Target-owned clue',
    body: 'Target created this note first.',
    tags: ['target'],
    status: 'draft',
    sessionName: 'Session 21',
  })
  assert.equal(targetOwnedNoteResponse.status, 201)
  const targetOwnedNoteId = targetOwnedNoteResponse.body.note.id as string

  const sourceEditedTargetNoteResponse = await sourceGuest
    .put(`/api/shared/${shareToken}/notes/${targetOwnedNoteId}`)
    .send({
      title: 'Target-owned clue',
      body: 'Source edited this target note before consolidation.',
      tags: ['target', 'edited'],
      status: 'active',
      sessionName: null,
    })
  assert.equal(sourceEditedTargetNoteResponse.status, 200)

  const unaffectedTargetNoteResponse = await targetGuest
    .post(`/api/shared/${shareToken}/notes`)
    .send({
      title: 'Target-only note',
      body: 'This note should stay untouched.',
      tags: ['stable'],
      status: 'active',
      sessionName: null,
    })
  assert.equal(unaffectedTargetNoteResponse.status, 201)
  const unaffectedTargetNoteId = unaffectedTargetNoteResponse.body.note.id as string

  const beforeConsolidationResponse = await authed
    .get('/api/notes')
    .query({ campaignId: defaultCampaignId })
  assert.equal(beforeConsolidationResponse.status, 200)

  const beforeSourceOwnedNote = findNoteById(
    beforeConsolidationResponse.body.notes,
    sourceOwnedNoteId,
  )
  const beforeSourceCreatedNote = findNoteById(
    beforeConsolidationResponse.body.notes,
    sourceCreatedNoteId,
  )
  const beforeTargetOwnedNote = findNoteById(
    beforeConsolidationResponse.body.notes,
    targetOwnedNoteId,
  )
  const beforeUnaffectedTargetNote = findNoteById(
    beforeConsolidationResponse.body.notes,
    unaffectedTargetNoteId,
  )

  const previewResponse = await authed
    .post(`/api/campaigns/${defaultCampaignId}/memberships/consolidations`)
    .send({
      sourceMembershipId,
      targetMembershipId,
    })
  assert.equal(previewResponse.status, 200)
  assert.equal(previewResponse.body.consolidation.applied, false)
  assert.equal(previewResponse.body.consolidation.effect, 'note-attribution-only')
  assert.equal(previewResponse.body.consolidation.sourceMembership.id, sourceMembershipId)
  assert.equal(previewResponse.body.consolidation.targetMembership.id, targetMembershipId)
  assert.equal(previewResponse.body.consolidation.noteChanges.authoredNoteCount, 2)
  assert.equal(previewResponse.body.consolidation.noteChanges.editedNoteCount, 2)
  assert.equal(
    previewResponse.body.consolidation.noteChanges.authoredAndEditedNoteCount,
    1,
  )
  assert.equal(previewResponse.body.consolidation.noteChanges.affectedNoteCount, 3)
  assert.equal(previewResponse.body.consolidation.requiresRoleMismatchConfirmation, false)
  assert.ok(
    previewResponse.body.consolidation.warnings.some((warning: string) =>
      warning.includes('Membership records, linked accounts, and guest tokens'),
    ),
  )
  assert.ok(
    previewResponse.body.consolidation.warnings.some((warning: string) =>
      warning.includes('Affected notes will show "Mira" instead of "Mira (Safari)"'),
    ),
  )

  const applyResponse = await authed
    .post(`/api/campaigns/${defaultCampaignId}/memberships/consolidations`)
    .send({
      sourceMembershipId,
      targetMembershipId,
      confirm: true,
    })
  assert.equal(applyResponse.status, 200)
  assert.equal(applyResponse.body.consolidation.applied, true)
  assert.equal(applyResponse.body.consolidation.noteChanges.affectedNoteCount, 3)

  const membershipsResponse = await authed.get(`/api/campaigns/${defaultCampaignId}/memberships`)
  assert.equal(membershipsResponse.status, 200)
  assert.ok(
    membershipsResponse.body.memberships.some(
      (membership: { id: string }) => membership.id === sourceMembershipId,
    ),
  )
  assert.ok(
    membershipsResponse.body.memberships.some(
      (membership: { id: string }) => membership.id === targetMembershipId,
    ),
  )

  const afterConsolidationResponse = await authed
    .get('/api/notes')
    .query({ campaignId: defaultCampaignId })
  assert.equal(afterConsolidationResponse.status, 200)

  const sourceOwnedNote = findNoteById(
    afterConsolidationResponse.body.notes,
    sourceOwnedNoteId,
  )
  assert.equal(sourceOwnedNote.createdBy.membershipId, targetMembershipId)
  assert.equal(sourceOwnedNote.lastEditedBy.membershipId, targetMembershipId)
  assert.equal(sourceOwnedNote.body, beforeSourceOwnedNote.body)
  assert.equal(sourceOwnedNote.updatedAt, beforeSourceOwnedNote.updatedAt)

  const sourceCreatedNote = findNoteById(
    afterConsolidationResponse.body.notes,
    sourceCreatedNoteId,
  )
  assert.equal(sourceCreatedNote.createdBy.membershipId, targetMembershipId)
  assert.equal(sourceCreatedNote.lastEditedBy.membershipId, targetMembershipId)
  assert.equal(sourceCreatedNote.body, beforeSourceCreatedNote.body)
  assert.equal(sourceCreatedNote.updatedAt, beforeSourceCreatedNote.updatedAt)

  const targetOwnedNote = findNoteById(
    afterConsolidationResponse.body.notes,
    targetOwnedNoteId,
  )
  assert.equal(targetOwnedNote.createdBy.membershipId, targetMembershipId)
  assert.equal(targetOwnedNote.lastEditedBy.membershipId, targetMembershipId)
  assert.equal(targetOwnedNote.body, beforeTargetOwnedNote.body)
  assert.equal(targetOwnedNote.updatedAt, beforeTargetOwnedNote.updatedAt)

  const unaffectedTargetNote = findNoteById(
    afterConsolidationResponse.body.notes,
    unaffectedTargetNoteId,
  )
  assert.equal(unaffectedTargetNote.createdBy.membershipId, targetMembershipId)
  assert.equal(unaffectedTargetNote.lastEditedBy.membershipId, targetMembershipId)
  assert.equal(unaffectedTargetNote.body, beforeUnaffectedTargetNote.body)
  assert.equal(unaffectedTargetNote.updatedAt, beforeUnaffectedTargetNote.updatedAt)
})

test('linked guest accounts cannot consolidate memberships through the owner-only route', async (t) => {
  const { app, cleanup } = await createTestApp()
  t.after(cleanup)

  const { token } = await registerOwner(request(app))
  const ownerAuthed = withAuth(request(app), token)

  const ownerMembershipsResponse = await ownerAuthed.get(
    `/api/campaigns/${defaultCampaignId}/memberships`,
  )
  assert.equal(ownerMembershipsResponse.status, 200)
  const ownerMembershipId = ownerMembershipsResponse.body.memberships[0].id as string

  const shareLinkResponse = await ownerAuthed
    .post(`/api/campaigns/${defaultCampaignId}/share-links`)
    .send({
      label: 'Owner-only consolidation link',
      accessLevel: 'editor',
      frameAncestors: null,
    })
  assert.equal(shareLinkResponse.status, 201)

  const shareToken = shareLinkResponse.body.token as string
  const joinResponse = await request(app).post(`/api/shared/${shareToken}/join`).send({
    displayName: 'Mira',
  })
  assert.equal(joinResponse.status, 201)

  const claimant = await registerOwner(request(app), {
    displayName: 'Mira Vale',
    email: 'mira-non-owner@example.com',
    password: 'mira-cannot-consolidate',
  })

  const claimResponse = await request(app)
    .post(`/api/shared/${shareToken}/membership/claim`)
    .set('Authorization', `Bearer ${claimant.token}`)
    .set('X-Guest-Token', joinResponse.body.guestToken as string)
  assert.equal(claimResponse.status, 200)

  const claimedMembershipId = claimResponse.body.membership.id as string
  const claimedAuthed = withAuth(request(app), claimant.token)

  const previewResponse = await claimedAuthed
    .post(`/api/campaigns/${defaultCampaignId}/memberships/consolidations`)
    .send({
      sourceMembershipId: claimedMembershipId,
      targetMembershipId: ownerMembershipId,
    })
  assert.equal(previewResponse.status, 403)
  assert.equal(previewResponse.body.error, 'You do not have access to this campaign.')

  const applyResponse = await claimedAuthed
    .post(`/api/campaigns/${defaultCampaignId}/memberships/consolidations`)
    .send({
      sourceMembershipId: claimedMembershipId,
      targetMembershipId: ownerMembershipId,
      confirm: true,
      confirmRoleMismatch: true,
    })
  assert.equal(applyResponse.status, 403)
  assert.equal(applyResponse.body.error, 'You do not have access to this campaign.')

  const ownerPreviewResponse = await ownerAuthed
    .post(`/api/campaigns/${defaultCampaignId}/memberships/consolidations`)
    .send({
      sourceMembershipId: claimedMembershipId,
      targetMembershipId: ownerMembershipId,
    })
  assert.equal(ownerPreviewResponse.status, 200)
  assert.equal(ownerPreviewResponse.body.consolidation.applied, false)
})

test('membership consolidations reject membership IDs from another campaign', async (t) => {
  const { app, cleanup } = await createTestApp()
  t.after(cleanup)

  const { token } = await registerOwner(request(app))
  const authed = withAuth(request(app), token)

  const defaultMembershipsResponse = await authed.get(
    `/api/campaigns/${defaultCampaignId}/memberships`,
  )
  assert.equal(defaultMembershipsResponse.status, 200)
  const defaultOwnerMembershipId = defaultMembershipsResponse.body.memberships[0].id as string

  const createCampaignResponse = await authed.post('/api/campaigns').send({
    name: 'Foreign campaign',
    tagline: 'Used to prove campaign-scoped membership checks.',
    system: 'Dungeons & Dragons 2024',
    setting: 'Moonfall',
    nextSession: null,
  })
  assert.equal(createCampaignResponse.status, 201)
  const foreignCampaignId = createCampaignResponse.body.campaign.id as string

  const foreignMembershipsResponse = await authed.get(
    `/api/campaigns/${foreignCampaignId}/memberships`,
  )
  assert.equal(foreignMembershipsResponse.status, 200)
  const foreignMembershipId = foreignMembershipsResponse.body.memberships[0].id as string

  const foreignSourceResponse = await authed
    .post(`/api/campaigns/${defaultCampaignId}/memberships/consolidations`)
    .send({
      sourceMembershipId: foreignMembershipId,
      targetMembershipId: defaultOwnerMembershipId,
    })
  assert.equal(foreignSourceResponse.status, 404)
  assert.equal(
    foreignSourceResponse.body.error,
    'Source membership was not found in this campaign.',
  )

  const foreignTargetResponse = await authed
    .post(`/api/campaigns/${defaultCampaignId}/memberships/consolidations`)
    .send({
      sourceMembershipId: defaultOwnerMembershipId,
      targetMembershipId: foreignMembershipId,
    })
  assert.equal(foreignTargetResponse.status, 404)
  assert.equal(
    foreignTargetResponse.body.error,
    'Target membership was not found in this campaign.',
  )
})

test('role-changing membership consolidations require explicit confirmation', async (t) => {
  const { app, cleanup } = await createTestApp()
  t.after(cleanup)

  const { token } = await registerOwner(request(app))
  const authed = withAuth(request(app), token)

  const membershipsResponse = await authed.get(
    `/api/campaigns/${defaultCampaignId}/memberships`,
  )
  assert.equal(membershipsResponse.status, 200)
  const ownerMembershipId = membershipsResponse.body.memberships[0].id as string

  const shareLinkResponse = await authed
    .post(`/api/campaigns/${defaultCampaignId}/share-links`)
    .send({
      label: 'Role mismatch link',
      accessLevel: 'editor',
      frameAncestors: null,
    })
  assert.equal(shareLinkResponse.status, 201)

  const joinResponse = await request(app)
    .post(`/api/shared/${shareLinkResponse.body.token}/join`)
    .send({ displayName: 'Aela Guest' })
  assert.equal(joinResponse.status, 201)
  const guestMembershipId = joinResponse.body.membership.id as string

  const createNoteResponse = await authed.post('/api/notes').send({
    campaignId: defaultCampaignId,
    title: 'Owner-only warning',
    body: 'Do not change this ownership without an explicit confirmation step.',
    tags: ['owner'],
    status: 'active',
    sessionName: null,
  })
  assert.equal(createNoteResponse.status, 201)
  const noteId = createNoteResponse.body.note.id as string

  const previewResponse = await authed
    .post(`/api/campaigns/${defaultCampaignId}/memberships/consolidations`)
    .send({
      sourceMembershipId: ownerMembershipId,
      targetMembershipId: guestMembershipId,
    })
  assert.equal(previewResponse.status, 200)
  assert.equal(previewResponse.body.consolidation.applied, false)
  assert.equal(previewResponse.body.consolidation.requiresRoleMismatchConfirmation, true)
  assert.ok(
    previewResponse.body.consolidation.warnings.some((warning: string) =>
      warning.includes('Affected notes will use the "guest" role instead of "owner"'),
    ),
  )

  const unconfirmedResponse = await authed
    .post(`/api/campaigns/${defaultCampaignId}/memberships/consolidations`)
    .send({
      sourceMembershipId: ownerMembershipId,
      targetMembershipId: guestMembershipId,
      confirm: true,
    })
  assert.equal(unconfirmedResponse.status, 409)
  assert.match(unconfirmedResponse.body.details[0], /owner-to-guest/)

  const beforeConfirmedGetResponse = await authed.get(`/api/notes/${noteId}`)
  assert.equal(beforeConfirmedGetResponse.status, 200)
  assert.equal(beforeConfirmedGetResponse.body.note.createdBy.role, 'owner')

  const confirmedResponse = await authed
    .post(`/api/campaigns/${defaultCampaignId}/memberships/consolidations`)
    .send({
      sourceMembershipId: ownerMembershipId,
      targetMembershipId: guestMembershipId,
      confirm: true,
      confirmRoleMismatch: true,
    })
  assert.equal(confirmedResponse.status, 200)
  assert.equal(confirmedResponse.body.consolidation.applied, true)
  assert.equal(confirmedResponse.body.consolidation.noteChanges.authoredNoteCount, 1)
  assert.equal(confirmedResponse.body.consolidation.noteChanges.editedNoteCount, 1)
  assert.equal(
    confirmedResponse.body.consolidation.noteChanges.authoredAndEditedNoteCount,
    1,
  )

  const afterConfirmedGetResponse = await authed.get(`/api/notes/${noteId}`)
  assert.equal(afterConfirmedGetResponse.status, 200)
  assert.equal(afterConfirmedGetResponse.body.note.createdBy.membershipId, guestMembershipId)
  assert.equal(afterConfirmedGetResponse.body.note.createdBy.role, 'guest')
  assert.equal(afterConfirmedGetResponse.body.note.lastEditedBy.membershipId, guestMembershipId)
  assert.equal(
    afterConfirmedGetResponse.body.note.body,
    'Do not change this ownership without an explicit confirmation step.',
  )
})

test('invalid note payloads return explicit errors for an authenticated owner', async (t) => {
  const { app, cleanup } = await createTestApp()
  t.after(cleanup)

  const { token } = await registerOwner(request(app))
  const authed = withAuth(request(app), token)

  const response = await authed.post('/api/notes').send({
    campaignId: defaultCampaignId,
    title: '',
    body: '',
    tags: ['travel'],
    status: 'draft',
    sessionName: '',
  })

  assert.equal(response.status, 400)
  assert.equal(response.body.error, 'Note payload is invalid.')
  assert.ok(Array.isArray(response.body.details))
  assert.match(response.body.details[0], /Title|Body/)
})

test('notes and owner sessions persist across app recreation when using the same database file', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'dnd-notes-persist-'))
  const dbPath = join(directory, 'notes.sqlite')

  t.after(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  const firstStore = createNoteStore({ dbPath })
  const firstApp = createApp({ noteStore: firstStore })

  const { token } = await registerOwner(request(firstApp))
  const firstAuthed = withAuth(request(firstApp), token)

  const createResponse = await firstAuthed.post('/api/notes').send({
    campaignId: defaultCampaignId,
    title: 'Map the smugglers cave',
    body: 'The western tunnel collapsed, but the tide pools hide a second entrance.',
    tags: ['cave', 'smugglers'],
    status: 'active',
    sessionName: 'Session 14',
  })

  assert.equal(createResponse.status, 201)
  firstStore.close()

  const secondStore = createNoteStore({ dbPath })
  t.after(() => {
    secondStore.close()
  })

  const secondApp = createApp({ noteStore: secondStore })
  const secondAuthed = withAuth(request(secondApp), token)

  const sessionResponse = await secondAuthed.get('/api/auth/session')
  assert.equal(sessionResponse.status, 200)

  const listResponse = await secondAuthed
    .get('/api/notes')
    .query({ campaignId: defaultCampaignId })

  assert.equal(listResponse.status, 200)
  assert.equal(listResponse.body.notes.length, 1)
  assert.equal(listResponse.body.notes[0].title, 'Map the smugglers cave')
})

test('legacy note databases are upgraded in place for membership attribution columns', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'dnd-notes-legacy-'))
  const dbPath = join(directory, 'notes.sqlite')

  t.after(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  const legacyDatabase = new Database(dbPath)
  legacyDatabase.exec(`
    CREATE TABLE notes (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      session_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)
  legacyDatabase
    .prepare(`
      INSERT INTO notes (
        id,
        campaign_id,
        title,
        body,
        status,
        tags_json,
        session_name,
        created_at,
        updated_at
      ) VALUES (
        @id,
        @campaign_id,
        @title,
        @body,
        @status,
        @tags_json,
        @session_name,
        @created_at,
        @updated_at
      )
    `)
    .run({
      id: 'legacy-note',
      campaign_id: defaultCampaignId,
      title: 'Legacy harbor log',
      body: 'Recorded before attribution columns existed.',
      status: 'active',
      tags_json: JSON.stringify(['harbor']),
      session_name: null,
      created_at: '2026-04-12T00:00:00.000Z',
      updated_at: '2026-04-12T00:00:00.000Z',
    })
  legacyDatabase.close()

  const noteStore = createNoteStore({ dbPath })

  try {
    const notes = noteStore.listNotes(defaultCampaignId)
    assert.equal(notes.length, 1)
    assert.equal(notes[0].title, 'Legacy harbor log')
    assert.equal(notes[0].createdBy, null)
    assert.equal(notes[0].lastEditedBy, null)
  } finally {
    noteStore.close()
  }

  const migratedDatabase = new Database(dbPath, { readonly: true })
  const migratedColumns = (
    migratedDatabase.prepare(`PRAGMA table_info(notes)`).all() as Array<{ name: string }>
  ).map((column) => column.name)
  migratedDatabase.close()

  assert.ok(migratedColumns.includes('created_by_membership_id'))
  assert.ok(migratedColumns.includes('last_edited_by_membership_id'))
})

test('legacy share links without stored plaintext tokens return an explicit regeneration error', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'dnd-notes-share-link-legacy-'))
  const dbPath = join(directory, 'notes.sqlite')

  t.after(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  const legacyDatabase = new Database(dbPath)
  legacyDatabase.exec(`
    CREATE TABLE campaign_share_links (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      label TEXT,
      access_level TEXT NOT NULL,
      frame_ancestors TEXT,
      expires_at TEXT,
      revoked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)
  legacyDatabase.close()

  const noteStore = createNoteStore({ dbPath })
  t.after(() => {
    noteStore.close()
  })

  const app = createApp({ noteStore })
  const { token } = await registerOwner(request(app))
  const authed = withAuth(request(app), token)

  const shareLinkId = 'legacy-share-link'
  const legacyShareToken = 'legacy-share-token'
  const timestamp = '2026-04-12T00:00:00.000Z'
  const writableDatabase = new Database(dbPath)
  writableDatabase
    .prepare(`
      INSERT INTO campaign_share_links (
        id,
        campaign_id,
        token_hash,
        label,
        access_level,
        frame_ancestors,
        expires_at,
        revoked_at,
        created_at,
        updated_at
      ) VALUES (
        @id,
        @campaign_id,
        @token_hash,
        @label,
        @access_level,
        @frame_ancestors,
        @expires_at,
        @revoked_at,
        @created_at,
        @updated_at
      )
    `)
    .run({
      id: shareLinkId,
      campaign_id: defaultCampaignId,
      token_hash: createHash('sha256').update(legacyShareToken).digest('hex'),
      label: 'Legacy link',
      access_level: 'viewer',
      frame_ancestors: null,
      expires_at: null,
      revoked_at: null,
      created_at: timestamp,
      updated_at: timestamp,
    })
  writableDatabase.close()

  const revealResponse = await authed.get(
    `/api/campaigns/${defaultCampaignId}/share-links/${shareLinkId}`,
  )
  assert.equal(revealResponse.status, 409)
  assert.equal(revealResponse.body.error, 'This shared link can no longer be revealed.')
  assert.ok(Array.isArray(revealResponse.body.details))
  assert.match(revealResponse.body.details[0], /Revoke it and create a new share link/)

  const migratedDatabase = new Database(dbPath, { readonly: true })
  const migratedColumns = (
    migratedDatabase.prepare(`PRAGMA table_info(campaign_share_links)`).all() as Array<{
      name: string
    }>
  ).map((column) => column.name)
  migratedDatabase.close()

  assert.ok(migratedColumns.includes('token_plaintext'))
})

test('owner note creation and editing attributes notes to campaign membership', async (t) => {
  const { app, cleanup } = await createTestApp()
  t.after(cleanup)

  const { token, owner } = await registerOwner(request(app))
  const authed = withAuth(request(app), token)

  const createResponse = await authed.post('/api/notes').send({
    campaignId: defaultCampaignId,
    title: 'Rune circle near the harbor',
    body: 'The runes glow faintly when the tide recedes.',
    tags: ['runes'],
    status: 'draft',
    sessionName: null,
  })

  assert.equal(createResponse.status, 201)
  assert.ok(createResponse.body.note.createdBy)
  assert.equal(createResponse.body.note.createdBy.displayName, owner.displayName)
  assert.equal(createResponse.body.note.createdBy.role, 'owner')
  assert.ok(createResponse.body.note.lastEditedBy)
  assert.equal(createResponse.body.note.lastEditedBy.membershipId, createResponse.body.note.createdBy.membershipId)

  const noteId = createResponse.body.note.id as string

  const updateResponse = await authed.put(`/api/notes/${noteId}`).send({
    title: 'Rune circle near the harbor',
    body: 'The runes pulse in rhythm with the full moon cycle.',
    tags: ['runes', 'moonwell'],
    status: 'active',
    sessionName: 'Session 16',
  })

  assert.equal(updateResponse.status, 200)
  assert.ok(updateResponse.body.note.createdBy)
  assert.equal(updateResponse.body.note.createdBy.displayName, owner.displayName)
  assert.ok(updateResponse.body.note.lastEditedBy)
  assert.equal(updateResponse.body.note.lastEditedBy.displayName, owner.displayName)
  assert.equal(updateResponse.body.note.lastEditedBy.role, 'owner')

  const getResponse = await authed.get(`/api/notes/${noteId}`)
  assert.equal(getResponse.status, 200)
  assert.ok(getResponse.body.note.createdBy)
  assert.equal(getResponse.body.note.createdBy.displayName, owner.displayName)
})

test('guest note creation and editing attributes notes to guest membership', async (t) => {
  const { app, cleanup } = await createTestApp()
  t.after(cleanup)

  const { token } = await registerOwner(request(app))
  const authed = withAuth(request(app), token)

  const shareLinkResponse = await authed
    .post(`/api/campaigns/${defaultCampaignId}/share-links`)
    .send({
      label: 'Editor link',
      accessLevel: 'editor',
      frameAncestors: null,
    })
  const shareToken = shareLinkResponse.body.token as string

  const joinResponse = await request(app).post(`/api/shared/${shareToken}/join`).send({
    displayName: 'Thorn',
  })
  assert.equal(joinResponse.status, 201)

  const guestToken = joinResponse.body.guestToken as string
  const guest = withGuest(request(app), guestToken)

  const createResponse = await guest.post(`/api/shared/${shareToken}/notes`).send({
    title: 'Hidden passage behind the altar',
    body: 'The statue rotates to reveal a narrow staircase descending into darkness.',
    tags: ['dungeon', 'secret'],
    status: 'draft',
    sessionName: 'Session 17',
  })

  assert.equal(createResponse.status, 201)
  assert.ok(createResponse.body.note.createdBy)
  assert.equal(createResponse.body.note.createdBy.displayName, 'Thorn')
  assert.equal(createResponse.body.note.createdBy.role, 'guest')
  assert.ok(createResponse.body.note.lastEditedBy)
  assert.equal(createResponse.body.note.lastEditedBy.displayName, 'Thorn')

  const noteId = createResponse.body.note.id as string

  const updateResponse = await guest.put(`/api/shared/${shareToken}/notes/${noteId}`).send({
    title: 'Hidden passage behind the altar',
    body: 'The staircase leads to an underground river. Faint chanting echoes from below.',
    tags: ['dungeon', 'secret', 'underground'],
    status: 'active',
    sessionName: null,
  })

  assert.equal(updateResponse.status, 200)
  assert.ok(updateResponse.body.note.createdBy)
  assert.equal(updateResponse.body.note.createdBy.displayName, 'Thorn')
  assert.ok(updateResponse.body.note.lastEditedBy)
  assert.equal(updateResponse.body.note.lastEditedBy.displayName, 'Thorn')
  assert.equal(updateResponse.body.note.lastEditedBy.role, 'guest')
})

test('notes without membership attribution return null for createdBy and lastEditedBy', async (t) => {
  const { app, noteStore, cleanup } = await createTestApp()
  t.after(cleanup)

  const { token } = await registerOwner(request(app))
  const authed = withAuth(request(app), token)

  noteStore.resetNotes(
    [
      {
        title: 'Legacy note',
        body: 'Created without attribution.',
        tags: [],
        status: 'active',
        sessionName: null,
      },
    ],
    defaultCampaignId,
  )

  const listResponse = await authed.get('/api/notes').query({ campaignId: defaultCampaignId })
  assert.equal(listResponse.status, 200)
  assert.equal(listResponse.body.notes.length, 1)
  assert.equal(listResponse.body.notes[0].createdBy, null)
  assert.equal(listResponse.body.notes[0].lastEditedBy, null)
})

test('session listing endpoint returns unique session names grouped from notes', async (t) => {
  const { app, cleanup } = await createTestApp()
  t.after(cleanup)

  const { token } = await registerOwner(request(app))
  const authed = withAuth(request(app), token)

  const emptySessionsResponse = await authed.get(
    `/api/campaigns/${defaultCampaignId}/sessions`,
  )
  assert.equal(emptySessionsResponse.status, 200)
  assert.equal(emptySessionsResponse.body.sessions.length, 0)

  await authed.post('/api/notes').send({
    campaignId: defaultCampaignId,
    title: 'Ambush at the bridge',
    body: 'Bandits attacked during the river crossing.',
    tags: ['combat'],
    status: 'active',
    sessionName: 'Session 5',
  })

  await authed.post('/api/notes').send({
    campaignId: defaultCampaignId,
    title: 'Loot found in bandit camp',
    body: 'A mysterious amulet was recovered from the camp leader.',
    tags: ['loot'],
    status: 'active',
    sessionName: 'Session 5',
  })

  await authed.post('/api/notes').send({
    campaignId: defaultCampaignId,
    title: 'Meeting with the baron',
    body: 'The baron offered a quest to clear the mines.',
    tags: ['quest'],
    status: 'draft',
    sessionName: 'Session 6',
  })

  await authed.post('/api/notes').send({
    campaignId: defaultCampaignId,
    title: 'General campaign thoughts',
    body: 'Need to figure out the factions.',
    tags: [],
    status: 'draft',
    sessionName: null,
  })

  const sessionsResponse = await authed.get(
    `/api/campaigns/${defaultCampaignId}/sessions`,
  )
  assert.equal(sessionsResponse.status, 200)
  assert.equal(sessionsResponse.body.sessions.length, 2)

  const sessionNames = sessionsResponse.body.sessions.map(
    (s: { sessionName: string }) => s.sessionName,
  )
  assert.ok(sessionNames.includes('Session 5'))
  assert.ok(sessionNames.includes('Session 6'))

  const session5 = sessionsResponse.body.sessions.find(
    (s: { sessionName: string }) => s.sessionName === 'Session 5',
  )
  assert.equal(session5.noteCount, 2)

  const session6 = sessionsResponse.body.sessions.find(
    (s: { sessionName: string }) => s.sessionName === 'Session 6',
  )
  assert.equal(session6.noteCount, 1)
})

test('session listing requires authentication and campaign access', async (t) => {
  const { app, cleanup } = await createTestApp()
  t.after(cleanup)

  const unauthenticatedResponse = await request(app).get(
    `/api/campaigns/${defaultCampaignId}/sessions`,
  )
  assert.equal(unauthenticatedResponse.status, 401)

  const { token } = await registerOwner(request(app))
  const authed = withAuth(request(app), token)

  const nonExistentResponse = await authed.get(
    '/api/campaigns/non-existent-campaign/sessions',
  )
  assert.equal(nonExistentResponse.status, 404)
})

test('shared session listing endpoint returns sessions for guest members', async (t) => {
  const { app, cleanup } = await createTestApp()
  t.after(cleanup)

  const { token } = await registerOwner(request(app))
  const authed = withAuth(request(app), token)

  const shareLinkResponse = await authed
    .post(`/api/campaigns/${defaultCampaignId}/share-links`)
    .send({
      label: 'Session browse test',
      accessLevel: 'editor',
      frameAncestors: null,
    })
  assert.equal(shareLinkResponse.status, 201)
  const shareToken = shareLinkResponse.body.token as string

  const joinResponse = await request(app).post(`/api/shared/${shareToken}/join`).send({
    displayName: 'Theron',
  })
  assert.equal(joinResponse.status, 201)
  const guestToken = joinResponse.body.guestToken as string
  const guest = withGuest(request(app), guestToken)

  await guest.post(`/api/shared/${shareToken}/notes`).send({
    title: 'Dragon sighting',
    body: 'Red dragon spotted near the northern cliffs.',
    tags: ['encounter'],
    status: 'active',
    sessionName: 'Session 8',
  })

  const sessionsResponse = await guest.get(`/api/shared/${shareToken}/sessions`)
  assert.equal(sessionsResponse.status, 200)
  assert.equal(sessionsResponse.body.sessions.length, 1)
  assert.equal(sessionsResponse.body.sessions[0].sessionName, 'Session 8')
  assert.equal(sessionsResponse.body.sessions[0].noteCount, 1)

  const unauthenticatedResponse = await request(app).get(
    `/api/shared/${shareToken}/sessions`,
  )
  assert.equal(unauthenticatedResponse.status, 401)
})

test('note-to-note links support validation, cross-campaign blocking, and backlink discovery', async () => {
  const { app, cleanup } = await createTestApp()
  const { token: token1 } = await registerOwner(request(app), { email: 'user1@example.com' })
  const { token: token2 } = await registerOwner(request(app), { email: 'user2@example.com' })
  const authed1 = withAuth(request(app), token1)
  const authed2 = withAuth(request(app), token2)

  try {
    // Create notes in campaign 1
    const note1Response = await authed1.post('/api/notes').send({
      title: 'The Ancient Ruins',
      body: 'Strange markings found on the walls.',
      tags: ['location'],
      status: 'active',
      campaignId: defaultCampaignId,
    })
    assert.equal(note1Response.status, 201)
    const note1Id = note1Response.body.note.id as string

    const note2Response = await authed1.post('/api/notes').send({
      title: 'The Mysterious Artifact',
      body: 'An artifact found in the ruins.',
      tags: ['item'],
      status: 'active',
      campaignId: defaultCampaignId,
      linkedNoteIds: [note1Id],
    })
    assert.equal(note2Response.status, 201)
    const note2Id = note2Response.body.note.id as string
    assert.deepEqual(note2Response.body.note.linkedNoteIds, [note1Id])

    // Create note 3 linking to both note 1 and note 2
    const note3Response = await authed1.post('/api/notes').send({
      title: 'Quest: Investigate the Ruins',
      body: 'Find out what happened at the ruins.',
      tags: ['quest'],
      status: 'active',
      campaignId: defaultCampaignId,
      linkedNoteIds: [note1Id, note2Id],
    })
    assert.equal(note3Response.status, 201)
    const note3Id = note3Response.body.note.id as string
    assert.deepEqual(note3Response.body.note.linkedNoteIds, [note1Id, note2Id])

    // Get backlinks for note1 - should include note2 and note3
    const backlinks1Response = await authed1.get(`/api/notes/${note1Id}/backlinks`)
    assert.equal(backlinks1Response.status, 200)
    const backlinks1 = backlinks1Response.body.notes as Array<{ id: string; title: string }>
    assert.equal(backlinks1.length, 2)
    const backlinkIds = backlinks1.map((n) => n.id).sort()
    assert.deepEqual(backlinkIds, [note2Id, note3Id].sort())

    // Get backlinks for note2 - should include note3
    const backlinks2Response = await authed1.get(`/api/notes/${note2Id}/backlinks`)
    assert.equal(backlinks2Response.status, 200)
    const backlinks2 = backlinks2Response.body.notes as Array<{ id: string }>
    assert.equal(backlinks2.length, 1)
    assert.equal(backlinks2[0].id, note3Id)

    // Get backlinks for note3 - should be empty
    const backlinks3Response = await authed1.get(`/api/notes/${note3Id}/backlinks`)
    assert.equal(backlinks3Response.status, 200)
    assert.equal(backlinks3Response.body.notes.length, 0)

    // Update note to remove a link
    const updateResponse = await authed1.put(`/api/notes/${note3Id}`).send({
      title: 'Quest: Investigate the Ruins',
      body: 'Find out what happened at the ruins.',
      tags: ['quest'],
      status: 'active',
      sessionName: null,
      linkedNoteIds: [note1Id],
    })
    assert.equal(updateResponse.status, 200)
    assert.deepEqual(updateResponse.body.note.linkedNoteIds, [note1Id])

    // Verify backlinks updated
    const updatedBacklinks2Response = await authed1.get(`/api/notes/${note2Id}/backlinks`)
    assert.equal(updatedBacklinks2Response.status, 200)
    assert.equal(updatedBacklinks2Response.body.notes.length, 0)

    // Try to link to non-existent note - should fail
    const badLinkResponse = await authed1.post('/api/notes').send({
      title: 'Bad Link Test',
      body: 'This should fail.',
      tags: [],
      status: 'draft',
      campaignId: defaultCampaignId,
      linkedNoteIds: ['non-existent-id'],
    })
    assert.equal(badLinkResponse.status, 400)
    // Error should be in .error field
    const errorText = JSON.stringify(badLinkResponse.body).toLowerCase()
    assert.ok(errorText.includes('not found'))

    // Create a second campaign and note in it
    const campaign2Response = await authed2.post('/api/campaigns').send({
      name: 'Another Campaign',
      tagline: 'A different story',
      system: 'D&D 5e',
      setting: 'Eberron',
    })
    assert.equal(campaign2Response.status, 201)
    const campaign2Id = campaign2Response.body.campaign.id as string

    const campaign2NoteResponse = await authed2.post('/api/notes').send({
      title: 'Campaign 2 Note',
      body: 'A note in a different campaign.',
      tags: [],
      status: 'draft',
      campaignId: campaign2Id,
    })
    assert.equal(campaign2NoteResponse.status, 201)
    const campaign2NoteId = campaign2NoteResponse.body.note.id as string

    // Try to link across campaigns - should fail
    const crossCampaignLinkResponse = await authed1.post('/api/notes').send({
      title: 'Cross Campaign Link',
      body: 'This should fail.',
      tags: [],
      status: 'draft',
      campaignId: defaultCampaignId,
      linkedNoteIds: [campaign2NoteId],
    })
    assert.equal(crossCampaignLinkResponse.status, 400)
    const crossErrorText = JSON.stringify(crossCampaignLinkResponse.body).toLowerCase()
    assert.ok(crossErrorText.includes('not found') || crossErrorText.includes('same campaign'))

    // Backlinks require auth and campaign access
    const unauthBacklinksResponse = await request(app).get(`/api/notes/${note1Id}/backlinks`)
    assert.equal(unauthBacklinksResponse.status, 401)

    const wrongUserBacklinksResponse = await authed2.get(`/api/notes/${note1Id}/backlinks`)
    assert.equal(wrongUserBacklinksResponse.status, 403)

    // Backlinks return 404 for non-existent notes
    const notFoundBacklinksResponse = await authed1.get('/api/notes/fake-id/backlinks')
    assert.equal(notFoundBacklinksResponse.status, 404)

    // Validation rejects too many links
    const tooManyLinksResponse = await authed1.post('/api/notes').send({
      title: 'Too Many Links',
      body: 'This has too many links.',
      tags: [],
      status: 'draft',
      campaignId: defaultCampaignId,
      linkedNoteIds: Array(21).fill('some-id'),
    })
    assert.equal(tooManyLinksResponse.status, 400)
    assert.ok(
      tooManyLinksResponse.body.details.some((err: string) =>
        err.includes('Cannot link more than 20 notes'),
      ),
    )
  } finally {
    await cleanup()
  }
})

test('legacy databases without linked_notes_json column are upgraded safely', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dnd-notes-api-'))
  const dbPath = join(directory, 'notes.sqlite')

  try {
    // Create initial app and note
    const noteStore1 = createNoteStore({ dbPath })
    const app1 = createApp({ noteStore: noteStore1 })
    const { token } = await registerOwner(request(app1))
    const authed = withAuth(request(app1), token)

    const noteResponse = await authed.post('/api/notes').send({
      title: 'Test Note',
      body: 'Original content.',
      tags: ['test'],
      status: 'draft',
      campaignId: defaultCampaignId,
    })
    assert.equal(noteResponse.status, 201)
    const noteId = noteResponse.body.note.id as string

    // Close the first app
    noteStore1.close()

    // Directly manipulate the database to simulate legacy schema
    const db = new Database(dbPath)
    db.exec('DROP TABLE IF EXISTS note_references')
    const columns = db.pragma('table_info(notes)') as Array<{ name: string }>
    const hasLinkedNotesJson = columns.some((col) => col.name === 'linked_notes_json')

    if (hasLinkedNotesJson) {
      // Recreate table without linked_notes_json to simulate legacy database
      db.exec('ALTER TABLE notes RENAME TO notes_old')
      db.exec(`
        CREATE TABLE notes (
          id TEXT PRIMARY KEY,
          campaign_id TEXT NOT NULL,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          status TEXT NOT NULL,
          tags_json TEXT NOT NULL,
          session_name TEXT,
          created_by_membership_id TEXT,
          last_edited_by_membership_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `)
      db.exec(`
        INSERT INTO notes 
        SELECT id, campaign_id, title, body, status, tags_json, session_name, 
               created_by_membership_id, last_edited_by_membership_id, created_at, updated_at
        FROM notes_old
      `)
      db.exec('DROP TABLE notes_old')
    }
    db.close()

    // Recreate the app - should trigger migration
    const noteStore2 = createNoteStore({ dbPath })
    const app2 = createApp({ noteStore: noteStore2 })

    // Verify the note can be read and has empty linkedNoteIds
    const getResponse = await withAuth(request(app2), token).get(`/api/notes/${noteId}`)
    assert.equal(getResponse.status, 200)
    assert.ok(Array.isArray(getResponse.body.note.linkedNoteIds))
    assert.equal(getResponse.body.note.linkedNoteIds.length, 0)

    // Verify we can create notes with links after migration
    const linkedNoteResponse = await withAuth(request(app2), token).post('/api/notes').send({
      title: 'Linked Note',
      body: 'Links to the test note.',
      tags: [],
      status: 'draft',
      campaignId: defaultCampaignId,
      linkedNoteIds: [noteId],
    })
    assert.equal(linkedNoteResponse.status, 201)
    assert.deepEqual(linkedNoteResponse.body.note.linkedNoteIds, [noteId])

    noteStore2.close()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

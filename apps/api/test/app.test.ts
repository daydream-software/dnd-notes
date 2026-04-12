import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import request, { type SuperTest, type Test } from 'supertest'
import { createApp } from '../src/app.js'
import { defaultCampaignId } from '../src/campaign.js'
import { createNoteStore } from '../src/note-store.js'

async function createTestApp() {
  const directory = await mkdtemp(join(tmpdir(), 'dnd-notes-api-'))
  const dbPath = join(directory, 'notes.sqlite')
  const noteStore = createNoteStore({ dbPath })
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

test('GET /health returns service metadata', async (t) => {
  const { app, cleanup } = await createTestApp()
  t.after(cleanup)

  const response = await request(app).get('/health')

  assert.equal(response.status, 200)
  assert.equal(response.body.status, 'ok')
  assert.equal(response.body.service, 'dnd-notes-api')
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

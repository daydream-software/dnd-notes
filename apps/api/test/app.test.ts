import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
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

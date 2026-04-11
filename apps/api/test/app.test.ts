import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import request from 'supertest'
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
    async cleanup() {
      noteStore.close()
      await rm(directory, { recursive: true, force: true })
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

test('note CRUD endpoints support the main workflow', async (t) => {
  const { app, cleanup } = await createTestApp()
  t.after(cleanup)

  const createResponse = await request(app).post('/api/notes').send({
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

  const listResponse = await request(app).get('/api/notes')

  assert.equal(listResponse.status, 200)
  assert.equal(listResponse.body.notes.length, 1)

  const updateResponse = await request(app).put(`/api/notes/${noteId}`).send({
    title: 'Track the stone circle',
    body: 'The runes now point toward Moray and a hidden druid vault.',
    tags: ['moonwell'],
    status: 'active',
    sessionName: null,
  })

  assert.equal(updateResponse.status, 200)
  assert.equal(updateResponse.body.note.status, 'active')
  assert.equal(updateResponse.body.note.sessionName, null)

  const deleteResponse = await request(app).delete(`/api/notes/${noteId}`)

  assert.equal(deleteResponse.status, 204)

  const finalListResponse = await request(app).get('/api/notes')

  assert.equal(finalListResponse.body.notes.length, 0)
})

test('campaign endpoints support creation, update, membership, and scoped notes', async (t) => {
  const { app, cleanup } = await createTestApp()
  t.after(cleanup)

  const initialCampaignsResponse = await request(app).get('/api/campaigns')

  assert.equal(initialCampaignsResponse.status, 200)
  assert.equal(initialCampaignsResponse.body.campaigns.length, 1)
  assert.equal(initialCampaignsResponse.body.campaigns[0].id, defaultCampaignId)

  const createCampaignResponse = await request(app).post('/api/campaigns').send({
    name: 'Emberfall Accord',
    tagline: 'Track alliances, betrayals, and faction leverage across the city.',
    system: 'Dungeons & Dragons 2024',
    setting: 'Emberfall',
    nextSession: '2026-05-01T19:30:00.000Z',
  })

  assert.equal(createCampaignResponse.status, 201)
  assert.equal(createCampaignResponse.body.campaign.name, 'Emberfall Accord')

  const campaignId = createCampaignResponse.body.campaign.id as string

  const membershipsResponse = await request(app).get(
    `/api/campaigns/${campaignId}/memberships`,
  )

  assert.equal(membershipsResponse.status, 200)
  assert.equal(membershipsResponse.body.memberships.length, 1)
  assert.equal(membershipsResponse.body.memberships[0].role, 'owner')

  const createNoteResponse = await request(app).post('/api/notes').send({
    campaignId,
    title: 'Glass market informant',
    body: 'The broker in the lower market wants proof before naming the buyer.',
    tags: ['market', 'informant'],
    status: 'active',
    sessionName: 'Session 2',
  })

  assert.equal(createNoteResponse.status, 201)
  assert.equal(createNoteResponse.body.note.campaignId, campaignId)

  const scopedNotesResponse = await request(app)
    .get('/api/notes')
    .query({ campaignId })

  assert.equal(scopedNotesResponse.status, 200)
  assert.equal(scopedNotesResponse.body.notes.length, 1)
  assert.equal(scopedNotesResponse.body.notes[0].title, 'Glass market informant')

  const scopedOverviewResponse = await request(app)
    .get('/api/overview')
    .query({ campaignId })

  assert.equal(scopedOverviewResponse.status, 200)
  assert.equal(scopedOverviewResponse.body.campaign.id, campaignId)
  assert.equal(scopedOverviewResponse.body.stats.totalNotes, 1)

  const updateCampaignResponse = await request(app)
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
})

test('invalid note payloads return explicit errors', async (t) => {
  const { app, cleanup } = await createTestApp()
  t.after(cleanup)

  const response = await request(app).post('/api/notes').send({
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

test('notes persist across app recreation when using the same database file', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'dnd-notes-persist-'))
  const dbPath = join(directory, 'notes.sqlite')

  t.after(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  const firstStore = createNoteStore({ dbPath })
  const firstApp = createApp({ noteStore: firstStore })

  const createResponse = await request(firstApp).post('/api/notes').send({
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
  const listResponse = await request(secondApp).get('/api/notes')

  assert.equal(listResponse.status, 200)
  assert.equal(listResponse.body.notes.length, 1)
  assert.equal(listResponse.body.notes[0].title, 'Map the smugglers cave')
})

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import request from 'supertest'
import { createApp } from '../src/app.js'
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

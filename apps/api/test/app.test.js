import assert from 'node:assert/strict'
import test from 'node:test'
import request from 'supertest'
import { createApp } from '../src/app.js'

const app = createApp()

test('GET /health returns service metadata', async () => {
  const response = await request(app).get('/health')

  assert.equal(response.status, 200)
  assert.equal(response.body.status, 'ok')
  assert.equal(response.body.service, 'dnd-notes-api')
})

test('GET /api/overview returns starter campaign data', async () => {
  const response = await request(app).get('/api/overview')

  assert.equal(response.status, 200)
  assert.equal(response.body.campaign.name, 'Moonshae Ledger')
  assert.equal(response.body.notes.length, 3)
})

test('GET /api/notes/:noteId returns 404 for unknown notes', async () => {
  const response = await request(app).get('/api/notes/unknown-note')

  assert.equal(response.status, 404)
  assert.match(response.body.error, /unknown-note/)
})

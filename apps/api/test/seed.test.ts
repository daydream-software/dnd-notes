import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { defaultCampaignId } from '../src/campaign.js'
import { createNoteStore } from '../src/note-store.js'
import {
  resetStarterNotes,
  seedStarterNotes,
  starterNotes,
} from '../src/seed-data.js'

async function createTestStore() {
  const directory = await mkdtemp(join(tmpdir(), 'dnd-notes-seed-'))
  const dbPath = join(directory, 'notes.sqlite')
  const noteStore = await createNoteStore({ dbPath })

  return {
    noteStore,
    async cleanup() {
      await noteStore.close()
      await rm(directory, { recursive: true, force: true })
    },
  }
}

test('seed workflow populates an empty database with starter notes', async (t) => {
  const { noteStore, cleanup } = await createTestStore()
  t.after(cleanup)

  const result = await seedStarterNotes(noteStore)

  assert.deepEqual(result, {
    action: 'seed',
    status: 'seeded',
    noteCount: starterNotes.length,
  })

  const notes = await noteStore.listNotes()

  assert.equal(notes.length, starterNotes.length)
  assert.deepEqual(
    notes.map((note) => note.title),
    starterNotes.map((note) => note.title),
  )
  assert.deepEqual(
    notes.map((note) => note.campaignId),
    Array(starterNotes.length).fill(defaultCampaignId),
  )
  assert.equal((await noteStore.listCampaigns())[0]?.id, defaultCampaignId)
})

test('seed workflow skips existing data and reset replaces it with starter notes', async (t) => {
  const { noteStore, cleanup } = await createTestStore()
  t.after(cleanup)

  await seedStarterNotes(noteStore)
  await noteStore.createNote({
    title: 'Temporary test note',
    body: 'This should disappear after a reset.',
    tags: ['temporary'],
    status: 'draft',
    sessionName: null,
  })

  const skippedResult = await seedStarterNotes(noteStore)

  assert.deepEqual(skippedResult, {
    action: 'seed',
    status: 'skipped',
    existingCount: starterNotes.length + 1,
  })

  const resetResult = await resetStarterNotes(noteStore)

  assert.deepEqual(resetResult, {
    action: 'reset',
    status: 'seeded',
    noteCount: starterNotes.length,
  })

  const titles = (await noteStore.listNotes()).map((note) => note.title)

  assert.equal(titles.includes('Temporary test note'), false)
  assert.deepEqual(titles, starterNotes.map((note) => note.title))
})

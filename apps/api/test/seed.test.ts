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
  const noteStore = createNoteStore({ dbPath })

  return {
    noteStore,
    async cleanup() {
      noteStore.close()
      await rm(directory, { recursive: true, force: true })
    },
  }
}

test('seed workflow populates an empty database with starter notes', async (t) => {
  const { noteStore, cleanup } = await createTestStore()
  t.after(cleanup)

  const result = seedStarterNotes(noteStore)

  assert.deepEqual(result, {
    action: 'seed',
    status: 'seeded',
    noteCount: starterNotes.length,
  })

  const notes = noteStore.listNotes()

  assert.equal(notes.length, starterNotes.length)
  assert.deepEqual(
    notes.map((note) => note.title),
    starterNotes.map((note) => note.title),
  )
  assert.deepEqual(
    notes.map((note) => note.campaignId),
    Array(starterNotes.length).fill(defaultCampaignId),
  )
  assert.equal(noteStore.listCampaigns()[0]?.id, defaultCampaignId)
})

test('seed workflow skips existing data and reset replaces it with starter notes', async (t) => {
  const { noteStore, cleanup } = await createTestStore()
  t.after(cleanup)

  seedStarterNotes(noteStore)
  noteStore.createNote({
    title: 'Temporary test note',
    body: 'This should disappear after a reset.',
    tags: ['temporary'],
    status: 'draft',
    sessionName: null,
  })

  const skippedResult = seedStarterNotes(noteStore)

  assert.deepEqual(skippedResult, {
    action: 'seed',
    status: 'skipped',
    existingCount: starterNotes.length + 1,
  })

  const resetResult = resetStarterNotes(noteStore)

  assert.deepEqual(resetResult, {
    action: 'reset',
    status: 'seeded',
    noteCount: starterNotes.length,
  })

  const titles = noteStore.listNotes().map((note) => note.title)

  assert.equal(titles.includes('Temporary test note'), false)
  assert.deepEqual(titles, starterNotes.map((note) => note.title))
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultCampaignId } from '../src/campaign.js'
import { createNoteStore } from '../src/note-store.js'
import { resolveSeedTarget } from '../src/seed-target.js'
import {
  resetStarterNotes,
  seedStarterNotes,
  starterNotes,
} from '../src/seed-data.js'
import { createTestPgMemPool } from './test-helpers.js'

async function createTestStore() {
  const { pool } = createTestPgMemPool()
  const noteStore = await createNoteStore({ postgresPool: pool })

  return {
    noteStore,
    async cleanup() {
      await noteStore.close()
      await pool.end()
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

test('seed target uses postgres when DATABASE_URL is configured', () => {
  assert.deepEqual(
    resolveSeedTarget({
      DATABASE_URL: 'postgresql://db.example/dnd-notes',
    } as NodeJS.ProcessEnv),
    {
      noteStoreOptions: {
        databaseUrl: 'postgresql://db.example/dnd-notes',
      },
      label: 'postgres',
    },
  )
})

test('seed target trims DATABASE_URL before passing it to the note store', () => {
  assert.deepEqual(
    resolveSeedTarget({
      DATABASE_URL: '  postgresql://db.example/dnd-notes  ',
    } as NodeJS.ProcessEnv),
    {
      noteStoreOptions: {
        databaseUrl: 'postgresql://db.example/dnd-notes',
      },
      label: 'postgres',
    },
  )
})

test('seed target requires DATABASE_URL in the postgres-only runtime', () => {
  assert.throws(
    () => resolveSeedTarget({} as NodeJS.ProcessEnv),
    /DATABASE_URL is required for seed workflows in the Postgres-only API runtime\./,
  )
})

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { defaultCampaignId } from '../src/campaign.js'
import { parseInlineNoteReferences } from '../src/note-references.js'
import { createNoteStore } from '../src/note-store.js'

const runtimeDirectory = join(dirname(fileURLToPath(import.meta.url)), '.runtime')

async function createPersistentDbPath() {
  await mkdir(runtimeDirectory, { recursive: true })
  return join(runtimeDirectory, `${randomUUID()}.sqlite`)
}

test('parseInlineNoteReferences supports canonical note syntaxes', () => {
  const references = parseInlineNoteReferences(
    'See ![[note-a]], ![[note-b|Relic]], and ![[note-c|The Pact|foreshadowing]].',
  )

  assert.deepEqual(
    references.map((reference) => ({
      targetNoteId: reference.targetNoteId,
      label: reference.label,
      qualifier: reference.qualifier,
    })),
    [
      { targetNoteId: 'note-a', label: null, qualifier: null },
      { targetNoteId: 'note-b', label: 'Relic', qualifier: null },
      {
        targetNoteId: 'note-c',
        label: 'The Pact',
        qualifier: 'foreshadowing',
      },
    ],
  )

  assert.throws(
    () => parseInlineNoteReferences('Broken ![[note-a||qualifier]] reference'),
    /Use !\[\[noteId\]\], !\[\[noteId\|label\]\], or !\[\[noteId\|label\|qualifier\]\]\./,
  )
})

test('note store extracts structured references while preserving linkedNoteIds compatibility', (t) => {
  const noteStore = createNoteStore({ dbPath: ':memory:' })
  t.after(() => noteStore.close())

  const ruins = noteStore.createNote({
    title: 'Ancient Ruins',
    body: 'Collapsed stone and old magic.',
    tags: ['location'],
    status: 'active',
    sessionName: null,
    campaignId: defaultCampaignId,
  })
  const relic = noteStore.createNote({
    title: 'Sun Relic',
    body: 'Recovered from the vault.',
    tags: ['item'],
    status: 'active',
    sessionName: null,
    campaignId: defaultCampaignId,
  })
  const patron = noteStore.createNote({
    title: 'Whispering Patron',
    body: 'Keeps asking for a favor.',
    tags: ['npc'],
    status: 'draft',
    sessionName: null,
    campaignId: defaultCampaignId,
  })

  const quest = noteStore.createNote({
    title: 'Quest Hook',
    body:
      `Start at ![[${ruins.id}]], recover ![[${relic.id}|Sun Relic]], ` +
      `and trace ![[${ruins.id}|Ancient Ruins|origin]].`,
    tags: ['quest'],
    status: 'active',
    sessionName: null,
    campaignId: defaultCampaignId,
    linkedNoteIds: [patron.id],
  })

  assert.deepEqual(quest.linkedNoteIds, [patron.id, ruins.id, relic.id])
  assert.deepEqual(
    quest.references.map((reference) => ({
      targetNoteId: reference.targetNoteId,
      referenceType: reference.referenceType,
      label: reference.label,
      qualifier: reference.qualifier,
    })),
    [
      {
        targetNoteId: patron.id,
        referenceType: 'linked',
        label: null,
        qualifier: null,
      },
      {
        targetNoteId: ruins.id,
        referenceType: 'inline',
        label: null,
        qualifier: null,
      },
      {
        targetNoteId: relic.id,
        referenceType: 'inline',
        label: 'Sun Relic',
        qualifier: null,
      },
      {
        targetNoteId: ruins.id,
        referenceType: 'inline',
        label: 'Ancient Ruins',
        qualifier: 'origin',
      },
    ],
  )

  const persistedQuest = noteStore.getNote(quest.id)
  assert.ok(persistedQuest)
  assert.equal(
    persistedQuest.references.find((reference) => reference.qualifier === 'origin')?.label,
    'Ancient Ruins',
  )

  assert.deepEqual(
    noteStore.getBacklinks(ruins.id).map((note) => note.id),
    [quest.id],
  )
  assert.deepEqual(
    noteStore.getBacklinks(relic.id).map((note) => note.id),
    [quest.id],
  )
  assert.deepEqual(
    noteStore.getBacklinks(patron.id).map((note) => note.id),
    [quest.id],
  )

  const updatedQuest = noteStore.updateNote(quest.id, {
    title: quest.title,
    body: `Only follow ![[${ruins.id}|Ancient Ruins|origin]].`,
    tags: quest.tags,
    status: quest.status,
    sessionName: quest.sessionName,
    linkedNoteIds: [],
  })

  assert.ok(updatedQuest)
  assert.deepEqual(updatedQuest.linkedNoteIds, [ruins.id])
  assert.equal(updatedQuest.references.length, 1)
  assert.equal(updatedQuest.references[0].qualifier, 'origin')
  assert.equal(noteStore.getBacklinks(relic.id).length, 0)
  assert.equal(noteStore.getBacklinks(patron.id).length, 0)
})

test('note store rejects malformed, missing, and cross-campaign inline references', () => {
  const noteStore = createNoteStore({ dbPath: ':memory:' })
  const owner = noteStore.createOwnerAccount({
    displayName: 'Data',
    email: 'data@example.com',
    password: 'moonlit-secret',
  })

  assert.ok(owner)

  const foreignCampaign = noteStore.createCampaign(
    {
      name: 'Foreign Campaign',
      tagline: 'Different trouble',
      system: 'D&D 5e',
      setting: 'Eberron',
      nextSession: null,
    },
    owner,
  )

  const foreignNote = noteStore.createNote({
    title: 'Elsewhere',
    body: 'Not part of the default campaign.',
    tags: [],
    status: 'draft',
    sessionName: null,
    campaignId: foreignCampaign.id,
  })

  assert.throws(
    () =>
      noteStore.createNote({
        title: 'Malformed',
        body: 'Broken ![[missing||qualifier]] reference.',
        tags: [],
        status: 'draft',
        sessionName: null,
        campaignId: defaultCampaignId,
      }),
    /Use !\[\[noteId\]\], !\[\[noteId\|label\]\], or !\[\[noteId\|label\|qualifier\]\]\./,
  )

  assert.throws(
    () =>
      noteStore.createNote({
        title: 'Missing target',
        body: 'Points at ![[does-not-exist|Ghost]].',
        tags: [],
        status: 'draft',
        sessionName: null,
        campaignId: defaultCampaignId,
      }),
    /Referenced note "does-not-exist" was not found\./,
  )

  assert.throws(
    () =>
      noteStore.createNote({
        title: 'Wrong campaign',
        body: `Points at ![[${foreignNote.id}|Foreign clue]].`,
        tags: [],
        status: 'draft',
        sessionName: null,
        campaignId: defaultCampaignId,
      }),
    /must be in the same campaign\./,
  )

  noteStore.close()
})

test('persistent stores backfill references from note bodies and linkedNoteIds on startup', async (t) => {
  const dbPath = await createPersistentDbPath()
  let noteStore = createNoteStore({ dbPath })

  t.after(async () => {
    noteStore.close()
    await rm(dbPath, { force: true })
  })

  const target = noteStore.createNote({
    title: 'Target',
    body: 'Anchor note.',
    tags: [],
    status: 'active',
    sessionName: null,
    campaignId: defaultCampaignId,
  })
  const legacyLinked = noteStore.createNote({
    title: 'Legacy Linked',
    body: 'Uses legacy linkedNoteIds only.',
    tags: [],
    status: 'active',
    sessionName: null,
    campaignId: defaultCampaignId,
    linkedNoteIds: [target.id],
  })
  const inlineLinked = noteStore.createNote({
    title: 'Inline Linked',
    body: `Uses ![[${target.id}|Target|clue]] in the body.`,
    tags: [],
    status: 'active',
    sessionName: null,
    campaignId: defaultCampaignId,
  })

  noteStore.close()

  const database = new Database(dbPath)
  database.exec('DROP TABLE note_references')
  database.close()

  noteStore = createNoteStore({ dbPath })

  const reloadedLegacy = noteStore.getNote(legacyLinked.id)
  const reloadedInline = noteStore.getNote(inlineLinked.id)

  assert.ok(reloadedLegacy)
  assert.ok(reloadedInline)
  assert.deepEqual(reloadedLegacy.linkedNoteIds, [target.id])
  assert.deepEqual(reloadedInline.linkedNoteIds, [target.id])
  assert.equal(reloadedInline.references[0].qualifier, 'clue')

  const backlinkIds = noteStore
    .getBacklinks(target.id)
    .map((note) => note.id)
    .sort()
  assert.deepEqual(backlinkIds, [inlineLinked.id, legacyLinked.id].sort())
})

import assert from 'node:assert/strict'
import test from 'node:test'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { defaultCampaignId } from '../src/campaign.js'
import { createNoteStore } from '../src/note-store.js'
import {
  createTestApp,
  createTestPgMemPool,
  registerOwner,
  withAuth,
  withGuest,
} from './test-helpers.js'

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
  const { pool } = createTestPgMemPool()
  t.after(async () => {
    await pool.end()
  })

  const firstStore = await createNoteStore({ postgresPool: pool })
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
  await firstStore.close()

  const secondStore = await createNoteStore({ postgresPool: pool })
  t.after(async () => {
    await secondStore.close()
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

    const backlinks1Response = await authed1.get(`/api/notes/${note1Id}/backlinks`)
    assert.equal(backlinks1Response.status, 200)
    const backlinks1 = backlinks1Response.body.notes as Array<{ id: string; title: string }>
    assert.equal(backlinks1.length, 2)
    const backlinkIds = backlinks1.map((n) => n.id).sort()
    assert.deepEqual(backlinkIds, [note2Id, note3Id].sort())

    const backlinks2Response = await authed1.get(`/api/notes/${note2Id}/backlinks`)
    assert.equal(backlinks2Response.status, 200)
    const backlinks2 = backlinks2Response.body.notes as Array<{ id: string }>
    assert.equal(backlinks2.length, 1)
    assert.equal(backlinks2[0].id, note3Id)

    const backlinks3Response = await authed1.get(`/api/notes/${note3Id}/backlinks`)
    assert.equal(backlinks3Response.status, 200)
    assert.equal(backlinks3Response.body.notes.length, 0)

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

    const updatedBacklinks2Response = await authed1.get(`/api/notes/${note2Id}/backlinks`)
    assert.equal(updatedBacklinks2Response.status, 200)
    assert.equal(updatedBacklinks2Response.body.notes.length, 0)

    const badLinkResponse = await authed1.post('/api/notes').send({
      title: 'Bad Link Test',
      body: 'This should fail.',
      tags: [],
      status: 'draft',
      campaignId: defaultCampaignId,
      linkedNoteIds: ['non-existent-id'],
    })
    assert.equal(badLinkResponse.status, 400)
    const errorText = JSON.stringify(badLinkResponse.body).toLowerCase()
    assert.ok(errorText.includes('not found'))

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

    const unauthBacklinksResponse = await request(app).get(`/api/notes/${note1Id}/backlinks`)
    assert.equal(unauthBacklinksResponse.status, 401)

    const wrongUserBacklinksResponse = await authed2.get(`/api/notes/${note1Id}/backlinks`)
    assert.equal(wrongUserBacklinksResponse.status, 403)

    const notFoundBacklinksResponse = await authed1.get('/api/notes/fake-id/backlinks')
    assert.equal(notFoundBacklinksResponse.status, 404)

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

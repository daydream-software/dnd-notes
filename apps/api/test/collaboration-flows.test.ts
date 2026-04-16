import assert from 'node:assert/strict'
import test from 'node:test'
import request from 'supertest'
import { defaultCampaignId } from '../src/campaign.js'
import {
  createTestApp,
  registerOwner,
  withAuth,
  withGuest,
} from './test-helpers.js'

function findNoteById(notes: Array<{ id: string }>, noteId: string) {
  const note = notes.find((candidate) => candidate.id === noteId)
  assert.ok(note)
  return note
}

test('recent activity returns collaborator summaries, supports filters, and rejects foreign memberships', async (t) => {
  const { app, cleanup } = await createTestApp()
  t.after(cleanup)

  const { token } = await registerOwner(request(app))
  const authed = withAuth(request(app), token)

  const RealDate = Date
  const fixedIso = new RealDate().toISOString()

  class FixedDate extends RealDate {
    constructor(value?: string | number) {
      super(value ?? fixedIso)
    }

    static now() {
      return new RealDate(fixedIso).getTime()
    }

    static parse(value: string) {
      return RealDate.parse(value)
    }

    static UTC(...args: Parameters<typeof RealDate.UTC>) {
      return RealDate.UTC(...args)
    }
  }

  let ownerNoteId: string | undefined

  globalThis.Date = FixedDate as unknown as DateConstructor

  try {
    const ownerCreateResponse = await authed.post('/api/notes').send({
      campaignId: defaultCampaignId,
      title: 'Owner watch list',
      body: 'Track the city watch near the moonwell.',
      tags: ['watch'],
      status: 'draft',
      sessionName: 'Session 19',
    })
    assert.equal(ownerCreateResponse.status, 201)
    ownerNoteId = ownerCreateResponse.body.note.id as string

    const ownerUpdateResponse = await authed.put(`/api/notes/${ownerNoteId}`).send({
      title: 'Owner watch list',
      body: 'Track the city watch near the moonwell and the harbor gate.',
      tags: ['watch', 'harbor'],
      status: 'active',
      sessionName: 'Session 19',
    })
    assert.equal(ownerUpdateResponse.status, 200)
    assert.notEqual(
      ownerUpdateResponse.body.note.updatedAt,
      ownerUpdateResponse.body.note.createdAt,
    )
  } finally {
    globalThis.Date = RealDate
  }

  const shareLinkResponse = await authed
    .post(`/api/campaigns/${defaultCampaignId}/share-links`)
    .send({
      label: 'Activity link',
      accessLevel: 'editor',
      frameAncestors: null,
    })
  assert.equal(shareLinkResponse.status, 201)

  const shareToken = shareLinkResponse.body.token as string
  const joinResponse = await request(app).post(`/api/shared/${shareToken}/join`).send({
    displayName: 'Mira',
  })
  assert.equal(joinResponse.status, 201)

  const guestToken = joinResponse.body.guestToken as string
  const guestMembershipId = joinResponse.body.membership.id as string
  const guest = withGuest(request(app), guestToken)

  const guestCreateResponse = await guest.post(`/api/shared/${shareToken}/notes`).send({
    title: 'Scout route update',
    body: 'The ridge path is clear until the ruined tower.',
    tags: ['scout'],
    status: 'draft',
    sessionName: 'Session 19',
  })
  assert.equal(guestCreateResponse.status, 201)

  const otherCampaignResponse = await authed.post('/api/campaigns').send({
    name: 'Second campaign',
    tagline: 'Used to validate foreign collaborator filters.',
    system: 'Dungeons & Dragons 2024',
    setting: 'The West Marches',
    nextSession: null,
  })
  assert.equal(otherCampaignResponse.status, 201)

  const otherCampaignId = otherCampaignResponse.body.campaign.id as string
  const otherMembershipsResponse = await authed.get(
    `/api/campaigns/${otherCampaignId}/memberships`,
  )
  assert.equal(otherMembershipsResponse.status, 200)
  const foreignMembershipId = otherMembershipsResponse.body.memberships[0].id as string

  const activityResponse = await authed
    .get('/api/notes/activity')
    .query({ campaignId: defaultCampaignId })
  assert.equal(activityResponse.status, 200)
  assert.equal(activityResponse.body.campaign.id, defaultCampaignId)
  assert.ok(ownerNoteId)
  assert.deepEqual(
    activityResponse.body.collaborators.map(
      (collaborator: { displayName: string; noteCount: number }) => [
        collaborator.displayName,
        collaborator.noteCount,
      ],
    ),
    [
      ['Aela', 1],
      ['Mira', 1],
    ],
  )
  assert.equal(activityResponse.body.activity.length, 2)

  const ownerActivity = findNoteById(
    activityResponse.body.activity as Array<{
      id: string
      title: string
      action: string
      createdBy: { displayName: string } | null
      lastEditedBy: { displayName: string } | null
    }>,
    ownerNoteId,
  )
  assert.equal(ownerActivity.title, 'Owner watch list')
  assert.equal(ownerActivity.action, 'edited')
  assert.equal(ownerActivity.createdBy?.displayName, 'Aela')
  assert.equal(ownerActivity.lastEditedBy?.displayName, 'Aela')

  const guestActivity = findNoteById(
    activityResponse.body.activity as Array<{
      id: string
      title: string
      action: string
      createdBy: { displayName: string } | null
    }>,
    guestCreateResponse.body.note.id as string,
  )
  assert.equal(guestActivity.title, 'Scout route update')
  assert.equal(guestActivity.action, 'created')
  assert.equal(guestActivity.createdBy?.displayName, 'Mira')

  const filteredActivityResponse = await authed.get('/api/notes/activity').query({
    campaignId: defaultCampaignId,
    membershipId: guestMembershipId,
  })
  assert.equal(filteredActivityResponse.status, 200)
  assert.equal(filteredActivityResponse.body.activity.length, 1)
  assert.equal(filteredActivityResponse.body.activity[0].title, 'Scout route update')
  assert.equal(filteredActivityResponse.body.collaborators.length, 2)

  const foreignFilterResponse = await authed.get('/api/notes/activity').query({
    campaignId: defaultCampaignId,
    membershipId: foreignMembershipId,
  })
  assert.equal(foreignFilterResponse.status, 400)
  assert.equal(
    foreignFilterResponse.body.error,
    'Activity membership filter is invalid for this campaign.',
  )
})

test('claimed collaborators can load recent activity for accessible campaigns', async (t) => {
  const { app, cleanup } = await createTestApp()
  t.after(cleanup)

  const { token } = await registerOwner(request(app))
  const authed = withAuth(request(app), token)

  const shareLinkResponse = await authed
    .post(`/api/campaigns/${defaultCampaignId}/share-links`)
    .send({
      label: 'Claimable activity link',
      accessLevel: 'editor',
      frameAncestors: null,
    })
  assert.equal(shareLinkResponse.status, 201)

  const shareToken = shareLinkResponse.body.token as string
  const joinResponse = await request(app).post(`/api/shared/${shareToken}/join`).send({
    displayName: 'Mira',
  })
  assert.equal(joinResponse.status, 201)

  const guestToken = joinResponse.body.guestToken as string
  const guestMembershipId = joinResponse.body.membership.id as string
  const guest = withGuest(request(app), guestToken)

  const guestCreateResponse = await guest.post(`/api/shared/${shareToken}/notes`).send({
    title: 'Moonwell timing',
    body: 'The moonwell opens when the second bell rings.',
    tags: ['moonwell'],
    status: 'active',
    sessionName: 'Session 20',
  })
  assert.equal(guestCreateResponse.status, 201)

  const claimant = await registerOwner(request(app), {
    displayName: 'Mira Vale',
    email: 'mira.activity@example.com',
    password: 'mira-activity-claim',
  })

  const claimResponse = await request(app)
    .post(`/api/shared/${shareToken}/membership/claim`)
    .set('Authorization', `Bearer ${claimant.token}`)
    .set('X-Guest-Token', guestToken)
  assert.equal(claimResponse.status, 200)
  assert.equal(claimResponse.body.membership.id, guestMembershipId)

  const claimedAuthed = withAuth(request(app), claimant.token)
  const activityResponse = await claimedAuthed.get('/api/notes/activity').query({
    campaignId: defaultCampaignId,
    membershipId: guestMembershipId,
  })
  assert.equal(activityResponse.status, 200)
  assert.equal(activityResponse.body.campaign.id, defaultCampaignId)
  assert.equal(activityResponse.body.collaborators.length, 1)
  assert.equal(activityResponse.body.collaborators[0].membershipId, guestMembershipId)
  assert.equal(activityResponse.body.activity.length, 1)
  assert.equal(activityResponse.body.activity[0].title, 'Moonwell timing')
  assert.equal(activityResponse.body.activity[0].createdBy.membershipId, guestMembershipId)
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

test('shared guest joins are rate limited per link after repeated attempts', async (t) => {
  const { app, cleanup } = await createTestApp()
  t.after(cleanup)

  const { token } = await registerOwner(request(app))
  const authed = withAuth(request(app), token)
  const shareLinkResponse = await authed
    .post(`/api/campaigns/${defaultCampaignId}/share-links`)
    .send({
      label: 'Rate-limited join link',
      accessLevel: 'editor',
      frameAncestors: null,
    })
  assert.equal(shareLinkResponse.status, 201)

  const shareToken = shareLinkResponse.body.token as string

  for (let index = 0; index < 10; index += 1) {
    const response = await request(app).post(`/api/shared/${shareToken}/join`).send({
      displayName: `Guest ${index}`,
    })

    assert.equal(response.status, 201)
  }

  const limitedResponse = await request(app).post(`/api/shared/${shareToken}/join`).send({
    displayName: 'Guest Final',
  })

  assert.equal(limitedResponse.status, 429)
  assert.equal(
    limitedResponse.body.error,
    'Too many guest join attempts. Please wait before trying again.',
  )
  assert.equal(typeof limitedResponse.headers['retry-after'], 'string')
})

test('guests can claim an existing membership with a real account without losing attribution', async (t) => {
  const { app, cleanup } = await createTestApp()
  t.after(cleanup)

  const { token } = await registerOwner(request(app))
  const authed = withAuth(request(app), token)

  const shareLinkResponse = await authed
    .post(`/api/campaigns/${defaultCampaignId}/share-links`)
    .send({
      label: 'Claimable editor link',
      accessLevel: 'editor',
      frameAncestors: null,
    })
  assert.equal(shareLinkResponse.status, 201)

  const shareToken = shareLinkResponse.body.token as string
  const joinResponse = await request(app).post(`/api/shared/${shareToken}/join`).send({
    displayName: 'Mira',
  })
  assert.equal(joinResponse.status, 201)
  assert.equal(joinResponse.body.membership.userId, null)

  const guestToken = joinResponse.body.guestToken as string
  const guest = withGuest(request(app), guestToken)

  const createNoteResponse = await guest.post(`/api/shared/${shareToken}/notes`).send({
    title: 'Claimed under the same actor',
    body: 'The moonwell sigil was mapped before the account upgrade.',
    tags: ['moonwell'],
    status: 'draft',
    sessionName: 'Session 18',
  })
  assert.equal(createNoteResponse.status, 201)
  assert.equal(createNoteResponse.body.note.createdBy.displayName, 'Mira')

  const noteId = createNoteResponse.body.note.id as string
  const membershipId = createNoteResponse.body.note.createdBy.membershipId as string

  const claimant = await registerOwner(request(app), {
    displayName: 'Mira Vale',
    email: 'mira@example.com',
    password: 'mira-claims-history',
  })

  const claimResponse = await request(app)
    .post(`/api/shared/${shareToken}/membership/claim`)
    .set('Authorization', `Bearer ${claimant.token}`)
    .set('X-Guest-Token', guestToken)
  assert.equal(claimResponse.status, 200)
  assert.equal(claimResponse.body.membership.id, joinResponse.body.membership.id)
  assert.equal(claimResponse.body.membership.userId, claimant.owner.id)
  assert.equal(claimResponse.body.membership.displayName, 'Mira')
  assert.equal(typeof claimResponse.body.guestToken, 'string')
  assert.notEqual(claimResponse.body.guestToken, guestToken)

  const claimedAuthed = withAuth(request(app), claimant.token)
  const claimedCampaignsResponse = await claimedAuthed.get('/api/campaigns')
  assert.equal(claimedCampaignsResponse.status, 200)
  assert.equal(claimedCampaignsResponse.body.campaigns.length, 1)
  assert.equal(claimedCampaignsResponse.body.campaigns[0].id, defaultCampaignId)

  const claimedCampaignResponse = await claimedAuthed.get(`/api/campaigns/${defaultCampaignId}`)
  assert.equal(claimedCampaignResponse.status, 200)
  assert.equal(claimedCampaignResponse.body.campaign.id, defaultCampaignId)

  const claimedOverviewResponse = await claimedAuthed.get('/api/overview')
  assert.equal(claimedOverviewResponse.status, 200)
  assert.equal(claimedOverviewResponse.body.campaign.id, defaultCampaignId)
  assert.equal(claimedOverviewResponse.body.membership.id, membershipId)
  assert.equal(claimedOverviewResponse.body.membership.role, 'guest')

  const claimedSessionsResponse = await claimedAuthed
    .get('/api/notes/sessions')
    .query({ campaignId: defaultCampaignId })
  assert.equal(claimedSessionsResponse.status, 200)
  assert.equal(claimedSessionsResponse.body.sessions.length, 1)
  assert.equal(claimedSessionsResponse.body.sessions[0].sessionName, 'Session 18')
  assert.equal(claimedSessionsResponse.body.sessions[0].noteCount, 1)
  assert.match(
    claimedSessionsResponse.body.sessions[0].latestActivity,
    /^\d{4}-\d{2}-\d{2}T/,
  )

  const claimedSessionNotesResponse = await claimedAuthed
    .get(`/api/notes/sessions/${encodeURIComponent('Session 18')}`)
    .query({ campaignId: defaultCampaignId })
  assert.equal(claimedSessionNotesResponse.status, 200)
  assert.equal(claimedSessionNotesResponse.body.notes.length, 1)
  assert.equal(claimedSessionNotesResponse.body.notes[0].id, noteId)

  const claimedCreateNoteResponse = await claimedAuthed.post('/api/notes').send({
    campaignId: defaultCampaignId,
    title: 'Follow-up under the linked account',
    body: 'Creating from the authenticated app should keep the guest membership actor.',
    tags: ['claim', 'follow-up'],
    status: 'active',
    sessionName: null,
  })
  assert.equal(claimedCreateNoteResponse.status, 201)
  assert.equal(claimedCreateNoteResponse.body.note.createdBy.membershipId, membershipId)
  assert.equal(claimedCreateNoteResponse.body.note.createdBy.role, 'guest')
  assert.equal(claimedCreateNoteResponse.body.note.createdBy.displayName, 'Mira')

  const staleSessionResponse = await guest.get(`/api/shared/${shareToken}/session`)
  assert.equal(staleSessionResponse.status, 200)
  assert.equal(staleSessionResponse.body.membership, null)
  const staleOverviewResponse = await guest.get(`/api/shared/${shareToken}/overview`)
  assert.equal(staleOverviewResponse.status, 401)

  const renewedGuestToken = claimResponse.body.guestToken as string
  const renewedGuest = withGuest(request(app), renewedGuestToken)
  const restoredSessionResponse = await renewedGuest.get(`/api/shared/${shareToken}/session`)
  assert.equal(restoredSessionResponse.status, 200)
  assert.equal(restoredSessionResponse.body.membership.userId, claimant.owner.id)

  const updateNoteResponse = await renewedGuest
    .put(`/api/shared/${shareToken}/notes/${noteId}`)
    .send({
      title: 'Claimed under the same actor',
      body: 'The moonwell sigil stayed on the same membership after linking the account.',
      tags: ['moonwell', 'claim'],
      status: 'active',
      sessionName: null,
    })
  assert.equal(updateNoteResponse.status, 200)
  assert.equal(updateNoteResponse.body.note.createdBy.membershipId, membershipId)
  assert.equal(updateNoteResponse.body.note.createdBy.displayName, 'Mira')
  assert.equal(updateNoteResponse.body.note.lastEditedBy.membershipId, membershipId)
  assert.equal(updateNoteResponse.body.note.lastEditedBy.displayName, 'Mira')
})

test('shared membership claims are rate limited after repeated attempts', async (t) => {
  const { app, cleanup } = await createTestApp()
  t.after(cleanup)

  const { token } = await registerOwner(request(app))
  const authed = withAuth(request(app), token)
  const shareLinkResponse = await authed
    .post(`/api/campaigns/${defaultCampaignId}/share-links`)
    .send({
      label: 'Rate-limited claim link',
      accessLevel: 'editor',
      frameAncestors: null,
    })
  assert.equal(shareLinkResponse.status, 201)

  const shareToken = shareLinkResponse.body.token as string
  const joinResponse = await request(app).post(`/api/shared/${shareToken}/join`).send({
    displayName: 'Claim Target',
  })
  assert.equal(joinResponse.status, 201)

  const claimant = await registerOwner(request(app), {
    displayName: 'Claimant',
    email: 'claim-rate-limit@example.com',
    password: 'claim-rate-limit-password',
  })

  let activeGuestToken = joinResponse.body.guestToken as string

  for (let index = 0; index < 5; index += 1) {
    const response = await request(app)
      .post(`/api/shared/${shareToken}/membership/claim`)
      .set('Authorization', `Bearer ${claimant.token}`)
      .set('X-Guest-Token', activeGuestToken)

    assert.equal(response.status, 200)

    if (typeof response.body.guestToken === 'string') {
      activeGuestToken = response.body.guestToken
    }
  }

  const limitedResponse = await request(app)
    .post(`/api/shared/${shareToken}/membership/claim`)
    .set('Authorization', `Bearer ${claimant.token}`)
    .set('X-Guest-Token', activeGuestToken)

  assert.equal(limitedResponse.status, 429)
  assert.equal(
    limitedResponse.body.error,
    'Too many membership claim attempts. Please wait before trying again.',
  )
  assert.equal(typeof limitedResponse.headers['retry-after'], 'string')
})

test('owners can preview and consolidate note attribution onto another membership', async (t) => {
  const { app, cleanup } = await createTestApp()
  t.after(cleanup)

  const { token } = await registerOwner(request(app))
  const authed = withAuth(request(app), token)

  const shareLinkResponse = await authed
    .post(`/api/campaigns/${defaultCampaignId}/share-links`)
    .send({
      label: 'Consolidation link',
      accessLevel: 'editor',
      frameAncestors: null,
    })
  assert.equal(shareLinkResponse.status, 201)

  const shareToken = shareLinkResponse.body.token as string

  const sourceJoinResponse = await request(app)
    .post(`/api/shared/${shareToken}/join`)
    .send({ displayName: 'Mira (Safari)' })
  assert.equal(sourceJoinResponse.status, 201)

  const targetJoinResponse = await request(app)
    .post(`/api/shared/${shareToken}/join`)
    .send({ displayName: 'Mira' })
  assert.equal(targetJoinResponse.status, 201)

  const sourceMembershipId = sourceJoinResponse.body.membership.id as string
  const targetMembershipId = targetJoinResponse.body.membership.id as string
  const sourceGuest = withGuest(request(app), sourceJoinResponse.body.guestToken as string)
  const targetGuest = withGuest(request(app), targetJoinResponse.body.guestToken as string)

  const sourceOwnedNoteResponse = await sourceGuest.post(`/api/shared/${shareToken}/notes`).send({
    title: 'Source-owned journal',
    body: 'Keep this note body exactly as written.',
    tags: ['mirror'],
    status: 'draft',
    sessionName: 'Session 20',
  })
  assert.equal(sourceOwnedNoteResponse.status, 201)
  const sourceOwnedNoteId = sourceOwnedNoteResponse.body.note.id as string

  const sourceCreatedNoteResponse = await sourceGuest
    .post(`/api/shared/${shareToken}/notes`)
    .send({
      title: 'Source-created clue',
      body: 'This started on the duplicate membership.',
      tags: ['clue'],
      status: 'draft',
      sessionName: 'Session 20',
    })
  assert.equal(sourceCreatedNoteResponse.status, 201)
  const sourceCreatedNoteId = sourceCreatedNoteResponse.body.note.id as string

  const targetEditedSourceNoteResponse = await targetGuest
    .put(`/api/shared/${shareToken}/notes/${sourceCreatedNoteId}`)
    .send({
      title: 'Source-created clue',
      body: 'Target edited this note before consolidation.',
      tags: ['clue', 'shared'],
      status: 'active',
      sessionName: null,
    })
  assert.equal(targetEditedSourceNoteResponse.status, 200)

  const targetOwnedNoteResponse = await targetGuest.post(`/api/shared/${shareToken}/notes`).send({
    title: 'Target-owned clue',
    body: 'Target created this note first.',
    tags: ['target'],
    status: 'draft',
    sessionName: 'Session 21',
  })
  assert.equal(targetOwnedNoteResponse.status, 201)
  const targetOwnedNoteId = targetOwnedNoteResponse.body.note.id as string

  const sourceEditedTargetNoteResponse = await sourceGuest
    .put(`/api/shared/${shareToken}/notes/${targetOwnedNoteId}`)
    .send({
      title: 'Target-owned clue',
      body: 'Source edited this target note before consolidation.',
      tags: ['target', 'edited'],
      status: 'active',
      sessionName: null,
    })
  assert.equal(sourceEditedTargetNoteResponse.status, 200)

  const unaffectedTargetNoteResponse = await targetGuest
    .post(`/api/shared/${shareToken}/notes`)
    .send({
      title: 'Target-only note',
      body: 'This note should stay untouched.',
      tags: ['stable'],
      status: 'active',
      sessionName: null,
    })
  assert.equal(unaffectedTargetNoteResponse.status, 201)
  const unaffectedTargetNoteId = unaffectedTargetNoteResponse.body.note.id as string

  const beforeConsolidationResponse = await authed
    .get('/api/notes')
    .query({ campaignId: defaultCampaignId })
  assert.equal(beforeConsolidationResponse.status, 200)

  const beforeSourceOwnedNote = findNoteById(
    beforeConsolidationResponse.body.notes,
    sourceOwnedNoteId,
  )
  const beforeSourceCreatedNote = findNoteById(
    beforeConsolidationResponse.body.notes,
    sourceCreatedNoteId,
  )
  const beforeTargetOwnedNote = findNoteById(
    beforeConsolidationResponse.body.notes,
    targetOwnedNoteId,
  )
  const beforeUnaffectedTargetNote = findNoteById(
    beforeConsolidationResponse.body.notes,
    unaffectedTargetNoteId,
  )

  const previewResponse = await authed
    .post(`/api/campaigns/${defaultCampaignId}/memberships/consolidations`)
    .send({
      sourceMembershipId,
      targetMembershipId,
    })
  assert.equal(previewResponse.status, 200)
  assert.equal(previewResponse.body.consolidation.applied, false)
  assert.equal(previewResponse.body.consolidation.effect, 'note-attribution-only')
  assert.equal(previewResponse.body.consolidation.sourceMembership.id, sourceMembershipId)
  assert.equal(previewResponse.body.consolidation.targetMembership.id, targetMembershipId)
  assert.equal(previewResponse.body.consolidation.noteChanges.authoredNoteCount, 2)
  assert.equal(previewResponse.body.consolidation.noteChanges.editedNoteCount, 2)
  assert.equal(
    previewResponse.body.consolidation.noteChanges.authoredAndEditedNoteCount,
    1,
  )
  assert.equal(previewResponse.body.consolidation.noteChanges.affectedNoteCount, 3)
  assert.equal(previewResponse.body.consolidation.requiresRoleMismatchConfirmation, false)
  assert.ok(
    previewResponse.body.consolidation.warnings.some((warning: string) =>
      warning.includes('Membership records, linked accounts, and guest tokens'),
    ),
  )
  assert.ok(
    previewResponse.body.consolidation.warnings.some((warning: string) =>
      warning.includes('Affected notes will show "Mira" instead of "Mira (Safari)"'),
    ),
  )

  const applyResponse = await authed
    .post(`/api/campaigns/${defaultCampaignId}/memberships/consolidations`)
    .send({
      sourceMembershipId,
      targetMembershipId,
      confirm: true,
    })
  assert.equal(applyResponse.status, 200)
  assert.equal(applyResponse.body.consolidation.applied, true)
  assert.equal(applyResponse.body.consolidation.noteChanges.affectedNoteCount, 3)

  const membershipsResponse = await authed.get(`/api/campaigns/${defaultCampaignId}/memberships`)
  assert.equal(membershipsResponse.status, 200)
  assert.ok(
    membershipsResponse.body.memberships.some(
      (membership: { id: string }) => membership.id === sourceMembershipId,
    ),
  )
  assert.ok(
    membershipsResponse.body.memberships.some(
      (membership: { id: string }) => membership.id === targetMembershipId,
    ),
  )

  const afterConsolidationResponse = await authed
    .get('/api/notes')
    .query({ campaignId: defaultCampaignId })
  assert.equal(afterConsolidationResponse.status, 200)

  const sourceOwnedNote = findNoteById(
    afterConsolidationResponse.body.notes,
    sourceOwnedNoteId,
  )
  assert.equal(sourceOwnedNote.createdBy.membershipId, targetMembershipId)
  assert.equal(sourceOwnedNote.lastEditedBy.membershipId, targetMembershipId)
  assert.equal(sourceOwnedNote.body, beforeSourceOwnedNote.body)
  assert.equal(sourceOwnedNote.updatedAt, beforeSourceOwnedNote.updatedAt)

  const sourceCreatedNote = findNoteById(
    afterConsolidationResponse.body.notes,
    sourceCreatedNoteId,
  )
  assert.equal(sourceCreatedNote.createdBy.membershipId, targetMembershipId)
  assert.equal(sourceCreatedNote.lastEditedBy.membershipId, targetMembershipId)
  assert.equal(sourceCreatedNote.body, beforeSourceCreatedNote.body)
  assert.equal(sourceCreatedNote.updatedAt, beforeSourceCreatedNote.updatedAt)

  const targetOwnedNote = findNoteById(
    afterConsolidationResponse.body.notes,
    targetOwnedNoteId,
  )
  assert.equal(targetOwnedNote.createdBy.membershipId, targetMembershipId)
  assert.equal(targetOwnedNote.lastEditedBy.membershipId, targetMembershipId)
  assert.equal(targetOwnedNote.body, beforeTargetOwnedNote.body)
  assert.equal(targetOwnedNote.updatedAt, beforeTargetOwnedNote.updatedAt)

  const unaffectedTargetNote = findNoteById(
    afterConsolidationResponse.body.notes,
    unaffectedTargetNoteId,
  )
  assert.equal(unaffectedTargetNote.createdBy.membershipId, targetMembershipId)
  assert.equal(unaffectedTargetNote.lastEditedBy.membershipId, targetMembershipId)
  assert.equal(unaffectedTargetNote.body, beforeUnaffectedTargetNote.body)
  assert.equal(unaffectedTargetNote.updatedAt, beforeUnaffectedTargetNote.updatedAt)
})

test('linked guest accounts cannot consolidate memberships through the owner-only route', async (t) => {
  const { app, cleanup } = await createTestApp()
  t.after(cleanup)

  const { token } = await registerOwner(request(app))
  const ownerAuthed = withAuth(request(app), token)

  const ownerMembershipsResponse = await ownerAuthed.get(
    `/api/campaigns/${defaultCampaignId}/memberships`,
  )
  assert.equal(ownerMembershipsResponse.status, 200)
  const ownerMembershipId = ownerMembershipsResponse.body.memberships[0].id as string

  const shareLinkResponse = await ownerAuthed
    .post(`/api/campaigns/${defaultCampaignId}/share-links`)
    .send({
      label: 'Owner-only consolidation link',
      accessLevel: 'editor',
      frameAncestors: null,
    })
  assert.equal(shareLinkResponse.status, 201)

  const shareToken = shareLinkResponse.body.token as string
  const joinResponse = await request(app).post(`/api/shared/${shareToken}/join`).send({
    displayName: 'Mira',
  })
  assert.equal(joinResponse.status, 201)

  const claimant = await registerOwner(request(app), {
    displayName: 'Mira Vale',
    email: 'mira-non-owner@example.com',
    password: 'mira-cannot-consolidate',
  })

  const claimResponse = await request(app)
    .post(`/api/shared/${shareToken}/membership/claim`)
    .set('Authorization', `Bearer ${claimant.token}`)
    .set('X-Guest-Token', joinResponse.body.guestToken as string)
  assert.equal(claimResponse.status, 200)

  const claimedMembershipId = claimResponse.body.membership.id as string
  const claimedAuthed = withAuth(request(app), claimant.token)

  const previewResponse = await claimedAuthed
    .post(`/api/campaigns/${defaultCampaignId}/memberships/consolidations`)
    .send({
      sourceMembershipId: claimedMembershipId,
      targetMembershipId: ownerMembershipId,
    })
  assert.equal(previewResponse.status, 403)
  assert.equal(previewResponse.body.error, 'You do not have access to this campaign.')

  const applyResponse = await claimedAuthed
    .post(`/api/campaigns/${defaultCampaignId}/memberships/consolidations`)
    .send({
      sourceMembershipId: claimedMembershipId,
      targetMembershipId: ownerMembershipId,
      confirm: true,
      confirmRoleMismatch: true,
    })
  assert.equal(applyResponse.status, 403)
  assert.equal(applyResponse.body.error, 'You do not have access to this campaign.')

  const ownerPreviewResponse = await ownerAuthed
    .post(`/api/campaigns/${defaultCampaignId}/memberships/consolidations`)
    .send({
      sourceMembershipId: claimedMembershipId,
      targetMembershipId: ownerMembershipId,
    })
  assert.equal(ownerPreviewResponse.status, 200)
  assert.equal(ownerPreviewResponse.body.consolidation.applied, false)
})

test('membership consolidations reject membership IDs from another campaign', async (t) => {
  const { app, cleanup } = await createTestApp()
  t.after(cleanup)

  const { token } = await registerOwner(request(app))
  const authed = withAuth(request(app), token)

  const defaultMembershipsResponse = await authed.get(
    `/api/campaigns/${defaultCampaignId}/memberships`,
  )
  assert.equal(defaultMembershipsResponse.status, 200)
  const defaultOwnerMembershipId = defaultMembershipsResponse.body.memberships[0].id as string

  const createCampaignResponse = await authed.post('/api/campaigns').send({
    name: 'Foreign campaign',
    tagline: 'Used to prove campaign-scoped membership checks.',
    system: 'Dungeons & Dragons 2024',
    setting: 'Moonfall',
    nextSession: null,
  })
  assert.equal(createCampaignResponse.status, 201)
  const foreignCampaignId = createCampaignResponse.body.campaign.id as string

  const foreignMembershipsResponse = await authed.get(
    `/api/campaigns/${foreignCampaignId}/memberships`,
  )
  assert.equal(foreignMembershipsResponse.status, 200)
  const foreignMembershipId = foreignMembershipsResponse.body.memberships[0].id as string

  const foreignSourceResponse = await authed
    .post(`/api/campaigns/${defaultCampaignId}/memberships/consolidations`)
    .send({
      sourceMembershipId: foreignMembershipId,
      targetMembershipId: defaultOwnerMembershipId,
    })
  assert.equal(foreignSourceResponse.status, 404)
  assert.equal(
    foreignSourceResponse.body.error,
    'Source membership was not found in this campaign.',
  )

  const foreignTargetResponse = await authed
    .post(`/api/campaigns/${defaultCampaignId}/memberships/consolidations`)
    .send({
      sourceMembershipId: defaultOwnerMembershipId,
      targetMembershipId: foreignMembershipId,
    })
  assert.equal(foreignTargetResponse.status, 404)
  assert.equal(
    foreignTargetResponse.body.error,
    'Target membership was not found in this campaign.',
  )
})

test('role-changing membership consolidations require explicit confirmation', async (t) => {
  const { app, cleanup } = await createTestApp()
  t.after(cleanup)

  const { token } = await registerOwner(request(app))
  const authed = withAuth(request(app), token)

  const membershipsResponse = await authed.get(
    `/api/campaigns/${defaultCampaignId}/memberships`,
  )
  assert.equal(membershipsResponse.status, 200)
  const ownerMembershipId = membershipsResponse.body.memberships[0].id as string

  const shareLinkResponse = await authed
    .post(`/api/campaigns/${defaultCampaignId}/share-links`)
    .send({
      label: 'Role mismatch link',
      accessLevel: 'editor',
      frameAncestors: null,
    })
  assert.equal(shareLinkResponse.status, 201)

  const joinResponse = await request(app)
    .post(`/api/shared/${shareLinkResponse.body.token}/join`)
    .send({ displayName: 'Aela Guest' })
  assert.equal(joinResponse.status, 201)
  const guestMembershipId = joinResponse.body.membership.id as string

  const createNoteResponse = await authed.post('/api/notes').send({
    campaignId: defaultCampaignId,
    title: 'Owner-only warning',
    body: 'Do not change this ownership without an explicit confirmation step.',
    tags: ['owner'],
    status: 'active',
    sessionName: null,
  })
  assert.equal(createNoteResponse.status, 201)
  const noteId = createNoteResponse.body.note.id as string

  const previewResponse = await authed
    .post(`/api/campaigns/${defaultCampaignId}/memberships/consolidations`)
    .send({
      sourceMembershipId: ownerMembershipId,
      targetMembershipId: guestMembershipId,
    })
  assert.equal(previewResponse.status, 200)
  assert.equal(previewResponse.body.consolidation.applied, false)
  assert.equal(previewResponse.body.consolidation.requiresRoleMismatchConfirmation, true)
  assert.ok(
    previewResponse.body.consolidation.warnings.some((warning: string) =>
      warning.includes('Affected notes will use the "guest" role instead of "owner"'),
    ),
  )

  const unconfirmedResponse = await authed
    .post(`/api/campaigns/${defaultCampaignId}/memberships/consolidations`)
    .send({
      sourceMembershipId: ownerMembershipId,
      targetMembershipId: guestMembershipId,
      confirm: true,
    })
  assert.equal(unconfirmedResponse.status, 409)
  assert.match(unconfirmedResponse.body.details[0], /owner-to-guest/)

  const beforeConfirmedGetResponse = await authed.get(`/api/notes/${noteId}`)
  assert.equal(beforeConfirmedGetResponse.status, 200)
  assert.equal(beforeConfirmedGetResponse.body.note.createdBy.role, 'owner')

  const confirmedResponse = await authed
    .post(`/api/campaigns/${defaultCampaignId}/memberships/consolidations`)
    .send({
      sourceMembershipId: ownerMembershipId,
      targetMembershipId: guestMembershipId,
      confirm: true,
      confirmRoleMismatch: true,
    })
  assert.equal(confirmedResponse.status, 200)
  assert.equal(confirmedResponse.body.consolidation.applied, true)
  assert.equal(confirmedResponse.body.consolidation.noteChanges.authoredNoteCount, 1)
  assert.equal(confirmedResponse.body.consolidation.noteChanges.editedNoteCount, 1)
  assert.equal(
    confirmedResponse.body.consolidation.noteChanges.authoredAndEditedNoteCount,
    1,
  )

  const afterConfirmedGetResponse = await authed.get(`/api/notes/${noteId}`)
  assert.equal(afterConfirmedGetResponse.status, 200)
  assert.equal(afterConfirmedGetResponse.body.note.createdBy.membershipId, guestMembershipId)
  assert.equal(afterConfirmedGetResponse.body.note.createdBy.role, 'guest')
  assert.equal(afterConfirmedGetResponse.body.note.lastEditedBy.membershipId, guestMembershipId)
  assert.equal(
    afterConfirmedGetResponse.body.note.body,
    'Do not change this ownership without an explicit confirmation step.',
  )
})

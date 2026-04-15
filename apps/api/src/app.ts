import cors from 'cors'
import express, { type Express, type Request, type Response } from 'express'
import type { NoteStore } from './note-store.js'
import type {
  ActivityCollaborator,
  AuthSessionResponse,
  CampaignMembership,
  CampaignMembershipsResponse,
  MembershipConsolidationResponse,
  CampaignShareLinkCreateResponse,
  CampaignShareLinkRevealResponse,
  CampaignShareLinksResponse,
  CampaignResponse,
  CampaignsResponse,
  CurrentOwnerResponse,
  ErrorResponse,
  HealthResponse,
  Note,
  NoteActivityEntry,
  NoteActivityResponse,
  NoteResponse,
  NotesOverview,
  NotesResponse,
  OwnerAccount,
  SessionSummary,
  SessionsResponse,
  SharedJoinResponse,
  SharedMembershipClaimResponse,
  SharedSessionResponse,
} from './types.js'
import {
  validateCampaignInput,
  validateCampaignShareLinkInput,
  validateGuestJoinInput,
  validateNoteCreateInput,
  validateMembershipConsolidationInput,
  validateNoteInput,
  validateOwnerLoginInput,
  validateOwnerRegistrationInput,
} from './validation.js'

interface NoteParams extends Record<string, string> {
  noteId: string
}

interface CampaignParams extends Record<string, string> {
  campaignId: string
}

interface SessionParams extends Record<string, string> {
  sessionId: string
}

interface ShareParams extends Record<string, string> {
  shareToken: string
}

interface ShareLinkParams extends CampaignParams {
  shareLinkId: string
}

interface SharedNoteParams extends ShareParams {
  noteId: string
}

const defaultActivityLimit = 20
const maxActivityLimit = 100

interface CreateAppOptions {
  noteStore: NoteStore
}

function parseAuthorizationToken(request: Request) {
  const authorizationHeader = request.header('authorization')

  if (!authorizationHeader) {
    return null
  }

  const [scheme, token] = authorizationHeader.split(' ')

  if (scheme !== 'Bearer' || !token) {
    return null
  }

  return token
}

function parseGuestToken(request: Request) {
  const guestToken = request.header('x-guest-token')

  if (!guestToken) {
    return null
  }

  const trimmed = guestToken.trim()
  return trimmed.length > 0 ? trimmed : null
}

function readRequestedCampaignId(request: Request) {
  const value = request.query.campaignId
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function readRequestedMembershipId(request: Request) {
  const value = request.query.membershipId

  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function readRequestedActivityLimit(
  request: Request,
  response: Response<ErrorResponse>,
) {
  const value = request.query.limit

  if (value === undefined) {
    return defaultActivityLimit
  }

  if (typeof value !== 'string') {
    response.status(400).json({ error: 'Activity limit must be a positive integer.' })
    return null
  }

  const parsed = Number.parseInt(value, 10)

  if (!Number.isInteger(parsed) || parsed <= 0) {
    response.status(400).json({ error: 'Activity limit must be a positive integer.' })
    return null
  }

  return Math.min(parsed, maxActivityLimit)
}

function buildOverview(
  noteStore: NoteStore,
  campaignId: string,
  membership: CampaignMembership | null,
): NotesOverview {
  const campaign = noteStore.getCampaign(campaignId)

  if (!campaign || campaign.archivedAt !== null) {
    throw new Error(`Campaign "${campaignId}" was not found.`)
  }

  return {
    campaign,
    membership,
    stats: noteStore.getStats(campaign.id),
    recentNotes: noteStore.listRecentNotes(3, campaign.id),
  }
}

function buildSessions(noteStore: NoteStore, campaignId: string): SessionSummary[] {
  const sessions = noteStore.listSessionNames(campaignId) as Array<string | SessionSummary>

  return sessions.map((session) => {
    if (typeof session !== 'string') {
      return session
    }

    const notes = noteStore.getSessionNotes(campaignId, session)
    const latestActivity = notes.reduce(
      (latest, note) => (note.updatedAt > latest ? note.updatedAt : latest),
      '',
    )

    return {
      sessionName: session,
      noteCount: notes.length,
      latestActivity,
    }
  })
}

function noteMatchesActivityMembership(note: Note, membershipId: string) {
  return (
    note.createdBy?.membershipId === membershipId ||
    note.lastEditedBy?.membershipId === membershipId
  )
}

function buildActivityCollaborators(notes: Note[]): ActivityCollaborator[] {
  const collaborators = new Map<string, ActivityCollaborator>()

  for (const note of notes) {
    const actorIds = new Set<string>()

    for (const actor of [note.createdBy, note.lastEditedBy]) {
      if (!actor || actorIds.has(actor.membershipId)) {
        continue
      }

      actorIds.add(actor.membershipId)
      const existing = collaborators.get(actor.membershipId)

      if (existing) {
        existing.noteCount += 1
        continue
      }

      collaborators.set(actor.membershipId, {
        membershipId: actor.membershipId,
        displayName: actor.displayName,
        role: actor.role,
        noteCount: 1,
      })
    }
  }

  return [...collaborators.values()].sort((left, right) =>
    right.noteCount !== left.noteCount
      ? right.noteCount - left.noteCount
      : left.displayName.localeCompare(right.displayName),
  )
}

function buildNoteActivityEntry(note: Note): NoteActivityEntry {
  return {
    ...note,
    action: note.createdAt === note.updatedAt ? 'created' : 'edited',
  }
}

function buildNoteActivityResponse(
  noteStore: NoteStore,
  campaignId: string,
  membershipId: string | null,
  limit: number,
): NoteActivityResponse {
  const campaign = noteStore.getCampaign(campaignId)

  if (!campaign || campaign.archivedAt !== null) {
    throw new Error(`Campaign "${campaignId}" was not found.`)
  }

  const notes = [...noteStore.listNotes(campaignId)].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  )

  const activity = membershipId
    ? notes.filter((note) => noteMatchesActivityMembership(note, membershipId))
    : notes

  return {
    campaign,
    collaborators: buildActivityCollaborators(notes),
    activity: activity.slice(0, limit).map(buildNoteActivityEntry),
  }
}

function requireOwner(
  noteStore: NoteStore,
  request: Request,
  response: Response<ErrorResponse>,
) {
  const token = parseAuthorizationToken(request)

  if (!token) {
    response.status(401).json({ error: 'Owner authentication is required.' })
    return null
  }

  const owner = noteStore.getOwnerBySessionToken(token)

  if (!owner) {
    response.status(401).json({ error: 'Owner session is invalid or expired.' })
    return null
  }

  return owner
}

function resolveOwnedCampaign(
  noteStore: NoteStore,
  owner: OwnerAccount,
  campaignId: string | null | undefined,
  response: Response<ErrorResponse>,
) {
  if (!campaignId) {
    try {
      return noteStore.getPrimaryCampaign(owner.id)
    } catch {
      response.status(404).json({ error: 'No owned campaigns are available.' })
      return null
    }
  }

  const campaign = noteStore.getCampaign(campaignId)

  if (!campaign || campaign.archivedAt !== null) {
    response.status(404).json({ error: `Campaign "${campaignId}" was not found.` })
    return null
  }

  if (!noteStore.userOwnsCampaign(owner.id, campaignId)) {
    response.status(403).json({ error: 'You do not have access to this campaign.' })
    return null
  }

  return campaign
}

function resolveAccessibleCampaign(
  noteStore: NoteStore,
  owner: OwnerAccount,
  campaignId: string | null | undefined,
  response: Response<ErrorResponse>,
) {
  if (!campaignId) {
    try {
      return noteStore.getPrimaryCampaignForUser(owner.id)
    } catch {
      response.status(404).json({ error: 'No campaigns are available.' })
      return null
    }
  }

  const campaign = noteStore.getCampaign(campaignId)

  if (!campaign || campaign.archivedAt !== null) {
    response.status(404).json({ error: `Campaign "${campaignId}" was not found.` })
    return null
  }

  if (!noteStore.userHasCampaignAccess(owner.id, campaignId)) {
    response.status(403).json({ error: 'You do not have access to this campaign.' })
    return null
  }

  return campaign
}

function resolveSharedLink(
  noteStore: NoteStore,
  shareToken: string,
  response: Response<ErrorResponse>,
) {
  const shareLink = noteStore.getCampaignShareLinkByToken(shareToken)

  if (!shareLink) {
    response.status(404).json({ error: 'Shared link was not found or has been revoked.' })
    return null
  }

  const campaign = noteStore.getCampaign(shareLink.campaignId)

  if (!campaign || campaign.archivedAt !== null) {
    response.status(404).json({ error: 'Campaign was not found for this shared link.' })
    return null
  }

  return { shareLink, campaign }
}

function applySharedLinkPolicy(
  response: Response,
  frameAncestors: string | null,
) {
  response.set(
    'Content-Security-Policy',
    `frame-ancestors ${frameAncestors?.trim() || "'none'"}`,
  )
}

function readSharedMembership(
  noteStore: NoteStore,
  request: Request,
  campaignId: string,
) {
  const guestToken = parseGuestToken(request)

  if (!guestToken) {
    return null
  }

  const membership = noteStore.getGuestMembershipByToken(guestToken)

  if (!membership || membership.campaignId !== campaignId) {
    return null
  }

  return membership
}

function requireSharedMembership(
  noteStore: NoteStore,
  request: Request,
  campaignId: string,
  response: Response<ErrorResponse>,
) {
  const membership = readSharedMembership(noteStore, request, campaignId)

  if (!membership) {
    response.status(401).json({ error: 'Guest authentication is required for this shared campaign.' })
    return null
  }

  return membership
}

function requireEditorAccess(
  accessLevel: 'viewer' | 'editor',
  response: Response<ErrorResponse>,
) {
  if (accessLevel !== 'editor') {
    response.status(403).json({ error: 'This shared link does not allow editing.' })
    return false
  }

  return true
}

function buildSharedUrl(request: Request, shareToken: string) {
  const origin = request.header('origin')?.replace(/\/$/, '')

  if (origin) {
    return `${origin}/share/${shareToken}`
  }

  return `${request.protocol}://${request.get('host')}/share/${shareToken}`
}

export function createApp({ noteStore }: CreateAppOptions): Express {
  const app = express()

  app.use(cors())
  app.use(express.json())

  app.get('/health', (_request: Request, response: Response<HealthResponse>) => {
    response.json({ status: 'ok', service: 'dnd-notes-api' })
  })

  app.post(
    '/api/auth/register',
    (
      request: Request,
      response: Response<AuthSessionResponse | ErrorResponse>,
    ) => {
      const validation = validateOwnerRegistrationInput(request.body)

      if (!validation.success) {
        response.status(400).json({
          error: 'Owner registration payload is invalid.',
          details: validation.errors,
        })
        return
      }

      const owner = noteStore.createOwnerAccount(validation.data)

      if (!owner) {
        response.status(409).json({
          error: `An owner account already exists for ${validation.data.email}.`,
        })
        return
      }

      const token = noteStore.createOwnerSession(owner.id)
      response.status(201).json({ token, owner })
    },
  )

  app.post(
    '/api/auth/login',
    (
      request: Request,
      response: Response<AuthSessionResponse | ErrorResponse>,
    ) => {
      const validation = validateOwnerLoginInput(request.body)

      if (!validation.success) {
        response.status(400).json({
          error: 'Owner login payload is invalid.',
          details: validation.errors,
        })
        return
      }

      const owner = noteStore.authenticateOwner(
        validation.data.email,
        validation.data.password,
      )

      if (!owner) {
        response.status(401).json({ error: 'Email or password is incorrect.' })
        return
      }

      const token = noteStore.createOwnerSession(owner.id)
      response.json({ token, owner })
    },
  )

  app.get(
    '/api/auth/session',
    (
      request: Request,
      response: Response<CurrentOwnerResponse | ErrorResponse>,
    ) => {
      const owner = requireOwner(noteStore, request, response)

      if (!owner) {
        return
      }

      response.json({ owner })
    },
  )

  app.post(
    '/api/auth/logout',
    (
      request: Request,
      response: Response<undefined | ErrorResponse>,
    ) => {
      const token = parseAuthorizationToken(request)

      if (!token) {
        response.status(401).json({ error: 'Owner authentication is required.' })
        return
      }

      noteStore.deleteOwnerSession(token)
      response.status(204).send()
    },
  )

  app.get(
    '/api/campaigns',
    (
      request: Request,
      response: Response<CampaignsResponse | ErrorResponse>,
    ) => {
      const owner = requireOwner(noteStore, request, response)

      if (!owner) {
        return
      }

      response.json({ campaigns: noteStore.listUserCampaigns(owner.id) })
    },
  )

  app.post(
    '/api/campaigns',
    (
      request: Request,
      response: Response<CampaignResponse | ErrorResponse>,
    ) => {
      const owner = requireOwner(noteStore, request, response)

      if (!owner) {
        return
      }

      const validation = validateCampaignInput(request.body)

      if (!validation.success) {
        response.status(400).json({
          error: 'Campaign payload is invalid.',
          details: validation.errors,
        })
        return
      }

      const campaign = noteStore.createCampaign(validation.data, owner)
      response.status(201).json({ campaign })
    },
  )

  app.get(
    '/api/campaigns/:campaignId',
    (
      request: Request<CampaignParams>,
      response: Response<CampaignResponse | ErrorResponse>,
    ) => {
      const owner = requireOwner(noteStore, request, response)

      if (!owner) {
        return
      }

      const campaign = resolveAccessibleCampaign(
        noteStore,
        owner,
        request.params.campaignId,
        response,
      )

      if (!campaign) {
        return
      }

      response.json({ campaign })
    },
  )

  app.get(
    '/api/campaigns/:campaignId/sessions',
    (
      request: Request<CampaignParams>,
      response: Response<SessionsResponse | ErrorResponse>,
    ) => {
      const owner = requireOwner(noteStore, request, response)

      if (!owner) {
        return
      }

      const campaign = resolveAccessibleCampaign(
        noteStore,
        owner,
        request.params.campaignId,
        response,
      )

      if (!campaign) {
        return
      }

      response.json({ sessions: buildSessions(noteStore, campaign.id) })
    },
  )

  app.put(
    '/api/campaigns/:campaignId',
    (
      request: Request<CampaignParams>,
      response: Response<CampaignResponse | ErrorResponse>,
    ) => {
      const owner = requireOwner(noteStore, request, response)

      if (!owner) {
        return
      }

      const campaign = resolveOwnedCampaign(
        noteStore,
        owner,
        request.params.campaignId,
        response,
      )

      if (!campaign) {
        return
      }

      const validation = validateCampaignInput(request.body)

      if (!validation.success) {
        response.status(400).json({
          error: 'Campaign payload is invalid.',
          details: validation.errors,
        })
        return
      }

      const updatedCampaign = noteStore.updateCampaign(
        campaign.id,
        validation.data,
        owner.id,
      )

      if (!updatedCampaign) {
        response.status(404).json({ error: `Campaign "${campaign.id}" was not found.` })
        return
      }

      response.json({ campaign: updatedCampaign })
    },
  )

  app.get(
    '/api/campaigns/:campaignId/memberships',
    (
      request: Request<CampaignParams>,
      response: Response<CampaignMembershipsResponse | ErrorResponse>,
    ) => {
      const owner = requireOwner(noteStore, request, response)

      if (!owner) {
        return
      }

      const campaign = resolveOwnedCampaign(
        noteStore,
        owner,
        request.params.campaignId,
        response,
      )

      if (!campaign) {
        return
      }

      response.json({
        memberships: noteStore.listCampaignMemberships(campaign.id),
      })
    },
  )

  app.post(
    '/api/campaigns/:campaignId/memberships/consolidations',
    (
      request: Request<CampaignParams>,
      response: Response<MembershipConsolidationResponse | ErrorResponse>,
    ) => {
      const owner = requireOwner(noteStore, request, response)

      if (!owner) {
        return
      }

      const campaign = resolveOwnedCampaign(
        noteStore,
        owner,
        request.params.campaignId,
        response,
      )

      if (!campaign) {
        return
      }

      const validation = validateMembershipConsolidationInput(request.body)

      if (!validation.success) {
        response.status(400).json({
          error: 'Membership consolidation payload is invalid.',
          details: validation.errors,
        })
        return
      }

      const preview = noteStore.previewMembershipConsolidation(
        campaign.id,
        validation.data.sourceMembershipId,
        validation.data.targetMembershipId,
        owner.id,
      )

      if (preview.status === 'forbidden') {
        response.status(403).json({ error: 'You do not have access to this campaign.' })
        return
      }

      if (preview.status === 'same-membership') {
        response.status(400).json({
          error: 'Membership consolidation requires two different memberships.',
          details: ['Pick a distinct source membership and target membership.'],
        })
        return
      }

      if (preview.status === 'source-not-found') {
        response.status(404).json({ error: 'Source membership was not found in this campaign.' })
        return
      }

      if (preview.status === 'target-not-found') {
        response.status(404).json({ error: 'Target membership was not found in this campaign.' })
        return
      }

      if (!validation.data.confirm) {
        response.json({
          consolidation: {
            ...preview.consolidation,
            applied: false,
          },
        })
        return
      }

      if (
        preview.consolidation.requiresRoleMismatchConfirmation &&
        !validation.data.confirmRoleMismatch
      ) {
        response.status(409).json({
          error: 'This consolidation changes note attribution roles.',
          details: [
            `Confirm the ${preview.consolidation.sourceMembership.role}-to-${preview.consolidation.targetMembership.role} change before applying it.`,
          ],
        })
        return
      }

      const consolidation = noteStore.consolidateMemberships(
        campaign.id,
        validation.data.sourceMembershipId,
        validation.data.targetMembershipId,
        owner.id,
      )

      if (consolidation.status === 'forbidden') {
        response.status(403).json({ error: 'You do not have access to this campaign.' })
        return
      }

      if (consolidation.status === 'same-membership') {
        response.status(400).json({
          error: 'Membership consolidation requires two different memberships.',
          details: ['Pick a distinct source membership and target membership.'],
        })
        return
      }

      if (consolidation.status === 'source-not-found') {
        response.status(404).json({ error: 'Source membership was not found in this campaign.' })
        return
      }

      if (consolidation.status === 'target-not-found') {
        response.status(404).json({ error: 'Target membership was not found in this campaign.' })
        return
      }

      response.json({ consolidation: consolidation.consolidation })
    },
  )

  app.get(
    '/api/campaigns/:campaignId/share-links',
    (
      request: Request<CampaignParams>,
      response: Response<CampaignShareLinksResponse | ErrorResponse>,
    ) => {
      const owner = requireOwner(noteStore, request, response)

      if (!owner) {
        return
      }

      const campaign = resolveOwnedCampaign(
        noteStore,
        owner,
        request.params.campaignId,
        response,
      )

      if (!campaign) {
        return
      }

      response.json({
        shareLinks: noteStore.listCampaignShareLinks(campaign.id),
      })
    },
  )

  app.post(
    '/api/campaigns/:campaignId/share-links',
    (
      request: Request<CampaignParams>,
      response: Response<CampaignShareLinkCreateResponse | ErrorResponse>,
    ) => {
      const owner = requireOwner(noteStore, request, response)

      if (!owner) {
        return
      }

      const campaign = resolveOwnedCampaign(
        noteStore,
        owner,
        request.params.campaignId,
        response,
      )

      if (!campaign) {
        return
      }

      const validation = validateCampaignShareLinkInput(request.body)

      if (!validation.success) {
        response.status(400).json({
          error: 'Share link payload is invalid.',
          details: validation.errors,
        })
        return
      }

      const created = noteStore.createCampaignShareLink(
        campaign.id,
        validation.data,
        owner.id,
      )

      if (!created) {
        response.status(403).json({ error: 'You do not have access to this campaign.' })
        return
      }

      response.status(201).json({
        shareLink: created.shareLink,
        token: created.token,
        url: buildSharedUrl(request, created.token),
      })
    },
  )

  app.get(
    '/api/campaigns/:campaignId/share-links/:shareLinkId',
    (
      request: Request<ShareLinkParams>,
      response: Response<CampaignShareLinkRevealResponse | ErrorResponse>,
    ) => {
      const owner = requireOwner(noteStore, request, response)

      if (!owner) {
        return
      }

      const campaign = resolveOwnedCampaign(
        noteStore,
        owner,
        request.params.campaignId,
        response,
      )

      if (!campaign) {
        return
      }

      const reveal = noteStore.getCampaignShareLinkReveal(
        campaign.id,
        request.params.shareLinkId,
        owner.id,
      )

      if (!reveal) {
        response.status(404).json({ error: 'Shared link was not found.' })
        return
      }

      if (reveal.status === 'legacy-unavailable') {
        response.status(409).json({
          error: 'This shared link can no longer be revealed.',
          details: [
            'This link was created before reveal support was added, so the original token was not stored. Revoke it and create a new share link to get a revealable URL.',
          ],
        })
        return
      }

      response.json({
        token: reveal.token,
        url: buildSharedUrl(request, reveal.token),
      })
    },
  )

  app.delete(
    '/api/campaigns/:campaignId/share-links/:shareLinkId',
    (
      request: Request<ShareLinkParams>,
      response: Response<undefined | ErrorResponse>,
    ) => {
      const owner = requireOwner(noteStore, request, response)

      if (!owner) {
        return
      }

      const campaign = resolveOwnedCampaign(
        noteStore,
        owner,
        request.params.campaignId,
        response,
      )

      if (!campaign) {
        return
      }

      const revoked = noteStore.revokeCampaignShareLink(
        campaign.id,
        request.params.shareLinkId,
        owner.id,
      )

      if (!revoked) {
        response.status(404).json({ error: 'Shared link was not found.' })
        return
      }

      response.status(204).send()
    },
  )

  app.get(
    '/api/overview',
    (
      request: Request,
      response: Response<NotesOverview | ErrorResponse>,
    ) => {
      const owner = requireOwner(noteStore, request, response)

      if (!owner) {
        return
      }

      const campaign = resolveAccessibleCampaign(
        noteStore,
        owner,
        readRequestedCampaignId(request),
        response,
      )

      if (!campaign) {
        return
      }

      response.json(
        buildOverview(
          noteStore,
          campaign.id,
          noteStore.getUserMembershipForCampaign(owner.id, campaign.id),
        ),
      )
    },
  )

  app.get(
    '/api/notes',
    (
      request: Request,
      response: Response<NotesResponse | ErrorResponse>,
    ) => {
      const owner = requireOwner(noteStore, request, response)

      if (!owner) {
        return
      }

      const campaign = resolveAccessibleCampaign(
        noteStore,
        owner,
        readRequestedCampaignId(request),
        response,
      )

      if (!campaign) {
        return
      }

      response.json({ notes: noteStore.listNotes(campaign.id) })
    },
  )

  app.get(
    '/api/notes/activity',
    (
      request: Request,
      response: Response<NoteActivityResponse | ErrorResponse>,
    ) => {
      const owner = requireOwner(noteStore, request, response)

      if (!owner) {
        return
      }

      const campaign = resolveAccessibleCampaign(
        noteStore,
        owner,
        readRequestedCampaignId(request),
        response,
      )

      if (!campaign) {
        return
      }

      const limit = readRequestedActivityLimit(request, response)

      if (limit === null) {
        return
      }

      const membershipId = readRequestedMembershipId(request)

      if (membershipId) {
        const membership = noteStore
          .listCampaignMemberships(campaign.id)
          .find((candidate) => candidate.id === membershipId)

        if (!membership) {
          response
            .status(400)
            .json({ error: 'Activity membership filter is invalid for this campaign.' })
          return
        }
      }

      response.json(
        buildNoteActivityResponse(noteStore, campaign.id, membershipId, limit),
      )
    },
  )

  app.get(
    '/api/notes/sessions',
    (request: Request, response: Response<SessionsResponse | ErrorResponse>) => {
      const owner = requireOwner(noteStore, request, response)

      if (!owner) {
        return
      }

      const campaign = resolveAccessibleCampaign(
        noteStore,
        owner,
        readRequestedCampaignId(request),
        response,
      )

      if (!campaign) {
        return
      }

      response.json({ sessions: buildSessions(noteStore, campaign.id) })
    },
  )

  app.post(
    '/api/notes',
    (
      request: Request,
      response: Response<NoteResponse | ErrorResponse>,
    ) => {
      const owner = requireOwner(noteStore, request, response)

      if (!owner) {
        return
      }

      const validation = validateNoteCreateInput(request.body)

      if (!validation.success) {
        response.status(400).json({
          error: 'Note payload is invalid.',
          details: validation.errors,
        })
        return
      }

      const campaign = resolveAccessibleCampaign(
        noteStore,
        owner,
        validation.data.campaignId,
        response,
      )

      if (!campaign) {
        return
      }

      const membership = noteStore.getUserMembershipForCampaign(owner.id, campaign.id)

      if (!membership) {
        response.status(403).json({ error: 'You do not have access to this campaign.' })
        return
      }

      try {
        const note = noteStore.createNote(
          {
            ...validation.data,
            campaignId: campaign.id,
          },
          membership.id,
        )

        response.status(201).json({ note })
      } catch (error) {
        response.status(400).json({
          error: error instanceof Error ? error.message : 'Failed to create note.',
        })
      }
    },
  )

  app.get(
    '/api/notes/sessions/:sessionId',
    (
      request: Request<SessionParams>,
      response: Response<NotesResponse | ErrorResponse>,
    ) => {
      const owner = requireOwner(noteStore, request, response)

      if (!owner) {
        return
      }

      const campaign = resolveAccessibleCampaign(
        noteStore,
        owner,
        readRequestedCampaignId(request),
        response,
      )

      if (!campaign) {
        return
      }

      const notes = noteStore.getSessionNotes(campaign.id, request.params.sessionId)

      response.json({ notes })
    },
  )

  app.get(
    '/api/notes/:noteId',
    (
      request: Request<NoteParams>,
      response: Response<NoteResponse | ErrorResponse>,
    ) => {
      const owner = requireOwner(noteStore, request, response)

      if (!owner) {
        return
      }

      const note = noteStore.getNote(request.params.noteId)

      if (!note) {
        response
          .status(404)
          .json({ error: `Note "${request.params.noteId}" was not found.` })
        return
      }

      if (!noteStore.userHasCampaignAccess(owner.id, note.campaignId)) {
        response.status(403).json({ error: 'You do not have access to this note.' })
        return
      }

      response.json({ note })
    },
  )

  app.get(
    '/api/notes/:noteId/backlinks',
    (
      request: Request<NoteParams>,
      response: Response<NotesResponse | ErrorResponse>,
    ) => {
      const owner = requireOwner(noteStore, request, response)

      if (!owner) {
        return
      }

      const note = noteStore.getNote(request.params.noteId)

      if (!note) {
        response
          .status(404)
          .json({ error: `Note "${request.params.noteId}" was not found.` })
        return
      }

      if (!noteStore.userHasCampaignAccess(owner.id, note.campaignId)) {
        response.status(403).json({ error: 'You do not have access to this note.' })
        return
      }

      const backlinks = noteStore.getBacklinks(request.params.noteId)
      response.json({ notes: backlinks })
    },
  )

  app.put(
    '/api/notes/:noteId',
    (
      request: Request<NoteParams>,
      response: Response<NoteResponse | ErrorResponse>,
    ) => {
      const owner = requireOwner(noteStore, request, response)

      if (!owner) {
        return
      }

      const existingNote = noteStore.getNote(request.params.noteId)

      if (!existingNote) {
        response
          .status(404)
          .json({ error: `Note "${request.params.noteId}" was not found.` })
        return
      }

      const membership = noteStore.getUserMembershipForCampaign(owner.id, existingNote.campaignId)

      if (!membership) {
        response.status(403).json({ error: 'You do not have access to this note.' })
        return
      }

      const validation = validateNoteInput(request.body)

      if (!validation.success) {
        response.status(400).json({
          error: 'Note payload is invalid.',
          details: validation.errors,
        })
        return
      }

      try {
        const note = noteStore.updateNote(
          request.params.noteId,
          {
            ...validation.data,
            campaignId: existingNote.campaignId,
          },
          membership.id,
        )

        if (!note) {
          response
            .status(404)
            .json({ error: `Note "${request.params.noteId}" was not found.` })
          return
        }

        response.json({ note })
      } catch (error) {
        response.status(400).json({
          error: error instanceof Error ? error.message : 'Failed to update note.',
        })
      }
    },
  )

  app.delete(
    '/api/notes/:noteId',
    (
      request: Request<NoteParams>,
      response: Response<undefined | ErrorResponse>,
    ) => {
      const owner = requireOwner(noteStore, request, response)

      if (!owner) {
        return
      }

      const note = noteStore.getNote(request.params.noteId)

      if (!note) {
        response
          .status(404)
          .json({ error: `Note "${request.params.noteId}" was not found.` })
        return
      }

      if (!noteStore.userHasCampaignAccess(owner.id, note.campaignId)) {
        response.status(403).json({ error: 'You do not have access to this note.' })
        return
      }

      noteStore.deleteNote(request.params.noteId)
      response.status(204).send()
    },
  )

  app.get(
    '/api/shared/:shareToken/session',
    (
      request: Request<ShareParams>,
      response: Response<SharedSessionResponse | ErrorResponse>,
    ) => {
      const shared = resolveSharedLink(noteStore, request.params.shareToken, response)

      if (!shared) {
        return
      }

      applySharedLinkPolicy(response, shared.shareLink.frameAncestors)

      response.json({
        campaign: shared.campaign,
        shareLink: shared.shareLink,
        membership: readSharedMembership(noteStore, request, shared.campaign.id),
      })
    },
  )

  app.post(
    '/api/shared/:shareToken/join',
    (
      request: Request<ShareParams>,
      response: Response<SharedJoinResponse | ErrorResponse>,
    ) => {
      const shared = resolveSharedLink(noteStore, request.params.shareToken, response)

      if (!shared) {
        return
      }

      applySharedLinkPolicy(response, shared.shareLink.frameAncestors)

      const validation = validateGuestJoinInput(request.body)

      if (!validation.success) {
        response.status(400).json({
          error: 'Guest join payload is invalid.',
          details: validation.errors,
        })
        return
      }

      const guestSession = noteStore.createGuestMembership(
        shared.campaign.id,
        validation.data.displayName,
      )

      response.status(201).json({
        campaign: shared.campaign,
        shareLink: shared.shareLink,
        membership: guestSession.membership,
        guestToken: guestSession.guestToken,
      })
    },
  )

  app.post(
    '/api/shared/:shareToken/membership/claim',
    (
      request: Request<ShareParams>,
      response: Response<SharedMembershipClaimResponse | ErrorResponse>,
    ) => {
      const shared = resolveSharedLink(noteStore, request.params.shareToken, response)

      if (!shared) {
        return
      }

      applySharedLinkPolicy(response, shared.shareLink.frameAncestors)

      const owner = requireOwner(noteStore, request, response)

      if (!owner) {
        return
      }

      const membership = requireSharedMembership(
        noteStore,
        request,
        shared.campaign.id,
        response,
      )

      if (!membership) {
        return
      }

      const claimedMembership = noteStore.claimGuestMembership(membership.id, owner.id)

      if (claimedMembership.status === 'not-found') {
        response.status(404).json({ error: 'Guest membership was not found.' })
        return
      }

      if (claimedMembership.status === 'account-already-member') {
        response.status(409).json({
          error: 'This account already has a membership in this campaign.',
          details: [
            'Keep using the membership that is already attached to this account for this campaign.',
          ],
        })
        return
      }

      if (
        claimedMembership.status === 'already-linked' &&
        claimedMembership.membership.userId !== owner.id
      ) {
        response.status(409).json({
          error: 'This guest membership is already linked to another account.',
          details: [
            'Use the same browser session that originally claimed this membership or ask the campaign owner to share a fresh link.',
          ],
        })
        return
      }

      response.json({
        membership: claimedMembership.membership,
        guestToken: claimedMembership.status === 'claimed' ? claimedMembership.guestToken : null,
      })
    },
  )

  app.get(
    '/api/shared/:shareToken/overview',
    (
      request: Request<ShareParams>,
      response: Response<NotesOverview | ErrorResponse>,
    ) => {
      const shared = resolveSharedLink(noteStore, request.params.shareToken, response)

      if (!shared) {
        return
      }

      applySharedLinkPolicy(response, shared.shareLink.frameAncestors)

      const membership = requireSharedMembership(
        noteStore,
        request,
        shared.campaign.id,
        response,
      )

      if (!membership) {
        return
      }

      response.json(buildOverview(noteStore, shared.campaign.id, membership))
    },
  )

  app.get(
    '/api/shared/:shareToken/notes',
    (
      request: Request<ShareParams>,
      response: Response<NotesResponse | ErrorResponse>,
    ) => {
      const shared = resolveSharedLink(noteStore, request.params.shareToken, response)

      if (!shared) {
        return
      }

      applySharedLinkPolicy(response, shared.shareLink.frameAncestors)

      const membership = requireSharedMembership(
        noteStore,
        request,
        shared.campaign.id,
        response,
      )

      if (!membership) {
        return
      }

      response.json({ notes: noteStore.listNotes(shared.campaign.id) })
    },
  )

  app.get(
    '/api/shared/:shareToken/sessions',
    (
      request: Request<ShareParams>,
      response: Response<SessionsResponse | ErrorResponse>,
    ) => {
      const shared = resolveSharedLink(noteStore, request.params.shareToken, response)

      if (!shared) {
        return
      }

      applySharedLinkPolicy(response, shared.shareLink.frameAncestors)

      const membership = requireSharedMembership(
        noteStore,
        request,
        shared.campaign.id,
        response,
      )

      if (!membership) {
        return
      }

      response.json({ sessions: buildSessions(noteStore, shared.campaign.id) })
    },
  )

  app.post(
    '/api/shared/:shareToken/notes',
    (
      request: Request<ShareParams>,
      response: Response<NoteResponse | ErrorResponse>,
    ) => {
      const shared = resolveSharedLink(noteStore, request.params.shareToken, response)

      if (!shared) {
        return
      }

      applySharedLinkPolicy(response, shared.shareLink.frameAncestors)

      const membership = requireSharedMembership(
        noteStore,
        request,
        shared.campaign.id,
        response,
      )

      if (!membership || !requireEditorAccess(shared.shareLink.accessLevel, response)) {
        return
      }

      const validation = validateNoteCreateInput(request.body)

      if (!validation.success) {
        response.status(400).json({
          error: 'Note payload is invalid.',
          details: validation.errors,
        })
        return
      }

      try {
        const note = noteStore.createNote(
          {
            ...validation.data,
            campaignId: shared.campaign.id,
          },
          membership.id,
        )

        response.status(201).json({ note })
      } catch (error) {
        response.status(400).json({
          error: error instanceof Error ? error.message : 'Failed to create note.',
        })
      }
    },
  )

  app.put(
    '/api/shared/:shareToken/notes/:noteId',
    (
      request: Request<SharedNoteParams>,
      response: Response<NoteResponse | ErrorResponse>,
    ) => {
      const shared = resolveSharedLink(noteStore, request.params.shareToken, response)

      if (!shared) {
        return
      }

      applySharedLinkPolicy(response, shared.shareLink.frameAncestors)

      const membership = requireSharedMembership(
        noteStore,
        request,
        shared.campaign.id,
        response,
      )

      if (!membership || !requireEditorAccess(shared.shareLink.accessLevel, response)) {
        return
      }

      const existingNote = noteStore.getNote(request.params.noteId)

      if (!existingNote || existingNote.campaignId !== shared.campaign.id) {
        response.status(404).json({ error: `Note "${request.params.noteId}" was not found.` })
        return
      }

      const validation = validateNoteInput(request.body)

      if (!validation.success) {
        response.status(400).json({
          error: 'Note payload is invalid.',
          details: validation.errors,
        })
        return
      }

      try {
        const note = noteStore.updateNote(
          request.params.noteId,
          {
            ...validation.data,
            campaignId: shared.campaign.id,
          },
          membership.id,
        )

        if (!note) {
          response.status(404).json({ error: `Note "${request.params.noteId}" was not found.` })
          return
        }

        response.json({ note })
      } catch (error) {
        response.status(400).json({
          error: error instanceof Error ? error.message : 'Failed to update note.',
        })
      }
    },
  )

  app.delete(
    '/api/shared/:shareToken/notes/:noteId',
    (
      request: Request<SharedNoteParams>,
      response: Response<undefined | ErrorResponse>,
    ) => {
      const shared = resolveSharedLink(noteStore, request.params.shareToken, response)

      if (!shared) {
        return
      }

      applySharedLinkPolicy(response, shared.shareLink.frameAncestors)

      const membership = requireSharedMembership(
        noteStore,
        request,
        shared.campaign.id,
        response,
      )

      if (!membership || !requireEditorAccess(shared.shareLink.accessLevel, response)) {
        return
      }

      const note = noteStore.getNote(request.params.noteId)

      if (!note || note.campaignId !== shared.campaign.id) {
        response.status(404).json({ error: `Note "${request.params.noteId}" was not found.` })
        return
      }

      noteStore.deleteNote(request.params.noteId)
      response.status(204).send()
    },
  )

  return app
}

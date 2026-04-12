import cors from 'cors'
import express, { type Express, type Request, type Response } from 'express'
import type { NoteStore } from './note-store.js'
import type {
  AuthSessionResponse,
  CampaignMembership,
  CampaignMembershipsResponse,
  CampaignShareLinkCreateResponse,
  CampaignShareLinkRevealResponse,
  CampaignShareLinksResponse,
  CampaignResponse,
  CampaignsResponse,
  CurrentOwnerResponse,
  ErrorResponse,
  HealthResponse,
  NoteResponse,
  NotesOverview,
  NotesResponse,
  OwnerAccount,
  SharedJoinResponse,
  SharedMembershipClaimResponse,
  SharedSessionResponse,
} from './types.js'
import {
  validateCampaignInput,
  validateCampaignShareLinkInput,
  validateGuestJoinInput,
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

interface ShareParams extends Record<string, string> {
  shareToken: string
}

interface ShareLinkParams extends CampaignParams {
  shareLinkId: string
}

interface SharedNoteParams extends ShareParams {
  noteId: string
}

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

      const validation = validateNoteInput(request.body)

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

      const note = noteStore.createNote(
        {
          ...validation.data,
          campaignId: campaign.id,
        },
        membership.id,
      )

      response.status(201).json({ note })
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

      const validation = validateNoteInput(request.body)

      if (!validation.success) {
        response.status(400).json({
          error: 'Note payload is invalid.',
          details: validation.errors,
        })
        return
      }

      const note = noteStore.createNote(
        {
          ...validation.data,
          campaignId: shared.campaign.id,
        },
        membership.id,
      )

      response.status(201).json({ note })
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

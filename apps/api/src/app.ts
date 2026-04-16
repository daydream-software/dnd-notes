import cors from 'cors'
import express, { type Express, type Request, type Response } from 'express'
import type { NoteStore } from './note-store.js'
import { registerAdminRoutes } from './routes/admin-routes.js'
import { registerAuthRoutes } from './routes/auth-routes.js'
import {
  type CampaignParams,
  type NoteParams,
  type SessionParams,
  type ShareLinkParams,
  type ShareParams,
  type SharedNoteParams,
  buildNoteActivityResponse,
  buildOverview,
  buildSessions,
  buildSharedUrl,
  normalizePublicWebUrl,
  readRequestedActivityLimit,
  readRequestedCampaignId,
  readRequestedMembershipId,
  resolveAccessibleCampaign,
  resolveOwnedCampaign,
  resolveSharedLink,
  applySharedLinkPolicy,
  readSharedMembership,
  requireAuthenticatedAccount,
  requireEditorAccess,
  requireSharedMembership,
  sharedClaimRateLimitPolicy,
  sharedJoinRateLimitPolicy,
  type RateLimitPolicy,
} from './route-support.js'
import type {
  CampaignMembershipsResponse,
  MembershipConsolidationResponse,
  CampaignShareLinkCreateResponse,
  CampaignShareLinkRevealResponse,
  CampaignShareLinksResponse,
  CampaignResponse,
  CampaignsResponse,
  ErrorResponse,
  HealthResponse,
  NoteActivityResponse,
  NoteResponse,
  NotesOverview,
  NotesResponse,
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
} from './validation.js'
interface RateLimitBucket {
  count: number
  resetAt: number
}

interface CreateAppOptions {
  noteStore: NoteStore
  publicWebUrl?: string
  allowedOrigins?: string
  restoreNoteStore?: (sourcePath: string) => NoteStore
}

function readRateLimitClientId(request: Request) {
  return request.ip || request.socket.remoteAddress || 'unknown'
}

export function createApp({
  noteStore: initialNoteStore,
  publicWebUrl: configuredPublicWebUrl,
  allowedOrigins: configuredAllowedOrigins,
  restoreNoteStore,
}: CreateAppOptions): Express {
  const app = express()
  let noteStore = initialNoteStore
  const rateLimitBuckets = new Map<string, RateLimitBucket>()
  const publicWebUrl = normalizePublicWebUrl(configuredPublicWebUrl)

  function isRateLimited(
    request: Request,
    response: Response<ErrorResponse>,
    policyKey: string,
    policy: RateLimitPolicy,
    scopeKey?: string,
  ) {
    const now = Date.now()

    for (const [key, bucket] of rateLimitBuckets) {
      if (bucket.resetAt <= now) {
        rateLimitBuckets.delete(key)
      }
    }

    const bucketKey = [
      policyKey,
      readRateLimitClientId(request),
      scopeKey ?? '',
    ].join(':')
    const existingBucket = rateLimitBuckets.get(bucketKey)

    if (!existingBucket || existingBucket.resetAt <= now) {
      rateLimitBuckets.set(bucketKey, {
        count: 1,
        resetAt: now + policy.windowMs,
      })
      return false
    }

    if (existingBucket.count >= policy.maxRequests) {
      response.set(
        'Retry-After',
        Math.max(1, Math.ceil((existingBucket.resetAt - now) / 1000)).toString(),
      )
      response.status(429).json({ error: policy.errorMessage })
      return true
    }

    existingBucket.count += 1
    return false
  }

  const routeContext = {
    getNoteStore: () => noteStore,
    setNoteStore: (restoredNoteStore: NoteStore) => {
      noteStore = restoredNoteStore
    },
    publicWebUrl,
    restoreNoteStore,
    isRateLimited,
  }

  // CORS configuration - explicit origin allowlist for security
  const allowedOrigins = (configuredAllowedOrigins ?? process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)

  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (e.g., mobile apps, curl, Postman)
        if (!origin) {
          callback(null, true)
          return
        }

        // Check if origin is in allowlist
        if (allowedOrigins.includes(origin)) {
          callback(null, true)
          return
        }

        // Reject origin
        callback(new Error('CORS policy: Origin not allowed'))
      },
      credentials: true,
    }),
  )

  // Security headers middleware
  app.use((_request, response, next) => {
    // Prevent MIME type sniffing
    response.setHeader('X-Content-Type-Options', 'nosniff')

    // Prevent clickjacking for API routes (frame-ancestors CSP applied per-route for shared links)
    response.setHeader('X-Frame-Options', 'DENY')

    // XSS protection (legacy header, but doesn't hurt)
    response.setHeader('X-XSS-Protection', '1; mode=block')

    // Don't send referrer to external sites
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')

    next()
  })

  app.use(express.json())

  app.get('/health', (_request: Request, response: Response<HealthResponse>) => {
    response.json({ status: 'ok', service: 'dnd-notes-api' })
  })

  registerAdminRoutes(app, routeContext)
  registerAuthRoutes(app, routeContext)

  app.get(
    '/api/campaigns',
    (
      request: Request,
      response: Response<CampaignsResponse | ErrorResponse>,
    ) => {
      const owner = requireAuthenticatedAccount(noteStore, request, response)

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
      const owner = requireAuthenticatedAccount(noteStore, request, response)

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
      const owner = requireAuthenticatedAccount(noteStore, request, response)

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
      const owner = requireAuthenticatedAccount(noteStore, request, response)

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
      const owner = requireAuthenticatedAccount(noteStore, request, response)

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
      const owner = requireAuthenticatedAccount(noteStore, request, response)

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
      const owner = requireAuthenticatedAccount(noteStore, request, response)

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
      const owner = requireAuthenticatedAccount(noteStore, request, response)

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
      const owner = requireAuthenticatedAccount(noteStore, request, response)

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
        url: buildSharedUrl(request, created.token, publicWebUrl),
      })
    },
  )

  app.get(
    '/api/campaigns/:campaignId/share-links/:shareLinkId',
    (
      request: Request<ShareLinkParams>,
      response: Response<CampaignShareLinkRevealResponse | ErrorResponse>,
    ) => {
      const owner = requireAuthenticatedAccount(noteStore, request, response)

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
        url: buildSharedUrl(request, reveal.token, publicWebUrl),
      })
    },
  )

  app.delete(
    '/api/campaigns/:campaignId/share-links/:shareLinkId',
    (
      request: Request<ShareLinkParams>,
      response: Response<undefined | ErrorResponse>,
    ) => {
      const owner = requireAuthenticatedAccount(noteStore, request, response)

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
      const owner = requireAuthenticatedAccount(noteStore, request, response)

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
      const owner = requireAuthenticatedAccount(noteStore, request, response)

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
      const owner = requireAuthenticatedAccount(noteStore, request, response)

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
      const owner = requireAuthenticatedAccount(noteStore, request, response)

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
      const owner = requireAuthenticatedAccount(noteStore, request, response)

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
      const owner = requireAuthenticatedAccount(noteStore, request, response)

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
      const owner = requireAuthenticatedAccount(noteStore, request, response)

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
      const owner = requireAuthenticatedAccount(noteStore, request, response)

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
      const owner = requireAuthenticatedAccount(noteStore, request, response)

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
      const owner = requireAuthenticatedAccount(noteStore, request, response)

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
      if (
        isRateLimited(
          request,
          response,
          'shared-join',
          sharedJoinRateLimitPolicy,
          request.params.shareToken,
        )
      ) {
        return
      }

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
      if (
        isRateLimited(
          request,
          response,
          'shared-claim',
          sharedClaimRateLimitPolicy,
          request.params.shareToken,
        )
      ) {
        return
      }

      const shared = resolveSharedLink(noteStore, request.params.shareToken, response)

      if (!shared) {
        return
      }

      applySharedLinkPolicy(response, shared.shareLink.frameAncestors)

      const owner = requireAuthenticatedAccount(noteStore, request, response)

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

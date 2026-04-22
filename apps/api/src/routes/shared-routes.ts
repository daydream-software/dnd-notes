import type { Express, Request, Response } from 'express'
import {
  type ErrorResponse,
  type NoteResponse,
  type NotesOverview,
  type NotesResponse,
  type SessionsResponse,
  type SharedJoinResponse,
  type SharedMembershipClaimResponse,
  type SharedSessionResponse,
} from '../types.js'
import {
  type AppRouteContext,
  type ShareParams,
  type SharedNoteParams,
  applySharedLinkPolicy,
  buildOverview,
  buildSessions,
  requireAuthenticatedAccount,
  requireEditorAccess,
  requireSharedMembership,
  resolveSharedLink,
  sharedClaimRateLimitPolicy,
  sharedJoinRateLimitPolicy,
  readSharedMembership,
} from '../route-support.js'
import { validateGuestJoinInput, validateNoteCreateInput, validateNoteInput } from '../validation.js'

export function registerSharedRoutes(app: Express, context: AppRouteContext) {
  app.get(
    '/api/shared/:shareToken/session',
    async (
      request: Request<ShareParams>,
      response: Response<SharedSessionResponse | ErrorResponse>,
    ) => {
      const noteStore = context.getNoteStore()
      const shared = await resolveSharedLink(noteStore, request.params.shareToken, response)

      if (!shared) {
        return
      }

      applySharedLinkPolicy(response, shared.shareLink.frameAncestors)

      response.json({
        campaign: shared.campaign,
        shareLink: shared.shareLink,
        membership: await readSharedMembership(noteStore, request, shared.campaign.id),
      })
    },
  )

  app.post(
    '/api/shared/:shareToken/join',
    async (
      request: Request<ShareParams>,
      response: Response<SharedJoinResponse | ErrorResponse>,
    ) => {
      if (
        context.isRateLimited(
          request,
          response,
          'shared-join',
          sharedJoinRateLimitPolicy,
          request.params.shareToken,
        )
      ) {
        return
      }

      const noteStore = context.getNoteStore()
      const shared = await resolveSharedLink(noteStore, request.params.shareToken, response)

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

      const guestSession = await noteStore.createGuestMembership(
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
    async (
      request: Request<ShareParams>,
      response: Response<SharedMembershipClaimResponse | ErrorResponse>,
    ) => {
      if (
        context.isRateLimited(
          request,
          response,
          'shared-claim',
          sharedClaimRateLimitPolicy,
          request.params.shareToken,
        )
      ) {
        return
      }

      const noteStore = context.getNoteStore()
      const shared = await resolveSharedLink(noteStore, request.params.shareToken, response)

      if (!shared) {
        return
      }

      applySharedLinkPolicy(response, shared.shareLink.frameAncestors)

      const owner = await requireAuthenticatedAccount(noteStore, request, response, context.runtimeAuth)

      if (!owner) {
        return
      }

      const membership = await requireSharedMembership(
        noteStore,
        request,
        shared.campaign.id,
        response,
      )

      if (!membership) {
        return
      }

      const claimedMembership = await noteStore.claimGuestMembership(membership.id, owner.id)

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
    async (
      request: Request<ShareParams>,
      response: Response<NotesOverview | ErrorResponse>,
    ) => {
      const noteStore = context.getNoteStore()
      const shared = await resolveSharedLink(noteStore, request.params.shareToken, response)

      if (!shared) {
        return
      }

      applySharedLinkPolicy(response, shared.shareLink.frameAncestors)

      const membership = await requireSharedMembership(
        noteStore,
        request,
        shared.campaign.id,
        response,
      )

      if (!membership) {
        return
      }

      response.json(await buildOverview(noteStore, shared.campaign.id, membership))
    },
  )

  app.get(
    '/api/shared/:shareToken/notes',
    async (
      request: Request<ShareParams>,
      response: Response<NotesResponse | ErrorResponse>,
    ) => {
      const noteStore = context.getNoteStore()
      const shared = await resolveSharedLink(noteStore, request.params.shareToken, response)

      if (!shared) {
        return
      }

      applySharedLinkPolicy(response, shared.shareLink.frameAncestors)

      const membership = await requireSharedMembership(
        noteStore,
        request,
        shared.campaign.id,
        response,
      )

      if (!membership) {
        return
      }

      response.json({ notes: await noteStore.listNotes(shared.campaign.id) })
    },
  )

  app.get(
    '/api/shared/:shareToken/sessions',
    async (
      request: Request<ShareParams>,
      response: Response<SessionsResponse | ErrorResponse>,
    ) => {
      const noteStore = context.getNoteStore()
      const shared = await resolveSharedLink(noteStore, request.params.shareToken, response)

      if (!shared) {
        return
      }

      applySharedLinkPolicy(response, shared.shareLink.frameAncestors)

      const membership = await requireSharedMembership(
        noteStore,
        request,
        shared.campaign.id,
        response,
      )

      if (!membership) {
        return
      }

      response.json({ sessions: await buildSessions(noteStore, shared.campaign.id) })
    },
  )

  app.post(
    '/api/shared/:shareToken/notes',
    async (
      request: Request<ShareParams>,
      response: Response<NoteResponse | ErrorResponse>,
    ) => {
      const noteStore = context.getNoteStore()
      const shared = await resolveSharedLink(noteStore, request.params.shareToken, response)

      if (!shared) {
        return
      }

      applySharedLinkPolicy(response, shared.shareLink.frameAncestors)

      const membership = await requireSharedMembership(
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
        const note = await noteStore.createNote(
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
    async (
      request: Request<SharedNoteParams>,
      response: Response<NoteResponse | ErrorResponse>,
    ) => {
      const noteStore = context.getNoteStore()
      const shared = await resolveSharedLink(noteStore, request.params.shareToken, response)

      if (!shared) {
        return
      }

      applySharedLinkPolicy(response, shared.shareLink.frameAncestors)

      const membership = await requireSharedMembership(
        noteStore,
        request,
        shared.campaign.id,
        response,
      )

      if (!membership || !requireEditorAccess(shared.shareLink.accessLevel, response)) {
        return
      }

      const existingNote = await noteStore.getNote(request.params.noteId)

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
        const note = await noteStore.updateNote(
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
    async (
      request: Request<SharedNoteParams>,
      response: Response<undefined | ErrorResponse>,
    ) => {
      const noteStore = context.getNoteStore()
      const shared = await resolveSharedLink(noteStore, request.params.shareToken, response)

      if (!shared) {
        return
      }

      applySharedLinkPolicy(response, shared.shareLink.frameAncestors)

      const membership = await requireSharedMembership(
        noteStore,
        request,
        shared.campaign.id,
        response,
      )

      if (!membership || !requireEditorAccess(shared.shareLink.accessLevel, response)) {
        return
      }

      const note = await noteStore.getNote(request.params.noteId)

      if (!note || note.campaignId !== shared.campaign.id) {
        response.status(404).json({ error: `Note "${request.params.noteId}" was not found.` })
        return
      }

      await noteStore.deleteNote(request.params.noteId)
      response.status(204).send()
    },
  )
}

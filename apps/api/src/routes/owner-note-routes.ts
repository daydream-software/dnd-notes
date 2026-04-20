import type { Express, Request, Response } from 'express'
import {
  type ErrorResponse,
  type NoteActivityResponse,
  type NoteResponse,
  type NotesOverview,
  type NotesResponse,
  type SessionsResponse,
} from '../types.js'
import {
  type AppRouteContext,
  type NoteParams,
  type SessionParams,
  buildNoteActivityResponse,
  buildOverview,
  buildSessions,
  readRequestedActivityLimit,
  readRequestedCampaignId,
  readRequestedMembershipId,
  requireAuthenticatedAccount,
  resolveAccessibleCampaign,
} from '../route-support.js'
import { validateNoteCreateInput, validateNoteInput } from '../validation.js'

export function registerOwnerNoteRoutes(app: Express, context: AppRouteContext) {
  app.get(
    '/api/overview',
    async (
      request: Request,
      response: Response<NotesOverview | ErrorResponse>,
    ) => {
      const noteStore = context.getNoteStore()
      const owner = await requireAuthenticatedAccount(noteStore, request, response)

      if (!owner) {
        return
      }

      const campaign = await resolveAccessibleCampaign(
        noteStore,
        owner,
        readRequestedCampaignId(request),
        response,
      )

      if (!campaign) {
        return
      }

      response.json(
        await buildOverview(
          noteStore,
          campaign.id,
          await noteStore.getUserMembershipForCampaign(owner.id, campaign.id),
        ),
      )
    },
  )

  app.get(
    '/api/notes',
    async (
      request: Request,
      response: Response<NotesResponse | ErrorResponse>,
    ) => {
      const noteStore = context.getNoteStore()
      const owner = await requireAuthenticatedAccount(noteStore, request, response)

      if (!owner) {
        return
      }

      const campaign = await resolveAccessibleCampaign(
        noteStore,
        owner,
        readRequestedCampaignId(request),
        response,
      )

      if (!campaign) {
        return
      }

      response.json({ notes: await noteStore.listNotes(campaign.id) })
    },
  )

  app.get(
    '/api/notes/activity',
    async (
      request: Request,
      response: Response<NoteActivityResponse | ErrorResponse>,
    ) => {
      const noteStore = context.getNoteStore()
      const owner = await requireAuthenticatedAccount(noteStore, request, response)

      if (!owner) {
        return
      }

      const campaign = await resolveAccessibleCampaign(
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
        const membership = (await noteStore.listCampaignMemberships(campaign.id))
          .find((candidate) => candidate.id === membershipId)

        if (!membership) {
          response
            .status(400)
            .json({ error: 'Activity membership filter is invalid for this campaign.' })
          return
        }
      }

      response.json(
        await buildNoteActivityResponse(noteStore, campaign.id, membershipId, limit),
      )
    },
  )

  app.get(
    '/api/notes/sessions',
    async (request: Request, response: Response<SessionsResponse | ErrorResponse>) => {
      const noteStore = context.getNoteStore()
      const owner = await requireAuthenticatedAccount(noteStore, request, response)

      if (!owner) {
        return
      }

      const campaign = await resolveAccessibleCampaign(
        noteStore,
        owner,
        readRequestedCampaignId(request),
        response,
      )

      if (!campaign) {
        return
      }

      response.json({ sessions: await buildSessions(noteStore, campaign.id) })
    },
  )

  app.post(
    '/api/notes',
    async (
      request: Request,
      response: Response<NoteResponse | ErrorResponse>,
    ) => {
      const noteStore = context.getNoteStore()
      const owner = await requireAuthenticatedAccount(noteStore, request, response)

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

      const campaign = await resolveAccessibleCampaign(
        noteStore,
        owner,
        validation.data.campaignId,
        response,
      )

      if (!campaign) {
        return
      }

      const membership = await noteStore.getUserMembershipForCampaign(owner.id, campaign.id)

      if (!membership) {
        response.status(403).json({ error: 'You do not have access to this campaign.' })
        return
      }

      try {
        const note = await noteStore.createNote(
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
    async (
      request: Request<SessionParams>,
      response: Response<NotesResponse | ErrorResponse>,
    ) => {
      const noteStore = context.getNoteStore()
      const owner = await requireAuthenticatedAccount(noteStore, request, response)

      if (!owner) {
        return
      }

      const campaign = await resolveAccessibleCampaign(
        noteStore,
        owner,
        readRequestedCampaignId(request),
        response,
      )

      if (!campaign) {
        return
      }

      const notes = await noteStore.getSessionNotes(campaign.id, request.params.sessionId)

      response.json({ notes })
    },
  )

  app.get(
    '/api/notes/:noteId',
    async (
      request: Request<NoteParams>,
      response: Response<NoteResponse | ErrorResponse>,
    ) => {
      const noteStore = context.getNoteStore()
      const owner = await requireAuthenticatedAccount(noteStore, request, response)

      if (!owner) {
        return
      }

      const note = await noteStore.getNote(request.params.noteId)

      if (!note) {
        response
          .status(404)
          .json({ error: `Note "${request.params.noteId}" was not found.` })
        return
      }

      if (!(await noteStore.userHasCampaignAccess(owner.id, note.campaignId))) {
        response.status(403).json({ error: 'You do not have access to this note.' })
        return
      }

      response.json({ note })
    },
  )

  app.get(
    '/api/notes/:noteId/backlinks',
    async (
      request: Request<NoteParams>,
      response: Response<NotesResponse | ErrorResponse>,
    ) => {
      const noteStore = context.getNoteStore()
      const owner = await requireAuthenticatedAccount(noteStore, request, response)

      if (!owner) {
        return
      }

      const note = await noteStore.getNote(request.params.noteId)

      if (!note) {
        response
          .status(404)
          .json({ error: `Note "${request.params.noteId}" was not found.` })
        return
      }

      if (!(await noteStore.userHasCampaignAccess(owner.id, note.campaignId))) {
        response.status(403).json({ error: 'You do not have access to this note.' })
        return
      }

      const backlinks = await noteStore.getBacklinks(request.params.noteId)
      response.json({ notes: backlinks })
    },
  )

  app.put(
    '/api/notes/:noteId',
    async (
      request: Request<NoteParams>,
      response: Response<NoteResponse | ErrorResponse>,
    ) => {
      const noteStore = context.getNoteStore()
      const owner = await requireAuthenticatedAccount(noteStore, request, response)

      if (!owner) {
        return
      }

      const existingNote = await noteStore.getNote(request.params.noteId)

      if (!existingNote) {
        response
          .status(404)
          .json({ error: `Note "${request.params.noteId}" was not found.` })
        return
      }

      const membership = await noteStore.getUserMembershipForCampaign(
        owner.id,
        existingNote.campaignId,
      )

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
        const note = await noteStore.updateNote(
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
    async (
      request: Request<NoteParams>,
      response: Response<undefined | ErrorResponse>,
    ) => {
      const noteStore = context.getNoteStore()
      const owner = await requireAuthenticatedAccount(noteStore, request, response)

      if (!owner) {
        return
      }

      const note = await noteStore.getNote(request.params.noteId)

      if (!note) {
        response
          .status(404)
          .json({ error: `Note "${request.params.noteId}" was not found.` })
        return
      }

      if (!(await noteStore.userHasCampaignAccess(owner.id, note.campaignId))) {
        response.status(403).json({ error: 'You do not have access to this note.' })
        return
      }

      await noteStore.deleteNote(request.params.noteId)
      response.status(204).send()
    },
  )
}

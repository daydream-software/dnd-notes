import cors from 'cors'
import express, { type Express, type Request, type Response } from 'express'
import type { NoteStore } from './note-store.js'
import type {
  CampaignMembershipsResponse,
  CampaignResponse,
  CampaignsResponse,
  ErrorResponse,
  HealthResponse,
  NoteResponse,
  NotesOverview,
  NotesResponse,
} from './types.js'
import { validateCampaignInput, validateNoteInput } from './validation.js'

interface NoteParams {
  noteId: string
}

interface CampaignParams {
  campaignId: string
}

interface CreateAppOptions {
  noteStore: NoteStore
}

function readRequestedCampaignId(request: Request) {
  const value = request.query.campaignId
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function resolveCampaign(
  noteStore: NoteStore,
  request: Request,
  response: Response<ErrorResponse>,
) {
  const requestedCampaignId = readRequestedCampaignId(request)
  const campaign = requestedCampaignId
    ? noteStore.getCampaign(requestedCampaignId)
    : noteStore.getPrimaryCampaign()

  if (!campaign || campaign.archivedAt !== null) {
    response.status(404).json({
      error: requestedCampaignId
        ? `Campaign "${requestedCampaignId}" was not found.`
        : 'No active campaign is available.',
    })
    return null
  }

  return campaign
}

function buildOverview(noteStore: NoteStore, campaignId?: string): NotesOverview {
  const campaign = campaignId
    ? noteStore.getCampaign(campaignId)
    : noteStore.getPrimaryCampaign()

  if (!campaign || campaign.archivedAt !== null) {
    throw new Error(`Campaign "${campaignId}" was not found.`)
  }

  return {
    campaign,
    stats: noteStore.getStats(campaign.id),
    recentNotes: noteStore.listRecentNotes(3, campaign.id),
  }
}

export function createApp({ noteStore }: CreateAppOptions): Express {
  const app = express()

  app.use(cors())
  app.use(express.json())

  app.get('/health', (_request: Request, response: Response<HealthResponse>) => {
    response.json({ status: 'ok', service: 'dnd-notes-api' })
  })

  app.get(
    '/api/campaigns',
    (_request: Request, response: Response<CampaignsResponse>) => {
      response.json({ campaigns: noteStore.listCampaigns() })
    },
  )

  app.post(
    '/api/campaigns',
    (request: Request, response: Response<CampaignResponse | ErrorResponse>) => {
      const validation = validateCampaignInput(request.body)

      if (!validation.success) {
        response.status(400).json({
          error: 'Campaign payload is invalid.',
          details: validation.errors,
        })
        return
      }

      const campaign = noteStore.createCampaign(validation.data)
      response.status(201).json({ campaign })
    },
  )

  app.get(
    '/api/campaigns/:campaignId',
    (
      request: Request<CampaignParams>,
      response: Response<CampaignResponse | ErrorResponse>,
    ) => {
      const campaign = noteStore.getCampaign(request.params.campaignId)

      if (!campaign || campaign.archivedAt !== null) {
        response
          .status(404)
          .json({ error: `Campaign "${request.params.campaignId}" was not found.` })
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
      const validation = validateCampaignInput(request.body)

      if (!validation.success) {
        response.status(400).json({
          error: 'Campaign payload is invalid.',
          details: validation.errors,
        })
        return
      }

      const campaign = noteStore.updateCampaign(
        request.params.campaignId,
        validation.data,
      )

      if (!campaign) {
        response
          .status(404)
          .json({ error: `Campaign "${request.params.campaignId}" was not found.` })
        return
      }

      response.json({ campaign })
    },
  )

  app.get(
    '/api/campaigns/:campaignId/memberships',
    (
      request: Request<CampaignParams>,
      response: Response<CampaignMembershipsResponse | ErrorResponse>,
    ) => {
      const campaign = noteStore.getCampaign(request.params.campaignId)

      if (!campaign || campaign.archivedAt !== null) {
        response
          .status(404)
          .json({ error: `Campaign "${request.params.campaignId}" was not found.` })
        return
      }

      response.json({
        memberships: noteStore.listCampaignMemberships(request.params.campaignId),
      })
    },
  )

  app.get(
    '/api/overview',
    (
      request: Request,
      response: Response<NotesOverview | ErrorResponse>,
    ) => {
      const campaign = resolveCampaign(noteStore, request, response)

      if (!campaign) {
        return
      }

      response.json(buildOverview(noteStore, campaign.id))
    },
  )

  app.get(
    '/api/notes',
    (request: Request, response: Response<NotesResponse | ErrorResponse>) => {
      const campaign = resolveCampaign(noteStore, request, response)

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
      const note = noteStore.getNote(request.params.noteId)

      if (!note) {
        response
          .status(404)
          .json({ error: `Note "${request.params.noteId}" was not found.` })
        return
      }

      response.json({ note })
    },
  )

  app.post(
    '/api/notes',
    (request: Request, response: Response<NoteResponse | ErrorResponse>) => {
      const validation = validateNoteInput(request.body)

      if (!validation.success) {
        response.status(400).json({
          error: 'Note payload is invalid.',
          details: validation.errors,
        })
        return
      }

      if (validation.data.campaignId) {
        const campaign = noteStore.getCampaign(validation.data.campaignId)

        if (!campaign || campaign.archivedAt !== null) {
          response.status(404).json({
            error: `Campaign "${validation.data.campaignId}" was not found.`,
          })
          return
        }
      }

      const note = noteStore.createNote(validation.data)
      response.status(201).json({ note })
    },
  )

  app.put(
    '/api/notes/:noteId',
    (
      request: Request<NoteParams>,
      response: Response<NoteResponse | ErrorResponse>,
    ) => {
      const validation = validateNoteInput(request.body)

      if (!validation.success) {
        response.status(400).json({
          error: 'Note payload is invalid.',
          details: validation.errors,
        })
        return
      }

      const note = noteStore.updateNote(request.params.noteId, validation.data)

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
      const deleted = noteStore.deleteNote(request.params.noteId)

      if (!deleted) {
        response
          .status(404)
          .json({ error: `Note "${request.params.noteId}" was not found.` })
        return
      }

      response.status(204).send()
    },
  )

  return app
}

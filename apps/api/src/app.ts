import cors from 'cors'
import express, { type Express, type Request, type Response } from 'express'
import type { NoteStore } from './note-store.js'
import type {
  AuthSessionResponse,
  CampaignMembershipsResponse,
  CampaignResponse,
  CampaignsResponse,
  CurrentOwnerResponse,
  ErrorResponse,
  HealthResponse,
  NoteResponse,
  NotesOverview,
  NotesResponse,
  OwnerAccount,
} from './types.js'
import {
  validateCampaignInput,
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

function readRequestedCampaignId(request: Request) {
  const value = request.query.campaignId
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function buildOverview(noteStore: NoteStore, campaignId: string): NotesOverview {
  const campaign = noteStore.getCampaign(campaignId)

  if (!campaign || campaign.archivedAt !== null) {
    throw new Error(`Campaign "${campaignId}" was not found.`)
  }

  return {
    campaign,
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

      response.json({ campaigns: noteStore.listOwnedCampaigns(owner.id) })
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

      const campaign = resolveOwnedCampaign(
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
    '/api/overview',
    (
      request: Request,
      response: Response<NotesOverview | ErrorResponse>,
    ) => {
      const owner = requireOwner(noteStore, request, response)

      if (!owner) {
        return
      }

      const campaign = resolveOwnedCampaign(
        noteStore,
        owner,
        readRequestedCampaignId(request),
        response,
      )

      if (!campaign) {
        return
      }

      response.json(buildOverview(noteStore, campaign.id))
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

      const campaign = resolveOwnedCampaign(
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

      if (!noteStore.userOwnsCampaign(owner.id, note.campaignId)) {
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

      const campaign = resolveOwnedCampaign(
        noteStore,
        owner,
        validation.data.campaignId,
        response,
      )

      if (!campaign) {
        return
      }

      const note = noteStore.createNote({
        ...validation.data,
        campaignId: campaign.id,
      })

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

      if (!noteStore.userOwnsCampaign(owner.id, existingNote.campaignId)) {
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

      const note = noteStore.updateNote(request.params.noteId, {
        ...validation.data,
        campaignId: existingNote.campaignId,
      })

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

      if (!noteStore.userOwnsCampaign(owner.id, note.campaignId)) {
        response.status(403).json({ error: 'You do not have access to this note.' })
        return
      }

      noteStore.deleteNote(request.params.noteId)
      response.status(204).send()
    },
  )

  return app
}

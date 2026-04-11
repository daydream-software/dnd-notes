import cors from 'cors'
import express, { type Express, type Request, type Response } from 'express'
import { defaultCampaign } from './campaign.js'
import type { NoteStore } from './note-store.js'
import type {
  ErrorResponse,
  HealthResponse,
  NoteResponse,
  NotesOverview,
  NotesResponse,
} from './types.js'
import { validateNoteInput } from './validation.js'

interface NoteParams {
  noteId: string
}

interface CreateAppOptions {
  noteStore: NoteStore
}

function buildOverview(noteStore: NoteStore): NotesOverview {
  return {
    campaign: defaultCampaign,
    stats: noteStore.getStats(),
    recentNotes: noteStore.listRecentNotes(3),
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
    '/api/overview',
    (_request: Request, response: Response<NotesOverview>) => {
      response.json(buildOverview(noteStore))
    },
  )

  app.get('/api/notes', (_request: Request, response: Response<NotesResponse>) => {
    response.json({ notes: noteStore.listNotes() })
  })

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

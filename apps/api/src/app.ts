import cors from 'cors'
import express, { type Express, type Request, type Response } from 'express'
import { overview } from './data.js'
import type {
  CampaignOverview,
  ErrorResponse,
  HealthResponse,
  NoteResponse,
  NotesResponse,
} from './types.js'

interface NoteParams {
  noteId: string
}

export function createApp(): Express {
  const app = express()

  app.use(cors())
  app.use(express.json())

  app.get('/health', (_request: Request, response: Response<HealthResponse>) => {
    response.json({ status: 'ok', service: 'dnd-notes-api' })
  })

  app.get(
    '/api/overview',
    (_request: Request, response: Response<CampaignOverview>) => {
      response.json(overview)
    },
  )

  app.get('/api/notes', (_request: Request, response: Response<NotesResponse>) => {
    response.json({ notes: overview.notes })
  })

  app.get(
    '/api/notes/:noteId',
    (
      request: Request<NoteParams>,
      response: Response<NoteResponse | ErrorResponse>,
    ) => {
      const note = overview.notes.find((entry) => entry.id === request.params.noteId)

      if (!note) {
        response
          .status(404)
          .json({ error: `Note "${request.params.noteId}" was not found.` })
        return
      }

      response.json({ note })
    },
  )

  return app
}

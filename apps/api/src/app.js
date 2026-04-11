import cors from 'cors'
import express from 'express'
import { overview } from './data.js'

export function createApp() {
  const app = express()

  app.use(cors())
  app.use(express.json())

  app.get('/health', (_request, response) => {
    response.json({ status: 'ok', service: 'dnd-notes-api' })
  })

  app.get('/api/overview', (_request, response) => {
    response.json(overview)
  })

  app.get('/api/notes', (_request, response) => {
    response.json({ notes: overview.notes })
  })

  app.get('/api/notes/:noteId', (request, response) => {
    const note = overview.notes.find((entry) => entry.id === request.params.noteId)

    if (!note) {
      response.status(404).json({ error: `Note "${request.params.noteId}" was not found.` })
      return
    }

    response.json({ note })
  })

  return app
}

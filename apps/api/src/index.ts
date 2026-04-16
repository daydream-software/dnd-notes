import 'dotenv/config'
import { createApp } from './app.js'
import { createNoteStore } from './note-store.js'

const port = Number(process.env.PORT ?? 3001)
const noteStore = createNoteStore()
const app = createApp({ noteStore })

function shutdown(exitCode: number) {
  noteStore.close()
  process.exit(exitCode)
}

app.listen(port, () => {
  console.log(`dnd-notes API listening on http://localhost:${port}`)
})

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

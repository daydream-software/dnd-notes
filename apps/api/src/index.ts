import 'dotenv/config'
import { createApp } from './app.js'
import { createNoteStore, restoreNoteStoreFromBackup } from './note-store.js'

const port = Number(process.env.PORT ?? 3001)
const serveWeb = process.env.SERVE_WEB === 'true'
const siteAdminEmails =
  process.env.SITE_ADMIN_EMAILS?.split(',').map((email) => email.trim()) ?? []
let noteStore = createNoteStore({ siteAdminEmails })
const app = createApp({
  noteStore,
  publicWebUrl: process.env.PUBLIC_WEB_URL,
  restoreNoteStore(sourcePath) {
    noteStore = restoreNoteStoreFromBackup(sourcePath, { siteAdminEmails })
    return noteStore
  },
  serveWeb,
})

function shutdown(exitCode: number) {
  noteStore.close()
  process.exit(exitCode)
}

app.listen(port, () => {
  console.log(`dnd-notes API listening on http://localhost:${port}`)
})

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

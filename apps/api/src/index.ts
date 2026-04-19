import 'dotenv/config'
import type { Server } from 'node:http'
import { createApp } from './app.js'
import { createNoteStore, restoreNoteStoreFromBackup } from './note-store.js'
import { createShutdownController } from './shutdown.js'

const port = Number(process.env.PORT ?? 3001)
const serveWeb = process.env.SERVE_WEB === 'true'
const shutdownGracePeriodMs = 30_000
const siteAdminEmails =
  process.env.SITE_ADMIN_EMAILS?.split(',').map((email) => email.trim()) ?? []
let noteStore = await createNoteStore({ siteAdminEmails })
const serverRef: { current?: Server } = {}
const shutdownController = createShutdownController({
  getServer: () => serverRef.current,
  closeResources: () => noteStore.close(),
  exit: (exitCode) => process.exit(exitCode),
  shutdownGracePeriodMs,
})
const app = createApp({
  noteStore,
  publicWebUrl: process.env.PUBLIC_WEB_URL,
  async restoreNoteStore(sourcePath) {
    noteStore = await restoreNoteStoreFromBackup(sourcePath, { siteAdminEmails })
    return noteStore
  },
  isShuttingDown: shutdownController.isShuttingDown,
  serveWeb,
})
serverRef.current = app.listen(port, () => {
  console.log(`dnd-notes API listening on http://localhost:${port}`)
})

process.on('SIGINT', () => shutdownController.shutdown(0))
process.on('SIGTERM', () => shutdownController.shutdown(0))

import 'dotenv/config'
import type { Server } from 'node:http'
import { createApp } from './app.js'
import { createNoteStore, restoreNoteStoreFromBackup } from './note-store.js'

const port = Number(process.env.PORT ?? 3001)
const serveWeb = process.env.SERVE_WEB === 'true'
const shutdownGracePeriodMs = 30_000
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
  isShuttingDown: () => shuttingDown,
  serveWeb,
})
let shuttingDown = false

function isServerNotRunningError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ERR_SERVER_NOT_RUNNING'
}

function finishShutdown(exitCode: number) {
  noteStore.close()
  process.exit(exitCode)
}

function shutdown(exitCode: number) {
  if (shuttingDown) {
    return
  }

  shuttingDown = true

  const forceShutdownTimer = setTimeout(() => {
    server?.closeAllConnections?.()
    finishShutdown(exitCode)
  }, shutdownGracePeriodMs)
  forceShutdownTimer.unref()

  server.close((error) => {
    clearTimeout(forceShutdownTimer)

    if (error) {
      if (isServerNotRunningError(error)) {
        finishShutdown(exitCode)
        return
      }

      console.error('Failed to close HTTP server cleanly.', error)
      finishShutdown(1)
      return
    }

    finishShutdown(exitCode)
  })
  server.closeIdleConnections?.()
}

const server: Server = app.listen(port, () => {
  console.log(`dnd-notes API listening on http://localhost:${port}`)
})

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

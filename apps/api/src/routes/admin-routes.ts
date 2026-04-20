import { createReadStream } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express, { type Express, type Request, type Response } from 'express'
import { InvalidBackupDatabaseError } from '../note-store.js'
import {
  type AdminAccountsResponse,
  type AdminOverviewResponse,
  type AdminRestoreResponse,
  type ErrorResponse,
} from '../types.js'
import {
  type AppRouteContext,
  requireSiteAdmin,
  sqliteFileHeader,
} from '../route-support.js'

export function registerAdminRoutes(app: Express, context: AppRouteContext) {
  app.get(
    '/api/admin/accounts',
    async (
      request: Request,
      response: Response<AdminAccountsResponse | ErrorResponse>,
    ) => {
      const noteStore = context.getNoteStore()
      const siteAdmin = await requireSiteAdmin(noteStore, request, response)

      if (!siteAdmin) {
        return
      }

      response.json({ accounts: await noteStore.listOwnerAccounts() })
    },
  )

  app.get(
    '/api/admin/overview',
    async (
      request: Request,
      response: Response<AdminOverviewResponse | ErrorResponse>,
    ) => {
      const noteStore = context.getNoteStore()
      const siteAdmin = await requireSiteAdmin(noteStore, request, response)

      if (!siteAdmin) {
        return
      }

      response.json({ overview: await noteStore.getAdminOverview() })
    },
  )

  app.get(
    '/api/admin/backup',
    async (
      request: Request,
      response: Response<ErrorResponse>,
    ) => {
      const noteStore = context.getNoteStore()
      const siteAdmin = await requireSiteAdmin(noteStore, request, response)

      if (!siteAdmin) {
        return
      }

      const backupDirectory = await mkdtemp(join(tmpdir(), 'dnd-notes-backup-'))
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const backupFileName = `dnd-notes-backup-${timestamp}.sqlite`
      const backupPath = join(backupDirectory, backupFileName)

      try {
        await noteStore.backupDatabase(backupPath)
      } catch {
        await rm(backupDirectory, { recursive: true, force: true })
        response.status(500).json({ error: 'Could not create the admin backup.' })
        return
      }

      response.setHeader('Content-Type', 'application/octet-stream')
      response.setHeader(
        'Content-Disposition',
        `attachment; filename="${backupFileName}"`,
      )

      const stream = createReadStream(backupPath)
      let cleanedUp = false

      const cleanupBackup = () => {
        if (cleanedUp) {
          return
        }

        cleanedUp = true
        void rm(backupDirectory, { recursive: true, force: true })
      }

      stream.on('error', () => {
        cleanupBackup()

        if (!response.headersSent) {
          response.status(500).json({ error: 'Could not stream the admin backup.' })
          return
        }

        response.destroy()
      })

      response.on('finish', cleanupBackup)
      response.on('close', cleanupBackup)
      stream.pipe(response)
    },
  )

  app.post(
    '/api/admin/restore',
    express.raw({
      type: [
        'application/octet-stream',
        'application/vnd.sqlite3',
        'application/x-sqlite3',
      ],
      limit: '50mb',
    }),
    async (
      request: Request,
      response: Response<AdminRestoreResponse | ErrorResponse>,
    ) => {
      let noteStore = context.getNoteStore()
      const siteAdmin = await requireSiteAdmin(noteStore, request, response)

      if (!siteAdmin) {
        return
      }

      if (!context.restoreNoteStore) {
        response.status(500).json({ error: 'Admin restore is not configured.' })
        return
      }

      if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
        response.status(400).json({ error: 'A SQLite backup file is required.' })
        return
      }

      if (
        request.body.length < sqliteFileHeader.length ||
        !request.body.subarray(0, sqliteFileHeader.length).equals(sqliteFileHeader)
      ) {
        response
          .status(400)
          .json({ error: 'The uploaded file is not a valid SQLite backup.' })
        return
      }

      const restoreDirectory = await mkdtemp(join(tmpdir(), 'dnd-notes-restore-'))
      const uploadPath = join(restoreDirectory, 'uploaded-backup.sqlite')
      const rollbackPath = join(restoreDirectory, 'rollback.sqlite')

      try {
        await writeFile(uploadPath, request.body)
        await noteStore.backupDatabase(rollbackPath)
      } catch {
        await rm(restoreDirectory, { recursive: true, force: true })
        response
          .status(500)
          .json({ error: 'Could not prepare the current database for restore.' })
        return
      }

      await noteStore.close()

      try {
        noteStore = await context.restoreNoteStore(uploadPath)
        context.setNoteStore(noteStore)
      } catch (restoreError) {
        try {
          noteStore = await context.restoreNoteStore(rollbackPath)
          context.setNoteStore(noteStore)
        } catch {
          await rm(restoreDirectory, { recursive: true, force: true })
          response.status(500).json({
            error:
              'Restore failed and the original database could not be reopened.',
          })
          return
        }

        await rm(restoreDirectory, { recursive: true, force: true })

        if (restoreError instanceof InvalidBackupDatabaseError) {
          response.status(400).json({
            error: 'The uploaded file is not a valid dnd-notes SQLite backup.',
          })
          return
        }

        response.status(500).json({ error: 'Could not restore the admin backup.' })
        return
      }

      await rm(restoreDirectory, { recursive: true, force: true })

      response.json({
        message: 'Backup restored successfully.',
        restoredAt: new Date().toISOString(),
        overview: await noteStore.getAdminOverview(),
      })
    },
  )
}

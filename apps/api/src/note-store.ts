import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultCampaign } from './campaign.js'
import type { Note, NoteInput, NoteStats } from './types.js'

interface NoteRow {
  id: string
  campaign_id: string
  title: string
  body: string
  status: Note['status']
  tags_json: string
  session_name: string | null
  created_at: string
  updated_at: string
}

interface CreateNoteStoreOptions {
  dbPath?: string
}

export interface NoteStore {
  listNotes(): Note[]
  listRecentNotes(limit: number): Note[]
  getNote(noteId: string): Note | null
  createNote(input: NoteInput): Note
  updateNote(noteId: string, input: NoteInput): Note | null
  deleteNote(noteId: string): boolean
  getStats(): NoteStats
  close(): void
}

const defaultDbPath = fileURLToPath(
  new URL('../data/dnd-notes.sqlite', import.meta.url),
)

function mapRow(row: NoteRow): Note {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    title: row.title,
    body: row.body,
    status: row.status,
    tags: JSON.parse(row.tags_json) as string[],
    sessionName: row.session_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function createNoteStore(
  options: CreateNoteStoreOptions = {},
): NoteStore {
  const dbPath = options.dbPath ?? process.env.NOTES_DB_PATH ?? defaultDbPath

  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true })
  }

  const database = new Database(dbPath)

  database.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      session_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_notes_updated_at
    ON notes(updated_at DESC);
  `)

  const selectAllNotes = database.prepare(`
    SELECT
      id,
      campaign_id,
      title,
      body,
      status,
      tags_json,
      session_name,
      created_at,
      updated_at
    FROM notes
    ORDER BY updated_at DESC
  `)

  const selectNoteById = database.prepare(`
    SELECT
      id,
      campaign_id,
      title,
      body,
      status,
      tags_json,
      session_name,
      created_at,
      updated_at
    FROM notes
    WHERE id = ?
  `)

  const insertNote = database.prepare(`
    INSERT INTO notes (
      id,
      campaign_id,
      title,
      body,
      status,
      tags_json,
      session_name,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @campaign_id,
      @title,
      @body,
      @status,
      @tags_json,
      @session_name,
      @created_at,
      @updated_at
    )
  `)

  const updateNoteStatement = database.prepare(`
    UPDATE notes
    SET
      title = @title,
      body = @body,
      status = @status,
      tags_json = @tags_json,
      session_name = @session_name,
      updated_at = @updated_at
    WHERE id = @id
  `)

  const deleteNoteStatement = database.prepare(`
    DELETE FROM notes
    WHERE id = ?
  `)

  const listNotes = () =>
    (selectAllNotes.all() as NoteRow[]).map((row) => mapRow(row))

  return {
    listNotes,
    listRecentNotes(limit) {
      return listNotes().slice(0, limit)
    },
    getNote(noteId) {
      const row = selectNoteById.get(noteId) as NoteRow | undefined
      return row ? mapRow(row) : null
    },
    createNote(input) {
      const timestamp = new Date().toISOString()
      const note: Note = {
        id: randomUUID(),
        campaignId: defaultCampaign.id,
        title: input.title,
        body: input.body,
        tags: input.tags,
        status: input.status,
        sessionName: input.sessionName,
        createdAt: timestamp,
        updatedAt: timestamp,
      }

      insertNote.run({
        id: note.id,
        campaign_id: note.campaignId,
        title: note.title,
        body: note.body,
        status: note.status,
        tags_json: JSON.stringify(note.tags),
        session_name: note.sessionName,
        created_at: note.createdAt,
        updated_at: note.updatedAt,
      })

      return note
    },
    updateNote(noteId, input) {
      const existing = this.getNote(noteId)

      if (!existing) {
        return null
      }

      const nextNote: Note = {
        ...existing,
        title: input.title,
        body: input.body,
        tags: input.tags,
        status: input.status,
        sessionName: input.sessionName,
        updatedAt: new Date().toISOString(),
      }

      updateNoteStatement.run({
        id: nextNote.id,
        title: nextNote.title,
        body: nextNote.body,
        status: nextNote.status,
        tags_json: JSON.stringify(nextNote.tags),
        session_name: nextNote.sessionName,
        updated_at: nextNote.updatedAt,
      })

      return nextNote
    },
    deleteNote(noteId) {
      const result = deleteNoteStatement.run(noteId)
      return result.changes > 0
    },
    getStats() {
      const notes = listNotes()

      return {
        totalNotes: notes.length,
        draftNotes: notes.filter((note) => note.status === 'draft').length,
        activeNotes: notes.filter((note) => note.status === 'active').length,
        archivedNotes: notes.filter((note) => note.status === 'archived').length,
        sessionLinkedNotes: notes.filter((note) => note.sessionName !== null).length,
      }
    },
    close() {
      database.close()
    },
  }
}

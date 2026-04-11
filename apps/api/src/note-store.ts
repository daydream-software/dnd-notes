import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  defaultCampaign,
  defaultCampaignId,
  defaultOwnerDisplayName,
} from './campaign.js'
import type {
  CampaignInput,
  CampaignMembership,
  CampaignSummary,
  Note,
  NoteInput,
  NoteStats,
} from './types.js'

interface CampaignRow {
  id: string
  name: string
  tagline: string
  system: string
  setting: string
  next_session: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
}

interface CampaignMembershipRow {
  id: string
  campaign_id: string
  role: CampaignMembership['role']
  display_name: string
  user_id: string | null
  guest_token_id: string | null
  created_at: string
  updated_at: string
}

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
  listCampaigns(): CampaignSummary[]
  getPrimaryCampaign(): CampaignSummary
  getCampaign(campaignId: string): CampaignSummary | null
  createCampaign(input: CampaignInput): CampaignSummary
  updateCampaign(campaignId: string, input: CampaignInput): CampaignSummary | null
  listCampaignMemberships(campaignId: string): CampaignMembership[]
  listNotes(campaignId?: string): Note[]
  listRecentNotes(limit: number, campaignId?: string): Note[]
  getNote(noteId: string): Note | null
  createNote(input: NoteInput): Note
  updateNote(noteId: string, input: NoteInput): Note | null
  deleteNote(noteId: string): boolean
  resetNotes(inputs: NoteInput[], campaignId?: string): Note[]
  getStats(campaignId?: string): NoteStats
  close(): void
}

const defaultDbPath = fileURLToPath(
  new URL('../data/dnd-notes.sqlite', import.meta.url),
)

export function resolveNoteDbPath(
  options: CreateNoteStoreOptions = {},
): string {
  return options.dbPath ?? process.env.NOTES_DB_PATH ?? defaultDbPath
}

function mapCampaignRow(row: CampaignRow): CampaignSummary {
  return {
    id: row.id,
    name: row.name,
    tagline: row.tagline,
    system: row.system,
    setting: row.setting,
    nextSession: row.next_session,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapMembershipRow(row: CampaignMembershipRow): CampaignMembership {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    role: row.role,
    displayName: row.display_name,
    userId: row.user_id,
    guestTokenId: row.guest_token_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapNoteRow(row: NoteRow): Note {
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
  const dbPath = resolveNoteDbPath(options)

  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true })
  }

  const database = new Database(dbPath)
  database.pragma('foreign_keys = ON')

  database.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      tagline TEXT NOT NULL,
      system TEXT NOT NULL,
      setting TEXT NOT NULL,
      next_session TEXT,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS campaign_memberships (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id),
      role TEXT NOT NULL,
      display_name TEXT NOT NULL,
      user_id TEXT,
      guest_token_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_campaign_memberships_campaign_id
    ON campaign_memberships(campaign_id);

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

    CREATE INDEX IF NOT EXISTS idx_notes_campaign_updated_at
    ON notes(campaign_id, updated_at DESC);
  `)

  const selectAllCampaigns = database.prepare(`
    SELECT
      id,
      name,
      tagline,
      system,
      setting,
      next_session,
      archived_at,
      created_at,
      updated_at
    FROM campaigns
    WHERE archived_at IS NULL
    ORDER BY
      CASE WHEN id = '${defaultCampaignId}' THEN 0 ELSE 1 END,
      created_at ASC
  `)

  const selectCampaignById = database.prepare(`
    SELECT
      id,
      name,
      tagline,
      system,
      setting,
      next_session,
      archived_at,
      created_at,
      updated_at
    FROM campaigns
    WHERE id = ?
  `)

  const selectPrimaryCampaign = database.prepare(`
    SELECT
      id,
      name,
      tagline,
      system,
      setting,
      next_session,
      archived_at,
      created_at,
      updated_at
    FROM campaigns
    WHERE archived_at IS NULL
    ORDER BY
      CASE WHEN id = '${defaultCampaignId}' THEN 0 ELSE 1 END,
      created_at ASC
    LIMIT 1
  `)

  const insertCampaign = database.prepare(`
    INSERT INTO campaigns (
      id,
      name,
      tagline,
      system,
      setting,
      next_session,
      archived_at,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @name,
      @tagline,
      @system,
      @setting,
      @next_session,
      @archived_at,
      @created_at,
      @updated_at
    )
  `)

  const updateCampaignStatement = database.prepare(`
    UPDATE campaigns
    SET
      name = @name,
      tagline = @tagline,
      system = @system,
      setting = @setting,
      next_session = @next_session,
      updated_at = @updated_at
    WHERE id = @id
  `)

  const selectMembershipsByCampaignId = database.prepare(`
    SELECT
      id,
      campaign_id,
      role,
      display_name,
      user_id,
      guest_token_id,
      created_at,
      updated_at
    FROM campaign_memberships
    WHERE campaign_id = ?
    ORDER BY
      CASE WHEN role = 'owner' THEN 0 ELSE 1 END,
      created_at ASC
  `)

  const insertMembership = database.prepare(`
    INSERT INTO campaign_memberships (
      id,
      campaign_id,
      role,
      display_name,
      user_id,
      guest_token_id,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @campaign_id,
      @role,
      @display_name,
      @user_id,
      @guest_token_id,
      @created_at,
      @updated_at
    )
  `)

  const countOwnerMemberships = database.prepare(`
    SELECT COUNT(*) AS count
    FROM campaign_memberships
    WHERE campaign_id = ? AND role = 'owner'
  `)

  const selectNotesByCampaignId = database.prepare(`
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
    WHERE campaign_id = ?
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

  const deleteNotesByCampaignIdStatement = database.prepare(`
    DELETE FROM notes
    WHERE campaign_id = ?
  `)

  const ensureDefaultCampaignTransaction = database.transaction(() => {
    const existing = selectCampaignById.get(defaultCampaign.id) as CampaignRow | undefined

    if (!existing) {
      const timestamp = new Date().toISOString()
      insertCampaign.run({
        id: defaultCampaign.id,
        name: defaultCampaign.name,
        tagline: defaultCampaign.tagline,
        system: defaultCampaign.system,
        setting: defaultCampaign.setting,
        next_session: defaultCampaign.nextSession,
        archived_at: null,
        created_at: timestamp,
        updated_at: timestamp,
      })
    }

    const ownerMembershipCount = countOwnerMemberships.get(defaultCampaign.id) as {
      count: number
    }

    if (ownerMembershipCount.count === 0) {
      const timestamp = new Date().toISOString()
      insertMembership.run({
        id: randomUUID(),
        campaign_id: defaultCampaign.id,
        role: 'owner',
        display_name: defaultOwnerDisplayName,
        user_id: null,
        guest_token_id: null,
        created_at: timestamp,
        updated_at: timestamp,
      })
    }
  })

  const createCampaignTransaction = database.transaction((input: CampaignInput) => {
    const timestamp = new Date().toISOString()
    const campaign: CampaignSummary = {
      id: randomUUID(),
      name: input.name,
      tagline: input.tagline,
      system: input.system,
      setting: input.setting,
      nextSession: input.nextSession,
      archivedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    insertCampaign.run({
      id: campaign.id,
      name: campaign.name,
      tagline: campaign.tagline,
      system: campaign.system,
      setting: campaign.setting,
      next_session: campaign.nextSession,
      archived_at: campaign.archivedAt,
      created_at: campaign.createdAt,
      updated_at: campaign.updatedAt,
    })

    insertMembership.run({
      id: randomUUID(),
      campaign_id: campaign.id,
      role: 'owner',
      display_name: defaultOwnerDisplayName,
      user_id: null,
      guest_token_id: null,
      created_at: timestamp,
      updated_at: timestamp,
    })

    return campaign
  })

  const updateCampaignTransaction = database.transaction(
    (campaignId: string, input: CampaignInput) => {
      const existing = selectCampaignById.get(campaignId) as CampaignRow | undefined

      if (!existing || existing.archived_at !== null) {
        return null
      }

      const updatedCampaign: CampaignSummary = {
        ...mapCampaignRow(existing),
        name: input.name,
        tagline: input.tagline,
        system: input.system,
        setting: input.setting,
        nextSession: input.nextSession,
        updatedAt: new Date().toISOString(),
      }

      updateCampaignStatement.run({
        id: updatedCampaign.id,
        name: updatedCampaign.name,
        tagline: updatedCampaign.tagline,
        system: updatedCampaign.system,
        setting: updatedCampaign.setting,
        next_session: updatedCampaign.nextSession,
        updated_at: updatedCampaign.updatedAt,
      })

      return updatedCampaign
    },
  )

  const listCampaigns = () =>
    (selectAllCampaigns.all() as CampaignRow[]).map((row) => mapCampaignRow(row))

  const getCampaign = (campaignId: string) => {
    const row = selectCampaignById.get(campaignId) as CampaignRow | undefined
    return row ? mapCampaignRow(row) : null
  }

  const getPrimaryCampaign = () => {
    const row = selectPrimaryCampaign.get() as CampaignRow | undefined

    if (!row) {
      throw new Error('No active campaigns are available.')
    }

    return mapCampaignRow(row)
  }

  const requireCampaign = (campaignId?: string | null) => {
    if (!campaignId) {
      return getPrimaryCampaign()
    }

    const campaign = getCampaign(campaignId)

    if (!campaign || campaign.archivedAt !== null) {
      throw new Error(`Campaign "${campaignId}" was not found.`)
    }

    return campaign
  }

  const listNotes = (campaignId?: string) => {
    const campaign = requireCampaign(campaignId)
    return (selectNotesByCampaignId.all(campaign.id) as NoteRow[]).map((row) =>
      mapNoteRow(row),
    )
  }

  const insertPersistedNote = (note: Note) => {
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
  }

  const resetNotesTransaction = database.transaction(
    (inputs: NoteInput[], campaignId?: string) => {
      const campaign = requireCampaign(campaignId)
      deleteNotesByCampaignIdStatement.run(campaign.id)

      const baseTimestamp = Date.now()

      return inputs.map((input, index) => {
        const timestamp = new Date(baseTimestamp - index).toISOString()
        const note: Note = {
          id: randomUUID(),
          campaignId: campaign.id,
          title: input.title,
          body: input.body,
          tags: input.tags,
          status: input.status,
          sessionName: input.sessionName,
          createdAt: timestamp,
          updatedAt: timestamp,
        }

        insertPersistedNote(note)
        return note
      })
    },
  )

  ensureDefaultCampaignTransaction()

  return {
    listCampaigns,
    getPrimaryCampaign,
    getCampaign,
    createCampaign(input) {
      return createCampaignTransaction(input)
    },
    updateCampaign(campaignId, input) {
      return updateCampaignTransaction(campaignId, input)
    },
    listCampaignMemberships(campaignId) {
      requireCampaign(campaignId)
      return (
        selectMembershipsByCampaignId.all(campaignId) as CampaignMembershipRow[]
      ).map((row) => mapMembershipRow(row))
    },
    listNotes,
    listRecentNotes(limit, campaignId) {
      return listNotes(campaignId).slice(0, limit)
    },
    getNote(noteId) {
      const row = selectNoteById.get(noteId) as NoteRow | undefined
      return row ? mapNoteRow(row) : null
    },
    createNote(input) {
      const campaign = requireCampaign(input.campaignId)
      const timestamp = new Date().toISOString()
      const note: Note = {
        id: randomUUID(),
        campaignId: campaign.id,
        title: input.title,
        body: input.body,
        tags: input.tags,
        status: input.status,
        sessionName: input.sessionName,
        createdAt: timestamp,
        updatedAt: timestamp,
      }

      insertPersistedNote(note)
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
    resetNotes(inputs, campaignId) {
      return resetNotesTransaction(inputs, campaignId)
    },
    getStats(campaignId) {
      const notes = listNotes(campaignId)

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

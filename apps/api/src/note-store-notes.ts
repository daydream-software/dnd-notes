import type { NoteStoreDatabase } from './note-store-database.js'
import type {
  CampaignMembershipRole,
  Note,
  NoteAttribution,
  NoteReference,
  NoteReferenceType,
} from './types.js'

export interface NoteRow {
  id: string
  campaign_id: string
  title: string
  body: string
  status: Note['status']
  tags_json: string
  linked_notes_json: string
  session_name: string | null
  created_by_membership_id: string | null
  last_edited_by_membership_id: string | null
  created_by_display_name: string | null
  created_by_role: string | null
  last_edited_by_display_name: string | null
  last_edited_by_role: string | null
  created_at: string
  updated_at: string
}

export interface NoteReferenceRow {
  id: string
  source_note_id: string
  target_note_id: string
  campaign_id: string
  reference_type: NoteReferenceType
  label: string | null
  qualifier: string | null
  position_in_body: number | null
  created_at: string
  updated_at: string
}

export interface NoteIdentityRow {
  id: string
  campaign_id: string
}

export interface StoredNoteForReferenceSyncRow {
  id: string
  campaign_id: string
  body: string
  linked_notes_json: string | null
  created_at: string
  updated_at: string
}

export interface NoteRecord {
  id: string
  campaignId: string
  title: string
  body: string
  tags: string[]
  status: Note['status']
  sessionName: string | null
  explicitLinkedNoteIds: string[]
  createdBy: NoteAttribution | null
  lastEditedBy: NoteAttribution | null
  createdAt: string
  updatedAt: string
}

export function mapNoteRow(row: NoteRow): NoteRecord {
  let createdBy: NoteAttribution | null = null

  if (row.created_by_membership_id && row.created_by_display_name && row.created_by_role) {
    createdBy = {
      membershipId: row.created_by_membership_id,
      displayName: row.created_by_display_name,
      role: row.created_by_role as CampaignMembershipRole,
    }
  }

  let lastEditedBy: NoteAttribution | null = null

  if (row.last_edited_by_membership_id && row.last_edited_by_display_name && row.last_edited_by_role) {
    lastEditedBy = {
      membershipId: row.last_edited_by_membership_id,
      displayName: row.last_edited_by_display_name,
      role: row.last_edited_by_role as CampaignMembershipRole,
    }
  }

  return {
    id: row.id,
    campaignId: row.campaign_id,
    title: row.title,
    body: row.body,
    status: row.status,
    tags: JSON.parse(row.tags_json) as string[],
    explicitLinkedNoteIds: row.linked_notes_json
      ? (JSON.parse(row.linked_notes_json) as string[])
      : [],
    sessionName: row.session_name,
    createdBy,
    lastEditedBy,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapNoteReferenceRow(row: NoteReferenceRow): NoteReference {
  return {
    id: row.id,
    sourceNoteId: row.source_note_id,
    targetNoteId: row.target_note_id,
    campaignId: row.campaign_id,
    referenceType: row.reference_type,
    label: row.label,
    qualifier: row.qualifier,
    positionInBody: row.position_in_body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function buildCompatibleLinkedNoteIds(
  explicitLinkedNoteIds: string[],
  references: NoteReference[],
) {
  const linkedReferenceTargets = new Set(
    references
      .filter((reference) => reference.referenceType === 'linked')
      .map((reference) => reference.targetNoteId),
  )
  const linkedNoteIds: string[] = []
  const seen = new Set<string>()

  for (const targetNoteId of explicitLinkedNoteIds) {
    if (!linkedReferenceTargets.has(targetNoteId) || seen.has(targetNoteId)) {
      continue
    }

    linkedNoteIds.push(targetNoteId)
    seen.add(targetNoteId)
  }

  for (const reference of references) {
    if (seen.has(reference.targetNoteId)) {
      continue
    }

    linkedNoteIds.push(reference.targetNoteId)
    seen.add(reference.targetNoteId)
  }

  return linkedNoteIds
}

export function composeNote(record: NoteRecord, references: NoteReference[]): Note {
  return {
    id: record.id,
    campaignId: record.campaignId,
    title: record.title,
    body: record.body,
    status: record.status,
    tags: record.tags,
    linkedNoteIds: buildCompatibleLinkedNoteIds(record.explicitLinkedNoteIds, references),
    references,
    sessionName: record.sessionName,
    createdBy: record.createdBy,
    lastEditedBy: record.lastEditedBy,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

export function groupReferencesBySource(rows: NoteReferenceRow[]) {
  const referencesBySource = new Map<string, NoteReference[]>()

  for (const row of rows) {
    const reference = mapNoteReferenceRow(row)
    const existingReferences = referencesBySource.get(reference.sourceNoteId)

    if (existingReferences) {
      existingReferences.push(reference)
    } else {
      referencesBySource.set(reference.sourceNoteId, [reference])
    }
  }

  return referencesBySource
}

export function prepareNoteStatements(database: NoteStoreDatabase) {
  const selectNotesByCampaignId = database.prepare(`
    SELECT
      notes.id,
      notes.campaign_id,
      notes.title,
      notes.body,
      notes.status,
      notes.tags_json,
      notes.linked_notes_json,
      notes.session_name,
      notes.created_by_membership_id,
      notes.last_edited_by_membership_id,
      cb.display_name AS created_by_display_name,
      cb.role AS created_by_role,
      eb.display_name AS last_edited_by_display_name,
      eb.role AS last_edited_by_role,
      notes.created_at,
      notes.updated_at
    FROM notes
    LEFT JOIN campaign_memberships cb
      ON cb.id = notes.created_by_membership_id
    LEFT JOIN campaign_memberships eb
      ON eb.id = notes.last_edited_by_membership_id
    WHERE notes.campaign_id = ?
    ORDER BY notes.updated_at DESC
  `)

  const selectNoteById = database.prepare(`
    SELECT
      notes.id,
      notes.campaign_id,
      notes.title,
      notes.body,
      notes.status,
      notes.tags_json,
      notes.linked_notes_json,
      notes.session_name,
      notes.created_by_membership_id,
      notes.last_edited_by_membership_id,
      cb.display_name AS created_by_display_name,
      cb.role AS created_by_role,
      eb.display_name AS last_edited_by_display_name,
      eb.role AS last_edited_by_role,
      notes.created_at,
      notes.updated_at
    FROM notes
    LEFT JOIN campaign_memberships cb
      ON cb.id = notes.created_by_membership_id
    LEFT JOIN campaign_memberships eb
      ON eb.id = notes.last_edited_by_membership_id
    WHERE notes.id = ?
  `)

  const selectNotesBySessionName = database.prepare(`
    SELECT
      notes.id,
      notes.campaign_id,
      notes.title,
      notes.body,
      notes.status,
      notes.tags_json,
      notes.linked_notes_json,
      notes.session_name,
      notes.created_by_membership_id,
      notes.last_edited_by_membership_id,
      cb.display_name AS created_by_display_name,
      cb.role AS created_by_role,
      eb.display_name AS last_edited_by_display_name,
      eb.role AS last_edited_by_role,
      notes.created_at,
      notes.updated_at
    FROM notes
    LEFT JOIN campaign_memberships cb
      ON cb.id = notes.created_by_membership_id
    LEFT JOIN campaign_memberships eb
      ON eb.id = notes.last_edited_by_membership_id
    WHERE notes.campaign_id = ? AND notes.session_name = ?
    ORDER BY notes.created_at ASC
  `)

  const selectNoteIdentityById = database.prepare(`
    SELECT id, campaign_id
    FROM notes
    WHERE id = ?
  `)

  const selectNoteReferencesByCampaignId = database.prepare(`
    SELECT
      id,
      source_note_id,
      target_note_id,
      campaign_id,
      reference_type,
      label,
      qualifier,
      position_in_body,
      created_at,
      updated_at
    FROM note_references
    WHERE campaign_id = ?
    ORDER BY
      source_note_id ASC,
      CASE reference_type WHEN 'linked' THEN 0 ELSE 1 END ASC,
      COALESCE(position_in_body, -1) ASC,
      created_at ASC
  `)

  const selectNoteReferencesBySourceNoteId = database.prepare(`
    SELECT
      id,
      source_note_id,
      target_note_id,
      campaign_id,
      reference_type,
      label,
      qualifier,
      position_in_body,
      created_at,
      updated_at
    FROM note_references
    WHERE source_note_id = ?
    ORDER BY
      CASE reference_type WHEN 'linked' THEN 0 ELSE 1 END ASC,
      COALESCE(position_in_body, -1) ASC,
      created_at ASC
  `)

  const selectStoredNotesForReferenceSync = database.prepare(`
    SELECT
      id,
      campaign_id,
      body,
      linked_notes_json,
      created_at,
      updated_at
    FROM notes
  `)

  const deleteNoteReferencesBySourceNoteId = database.prepare(`
    DELETE FROM note_references
    WHERE source_note_id = ?
  `)

  const insertNoteReference = database.prepare(`
    INSERT INTO note_references (
      id,
      source_note_id,
      target_note_id,
      campaign_id,
      reference_type,
      label,
      qualifier,
      position_in_body,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @source_note_id,
      @target_note_id,
      @campaign_id,
      @reference_type,
      @label,
      @qualifier,
      @position_in_body,
      @created_at,
      @updated_at
    )
  `)

  const insertNote = database.prepare(`
    INSERT INTO notes (
      id,
      campaign_id,
      title,
      body,
      status,
      tags_json,
      linked_notes_json,
      session_name,
      created_by_membership_id,
      last_edited_by_membership_id,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @campaign_id,
      @title,
      @body,
      @status,
      @tags_json,
      @linked_notes_json,
      @session_name,
      @created_by_membership_id,
      @last_edited_by_membership_id,
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
      linked_notes_json = @linked_notes_json,
      session_name = @session_name,
      last_edited_by_membership_id = @last_edited_by_membership_id,
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

  return {
    deleteNoteReferencesBySourceNoteId,
    deleteNoteStatement,
    deleteNotesByCampaignIdStatement,
    insertNote,
    insertNoteReference,
    selectNoteById,
    selectNoteIdentityById,
    selectNoteReferencesByCampaignId,
    selectNoteReferencesBySourceNoteId,
    selectNotesByCampaignId,
    selectNotesBySessionName,
    selectStoredNotesForReferenceSync,
    updateNoteStatement,
  }
}

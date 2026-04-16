import Database from 'better-sqlite3'
import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  defaultCampaign,
  defaultCampaignId,
  defaultOwnerDisplayName,
} from './campaign.js'
import { parseInlineNoteReferences } from './note-references.js'
import type {
  CampaignInput,
  CampaignShareLink,
  CampaignShareLinkInput,
  CampaignMembership,
  CampaignMembershipRole,
  MembershipConsolidationSummary,
  CampaignSummary,
  Note,
  NoteAttribution,
  NoteInput,
  NoteReference,
  NoteReferenceType,
  NoteStats,
  OwnerAccount,
  OwnerRegistrationInput,
  SessionSummary,
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
  linked_notes_json?: string
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

interface NoteReferenceRow {
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

interface NoteIdentityRow {
  id: string
  campaign_id: string
}

interface NoteRecord {
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

interface PendingReference {
  targetNoteId: string
  referenceType: NoteReferenceType
  label: string | null
  qualifier: string | null
  positionInBody: number | null
}

interface OwnerAccountRow {
  id: string
  email: string
  display_name: string
  password_hash: string
  is_site_admin: number
  created_at: string
  updated_at: string
}

interface CampaignShareLinkRow {
  id: string
  campaign_id: string
  token_hash: string
  token_plaintext?: string | null
  label: string | null
  access_level: CampaignShareLink['accessLevel']
  frame_ancestors: string | null
  expires_at: string | null
  revoked_at: string | null
  created_at: string
  updated_at: string
}

type CampaignShareLinkRevealResult =
  | { status: 'available'; token: string }
  | { status: 'legacy-unavailable' }

type ClaimGuestMembershipResult =
  | { status: 'claimed'; membership: CampaignMembership; guestToken: string }
  | { status: 'already-linked'; membership: CampaignMembership }
  | { status: 'account-already-member'; membership: CampaignMembership }
  | { status: 'not-found' }

interface MembershipConsolidationCountsRow {
  authored_note_count: number
  edited_note_count: number
  authored_and_edited_note_count: number
  affected_note_count: number
}

type MembershipConsolidationPreview = Omit<
  MembershipConsolidationSummary,
  'applied'
>

type MembershipConsolidationPreviewResult =
  | { status: 'ready'; consolidation: MembershipConsolidationPreview }
  | { status: 'source-not-found' }
  | { status: 'target-not-found' }
  | { status: 'same-membership' }
  | { status: 'forbidden' }

type MembershipConsolidationResult =
  | { status: 'ready'; consolidation: MembershipConsolidationSummary }
  | { status: 'source-not-found' }
  | { status: 'target-not-found' }
  | { status: 'same-membership' }
  | { status: 'forbidden' }

interface CreateNoteStoreOptions {
  dbPath?: string
  siteAdminEmails?: readonly string[]
}

const sessionTtlMs = 1000 * 60 * 60 * 24 * 30

function normalizeEmailAddress(email: string) {
  return email.trim().toLowerCase()
}

function resolveConfiguredSiteAdminEmails(options: CreateNoteStoreOptions) {
  const configuredEmails =
    options.siteAdminEmails ??
    process.env.SITE_ADMIN_EMAILS?.split(',').map((email) => email.trim()) ??
    []

  return new Set(
    configuredEmails
      .map((email) => normalizeEmailAddress(email))
      .filter((email) => email.length > 0),
  )
}

export interface NoteStore {
  listCampaigns(): CampaignSummary[]
  listUserCampaigns(userId: string): CampaignSummary[]
  listOwnedCampaigns(ownerUserId: string): CampaignSummary[]
  getPrimaryCampaignForUser(userId: string): CampaignSummary
  getPrimaryCampaign(ownerUserId?: string): CampaignSummary
  getCampaign(campaignId: string): CampaignSummary | null
  createCampaign(input: CampaignInput, owner: OwnerAccount): CampaignSummary
  updateCampaign(
    campaignId: string,
    input: CampaignInput,
    ownerUserId?: string,
  ): CampaignSummary | null
  listCampaignMemberships(campaignId: string): CampaignMembership[]
  listCampaignShareLinks(campaignId: string): CampaignShareLink[]
  userHasCampaignAccess(userId: string, campaignId: string): boolean
  userOwnsCampaign(ownerUserId: string, campaignId: string): boolean
  createOwnerAccount(input: OwnerRegistrationInput): OwnerAccount | null
  authenticateOwner(email: string, password: string): OwnerAccount | null
  getOwnerBySessionToken(token: string): OwnerAccount | null
  createOwnerSession(ownerUserId: string): string
  deleteOwnerSession(token: string): void
  createCampaignShareLink(
    campaignId: string,
    input: CampaignShareLinkInput,
    ownerUserId: string,
  ): { shareLink: CampaignShareLink; token: string } | null
  revokeCampaignShareLink(
    campaignId: string,
    shareLinkId: string,
    ownerUserId: string,
  ): boolean
  getCampaignShareLinkReveal(
    campaignId: string,
    shareLinkId: string,
    ownerUserId: string,
  ): CampaignShareLinkRevealResult | null
  getCampaignShareLinkByToken(token: string): CampaignShareLink | null
  createGuestMembership(
    campaignId: string,
    displayName: string,
  ): { membership: CampaignMembership; guestToken: string }
  getGuestMembershipByToken(token: string): CampaignMembership | null
  claimGuestMembership(membershipId: string, ownerUserId: string): ClaimGuestMembershipResult
  previewMembershipConsolidation(
    campaignId: string,
    sourceMembershipId: string,
    targetMembershipId: string,
    ownerUserId: string,
  ): MembershipConsolidationPreviewResult
  consolidateMemberships(
    campaignId: string,
    sourceMembershipId: string,
    targetMembershipId: string,
    ownerUserId: string,
  ): MembershipConsolidationResult
  getUserMembershipForCampaign(userId: string, campaignId: string): CampaignMembership | null
  getOwnerMembershipForCampaign(ownerUserId: string, campaignId: string): CampaignMembership | null
  listNotes(campaignId?: string): Note[]
  listSessionNames(campaignId?: string): SessionSummary[]
  listRecentNotes(limit: number, campaignId?: string): Note[]
  getSessionNotes(campaignId: string, sessionName: string): Note[]
  getNote(noteId: string): Note | null
  getBacklinks(noteId: string): Note[]
  createNote(input: NoteInput, membershipId?: string): Note
  updateNote(noteId: string, input: NoteInput, membershipId?: string): Note | null
  deleteNote(noteId: string): boolean
  resetNotes(inputs: NoteInput[], campaignId?: string): Note[]
  getStats(campaignId?: string): NoteStats
  backupDatabase(destinationPath: string): Promise<void>
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

function createPasswordHash(password: string) {
  const salt = randomBytes(16).toString('hex')
  const derivedKey = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${derivedKey}`
}

function verifyPassword(password: string, storedHash: string) {
  const [salt, expectedHex] = storedHash.split(':')

  if (!salt || !expectedHex) {
    return false
  }

  const provided = Buffer.from(scryptSync(password, salt, 64))
  const expected = Buffer.from(expectedHex, 'hex')

  if (provided.length !== expected.length) {
    return false
  }

  return timingSafeEqual(provided, expected)
}

function createSessionToken() {
  return randomBytes(24).toString('hex')
}

function hashSessionToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function createTimestampAfter(previousTimestamp: string) {
  const previousMs = new Date(previousTimestamp).getTime()
  const nextMs = Math.max(Date.now(), previousMs + 1)
  return new Date(nextMs).toISOString()
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

function mapNoteRow(row: NoteRow): NoteRecord {
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

function mapNoteReferenceRow(row: NoteReferenceRow): NoteReference {
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

function buildCompatibleLinkedNoteIds(explicitLinkedNoteIds: string[], references: NoteReference[]) {
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

function composeNote(record: NoteRecord, references: NoteReference[]): Note {
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

function mapOwnerAccountRow(row: OwnerAccountRow): OwnerAccount {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    isSiteAdmin: row.is_site_admin === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function buildMembershipConsolidationWarnings(
  sourceMembership: CampaignMembership,
  targetMembership: CampaignMembership,
) {
  const warnings = [
    'Only note attribution moves. Membership records, linked accounts, and guest tokens stay on their current memberships.',
  ]

  if (sourceMembership.displayName !== targetMembership.displayName) {
    warnings.push(
      `Affected notes will show "${targetMembership.displayName}" instead of "${sourceMembership.displayName}".`,
    )
  }

  if (sourceMembership.role !== targetMembership.role) {
    warnings.push(
      `Affected notes will use the "${targetMembership.role}" role instead of "${sourceMembership.role}".`,
    )
  }

  return warnings
}

function mapCampaignShareLinkRow(row: CampaignShareLinkRow): CampaignShareLink {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    label: row.label,
    accessLevel: row.access_level,
    frameAncestors: row.frame_ancestors,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function createNoteStore(
  options: CreateNoteStoreOptions = {},
): NoteStore {
  const dbPath = resolveNoteDbPath(options)
  const configuredSiteAdminEmails = resolveConfiguredSiteAdminEmails(options)

  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true })
  }

  const database = new Database(dbPath)
  database.pragma('foreign_keys = ON')

  database.exec(`
    CREATE TABLE IF NOT EXISTS owner_accounts (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      is_site_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS owner_sessions (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL REFERENCES owner_accounts(id),
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_owner_sessions_owner_user_id
    ON owner_sessions(owner_user_id);

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
      user_id TEXT REFERENCES owner_accounts(id),
      guest_token_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_campaign_memberships_campaign_id
    ON campaign_memberships(campaign_id);

    CREATE INDEX IF NOT EXISTS idx_campaign_memberships_user_id
    ON campaign_memberships(user_id);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_memberships_guest_token_id
    ON campaign_memberships(guest_token_id)
    WHERE guest_token_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS campaign_share_links (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id),
      token_hash TEXT NOT NULL UNIQUE,
      token_plaintext TEXT,
      label TEXT,
      access_level TEXT NOT NULL,
      frame_ancestors TEXT,
      expires_at TEXT,
      revoked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_campaign_share_links_campaign_id
    ON campaign_share_links(campaign_id);

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      linked_notes_json TEXT NOT NULL DEFAULT '[]',
      session_name TEXT,
      created_by_membership_id TEXT REFERENCES campaign_memberships(id),
      last_edited_by_membership_id TEXT REFERENCES campaign_memberships(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_notes_campaign_updated_at
    ON notes(campaign_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS note_references (
      id TEXT PRIMARY KEY,
      source_note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      target_note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id),
      reference_type TEXT NOT NULL,
      label TEXT,
      qualifier TEXT,
      position_in_body INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_note_references_target
    ON note_references(target_note_id, campaign_id);

    CREATE INDEX IF NOT EXISTS idx_note_references_source
    ON note_references(source_note_id, campaign_id);
  `)

  const ensureNotesAttributionColumns = database.transaction(() => {
    const notesTableExists = database
      .prepare(`
        SELECT 1
        FROM sqlite_master
        WHERE type = 'table' AND name = 'notes'
      `)
      .get()

    if (!notesTableExists) {
      return
    }

    const noteColumns = new Set(
      (
        database.prepare(`
          PRAGMA table_info(notes)
        `).all() as Array<{ name: string }>
      ).map((column) => column.name),
    )

    if (!noteColumns.has('created_by_membership_id')) {
      database.exec(`
        ALTER TABLE notes
        ADD COLUMN created_by_membership_id TEXT REFERENCES campaign_memberships(id)
      `)
    }

    if (!noteColumns.has('last_edited_by_membership_id')) {
      database.exec(`
        ALTER TABLE notes
        ADD COLUMN last_edited_by_membership_id TEXT REFERENCES campaign_memberships(id)
      `)
    }

    if (!noteColumns.has('linked_notes_json')) {
      database.exec(`
        ALTER TABLE notes
        ADD COLUMN linked_notes_json TEXT NOT NULL DEFAULT '[]'
      `)
    }
  })

  const ensureOwnerSiteAdminColumn = database.transaction(() => {
    const ownerAccountsTableExists = database
      .prepare(`
        SELECT 1
        FROM sqlite_master
        WHERE type = 'table' AND name = 'owner_accounts'
      `)
      .get()

    if (!ownerAccountsTableExists) {
      return
    }

    const ownerColumns = new Set(
      (
        database.prepare(`
          PRAGMA table_info(owner_accounts)
        `).all() as Array<{ name: string }>
      ).map((column) => column.name),
    )

    if (!ownerColumns.has('is_site_admin')) {
      database.exec(`
        ALTER TABLE owner_accounts
        ADD COLUMN is_site_admin INTEGER NOT NULL DEFAULT 0
      `)
    }
  })

  const ensureShareLinkRevealTokens = database.transaction(() => {
    const shareLinksTableExists = database
      .prepare(`
        SELECT 1
        FROM sqlite_master
        WHERE type = 'table' AND name = 'campaign_share_links'
      `)
      .get()

    if (!shareLinksTableExists) {
      return
    }

    const shareLinkColumns = new Set(
      (
        database.prepare(`
          PRAGMA table_info(campaign_share_links)
        `).all() as Array<{ name: string }>
      ).map((column) => column.name),
    )

    if (!shareLinkColumns.has('token_plaintext')) {
      database.exec(`
        ALTER TABLE campaign_share_links
        ADD COLUMN token_plaintext TEXT
      `)
    }
  })

  function elevateConfiguredSiteAdminAccounts() {
    if (configuredSiteAdminEmails.size === 0) {
      return
    }

    const placeholders = Array.from(
      { length: configuredSiteAdminEmails.size },
      () => '?',
    ).join(', ')
    const timestamp = new Date().toISOString()

    database
      .prepare(`
        UPDATE owner_accounts
        SET is_site_admin = 1,
            updated_at = ?
        WHERE is_site_admin != 1
          AND lower(email) IN (${placeholders})
      `)
      .run(timestamp, ...configuredSiteAdminEmails)
  }

  ensureOwnerSiteAdminColumn()
  ensureNotesAttributionColumns()
  ensureShareLinkRevealTokens()
  elevateConfiguredSiteAdminAccounts()

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

  const selectUserCampaigns = database.prepare(`
    SELECT
      campaigns.id,
      campaigns.name,
      campaigns.tagline,
      campaigns.system,
      campaigns.setting,
      campaigns.next_session,
      campaigns.archived_at,
      campaigns.created_at,
      campaigns.updated_at
    FROM campaigns
    INNER JOIN campaign_memberships
      ON campaign_memberships.campaign_id = campaigns.id
    WHERE
      campaigns.archived_at IS NULL
      AND campaign_memberships.user_id = ?
    ORDER BY
      CASE WHEN campaigns.id = '${defaultCampaignId}' THEN 0 ELSE 1 END,
      campaigns.created_at ASC
  `)

  const selectOwnedCampaigns = database.prepare(`
    SELECT
      campaigns.id,
      campaigns.name,
      campaigns.tagline,
      campaigns.system,
      campaigns.setting,
      campaigns.next_session,
      campaigns.archived_at,
      campaigns.created_at,
      campaigns.updated_at
    FROM campaigns
    INNER JOIN campaign_memberships
      ON campaign_memberships.campaign_id = campaigns.id
    WHERE
      campaigns.archived_at IS NULL
      AND campaign_memberships.user_id = ?
      AND campaign_memberships.role = 'owner'
    ORDER BY
      CASE WHEN campaigns.id = '${defaultCampaignId}' THEN 0 ELSE 1 END,
      campaigns.created_at ASC
  `)

  const selectPrimaryUserCampaign = database.prepare(`
    SELECT
      campaigns.id,
      campaigns.name,
      campaigns.tagline,
      campaigns.system,
      campaigns.setting,
      campaigns.next_session,
      campaigns.archived_at,
      campaigns.created_at,
      campaigns.updated_at
    FROM campaigns
    INNER JOIN campaign_memberships
      ON campaign_memberships.campaign_id = campaigns.id
    WHERE
      campaigns.archived_at IS NULL
      AND campaign_memberships.user_id = ?
    ORDER BY
      CASE WHEN campaigns.id = '${defaultCampaignId}' THEN 0 ELSE 1 END,
      campaigns.created_at ASC
    LIMIT 1
  `)

  const selectPrimaryOwnedCampaign = database.prepare(`
    SELECT
      campaigns.id,
      campaigns.name,
      campaigns.tagline,
      campaigns.system,
      campaigns.setting,
      campaigns.next_session,
      campaigns.archived_at,
      campaigns.created_at,
      campaigns.updated_at
    FROM campaigns
    INNER JOIN campaign_memberships
      ON campaign_memberships.campaign_id = campaigns.id
    WHERE
      campaigns.archived_at IS NULL
      AND campaign_memberships.user_id = ?
      AND campaign_memberships.role = 'owner'
    ORDER BY
      CASE WHEN campaigns.id = '${defaultCampaignId}' THEN 0 ELSE 1 END,
      campaigns.created_at ASC
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

  const selectOwnerMembershipByCampaignAndUser = database.prepare(`
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
    WHERE campaign_id = ? AND user_id = ? AND role = 'owner'
  `)

  const selectMembershipByCampaignAndUser = database.prepare(`
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
    WHERE campaign_id = ? AND user_id = ?
    LIMIT 1
  `)

  const selectGuestMembershipByTokenHash = database.prepare(`
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
    WHERE guest_token_id = ? AND role = 'guest'
  `)

  const selectMembershipById = database.prepare(`
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
    WHERE id = ?
  `)

  const selectMembershipByCampaignAndId = database.prepare(`
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
    WHERE campaign_id = ? AND id = ?
    LIMIT 1
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

  const updateUnclaimedDefaultMembership = database.prepare(`
    UPDATE campaign_memberships
    SET
      user_id = @user_id,
      display_name = @display_name,
      updated_at = @updated_at
    WHERE
      campaign_id = @campaign_id
      AND role = 'owner'
      AND user_id IS NULL
  `)

  const claimGuestMembershipStatement = database.prepare(`
    UPDATE campaign_memberships
    SET
      user_id = @user_id,
      guest_token_id = @guest_token_id,
      updated_at = @updated_at
    WHERE
      id = @id
      AND role = 'guest'
  `)

  const countOwnerMemberships = database.prepare(`
    SELECT COUNT(*) AS count
    FROM campaign_memberships
    WHERE campaign_id = ? AND role = 'owner'
  `)

  const selectOwnerAccountById = database.prepare(`
    SELECT
      id,
      email,
      display_name,
      password_hash,
      is_site_admin,
      created_at,
      updated_at
    FROM owner_accounts
    WHERE id = ?
  `)

  const selectOwnerAccountByEmail = database.prepare(`
    SELECT
      id,
      email,
      display_name,
      password_hash,
      is_site_admin,
      created_at,
      updated_at
    FROM owner_accounts
    WHERE email = ?
  `)

  const insertOwnerAccount = database.prepare(`
    INSERT INTO owner_accounts (
      id,
      email,
      display_name,
      password_hash,
      is_site_admin,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @email,
      @display_name,
      @password_hash,
      @is_site_admin,
      @created_at,
      @updated_at
    )
  `)

  const insertOwnerSession = database.prepare(`
    INSERT INTO owner_sessions (
      id,
      owner_user_id,
      token_hash,
      created_at,
      expires_at
    ) VALUES (
      @id,
      @owner_user_id,
      @token_hash,
      @created_at,
      @expires_at
    )
  `)

  const selectOwnerBySessionToken = database.prepare(`
    SELECT
      owner_accounts.id,
      owner_accounts.email,
      owner_accounts.display_name,
      owner_accounts.password_hash,
      owner_accounts.is_site_admin,
      owner_accounts.created_at,
      owner_accounts.updated_at
    FROM owner_sessions
    INNER JOIN owner_accounts
      ON owner_accounts.id = owner_sessions.owner_user_id
    WHERE owner_sessions.token_hash = ? AND owner_sessions.expires_at > ?
  `)

  const deleteOwnerSessionByTokenHash = database.prepare(`
    DELETE FROM owner_sessions
    WHERE token_hash = ?
  `)

  const deleteExpiredOwnerSessions = database.prepare(`
    DELETE FROM owner_sessions
    WHERE expires_at <= ?
  `)

  const selectActiveShareLinksByCampaignId = database.prepare(`
    SELECT
      id,
      campaign_id,
      token_hash,
      label,
      access_level,
      frame_ancestors,
      expires_at,
      revoked_at,
      created_at,
      updated_at
    FROM campaign_share_links
    WHERE
      campaign_id = ?
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > ?)
    ORDER BY created_at DESC
  `)

  const selectActiveShareLinkByTokenHash = database.prepare(`
    SELECT
      id,
      campaign_id,
      token_hash,
      label,
      access_level,
      frame_ancestors,
      expires_at,
      revoked_at,
      created_at,
      updated_at
    FROM campaign_share_links
    WHERE
      token_hash = ?
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > ?)
  `)

  const selectShareLinkRevealById = database.prepare(`
    SELECT token_plaintext
    FROM campaign_share_links
    WHERE
      id = ?
      AND campaign_id = ?
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > ?)
  `)

  const insertShareLink = database.prepare(`
    INSERT INTO campaign_share_links (
      id,
      campaign_id,
      token_hash,
      token_plaintext,
      label,
      access_level,
      frame_ancestors,
      expires_at,
      revoked_at,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @campaign_id,
      @token_hash,
      @token_plaintext,
      @label,
      @access_level,
      @frame_ancestors,
      @expires_at,
      @revoked_at,
      @created_at,
      @updated_at
    )
  `)

  const revokeShareLinkStatement = database.prepare(`
    UPDATE campaign_share_links
    SET
      revoked_at = @revoked_at,
      updated_at = @updated_at
    WHERE id = @id AND campaign_id = @campaign_id
  `)

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

  const selectMembershipConsolidationCounts = database.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN created_by_membership_id = @source_membership_id THEN 1 ELSE 0 END), 0) AS authored_note_count,
      COALESCE(SUM(CASE WHEN last_edited_by_membership_id = @source_membership_id THEN 1 ELSE 0 END), 0) AS edited_note_count,
      COALESCE(
        SUM(
          CASE
            WHEN created_by_membership_id = @source_membership_id
              AND last_edited_by_membership_id = @source_membership_id
            THEN 1
            ELSE 0
          END
        ),
        0
      ) AS authored_and_edited_note_count,
      COALESCE(
        SUM(
          CASE
            WHEN created_by_membership_id = @source_membership_id
              OR last_edited_by_membership_id = @source_membership_id
            THEN 1
            ELSE 0
          END
        ),
        0
      ) AS affected_note_count
    FROM notes
    WHERE campaign_id = @campaign_id
  `)

  const reassignMembershipAttributionStatement = database.prepare(`
    UPDATE notes
    SET
      created_by_membership_id = CASE
        WHEN created_by_membership_id = @source_membership_id THEN @target_membership_id
        ELSE created_by_membership_id
      END,
      last_edited_by_membership_id = CASE
        WHEN last_edited_by_membership_id = @source_membership_id THEN @target_membership_id
        ELSE last_edited_by_membership_id
      END
    WHERE
      campaign_id = @campaign_id
      AND (
        created_by_membership_id = @source_membership_id
        OR last_edited_by_membership_id = @source_membership_id
      )
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

  const createOwnerAccountTransaction = database.transaction(
    (input: OwnerRegistrationInput) => {
      const normalizedEmail = normalizeEmailAddress(input.email)
      const existing = selectOwnerAccountByEmail.get(input.email) as
        | OwnerAccountRow
        | undefined

      if (existing) {
        return null
      }

      const timestamp = new Date().toISOString()
      const owner: OwnerAccount = {
        id: randomUUID(),
        email: input.email,
        displayName: input.displayName,
        isSiteAdmin: configuredSiteAdminEmails.has(normalizedEmail),
        createdAt: timestamp,
        updatedAt: timestamp,
      }

      insertOwnerAccount.run({
        id: owner.id,
        email: owner.email,
        display_name: owner.displayName,
        password_hash: createPasswordHash(input.password),
        is_site_admin: owner.isSiteAdmin ? 1 : 0,
        created_at: owner.createdAt,
        updated_at: owner.updatedAt,
      })

      updateUnclaimedDefaultMembership.run({
        user_id: owner.id,
        display_name: owner.displayName,
        updated_at: timestamp,
        campaign_id: defaultCampaign.id,
      })

      return owner
    },
  )

  const createCampaignTransaction = database.transaction(
    (input: CampaignInput, owner: OwnerAccount) => {
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
        display_name: owner.displayName,
        user_id: owner.id,
        guest_token_id: null,
        created_at: timestamp,
        updated_at: timestamp,
      })

      return campaign
    },
  )

  const updateCampaignTransaction = database.transaction(
    (campaignId: string, input: CampaignInput, ownerUserId?: string) => {
      const existing = selectCampaignById.get(campaignId) as CampaignRow | undefined

      if (!existing || existing.archived_at !== null) {
        return null
      }

      if (ownerUserId && !selectOwnerMembershipByCampaignAndUser.get(campaignId, ownerUserId)) {
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

  const createCampaignShareLinkTransaction = database.transaction(
    (campaignId: string, input: CampaignShareLinkInput, ownerUserId: string) => {
      const campaign = selectCampaignById.get(campaignId) as CampaignRow | undefined

      if (!campaign || campaign.archived_at !== null) {
        return null
      }

      if (!selectOwnerMembershipByCampaignAndUser.get(campaignId, ownerUserId)) {
        return null
      }

      const token = createSessionToken()
      const timestamp = new Date().toISOString()
      const shareLink: CampaignShareLink = {
        id: randomUUID(),
        campaignId,
        label: input.label,
        accessLevel: input.accessLevel,
        frameAncestors: input.frameAncestors,
        expiresAt: input.expiresAt ?? null,
        revokedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      }

      insertShareLink.run({
        id: shareLink.id,
        campaign_id: shareLink.campaignId,
        token_hash: hashSessionToken(token),
        token_plaintext: token,
        label: shareLink.label,
        access_level: shareLink.accessLevel,
        frame_ancestors: shareLink.frameAncestors,
        expires_at: shareLink.expiresAt,
        revoked_at: shareLink.revokedAt,
        created_at: shareLink.createdAt,
        updated_at: shareLink.updatedAt,
      })

      return { shareLink, token }
    },
  )

  const createGuestMembershipTransaction = database.transaction(
    (campaignId: string, displayName: string) => {
      const campaign = selectCampaignById.get(campaignId) as CampaignRow | undefined

      if (!campaign || campaign.archived_at !== null) {
        throw new Error(`Campaign "${campaignId}" was not found.`)
      }

      const guestToken = createSessionToken()
      const timestamp = new Date().toISOString()
      const membership: CampaignMembership = {
        id: randomUUID(),
        campaignId,
        role: 'guest',
        displayName,
        userId: null,
        guestTokenId: hashSessionToken(guestToken),
        createdAt: timestamp,
        updatedAt: timestamp,
      }

      insertMembership.run({
        id: membership.id,
        campaign_id: membership.campaignId,
        role: membership.role,
        display_name: membership.displayName,
        user_id: membership.userId,
        guest_token_id: membership.guestTokenId,
        created_at: membership.createdAt,
        updated_at: membership.updatedAt,
      })

      return { membership, guestToken }
    },
  )

  const claimGuestMembershipTransaction = database.transaction(
    (membershipId: string, ownerUserId: string): ClaimGuestMembershipResult => {
      const membershipRow = selectMembershipById.get(membershipId) as
        | CampaignMembershipRow
        | undefined

      if (!membershipRow || membershipRow.role !== 'guest') {
        return { status: 'not-found' }
      }

      const membership = mapMembershipRow(membershipRow)

      if (membership.userId !== null) {
        return { status: 'already-linked', membership }
      }

      const existingMembership = selectMembershipByCampaignAndUser.get(
        membership.campaignId,
        ownerUserId,
      ) as CampaignMembershipRow | undefined

      if (existingMembership) {
        return {
          status: 'account-already-member',
          membership: mapMembershipRow(existingMembership),
        }
      }

      const updatedAt = new Date().toISOString()
      const guestToken = createSessionToken()
      const guestTokenId = hashSessionToken(guestToken)

      claimGuestMembershipStatement.run({
        id: membership.id,
        user_id: ownerUserId,
        guest_token_id: guestTokenId,
        updated_at: updatedAt,
      })

      return {
        status: 'claimed',
        membership: {
          ...membership,
          userId: ownerUserId,
          guestTokenId,
          updatedAt,
        },
        guestToken,
      }
    },
  )

  const previewMembershipConsolidation = (
    campaignId: string,
    sourceMembershipId: string,
    targetMembershipId: string,
    ownerUserId: string,
  ): MembershipConsolidationPreviewResult => {
    requireCampaign(campaignId)

    if (!selectOwnerMembershipByCampaignAndUser.get(campaignId, ownerUserId)) {
      return { status: 'forbidden' }
    }

    if (sourceMembershipId === targetMembershipId) {
      return { status: 'same-membership' }
    }

    const sourceMembershipRow = selectMembershipByCampaignAndId.get(
      campaignId,
      sourceMembershipId,
    ) as CampaignMembershipRow | undefined

    if (!sourceMembershipRow) {
      return { status: 'source-not-found' }
    }

    const targetMembershipRow = selectMembershipByCampaignAndId.get(
      campaignId,
      targetMembershipId,
    ) as CampaignMembershipRow | undefined

    if (!targetMembershipRow) {
      return { status: 'target-not-found' }
    }

    const sourceMembership = mapMembershipRow(sourceMembershipRow)
    const targetMembership = mapMembershipRow(targetMembershipRow)
    const counts = selectMembershipConsolidationCounts.get({
      campaign_id: campaignId,
      source_membership_id: sourceMembership.id,
    }) as MembershipConsolidationCountsRow

    return {
      status: 'ready',
      consolidation: {
        effect: 'note-attribution-only',
        sourceMembership,
        targetMembership,
        noteChanges: {
          authoredNoteCount: counts.authored_note_count,
          editedNoteCount: counts.edited_note_count,
          authoredAndEditedNoteCount: counts.authored_and_edited_note_count,
          affectedNoteCount: counts.affected_note_count,
        },
        warnings: buildMembershipConsolidationWarnings(
          sourceMembership,
          targetMembership,
        ),
        requiresRoleMismatchConfirmation:
          sourceMembership.role !== targetMembership.role,
      },
    }
  }

  const consolidateMembershipsTransaction = database.transaction(
    (
      campaignId: string,
      sourceMembershipId: string,
      targetMembershipId: string,
      ownerUserId: string,
    ): MembershipConsolidationResult => {
      const preview = previewMembershipConsolidation(
        campaignId,
        sourceMembershipId,
        targetMembershipId,
        ownerUserId,
      )

      if (preview.status !== 'ready') {
        return preview
      }

      reassignMembershipAttributionStatement.run({
        campaign_id: campaignId,
        source_membership_id: sourceMembershipId,
        target_membership_id: targetMembershipId,
      })

      return {
        status: 'ready',
        consolidation: {
          ...preview.consolidation,
          applied: true,
        },
      }
    },
  )

  const listCampaigns = () =>
    (selectAllCampaigns.all() as CampaignRow[]).map((row) => mapCampaignRow(row))

  const listUserCampaigns = (userId: string) =>
    (selectUserCampaigns.all(userId) as CampaignRow[]).map((row) => mapCampaignRow(row))

  const listOwnedCampaigns = (ownerUserId: string) =>
    (selectOwnedCampaigns.all(ownerUserId) as CampaignRow[]).map((row) =>
      mapCampaignRow(row),
    )

  const getCampaign = (campaignId: string) => {
    const row = selectCampaignById.get(campaignId) as CampaignRow | undefined
    return row ? mapCampaignRow(row) : null
  }

  const getPrimaryCampaign = (ownerUserId?: string) => {
    if (ownerUserId) {
      const row = selectPrimaryOwnedCampaign.get(ownerUserId) as
        | CampaignRow
        | undefined

      if (!row) {
        throw new Error('No owned campaigns are available.')
      }

      return mapCampaignRow(row)
    }

    const campaigns = listCampaigns()
    const primaryCampaign = campaigns[0]

    if (!primaryCampaign) {
      throw new Error('No active campaigns are available.')
    }

    return primaryCampaign
  }

  const getPrimaryCampaignForUser = (userId: string) => {
    const row = selectPrimaryUserCampaign.get(userId) as CampaignRow | undefined

    if (!row) {
      throw new Error('No campaigns are available.')
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

  const groupReferencesBySource = (rows: NoteReferenceRow[]) => {
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

  const validateReferenceTarget = (targetNoteId: string, campaignId: string) => {
    const targetNote = selectNoteIdentityById.get(targetNoteId) as NoteIdentityRow | undefined

    if (!targetNote) {
      throw new Error(`Referenced note "${targetNoteId}" was not found.`)
    }

    if (targetNote.campaign_id !== campaignId) {
      throw new Error(`Referenced note "${targetNoteId}" must be in the same campaign.`)
    }
  }

  const buildPendingReferences = (
    body: string,
    explicitLinkedNoteIds: string[],
    campaignId: string,
    options: { allowInvalidReferences: boolean } = {
      allowInvalidReferences: false,
    },
  ) => {
    let inlineReferences: ReturnType<typeof parseInlineNoteReferences> = []

    try {
      inlineReferences = parseInlineNoteReferences(body)
    } catch (error) {
      if (!options.allowInvalidReferences) {
        throw error
      }
    }

    const references: PendingReference[] = []
    const explicitTargetIds = new Set<string>()

    for (const linkedNoteId of explicitLinkedNoteIds) {
      const targetNoteId = linkedNoteId.trim()

      if (targetNoteId.length === 0 || explicitTargetIds.has(targetNoteId)) {
        continue
      }

      try {
        validateReferenceTarget(targetNoteId, campaignId)
      } catch (error) {
        if (!options.allowInvalidReferences) {
          throw error
        }

        continue
      }

      explicitTargetIds.add(targetNoteId)
      references.push({
        targetNoteId,
        referenceType: 'linked',
        label: null,
        qualifier: null,
        positionInBody: null,
      })
    }

    for (const reference of inlineReferences) {
      try {
        validateReferenceTarget(reference.targetNoteId, campaignId)
      } catch (error) {
        if (!options.allowInvalidReferences) {
          throw error
        }

        continue
      }

      references.push({
        targetNoteId: reference.targetNoteId,
        referenceType: 'inline',
        label: reference.label,
        qualifier: reference.qualifier,
        positionInBody: reference.positionInBody,
      })
    }

    return references
  }

  const replaceNoteReferences = (
    noteId: string,
    campaignId: string,
    body: string,
    explicitLinkedNoteIds: string[],
    timestamp: string,
    options?: { allowInvalidReferences: boolean },
  ) => {
    const references = buildPendingReferences(body, explicitLinkedNoteIds, campaignId, options)
    const persistedReferences: NoteReference[] = []

    deleteNoteReferencesBySourceNoteId.run(noteId)

    for (const reference of references) {
      const id = randomUUID()
      const persistedReference = mapNoteReferenceRow({
        id,
        source_note_id: noteId,
        target_note_id: reference.targetNoteId,
        campaign_id: campaignId,
        reference_type: reference.referenceType,
        label: reference.label,
        qualifier: reference.qualifier,
        position_in_body: reference.positionInBody,
        created_at: timestamp,
        updated_at: timestamp,
      })

      insertNoteReference.run({
        id,
        source_note_id: persistedReference.sourceNoteId,
        target_note_id: persistedReference.targetNoteId,
        campaign_id: persistedReference.campaignId,
        reference_type: persistedReference.referenceType,
        label: persistedReference.label,
        qualifier: persistedReference.qualifier,
        position_in_body: persistedReference.positionInBody,
        created_at: persistedReference.createdAt,
        updated_at: persistedReference.updatedAt,
      })

      persistedReferences.push(persistedReference)
    }

    return persistedReferences
  }

  const syncNoteReferencesTransaction = database.transaction(
    (options: { allowInvalidReferences: boolean } = { allowInvalidReferences: true }) => {
      const noteRows = selectStoredNotesForReferenceSync.all() as Array<{
        id: string
        campaign_id: string
        body: string
        linked_notes_json: string | null
        created_at: string
        updated_at: string
      }>

      for (const row of noteRows) {
        const explicitLinkedNoteIds = row.linked_notes_json
          ? (JSON.parse(row.linked_notes_json) as string[])
          : []

        replaceNoteReferences(
          row.id,
          row.campaign_id,
          row.body,
          explicitLinkedNoteIds,
          row.updated_at ?? row.created_at,
          options,
        )
      }
    },
  )

  const listNotes = (campaignId?: string) => {
    const campaign = requireCampaign(campaignId)
    const notes = (selectNotesByCampaignId.all(campaign.id) as NoteRow[]).map((row) =>
      mapNoteRow(row),
    )
    const referencesBySource = groupReferencesBySource(
      selectNoteReferencesByCampaignId.all(campaign.id) as NoteReferenceRow[],
    )

    return notes.map((note) => composeNote(note, referencesBySource.get(note.id) ?? []))
  }

  const insertPersistedNote = (note: NoteRecord) => {
    insertNote.run({
      id: note.id,
      campaign_id: note.campaignId,
      title: note.title,
      body: note.body,
      status: note.status,
      tags_json: JSON.stringify(note.tags),
      linked_notes_json: JSON.stringify(note.explicitLinkedNoteIds),
      session_name: note.sessionName,
      created_by_membership_id: note.createdBy?.membershipId ?? null,
      last_edited_by_membership_id: note.lastEditedBy?.membershipId ?? null,
      created_at: note.createdAt,
      updated_at: note.updatedAt,
    })
  }

  const resetNotesTransaction = database.transaction(
    (inputs: NoteInput[], campaignId?: string) => {
      const campaign = requireCampaign(campaignId)
      deleteNotesByCampaignIdStatement.run(campaign.id)

      const baseTimestamp = Date.now()
      const notes = inputs.map((input, index) => {
        const timestamp = new Date(baseTimestamp - index).toISOString()
        const note: NoteRecord = {
          id: randomUUID(),
          campaignId: campaign.id,
          title: input.title,
          body: input.body,
          tags: input.tags,
          status: input.status,
          sessionName: input.sessionName,
          explicitLinkedNoteIds: input.linkedNoteIds ?? [],
          createdBy: null,
          lastEditedBy: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        }

        insertPersistedNote(note)
        return note
      })

      for (const note of notes) {
        replaceNoteReferences(
          note.id,
          note.campaignId,
          note.body,
          note.explicitLinkedNoteIds,
          note.updatedAt,
          { allowInvalidReferences: false },
        )
      }

      return notes.map((note) =>
        composeNote(
          note,
          (selectNoteReferencesBySourceNoteId.all(note.id) as NoteReferenceRow[]).map(
            mapNoteReferenceRow,
          ),
        ),
      )
    },
  )

  const createNoteTransaction = database.transaction((input: NoteInput, membershipId?: string) => {
    const campaign = requireCampaign(input.campaignId)
    const timestamp = new Date().toISOString()

    const membership = membershipId
      ? (selectMembershipById.get(membershipId) as CampaignMembershipRow | undefined)
      : undefined

    const attribution: NoteAttribution | null = membership
      ? {
          membershipId: membership.id,
          displayName: membership.display_name,
          role: membership.role as CampaignMembershipRole,
        }
      : null

    const note: NoteRecord = {
      id: randomUUID(),
      campaignId: campaign.id,
      title: input.title,
      body: input.body,
      tags: input.tags,
      status: input.status,
      sessionName: input.sessionName,
      explicitLinkedNoteIds: input.linkedNoteIds ?? [],
      createdBy: attribution,
      lastEditedBy: attribution,
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    insertPersistedNote(note)
    const references = replaceNoteReferences(
      note.id,
      note.campaignId,
      note.body,
      note.explicitLinkedNoteIds,
      note.updatedAt,
      { allowInvalidReferences: false },
    )

    return composeNote(note, references)
  })

  const updateNoteTransaction = database.transaction(
    (noteId: string, input: NoteInput, membershipId?: string) => {
      const existingRow = selectNoteById.get(noteId) as NoteRow | undefined

      if (!existingRow) {
        return null
      }

      const existing = mapNoteRow(existingRow)
      const membership = membershipId
        ? (selectMembershipById.get(membershipId) as CampaignMembershipRow | undefined)
        : undefined

      const editAttribution: NoteAttribution | null = membership
        ? {
            membershipId: membership.id,
            displayName: membership.display_name,
            role: membership.role as CampaignMembershipRole,
          }
        : existing.lastEditedBy

      const nextNote: NoteRecord = {
        ...existing,
        title: input.title,
        body: input.body,
        tags: input.tags,
        status: input.status,
        sessionName: input.sessionName,
        explicitLinkedNoteIds: input.linkedNoteIds ?? existing.explicitLinkedNoteIds,
        lastEditedBy: editAttribution,
        updatedAt: createTimestampAfter(existing.updatedAt),
      }

      updateNoteStatement.run({
        id: nextNote.id,
        title: nextNote.title,
        body: nextNote.body,
        status: nextNote.status,
        tags_json: JSON.stringify(nextNote.tags),
        linked_notes_json: JSON.stringify(nextNote.explicitLinkedNoteIds),
        session_name: nextNote.sessionName,
        last_edited_by_membership_id: nextNote.lastEditedBy?.membershipId ?? null,
        updated_at: nextNote.updatedAt,
      })

      const references = replaceNoteReferences(
        nextNote.id,
        nextNote.campaignId,
        nextNote.body,
        nextNote.explicitLinkedNoteIds,
        nextNote.updatedAt,
        { allowInvalidReferences: false },
      )

      return composeNote(nextNote, references)
    },
  )

  ensureDefaultCampaignTransaction()
  syncNoteReferencesTransaction()

  return {
    listCampaigns,
    listUserCampaigns,
    listOwnedCampaigns,
    getPrimaryCampaignForUser,
    getPrimaryCampaign,
    getCampaign,
    createCampaign(input, owner) {
      return createCampaignTransaction(input, owner)
    },
    updateCampaign(campaignId, input, ownerUserId) {
      return updateCampaignTransaction(campaignId, input, ownerUserId)
    },
    listCampaignMemberships(campaignId) {
      requireCampaign(campaignId)
      return (
        selectMembershipsByCampaignId.all(campaignId) as CampaignMembershipRow[]
      ).map((row) => mapMembershipRow(row))
    },
    listCampaignShareLinks(campaignId) {
      requireCampaign(campaignId)
      return (
        selectActiveShareLinksByCampaignId.all(campaignId, new Date().toISOString()) as
          CampaignShareLinkRow[]
      ).map((row) => mapCampaignShareLinkRow(row))
    },
    userHasCampaignAccess(userId, campaignId) {
      return Boolean(selectMembershipByCampaignAndUser.get(campaignId, userId))
    },
    userOwnsCampaign(ownerUserId, campaignId) {
      return Boolean(selectOwnerMembershipByCampaignAndUser.get(campaignId, ownerUserId))
    },
    createOwnerAccount(input) {
      return createOwnerAccountTransaction(input)
    },
    authenticateOwner(email, password) {
      const row = selectOwnerAccountByEmail.get(email) as OwnerAccountRow | undefined

      if (!row || !verifyPassword(password, row.password_hash)) {
        return null
      }

      return mapOwnerAccountRow(row)
    },
    getOwnerBySessionToken(token) {
      deleteExpiredOwnerSessions.run(new Date().toISOString())
      const row = selectOwnerBySessionToken.get(
        hashSessionToken(token),
        new Date().toISOString(),
      ) as OwnerAccountRow | undefined

      return row ? mapOwnerAccountRow(row) : null
    },
    createOwnerSession(ownerUserId) {
      const owner = selectOwnerAccountById.get(ownerUserId) as OwnerAccountRow | undefined

      if (!owner) {
        throw new Error(`Owner "${ownerUserId}" was not found.`)
      }

      const token = createSessionToken()
      const createdAt = new Date().toISOString()
      const expiresAt = new Date(Date.now() + sessionTtlMs).toISOString()

      insertOwnerSession.run({
        id: randomUUID(),
        owner_user_id: owner.id,
        token_hash: hashSessionToken(token),
        created_at: createdAt,
        expires_at: expiresAt,
      })

      return token
    },
    deleteOwnerSession(token) {
      deleteOwnerSessionByTokenHash.run(hashSessionToken(token))
    },
    createCampaignShareLink(campaignId, input, ownerUserId) {
      return createCampaignShareLinkTransaction(campaignId, input, ownerUserId)
    },
    revokeCampaignShareLink(campaignId, shareLinkId, ownerUserId) {
      if (!selectOwnerMembershipByCampaignAndUser.get(campaignId, ownerUserId)) {
        return false
      }

      const result = revokeShareLinkStatement.run({
        id: shareLinkId,
        campaign_id: campaignId,
        revoked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })

      return result.changes > 0
    },
    getCampaignShareLinkReveal(campaignId, shareLinkId, ownerUserId) {
      if (!selectOwnerMembershipByCampaignAndUser.get(campaignId, ownerUserId)) {
        return null
      }

      const row = selectShareLinkRevealById.get(
        shareLinkId,
        campaignId,
        new Date().toISOString(),
      ) as Pick<CampaignShareLinkRow, 'token_plaintext'> | undefined

      if (!row) {
        return null
      }

      if (!row.token_plaintext) {
        return { status: 'legacy-unavailable' }
      }

      return {
        status: 'available',
        token: row.token_plaintext,
      }
    },
    getCampaignShareLinkByToken(token) {
      const row = selectActiveShareLinkByTokenHash.get(
        hashSessionToken(token),
        new Date().toISOString(),
      ) as CampaignShareLinkRow | undefined

      return row ? mapCampaignShareLinkRow(row) : null
    },
    createGuestMembership(campaignId, displayName) {
      return createGuestMembershipTransaction(campaignId, displayName)
    },
    getGuestMembershipByToken(token) {
      const row = selectGuestMembershipByTokenHash.get(
        hashSessionToken(token),
      ) as CampaignMembershipRow | undefined

      return row ? mapMembershipRow(row) : null
    },
    claimGuestMembership(membershipId, ownerUserId) {
      return claimGuestMembershipTransaction(membershipId, ownerUserId)
    },
    previewMembershipConsolidation(campaignId, sourceMembershipId, targetMembershipId, ownerUserId) {
      return previewMembershipConsolidation(
        campaignId,
        sourceMembershipId,
        targetMembershipId,
        ownerUserId,
      )
    },
    consolidateMemberships(campaignId, sourceMembershipId, targetMembershipId, ownerUserId) {
      return consolidateMembershipsTransaction(
        campaignId,
        sourceMembershipId,
        targetMembershipId,
        ownerUserId,
      )
    },
    getUserMembershipForCampaign(userId, campaignId) {
      const row = selectMembershipByCampaignAndUser.get(
        campaignId,
        userId,
      ) as CampaignMembershipRow | undefined

      return row ? mapMembershipRow(row) : null
    },
    getOwnerMembershipForCampaign(ownerUserId, campaignId) {
      const row = selectOwnerMembershipByCampaignAndUser.get(
        campaignId,
        ownerUserId,
      ) as CampaignMembershipRow | undefined

      return row ? mapMembershipRow(row) : null
    },
    listNotes,
    listSessionNames(campaignId) {
      const notes = listNotes(campaignId)
      const sessionMap = new Map<string, { noteCount: number; latestActivity: string }>()

      for (const note of notes) {
        if (note.sessionName === null) {
          continue
        }

        const existing = sessionMap.get(note.sessionName)

        if (existing) {
          existing.noteCount += 1
          if (note.updatedAt > existing.latestActivity) {
            existing.latestActivity = note.updatedAt
          }
        } else {
          sessionMap.set(note.sessionName, {
            noteCount: 1,
            latestActivity: note.updatedAt,
          })
        }
      }

      const sessions: SessionSummary[] = []

      for (const [sessionName, data] of sessionMap) {
        sessions.push({
          sessionName,
          noteCount: data.noteCount,
          latestActivity: data.latestActivity,
        })
      }

      sessions.sort((a, b) => b.latestActivity.localeCompare(a.latestActivity))

      return sessions
    },
    listRecentNotes(limit, campaignId) {
      return listNotes(campaignId).slice(0, limit)
    },
    getSessionNotes(campaignId, sessionName) {
      const rows = selectNotesBySessionName.all(
        campaignId,
        sessionName,
      ) as NoteRow[]
      const referencesBySource = groupReferencesBySource(
        selectNoteReferencesByCampaignId.all(campaignId) as NoteReferenceRow[],
      )

      return rows.map((row) => {
        const note = mapNoteRow(row)
        return composeNote(note, referencesBySource.get(note.id) ?? [])
      })
    },
    getNote(noteId) {
      const row = selectNoteById.get(noteId) as NoteRow | undefined
      if (!row) {
        return null
      }

      const note = mapNoteRow(row)
      const references = (selectNoteReferencesBySourceNoteId.all(noteId) as NoteReferenceRow[]).map(
        mapNoteReferenceRow,
      )

      return composeNote(note, references)
    },
    getBacklinks(noteId) {
      const targetNote = this.getNote(noteId)
      if (!targetNote) {
        return []
      }
      const allNotes = listNotes(targetNote.campaignId)
      return allNotes.filter((note) => note.linkedNoteIds.includes(noteId))
    },
    createNote(input, membershipId) {
      return createNoteTransaction(input, membershipId)
    },
    updateNote(noteId, input, membershipId) {
      return updateNoteTransaction(noteId, input, membershipId)
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
    backupDatabase(destinationPath) {
      return database.backup(destinationPath).then(() => undefined)
    },
    close() {
      database.close()
    },
  }
}

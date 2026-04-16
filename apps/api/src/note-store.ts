import Database from 'better-sqlite3'
import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto'
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  defaultCampaign,
  defaultCampaignId,
  defaultOwnerDisplayName,
} from './campaign.js'
import { initializeNoteStoreDatabase } from './note-store-bootstrap.js'
import {
  composeNote,
  groupReferencesBySource,
  mapNoteReferenceRow,
  mapNoteRow,
  prepareNoteStatements,
} from './note-store-notes.js'
import { parseInlineNoteReferences } from './note-references.js'
import type {
  AdminAccountSummary,
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
  AdminOverview,
  OwnerAccount,
  OwnerRegistrationInput,
  SessionSummary,
} from './types.js'
import type {
  NoteIdentityRow,
  NoteRecord,
  NoteReferenceRow,
  NoteRow,
  StoredNoteForReferenceSyncRow,
} from './note-store-notes.js'

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

interface AdminAccountSummaryRow {
  id: string
  email: string
  display_name: string
  is_site_admin: number
  created_at: string
  updated_at: string
  membership_count: number
  owned_campaign_count: number
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

export interface CreateNoteStoreOptions {
  dbPath?: string
  siteAdminEmails?: readonly string[]
}

export class InvalidBackupDatabaseError extends Error {}

const requiredBackupTables = [
  'owner_accounts',
  'owner_sessions',
  'campaigns',
  'campaign_memberships',
  'campaign_share_links',
  'notes',
] as const

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
  listOwnerAccounts(): AdminAccountSummary[]
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
  getAdminOverview(): AdminOverview
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

function mapAdminAccountSummaryRow(row: AdminAccountSummaryRow): AdminAccountSummary {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    isSiteAdmin: row.is_site_admin === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    campaignMembershipCount: row.membership_count,
    ownedCampaignCount: row.owned_campaign_count,
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
  initializeNoteStoreDatabase(database, configuredSiteAdminEmails)

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

  const selectAdminOverviewCounts = database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM owner_accounts) AS owner_account_count,
      (SELECT COUNT(*) FROM owner_accounts WHERE is_site_admin = 1) AS site_admin_count,
      (SELECT COUNT(*) FROM campaigns) AS campaign_count,
      (SELECT COUNT(*) FROM campaigns WHERE archived_at IS NOT NULL) AS archived_campaign_count,
      (SELECT COUNT(*) FROM campaign_memberships) AS membership_count,
      (SELECT COUNT(*) FROM campaign_memberships WHERE user_id IS NOT NULL) AS linked_membership_count,
      (SELECT COUNT(*) FROM campaign_memberships WHERE role = 'guest') AS guest_membership_count,
      (SELECT COUNT(*) FROM campaign_share_links WHERE revoked_at IS NULL) AS active_share_link_count,
      (SELECT COUNT(*) FROM campaign_share_links WHERE revoked_at IS NOT NULL) AS revoked_share_link_count,
      (SELECT COUNT(*) FROM notes) AS note_count,
      (SELECT COUNT(*) FROM notes WHERE status = 'draft') AS draft_note_count,
      (SELECT COUNT(*) FROM notes WHERE status = 'active') AS active_note_count,
      (SELECT COUNT(*) FROM notes WHERE status = 'archived') AS archived_note_count
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

  const selectAdminAccounts = database.prepare(`
    SELECT
      owner_accounts.id,
      owner_accounts.email,
      owner_accounts.display_name,
      owner_accounts.is_site_admin,
      owner_accounts.created_at,
      owner_accounts.updated_at,
      COUNT(DISTINCT campaign_memberships.id) AS membership_count,
      COUNT(
        DISTINCT CASE
          WHEN campaign_memberships.role = 'owner' THEN campaign_memberships.campaign_id
        END
      ) AS owned_campaign_count
    FROM owner_accounts
    LEFT JOIN campaign_memberships
      ON campaign_memberships.user_id = owner_accounts.id
    GROUP BY
      owner_accounts.id,
      owner_accounts.email,
      owner_accounts.display_name,
      owner_accounts.is_site_admin,
      owner_accounts.created_at,
      owner_accounts.updated_at
    ORDER BY owner_accounts.is_site_admin DESC, owner_accounts.email ASC
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

  const {
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
  } = prepareNoteStatements(database)

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
      const noteRows = selectStoredNotesForReferenceSync.all() as StoredNoteForReferenceSyncRow[]

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
    listOwnerAccounts() {
      const rows = selectAdminAccounts.all() as AdminAccountSummaryRow[]
      return rows.map(mapAdminAccountSummaryRow)
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
    getAdminOverview() {
      const counts = selectAdminOverviewCounts.get() as {
        owner_account_count: number
        site_admin_count: number
        campaign_count: number
        archived_campaign_count: number
        membership_count: number
        linked_membership_count: number
        guest_membership_count: number
        active_share_link_count: number
        revoked_share_link_count: number
        note_count: number
        draft_note_count: number
        active_note_count: number
        archived_note_count: number
      }

      return {
        generatedAt: new Date().toISOString(),
        accounts: {
          total: counts.owner_account_count,
          siteAdmins: counts.site_admin_count,
        },
        campaigns: {
          total: counts.campaign_count,
          archived: counts.archived_campaign_count,
        },
        memberships: {
          total: counts.membership_count,
          linkedAccounts: counts.linked_membership_count,
          guests: counts.guest_membership_count,
        },
        shareLinks: {
          active: counts.active_share_link_count,
          revoked: counts.revoked_share_link_count,
        },
        notes: {
          total: counts.note_count,
          draft: counts.draft_note_count,
          active: counts.active_note_count,
          archived: counts.archived_note_count,
        },
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

export function restoreNoteStoreFromBackup(
  sourcePath: string,
  options: CreateNoteStoreOptions = {},
): NoteStore {
  const dbPath = resolveNoteDbPath(options)

  if (dbPath === ':memory:') {
    throw new Error('Admin restore is not supported for in-memory note stores.')
  }

  const validationDatabase = new Database(sourcePath, {
    readonly: true,
    fileMustExist: true,
  })

  try {
    const existingTables = new Set(
      (
        validationDatabase.prepare(`
          SELECT name
          FROM sqlite_master
          WHERE type = 'table'
        `).all() as Array<{ name: string }>
      ).map((row) => row.name),
    )
    const missingTables = requiredBackupTables.filter(
      (tableName) => !existingTables.has(tableName),
    )

    if (missingTables.length > 0) {
      throw new InvalidBackupDatabaseError(
        `Missing required tables: ${missingTables.join(', ')}`,
      )
    }
  } catch (error) {
    if (error instanceof InvalidBackupDatabaseError) {
      throw error
    }

    throw new InvalidBackupDatabaseError('The uploaded database could not be read.')
  } finally {
    validationDatabase.close()
  }

  const validationStore = createNoteStore({ ...options, dbPath: sourcePath })

  try {
    validationStore.getAdminOverview()
  } catch {
    throw new InvalidBackupDatabaseError(
      'The uploaded database could not be opened as a dnd-notes backup.',
    )
  } finally {
    validationStore.close()
  }

  mkdirSync(dirname(dbPath), { recursive: true })
  copyFileSync(sourcePath, dbPath)

  return createNoteStore({ ...options, dbPath })
}

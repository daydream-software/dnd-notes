import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto'
import {
  defaultCampaign,
  defaultCampaignId,
  defaultOwnerDisplayName,
} from './campaign.js'
import { initializeNoteStoreDatabase } from './note-store-bootstrap.js'
import {
  createNoteStorePostgresPool,
  createPostgresDatabase,
  type NoteStoreDatabase,
  type PostgresPoolLike,
} from './note-store-database.js'
import { runTenantApiMigrations } from './migrations.js'
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
  KeycloakOwnerIdentity,
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
  keycloak_sub: string | null
  created_at: string
  updated_at: string
}

interface AdminAccountSummaryRow {
  id: string
  email: string
  display_name: string
  is_site_admin: number
  keycloak_sub: string | null
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
  databaseUrl?: string
  postgresPool?: PostgresPoolLike
  siteAdminEmails?: readonly string[]
  migrationMode?: 'apply' | 'verify'
}

export type RuntimeNoteStoreOptions = CreateNoteStoreOptions
export const ownerKeycloakLinkConflictCode = 'OWNER_KEYCLOAK_LINK_CONFLICT'

export class OwnerKeycloakLinkConflictError extends Error {
  readonly code = ownerKeycloakLinkConflictCode

  constructor(
    readonly ownerId: string,
    message = 'This owner account is already linked to a different Keycloak identity.',
  ) {
    super(message)
    this.name = 'OwnerKeycloakLinkConflictError'
  }
}

const sessionTtlMs = 1000 * 60 * 60 * 24 * 30

function normalizeEmailAddress(email: string) {
  return email.trim().toLowerCase()
}

function isOwnerEmailUniqueConstraintError(error: unknown) {
  if (!(error instanceof Error)) {
    return false
  }

  const code =
    'code' in error && typeof error.code === 'string'
      ? error.code
      : undefined
  const constraint =
    'constraint' in error && typeof error.constraint === 'string'
      ? error.constraint
      : undefined
  const details = [code, constraint, error.message].filter(Boolean).join(' ')

  return (
    code === '23505' ||
    /owner_accounts\.email/i.test(details) ||
    /idx_owner_accounts_email_lower/i.test(details) ||
    /duplicate key value/i.test(details)
  )
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
  listCampaigns(): Promise<CampaignSummary[]>
  listUserCampaigns(userId: string): Promise<CampaignSummary[]>
  listOwnedCampaigns(ownerUserId: string): Promise<CampaignSummary[]>
  getPrimaryCampaignForUser(userId: string): Promise<CampaignSummary>
  getPrimaryCampaign(ownerUserId?: string): Promise<CampaignSummary>
  getCampaign(campaignId: string): Promise<CampaignSummary | null>
  createCampaign(input: CampaignInput, owner: OwnerAccount): Promise<CampaignSummary>
  updateCampaign(
    campaignId: string,
    input: CampaignInput,
    ownerUserId?: string,
  ): Promise<CampaignSummary | null>
  listCampaignMemberships(campaignId: string): Promise<CampaignMembership[]>
  listCampaignShareLinks(campaignId: string): Promise<CampaignShareLink[]>
  userHasCampaignAccess(userId: string, campaignId: string): Promise<boolean>
  userOwnsCampaign(ownerUserId: string, campaignId: string): Promise<boolean>
  createOwnerAccount(input: OwnerRegistrationInput): Promise<OwnerAccount | null>
  authenticateOwner(email: string, password: string): Promise<OwnerAccount | null>
  getOwnerBySessionToken(token: string): Promise<OwnerAccount | null>
  findOrCreateOwnerByKeycloakIdentity(
    identity: KeycloakOwnerIdentity,
  ): Promise<OwnerAccount>
  listOwnerAccounts(): Promise<AdminAccountSummary[]>
  createOwnerSession(ownerUserId: string): Promise<string>
  deleteOwnerSession(token: string): Promise<void>
  createCampaignShareLink(
    campaignId: string,
    input: CampaignShareLinkInput,
    ownerUserId: string,
  ): Promise<{ shareLink: CampaignShareLink; token: string } | null>
  revokeCampaignShareLink(
    campaignId: string,
    shareLinkId: string,
    ownerUserId: string,
  ): Promise<boolean>
  getCampaignShareLinkReveal(
    campaignId: string,
    shareLinkId: string,
    ownerUserId: string,
  ): Promise<CampaignShareLinkRevealResult | null>
  getCampaignShareLinkByToken(token: string): Promise<CampaignShareLink | null>
  createGuestMembership(
    campaignId: string,
    displayName: string,
  ): Promise<{ membership: CampaignMembership; guestToken: string }>
  getGuestMembershipByToken(token: string): Promise<CampaignMembership | null>
  claimGuestMembership(
    membershipId: string,
    ownerUserId: string,
  ): Promise<ClaimGuestMembershipResult>
  previewMembershipConsolidation(
    campaignId: string,
    sourceMembershipId: string,
    targetMembershipId: string,
    ownerUserId: string,
  ): Promise<MembershipConsolidationPreviewResult>
  consolidateMemberships(
    campaignId: string,
    sourceMembershipId: string,
    targetMembershipId: string,
    ownerUserId: string,
  ): Promise<MembershipConsolidationResult>
  getUserMembershipForCampaign(userId: string, campaignId: string): Promise<CampaignMembership | null>
  getOwnerMembershipForCampaign(
    ownerUserId: string,
    campaignId: string,
  ): Promise<CampaignMembership | null>
  listNotes(campaignId?: string): Promise<Note[]>
  listSessionNames(campaignId?: string): Promise<SessionSummary[]>
  listRecentNotes(limit: number, campaignId?: string): Promise<Note[]>
  getSessionNotes(campaignId: string, sessionName: string): Promise<Note[]>
  getNote(noteId: string): Promise<Note | null>
  getBacklinks(noteId: string): Promise<Note[]>
  createNote(input: NoteInput, membershipId?: string): Promise<Note>
  updateNote(noteId: string, input: NoteInput, membershipId?: string): Promise<Note | null>
  deleteNote(noteId: string): Promise<boolean>
  resetNotes(inputs: NoteInput[], campaignId?: string): Promise<Note[]>
  getStats(campaignId?: string): Promise<NoteStats>
  getAdminOverview(): Promise<AdminOverview>
  checkHealth(): Promise<void>
  close(): Promise<void>
}

function resolveDatabaseUrl(
  options: CreateNoteStoreOptions,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const configuredDatabaseUrl = options.databaseUrl ?? environment.DATABASE_URL
  const trimmedDatabaseUrl = configuredDatabaseUrl?.trim()
  return trimmedDatabaseUrl && trimmedDatabaseUrl.length > 0
    ? trimmedDatabaseUrl
    : null
}

function requirePostgresDatabaseUrl(options: CreateNoteStoreOptions, databaseUrl = resolveDatabaseUrl(options)) {
  if (!options.postgresPool && !databaseUrl) {
    throw new Error('DATABASE_URL is required unless a postgresPool is provided.')
  }

  return databaseUrl
}

export async function initializeDatabaseOrClose(
  database: Pick<NoteStoreDatabase, 'close'>,
  initialize: () => Promise<void>,
) {
  try {
    await initialize()
  } catch (error) {
    try {
      await database.close()
    } catch (closeError) {
      throw new AggregateError(
        [error, closeError],
        'Failed to initialize the note store database and close it cleanly.',
        { cause: closeError },
      )
    }

    throw error
  }
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
    keycloakSub: row.keycloak_sub,
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
    keycloakSub: row.keycloak_sub,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    campaignMembershipCount: Number(row.membership_count),
    ownedCampaignCount: Number(row.owned_campaign_count),
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

export async function createNoteStore(
  options: CreateNoteStoreOptions = {},
): Promise<NoteStore> {
  const databaseUrl = requirePostgresDatabaseUrl(options)
  const configuredSiteAdminEmails = resolveConfiguredSiteAdminEmails(options)
  const migrationMode = options.migrationMode ?? 'apply'

  let pool: PostgresPoolLike
  let ownedPool: PostgresPoolLike | undefined

  if (options.postgresPool) {
    pool = options.postgresPool
  } else {
    ownedPool = createNoteStorePostgresPool(databaseUrl ?? '')
    pool = ownedPool
  }

  if (migrationMode === 'apply') {
    try {
      await runTenantApiMigrations({ pool })
    } catch (error) {
      if (ownedPool) {
        try {
          await ownedPool.end()
        } catch {
          // Preserve the original failure.
        }
      }
      throw error
    }
  }

  const database = createPostgresDatabase({ pool })

  await initializeDatabaseOrClose(
    {
      async close() {
        if (ownedPool) {
          await ownedPool.end()
        }
      },
    },
    () => initializeNoteStoreDatabase(database, configuredSiteAdminEmails),
  )

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

  const insertDefaultCampaignIfMissing = database.prepare(`
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
    ON CONFLICT (id) DO NOTHING
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
  const checkDatabaseConnection = database.prepare('SELECT 1')

  const selectOwnerAccountById = database.prepare(`
    SELECT
      id,
      email,
      display_name,
      password_hash,
      is_site_admin,
      keycloak_sub,
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
      keycloak_sub,
      created_at,
      updated_at
    FROM owner_accounts
    WHERE LOWER(email) = LOWER(?)
  `)

  const selectOwnerAccountByKeycloakSub = database.prepare(`
    SELECT
      id,
      email,
      display_name,
      password_hash,
      is_site_admin,
      keycloak_sub,
      created_at,
      updated_at
    FROM owner_accounts
    WHERE keycloak_sub = ?
  `)

  const selectAdminAccounts = database.prepare(`
    SELECT
      owner_accounts.id,
      owner_accounts.email,
      owner_accounts.display_name,
      owner_accounts.is_site_admin,
      owner_accounts.keycloak_sub,
      owner_accounts.created_at,
      owner_accounts.updated_at,
      COALESCE(membership_counts.membership_count, 0) AS membership_count,
      COALESCE(owned_campaign_counts.owned_campaign_count, 0) AS owned_campaign_count
    FROM owner_accounts
    LEFT JOIN (
      SELECT
        user_id,
        COUNT(*) AS membership_count
      FROM campaign_memberships
      GROUP BY user_id
    ) AS membership_counts
      ON membership_counts.user_id = owner_accounts.id
    LEFT JOIN (
      SELECT
        user_id,
        COUNT(DISTINCT campaign_id) AS owned_campaign_count
      FROM campaign_memberships
      WHERE role = 'owner'
      GROUP BY user_id
    ) AS owned_campaign_counts
      ON owned_campaign_counts.user_id = owner_accounts.id
    ORDER BY owner_accounts.is_site_admin DESC, owner_accounts.email ASC
  `)

  const insertOwnerAccount = database.prepare(`
    INSERT INTO owner_accounts (
      id,
      email,
      display_name,
      password_hash,
      is_site_admin,
      keycloak_sub,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @email,
      @display_name,
      @password_hash,
      @is_site_admin,
      @keycloak_sub,
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
      owner_accounts.keycloak_sub,
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

  const updateOwnerKeycloakIdentity = database.prepare(`
    UPDATE owner_accounts
    SET
      email = @email,
      display_name = @display_name,
      is_site_admin = @is_site_admin,
      keycloak_sub = @keycloak_sub,
      updated_at = @updated_at
    WHERE id = @id
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

  const ensureDefaultCampaignTransaction = database.transaction(async () => {
    const campaignTimestamp = new Date().toISOString()
    await insertDefaultCampaignIfMissing.run({
      id: defaultCampaign.id,
      name: defaultCampaign.name,
      tagline: defaultCampaign.tagline,
      system: defaultCampaign.system,
      setting: defaultCampaign.setting,
      next_session: defaultCampaign.nextSession,
      archived_at: null,
      created_at: campaignTimestamp,
      updated_at: campaignTimestamp,
    })

    const ownerMembershipCount = (await countOwnerMemberships.get(defaultCampaign.id)) as {
      count: number
    }

    if (Number(ownerMembershipCount.count) === 0) {
      const timestamp = new Date().toISOString()
      await insertMembership.run({
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
    async (input: OwnerRegistrationInput) => {
      const normalizedEmail = normalizeEmailAddress(input.email)
      const existing = (await selectOwnerAccountByEmail.get(normalizedEmail)) as
        | OwnerAccountRow
        | undefined

      if (existing) {
        return null
      }

      const timestamp = new Date().toISOString()
      const owner: OwnerAccount = {
        id: randomUUID(),
        email: normalizedEmail,
        displayName: input.displayName,
        isSiteAdmin: configuredSiteAdminEmails.has(normalizedEmail),
        keycloakSub: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      }

      try {
        await insertOwnerAccount.run({
          id: owner.id,
          email: owner.email,
          display_name: owner.displayName,
          password_hash: createPasswordHash(input.password),
          is_site_admin: owner.isSiteAdmin ? 1 : 0,
          keycloak_sub: owner.keycloakSub,
          created_at: owner.createdAt,
          updated_at: owner.updatedAt,
        })
      } catch (error) {
        if (isOwnerEmailUniqueConstraintError(error)) {
          return null
        }

        throw error
      }

      await updateUnclaimedDefaultMembership.run({
        user_id: owner.id,
        display_name: owner.displayName,
        updated_at: timestamp,
        campaign_id: defaultCampaign.id,
      })

      return owner
    },
  )

  const resolveOwnerEmailForKeycloakIdentity = async (
    owner: OwnerAccountRow,
    normalizedEmail: string,
  ) => {
    const currentEmail = normalizeEmailAddress(owner.email)

    if (currentEmail === normalizedEmail) {
      return currentEmail
    }

    const existing = (await selectOwnerAccountByEmail.get(normalizedEmail)) as
      | OwnerAccountRow
      | undefined

    if (existing && existing.id !== owner.id) {
      return currentEmail
    }

    return normalizedEmail
  }

  const findOrCreateOwnerByKeycloakIdentityTransaction = database.transaction(
    async (identity: KeycloakOwnerIdentity) => {
      const normalizedEmail = normalizeEmailAddress(identity.email)
      const byKeycloakSub = (await selectOwnerAccountByKeycloakSub.get(
        identity.keycloakSub,
      )) as OwnerAccountRow | undefined

      if (byKeycloakSub) {
        const updatedAt = new Date().toISOString()
        const persistedEmail = await resolveOwnerEmailForKeycloakIdentity(
          byKeycloakSub,
          normalizedEmail,
        )
        const updatedOwner = {
          ...mapOwnerAccountRow(byKeycloakSub),
          email: persistedEmail,
          displayName: identity.displayName,
          isSiteAdmin: configuredSiteAdminEmails.has(persistedEmail),
          updatedAt,
        }

        await updateOwnerKeycloakIdentity.run({
          id: updatedOwner.id,
          email: updatedOwner.email,
          display_name: updatedOwner.displayName,
          is_site_admin: updatedOwner.isSiteAdmin ? 1 : 0,
          keycloak_sub: identity.keycloakSub,
          updated_at: updatedOwner.updatedAt,
        })

        return updatedOwner
      }

      const byEmail = (await selectOwnerAccountByEmail.get(normalizedEmail)) as
        | OwnerAccountRow
        | undefined

      if (byEmail) {
        if (
          byEmail.keycloak_sub !== null &&
          byEmail.keycloak_sub !== identity.keycloakSub
        ) {
          throw new OwnerKeycloakLinkConflictError(byEmail.id)
        }

        const updatedAt = new Date().toISOString()
        const updatedOwner = {
          ...mapOwnerAccountRow(byEmail),
          displayName: identity.displayName,
          isSiteAdmin: configuredSiteAdminEmails.has(normalizedEmail),
          keycloakSub: identity.keycloakSub,
          updatedAt,
        }

        await updateOwnerKeycloakIdentity.run({
          id: updatedOwner.id,
          email: normalizedEmail,
          display_name: updatedOwner.displayName,
          is_site_admin: updatedOwner.isSiteAdmin ? 1 : 0,
          keycloak_sub: updatedOwner.keycloakSub,
          updated_at: updatedOwner.updatedAt,
        })

        return updatedOwner
      }

      const createdOwner = await createOwnerAccountTransaction({
        displayName: identity.displayName,
        email: normalizedEmail,
        password: randomBytes(32).toString('hex'),
      })

      if (!createdOwner) {
        throw new Error(`Owner account "${normalizedEmail}" could not be created.`)
      }

      const updatedAt = new Date().toISOString()
      await updateOwnerKeycloakIdentity.run({
        id: createdOwner.id,
        email: normalizedEmail,
        display_name: createdOwner.displayName,
        is_site_admin: createdOwner.isSiteAdmin ? 1 : 0,
        keycloak_sub: identity.keycloakSub,
        updated_at: updatedAt,
      })

      return {
        ...createdOwner,
        keycloakSub: identity.keycloakSub,
        updatedAt,
      }
    },
  )

  const createCampaignTransaction = database.transaction(
    async (input: CampaignInput, owner: OwnerAccount) => {
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

      await insertCampaign.run({
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

      await insertMembership.run({
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
    async (campaignId: string, input: CampaignInput, ownerUserId?: string) => {
      const existing = (await selectCampaignById.get(campaignId)) as CampaignRow | undefined

      if (!existing || existing.archived_at !== null) {
        return null
      }

      if (
        ownerUserId &&
        !(await selectOwnerMembershipByCampaignAndUser.get(campaignId, ownerUserId))
      ) {
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

      await updateCampaignStatement.run({
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
    async (campaignId: string, input: CampaignShareLinkInput, ownerUserId: string) => {
      const campaign = (await selectCampaignById.get(campaignId)) as CampaignRow | undefined

      if (!campaign || campaign.archived_at !== null) {
        return null
      }

      if (!(await selectOwnerMembershipByCampaignAndUser.get(campaignId, ownerUserId))) {
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

      await insertShareLink.run({
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
    async (campaignId: string, displayName: string) => {
      const campaign = (await selectCampaignById.get(campaignId)) as CampaignRow | undefined

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

      await insertMembership.run({
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
    async (membershipId: string, ownerUserId: string): Promise<ClaimGuestMembershipResult> => {
      const membershipRow = (await selectMembershipById.get(membershipId)) as
        | CampaignMembershipRow
        | undefined

      if (!membershipRow || membershipRow.role !== 'guest') {
        return { status: 'not-found' }
      }

      const membership = mapMembershipRow(membershipRow)

      if (membership.userId !== null) {
        return { status: 'already-linked', membership }
      }

      const existingMembership = (await selectMembershipByCampaignAndUser.get(
        membership.campaignId,
        ownerUserId,
      )) as CampaignMembershipRow | undefined

      if (existingMembership) {
        return {
          status: 'account-already-member',
          membership: mapMembershipRow(existingMembership),
        }
      }

      const updatedAt = new Date().toISOString()
      const guestToken = createSessionToken()
      const guestTokenId = hashSessionToken(guestToken)

      await claimGuestMembershipStatement.run({
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

  const previewMembershipConsolidation = async (
    campaignId: string,
    sourceMembershipId: string,
    targetMembershipId: string,
    ownerUserId: string,
  ): Promise<MembershipConsolidationPreviewResult> => {
    await requireCampaign(campaignId)

    if (!(await selectOwnerMembershipByCampaignAndUser.get(campaignId, ownerUserId))) {
      return { status: 'forbidden' }
    }

    if (sourceMembershipId === targetMembershipId) {
      return { status: 'same-membership' }
    }

    const sourceMembershipRow = (await selectMembershipByCampaignAndId.get(
      campaignId,
      sourceMembershipId,
    )) as CampaignMembershipRow | undefined

    if (!sourceMembershipRow) {
      return { status: 'source-not-found' }
    }

    const targetMembershipRow = (await selectMembershipByCampaignAndId.get(
      campaignId,
      targetMembershipId,
    )) as CampaignMembershipRow | undefined

    if (!targetMembershipRow) {
      return { status: 'target-not-found' }
    }

    const sourceMembership = mapMembershipRow(sourceMembershipRow)
    const targetMembership = mapMembershipRow(targetMembershipRow)
    const counts = (await selectMembershipConsolidationCounts.get({
      campaign_id: campaignId,
      source_membership_id: sourceMembership.id,
    })) as MembershipConsolidationCountsRow

    return {
      status: 'ready',
      consolidation: {
        effect: 'note-attribution-only',
        sourceMembership,
        targetMembership,
        noteChanges: {
          authoredNoteCount: Number(counts.authored_note_count),
          editedNoteCount: Number(counts.edited_note_count),
          authoredAndEditedNoteCount: Number(counts.authored_and_edited_note_count),
          affectedNoteCount: Number(counts.affected_note_count),
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
    async (
      campaignId: string,
      sourceMembershipId: string,
      targetMembershipId: string,
      ownerUserId: string,
    ): Promise<MembershipConsolidationResult> => {
      const preview = await previewMembershipConsolidation(
        campaignId,
        sourceMembershipId,
        targetMembershipId,
        ownerUserId,
      )

      if (preview.status !== 'ready') {
        return preview
      }

      await reassignMembershipAttributionStatement.run({
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

  const listCampaigns = async () =>
    ((await selectAllCampaigns.all()) as CampaignRow[]).map((row) => mapCampaignRow(row))

  const listUserCampaigns = async (userId: string) =>
    ((await selectUserCampaigns.all(userId)) as CampaignRow[]).map((row) =>
      mapCampaignRow(row),
    )

  const listOwnedCampaigns = async (ownerUserId: string) =>
    ((await selectOwnedCampaigns.all(ownerUserId)) as CampaignRow[]).map((row) =>
      mapCampaignRow(row),
    )

  const getCampaign = async (campaignId: string) => {
    const row = (await selectCampaignById.get(campaignId)) as CampaignRow | undefined
    return row ? mapCampaignRow(row) : null
  }

  const getPrimaryCampaign = async (ownerUserId?: string) => {
    if (ownerUserId) {
      const row = (await selectPrimaryOwnedCampaign.get(ownerUserId)) as
        | CampaignRow
        | undefined

      if (!row) {
        throw new Error('No owned campaigns are available.')
      }

      return mapCampaignRow(row)
    }

    const campaigns = await listCampaigns()
    const primaryCampaign = campaigns[0]

    if (!primaryCampaign) {
      throw new Error('No active campaigns are available.')
    }

    return primaryCampaign
  }

  const getPrimaryCampaignForUser = async (userId: string) => {
    const row = (await selectPrimaryUserCampaign.get(userId)) as CampaignRow | undefined

    if (!row) {
      throw new Error('No campaigns are available.')
    }

    return mapCampaignRow(row)
  }

  const requireCampaign = async (campaignId?: string | null) => {
    if (!campaignId) {
      return getPrimaryCampaign()
    }

    const campaign = await getCampaign(campaignId)

    if (!campaign || campaign.archivedAt !== null) {
      throw new Error(`Campaign "${campaignId}" was not found.`)
    }

    return campaign
  }

  const validateReferenceTarget = async (targetNoteId: string, campaignId: string) => {
    const targetNote = (await selectNoteIdentityById.get(targetNoteId)) as
      | NoteIdentityRow
      | undefined

    if (!targetNote) {
      throw new Error(`Referenced note "${targetNoteId}" was not found.`)
    }

    if (targetNote.campaign_id !== campaignId) {
      throw new Error(`Referenced note "${targetNoteId}" must be in the same campaign.`)
    }
  }

  const buildPendingReferences = async (
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
        await validateReferenceTarget(targetNoteId, campaignId)
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
        await validateReferenceTarget(reference.targetNoteId, campaignId)
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

  const replaceNoteReferences = async (
    noteId: string,
    campaignId: string,
    body: string,
    explicitLinkedNoteIds: string[],
    timestamp: string,
    options?: { allowInvalidReferences: boolean },
  ) => {
    const references = await buildPendingReferences(
      body,
      explicitLinkedNoteIds,
      campaignId,
      options,
    )
    const persistedReferences: NoteReference[] = []

    await deleteNoteReferencesBySourceNoteId.run(noteId)

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

      await insertNoteReference.run({
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
    async (options: { allowInvalidReferences: boolean } = { allowInvalidReferences: true }) => {
      const noteRows = (await selectStoredNotesForReferenceSync.all()) as StoredNoteForReferenceSyncRow[]

      for (const row of noteRows) {
        const explicitLinkedNoteIds = row.linked_notes_json
          ? (JSON.parse(row.linked_notes_json) as string[])
          : []

        await replaceNoteReferences(
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

  const listNotes = async (campaignId?: string) => {
    const campaign = await requireCampaign(campaignId)
    const notes = ((await selectNotesByCampaignId.all(campaign.id)) as NoteRow[]).map((row) =>
      mapNoteRow(row),
    )
    const referencesBySource = groupReferencesBySource(
      (await selectNoteReferencesByCampaignId.all(campaign.id)) as NoteReferenceRow[],
    )

    return notes.map((note) => composeNote(note, referencesBySource.get(note.id) ?? []))
  }

  const insertPersistedNote = async (note: NoteRecord) => {
    await insertNote.run({
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
    async (inputs: NoteInput[], campaignId?: string) => {
      const campaign = await requireCampaign(campaignId)
      await deleteNotesByCampaignIdStatement.run(campaign.id)

      const baseTimestamp = Date.now()
      const notes: NoteRecord[] = []

      for (const [index, input] of inputs.entries()) {
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

        await insertPersistedNote(note)
        notes.push(note)
      }

      for (const note of notes) {
        await replaceNoteReferences(
          note.id,
          note.campaignId,
          note.body,
          note.explicitLinkedNoteIds,
          note.updatedAt,
          { allowInvalidReferences: false },
        )
      }

      return Promise.all(
        notes.map(async (note) =>
          composeNote(
            note,
            ((await selectNoteReferencesBySourceNoteId.all(note.id)) as NoteReferenceRow[]).map(
              mapNoteReferenceRow,
            ),
          ),
        ),
      )
    },
  )

  const createNoteTransaction = database.transaction(async (input: NoteInput, membershipId?: string) => {
    const campaign = await requireCampaign(input.campaignId)
    const timestamp = new Date().toISOString()

    const membership = membershipId
      ? ((await selectMembershipById.get(membershipId)) as CampaignMembershipRow | undefined)
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

    await insertPersistedNote(note)
    const references = await replaceNoteReferences(
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
    async (noteId: string, input: NoteInput, membershipId?: string) => {
      const existingRow = (await selectNoteById.get(noteId)) as NoteRow | undefined

      if (!existingRow) {
        return null
      }

      const existing = mapNoteRow(existingRow)
      const membership = membershipId
        ? ((await selectMembershipById.get(membershipId)) as CampaignMembershipRow | undefined)
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

      await updateNoteStatement.run({
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

      const references = await replaceNoteReferences(
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

  await ensureDefaultCampaignTransaction()
  await syncNoteReferencesTransaction()

  const noteStore: NoteStore = {
    listCampaigns,
    listUserCampaigns,
    listOwnedCampaigns,
    getPrimaryCampaignForUser,
    getPrimaryCampaign,
    getCampaign,
    async createCampaign(input, owner) {
      return createCampaignTransaction(input, owner)
    },
    async updateCampaign(campaignId, input, ownerUserId) {
      return updateCampaignTransaction(campaignId, input, ownerUserId)
    },
    async listCampaignMemberships(campaignId) {
      await requireCampaign(campaignId)
      return (
        (await selectMembershipsByCampaignId.all(campaignId)) as CampaignMembershipRow[]
      ).map((row) => mapMembershipRow(row))
    },
    async listCampaignShareLinks(campaignId) {
      await requireCampaign(campaignId)
      return (
        (await selectActiveShareLinksByCampaignId.all(campaignId, new Date().toISOString())) as
          CampaignShareLinkRow[]
      ).map((row) => mapCampaignShareLinkRow(row))
    },
    async userHasCampaignAccess(userId, campaignId) {
      return Boolean(await selectMembershipByCampaignAndUser.get(campaignId, userId))
    },
    async userOwnsCampaign(ownerUserId, campaignId) {
      return Boolean(
        await selectOwnerMembershipByCampaignAndUser.get(campaignId, ownerUserId),
      )
    },
    async createOwnerAccount(input) {
      return createOwnerAccountTransaction(input)
    },
    async authenticateOwner(email, password) {
      const normalizedEmail = normalizeEmailAddress(email)
      const row = (await selectOwnerAccountByEmail.get(normalizedEmail)) as
        | OwnerAccountRow
        | undefined

      if (!row || !verifyPassword(password, row.password_hash)) {
        return null
      }

      return mapOwnerAccountRow(row)
    },
    async getOwnerBySessionToken(token) {
      await deleteExpiredOwnerSessions.run(new Date().toISOString())
      const row = (await selectOwnerBySessionToken.get(
        hashSessionToken(token),
        new Date().toISOString(),
      )) as OwnerAccountRow | undefined

      return row ? mapOwnerAccountRow(row) : null
    },
    async findOrCreateOwnerByKeycloakIdentity(identity) {
      return findOrCreateOwnerByKeycloakIdentityTransaction(identity)
    },
    async listOwnerAccounts() {
      const rows = (await selectAdminAccounts.all()) as AdminAccountSummaryRow[]
      return rows.map(mapAdminAccountSummaryRow)
    },
    async createOwnerSession(ownerUserId) {
      const owner = (await selectOwnerAccountById.get(ownerUserId)) as
        | OwnerAccountRow
        | undefined

      if (!owner) {
        throw new Error(`Owner "${ownerUserId}" was not found.`)
      }

      const token = createSessionToken()
      const createdAt = new Date().toISOString()
      const expiresAt = new Date(Date.now() + sessionTtlMs).toISOString()

      await insertOwnerSession.run({
        id: randomUUID(),
        owner_user_id: owner.id,
        token_hash: hashSessionToken(token),
        created_at: createdAt,
        expires_at: expiresAt,
      })

      return token
    },
    async deleteOwnerSession(token) {
      await deleteOwnerSessionByTokenHash.run(hashSessionToken(token))
    },
    async createCampaignShareLink(campaignId, input, ownerUserId) {
      return createCampaignShareLinkTransaction(campaignId, input, ownerUserId)
    },
    async revokeCampaignShareLink(campaignId, shareLinkId, ownerUserId) {
      if (!(await selectOwnerMembershipByCampaignAndUser.get(campaignId, ownerUserId))) {
        return false
      }

      const result = await revokeShareLinkStatement.run({
        id: shareLinkId,
        campaign_id: campaignId,
        revoked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })

      return result.changes > 0
    },
    async getCampaignShareLinkReveal(campaignId, shareLinkId, ownerUserId) {
      if (!(await selectOwnerMembershipByCampaignAndUser.get(campaignId, ownerUserId))) {
        return null
      }

      const row = (await selectShareLinkRevealById.get(
        shareLinkId,
        campaignId,
        new Date().toISOString(),
      )) as Pick<CampaignShareLinkRow, 'token_plaintext'> | undefined

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
    async getCampaignShareLinkByToken(token) {
      const row = (await selectActiveShareLinkByTokenHash.get(
        hashSessionToken(token),
        new Date().toISOString(),
      )) as CampaignShareLinkRow | undefined

      return row ? mapCampaignShareLinkRow(row) : null
    },
    async createGuestMembership(campaignId, displayName) {
      return createGuestMembershipTransaction(campaignId, displayName)
    },
    async getGuestMembershipByToken(token) {
      const row = (await selectGuestMembershipByTokenHash.get(
        hashSessionToken(token),
      )) as CampaignMembershipRow | undefined

      return row ? mapMembershipRow(row) : null
    },
    async claimGuestMembership(membershipId, ownerUserId) {
      return claimGuestMembershipTransaction(membershipId, ownerUserId)
    },
    async previewMembershipConsolidation(
      campaignId,
      sourceMembershipId,
      targetMembershipId,
      ownerUserId,
    ) {
      return previewMembershipConsolidation(
        campaignId,
        sourceMembershipId,
        targetMembershipId,
        ownerUserId,
      )
    },
    async consolidateMemberships(campaignId, sourceMembershipId, targetMembershipId, ownerUserId) {
      return consolidateMembershipsTransaction(
        campaignId,
        sourceMembershipId,
        targetMembershipId,
        ownerUserId,
      )
    },
    async getUserMembershipForCampaign(userId, campaignId) {
      const row = (await selectMembershipByCampaignAndUser.get(
        campaignId,
        userId,
      )) as CampaignMembershipRow | undefined

      return row ? mapMembershipRow(row) : null
    },
    async getOwnerMembershipForCampaign(ownerUserId, campaignId) {
      const row = (await selectOwnerMembershipByCampaignAndUser.get(
        campaignId,
        ownerUserId,
      )) as CampaignMembershipRow | undefined

      return row ? mapMembershipRow(row) : null
    },
    listNotes,
    async listSessionNames(campaignId) {
      const notes = await listNotes(campaignId)
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
    async listRecentNotes(limit, campaignId) {
      return (await listNotes(campaignId)).slice(0, limit)
    },
    async getSessionNotes(campaignId, sessionName) {
      const rows = (await selectNotesBySessionName.all(
        campaignId,
        sessionName,
      )) as NoteRow[]
      const referencesBySource = groupReferencesBySource(
        (await selectNoteReferencesByCampaignId.all(campaignId)) as NoteReferenceRow[],
      )

      return rows.map((row) => {
        const note = mapNoteRow(row)
        return composeNote(note, referencesBySource.get(note.id) ?? [])
      })
    },
    async getNote(noteId) {
      const row = (await selectNoteById.get(noteId)) as NoteRow | undefined
      if (!row) {
        return null
      }

      const note = mapNoteRow(row)
      const references = (
        (await selectNoteReferencesBySourceNoteId.all(noteId)) as NoteReferenceRow[]
      ).map(mapNoteReferenceRow)

      return composeNote(note, references)
    },
    async getBacklinks(noteId) {
      const targetNote = await noteStore.getNote(noteId)
      if (!targetNote) {
        return []
      }
      const allNotes = await listNotes(targetNote.campaignId)
      return allNotes.filter((note) => note.linkedNoteIds.includes(noteId))
    },
    async createNote(input, membershipId) {
      return createNoteTransaction(input, membershipId)
    },
    async updateNote(noteId, input, membershipId) {
      return updateNoteTransaction(noteId, input, membershipId)
    },
    async deleteNote(noteId) {
      const result = await deleteNoteStatement.run(noteId)
      return result.changes > 0
    },
    async resetNotes(inputs, campaignId) {
      return resetNotesTransaction(inputs, campaignId)
    },
    async getStats(campaignId) {
      const notes = await listNotes(campaignId)

      return {
        totalNotes: notes.length,
        draftNotes: notes.filter((note) => note.status === 'draft').length,
        activeNotes: notes.filter((note) => note.status === 'active').length,
        archivedNotes: notes.filter((note) => note.status === 'archived').length,
        sessionLinkedNotes: notes.filter((note) => note.sessionName !== null).length,
      }
    },
    async getAdminOverview() {
      const counts = (await selectAdminOverviewCounts.get()) as {
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
          total: Number(counts.owner_account_count),
          siteAdmins: Number(counts.site_admin_count),
        },
        campaigns: {
          total: Number(counts.campaign_count),
          archived: Number(counts.archived_campaign_count),
        },
        memberships: {
          total: Number(counts.membership_count),
          linkedAccounts: Number(counts.linked_membership_count),
          guests: Number(counts.guest_membership_count),
        },
        shareLinks: {
          active: Number(counts.active_share_link_count),
          revoked: Number(counts.revoked_share_link_count),
        },
        notes: {
          total: Number(counts.note_count),
          draft: Number(counts.draft_note_count),
          active: Number(counts.active_note_count),
          archived: Number(counts.archived_note_count),
        },
      }
    },
    async checkHealth() {
      await checkDatabaseConnection.get()
    },
    close() {
      const tasks: Array<Promise<unknown>> = [database.close()]
      if (ownedPool) {
        tasks.push(ownedPool.end())
      }
      return Promise.all(tasks).then(() => undefined)
    },
  }

  return noteStore
}

export async function createRuntimeNoteStore(
  options: RuntimeNoteStoreOptions = {},
): Promise<NoteStore> {
  return createNoteStore({
    ...options,
    migrationMode: 'verify',
  })
}

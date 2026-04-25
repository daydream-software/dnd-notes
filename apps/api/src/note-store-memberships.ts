import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { NoteStoreDatabase } from './note-store-database.js'
import type {
  CampaignMembership,
  CampaignMembershipRole,
  MembershipConsolidationSummary,
} from './types.js'
import type { InsertMembershipRowInput } from './note-store-campaigns.js'

export interface CampaignMembershipRow {
  id: string
  campaign_id: string
  role: CampaignMembership['role']
  display_name: string
  user_id: string | null
  guest_token_id: string | null
  created_at: string
  updated_at: string
}

interface MembershipConsolidationCountsRow {
  authored_note_count: number
  edited_note_count: number
  authored_and_edited_note_count: number
  affected_note_count: number
}

export type MembershipConsolidationPreview = Omit<
  MembershipConsolidationSummary,
  'applied'
>

export type MembershipConsolidationPreviewResult =
  | { status: 'ready'; consolidation: MembershipConsolidationPreview }
  | { status: 'source-not-found' }
  | { status: 'target-not-found' }
  | { status: 'same-membership' }
  | { status: 'forbidden' }

export type MembershipConsolidationResult =
  | { status: 'ready'; consolidation: MembershipConsolidationSummary }
  | { status: 'source-not-found' }
  | { status: 'target-not-found' }
  | { status: 'same-membership' }
  | { status: 'forbidden' }

export type ClaimGuestMembershipResult =
  | { status: 'claimed'; membership: CampaignMembership; guestToken: string }
  | { status: 'already-linked'; membership: CampaignMembership }
  | { status: 'account-already-member'; membership: CampaignMembership }
  | { status: 'not-found' }

export function mapMembershipRow(row: CampaignMembershipRow): CampaignMembership {
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

function createMembershipGuestToken() {
  return randomBytes(24).toString('hex')
}

function hashMembershipGuestToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export function prepareMembershipStatements(database: NoteStoreDatabase) {
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

  const countOwnerMembershipsStatement = database.prepare(`
    SELECT COUNT(*) AS count
    FROM campaign_memberships
    WHERE campaign_id = ? AND role = 'owner'
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

  return {
    selectMembershipsByCampaignId,
    selectOwnerMembershipByCampaignAndUser,
    selectMembershipByCampaignAndUser,
    selectGuestMembershipByTokenHash,
    selectMembershipById,
    selectMembershipByCampaignAndId,
    insertMembership,
    claimGuestMembershipStatement,
    countOwnerMembershipsStatement,
    selectMembershipConsolidationCounts,
    reassignMembershipAttributionStatement,
  }
}

export type MembershipStatements = ReturnType<typeof prepareMembershipStatements>

export function createMembershipDomain(deps: {
  database: NoteStoreDatabase
  statements: MembershipStatements
  requireCampaign: (campaignId: string) => Promise<unknown>
  isCampaignActive: (campaignId: string) => Promise<boolean>
}) {
  const {
    database,
    statements: {
      selectMembershipsByCampaignId,
      selectOwnerMembershipByCampaignAndUser,
      selectMembershipByCampaignAndUser,
      selectGuestMembershipByTokenHash,
      selectMembershipById,
      selectMembershipByCampaignAndId,
      insertMembership,
      claimGuestMembershipStatement,
      countOwnerMembershipsStatement,
      selectMembershipConsolidationCounts,
      reassignMembershipAttributionStatement,
    },
    requireCampaign,
    isCampaignActive,
  } = deps

  const insertMembershipRow = async (input: InsertMembershipRowInput) => {
    await insertMembership.run(input)
  }

  const countOwnerMemberships = async (campaignId: string) => {
    const row = (await countOwnerMembershipsStatement.get(campaignId)) as {
      count: number
    }
    return Number(row.count)
  }

  const listCampaignMemberships = async (campaignId: string) => {
    await requireCampaign(campaignId)
    return (
      (await selectMembershipsByCampaignId.all(
        campaignId,
      )) as CampaignMembershipRow[]
    ).map((row) => mapMembershipRow(row))
  }

  const userHasCampaignAccess = async (userId: string, campaignId: string) =>
    Boolean(await selectMembershipByCampaignAndUser.get(campaignId, userId))

  const ownsCampaign = async (campaignId: string, ownerUserId: string) =>
    Boolean(
      await selectOwnerMembershipByCampaignAndUser.get(campaignId, ownerUserId),
    )

  const userOwnsCampaign = async (ownerUserId: string, campaignId: string) =>
    ownsCampaign(campaignId, ownerUserId)

  const getUserMembershipForCampaign = async (
    userId: string,
    campaignId: string,
  ) => {
    const row = (await selectMembershipByCampaignAndUser.get(
      campaignId,
      userId,
    )) as CampaignMembershipRow | undefined
    return row ? mapMembershipRow(row) : null
  }

  const getOwnerMembershipForCampaign = async (
    ownerUserId: string,
    campaignId: string,
  ) => {
    const row = (await selectOwnerMembershipByCampaignAndUser.get(
      campaignId,
      ownerUserId,
    )) as CampaignMembershipRow | undefined
    return row ? mapMembershipRow(row) : null
  }

  const findMembershipAttribution = async (membershipId: string) => {
    const row = (await selectMembershipById.get(membershipId)) as
      | CampaignMembershipRow
      | undefined
    if (!row) {
      return null
    }
    return {
      membershipId: row.id,
      displayName: row.display_name,
      role: row.role as CampaignMembershipRole,
    }
  }

  const createGuestMembershipTransaction = database.transaction(
    async (campaignId: string, displayName: string) => {
      if (!(await isCampaignActive(campaignId))) {
        throw new Error(`Campaign "${campaignId}" was not found.`)
      }

      const guestToken = createMembershipGuestToken()
      const timestamp = new Date().toISOString()
      const membership: CampaignMembership = {
        id: randomUUID(),
        campaignId,
        role: 'guest',
        displayName,
        userId: null,
        guestTokenId: hashMembershipGuestToken(guestToken),
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

  const getGuestMembershipByToken = async (token: string) => {
    const row = (await selectGuestMembershipByTokenHash.get(
      hashMembershipGuestToken(token),
    )) as CampaignMembershipRow | undefined

    return row ? mapMembershipRow(row) : null
  }

  const claimGuestMembershipTransaction = database.transaction(
    async (
      membershipId: string,
      ownerUserId: string,
    ): Promise<ClaimGuestMembershipResult> => {
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
      const guestToken = createMembershipGuestToken()
      const guestTokenId = hashMembershipGuestToken(guestToken)

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

    if (!(await ownsCampaign(campaignId, ownerUserId))) {
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
          authoredAndEditedNoteCount: Number(
            counts.authored_and_edited_note_count,
          ),
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

  return {
    insertMembershipRow,
    countOwnerMemberships,
    listCampaignMemberships,
    userHasCampaignAccess,
    userOwnsCampaign,
    ownsCampaign,
    getUserMembershipForCampaign,
    getOwnerMembershipForCampaign,
    findMembershipAttribution,
    createGuestMembership: createGuestMembershipTransaction,
    getGuestMembershipByToken,
    claimGuestMembership: claimGuestMembershipTransaction,
    previewMembershipConsolidation,
    consolidateMemberships: consolidateMembershipsTransaction,
  }
}

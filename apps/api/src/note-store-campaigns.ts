import { randomUUID } from 'node:crypto'
import {
  defaultCampaign,
  defaultCampaignId,
  defaultOwnerDisplayName,
} from './campaign.js'
import type { NoteStoreDatabase } from './note-store-database.js'
import type {
  CampaignInput,
  CampaignSummary,
  OwnerAccount,
} from './types.js'

export interface CampaignRow {
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

export function mapCampaignRow(row: CampaignRow): CampaignSummary {
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

export function prepareCampaignStatements(database: NoteStoreDatabase) {
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

  return {
    selectCampaignById,
    selectAllCampaigns,
    selectUserCampaigns,
    selectOwnedCampaigns,
    selectPrimaryUserCampaign,
    selectPrimaryOwnedCampaign,
    insertCampaign,
    insertDefaultCampaignIfMissing,
    updateCampaignStatement,
  }
}

export type CampaignStatements = ReturnType<typeof prepareCampaignStatements>

export interface InsertMembershipRowInput {
  id: string
  campaign_id: string
  role: 'owner' | 'guest'
  display_name: string
  user_id: string | null
  guest_token_id: string | null
  created_at: string
  updated_at: string
}

export function createCampaignDomain(deps: {
  database: NoteStoreDatabase
  statements: CampaignStatements
  insertMembership: (input: InsertMembershipRowInput) => Promise<unknown>
  countOwnerMemberships: (campaignId: string) => Promise<number>
  ownsCampaign: (campaignId: string, ownerUserId: string) => Promise<boolean>
}) {
  const {
    database,
    statements: {
      selectCampaignById,
      selectAllCampaigns,
      selectUserCampaigns,
      selectOwnedCampaigns,
      selectPrimaryUserCampaign,
      selectPrimaryOwnedCampaign,
      insertCampaign,
      insertDefaultCampaignIfMissing,
      updateCampaignStatement,
    },
    insertMembership,
    countOwnerMemberships,
    ownsCampaign,
  } = deps

  const listCampaigns = async () =>
    ((await selectAllCampaigns.all()) as CampaignRow[]).map((row) =>
      mapCampaignRow(row),
    )

  const listUserCampaigns = async (userId: string) =>
    ((await selectUserCampaigns.all(userId)) as CampaignRow[]).map((row) =>
      mapCampaignRow(row),
    )

  const listOwnedCampaigns = async (ownerUserId: string) =>
    ((await selectOwnedCampaigns.all(ownerUserId)) as CampaignRow[]).map(
      (row) => mapCampaignRow(row),
    )

  const getCampaign = async (campaignId: string) => {
    const row = (await selectCampaignById.get(campaignId)) as
      | CampaignRow
      | undefined
    return row ? mapCampaignRow(row) : null
  }

  const getPrimaryCampaign = async (
    ownerUserId?: string,
  ): Promise<CampaignSummary> => {
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

  const getPrimaryCampaignForUser = async (
    userId: string,
  ): Promise<CampaignSummary> => {
    const row = (await selectPrimaryUserCampaign.get(userId)) as
      | CampaignRow
      | undefined

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

  const isCampaignActive = async (campaignId: string) => {
    const campaign = await getCampaign(campaignId)
    return campaign !== null && campaign.archivedAt === null
  }

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

      await insertMembership({
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
    async (
      campaignId: string,
      input: CampaignInput,
      ownerUserId?: string,
    ) => {
      const existing = (await selectCampaignById.get(campaignId)) as
        | CampaignRow
        | undefined

      if (!existing || existing.archived_at !== null) {
        return null
      }

      if (ownerUserId && !(await ownsCampaign(campaignId, ownerUserId))) {
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

    if ((await countOwnerMemberships(defaultCampaign.id)) === 0) {
      const timestamp = new Date().toISOString()
      await insertMembership({
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

  return {
    listCampaigns,
    listUserCampaigns,
    listOwnedCampaigns,
    getCampaign,
    getPrimaryCampaign,
    getPrimaryCampaignForUser,
    requireCampaign,
    isCampaignActive,
    createCampaign: createCampaignTransaction,
    updateCampaign: updateCampaignTransaction,
    ensureDefaultCampaign: ensureDefaultCampaignTransaction,
  }
}

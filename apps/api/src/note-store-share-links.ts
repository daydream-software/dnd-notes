import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { NoteStoreDatabase } from './note-store-database.js'
import type {
  CampaignShareLink,
  CampaignShareLinkInput,
} from './types.js'

export interface CampaignShareLinkRow {
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

export type CampaignShareLinkRevealResult =
  | { status: 'available'; token: string }
  | { status: 'legacy-unavailable' }

export function mapCampaignShareLinkRow(
  row: CampaignShareLinkRow,
): CampaignShareLink {
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

function createShareToken() {
  return randomBytes(24).toString('hex')
}

function hashShareToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export function prepareShareLinkStatements(database: NoteStoreDatabase) {
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

  return {
    selectActiveShareLinksByCampaignId,
    selectActiveShareLinkByTokenHash,
    selectShareLinkRevealById,
    insertShareLink,
    revokeShareLinkStatement,
  }
}

export type ShareLinkStatements = ReturnType<typeof prepareShareLinkStatements>

export function createShareLinkDomain(deps: {
  database: NoteStoreDatabase
  statements: ShareLinkStatements
  isCampaignActive: (campaignId: string) => Promise<boolean>
  ownsCampaign: (campaignId: string, ownerUserId: string) => Promise<boolean>
  requireCampaign: (campaignId: string) => Promise<unknown>
}) {
  const {
    database,
    statements: {
      selectActiveShareLinksByCampaignId,
      selectActiveShareLinkByTokenHash,
      selectShareLinkRevealById,
      insertShareLink,
      revokeShareLinkStatement,
    },
    isCampaignActive,
    ownsCampaign,
    requireCampaign,
  } = deps

  const createCampaignShareLinkTransaction = database.transaction(
    async (
      campaignId: string,
      input: CampaignShareLinkInput,
      ownerUserId: string,
    ) => {
      if (!(await isCampaignActive(campaignId))) {
        return null
      }

      if (!(await ownsCampaign(campaignId, ownerUserId))) {
        return null
      }

      const token = createShareToken()
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
        token_hash: hashShareToken(token),
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

  const listCampaignShareLinks = async (campaignId: string) => {
    await requireCampaign(campaignId)
    return (
      (await selectActiveShareLinksByCampaignId.all(
        campaignId,
        new Date().toISOString(),
      )) as CampaignShareLinkRow[]
    ).map((row) => mapCampaignShareLinkRow(row))
  }

  const revokeCampaignShareLink = async (
    campaignId: string,
    shareLinkId: string,
    ownerUserId: string,
  ) => {
    if (!(await ownsCampaign(campaignId, ownerUserId))) {
      return false
    }

    const result = await revokeShareLinkStatement.run({
      id: shareLinkId,
      campaign_id: campaignId,
      revoked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    return result.changes > 0
  }

  const getCampaignShareLinkReveal = async (
    campaignId: string,
    shareLinkId: string,
    ownerUserId: string,
  ): Promise<CampaignShareLinkRevealResult | null> => {
    if (!(await ownsCampaign(campaignId, ownerUserId))) {
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
  }

  const getCampaignShareLinkByToken = async (token: string) => {
    const row = (await selectActiveShareLinkByTokenHash.get(
      hashShareToken(token),
      new Date().toISOString(),
    )) as CampaignShareLinkRow | undefined

    return row ? mapCampaignShareLinkRow(row) : null
  }

  return {
    createCampaignShareLink: createCampaignShareLinkTransaction,
    listCampaignShareLinks,
    revokeCampaignShareLink,
    getCampaignShareLinkReveal,
    getCampaignShareLinkByToken,
  }
}

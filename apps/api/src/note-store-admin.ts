import type { NoteStoreDatabase } from './note-store-database.js'
import type { AdminAccountSummary, AdminOverview } from './types.js'

export interface AdminAccountSummaryRow {
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

export interface AdminOverviewCountsRow {
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

export function mapAdminAccountSummaryRow(
  row: AdminAccountSummaryRow,
): AdminAccountSummary {
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

export function prepareAdminStatements(database: NoteStoreDatabase) {
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

  return { selectAdminAccounts, selectAdminOverviewCounts }
}

export type AdminStatements = ReturnType<typeof prepareAdminStatements>

export function createAdminDomain(deps: { statements: AdminStatements }) {
  const { selectAdminAccounts, selectAdminOverviewCounts } = deps.statements

  const listOwnerAccounts = async (): Promise<AdminAccountSummary[]> => {
    const rows = (await selectAdminAccounts.all()) as AdminAccountSummaryRow[]
    return rows.map(mapAdminAccountSummaryRow)
  }

  const getAdminOverview = async (): Promise<AdminOverview> => {
    const counts = (await selectAdminOverviewCounts.get()) as AdminOverviewCountsRow

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
  }

  return { listOwnerAccounts, getAdminOverview }
}

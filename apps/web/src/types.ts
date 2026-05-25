export const noteStatuses = ['draft', 'active', 'archived'] as const

export type NoteStatus = (typeof noteStatuses)[number]
export const campaignMembershipRoles = ['owner', 'guest'] as const
export type CampaignMembershipRole = (typeof campaignMembershipRoles)[number]
export const shareAccessLevels = ['viewer', 'editor'] as const
export type ShareAccessLevel = (typeof shareAccessLevels)[number]

export interface CampaignSummary {
  id: string
  name: string
  tagline: string
  system: string
  setting: string
  nextSession: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CampaignInput {
  name: string
  tagline: string
  system: string
  setting: string
  nextSession: string | null
}

export interface CampaignMembership {
  id: string
  campaignId: string
  role: CampaignMembershipRole
  displayName: string
  userId: string | null
  guestTokenId: string | null
  createdAt: string
  updatedAt: string
}

export interface CampaignShareLink {
  id: string
  campaignId: string
  label: string | null
  accessLevel: ShareAccessLevel
  frameAncestors: string | null
  expiresAt: string | null
  revokedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CampaignShareLinkInput {
  label: string | null
  accessLevel: ShareAccessLevel
  frameAncestors: string | null
  expiresAt?: string | null
}

export interface GuestJoinInput {
  displayName: string
}

export interface OwnerAccount {
  id: string
  email: string
  displayName: string
  isSiteAdmin: boolean
  keycloakSub?: string | null
  createdAt: string
  updatedAt: string
}

export interface AuthConfigResponse {
  keycloak: {
    url: string
    realm: string
    clientId: string
  }
}

export interface NoteAttribution {
  membershipId: string
  displayName: string
  role: CampaignMembershipRole
}

export const noteReferenceTypes = ['linked', 'inline'] as const
export type NoteReferenceType = (typeof noteReferenceTypes)[number]

export interface NoteReference {
  id: string
  sourceNoteId: string
  targetNoteId: string
  campaignId: string
  referenceType: NoteReferenceType
  label: string | null
  qualifier: string | null
  positionInBody: number | null
  createdAt: string
  updatedAt: string
}

export interface Note {
  id: string
  campaignId: string
  title: string
  body: string
  tags: string[]
  status: NoteStatus
  sessionName: string | null
  linkedNoteIds: string[]
  references?: NoteReference[]
  createdBy: NoteAttribution | null
  lastEditedBy: NoteAttribution | null
  createdAt: string
  updatedAt: string
}

export interface NoteInput {
  title: string
  body?: string
  tags?: string[]
  status?: NoteStatus
  sessionName?: string | null
  linkedNoteIds?: string[]
  campaignId?: string | null
}

export interface NoteStats {
  totalNotes: number
  draftNotes: number
  activeNotes: number
  archivedNotes: number
  sessionLinkedNotes: number
}

export interface NotesOverview {
  campaign: CampaignSummary
  membership: CampaignMembership | null
  stats: NoteStats
  recentNotes: Note[]
}

export interface AdminOverview {
  generatedAt: string
  accounts: {
    total: number
    siteAdmins: number
  }
  campaigns: {
    total: number
    archived: number
  }
  memberships: {
    total: number
    linkedAccounts: number
    guests: number
  }
  shareLinks: {
    active: number
    revoked: number
  }
  notes: {
    total: number
    draft: number
    active: number
    archived: number
  }
}

export interface AdminOverviewResponse {
  overview: AdminOverview
}

export interface AdminAccountSummary extends OwnerAccount {
  campaignMembershipCount: number
  ownedCampaignCount: number
}

export interface AdminAccountsResponse {
  accounts: AdminAccountSummary[]
}

export interface CurrentOwnerResponse {
  owner: OwnerAccount
}

export interface CampaignsResponse {
  campaigns: CampaignSummary[]
}

export interface CampaignResponse {
  campaign: CampaignSummary
}

export interface CampaignMembershipsResponse {
  memberships: CampaignMembership[]
}

export interface MembershipConsolidationInput {
  sourceMembershipId: string
  targetMembershipId: string
  confirm?: boolean
  confirmRoleMismatch?: boolean
}

export interface MembershipConsolidationNoteChanges {
  authoredNoteCount: number
  editedNoteCount: number
  authoredAndEditedNoteCount: number
  affectedNoteCount: number
}

export interface MembershipConsolidationSummary {
  applied: boolean
  effect: 'note-attribution-only'
  sourceMembership: CampaignMembership
  targetMembership: CampaignMembership
  noteChanges: MembershipConsolidationNoteChanges
  warnings: string[]
  requiresRoleMismatchConfirmation: boolean
}

export interface MembershipConsolidationResponse {
  consolidation: MembershipConsolidationSummary
}

export interface CampaignShareLinksResponse {
  shareLinks: CampaignShareLink[]
}

export interface CampaignShareLinkResponse {
  shareLink: CampaignShareLink
}

export interface CampaignShareLinkCreateResponse {
  shareLink: CampaignShareLink
  token: string
  url: string
}

export interface CampaignShareLinkRevealResponse {
  token: string
  url: string
}

export interface NotesResponse {
  notes: Note[]
}

export interface SessionSummary {
  sessionName: string
  noteCount: number
  latestActivity: string
}

export interface SessionsResponse {
  sessions: SessionSummary[]
}

export type NoteActivityAction = 'created' | 'edited'

export interface ActivityCollaborator {
  membershipId: string
  displayName: string
  role: CampaignMembershipRole
  noteCount: number
}

export interface NoteActivityEntry extends Note {
  action: NoteActivityAction
}

export interface NoteActivityResponse {
  campaign: CampaignSummary
  collaborators: ActivityCollaborator[]
  activity: NoteActivityEntry[]
}

export interface NoteResponse {
  note: Note
}

export interface SharedSessionResponse {
  campaign: CampaignSummary
  shareLink: CampaignShareLink
  membership: CampaignMembership | null
}

export interface SharedJoinResponse {
  campaign: CampaignSummary
  shareLink: CampaignShareLink
  membership: CampaignMembership
  guestToken: string
}

export interface SharedMembershipClaimResponse {
  membership: CampaignMembership
  guestToken: string | null
}

export interface ErrorResponse {
  error: string
  details?: string[]
  /** Machine-readable marker, e.g. 'tenant_in_maintenance' (maintenance write-gate). */
  code?: string
  /** Set by wake/maintenance signals to mark the response as safe to retry. */
  retryable?: boolean
}

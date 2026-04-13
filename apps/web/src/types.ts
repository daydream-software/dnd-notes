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
  createdAt: string
  updatedAt: string
}

export interface OwnerRegistrationInput {
  displayName: string
  email: string
  password: string
}

export interface OwnerLoginInput {
  email: string
  password: string
}

export interface NoteAttribution {
  membershipId: string
  displayName: string
  role: CampaignMembershipRole
}

export interface Note {
  id: string
  campaignId: string
  title: string
  body: string
  tags: string[]
  status: NoteStatus
  sessionName: string | null
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

export interface AuthSessionResponse {
  token: string
  owner: OwnerAccount
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
}

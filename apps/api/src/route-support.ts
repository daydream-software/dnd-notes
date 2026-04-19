import type { Request, Response } from 'express'
import type { NoteStore } from './note-store.js'
import type {
  ActivityCollaborator,
  CampaignMembership,
  ErrorResponse,
  Note,
  NoteActivityEntry,
  NoteActivityResponse,
  NotesOverview,
  OwnerAccount,
  SessionSummary,
} from './types.js'

export interface NoteParams extends Record<string, string> {
  noteId: string
}

export interface CampaignParams extends Record<string, string> {
  campaignId: string
}

export interface SessionParams extends Record<string, string> {
  sessionId: string
}

export interface ShareParams extends Record<string, string> {
  shareToken: string
}

export interface ShareLinkParams extends CampaignParams {
  shareLinkId: string
}

export interface SharedNoteParams extends ShareParams {
  noteId: string
}

export const defaultActivityLimit = 20
export const maxActivityLimit = 100

export interface RateLimitPolicy {
  maxRequests: number
  windowMs: number
  errorMessage: string
}

export interface AppRouteContext {
  getNoteStore: () => NoteStore
  setNoteStore: (noteStore: NoteStore) => void
  publicWebUrl: string | null
  restoreNoteStore?: (sourcePath: string) => Promise<NoteStore>
  isRateLimited: (
    request: Request,
    response: Response<ErrorResponse>,
    policyKey: string,
    policy: RateLimitPolicy,
    scopeKey?: string,
  ) => boolean
}

export const registerRateLimitPolicy: RateLimitPolicy = {
  maxRequests: 5,
  windowMs: 1000 * 60 * 15,
  errorMessage: 'Too many registration attempts. Please wait before trying again.',
}

export const loginRateLimitPolicy: RateLimitPolicy = {
  maxRequests: 5,
  windowMs: 1000 * 60 * 15,
  errorMessage: 'Too many login attempts. Please wait before trying again.',
}

export const sharedJoinRateLimitPolicy: RateLimitPolicy = {
  maxRequests: 10,
  windowMs: 1000 * 60 * 10,
  errorMessage: 'Too many guest join attempts. Please wait before trying again.',
}

export const sharedClaimRateLimitPolicy: RateLimitPolicy = {
  maxRequests: 5,
  windowMs: 1000 * 60 * 15,
  errorMessage: 'Too many membership claim attempts. Please wait before trying again.',
}

export const sqliteFileHeader = Buffer.from('SQLite format 3\0')

export function normalizePublicWebUrl(publicWebUrl?: string) {
  if (!publicWebUrl) {
    return null
  }

  const trimmed = publicWebUrl.trim()

  if (!trimmed) {
    return null
  }

  let parsed: URL

  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('PUBLIC_WEB_URL must be an absolute URL.')
  }

  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('PUBLIC_WEB_URL must not include a path, query string, or hash.')
  }

  return parsed.toString().replace(/\/$/, '')
}

export function parseAuthorizationToken(request: Request) {
  const authorizationHeader = request.header('authorization')

  if (!authorizationHeader) {
    return null
  }

  const [scheme, token] = authorizationHeader.split(' ')

  if (scheme !== 'Bearer' || !token) {
    return null
  }

  return token
}

function parseGuestToken(request: Request) {
  const guestToken = request.header('x-guest-token')

  if (!guestToken) {
    return null
  }

  const trimmed = guestToken.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function readRequestedCampaignId(request: Request) {
  const value = request.query.campaignId
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function readRequestedMembershipId(request: Request) {
  const value = request.query.membershipId

  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function readRequestedActivityLimit(
  request: Request,
  response: Response<ErrorResponse>,
) {
  const value = request.query.limit

  if (value === undefined) {
    return defaultActivityLimit
  }

  if (typeof value !== 'string') {
    response.status(400).json({ error: 'Activity limit must be a positive integer.' })
    return null
  }

  const parsed = Number.parseInt(value, 10)

  if (!Number.isInteger(parsed) || parsed <= 0) {
    response.status(400).json({ error: 'Activity limit must be a positive integer.' })
    return null
  }

  return Math.min(parsed, maxActivityLimit)
}

export async function buildOverview(
  noteStore: NoteStore,
  campaignId: string,
  membership: CampaignMembership | null,
): Promise<NotesOverview> {
  const campaign = await noteStore.getCampaign(campaignId)

  if (!campaign || campaign.archivedAt !== null) {
    throw new Error(`Campaign "${campaignId}" was not found.`)
  }

  return {
    campaign,
    membership,
    stats: await noteStore.getStats(campaign.id),
    recentNotes: await noteStore.listRecentNotes(3, campaign.id),
  }
}

export async function buildSessions(
  noteStore: NoteStore,
  campaignId: string,
): Promise<SessionSummary[]> {
  return noteStore.listSessionNames(campaignId)
}

function noteMatchesActivityMembership(note: Note, membershipId: string) {
  return (
    note.createdBy?.membershipId === membershipId ||
    note.lastEditedBy?.membershipId === membershipId
  )
}

function buildActivityCollaborators(notes: Note[]): ActivityCollaborator[] {
  const collaborators = new Map<string, ActivityCollaborator>()

  for (const note of notes) {
    const actorIds = new Set<string>()

    for (const actor of [note.createdBy, note.lastEditedBy]) {
      if (!actor || actorIds.has(actor.membershipId)) {
        continue
      }

      actorIds.add(actor.membershipId)
      const existing = collaborators.get(actor.membershipId)

      if (existing) {
        existing.noteCount += 1
        continue
      }

      collaborators.set(actor.membershipId, {
        membershipId: actor.membershipId,
        displayName: actor.displayName,
        role: actor.role,
        noteCount: 1,
      })
    }
  }

  return [...collaborators.values()].sort((left, right) =>
    right.noteCount !== left.noteCount
      ? right.noteCount - left.noteCount
      : left.displayName.localeCompare(right.displayName),
  )
}

function buildNoteActivityEntry(note: Note): NoteActivityEntry {
  return {
    ...note,
    action: note.createdAt === note.updatedAt ? 'created' : 'edited',
  }
}

export async function buildNoteActivityResponse(
  noteStore: NoteStore,
  campaignId: string,
  membershipId: string | null,
  limit: number,
): Promise<NoteActivityResponse> {
  const campaign = await noteStore.getCampaign(campaignId)

  if (!campaign || campaign.archivedAt !== null) {
    throw new Error(`Campaign "${campaignId}" was not found.`)
  }

  const notes = [...(await noteStore.listNotes(campaignId))].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  )

  const activity = membershipId
    ? notes.filter((note) => noteMatchesActivityMembership(note, membershipId))
    : notes

  return {
    campaign,
    collaborators: buildActivityCollaborators(notes),
    activity: activity.slice(0, limit).map(buildNoteActivityEntry),
  }
}

export async function requireAuthenticatedAccount(
  noteStore: NoteStore,
  request: Request,
  response: Response<ErrorResponse>,
) {
  const token = parseAuthorizationToken(request)

  if (!token) {
    response.status(401).json({ error: 'Owner authentication is required.' })
    return null
  }

  const owner = await noteStore.getOwnerBySessionToken(token)

  if (!owner) {
    response.status(401).json({ error: 'Owner session is invalid or expired.' })
    return null
  }

  return owner
}

export async function requireSiteAdmin(
  noteStore: NoteStore,
  request: Request,
  response: Response<ErrorResponse>,
) {
  const owner = await requireAuthenticatedAccount(noteStore, request, response)

  if (!owner) {
    return null
  }

  if (!owner.isSiteAdmin) {
    response.status(403).json({ error: 'Site-admin access is required.' })
    return null
  }

  return owner
}

export async function resolveOwnedCampaign(
  noteStore: NoteStore,
  owner: OwnerAccount,
  campaignId: string | null | undefined,
  response: Response<ErrorResponse>,
) {
  if (!campaignId) {
    try {
      return await noteStore.getPrimaryCampaign(owner.id)
    } catch {
      response.status(404).json({ error: 'No owned campaigns are available.' })
      return null
    }
  }

  const campaign = await noteStore.getCampaign(campaignId)

  if (!campaign || campaign.archivedAt !== null) {
    response.status(404).json({ error: `Campaign "${campaignId}" was not found.` })
    return null
  }

  if (!(await noteStore.userOwnsCampaign(owner.id, campaignId))) {
    response.status(403).json({ error: 'You do not have access to this campaign.' })
    return null
  }

  return campaign
}

export async function resolveAccessibleCampaign(
  noteStore: NoteStore,
  owner: OwnerAccount,
  campaignId: string | null | undefined,
  response: Response<ErrorResponse>,
) {
  if (!campaignId) {
    try {
      return await noteStore.getPrimaryCampaignForUser(owner.id)
    } catch {
      response.status(404).json({ error: 'No campaigns are available.' })
      return null
    }
  }

  const campaign = await noteStore.getCampaign(campaignId)

  if (!campaign || campaign.archivedAt !== null) {
    response.status(404).json({ error: `Campaign "${campaignId}" was not found.` })
    return null
  }

  if (!(await noteStore.userHasCampaignAccess(owner.id, campaignId))) {
    response.status(403).json({ error: 'You do not have access to this campaign.' })
    return null
  }

  return campaign
}

export async function resolveSharedLink(
  noteStore: NoteStore,
  shareToken: string,
  response: Response<ErrorResponse>,
) {
  const shareLink = await noteStore.getCampaignShareLinkByToken(shareToken)

  if (!shareLink) {
    response.status(404).json({ error: 'Shared link was not found or has been revoked.' })
    return null
  }

  const campaign = await noteStore.getCampaign(shareLink.campaignId)

  if (!campaign || campaign.archivedAt !== null) {
    response.status(404).json({ error: 'Campaign was not found for this shared link.' })
    return null
  }

  return { shareLink, campaign }
}

export function applySharedLinkPolicy(
  response: Response,
  frameAncestors: string | null,
) {
  response.set(
    'Content-Security-Policy',
    `frame-ancestors ${frameAncestors?.trim() || "'none'"}`,
  )
  response.removeHeader('X-Frame-Options')
}

export async function readSharedMembership(
  noteStore: NoteStore,
  request: Request,
  campaignId: string,
) {
  const guestToken = parseGuestToken(request)

  if (!guestToken) {
    return null
  }

  const membership = await noteStore.getGuestMembershipByToken(guestToken)

  if (!membership || membership.campaignId !== campaignId) {
    return null
  }

  return membership
}

export async function requireSharedMembership(
  noteStore: NoteStore,
  request: Request,
  campaignId: string,
  response: Response<ErrorResponse>,
) {
  const membership = await readSharedMembership(noteStore, request, campaignId)

  if (!membership) {
    response.status(401).json({ error: 'Guest authentication is required for this shared campaign.' })
    return null
  }

  return membership
}

export function requireEditorAccess(
  accessLevel: 'viewer' | 'editor',
  response: Response<ErrorResponse>,
) {
  if (accessLevel !== 'editor') {
    response.status(403).json({ error: 'This shared link does not allow editing.' })
    return false
  }

  return true
}

export function buildSharedUrl(
  request: Request,
  shareToken: string,
  publicWebUrl: string | null,
) {
  if (publicWebUrl) {
    return `${publicWebUrl}/share/${shareToken}`
  }

  const origin = request.header('origin')?.replace(/\/$/, '')

  if (origin) {
    return `${origin}/share/${shareToken}`
  }

  return `${request.protocol}://${request.get('host')}/share/${shareToken}`
}

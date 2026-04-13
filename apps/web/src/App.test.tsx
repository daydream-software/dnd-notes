import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import userEvent from '@testing-library/user-event'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import App from './App'

type NoteStatus = 'draft' | 'active' | 'archived'

interface CampaignFixture {
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

interface CampaignMembershipFixture {
  id: string
  campaignId: string
  role: 'owner' | 'guest'
  displayName: string
  userId: string | null
  guestTokenId: string | null
  createdAt: string
  updatedAt: string
}

interface CampaignShareLinkFixture {
  id: string
  campaignId: string
  label: string | null
  accessLevel: 'viewer' | 'editor'
  frameAncestors: string | null
  expiresAt: string | null
  revokedAt: string | null
  createdAt: string
  updatedAt: string
  token?: string | null
  url?: string | null
}

interface NoteFixture {
  id: string
  campaignId: string
  title: string
  body: string
  tags: string[]
  status: NoteStatus
  sessionName: string | null
  createdBy?: {
    membershipId: string
    displayName: string
    role: 'owner' | 'guest'
  } | null
  lastEditedBy?: {
    membershipId: string
    displayName: string
    role: 'owner' | 'guest'
  } | null
  createdAt: string
  updatedAt: string
}

const defaultCampaignId = 'moonshae-ledger'
const authTokenStorageKey = 'dnd-notes:owner-auth-token'
const selectedCampaignStorageKey = 'dnd-notes:selected-campaign-id'

function buildOverview(
  campaign: CampaignFixture,
  notes: NoteFixture[],
  membership: CampaignMembershipFixture | null,
) {
  const sortedNotes = [...notes].sort((leftNote, rightNote) =>
    rightNote.updatedAt.localeCompare(leftNote.updatedAt),
  )

  return {
    campaign,
    membership,
    stats: {
      totalNotes: notes.length,
      draftNotes: notes.filter((note) => note.status === 'draft').length,
      activeNotes: notes.filter((note) => note.status === 'active').length,
      archivedNotes: notes.filter((note) => note.status === 'archived').length,
      sessionLinkedNotes: notes.filter((note) => note.sessionName !== null).length,
    },
    recentNotes: sortedNotes.slice(0, 3),
  }
}

function createAttribution(membership: CampaignMembershipFixture | null) {
  if (!membership) {
    return null
  }

  return {
    membershipId: membership.id,
    displayName: membership.displayName,
    role: membership.role,
  } as const
}

function countActivityMatches(notes: NoteFixture[], membershipId: string) {
  return notes.filter(
    (note) =>
      note.createdBy?.membershipId === membershipId ||
      note.lastEditedBy?.membershipId === membershipId,
  ).length
}

function serializeShareLink(shareLink: CampaignShareLinkFixture) {
  return {
    id: shareLink.id,
    campaignId: shareLink.campaignId,
    label: shareLink.label,
    accessLevel: shareLink.accessLevel,
    frameAncestors: shareLink.frameAncestors,
    expiresAt: shareLink.expiresAt,
    revokedAt: shareLink.revokedAt,
    createdAt: shareLink.createdAt,
    updatedAt: shareLink.updatedAt,
  }
}

function readHeader(
  headers: HeadersInit | undefined,
  name: string,
) {
  if (!headers) {
    return null
  }

  if (headers instanceof Headers) {
    return headers.get(name)
  }

  if (Array.isArray(headers)) {
    const match = headers.find(([headerName]) => headerName.toLowerCase() === name.toLowerCase())
    return match?.[1] ?? null
  }

  const value = headers[name as keyof typeof headers]

  if (Array.isArray(value)) {
    return value[0] ?? null
  }

  return typeof value === 'string' ? value : null
}

describe('App', () => {
  let owner:
    | {
        id: string
        email: string
        displayName: string
        createdAt: string
        updatedAt: string
      }
    | null
  let ownerPassword: string | null
  let activeToken: string | null
  let campaigns: CampaignFixture[]
  let membershipsByCampaign: Record<string, CampaignMembershipFixture[]>
  let shareLinksByCampaign: Record<string, CampaignShareLinkFixture[]>
  let guestMembershipByToken: Record<string, CampaignMembershipFixture>
  let notesByCampaign: Record<string, NoteFixture[]>
  let sharedSessionRequestCount: number
  let sharedSessionResponseDelaysMs: number[]
  let activityResponseDelayByMembershipId: Record<string, number>
  let writeTextMock: ReturnType<typeof vi.fn>
  let execCommandMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    owner = null
    ownerPassword = null
    activeToken = null
    campaigns = [
      {
        id: defaultCampaignId,
        name: 'Moonshae Ledger',
        tagline:
          'Capture the clues, fallout, and character beats that matter between sessions.',
        system: 'Dungeons & Dragons 5e',
        setting: 'Moonshae Isles',
        nextSession: '2026-04-18T19:00:00.000Z',
        archivedAt: null,
        createdAt: '2026-04-01T12:00:00.000Z',
        updatedAt: '2026-04-10T20:00:00.000Z',
      },
    ]
    membershipsByCampaign = {
      [defaultCampaignId]: [
        {
          id: 'membership-default-owner',
          campaignId: defaultCampaignId,
          role: 'owner',
          displayName: 'Campaign owner',
          userId: null,
          guestTokenId: null,
          createdAt: '2026-04-01T12:00:00.000Z',
          updatedAt: '2026-04-01T12:00:00.000Z',
        },
      ],
    }
    shareLinksByCampaign = {
      [defaultCampaignId]: [],
    }
    guestMembershipByToken = {}
    notesByCampaign = {
      [defaultCampaignId]: [
        {
          id: 'storm-ledger',
          campaignId: defaultCampaignId,
          title: 'Storm ledger updated',
          body: 'Session fallout points toward a storm giant envoy and a rushed harbor meeting.',
          tags: ['recap', 'harbor'],
          status: 'draft',
          sessionName: 'Session 12',
          createdAt: '2026-04-10T19:00:00.000Z',
          updatedAt: '2026-04-10T21:30:00.000Z',
        },
        {
          id: 'vault-sigils',
          campaignId: defaultCampaignId,
          title: 'Vault sigils mapped',
          body: 'Three sigils match the missing druid circles and point toward the western reef.',
          tags: ['clue', 'sigils'],
          status: 'active',
          sessionName: 'Session 12',
          createdAt: '2026-04-10T18:15:00.000Z',
          updatedAt: '2026-04-10T20:45:00.000Z',
        },
        {
          id: 'cipher-fragment',
          campaignId: defaultCampaignId,
          title: 'Cipher fragment recovered',
          body: 'Candlekeep contact goes silent after delivering the translated cipher.',
          tags: ['clue', 'candlekeep'],
          status: 'active',
          sessionName: 'Session 11',
          createdAt: '2026-04-08T18:00:00.000Z',
          updatedAt: '2026-04-10T20:00:00.000Z',
        },
        {
          id: 'quartermaster-ledger',
          campaignId: defaultCampaignId,
          title: 'Quartermaster ledger',
          body: 'Track which harbor favors are still owed before the next departure.',
          tags: ['logistics'],
          status: 'draft',
          sessionName: null,
          createdAt: '2026-04-07T18:00:00.000Z',
          updatedAt: '2026-04-07T18:30:00.000Z',
        },
      ],
    }
    sharedSessionRequestCount = 0
    sharedSessionResponseDelaysMs = []
    activityResponseDelayByMembershipId = {}

    localStorage.clear()
    window.history.replaceState({}, '', '/')
    writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: writeTextMock,
      },
    })
    execCommandMock = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommandMock,
    })

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url
      const parsedUrl = new URL(url, 'http://localhost')
      const path = parsedUrl.pathname
      const method = init?.method?.toUpperCase() ?? 'GET'
      const token = readHeader(init?.headers, 'Authorization')?.replace('Bearer ', '') ?? null
      const guestToken = readHeader(init?.headers, 'X-Guest-Token')

      const requireOwner = () => {
        if (!token || token !== activeToken || !owner) {
          return new Response(
            JSON.stringify({ error: 'Owner authentication is required.' }),
            {
              status: 401,
              headers: {
                'Content-Type': 'application/json',
              },
            },
          )
        }

        return null
      }

      const readCampaignId = () =>
        parsedUrl.searchParams.get('campaignId') ?? defaultCampaignId

      const findCampaignMembership = (campaignId: string) =>
        membershipsByCampaign[campaignId]?.find(
          (campaignMembership) => campaignMembership.userId === owner?.id,
        ) ?? null

      const ensureOwnerCampaign = (campaignId: string) => {
        const authFailure = requireOwner()
        if (authFailure) {
          return authFailure
        }

        const membership = membershipsByCampaign[campaignId]?.find(
          (campaignMembership) =>
            campaignMembership.role === 'owner' && campaignMembership.userId === owner?.id,
        )

        if (!membership) {
          return new Response(
            JSON.stringify({ error: 'You do not have access to this campaign.' }),
            {
              status: 403,
              headers: {
                'Content-Type': 'application/json',
              },
            },
          )
        }

        return null
      }

      const ensureCampaignAccess = (campaignId: string) => {
        const authFailure = requireOwner()
        if (authFailure) {
          return authFailure
        }

        if (!findCampaignMembership(campaignId)) {
          return new Response(
            JSON.stringify({ error: 'You do not have access to this campaign.' }),
            {
              status: 403,
              headers: {
                'Content-Type': 'application/json',
              },
            },
          )
        }

        return null
      }

      const resolveShareLink = (shareTokenValue: string) => {
        const shareLink = Object.values(shareLinksByCampaign)
          .flat()
          .find((candidateShareLink) => candidateShareLink.token === shareTokenValue)

        if (!shareLink) {
          return null
        }

        const campaign = campaigns.find(
          (candidateCampaign) => candidateCampaign.id === shareLink.campaignId,
        )

        if (!campaign) {
          return null
        }

        return { shareLink, campaign }
      }

      const requireGuestMembership = (campaignId: string) => {
        if (!guestToken) {
          return new Response(
            JSON.stringify({ error: 'Guest authentication is required for this shared campaign.' }),
            {
              status: 401,
              headers: {
                'Content-Type': 'application/json',
              },
            },
          )
        }

        const membership = guestMembershipByToken[guestToken]

        if (!membership || membership.campaignId !== campaignId) {
          return new Response(
            JSON.stringify({ error: 'Guest authentication is required for this shared campaign.' }),
            {
              status: 401,
              headers: {
                'Content-Type': 'application/json',
              },
            },
          )
        }

        return membership
      }

      const buildActivityResponse = (
        campaignId: string,
        membershipId: string | null,
        limit: number,
      ) => {
        const campaign = campaigns.find(
          (candidateCampaign) => candidateCampaign.id === campaignId,
        )
        const campaignNotes = [...(notesByCampaign[campaignId] ?? [])].sort((leftNote, rightNote) =>
          rightNote.updatedAt.localeCompare(leftNote.updatedAt),
        )
        const filteredNotes = membershipId
          ? campaignNotes.filter(
              (note) =>
                note.createdBy?.membershipId === membershipId ||
                note.lastEditedBy?.membershipId === membershipId,
            )
          : campaignNotes

        const collaborators = (membershipsByCampaign[campaignId] ?? [])
          .map((membership) => ({
            membershipId: membership.id,
            displayName: membership.displayName,
            role: membership.role,
            noteCount: countActivityMatches(campaignNotes, membership.id),
          }))
          .filter((collaborator) => collaborator.noteCount > 0)
          .sort((leftCollaborator, rightCollaborator) =>
            rightCollaborator.noteCount !== leftCollaborator.noteCount
              ? rightCollaborator.noteCount - leftCollaborator.noteCount
              : leftCollaborator.displayName.localeCompare(rightCollaborator.displayName),
          )

        return {
          campaign,
          collaborators,
          activity: filteredNotes.slice(0, limit).map((note) => ({
            ...note,
            action: note.createdAt === note.updatedAt ? 'created' : 'edited',
          })),
        }
      }

      if (path === '/api/auth/register' && method === 'POST') {
        const payload = JSON.parse(String(init?.body)) as {
          displayName: string
          email: string
          password: string
        }

        owner = {
          id: 'owner-1',
          email: payload.email.toLowerCase(),
          displayName: payload.displayName,
          createdAt: '2026-04-11T20:00:00.000Z',
          updatedAt: '2026-04-11T20:00:00.000Z',
        }
        ownerPassword = payload.password
        activeToken = 'owner-token-1'
        membershipsByCampaign[defaultCampaignId] = membershipsByCampaign[
          defaultCampaignId
        ].map((membership) => ({
          ...(membership.role === 'owner' && membership.userId === null
            ? {
                ...membership,
                displayName: payload.displayName,
                userId: owner?.id ?? null,
                updatedAt: '2026-04-11T20:00:00.000Z',
              }
            : membership),
        }))

        return new Response(
          JSON.stringify({ token: activeToken, owner }),
          {
            status: 201,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        )
      }

      if (path === '/api/auth/login' && method === 'POST') {
        const payload = JSON.parse(String(init?.body)) as {
          email: string
          password: string
        }

        if (
          !owner ||
          payload.email.toLowerCase() !== owner.email ||
          payload.password !== ownerPassword
        ) {
          return new Response(
            JSON.stringify({ error: 'Email or password is incorrect.' }),
            {
              status: 401,
              headers: {
                'Content-Type': 'application/json',
              },
            },
          )
        }

        activeToken = 'owner-token-login'

        return new Response(
          JSON.stringify({ token: activeToken, owner }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        )
      }

      if (path === '/api/auth/session' && method === 'GET') {
        const authFailure = requireOwner()
        if (authFailure) {
          return authFailure
        }

        return new Response(JSON.stringify({ owner }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        })
      }

      if (path === '/api/auth/logout' && method === 'POST') {
        const authFailure = requireOwner()
        if (authFailure) {
          return authFailure
        }

        activeToken = null

        return new Response(null, { status: 204 })
      }

      if (path === '/api/campaigns' && method === 'GET') {
        const authFailure = requireOwner()
        if (authFailure) {
          return authFailure
        }

        const accessibleCampaigns = campaigns.filter((campaign) =>
          membershipsByCampaign[campaign.id]?.some(
            (membership) => membership.userId === owner?.id,
          ),
        )

        return new Response(JSON.stringify({ campaigns: accessibleCampaigns }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        })
      }

      if (path === '/api/campaigns' && method === 'POST') {
        const authFailure = requireOwner()
        if (authFailure) {
          return authFailure
        }

        const payload = JSON.parse(String(init?.body)) as {
          name: string
          tagline: string
          system: string
          setting: string
          nextSession: string | null
        }

        const createdCampaign: CampaignFixture = {
          id: `campaign-${campaigns.length + 1}`,
          name: payload.name,
          tagline: payload.tagline,
          system: payload.system,
          setting: payload.setting,
          nextSession: payload.nextSession,
          archivedAt: null,
          createdAt: '2026-04-12T00:00:00.000Z',
          updatedAt: '2026-04-12T00:00:00.000Z',
        }

        campaigns = [...campaigns, createdCampaign]
        membershipsByCampaign[createdCampaign.id] = [
          {
            id: `membership-${createdCampaign.id}-owner`,
            campaignId: createdCampaign.id,
            role: 'owner',
            displayName: owner?.displayName ?? 'Owner',
            userId: owner?.id ?? null,
            guestTokenId: null,
            createdAt: '2026-04-12T00:00:00.000Z',
            updatedAt: '2026-04-12T00:00:00.000Z',
          },
        ]
        notesByCampaign[createdCampaign.id] = []

        return new Response(JSON.stringify({ campaign: createdCampaign }), {
          status: 201,
          headers: {
            'Content-Type': 'application/json',
          },
        })
      }

      const campaignMatch = path.match(/^\/api\/campaigns\/([^/]+)$/)
      if (campaignMatch && method === 'PUT') {
        const campaignId = campaignMatch[1]
        const ownershipFailure = ensureOwnerCampaign(campaignId)
        if (ownershipFailure) {
          return ownershipFailure
        }

        const payload = JSON.parse(String(init?.body)) as {
          name: string
          tagline: string
          system: string
          setting: string
          nextSession: string | null
        }

        campaigns = campaigns.map((campaign) =>
          campaign.id === campaignId
            ? {
                ...campaign,
                name: payload.name,
                tagline: payload.tagline,
                system: payload.system,
                setting: payload.setting,
                nextSession: payload.nextSession,
                updatedAt: '2026-04-12T01:00:00.000Z',
              }
            : campaign,
        )

        return new Response(
          JSON.stringify({
            campaign: campaigns.find((campaign) => campaign.id === campaignId),
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        )
      }

      const membershipsMatch = path.match(/^\/api\/campaigns\/([^/]+)\/memberships$/)
      if (membershipsMatch && method === 'GET') {
        const campaignId = membershipsMatch[1]
        const ownershipFailure = ensureOwnerCampaign(campaignId)
        if (ownershipFailure) {
          return ownershipFailure
        }

        return new Response(
          JSON.stringify({ memberships: membershipsByCampaign[campaignId] ?? [] }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        )
      }

      const shareLinksMatch = path.match(/^\/api\/campaigns\/([^/]+)\/share-links$/)
      if (shareLinksMatch && method === 'GET') {
        const campaignId = shareLinksMatch[1]
        const ownershipFailure = ensureOwnerCampaign(campaignId)
        if (ownershipFailure) {
          return ownershipFailure
        }

        return new Response(
          JSON.stringify({
            shareLinks: (shareLinksByCampaign[campaignId] ?? []).map((shareLink) =>
              serializeShareLink(shareLink),
            ),
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        )
      }

      if (shareLinksMatch && method === 'POST') {
        const campaignId = shareLinksMatch[1]
        const ownershipFailure = ensureOwnerCampaign(campaignId)
        if (ownershipFailure) {
          return ownershipFailure
        }

        const payload = JSON.parse(String(init?.body)) as {
          label: string | null
          accessLevel: 'viewer' | 'editor'
          frameAncestors: string | null
        }

        const createdShareLink: CampaignShareLinkFixture = {
          id: `share-link-${(shareLinksByCampaign[campaignId] ?? []).length + 1}`,
          campaignId,
          label: payload.label,
          accessLevel: payload.accessLevel,
          frameAncestors: payload.frameAncestors,
          expiresAt: null,
          revokedAt: null,
          createdAt: '2026-04-12T01:30:00.000Z',
          updatedAt: '2026-04-12T01:30:00.000Z',
          token: `share-token-${campaignId}-${(shareLinksByCampaign[campaignId] ?? []).length + 1}`,
          url: `http://localhost/share/share-token-${campaignId}-${(shareLinksByCampaign[campaignId] ?? []).length + 1}`,
        }

        shareLinksByCampaign[campaignId] = [
          createdShareLink,
          ...(shareLinksByCampaign[campaignId] ?? []),
        ]

        return new Response(
          JSON.stringify({
            shareLink: serializeShareLink(createdShareLink),
            token: createdShareLink.token,
            url: createdShareLink.url,
          }),
          {
            status: 201,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        )
      }

      const shareLinkDetailMatch = path.match(
        /^\/api\/campaigns\/([^/]+)\/share-links\/([^/]+)$/,
      )
      if (shareLinkDetailMatch && method === 'GET') {
        const campaignId = shareLinkDetailMatch[1]
        const shareLinkId = shareLinkDetailMatch[2]
        const ownershipFailure = ensureOwnerCampaign(campaignId)
        if (ownershipFailure) {
          return ownershipFailure
        }

        const shareLink = (shareLinksByCampaign[campaignId] ?? []).find(
          (candidateShareLink) => candidateShareLink.id === shareLinkId,
        )

        if (!shareLink) {
          return new Response(JSON.stringify({ error: 'Shared link was not found.' }), {
            status: 404,
            headers: {
              'Content-Type': 'application/json',
            },
          })
        }

        if (!shareLink.token || !shareLink.url) {
          return new Response(
            JSON.stringify({
              error: 'This shared link can no longer be revealed.',
              details: [
                'This link was created before reveal support was added, so the original token was not stored. Revoke it and create a new share link to get a revealable URL.',
              ],
            }),
            {
              status: 409,
              headers: {
                'Content-Type': 'application/json',
              },
            },
          )
        }

        return new Response(
          JSON.stringify({
            token: shareLink.token,
            url: shareLink.url,
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        )
      }

      if (shareLinkDetailMatch && method === 'DELETE') {
        const campaignId = shareLinkDetailMatch[1]
        const shareLinkId = shareLinkDetailMatch[2]
        const ownershipFailure = ensureOwnerCampaign(campaignId)
        if (ownershipFailure) {
          return ownershipFailure
        }

        shareLinksByCampaign[campaignId] = (shareLinksByCampaign[campaignId] ?? []).filter(
          (shareLink) => shareLink.id !== shareLinkId,
        )

        return new Response(null, { status: 204 })
      }

      const sharedSessionMatch = path.match(/^\/api\/shared\/([^/]+)\/session$/)
      if (sharedSessionMatch && method === 'GET') {
        sharedSessionRequestCount += 1
        const delayMs = sharedSessionResponseDelaysMs.shift()

        if (delayMs) {
          await new Promise((resolve) => setTimeout(resolve, delayMs))
        }

        const resolved = resolveShareLink(sharedSessionMatch[1])

        if (!resolved) {
          return new Response(
            JSON.stringify({ error: 'Shared link was not found or has been revoked.' }),
            {
              status: 404,
              headers: {
                'Content-Type': 'application/json',
              },
            },
          )
        }

        const membership =
          guestToken && guestMembershipByToken[guestToken]?.campaignId === resolved.campaign.id
            ? guestMembershipByToken[guestToken]
            : null

        return new Response(
          JSON.stringify({
            campaign: resolved.campaign,
            shareLink: {
              id: resolved.shareLink.id,
              campaignId: resolved.shareLink.campaignId,
              label: resolved.shareLink.label,
              accessLevel: resolved.shareLink.accessLevel,
              frameAncestors: resolved.shareLink.frameAncestors,
              expiresAt: resolved.shareLink.expiresAt,
              revokedAt: resolved.shareLink.revokedAt,
              createdAt: resolved.shareLink.createdAt,
              updatedAt: resolved.shareLink.updatedAt,
            },
            membership,
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        )
      }

      const sharedJoinMatch = path.match(/^\/api\/shared\/([^/]+)\/join$/)
      if (sharedJoinMatch && method === 'POST') {
        const resolved = resolveShareLink(sharedJoinMatch[1])

        if (!resolved) {
          return new Response(
            JSON.stringify({ error: 'Shared link was not found or has been revoked.' }),
            {
              status: 404,
              headers: {
                'Content-Type': 'application/json',
              },
            },
          )
        }

        const payload = JSON.parse(String(init?.body)) as { displayName: string }
        const newGuestToken = `guest-token-${Object.keys(guestMembershipByToken).length + 1}`
        const membership: CampaignMembershipFixture = {
          id: `membership-${resolved.campaign.id}-guest-${Object.keys(guestMembershipByToken).length + 1}`,
          campaignId: resolved.campaign.id,
          role: 'guest',
          displayName: payload.displayName,
          userId: null,
          guestTokenId: `hashed-${newGuestToken}`,
          createdAt: '2026-04-12T02:30:00.000Z',
          updatedAt: '2026-04-12T02:30:00.000Z',
        }

        guestMembershipByToken[newGuestToken] = membership
        membershipsByCampaign[resolved.campaign.id] = [
          ...(membershipsByCampaign[resolved.campaign.id] ?? []),
          membership,
        ]

        return new Response(
          JSON.stringify({
            campaign: resolved.campaign,
            shareLink: {
              id: resolved.shareLink.id,
              campaignId: resolved.shareLink.campaignId,
              label: resolved.shareLink.label,
              accessLevel: resolved.shareLink.accessLevel,
              frameAncestors: resolved.shareLink.frameAncestors,
              expiresAt: resolved.shareLink.expiresAt,
              revokedAt: resolved.shareLink.revokedAt,
              createdAt: resolved.shareLink.createdAt,
              updatedAt: resolved.shareLink.updatedAt,
            },
            membership,
            guestToken: newGuestToken,
          }),
          {
            status: 201,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        )
      }

      const sharedClaimMatch = path.match(/^\/api\/shared\/([^/]+)\/membership\/claim$/)
      if (sharedClaimMatch && method === 'POST') {
        const resolved = resolveShareLink(sharedClaimMatch[1])

        if (!resolved) {
          return new Response(
            JSON.stringify({ error: 'Shared link was not found or has been revoked.' }),
            {
              status: 404,
              headers: {
                'Content-Type': 'application/json',
              },
            },
          )
        }

        const authFailure = requireOwner()
        if (authFailure) {
          return authFailure
        }

        const membership = requireGuestMembership(resolved.campaign.id)
        if (membership instanceof Response) {
          return membership
        }

        if (membership.userId && membership.userId !== owner?.id) {
          return new Response(
            JSON.stringify({
              error: 'This guest membership is already linked to another account.',
              details: [
                'Use the same browser session that originally claimed this membership or ask the campaign owner to share a fresh link.',
              ],
            }),
            {
              status: 409,
              headers: {
                'Content-Type': 'application/json',
              },
            },
          )
        }

        const existingMembership = (membershipsByCampaign[resolved.campaign.id] ?? []).find(
          (campaignMembership) =>
            campaignMembership.userId === owner?.id && campaignMembership.id !== membership.id,
        )

        if (!membership.userId && existingMembership) {
          return new Response(
            JSON.stringify({
              error: 'This account already has a membership in this campaign.',
              details: [
                'Keep using the membership that is already attached to this account for this campaign.',
              ],
            }),
            {
              status: 409,
              headers: {
                'Content-Type': 'application/json',
              },
            },
          )
        }

        const refreshedGuestToken =
          membership.userId === owner?.id || !guestToken ? null : `${guestToken}-claimed`
        const claimedMembership =
          membership.userId === owner?.id
            ? membership
            : {
                ...membership,
                userId: owner?.id ?? null,
                guestTokenId: refreshedGuestToken ? `hashed-${refreshedGuestToken}` : null,
                updatedAt: '2026-04-12T02:45:00.000Z',
              }

        if (guestToken && refreshedGuestToken) {
          delete guestMembershipByToken[guestToken]
          guestMembershipByToken[refreshedGuestToken] = claimedMembership
        }

        membershipsByCampaign[resolved.campaign.id] = (membershipsByCampaign[
          resolved.campaign.id
        ] ?? []).map((campaignMembership) =>
          campaignMembership.id === claimedMembership.id ? claimedMembership : campaignMembership,
        )

        return new Response(
          JSON.stringify({
            membership: claimedMembership,
            guestToken: refreshedGuestToken,
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        )
      }

      const sharedOverviewMatch = path.match(/^\/api\/shared\/([^/]+)\/overview$/)
      if (sharedOverviewMatch && method === 'GET') {
        const resolved = resolveShareLink(sharedOverviewMatch[1])

        if (!resolved) {
          return new Response(
            JSON.stringify({ error: 'Shared link was not found or has been revoked.' }),
            {
              status: 404,
              headers: {
                'Content-Type': 'application/json',
              },
            },
          )
        }

        const membership = requireGuestMembership(resolved.campaign.id)
        if (membership instanceof Response) {
          return membership
        }

        return new Response(
          JSON.stringify(
            buildOverview(
              resolved.campaign,
              notesByCampaign[resolved.campaign.id] ?? [],
              membership,
            ),
          ),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        )
      }

      const sharedNotesMatch = path.match(/^\/api\/shared\/([^/]+)\/notes$/)
      if (sharedNotesMatch && method === 'GET') {
        const resolved = resolveShareLink(sharedNotesMatch[1])

        if (!resolved) {
          return new Response(
            JSON.stringify({ error: 'Shared link was not found or has been revoked.' }),
            {
              status: 404,
              headers: {
                'Content-Type': 'application/json',
              },
            },
          )
        }

        const membership = requireGuestMembership(resolved.campaign.id)
        if (membership instanceof Response) {
          return membership
        }

        return new Response(
          JSON.stringify({ notes: notesByCampaign[resolved.campaign.id] ?? [] }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        )
      }

      if (sharedNotesMatch && method === 'POST') {
        const resolved = resolveShareLink(sharedNotesMatch[1])

        if (!resolved) {
          return new Response(
            JSON.stringify({ error: 'Shared link was not found or has been revoked.' }),
            {
              status: 404,
              headers: {
                'Content-Type': 'application/json',
              },
            },
          )
        }

        const membership = requireGuestMembership(resolved.campaign.id)
        if (membership instanceof Response) {
          return membership
        }

        if (resolved.shareLink.accessLevel !== 'editor') {
          return new Response(
            JSON.stringify({ error: 'This shared link does not allow editing.' }),
            {
              status: 403,
              headers: {
                'Content-Type': 'application/json',
              },
            },
          )
        }

        const payload = JSON.parse(String(init?.body)) as {
          title: string
          body: string
          tags: string[]
          status: NoteStatus
          sessionName: string | null
        }
        const attribution = createAttribution(membership)

        const createdNote: NoteFixture = {
          id: `shared-note-${(notesByCampaign[resolved.campaign.id] ?? []).length + 1}`,
          campaignId: resolved.campaign.id,
          title: payload.title,
          body: payload.body,
          tags: payload.tags,
          status: payload.status,
          sessionName: payload.sessionName,
          createdBy: attribution,
          lastEditedBy: attribution,
          createdAt: '2026-04-12T03:00:00.000Z',
          updatedAt: '2026-04-12T03:00:00.000Z',
        }

        notesByCampaign[resolved.campaign.id] = [
          createdNote,
          ...(notesByCampaign[resolved.campaign.id] ?? []),
        ]

        return new Response(JSON.stringify({ note: createdNote }), {
          status: 201,
          headers: {
            'Content-Type': 'application/json',
          },
        })
      }

      const sharedNoteMatch = path.match(/^\/api\/shared\/([^/]+)\/notes\/([^/]+)$/)
      if (sharedNoteMatch && method === 'PUT') {
        const resolved = resolveShareLink(sharedNoteMatch[1])

        if (!resolved) {
          return new Response(
            JSON.stringify({ error: 'Shared link was not found or has been revoked.' }),
            {
              status: 404,
              headers: {
                'Content-Type': 'application/json',
              },
            },
          )
        }

        const membership = requireGuestMembership(resolved.campaign.id)
        if (membership instanceof Response) {
          return membership
        }

        if (resolved.shareLink.accessLevel !== 'editor') {
          return new Response(
            JSON.stringify({ error: 'This shared link does not allow editing.' }),
            {
              status: 403,
              headers: {
                'Content-Type': 'application/json',
              },
            },
          )
        }

        const noteId = sharedNoteMatch[2]
        const payload = JSON.parse(String(init?.body)) as {
          title: string
          body: string
          tags: string[]
          status: NoteStatus
          sessionName: string | null
        }
        const attribution = createAttribution(membership)

        notesByCampaign[resolved.campaign.id] = (notesByCampaign[resolved.campaign.id] ?? []).map(
          (note) =>
            note.id === noteId
              ? {
                  ...note,
                  title: payload.title,
                  body: payload.body,
                  tags: payload.tags,
                  status: payload.status,
                  sessionName: payload.sessionName,
                  lastEditedBy: attribution,
                  updatedAt: '2026-04-12T03:30:00.000Z',
                }
              : note,
        )

        return new Response(
          JSON.stringify({
            note: (notesByCampaign[resolved.campaign.id] ?? []).find((note) => note.id === noteId),
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        )
      }

      if (sharedNoteMatch && method === 'DELETE') {
        const resolved = resolveShareLink(sharedNoteMatch[1])

        if (!resolved) {
          return new Response(
            JSON.stringify({ error: 'Shared link was not found or has been revoked.' }),
            {
              status: 404,
              headers: {
                'Content-Type': 'application/json',
              },
            },
          )
        }

        const membership = requireGuestMembership(resolved.campaign.id)
        if (membership instanceof Response) {
          return membership
        }

        if (resolved.shareLink.accessLevel !== 'editor') {
          return new Response(
            JSON.stringify({ error: 'This shared link does not allow editing.' }),
            {
              status: 403,
              headers: {
                'Content-Type': 'application/json',
              },
            },
          )
        }

        const noteId = sharedNoteMatch[2]
        notesByCampaign[resolved.campaign.id] = (notesByCampaign[resolved.campaign.id] ?? []).filter(
          (note) => note.id !== noteId,
        )

        return new Response(null, { status: 204 })
      }

      if (path === '/api/overview' && method === 'GET') {
        const campaignId = readCampaignId()
        const accessFailure = ensureCampaignAccess(campaignId)
        if (accessFailure) {
          return accessFailure
        }

        const campaign = campaigns.find((candidateCampaign) => candidateCampaign.id === campaignId)
        const membership = findCampaignMembership(campaignId)

        return new Response(
          JSON.stringify(
            buildOverview(campaign!, notesByCampaign[campaignId] ?? [], membership),
          ),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        )
      }

      if (path === '/api/notes' && method === 'GET') {
        const campaignId = readCampaignId()
        const accessFailure = ensureCampaignAccess(campaignId)
        if (accessFailure) {
          return accessFailure
        }

        return new Response(
          JSON.stringify({ notes: notesByCampaign[campaignId] ?? [] }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        )
      }

      if (path === '/api/notes/activity' && method === 'GET') {
        const campaignId = readCampaignId()
        const accessFailure = ensureCampaignAccess(campaignId)
        if (accessFailure) {
          return accessFailure
        }

        const membershipId = parsedUrl.searchParams.get('membershipId')
        const delayMs = membershipId
          ? activityResponseDelayByMembershipId[membershipId]
          : undefined

        if (delayMs) {
          await new Promise((resolve) => setTimeout(resolve, delayMs))
        }

        const limit = Number(parsedUrl.searchParams.get('limit') ?? '20')

        return new Response(
          JSON.stringify(buildActivityResponse(campaignId, membershipId, limit)),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        )
      }

      if (path === '/api/notes/sessions' && method === 'GET') {
        const campaignId = readCampaignId()
        const accessFailure = ensureCampaignAccess(campaignId)
        if (accessFailure) {
          return accessFailure
        }

        const sessions = Object.values(
          (notesByCampaign[campaignId] ?? []).reduce<
            Record<string, { sessionName: string; noteCount: number }>
          >((sessionMap, note) => {
            if (!note.sessionName) {
              return sessionMap
            }

            sessionMap[note.sessionName] ??= {
              sessionName: note.sessionName,
              noteCount: 0,
            }
            sessionMap[note.sessionName].noteCount += 1
            return sessionMap
          }, {}),
        )

        return new Response(
          JSON.stringify({
            sessions,
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        )
      }

      const sessionNotesMatch = path.match(/^\/api\/notes\/sessions\/([^/]+)$/)
      if (sessionNotesMatch && method === 'GET') {
        const campaignId = readCampaignId()
        const accessFailure = ensureCampaignAccess(campaignId)
        if (accessFailure) {
          return accessFailure
        }

        const sessionName = decodeURIComponent(sessionNotesMatch[1])

        return new Response(
          JSON.stringify({
            notes: (notesByCampaign[campaignId] ?? []).filter(
              (note) => note.sessionName === sessionName,
            ),
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        )
      }

      if (path === '/api/notes' && method === 'POST') {
        const payload = JSON.parse(String(init?.body)) as {
          campaignId: string
          title: string
          body?: string
          tags?: string[]
          status?: NoteStatus
          sessionName?: string | null
        }

        const accessFailure = ensureCampaignAccess(payload.campaignId)
        if (accessFailure) {
          return accessFailure
        }
        const attribution = createAttribution(findCampaignMembership(payload.campaignId))

        const createdNote: NoteFixture = {
          id: `note-${(notesByCampaign[payload.campaignId] ?? []).length + 1}`,
          campaignId: payload.campaignId,
          title: payload.title,
          body: payload.body ?? '',
          tags: payload.tags ?? [],
          status: payload.status ?? 'draft',
          sessionName: payload.sessionName ?? null,
          createdBy: attribution,
          lastEditedBy: attribution,
          createdAt: '2026-04-12T02:00:00.000Z',
          updatedAt: '2026-04-12T02:00:00.000Z',
        }

        notesByCampaign[payload.campaignId] = [
          createdNote,
          ...(notesByCampaign[payload.campaignId] ?? []),
        ]

        return new Response(JSON.stringify({ note: createdNote }), {
          status: 201,
          headers: {
            'Content-Type': 'application/json',
          },
        })
      }

      const noteMatch = path.match(/^\/api\/notes\/([^/]+)$/)

      if (noteMatch && method === 'PUT') {
        const noteId = noteMatch[1]
        const targetCampaignId =
          Object.keys(notesByCampaign).find((campaignId) =>
            (notesByCampaign[campaignId] ?? []).some((note) => note.id === noteId),
          ) ?? defaultCampaignId

        const accessFailure = ensureCampaignAccess(targetCampaignId)
        if (accessFailure) {
          return accessFailure
        }

        const payload = JSON.parse(String(init?.body)) as {
          title: string
          body: string
          tags: string[]
          status: NoteStatus
          sessionName: string | null
        }
        const attribution = createAttribution(findCampaignMembership(targetCampaignId))

        notesByCampaign[targetCampaignId] = (notesByCampaign[targetCampaignId] ?? []).map(
          (note) =>
            note.id === noteId
              ? {
                  ...note,
                  title: payload.title,
                  body: payload.body,
                  tags: payload.tags,
                  status: payload.status,
                  sessionName: payload.sessionName,
                  lastEditedBy: attribution,
                  updatedAt: '2026-04-12T03:00:00.000Z',
                }
              : note,
        )

        const updatedNote = notesByCampaign[targetCampaignId].find(
          (note) => note.id === noteId,
        )

        return new Response(JSON.stringify({ note: updatedNote }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        })
      }

      if (noteMatch && method === 'DELETE') {
        const noteId = noteMatch[1]
        const targetCampaignId =
          Object.keys(notesByCampaign).find((campaignId) =>
            (notesByCampaign[campaignId] ?? []).some((note) => note.id === noteId),
          ) ?? defaultCampaignId

        const accessFailure = ensureCampaignAccess(targetCampaignId)
        if (accessFailure) {
          return accessFailure
        }

        notesByCampaign[targetCampaignId] = (notesByCampaign[targetCampaignId] ?? []).filter(
          (note) => note.id !== noteId,
        )

        return new Response(null, { status: 204 })
      }

      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: {
          'Content-Type': 'application/json',
        },
      })
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    localStorage.clear()
    window.history.replaceState({}, '', '/')
  })

  it('supports owner onboarding, share-link reveal, and the note workflow', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(await screen.findByText('Create your owner account')).toBeTruthy()

    await user.type(screen.getByLabelText('Owner display name'), 'Stef')
    await user.type(screen.getByLabelText('Email'), 'stef@example.com')
    await user.type(screen.getByLabelText('Password'), 'moonlit-secret')
    await user.click(screen.getByRole('button', { name: 'Create owner account' }))

    expect(
      (await screen.findAllByRole('heading', { name: 'Moonshae Ledger' }))[0],
    ).toBeTruthy()
    expect(screen.getByText(/Signed in as Stef/)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Campaign settings' }))
    await user.clear(screen.getByLabelText('Tagline'))
    await user.type(
      screen.getByLabelText('Tagline'),
      'Track the shifting alliances and secrets between sessions.',
    )
    await user.type(screen.getByLabelText('Link label'), 'VTT table')
    await user.type(
      screen.getByLabelText('Allowed frame ancestors'),
      'https://owlbear.app',
    )
    await user.click(screen.getByRole('button', { name: 'Create shared link' }))

    expect(
      await screen.findByText(
        'Shared link created. Reveal it on the card when you need to copy it again.',
      ),
    ).toBeTruthy()

    const shareLinkCard = screen.getByRole('region', { name: 'VTT table shared link' })
    expect(within(shareLinkCard).queryByText(/http:\/\/localhost\/share\//)).toBeNull()
    expect(
      within(shareLinkCard).getByText('URL hidden until you reveal it on this card.'),
    ).toBeTruthy()
    expect(within(shareLinkCard).getByText('VTT table')).toBeTruthy()
    expect(within(shareLinkCard).getByText(/Frame ancestors: https:\/\/owlbear.app/)).toBeTruthy()

    await user.click(within(shareLinkCard).getByRole('button', { name: 'Reveal link' }))

    expect(
      await within(shareLinkCard).findByText(
        'http://localhost/share/share-token-moonshae-ledger-1',
      ),
    ).toBeTruthy()
    expect(within(shareLinkCard).getByRole('button', { name: 'Show link' })).toBeTruthy()

    await user.click(within(shareLinkCard).getByRole('button', { name: 'Copy link' }))

    expect(await within(shareLinkCard).findByRole('button', { name: 'Copied' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Save campaign settings' }))

    expect(
      await screen.findByText(
        'Track the shifting alliances and secrets between sessions.',
      ),
    ).toBeTruthy()
    expect(screen.getByText(/Signed in as Stef/)).toBeTruthy()

    await user.click(screen.getAllByRole('button', { name: 'New note' })[0])
    await user.type(screen.getByLabelText('Title'), 'Harper safe house')
    await user.type(screen.getByLabelText('Session name'), 'Session 13')
    await user.type(screen.getByRole('combobox', { name: 'Tags' }), 'harpers, safehouse')
    await user.type(
      screen.getByLabelText('Body'),
      'A hidden cellar beneath the inn gives the party a safe fallback location.',
    )

    await user.click(screen.getAllByRole('button', { name: 'Save note' })[0])

    expect(await screen.findByDisplayValue('Harper safe house')).toBeTruthy()
    expect(screen.getAllByText('safehouse').length).toBeGreaterThan(0)

    await user.clear(screen.getByLabelText('Title'))
    await user.type(screen.getByLabelText('Title'), 'Harper safe house secured')
    await user.click(screen.getAllByRole('button', { name: 'Save note' })[0])

    expect(
      await screen.findByDisplayValue('Harper safe house secured'),
    ).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Delete note' }))

    await waitFor(() => {
      expect(
        screen.queryByDisplayValue('Harper safe house secured'),
      ).toBeNull()
    })
  }, 45000)

  it('can switch into session browsing and drill into one session note trail', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.type(await screen.findByLabelText('Owner display name'), 'Stef')
    await user.type(screen.getByLabelText('Email'), 'stef@example.com')
    await user.type(screen.getByLabelText('Password'), 'moonlit-secret')
    await user.click(screen.getByRole('button', { name: 'Create owner account' }))

    expect(
      (await screen.findAllByRole('heading', { name: 'Moonshae Ledger' }))[0],
    ).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Browse by session' }))

    expect(await screen.findByRole('heading', { name: 'Sessions' })).toBeTruthy()

    const sessionList = screen.getByRole('list', { name: 'Session list' })
    expect(within(sessionList).getByText('Session 12')).toBeTruthy()
    expect(within(sessionList).getByText('2 notes')).toBeTruthy()
    expect(within(sessionList).getByText('Session 11')).toBeTruthy()
    expect(within(sessionList).getByText('1 note')).toBeTruthy()

    await user.click(within(sessionList).getByText('Session 12'))

    expect(
      await screen.findByRole('heading', { name: 'Session 12 notes' }),
    ).toBeTruthy()
    expect(screen.getByText('2 notes in Session 12')).toBeTruthy()
    expect(screen.getByDisplayValue('Storm ledger updated')).toBeTruthy()
    const sessionNotesList = screen.getByRole('list', { name: 'Session notes' })
    expect(within(sessionNotesList).getByText('Vault sigils mapped')).toBeTruthy()
    expect(within(sessionNotesList).queryByText('Cipher fragment recovered')).toBeNull()
    expect(within(sessionNotesList).queryByText('Quartermaster ledger')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Back to sessions' }))

    expect(await screen.findByRole('heading', { name: 'Sessions' })).toBeTruthy()
  }, 35000)

  it('derives tag facets locally, clears the active filter for a new note, and reuses tags in the editor', async () => {
    notesByCampaign[defaultCampaignId] = [
      {
        id: 'cipher-fragment',
        campaignId: defaultCampaignId,
        title: 'Cipher fragment recovered',
        body: 'Candlekeep contact goes silent after delivering the translated cipher.',
        tags: ['clue', 'candlekeep'],
        status: 'active',
        sessionName: 'Session 11',
        createdAt: '2026-04-08T18:00:00.000Z',
        updatedAt: '2026-04-10T20:00:00.000Z',
      },
      {
        id: 'reef-warning',
        campaignId: defaultCampaignId,
        title: 'Reef warning',
        body: 'Scout marks point to a hidden channel beside the reef.',
        tags: ['clue', 'reef'],
        status: 'draft',
        sessionName: null,
        createdAt: '2026-04-09T18:00:00.000Z',
        updatedAt: '2026-04-10T21:00:00.000Z',
      },
      {
        id: 'harbor-watch',
        campaignId: defaultCampaignId,
        title: 'Harbor watch',
        body: 'Dock crews rotate faster whenever the envoy ship arrives.',
        tags: ['harbor'],
        status: 'active',
        sessionName: 'Session 12',
        createdAt: '2026-04-10T18:00:00.000Z',
        updatedAt: '2026-04-11T08:00:00.000Z',
      },
    ]

    const user = userEvent.setup()
    render(<App />)

    await user.type(await screen.findByLabelText('Owner display name'), 'Stef')
    await user.type(screen.getByLabelText('Email'), 'stef@example.com')
    await user.type(screen.getByLabelText('Password'), 'moonlit-secret')
    await user.click(screen.getByRole('button', { name: 'Create owner account' }))

    const countRequestsForPath = (pathname: string) =>
      vi.mocked(globalThis.fetch).mock.calls.filter(([input]) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url

        return new URL(url, 'http://localhost').pathname === pathname
      }).length

    const workspaceRequestCountBeforeFilter =
      countRequestsForPath('/api/auth/session') +
      countRequestsForPath('/api/campaigns') +
      countRequestsForPath('/api/overview') +
      countRequestsForPath('/api/notes') +
      countRequestsForPath('/api/notes/sessions')

    await user.click(screen.getByRole('button', { name: 'clue (2)' }))

    expect(await screen.findByRole('heading', { name: 'Notes tagged “clue”' })).toBeTruthy()
    expect(screen.getByText('Filtering by clue (2)')).toBeTruthy()
    expect(
      countRequestsForPath('/api/auth/session') +
        countRequestsForPath('/api/campaigns') +
        countRequestsForPath('/api/overview') +
        countRequestsForPath('/api/notes') +
        countRequestsForPath('/api/notes/sessions'),
    ).toBe(workspaceRequestCountBeforeFilter)

    const filteredNotesList = screen.getByRole('list', { name: 'Notes list' })
    expect(within(filteredNotesList).getByText('Cipher fragment recovered')).toBeTruthy()
    expect(within(filteredNotesList).getByText('Reef warning')).toBeTruthy()
    expect(within(filteredNotesList).queryByText('Harbor watch')).toBeNull()

    await user.click(screen.getAllByRole('button', { name: 'New note' })[0])

    expect(await screen.findByRole('heading', { name: 'Notes' })).toBeTruthy()
    expect(screen.queryByText('Filtering by clue (2)')).toBeNull()
    expect(screen.getByRole('button', { name: 'clue (2)' })).toBeTruthy()
    expect(
      countRequestsForPath('/api/auth/session') +
        countRequestsForPath('/api/campaigns') +
        countRequestsForPath('/api/overview') +
        countRequestsForPath('/api/notes') +
        countRequestsForPath('/api/notes/sessions'),
    ).toBe(workspaceRequestCountBeforeFilter)

    const allNotesList = screen.getByRole('list', { name: 'Notes list' })
    expect(within(allNotesList).getByText('Harbor watch')).toBeTruthy()

    await user.type(screen.getByLabelText('Title'), 'Shoreline clue map')
    const tagsCombobox = screen.getByRole('combobox', { name: 'Tags' })
    await user.click(tagsCombobox)
    await user.type(tagsCombobox, 'cl')

    expect(await screen.findByRole('option', { name: 'clue' })).toBeTruthy()

    await user.click(screen.getByRole('option', { name: 'clue' }))
    await user.type(screen.getByRole('combobox', { name: 'Tags' }), 'shoreline, harbor')
    await user.tab()
    await user.type(
      screen.getByLabelText('Body'),
      'Keep the shoreline clue bundled with the harbor route notes.',
    )
    await user.click(screen.getAllByRole('button', { name: 'Save note' })[0])

    expect(await screen.findByDisplayValue('Shoreline clue map')).toBeTruthy()
    expect(notesByCampaign[defaultCampaignId][0].tags).toEqual([
      'clue',
      'shoreline',
      'harbor',
    ])
    expect(screen.queryByText('Filtering by clue (3)')).toBeNull()
    expect(screen.getByRole('button', { name: 'clue (3)' })).toBeTruthy()
  }, 35000)

  it('surfaces when an older shared link can no longer be revealed', async () => {
    shareLinksByCampaign[defaultCampaignId] = [
      {
        id: 'legacy-share-link',
        campaignId: defaultCampaignId,
        label: 'Legacy table',
        accessLevel: 'viewer',
        frameAncestors: null,
        expiresAt: null,
        revokedAt: null,
        createdAt: '2026-04-12T01:30:00.000Z',
        updatedAt: '2026-04-12T01:30:00.000Z',
      },
    ]

    const user = userEvent.setup()
    render(<App />)

    await user.type(await screen.findByLabelText('Owner display name'), 'Stef')
    await user.type(screen.getByLabelText('Email'), 'stef@example.com')
    await user.type(screen.getByLabelText('Password'), 'moonlit-secret')
    await user.click(screen.getByRole('button', { name: 'Create owner account' }))

    expect(
      (await screen.findAllByRole('heading', { name: 'Moonshae Ledger' }))[0],
    ).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Campaign settings' }))

    const shareLinkCard = await screen.findByRole('region', {
      name: 'Legacy table shared link',
    })

    await user.click(within(shareLinkCard).getByRole('button', { name: 'Reveal link' }))

    expect(
      await within(shareLinkCard).findByText(/This shared link can no longer be revealed/),
    ).toBeTruthy()
    expect(
      within(shareLinkCard).getByText(/Revoke it and create a new share link/),
    ).toBeTruthy()
  })

  it('supports creating a second campaign and scoping the workspace to it', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.type(await screen.findByLabelText('Owner display name'), 'Stef')
    await user.type(screen.getByLabelText('Email'), 'stef@example.com')
    await user.type(screen.getByLabelText('Password'), 'moonlit-secret')
    await user.click(screen.getByRole('button', { name: 'Create owner account' }))

    expect(
      (await screen.findAllByRole('heading', { name: 'Moonshae Ledger' }))[0],
    ).toBeTruthy()

    await user.click(screen.getAllByRole('button', { name: 'New campaign' })[0])
    await user.type(screen.getByLabelText('Campaign name'), 'Ashen Skies')
    await user.type(
      screen.getByLabelText('Tagline'),
      'Keep the sky-fleet politics and frontier rumors in one place.',
    )
    await user.type(screen.getByLabelText('System'), 'Stars Without Number')
    await user.type(screen.getByLabelText('Setting'), 'The Ashen Reach')
    await user.click(screen.getByRole('button', { name: 'Create campaign' }))

    expect(
      (await screen.findAllByRole('heading', { name: 'Ashen Skies' }))[0],
    ).toBeTruthy()
    expect(
      screen.getByText('No notes yet in this campaign. Create the first one to start using the workspace.'),
    ).toBeTruthy()

    await user.click(screen.getAllByRole('button', { name: 'New note' })[0])
    await user.type(screen.getAllByLabelText('Title')[0], 'Dockmaster bribe trail')
    await user.type(
      screen.getAllByLabelText('Body')[0],
      'The dockmaster keeps taking payment in relic shards from the eastern miners.',
    )
    await user.click(screen.getAllByRole('button', { name: 'Save note' })[0])

    expect(await screen.findByDisplayValue('Dockmaster bribe trail')).toBeTruthy()

    const statsList = (await screen.findAllByRole('list', { name: 'Campaign stats' }))[0]
    expect(within(statsList).getByText('Total notes')).toBeTruthy()
    expect(within(statsList).getByText('Draft notes')).toBeTruthy()
  }, 35000)

  it('can seed a new campaign from the starter pack template', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.type(await screen.findByLabelText('Owner display name'), 'Stef')
    await user.type(screen.getByLabelText('Email'), 'stef@example.com')
    await user.type(screen.getByLabelText('Password'), 'moonlit-secret')
    await user.click(screen.getByRole('button', { name: 'Create owner account' }))

    await user.click(screen.getAllByRole('button', { name: 'New campaign' })[0])
    await user.click(screen.getByRole('combobox', { name: 'Campaign starter' }))
    await user.click(await screen.findByRole('option', { name: 'Starter pack' }))

    expect(screen.getByText(/Seeds flexible notes for NPCs, factions, locations/)).toBeTruthy()

    await user.type(screen.getByLabelText('Campaign name'), 'Starfall Routes')
    await user.type(
      screen.getByLabelText('Tagline'),
      'Keep the cast, places, and session fallout ready before the first recap.',
    )
    await user.type(screen.getByLabelText('System'), 'Dungeons & Dragons 5e')
    await user.type(screen.getByLabelText('Setting'), 'The Starfall Coast')
    await user.click(screen.getByRole('button', { name: 'Create campaign' }))

    expect(
      (await screen.findAllByRole('heading', { name: 'Starfall Routes' }))[0],
    ).toBeTruthy()
    expect(await screen.findByText('NPC roster')).toBeTruthy()
    expect((await screen.findAllByText('Faction tracker')).length).toBeGreaterThan(0)
    expect((await screen.findAllByText('Location ledger')).length).toBeGreaterThan(0)
    expect((await screen.findAllByText('Session log')).length).toBeGreaterThan(0)
  }, 30000)

  it('can start a new note from a built-in template', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.type(await screen.findByLabelText('Owner display name'), 'Stef')
    await user.type(screen.getByLabelText('Email'), 'stef@example.com')
    await user.type(screen.getByLabelText('Password'), 'moonlit-secret')
    await user.click(screen.getByRole('button', { name: 'Create owner account' }))

    await user.click(screen.getAllByRole('button', { name: 'New note' })[0])
    await user.click(screen.getByRole('combobox', { name: 'Note template' }))
    await user.click(await screen.findByRole('option', { name: 'Faction brief' }))

    expect(screen.getByDisplayValue('Faction brief')).toBeTruthy()
    expect(screen.getAllByText('faction').length).toBeGreaterThan(0)
    expect(screen.getAllByText('politics').length).toBeGreaterThan(0)
    expect(screen.getByDisplayValue(/What the faction wants:/)).toBeTruthy()

    await user.clear(screen.getByLabelText('Title'))
    await user.type(screen.getByLabelText('Title'), 'Ashen Hand brief')
    await user.click(screen.getAllByRole('button', { name: 'Save note' })[0])

    expect(await screen.findByDisplayValue('Ashen Hand brief')).toBeTruthy()
    expect((await screen.findAllByText('Ashen Hand brief')).length).toBeGreaterThan(0)
  }, 15000)

  it('supports the guest join flow on a shared campaign route', async () => {
    shareLinksByCampaign[defaultCampaignId] = [
      {
        id: 'share-link-default',
        campaignId: defaultCampaignId,
        label: 'Player table',
        accessLevel: 'editor',
        frameAncestors: 'https://owlbear.app',
        expiresAt: null,
        revokedAt: null,
        createdAt: '2026-04-12T01:30:00.000Z',
        updatedAt: '2026-04-12T01:30:00.000Z',
        token: 'share-token-moonshae-ledger-1',
        url: 'http://localhost/share/share-token-moonshae-ledger-1',
      },
    ]

    window.history.replaceState({}, '', '/share/share-token-moonshae-ledger-1')

    const user = userEvent.setup()
    render(<App />)

    expect(await screen.findByText('Join Moonshae Ledger')).toBeTruthy()

    await user.type(screen.getByLabelText('Display name'), 'Nox')
    await user.click(screen.getByRole('button', { name: 'Join campaign' }))

    expect(await screen.findByText(/Joined as Nox/)).toBeTruthy()
    expect((await screen.findAllByText('Cipher fragment recovered')).length).toBeGreaterThan(0)
    expect(screen.getByText(/Total notes/)).toBeTruthy()
  }, 20000)

  it('lets a guest create and link a real account from the shared route', async () => {
    const sharedCampaignId = 'emberfall-accord'
    campaigns = [
      ...campaigns,
      {
        id: sharedCampaignId,
        name: 'Emberfall Accord',
        tagline: 'Track alliances and betrayals across the city.',
        system: 'Dungeons & Dragons 2024',
        setting: 'Emberfall',
        nextSession: null,
        archivedAt: null,
        createdAt: '2026-04-12T02:00:00.000Z',
        updatedAt: '2026-04-12T02:00:00.000Z',
      },
    ]
    membershipsByCampaign[sharedCampaignId] = []
    notesByCampaign[sharedCampaignId] = [
      {
        id: 'emberfall-note-1',
        campaignId: sharedCampaignId,
        title: 'Accord watch list',
        body: 'Keep tabs on who is leaning toward the harbor guild this week.',
        tags: ['faction'],
        status: 'active',
        sessionName: null,
        createdAt: '2026-04-12T02:15:00.000Z',
        updatedAt: '2026-04-12T02:15:00.000Z',
      },
    ]
    shareLinksByCampaign[sharedCampaignId] = [
      {
        id: 'share-link-default',
        campaignId: sharedCampaignId,
        label: 'Player table',
        accessLevel: 'editor',
        frameAncestors: 'https://owlbear.app',
        expiresAt: null,
        revokedAt: null,
        createdAt: '2026-04-12T01:30:00.000Z',
        updatedAt: '2026-04-12T01:30:00.000Z',
        token: 'share-token-emberfall-accord-1',
        url: 'http://localhost/share/share-token-emberfall-accord-1',
      },
    ]

    window.history.replaceState({}, '', '/share/share-token-emberfall-accord-1')

    const user = userEvent.setup()
    render(<App />)

    expect(await screen.findByText('Join Emberfall Accord')).toBeTruthy()

    await user.type(screen.getByLabelText('Display name'), 'Nox')
    await user.click(screen.getByRole('button', { name: 'Join campaign' }))

    expect(await screen.findByText(/Joined as Nox/)).toBeTruthy()
    expect(await screen.findByText('Link this guest membership')).toBeTruthy()

    await user.type(screen.getByLabelText('Account display name'), 'Nox Real')
    await user.type(screen.getByLabelText('Email'), 'nox@example.com')
    await user.type(screen.getByLabelText('Password'), 'moonlit-secret')
    await user.click(screen.getByRole('button', { name: 'Create and link account' }))

    expect((await screen.findByRole('alert')).textContent).toMatch(/Nox Real/)
    expect(localStorage.getItem(authTokenStorageKey)).toBe('owner-token-1')
    expect(
      localStorage.getItem('dnd-notes:guest-token:share-token-emberfall-accord-1'),
    ).toBe('guest-token-1-claimed')
    expect(localStorage.getItem(selectedCampaignStorageKey)).toBe(sharedCampaignId)
    expect((await screen.findAllByText('Accord watch list')).length).toBeGreaterThan(0)

    cleanup()
    window.history.replaceState({}, '', '/')
    render(<App />)

    expect(
      (await screen.findAllByRole('heading', { name: 'Emberfall Accord' }))[0],
    ).toBeTruthy()
    expect(screen.getByText('Linked collaborator')).toBeTruthy()
    expect(screen.getByText(/Share links and campaign settings stay with the campaign owner/)).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Campaign settings' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  }, 20000)

  it('does not let a stale shared-session response clear a new guest join', async () => {
    shareLinksByCampaign[defaultCampaignId] = [
      {
        id: 'share-link-default',
        campaignId: defaultCampaignId,
        label: 'Player table',
        accessLevel: 'editor',
        frameAncestors: 'https://owlbear.app',
        expiresAt: null,
        revokedAt: null,
        createdAt: '2026-04-12T01:30:00.000Z',
        updatedAt: '2026-04-12T01:30:00.000Z',
        token: 'share-token-moonshae-ledger-1',
        url: 'http://localhost/share/share-token-moonshae-ledger-1',
      },
    ]
    sharedSessionResponseDelaysMs = [75]

    window.history.replaceState({}, '', '/share/share-token-moonshae-ledger-1')

    const user = userEvent.setup()
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    )

    expect(await screen.findByText('Join Moonshae Ledger')).toBeTruthy()

    await user.type(screen.getByLabelText('Display name'), 'Nox')
    await user.click(screen.getByRole('button', { name: 'Join campaign' }))

    expect(await screen.findByText(/Joined as Nox/)).toBeTruthy()
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(screen.getByText(/Joined as Nox/)).toBeTruthy()
    expect(
      localStorage.getItem('dnd-notes:guest-token:share-token-moonshae-ledger-1'),
    ).toBe('guest-token-1')
  }, 20000)

  it('restores a saved guest session on refresh without looping the loading screen', async () => {
    shareLinksByCampaign[defaultCampaignId] = [
      {
        id: 'share-link-default',
        campaignId: defaultCampaignId,
        label: 'Player table',
        accessLevel: 'editor',
        frameAncestors: 'https://owlbear.app',
        expiresAt: null,
        revokedAt: null,
        createdAt: '2026-04-12T01:30:00.000Z',
        updatedAt: '2026-04-12T01:30:00.000Z',
        token: 'share-token-moonshae-ledger-1',
        url: 'http://localhost/share/share-token-moonshae-ledger-1',
      },
    ]

    const restoredMembership: CampaignMembershipFixture = {
      id: 'membership-moonshae-ledger-guest-restore',
      campaignId: defaultCampaignId,
      role: 'guest',
      displayName: 'Nox',
      userId: null,
      guestTokenId: 'hashed-guest-token-restore',
      createdAt: '2026-04-12T02:30:00.000Z',
      updatedAt: '2026-04-12T02:30:00.000Z',
    }

    guestMembershipByToken['guest-token-restore'] = restoredMembership
    membershipsByCampaign[defaultCampaignId] = [
      ...(membershipsByCampaign[defaultCampaignId] ?? []),
      restoredMembership,
    ]
    localStorage.setItem(
      'dnd-notes:guest-token:share-token-moonshae-ledger-1',
      'guest-token-restore',
    )
    window.history.replaceState({}, '', '/share/share-token-moonshae-ledger-1')

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    )

    expect(await screen.findByText(/Joined as Nox/)).toBeTruthy()
    expect((await screen.findAllByText('Cipher fragment recovered')).length).toBeGreaterThan(0)
    await waitFor(() => expect(sharedSessionRequestCount).toBe(2))
    await new Promise((resolve) => setTimeout(resolve, 75))
    expect(sharedSessionRequestCount).toBe(2)
    expect(screen.queryByText('Loading shared campaign...')).toBeNull()
  }, 20000)

  it('keeps session browsing local and loads recent activity without reloading the workspace', async () => {
    notesByCampaign[defaultCampaignId] = [
      {
        id: 'cipher-fragment',
        campaignId: defaultCampaignId,
        title: 'Cipher fragment recovered',
        body: 'Candlekeep contact goes silent after delivering the translated cipher.',
        tags: ['clue', 'candlekeep'],
        status: 'active',
        sessionName: 'Session 11',
        createdAt: '2026-04-08T18:00:00.000Z',
        updatedAt: '2026-04-10T20:00:00.000Z',
      },
      {
        id: 'moonwell-ritual',
        campaignId: defaultCampaignId,
        title: 'Moonwell ritual notes',
        body: 'The ritual requires three silver tokens placed at twilight.',
        tags: ['ritual', 'moonwell'],
        status: 'draft',
        sessionName: 'Session 11',
        createdAt: '2026-04-08T19:00:00.000Z',
        updatedAt: '2026-04-10T21:00:00.000Z',
      },
      {
        id: 'harbor-ambush',
        campaignId: defaultCampaignId,
        title: 'Harbor ambush',
        body: 'Pirates attacked the trade ship during the night watch.',
        tags: ['combat'],
        status: 'active',
        sessionName: 'Session 12',
        createdAt: '2026-04-09T18:00:00.000Z',
        updatedAt: '2026-04-11T20:00:00.000Z',
      },
      {
        id: 'general-thoughts',
        campaignId: defaultCampaignId,
        title: 'Campaign timeline ideas',
        body: 'Need to plan the faction dynamics for the next arc.',
        tags: ['planning'],
        status: 'draft',
        sessionName: null,
        createdAt: '2026-04-10T10:00:00.000Z',
        updatedAt: '2026-04-10T10:00:00.000Z',
      },
    ]

    const user = userEvent.setup()
    render(<App />)

    await user.type(await screen.findByLabelText('Owner display name'), 'Stef')
    await user.type(screen.getByLabelText('Email'), 'stef@example.com')
    await user.type(screen.getByLabelText('Password'), 'moonlit-secret')
    await user.click(screen.getByRole('button', { name: 'Create owner account' }))

    expect(
      (await screen.findAllByRole('heading', { name: 'Moonshae Ledger' }))[0],
    ).toBeTruthy()

    expect(screen.getAllByText('Cipher fragment recovered').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Moonwell ritual notes').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Harbor ambush').length).toBeGreaterThan(0)
    expect(screen.getByText('Campaign timeline ideas')).toBeTruthy()

    expect(screen.getByRole('button', { name: 'All notes' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Browse by session' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Recent activity' })).toBeTruthy()

    const countRequestsForPath = (pathname: string) =>
      vi.mocked(globalThis.fetch).mock.calls.filter(([input]) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url

        return new URL(url, 'http://localhost').pathname === pathname
      }).length

    const workspaceRequestCountBeforeBrowse =
      countRequestsForPath('/api/auth/session') +
      countRequestsForPath('/api/campaigns') +
      countRequestsForPath('/api/overview') +
      countRequestsForPath('/api/notes') +
      countRequestsForPath('/api/notes/sessions')

    await user.click(screen.getByRole('button', { name: 'Browse by session' }))

    expect(
      countRequestsForPath('/api/auth/session') +
        countRequestsForPath('/api/campaigns') +
        countRequestsForPath('/api/overview') +
        countRequestsForPath('/api/notes') +
        countRequestsForPath('/api/notes/sessions'),
    ).toBe(workspaceRequestCountBeforeBrowse)

    expect(screen.getByText('Session 11')).toBeTruthy()
    expect(screen.getByText('Session 12')).toBeTruthy()
    expect(screen.getByText('2 notes')).toBeTruthy()
    expect(screen.getByText('1 note')).toBeTruthy()

    await user.click(screen.getByText('Session 11'))

    expect(
      countRequestsForPath('/api/auth/session') +
        countRequestsForPath('/api/campaigns') +
        countRequestsForPath('/api/overview') +
        countRequestsForPath('/api/notes') +
        countRequestsForPath('/api/notes/sessions'),
    ).toBe(workspaceRequestCountBeforeBrowse)

    expect(screen.getAllByText('Cipher fragment recovered').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Moonwell ritual notes').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Back to sessions' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Back to sessions' }))

    expect(screen.getByText('Session 11')).toBeTruthy()
    expect(screen.getByText('Session 12')).toBeTruthy()

    await user.click(screen.getByText('Session 12'))

    expect(screen.getAllByText('Harbor ambush').length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'All notes' }))

    expect(
      countRequestsForPath('/api/auth/session') +
        countRequestsForPath('/api/campaigns') +
        countRequestsForPath('/api/overview') +
        countRequestsForPath('/api/notes') +
        countRequestsForPath('/api/notes/sessions'),
    ).toBe(workspaceRequestCountBeforeBrowse)

    expect(screen.getAllByText('Cipher fragment recovered').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Harbor ambush').length).toBeGreaterThan(0)
    expect(screen.getByText('Campaign timeline ideas')).toBeTruthy()

    const activityRequestsBeforeOpen = countRequestsForPath('/api/notes/activity')

    await user.click(screen.getByRole('button', { name: 'Recent activity' }))

    expect(await screen.findByRole('heading', { name: 'Recent activity' })).toBeTruthy()
    expect(countRequestsForPath('/api/notes/activity')).toBe(activityRequestsBeforeOpen + 1)
    expect(
      countRequestsForPath('/api/auth/session') +
        countRequestsForPath('/api/campaigns') +
        countRequestsForPath('/api/overview') +
        countRequestsForPath('/api/notes') +
        countRequestsForPath('/api/notes/sessions'),
    ).toBe(workspaceRequestCountBeforeBrowse)
  }, 25000)

  it('preserves draft state when switching between notes, sessions, and recent activity', async () => {
    notesByCampaign[defaultCampaignId] = [
      {
        id: 'session-note-1',
        campaignId: defaultCampaignId,
        title: 'Tavern encounter',
        body: 'Met a suspicious elf at the tavern.',
        tags: ['npc'],
        status: 'active',
        sessionName: 'Session 3',
        createdAt: '2026-04-08T18:00:00.000Z',
        updatedAt: '2026-04-10T20:00:00.000Z',
      },
    ]

    const user = userEvent.setup()
    render(<App />)

    await user.type(await screen.findByLabelText('Owner display name'), 'Stef')
    await user.type(screen.getByLabelText('Email'), 'stef@example.com')
    await user.type(screen.getByLabelText('Password'), 'moonlit-secret')
    await user.click(screen.getByRole('button', { name: 'Create owner account' }))

    expect(
      (await screen.findAllByRole('heading', { name: 'Moonshae Ledger' }))[0],
    ).toBeTruthy()

    await user.click(screen.getAllByRole('button', { name: 'New note' })[0])

    await user.type(screen.getByLabelText('Title'), 'Draft in progress')
    await user.type(screen.getByLabelText('Body'), 'This is work in progress.')

    expect(screen.getByDisplayValue('Draft in progress')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'npc (1)' }))

    expect(screen.getByDisplayValue('Draft in progress')).toBeTruthy()
    expect(screen.getByDisplayValue('This is work in progress.')).toBeTruthy()
    expect(screen.getByText('Filtering by npc (1)')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Browse by session' }))

    expect(screen.getByDisplayValue('Draft in progress')).toBeTruthy()
    expect(screen.getByDisplayValue('This is work in progress.')).toBeTruthy()
    expect(screen.getByText('Filtering by npc (1)')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Recent activity' }))

    expect(screen.getByDisplayValue('Draft in progress')).toBeTruthy()
    expect(screen.getByDisplayValue('This is work in progress.')).toBeTruthy()
    expect(screen.getByText('Filtering by npc (1)')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'All notes' }))

    expect(screen.getByDisplayValue('Draft in progress')).toBeTruthy()
    expect(screen.getByDisplayValue('This is work in progress.')).toBeTruthy()
    expect(screen.getByText('Filtering by npc (1)')).toBeTruthy()
  }, 25000)

  it('shows a recent activity empty state when a campaign has no notes yet', async () => {
    notesByCampaign[defaultCampaignId] = []

    const user = userEvent.setup()
    render(<App />)

    await user.type(await screen.findByLabelText('Owner display name'), 'Stef')
    await user.type(screen.getByLabelText('Email'), 'stef@example.com')
    await user.type(screen.getByLabelText('Password'), 'moonlit-secret')
    await user.click(screen.getByRole('button', { name: 'Create owner account' }))

    await user.click(screen.getByRole('button', { name: 'Recent activity' }))

    expect(
      await screen.findByText(
        'No notes in this campaign yet. Create your first note to get started.',
      ),
    ).toBeTruthy()
  }, 25000)

  it('shows recent activity with collaborator filters and keeps the latest filter response', async () => {
    const guestMembership: CampaignMembershipFixture = {
      id: 'membership-default-guest-1',
      campaignId: defaultCampaignId,
      role: 'guest',
      displayName: 'Scout Mira',
      userId: null,
      guestTokenId: 'guest-token-1',
      createdAt: '2026-04-01T12:30:00.000Z',
      updatedAt: '2026-04-01T12:30:00.000Z',
    }
    membershipsByCampaign[defaultCampaignId] = [
      ...(membershipsByCampaign[defaultCampaignId] ?? []),
      guestMembership,
    ]

    const ownerAttribution = {
      membershipId: membershipsByCampaign[defaultCampaignId][0].id,
      displayName: 'Campaign owner',
      role: 'owner' as const,
    }
    const guestAttribution = {
      membershipId: guestMembership.id,
      displayName: guestMembership.displayName,
      role: 'guest' as const,
    }

    notesByCampaign[defaultCampaignId] = [
      {
        id: 'owner-watch-list',
        campaignId: defaultCampaignId,
        title: 'Owner watch list',
        body: 'Track the factions that still owe favors before the next council.',
        tags: ['faction'],
        status: 'active',
        sessionName: null,
        createdBy: ownerAttribution,
        lastEditedBy: ownerAttribution,
        createdAt: '2026-04-09T18:00:00.000Z',
        updatedAt: '2026-04-09T18:00:00.000Z',
      },
      {
        id: 'scout-route-update',
        campaignId: defaultCampaignId,
        title: 'Scout route update',
        body: 'Mira found a safer shoreline approach for the next landing.',
        tags: ['travel'],
        status: 'draft',
        sessionName: 'Session 15',
        createdBy: guestAttribution,
        lastEditedBy: guestAttribution,
        createdAt: '2026-04-11T08:00:00.000Z',
        updatedAt: '2026-04-11T08:00:00.000Z',
      },
      {
        id: 'crossroads-briefing',
        campaignId: defaultCampaignId,
        title: 'Crossroads briefing',
        body: 'Started by the owner, then updated with Mira’s scouting notes.',
        tags: ['briefing'],
        status: 'active',
        sessionName: 'Session 15',
        createdBy: ownerAttribution,
        lastEditedBy: guestAttribution,
        createdAt: '2026-04-10T18:00:00.000Z',
        updatedAt: '2026-04-12T09:30:00.000Z',
      },
      {
        id: 'legacy-loose-end',
        campaignId: defaultCampaignId,
        title: 'Legacy loose end',
        body: 'Older imported note without attribution metadata.',
        tags: ['legacy'],
        status: 'archived',
        sessionName: null,
        createdBy: null,
        lastEditedBy: null,
        createdAt: '2026-04-08T12:00:00.000Z',
        updatedAt: '2026-04-08T12:00:00.000Z',
      },
    ]

    activityResponseDelayByMembershipId = {
      [guestMembership.id]: 90,
      [membershipsByCampaign[defaultCampaignId][0].id]: 10,
    }

    const user = userEvent.setup()
    render(<App />)

    await user.type(await screen.findByLabelText('Owner display name'), 'Stef')
    await user.type(screen.getByLabelText('Email'), 'stef@example.com')
    await user.type(screen.getByLabelText('Password'), 'moonlit-secret')
    await user.click(screen.getByRole('button', { name: 'Create owner account' }))

    await user.click(screen.getByRole('button', { name: 'Recent activity' }))

    expect(await screen.findByRole('heading', { name: 'Recent activity' })).toBeTruthy()
    expect(await screen.findByText('Created by Unknown')).toBeTruthy()
    expect(screen.getByText('Last edited by Scout Mira (Guest)')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Stef (2)' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Scout Mira (2)' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Scout Mira (2)' }))
    await user.click(screen.getByRole('button', { name: 'Stef (2)' }))

    expect(await screen.findByText('Filtering by Stef')).toBeTruthy()
    const activityList = screen.getByRole('list', { name: 'Recent activity list' })

    await waitFor(() => {
      expect(within(activityList).getAllByText('Owner watch list').length).toBeGreaterThan(0)
      expect(within(activityList).queryAllByText('Scout route update')).toHaveLength(0)
    })
  }, 25000)

  it('shows empty state for session browsing when no notes have session names', async () => {
    notesByCampaign[defaultCampaignId] = [
      {
        id: 'unlinked-note',
        campaignId: defaultCampaignId,
        title: 'Loose thoughts',
        body: 'Some campaign ideas without a session.',
        tags: [],
        status: 'draft',
        sessionName: null,
        createdAt: '2026-04-08T18:00:00.000Z',
        updatedAt: '2026-04-10T20:00:00.000Z',
      },
    ]

    const user = userEvent.setup()
    render(<App />)

    await user.type(await screen.findByLabelText('Owner display name'), 'Stef')
    await user.type(screen.getByLabelText('Email'), 'stef@example.com')
    await user.type(screen.getByLabelText('Password'), 'moonlit-secret')
    await user.click(screen.getByRole('button', { name: 'Create owner account' }))

    expect(
      (await screen.findAllByRole('heading', { name: 'Moonshae Ledger' }))[0],
    ).toBeTruthy()

    expect(
      screen.getByText(
        'No tagged notes yet. Add tags to a note to browse the campaign this way.',
      ),
    ).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Browse by session' }))

    expect(
      screen.getByText(/No session-linked notes yet/),
    ).toBeTruthy()
  }, 25000)

  it('lets an owner use quick capture to create a note with just a title', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.type(await screen.findByLabelText('Owner display name'), 'Stef')
    await user.type(screen.getByLabelText('Email'), 'stef@example.com')
    await user.type(screen.getByLabelText('Password'), 'moonlit-secret')
    await user.click(screen.getByRole('button', { name: 'Create owner account' }))

    expect(
      (await screen.findAllByRole('heading', { name: 'Moonshae Ledger' }))[0],
    ).toBeTruthy()

    const quickCaptureInput = screen.getByLabelText('Quick capture')
    expect(quickCaptureInput).toBeTruthy()

    await user.type(quickCaptureInput, 'Strange runes near the harbor')
    await user.click(screen.getByRole('button', { name: 'Capture' }))

    expect(
      await screen.findByDisplayValue('Strange runes near the harbor'),
    ).toBeTruthy()
  }, 15000)
})

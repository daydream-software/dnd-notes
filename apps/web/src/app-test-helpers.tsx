import { cleanup, render, screen, within } from '@testing-library/react'
import { vi } from 'vitest'
import App from './App'
import { createJsonResponse, readMockRequest } from './test-helpers'

export const authTokenStorageKey = 'dnd-notes:owner-auth-token'
export const keycloakTokensStorageKey = 'dnd-notes:keycloak-auth-tokens'
export const selectedCampaignStorageKey = 'dnd-notes:selected-campaign-id'

export const owner = {
  id: 'owner-1',
  email: 'chunk@example.com',
  displayName: 'Chunk the Tester',
  isSiteAdmin: false,
  keycloakSub: null,
  createdAt: '2026-04-13T00:00:00.000Z',
  updatedAt: '2026-04-13T00:00:00.000Z',
}

export const siteAdminOwner = {
  ...owner,
  isSiteAdmin: true,
}

export const campaign = {
  id: 'moonshae-ledger',
  name: 'Moonshae Ledger',
  tagline: 'Track clues, fallout, and next-session prep.',
  system: 'Dungeons & Dragons 5e',
  setting: 'Moonshae Isles',
  nextSession: '2026-04-18T19:00:00.000Z',
  archivedAt: null,
  createdAt: '2026-04-01T12:00:00.000Z',
  updatedAt: '2026-04-10T20:00:00.000Z',
}

export const membership = {
  id: 'membership-owner',
  campaignId: campaign.id,
  role: 'owner',
  displayName: owner.displayName,
  userId: owner.id,
  guestTokenId: null,
  createdAt: '2026-04-01T12:00:00.000Z',
  updatedAt: '2026-04-01T12:00:00.000Z',
}

export const notes = [
  {
    id: 'storm-ledger',
    campaignId: campaign.id,
    title: 'Storm ledger updated',
    body: 'Session fallout points toward a storm giant envoy.',
    tags: ['recap', 'harbor'],
    linkedNoteIds: [],
    status: 'draft',
    sessionName: 'Session 12',
    createdBy: {
      membershipId: membership.id,
      displayName: membership.displayName,
      role: membership.role,
    },
    lastEditedBy: null,
    createdAt: '2026-04-10T19:00:00.000Z',
    updatedAt: '2026-04-10T21:30:00.000Z',
  },
  {
    id: 'vault-sigils',
    campaignId: campaign.id,
    title: 'Vault sigils mapped',
    body: 'Three sigils point toward the western reef and ![[storm-ledger|Storm ledger updated|searching for]].',
    tags: ['clue', 'sigils'],
    linkedNoteIds: [],
    status: 'active',
    sessionName: 'Session 11',
    createdBy: {
      membershipId: membership.id,
      displayName: membership.displayName,
      role: membership.role,
    },
    lastEditedBy: null,
    createdAt: '2026-04-09T18:15:00.000Z',
    updatedAt: '2026-04-10T20:45:00.000Z',
  },
]

export const adminOverview = {
  generatedAt: '2026-04-16T01:30:00.000Z',
  accounts: {
    total: 2,
    siteAdmins: 1,
  },
  campaigns: {
    total: 1,
    archived: 0,
  },
  memberships: {
    total: 1,
    linkedAccounts: 1,
    guests: 0,
  },
  shareLinks: {
    active: 1,
    revoked: 0,
  },
  notes: {
    total: notes.length,
    draft: 1,
    active: 1,
    archived: 0,
  },
}

export const adminAccounts = [
  {
    ...siteAdminOwner,
    campaignMembershipCount: 1,
    ownedCampaignCount: 1,
  },
  {
    id: 'owner-2',
    email: 'ally@example.com',
    displayName: 'Ally Observer',
    isSiteAdmin: false,
    createdAt: '2026-04-14T00:00:00.000Z',
    updatedAt: '2026-04-14T00:00:00.000Z',
    campaignMembershipCount: 2,
    ownedCampaignCount: 0,
  },
]

export function getVisibleNotes() {
  return within(screen.getByRole('list', { name: 'Notes list' })).getAllByRole('button')
}

export function renderApp() {
  return render(<App />)
}

/**
 * Render the app and wait for the workspace to load.
 * Requires setupAppFetchMock() to have been called beforehand (seeds Keycloak tokens).
 */
export async function renderOwnerAndLoadWorkspace() {
  renderApp()
  await screen.findByText('Storm ledger updated')
}

export function setupAppFetchMock() {
  let activeOwner = owner

  // Seed Keycloak tokens so bootstrapAuth restores the session without a login redirect.
  localStorage.clear()
  localStorage.setItem(
    keycloakTokensStorageKey,
    JSON.stringify({ accessToken: 'smoke-token', refreshToken: 'smoke-refresh' }),
  )
  localStorage.setItem(authTokenStorageKey, 'smoke-token')
  window.history.replaceState({}, '', '/')

  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const { path, method } = readMockRequest(input, init)

    if (path === '/api/auth/config' && method === 'GET') {
      return createJsonResponse({
        keycloak: {
          url: 'https://auth.example.com',
          realm: 'dnd-notes',
          clientId: 'dnd-notes-web',
        },
      })
    }

    if (path === '/api/auth/session' && method === 'GET') {
      return createJsonResponse({ owner: activeOwner })
    }

    if (path === '/api/campaigns' && method === 'GET') {
      return createJsonResponse({ campaigns: [campaign] })
    }

    if (path === '/api/admin/overview' && method === 'GET') {
      return createJsonResponse({ overview: adminOverview })
    }

    if (path === '/api/admin/accounts' && method === 'GET') {
      return createJsonResponse({ accounts: adminAccounts })
    }

    if (path === '/api/overview' && method === 'GET') {
      return createJsonResponse({
        campaign,
        membership,
        stats: {
          totalNotes: notes.length,
          draftNotes: notes.filter((note) => note.status === 'draft').length,
          activeNotes: notes.filter((note) => note.status === 'active').length,
          archivedNotes: 0,
          sessionLinkedNotes: notes.filter((note) => note.sessionName !== null).length,
        },
        recentNotes: notes,
      })
    }

    if (path === '/api/notes/sessions' && method === 'GET') {
      return createJsonResponse({
        sessions: [
          {
            sessionName: 'Session 12',
            noteCount: 1,
            latestActivity: '2026-04-10T21:30:00.000Z',
          },
          {
            sessionName: 'Session 11',
            noteCount: 1,
            latestActivity: '2026-04-10T20:45:00.000Z',
          },
        ],
      })
    }

    if (path === '/api/notes' && method === 'GET') {
      return createJsonResponse({ notes })
    }

    return createJsonResponse({ error: 'Unhandled ' + method + ' ' + path }, 500)
  })

  return {
    setActiveOwner(nextOwner = owner) {
      activeOwner = nextOwner
    },
    countRequests(path: string, method: string) {
      return fetchSpy.mock.calls.filter(([input, init]) => {
        const request = readMockRequest(input, init)
        return request.path === path && request.method === method.toUpperCase()
      }).length
    },
  }
}

export function cleanupAppTestHarness() {
  cleanup()
  vi.restoreAllMocks()
}

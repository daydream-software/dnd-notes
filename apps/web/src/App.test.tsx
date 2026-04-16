import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const authTokenStorageKey = 'dnd-notes:owner-auth-token'
const selectedCampaignStorageKey = 'dnd-notes:selected-campaign-id'

const owner = {
  id: 'owner-1',
  email: 'chunk@example.com',
  displayName: 'Chunk the Tester',
  isSiteAdmin: false,
  createdAt: '2026-04-13T00:00:00.000Z',
  updatedAt: '2026-04-13T00:00:00.000Z',
}

const siteAdminOwner = {
  ...owner,
  isSiteAdmin: true,
}

const campaign = {
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

const membership = {
  id: 'membership-owner',
  campaignId: campaign.id,
  role: 'owner',
  displayName: owner.displayName,
  userId: owner.id,
  guestTokenId: null,
  createdAt: '2026-04-01T12:00:00.000Z',
  updatedAt: '2026-04-01T12:00:00.000Z',
}

const notes = [
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

const adminOverview = {
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

function createJsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function getVisibleNotes() {
  return within(screen.getByRole('list', { name: 'Notes list' })).getAllByRole('button')
}

async function registerOwnerAndLoadWorkspace(user: ReturnType<typeof userEvent.setup>) {
  render(<App />)

  await user.type(await screen.findByLabelText('Owner display name'), owner.displayName)
  await user.type(screen.getByLabelText('Email'), owner.email)
  await user.type(screen.getByLabelText('Password'), 'smoke-password')
  await user.click(screen.getByRole('button', { name: 'Create owner account' }))

  await screen.findByText('Storm ledger updated')
}

describe('App smoke path', () => {
  let activeOwner = owner

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState({}, '', '/')
    activeOwner = owner

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      const parsedUrl = new URL(url, 'http://localhost')
      const path = parsedUrl.pathname
      const method = init?.method?.toUpperCase() ?? 'GET'

      if (path === '/api/auth/register' && method === 'POST') {
        return createJsonResponse({ owner: activeOwner, token: 'smoke-token' }, 201)
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
  })

  it('renders owner onboarding before authentication', () => {
    render(<App />)

    expect(screen.getByLabelText('Owner display name')).toBeTruthy()
    expect(screen.getByLabelText('Email')).toBeTruthy()
    expect(screen.getByLabelText('Password')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create owner account' })).toBeTruthy()
  })

  it('loads the workspace after owner registration', async () => {
    const user = userEvent.setup()

    await registerOwnerAndLoadWorkspace(user)

    expect(screen.getByLabelText('Search notes')).toBeTruthy()
    expect(screen.getAllByText('Moonshae Ledger').length).toBeGreaterThan(0)
    expect(getVisibleNotes()).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'New note' }).length).toBeGreaterThan(0)
  })

  it('shows the site admin panel for site admins', async () => {
    const user = userEvent.setup()
    activeOwner = siteAdminOwner

    await registerOwnerAndLoadWorkspace(user)

    expect(await screen.findByRole('heading', { name: 'Site admin panel' })).toBeTruthy()
    expect(screen.getByText('Site admins 1')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Refresh admin metrics' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Download SQLite backup' })).toBeTruthy()
  })

  it('restores a saved owner session into the selected campaign workspace', async () => {
    localStorage.setItem(authTokenStorageKey, 'smoke-token')
    localStorage.setItem(selectedCampaignStorageKey, campaign.id)

    render(<App />)

    await screen.findByText('Storm ledger updated')

    expect(screen.queryByLabelText('Owner display name')).toBeNull()
    expect(screen.getByLabelText('Search notes')).toBeTruthy()
    expect(screen.getAllByText('Moonshae Ledger').length).toBeGreaterThan(0)
    expect(getVisibleNotes()).toHaveLength(2)
  })

  it('shows inline body references in the backlinks panel', async () => {
    const user = userEvent.setup()

    await registerOwnerAndLoadWorkspace(user)
    const stormLedgerHeading = within(
      screen.getByRole('list', { name: 'Notes list' }),
    ).getByText('Storm ledger updated')
    const stormLedgerButton = stormLedgerHeading.closest('[role="button"]')

    expect(stormLedgerButton).toBeTruthy()
    await user.click(stormLedgerButton!)

    expect(screen.getByText('Referenced by (1)')).toBeTruthy()
    expect(
      screen.getByText('Vault sigils mapped searching for Storm ledger updated'),
    ).toBeTruthy()
    expect(screen.queryByLabelText('Linked notes')).toBeNull()
  })

  it('shows inline link qualifiers in the linked notes panel', async () => {
    const user = userEvent.setup()

    await registerOwnerAndLoadWorkspace(user)
    const vaultSigilsHeading = within(
      screen.getByRole('list', { name: 'Notes list' }),
    ).getByText('Vault sigils mapped')
    const vaultSigilsButton = vaultSigilsHeading.closest('[role="button"]')

    expect(vaultSigilsButton).toBeTruthy()
    await user.click(vaultSigilsButton!)

    expect(screen.getByText('Linked notes (1)')).toBeTruthy()
    expect(
      screen.getByText('Vault sigils mapped searching for Storm ledger updated'),
    ).toBeTruthy()
  })

  it('keeps the followed linked note selected while search is active', async () => {
    const user = userEvent.setup()

    await registerOwnerAndLoadWorkspace(user)
    await user.type(screen.getByLabelText('Search notes'), 'vault')

    await user.click(
      within(screen.getByRole('list', { name: 'Notes list' })).getByText('Vault sigils mapped'),
    )

    const linkedRelationship = screen.getByText(
      'Vault sigils mapped searching for Storm ledger updated',
    )
    const linkedNoteCard = linkedRelationship.closest('.MuiCard-root')

    expect(linkedNoteCard).toBeTruthy()
    await user.click(linkedNoteCard!)

    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe(
      'Storm ledger updated',
    )
  })

  it('keeps the followed linked note selected while tag filters are active', async () => {
    const user = userEvent.setup()

    await registerOwnerAndLoadWorkspace(user)
    await user.type(screen.getByLabelText('Search notes'), 'vault')
    await user.click(screen.getAllByRole('button', { name: /sigils/ })[0])
    await user.click(
      within(screen.getByRole('list', { name: 'Notes list' })).getByText('Vault sigils mapped'),
    )

    const linkedRelationship = screen.getByText(
      'Vault sigils mapped searching for Storm ledger updated',
    )
    const linkedNoteCard = linkedRelationship.closest('.MuiCard-root')

    expect(linkedNoteCard).toBeTruthy()
    await user.click(linkedNoteCard!)

    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe(
      'Storm ledger updated',
    )
  })
})

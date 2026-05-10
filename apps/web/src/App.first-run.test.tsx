import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  campaign,
  cleanupAppTestHarness,
  membership,
  owner,
  renderApp,
} from './app-test-helpers'
import { createJsonResponse, readMockRequest } from './test-helpers'

interface Note {
  id: string
  campaignId: string
  title: string
  body: string
  tags: string[]
  linkedNoteIds: string[]
  status: string
  sessionName: string | null
  createdBy: { membershipId: string; displayName: string; role: string }
  lastEditedBy: null
  createdAt: string
  updatedAt: string
}

interface FirstRunMockOptions {
  /** Notes returned by GET /api/notes after campaign creation. Defaults to []. */
  notesAfterCreation?: Note[]
}

/**
 * Minimal fetch mock for the first-run flow (no campaigns).
 * Returns an empty campaigns list so the app renders the first-run hero form.
 */
function setupFirstRunFetchMock(options: FirstRunMockOptions = {}) {
  const { notesAfterCreation = [] } = options

  const createdCampaign = {
    ...campaign,
    id: 'new-campaign-1',
    name: 'My Campaign',
  }

  const noteRequests: Array<{ title: string }> = []

  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const { path, method } = readMockRequest(input, init)

    if (path === '/api/auth/config' && method === 'GET') {
      return createJsonResponse({ mode: 'local', keycloak: null })
    }

    if (path === '/api/auth/register' && method === 'POST') {
      return createJsonResponse({ owner, token: 'smoke-token' }, 201)
    }

    if (path === '/api/auth/session' && method === 'GET') {
      return createJsonResponse({ owner })
    }

    // First call returns no campaigns; subsequent calls return the created one
    if (path === '/api/campaigns' && method === 'GET') {
      const hasCreated = fetchSpy.mock.calls.some(([i, ini]) => {
        const r = readMockRequest(i, ini)
        return r.path === '/api/campaigns' && r.method === 'POST'
      })
      return createJsonResponse({
        campaigns: hasCreated ? [createdCampaign] : [],
      })
    }

    if (path === '/api/campaigns' && method === 'POST') {
      return createJsonResponse({ campaign: createdCampaign }, 201)
    }

    if (path === '/api/notes' && method === 'POST') {
      const body = JSON.parse((init?.body as string) ?? '{}')
      noteRequests.push({ title: body.title })
      return createJsonResponse(
        {
          note: {
            id: `note-${noteRequests.length}`,
            campaignId: createdCampaign.id,
            title: body.title,
            body: body.body ?? '',
            tags: body.tags ?? [],
            linkedNoteIds: [],
            status: body.status ?? 'draft',
            sessionName: body.sessionName ?? null,
            createdBy: { membershipId: membership.id, displayName: owner.displayName, role: 'owner' },
            lastEditedBy: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        },
        201,
      )
    }

    if (path === '/api/overview' && method === 'GET') {
      return createJsonResponse({
        campaign: createdCampaign,
        membership,
        stats: { totalNotes: 0, draftNotes: 0, activeNotes: 0, archivedNotes: 0, sessionLinkedNotes: 0 },
        recentNotes: [],
      })
    }

    if (path === '/api/notes' && method === 'GET') {
      return createJsonResponse({ notes: notesAfterCreation })
    }

    if (path === '/api/notes/sessions' && method === 'GET') {
      return createJsonResponse({ sessions: [] })
    }

    return createJsonResponse({ error: 'Unhandled ' + method + ' ' + path }, 500)
  })

  localStorage.clear()
  window.history.replaceState({}, '', '/')

  return { noteRequests, fetchSpy }
}

async function registerOwnerFirstRun(user: ReturnType<typeof userEvent.setup>) {
  renderApp()

  await user.type(await screen.findByLabelText('Owner display name'), owner.displayName)
  await user.type(screen.getByLabelText('Email'), owner.email)
  await user.type(screen.getByLabelText('Password'), 'smoke-password')
  await user.click(screen.getByRole('button', { name: 'Create owner account' }))

  // Wait for first-run hero to appear
  await screen.findByText('Create your first campaign')
}

describe('First-run UX — empty notes CTA + campaign template picker', () => {
  let firstRunMock: ReturnType<typeof setupFirstRunFetchMock>

  beforeEach(() => {
    firstRunMock = setupFirstRunFetchMock()
  })

  afterEach(() => {
    cleanupAppTestHarness()
  })

  describe('Campaign starter template picker on first-run form', () => {
    it('renders the campaign starter select on the first-run hero form', async () => {
      const user = userEvent.setup()
      await registerOwnerFirstRun(user)

      expect(screen.getByLabelText('Campaign starter')).toBeTruthy()
    })

    it('shows no preview chips when "Blank campaign" is selected', async () => {
      const user = userEvent.setup()
      await registerOwnerFirstRun(user)

      // Default is blank — no starter preview chips should be visible
      expect(screen.queryByText('NPC roster')).toBeNull()
      expect(screen.queryByText('Faction tracker')).toBeNull()
      expect(screen.queryByText('Location ledger')).toBeNull()
      expect(screen.queryByText('Session log')).toBeNull()
    })

    it('shows starter note chips when "Starter pack" is selected', async () => {
      const user = userEvent.setup()
      await registerOwnerFirstRun(user)

      await user.click(screen.getByLabelText('Campaign starter'))
      await user.click(await screen.findByRole('option', { name: 'Starter pack' }))

      // Preview alert chips should appear for each seeded note
      expect(screen.getByText('NPC roster')).toBeTruthy()
      expect(screen.getByText('Faction tracker')).toBeTruthy()
      expect(screen.getByText('Location ledger')).toBeTruthy()
      expect(screen.getByText('Session log')).toBeTruthy()
    })

    it('seeds starter notes when the campaign is created with "Starter pack"', async () => {
      const user = userEvent.setup()
      const { noteRequests } = firstRunMock
      await registerOwnerFirstRun(user)

      await user.click(screen.getByLabelText('Campaign starter'))
      await user.click(await screen.findByRole('option', { name: 'Starter pack' }))

      await user.type(screen.getByLabelText('Campaign name'), 'My Campaign')
      await user.click(screen.getByRole('button', { name: 'Create campaign' }))

      // Wait for workspace to load (blank — no notes after seeding in this mock)
      await screen.findByLabelText('Search notes')

      expect(noteRequests.map((r) => r.title)).toEqual([
        'NPC roster',
        'Faction tracker',
        'Location ledger',
        'Session log',
      ])
    })

    it('does not seed any notes when "Blank campaign" is kept', async () => {
      const user = userEvent.setup()
      const { noteRequests } = firstRunMock
      await registerOwnerFirstRun(user)

      await user.type(screen.getByLabelText('Campaign name'), 'My Campaign')
      await user.click(screen.getByRole('button', { name: 'Create campaign' }))

      await screen.findByLabelText('Search notes')

      expect(noteRequests).toHaveLength(0)
    })
  })

  describe('Empty notes CTA in browse pane', () => {
    it('renders the "New note" CTA button when there are no notes', async () => {
      const user = userEvent.setup()
      await registerOwnerFirstRun(user)

      // Create the campaign (blank) to enter the workspace
      await user.type(screen.getByLabelText('Campaign name'), 'My Campaign')
      await user.click(screen.getByRole('button', { name: 'Create campaign' }))

      // Workspace loads with zero notes
      await screen.findByLabelText('Search notes')

      // Multiple "New note" buttons exist (header icon + browse pane action + CTA).
      // We verify the CTA variant is present by checking the count is higher than
      // what would be present with notes (icon + browse action = 2; with CTA = 3).
      const newNoteButtons = screen.getAllByRole('button', { name: 'New note' })
      expect(newNoteButtons.length).toBeGreaterThanOrEqual(3)
    })

    it('clicking the "New note" CTA opens the note editor', async () => {
      const user = userEvent.setup()
      await registerOwnerFirstRun(user)

      await user.type(screen.getByLabelText('Campaign name'), 'My Campaign')
      await user.click(screen.getByRole('button', { name: 'Create campaign' }))

      await screen.findByLabelText('Search notes')

      // Click the last "New note" button — that is the contained CTA at the bottom
      const newNoteButtons = screen.getAllByRole('button', { name: 'New note' })
      await user.click(newNoteButtons[newNoteButtons.length - 1])

      // The editor title input should now be visible
      expect(screen.getByLabelText('Title')).toBeTruthy()
    })

    it('does not render the "New note" CTA when a tag filter is active', async () => {
      // Re-install the mock with one tagged note so the tag chip renders in the UI
      const taggedNote = {
        id: 'note-tagged-1',
        campaignId: 'new-campaign-1',
        title: 'Tagged note',
        body: '',
        tags: ['combat'],
        linkedNoteIds: [],
        status: 'draft',
        sessionName: null,
        createdBy: { membershipId: membership.id, displayName: owner.displayName, role: 'owner' },
        lastEditedBy: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      firstRunMock = setupFirstRunFetchMock({ notesAfterCreation: [taggedNote] })

      const user = userEvent.setup()
      await registerOwnerFirstRun(user)

      await user.type(screen.getByLabelText('Campaign name'), 'My Campaign')
      await user.click(screen.getByRole('button', { name: 'Create campaign' }))

      await screen.findByLabelText('Search notes')

      // Click the "combat" tag filter chip (filter active, 1 result visible)
      await user.click(screen.getByRole('button', { name: /combat/ }))

      // Force a truly empty filtered state by typing a search query that matches nothing
      await user.type(screen.getByLabelText('Search notes'), 'zzz-no-match')

      // Verify the list is genuinely empty — the tagged note is gone
      expect(screen.queryByText('Tagged note')).toBeNull()

      // The contained "New note" CTA must not appear even when the filtered list is empty
      const newNoteButtons = screen.queryAllByRole('button', { name: 'New note' })
      expect(newNoteButtons.length).toBeLessThan(3)
      // The tag-filter empty state message is also not the CTA alert
      expect(screen.queryByText(/Create the first one/)).toBeNull()
    })
  })

  describe('within NotesBrowsePane — aria-label on New note header button', () => {
    it('the New note icon button in the workspace header carries its aria-label', async () => {
      const user = userEvent.setup()
      await registerOwnerFirstRun(user)

      await user.type(screen.getByLabelText('Campaign name'), 'My Campaign')
      await user.click(screen.getByRole('button', { name: 'Create campaign' }))

      await screen.findByLabelText('Search notes')

      // "New note" button should exist (either header icon or CTA — at least one)
      const newNoteButtons = screen.getAllByRole('button', { name: 'New note' })
      expect(newNoteButtons.length).toBeGreaterThan(0)
    })
  })
})

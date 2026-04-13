import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

/**
 * Regression tests for Issue #24: Campaign Note Search with Filters
 * 
 * Focus: Search functionality for finding notes by title, body, tags, sessions, and collaborators.
 * These tests verify that client-side filtering works correctly and search state is preserved.
 */

describe('Campaign Note Search (Issue #24)', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState({}, '', '/')

    // Mock fetch for owner registration and basic campaign workflow
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      const parsedUrl = new URL(url, 'http://localhost')
      const path = parsedUrl.pathname
      const method = init?.method?.toUpperCase() ?? 'GET'

      // Owner registration
      if (path === '/api/owners' && method === 'POST') {
        return new Response(
          JSON.stringify({
            owner: {
              id: 'owner-1',
              email: 'test@example.com',
              displayName: 'Test Owner',
              createdAt: '2026-04-13T00:00:00.000Z',
              updatedAt: '2026-04-13T00:00:00.000Z',
            },
            token: 'test-token',
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        )
      }

      // Overview with pre-populated notes for search testing
      if (path === '/api/overview' && method === 'GET') {
        return new Response(
          JSON.stringify({
            campaign: {
              id: 'campaign-1',
              name: 'Test Campaign',
              tagline: 'Test tagline',
              system: 'D&D 5e',
              setting: 'Forgotten Realms',
              nextSession: null,
              archivedAt: null,
              createdAt: '2026-04-13T00:00:00.000Z',
              updatedAt: '2026-04-13T00:00:00.000Z',
            },
            membership: {
              id: 'membership-1',
              campaignId: 'campaign-1',
              role: 'owner',
              displayName: 'Test Owner',
              userId: 'owner-1',
              guestTokenId: null,
              createdAt: '2026-04-13T00:00:00.000Z',
              updatedAt: '2026-04-13T00:00:00.000Z',
            },
            stats: {
              totalNotes: 4,
              draftNotes: 1,
              activeNotes: 3,
              archivedNotes: 0,
              sessionLinkedNotes: 2,
            },
            recentNotes: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }

      // Notes endpoint with test fixtures
      if (path === '/api/notes' && method === 'GET') {
        return new Response(
          JSON.stringify({
            notes: [
              {
                id: 'note-1',
                campaignId: 'campaign-1',
                title: 'Dragon Encounter',
                body: 'Party faced a red dragon in the mountains',
                tags: ['combat', 'dragon'],
                status: 'active',
                sessionName: 'Session 5',
                createdBy: {
                  membershipId: 'membership-1',
                  displayName: 'Test Owner',
                  role: 'owner',
                },
                lastEditedBy: null,
                createdAt: '2026-04-10T10:00:00.000Z',
                updatedAt: '2026-04-10T10:00:00.000Z',
              },
              {
                id: 'note-2',
                campaignId: 'campaign-1',
                title: 'Goblin Camp',
                body: 'Found a goblin camp near the river',
                tags: ['exploration', 'goblin'],
                status: 'active',
                sessionName: 'Session 4',
                createdBy: {
                  membershipId: 'membership-1',
                  displayName: 'Test Owner',
                  role: 'owner',
                },
                lastEditedBy: null,
                createdAt: '2026-04-09T10:00:00.000Z',
                updatedAt: '2026-04-09T10:00:00.000Z',
              },
              {
                id: 'note-3',
                campaignId: 'campaign-1',
                title: 'Mysterious Artifact',
                body: 'Discovered an ancient artifact with dragon runes',
                tags: ['artifact', 'mystery'],
                status: 'active',
                sessionName: null,
                createdBy: {
                  membershipId: 'membership-1',
                  displayName: 'Test Owner',
                  role: 'owner',
                },
                lastEditedBy: null,
                createdAt: '2026-04-08T10:00:00.000Z',
                updatedAt: '2026-04-08T10:00:00.000Z',
              },
              {
                id: 'note-4',
                campaignId: 'campaign-1',
                title: 'Village Quest',
                body: 'Villagers need help with dragon problem',
                tags: ['quest'],
                status: 'draft',
                sessionName: null,
                createdBy: {
                  membershipId: 'membership-1',
                  displayName: 'Test Owner',
                  role: 'owner',
                },
                lastEditedBy: null,
                createdAt: '2026-04-07T10:00:00.000Z',
                updatedAt: '2026-04-07T10:00:00.000Z',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }

      // Default fallback
      return new Response(JSON.stringify({ error: 'Not mocked' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    })
  })

  it('filters notes by title search (case-insensitive)', async () => {
    const user = userEvent.setup()
    render(<App />)

    // Register and wait for workspace load
    await user.type(await screen.findByLabelText('Owner display name'), 'Test Owner')
    await user.type(screen.getByLabelText('Email'), 'test@example.com')
    await user.type(screen.getByLabelText('Password'), 'test-password')
    await user.click(screen.getByRole('button', { name: 'Create owner account' }))

    // Wait for notes to load
    await screen.findByText('Dragon Encounter')

    // Search for "dragon" - should match 3 notes (title + body + body)
    const searchInput = screen.getByLabelText('Search notes')
    await user.type(searchInput, 'dragon')

    await waitFor(() => {
      const notesList = screen.getByRole('list', { name: 'Notes list' })
      const noteButtons = within(notesList).getAllByRole('button')
      expect(noteButtons.length).toBe(3)
    })

    // Verify correct notes are shown
    expect(screen.getByText('Dragon Encounter')).toBeTruthy()
    expect(screen.getByText('Mysterious Artifact')).toBeTruthy()
    expect(screen.getByText('Village Quest')).toBeTruthy()
    expect(screen.queryByText('Goblin Camp')).toBeNull()
  })

  it('filters notes by body content', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.type(await screen.findByLabelText('Owner display name'), 'Test Owner')
    await user.type(screen.getByLabelText('Email'), 'test@example.com')
    await user.type(screen.getByLabelText('Password'), 'test-password')
    await user.click(screen.getByRole('button', { name: 'Create owner account' }))

    await screen.findByText('Dragon Encounter')

    // Search for "goblin" - should match note with "goblin" in title or body
    await user.type(screen.getByLabelText('Search notes'), 'goblin')

    await waitFor(() => {
      const notesList = screen.getByRole('list', { name: 'Notes list' })
      const noteButtons = within(notesList).getAllByRole('button')
      expect(noteButtons.length).toBe(1)
    })

    expect(screen.getByText('Goblin Camp')).toBeTruthy()
  })

  it('can clear search with clear button', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.type(await screen.findByLabelText('Owner display name'), 'Test Owner')
    await user.type(screen.getByLabelText('Email'), 'test@example.com')
    await user.type(screen.getByLabelText('Password'), 'test-password')
    await user.click(screen.getByRole('button', { name: 'Create owner account' }))

    await screen.findByText('Dragon Encounter')

    // Search to filter notes
    await user.type(screen.getByLabelText('Search notes'), 'goblin')
    
    await waitFor(() => {
      const notesList = screen.getByRole('list', { name: 'Notes list' })
      expect(within(notesList).getAllByRole('button').length).toBe(1)
    })

    // Click clear button
    const clearButton = screen.getByRole('button', { name: 'Clear search' })
    await user.click(clearButton)

    // All notes should be visible again
    await waitFor(() => {
      const notesList = screen.getByRole('list', { name: 'Notes list' })
      expect(within(notesList).getAllByRole('button').length).toBe(4)
    })

    // Search input should be empty
    const searchInput = screen.getByLabelText('Search notes') as HTMLInputElement
    expect(searchInput.value).toBe('')
  })

  it('combines search with tag filter', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.type(await screen.findByLabelText('Owner display name'), 'Test Owner')
    await user.type(screen.getByLabelText('Email'), 'test@example.com')
    await user.type(screen.getByLabelText('Password'), 'test-password')
    await user.click(screen.getByRole('button', { name: 'Create owner account' }))

    await screen.findByText('Dragon Encounter')

    // First apply search for "dragon"
    await user.type(screen.getByLabelText('Search notes'), 'dragon')

    await waitFor(() => {
      const notesList = screen.getByRole('list', { name: 'Notes list' })
      expect(within(notesList).getAllByRole('button').length).toBe(3)
    })

    // Then click the "combat" tag - should narrow down to Dragon Encounter only
    await user.click(screen.getByRole('button', { name: /combat/ }))

    await waitFor(() => {
      const notesList = screen.getByRole('list', { name: 'Notes list' })
      expect(within(notesList).getAllByRole('button').length).toBe(1)
    })

    expect(screen.getByText('Dragon Encounter')).toBeTruthy()
  })

  it('shows correct result count in description', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.type(await screen.findByLabelText('Owner display name'), 'Test Owner')
    await user.type(screen.getByLabelText('Email'), 'test@example.com')
    await user.type(screen.getByLabelText('Password'), 'test-password')
    await user.click(screen.getByRole('button', { name: 'Create owner account' }))

    await screen.findByText('Dragon Encounter')

    // Search for "dragon"
    await user.type(screen.getByLabelText('Search notes'), 'dragon')

    // Check that the description shows the correct count
    await waitFor(() => {
      expect(
        screen.getByText(/Showing 3 notes matching "dragon"/)
      ).toBeTruthy()
    })
  })

  it('clears search when starting a new note', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.type(await screen.findByLabelText('Owner display name'), 'Test Owner')
    await user.type(screen.getByLabelText('Email'), 'test@example.com')
    await user.type(screen.getByLabelText('Password'), 'test-password')
    await user.click(screen.getByRole('button', { name: 'Create owner account' }))

    await screen.findByText('Dragon Encounter')

    // Apply search
    await user.type(screen.getByLabelText('Search notes'), 'dragon')

    await waitFor(() => {
      expect(screen.getByText(/Showing 3 notes matching "dragon"/)).toBeTruthy()
    })

    // Click "New note" button
    await user.click(screen.getByRole('button', { name: 'New note' }))

    // Search should be cleared
    await waitFor(() => {
      const searchInput = screen.getByLabelText('Search notes') as HTMLInputElement
      expect(searchInput.value).toBe('')
    })
  })
})

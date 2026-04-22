import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createJsonResponse, readMockRequest } from './test-helpers'

const initMock = vi.fn<() => Promise<
  | {
      accessToken: string
      refreshToken: string
      idToken?: string
    }
  | null
>>()
const loginMock = vi.fn<(redirectUri?: string) => Promise<void>>()
const logoutMock = vi.fn<(redirectUri?: string) => Promise<void>>()
const refreshMock = vi.fn<(minValidity?: number) => Promise<{
  accessToken: string
  refreshToken: string
  idToken?: string
}>>()
const clearMock = vi.fn<() => void>()

vi.mock('./keycloak-client', () => ({
  createRuntimeKeycloakClient: () => ({
    init: initMock,
    login: loginMock,
    logout: logoutMock,
    refresh: refreshMock,
    clear: clearMock,
  }),
  isKeycloakAuthConfig: (
    authConfig: { mode: 'local' | 'keycloak'; keycloak: unknown } | null,
  ) => authConfig?.mode === 'keycloak' && authConfig.keycloak !== null,
}))

import App from './App'

const owner = {
  id: 'owner-1',
  email: 'keycloak-owner@example.com',
  displayName: 'Keycloak Owner',
  isSiteAdmin: false,
  keycloakSub: 'tenant-owner-sub',
  createdAt: '2026-04-22T00:00:00.000Z',
  updatedAt: '2026-04-22T00:00:00.000Z',
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
    createdBy: null,
    lastEditedBy: null,
    createdAt: '2026-04-10T19:00:00.000Z',
    updatedAt: '2026-04-10T21:30:00.000Z',
  },
]

describe('App Keycloak runtime auth', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState({}, '', '/')
    initMock.mockReset()
    loginMock.mockReset()
    logoutMock.mockReset()
    refreshMock.mockReset()
    clearMock.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows the Keycloak sign-in action when runtime auth mode is keycloak', async () => {
    initMock.mockResolvedValue(null)
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)

      if (path === '/api/auth/config' && method === 'GET') {
        return createJsonResponse({
          mode: 'keycloak',
          keycloak: {
            url: 'https://auth.example.com',
            realm: 'dnd-notes',
            clientId: 'dnd-notes-web',
          },
        })
      }

      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    render(<App />)

    const user = userEvent.setup()
    const button = await screen.findByRole('button', {
      name: 'Continue with Keycloak',
    })
    expect(screen.getByText('Sign in with Keycloak')).toBeTruthy()

    await user.click(button)

    expect(loginMock).toHaveBeenCalledTimes(1)
  })

  it('restores a saved Keycloak session into the workspace', async () => {
    localStorage.setItem(
      'dnd-notes:keycloak-auth-tokens',
      JSON.stringify({
        accessToken: 'keycloak-access-token',
        refreshToken: 'keycloak-refresh-token',
      }),
    )
    initMock.mockResolvedValue({
      accessToken: 'keycloak-access-token',
      refreshToken: 'keycloak-refresh-token',
    })
    refreshMock.mockResolvedValue({
      accessToken: 'keycloak-access-token',
      refreshToken: 'keycloak-refresh-token',
    })

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)

      if (path === '/api/auth/config' && method === 'GET') {
        return createJsonResponse({
          mode: 'keycloak',
          keycloak: {
            url: 'https://auth.example.com',
            realm: 'dnd-notes',
            clientId: 'dnd-notes-web',
          },
        })
      }

      if (path === '/api/auth/session' && method === 'GET') {
        return createJsonResponse({ owner })
      }

      if (path === '/api/campaigns' && method === 'GET') {
        return createJsonResponse({ campaigns: [campaign] })
      }

      if (path === '/api/overview' && method === 'GET') {
        return createJsonResponse({
          campaign,
          membership: null,
          stats: {
            totalNotes: notes.length,
            draftNotes: 1,
            activeNotes: 0,
            archivedNotes: 0,
            sessionLinkedNotes: 1,
          },
          recentNotes: notes,
        })
      }

      if (path === '/api/notes' && method === 'GET') {
        return createJsonResponse({ notes })
      }

      if (path === '/api/notes/sessions' && method === 'GET') {
        return createJsonResponse({
          sessions: [
            {
              sessionName: 'Session 12',
              noteCount: 1,
              latestActivity: '2026-04-10T21:30:00.000Z',
            },
          ],
        })
      }

      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    render(<App />)

    expect(await screen.findByText('Storm ledger updated')).toBeTruthy()
    expect(screen.queryByText('Sign in with Keycloak')).toBeNull()
  })

  it('shows an auth error instead of silently no-oping when the Keycloak client is missing', async () => {
    initMock.mockRejectedValue(new Error('Could not initialize the Keycloak client.'))
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)

      if (path === '/api/auth/config' && method === 'GET') {
        return createJsonResponse({
          mode: 'keycloak',
          keycloak: {
            url: 'https://auth.example.com',
            realm: 'dnd-notes',
            clientId: 'dnd-notes-web',
          },
        })
      }

      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    render(<App />)

    const user = userEvent.setup()
    const button = await screen.findByRole('button', {
      name: 'Continue with Keycloak',
    })

    expect(await screen.findByText('Could not initialize the Keycloak client.')).toBeTruthy()

    await user.click(button)

    expect(loginMock).not.toHaveBeenCalled()
    expect(
      await screen.findByText(
        'Keycloak sign-in is not ready yet. Reload and try again.',
      ),
    ).toBeTruthy()
  })
})

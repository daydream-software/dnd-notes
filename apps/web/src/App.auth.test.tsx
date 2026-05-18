import { screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./keycloak-client', () => ({
  createRuntimeKeycloakClient: () => ({
    init: async (stored: { accessToken: string; refreshToken: string } | null) => stored,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: async () => {
      const raw = localStorage.getItem('dnd-notes:keycloak-auth-tokens')
      return raw ? JSON.parse(raw) : null
    },
    clear: vi.fn(),
  }),
  isKeycloakAuthConfig: (authConfig: { keycloak?: { url?: string; realm?: string; clientId?: string } } | null) => {
    const kc = authConfig?.keycloak
    return (
      typeof kc?.url === 'string' && kc.url.length > 0 &&
      typeof kc?.realm === 'string' && kc.realm.length > 0 &&
      typeof kc?.clientId === 'string' && kc.clientId.length > 0
    )
  },
}))

import {
  cleanupAppTestHarness,
  getVisibleNotes,
  renderOwnerAndLoadWorkspace,
  setupAppFetchMock,
} from './app-test-helpers'

describe('App owner auth and bootstrap', () => {
  beforeEach(() => {
    setupAppFetchMock()
  })

  afterEach(() => {
    cleanupAppTestHarness()
  })

  it('loads the workspace after Keycloak session restore', async () => {
    await renderOwnerAndLoadWorkspace()

    expect(screen.getByLabelText('Search notes')).toBeTruthy()
    expect(screen.getAllByText('Moonshae Ledger').length).toBeGreaterThan(0)
    expect(getVisibleNotes()).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'New note' }).length).toBeGreaterThan(0)
  })

  it('restores a saved Keycloak session into the selected campaign workspace', async () => {
    // setupAppFetchMock already seeds Keycloak tokens; bootstrapAuth reads them and
    // calls fetchOwnerSession without a login redirect.
    await renderOwnerAndLoadWorkspace()

    expect(screen.queryByText('Sign in to your workspace')).toBeNull()
    expect(screen.getByLabelText('Search notes')).toBeTruthy()
    expect(screen.getAllByText('Moonshae Ledger').length).toBeGreaterThan(0)
    expect(getVisibleNotes()).toHaveLength(2)
  })
})

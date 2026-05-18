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
  renderOwnerAndLoadWorkspace,
  setupAppFetchMock,
  siteAdminOwner,
} from './app-test-helpers'

describe('App site admin flows', () => {
  let appTestContext: ReturnType<typeof setupAppFetchMock>

  beforeEach(() => {
    appTestContext = setupAppFetchMock()
    appTestContext.setActiveOwner(siteAdminOwner)
  })

  afterEach(() => {
    cleanupAppTestHarness()
  })

  it('shows the site admin panel for site admins without backup controls', async () => {
    await renderOwnerAndLoadWorkspace()

    expect(await screen.findByRole('heading', { name: 'Site admin panel' })).toBeTruthy()
    expect(screen.getByText('Site admins 1')).toBeTruthy()
    expect(screen.getByText('ally@example.com')).toBeTruthy()
    expect(screen.getByText('Owned campaigns 1')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Refresh admin metrics' })).toBeTruthy()
    expect(screen.queryByText(/backup/i)).toBeNull()
    expect(screen.queryByText(/restore/i)).toBeNull()
  })
})

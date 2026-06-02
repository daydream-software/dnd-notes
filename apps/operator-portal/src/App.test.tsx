import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createJsonResponse, makeJwt, readMockRequest } from './test-helpers'

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
const storedTokensKey = 'dnd-notes:operator-portal:keycloak-tokens'

vi.mock('./keycloak-client', () => ({
  createRuntimeKeycloakClient: () => ({
    init: initMock,
    login: loginMock,
    logout: logoutMock,
    refresh: refreshMock,
    clear: clearMock,
  }),
  readStoredKeycloakTokens: () => {
    const storedValue = localStorage.getItem(storedTokensKey)
    return storedValue ? JSON.parse(storedValue) : null
  },
  persistKeycloakTokens: (tokens: {
    accessToken: string
    refreshToken: string
    idToken?: string
  }) => {
    localStorage.setItem(storedTokensKey, JSON.stringify(tokens))
  },
  clearStoredKeycloakTokens: () => {
    localStorage.removeItem(storedTokensKey)
  },
}))

import App from './App'

const fleetStatus = {
  generatedAt: '2026-04-22T18:00:00.000Z',
  controlPlane: {
    status: 'healthy',
    uptime: 321,
    version: '0.1.0',
  },
  dependencies: {
    tenantRegistry: { status: 'healthy' },
    tenantProvisioning: {
      status: 'healthy',
      details: 'Tenant provisioning service configured.',
    },
  },
  summary: {
    totalTenants: 2,
    tenantsByCurrentState: {
      provisioning: 0,
      ready: 1,
      maintenance: 0,
      upgrading: 0,
      restoring: 0,
      failed: 1,
      deprovisioned: 0,
    },
    tenantsByDesiredState: {
      provisioning: 0,
      ready: 2,
      maintenance: 0,
      upgrading: 0,
      restoring: 0,
      failed: 0,
      deprovisioned: 0,
    },
    tenantsByVersion: {
      '1.0.0': 1,
      '2.0.0': 1,
    },
    tenantsWithBackupMetadata: 1,
    tenantsMissingBackupMetadata: 1,
    tenantsNeedingAttention: 1,
  },
  tenants: [
    {
      tenant: {
        id: 'tenant-ready',
        slug: 'moonshae-ledger',
        subdomain: 't-moonshae-ledger',
        ownerId: 'owner-1',
        desiredState: 'ready',
        currentState: 'ready',
        version: '1.0.0',
        storageReference: 'pvc-moonshae-ledger',
        backupMetadata: '{"lastBackupStatus":"ok"}',
        createdAt: '2026-04-22T16:00:00.000Z',
        updatedAt: '2026-04-22T17:00:00.000Z',
      },
      health: 'healthy',
      backup: {
        rawMetadata: '{"lastBackupStatus":"ok"}',
        location: 's3://fleet/moonshae-ledger',
        lastBackupAt: '2026-04-22T17:30:00.000Z',
        lastBackupStatus: 'ok',
        lastRestoreDrillAt: null,
        lastRestoreDrillStatus: null,
      },
      latestTransition: {
        id: 1,
        tenantId: 'tenant-ready',
        fromState: 'provisioning',
        toState: 'ready',
        triggeredBy: 'operator',
        reason: 'Provisioned successfully',
        createdAt: '2026-04-22T17:00:00.000Z',
      },
    },
    {
      tenant: {
        id: 'tenant-failed',
        slug: 'stormwatch',
        subdomain: null,
        ownerId: 'owner-2',
        desiredState: 'ready',
        currentState: 'failed',
        version: '2.0.0',
        storageReference: null,
        backupMetadata: null,
        createdAt: '2026-04-22T16:00:00.000Z',
        updatedAt: '2026-04-22T17:15:00.000Z',
      },
      health: 'attention',
      backup: {
        rawMetadata: null,
        location: null,
        lastBackupAt: null,
        lastBackupStatus: null,
        lastRestoreDrillAt: null,
        lastRestoreDrillStatus: null,
      },
      latestTransition: {
        id: 2,
        tenantId: 'tenant-failed',
        fromState: 'provisioning',
        toState: 'failed',
        triggeredBy: 'system',
        reason: 'Probe never became ready',
        createdAt: '2026-04-22T17:15:00.000Z',
      },
    },
  ],
}

// Minimal JWT tokens carrying the required operator roles for existing session tests.
const authorizedAccessToken = makeJwt({
  sub: 'operator-user',
  preferred_username: 'operator',
  realm_access: { roles: ['control-plane-workforce'] },
})
const authorizedRefreshToken = makeJwt({ sub: 'operator-user', typ: 'Refresh' })

// Minimal JWT token for a user with no operator roles.
const unauthorizedAccessToken = makeJwt({
  sub: 'customer-user',
  preferred_username: 'customer',
  realm_access: { roles: ['default-roles-dnd-notes-dev'] },
})
const unauthorizedRefreshToken = makeJwt({ sub: 'customer-user', typ: 'Refresh' })

// JWT carrying the operator role via client-level resource_access only.
const clientRoleAccessToken = makeJwt({
  sub: 'workforce-user',
  preferred_username: 'workforce',
  resource_access: { 'dnd-notes-control-plane': { roles: ['control-plane-workforce'] } },
})

// JWT carrying the admin role via realm_access only.
const realmAdminAccessToken = makeJwt({
  sub: 'admin-user',
  preferred_username: 'admin',
  realm_access: { roles: ['control-plane-admin'] },
})

describe('operator portal', () => {
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

  it('shows the sign-in action when there is no operator session yet', async () => {
    initMock.mockResolvedValue(null)
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('Unexpected fetch')
    })

    render(<App />)

    const user = userEvent.setup()
    const button = await screen.findByRole('button', {
      name: 'Continue',
    })

    expect(screen.getByText('Operator control portal')).toBeTruthy()
    expect(
      screen.getByText(
        'Sign in with your workforce or admin account before inspecting fleet state.',
      ),
    ).toBeTruthy()

    await user.click(button)

    expect(loginMock).toHaveBeenCalledTimes(1)
  })

  it('restores a saved operator session and renders fleet status from the control-plane API', async () => {
    localStorage.setItem(
      storedTokensKey,
      JSON.stringify({
        accessToken: authorizedAccessToken,
        refreshToken: authorizedRefreshToken,
      }),
    )
    initMock.mockResolvedValue({
      accessToken: authorizedAccessToken,
      refreshToken: authorizedRefreshToken,
    })
    refreshMock.mockResolvedValue({
      accessToken: authorizedAccessToken,
      refreshToken: authorizedRefreshToken,
    })

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)

      if (path === '/operator-api/internal/fleet/status' && method === 'GET') {
        return createJsonResponse(fleetStatus)
      }

      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    render(<App />)

    expect(await screen.findByText('Fleet tenants')).toBeTruthy()
    expect(screen.getByText('moonshae-ledger')).toBeTruthy()
    expect(screen.getByText('stormwatch')).toBeTruthy()
    expect(
      screen
        .getAllByRole('alert')
        .some(
          (alert) =>
            alert.textContent?.includes('Portal writes stay on the existing') ?? false,
        ),
    ).toBe(true)
    expect(screen.getByText('Provisioning lane')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Provision tenant' })).toBeTruthy()
  })

  it('clears stale error UI when the operator session is cleared', async () => {
    localStorage.setItem(
      storedTokensKey,
      JSON.stringify({
        accessToken: authorizedAccessToken,
        refreshToken: authorizedRefreshToken,
      }),
    )
    initMock.mockResolvedValue({
      accessToken: authorizedAccessToken,
      refreshToken: authorizedRefreshToken,
    })
    refreshMock.mockResolvedValue({
      accessToken: authorizedAccessToken,
      refreshToken: authorizedRefreshToken,
    })
    logoutMock.mockResolvedValue()

    let fleetStatusRequests = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)

      if (path === '/operator-api/internal/fleet/status' && method === 'GET') {
        fleetStatusRequests += 1

        if (fleetStatusRequests === 1) {
          return createJsonResponse(fleetStatus)
        }

        return createJsonResponse({ error: 'Fleet refresh failed' }, 500)
      }

      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    render(<App />)

    const user = userEvent.setup()
    expect(await screen.findByText('Fleet tenants')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Refresh fleet' }))

    expect(await screen.findByText('Fleet refresh failed')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(
      await screen.findByRole('button', { name: 'Continue' }),
    ).toBeTruthy()
    await waitFor(() => {
      expect(screen.queryByText('Fleet refresh failed')).toBeNull()
    })
  })

  it('renders the operator dashboard for an authenticated user with the workforce role', async () => {
    initMock.mockResolvedValue({
      accessToken: authorizedAccessToken,
      refreshToken: authorizedRefreshToken,
    })
    refreshMock.mockResolvedValue({
      accessToken: authorizedAccessToken,
      refreshToken: authorizedRefreshToken,
    })

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)

      if (path === '/operator-api/internal/fleet/status' && method === 'GET') {
        return createJsonResponse(fleetStatus)
      }

      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    render(<App />)

    expect(await screen.findByText('Fleet tenants')).toBeTruthy()
    expect(screen.queryByTestId('access-denied-view')).toBeNull()
  })

  it('renders the access-denied view for an authenticated user without an operator role', async () => {
    initMock.mockResolvedValue({
      accessToken: unauthorizedAccessToken,
      refreshToken: unauthorizedRefreshToken,
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('Unexpected fetch — fleet must not be loaded for unauthorized users')
    })

    render(<App />)

    expect(await screen.findByTestId('access-denied-view')).toBeTruthy()
    expect(screen.getByText('Access not authorized')).toBeTruthy()
    const customerPortalLink = screen.getByRole('link', { name: /portal/i }) as HTMLAnchorElement
    expect(customerPortalLink.getAttribute('href')).toBe('https://portal.127.0.0.1.nip.io')
    expect(screen.queryByText('Fleet tenants')).toBeNull()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
  })

  it('calls keycloak.logout when signing out from the access-denied view', async () => {
    initMock.mockResolvedValue({
      accessToken: unauthorizedAccessToken,
      refreshToken: unauthorizedRefreshToken,
    })
    logoutMock.mockResolvedValue()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('Unexpected fetch')
    })

    render(<App />)

    const user = userEvent.setup()
    await screen.findByTestId('access-denied-view')
    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(logoutMock).toHaveBeenCalledTimes(1)
  })

  it('grants access based on realm-level role', async () => {
    initMock.mockResolvedValue({
      accessToken: realmAdminAccessToken,
      refreshToken: authorizedRefreshToken,
    })
    refreshMock.mockResolvedValue({
      accessToken: realmAdminAccessToken,
      refreshToken: authorizedRefreshToken,
    })

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)

      if (path === '/operator-api/internal/fleet/status' && method === 'GET') {
        return createJsonResponse(fleetStatus)
      }

      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    render(<App />)

    expect(await screen.findByText('Fleet tenants')).toBeTruthy()
    expect(screen.queryByTestId('access-denied-view')).toBeNull()
  })

  it('grants access based on client-level role under resource_access', async () => {
    initMock.mockResolvedValue({
      accessToken: clientRoleAccessToken,
      refreshToken: authorizedRefreshToken,
    })
    refreshMock.mockResolvedValue({
      accessToken: clientRoleAccessToken,
      refreshToken: authorizedRefreshToken,
    })

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)

      if (path === '/operator-api/internal/fleet/status' && method === 'GET') {
        return createJsonResponse(fleetStatus)
      }

      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    render(<App />)

    expect(await screen.findByText('Fleet tenants')).toBeTruthy()
    expect(screen.queryByTestId('access-denied-view')).toBeNull()
  })
})

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { createJsonResponse, readMockRequest } from './test-helpers'
import type { CustomerKeycloakClient } from './keycloak-client'
import type {
  PortalCatalogResponse,
  PortalDashboardResponse,
} from './types'

const catalog: PortalCatalogResponse = {
  defaultTenantVersion: '0.1.0',
  provisioningConfigured: true,
  slugPolicy: {
    pattern: '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$',
    maxLength: 63,
    example: 'misty-harbor',
  },
  plans: [
    {
      id: 'adventurer',
      name: 'Adventurer',
      priceLabel: '$9/mo placeholder',
      description: 'Single campaign tenant',
      features: ['One tenant instance'],
    },
    {
      id: 'guild',
      name: 'Guild',
      priceLabel: '$29/mo placeholder',
      description: 'Multiple groups',
      features: ['Expanded collaboration headroom'],
    },
  ],
  placeholders: {
    billingStatus: 'placeholder',
    teamInvites: 'coming-soon',
    usageAnalytics: 'coming-soon',
  },
}

const keycloakCatalog: PortalCatalogResponse = { ...catalog }

const baseDashboard: PortalDashboardResponse = {
  account: {
    id: 'account-1',
    email: 'owner@example.com',
    displayName: 'Alyx',
    billingEmail: 'billing@example.com',
    billingProvider: 'stripe',
    keycloakSub: null,
    createdAt: '2026-04-22T20:00:00.000Z',
    updatedAt: '2026-04-22T20:00:00.000Z',
  },
  catalog: {
    ...catalog,
  },
  tenants: [
    {
      tenant: {
        id: 'tenant-1',
        slug: 'misty-harbor',
        subdomain: 't-harbor',
        ownerId: 'account-1',
        displayName: 'Misty Harbor',
        planTier: 'adventurer',
        initialAdminEmail: 'owner@example.com',
        desiredState: 'ready',
        currentState: 'ready',
        version: '0.1.0',
        storageReference: 'pvc-misty-harbor',
        backupMetadata: '{"lastBackupAt":"2026-04-22T20:30:00.000Z"}',
        createdAt: '2026-04-22T20:00:00.000Z',
        updatedAt: '2026-04-22T20:30:00.000Z',
      },
      latestTransition: {
        id: 1,
        tenantId: 'tenant-1',
        fromState: 'provisioning',
        toState: 'ready',
        triggeredBy: 'portal:account-1',
        reason: 'Portal self-serve',
        createdAt: '2026-04-22T20:30:00.000Z',
      },
      backup: {
        rawMetadata: '{"lastBackupAt":"2026-04-22T20:30:00.000Z"}',
        location: 's3://tenant/misty-harbor',
        lastBackupAt: '2026-04-22T20:30:00.000Z',
        lastBackupStatus: 'ok',
        lastRestoreDrillAt: null,
        lastRestoreDrillStatus: null,
      },
      appUrl: 'https://t-harbor.example.com',
      settingsPath: '/dashboard/tenants/tenant-1',
    },
  ],
}

/** Build a minimal keycloak client stub (not authenticated by default). */
function makeKeycloakStub(
  overrides: Partial<CustomerKeycloakClient> = {},
): CustomerKeycloakClient {
  return {
    init: vi.fn().mockResolvedValue(null),
    login: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    freshToken: vi.fn().mockResolvedValue('kc-access-token'),
    ...overrides,
  }
}


describe('customer portal — keycloak mode', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('shows the sign-in entry card when catalog reports keycloak mode and session is unauthenticated', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)

      if (path === '/portal-api/portal/catalog' && method === 'GET') {
        return createJsonResponse(keycloakCatalog)
      }

      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    const stub = makeKeycloakStub({ init: vi.fn().mockResolvedValue(null) })
    render(<App keycloakClientFactory={() => stub} />)

    expect(
      await screen.findByRole('button', { name: 'Sign in' }),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Create portal account' })).toBeNull()
  })

  it('calls keycloak.login when the sign-in button is clicked', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)

      if (path === '/portal-api/portal/catalog' && method === 'GET') {
        return createJsonResponse(keycloakCatalog)
      }

      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    const stub = makeKeycloakStub({ init: vi.fn().mockResolvedValue(null) })
    render(<App keycloakClientFactory={() => stub} />)

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Sign in' }))

    expect(stub.login).toHaveBeenCalledOnce()
    expect(stub.login).toHaveBeenCalledWith(`${window.location.origin}/`)
  })

  it('renders the dashboard after a successful session is restored', async () => {
    const kcDashboard: PortalDashboardResponse = {
      ...baseDashboard,
      account: { ...baseDashboard.account, keycloakSub: 'sub-123' },
      catalog: keycloakCatalog,
    }

    let dashboardAuthHeader: string | null = null

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)

      if (path === '/portal-api/portal/catalog' && method === 'GET') {
        return createJsonResponse(keycloakCatalog)
      }

      if (path === '/portal-api/portal/me' && method === 'GET') {
        const headers = init?.headers instanceof Headers ? init.headers : new Headers(init?.headers as HeadersInit)
        dashboardAuthHeader = headers.get('Authorization')
        return createJsonResponse(kcDashboard)
      }

      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    const stub = makeKeycloakStub({
      init: vi.fn().mockResolvedValue({
        accessToken: 'kc-access-token',
        refreshToken: 'kc-refresh-token',
      }),
      freshToken: vi.fn().mockResolvedValue('kc-access-token'),
    })
    render(<App keycloakClientFactory={() => stub} />)

    expect(await screen.findByText('Customer dashboard')).toBeTruthy()
    expect(await screen.findByText('Misty Harbor')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull()
    expect(stub.freshToken).toHaveBeenCalledOnce()
    expect(dashboardAuthHeader).toBe('Bearer kc-access-token')
  })

  it('calls keycloak.logout when the sign-out button is clicked', async () => {
    const kcDashboard: PortalDashboardResponse = {
      ...baseDashboard,
      account: { ...baseDashboard.account, keycloakSub: 'sub-123' },
      catalog: keycloakCatalog,
    }

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)

      if (path === '/portal-api/portal/catalog' && method === 'GET') {
        return createJsonResponse(keycloakCatalog)
      }

      if (path === '/portal-api/portal/me' && method === 'GET') {
        return createJsonResponse(kcDashboard)
      }

      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    const stub = makeKeycloakStub({
      init: vi.fn().mockResolvedValue({
        accessToken: 'kc-access-token',
        refreshToken: 'kc-refresh-token',
      }),
      freshToken: vi.fn().mockResolvedValue('kc-access-token'),
    })
    render(<App keycloakClientFactory={() => stub} />)

    const user = userEvent.setup()
    await screen.findByText('Customer dashboard')

    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(stub.logout).toHaveBeenCalledOnce()
    expect(stub.logout).toHaveBeenCalledWith(`${window.location.origin}/`)
    expect(
      await screen.findByRole('button', { name: 'Sign in' }),
    ).toBeTruthy()
  })

  it('clears persisted keycloak tokens from sessionStorage when dashboard fetch returns 401', async () => {
    const kcTokensKey = 'dnd-notes:customer-portal:keycloak-tokens'

    sessionStorage.setItem(
      kcTokensKey,
      JSON.stringify({ accessToken: 'kc-access-token', refreshToken: 'kc-refresh-token' }),
    )

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)

      if (path === '/portal-api/portal/catalog' && method === 'GET') {
        return createJsonResponse(keycloakCatalog)
      }

      if (path === '/portal-api/portal/me' && method === 'GET') {
        return createJsonResponse({ error: 'Unauthorized' }, 401)
      }

      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    const stub = makeKeycloakStub({
      init: vi.fn().mockResolvedValue({
        accessToken: 'kc-access-token',
        refreshToken: 'kc-refresh-token',
      }),
      freshToken: vi.fn().mockResolvedValue('kc-access-token'),
    })
    render(<App keycloakClientFactory={() => stub} />)

    // UI should fall back to the entry card (keycloakToken state is null)
    expect(
      await screen.findByRole('button', { name: 'Sign in' }),
    ).toBeTruthy()

    // sessionStorage must also be cleared — prevents the reload loop
    expect(sessionStorage.getItem(kcTokensKey)).toBeNull()
  })
})

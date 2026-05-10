import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { createJsonResponse, readMockJsonBody, readMockRequest } from './test-helpers'
import type { CustomerKeycloakClient } from './keycloak-client'
import type {
  PortalCatalogResponse,
  PortalCreateTenantRequest,
  PortalDashboardResponse,
  PortalSignupRequest,
} from './types'

const storedTokenKey = 'dnd-notes:customer-portal:session-token'

const catalog: PortalCatalogResponse = {
  authMode: 'local',
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

const keycloakCatalog: PortalCatalogResponse = {
  ...catalog,
  authMode: 'keycloak',
}

const baseDashboard: PortalDashboardResponse = {
  account: {
    id: 'account-1',
    email: 'owner@example.com',
    displayName: 'Alyx',
    billingEmail: 'billing@example.com',
    billingProvider: 'stripe',
    authProvider: 'local',
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

describe('customer portal', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('renders the public landing page and plan catalog', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)

      if (path === '/portal-api/portal/catalog' && method === 'GET') {
        return createJsonResponse(catalog)
      }

      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    const stub = makeKeycloakStub()
    render(<App keycloakClientFactory={() => stub} />)

    expect(
      await screen.findByText(
        'Spin up a dedicated D&D note space without waiting on manual ops.',
      ),
    ).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Adventurer' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Guild' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create portal account' })).toBeTruthy()
  })

  it('creates a portal account and renders the dashboard after signup', async () => {
    let signupCount = 0

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)

      if (path === '/portal-api/portal/catalog' && method === 'GET') {
        return createJsonResponse(catalog)
      }

      if (path === '/portal-api/portal/signup' && method === 'POST') {
        const body = readMockJsonBody<PortalSignupRequest>(init)
        signupCount += 1
        expect(body?.email).toBe('owner@example.com')
        expect(body?.password).toBe('top-secret-passphrase')
        expect(body?.planTier).toBe('adventurer')
        expect(body?.tenantSlug).toBe(signupCount === 1 ? 'misty-harbor' : 'second-harbor')

        return createJsonResponse({
          token: 'portal-session-token',
          dashboard: baseDashboard,
        }, 201)
      }

      if (path === '/portal-api/portal/logout' && method === 'POST') {
        return createJsonResponse({ signedOut: true })
      }

      if (path === '/portal-api/portal/me' && method === 'GET') {
        return createJsonResponse(baseDashboard)
      }

      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    const stub = makeKeycloakStub()
    render(<App keycloakClientFactory={() => stub} />)

    const user = userEvent.setup()
    await screen.findByLabelText('Work email')

    await user.type(screen.getByLabelText('Work email'), 'owner@example.com')
    await user.type(screen.getByLabelText('Display name'), 'Alyx')
    await user.type(screen.getAllByLabelText('Password')[0], 'top-secret-passphrase')
    await user.type(screen.getByLabelText('Tenant name'), 'Misty Harbor')
    await user.click(screen.getByRole('button', { name: 'Create portal account' }))

    expect(await screen.findByText('Customer dashboard')).toBeTruthy()
    expect(screen.getByText('Misty Harbor')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open tenant app' })).toBeTruthy()
    expect(sessionStorage.getItem(storedTokenKey)).toBe('portal-session-token')

    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    await screen.findByRole('button', { name: 'Create portal account' })

    await user.type(screen.getByLabelText('Work email'), 'owner@example.com')
    await user.type(screen.getByLabelText('Display name'), 'Alyx')
    await user.type(screen.getAllByLabelText('Password')[0], 'top-secret-passphrase')
    await user.type(screen.getByLabelText('Tenant name'), 'Second Harbor')
    await user.click(screen.getByRole('button', { name: 'Create portal account' }))

    expect(await screen.findByText('Customer dashboard')).toBeTruthy()
    expect(signupCount).toBe(2)
  })

  it('does not re-fetch the dashboard immediately after signup succeeds', async () => {
    let dashboardFetchCount = 0

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)

      if (path === '/portal-api/portal/catalog' && method === 'GET') {
        return createJsonResponse(catalog)
      }

      if (path === '/portal-api/portal/signup' && method === 'POST') {
        return createJsonResponse(
          {
            token: 'portal-session-token',
            dashboard: baseDashboard,
          },
          201,
        )
      }

      if (path === '/portal-api/portal/me' && method === 'GET') {
        dashboardFetchCount += 1
        return createJsonResponse({ error: 'unexpected restore request' }, 500)
      }

      if (path === '/portal-api/portal/logout' && method === 'POST') {
        return createJsonResponse({ signedOut: true })
      }

      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    const stub = makeKeycloakStub()
    render(<App keycloakClientFactory={() => stub} />)

    const user = userEvent.setup()
    await screen.findByLabelText('Work email')

    await user.type(screen.getByLabelText('Work email'), 'owner@example.com')
    await user.type(screen.getByLabelText('Display name'), 'Alyx')
    await user.type(screen.getAllByLabelText('Password')[0], 'top-secret-passphrase')
    await user.type(screen.getByLabelText('Tenant name'), 'Misty Harbor')
    await user.click(screen.getByRole('button', { name: 'Create portal account' }))

    expect(await screen.findByText('Customer dashboard')).toBeTruthy()
    expect(screen.getByText('Misty Harbor')).toBeTruthy()
    expect(screen.queryByText('Failed to restore the customer portal session.')).toBeNull()
    expect(sessionStorage.getItem(storedTokenKey)).toBe('portal-session-token')
    expect(dashboardFetchCount).toBe(0)
  })

  it('does not re-fetch the dashboard immediately after login succeeds', async () => {
    let dashboardFetchCount = 0

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)

      if (path === '/portal-api/portal/catalog' && method === 'GET') {
        return createJsonResponse(catalog)
      }

      if (path === '/portal-api/portal/login' && method === 'POST') {
        return createJsonResponse(
          {
            token: 'portal-session-token',
            dashboard: baseDashboard,
          },
          200,
        )
      }

      if (path === '/portal-api/portal/me' && method === 'GET') {
        dashboardFetchCount += 1
        return createJsonResponse({ error: 'unexpected restore request' }, 500)
      }

      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    const stub = makeKeycloakStub()
    render(<App keycloakClientFactory={() => stub} />)

    const user = userEvent.setup()
    await screen.findByLabelText('Portal email')

    await user.type(screen.getByLabelText('Portal email'), 'owner@example.com')
    await user.type(screen.getAllByLabelText('Password')[1], 'top-secret-passphrase')
    await user.click(screen.getByRole('button', { name: 'Restore dashboard' }))

    expect(await screen.findByText('Customer dashboard')).toBeTruthy()
    expect(screen.getByText('Misty Harbor')).toBeTruthy()
    expect(screen.queryByText('Failed to restore the customer portal session.')).toBeNull()
    expect(sessionStorage.getItem(storedTokenKey)).toBe('portal-session-token')
    expect(dashboardFetchCount).toBe(0)

    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('button', { name: 'Restore dashboard' })).toBeTruthy()
    expect(
      (screen.getAllByLabelText('Password')[1] as HTMLInputElement).value,
    ).toBe('')
  })

  it('creates an additional tenant from the customer dashboard', async () => {
    sessionStorage.setItem(storedTokenKey, 'portal-session-token')
    const tenantRequests: PortalCreateTenantRequest[] = []

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)

      if (path === '/portal-api/portal/catalog' && method === 'GET') {
        return createJsonResponse(catalog)
      }

      if (path === '/portal-api/portal/me' && method === 'GET') {
        return createJsonResponse(baseDashboard)
      }

      if (path === '/portal-api/portal/me/tenants' && method === 'POST') {
        const body = readMockJsonBody<PortalCreateTenantRequest>(init)
        expect(body).toBeTruthy()
        tenantRequests.push(body!)

        return createJsonResponse({
          ...baseDashboard,
          tenants: [
            ...baseDashboard.tenants,
            {
              tenant: {
                id: 'tenant-2',
                slug: 'emberfall',
                subdomain: 't-emberfall',
                ownerId: 'account-1',
                displayName: 'Emberfall',
                planTier: 'guild',
                initialAdminEmail: 'owner@example.com',
                desiredState: 'provisioning',
                currentState: 'provisioning',
                version: '0.1.0',
                storageReference: null,
                backupMetadata: null,
                createdAt: '2026-04-22T21:00:00.000Z',
                updatedAt: '2026-04-22T21:00:00.000Z',
              },
              latestTransition: {
                id: 2,
                tenantId: 'tenant-2',
                fromState: 'provisioning',
                toState: 'provisioning',
                triggeredBy: 'system',
                reason: 'Tenant creation',
                createdAt: '2026-04-22T21:00:00.000Z',
              },
              backup: {
                rawMetadata: null,
                location: null,
                lastBackupAt: null,
                lastBackupStatus: null,
                lastRestoreDrillAt: null,
                lastRestoreDrillStatus: null,
              },
              appUrl: null,
              settingsPath: '/dashboard/tenants/tenant-2',
            },
          ],
        }, 201)
      }

      if (path === '/portal-api/portal/logout' && method === 'POST') {
        return createJsonResponse({ signedOut: true })
      }

      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    const stub = makeKeycloakStub()
    render(<App keycloakClientFactory={() => stub} />)

    const user = userEvent.setup()
    expect(await screen.findByText('Customer dashboard')).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'Add another tenant' })).toBeTruthy()

    await user.click(screen.getByLabelText('Plan'))
    await user.click(await screen.findByRole('option', { name: 'Guild' }))
    await user.click(screen.getByLabelText('Payment provider'))
    await user.click(await screen.findByRole('option', { name: 'Square (coming soon)' }))
    await user.type(screen.getByLabelText('Tenant name'), 'Emberfall')
    await user.clear(screen.getByLabelText('Tenant slug'))
    await user.type(screen.getByLabelText('Tenant slug'), 'emberfall')
    await user.click(screen.getByRole('button', { name: 'Create tenant request' }))

    expect(await screen.findByText('Emberfall')).toBeTruthy()
    expect(
      screen.getByText(
        'Tenant request submitted. The dashboard now reflects the latest instance list.',
      ),
    ).toBeTruthy()

    await user.type(screen.getByLabelText('Tenant name'), 'Second Emberfall')
    await user.clear(screen.getByLabelText('Tenant slug'))
    await user.type(screen.getByLabelText('Tenant slug'), 'second-emberfall')
    await user.click(screen.getByRole('button', { name: 'Create tenant request' }))

    expect(tenantRequests).toHaveLength(2)
    expect(tenantRequests[0]?.planTier).toBe('guild')
    expect(tenantRequests[0]?.paymentProvider).toBe('square')
    expect(tenantRequests[1]?.planTier).toBe('guild')
    expect(tenantRequests[1]?.paymentProvider).toBe('square')
  })

  it('clears the dashboard after sign out', async () => {
    sessionStorage.setItem(storedTokenKey, 'portal-session-token')

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)

      if (path === '/portal-api/portal/catalog' && method === 'GET') {
        return createJsonResponse(catalog)
      }

      if (path === '/portal-api/portal/me' && method === 'GET') {
        return createJsonResponse(baseDashboard)
      }

      if (path === '/portal-api/portal/logout' && method === 'POST') {
        return createJsonResponse({ signedOut: true })
      }

      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    const stub = makeKeycloakStub()
    render(<App keycloakClientFactory={() => stub} />)

    const user = userEvent.setup()
    expect(await screen.findByText('Customer dashboard')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('button', { name: 'Create portal account' })).toBeTruthy()
    await waitFor(() => {
      expect(sessionStorage.getItem(storedTokenKey)).toBeNull()
    })
  })

  it('shows "Create your first workspace" heading when dashboard has zero tenants', async () => {
    const emptyDashboard: PortalDashboardResponse = {
      ...baseDashboard,
      tenants: [],
    }

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)

      if (path === '/portal-api/portal/catalog' && method === 'GET') {
        return createJsonResponse(catalog)
      }

      if (path === '/portal-api/portal/login' && method === 'POST') {
        return createJsonResponse({ token: 'portal-session-token', dashboard: emptyDashboard }, 200)
      }

      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    const stub = makeKeycloakStub()
    render(<App keycloakClientFactory={() => stub} />)

    const user = userEvent.setup()
    await screen.findByLabelText('Portal email')
    await user.type(screen.getByLabelText('Portal email'), 'owner@example.com')
    await user.type(screen.getAllByLabelText('Password')[1], 'secret')
    await user.click(screen.getByRole('button', { name: 'Restore dashboard' }))

    expect(
      await screen.findByRole('heading', { name: 'Create your first workspace' }),
    ).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Add another tenant' })).toBeNull()
  })

  it('shows "Add another tenant" heading when dashboard already has at least one tenant', async () => {
    sessionStorage.setItem(storedTokenKey, 'portal-session-token')

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)

      if (path === '/portal-api/portal/catalog' && method === 'GET') {
        return createJsonResponse(catalog)
      }

      if (path === '/portal-api/portal/me' && method === 'GET') {
        return createJsonResponse(baseDashboard)
      }

      if (path === '/portal-api/portal/logout' && method === 'POST') {
        return createJsonResponse({ signedOut: true })
      }

      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    const stub = makeKeycloakStub()
    render(<App keycloakClientFactory={() => stub} />)

    expect(await screen.findByRole('heading', { name: 'Add another tenant' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Create your first workspace' })).toBeNull()
  })

  it('shows payment provider options with "(coming soon)" labels', async () => {
    sessionStorage.setItem(storedTokenKey, 'portal-session-token')

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)

      if (path === '/portal-api/portal/catalog' && method === 'GET') {
        return createJsonResponse(catalog)
      }

      if (path === '/portal-api/portal/me' && method === 'GET') {
        return createJsonResponse(baseDashboard)
      }

      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    const stub = makeKeycloakStub()
    render(<App keycloakClientFactory={() => stub} />)

    const user = userEvent.setup()
    await screen.findByText('Customer dashboard')

    await user.click(screen.getByLabelText('Payment provider'))
    expect(await screen.findByRole('option', { name: 'Stripe (coming soon)' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Square (coming soon)' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Manual review (coming soon)' })).toBeTruthy()
  })

  it('polls dashboard every ~4 s while a tenant is in a transient state and shows in-progress notice', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    sessionStorage.setItem(storedTokenKey, 'portal-session-token')

    const provisioningDashboard: PortalDashboardResponse = {
      ...baseDashboard,
      tenants: [
        {
          ...baseDashboard.tenants[0]!,
          tenant: {
            ...baseDashboard.tenants[0]!.tenant,
            currentState: 'provisioning',
            desiredState: 'ready',
          },
          appUrl: null,
        },
      ],
    }

    let meCallCount = 0

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)

      if (path === '/portal-api/portal/catalog' && method === 'GET') {
        return createJsonResponse(catalog)
      }

      if (path === '/portal-api/portal/me' && method === 'GET') {
        meCallCount += 1
        return createJsonResponse(provisioningDashboard)
      }

      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    const stub = makeKeycloakStub()
    render(<App keycloakClientFactory={() => stub} />)

    // Wait for the initial dashboard load to complete (needs real microtasks)
    await vi.runAllTimersAsync()
    expect(meCallCount).toBeGreaterThanOrEqual(1)

    // Advance past the polling interval
    await vi.advanceTimersByTimeAsync(4100)
    expect(meCallCount).toBeGreaterThanOrEqual(2)

    expect(
      screen.getByText('Provisioning is in progress. The dashboard updates automatically — no need to refresh.'),
    ).toBeTruthy()
  })

  it('auto-navigates when the single tenant transitions from provisioning to ready', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    sessionStorage.setItem(storedTokenKey, 'portal-session-token')

    const provisioningDashboard: PortalDashboardResponse = {
      ...baseDashboard,
      tenants: [
        {
          ...baseDashboard.tenants[0]!,
          tenant: {
            ...baseDashboard.tenants[0]!.tenant,
            currentState: 'provisioning',
            desiredState: 'ready',
          },
          appUrl: null,
        },
      ],
    }

    const readyDashboard: PortalDashboardResponse = {
      ...baseDashboard,
    }

    let meCallCount = 0

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)

      if (path === '/portal-api/portal/catalog' && method === 'GET') {
        return createJsonResponse(catalog)
      }

      if (path === '/portal-api/portal/me' && method === 'GET') {
        meCallCount += 1
        // First call: provisioning. Second call onwards: ready.
        return createJsonResponse(meCallCount === 1 ? provisioningDashboard : readyDashboard)
      }

      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    const navigated: string[] = []
    const stub = makeKeycloakStub()
    render(<App keycloakClientFactory={() => stub} navigate={(url) => navigated.push(url)} />)

    // Let initial load settle (catalog + dashboard)
    await vi.runAllTimersAsync()
    expect(meCallCount).toBeGreaterThanOrEqual(1)

    // Advance past the polling interval to fire the setInterval callback
    await vi.advanceTimersByTimeAsync(4100)
    // Flush the resulting microtasks (the poll async function resolves)
    await vi.runAllTimersAsync()

    expect(navigated).toContain('https://t-harbor.example.com')
  })

  it('shows an error alert when a tenant is in failed state', async () => {
    sessionStorage.setItem(storedTokenKey, 'portal-session-token')

    const failedDashboard: PortalDashboardResponse = {
      ...baseDashboard,
      tenants: [
        {
          ...baseDashboard.tenants[0]!,
          tenant: {
            ...baseDashboard.tenants[0]!.tenant,
            currentState: 'failed',
            desiredState: 'ready',
          },
          appUrl: null,
        },
      ],
    }

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)

      if (path === '/portal-api/portal/catalog' && method === 'GET') {
        return createJsonResponse(catalog)
      }

      if (path === '/portal-api/portal/me' && method === 'GET') {
        return createJsonResponse(failedDashboard)
      }

      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    const stub = makeKeycloakStub()
    render(<App keycloakClientFactory={() => stub} />)

    expect(
      await screen.findByText(
        'Provisioning failed for this workspace. You can retry by creating a new tenant request, or contact support if the issue persists.',
      ),
    ).toBeTruthy()
  })
})

describe('customer portal — keycloak mode', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('shows the Keycloak entry card when catalog reports keycloak mode and session is unauthenticated', async () => {
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
      await screen.findByRole('button', { name: 'Sign in with Keycloak' }),
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
    await user.click(await screen.findByRole('button', { name: 'Sign in with Keycloak' }))

    expect(stub.login).toHaveBeenCalledOnce()
    expect(stub.login).toHaveBeenCalledWith(`${window.location.origin}/`)
  })

  it('renders the dashboard after a successful Keycloak session is restored', async () => {
    const kcDashboard: PortalDashboardResponse = {
      ...baseDashboard,
      account: { ...baseDashboard.account, authProvider: 'keycloak', keycloakSub: 'sub-123' },
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
    expect(screen.queryByRole('button', { name: 'Sign in with Keycloak' })).toBeNull()
    expect(stub.freshToken).toHaveBeenCalledOnce()
    expect(dashboardAuthHeader).toBe('Bearer kc-access-token')
  })

  it('calls keycloak.logout when the sign-out button is clicked', async () => {
    const kcDashboard: PortalDashboardResponse = {
      ...baseDashboard,
      account: { ...baseDashboard.account, authProvider: 'keycloak', keycloakSub: 'sub-123' },
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
      await screen.findByRole('button', { name: 'Sign in with Keycloak' }),
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
      await screen.findByRole('button', { name: 'Sign in with Keycloak' }),
    ).toBeTruthy()

    // sessionStorage must also be cleared — prevents the reload loop
    expect(sessionStorage.getItem(kcTokensKey)).toBeNull()
  })
})

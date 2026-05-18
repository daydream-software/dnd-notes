/**
 * Tenant-creation flow tests (Keycloak-authenticated dashboard).
 *
 * Covered:
 *   1. Empty tenant name (HTML5 required) — fetch not called for POST /portal/me/tenants
 *   2. Slug auto-normalizes on tenant name input
 *   3. API 422 with structured error body — error alert shown, form data preserved
 *   4. API 500 — generic error alert, modal stays open with draft preserved
 *   5. Plan dropdown default (first catalog plan) is sent in the request body
 *   6. Plan dropdown selection change updates the planTier in the request body
 *
 * Replaces the deleted local-auth equivalents (App.tenant-create-errors.test.tsx
 * and App.plan-selection.test.tsx in #316) post-Phase 2 exit (#318). The
 * create-tenant form is the only place the plan dropdown still surfaces now
 * that the pre-auth signup flow is gone.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { createJsonResponse, readMockRequest } from './test-helpers'
import type { CustomerKeycloakClient } from './keycloak-client'
import type {
  PortalCatalogResponse,
  PortalDashboardResponse,
  PortalPlan,
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

function makeCatalog(plans: PortalPlan[]): PortalCatalogResponse {
  return { ...catalog, plans }
}

const baseDashboard: PortalDashboardResponse = {
  account: {
    id: 'account-1',
    email: 'owner@example.com',
    displayName: 'Alyx',
    billingEmail: 'billing@example.com',
    billingProvider: 'stripe',
    keycloakSub: 'sub-123',
    createdAt: '2026-04-22T20:00:00.000Z',
    updatedAt: '2026-04-22T20:00:00.000Z',
  },
  catalog,
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
        backupMetadata: null,
        createdAt: '2026-04-22T20:00:00.000Z',
        updatedAt: '2026-04-22T20:30:00.000Z',
      },
      latestTransition: null,
      backup: {
        rawMetadata: null,
        location: null,
        lastBackupAt: null,
        lastBackupStatus: null,
        lastRestoreDrillAt: null,
        lastRestoreDrillStatus: null,
      },
      appUrl: 'https://t-harbor.example.com',
      settingsPath: '/dashboard/tenants/tenant-1',
    },
  ],
}

/**
 * Returns a Keycloak stub primed for an already-authenticated dashboard load:
 * init() resolves tokens, freshToken() resolves a stable access token used
 * for the /portal/me Authorization header.
 */
function makeAuthenticatedKeycloakStub(
  overrides: Partial<CustomerKeycloakClient> = {},
): CustomerKeycloakClient {
  return {
    init: vi.fn().mockResolvedValue({
      accessToken: 'kc-access-token',
      refreshToken: 'kc-refresh-token',
    }),
    login: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    freshToken: vi.fn().mockResolvedValue('kc-access-token'),
    ...overrides,
  }
}

describe('customer portal — tenant creation (Keycloak)', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('does not call the create-tenant endpoint when the tenant name is empty', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)
      if (path === '/portal-api/portal/catalog' && method === 'GET') {
        return createJsonResponse(catalog)
      }
      if (path === '/portal-api/portal/me' && method === 'GET') {
        return createJsonResponse(baseDashboard)
      }
      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    const stub = makeAuthenticatedKeycloakStub()
    render(<App keycloakClientFactory={() => stub} />)

    const user = userEvent.setup()
    expect(await screen.findByRole('heading', { name: 'Add another tenant' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Create tenant request' }))

    const createCalls = vi.mocked(fetchSpy).mock.calls.filter(([input, init]) => {
      const { path, method } = readMockRequest(input, init)
      return path === '/portal-api/portal/me/tenants' && method === 'POST'
    })
    expect(createCalls).toHaveLength(0)

    expect(
      screen.queryByText('Tenant request submitted. The dashboard now reflects the latest instance list.'),
    ).toBeNull()
  })

  it('auto-normalizes the tenant slug from the tenant name input', async () => {
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

    const stub = makeAuthenticatedKeycloakStub()
    render(<App keycloakClientFactory={() => stub} />)

    const user = userEvent.setup()
    expect(await screen.findByRole('heading', { name: 'Add another tenant' })).toBeTruthy()

    await user.type(screen.getByLabelText('Tenant name'), 'Ember Falls Campaign')

    const slugInput = screen.getByLabelText('Tenant slug') as HTMLInputElement
    expect(slugInput.value).toBe('ember-falls-campaign')
  })

  it('shows an error alert on API 422 and preserves the form data', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)
      if (path === '/portal-api/portal/catalog' && method === 'GET') {
        return createJsonResponse(catalog)
      }
      if (path === '/portal-api/portal/me' && method === 'GET') {
        return createJsonResponse(baseDashboard)
      }
      if (path === '/portal-api/portal/me/tenants' && method === 'POST') {
        return createJsonResponse(
          { error: 'Slug already taken', details: 'Choose a different slug.' },
          422,
        )
      }
      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    const stub = makeAuthenticatedKeycloakStub()
    render(<App keycloakClientFactory={() => stub} />)

    const user = userEvent.setup()
    expect(await screen.findByRole('heading', { name: 'Add another tenant' })).toBeTruthy()

    await user.type(screen.getByLabelText('Tenant name'), 'Emberfall')
    await user.click(screen.getByRole('button', { name: 'Create tenant request' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy()
    })
    expect(screen.getByRole('alert').textContent).toContain('Slug already taken')

    expect(screen.getByRole('heading', { name: 'Add another tenant' })).toBeTruthy()
    expect((screen.getByLabelText('Tenant name') as HTMLInputElement).value).toBe('Emberfall')
  })

  it('shows a generic error alert on API 500 and keeps the form open', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)
      if (path === '/portal-api/portal/catalog' && method === 'GET') {
        return createJsonResponse(catalog)
      }
      if (path === '/portal-api/portal/me' && method === 'GET') {
        return createJsonResponse(baseDashboard)
      }
      if (path === '/portal-api/portal/me/tenants' && method === 'POST') {
        return createJsonResponse({ error: 'Internal server error' }, 500)
      }
      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    const stub = makeAuthenticatedKeycloakStub()
    render(<App keycloakClientFactory={() => stub} />)

    const user = userEvent.setup()
    expect(await screen.findByRole('heading', { name: 'Add another tenant' })).toBeTruthy()

    await user.type(screen.getByLabelText('Tenant name'), 'Emberfall')
    await user.click(screen.getByRole('button', { name: 'Create tenant request' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy()
    })
    expect(screen.getByRole('alert').textContent).toContain('Internal server error')

    expect(screen.getByRole('button', { name: 'Create tenant request' })).toBeTruthy()
    expect(
      screen.queryByText('Tenant request submitted. The dashboard now reflects the latest instance list.'),
    ).toBeNull()
  })

  it('sends the first catalog plan as the default planTier when the dropdown is left untouched', async () => {
    const multiPlanCatalog = makeCatalog([
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
    ])
    const dashboardWithCatalog: PortalDashboardResponse = {
      ...baseDashboard,
      catalog: multiPlanCatalog,
    }

    let capturedPlanTier: string | undefined

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)
      if (path === '/portal-api/portal/catalog' && method === 'GET') {
        return createJsonResponse(multiPlanCatalog)
      }
      if (path === '/portal-api/portal/me' && method === 'GET') {
        return createJsonResponse(dashboardWithCatalog)
      }
      if (path === '/portal-api/portal/me/tenants' && method === 'POST') {
        const body = JSON.parse(init?.body as string) as { planTier?: string }
        capturedPlanTier = body.planTier
        return createJsonResponse({ error: 'Create blocked in default-plan test' }, 500)
      }
      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    const stub = makeAuthenticatedKeycloakStub()
    render(<App keycloakClientFactory={() => stub} />)

    const user = userEvent.setup()
    expect(await screen.findByRole('heading', { name: 'Add another tenant' })).toBeTruthy()

    await user.type(screen.getByLabelText('Tenant name'), 'Default Plan Tenant')
    await user.click(screen.getByRole('button', { name: 'Create tenant request' }))

    await screen.findByRole('alert')

    expect(capturedPlanTier).toBe('adventurer')
  })

  it('updates the planTier in the request body when a different plan is selected', async () => {
    const multiPlanCatalog = makeCatalog([
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
    ])
    const dashboardWithCatalog: PortalDashboardResponse = {
      ...baseDashboard,
      catalog: multiPlanCatalog,
    }

    let capturedPlanTier: string | undefined

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)
      if (path === '/portal-api/portal/catalog' && method === 'GET') {
        return createJsonResponse(multiPlanCatalog)
      }
      if (path === '/portal-api/portal/me' && method === 'GET') {
        return createJsonResponse(dashboardWithCatalog)
      }
      if (path === '/portal-api/portal/me/tenants' && method === 'POST') {
        const body = JSON.parse(init?.body as string) as { planTier?: string }
        capturedPlanTier = body.planTier
        return createJsonResponse({ error: 'Create intentionally blocked' }, 500)
      }
      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    const stub = makeAuthenticatedKeycloakStub()
    render(<App keycloakClientFactory={() => stub} />)

    const user = userEvent.setup()
    expect(await screen.findByRole('heading', { name: 'Add another tenant' })).toBeTruthy()

    await user.click(screen.getByLabelText('Plan'))
    await user.click(await screen.findByRole('option', { name: 'Guild' }))

    await user.type(screen.getByLabelText('Tenant name'), 'Emberfall')
    await user.click(screen.getByRole('button', { name: 'Create tenant request' }))

    await screen.findByRole('alert')

    expect(capturedPlanTier).toBe('guild')
  })
})

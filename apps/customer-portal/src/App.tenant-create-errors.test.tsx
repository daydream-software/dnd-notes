/**
 * Error-path tests for the customer portal tenant creation flow (local-auth mode).
 *
 * Covered:
 *   1. Empty tenant name (HTML5 required) — fetch not called for POST /portal/me/tenants.
 *   2. Slug auto-normalizes on tenant name input (no separate slug entry needed).
 *   3. API 422 with structured error body — error alert shown, form data preserved.
 *   4. API 500 — generic error alert, modal stays open with draft preserved.
 *
 * Deferred:
 *   - "Invalid slug pattern → validation error": App.tsx normalizeSlug() is
 *     applied on every onChange keystroke; there is no pattern-based client-side
 *     validation error rendered in the UI. The slug is always silently normalized.
 *   - "Plan field omitted → validation error": the Plan <TextField select> has no
 *     `required` attribute and auto-defaults to catalog.plans[0].id. There is no
 *     plan-required validation path.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { createJsonResponse, readMockRequest } from './test-helpers'
import type { CustomerKeycloakClient } from './keycloak-client'
import type { PortalCatalogResponse, PortalDashboardResponse } from './types'

const sessionTokenStorageKey = 'dnd-notes:customer-portal:session-token'

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

describe('customer portal — tenant creation errors', () => {
  beforeEach(() => {
    sessionStorage.clear()
    sessionStorage.setItem(sessionTokenStorageKey, 'portal-session-token')
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

    const stub = makeKeycloakStub()
    render(<App keycloakClientFactory={() => stub} />)

    const user = userEvent.setup()
    // Wait for the dashboard to render (session token is seeded).
    expect(await screen.findByRole('heading', { name: 'Add another tenant' })).toBeTruthy()

    // Submit without touching the tenant name (it's empty by default).
    await user.click(screen.getByRole('button', { name: 'Create tenant request' }))

    // The create-tenant POST must not fire.
    const createCalls = vi.mocked(fetchSpy).mock.calls.filter(([input, init]) => {
      const { path, method } = readMockRequest(input, init)
      return path === '/portal-api/portal/me/tenants' && method === 'POST'
    })
    expect(createCalls).toHaveLength(0)

    // The success notice must not appear.
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

    const stub = makeKeycloakStub()
    render(<App keycloakClientFactory={() => stub} />)

    const user = userEvent.setup()
    expect(await screen.findByRole('heading', { name: 'Add another tenant' })).toBeTruthy()

    // Typing a name with uppercase and spaces should produce a normalized slug.
    await user.type(screen.getByLabelText('Tenant name'), 'Ember Falls Campaign')

    const slugInput = screen.getByLabelText('Tenant slug') as HTMLInputElement
    // Normalized slug: lowercase, spaces → hyphens.
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

    const stub = makeKeycloakStub()
    render(<App keycloakClientFactory={() => stub} />)

    const user = userEvent.setup()
    expect(await screen.findByRole('heading', { name: 'Add another tenant' })).toBeTruthy()

    await user.type(screen.getByLabelText('Tenant name'), 'Emberfall')
    await user.click(screen.getByRole('button', { name: 'Create tenant request' }))

    // Error alert must appear with the server message.
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy()
    })
    expect(screen.getByRole('alert').textContent).toContain('Slug already taken')

    // The create form must still be visible (dashboard heading still present).
    expect(screen.getByRole('heading', { name: 'Add another tenant' })).toBeTruthy()

    // The form data must be preserved — tenant name field retains its value.
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

    const stub = makeKeycloakStub()
    render(<App keycloakClientFactory={() => stub} />)

    const user = userEvent.setup()
    expect(await screen.findByRole('heading', { name: 'Add another tenant' })).toBeTruthy()

    await user.type(screen.getByLabelText('Tenant name'), 'Emberfall')
    await user.click(screen.getByRole('button', { name: 'Create tenant request' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy()
    })
    expect(screen.getByRole('alert').textContent).toContain('Internal server error')

    // Form must still be present.
    expect(screen.getByRole('button', { name: 'Create tenant request' })).toBeTruthy()

    // Positive assertion: no success notice appeared.
    expect(
      screen.queryByText('Tenant request submitted. The dashboard now reflects the latest instance list.'),
    ).toBeNull()
  })
})

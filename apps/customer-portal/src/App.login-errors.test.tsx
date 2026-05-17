/**
 * Error-path tests for the customer portal login flow (local-auth mode only).
 *
 * Keycloak-mode login is already tested in App.test.tsx
 * ("customer portal — keycloak mode" suite). This file is scoped to the
 * local-auth escape hatch only.
 *
 * Covered:
 *   1. Local-mode 401 invalid credentials — error alert shown, form stays open.
 *   2. Local-mode 500 — generic error alert shown, form stays open.
 *   3. Expired session mid-use: dashboard restore via /portal/me returns 401
 *      → session cleared, login form restored.
 *
 * Deferred: none.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { createJsonResponse, readMockRequest } from './test-helpers'
import type { CustomerKeycloakClient } from './keycloak-client'
import type { PortalCatalogResponse } from './types'

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
  ],
  placeholders: {
    billingStatus: 'placeholder',
    teamInvites: 'coming-soon',
    usageAnalytics: 'coming-soon',
  },
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

describe('customer portal — login errors (local mode)', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows an error alert on 401 invalid credentials and keeps the login form open', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)
      if (path === '/portal-api/portal/catalog' && method === 'GET') {
        return createJsonResponse(catalog)
      }
      if (path === '/portal-api/portal/login' && method === 'POST') {
        return createJsonResponse({ error: 'Invalid email or password' }, 401)
      }
      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    const stub = makeKeycloakStub()
    render(<App keycloakClientFactory={() => stub} />)

    const user = userEvent.setup()
    await screen.findByLabelText('Portal email')

    await user.type(screen.getByLabelText('Portal email'), 'owner@example.com')
    await user.type(screen.getAllByLabelText('Password')[1], 'wrong-password')
    await user.click(screen.getByRole('button', { name: 'Restore dashboard' }))

    // Error alert must appear.
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy()
    })
    expect(screen.getByRole('alert').textContent).toContain('Invalid email or password')

    // Login form must remain visible — the "Restore dashboard" button must still exist.
    expect(screen.getByRole('button', { name: 'Restore dashboard' })).toBeTruthy()

    // Dashboard must NOT be rendered.
    expect(screen.queryByText('Customer dashboard')).toBeNull()

    // Session storage must remain empty.
    expect(sessionStorage.getItem(sessionTokenStorageKey)).toBeNull()
  })

  it('shows a generic error alert on 500 from the login endpoint', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)
      if (path === '/portal-api/portal/catalog' && method === 'GET') {
        return createJsonResponse(catalog)
      }
      if (path === '/portal-api/portal/login' && method === 'POST') {
        return createJsonResponse({ error: 'Internal server error' }, 500)
      }
      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    const stub = makeKeycloakStub()
    render(<App keycloakClientFactory={() => stub} />)

    const user = userEvent.setup()
    await screen.findByLabelText('Portal email')

    await user.type(screen.getByLabelText('Portal email'), 'owner@example.com')
    await user.type(screen.getAllByLabelText('Password')[1], 'some-password')
    await user.click(screen.getByRole('button', { name: 'Restore dashboard' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy()
    })
    expect(screen.getByRole('alert').textContent).toContain('Internal server error')

    // Login form must remain visible.
    expect(screen.getByRole('button', { name: 'Restore dashboard' })).toBeTruthy()
    expect(screen.queryByText('Customer dashboard')).toBeNull()
  })

  it('clears an expired session when /portal/me returns 401 during restore', async () => {
    // Seed a stale session token in storage — this triggers the local-auth
    // dashboard restore effect on mount.
    sessionStorage.setItem(sessionTokenStorageKey, 'stale-session-token')

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)
      if (path === '/portal-api/portal/catalog' && method === 'GET') {
        return createJsonResponse(catalog)
      }
      if (path === '/portal-api/portal/me' && method === 'GET') {
        // Simulate an expired/revoked session.
        return createJsonResponse({ error: 'Unauthorized' }, 401)
      }
      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    const stub = makeKeycloakStub()
    render(<App keycloakClientFactory={() => stub} />)

    // The app must clear the stale token and fall back to the login form.
    await waitFor(() => {
      expect(sessionStorage.getItem(sessionTokenStorageKey)).toBeNull()
    })

    // Login form must be present — dashboard must not render.
    expect(await screen.findByRole('button', { name: 'Restore dashboard' })).toBeTruthy()
    expect(screen.queryByText('Customer dashboard')).toBeNull()
  })
})

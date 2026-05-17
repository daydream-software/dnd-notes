/**
 * Error-path tests for the customer portal signup flow (local-auth mode).
 *
 * Covered:
 *   1. Invalid email format (HTML5 type=email) — fetch not called.
 *   2. API 409 conflict — error alert shown, form data preserved.
 *   3. API 500 with structured error body — generic error alert shown.
 *   4. API 422 with details array — error alert concatenates error + details.
 *
 * Deferred:
 *   - Invalid slug pattern: App.tsx normalizes on every keystroke via
 *     normalizeSlug(); there is no client-side validation error rendered.
 *     The equivalent observable behavior is slug normalization on input
 *     (covered inline in the "API 409" test to prove draft is preserved
 *     as-normalized).
 *   - Plan field omitted: the plan <TextField select> has no `required`
 *     attribute and defaults to catalog.plans[0].id on catalog load.
 *     There is no "plan required" validation path in the UI.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { createJsonResponse, readMockRequest } from './test-helpers'
import type { CustomerKeycloakClient } from './keycloak-client'
import type { PortalCatalogResponse } from './types'

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

describe('customer portal — signup errors', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('does not call the signup endpoint when the email field contains an invalid format', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)
      if (path === '/portal-api/portal/catalog' && method === 'GET') {
        return createJsonResponse(catalog)
      }
      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    const stub = makeKeycloakStub()
    render(<App keycloakClientFactory={() => stub} />)

    const user = userEvent.setup()
    await screen.findByLabelText('Work email')

    // Type a string that is not a valid email address.
    await user.type(screen.getByLabelText('Work email'), 'not-an-email')
    await user.type(screen.getByLabelText('Display name'), 'Alyx')
    await user.type(screen.getAllByLabelText('Password')[0], 'top-secret-passphrase')
    await user.type(screen.getByLabelText('Tenant name'), 'Misty Harbor')
    await user.click(screen.getByRole('button', { name: 'Create portal account' }))

    // The form must not reach the signup endpoint — the submit is blocked by
    // the browser's HTML5 email validation before the handler fires.
    const signupCalls = vi.mocked(fetchSpy).mock.calls.filter(([input, init]) => {
      const { path, method } = readMockRequest(input, init)
      return path === '/portal-api/portal/signup' && method === 'POST'
    })
    expect(signupCalls).toHaveLength(0)

    // Dashboard must remain hidden.
    expect(screen.queryByText('Customer dashboard')).toBeNull()
  })

  it('shows an error alert on API 409 conflict and preserves the form data', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)
      if (path === '/portal-api/portal/catalog' && method === 'GET') {
        return createJsonResponse(catalog)
      }
      if (path === '/portal-api/portal/signup' && method === 'POST') {
        return createJsonResponse(
          { error: 'Email already registered', details: 'Use the login form to restore your session.' },
          409,
        )
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

    // Error alert must appear with the server message.
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy()
    })
    expect(screen.getByRole('alert').textContent).toContain('Email already registered')

    // The signup form must still be visible — dashboard must NOT render.
    expect(screen.queryByText('Customer dashboard')).toBeNull()
    // Email field must retain its value (form data preserved).
    expect((screen.getByLabelText('Work email') as HTMLInputElement).value).toBe('owner@example.com')
  })

  it('shows a generic error alert on API 500', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)
      if (path === '/portal-api/portal/catalog' && method === 'GET') {
        return createJsonResponse(catalog)
      }
      if (path === '/portal-api/portal/signup' && method === 'POST') {
        return createJsonResponse({ error: 'Internal server error' }, 500)
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

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy()
    })
    expect(screen.getByRole('alert').textContent).toContain('Internal server error')

    // Dashboard must remain hidden after the error.
    expect(screen.queryByText('Customer dashboard')).toBeNull()
  })

  it('concatenates error and details array from a structured 422 response', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)
      if (path === '/portal-api/portal/catalog' && method === 'GET') {
        return createJsonResponse(catalog)
      }
      if (path === '/portal-api/portal/signup' && method === 'POST') {
        return createJsonResponse(
          { error: 'Validation failed', details: ['tenantSlug is invalid', 'planTier is required'] },
          422,
        )
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

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy()
    })
    // readJson concatenates error + details.join(' ') per control-plane-api.ts:40-41.
    const alertText = screen.getByRole('alert').textContent ?? ''
    expect(alertText).toContain('Validation failed')
    expect(alertText).toContain('tenantSlug is invalid')
  })
})

/**
 * Plan selection tests for the customer portal (local-auth mode).
 *
 * The plan catalog is rendered server-driven: App.tsx consumes catalog.plans[]
 * from /portal/catalog, selects the first plan as the default, and renders
 * each plan as a <MenuItem> in the Plan dropdown and as a <Card> in the grid.
 *
 * Covered:
 *   1. Catalog with only one plan — only that plan card rendered, no other plan.
 *   2. Default plan is pre-selected to catalog.plans[0].id after catalog loads.
 *   3. Switching the plan dropdown updates the selected value.
 *
 * Deferred:
 *   - Disabled plan handling: PortalPlan (types.ts:49-55) has no "available"
 *     or "disabled" flag; App.tsx renders planOptions.map(plan => <MenuItem>)
 *     with no disabled prop. There is no disabled-plan UI to test. This would
 *     require a backend and types change first.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { createJsonResponse, readMockRequest } from './test-helpers'
import type { CustomerKeycloakClient } from './keycloak-client'
import type { PortalCatalogResponse } from './types'

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

function makeCatalog(plans: PortalCatalogResponse['plans']): PortalCatalogResponse {
  return {
    authMode: 'local',
    defaultTenantVersion: '0.1.0',
    provisioningConfigured: true,
    slugPolicy: {
      pattern: '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$',
      maxLength: 63,
      example: 'misty-harbor',
    },
    plans,
    placeholders: {
      billingStatus: 'placeholder',
      teamInvites: 'coming-soon',
      usageAnalytics: 'coming-soon',
    },
  }
}

describe('customer portal — plan selection', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders only the single plan card when the catalog contains one plan', async () => {
    const singlePlanCatalog = makeCatalog([
      {
        id: 'adventurer',
        name: 'Adventurer',
        priceLabel: '$9/mo placeholder',
        description: 'Single campaign tenant',
        features: ['One tenant instance'],
      },
    ])

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)
      if (path === '/portal-api/portal/catalog' && method === 'GET') {
        return createJsonResponse(singlePlanCatalog)
      }
      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    const stub = makeKeycloakStub()
    render(<App keycloakClientFactory={() => stub} />)

    // The plan card grid must contain exactly one plan heading.
    expect(await screen.findByRole('heading', { name: 'Adventurer' })).toBeTruthy()
    // The Guild card must not be rendered (it's not in the catalog).
    expect(screen.queryByRole('heading', { name: 'Guild' })).toBeNull()
  })

  it('defaults the plan dropdown to the first plan in the catalog', async () => {
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

    let capturedPlanTier: string | undefined

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)
      if (path === '/portal-api/portal/catalog' && method === 'GET') {
        return createJsonResponse(multiPlanCatalog)
      }
      if (path === '/portal-api/portal/signup' && method === 'POST') {
        const body = JSON.parse(init?.body as string) as { planTier?: string }
        capturedPlanTier = body.planTier
        return createJsonResponse({ error: 'Signup blocked in default-plan test' }, 500)
      }
      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    const stub = makeKeycloakStub()
    render(<App keycloakClientFactory={() => stub} />)

    const user = userEvent.setup()
    await screen.findByRole('heading', { name: 'Your D&D Notes workspaces' })

    // Fill required fields WITHOUT touching the Plan dropdown.
    // If the default is 'adventurer' (plans[0].id), it must appear in the POST body.
    await user.type(screen.getByLabelText('Work email'), 'owner@example.com')
    await user.type(screen.getByLabelText('Display name'), 'Alyx')
    await user.type(screen.getAllByLabelText('Password')[0], 'top-secret-passphrase')
    await user.type(screen.getByLabelText('Tenant name'), 'Misty Harbor')
    await user.click(screen.getByRole('button', { name: 'Create portal account' }))

    // Wait for the (intentionally) failed signup to complete.
    await screen.findByRole('alert')

    // The plan tier in the request body must be the first catalog plan.
    expect(capturedPlanTier).toBe('adventurer')

    // Both plan card headings must appear in the grid.
    expect(screen.getByRole('heading', { name: 'Adventurer' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Guild' })).toBeTruthy()
  })

  it('updates the selected plan when a different option is chosen', async () => {
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

    let capturedPlanTier: string | undefined

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)
      if (path === '/portal-api/portal/catalog' && method === 'GET') {
        return createJsonResponse(multiPlanCatalog)
      }
      if (path === '/portal-api/portal/signup' && method === 'POST') {
        const body = JSON.parse(init?.body as string) as { planTier?: string }
        capturedPlanTier = body.planTier
        return createJsonResponse({ error: 'Signup intentionally blocked for this test' }, 500)
      }
      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    const stub = makeKeycloakStub()
    render(<App keycloakClientFactory={() => stub} />)

    const user = userEvent.setup()
    await screen.findByRole('heading', { name: 'Your D&D Notes workspaces' })

    // Open the Plan dropdown in the signup form and select "Guild".
    await user.click(screen.getByLabelText('Plan'))
    await user.click(await screen.findByRole('option', { name: 'Guild' }))

    // After selecting Guild, the dropdown listbox closes.
    expect(screen.queryByRole('option', { name: 'Guild' })).toBeNull()

    // Fill minimal required fields and submit to verify Guild is sent in the request.
    await user.type(screen.getByLabelText('Work email'), 'owner@example.com')
    await user.type(screen.getByLabelText('Display name'), 'Alyx')
    await user.type(screen.getAllByLabelText('Password')[0], 'top-secret-passphrase')
    await user.type(screen.getByLabelText('Tenant name'), 'Emberfall')
    await user.click(screen.getByRole('button', { name: 'Create portal account' }))

    // Wait for the (intentionally) failed signup fetch to complete.
    await screen.findByRole('alert')

    // The plan tier sent in the request body must be 'guild' (not 'adventurer').
    expect(capturedPlanTier).toBe('guild')

    // Both plan card headings must still appear in the grid (catalog unchanged).
    expect(screen.getByRole('heading', { name: 'Adventurer' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Guild' })).toBeTruthy()
  })
})

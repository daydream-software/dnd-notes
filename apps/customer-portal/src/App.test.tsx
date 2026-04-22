import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { createJsonResponse, readMockJsonBody, readMockRequest } from './test-helpers'
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

describe('customer portal', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders the public landing page and plan catalog', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)

      if (path === '/portal-api/portal/catalog' && method === 'GET') {
        return createJsonResponse(catalog)
      }

      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    render(<App />)

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
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)

      if (path === '/portal-api/portal/catalog' && method === 'GET') {
        return createJsonResponse(catalog)
      }

      if (path === '/portal-api/portal/signup' && method === 'POST') {
        const body = readMockJsonBody<PortalSignupRequest>(init)
        expect(body?.email).toBe('owner@example.com')
        expect(body?.password).toBe('top-secret-passphrase')
        expect(body?.tenantSlug).toBe('misty-harbor')

        return createJsonResponse({
          token: 'portal-session-token',
          dashboard: baseDashboard,
        }, 201)
      }

      if (path === '/portal-api/portal/me' && method === 'GET') {
        return createJsonResponse(baseDashboard)
      }

      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    render(<App />)

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
  })

  it('creates an additional tenant from the customer dashboard', async () => {
    sessionStorage.setItem(storedTokenKey, 'portal-session-token')

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
        expect(body?.tenantSlug).toBe('emberfall')

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

    render(<App />)

    const user = userEvent.setup()
    expect(await screen.findByText('Customer dashboard')).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'Add another tenant' })).toBeTruthy()

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

    render(<App />)

    const user = userEvent.setup()
    expect(await screen.findByText('Customer dashboard')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('button', { name: 'Create portal account' })).toBeTruthy()
    await waitFor(() => {
      expect(sessionStorage.getItem(storedTokenKey)).toBeNull()
    })
  })
})

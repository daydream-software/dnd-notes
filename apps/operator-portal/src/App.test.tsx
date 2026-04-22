import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createJsonResponse, readMockRequest } from './test-helpers'

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
        subdomain: 'moonshae-ledger',
        ownerId: 'owner-1',
        initialAdminEmail: 'admin@moonshae.example',
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
        initialAdminEmail: null,
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

  it('shows the Keycloak sign-in action when there is no operator session yet', async () => {
    initMock.mockResolvedValue(null)
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('Unexpected fetch')
    })

    render(<App />)

    const user = userEvent.setup()
    const button = await screen.findByRole('button', {
      name: 'Continue with Keycloak',
    })

    expect(screen.getByText('Operator control portal')).toBeTruthy()
    expect(
      screen.getByText(
        'Sign in with the workforce/admin Keycloak realm before inspecting fleet state.',
      ),
    ).toBeTruthy()

    await user.click(button)

    expect(loginMock).toHaveBeenCalledTimes(1)
  })

  it('restores a saved operator session and renders fleet status from the control-plane API', async () => {
    localStorage.setItem(
      storedTokensKey,
      JSON.stringify({
        accessToken: 'operator-access-token',
        refreshToken: 'operator-refresh-token',
      }),
    )
    initMock.mockResolvedValue({
      accessToken: 'operator-access-token',
      refreshToken: 'operator-refresh-token',
    })
    refreshMock.mockResolvedValue({
      accessToken: 'operator-access-token',
      refreshToken: 'operator-refresh-token',
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
    expect(screen.getByText('Initial admin admin@moonshae.example')).toBeTruthy()
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
})

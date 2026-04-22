import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createJsonResponse,
  readMockJsonBody,
  readMockRequest,
} from './test-helpers'

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

function createMockJwt(claims: Record<string, unknown>) {
  const encode = (value: Record<string, unknown>) =>
    window
      .btoa(JSON.stringify(value))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '')

  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(claims)}.signature`
}

function createFleetStatus() {
  return {
    generatedAt: '2026-04-22T18:00:00.000Z',
    controlPlane: {
      status: 'healthy' as const,
      uptime: 321,
      version: '0.1.0',
    },
    dependencies: {
      tenantRegistry: { status: 'healthy' as const },
      tenantProvisioning: {
        status: 'healthy' as const,
        details: 'Tenant provisioning service configured.',
      },
    },
    summary: {
      totalTenants: 1,
      tenantsByCurrentState: {
        provisioning: 0,
        ready: 1,
        maintenance: 0,
        upgrading: 0,
        restoring: 0,
        failed: 0,
        deprovisioned: 0,
      },
      tenantsByDesiredState: {
        provisioning: 0,
        ready: 1,
        maintenance: 0,
        upgrading: 0,
        restoring: 0,
        failed: 0,
        deprovisioned: 0,
      },
      tenantsByVersion: {
        '1.0.0': 1,
      },
      tenantsWithBackupMetadata: 1,
      tenantsMissingBackupMetadata: 0,
      tenantsNeedingAttention: 0,
    },
    tenants: [
      {
        tenant: {
          id: 'tenant-ready',
          slug: 'moonshae-ledger',
          subdomain: 'moonshae-ledger',
          ownerId: 'owner-1',
          initialAdminEmail: 'admin@moonshae.example',
          desiredState: 'ready' as const,
          currentState: 'ready' as const,
          version: '1.0.0',
          storageReference: 'pvc-moonshae-ledger',
          backupMetadata: '{"lastBackupStatus":"ok"}',
          createdAt: '2026-04-22T16:00:00.000Z',
          updatedAt: '2026-04-22T17:00:00.000Z',
        },
        health: 'healthy' as const,
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
          fromState: 'provisioning' as const,
          toState: 'ready' as const,
          triggeredBy: 'operator@example.com',
          reason: 'Provisioned successfully',
          createdAt: '2026-04-22T17:00:00.000Z',
        },
      },
    ],
  }
}

describe('operator portal lifecycle actions', () => {
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

  it('creates and provisions a tenant through the existing control-plane routes', async () => {
    const accessToken = createMockJwt({ email: 'stef@example.com' })
    const fleetResponses = [
      createFleetStatus(),
      {
        ...createFleetStatus(),
        summary: {
          ...createFleetStatus().summary,
          totalTenants: 2,
          tenantsByCurrentState: {
            ...createFleetStatus().summary.tenantsByCurrentState,
            ready: 2,
          },
          tenantsByDesiredState: {
            ...createFleetStatus().summary.tenantsByDesiredState,
            ready: 2,
          },
          tenantsByVersion: {
            '1.0.0': 1,
            '2.1.0': 1,
          },
        },
        tenants: [
          ...createFleetStatus().tenants,
          {
            tenant: {
              id: 'candlekeep',
              slug: 'candlekeep',
              subdomain: 't-candlekeep',
              ownerId: 'owner-99',
              initialAdminEmail: 'keeper@candlekeep.example',
              desiredState: 'ready' as const,
              currentState: 'ready' as const,
              version: '2.1.0',
              storageReference: 'pvc-candlekeep',
              backupMetadata: null,
              createdAt: '2026-04-22T18:30:00.000Z',
              updatedAt: '2026-04-22T18:31:00.000Z',
            },
            health: 'healthy' as const,
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
              tenantId: 'candlekeep',
              fromState: 'provisioning' as const,
              toState: 'ready' as const,
              triggeredBy: 'stef@example.com',
              reason: 'Launch the customer-facing demo tenant',
              createdAt: '2026-04-22T18:31:00.000Z',
            },
          },
        ],
      },
    ]

    const createRequests: Array<{
      id: string
      ownerId: string
      initialAdminEmail: string
      slug: string
      version: string
    }> = []
    const provisionRequests: Array<{
      triggeredBy: string
      reason?: string
      version?: string
    }> = []

    localStorage.setItem(
      storedTokensKey,
      JSON.stringify({
        accessToken,
        refreshToken: 'operator-refresh-token',
      }),
    )
    initMock.mockResolvedValue({
      accessToken,
      refreshToken: 'operator-refresh-token',
    })
    refreshMock.mockResolvedValue({
      accessToken,
      refreshToken: 'operator-refresh-token',
    })

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)

      if (path === '/operator-api/internal/fleet/status' && method === 'GET') {
        return createJsonResponse(fleetResponses.shift() ?? createFleetStatus())
      }

      if (path === '/operator-api/internal/tenants' && method === 'POST') {
        const request = readMockJsonBody<{
          id: string
          ownerId: string
          initialAdminEmail: string
          slug: string
          version: string
        }>(init)

        if (!request) {
          throw new Error('Missing create tenant request body')
        }

        createRequests.push(request)
        return createJsonResponse(
          {
            tenant: {
              id: request.id,
              slug: request.slug,
              subdomain: null,
              ownerId: request.ownerId,
              initialAdminEmail: request.initialAdminEmail,
              desiredState: 'provisioning',
              currentState: 'provisioning',
              version: request.version,
              storageReference: null,
              backupMetadata: null,
              createdAt: '2026-04-22T18:30:00.000Z',
              updatedAt: '2026-04-22T18:30:00.000Z',
            },
          },
          201,
        )
      }

      if (path === '/operator-api/internal/tenants/candlekeep/provision' && method === 'POST') {
        const request = readMockJsonBody<{
          triggeredBy: string
          reason?: string
          version?: string
        }>(init)

        if (!request) {
          throw new Error('Missing provision request body')
        }

        provisionRequests.push(request)
        return createJsonResponse({
          tenant: {
            id: 'candlekeep',
            slug: 'candlekeep',
            subdomain: 't-candlekeep',
            ownerId: 'owner-99',
            initialAdminEmail: 'keeper@candlekeep.example',
            desiredState: 'ready',
            currentState: 'ready',
            version: '2.1.0',
            storageReference: 'pvc-candlekeep',
            backupMetadata: null,
            createdAt: '2026-04-22T18:30:00.000Z',
            updatedAt: '2026-04-22T18:31:00.000Z',
          },
          resources: {
            namespace: 'tenant-candlekeep',
            deploymentName: 'tenant-candlekeep-app',
            serviceName: 'tenant-candlekeep-service',
            pvcName: 'tenant-candlekeep-pvc',
            configMapName: 'tenant-candlekeep-config',
            secretName: 'tenant-candlekeep-runtime',
            hostname: 'candlekeep.example.test',
            databaseName: 'tenant_candlekeep',
            image: 'ghcr.io/daydream-software/dnd-notes:2.1.0',
          },
        })
      }

      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Provision tenant' })).toBeTruthy()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/tenant slug/i), 'candlekeep')
    await user.type(screen.getByLabelText(/owner id/i), 'owner-99')
    await user.type(
      screen.getByLabelText(/initial admin email/i),
      'keeper@candlekeep.example',
    )
    await user.clear(screen.getByLabelText(/tenant version/i))
    await user.type(screen.getByLabelText(/tenant version/i), '2.1.0')
    await user.type(
      screen.getByLabelText(/^operator reason/i),
      'Launch the customer-facing demo tenant',
    )

    expect((screen.getByLabelText(/tenant id/i) as HTMLInputElement).value).toBe('candlekeep')
    await user.click(screen.getByRole('button', { name: 'Review and provision tenant' }))

    expect(await screen.findByText('Confirm tenant provisioning')).toBeTruthy()
    const provisionDialog = screen.getByRole('dialog')
    expect(within(provisionDialog).getByText(/Tenant ID:/)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Create and provision tenant' }))

    expect(createRequests).toEqual([
      {
        id: 'candlekeep',
        ownerId: 'owner-99',
        initialAdminEmail: 'keeper@candlekeep.example',
        slug: 'candlekeep',
        version: '2.1.0',
      },
    ])
    expect(provisionRequests).toEqual([
      {
        triggeredBy: 'stef@example.com',
        reason: 'Launch the customer-facing demo tenant',
        version: '2.1.0',
      },
    ])
    expect(
      await screen.findByText(
        /Provisioned candlekeep\. Namespace tenant-candlekeep, host candlekeep\.example\.test, and database tenant_candlekeep came from the live control-plane response\./,
      ),
    ).toBeTruthy()
    expect(screen.getByText('candlekeep')).toBeTruthy()
    expect(screen.getByText('Initial admin keeper@candlekeep.example')).toBeTruthy()
    expect(screen.getByText('Launch the customer-facing demo tenant')).toBeTruthy()
  })

  it('locks the provisioning confirmation if the live fleet disables mutations after review opens', async () => {
    const accessToken = createMockJwt({ email: 'stef@example.com' })
    const disabledReason = 'Tenant provisioning service degraded after refresh.'
    const fleetResponses = [
      createFleetStatus(),
      {
        ...createFleetStatus(),
        dependencies: {
          ...createFleetStatus().dependencies,
          tenantProvisioning: {
            status: 'disabled' as const,
            details: disabledReason,
          },
        },
      },
    ]
    const createRequests: Array<{
      id: string
      ownerId: string
      initialAdminEmail: string
      slug: string
      version: string
    }> = []
    const provisionRequests: Array<{ triggeredBy: string; reason: string; version: string }> = []

    localStorage.setItem(
      storedTokensKey,
      JSON.stringify({
        accessToken,
        refreshToken: 'operator-refresh-token',
      }),
    )
    initMock.mockResolvedValue({
      accessToken,
      refreshToken: 'operator-refresh-token',
    })
    refreshMock.mockResolvedValue({
      accessToken,
      refreshToken: 'operator-refresh-token',
    })

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)

      if (path === '/operator-api/internal/fleet/status' && method === 'GET') {
        return createJsonResponse(fleetResponses.shift() ?? fleetResponses[0] ?? createFleetStatus())
      }

      if (path === '/operator-api/internal/tenants' && method === 'POST') {
        const request = readMockJsonBody<{
          id: string
          ownerId: string
          initialAdminEmail: string
          slug: string
          version: string
        }>(init)

        if (!request) {
          throw new Error('Missing create tenant request body')
        }

        createRequests.push(request)
        return createJsonResponse(
          { error: 'Unexpected tenant create call while provisioning is disabled.' },
          500,
        )
      }

      if (path === '/operator-api/internal/tenants/candlekeep/provision' && method === 'POST') {
        const request = readMockJsonBody<{ triggeredBy: string; reason: string; version: string }>(init)

        if (!request) {
          throw new Error('Missing provision request body')
        }

        provisionRequests.push(request)
        return createJsonResponse(
          { error: 'Unexpected tenant provision call while provisioning is disabled.' },
          500,
        )
      }

      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Provision tenant' })).toBeTruthy()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/tenant slug/i), 'candlekeep')
    await user.type(screen.getByLabelText(/owner id/i), 'owner-99')
    await user.type(
      screen.getByLabelText(/initial admin email/i),
      'keeper@candlekeep.example',
    )
    await user.clear(screen.getByLabelText(/tenant version/i))
    await user.type(screen.getByLabelText(/tenant version/i), '2.1.0')
    await user.type(
      screen.getByLabelText(/^operator reason/i),
      'Launch the customer-facing demo tenant',
    )

    await user.click(screen.getByRole('button', { name: 'Review and provision tenant' }))

    const provisionDialog = await screen.findByRole('dialog')
    const confirmButton = within(provisionDialog).getByRole('button', {
      name: 'Create and provision tenant',
    }) as HTMLButtonElement
    expect(confirmButton.disabled).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Refresh fleet', hidden: true }))

    expect(await within(provisionDialog).findByText(disabledReason)).toBeTruthy()
    expect(confirmButton.disabled).toBe(true)

    expect(createRequests).toEqual([])
    expect(provisionRequests).toEqual([])
    expect(screen.queryByText(/Provisioned candlekeep\./)).toBeNull()
  })

  it('requires an explicit slug confirmation before deprovisioning a tenant', async () => {
    const accessToken = createMockJwt({ preferred_username: 'stef@example.com' })
    const initialFleetStatus = createFleetStatus()
    const updatedFleetStatus = {
      ...createFleetStatus(),
      summary: {
        ...createFleetStatus().summary,
        tenantsByCurrentState: {
          ...createFleetStatus().summary.tenantsByCurrentState,
          ready: 0,
          deprovisioned: 1,
        },
        tenantsByDesiredState: {
          ...createFleetStatus().summary.tenantsByDesiredState,
          ready: 0,
          deprovisioned: 1,
        },
      },
      tenants: [
        {
          ...createFleetStatus().tenants[0],
          tenant: {
            ...createFleetStatus().tenants[0].tenant,
            desiredState: 'deprovisioned' as const,
            currentState: 'deprovisioned' as const,
            storageReference: null,
          },
          latestTransition: {
            id: 9,
            tenantId: 'tenant-ready',
            fromState: 'ready' as const,
            toState: 'deprovisioned' as const,
            triggeredBy: 'stef@example.com',
            reason: 'Retired after the migration rehearsal',
            createdAt: '2026-04-22T18:45:00.000Z',
          },
        },
      ],
    }
    const fleetResponses = [initialFleetStatus, updatedFleetStatus]
    const deprovisionRequests: Array<{ triggeredBy: string; reason?: string }> = []

    localStorage.setItem(
      storedTokensKey,
      JSON.stringify({
        accessToken,
        refreshToken: 'operator-refresh-token',
      }),
    )
    initMock.mockResolvedValue({
      accessToken,
      refreshToken: 'operator-refresh-token',
    })
    refreshMock.mockResolvedValue({
      accessToken,
      refreshToken: 'operator-refresh-token',
    })

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)

      if (path === '/operator-api/internal/fleet/status' && method === 'GET') {
        return createJsonResponse(fleetResponses.shift() ?? updatedFleetStatus)
      }

      if (path === '/operator-api/internal/tenants/tenant-ready/deprovision' && method === 'POST') {
        const request = readMockJsonBody<{ triggeredBy: string; reason?: string }>(init)

        if (!request) {
          throw new Error('Missing deprovision request body')
        }

        deprovisionRequests.push(request)
        return createJsonResponse({
          tenant: {
            ...initialFleetStatus.tenants[0].tenant,
            desiredState: 'deprovisioned',
            currentState: 'deprovisioned',
            storageReference: null,
          },
          deprovisioned: true,
        })
      }

      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    render(<App />)

    const user = userEvent.setup()
    expect(await screen.findByText('moonshae-ledger')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Deprovision tenant' }))

    expect(await screen.findByText('Confirm deprovision')).toBeTruthy()
    const deprovisionDialog = screen.getByRole('dialog')
    expect(
      (
        within(deprovisionDialog).getByRole('button', {
          name: 'Deprovision tenant now',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)

    await user.type(
      within(deprovisionDialog).getByLabelText(/^operator reason/i),
      'Retired after the migration rehearsal',
    )
    expect(
      (
        within(deprovisionDialog).getByRole('button', {
          name: 'Deprovision tenant now',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)

    await user.type(
      within(deprovisionDialog).getByLabelText(/confirm tenant slug/i),
      'moonshae-ledger',
    )
    await user.click(
      within(deprovisionDialog).getByRole('button', { name: 'Deprovision tenant now' }),
    )

    expect(deprovisionRequests).toEqual([
      {
        triggeredBy: 'stef@example.com',
        reason: 'Retired after the migration rehearsal',
      },
    ])
    expect(
      await screen.findByText(
        /Deprovisioned moonshae-ledger\. The control plane now reports it as deprovisioned, and any recorded backup metadata stays visible for audit follow-up\./,
      ),
    ).toBeTruthy()
    expect(screen.getByText('Current Deprovisioned')).toBeTruthy()
  })

  it('only offers rolling updates for tenants that are currently ready', async () => {
    const accessToken = createMockJwt({ email: 'stef@example.com' })
    const fleetStatus = {
      ...createFleetStatus(),
      summary: {
        ...createFleetStatus().summary,
        totalTenants: 2,
        tenantsByCurrentState: {
          ...createFleetStatus().summary.tenantsByCurrentState,
          failed: 1,
        },
        tenantsByDesiredState: {
          ...createFleetStatus().summary.tenantsByDesiredState,
          ready: 2,
        },
        tenantsByVersion: {
          ...createFleetStatus().summary.tenantsByVersion,
          '2.0.0': 1,
        },
        tenantsMissingBackupMetadata: 1,
        tenantsNeedingAttention: 1,
      },
      tenants: [
        ...createFleetStatus().tenants,
        {
          tenant: {
            id: 'tenant-failed',
            slug: 'stormwatch',
            subdomain: null,
            ownerId: 'owner-2',
            initialAdminEmail: null,
            desiredState: 'ready' as const,
            currentState: 'failed' as const,
            version: '2.0.0',
            storageReference: null,
            backupMetadata: null,
            createdAt: '2026-04-22T16:00:00.000Z',
            updatedAt: '2026-04-22T17:15:00.000Z',
          },
          health: 'attention' as const,
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
            fromState: 'provisioning' as const,
            toState: 'failed' as const,
            triggeredBy: 'system',
            reason: 'Probe never became ready',
            createdAt: '2026-04-22T17:15:00.000Z',
          },
        },
      ],
    }

    localStorage.setItem(
      storedTokensKey,
      JSON.stringify({
        accessToken,
        refreshToken: 'operator-refresh-token',
      }),
    )
    initMock.mockResolvedValue({
      accessToken,
      refreshToken: 'operator-refresh-token',
    })
    refreshMock.mockResolvedValue({
      accessToken,
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

    const user = userEvent.setup()
    expect(await screen.findByText('moonshae-ledger')).toBeTruthy()
    expect(screen.getByText('stormwatch')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Roll to new version' })).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Roll to new version' }))

    const upgradeDialog = await screen.findByRole('dialog')
    expect(within(upgradeDialog).getByText(/moonshae-ledger \(tenant-ready\)/)).toBeTruthy()
  })

  it('rolls a ready tenant to a new version through the existing provision route', async () => {
    const accessToken = createMockJwt({ email: 'stef@example.com' })
    const initialFleetStatus = createFleetStatus()
    const updatedFleetStatus = {
      ...createFleetStatus(),
      summary: {
        ...createFleetStatus().summary,
        tenantsByVersion: {
          '2.1.0': 1,
        },
      },
      tenants: [
        {
          ...createFleetStatus().tenants[0],
          tenant: {
            ...createFleetStatus().tenants[0].tenant,
            version: '2.1.0',
            updatedAt: '2026-04-22T18:35:00.000Z',
          },
          latestTransition: {
            id: 10,
            tenantId: 'tenant-ready',
            fromState: 'upgrading' as const,
            toState: 'ready' as const,
            triggeredBy: 'stef@example.com',
            reason: 'Roll forward after smoke sign-off',
            createdAt: '2026-04-22T18:35:00.000Z',
          },
        },
      ],
    }
    const fleetResponses = [initialFleetStatus, updatedFleetStatus]
    const upgradeRequests: Array<{
      triggeredBy: string
      reason?: string
      version?: string
    }> = []

    localStorage.setItem(
      storedTokensKey,
      JSON.stringify({
        accessToken,
        refreshToken: 'operator-refresh-token',
      }),
    )
    initMock.mockResolvedValue({
      accessToken,
      refreshToken: 'operator-refresh-token',
    })
    refreshMock.mockResolvedValue({
      accessToken,
      refreshToken: 'operator-refresh-token',
    })

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)

      if (path === '/operator-api/internal/fleet/status' && method === 'GET') {
        return createJsonResponse(fleetResponses.shift() ?? updatedFleetStatus)
      }

      if (path === '/operator-api/internal/tenants/tenant-ready/provision' && method === 'POST') {
        const request = readMockJsonBody<{
          triggeredBy: string
          reason?: string
          version?: string
        }>(init)

        if (!request) {
          throw new Error('Missing rolling update request body')
        }

        upgradeRequests.push(request)
        return createJsonResponse({
          tenant: {
            ...initialFleetStatus.tenants[0].tenant,
            version: '2.1.0',
            desiredState: 'ready',
            currentState: 'ready',
            updatedAt: '2026-04-22T18:35:00.000Z',
          },
          resources: {
            namespace: 'tenant-moonshae-ledger',
            deploymentName: 'tenant-moonshae-ledger-app',
            serviceName: 'tenant-moonshae-ledger-service',
            pvcName: 'tenant-moonshae-ledger-pvc',
            configMapName: 'tenant-moonshae-ledger-config',
            secretName: 'tenant-moonshae-ledger-runtime',
            hostname: 'moonshae-ledger.example.test',
            databaseName: 'tenant_moonshae_ledger',
            image: 'ghcr.io/daydream-software/dnd-notes:2.1.0',
          },
        })
      }

      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    render(<App />)

    const user = userEvent.setup()
    expect(await screen.findByText('moonshae-ledger')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Roll to new version' }))

    expect(await screen.findByText('Confirm rolling update')).toBeTruthy()
    const upgradeDialog = screen.getByRole('dialog')
    await user.type(within(upgradeDialog).getByLabelText(/^Target version/i), '2.1.0')
    await user.type(
      within(upgradeDialog).getByLabelText(/^operator reason/i),
      'Roll forward after smoke sign-off',
    )
    expect(
      (
        within(upgradeDialog).getByRole('button', {
          name: 'Start rolling update',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)

    await user.type(
      within(upgradeDialog).getByLabelText(/^Confirm target version/i),
      '2.1.0',
    )
    await user.click(
      within(upgradeDialog).getByRole('button', { name: 'Start rolling update' }),
    )

    expect(upgradeRequests).toEqual([
      {
        triggeredBy: 'stef@example.com',
        reason: 'Roll forward after smoke sign-off',
        version: '2.1.0',
      },
    ])
    expect(
      await screen.findByText(
        /Rolled moonshae-ledger to 2\.1\.0\. The control plane used the existing provision route and returned the tenant as ready after the drain-first replacement\./,
      ),
    ).toBeTruthy()
    expect(screen.getByText('Version 2.1.0')).toBeTruthy()
    expect(screen.getAllByText('Roll forward after smoke sign-off').length).toBeGreaterThan(0)
  })

  it.each([
    [
      'stale no-op targets',
      {
        status: 400,
        body: {
          code: 'unsupported_target_version',
          error: 'Invalid tenant provisioning request',
          details:
            'Tenant tenant-ready is already running version 2.1.0. Choose a different target version for a rolling update.',
        },
        expectedMessage:
          'Tenant tenant-ready is already running version 2.1.0. Choose a different target version for a rolling update.',
      },
    ],
    [
      'concurrent rollouts',
      {
        status: 409,
        body: {
          code: 'tenant_rollout_in_progress',
          error: 'Tenant rolling update conflict',
          details:
            'Tenant tenant-ready already has a rolling update in progress. Wait for it to return to ready before starting another rollout.',
        },
        expectedMessage:
          'Tenant tenant-ready already has a rolling update in progress. Wait for it to return to ready before starting another rollout.',
      },
    ],
    [
      'non-ready rollout retries',
      {
        status: 409,
        body: {
          code: 'tenant_rollout_disallowed',
          error: 'Tenant rolling update conflict',
          details:
            'Tenant tenant-ready cannot start a rolling update from state maintenance. Rolling updates are only supported for ready tenants.',
        },
        expectedMessage:
          'Tenant tenant-ready cannot start a rolling update from state maintenance. Rolling updates are only supported for ready tenants.',
      },
    ],
    [
      'mid-flight rollout failures',
      {
        status: 500,
        body: {
          code: 'tenant_rollout_failed',
          error: 'Tenant rolling update failed',
          details:
            'Rolling update failed for tenant tenant-ready. The control plane marked the tenant failed; inspect the latest transition and control-plane logs before retrying.',
        },
        expectedMessage:
          'Rolling update failed for tenant tenant-ready. The control plane marked the tenant failed; inspect the latest transition and control-plane logs before retrying.',
      },
    ],
  ])('surfaces stable rollout guidance inline for %s', async (_, { status, body, expectedMessage }) => {
    const accessToken = createMockJwt({ email: 'stef@example.com' })

    localStorage.setItem(
      storedTokensKey,
      JSON.stringify({
        accessToken,
        refreshToken: 'operator-refresh-token',
      }),
    )
    initMock.mockResolvedValue({
      accessToken,
      refreshToken: 'operator-refresh-token',
    })
    refreshMock.mockResolvedValue({
      accessToken,
      refreshToken: 'operator-refresh-token',
    })

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)

      if (path === '/operator-api/internal/fleet/status' && method === 'GET') {
        return createJsonResponse(createFleetStatus())
      }

      if (path === '/operator-api/internal/tenants/tenant-ready/provision' && method === 'POST') {
        return createJsonResponse(body, status)
      }

      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    render(<App />)

    const user = userEvent.setup()
    expect(await screen.findByText('moonshae-ledger')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Roll to new version' }))

    const upgradeDialog = await screen.findByRole('dialog')
    await user.type(within(upgradeDialog).getByLabelText(/^Target version/i), '2.1.0')
    await user.type(
      within(upgradeDialog).getByLabelText(/^operator reason/i),
      'Roll forward after smoke sign-off',
    )
    await user.type(
      within(upgradeDialog).getByLabelText(/^Confirm target version/i),
      '2.1.0',
    )
    await user.click(
      within(upgradeDialog).getByRole('button', { name: 'Start rolling update' }),
    )

    expect(await within(upgradeDialog).findByText(expectedMessage)).toBeTruthy()
    expect(within(upgradeDialog).getByText('Confirm rolling update')).toBeTruthy()
    expect(screen.queryByText(/Rolled moonshae-ledger to 2\.1\.0/)).toBeNull()
  })
})

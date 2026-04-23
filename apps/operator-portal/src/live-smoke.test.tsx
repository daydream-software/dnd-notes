import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createJsonResponse,
  readMockJsonBody,
  readMockRequest,
} from './test-helpers'
import { provisionTenantThroughOperatorPortal } from './live-smoke'

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
    generatedAt: '2026-04-23T01:00:00.000Z',
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

describe('provisionTenantThroughOperatorPortal', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState({}, '', '/')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('drives the live portal UI against the existing operator API contract', async () => {
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
            k3d: 1,
          },
        },
      },
    ]
    const createRequests: Array<{
      id: string
      ownerId: string
      initialAdminEmail?: string
      slug: string
      version: string
    }> = []
    const provisionRequests: Array<{
      triggeredBy: string
      reason?: string
      version?: string
    }> = []

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)

      if (path === '/operator-api/internal/fleet/status' && method === 'GET') {
        return createJsonResponse(fleetResponses.shift() ?? createFleetStatus())
      }

      if (path === '/operator-api/internal/tenants' && method === 'POST') {
        const body = readMockJsonBody<{
          id: string
          ownerId: string
          initialAdminEmail?: string
          slug: string
          version: string
        }>(init)
        expect(body).toBeTruthy()
        createRequests.push(body!)

        return createJsonResponse({
          tenant: {
            id: body!.id,
            slug: body!.slug,
            subdomain: `t-${body!.slug}`,
            ownerId: body!.ownerId,
            initialAdminEmail: body!.initialAdminEmail ?? null,
            desiredState: 'provisioning',
            currentState: 'provisioning',
            version: body!.version,
          },
        }, 201)
      }

      if (
        path === '/operator-api/internal/tenants/candlekeep/provision' &&
        method === 'POST'
      ) {
        const body = readMockJsonBody<{
          triggeredBy: string
          reason?: string
          version?: string
        }>(init)
        expect(body).toBeTruthy()
        provisionRequests.push(body!)

        return createJsonResponse({
          tenant: {
            id: 'candlekeep',
            slug: 'candlekeep',
            subdomain: 't-candlekeep',
            ownerId: 'owner-99',
            initialAdminEmail: 'keeper@candlekeep.example',
            desiredState: 'ready',
            currentState: 'ready',
            version: 'k3d',
          },
          resources: {
            namespace: 'tenant-t-candlekeep',
            hostname: 't-candlekeep.127.0.0.1.nip.io',
            databaseName: 'tenant_t_candlekeep',
          },
        })
      }

      throw new Error(`Unexpected fetch ${method} ${path}`)
    })

    const notice = await provisionTenantThroughOperatorPortal({
      accessToken: createMockJwt({ email: 'site-admin@example.com' }),
      refreshToken: 'smoke-refresh-token',
      tenantId: 'candlekeep',
      tenantSlug: 'candlekeep',
      ownerId: 'owner-99',
      initialAdminEmail: 'keeper@candlekeep.example',
      version: 'k3d',
      reason: 'Launch the full-stack smoke tenant',
    })

    expect(createRequests).toEqual([
      {
        id: 'candlekeep',
        slug: 'candlekeep',
        ownerId: 'owner-99',
        initialAdminEmail: 'keeper@candlekeep.example',
        version: 'k3d',
      },
    ])
    expect(provisionRequests).toEqual([
      {
        triggeredBy: 'site-admin@example.com',
        reason: 'Launch the full-stack smoke tenant',
        version: 'k3d',
      },
    ])
    expect(notice.notice).toContain('Provisioned candlekeep.')
    expect(notice.notice).toContain('Namespace tenant-t-candlekeep')
    expect(notice.notice).toContain('host t-candlekeep.127.0.0.1.nip.io')
  })

  it('waits for the initial fleet refresh before submitting provisioning', async () => {
    let fleetFetchCount = 0

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)

      if (path === '/operator-api/internal/fleet/status' && method === 'GET') {
        fleetFetchCount += 1

        if (fleetFetchCount === 1) {
          await new Promise((resolve) => setTimeout(resolve, 1500))
        }

        return createJsonResponse(createFleetStatus())
      }

      if (path === '/operator-api/internal/tenants' && method === 'POST') {
        return createJsonResponse({
          tenant: {
            id: 'slow-fleet',
            slug: 'slow-fleet',
            subdomain: 'slow-fleet',
            ownerId: 'owner-7',
            initialAdminEmail: 'owner@example.com',
            desiredState: 'provisioning',
            currentState: 'provisioning',
            version: 'k3d',
          },
        }, 201)
      }

      if (
        path === '/operator-api/internal/tenants/slow-fleet/provision' &&
        method === 'POST'
      ) {
        return createJsonResponse({
          tenant: {
            id: 'slow-fleet',
            slug: 'slow-fleet',
            subdomain: 'slow-fleet',
            ownerId: 'owner-7',
            initialAdminEmail: 'owner@example.com',
            desiredState: 'ready',
            currentState: 'ready',
            version: 'k3d',
          },
          resources: {
            namespace: 'tenant-slow-fleet',
            hostname: 'slow-fleet.example.test',
            databaseName: 'tenant_slow_fleet',
          },
        })
      }

      throw new Error(`Unexpected fetch ${method} ${path}`)
    })

    const notice = await provisionTenantThroughOperatorPortal({
      accessToken: createMockJwt({ email: 'slow-admin@example.com' }),
      refreshToken: 'slow-refresh-token',
      tenantId: 'slow-fleet',
      tenantSlug: 'slow-fleet',
      ownerId: 'owner-7',
      initialAdminEmail: 'owner@example.com',
      version: 'k3d',
      reason: 'Wait for fleet health before provisioning',
    })

    expect(fleetFetchCount).toBeGreaterThanOrEqual(1)
    expect(notice.notice).toContain('Provisioned slow-fleet.')
  })
})

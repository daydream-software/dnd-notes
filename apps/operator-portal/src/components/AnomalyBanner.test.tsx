import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import AnomalyBanner from './AnomalyBanner'
import type { FleetTenantStatus, TenantState, TenantUptime } from '../types'

afterEach(() => {
  cleanup()
})

function makeUptime(overrides: Partial<TenantUptime> = {}): TenantUptime {
  return {
    currentStateSince: '2026-04-22T12:00:00.000Z',
    uptimePct: 99.5,
    totalSleepMs: 0,
    lastSleepMs: null,
    wakeCount: 0,
    lastWakeAt: null,
    seenByActivator: true,
    ...overrides,
  }
}

function makeStatus(
  id: string,
  slug: string,
  currentState: TenantState,
  uptime?: TenantUptime,
): FleetTenantStatus {
  return {
    tenant: {
      id,
      slug,
      subdomain: `t-${slug}`,
      ownerId: 'owner-1',
      desiredState: 'ready',
      currentState,
      version: '1.0.0',
      storageReference: null,
      backupMetadata: null,
      createdAt: '2026-04-22T16:00:00.000Z',
      updatedAt: '2026-04-22T17:00:00.000Z',
    },
    health: 'healthy',
    backup: {
      rawMetadata: null,
      location: null,
      lastBackupAt: null,
      lastBackupStatus: null,
      lastRestoreDrillAt: null,
      lastRestoreDrillStatus: null,
    },
    latestTransition: null,
    uptime,
  }
}

describe('AnomalyBanner', () => {
  it('renders nothing when there are zero anomalies', () => {
    const tenants = [
      makeStatus('t-1', 'alpha-keep', 'ready', makeUptime({ seenByActivator: true })),
      makeStatus('t-2', 'beta-watch', 'ready'),
    ]

    const { container } = render(<AnomalyBanner tenants={tenants} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders banner with count for one stuck-sleeping tenant', () => {
    const tenants = [
      makeStatus('t-1', 'nether-hold', 'sleeping', makeUptime({ seenByActivator: false })),
      makeStatus('t-2', 'alpha-keep', 'ready', makeUptime({ seenByActivator: true })),
    ]

    render(<AnomalyBanner tenants={tenants} />)

    expect(screen.getByText('1 anomaly detected')).toBeTruthy()
    expect(screen.getByText('nether-hold')).toBeTruthy()
  })

  it('renders banner with plural count for multiple stuck-sleeping tenants', () => {
    const tenants = [
      makeStatus('t-1', 'nether-hold', 'sleeping', makeUptime({ seenByActivator: false })),
      makeStatus('t-2', 'shadow-fort', 'sleeping', makeUptime({ seenByActivator: false })),
      makeStatus('t-3', 'alpha-keep', 'ready', makeUptime({ seenByActivator: true })),
    ]

    render(<AnomalyBanner tenants={tenants} />)

    expect(screen.getByText('2 anomalies detected')).toBeTruthy()
    expect(screen.getByText('nether-hold')).toBeTruthy()
    expect(screen.getByText('shadow-fort')).toBeTruthy()
  })

  it('does not flag a sleeping tenant when seenByActivator is true', () => {
    const tenants = [
      makeStatus('t-1', 'alpha-keep', 'sleeping', makeUptime({ seenByActivator: true })),
    ]

    const { container } = render(<AnomalyBanner tenants={tenants} />)
    expect(container.firstChild).toBeNull()
  })

  it('does not flag a ready tenant even when seenByActivator is false', () => {
    const tenants = [
      makeStatus('t-1', 'alpha-keep', 'ready', makeUptime({ seenByActivator: false })),
    ]

    const { container } = render(<AnomalyBanner tenants={tenants} />)
    expect(container.firstChild).toBeNull()
  })
})

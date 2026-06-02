import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TenantTable from './TenantTable'
import type { FleetTenantStatus } from '../types'

afterEach(() => {
  cleanup()
})

import type { TenantUptime } from '../types'

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

function makeStatus(overrides: Partial<FleetTenantStatus['tenant']> & {
  health?: FleetTenantStatus['health']
  latestTransition?: FleetTenantStatus['latestTransition']
  uptime?: FleetTenantStatus['uptime']
} = {}): FleetTenantStatus {
  const { health = 'healthy', latestTransition = null, uptime, ...tenantOverrides } = overrides
  return {
    tenant: {
      id: 'tenant-abc',
      slug: 'alpha-keep',
      subdomain: 't-alpha-keep',
      ownerId: 'owner-1',
      desiredState: 'ready',
      currentState: 'ready',
      version: '1.0.0',
      storageReference: 'pvc-alpha-keep',
      backupMetadata: null,
      createdAt: '2026-04-22T16:00:00.000Z',
      updatedAt: '2026-04-22T17:00:00.000Z',
      ...tenantOverrides,
    },
    health,
    backup: {
      rawMetadata: null,
      location: null,
      lastBackupAt: null,
      lastBackupStatus: null,
      lastRestoreDrillAt: null,
      lastRestoreDrillStatus: null,
    },
    latestTransition,
    uptime,
  }
}

describe('TenantTable', () => {
  it('renders tenant slugs and a caption count', () => {
    const tenants = [
      makeStatus({ slug: 'alpha-keep', id: 'tenant-a' }),
      makeStatus({ slug: 'beta-watch', id: 'tenant-b' }),
    ]

    render(
      <TenantTable
        tenants={tenants}
        mutationDisabled={false}
        onUpgrade={vi.fn()}
        onDeprovision={vi.fn()}
      />,
    )

    expect(screen.getByText('alpha-keep')).toBeTruthy()
    expect(screen.getByText('beta-watch')).toBeTruthy()
    expect(screen.getByText('2 tenants')).toBeTruthy()
  })

  it('shows singular caption for one tenant', () => {
    render(
      <TenantTable
        tenants={[makeStatus()]}
        mutationDisabled={false}
        onUpgrade={vi.fn()}
        onDeprovision={vi.fn()}
      />,
    )

    expect(screen.getByText('1 tenant')).toBeTruthy()
  })

  it('shows empty-fleet message when tenants array is empty', () => {
    render(
      <TenantTable
        tenants={[]}
        mutationDisabled={false}
        onUpgrade={vi.fn()}
        onDeprovision={vi.fn()}
      />,
    )

    expect(screen.getByText('No tenant instances have been provisioned yet.')).toBeTruthy()
  })

  it('sorts by slug ascending by default, clicking slug header flips to descending', async () => {
    const user = userEvent.setup()
    const tenants = [
      makeStatus({ slug: 'zephyr-vault', id: 'tenant-z' }),
      makeStatus({ slug: 'alpha-keep', id: 'tenant-a' }),
      makeStatus({ slug: 'moonshae-ledger', id: 'tenant-m' }),
    ]

    render(
      <TenantTable
        tenants={tenants}
        mutationDisabled={false}
        onUpgrade={vi.fn()}
        onDeprovision={vi.fn()}
      />,
    )

    // Default: sorted asc by slug — alpha-keep should appear first in table body
    const rows = screen.getAllByRole('row')
    // rows[0] is the thead tr; data rows start at index 1
    expect(rows[1].textContent).toContain('alpha-keep')
    expect(rows[2].textContent).toContain('moonshae-ledger')
    expect(rows[3].textContent).toContain('zephyr-vault')

    // Click Tenant header button to flip to descending
    await user.click(screen.getByRole('button', { name: /Tenant/i }))

    const rowsDesc = screen.getAllByRole('row')
    expect(rowsDesc[1].textContent).toContain('zephyr-vault')
    expect(rowsDesc[3].textContent).toContain('alpha-keep')
  })

  it('filters by state chip selection', async () => {
    const user = userEvent.setup()
    const tenants = [
      makeStatus({ slug: 'ready-tenant', id: 'tenant-ready', currentState: 'ready' }),
      makeStatus({ slug: 'failed-tenant', id: 'tenant-failed', currentState: 'failed', desiredState: 'ready' }),
    ]

    render(
      <TenantTable
        tenants={tenants}
        mutationDisabled={false}
        onUpgrade={vi.fn()}
        onDeprovision={vi.fn()}
      />,
    )

    // Both visible initially
    expect(screen.getByText('ready-tenant')).toBeTruthy()
    expect(screen.getByText('failed-tenant')).toBeTruthy()

    // Click the 'Failed' filter chip
    await user.click(screen.getByRole('button', { name: 'Failed' }))

    expect(screen.queryByText('ready-tenant')).toBeNull()
    expect(screen.getByText('failed-tenant')).toBeTruthy()

    // Click 'All states' to reset
    await user.click(screen.getByRole('button', { name: 'All states' }))

    expect(screen.getByText('ready-tenant')).toBeTruthy()
    expect(screen.getByText('failed-tenant')).toBeTruthy()
  })

  it('shows no-match message when filter narrows to zero results', async () => {
    const user = userEvent.setup()
    const tenants = [
      makeStatus({ slug: 'ready-tenant', id: 'tenant-ready', currentState: 'ready' }),
    ]

    render(
      <TenantTable
        tenants={tenants}
        mutationDisabled={false}
        onUpgrade={vi.fn()}
        onDeprovision={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Failed' }))

    expect(screen.getByText('No tenants match this filter.')).toBeTruthy()
  })

  it('filters by slug via search input', async () => {
    const user = userEvent.setup()
    const tenants = [
      makeStatus({ slug: 'moonshae-ledger', id: 'tenant-moon' }),
      makeStatus({ slug: 'stormwatch', id: 'tenant-storm' }),
    ]

    render(
      <TenantTable
        tenants={tenants}
        mutationDisabled={false}
        onUpgrade={vi.fn()}
        onDeprovision={vi.fn()}
      />,
    )

    const searchInput = screen.getByPlaceholderText(/Filter by slug, id, owner/i)
    await user.type(searchInput, 'storm')

    expect(screen.queryByText('moonshae-ledger')).toBeNull()
    expect(screen.getByText('stormwatch')).toBeTruthy()
  })

  it('filters by tenant id via search input', async () => {
    const user = userEvent.setup()
    const tenants = [
      makeStatus({ slug: 'moonshae-ledger', id: 'tenant-moon-001' }),
      makeStatus({ slug: 'stormwatch', id: 'tenant-storm-002' }),
    ]

    render(
      <TenantTable
        tenants={tenants}
        mutationDisabled={false}
        onUpgrade={vi.fn()}
        onDeprovision={vi.fn()}
      />,
    )

    const searchInput = screen.getByPlaceholderText(/Filter by slug, id, owner/i)
    await user.type(searchInput, 'moon-001')

    expect(screen.getByText('moonshae-ledger')).toBeTruthy()
    expect(screen.queryByText('stormwatch')).toBeNull()
  })

  it('shows roll and deprovision icon buttons for ready tenants', () => {
    const tenants = [makeStatus({ slug: 'alpha-keep', id: 'tenant-a', currentState: 'ready' })]
    const onUpgrade = vi.fn()
    const onDeprovision = vi.fn()

    render(
      <TenantTable
        tenants={tenants}
        mutationDisabled={false}
        onUpgrade={onUpgrade}
        onDeprovision={onDeprovision}
      />,
    )

    expect(screen.getByRole('button', { name: /Roll alpha-keep to new version/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Deprovision alpha-keep/ })).toBeTruthy()
  })

  it('does not show roll button for non-ready tenants', () => {
    const tenants = [makeStatus({ slug: 'alpha-keep', id: 'tenant-a', currentState: 'failed', desiredState: 'ready' })]

    render(
      <TenantTable
        tenants={tenants}
        mutationDisabled={false}
        onUpgrade={vi.fn()}
        onDeprovision={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: /Roll alpha-keep to new version/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Deprovision alpha-keep/ })).toBeTruthy()
  })

  it('hides action buttons for deprovisioned tenants', () => {
    const tenants = [
      makeStatus({ slug: 'alpha-keep', id: 'tenant-a', currentState: 'deprovisioned', desiredState: 'deprovisioned' }),
    ]

    render(
      <TenantTable
        tenants={tenants}
        mutationDisabled={false}
        onUpgrade={vi.fn()}
        onDeprovision={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: /Roll alpha-keep/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Deprovision alpha-keep/ })).toBeNull()
  })

  it('fires onUpgrade with correct status when roll button is clicked', async () => {
    const user = userEvent.setup()
    const status = makeStatus({ slug: 'alpha-keep', id: 'tenant-a', currentState: 'ready' })
    const onUpgrade = vi.fn()

    render(
      <TenantTable
        tenants={[status]}
        mutationDisabled={false}
        onUpgrade={onUpgrade}
        onDeprovision={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Roll alpha-keep to new version/ }))
    expect(onUpgrade).toHaveBeenCalledWith(status)
  })

  it('fires onDeprovision with correct status when deprovision button is clicked', async () => {
    const user = userEvent.setup()
    const status = makeStatus({ slug: 'alpha-keep', id: 'tenant-a', currentState: 'ready' })
    const onDeprovision = vi.fn()

    render(
      <TenantTable
        tenants={[status]}
        mutationDisabled={false}
        onUpgrade={vi.fn()}
        onDeprovision={onDeprovision}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Deprovision alpha-keep/ }))
    expect(onDeprovision).toHaveBeenCalledWith(status)
  })

  it('renders last transition chips when latestTransition is present', () => {
    const status = makeStatus({
      slug: 'alpha-keep',
      id: 'tenant-a',
      latestTransition: {
        id: 1,
        tenantId: 'tenant-a',
        fromState: 'provisioning',
        toState: 'ready',
        triggeredBy: 'operator',
        reason: null,
        createdAt: '2026-04-22T17:00:00.000Z',
      },
    })

    render(
      <TenantTable
        tenants={[status]}
        mutationDisabled={false}
        onUpgrade={vi.fn()}
        onDeprovision={vi.fn()}
      />,
    )

    const row = screen.getAllByRole('row')[1]
    // 'Provisioning' appears once (fromState chip in last-transition column)
    expect(within(row).getByText('Provisioning')).toBeTruthy()
    // 'Ready' appears twice: once for current state chip, once for toState chip
    expect(within(row).getAllByText('Ready').length).toBeGreaterThan(0)
  })

  it('renders "None recorded" when latestTransition is null', () => {
    render(
      <TenantTable
        tenants={[makeStatus({ latestTransition: null })]}
        mutationDisabled={false}
        onUpgrade={vi.fn()}
        onDeprovision={vi.fn()}
      />,
    )

    expect(screen.getByText('None recorded')).toBeTruthy()
  })

  it('caption shows total count when no filter is active', () => {
    const tenants = [
      makeStatus({ slug: 'alpha-keep', id: 'tenant-a' }),
      makeStatus({ slug: 'beta-watch', id: 'tenant-b' }),
      makeStatus({ slug: 'gamma-fort', id: 'tenant-c' }),
    ]

    render(
      <TenantTable
        tenants={tenants}
        mutationDisabled={false}
        onUpgrade={vi.fn()}
        onDeprovision={vi.fn()}
      />,
    )

    expect(screen.getByText('3 tenants')).toBeTruthy()
  })

  it('caption shows "M of N tenants" when state filter narrows results', async () => {
    const user = userEvent.setup()
    const tenants = [
      makeStatus({ slug: 'ready-one', id: 'tenant-r1', currentState: 'ready' }),
      makeStatus({ slug: 'ready-two', id: 'tenant-r2', currentState: 'ready' }),
      makeStatus({ slug: 'failed-one', id: 'tenant-f1', currentState: 'failed', desiredState: 'ready' }),
    ]

    render(
      <TenantTable
        tenants={tenants}
        mutationDisabled={false}
        onUpgrade={vi.fn()}
        onDeprovision={vi.fn()}
      />,
    )

    // Before filtering: all 3 visible
    expect(screen.getByText('3 tenants')).toBeTruthy()

    // Apply state filter for 'Failed' → only 1 matches
    await user.click(screen.getByRole('button', { name: 'Failed' }))

    expect(screen.getByText('1 of 3 tenants')).toBeTruthy()
  })

  it('caption shows "M of N tenants" when search narrows results', async () => {
    const user = userEvent.setup()
    const tenants = [
      makeStatus({ slug: 'moonshae-ledger', id: 'tenant-moon' }),
      makeStatus({ slug: 'stormwatch', id: 'tenant-storm' }),
    ]

    render(
      <TenantTable
        tenants={tenants}
        mutationDisabled={false}
        onUpgrade={vi.fn()}
        onDeprovision={vi.fn()}
      />,
    )

    // Before filtering: both visible
    expect(screen.getByText('2 tenants')).toBeTruthy()

    const searchInput = screen.getByPlaceholderText(/Filter by slug, id, owner/i)
    await user.type(searchInput, 'storm')

    expect(screen.getByText('1 of 2 tenants')).toBeTruthy()
  })

  // ── Uptime column ──────────────────────────────────────────────────────────

  it('renders uptime percentage when uptime is present', () => {
    const tenants = [
      makeStatus({ slug: 'alpha-keep', id: 'tenant-a', uptime: makeUptime({ uptimePct: 98.7 }) }),
    ]

    render(
      <TenantTable
        tenants={tenants}
        mutationDisabled={false}
        onUpgrade={vi.fn()}
        onDeprovision={vi.fn()}
      />,
    )

    expect(screen.getByText('98.7%')).toBeTruthy()
  })

  it('renders "last wake —" when lastWakeAt is null', () => {
    const tenants = [
      makeStatus({ slug: 'alpha-keep', id: 'tenant-a', uptime: makeUptime({ lastWakeAt: null }) }),
    ]

    render(
      <TenantTable
        tenants={tenants}
        mutationDisabled={false}
        onUpgrade={vi.fn()}
        onDeprovision={vi.fn()}
      />,
    )

    expect(screen.getByText('last wake —')).toBeTruthy()
  })

  it('renders "—" in uptime column when uptime is missing', () => {
    const tenants = [makeStatus({ slug: 'alpha-keep', id: 'tenant-a' })]

    render(
      <TenantTable
        tenants={tenants}
        mutationDisabled={false}
        onUpgrade={vi.fn()}
        onDeprovision={vi.fn()}
      />,
    )

    // One "—" for the uptime cell (may also appear in actions for deprovisioned, but this is ready)
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(1)
  })

  // ── Stuck-sleeping badge ──────────────────────────────────────────────────

  it('renders stuck-sleeping badge when currentState is sleeping and seenByActivator is false', () => {
    const tenants = [
      makeStatus({
        slug: 'alpha-keep',
        id: 'tenant-a',
        currentState: 'sleeping',
        desiredState: 'ready',
        uptime: makeUptime({ seenByActivator: false }),
      }),
    ]

    render(
      <TenantTable
        tenants={tenants}
        mutationDisabled={false}
        onUpgrade={vi.fn()}
        onDeprovision={vi.fn()}
      />,
    )

    expect(screen.getByText('Stuck sleeping')).toBeTruthy()
  })

  it('does not render stuck-sleeping badge when seenByActivator is true', () => {
    const tenants = [
      makeStatus({
        slug: 'alpha-keep',
        id: 'tenant-a',
        currentState: 'sleeping',
        desiredState: 'ready',
        uptime: makeUptime({ seenByActivator: true }),
      }),
    ]

    render(
      <TenantTable
        tenants={tenants}
        mutationDisabled={false}
        onUpgrade={vi.fn()}
        onDeprovision={vi.fn()}
      />,
    )

    expect(screen.queryByText('Stuck sleeping')).toBeNull()
  })

  it('does not render stuck-sleeping badge when tenant is not sleeping', () => {
    const tenants = [
      makeStatus({
        slug: 'alpha-keep',
        id: 'tenant-a',
        currentState: 'ready',
        uptime: makeUptime({ seenByActivator: false }),
      }),
    ]

    render(
      <TenantTable
        tenants={tenants}
        mutationDisabled={false}
        onUpgrade={vi.fn()}
        onDeprovision={vi.fn()}
      />,
    )

    expect(screen.queryByText('Stuck sleeping')).toBeNull()
  })

  // ── Anomalies only filter ─────────────────────────────────────────────────

  it('"Anomalies only" filter narrows to stuck-sleeping tenants', async () => {
    const user = userEvent.setup()

    const sleeping = makeStatus({ slug: 'nether-hold', id: 'tenant-s', currentState: 'sleeping', uptime: makeUptime({ seenByActivator: false }) })

    const normal = makeStatus({ slug: 'alpha-keep', id: 'tenant-a' })

    render(
      <TenantTable
        tenants={[sleeping, normal]}
        mutationDisabled={false}
        onUpgrade={vi.fn()}
        onDeprovision={vi.fn()}
      />,
    )

    expect(screen.getByText('nether-hold')).toBeTruthy()
    expect(screen.getByText('alpha-keep')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Anomalies only' }))

    expect(screen.getByText('nether-hold')).toBeTruthy()
    expect(screen.queryByText('alpha-keep')).toBeNull()
  })

  // ── Sort by uptime ────────────────────────────────────────────────────────

  it('sorts by uptime ascending when Uptime header is clicked', async () => {
    const user = userEvent.setup()
    const tenants = [
      makeStatus({ slug: 'dragon-peak', id: 'tenant-h', uptime: makeUptime({ uptimePct: 99.9 }) }),
      makeStatus({ slug: 'shadow-keep', id: 'tenant-l', uptime: makeUptime({ uptimePct: 72.3 }) }),
      makeStatus({ slug: 'storm-reach', id: 'tenant-m', uptime: makeUptime({ uptimePct: 85.1 }) }),
    ]

    render(
      <TenantTable
        tenants={tenants}
        mutationDisabled={false}
        onUpgrade={vi.fn()}
        onDeprovision={vi.fn()}
      />,
    )

    // Click Uptime header to sort ascending (exact text to avoid collision with Roll button aria-labels)
    await user.click(screen.getByRole('button', { name: 'Uptime' }))

    const rows = screen.getAllByRole('row')
    expect(rows[1].textContent).toContain('shadow-keep')
    expect(rows[2].textContent).toContain('storm-reach')
    expect(rows[3].textContent).toContain('dragon-peak')
  })

  it('sorts tenants without uptime data to the bottom regardless of sort direction', async () => {
    const user = userEvent.setup()
    const tenants = [
      makeStatus({ slug: 'no-uptime-tenant', id: 'tenant-x' }),
      makeStatus({ slug: 'dragon-peak', id: 'tenant-h', uptime: makeUptime({ uptimePct: 99.9 }) }),
      makeStatus({ slug: 'shadow-keep', id: 'tenant-l', uptime: makeUptime({ uptimePct: 72.3 }) }),
    ]

    render(
      <TenantTable
        tenants={tenants}
        mutationDisabled={false}
        onUpgrade={vi.fn()}
        onDeprovision={vi.fn()}
      />,
    )

    const uptimeBtn = screen.getByRole('button', { name: 'Uptime' })

    // Ascending: lower uptime first, no-uptime always last
    await user.click(uptimeBtn)
    let rows = screen.getAllByRole('row')
    expect(rows[1].textContent).toContain('shadow-keep')
    expect(rows[2].textContent).toContain('dragon-peak')
    expect(rows[3].textContent).toContain('no-uptime-tenant')

    // Descending: higher uptime first, no-uptime still last
    await user.click(uptimeBtn)
    rows = screen.getAllByRole('row')
    expect(rows[1].textContent).toContain('dragon-peak')
    expect(rows[2].textContent).toContain('shadow-keep')
    expect(rows[3].textContent).toContain('no-uptime-tenant')
  })

  it('sorts by uptime descending on second Uptime header click', async () => {
    const user = userEvent.setup()
    const tenants = [
      makeStatus({ slug: 'dragon-peak', id: 'tenant-h', uptime: makeUptime({ uptimePct: 99.9 }) }),
      makeStatus({ slug: 'shadow-keep', id: 'tenant-l', uptime: makeUptime({ uptimePct: 72.3 }) }),
      makeStatus({ slug: 'storm-reach', id: 'tenant-m', uptime: makeUptime({ uptimePct: 85.1 }) }),
    ]

    render(
      <TenantTable
        tenants={tenants}
        mutationDisabled={false}
        onUpgrade={vi.fn()}
        onDeprovision={vi.fn()}
      />,
    )

    const uptimeBtn = screen.getByRole('button', { name: 'Uptime' })
    await user.click(uptimeBtn) // asc
    await user.click(uptimeBtn) // desc

    const rows = screen.getAllByRole('row')
    expect(rows[1].textContent).toContain('dragon-peak')
    expect(rows[2].textContent).toContain('storm-reach')
    expect(rows[3].textContent).toContain('shadow-keep')
  })
})

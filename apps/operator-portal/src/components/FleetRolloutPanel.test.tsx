import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deriveSuggestedRolloutVersion } from '../fleet-rollout-utils'
import type { UseFleetRolloutResult } from '../hooks/useFleetRollout'
import type { FleetRollout, FleetTenantStatus } from '../types'
import FleetRolloutPanel from './FleetRolloutPanel'

// ── Factories ─────────────────────────────────────────────────────────────────

function makeRollout(overrides: Partial<FleetRollout> = {}): FleetRollout {
  return {
    id: 'rl_test',
    targetVersion: '1.4.3',
    status: 'running',
    triggeredBy: 'operator@example.com',
    startedAt: '2026-06-01T14:32:08.000Z',
    endedAt: null,
    abortReason: null,
    failedTenant: null,
    failedError: null,
    total: 5,
    completed: 2,
    failed: 0,
    skipped: 1,
    pending: 2,
    currentTenant: 'iron-vault',
    elapsedSeconds: 252,
    ...overrides,
  }
}

function makeTenant(version: string): FleetTenantStatus {
  return {
    tenant: {
      id: `tenant-${version}`,
      slug: `tenant-${version}`,
      subdomain: null,
      ownerId: 'owner-id',
      desiredState: 'ready',
      currentState: 'ready',
      version,
      storageReference: null,
      backupMetadata: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
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
  }
}

function makeHook(overrides: Partial<UseFleetRolloutResult> = {}): UseFleetRolloutResult {
  return {
    rollout: null,
    isPolling: false,
    isStarting: false,
    isAborting: false,
    error: null,
    provisioningNotConfigured: false,
    startRollout: vi.fn().mockResolvedValue({ id: 'rl_test', status: 'running', startedAt: '' }),
    abortRollout: vi.fn().mockResolvedValue({ status: 'aborted' }),
    ...overrides,
  }
}

const defaultProps = {
  actor: 'operator@example.com',
  disabledReason: null as string | null,
  surfaceRadius: '18px',
  tenants: [makeTenant('1.4.2'), makeTenant('1.4.2'), makeTenant('1.4.3')],
  onError: vi.fn(),
}

function renderPanel(
  hookOverrides: Partial<UseFleetRolloutResult> = {},
  propOverrides: Partial<typeof defaultProps> = {},
) {
  const hook = makeHook(hookOverrides)
  const props = { ...defaultProps, ...propOverrides }
  const result = render(
    <FleetRolloutPanel
      actor={props.actor}
      disabledReason={props.disabledReason}
      hook={hook}
      surfaceRadius={props.surfaceRadius}
      tenants={props.tenants}
      onError={props.onError}
    />,
  )
  return { ...result, hook }
}

// ── Unit: deriveSuggestedRolloutVersion ───────────────────────────────────────

describe('deriveSuggestedRolloutVersion', () => {
  it('returns empty string for empty fleet', () => {
    expect(deriveSuggestedRolloutVersion([])).toBe('')
  })

  it('returns the majority version', () => {
    const tenants = [makeTenant('1.2.0'), makeTenant('1.2.0'), makeTenant('1.3.0')]
    expect(deriveSuggestedRolloutVersion(tenants)).toBe('1.2.0')
  })

  it('returns the highest version on tie', () => {
    const tenants = [makeTenant('1.2.0'), makeTenant('1.3.0')]
    expect(deriveSuggestedRolloutVersion(tenants)).toBe('1.3.0')
  })
})

// ── Component ─────────────────────────────────────────────────────────────────

describe('FleetRolloutPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  // ── Compose state ───────────────────────────────────────────────────────────

  it('renders the trigger button in compose state (no rollout)', () => {
    renderPanel()
    expect(screen.getByRole('button', { name: /roll fleet to version/i })).toBeTruthy()
  })

  it('reveals the inline form when the trigger button is clicked', async () => {
    renderPanel()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /roll fleet to version/i }))
    expect(screen.getByLabelText(/target version/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /start rollout/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeTruthy()
  })

  it('prefills target version from suggested majority version', async () => {
    renderPanel()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /roll fleet to version/i }))
    // The default tenants fixture has 2x '1.4.2' and 1x '1.4.3', so majority = '1.4.2'
    expect((screen.getByLabelText(/target version/i) as HTMLInputElement).value).toBe('1.4.2')
  })

  it('cancel button closes the compose form', async () => {
    renderPanel()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /roll fleet to version/i }))
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(screen.queryByLabelText(/target version/i)).toBeNull()
  })

  it('calls startRollout with the correct params', async () => {
    const { hook } = renderPanel()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /roll fleet to version/i }))
    const versionInput = screen.getByLabelText(/target version/i)
    await user.clear(versionInput)
    await user.type(versionInput, '1.5.0')
    await user.click(screen.getByRole('button', { name: /start rollout/i }))
    await waitFor(() => {
      expect(hook.startRollout).toHaveBeenCalledWith({
        version: '1.5.0',
        triggeredBy: 'operator@example.com',
      })
    })
  })

  it('disables the Start button when the version field is empty', async () => {
    // Render with empty fleet so the suggested version is empty.
    renderPanel({}, { tenants: [] })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /roll fleet to version/i }))
    // Field should be empty with no suggested version.
    const versionInput = screen.getByLabelText(/target version/i) as HTMLInputElement
    expect(versionInput.value).toBe('')
    expect(screen.getByRole('button', { name: /start rollout/i })).toHaveProperty('disabled', true)
  })

  it('hides the trigger button when disabledReason is set', () => {
    renderPanel({}, { disabledReason: 'Provisioning lane is degraded.' })
    expect(screen.queryByRole('button', { name: /roll fleet to version/i })).toBeNull()
    expect(screen.getByText(/Provisioning lane is degraded/i)).toBeTruthy()
  })

  // ── Running state ───────────────────────────────────────────────────────────

  it('renders the progress bar and counts in running state', () => {
    renderPanel({ rollout: makeRollout() })
    expect(screen.getByText(/rolling to/i)).toBeTruthy()
    // 2 completed + 0 failed + 1 skipped = 3 / 5 processed
    expect(screen.getByText(/3 \/ 5 tenants processed/i)).toBeTruthy()
    expect(screen.getByText(/2 succeeded/i)).toBeTruthy()
    expect(screen.getByText(/1 skipped/i)).toBeTruthy()
  })

  it('shows the current-tenant indicator with autorenew icon in running state', () => {
    renderPanel({ rollout: makeRollout({ currentTenant: 'iron-vault' }) })
    expect(screen.getByText(/iron-vault/)).toBeTruthy()
    expect(screen.getByText(/currently rolling/i)).toBeTruthy()
  })

  it('renders the Abort button in running state', () => {
    renderPanel({ rollout: makeRollout() })
    expect(screen.getByRole('button', { name: /abort rollout/i })).toBeTruthy()
  })

  it('opens the abort confirmation dialog when Abort button is clicked', async () => {
    renderPanel({ rollout: makeRollout() })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /abort rollout/i }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText(/abort fleet rollout\?/i)).toBeTruthy()
  })

  it('fires abortRollout after confirming the dialog', async () => {
    const abortRollout = vi.fn().mockResolvedValue({ status: 'aborted' })
    renderPanel({ rollout: makeRollout(), abortRollout })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /abort rollout/i }))
    await user.type(screen.getByLabelText(/reason/i), 'Pausing to investigate.')
    await user.click(screen.getByRole('button', { name: /^abort rollout$/i }))
    await waitFor(() => {
      expect(abortRollout).toHaveBeenCalledWith({ reason: 'Pausing to investigate.' })
    })
  })

  it('fires abortRollout with no reason when left blank', async () => {
    const abortRollout = vi.fn().mockResolvedValue({ status: 'aborted' })
    renderPanel({ rollout: makeRollout(), abortRollout })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /abort rollout/i }))
    // Don't type a reason — just confirm.
    await user.click(screen.getByRole('button', { name: /^abort rollout$/i }))
    await waitFor(() => {
      expect(abortRollout).toHaveBeenCalledWith({ reason: undefined })
    })
  })

  it('dialog cancel does not call abortRollout', async () => {
    const abortRollout = vi.fn()
    renderPanel({ rollout: makeRollout(), abortRollout })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /abort rollout/i }))
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(abortRollout).not.toHaveBeenCalled()
  })

  // ── Terminal: completed ─────────────────────────────────────────────────────

  it('renders completed callout for completed rollout', () => {
    renderPanel({
      rollout: makeRollout({
        status: 'completed',
        completed: 4,
        failed: 0,
        skipped: 1,
        currentTenant: null,
        endedAt: '2026-06-01T14:44:11.000Z',
      }),
    })
    expect(screen.getByText(/rolled 4 tenants to 1\.4\.3/i)).toBeTruthy()
    // "1 skipped" appears in both the progress row and the success callout — use getAllByText.
    expect(screen.getAllByText(/1 skipped/i).length).toBeGreaterThanOrEqual(1)
  })

  it('Dismiss button in completed state removes the rollout from view', async () => {
    const rollout = makeRollout({ status: 'completed', currentTenant: null, endedAt: '2026-06-01T14:44:11.000Z' })
    renderPanel({ rollout })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(screen.queryByText(/rolling to/i)).toBeNull()
  })

  // ── Terminal: aborted ───────────────────────────────────────────────────────

  it('renders aborted callout with reason', () => {
    renderPanel({
      rollout: makeRollout({
        status: 'aborted',
        currentTenant: null,
        endedAt: '2026-06-01T14:37:55.000Z',
        abortReason: 'Investigating archve flapping.',
      }),
    })
    expect(screen.getByText(/rollout aborted/i)).toBeTruthy()
    expect(screen.getByText(/Investigating archve flapping\./)).toBeTruthy()
  })

  // ── Terminal: failed ────────────────────────────────────────────────────────

  it('renders failed callout with tenant and error message', () => {
    renderPanel({
      rollout: makeRollout({
        status: 'failed',
        failed: 1,
        currentTenant: null,
        endedAt: '2026-06-01T14:40:29.000Z',
        failedTenant: 'pale-watch',
        failedError: 'PVC migration failed: insufficient block storage.',
      }),
    })
    expect(screen.getByText(/pale-watch/)).toBeTruthy()
    expect(screen.getByText(/PVC migration failed/i)).toBeTruthy()
  })

  // ── 501 / provisioning not configured ──────────────────────────────────────

  it('renders the 501 message when provisioningNotConfigured is true', () => {
    renderPanel({ provisioningNotConfigured: true })
    expect(
      screen.getByText(/provisioning is not configured for this environment/i),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: /roll fleet to version/i })).toBeNull()
  })
})

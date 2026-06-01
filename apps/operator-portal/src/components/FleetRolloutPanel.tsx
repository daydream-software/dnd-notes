import AutorenewRoundedIcon from '@mui/icons-material/AutorenewRounded'
import CancelRoundedIcon from '@mui/icons-material/CancelRounded'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import ErrorRoundedIcon from '@mui/icons-material/ErrorRounded'
import RocketLaunchRoundedIcon from '@mui/icons-material/RocketLaunchRounded'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import * as React from 'react'
import { ApiError } from '../control-plane-api'
import { deriveSuggestedRolloutVersion } from '../fleet-rollout-utils'
import type { UseFleetRolloutResult } from '../hooks/useFleetRollout'
import type { FleetRollout, FleetTenantStatus } from '../types'

const { useCallback, useMemo, useState } = React

function formatElapsed(seconds: number): string {
  if (seconds < 60) {
    return `${Math.floor(seconds)}s`
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`
  }
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function computeProgress(rollout: FleetRollout): number {
  if (!rollout.total) {
    return 0
  }
  return Math.round(
    ((rollout.completed + rollout.failed + rollout.skipped) / rollout.total) * 100,
  )
}

// ── Abort confirmation dialog ─────────────────────────────────────────────────

interface AbortDialogProps {
  open: boolean
  isAborting: boolean
  onCancel: () => void
  onConfirm: (reason: string) => void
  surfaceRadius: string
}

function AbortDialog({ open, isAborting, onCancel, onConfirm, surfaceRadius }: AbortDialogProps) {
  const [reason, setReason] = useState('')

  const handleConfirm = useCallback(() => {
    onConfirm(reason)
    setReason('')
  }, [onConfirm, reason])

  const handleCancel = useCallback(() => {
    setReason('')
    onCancel()
  }, [onCancel])

  return (
    <Dialog
      open={open}
      onClose={isAborting ? undefined : handleCancel}
      fullWidth
      maxWidth="sm"
    >
      <DialogTitle>Abort fleet rollout?</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography color="text.secondary">
            The tenant currently being upgraded will be allowed to finish. Remaining
            tenants will not be started. Already-upgraded tenants are left as-is — no
            rollback.
          </Typography>
          <TextField
            label="Reason (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            multiline
            minRows={2}
            fullWidth
            disabled={isAborting}
            helperText="Recorded in the rollout audit trail."
            sx={{ borderRadius: surfaceRadius }}
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={handleCancel} disabled={isAborting}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="error"
          onClick={handleConfirm}
          disabled={isAborting}
        >
          {isAborting ? 'Aborting…' : 'Abort rollout'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export interface FleetRolloutPanelProps {
  actor: string
  disabledReason?: string | null
  hook: UseFleetRolloutResult
  surfaceRadius: string
  tenants: FleetTenantStatus[]
  onError: (message: string) => void
}

export default function FleetRolloutPanel({
  actor,
  disabledReason,
  hook,
  surfaceRadius,
  tenants,
  onError,
}: FleetRolloutPanelProps) {
  const {
    rollout,
    isStarting,
    isAborting,
    provisioningNotConfigured,
    startRollout,
    abortRollout,
  } = hook

  const suggestedVersion = useMemo(() => deriveSuggestedRolloutVersion(tenants), [tenants])

  const [composeOpen, setComposeOpen] = useState(false)
  const [targetVersion, setTargetVersion] = useState(suggestedVersion)
  const [abortDialogOpen, setAbortDialogOpen] = useState(false)

  // Keep targetVersion in sync when the suggestion changes (fleet data refreshes).
  React.useEffect(() => {
    if (!composeOpen) {
      setTargetVersion(suggestedVersion)
    }
  }, [suggestedVersion, composeOpen])

  // After a terminal rollout is dismissed, keep local state clear.
  const [dismissed, setDismissed] = useState<string | null>(null)
  const visibleRollout = rollout?.id === dismissed ? null : rollout

  const isRunning = visibleRollout?.status === 'running'

  const handleOpenCompose = useCallback(() => {
    setTargetVersion(suggestedVersion)
    setComposeOpen(true)
  }, [suggestedVersion])

  const handleCancelCompose = useCallback(() => {
    setComposeOpen(false)
  }, [])

  const handleStartRollout = useCallback(async () => {
    const version = targetVersion.trim()
    if (!version) {
      onError('Target version is required to start a fleet rollout.')
      return
    }

    try {
      await startRollout({ version, triggeredBy: actor })
      setComposeOpen(false)
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 409) {
        // 409 means an existing rollout is already running — the hook refetched
        // and the running-state UI will take over automatically.
        setComposeOpen(false)
        return
      }

      if (err instanceof ApiError && err.statusCode === 501) {
        // Already surfaced via provisioningNotConfigured flag.
        return
      }

      const message = err instanceof Error ? err.message : 'Could not start fleet rollout.'
      onError(message)
    }
  }, [actor, onError, startRollout, targetVersion])

  const handleAbortConfirm = useCallback(
    async (reason: string) => {
      try {
        await abortRollout({ reason: reason.trim() || undefined })
        setAbortDialogOpen(false)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not abort fleet rollout.'
        onError(message)
        setAbortDialogOpen(false)
      }
    },
    [abortRollout, onError],
  )

  const handleDismiss = useCallback(() => {
    if (rollout) {
      setDismissed(rollout.id)
    }
  }, [rollout])

  // ── 501 — provisioning not configured ─────────────────────────────────────

  if (provisioningNotConfigured) {
    return (
      <Card sx={{ borderRadius: surfaceRadius }}>
        <CardContent sx={{ p: 3 }}>
          <Alert severity="info" sx={{ borderRadius: surfaceRadius }}>
            Provisioning is not configured for this environment. Fleet rollouts are unavailable.
          </Alert>
        </CardContent>
      </Card>
    )
  }

  const progressPct = visibleRollout ? computeProgress(visibleRollout) : 0

  const progressColor: 'error' | 'warning' | 'success' | 'primary' =
    visibleRollout?.status === 'failed'
      ? 'error'
      : visibleRollout?.status === 'aborted'
        ? 'warning'
        : visibleRollout?.status === 'completed'
          ? 'success'
          : 'primary'

  return (
    <>
      <Card sx={{ borderRadius: surfaceRadius }}>
        <CardContent sx={{ p: 3 }}>
          <Stack spacing={2.5}>
            {/* Header row */}
            <Box>
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap' }}>
                <Box>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <RocketLaunchRoundedIcon color="primary" />
                    <Typography variant="h5">Fleet rolling update</Typography>
                  </Stack>
                  <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                    Roll a new version progressively across every eligible tenant — one at a
                    time, serialized server-side. Closing the tab does not stop the rollout.
                  </Typography>
                </Box>

                {/* Trigger button — hidden when rollout is active, disabled shown, or compose open */}
                {!visibleRollout && !composeOpen && !disabledReason ? (
                  <Button
                    variant="outlined"
                    startIcon={<RocketLaunchRoundedIcon />}
                    onClick={handleOpenCompose}
                    sx={{ alignSelf: 'flex-start', whiteSpace: 'nowrap' }}
                  >
                    Roll fleet to version…
                  </Button>
                ) : null}
              </Stack>

              {disabledReason && !visibleRollout ? (
                <Alert severity="info" sx={{ mt: 1.5, borderRadius: surfaceRadius }}>
                  {disabledReason}
                </Alert>
              ) : null}
            </Box>

            {/* Compose form */}
            {composeOpen && !visibleRollout ? (
              <Box
                sx={{
                  display: 'flex',
                  gap: 1.5,
                  alignItems: 'flex-end',
                  flexWrap: 'wrap',
                  p: 2,
                  borderRadius: surfaceRadius,
                  border: '1px solid var(--brand-line-soft)',
                  backdropFilter: 'var(--card-blur)',
                  background: 'var(--bg-paper-soft)',
                }}
              >
                <Box sx={{ flex: '1 1 240px', minWidth: 180 }}>
                  <TextField
                    label="Target version"
                    value={targetVersion}
                    onChange={(e) => setTargetVersion(e.target.value)}
                    helperText={
                      suggestedVersion
                        ? `Suggested from majority fleet version (${suggestedVersion}).`
                        : 'Enter the target image version.'
                    }
                    disabled={isStarting}
                    fullWidth
                    required
                  />
                </Box>
                <Button
                  variant="outlined"
                  onClick={handleCancelCompose}
                  disabled={isStarting}
                  sx={{ alignSelf: 'flex-start' }}
                >
                  Cancel
                </Button>
                <Button
                  variant="contained"
                  startIcon={<RocketLaunchRoundedIcon />}
                  onClick={() => void handleStartRollout()}
                  disabled={!targetVersion.trim() || isStarting}
                  sx={{ alignSelf: 'flex-start' }}
                >
                  {isStarting ? 'Starting…' : 'Start rollout'}
                </Button>
              </Box>
            ) : null}

            {/* Active or terminal rollout view */}
            {visibleRollout ? (
              <Stack spacing={2}>
                {/* Banner row */}
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  sx={{ justifyContent: 'space-between', alignItems: { sm: 'flex-start' }, gap: 1.5 }}
                >
                  <Box>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                      Rolling to{' '}
                      <Box component="span" sx={{ fontFamily: 'Geist Mono, monospace', color: 'primary.main' }}>
                        {visibleRollout.targetVersion}
                      </Box>
                    </Typography>
                    <Typography color="text.secondary" variant="body2" sx={{ mt: 0.25 }}>
                      Started {formatTimestamp(visibleRollout.startedAt)} by{' '}
                      <Box component="span" sx={{ fontFamily: 'Geist Mono, monospace', color: 'text.primary' }}>
                        {visibleRollout.triggeredBy}
                      </Box>
                      {visibleRollout.endedAt
                        ? ` · ended ${formatTimestamp(visibleRollout.endedAt)}`
                        : ''}
                      {' · '}
                      {formatElapsed(visibleRollout.elapsedSeconds)} elapsed
                    </Typography>
                  </Box>

                  <Stack direction="row" spacing={1}>
                    {isRunning ? (
                      <Button
                        color="error"
                        variant="outlined"
                        startIcon={<CancelRoundedIcon />}
                        onClick={() => setAbortDialogOpen(true)}
                        disabled={isAborting}
                        sx={{ alignSelf: 'flex-start', whiteSpace: 'nowrap' }}
                      >
                        Abort rollout
                      </Button>
                    ) : (
                      <Button
                        variant="text"
                        startIcon={<CloseRoundedIcon />}
                        onClick={handleDismiss}
                        sx={{ alignSelf: 'flex-start' }}
                      >
                        Dismiss
                      </Button>
                    )}
                  </Stack>
                </Stack>

                {/* Progress bar */}
                <Box>
                  <LinearProgress
                    variant="determinate"
                    value={progressPct}
                    color={progressColor}
                    sx={{ borderRadius: 999, height: 6 }}
                  />
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    sx={{ justifyContent: 'space-between', mt: 1, gap: 0.5 }}
                  >
                    <Typography color="text.secondary" variant="body2">
                      {visibleRollout.completed + visibleRollout.failed + visibleRollout.skipped}
                      {' / '}
                      {visibleRollout.total} tenants processed
                      {' · '}
                      <Box component="span" sx={{ color: 'success.main' }}>
                        {visibleRollout.completed} succeeded
                      </Box>
                      {visibleRollout.skipped > 0 ? (
                        <>
                          {' · '}
                          <Box component="span" sx={{ color: 'text.disabled' }}>
                            {visibleRollout.skipped} skipped
                          </Box>
                        </>
                      ) : null}
                      {visibleRollout.failed > 0 ? (
                        <>
                          {' · '}
                          <Box component="span" sx={{ color: 'error.main' }}>
                            {visibleRollout.failed} failed
                          </Box>
                        </>
                      ) : null}
                    </Typography>

                    {isRunning && visibleRollout.currentTenant ? (
                      <Typography
                        color="primary"
                        variant="body2"
                        sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
                      >
                        <AutorenewRoundedIcon fontSize="small" sx={{ fontSize: 14 }} />
                        Currently rolling{' '}
                        <Box component="span" sx={{ fontFamily: 'Geist Mono, monospace', color: 'text.primary' }}>
                          {visibleRollout.currentTenant}
                        </Box>
                      </Typography>
                    ) : null}
                  </Stack>
                </Box>

                {/* Terminal-state callouts */}
                {visibleRollout.status === 'failed' ? (
                  <Alert
                    severity="error"
                    icon={<ErrorRoundedIcon fontSize="inherit" />}
                    sx={{ borderRadius: surfaceRadius }}
                  >
                    Halted at{' '}
                    <Box component="span" sx={{ fontFamily: 'Geist Mono, monospace' }}>
                      {visibleRollout.failedTenant}
                    </Box>
                    {visibleRollout.failedError ? `. ${visibleRollout.failedError}` : ''}
                    {' '}
                    Already-upgraded tenants are left as-is — no rollback.
                  </Alert>
                ) : null}

                {visibleRollout.status === 'aborted' ? (
                  <Alert
                    severity="warning"
                    icon={<CancelRoundedIcon fontSize="inherit" />}
                    sx={{ borderRadius: surfaceRadius }}
                  >
                    Rollout aborted. The tenant mid-provision was allowed to finish; remaining
                    tenants were not started.
                    {visibleRollout.abortReason ? ` ${visibleRollout.abortReason}` : ''}
                  </Alert>
                ) : null}

                {visibleRollout.status === 'completed' ? (
                  <Alert
                    severity="success"
                    icon={<CheckCircleRoundedIcon fontSize="inherit" />}
                    sx={{ borderRadius: surfaceRadius }}
                  >
                    Rolled {visibleRollout.completed}{' '}
                    {visibleRollout.completed === 1 ? 'tenant' : 'tenants'} to{' '}
                    {visibleRollout.targetVersion}.
                    {visibleRollout.skipped > 0
                      ? ` ${visibleRollout.skipped} skipped (sleeping or deprovisioned).`
                      : ''}
                  </Alert>
                ) : null}
              </Stack>
            ) : null}
          </Stack>
        </CardContent>
      </Card>

      <AbortDialog
        open={abortDialogOpen}
        isAborting={isAborting}
        onCancel={() => setAbortDialogOpen(false)}
        onConfirm={(reason) => void handleAbortConfirm(reason)}
        surfaceRadius={surfaceRadius}
      />
    </>
  )
}

import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import * as React from 'react'
import { provisionTenant } from './control-plane-api'
import type { FleetTenantStatus } from './types'

const { useEffect, useMemo, useState } = React

interface TenantUpgradeDialogProps {
  actor: string
  authToken: string
  onClose: () => void
  onError: (message: string) => void
  onRefresh: () => Promise<void>
  onUpgraded: (message: string) => void
  open: boolean
  suggestedVersion: string
  surfaceRadius: number
  tenantStatus: FleetTenantStatus | null
}

function getInitialTargetVersion(
  tenantStatus: FleetTenantStatus | null,
  suggestedVersion: string,
) {
  if (!tenantStatus) {
    return ''
  }

  const normalizedSuggestedVersion = suggestedVersion.trim()

  if (
    normalizedSuggestedVersion.length === 0 ||
    normalizedSuggestedVersion === tenantStatus.tenant.version
  ) {
    return ''
  }

  return normalizedSuggestedVersion
}

export default function TenantUpgradeDialog({
  actor,
  authToken,
  onClose,
  onError,
  onRefresh,
  onUpgraded,
  open,
  suggestedVersion,
  surfaceRadius,
  tenantStatus,
}: TenantUpgradeDialogProps) {
  const [targetVersion, setTargetVersion] = useState('')
  const [reason, setReason] = useState('')
  const [confirmationValue, setConfirmationValue] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submissionError, setSubmissionError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setTargetVersion(getInitialTargetVersion(tenantStatus, suggestedVersion))
      setReason('')
      setConfirmationValue('')
      setSubmissionError(null)
    }
  }, [open, suggestedVersion, tenantStatus])

  const normalizedTargetVersion = targetVersion.trim()
  const requiresVersionChange =
    tenantStatus != null && normalizedTargetVersion !== tenantStatus.tenant.version
  const confirmationMatches =
    normalizedTargetVersion.length > 0 &&
    confirmationValue.trim() === normalizedTargetVersion
  const canSubmit =
    Boolean(tenantStatus) &&
    reason.trim().length > 0 &&
    normalizedTargetVersion.length > 0 &&
    requiresVersionChange &&
    confirmationMatches &&
    !isSubmitting

  const versionHelperText = useMemo(() => {
    if (!tenantStatus) {
      return 'Enter the image/app version you want the control plane to deploy.'
    }

    if (
      suggestedVersion.trim().length > 0 &&
      suggestedVersion.trim() !== tenantStatus.tenant.version
    ) {
      return `Prefilled from the fleet majority (${suggestedVersion.trim()}). Change it if this tenant needs a different rollout.`
    }

    return `Enter a different version than the current ${tenantStatus.tenant.version} to trigger a rolling update.`
  }, [suggestedVersion, tenantStatus])

  const handleConfirm = async () => {
    if (!tenantStatus || !canSubmit) {
      return
    }

    setIsSubmitting(true)
    setSubmissionError(null)

    try {
      const result = await provisionTenant(authToken, tenantStatus.tenant.id, {
        triggeredBy: actor,
        reason: reason.trim(),
        version: normalizedTargetVersion,
      })

      await onRefresh()
      onUpgraded(
        `Rolled ${result.tenant.slug} to ${result.tenant.version}. The control plane used the existing provision route and returned the tenant as ${result.tenant.currentState} after the drain-first replacement.`,
      )
      onClose()
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Could not roll the tenant forward.'
      setSubmissionError(message)
      onError(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!isSubmitting) {
          onClose()
        }
      }}
      fullWidth
      maxWidth="sm"
    >
      <DialogTitle>Confirm rolling update</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert
            severity="warning"
            icon={<WarningAmberRoundedIcon fontSize="inherit" />}
            sx={{ borderRadius: surfaceRadius }}
          >
            Rolling update reuses the live <code>/internal/tenants/:tenantId/provision</code>{' '}
            route. The control plane marks the tenant upgrading, drains the current pod,
            swaps the image tag, and only returns to ready when the replacement is
            healthy.
          </Alert>

          {submissionError ? (
            <Alert severity="error" sx={{ borderRadius: surfaceRadius }}>
              {submissionError}
            </Alert>
          ) : null}

          {tenantStatus ? (
            <>
              <Typography variant="body2">
                <strong>Tenant:</strong> {tenantStatus.tenant.slug} ({tenantStatus.tenant.id})
              </Typography>
              <Typography variant="body2">
                <strong>Current version:</strong> {tenantStatus.tenant.version}
              </Typography>
              <Typography variant="body2">
                <strong>Triggered by:</strong> {actor}
              </Typography>
            </>
          ) : null}

          <TextField
            label="Target version"
            value={targetVersion}
            onChange={(event) => {
              setTargetVersion(event.target.value)
              setSubmissionError(null)
            }}
            helperText={versionHelperText}
            fullWidth
            required
          />
          <TextField
            label="Operator reason"
            value={reason}
            onChange={(event) => {
              setReason(event.target.value)
              setSubmissionError(null)
            }}
            helperText="Saved to the upgrade transition audit trail."
            fullWidth
            required
            multiline
            minRows={2}
          />
          <TextField
            label="Confirm target version"
            value={confirmationValue}
            onChange={(event) => {
              setConfirmationValue(event.target.value)
              setSubmissionError(null)
            }}
            helperText="Re-enter the target version so the rollout target stays explicit."
            fullWidth
            required
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => void handleConfirm()} disabled={!canSubmit}>
          {isSubmitting ? 'Rolling update…' : 'Start rolling update'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

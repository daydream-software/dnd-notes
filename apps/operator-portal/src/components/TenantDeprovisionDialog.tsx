import DeleteForeverRoundedIcon from '@mui/icons-material/DeleteForeverRounded'
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
import { deprovisionTenant } from '../control-plane-api'
import type { FleetTenantStatus } from '../types'

const { useEffect, useMemo, useState } = React

interface TenantDeprovisionDialogProps {
  actor: string
  authToken: string
  onClose: () => void
  onDeprovisioned: (message: string) => void
  onError: (message: string) => void
  onRefresh: () => Promise<void>
  open: boolean
  surfaceRadius: string
  tenantStatus: FleetTenantStatus | null
}

export default function TenantDeprovisionDialog({
  actor,
  authToken,
  onClose,
  onDeprovisioned,
  onError,
  onRefresh,
  open,
  surfaceRadius,
  tenantStatus,
}: TenantDeprovisionDialogProps) {
  const [reason, setReason] = useState('')
  const [confirmationValue, setConfirmationValue] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setReason('')
      setConfirmationValue('')
    }
  }, [open, tenantStatus?.tenant.id])

  const confirmationMatches = useMemo(
    () => confirmationValue.trim() === tenantStatus?.tenant.slug,
    [confirmationValue, tenantStatus?.tenant.slug],
  )

  const canSubmit =
    Boolean(tenantStatus) &&
    reason.trim().length > 0 &&
    confirmationMatches &&
    !isSubmitting

  const handleConfirm = async () => {
    if (!tenantStatus || !canSubmit) {
      return
    }

    setIsSubmitting(true)

    try {
      const result = await deprovisionTenant(authToken, tenantStatus.tenant.id, {
        triggeredBy: actor,
        reason: reason.trim(),
      })

      await onRefresh()
      onDeprovisioned(
        `Deprovisioned ${result.tenant.slug}. The control plane now reports it as ${result.tenant.currentState}, and any recorded backup metadata stays visible for audit follow-up.`,
      )
      onClose()
    } catch (error) {
      onError(
        error instanceof Error ? error.message : 'Could not deprovision the tenant.',
      )
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
      <DialogTitle>Confirm deprovision</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert
            severity="warning"
            icon={<WarningAmberRoundedIcon fontSize="inherit" />}
            sx={{ borderRadius: surfaceRadius }}
          >
            Deprovisioning deletes the live tenant resources. Keep the reason crisp
            so the transition history explains why the instance was retired.
          </Alert>

          {tenantStatus ? (
            <>
              <Typography variant="body2">
                <strong>Tenant:</strong> {tenantStatus.tenant.slug} ({tenantStatus.tenant.id})
              </Typography>
              <Typography variant="body2">
                <strong>Current state:</strong> {tenantStatus.tenant.currentState}
              </Typography>
              <Typography variant="body2">
                <strong>Triggered by:</strong> {actor}
              </Typography>
              <Typography variant="body2">
                Type <strong>{tenantStatus.tenant.slug}</strong> to confirm this
                destructive action.
              </Typography>
            </>
          ) : null}

          <TextField
            label="Operator reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            helperText="Saved to the deprovision transition audit trail."
            fullWidth
            required
            multiline
            minRows={2}
          />
          <TextField
            label="Confirm tenant slug"
            value={confirmationValue}
            onChange={(event) => setConfirmationValue(event.target.value)}
            helperText="This stays intentionally explicit because the action is destructive."
            fullWidth
            required
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="warning"
          startIcon={<DeleteForeverRoundedIcon />}
          onClick={() => void handleConfirm()}
          disabled={!canSubmit}
        >
          {isSubmitting ? 'Deprovisioning…' : 'Deprovision tenant now'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

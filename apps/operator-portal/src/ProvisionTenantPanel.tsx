import AddCircleOutlineRoundedIcon from '@mui/icons-material/AddCircleOutlineRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
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
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import * as React from 'react'
import { ApiError, createTenant, provisionTenant } from './control-plane-api'
import type { CreateTenantRequest } from './types'

const { useEffect, useMemo, useState } = React

interface ProvisionTenantPanelProps {
  actor: string
  authToken: string
  disabledReason?: string | null
  onError: (message: string) => void
  onProvisioned: (message: string) => void
  onRefresh: () => Promise<void>
  suggestedVersion: string
  surfaceRadius: number
}

interface ProvisionDraft {
  id: string
  slug: string
  ownerId: string
  initialAdminEmail: string
  version: string
  reason: string
}

function createInitialDraft(suggestedVersion: string): ProvisionDraft {
  return {
    id: '',
    slug: '',
    ownerId: '',
    initialAdminEmail: '',
    version: suggestedVersion,
    reason: '',
  }
}

function normalizeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
}

function normalizeDraft(draft: ProvisionDraft, suggestedVersion: string): ProvisionDraft {
  const normalizedSlug = normalizeSlug(draft.slug)

  return {
    id: draft.id.trim().length > 0 ? draft.id.trim() : normalizedSlug,
    slug: normalizedSlug,
    ownerId: draft.ownerId.trim(),
    initialAdminEmail: draft.initialAdminEmail.trim(),
    version: draft.version.trim().length > 0 ? draft.version.trim() : suggestedVersion,
    reason: draft.reason.trim(),
  }
}

function getValidationMessage(draft: ProvisionDraft) {
  if (
    !draft.id ||
    !draft.slug ||
    !draft.ownerId ||
    !draft.initialAdminEmail ||
    !draft.version ||
    !draft.reason
  ) {
    return 'Fill tenant ID, slug, owner ID, initial admin email, version, and operator reason before provisioning.'
  }

  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(draft.slug)) {
    return 'Tenant slug must use lowercase letters, numbers, and hyphens only.'
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.initialAdminEmail)) {
    return 'Initial admin email must be a valid email address.'
  }

  return null
}

export default function ProvisionTenantPanel({
  actor,
  authToken,
  disabledReason,
  onError,
  onProvisioned,
  onRefresh,
  suggestedVersion,
  surfaceRadius,
}: ProvisionTenantPanelProps) {
  const [draft, setDraft] = useState(() => createInitialDraft(suggestedVersion))
  const [isReviewOpen, setIsReviewOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    setDraft((currentDraft) =>
      currentDraft.version.trim().length > 0 || suggestedVersion.trim().length === 0
        ? currentDraft
        : { ...currentDraft, version: suggestedVersion },
    )
  }, [suggestedVersion])

  const normalizedDraft = useMemo(
    () => normalizeDraft(draft, suggestedVersion),
    [draft, suggestedVersion],
  )
  const validationMessage = useMemo(
    () => getValidationMessage(normalizedDraft),
    [normalizedDraft],
  )

  const handleSubmit = () => {
    if (disabledReason) {
      onError(disabledReason)
      return
    }

    if (validationMessage) {
      onError(validationMessage)
      return
    }

    setDraft(normalizedDraft)
    setIsReviewOpen(true)
  }

  const handleConfirm = async () => {
    if (disabledReason) {
      onError(disabledReason)
      return
    }

    if (validationMessage) {
      onError(validationMessage)
      return
    }

    setIsSubmitting(true)
    let tenantCreated = false
    let tenantAlreadyExisted = false

    try {
      const createTenantRequest = {
        id: normalizedDraft.id,
        slug: normalizedDraft.slug,
        ownerId: normalizedDraft.ownerId,
        ...(normalizedDraft.initialAdminEmail
          ? { initialAdminEmail: normalizedDraft.initialAdminEmail }
          : {}),
        version: normalizedDraft.version,
      } satisfies CreateTenantRequest

      try {
        await createTenant(authToken, createTenantRequest)
        tenantCreated = true
      } catch (error) {
        // 409 means the tenant record already exists — continue to provisioning
        // so the operator can re-provision tenants that failed or were deprovisioned.
        if (error instanceof ApiError && error.statusCode === 409) {
          tenantAlreadyExisted = true
        } else {
          throw error
        }
      }

      const provisioningResult = await provisionTenant(authToken, normalizedDraft.id, {
        triggeredBy: actor,
        reason: normalizedDraft.reason,
        version: normalizedDraft.version,
      })

      await onRefresh()
      setDraft(createInitialDraft(suggestedVersion))
      setIsReviewOpen(false)
      onProvisioned(
        tenantAlreadyExisted
          ? `Re-provisioned existing tenant ${provisioningResult.tenant.slug}. Namespace ${provisioningResult.resources.namespace}, host ${provisioningResult.resources.hostname}.`
          : `Provisioned ${provisioningResult.tenant.slug}. Namespace ${provisioningResult.resources.namespace}, host ${provisioningResult.resources.hostname}, and database ${provisioningResult.resources.databaseName} came from the live control-plane response.`,
      )
    } catch (error) {
      if (tenantCreated) {
        await onRefresh()
      }

      const message =
        error instanceof Error ? error.message : 'Could not provision the tenant.'
      onError(
        tenantCreated
          ? `Created ${normalizedDraft.slug}, but provisioning failed: ${message} The tenant record stays visible for retry or triage.`
          : message,
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <Card sx={{ borderRadius: surfaceRadius }}>
        <CardContent sx={{ p: 3 }}>
          <Stack spacing={2.5}>
            <Box>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <AddCircleOutlineRoundedIcon color="primary" />
                <Typography variant="h5">Provision tenant</Typography>
              </Stack>
              <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                Create the tenant record, then hand provisioning to the existing
                control-plane route. No browser-local lifecycle state gets invented
                here.
              </Typography>
            </Box>

            <Alert severity="warning" sx={{ borderRadius: surfaceRadius }}>
              Confirmation creates a real tenant record immediately, then asks the
              control plane to create the namespace, deployment, service, PVC,
              runtime secret, and database. Failures after creation stay visible in
              the fleet list for retry/triage.
            </Alert>

            {disabledReason ? (
              <Alert severity="info" sx={{ borderRadius: surfaceRadius }}>
                {disabledReason}
              </Alert>
            ) : null}

            <Stack spacing={2}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                <TextField
                  label="Tenant ID"
                  value={draft.id}
                  onChange={(event) =>
                    setDraft((currentDraft) => ({
                      ...currentDraft,
                      id: event.target.value,
                    }))
                  }
                  fullWidth
                  required
                />
                <TextField
                  label="Tenant slug"
                  value={draft.slug}
                  onChange={(event) =>
                    setDraft((currentDraft) => ({
                      ...currentDraft,
                      slug: event.target.value,
                    }))
                  }
                  onBlur={() =>
                    setDraft((currentDraft) => {
                      const normalizedSlug = normalizeSlug(currentDraft.slug)

                      return {
                        ...currentDraft,
                        slug: normalizedSlug,
                        id:
                          currentDraft.id.trim().length > 0
                            ? currentDraft.id
                            : normalizedSlug,
                      }
                    })
                  }
                  helperText="Lowercase letters, numbers, and hyphens only."
                  fullWidth
                  required
                />
              </Stack>

              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                <TextField
                  label="Owner ID"
                  value={draft.ownerId}
                  onChange={(event) =>
                    setDraft((currentDraft) => ({
                      ...currentDraft,
                      ownerId: event.target.value,
                    }))
                  }
                  fullWidth
                  required
                />
                <TextField
                  label="Initial admin email"
                  type="email"
                  value={draft.initialAdminEmail}
                  onChange={(event) =>
                    setDraft((currentDraft) => ({
                      ...currentDraft,
                      initialAdminEmail: event.target.value,
                    }))
                  }
                  helperText="Recorded on the tenant record for later bootstrap work."
                  fullWidth
                  required
                />
                <TextField
                  label="Tenant version"
                  value={draft.version}
                  onChange={(event) =>
                    setDraft((currentDraft) => ({
                      ...currentDraft,
                      version: event.target.value,
                    }))
                  }
                  helperText={
                    suggestedVersion
                      ? `Prefilled from the current fleet (${suggestedVersion}).`
                      : 'Use the tenant image/app version you want to deploy.'
                  }
                  fullWidth
                  required
                />
              </Stack>

              <TextField
                label="Operator reason"
                value={draft.reason}
                onChange={(event) =>
                  setDraft((currentDraft) => ({
                    ...currentDraft,
                    reason: event.target.value,
                  }))
                }
                helperText={`Recorded in the tenant transition audit trail as ${actor}.`}
                fullWidth
                required
                multiline
                minRows={2}
              />
            </Stack>

            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1.5}
              sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
            >
              <Typography color="text.secondary" variant="body2">
                Acting as <strong>{actor}</strong>
              </Typography>
              <Button
                variant="contained"
                onClick={handleSubmit}
                disabled={Boolean(disabledReason) || isSubmitting}
              >
                Review and provision tenant
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Dialog
        open={isReviewOpen}
        onClose={() => {
          if (!isSubmitting) {
            setIsReviewOpen(false)
          }
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Confirm tenant provisioning</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert
              severity="warning"
              icon={<WarningAmberRoundedIcon fontSize="inherit" />}
              sx={{ borderRadius: surfaceRadius }}
            >
              This will create the tenant record and trigger real platform work.
            </Alert>

            <Stack spacing={1}>
              <Typography variant="body2">
                <strong>Tenant ID:</strong> {normalizedDraft.id}
              </Typography>
              <Typography variant="body2">
                <strong>Slug:</strong> {normalizedDraft.slug}
              </Typography>
              <Typography variant="body2">
                <strong>Owner ID:</strong> {normalizedDraft.ownerId}
              </Typography>
              <Typography variant="body2">
                <strong>Initial admin email:</strong> {normalizedDraft.initialAdminEmail}
              </Typography>
              <Typography variant="body2">
                <strong>Version:</strong> {normalizedDraft.version}
              </Typography>
              <Typography variant="body2">
                <strong>Triggered by:</strong> {actor}
              </Typography>
              <Typography variant="body2">
                <strong>Reason:</strong> {normalizedDraft.reason}
              </Typography>
            </Stack>

            <Alert severity="info" sx={{ borderRadius: surfaceRadius }}>
              If the create call succeeds but provisioning fails, the new tenant stays
              in the fleet list so the operator can retry the existing
              <code> /internal/tenants/:id/provision</code> path instead of losing
              the audit trail. This slice records the initial admin email for later
              bootstrap work; it does not create the in-tenant admin account yet.
            </Alert>

            {disabledReason ? (
              <Alert severity="info" sx={{ borderRadius: surfaceRadius }}>
                {disabledReason}
              </Alert>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setIsReviewOpen(false)} disabled={isSubmitting}>
            Back
          </Button>
          <Button
            variant="contained"
            onClick={() => void handleConfirm()}
            disabled={Boolean(disabledReason) || isSubmitting}
          >
            {isSubmitting ? 'Provisioning…' : 'Create and provision tenant'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

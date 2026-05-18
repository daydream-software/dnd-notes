import AddCircleOutlineRoundedIcon from '@mui/icons-material/AddCircleOutlineRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import useMediaQuery from '@mui/material/useMediaQuery'
import * as React from 'react'
import { ApiError, createTenant, provisionTenant, searchKeycloakUsers } from '../control-plane-api'
import type { KeycloakUserSummary } from '../control-plane-api'
import type { CreateTenantRequest } from '../types'

const { useCallback, useEffect, useMemo, useRef, useState } = React

interface ProvisionTenantPanelProps {
  actor: string
  authToken: string
  disabledReason?: string | null
  onError: (message: string) => void
  onProvisioned: (message: string) => void
  onRefresh: () => Promise<void>
  suggestedVersion: string
  surfaceRadius: string
}

interface ProvisionDraft {
  id: string
  slug: string
  ownerId: string
  version: string
  reason: string
}

function createInitialDraft(suggestedVersion: string): ProvisionDraft {
  return {
    id: '',
    slug: '',
    ownerId: '',
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
    version: draft.version.trim().length > 0 ? draft.version.trim() : suggestedVersion,
    reason: draft.reason.trim(),
  }
}

function getValidationMessage(draft: ProvisionDraft) {
  if (!draft.id || !draft.slug || !draft.ownerId || !draft.version || !draft.reason) {
    return 'Fill tenant ID, slug, owner, version, and operator reason before provisioning.'
  }

  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(draft.slug)) {
    return 'Tenant slug must use lowercase letters, numbers, and hyphens only.'
  }

  return null
}

function formatUserLabel(user: KeycloakUserSummary): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ')
  return name.length > 0 ? name : (user.username ?? user.id)
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
  const theme = useTheme()
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'))
  const [draft, setDraft] = useState(() => createInitialDraft(suggestedVersion))
  const [isReviewOpen, setIsReviewOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Autocomplete state
  const [ownerOptions, setOwnerOptions] = useState<KeycloakUserSummary[]>([])
  const [ownerInputValue, setOwnerInputValue] = useState('')
  const [selectedOwner, setSelectedOwner] = useState<KeycloakUserSummary | null>(null)
  const [ownerLoading, setOwnerLoading] = useState(false)
  const [ownerError, setOwnerError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const runOwnerSearch = useCallback(
    (query: string) => {
      if (abortRef.current) {
        abortRef.current.abort()
      }

      const trimmed = query.trim()

      if (trimmed.length === 0) {
        setOwnerOptions([])
        setOwnerLoading(false)
        setOwnerError(null)
        return
      }

      const controller = new AbortController()
      abortRef.current = controller
      setOwnerLoading(true)
      setOwnerError(null)

      searchKeycloakUsers(authToken, trimmed, controller.signal)
        .then((results) => {
          setOwnerOptions(results)
          setOwnerLoading(false)
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.name === 'AbortError') {
            return
          }
          setOwnerOptions([])
          setOwnerLoading(false)
          setOwnerError('Could not reach Keycloak — try again')
        })
    },
    [authToken],
  )

  const handleOwnerInputChange = useCallback(
    (_event: React.SyntheticEvent, value: string, reason: string) => {
      // 'input' = user typed; 'clear' = clear button. 'reset' fires when an
      // option is selected to sync the input — we must NOT clear in that case,
      // or we'd immediately wipe the freshly-committed ownerId.
      if (reason === 'input' || reason === 'clear') {
        setSelectedOwner(null)
        setDraft((currentDraft) => ({ ...currentDraft, ownerId: '' }))
      }

      setOwnerInputValue(value)

      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }

      debounceRef.current = setTimeout(() => {
        runOwnerSearch(value)
      }, 300)
    },
    [runOwnerSearch],
  )

  const handleOwnerChange = useCallback(
    (_event: React.SyntheticEvent, value: KeycloakUserSummary | null) => {
      setSelectedOwner(value)
      setDraft((currentDraft) => ({
        ...currentDraft,
        ownerId: value?.id ?? '',
      }))
    },
    [],
  )

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (abortRef.current) abortRef.current.abort()
    }
  }, [])

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
      setSelectedOwner(null)
      setOwnerInputValue('')
      setOwnerOptions([])
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
                <Autocomplete<KeycloakUserSummary>
                  options={ownerOptions}
                  value={selectedOwner}
                  inputValue={ownerInputValue}
                  onInputChange={handleOwnerInputChange}
                  onChange={handleOwnerChange}
                  loading={ownerLoading}
                  filterOptions={(x) => x}
                  getOptionLabel={(option) => option.email ?? option.username ?? option.id}
                  isOptionEqualToValue={(option, value) => option.id === value.id}
                  noOptionsText={
                    ownerError
                      ? 'Could not reach Keycloak — try again'
                      : ownerInputValue.trim().length === 0
                        ? 'Type to search for a user'
                        : 'No users match'
                  }
                  renderOption={(props, option) => {
                    const { key, ...rest } = props as { key?: React.Key } & React.HTMLAttributes<HTMLLIElement>
                    return (
                      <li key={key ?? option.id} {...rest}>
                        <Stack spacing={0}>
                          <Typography variant="body2">
                            {option.email ?? option.id}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {formatUserLabel(option)}
                          </Typography>
                        </Stack>
                      </li>
                    )
                  }}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Search for owner"
                      required
                      error={Boolean(ownerError)}
                      helperText={ownerError ?? undefined}
                      slotProps={{
                        ...params.slotProps,
                        input: {
                          ...params.slotProps.input,
                          endAdornment: (
                            <>
                              {ownerLoading ? (
                                <CircularProgress color="inherit" size={16} />
                              ) : null}
                              {params.slotProps.input.endAdornment}
                            </>
                          ),
                        },
                      }}
                    />
                  )}
                  fullWidth
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
                sx={{ alignSelf: 'flex-start' }}
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
        fullScreen={fullScreen}
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
              the audit trail.
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

import AdminPanelSettingsRoundedIcon from '@mui/icons-material/AdminPanelSettingsRounded'
import ApartmentRoundedIcon from '@mui/icons-material/ApartmentRounded'
import BackupRoundedIcon from '@mui/icons-material/BackupRounded'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import DeleteForeverRoundedIcon from '@mui/icons-material/DeleteForeverRounded'
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded'
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SecurityRoundedIcon from '@mui/icons-material/SecurityRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Divider,
  IconButton,
  Link,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import * as React from 'react'
import {
  buildOperatorRedirectUri,
  customerPortalUrl,
  operatorKeycloakConfig,
  requiredRoles,
} from './config'
import { extractEffectiveRoles, hasAnyRequiredRole } from './keycloak-roles'
import { fetchFleetStatus } from './control-plane-api'
import {
  clearStoredKeycloakTokens,
  createRuntimeKeycloakClient,
  persistKeycloakTokens,
  readStoredKeycloakTokens,
  type RuntimeKeycloakClient,
} from './keycloak-client'
import ProvisionTenantPanel from './ProvisionTenantPanel'
import TenantDeprovisionDialog from './TenantDeprovisionDialog'
import TenantUpgradeDialog from './TenantUpgradeDialog'
import type {
  FleetDependencyHealth,
  FleetStatusResponse,
  FleetTenantBackupStatus,
  FleetTenantStatus,
  OperatorKeycloakConfig,
  TenantState,
} from './types'

const { useCallback, useEffect, useMemo, useRef, useState } = React

interface CopyFieldProps {
  label: string
  value: string
}

function CopyField({ label, value }: CopyFieldProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    if (!navigator.clipboard?.writeText) return
    navigator.clipboard.writeText(value)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {
        setCopied(false)
      })
  }, [value])

  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', minWidth: 0 }}>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ minWidth: 80, flexShrink: 0 }}
      >
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          fontFamily: 'Geist Mono',
          color: 'text.primary',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          minWidth: 0,
        }}
      >
        {value}
      </Typography>
      <Tooltip title={copied ? 'Copied' : 'Copy'} placement="top">
        <IconButton
          size="small"
          onClick={handleCopy}
          aria-label={`Copy ${label}`}
          sx={{ flexShrink: 0, p: 0.25 }}
        >
          <ContentCopyRoundedIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </Tooltip>
    </Stack>
  )
}

export const surfaceRadius = '18px'

function formatTimestamp(value: string | null) {
  return value ? new Date(value).toLocaleString() : 'Not recorded'
}

function formatUptime(seconds: number) {
  if (seconds < 60) {
    return `${Math.floor(seconds)}s`
  }

  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m`
  }

  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}

function formatStateLabel(state: TenantState) {
  return state.charAt(0).toUpperCase() + state.slice(1)
}

function getStateChipColor(state: TenantState) {
  switch (state) {
    case 'ready':
      return 'success'
    case 'failed':
      return 'error'
    case 'maintenance':
    case 'restoring':
    case 'upgrading':
    case 'provisioning':
      return 'warning'
    case 'deprovisioned':
      return 'default'
  }
}

function getHealthChipColor(health: FleetTenantStatus['health']) {
  return health === 'healthy' ? 'success' : 'warning'
}

function getDependencyChipColor(status: FleetDependencyHealth['status']) {
  return status === 'healthy' ? 'success' : 'default'
}

function describeBackup(backup: FleetTenantBackupStatus) {
  if (backup.lastBackupStatus) {
    return backup.lastBackupStatus
  }

  return backup.rawMetadata ? 'recorded' : 'missing'
}

function describeLatestTransition(tenantStatus: FleetTenantStatus) {
  if (!tenantStatus.latestTransition) {
    return 'No transition recorded yet.'
  }

  const latestTransition = tenantStatus.latestTransition
  return `${formatStateLabel(latestTransition.fromState)} → ${formatStateLabel(
    latestTransition.toState,
  )} at ${formatTimestamp(latestTransition.createdAt)} by ${latestTransition.triggeredBy}.`
}

function decodeJwtPayload(token: string) {
  const parts = token.split('.')

  if (parts.length < 2) {
    return null
  }

  try {
    const normalizedPayload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padding = '='.repeat((4 - (normalizedPayload.length % 4)) % 4)
    const json = window.atob(`${normalizedPayload}${padding}`)

    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
}

function isAuthorized(token: string): boolean {
  const effectiveRoles = extractEffectiveRoles(token, operatorKeycloakConfig.clientId)
  return hasAnyRequiredRole(effectiveRoles, requiredRoles)
}

function getOperatorActor(authToken: string | null) {
  if (!authToken) {
    return 'operator-portal'
  }

  const payload = decodeJwtPayload(authToken)
  const actorCandidates = [
    payload?.preferred_username,
    payload?.email,
    payload?.name,
    payload?.sub,
  ]

  const actor = actorCandidates.find(
    (candidate): candidate is string =>
      typeof candidate === 'string' && candidate.trim().length > 0,
  )

  return actor?.trim() ?? 'operator-portal'
}

function getSuggestedProvisionVersion(fleetStatus: FleetStatusResponse | null) {
  if (!fleetStatus) {
    return ''
  }

  const versionEntries = Object.entries(fleetStatus.summary.tenantsByVersion)

  if (versionEntries.length === 0) {
    return fleetStatus.controlPlane.version
  }

  return versionEntries.sort((left, right) => right[1] - left[1])[0][0]
}

function getMutationDisabledReason(fleetStatus: FleetStatusResponse | null) {
  if (!fleetStatus) {
    return 'Refresh the live fleet first so the portal can confirm the provisioning lane is healthy.'
  }

  if (fleetStatus.dependencies.tenantProvisioning.status !== 'healthy') {
    return (
      fleetStatus.dependencies.tenantProvisioning.details ??
      'Tenant provisioning is disabled, so portal mutations stay locked.'
    )
  }

  return null
}

interface OperatorPortalProps {
  keycloakClientFactory?: (config: OperatorKeycloakConfig) => RuntimeKeycloakClient
}

export default function OperatorPortal({
  keycloakClientFactory = createRuntimeKeycloakClient,
}: OperatorPortalProps = {}) {
  const keycloakClientRef = useRef<RuntimeKeycloakClient | null>(null)
  const [authToken, setAuthToken] = useState<string | null>(null)
  const [isRoleAuthorized, setIsRoleAuthorized] = useState<boolean | null>(null)
  const [fleetStatus, setFleetStatus] = useState<FleetStatusResponse | null>(null)
  const [isAuthReady, setIsAuthReady] = useState(false)
  const [isLoadingFleet, setIsLoadingFleet] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [deprovisionTarget, setDeprovisionTarget] = useState<FleetTenantStatus | null>(null)
  const [upgradeTarget, setUpgradeTarget] = useState<FleetTenantStatus | null>(null)

  const clearSession = useCallback(() => {
    clearStoredKeycloakTokens()
    keycloakClientRef.current?.clear()
    setAuthToken(null)
    setIsRoleAuthorized(null)
    setFleetStatus(null)
    setIsLoadingFleet(false)
    setError(null)
    setNotice(null)
    setDeprovisionTarget(null)
    setUpgradeTarget(null)
  }, [])

  const loadFleet = useCallback(async (sessionToken: string) => {
    setIsLoadingFleet(true)

    try {
      const nextFleetStatus = await fetchFleetStatus(sessionToken)
      setFleetStatus(nextFleetStatus)
      setError(null)
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Could not load operator fleet status.',
      )
    } finally {
      setIsLoadingFleet(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const keycloakClient = keycloakClientFactory(operatorKeycloakConfig)
    keycloakClientRef.current = keycloakClient

    const bootstrapAuth = async () => {
      try {
        const tokens = await keycloakClient.init(readStoredKeycloakTokens())

        if (cancelled) {
          return
        }

        if (!tokens) {
          clearSession()
          return
        }

        persistKeycloakTokens(tokens)
        setAuthToken(tokens.accessToken)

        const authorized = isAuthorized(tokens.accessToken)
        setIsRoleAuthorized(authorized)

        if (authorized) {
          await loadFleet(tokens.accessToken)
        }
      } catch (bootstrapError) {
        if (!cancelled) {
          clearSession()
          setError(
            bootstrapError instanceof Error
              ? bootstrapError.message
              : 'Could not initialize the operator Keycloak session.',
          )
        }
      } finally {
        if (!cancelled) {
          setIsAuthReady(true)
        }
      }
    }

    void bootstrapAuth()

    return () => {
      cancelled = true
    }
  }, [clearSession, keycloakClientFactory, loadFleet])

  useEffect(() => {
    if (!authToken || !keycloakClientRef.current) {
      return
    }

    let cancelled = false
    const refreshInterval = window.setInterval(() => {
      void keycloakClientRef.current
        ?.refresh(30)
        .then((tokens) => {
          if (cancelled) {
            return
          }

          persistKeycloakTokens(tokens)
          setAuthToken(tokens.accessToken)
        })
        .catch((refreshError) => {
          if (cancelled) {
            return
          }

          clearSession()
          setError(
            refreshError instanceof Error
              ? refreshError.message
              : 'Keycloak session expired. Sign in again.',
          )
        })
    }, 15_000)

    return () => {
      cancelled = true
      window.clearInterval(refreshInterval)
    }
  }, [authToken, clearSession])

  const handleLogin = useCallback(async () => {
    if (!keycloakClientRef.current) {
      setError('Keycloak sign-in is not ready yet. Reload and try again.')
      return
    }

    await keycloakClientRef.current.login(buildOperatorRedirectUri())
  }, [])

  const handleLogout = useCallback(async () => {
    const keycloakClient = keycloakClientRef.current
    const redirectUri = buildOperatorRedirectUri()

    clearSession()

    if (!keycloakClient) {
      return
    }

    try {
      await keycloakClient.logout(redirectUri)
    } catch (logoutError) {
      setError(
        logoutError instanceof Error
          ? logoutError.message
          : 'Could not sign out of the operator portal cleanly.',
      )
    }
  }, [clearSession])

  const operatorActor = useMemo(() => getOperatorActor(authToken), [authToken])
  const suggestedProvisionVersion = useMemo(
    () => getSuggestedProvisionVersion(fleetStatus),
    [fleetStatus],
  )
  const mutationDisabledReason = useMemo(
    () => getMutationDisabledReason(fleetStatus),
    [fleetStatus],
  )

  const summaryCards = useMemo(() => {
    if (!fleetStatus) {
      return []
    }

    return [
      {
        label: 'Fleet tenants',
        value: String(fleetStatus.summary.totalTenants),
        helper: `${fleetStatus.summary.tenantsByCurrentState.ready} ready · ${fleetStatus.summary.tenantsByCurrentState.failed} failed`,
        icon: <ApartmentRoundedIcon color="primary" />,
      },
      {
        label: 'Needs attention',
        value: String(fleetStatus.summary.tenantsNeedingAttention),
        helper: `${fleetStatus.summary.tenantsMissingBackupMetadata} missing backup metadata`,
        icon:
          fleetStatus.summary.tenantsNeedingAttention > 0 ? (
            <WarningAmberRoundedIcon color="warning" />
          ) : (
            <CheckCircleRoundedIcon color="success" />
          ),
      },
      {
        label: 'Backups tracked',
        value: `${fleetStatus.summary.tenantsWithBackupMetadata}/${fleetStatus.summary.totalTenants}`,
        helper: `${fleetStatus.summary.tenantsMissingBackupMetadata} missing`,
        icon: <BackupRoundedIcon color="secondary" />,
      },
      {
        label: 'Provisioning lane',
        value:
          fleetStatus.dependencies.tenantProvisioning.status === 'healthy'
            ? 'Healthy'
            : 'Disabled',
        helper:
          fleetStatus.dependencies.tenantProvisioning.details ??
          'Provisioning endpoint ready.',
        icon: <SecurityRoundedIcon color="info" />,
      },
    ]
  }, [fleetStatus])

  return (
    <Container maxWidth="xl" sx={{ py: 5 }}>
      <Stack spacing={3}>
        <Card sx={{ borderRadius: surfaceRadius }}>
          <CardContent sx={{ p: 3 }}>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={2}
              sx={{ justifyContent: 'space-between', alignItems: { md: 'flex-start' } }}
            >
              <Box>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <AdminPanelSettingsRoundedIcon color="secondary" />
                  <Typography variant="h4">Operator control portal</Typography>
                </Stack>
                <Typography color="text.secondary" sx={{ mt: 1 }}>
                  Inspect and trigger tenant lifecycle work through the existing
                  control-plane routes, not a browser-only write path.
                </Typography>
                <Typography color="text.secondary" variant="body2" sx={{ mt: 1.5 }}>
                  Keycloak realm <strong>{operatorKeycloakConfig.realm}</strong> · client{' '}
                  <strong>{operatorKeycloakConfig.clientId}</strong>
                  {authToken ? (
                    <>
                      {' '}
                      · acting as <strong>{operatorActor}</strong>
                    </>
                  ) : null}
                </Typography>
              </Box>

              {authToken && isRoleAuthorized ? (
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                  <Button
                    variant="outlined"
                    startIcon={<RefreshRoundedIcon />}
                    onClick={() => void loadFleet(authToken)}
                    disabled={isLoadingFleet}
                  >
                    {isLoadingFleet ? 'Refreshing…' : 'Refresh fleet'}
                  </Button>
                  <Button
                    variant="outlined"
                    color="inherit"
                    startIcon={<LogoutRoundedIcon />}
                    onClick={() => void handleLogout()}
                  >
                    Sign out
                  </Button>
                </Stack>
              ) : null}
            </Stack>
          </CardContent>
        </Card>

        <Alert severity="info" sx={{ borderRadius: surfaceRadius }}>
          Portal writes stay on the existing <code>/internal/tenants</code> control-plane
          contract. Provisioning creates real Kubernetes and database resources, while
          deprovisioning deletes live resources and requires explicit confirmation.
        </Alert>

        {notice ? (
          <Alert
            severity="success"
            sx={{ borderRadius: surfaceRadius }}
            data-testid="operator-portal-notice"
          >
            {notice}
          </Alert>
        ) : null}

        {error ? (
          <Alert
            severity="error"
            sx={{ borderRadius: surfaceRadius }}
            data-testid="operator-portal-error"
          >
            {error}
          </Alert>
        ) : null}

        {!isAuthReady ? (
          <Card sx={{ borderRadius: surfaceRadius }}>
            <CardContent sx={{ p: 4 }}>
              <Stack spacing={2} sx={{ alignItems: 'center', textAlign: 'center' }}>
                <CircularProgress />
                <Typography variant="h6">Checking operator session…</Typography>
              </Stack>
            </CardContent>
          </Card>
        ) : !authToken ? (
          <Card sx={{ borderRadius: surfaceRadius }}>
            <CardContent sx={{ p: 4 }}>
              <Stack spacing={2.5} sx={{ alignItems: 'center', textAlign: 'center' }}>
                <SecurityRoundedIcon color="secondary" sx={{ fontSize: 40 }} />
                <Box>
                  <Typography variant="h5">Sign in with Keycloak</Typography>
                  <Typography color="text.secondary" sx={{ mt: 1 }}>
                    Sign in with the workforce/admin Keycloak realm before
                    inspecting fleet state.
                  </Typography>
                </Box>
                <Button
                  variant="contained"
                  size="large"
                  onClick={() => void handleLogin()}
                >
                  Continue with Keycloak
                </Button>
              </Stack>
            </CardContent>
          </Card>
        ) : !isRoleAuthorized ? (
          <Card sx={{ borderRadius: surfaceRadius }} data-testid="access-denied-view">
            <CardContent sx={{ p: 4 }}>
              <Stack spacing={2.5} sx={{ alignItems: 'flex-start' }}>
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                  <SecurityRoundedIcon color="warning" sx={{ fontSize: 36 }} />
                  <Typography variant="h5">Access not authorized</Typography>
                </Stack>
                <Typography color="text.secondary">
                  You don&apos;t have access to the operator console. Your account does not have a
                  required operator role ({requiredRoles.join(', ')}).
                </Typography>
                <Typography color="text.secondary">
                  If you reached here by mistake, sign in to the customer portal instead.{' '}
                  <Link href={customerPortalUrl} underline="hover">
                    Go to customer portal
                  </Link>
                </Typography>
                <Button
                  variant="outlined"
                  color="inherit"
                  startIcon={<LogoutRoundedIcon />}
                  onClick={() => void handleLogout()}
                  sx={{ alignSelf: 'flex-start' }}
                >
                  Sign out
                </Button>
              </Stack>
            </CardContent>
          </Card>
        ) : (
          <>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={2}
              useFlexGap
              sx={{ flexWrap: 'wrap' }}
            >
              {summaryCards.map((card) => (
                <Card
                  key={card.label}
                  variant="outlined"
                  sx={{ flex: '1 1 220px', minWidth: 0, borderRadius: surfaceRadius }}
                >
                  <CardContent sx={{ p: 2.5 }}>
                    <Stack spacing={1.5}>
                      <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                        <Typography color="text.secondary" variant="body2">
                          {card.label}
                        </Typography>
                        {card.icon}
                      </Stack>
                      <Typography variant="h4">{card.value}</Typography>
                      <Typography color="text.secondary" variant="body2">
                        {card.helper}
                      </Typography>
                    </Stack>
                  </CardContent>
                </Card>
              ))}
            </Stack>

            <ProvisionTenantPanel
              actor={operatorActor}
              authToken={authToken}
              disabledReason={mutationDisabledReason}
              onError={(message) => {
                setNotice(null)
                setError(message)
              }}
              onProvisioned={(message) => {
                setError(null)
                setNotice(message)
              }}
              onRefresh={() => loadFleet(authToken)}
              suggestedVersion={suggestedProvisionVersion}
              surfaceRadius={surfaceRadius}
            />

            {fleetStatus ? (
              <Card sx={{ borderRadius: surfaceRadius }}>
                <CardContent sx={{ p: 3 }}>
                  <Stack spacing={2.5}>
                    <Box>
                      <Typography variant="h5">Control-plane status</Typography>
                      <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                        Generated {formatTimestamp(fleetStatus.generatedAt)} · version{' '}
                        {fleetStatus.controlPlane.version} · uptime{' '}
                        {formatUptime(fleetStatus.controlPlane.uptime)}
                      </Typography>
                    </Box>

                    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                      <Chip
                        label={`Control plane ${fleetStatus.controlPlane.status}`}
                        color="success"
                        size="small"
                      />
                      <Chip
                        label={`Tenant registry ${fleetStatus.dependencies.tenantRegistry.status}`}
                        color={getDependencyChipColor(
                          fleetStatus.dependencies.tenantRegistry.status,
                        )}
                        size="small"
                      />
                      <Chip
                        label={`Provisioning ${fleetStatus.dependencies.tenantProvisioning.status}`}
                        color={getDependencyChipColor(
                          fleetStatus.dependencies.tenantProvisioning.status,
                        )}
                        size="small"
                      />
                    </Stack>

                    <Divider />

                    <Stack spacing={1.5}>
                      <Typography variant="h5">Tenant fleet</Typography>
                      <Typography color="text.secondary">
                        Current and desired lifecycle state comes straight from the
                        existing <code>/internal/fleet/status</code> contract, including
                        the latest transition actor and reason.
                      </Typography>
                    </Stack>

                    {fleetStatus.tenants.length === 0 ? (
                      <Typography color="text.secondary">
                        No tenant instances have been provisioned yet.
                      </Typography>
                    ) : (
                      <Stack spacing={2}>
                        {fleetStatus.tenants.map((tenantStatus) => (
                          <Card
                            key={tenantStatus.tenant.id}
                            variant="outlined"
                            sx={{ borderRadius: surfaceRadius }}
                          >
                            <CardContent sx={{ p: 2.5 }}>
                              <Stack spacing={1.75}>
                                <Stack
                                  direction={{ xs: 'column', lg: 'row' }}
                                  spacing={1.5}
                                  sx={{ justifyContent: 'space-between' }}
                                >
                                  <Box>
                                    <Typography variant="h6">
                                      {tenantStatus.tenant.slug}
                                    </Typography>
                                    <Typography color="text.secondary" variant="body2">
                                      Tenant {tenantStatus.tenant.id} · owner{' '}
                                      {tenantStatus.tenant.ownerId}
                                    </Typography>
                                    {tenantStatus.tenant.initialAdminEmail ? (
                                      <Typography color="text.secondary" variant="body2">
                                        Initial admin {tenantStatus.tenant.initialAdminEmail}
                                      </Typography>
                                    ) : null}
                                  </Box>
                                  <Stack
                                    direction="row"
                                    spacing={1}
                                    useFlexGap
                                    sx={{ flexWrap: 'wrap', justifyContent: { lg: 'flex-end' } }}
                                  >
                                    <Chip
                                      label={`Current ${formatStateLabel(
                                        tenantStatus.tenant.currentState,
                                      )}`}
                                      color={getStateChipColor(
                                        tenantStatus.tenant.currentState,
                                      )}
                                      size="small"
                                    />
                                    <Chip
                                      label={`Desired ${formatStateLabel(
                                        tenantStatus.tenant.desiredState,
                                      )}`}
                                      size="small"
                                    />
                                    <Chip
                                      label={
                                        tenantStatus.health === 'healthy'
                                          ? 'Healthy'
                                          : 'Needs attention'
                                      }
                                      color={getHealthChipColor(tenantStatus.health)}
                                      size="small"
                                    />
                                  </Stack>
                                </Stack>

                                <Stack
                                  direction="row"
                                  spacing={1}
                                  useFlexGap
                                  sx={{ flexWrap: 'wrap' }}
                                >
                                  <Chip
                                    label={`Version ${tenantStatus.tenant.version}`}
                                    size="small"
                                  />
                                  <Chip
                                    label={`Subdomain ${
                                      tenantStatus.tenant.subdomain ?? 'pending'
                                    }`}
                                    size="small"
                                  />
                                  <Chip
                                    label={`Storage ${
                                      tenantStatus.tenant.storageReference ?? 'pending'
                                    }`}
                                    size="small"
                                  />
                                  <Chip
                                    label={`Backup ${describeBackup(tenantStatus.backup)}`}
                                    color={
                                      tenantStatus.backup.rawMetadata ? 'success' : 'warning'
                                    }
                                    size="small"
                                  />
                                  {tenantStatus.backup.location ? (
                                    <Chip
                                      label={`Location ${tenantStatus.backup.location}`}
                                      size="small"
                                    />
                                  ) : null}
                                </Stack>

                                {tenantStatus.resources ? (
                                  <Box
                                    sx={{
                                      border: '1px solid rgba(167, 139, 250, 0.18)',
                                      borderRadius: surfaceRadius,
                                      p: 1.5,
                                      backdropFilter: 'blur(12px)',
                                    }}
                                  >
                                    <Typography
                                      variant="body2"
                                      color="text.secondary"
                                      sx={{ mb: 1 }}
                                    >
                                      Resource identifiers
                                    </Typography>
                                    <Stack spacing={0.5}>
                                      <CopyField
                                        label="Namespace"
                                        value={tenantStatus.resources.namespace}
                                      />
                                      <CopyField
                                        label="Hostname"
                                        value={tenantStatus.resources.hostname}
                                      />
                                      <CopyField
                                        label="Database"
                                        value={tenantStatus.resources.databaseName}
                                      />
                                    </Stack>
                                  </Box>
                                ) : null}

                                <Typography color="text.secondary" variant="body2">
                                  {describeLatestTransition(tenantStatus)}
                                </Typography>

                                {tenantStatus.latestTransition?.reason ? (
                                  <Alert
                                    severity={
                                      tenantStatus.health === 'healthy'
                                        ? 'info'
                                        : 'warning'
                                    }
                                    icon={
                                      tenantStatus.health === 'healthy' ? (
                                        <CheckCircleRoundedIcon fontSize="inherit" />
                                      ) : (
                                        <ErrorOutlineRoundedIcon fontSize="inherit" />
                                      )
                                    }
                                    sx={{ borderRadius: surfaceRadius }}
                                  >
                                    {tenantStatus.latestTransition.reason}
                                  </Alert>
                                ) : null}

                                {tenantStatus.tenant.currentState !== 'deprovisioned' ? (
                                  <Stack
                                    direction={{ xs: 'column', sm: 'row' }}
                                    spacing={1.5}
                                    sx={{
                                      justifyContent: 'space-between',
                                      alignItems: { sm: 'center' },
                                    }}
                                  >
                                    <Typography color="text.secondary" variant="body2">
                                      {tenantStatus.tenant.currentState === 'ready'
                                        ? 'Rolling updates reuse the live provision route with a version override, while deprovision removes the live tenant resources and keeps the record visible for audit/history.'
                                        : 'Deprovision removes the live tenant resources and keeps the tenant record visible for audit/history.'}
                                    </Typography>
                                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                                      {tenantStatus.tenant.currentState === 'ready' ? (
                                        <Button
                                          variant="outlined"
                                          startIcon={<RefreshRoundedIcon />}
                                          disabled={Boolean(mutationDisabledReason)}
                                          onClick={() => setUpgradeTarget(tenantStatus)}
                                        >
                                          Roll to new version
                                        </Button>
                                      ) : null}
                                      <Button
                                        variant="outlined"
                                        color="warning"
                                        startIcon={<DeleteForeverRoundedIcon />}
                                        disabled={Boolean(mutationDisabledReason)}
                                        onClick={() => setDeprovisionTarget(tenantStatus)}
                                      >
                                        Deprovision tenant
                                      </Button>
                                    </Stack>
                                  </Stack>
                                ) : null}
                              </Stack>
                            </CardContent>
                          </Card>
                        ))}
                      </Stack>
                    )}
                  </Stack>
                </CardContent>
              </Card>
            ) : null}
          </>
        )}
      </Stack>

      <TenantDeprovisionDialog
        actor={operatorActor}
        authToken={authToken ?? ''}
        onClose={() => setDeprovisionTarget(null)}
        onDeprovisioned={(message) => {
          setError(null)
          setNotice(message)
        }}
        onError={(message) => {
          setNotice(null)
          setError(message)
        }}
        onRefresh={() => (authToken ? loadFleet(authToken) : Promise.resolve())}
        open={Boolean(deprovisionTarget)}
        surfaceRadius={surfaceRadius}
        tenantStatus={deprovisionTarget}
      />
      <TenantUpgradeDialog
        actor={operatorActor}
        authToken={authToken ?? ''}
        onClose={() => setUpgradeTarget(null)}
        onError={(message) => {
          setNotice(null)
          setError(message)
        }}
        onRefresh={() => (authToken ? loadFleet(authToken) : Promise.resolve())}
        onUpgraded={(message) => {
          setError(null)
          setNotice(message)
        }}
        open={Boolean(upgradeTarget)}
        suggestedVersion={suggestedProvisionVersion}
        surfaceRadius={surfaceRadius}
        tenantStatus={upgradeTarget}
      />
    </Container>
  )
}

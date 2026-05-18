import AccountCircleRoundedIcon from '@mui/icons-material/AccountCircleRounded'
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded'
import ManageAccountsRoundedIcon from '@mui/icons-material/ManageAccountsRounded'
import { useCallback, useEffect, useMemo, useRef, useState, type SubmitEvent } from 'react'
import {
  Alert,
  AppBar,
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
  MenuItem,
  Paper,
  Stack,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import useMediaQuery from '@mui/material/useMediaQuery'
import { Footer } from '@dnd-notes/theme'
import { buildAccountConsoleUrl, buildPortalRedirectUri, portalKeycloakConfig } from './config'
import {
  createPortalTenant,
  fetchPortalCatalog,
  fetchPortalDashboard,
} from './control-plane-api'
import {
  clearStoredKeycloakTokens,
  createCustomerKeycloakClient,
  type CustomerKeycloakClient,
  type CustomerKeycloakConfig,
} from './keycloak-client'
import type {
  PortalCatalogResponse,
  PortalCreateTenantRequest,
  PortalDashboardResponse,
  PortalTenantSummary,
} from './types'

const defaultCreateTenantDraft = {
  tenantName: '',
  tenantSlug: '',
  planTier: '',
  paymentProvider: 'stripe' as const,
  billingEmail: '',
}

function formatTimestamp(value: string | null) {
  if (!value) {
    return 'Not available yet'
  }

  return new Date(value).toLocaleString()
}

function formatStateLabel(value: string) {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`
}

function getStateChipColor(state: PortalTenantSummary['tenant']['currentState']) {
  switch (state) {
    case 'ready':
      return 'success'
    case 'maintenance':
    case 'upgrading':
    case 'restoring':
      return 'warning'
    case 'failed':
    case 'deprovisioned':
      return 'error'
    default:
      return 'info'
  }
}

function normalizeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/--+/g, '-')
    .slice(0, 63)
}

function buildTenantLinkLabel(summary: PortalTenantSummary) {
  if (summary.appUrl) {
    return 'Open tenant app'
  }

  return 'App URL available after provisioning'
}

interface AppProps {
  keycloakClientFactory?: (config: CustomerKeycloakConfig) => CustomerKeycloakClient
  /** Injected for tests; defaults to window.location.assign. */
  navigate?: (url: string) => void
}

export default function App({
  keycloakClientFactory = createCustomerKeycloakClient,
  navigate = (url) => { window.location.assign(url) },
}: AppProps = {}) {
  const theme = useTheme()
  const isXs = useMediaQuery(theme.breakpoints.down('sm'))
  const keycloakClientRef = useRef<CustomerKeycloakClient | null>(null)
  /** Tracks tenant IDs that were already in `ready` state when first observed. */
  const seenReadyTenantIdsRef = useRef<Set<string>>(new Set())
  /** Stable ref to the navigate function so the polling effect doesn't re-subscribe on prop changes. */
  const navigateRef = useRef(navigate)
  useEffect(() => {
    navigateRef.current = navigate
  }, [navigate])

  // Keycloak-mode state
  const [isKeycloakReady, setIsKeycloakReady] = useState(false)
  const [keycloakToken, setKeycloakToken] = useState<string | null>(null)

  // Dashboard + catalog state (shared between both auth modes)
  const [catalog, setCatalog] = useState<PortalCatalogResponse | null>(null)
  const [dashboard, setDashboard] = useState<PortalDashboardResponse | null>(null)
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(true)
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(false)
  const [isSubmittingCreateTenant, setIsSubmittingCreateTenant] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [createTenantDraft, setCreateTenantDraft] = useState(defaultCreateTenantDraft)
  const [hasEditedCreateTenantSlug, setHasEditedCreateTenantSlug] = useState(false)

  // --- Catalog fetch (runs on mount regardless of auth mode) ---
  useEffect(() => {
    const abortController = new AbortController()

    fetchPortalCatalog(abortController.signal)
      .then((response) => {
        setCatalog(response)
        setCreateTenantDraft((currentDraft) => ({
          ...currentDraft,
          planTier: currentDraft.planTier || response.plans[0]?.id || '',
        }))
      })
      .catch((requestError: unknown) => {
        if (!abortController.signal.aborted) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : 'Failed to load the customer portal catalog.',
          )
        }
      })
      .finally(() => {
        if (!abortController.signal.aborted) {
          setIsLoadingCatalog(false)
        }
      })

    return () => {
      abortController.abort()
    }
  }, [])

  // --- Keycloak bootstrap (gated on catalog load) ---
  useEffect(() => {
    if (isLoadingCatalog || !catalog) {
      return
    }

    let cancelled = false
    const keycloakClient = keycloakClientFactory(portalKeycloakConfig)
    keycloakClientRef.current = keycloakClient

    const bootstrap = async () => {
      try {
        const tokens = await keycloakClient.init()

        if (cancelled) {
          return
        }

        if (tokens) {
          setKeycloakToken(tokens.accessToken)
        }
      } catch (bootstrapError) {
        if (!cancelled) {
          console.error(bootstrapError)
          setError('Could not initialize your session. Reload and try again.')
        }
      } finally {
        if (!cancelled) {
          setIsKeycloakReady(true)
        }
      }
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [catalog, isLoadingCatalog, keycloakClientFactory])

  // --- Keycloak dashboard hydration ---
  useEffect(() => {
    if (!keycloakToken || !isKeycloakReady) {
      return
    }

    if (dashboard) {
      return
    }

    let cancelled = false

    const hydrate = async () => {
      if (!cancelled) {
        setIsLoadingDashboard(true)
      }

      try {
        const freshToken = await keycloakClientRef.current!.freshToken()
        const response = await fetchPortalDashboard(freshToken)

        if (!cancelled) {
          setDashboard(response)
        }
      } catch (hydrationError) {
        if (!cancelled) {
          clearStoredKeycloakTokens()
          setKeycloakToken(null)
          setDashboard(null)
          setError(
            hydrationError instanceof Error
              ? hydrationError.message
              : 'Failed to load the customer portal dashboard.',
          )
        }
      } finally {
        if (!cancelled) {
          setIsLoadingDashboard(false)
        }
      }
    }

    void hydrate()

    return () => {
      cancelled = true
    }
  }, [dashboard, isKeycloakReady, keycloakToken])

  // --- Tenant polling (runs while any tenant is in a transient state) ---
  const transientStates = new Set(['provisioning', 'upgrading', 'restoring', 'maintenance'])
  const transientTenantIds =
    dashboard?.tenants
      .filter((s) => transientStates.has(s.tenant.currentState))
      .map((s) => s.tenant.id)
      .join(',') ?? ''

  useEffect(() => {
    if (!dashboard || transientTenantIds.length === 0) {
      return
    }

    // Seed the seen-ready set from the current snapshot so we only act on
    // state *transitions* that happen during this session — not on every load.
    for (const tenantSummary of dashboard.tenants) {
      if (tenantSummary.tenant.currentState === 'ready') {
        seenReadyTenantIdsRef.current.add(tenantSummary.tenant.id)
      }
    }

    let cancelled = false
    let inFlight = false

    const poll = async () => {
      if (cancelled || inFlight) {
        return
      }
      inFlight = true

      try {
        const client = keycloakClientRef.current
        const currentToken = client ? await client.freshToken().catch(() => null) : null

        if (!currentToken || cancelled) {
          return
        }

        const freshDashboard = await fetchPortalDashboard(currentToken)

        if (cancelled) {
          return
        }

        setDashboard(freshDashboard)

        // Detect newly-ready tenants (transitioned to ready during this session).
        const newlyReady = freshDashboard.tenants.filter(
          (s) =>
            s.tenant.currentState === 'ready' &&
            !seenReadyTenantIdsRef.current.has(s.tenant.id),
        )

        for (const s of newlyReady) {
          seenReadyTenantIdsRef.current.add(s.tenant.id)
        }

        // Auto-navigate when a single-tenant account's first tenant becomes ready.
        if (
          newlyReady.length === 1 &&
          freshDashboard.tenants.length === 1 &&
          newlyReady[0]!.appUrl
        ) {
          cancelled = true
          navigateRef.current(newlyReady[0]!.appUrl)
        }
      } catch {
        // Polling failure — skip the tick rather than tearing down the session.
      } finally {
        inFlight = false
      }
    }

    const intervalId = setInterval(() => { void poll() }, 4000)

    return () => {
      cancelled = true
      clearInterval(intervalId)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transientTenantIds])

  const activeCatalog = dashboard?.catalog ?? catalog
  const planOptions = activeCatalog?.plans ?? []
  const tenantCount = dashboard?.tenants.length ?? 0
  const instanceHeadline = useMemo(() => {
    if (tenantCount === 0) {
      return 'No instances yet'
    }

    if (tenantCount === 1) {
      return '1 active customer instance'
    }

    return `${tenantCount} customer instances`
  }, [tenantCount])

  // --- Keycloak login/logout ---
  const handleKeycloakLogin = useCallback(async () => {
    if (!keycloakClientRef.current) {
      setError('Sign-in is not ready yet. Reload and try again.')
      return
    }

    try {
      await keycloakClientRef.current.login(buildPortalRedirectUri())
    } catch (loginError) {
      console.error(loginError)
      setError('Could not start the sign-in flow. Reload and try again.')
    }
  }, [])

  const handleKeycloakLogout = useCallback(async () => {
    const redirectUri = buildPortalRedirectUri()

    setKeycloakToken(null)
    setDashboard(null)
    setError(null)
    setNotice(null)

    if (!keycloakClientRef.current) {
      return
    }

    try {
      await keycloakClientRef.current.logout(redirectUri)
    } catch (logoutError) {
      setError(
        logoutError instanceof Error
          ? logoutError.message
          : 'Could not sign out of the portal cleanly.',
      )
    }
  }, [])

  const handleLogout = () => void handleKeycloakLogout()

  const isAuthenticated = Boolean(keycloakToken)

  const handleCreateTenant = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()

    const currentToken = await keycloakClientRef.current?.freshToken().catch(() => null)

    if (!currentToken) {
      setError('Sign in before requesting another tenant.')
      return
    }

    setIsSubmittingCreateTenant(true)
    setError(null)
    setNotice(null)

    const request: PortalCreateTenantRequest = {
      tenantName: createTenantDraft.tenantName,
      tenantSlug: normalizeSlug(createTenantDraft.tenantSlug),
      planTier: createTenantDraft.planTier,
      paymentProvider: createTenantDraft.paymentProvider,
      billingEmail: createTenantDraft.billingEmail || undefined,
    }

    try {
      const response = await createPortalTenant(currentToken, request)
      setDashboard(response)
      setNotice('Tenant request submitted. The dashboard now reflects the latest instance list.')
      setCreateTenantDraft((currentDraft) => ({
        ...defaultCreateTenantDraft,
        planTier: currentDraft.planTier,
        paymentProvider: currentDraft.paymentProvider,
        billingEmail: response.account.billingEmail ?? currentDraft.billingEmail,
      }))
      setHasEditedCreateTenantSlug(false)
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Failed to create the tenant request.',
      )
    } finally {
      setIsSubmittingCreateTenant(false)
    }
  }

  // Keycloak entry card — shown when mode=keycloak and not authenticated
  const renderKeycloakEntry = () => {
    if (!isKeycloakReady) {
      return (
        <Card>
          <CardContent sx={{ p: 4 }}>
            <Stack spacing={2} sx={{ alignItems: 'center', textAlign: 'center' }}>
              <CircularProgress />
              <Typography variant="h6">Checking session…</Typography>
            </Stack>
          </CardContent>
        </Card>
      )
    }

    return (
      <Card>
        <CardContent sx={{ p: 4 }}>
          <Stack spacing={2.5} sx={{ alignItems: 'center', textAlign: 'center' }}>
            <AccountCircleRoundedIcon color="primary" sx={{ fontSize: 44 }} />
            <Box>
              <Typography variant="h5">Sign in to the customer portal</Typography>
              <Typography color="text.secondary" sx={{ mt: 1 }}>
                Use your portal account to manage tenant instances. New users are
                registered automatically on first sign-in.
              </Typography>
            </Box>
            <Button
              variant="contained"
              size="large"
              onClick={() => void handleKeycloakLogin()}
              sx={{ alignSelf: 'flex-start' }}
            >
              Sign in
            </Button>
          </Stack>
        </CardContent>
      </Card>
    )
  }

  return (
    <Box sx={{ minHeight: '100vh' }}>
      <AppBar position="static" color="transparent" elevation={0}>
        <Toolbar sx={{ justifyContent: 'space-between', gap: 1, minHeight: { xs: 56, sm: 64 } }}>
          <Typography
            variant="h6"
            sx={{ fontWeight: 700, letterSpacing: '0.08em', flexShrink: 0 }}
          >
            D&amp;D NOTES
          </Typography>
          <Stack
            direction="row"
            spacing={0.5}
            sx={{ alignItems: 'center', minWidth: 0, flexShrink: 0 }}
          >
            {!isXs ? (
              <Chip
                label={
                  activeCatalog?.provisioningConfigured
                    ? 'Self-serve provisioning enabled'
                    : 'Provisioning placeholder mode'
                }
                color={activeCatalog?.provisioningConfigured ? 'success' : 'warning'}
                variant="outlined"
                size="small"
              />
            ) : null}
            {isAuthenticated ? (
              isXs ? (
                <Tooltip title="Account settings">
                  <IconButton
                    color="inherit"
                    component="a"
                    href={buildAccountConsoleUrl(portalKeycloakConfig)}
                    aria-label="Account settings"
                    size="small"
                  >
                    <ManageAccountsRoundedIcon />
                  </IconButton>
                </Tooltip>
              ) : (
                <Button
                  color="inherit"
                  startIcon={<ManageAccountsRoundedIcon />}
                  component="a"
                  href={buildAccountConsoleUrl(portalKeycloakConfig)}
                >
                  Account settings
                </Button>
              )
            ) : null}
            {isAuthenticated ? (
              isXs ? (
                <Tooltip title="Sign out">
                  <IconButton
                    color="inherit"
                    onClick={handleLogout}
                    aria-label="Sign out"
                    size="small"
                  >
                    <LogoutRoundedIcon />
                  </IconButton>
                </Tooltip>
              ) : (
                <Button
                  color="inherit"
                  startIcon={<LogoutRoundedIcon />}
                  onClick={handleLogout}
                >
                  Sign out
                </Button>
              )
            ) : null}
          </Stack>
        </Toolbar>
      </AppBar>

      <Container maxWidth="xl" sx={{ py: 6 }}>
        <Stack spacing={2.5}>
          <Paper sx={{ p: { xs: 3, md: 5 }, backdropFilter: 'blur(16px)' }}>
            <Stack spacing={2}>
              <Typography
                variant="h2"
                sx={{ fontSize: { xs: '2.4rem', md: '3.5rem' }, fontWeight: 800 }}
              >
                Your D&amp;D Notes workspaces
              </Typography>
              <Typography variant="h6" color="text.secondary" sx={{ maxWidth: 780 }}>
                {!isAuthenticated
                  ? 'Sign in to manage your tenants, or create your first one.'
                  : 'Manage your tenant instances from this customer portal.'}
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <Chip label={instanceHeadline} color="secondary" />
                {activeCatalog ? (
                  <Chip
                    label={`Default tenant version ${activeCatalog.defaultTenantVersion}`}
                    variant="outlined"
                  />
                ) : null}
                {dashboard ? (
                  <Chip
                    label={`Signed in as ${dashboard.account.email}`}
                    variant="outlined"
                  />
                ) : null}
              </Stack>
            </Stack>
          </Paper>

          {error ? <Alert severity="error">{error}</Alert> : null}
          {notice ? <Alert severity="success">{notice}</Alert> : null}
          {activeCatalog && !activeCatalog.provisioningConfigured ? (
            <Alert severity="warning">
              Live tenant provisioning is disabled in this environment. The portal still
              records customer intent and tenant requests, but app URLs will appear only
              after the control-plane provisioning lane is configured.
            </Alert>
          ) : null}

              {!isAuthenticated ? (
                renderKeycloakEntry()
              ) : (
                <Box
                  sx={{
                    display: 'grid',
                    gap: 3,
                    gridTemplateColumns: { xs: '1fr', md: '1.4fr 1fr' },
                  }}
                >
                  <Paper sx={{ p: 3 }}>
                    <Stack spacing={2}>
                      <Typography variant="h4">Customer dashboard</Typography>
                      <Typography color="text.secondary">
                        Track lifecycle state, backups, and app access for the tenants
                        tied to your portal account.
                      </Typography>

                      {isLoadingDashboard ? (
                        <Stack spacing={2} sx={{ alignItems: 'center', py: 4 }}>
                          <CircularProgress size={28} />
                          <Typography color="text.secondary">Loading dashboard…</Typography>
                        </Stack>
                      ) : dashboard ? (
                        <Stack spacing={2}>
                          <Paper variant="outlined" sx={{ p: 2 }}>
                            <Stack spacing={1}>
                              <Typography variant="h6">
                                {dashboard.account.displayName}
                              </Typography>
                              <Typography color="text.secondary">
                                {dashboard.account.email}
                              </Typography>
                              <Typography variant="body2" color="text.secondary">
                                Billing provider:{' '}
                                {dashboard.account.billingProvider ??
                                  'Captured as a placeholder'}
                              </Typography>
                            </Stack>
                          </Paper>

                          <Stack spacing={2}>
                            {dashboard.tenants.length === 0 ? (
                              <Alert severity="info">
                                No tenant requests yet. Use the form on the right to
                                create one.
                              </Alert>
                            ) : null}
                            {dashboard.tenants.map((tenantSummary) => (
                              <Paper
                                key={tenantSummary.tenant.id}
                                variant="outlined"
                                sx={{ p: 2.5 }}
                              >
                                <Stack spacing={2}>
                                  <Stack
                                    direction={{ xs: 'column', sm: 'row' }}
                                    spacing={1}
                                    sx={{ justifyContent: 'space-between' }}
                                  >
                                    <Box>
                                      <Typography variant="h6">
                                        {tenantSummary.tenant.displayName ??
                                          tenantSummary.tenant.slug}
                                      </Typography>
                                      <Typography color="text.secondary">
                                        {tenantSummary.tenant.slug}
                                      </Typography>
                                    </Box>
                                    <Stack
                                      direction="row"
                                      spacing={1}
                                      sx={{ flexWrap: 'wrap' }}
                                    >
                                      <Chip
                                        label={formatStateLabel(
                                          tenantSummary.tenant.currentState,
                                        )}
                                        color={getStateChipColor(
                                          tenantSummary.tenant.currentState,
                                        )}
                                        size="small"
                                      />
                                      <Chip
                                        label={
                                          tenantSummary.tenant.planTier ?? 'plan pending'
                                        }
                                        size="small"
                                        variant="outlined"
                                      />
                                    </Stack>
                                  </Stack>

                                  <Typography variant="body2" color="text.secondary">
                                    Version {tenantSummary.tenant.version} · Last backup{' '}
                                    {formatTimestamp(tenantSummary.backup.lastBackupAt)}
                                  </Typography>

                                  <Stack
                                    direction={{ xs: 'column', sm: 'row' }}
                                    spacing={1.5}
                                  >
                                    <Button
                                      component={tenantSummary.appUrl ? Link : 'button'}
                                      href={tenantSummary.appUrl ?? undefined}
                                      target={tenantSummary.appUrl ? '_blank' : undefined}
                                      rel={
                                        tenantSummary.appUrl ? 'noreferrer' : undefined
                                      }
                                      variant="contained"
                                      disabled={!tenantSummary.appUrl}
                                    >
                                      {buildTenantLinkLabel(tenantSummary)}
                                    </Button>
                                    <Button variant="outlined" disabled>
                                      Settings placeholder (
                                      {tenantSummary.settingsPath})
                                    </Button>
                                  </Stack>

                                  <Divider />

                                  <Typography variant="body2">
                                    Latest transition:{' '}
                                    {tenantSummary.latestTransition
                                      ? `${formatStateLabel(tenantSummary.latestTransition.fromState)} → ${formatStateLabel(tenantSummary.latestTransition.toState)}`
                                      : 'No transition recorded yet'}
                                  </Typography>
                                  {tenantSummary.tenant.currentState === 'failed' ? (
                                    <Alert severity="error">
                                      Provisioning failed for this workspace. You can retry
                                      by creating a new tenant request, or contact support
                                      if the issue persists.
                                    </Alert>
                                  ) : null}
                                  {transientStates.has(tenantSummary.tenant.currentState) ? (
                                    <Alert severity="info">
                                      Provisioning is in progress. The dashboard updates
                                      automatically — no need to refresh.
                                    </Alert>
                                  ) : null}
                                  <Typography variant="body2" color="text.secondary">
                                    Custom domain, archive/reactivate, subscription
                                    management, team invites, and usage analytics stay
                                    intentionally placeholder for this issue.
                                  </Typography>
                                </Stack>
                              </Paper>
                            ))}
                          </Stack>
                        </Stack>
                      ) : null}
                    </Stack>
                  </Paper>

                  <Paper sx={{ p: 3 }}>
                    <Stack spacing={2}>
                      <Typography variant="h4">
                        {dashboard === null
                          ? null
                          : dashboard.tenants.length === 0
                          ? 'Create your first workspace'
                          : 'Add another tenant'}
                      </Typography>
                      <Typography color="text.secondary">
                        {dashboard === null
                          ? null
                          : dashboard.tenants.length === 0
                          ? 'Your account is ready. Claim a tenant slug to spin up your dedicated note space.'
                          : 'Request another tenant under the same owner account. The control plane keeps the portal scoped to your owned instances only.'}
                      </Typography>

                      <form onSubmit={(e) => void handleCreateTenant(e)}>
                        <Stack spacing={2}>
                          <TextField
                            id="create-tenant-name"
                            label="Tenant name"
                            slotProps={{ htmlInput: { 'aria-label': 'Tenant name' } }}
                            value={createTenantDraft.tenantName}
                            onChange={(event) =>
                              setCreateTenantDraft((currentDraft) => ({
                                ...currentDraft,
                                tenantName: event.target.value,
                                tenantSlug: hasEditedCreateTenantSlug
                                  ? currentDraft.tenantSlug
                                  : normalizeSlug(event.target.value),
                              }))
                            }
                            fullWidth
                            required
                          />
                          <TextField
                            id="create-tenant-slug"
                            label="Tenant slug"
                            slotProps={{ htmlInput: { 'aria-label': 'Tenant slug' } }}
                            value={createTenantDraft.tenantSlug}
                            onChange={(event) => {
                              setHasEditedCreateTenantSlug(true)
                              setCreateTenantDraft((currentDraft) => ({
                                ...currentDraft,
                                tenantSlug: normalizeSlug(event.target.value),
                              }))
                            }}
                            fullWidth
                            required
                          />
                          <TextField
                            id="create-plan-tier"
                            select
                            label="Plan"
                            value={createTenantDraft.planTier}
                            onChange={(event) =>
                              setCreateTenantDraft((currentDraft) => ({
                                ...currentDraft,
                                planTier: event.target.value,
                              }))
                            }
                            fullWidth
                          >
                            {planOptions.map((plan) => (
                              <MenuItem key={plan.id} value={plan.id}>
                                {plan.name}
                              </MenuItem>
                            ))}
                          </TextField>
                          <TextField
                            id="create-payment-provider"
                            select
                            label="Payment provider"
                            value={createTenantDraft.paymentProvider}
                            onChange={(event) =>
                              setCreateTenantDraft((currentDraft) => ({
                                ...currentDraft,
                                paymentProvider: event.target.value as typeof currentDraft.paymentProvider,
                              }))
                            }
                            fullWidth
                          >
                            <MenuItem value="stripe">Stripe (coming soon)</MenuItem>
                            <MenuItem value="square">Square (coming soon)</MenuItem>
                            <MenuItem value="manual-review">
                              Manual review (coming soon)
                            </MenuItem>
                          </TextField>
                          <TextField
                            id="create-billing-email"
                            label="Billing email (optional)"
                            type="email"
                            slotProps={{
                              htmlInput: { 'aria-label': 'Billing email (optional)' },
                            }}
                            value={createTenantDraft.billingEmail}
                            onChange={(event) =>
                              setCreateTenantDraft((currentDraft) => ({
                                ...currentDraft,
                                billingEmail: event.target.value,
                              }))
                            }
                            fullWidth
                          />
                          <Button
                            type="submit"
                            variant="contained"
                            disabled={isSubmittingCreateTenant}
                            sx={{ alignSelf: 'flex-start' }}
                          >
                            {isSubmittingCreateTenant
                              ? 'Submitting tenant request…'
                              : 'Create tenant request'}
                          </Button>
                        </Stack>
                      </form>

                      <Divider />

                      <Stack spacing={1.5}>
                        <Typography variant="h6">Future roadmap placeholders</Typography>
                        <Typography variant="body2" color="text.secondary">
                          Billing/subscription management:{' '}
                          {activeCatalog?.placeholders.billingStatus ?? 'placeholder'}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Team member invites:{' '}
                          {activeCatalog?.placeholders.teamInvites ?? 'coming-soon'}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Usage analytics:{' '}
                          {activeCatalog?.placeholders.usageAnalytics ?? 'coming-soon'}
                        </Typography>
                      </Stack>
                    </Stack>
                  </Paper>
                </Box>
              )}

          <Box
            sx={{
              display: 'grid',
              gap: 3,
              gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
            }}
          >
            {(planOptions.length > 0 ? planOptions : []).map((plan) => (
              <Card key={plan.id} variant="outlined">
                <CardContent>
                  <Stack spacing={1.5}>
                    <Stack
                      direction="row"
                      sx={{ justifyContent: 'space-between', alignItems: 'center' }}
                    >
                      <Typography variant="h5">{plan.name}</Typography>
                      <Chip label={plan.priceLabel} size="small" color="primary" />
                    </Stack>
                    <Typography color="text.secondary">{plan.description}</Typography>
                    <Stack spacing={1}>
                      {plan.features.map((feature) => (
                        <Typography key={feature} variant="body2">
                          - {feature}
                        </Typography>
                      ))}
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Box>

          <Paper sx={{ p: 3 }}>
            <Stack spacing={1.5}>
              <Typography variant="h4">Portal contract</Typography>
              <Typography color="text.secondary">
                This portal stays a frontend to the control-plane API rather than a fork
                of the operator dashboard. Customer traffic goes through{' '}
                <code>/portal</code>, while internal fleet controls stay under{' '}
                <code>/internal</code>.
              </Typography>
            </Stack>
          </Paper>

          {isLoadingCatalog || isLoadingDashboard ? (
            <Alert severity="info">Loading portal data…</Alert>
          ) : null}
        </Stack>
      </Container>
      <Footer
        variant="rich"
        tagline="Calm, mobile-friendly note-taking for tabletop campaigns."
      />
    </Box>
  )
}

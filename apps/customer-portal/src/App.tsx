import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  AppBar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  Divider,
  Link,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Toolbar,
  Typography,
} from '@mui/material'
import {
  createPortalTenant,
  fetchPortalCatalog,
  fetchPortalDashboard,
  loginPortalAccount,
  logoutPortal,
  signupPortalAccount,
} from './control-plane-api'
import type {
  PortalCatalogResponse,
  PortalCreateTenantRequest,
  PortalDashboardResponse,
  PortalTenantSummary,
} from './types'

const sessionTokenStorageKey = 'dnd-notes:customer-portal:session-token'

const defaultSignupDraft = {
  email: '',
  displayName: '',
  password: '',
  billingEmail: '',
  paymentProvider: 'stripe' as const,
  tenantName: '',
  tenantSlug: '',
  planTier: '',
}

const defaultCreateTenantDraft = {
  tenantName: '',
  tenantSlug: '',
  planTier: '',
  paymentProvider: 'stripe' as const,
  billingEmail: '',
}

function readStoredSessionToken() {
  const storedValue = window.localStorage.getItem(sessionTokenStorageKey)
  return storedValue && storedValue.trim().length > 0 ? storedValue : null
}

function persistSessionToken(token: string) {
  window.localStorage.setItem(sessionTokenStorageKey, token)
}

function clearSessionToken() {
  window.localStorage.removeItem(sessionTokenStorageKey)
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

export default function App() {
  const [catalog, setCatalog] = useState<PortalCatalogResponse | null>(null)
  const [dashboard, setDashboard] = useState<PortalDashboardResponse | null>(null)
  const [sessionToken, setSessionToken] = useState<string | null>(() =>
    readStoredSessionToken(),
  )
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(true)
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(false)
  const [isSubmittingSignup, setIsSubmittingSignup] = useState(false)
  const [isSubmittingCreateTenant, setIsSubmittingCreateTenant] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [signupDraft, setSignupDraft] = useState(defaultSignupDraft)
  const [createTenantDraft, setCreateTenantDraft] = useState(defaultCreateTenantDraft)
  const [hasEditedSignupSlug, setHasEditedSignupSlug] = useState(false)
  const [hasEditedCreateTenantSlug, setHasEditedCreateTenantSlug] = useState(false)

  useEffect(() => {
    const abortController = new AbortController()
    setIsLoadingCatalog(true)

    fetchPortalCatalog(abortController.signal)
      .then((response) => {
        setCatalog(response)
        setSignupDraft((currentDraft) => ({
          ...currentDraft,
          planTier: currentDraft.planTier || response.plans[0]?.id || '',
        }))
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

  useEffect(() => {
    if (!sessionToken) {
      setDashboard(null)
      setIsLoadingDashboard(false)
      return
    }

    const abortController = new AbortController()
    setIsLoadingDashboard(true)

    fetchPortalDashboard(sessionToken, abortController.signal)
      .then((response) => {
        setDashboard(response)
      })
      .catch((requestError: unknown) => {
        if (abortController.signal.aborted) {
          return
        }

        clearSessionToken()
        setSessionToken(null)
        setDashboard(null)
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'Failed to restore the customer portal session.',
        )
      })
      .finally(() => {
        if (!abortController.signal.aborted) {
          setIsLoadingDashboard(false)
        }
      })

    return () => {
      abortController.abort()
    }
  }, [sessionToken])

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

  const handleSuccessfulSession = (response: {
    token: string
    dashboard: PortalDashboardResponse
  }) => {
    persistSessionToken(response.token)
    setSessionToken(response.token)
    setDashboard(response.dashboard)
    setCreateTenantDraft((currentDraft) => ({
      ...currentDraft,
      billingEmail: response.dashboard.account.billingEmail ?? '',
    }))
  }

  const handleSignup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    setIsSubmittingSignup(true)
    setError(null)
    setNotice(null)

    try {
      const response = await signupPortalAccount({
        email: signupDraft.email,
        displayName: signupDraft.displayName,
        password: signupDraft.password,
        billingEmail: signupDraft.billingEmail || undefined,
        paymentProvider: signupDraft.paymentProvider,
        tenantName: signupDraft.tenantName,
        tenantSlug: normalizeSlug(signupDraft.tenantSlug),
        planTier: signupDraft.planTier,
        acceptTerms: true,
      })

      handleSuccessfulSession(response)
      setNotice('Portal account ready. Your first instance request is now tracked below.')
      setSignupDraft(defaultSignupDraft)
      setHasEditedSignupSlug(false)
      setLoginEmail(response.dashboard.account.email)
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Failed to complete portal signup.',
      )
    } finally {
      setIsSubmittingSignup(false)
    }
  }

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    setError(null)
    setNotice(null)

    try {
      const response = await loginPortalAccount({
        email: loginEmail,
        password: loginPassword,
      })
      handleSuccessfulSession(response)
      setNotice('Welcome back. Your customer dashboard is restored.')
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Failed to restore the portal session.',
      )
    }
  }

  const handleLogout = async () => {
    if (!sessionToken) {
      return
    }

    setError(null)
    setNotice(null)

    try {
      await logoutPortal(sessionToken)
    } catch {
      // Best-effort server cleanup; the local session still needs to clear.
    }

    clearSessionToken()
    setSessionToken(null)
    setDashboard(null)
    setNotice('Signed out of the customer portal.')
  }

  const handleCreateTenant = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!sessionToken) {
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
      const response = await createPortalTenant(sessionToken, request)
      setDashboard(response)
      setNotice('Tenant request submitted. The dashboard now reflects the latest instance list.')
      setCreateTenantDraft((currentDraft) => ({
        ...defaultCreateTenantDraft,
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

  return (
    <Box sx={{ minHeight: '100vh', background: 'linear-gradient(180deg, #020617 0%, #111827 100%)' }}>
      <AppBar position="static" color="transparent" elevation={0}>
        <Toolbar sx={{ justifyContent: 'space-between', gap: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            dnd-notes customer portal
          </Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Chip
              label={
                activeCatalog?.provisioningConfigured
                  ? 'Self-serve provisioning enabled'
                  : 'Provisioning placeholder mode'
              }
              color={activeCatalog?.provisioningConfigured ? 'success' : 'warning'}
              variant="outlined"
            />
            {dashboard ? (
              <Button color="inherit" onClick={handleLogout}>
                Sign out
              </Button>
            ) : null}
          </Stack>
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ py: 6 }}>
        <Stack spacing={4}>
          <Paper sx={{ p: { xs: 3, md: 5 }, backdropFilter: 'blur(24px)' }}>
            <Stack spacing={2}>
              <Typography variant="overline" color="primary.main">
                Public landing + self-serve signup
              </Typography>
              <Typography variant="h2" sx={{ fontSize: { xs: '2.4rem', md: '3.5rem' }, fontWeight: 800 }}>
                Spin up a dedicated D&amp;D note space without waiting on manual ops.
              </Typography>
              <Typography variant="h6" color="text.secondary" sx={{ maxWidth: 780 }}>
                Discover the product, claim a tenant slug, capture billing intent, and
                manage your owned instances from a single customer-facing portal.
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
                  <Chip label={`Signed in as ${dashboard.account.email}`} variant="outlined" />
                ) : null}
              </Stack>
            </Stack>
          </Paper>

          {error ? <Alert severity="error">{error}</Alert> : null}
          {notice ? <Alert severity="success">{notice}</Alert> : null}
          {activeCatalog?.authMode === 'keycloak' ? (
            <Alert severity="info">
              The portal contract is already shaped for future Keycloak auth, but this
              thin slice only implements local email-based customer sessions.
            </Alert>
          ) : null}
          {activeCatalog && !activeCatalog.provisioningConfigured ? (
            <Alert severity="warning">
              Live tenant provisioning is disabled in this environment. The portal still
              records customer intent and tenant requests, but app URLs will appear only
              after the control-plane provisioning lane is configured.
            </Alert>
          ) : null}

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
                          • {feature}
                        </Typography>
                      ))}
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Box>

          <Box
            sx={{
              display: 'grid',
              gap: 3,
              gridTemplateColumns: { xs: '1fr', md: dashboard ? '1.4fr 1fr' : '1fr 1fr' },
            }}
          >
            <Paper sx={{ p: 3 }}>
              <Stack spacing={2}>
                <Typography variant="h4">
                  {dashboard ? 'Customer dashboard' : 'Create your first instance'}
                </Typography>
                <Typography color="text.secondary">
                  {dashboard
                    ? 'Track lifecycle state, backups, and app access for the tenants tied to your portal account.'
                    : 'The first signup flow claims your portal account and immediately requests a dedicated tenant.'}
                </Typography>
                {dashboard ? (
                  <Stack spacing={2}>
                    <Paper variant="outlined" sx={{ p: 2 }}>
                      <Stack spacing={1}>
                        <Typography variant="h6">{dashboard.account.displayName}</Typography>
                        <Typography color="text.secondary">{dashboard.account.email}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          Billing provider:{' '}
                          {dashboard.account.billingProvider ?? 'Captured as a placeholder'}
                        </Typography>
                      </Stack>
                    </Paper>

                    <Stack spacing={2}>
                      {dashboard.tenants.length === 0 ? (
                        <Alert severity="info">
                          No tenant requests yet. Use the form on the right to create one.
                        </Alert>
                      ) : null}
                      {dashboard.tenants.map((tenantSummary) => (
                        <Paper key={tenantSummary.tenant.id} variant="outlined" sx={{ p: 2.5 }}>
                          <Stack spacing={2}>
                            <Stack
                              direction={{ xs: 'column', sm: 'row' }}
                              spacing={1}
                              sx={{ justifyContent: 'space-between' }}
                            >
                              <Box>
                                <Typography variant="h6">
                                  {tenantSummary.tenant.displayName ?? tenantSummary.tenant.slug}
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
                                  label={formatStateLabel(tenantSummary.tenant.currentState)}
                                  color={getStateChipColor(tenantSummary.tenant.currentState)}
                                  size="small"
                                />
                                <Chip
                                  label={tenantSummary.tenant.planTier ?? 'plan pending'}
                                  size="small"
                                  variant="outlined"
                                />
                              </Stack>
                            </Stack>

                            <Typography variant="body2" color="text.secondary">
                              Version {tenantSummary.tenant.version} • Last backup{' '}
                              {formatTimestamp(tenantSummary.backup.lastBackupAt)}
                            </Typography>

                            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                              <Button
                                component={tenantSummary.appUrl ? Link : 'button'}
                                href={tenantSummary.appUrl ?? undefined}
                                target={tenantSummary.appUrl ? '_blank' : undefined}
                                rel={tenantSummary.appUrl ? 'noreferrer' : undefined}
                                variant="contained"
                                disabled={!tenantSummary.appUrl}
                              >
                                {buildTenantLinkLabel(tenantSummary)}
                              </Button>
                              <Button variant="outlined" disabled>
                                Settings placeholder ({tenantSummary.settingsPath})
                              </Button>
                            </Stack>

                            <Divider />

                            <Typography variant="body2">
                              Latest transition:{' '}
                              {tenantSummary.latestTransition
                                ? `${formatStateLabel(tenantSummary.latestTransition.fromState)} → ${formatStateLabel(tenantSummary.latestTransition.toState)}`
                                : 'No transition recorded yet'}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              Custom domain, archive/reactivate, subscription management, team
                              invites, and usage analytics stay intentionally placeholder for
                              this issue.
                            </Typography>
                          </Stack>
                        </Paper>
                      ))}
                    </Stack>
                  </Stack>
                ) : (
                  <form onSubmit={handleSignup}>
                    <Stack spacing={2}>
                      <TextField
                        id="signup-work-email"
                        label="Work email"
                        type="email"
                        slotProps={{ htmlInput: { 'aria-label': 'Work email' } }}
                        value={signupDraft.email}
                        onChange={(event) =>
                          setSignupDraft((currentDraft) => ({
                            ...currentDraft,
                            email: event.target.value,
                          }))
                        }
                        required
                      />
                      <TextField
                        id="signup-display-name"
                        label="Display name"
                        slotProps={{ htmlInput: { 'aria-label': 'Display name' } }}
                        value={signupDraft.displayName}
                        onChange={(event) =>
                          setSignupDraft((currentDraft) => ({
                            ...currentDraft,
                            displayName: event.target.value,
                          }))
                        }
                        required
                      />
                      <TextField
                        id="signup-password"
                        label="Password"
                        type="password"
                        slotProps={{ htmlInput: { 'aria-label': 'Password' } }}
                        value={signupDraft.password}
                        onChange={(event) =>
                          setSignupDraft((currentDraft) => ({
                            ...currentDraft,
                            password: event.target.value,
                          }))
                        }
                        helperText="At least 10 characters for the local portal auth slice."
                        required
                      />
                      <TextField
                        id="signup-billing-email"
                        label="Billing email (optional)"
                        type="email"
                        slotProps={{
                          htmlInput: { 'aria-label': 'Billing email (optional)' },
                        }}
                        value={signupDraft.billingEmail}
                        onChange={(event) =>
                          setSignupDraft((currentDraft) => ({
                            ...currentDraft,
                            billingEmail: event.target.value,
                          }))
                        }
                      />
                      <TextField
                        id="signup-tenant-name"
                        label="Tenant name"
                        slotProps={{ htmlInput: { 'aria-label': 'Tenant name' } }}
                        value={signupDraft.tenantName}
                        onChange={(event) =>
                          setSignupDraft((currentDraft) => ({
                            ...currentDraft,
                            tenantName: event.target.value,
                            tenantSlug: hasEditedSignupSlug
                              ? currentDraft.tenantSlug
                              : normalizeSlug(event.target.value),
                          }))
                        }
                        required
                      />
                      <TextField
                        id="signup-tenant-slug"
                        label="Tenant slug"
                        slotProps={{ htmlInput: { 'aria-label': 'Tenant slug' } }}
                        value={signupDraft.tenantSlug}
                        helperText={
                          activeCatalog
                            ? `Lowercase letters, numbers, and hyphens only. Example: ${activeCatalog.slugPolicy.example}`
                            : 'Lowercase letters, numbers, and hyphens only.'
                        }
                        onChange={(event) =>
                          {
                            setHasEditedSignupSlug(true)
                            setSignupDraft((currentDraft) => ({
                              ...currentDraft,
                              tenantSlug: normalizeSlug(event.target.value),
                            }))
                          }
                        }
                        required
                      />
                      <TextField
                        id="signup-plan-tier"
                        select
                        label="Plan"
                        value={signupDraft.planTier}
                        onChange={(event) =>
                          setSignupDraft((currentDraft) => ({
                            ...currentDraft,
                            planTier: event.target.value,
                          }))
                        }
                      >
                        {planOptions.map((plan) => (
                          <MenuItem key={plan.id} value={plan.id}>
                            {plan.name}
                          </MenuItem>
                        ))}
                      </TextField>
                      <TextField
                        id="signup-payment-provider"
                        select
                        label="Payment provider placeholder"
                        value={signupDraft.paymentProvider}
                        onChange={(event) =>
                          setSignupDraft((currentDraft) => ({
                            ...currentDraft,
                            paymentProvider: event.target.value as typeof currentDraft.paymentProvider,
                          }))
                        }
                      >
                        <MenuItem value="stripe">Stripe placeholder</MenuItem>
                        <MenuItem value="square">Square placeholder</MenuItem>
                        <MenuItem value="manual-review">Manual review placeholder</MenuItem>
                      </TextField>
                      <Button
                        type="submit"
                        variant="contained"
                        size="large"
                        disabled={isSubmittingSignup || isLoadingCatalog}
                      >
                        {isSubmittingSignup ? 'Creating portal account…' : 'Create portal account'}
                      </Button>
                    </Stack>
                  </form>
                )}
              </Stack>
            </Paper>

            <Paper sx={{ p: 3 }}>
              <Stack spacing={2}>
                <Typography variant="h4">
                  {dashboard ? 'Add another tenant' : 'Already have a portal account?'}
                </Typography>
                <Typography color="text.secondary">
                  {dashboard
                    ? 'Request another tenant under the same owner account. The control plane keeps the portal scoped to your owned instances only.'
                    : 'Sign back in with the same email to restore your customer dashboard without creating a duplicate account.'}
                </Typography>

                {dashboard ? (
                  <form onSubmit={handleCreateTenant}>
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
                        required
                      />
                      <TextField
                        id="create-tenant-slug"
                        label="Tenant slug"
                        slotProps={{ htmlInput: { 'aria-label': 'Tenant slug' } }}
                        value={createTenantDraft.tenantSlug}
                        onChange={(event) =>
                          {
                            setHasEditedCreateTenantSlug(true)
                            setCreateTenantDraft((currentDraft) => ({
                              ...currentDraft,
                              tenantSlug: normalizeSlug(event.target.value),
                            }))
                          }
                        }
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
                        label="Payment provider placeholder"
                        value={createTenantDraft.paymentProvider}
                        onChange={(event) =>
                          setCreateTenantDraft((currentDraft) => ({
                            ...currentDraft,
                            paymentProvider: event.target.value as typeof currentDraft.paymentProvider,
                          }))
                        }
                      >
                        <MenuItem value="stripe">Stripe placeholder</MenuItem>
                        <MenuItem value="square">Square placeholder</MenuItem>
                        <MenuItem value="manual-review">Manual review placeholder</MenuItem>
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
                      />
                      <Button
                        type="submit"
                        variant="contained"
                        disabled={isSubmittingCreateTenant}
                      >
                        {isSubmittingCreateTenant
                          ? 'Submitting tenant request…'
                          : 'Create tenant request'}
                      </Button>
                    </Stack>
                  </form>
                ) : (
                  <form onSubmit={handleLogin}>
                    <Stack spacing={2}>
                      <TextField
                        id="login-email"
                        label="Portal email"
                        type="email"
                        slotProps={{ htmlInput: { 'aria-label': 'Portal email' } }}
                        value={loginEmail}
                        onChange={(event) => setLoginEmail(event.target.value)}
                        required
                      />
                      <TextField
                        id="login-password"
                        label="Password"
                        type="password"
                        slotProps={{ htmlInput: { 'aria-label': 'Password' } }}
                        value={loginPassword}
                        onChange={(event) => setLoginPassword(event.target.value)}
                        required
                      />
                      <Button type="submit" variant="outlined">
                        Restore dashboard
                      </Button>
                    </Stack>
                  </form>
                )}

                <Divider />

                <Stack spacing={1.5}>
                  <Typography variant="h6">Future roadmap placeholders</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Billing/subscription management: {activeCatalog?.placeholders.billingStatus ?? 'placeholder'}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Team member invites: {activeCatalog?.placeholders.teamInvites ?? 'coming-soon'}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Usage analytics: {activeCatalog?.placeholders.usageAnalytics ?? 'coming-soon'}
                  </Typography>
                </Stack>
              </Stack>
            </Paper>
          </Box>

          <Paper sx={{ p: 3 }}>
            <Stack spacing={1.5}>
              <Typography variant="h4">Portal ↔ control-plane contract</Typography>
              <Typography color="text.secondary">
                This portal stays a frontend to the control-plane API rather than a fork of
                the operator dashboard. Customer traffic goes through `/portal`, while
                internal fleet controls stay under `/internal`.
              </Typography>
            </Stack>
          </Paper>

          {isLoadingCatalog || isLoadingDashboard ? (
            <Alert severity="info">Loading portal data…</Alert>
          ) : null}
        </Stack>
      </Container>
    </Box>
  )
}

import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import DeleteForeverRoundedIcon from '@mui/icons-material/DeleteForeverRounded'
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import * as React from 'react'
import { useDeprovision } from '../hooks/useDeprovision'
import { useUpgrade } from '../hooks/useUpgrade'
import ProvisionTenantPanel from '../components/ProvisionTenantPanel'
import TenantDeprovisionDialog from '../components/TenantDeprovisionDialog'
import TenantUpgradeDialog from '../components/TenantUpgradeDialog'
import type {
  FleetDependencyHealth,
  FleetStatusResponse,
  FleetTenantBackupStatus,
  FleetTenantStatus,
  TenantState,
} from '../types'
import type { SummaryCard } from './fleetSummaryCards'

const { useCallback, useState } = React

// ── Utility formatters ────────────────────────────────────────────────────────

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

// ── CopyField ─────────────────────────────────────────────────────────────────

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

// ── FleetStatusPage ───────────────────────────────────────────────────────────

export interface FleetStatusPageProps {
  actor: string
  authToken: string
  fleetStatus: FleetStatusResponse
  mutationDisabledReason: string | null
  suggestedProvisionVersion: string
  summaryCards: SummaryCard[]
  surfaceRadius: string
  onError: (message: string) => void
  onNotice: (message: string) => void
  onRefresh: () => Promise<void>
}

export default function FleetStatusPage({
  actor,
  authToken,
  fleetStatus,
  mutationDisabledReason,
  suggestedProvisionVersion,
  summaryCards,
  surfaceRadius,
  onError,
  onNotice,
  onRefresh,
}: FleetStatusPageProps) {
  const { deprovisionTarget, openDeprovision, closeDeprovision } = useDeprovision()
  const { upgradeTarget, openUpgrade, closeUpgrade } = useUpgrade()

  return (
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
        actor={actor}
        authToken={authToken}
        disabledReason={mutationDisabledReason}
        onError={onError}
        onProvisioned={onNotice}
        onRefresh={onRefresh}
        suggestedVersion={suggestedProvisionVersion}
        surfaceRadius={surfaceRadius}
      />

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
                                  onClick={() => openUpgrade(tenantStatus)}
                                >
                                  Roll to new version
                                </Button>
                              ) : null}
                              <Button
                                variant="outlined"
                                color="warning"
                                startIcon={<DeleteForeverRoundedIcon />}
                                disabled={Boolean(mutationDisabledReason)}
                                onClick={() => openDeprovision(tenantStatus)}
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

      <TenantDeprovisionDialog
        actor={actor}
        authToken={authToken}
        onClose={closeDeprovision}
        onDeprovisioned={onNotice}
        onError={onError}
        onRefresh={onRefresh}
        open={Boolean(deprovisionTarget)}
        surfaceRadius={surfaceRadius}
        tenantStatus={deprovisionTarget}
      />
      <TenantUpgradeDialog
        actor={actor}
        authToken={authToken}
        onClose={closeUpgrade}
        onError={onError}
        onRefresh={onRefresh}
        onUpgraded={onNotice}
        open={Boolean(upgradeTarget)}
        suggestedVersion={suggestedProvisionVersion}
        surfaceRadius={surfaceRadius}
        tenantStatus={upgradeTarget}
      />
    </>
  )
}


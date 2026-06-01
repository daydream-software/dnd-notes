import {
  Box,
  Card,
  CardContent,
  Chip,
  Divider,
  Stack,
  Typography,
} from '@mui/material'
import { useDeprovision } from '../hooks/useDeprovision'
import { useUpgrade } from '../hooks/useUpgrade'
import ProvisionTenantPanel from '../components/ProvisionTenantPanel'
import TenantDeprovisionDialog from '../components/TenantDeprovisionDialog'
import TenantTable from '../components/TenantTable'
import TenantUpgradeDialog from '../components/TenantUpgradeDialog'
import type {
  FleetDependencyHealth,
  FleetStatusResponse,
} from '../types'
import type { SummaryCard } from './fleetSummaryCards'

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

function getDependencyChipColor(status: FleetDependencyHealth['status']) {
  return status === 'healthy' ? 'success' : 'default'
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
                color={fleetStatus.controlPlane.status === 'healthy' ? 'success' : 'warning'}
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

            <TenantTable
              tenants={fleetStatus.tenants}
              mutationDisabled={Boolean(mutationDisabledReason)}
              onUpgrade={openUpgrade}
              onDeprovision={openDeprovision}
            />
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


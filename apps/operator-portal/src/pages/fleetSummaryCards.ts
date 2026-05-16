import ApartmentRoundedIcon from '@mui/icons-material/ApartmentRounded'
import BackupRoundedIcon from '@mui/icons-material/BackupRounded'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import SecurityRoundedIcon from '@mui/icons-material/SecurityRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import * as React from 'react'
import type { FleetStatusResponse } from '../types'

export interface SummaryCard {
  label: string
  value: string
  helper: string
  icon: React.ReactNode
}

export function buildSummaryCards(fleetStatus: FleetStatusResponse): SummaryCard[] {
  // Coalesce optional counters so a partial fleet response never renders
  // `undefined ready · undefined failed`.
  const totalTenants = fleetStatus.summary.totalTenants ?? 0
  const readyCount = fleetStatus.summary.tenantsByCurrentState?.ready ?? 0
  const failedCount = fleetStatus.summary.tenantsByCurrentState?.failed ?? 0
  const needsAttentionCount = fleetStatus.summary.tenantsNeedingAttention ?? 0
  const trackedBackupCount = fleetStatus.summary.tenantsWithBackupMetadata ?? 0
  const missingBackupCount = fleetStatus.summary.tenantsMissingBackupMetadata ?? 0

  return [
    {
      label: 'Fleet tenants',
      value: String(totalTenants),
      helper: `${readyCount} ready · ${failedCount} failed`,
      icon: React.createElement(ApartmentRoundedIcon, { color: 'primary' }),
    },
    {
      label: 'Needs attention',
      value: String(needsAttentionCount),
      helper: `${missingBackupCount} missing backup metadata`,
      icon:
        needsAttentionCount > 0
          ? React.createElement(WarningAmberRoundedIcon, { color: 'warning' })
          : React.createElement(CheckCircleRoundedIcon, { color: 'success' }),
    },
    {
      label: 'Backups tracked',
      value: `${trackedBackupCount}/${totalTenants}`,
      helper: `${missingBackupCount} missing`,
      icon: React.createElement(BackupRoundedIcon, { color: 'secondary' }),
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
      icon: React.createElement(SecurityRoundedIcon, { color: 'info' }),
    },
  ]
}

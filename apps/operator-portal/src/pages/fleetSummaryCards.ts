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
  return [
    {
      label: 'Fleet tenants',
      value: String(fleetStatus.summary.totalTenants),
      helper: `${fleetStatus.summary.tenantsByCurrentState.ready} ready · ${fleetStatus.summary.tenantsByCurrentState.failed} failed`,
      icon: React.createElement(ApartmentRoundedIcon, { color: 'primary' }),
    },
    {
      label: 'Needs attention',
      value: String(fleetStatus.summary.tenantsNeedingAttention),
      helper: `${fleetStatus.summary.tenantsMissingBackupMetadata} missing backup metadata`,
      icon:
        fleetStatus.summary.tenantsNeedingAttention > 0
          ? React.createElement(WarningAmberRoundedIcon, { color: 'warning' })
          : React.createElement(CheckCircleRoundedIcon, { color: 'success' }),
    },
    {
      label: 'Backups tracked',
      value: `${fleetStatus.summary.tenantsWithBackupMetadata}/${fleetStatus.summary.totalTenants}`,
      helper: `${fleetStatus.summary.tenantsMissingBackupMetadata} missing`,
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

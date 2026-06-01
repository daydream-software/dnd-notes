import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import { Box, Chip, Stack, Typography } from '@mui/material'
import * as React from 'react'
import type { FleetTenantStatus } from '../types'
import { isStuckSleeping } from './tenant-anomalies'

const { useMemo } = React

interface AnomalyItem {
  id: string
  slug: string
  label: string
}

function deriveAnomalies(tenants: FleetTenantStatus[]): AnomalyItem[] {
  const out: AnomalyItem[] = []
  for (const status of tenants) {
    if (isStuckSleeping(status)) {
      out.push({
        id: status.tenant.id,
        slug: status.tenant.slug,
        label: 'Stuck sleeping',
      })
    }
  }
  return out
}

export interface AnomalyBannerProps {
  tenants: FleetTenantStatus[]
}

export default function AnomalyBanner({ tenants }: AnomalyBannerProps) {
  const anomalies = useMemo(() => deriveAnomalies(tenants), [tenants])

  if (anomalies.length === 0) return null

  const count = anomalies.length

  return (
    <Box
      role="alert"
      sx={{
        borderRadius: 18,
        background: 'rgba(245,158,11,0.08)',
        border: '1px solid rgba(245,158,11,0.28)',
        padding: '14px 18px',
        display: 'flex',
        gap: '14px',
        alignItems: 'flex-start',
      }}
    >
      <WarningAmberRoundedIcon
        aria-hidden
        sx={{ fontSize: 22, color: 'var(--warn)', mt: '1px', flexShrink: 0 }}
      />
      <Stack spacing={1} sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg-1)' }}>
          {count} {count === 1 ? 'anomaly' : 'anomalies'} detected
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {anomalies.map((item) => (
            <Chip
              key={`${item.id}-stuck-sleeping`}
              size="small"
              icon={
                <WarningAmberRoundedIcon
                  sx={{ fontSize: '13px !important', color: 'var(--warn) !important' }}
                />
              }
              label={
                <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                  <Box
                    component="span"
                    sx={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
                  >
                    {item.slug}
                  </Box>
                  <Box component="span" sx={{ opacity: 0.8, fontSize: 11.5 }}>
                    {item.label}
                  </Box>
                </Box>
              }
              sx={{
                background: 'rgba(245,158,11,0.12)',
                border: '1px solid rgba(245,158,11,0.30)',
                color: 'var(--warn)',
                '.MuiChip-label': { px: 1 },
              }}
            />
          ))}
        </Box>
      </Stack>
    </Box>
  )
}

import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import DeleteForeverRoundedIcon from '@mui/icons-material/DeleteForeverRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded'
import ArrowDownwardRoundedIcon from '@mui/icons-material/ArrowDownwardRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import {
  Box,
  Chip,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import * as React from 'react'
import type { FleetTenantStatus, TenantState } from '../types'
import { isStuckSleeping } from './tenant-anomalies'

const { useState, useMemo } = React

// ── Type helpers ──────────────────────────────────────────────────────────────

type SortKey = 'slug' | 'state' | 'version' | 'lastTransition' | 'uptime'
type SortDir = 'asc' | 'desc'

type FilterState = 'all' | TenantState

const STATE_FILTER_OPTIONS: FilterState[] = [
  'all',
  'ready',
  'sleeping',
  'provisioning',
  'upgrading',
  'restoring',
  'maintenance',
  'failed',
  'deprovisioned',
]

// ── Utility formatters ────────────────────────────────────────────────────────

function formatStateLabel(state: string): string {
  return state.charAt(0).toUpperCase() + state.slice(1)
}

function getStateChipColor(state: TenantState) {
  switch (state) {
    case 'ready':
      return 'success' as const
    case 'failed':
      return 'error' as const
    case 'maintenance':
    case 'restoring':
    case 'upgrading':
    case 'provisioning':
      return 'warning' as const
    case 'deprovisioned':
      return 'default' as const
  }
}

function formatTimestamp(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—'
}

/**
 * Returns a human-readable relative time string (e.g. "3h ago", "6d ago").
 * Uses Intl.RelativeTimeFormat for correctness, picking the largest unit >= 1.
 */
function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return '—'

  const diffMs = Date.now() - new Date(isoString).getTime()
  const diffSecs = Math.floor(diffMs / 1000)

  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'always' })

  if (diffSecs < 60) return rtf.format(-diffSecs, 'second')
  const diffMins = Math.floor(diffSecs / 60)
  if (diffMins < 60) return rtf.format(-diffMins, 'minute')
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return rtf.format(-diffHours, 'hour')
  const diffDays = Math.floor(diffHours / 24)
  return rtf.format(-diffDays, 'day')
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface HealthDotProps {
  healthy: boolean
}

function HealthDot({ healthy }: HealthDotProps) {
  return (
    <Box
      component="span"
      title={healthy ? 'Healthy' : 'Needs attention'}
      sx={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        flexShrink: 0,
        background: healthy ? 'var(--success)' : 'var(--warn)',
      }}
    />
  )
}

interface SortHeaderProps {
  label: string
  sortKey: SortKey
  activeSortKey: SortKey
  sortDir: SortDir
  onSort: (key: SortKey) => void
  align?: 'left' | 'right'
}

function SortHeader({ label, sortKey, activeSortKey, sortDir, onSort, align = 'left' }: SortHeaderProps) {
  const isActive = sortKey === activeSortKey

  return (
    <th
      style={{
        padding: '10px 14px',
        fontSize: 11.5,
        fontWeight: 600,
        color: isActive ? 'var(--accent)' : 'var(--fg-muted)',
        background: 'var(--bg-paper-soft)',
        borderBottom: '1px solid var(--brand-line-soft)',
        position: 'sticky',
        top: 0,
        whiteSpace: 'nowrap',
        textAlign: align,
      }}
      aria-sort={isActive ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'inherit',
          font: 'inherit',
          fontSize: 'inherit',
          fontWeight: 'inherit',
          padding: 0,
          margin: 0,
          cursor: 'pointer',
          userSelect: 'none',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          flexDirection: align === 'right' ? 'row-reverse' : 'row',
        }}
      >
        {label}
        {isActive ? (
          sortDir === 'asc' ? (
            <ArrowUpwardRoundedIcon sx={{ fontSize: 12 }} />
          ) : (
            <ArrowDownwardRoundedIcon sx={{ fontSize: 12 }} />
          )
        ) : null}
      </button>
    </th>
  )
}

// ── TenantTableRow ────────────────────────────────────────────────────────────

interface TenantTableRowProps {
  status: FleetTenantStatus
  mutationDisabled: boolean
  onUpgrade: (status: FleetTenantStatus) => void
  onDeprovision: (status: FleetTenantStatus) => void
}

function TenantTableRow({ status, mutationDisabled, onUpgrade, onDeprovision }: TenantTableRowProps) {
  const [hover, setHover] = useState(false)
  const t = status.tenant
  const isDeprovisioned = t.currentState === 'deprovisioned'
  const canRoll = t.currentState === 'ready'
  const stateChanged = t.desiredState !== t.currentState
  const stuckSleeping = isStuckSleeping(status)

  const TD: React.CSSProperties = {
    padding: '12px 14px',
    verticalAlign: 'middle',
    borderBottom: '1px solid var(--brand-line-faint)',
    color: 'var(--fg-1)',
    fontSize: 13.5,
  }

  return (
    <tr
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: hover ? 'var(--action-hover)' : 'transparent',
        transition: 'background 150ms',
      }}
    >
      {/* Tenant */}
      <td style={{ ...TD, minWidth: 200 }}>
        <Box sx={{ display: 'flex', alignItems: stuckSleeping ? 'flex-start' : 'center', gap: 1 }}>
          <Box sx={{ pt: stuckSleeping ? '3px' : 0, flexShrink: 0 }}>
            <HealthDot healthy={status.health === 'healthy'} />
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, minWidth: 0 }}>
            <Typography
              component="span"
              sx={{ fontSize: 14, fontWeight: 600, color: 'var(--fg-1)', lineHeight: 1.3 }}
            >
              {t.slug}
            </Typography>
            <Typography
              component="span"
              sx={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11.5,
                color: 'var(--fg-muted)',
                lineHeight: 1.3,
              }}
            >
              {t.id}
            </Typography>
            {stuckSleeping ? (
              <Box
                component="span"
                title="Current state sleeping and not seen by activator. Idle-scaler may have desynced."
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  mt: 0.75,
                  px: '8px',
                  py: '2px',
                  borderRadius: '999px',
                  fontSize: 11,
                  fontWeight: 600,
                  background: 'rgba(245,158,11,0.14)',
                  color: 'var(--warn)',
                  border: '1px solid rgba(245,158,11,0.32)',
                  width: 'fit-content',
                }}
              >
                <WarningAmberRoundedIcon sx={{ fontSize: 12 }} aria-hidden />
                Stuck sleeping
              </Box>
            ) : null}
          </Box>
        </Box>
      </td>

      {/* State */}
      <td style={TD}>
        <Chip
          label={formatStateLabel(t.currentState)}
          color={getStateChipColor(t.currentState)}
          size="small"
        />
        {stateChanged ? (
          <Typography
            component="div"
            sx={{ fontSize: 11, color: 'var(--fg-muted)', mt: 0.5 }}
          >
            desired {formatStateLabel(t.desiredState)}
          </Typography>
        ) : null}
      </td>

      {/* Version */}
      <td
        style={{
          ...TD,
          fontFamily: 'var(--font-mono)',
          fontSize: 12.5,
          color: 'var(--fg-1)',
        }}
      >
        {t.version}
      </td>

      {/* Last transition */}
      <td style={{ ...TD, minWidth: 220 }}>
        {status.latestTransition ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
              <Chip
                label={formatStateLabel(status.latestTransition.fromState)}
                size="small"
                variant="outlined"
              />
              <ArrowForwardRoundedIcon
                fontSize="inherit"
                sx={{ color: 'var(--fg-muted)' }}
                aria-hidden
              />
              <Chip
                label={formatStateLabel(status.latestTransition.toState)}
                color={getStateChipColor(status.latestTransition.toState)}
                size="small"
              />
            </Box>
            <Typography
              component="div"
              sx={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11.5,
                color: 'var(--fg-muted)',
              }}
            >
              {formatTimestamp(status.latestTransition.createdAt)}
            </Typography>
          </Box>
        ) : (
          <Typography
            component="span"
            sx={{ fontSize: 12.5, color: 'var(--fg-muted)', fontStyle: 'italic' }}
          >
            None recorded
          </Typography>
        )}
      </td>

      {/* Uptime */}
      <td style={{ ...TD, textAlign: 'right', minWidth: 120 }}>
        {status.uptime ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.25 }}>
            <Typography
              component="span"
              sx={{
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--fg-1)',
                lineHeight: 1.3,
              }}
            >
              {status.uptime.uptimePct.toFixed(1)}%
            </Typography>
            <Typography
              component="span"
              sx={{ fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.3 }}
            >
              last wake {formatRelativeTime(status.uptime.lastWakeAt)}
            </Typography>
          </Box>
        ) : (
          <Typography
            component="span"
            sx={{ fontSize: 13, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}
          >
            —
          </Typography>
        )}
      </td>

      {/* Actions */}
      <td style={{ ...TD, textAlign: 'right', whiteSpace: 'nowrap' }}>
        {!isDeprovisioned && !mutationDisabled ? (
          <Box sx={{ display: 'inline-flex', gap: 0.75 }}>
            {canRoll ? (
              <Tooltip title="Roll to new version">
                <IconButton
                  size="small"
                  aria-label={`Roll ${t.slug} to new version`}
                  onClick={() => onUpgrade(status)}
                >
                  <RefreshRoundedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}
            <Tooltip title="Deprovision tenant">
              <IconButton
                size="small"
                color="warning"
                aria-label={`Deprovision ${t.slug}`}
                onClick={() => onDeprovision(status)}
              >
                <DeleteForeverRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        ) : (
          <Typography
            component="span"
            sx={{ fontSize: 11.5, color: 'var(--fg-muted)' }}
          >
            —
          </Typography>
        )}
      </td>
    </tr>
  )
}

// ── TenantTable ───────────────────────────────────────────────────────────────

export interface TenantTableProps {
  tenants: FleetTenantStatus[]
  mutationDisabled: boolean
  onUpgrade: (status: FleetTenantStatus) => void
  onDeprovision: (status: FleetTenantStatus) => void
}

export default function TenantTable({
  tenants,
  mutationDisabled,
  onUpgrade,
  onDeprovision,
}: TenantTableProps) {
  const [stateFilter, setStateFilter] = useState<FilterState>('all')
  const [anomaliesOnly, setAnomaliesOnly] = useState(false)
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState<SortKey>('slug')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const filtered = useMemo(() => {
    return tenants.filter((s) => {
      if (stateFilter !== 'all' && s.tenant.currentState !== stateFilter) return false
      if (anomaliesOnly && !isStuckSleeping(s)) return false
      if (!query) return true
      const q = query.toLowerCase()
      return (
        s.tenant.slug.toLowerCase().includes(q) ||
        s.tenant.id.toLowerCase().includes(q) ||
        s.tenant.ownerId.toLowerCase().includes(q)
      )
    })
  }, [tenants, stateFilter, anomaliesOnly, query])

  const sorted = useMemo(() => {
    const list = [...filtered]
    const dir = sortDir === 'asc' ? 1 : -1
    list.sort((a, b) => {
      if (sortBy === 'uptime') {
        // Tenants without uptime data always sort to the bottom regardless of direction.
        const aHas = a.uptime !== undefined
        const bHas = b.uptime !== undefined
        if (!aHas && !bHas) return 0
        if (!aHas) return 1  // a has no data → after b
        if (!bHas) return -1 // b has no data → after a
        return (a.uptime!.uptimePct - b.uptime!.uptimePct) * dir
      }

      let va: string
      let vb: string
      if (sortBy === 'slug') {
        va = a.tenant.slug
        vb = b.tenant.slug
      } else if (sortBy === 'state') {
        va = a.tenant.currentState
        vb = b.tenant.currentState
      } else if (sortBy === 'version') {
        const vaV = a.tenant.version
        const vbV = b.tenant.version
        return vaV.localeCompare(vbV, undefined, { numeric: true, sensitivity: 'base' }) * dir
      } else {
        // lastTransition — sort by createdAt timestamp, nulls last
        va = a.latestTransition?.createdAt ?? ''
        vb = b.latestTransition?.createdAt ?? ''
      }
      if (va < vb) return -1 * dir
      if (va > vb) return 1 * dir
      return 0
    })
    return list
  }, [filtered, sortBy, sortDir])

  const toggleSort = (key: SortKey) => {
    if (key === sortBy) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(key)
      setSortDir('asc')
    }
  }

  const isFiltered = sorted.length !== tenants.length
  const captionCount = isFiltered
    ? `${sorted.length} of ${tenants.length} tenants`
    : tenants.length === 1
      ? '1 tenant'
      : `${tenants.length} tenants`

  const TD_HEADERS: React.CSSProperties = {
    padding: '10px 14px',
    fontSize: 11.5,
    fontWeight: 600,
    background: 'var(--bg-paper-soft)',
    borderBottom: '1px solid var(--brand-line-soft)',
    position: 'sticky',
    top: 0,
    whiteSpace: 'nowrap',
  }

  return (
    <Stack spacing={2}>
      {/* Toolbar: state filter chips + anomalies-only chip + search */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        useFlexGap
        sx={{ flexWrap: 'wrap', alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
      >
        <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
          {STATE_FILTER_OPTIONS.map((s) => (
            <Chip
              key={s}
              label={s === 'all' ? 'All states' : formatStateLabel(s)}
              size="small"
              onClick={() => setStateFilter(s)}
              color={stateFilter === s ? 'primary' : 'default'}
              variant={stateFilter === s ? 'filled' : 'outlined'}
            />
          ))}
          <Chip
            label="Anomalies only"
            size="small"
            onClick={() => setAnomaliesOnly((v) => !v)}
            color={anomaliesOnly ? 'warning' : 'default'}
            variant={anomaliesOnly ? 'filled' : 'outlined'}
          />
        </Stack>

        <TextField
          size="small"
          placeholder="Filter by slug, id, owner"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchRoundedIcon sx={{ fontSize: 18, color: 'var(--fg-muted)' }} />
                </InputAdornment>
              ),
            },
          }}
          sx={{ minWidth: 240 }}
        />
      </Stack>

      {/* Caption count */}
      <Typography variant="body2" color="text.secondary">
        {captionCount}
      </Typography>

      {/* Table */}
      <Box
        sx={{
          overflowX: 'auto',
          borderRadius: 18,
          border: '1px solid var(--brand-line-soft)',
        }}
      >
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            background: 'var(--bg-paper-soft)',
            fontFamily: 'inherit',
          }}
        >
          <thead>
            <tr>
              <SortHeader
                label="Tenant"
                sortKey="slug"
                activeSortKey={sortBy}
                sortDir={sortDir}
                onSort={toggleSort}
              />
              <SortHeader
                label="State"
                sortKey="state"
                activeSortKey={sortBy}
                sortDir={sortDir}
                onSort={toggleSort}
              />
              <SortHeader
                label="Version"
                sortKey="version"
                activeSortKey={sortBy}
                sortDir={sortDir}
                onSort={toggleSort}
              />
              <SortHeader
                label="Last transition"
                sortKey="lastTransition"
                activeSortKey={sortBy}
                sortDir={sortDir}
                onSort={toggleSort}
              />
              <SortHeader
                label="Uptime"
                sortKey="uptime"
                activeSortKey={sortBy}
                sortDir={sortDir}
                onSort={toggleSort}
                align="right"
              />
              <th
                style={{
                  ...TD_HEADERS,
                  color: 'var(--fg-muted)',
                  textAlign: 'right',
                }}
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  style={{
                    padding: 24,
                    textAlign: 'center',
                    color: 'var(--fg-muted)',
                    fontSize: 13.5,
                  }}
                >
                  {tenants.length === 0
                    ? 'No tenant instances have been provisioned yet.'
                    : 'No tenants match this filter.'}
                </td>
              </tr>
            ) : (
              sorted.map((s) => (
                <TenantTableRow
                  key={s.tenant.id}
                  status={s}
                  mutationDisabled={mutationDisabled}
                  onUpgrade={onUpgrade}
                  onDeprovision={onDeprovision}
                />
              ))
            )}
          </tbody>
        </table>
      </Box>
    </Stack>
  )
}

import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import DeleteForeverRoundedIcon from '@mui/icons-material/DeleteForeverRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded'
import ArrowDownwardRoundedIcon from '@mui/icons-material/ArrowDownwardRounded'
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

const { useState, useMemo } = React

// ── Type helpers ──────────────────────────────────────────────────────────────

type SortKey = 'slug' | 'state' | 'version' | 'lastTransition'
type SortDir = 'asc' | 'desc'

// 'sleeping' is a valid filter target (it's a real state the activator adds)
// even though it's not yet in the base TenantState union.
type FilterState = 'all' | TenantState | 'sleeping'

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
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <HealthDot healthy={status.health === 'healthy'} />
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
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState<SortKey>('slug')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const filtered = useMemo(() => {
    return tenants.filter((s) => {
      if (stateFilter !== 'all' && s.tenant.currentState !== stateFilter) return false
      if (!query) return true
      const q = query.toLowerCase()
      return (
        s.tenant.slug.toLowerCase().includes(q) ||
        s.tenant.id.toLowerCase().includes(q) ||
        s.tenant.ownerId.toLowerCase().includes(q)
      )
    })
  }, [tenants, stateFilter, query])

  const sorted = useMemo(() => {
    const list = [...filtered]
    const dir = sortDir === 'asc' ? 1 : -1
    list.sort((a, b) => {
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
      {/* Toolbar: state filter chips + search */}
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
                  colSpan={5}
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

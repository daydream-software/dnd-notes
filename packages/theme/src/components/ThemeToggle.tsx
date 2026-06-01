import { IconButton, Tooltip } from '@mui/material'
import { useThemeMode } from '../index.js'

/** Geist-flavored inline icons — `currentColor` strokes, stroke-width 2,
 *  so they inherit the surrounding text color in either mode. */
function SunIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="22" />
      <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" />
      <line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
      <line x1="2" y1="12" x2="4" y2="12" />
      <line x1="20" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" />
      <line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
    </svg>
  )
}

function MoonIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

export interface ThemeToggleProps {
  /** Icon size in px. Default 16. */
  size?: number
}

/**
 * Small icon button that flips between dark and light mode.
 * Inherits the surrounding text color. Pair with a parent that gives it
 * its position — this component does not float or absolute-position itself.
 *
 * Renders nothing when used outside a `<ThemeRoot>` — the shared Footer
 * embeds this and is sometimes rendered in tests or partial surfaces
 * that don't bother to wire the theme context.
 */
export function ThemeToggle({ size = 16 }: ThemeToggleProps) {
  const ctx = useThemeMode()
  // Render nothing when there is no surrounding <ThemeRoot> — the Footer
  // is shared and shown inside tests and partial renders that don't always
  // bother to wire the theme context.
  if (!ctx) return null
  const { mode, toggleMode } = ctx
  const nextLabel = mode === 'light' ? 'dark' : 'light'
  return (
    <Tooltip title={`Switch to ${nextLabel} mode`} placement="top">
      <IconButton
        onClick={toggleMode}
        size="small"
        sx={{
          color: 'inherit',
          opacity: 0.78,
          '&:hover': { opacity: 1, color: 'primary.main' },
        }}
        aria-label={`Switch to ${nextLabel} mode`}
      >
        {mode === 'light' ? <SunIcon size={size} /> : <MoonIcon size={size} />}
      </IconButton>
    </Tooltip>
  )
}

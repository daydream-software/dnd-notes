import { IconButton, Tooltip } from '@mui/material'
import DarkModeRounded from '@mui/icons-material/DarkModeRounded'
import LightModeRounded from '@mui/icons-material/LightModeRounded'
import { useThemeMode } from '../index.js'

export interface ThemeToggleProps {
  /** Icon size in px. Default 18. */
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
 *
 * Icons use the MUI Rounded family (`LightModeRounded`, `DarkModeRounded`)
 * per the design-system constraint: MUI Rounded glyphs only — never
 * Outlined or Sharp, never inline SVG.
 */
export function ThemeToggle({ size = 18 }: ThemeToggleProps) {
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
        {mode === 'light'
          ? <LightModeRounded sx={{ fontSize: size }} />
          : <DarkModeRounded sx={{ fontSize: size }} />}
      </IconButton>
    </Tooltip>
  )
}

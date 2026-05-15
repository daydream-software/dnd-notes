import { createTheme } from '@mui/material/styles'
import type { Shape } from '@mui/material/styles'

// Module augmentation: extend MUI's Shape interface with design-system card tokens.
// Consumers access these via theme.shape.cardBorder / theme.shape.cardShadow.
declare module '@mui/material/styles' {
  interface Shape {
    /** 1px purple-tinted-translucent border for card surfaces. */
    cardBorder: string
    /** Slate-tinted drop shadow for card surfaces. */
    cardShadow: string
  }
}

const shapeOverride = {
  borderRadius: 18,
  cardBorder: 'rgba(167, 139, 250, 0.2)',
  cardShadow: '0 12px 30px rgba(2, 6, 23, 0.26)',
} as Shape

/**
 * Single-source design tokens used directly in `sx` props where the theme
 * runtime isn't available (e.g. plain data modules) or where the verbose
 * `(theme) => theme.shape.cardBorder` callback form is undesired.
 *
 * Keep in sync with `theme.shape.cardBorder` / `theme.palette.divider`.
 */
export const cardBorderColor = 'rgba(167, 139, 250, 0.2)' as const
/** Softer purple-translucent border for nested / outlined surfaces. */
export const cardBorderColorSubtle = 'rgba(167, 139, 250, 0.18)' as const
/** Heavier purple-translucent border for hover / selected states. */
export const cardBorderColorHover = 'rgba(167, 139, 250, 0.22)' as const

/**
 * Spread-ready glass-card surface bundle. Use when an `sx`-styled element
 * needs the full design-system card treatment without being a `<Card>`.
 *
 * @example
 * <Box sx={{ ...cardGlassSx, p: 3 }}>…</Box>
 */
export const cardGlassSx = {
  bgcolor: 'rgba(15, 23, 42, 0.9)',
  border: `1px solid ${cardBorderColor}`,
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  boxShadow: '0 12px 30px rgba(2, 6, 23, 0.26)',
} as const

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#a78bfa',
    },
    secondary: {
      main: '#f59e0b',
    },
    background: {
      default: '#0f172a',
      paper: 'rgba(15, 23, 42, 0.9)',
    },
    divider: 'rgba(167, 139, 250, 0.2)',
  },
  shape: shapeOverride,
  typography: {
    fontFamily:
      "'Geist', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: { textTransform: 'none' },
      },
    },
    MuiTypography: {
      styleOverrides: {
        overline: {
          textTransform: 'none',
          letterSpacing: 'normal',
        },
      },
    },
    // Default glass treatment for every <Card>. The variant-specific blocks
    // honor MUI's `variant="outlined"` / `variant="elevation"` so nested
    // cards (operator-portal summary tiles, customer-portal plan cards)
    // get a slightly lighter surface than top-level ones. Apps remain free
    // to override any prop via `sx`.
    MuiCard: {
      styleOverrides: {
        root: ({ ownerState }) => ({
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          ...(ownerState.variant === 'outlined'
            ? {
                backgroundColor: 'rgba(15, 23, 42, 0.72)',
                border: `1px solid ${cardBorderColorSubtle}`,
                boxShadow: 'none',
              }
            : {
                backgroundColor: 'rgba(15, 23, 42, 0.9)',
                border: `1px solid ${cardBorderColor}`,
                boxShadow: '0 16px 40px rgba(2, 6, 23, 0.26)',
              }),
        }),
      },
    },
  },
})

export { Footer } from './components/Footer.js'
export type { FooterProps } from './components/Footer.js'
export { DaydreamMark, DndNotesMark, GitHubMark } from './components/Marks.js'

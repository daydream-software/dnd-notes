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
})

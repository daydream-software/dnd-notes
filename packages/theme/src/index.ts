import { createTheme } from '@mui/material/styles'
import type { Shape, Theme } from '@mui/material/styles'
import { ThemeProvider } from '@mui/material/styles'
import * as React from 'react'

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

/**
 * Single-source design tokens used directly in `sx` props where the theme
 * runtime isn't available (e.g. plain data modules) or where the verbose
 * `(theme) => theme.shape.cardBorder` callback form is undesired.
 *
 * Values resolve to CSS custom properties defined in
 * `@dnd-notes/theme/tokens.css` and flip with `data-theme` on <html>.
 * The fallback in `var(name, fallback)` preserves dark-mode behavior when
 * the tokens CSS hasn't been imported (defensive — keeps the package
 * usable in isolation, e.g. unit tests).
 */
export const cardBorderColor = 'var(--brand-line, rgba(167, 139, 250, 0.2))' as const
/** Softer purple-translucent border for nested / outlined surfaces. */
export const cardBorderColorSubtle = 'var(--brand-line-soft, rgba(167, 139, 250, 0.18))' as const
/** Heavier purple-translucent border for hover / selected states. */
export const cardBorderColorHover = 'var(--brand-line-strong, rgba(167, 139, 250, 0.22))' as const

/**
 * Spread-ready glass-card surface bundle. Use when an `sx`-styled element
 * needs the full design-system card treatment without being a `<Card>`.
 * Mode-aware via CSS vars: bgcolor, backdrop-blur and shadow flip between
 * dark and light.
 *
 * @example
 * <Box sx={{ ...cardGlassSx, p: 3 }}>…</Box>
 */
export const cardGlassSx = {
  bgcolor: 'var(--bg-paper, rgba(15, 23, 42, 0.9))',
  border: `1px solid ${cardBorderColor}`,
  backdropFilter: 'var(--card-blur, blur(12px))',
  WebkitBackdropFilter: 'var(--card-blur, blur(12px))',
  boxShadow: 'var(--shadow-sm, 0 12px 30px rgba(2, 6, 23, 0.26))',
} as const

const shapeOverride = {
  borderRadius: 18,
  cardBorder: cardBorderColor,
  cardShadow: 'var(--shadow-md, 0 12px 30px rgba(2, 6, 23, 0.26))',
} as Shape

/** Build the MUI theme for one mode. The shape, typography and brand
 *  purples are mode-invariant; only the palette swatches and the
 *  MuiCard surface override change. */
function buildTheme(mode: 'dark' | 'light'): Theme {
  const isDark = mode === 'dark'
  return createTheme({
    palette: {
      mode,
      primary: { main: '#a78bfa' },
      secondary: { main: '#f59e0b' },
      background: isDark
        ? { default: '#0f172a', paper: 'rgba(15, 23, 42, 0.9)' }
        : { default: '#fbfaff', paper: '#ffffff' },
      divider: isDark ? 'rgba(167, 139, 250, 0.2)' : 'rgba(15, 23, 42, 0.10)',
      ...(isDark
        ? {}
        : {
            // Light-mode AA-safe semantic foregrounds (matches tokens.css).
            error: { main: '#dc2626' },
            success: { main: '#16a34a' },
            info: { main: '#2563eb' },
          }),
    },
    shape: shapeOverride,
    typography: {
      fontFamily:
        "'Geist', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    },
    components: {
      MuiButton: {
        styleOverrides: {
          // Contained-primary uses mode-aware CSS vars so the button's
          // affordance against the page stays strong in light mode
          // (brand-500 reads soft on #fbfaff). Only this role flips —
          // chips / focus rings / links continue to derive from
          // palette.primary.main = brand-500 in both modes. #408.
          root: ({ ownerState }) => ({
            textTransform: 'none',
            ...(ownerState.variant === 'contained' && ownerState.color === 'primary'
              ? {
                  backgroundColor: 'var(--button-primary-bg)',
                  color: 'var(--button-primary-fg)',
                  '&:hover': {
                    backgroundColor: 'var(--button-primary-bg-hover)',
                  },
                }
              : {}),
          }),
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
      MuiCard: {
        styleOverrides: {
          root: ({ ownerState }) => ({
            // Backdrop blur is a no-op in light mode (set to `none` via
            // tokens.css). Keeps the same JS code path for both modes.
            backdropFilter: 'var(--card-blur, blur(12px))',
            WebkitBackdropFilter: 'var(--card-blur, blur(12px))',
            ...(ownerState.variant === 'outlined'
              ? {
                  backgroundColor: 'var(--bg-paper-soft, rgba(15, 23, 42, 0.72))',
                  border: `1px solid ${cardBorderColorSubtle}`,
                  boxShadow: 'none',
                }
              : {
                  backgroundColor: 'var(--bg-paper, rgba(15, 23, 42, 0.9))',
                  border: `1px solid ${cardBorderColor}`,
                  boxShadow: 'var(--shadow-md, 0 16px 40px rgba(2, 6, 23, 0.26))',
                }),
          }),
        },
      },
    },
  })
}

export const darkTheme = buildTheme('dark')
export const lightTheme = buildTheme('light')
/**
 * Backwards-compat alias. New consumers should reach for `darkTheme` or
 * `lightTheme` explicitly, or compose with `<ThemeRoot>` to get
 * mode-driven theme switching.
 */
export const theme = darkTheme

// =========================================================================
// Theme-mode runtime: context, hook, root component
// =========================================================================

export type ThemeMode = 'dark' | 'light'

const STORAGE_KEY = 'dndnotes-theme-mode'

interface ThemeModeContextValue {
  mode: ThemeMode
  setMode: (next: ThemeMode) => void
  toggleMode: () => void
}

const ThemeModeContext = React.createContext<ThemeModeContextValue | null>(null)

/** Read the user's preferred mode from localStorage, falling back to the
 *  OS `prefers-color-scheme` query. Defaults to dark when neither signal
 *  is available (matches the historical app behavior). */
function resolveInitialMode(): ThemeMode {
  if (typeof window === 'undefined') return 'dark'
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'dark' || stored === 'light') return stored
  } catch {
    /* ignore */
  }
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  }
  return 'dark'
}

/**
 * Hook returning the current mode plus setters. Returns null when called
 * outside `<ThemeRoot>` (so optional UI like `<ThemeToggle>` can render
 * unconditionally — e.g. inside the shared Footer — without crashing the
 * test renderer or partial-render surfaces). Callers that genuinely
 * require the context should null-check the return value explicitly.
 */
export function useThemeMode(): ThemeModeContextValue | null {
  return React.useContext(ThemeModeContext)
}

interface ThemeRootProps {
  children: React.ReactNode
  /** Force a specific mode (skips localStorage / prefers-color-scheme).
   *  Useful for storybook-style isolated previews. */
  defaultMode?: ThemeMode
}

/**
 * Mounts ThemeProvider with the right MUI theme based on the current mode,
 * persists user choices to localStorage, listens to OS `prefers-color-scheme`
 * changes (only when the user hasn't picked explicitly), and reflects the
 * mode onto `<html data-theme>` so the CSS custom properties in
 * `@dnd-notes/theme/tokens.css` flip in lockstep.
 */
export function ThemeRoot({ children, defaultMode }: ThemeRootProps): React.ReactElement {
  const [mode, setModeState] = React.useState<ThemeMode>(() =>
    defaultMode ?? resolveInitialMode(),
  )

  // Reflect mode onto <html data-theme> so CSS vars and the design-system
  // tokens.css overrides flip with the React tree.
  React.useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.dataset.theme = mode
  }, [mode])

  // Cross-tab sync via the `storage` event.
  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && (e.newValue === 'dark' || e.newValue === 'light')) {
        setModeState(e.newValue)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Follow OS preference only when the user hasn't explicitly stored a
  // choice. Stored choices win over the OS query.
  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = (e: MediaQueryListEvent) => {
      try {
        if (window.localStorage.getItem(STORAGE_KEY)) return
      } catch {
        /* ignore */
      }
      setModeState(e.matches ? 'light' : 'dark')
    }
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])

  const ctx = React.useMemo<ThemeModeContextValue>(
    () => ({
      mode,
      setMode: (next) => {
        try {
          window.localStorage.setItem(STORAGE_KEY, next)
        } catch {
          /* ignore */
        }
        setModeState(next)
      },
      toggleMode: () => {
        const next: ThemeMode = mode === 'light' ? 'dark' : 'light'
        try {
          window.localStorage.setItem(STORAGE_KEY, next)
        } catch {
          /* ignore */
        }
        setModeState(next)
      },
    }),
    [mode],
  )

  const activeTheme = mode === 'light' ? lightTheme : darkTheme

  return React.createElement(
    ThemeModeContext.Provider,
    { value: ctx },
    React.createElement(ThemeProvider, { theme: activeTheme }, children),
  )
}

export { Footer } from './components/Footer.js'
export type { FooterProps } from './components/Footer.js'
export { DaydreamMark, DndNotesMark, GitHubMark } from './components/Marks.js'
export { ThemeToggle } from './components/ThemeToggle.js'
export type { ThemeToggleProps } from './components/ThemeToggle.js'

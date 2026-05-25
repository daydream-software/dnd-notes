import { Box, CircularProgress, Snackbar, Typography } from '@mui/material'
import { useWakeRetryActive } from './wake-retry-status'

/**
 * Non-blocking top banner shown while the API layer is retrying against a
 * waking (scale-to-zero) or maintenance-paused tenant. A full-screen overlay
 * would discard the user's current view during an in-session retry; this gives
 * visible "reconnecting" feedback without disruption (epic #393).
 *
 * Styled from the design system directly (the theme does not customize the
 * Alert "info" palette, so a filled Alert would render an off-brand blue):
 * Paper surface, purple-tinted translucent border, backdrop blur, slate shadow.
 */
export function WakeReconnectingBanner() {
  const active = useWakeRetryActive()

  return (
    <Snackbar open={active} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
      <Box
        role="status"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: 2,
          py: 1.25,
          // MUI sx borderRadius multiplies theme.shape.borderRadius (18), so
          // `1` == 18px — the global surface rounding, not 8px spacing.
          borderRadius: 1,
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'rgba(167, 139, 250, 0.22)',
          backdropFilter: 'blur(14px)',
          boxShadow: '0 8px 24px rgba(2, 6, 23, 0.26)',
        }}
      >
        <CircularProgress size={18} color="primary" />
        <Typography variant="body2" color="text.primary">
          Reconnecting to your workspace…
        </Typography>
      </Box>
    </Snackbar>
  )
}

import { Alert, Box, Button, Container, Stack } from '@mui/material'
import { useLoadingTimeout } from './useLoadingTimeout'
import {
  NoteBodySkeleton,
  NoteListItemSkeleton,
  WorkspaceHeaderSkeleton,
} from './WorkspaceSkeletons'

interface WorkspaceLoadingViewProps {
  /** Pass the same loading flag that drives this view. Used to start the timeout. */
  loading: boolean
  /** Called when the user clicks the retry button. Should re-trigger the fetch. */
  onRetry: () => void
  /**
   * Milliseconds before the slow-connection alert is shown below the skeleton.
   * Defaults to 8000.
   */
  timeoutMs?: number
}

export function WorkspaceLoadingView({
  loading,
  onRetry,
  timeoutMs = 8000,
}: WorkspaceLoadingViewProps) {
  const timedOut = useLoadingTimeout(loading, timeoutMs)

  return (
    <Box
      component="main"
      sx={{ minHeight: '100vh', py: { xs: 2.5, md: 4 }, width: '100%' }}
    >
      <Container maxWidth="xl" sx={{ minWidth: 0, position: 'relative' }}>
        <Stack spacing={2.5}>
          {/* Header card skeleton */}
          <Box
            sx={{
              display: 'flex',
              justifyContent: { xs: 'center', lg: 'flex-end' },
              width: '100%',
            }}
          >
            <WorkspaceHeaderSkeleton />
          </Box>

          {/* Workspace pane skeletons — browse + editor side by side */}
          <Box
            sx={{
              display: 'grid',
              gap: 2,
              gridTemplateColumns: {
                xs: '1fr',
                lg: 'minmax(0, 1.1fr) minmax(0, 1fr)',
              },
            }}
          >
            <NoteListItemSkeleton count={5} />
            <NoteBodySkeleton />
          </Box>

          {/* Slow-connection alert — shown below skeleton after timeout */}
          {timedOut ? (
            <Alert
              severity="info"
              action={
                <Button size="small" onClick={onRetry} color="inherit">
                  Retry
                </Button>
              }
            >
              Loading is taking longer than usual. Try refreshing.
            </Alert>
          ) : null}
        </Stack>
      </Container>
    </Box>
  )
}

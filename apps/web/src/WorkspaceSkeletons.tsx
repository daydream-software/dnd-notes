import { Box, Skeleton, Stack } from '@mui/material'
import { useTheme } from '@mui/material/styles'

/**
 * Shared border + background style derived from design-system tokens.
 * Consuming components spread this onto their wrapper `sx`.
 */
function useSkeletonSurfaceSx() {
  const theme = useTheme()
  return {
    border: '1px solid',
    borderColor: theme.shape.cardBorder,
    borderRadius: `${theme.shape.borderRadius}px`,
    bgcolor: theme.palette.background.paper,
    backdropFilter: 'var(--card-blur)',
    boxShadow: theme.shape.cardShadow,
    overflow: 'hidden',
  } as const
}

// ---------------------------------------------------------------------------
// WorkspaceHeaderSkeleton
// Placeholder for the sticky campaign header card.
// ---------------------------------------------------------------------------

export function WorkspaceHeaderSkeleton() {
  const surfaceSx = useSkeletonSurfaceSx()

  return (
    <Box
      sx={{
        ...surfaceSx,
        alignSelf: { xs: 'center', lg: 'flex-end' },
        width: { xs: 'min(100%, 360px)', lg: 'auto' },
        minWidth: { lg: 320 },
        px: { xs: 2, md: 2.5 },
        py: { xs: 2, md: 2.25 },
      }}
    >
      <Stack spacing={1}>
        <Skeleton variant="text" width="60%" height={28} />
        <Skeleton variant="text" width="40%" height={18} />
        <Skeleton variant="rounded" width="100%" height={36} />
      </Stack>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// NoteListItemSkeleton
// Placeholder for a single row in the notes browse list.
// ---------------------------------------------------------------------------

interface NoteListItemSkeletonProps {
  /** Number of skeleton rows to render. Defaults to 5. */
  count?: number
}

export function NoteListItemSkeleton({ count = 5 }: NoteListItemSkeletonProps) {
  const surfaceSx = useSkeletonSurfaceSx()

  return (
    <Stack spacing={1}>
      {Array.from({ length: count }, (_, i) => (
        <Box
          key={i}
          sx={{
            ...surfaceSx,
            px: { xs: 1.75, sm: 2 },
            py: { xs: 1.25, sm: 1.5 },
          }}
        >
          <Stack spacing={0.75}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Skeleton variant="text" width="55%" height={22} />
              <Skeleton variant="rounded" width={56} height={18} sx={{ ml: 'auto', borderRadius: '999px' }} />
            </Stack>
            <Skeleton variant="text" width="80%" height={16} />
          </Stack>
        </Box>
      ))}
    </Stack>
  )
}

// ---------------------------------------------------------------------------
// NoteBodySkeleton
// Placeholder for the note editor / body pane while content loads.
// ---------------------------------------------------------------------------

export function NoteBodySkeleton() {
  const surfaceSx = useSkeletonSurfaceSx()

  return (
    <Box
      sx={{
        ...surfaceSx,
        px: { xs: 2, sm: 2.5 },
        py: { xs: 2, sm: 2.5 },
      }}
    >
      <Stack spacing={1.5}>
        {/* Title line */}
        <Skeleton variant="text" width="45%" height={32} />
        {/* Body lines */}
        <Skeleton variant="text" width="100%" height={18} />
        <Skeleton variant="text" width="92%" height={18} />
        <Skeleton variant="text" width="78%" height={18} />
        <Skeleton variant="text" width="60%" height={18} />
      </Stack>
    </Box>
  )
}

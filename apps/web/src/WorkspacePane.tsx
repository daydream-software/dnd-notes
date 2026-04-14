import { Box, Button, Card, CardContent, Stack, Typography } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'

interface WorkspacePaneProps {
  workspaceTitle?: string
  workspaceDescription?: string
  showBrowsePane: boolean
  showEditorPane: boolean
  showSplitNoteWorkspace: boolean
  canSplitNoteWorkspace: boolean
  onShowBrowsePane: () => void
  onShowEditorPane: () => void
  onToggleSplitWorkspace: () => void
  workspaceEditorLabel: string
  surfaceRadius: string
  cardSx?: SxProps<Theme>
}

export default function WorkspacePane({
  workspaceTitle = 'Workspace',
  workspaceDescription = 'Switch between browsing and editing without stretching the page.',
  showBrowsePane,
  showEditorPane,
  showSplitNoteWorkspace,
  canSplitNoteWorkspace,
  onShowBrowsePane,
  onShowEditorPane,
  onToggleSplitWorkspace,
  workspaceEditorLabel,
  surfaceRadius,
  cardSx,
}: WorkspacePaneProps) {
  const resolvedCardSx: SxProps<Theme> = [
    {
      borderRadius: surfaceRadius,
      minWidth: 0,
    },
    ...(Array.isArray(cardSx) ? cardSx : cardSx ? [cardSx] : []),
  ]

  return (
    <Card sx={resolvedCardSx}>
      <CardContent sx={{ p: { xs: 2, sm: 2.5 }, minWidth: 0 }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={1.5}
          sx={{ justifyContent: 'space-between', alignItems: { md: 'center' } }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="overline" color="text.secondary">
              {workspaceTitle}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
              {workspaceDescription}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            <Button
              size="small"
              variant={!showEditorPane || showSplitNoteWorkspace ? 'contained' : 'outlined'}
              onClick={onShowBrowsePane}
            >
              Browse notes
            </Button>
            <Button
              size="small"
              variant={!showBrowsePane || showSplitNoteWorkspace ? 'contained' : 'outlined'}
              onClick={onShowEditorPane}
            >
              {workspaceEditorLabel}
            </Button>
            {canSplitNoteWorkspace ? (
              <Button
                size="small"
                variant={showSplitNoteWorkspace ? 'contained' : 'outlined'}
                onClick={onToggleSplitWorkspace}
              >
                Split view
              </Button>
            ) : null}
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  )
}
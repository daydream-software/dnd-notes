import { DndNotesMark } from './DndNotesMark'
import {
  Box,
  Container,
  Stack,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'
import WorkspacePane from './WorkspacePane'

export interface WorkspaceStatCard {
  label: string
  value: number | string
  icon?: ReactNode
}

interface CampaignWorkspaceSurfaceProps {
  header: ReactNode
  notices?: ReactNode
  bodyTop?: ReactNode
  statCards?: readonly WorkspaceStatCard[]
  showBrowsePane: boolean
  showEditorPane: boolean
  showSplitNoteWorkspace: boolean
  canSplitNoteWorkspace: boolean
  onShowBrowsePane: () => void
  onShowEditorPane: () => void
  onToggleSplitWorkspace: () => void
  workspaceEditorLabel: string
  browsePane: ReactNode
  editorPane: ReactNode
  surfaceRadius: string
  statPillRadius: string
  workspaceTitle?: string
  workspaceDescription?: string
}

const singleLineTextSx = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

function CampaignWorkspaceSurface({
  header,
  notices,
  bodyTop,
  statCards = [],
  showBrowsePane,
  showEditorPane,
  showSplitNoteWorkspace,
  canSplitNoteWorkspace,
  onShowBrowsePane,
  onShowEditorPane,
  onToggleSplitWorkspace,
  workspaceEditorLabel,
  browsePane,
  editorPane,
  surfaceRadius,
  statPillRadius,
  workspaceTitle = 'Workspace',
  workspaceDescription = 'Switch between browsing and editing without stretching the page.',
}: CampaignWorkspaceSurfaceProps) {
  return (
    <Box
      component="main"
      sx={{ minHeight: '100vh', py: { xs: 2.5, md: 4 }, width: '100%' }}
    >
      <Container maxWidth="xl" sx={{ minWidth: 0, position: 'relative' }}>
        <Stack spacing={2.5}>
          <Box
            aria-label="Application brand"
            sx={{
              display: { xs: 'none', lg: 'inline-flex' },
              alignItems: 'center',
              alignSelf: 'flex-start',
              flexShrink: 0,
              gap: 0.75,
              px: 1.25,
              py: 0.75,
              borderRadius: '999px',
              border: '1px solid',
              borderColor: 'rgba(167, 139, 250, 0.2)',
              bgcolor: 'rgba(15, 23, 42, 0.72)',
              color: 'rgba(255, 255, 255, 0.78)',
              backdropFilter: 'blur(12px)',
              boxShadow: '0 12px 30px rgba(2, 6, 23, 0.24)',
              maxWidth: '100%',
            }}
          >
            <DndNotesMark fontSize="small" />
            <Typography
              variant="caption"
              sx={{
                ...singleLineTextSx,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              D&amp;D Notes
            </Typography>
          </Box>

          {header}
          {notices}
          {bodyTop}

          {statCards.length > 0 ? (
            <Box
              component="ul"
              aria-label="Campaign stats"
              sx={{
                display: 'grid',
                gap: 3,
                listStyle: 'none',
                p: 0,
                m: 0,
                gridTemplateColumns: {
                  xs: 'repeat(2, minmax(0, 1fr))',
                  md: 'repeat(4, minmax(0, 1fr))',
                },
              }}
            >
              {statCards.map((card) => (
                <Box key={card.label} component="li">
                  <Box
                    aria-label={`${card.label}: ${card.value}`}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1.5,
                      minWidth: 0,
                      borderRadius: statPillRadius,
                      px: { xs: 1.75, sm: 2.25 },
                      py: { xs: 1.25, sm: 1.5 },
                      bgcolor: 'rgba(15, 23, 42, 0.88)',
                      border: '1px solid',
                      borderColor: 'rgba(167, 139, 250, 0.18)',
                      boxShadow: '0 20px 40px rgba(15, 23, 42, 0.24)',
                    }}
                  >
                    {card.icon ? (
                      <Box
                        sx={{
                          display: 'grid',
                          placeItems: 'center',
                          width: 40,
                          height: 40,
                          flexShrink: 0,
                          borderRadius: '50%',
                          bgcolor: 'rgba(167, 139, 250, 0.16)',
                        }}
                      >
                        {card.icon}
                      </Box>
                    ) : null}
                    <Box sx={{ minWidth: 0 }}>
                      <Typography
                        color="text.secondary"
                        variant="body2"
                        sx={{ lineHeight: 1.2 }}
                      >
                        {card.label}
                      </Typography>
                      <Typography
                        variant="h5"
                        sx={{
                          mt: 0.25,
                          fontSize: { xs: '1.35rem', sm: '1.55rem' },
                          lineHeight: 1.1,
                        }}
                      >
                        {card.value}
                      </Typography>
                    </Box>
                  </Box>
                </Box>
              ))}
            </Box>
          ) : null}

          <Box
            sx={{
              display: 'grid',
              gap: 2,
              minWidth: 0,
              gridTemplateColumns: showSplitNoteWorkspace
                ? {
                    xs: '1fr',
                    lg: 'minmax(0, 1.1fr) minmax(0, 1fr)',
                  }
                : '1fr',
            }}
          >
            <WorkspacePane
              workspaceTitle={workspaceTitle}
              workspaceDescription={workspaceDescription}
              showBrowsePane={showBrowsePane}
              showEditorPane={showEditorPane}
              showSplitNoteWorkspace={showSplitNoteWorkspace}
              canSplitNoteWorkspace={canSplitNoteWorkspace}
              onShowBrowsePane={onShowBrowsePane}
              onShowEditorPane={onShowEditorPane}
              onToggleSplitWorkspace={onToggleSplitWorkspace}
              workspaceEditorLabel={workspaceEditorLabel}
              surfaceRadius={surfaceRadius}
              cardSx={{ gridColumn: '1 / -1' }}
            />

            {showBrowsePane ? <Box sx={{ minWidth: 0 }}>{browsePane}</Box> : null}
            {showEditorPane ? <Box sx={{ minWidth: 0 }}>{editorPane}</Box> : null}
          </Box>
        </Stack>
      </Container>
    </Box>
  )
}

export default CampaignWorkspaceSurface
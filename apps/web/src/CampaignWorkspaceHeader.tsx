import {
  Box,
  Card,
  CardContent,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import type { ReactNode } from 'react'

const singleLineTextSx = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const

interface CampaignOption {
  id: string
  name: string
}

export interface WorkspaceHeaderAction {
  ariaLabel: string
  icon: ReactNode
  onClick?: () => void
  disabled?: boolean
  color?: 'inherit' | 'default' | 'primary' | 'secondary'
}

interface CampaignWorkspaceHeaderProps {
  campaignName: string
  mobileSubtitle: string
  desktopSubtitle?: string
  selectedCampaignId: string
  campaignOptions: readonly CampaignOption[]
  onSelectCampaign: (campaignId: string) => void
  actions: readonly WorkspaceHeaderAction[]
  surfaceRadius: string
  compactDesktop?: boolean
  stickyDesktop?: boolean
}

export default function CampaignWorkspaceHeader({
  campaignName,
  mobileSubtitle,
  desktopSubtitle,
  selectedCampaignId,
  campaignOptions,
  onSelectCampaign,
  actions,
  surfaceRadius,
  compactDesktop = false,
  stickyDesktop = true,
}: CampaignWorkspaceHeaderProps) {
  const theme = useTheme()
  const useNarrowFloatingHeader = useMediaQuery(theme.breakpoints.down('md'))
  const subtitle = useNarrowFloatingHeader ? mobileSubtitle : (desktopSubtitle ?? mobileSubtitle)
  // compactDesktop (driven by scroll) shrinks the card vertically — halved
  // padding, pill border, hidden subtitle, smaller title. Applies at every
  // viewport: mobile compacts too, otherwise the scrolled header keeps too
  // much vertical real estate.
  const contentPadding = compactDesktop
    ? { xs: 0.75, md: 0.75 }
    : { xs: 1.25, md: 1.5 }
  const contentBottomPadding = compactDesktop
    ? { xs: 0.75, md: 0.75 }
    : { xs: 1.5, md: 1.75 }

  // Controls always flow into a single horizontal row — dropdown next to
  // icons. Same layout on mobile and desktop so the header reads the same
  // at every viewport.
  const controls = (
    <Stack
      direction="row"
      spacing={1}
      sx={{
        width: { xs: '100%', md: 'auto' },
        minWidth: 0,
        maxWidth: '100%',
        alignItems: 'center',
      }}
    >
      <TextField
        select
        size="small"
        label="Campaign"
        value={selectedCampaignId}
        onChange={(event) => onSelectCampaign(event.target.value)}
        sx={{ flex: { xs: 1, md: 'unset' }, minWidth: { md: 200 } }}
      >
        {campaignOptions.map((campaign) => (
          <MenuItem key={campaign.id} value={campaign.id}>
            {campaign.name}
          </MenuItem>
        ))}
      </TextField>
      <Box
        sx={{
          display: 'inline-flex',
          gap: useNarrowFloatingHeader ? 0.25 : 0.5,
          flexShrink: 0,
          minWidth: 0,
        }}
      >
        {actions.map((action) => (
          <Tooltip key={action.ariaLabel} title={action.ariaLabel}>
            <span>
              <IconButton
                aria-label={action.ariaLabel}
                color={action.color ?? 'inherit'}
                size="small"
                onClick={action.onClick}
                disabled={action.disabled}
              >
                {action.icon}
              </IconButton>
            </span>
          </Tooltip>
        ))}
      </Box>
    </Stack>
  )

  return (
    <Card
      sx={{
        position: stickyDesktop ? 'sticky' : { xs: 'sticky', lg: 'static' },
        top: { xs: 8, md: 12 },
        zIndex: 2,
        alignSelf: 'stretch',
        width: '100%',
        minHeight: { md: 'auto' },
        minWidth: 0,
        maxWidth: 'none',
        // Border-radius collapses to a pill on compact (desktop only — on
        // mobile the card still has two content rows so the pill curve would
        // clip the title; keep the regular radius there).
        borderRadius: compactDesktop
          ? { xs: surfaceRadius, md: '999px' }
          : surfaceRadius,
        border: '1px solid',
        borderColor: theme.shape.cardBorder,
        bgcolor: 'rgba(15, 23, 42, 0.88)',
        backdropFilter: 'blur(16px)',
        overflow: 'hidden',
        boxShadow: '0 16px 40px rgba(2, 6, 23, 0.26)',
        transition: theme.transitions.create(
          ['border-radius', 'max-width', 'padding'],
          { duration: theme.transitions.duration.shorter },
        ),
      }}
    >
      <CardContent
        sx={{
          pt: contentPadding,
          px: contentPadding,
          pb: contentBottomPadding,
          '&:last-child': {
            pb: contentBottomPadding,
          },
        }}
      >
        <Stack spacing={useNarrowFloatingHeader ? 0.75 : 1}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={useNarrowFloatingHeader ? 0.75 : 1}
            sx={{
              justifyContent: 'space-between',
              alignItems: { md: 'center' },
            }}
          >
            <Stack
              spacing={useNarrowFloatingHeader ? 0.35 : 0.5}
              sx={{ minWidth: 0, maxWidth: 760, flex: 1 }}
            >
              <Typography
                variant="h5"
                title={campaignName}
                sx={{
                  ...singleLineTextSx,
                  fontSize: compactDesktop
                    ? { xs: '0.95rem', md: '1rem' }
                    : { xs: '1.05rem', md: '1.2rem' },
                  transition: theme.transitions.create(['font-size'], {
                    duration: theme.transitions.duration.shorter,
                  }),
                }}
              >
                {campaignName}
              </Typography>
              <Typography
                color="rgba(255, 255, 255, 0.72)"
                variant="caption"
                sx={{
                  ...singleLineTextSx,
                  // Collapse subtitle when the card is in compact mode (any
                  // viewport) — keeps the row tight.
                  ...(compactDesktop
                    ? {
                        maxHeight: 0,
                        opacity: 0,
                        margin: 0,
                      }
                    : {}),
                  transition: theme.transitions.create(
                    ['max-height', 'opacity', 'margin'],
                    { duration: theme.transitions.duration.shorter },
                  ),
                }}
              >
                {subtitle}
              </Typography>
            </Stack>

            {controls}
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  )
}

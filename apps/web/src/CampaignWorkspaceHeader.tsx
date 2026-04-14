import {
  Box,
  Card,
  CardContent,
  IconButton,
  MenuItem,
  Stack,
  TextField,
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
  const contentPadding = useNarrowFloatingHeader ? { xs: 1, md: 1.25 } : { xs: 1.25, md: 1.5 }
  const contentBottomPadding = useNarrowFloatingHeader
    ? { xs: 2, md: 2.25 }
    : { xs: 1.5, md: 1.75 }

  const controls = (
    <Stack
      spacing={0.75}
      sx={{
        width: { xs: '100%', md: 'auto' },
        minWidth: 0,
        maxWidth: '100%',
        ...(compactDesktop ? { minWidth: { md: 320 } } : {}),
      }}
    >
      <TextField
        select
        size="small"
        label="Campaign"
        value={selectedCampaignId}
        onChange={(event) => onSelectCampaign(event.target.value)}
      >
        {campaignOptions.map((campaign) => (
          <MenuItem key={campaign.id} value={campaign.id}>
            {campaign.name}
          </MenuItem>
        ))}
      </TextField>
      <Box
        sx={{
          display: 'grid',
          gap: useNarrowFloatingHeader ? 0.25 : 0.5,
          gridTemplateColumns: `repeat(${Math.max(actions.length, 1)}, minmax(0, 1fr))`,
          width: '100%',
          minWidth: 0,
        }}
      >
        {actions.map((action) => (
          <IconButton
            key={action.ariaLabel}
            aria-label={action.ariaLabel}
            color={action.color ?? 'inherit'}
            size="small"
            onClick={action.onClick}
            disabled={action.disabled}
          >
            {action.icon}
          </IconButton>
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
        alignSelf: { xs: 'center', lg: 'flex-end' },
        width: { xs: 'min(100%, 360px)', lg: compactDesktop ? 560 : 'auto' },
        minHeight: { xs: 150, md: 'auto' },
        minWidth: 0,
        maxWidth: { xs: 360, lg: compactDesktop ? 560 : 'none' },
        borderRadius: surfaceRadius,
        border: '1px solid',
        borderColor: compactDesktop
          ? 'rgba(167, 139, 250, 0.14)'
          : 'rgba(167, 139, 250, 0.2)',
        bgcolor: compactDesktop
          ? 'rgba(15, 23, 42, 0.44)'
          : 'rgba(15, 23, 42, 0.88)',
        backdropFilter: compactDesktop ? 'blur(12px)' : 'blur(16px)',
        overflow: 'hidden',
        boxShadow: compactDesktop
          ? '0 16px 40px rgba(2, 6, 23, 0.18)'
          : '0 16px 40px rgba(2, 6, 23, 0.26)',
        transition: theme.transitions.create(
          ['background-color', 'border-color', 'box-shadow', 'max-width'],
          { duration: theme.transitions.duration.shorter },
        ),
        ...(compactDesktop
          ? {
              '&:hover': {
                bgcolor: 'rgba(15, 23, 42, 0.88)',
                borderColor: 'rgba(167, 139, 250, 0.22)',
                boxShadow: '0 18px 44px rgba(2, 6, 23, 0.28)',
              },
            }
          : {}),
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
              alignItems: { md: compactDesktop ? 'flex-start' : 'center' },
            }}
          >
            <Stack
              spacing={useNarrowFloatingHeader ? 0.35 : 0.5}
              sx={{ minWidth: 0, maxWidth: 760 }}
            >
              <Typography
                variant="h5"
                title={campaignName}
                sx={{
                  ...singleLineTextSx,
                  fontSize: useNarrowFloatingHeader
                    ? { xs: '1rem', md: '1.1rem' }
                    : { xs: '1.05rem', md: '1.2rem' },
                }}
              >
                {campaignName}
              </Typography>
              <Typography
                color="rgba(255, 255, 255, 0.72)"
                variant="caption"
                sx={singleLineTextSx}
              >
                {subtitle}
              </Typography>
              {useNarrowFloatingHeader ? <Stack spacing={0.5} sx={{ pt: 0.25 }}>{controls}</Stack> : null}
            </Stack>

            {!useNarrowFloatingHeader ? controls : null}
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  )
}

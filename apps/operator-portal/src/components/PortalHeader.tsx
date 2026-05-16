import AdminPanelSettingsRoundedIcon from '@mui/icons-material/AdminPanelSettingsRounded'
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded'
import ManageAccountsRoundedIcon from '@mui/icons-material/ManageAccountsRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import {
  Box,
  Button,
  Card,
  CardContent,
  Stack,
  Typography,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import useMediaQuery from '@mui/material/useMediaQuery'
import { buildAccountConsoleUrl, operatorKeycloakConfig } from '../config'

interface PortalHeaderProps {
  authToken: string | null
  isRoleAuthorized: boolean | null
  isLoadingFleet: boolean
  operatorActor: string
  surfaceRadius: string
  onRefresh: () => void
  onLogout: () => void
}

export default function PortalHeader({
  authToken,
  isRoleAuthorized,
  isLoadingFleet,
  operatorActor,
  surfaceRadius,
  onRefresh,
  onLogout,
}: PortalHeaderProps) {
  const theme = useTheme()
  const isXs = useMediaQuery(theme.breakpoints.down('sm'))

  return (
    <Card sx={{ borderRadius: surfaceRadius }}>
      <CardContent sx={{ p: { xs: 2, md: 3 } }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          sx={{ justifyContent: 'space-between', alignItems: { md: 'flex-start' } }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <AdminPanelSettingsRoundedIcon color="secondary" sx={{ flexShrink: 0 }} />
              <Typography
                variant="h4"
                sx={{
                  fontSize: { xs: '1.25rem', md: '2.125rem' },
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                Operator control portal
              </Typography>
            </Stack>
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              Inspect and trigger tenant lifecycle work through the existing
              control-plane routes, not a browser-only write path.
            </Typography>
            {authToken ? (
              <Typography color="text.secondary" variant="body2" sx={{ mt: 1.5 }}>
                Acting as <strong>{operatorActor}</strong>
              </Typography>
            ) : null}
          </Box>

          {authToken && isRoleAuthorized ? (
            <Stack
              direction="row"
              spacing={1}
              useFlexGap
              sx={{ flexWrap: 'wrap', flexShrink: 0 }}
            >
              <Button
                variant="outlined"
                startIcon={isXs ? undefined : <RefreshRoundedIcon />}
                onClick={onRefresh}
                disabled={isLoadingFleet}
                aria-label="Refresh fleet"
                sx={{ minWidth: 0 }}
              >
                {isXs ? <RefreshRoundedIcon fontSize="small" /> : (isLoadingFleet ? 'Refreshing…' : 'Refresh fleet')}
              </Button>
              <Button
                variant="outlined"
                color="inherit"
                startIcon={isXs ? undefined : <ManageAccountsRoundedIcon />}
                component="a"
                href={buildAccountConsoleUrl(operatorKeycloakConfig)}
                aria-label="Account settings"
                sx={{ minWidth: 0 }}
              >
                {isXs ? <ManageAccountsRoundedIcon fontSize="small" /> : 'Account settings'}
              </Button>
              <Button
                variant="outlined"
                color="inherit"
                startIcon={isXs ? undefined : <LogoutRoundedIcon />}
                onClick={onLogout}
                aria-label="Sign out"
                sx={{ minWidth: 0 }}
              >
                {isXs ? <LogoutRoundedIcon fontSize="small" /> : 'Sign out'}
              </Button>
            </Stack>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  )
}

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
  return (
    <Card sx={{ borderRadius: surfaceRadius }}>
      <CardContent sx={{ p: 3 }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          sx={{ justifyContent: 'space-between', alignItems: { md: 'flex-start' } }}
        >
          <Box>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <AdminPanelSettingsRoundedIcon color="secondary" />
              <Typography variant="h4">Operator control portal</Typography>
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
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <Button
                variant="outlined"
                startIcon={<RefreshRoundedIcon />}
                onClick={onRefresh}
                disabled={isLoadingFleet}
              >
                {isLoadingFleet ? 'Refreshing…' : 'Refresh fleet'}
              </Button>
              <Button
                variant="outlined"
                color="inherit"
                startIcon={<ManageAccountsRoundedIcon />}
                component="a"
                href={buildAccountConsoleUrl(operatorKeycloakConfig)}
              >
                Account settings
              </Button>
              <Button
                variant="outlined"
                color="inherit"
                startIcon={<LogoutRoundedIcon />}
                onClick={onLogout}
              >
                Sign out
              </Button>
            </Stack>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  )
}

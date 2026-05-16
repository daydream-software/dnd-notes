import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded'
import SecurityRoundedIcon from '@mui/icons-material/SecurityRounded'
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Link,
  Stack,
  Typography,
} from '@mui/material'
import * as React from 'react'
import { customerPortalUrl, requiredRoles } from '../config'

interface AuthGateProps {
  isAuthReady: boolean
  authToken: string | null
  isRoleAuthorized: boolean | null
  surfaceRadius: string
  onLogin: () => void
  onLogout: () => void
  children: React.ReactNode
}

export default function AuthGate({
  isAuthReady,
  authToken,
  isRoleAuthorized,
  surfaceRadius,
  onLogin,
  onLogout,
  children,
}: AuthGateProps) {
  if (!isAuthReady) {
    return (
      <Card sx={{ borderRadius: surfaceRadius }}>
        <CardContent sx={{ p: 4 }}>
          <Stack spacing={2} sx={{ alignItems: 'center', textAlign: 'center' }}>
            <CircularProgress />
            <Typography variant="h6">Checking operator session…</Typography>
          </Stack>
        </CardContent>
      </Card>
    )
  }

  if (!authToken) {
    return (
      <Card sx={{ borderRadius: surfaceRadius }}>
        <CardContent sx={{ p: 4 }}>
          <Stack spacing={2.5}>
            <Box>
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                <SecurityRoundedIcon color="secondary" sx={{ fontSize: 40 }} />
                <Typography variant="h5">Sign in to the operator portal</Typography>
              </Stack>
              <Typography color="text.secondary" sx={{ mt: 1 }}>
                Sign in with your workforce or admin account before
                inspecting fleet state.
              </Typography>
            </Box>
            <Button
              variant="contained"
              size="large"
              onClick={onLogin}
              sx={{ alignSelf: 'flex-start' }}
            >
              Continue
            </Button>
          </Stack>
        </CardContent>
      </Card>
    )
  }

  if (!isRoleAuthorized) {
    return (
      <Card sx={{ borderRadius: surfaceRadius }} data-testid="access-denied-view">
        <CardContent sx={{ p: 4 }}>
          <Stack spacing={2.5} sx={{ alignItems: 'flex-start' }}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <SecurityRoundedIcon color="warning" sx={{ fontSize: 36 }} />
              <Typography variant="h5">Access not authorized</Typography>
            </Stack>
            <Typography color="text.secondary">
              You don&apos;t have access to the operator console. Your account does not have a
              required operator role ({requiredRoles.join(', ')}).
            </Typography>
            <Typography color="text.secondary">
              If you reached here by mistake, sign in to the customer portal instead.{' '}
              <Link href={customerPortalUrl} underline="hover">
                Go to customer portal
              </Link>
            </Typography>
            <Button
              variant="outlined"
              color="inherit"
              startIcon={<LogoutRoundedIcon />}
              onClick={onLogout}
              sx={{ alignSelf: 'flex-start' }}
            >
              Sign out
            </Button>
          </Stack>
        </CardContent>
      </Card>
    )
  }

  return <>{children}</>
}

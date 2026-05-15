import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Container,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { Footer } from '@dnd-notes/theme'
import type { OwnerLoginDraft, OwnerRegistrationDraft } from '../hooks/useSession'

export interface LoginPageProps {
  isKeycloakMode: boolean
  isRegisterMode: boolean
  registerDraft: OwnerRegistrationDraft
  loginDraft: OwnerLoginDraft
  isSubmittingAuth: boolean
  error: string | null
  surfaceRadius: number | string
  heroCardRadius: number | string
  onRegisterDraftChange: <Field extends keyof OwnerRegistrationDraft>(
    field: Field,
    value: OwnerRegistrationDraft[Field],
  ) => void
  onLoginDraftChange: <Field extends keyof OwnerLoginDraft>(
    field: Field,
    value: OwnerLoginDraft[Field],
  ) => void
  onToggleRegisterMode: () => void
  onSubmit: () => void
}

export default function LoginPage({
  isKeycloakMode,
  isRegisterMode,
  registerDraft,
  loginDraft,
  isSubmittingAuth,
  error,
  surfaceRadius,
  heroCardRadius,
  onRegisterDraftChange,
  onLoginDraftChange,
  onToggleRegisterMode,
  onSubmit,
}: LoginPageProps) {
  return (
    <Box component="main" sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', p: 3 }}>
      <Container maxWidth="sm" sx={{ flex: 1, display: 'grid', placeItems: 'center' }}>
        <Stack spacing={3} sx={{ width: '100%' }}>
          <Card sx={{ borderRadius: heroCardRadius }}>
            <CardContent sx={{ p: { xs: 3, md: 4 } }}>
              <Stack spacing={3}>
                <Box>
                  <Typography
                    variant="overline"
                    sx={{ color: 'text.secondary', letterSpacing: '0.18em' }}
                  >
                    Your D&D Notes workspace
                  </Typography>
                  <Typography variant="h3" sx={{ mt: 1 }}>
                    {isKeycloakMode
                      ? 'Sign in to your workspace'
                      : isRegisterMode
                        ? 'Create your owner account'
                        : 'Sign in to your workspace'}
                  </Typography>
                  <Typography color="text.secondary" sx={{ mt: 2 }}>
                    {isKeycloakMode
                      ? 'Use your workspace account to access your campaigns and notes.'
                      : 'Finish setting up campaigns, manage campaign details, and keep note workflows scoped to the right table.'}
                  </Typography>
                </Box>

                {error ? (
                  <Alert severity="error" sx={{ borderRadius: surfaceRadius }}>
                    {error}
                  </Alert>
                ) : null}

                {!isKeycloakMode && isRegisterMode ? (
                  <TextField
                    label="Owner display name"
                    value={registerDraft.displayName}
                    onChange={(event) =>
                      onRegisterDraftChange('displayName', event.target.value)
                    }
                  />
                ) : null}

                {!isKeycloakMode ? (
                  <>
                    <TextField
                      label="Email"
                      type="email"
                      value={isRegisterMode ? registerDraft.email : loginDraft.email}
                      onChange={(event) => {
                        const value = event.target.value
                        if (isRegisterMode) {
                          onRegisterDraftChange('email', value)
                        } else {
                          onLoginDraftChange('email', value)
                        }
                      }}
                    />

                    <TextField
                      label="Password"
                      type="password"
                      value={isRegisterMode ? registerDraft.password : loginDraft.password}
                      onChange={(event) => {
                        const value = event.target.value
                        if (isRegisterMode) {
                          onRegisterDraftChange('password', value)
                        } else {
                          onLoginDraftChange('password', value)
                        }
                      }}
                    />
                  </>
                ) : null}

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                  <Button
                    variant="contained"
                    onClick={onSubmit}
                    disabled={isSubmittingAuth}
                    sx={{ alignSelf: { xs: 'flex-start', sm: 'auto' } }}
                  >
                    {isSubmittingAuth
                      ? isKeycloakMode
                        ? 'Signing in…'
                        : isRegisterMode
                          ? 'Creating account…'
                          : 'Signing in…'
                      : isKeycloakMode
                        ? 'Continue'
                        : isRegisterMode
                          ? 'Create owner account'
                          : 'Sign in'}
                  </Button>
                  {!isKeycloakMode ? (
                    <Button
                      variant="text"
                      onClick={onToggleRegisterMode}
                    >
                      {isRegisterMode
                        ? 'Already have an account? Sign in'
                        : 'Need an account? Create one'}
                    </Button>
                  ) : null}
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        </Stack>
      </Container>
      <Footer variant="signature" />
    </Box>
  )
}

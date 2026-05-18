import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Container,
  Stack,
  Typography,
} from '@mui/material'
import { Footer } from '@dnd-notes/theme'

export interface LoginPageProps {
  isSubmittingAuth: boolean
  error: string | null
  surfaceRadius: number | string
  heroCardRadius: number | string
  onSubmit: () => void
}

export default function LoginPage({
  isSubmittingAuth,
  error,
  surfaceRadius,
  heroCardRadius,
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
                    Sign in to your workspace
                  </Typography>
                  <Typography color="text.secondary" sx={{ mt: 2 }}>
                    Use your workspace account to access your campaigns and notes.
                  </Typography>
                </Box>

                {error ? (
                  <Alert severity="error" sx={{ borderRadius: surfaceRadius }}>
                    {error}
                  </Alert>
                ) : null}

                <Button
                  variant="contained"
                  onClick={onSubmit}
                  disabled={isSubmittingAuth}
                  sx={{ alignSelf: 'flex-start' }}
                >
                  {isSubmittingAuth ? 'Signing in…' : 'Continue'}
                </Button>
              </Stack>
            </CardContent>
          </Card>
        </Stack>
      </Container>
      <Footer variant="signature" />
    </Box>
  )
}

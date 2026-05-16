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
import type { GuestJoinInput } from '../types'

const heroCardRadius = '32px'
const surfaceRadius = '24px'

interface JoinPageProps {
  campaignName: string | undefined
  joinDraft: GuestJoinInput
  isJoining: boolean
  error: string | null
  onJoinDraftChange: (draft: GuestJoinInput) => void
  onJoin: () => void
}

export default function JoinPage({
  campaignName,
  joinDraft,
  isJoining,
  error,
  onJoinDraftChange,
  onJoin,
}: JoinPageProps) {
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
                    Shared campaign access
                  </Typography>
                  <Typography variant="h3" sx={{ mt: 1 }}>
                    Join {campaignName}
                  </Typography>
                  <Typography color="text.secondary" sx={{ mt: 2 }}>
                    Pick the name you want this campaign to use for you. You can return with
                    the same shared link and keep this guest identity.
                  </Typography>
                </Box>

                {error ? (
                  <Alert severity="error" sx={{ borderRadius: surfaceRadius }}>
                    {error}
                  </Alert>
                ) : null}

                <TextField
                  label="Display name"
                  value={joinDraft.displayName}
                  onChange={(event) => onJoinDraftChange({ displayName: event.target.value })}
                />

                <Button
                  variant="contained"
                  onClick={onJoin}
                  disabled={isJoining || joinDraft.displayName.trim().length === 0}
                  sx={{ alignSelf: 'flex-start' }}
                >
                  {isJoining ? 'Joining campaign…' : 'Join campaign'}
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

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import AdminPage from './AdminPage'
import type { CampaignDraft } from '../hooks/useCampaign'
import {
  campaignStarterTemplates,
  getCampaignStarterTemplate,
} from '../hooks/useCampaign'
import type { OwnerAccount } from '../types'

interface CampaignListPageProps {
  owner: OwnerAccount | null
  authToken: string | null
  surfaceRadius: number | string
  heroCardRadius: number | string
  error: string | null
  selectedCampaignTemplateId: string
  onSelectedCampaignTemplateIdChange: (id: string) => void
  campaignDraft: CampaignDraft
  onCampaignDraftChange: <Field extends keyof CampaignDraft>(
    field: Field,
    value: CampaignDraft[Field],
  ) => void
  isSavingCampaign: boolean
  onSaveCampaign: () => void
  onLogout: () => void
}

export default function CampaignListPage({
  owner,
  authToken,
  surfaceRadius,
  heroCardRadius,
  error,
  selectedCampaignTemplateId,
  onSelectedCampaignTemplateIdChange,
  campaignDraft,
  onCampaignDraftChange,
  isSavingCampaign,
  onSaveCampaign,
  onLogout,
}: CampaignListPageProps) {
  const selectedCampaignTemplate = getCampaignStarterTemplate(selectedCampaignTemplateId)

  return (
    <Box component="main" sx={{ minHeight: '100vh', py: { xs: 4, md: 6 } }}>
      <Container maxWidth="md">
        <Stack spacing={3}>
          {owner?.isSiteAdmin && authToken ? (
            <AdminPage authToken={authToken} surfaceRadius={surfaceRadius} />
          ) : null}
          <Card sx={{ borderRadius: heroCardRadius }}>
            <CardContent sx={{ p: { xs: 3, md: 4 } }}>
              <Stack spacing={3}>
                <Box>
                  <Typography
                    variant="overline"
                    sx={{ color: 'text.secondary', letterSpacing: '0.18em' }}
                  >
                    Owner setup
                  </Typography>
                  <Typography variant="h3" sx={{ mt: 1 }}>
                    Create your first campaign
                  </Typography>
                  <Typography color="text.secondary" sx={{ mt: 2 }}>
                    Start with the campaign shell first, then you can manage notes,
                    settings, and invite flows from the same workspace.
                  </Typography>
                </Box>

                {error ? (
                  <Alert severity="error" sx={{ borderRadius: surfaceRadius }}>
                    {error}
                  </Alert>
                ) : null}

                <Stack spacing={1.5}>
                  <TextField
                    select
                    label="Campaign starter"
                    value={selectedCampaignTemplateId}
                    onChange={(event) =>
                      onSelectedCampaignTemplateIdChange(event.target.value)
                    }
                    helperText="Optional. Seed flexible starter notes or leave the campaign blank."
                  >
                    {campaignStarterTemplates.map((template) => (
                      <MenuItem key={template.id} value={template.id}>
                        {template.name}
                      </MenuItem>
                    ))}
                  </TextField>

                  {selectedCampaignTemplate.starterNotes.length > 0 ? (
                    <Alert severity="info" sx={{ borderRadius: surfaceRadius }}>
                      <Stack spacing={1}>
                        <Typography variant="body2">
                          {selectedCampaignTemplate.description}
                        </Typography>
                        <Stack
                          direction="row"
                          spacing={1}
                          useFlexGap
                          sx={{ flexWrap: 'wrap' }}
                        >
                          {selectedCampaignTemplate.starterNotes.map((starterNote) => (
                            <Chip
                              key={starterNote.title}
                              label={starterNote.title}
                              size="small"
                            />
                          ))}
                        </Stack>
                      </Stack>
                    </Alert>
                  ) : null}
                </Stack>

                <TextField
                  label="Campaign name"
                  value={campaignDraft.name}
                  onChange={(event) =>
                    onCampaignDraftChange('name', event.target.value)
                  }
                />
                <TextField
                  label="Tagline"
                  value={campaignDraft.tagline}
                  onChange={(event) =>
                    onCampaignDraftChange('tagline', event.target.value)
                  }
                />
                <TextField
                  label="System"
                  value={campaignDraft.system}
                  onChange={(event) =>
                    onCampaignDraftChange('system', event.target.value)
                  }
                />
                <TextField
                  label="Setting"
                  value={campaignDraft.setting}
                  onChange={(event) =>
                    onCampaignDraftChange('setting', event.target.value)
                  }
                />
                <TextField
                  label="Next session"
                  value={campaignDraft.nextSession}
                  onChange={(event) =>
                    onCampaignDraftChange('nextSession', event.target.value)
                  }
                  helperText="Optional. Use an ISO timestamp or plain text date."
                />

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                  <Button
                    variant="contained"
                    onClick={onSaveCampaign}
                    disabled={isSavingCampaign}
                  >
                    {isSavingCampaign ? 'Creating campaign…' : 'Create campaign'}
                  </Button>
                  <Button variant="text" onClick={onLogout}>
                    Sign out
                  </Button>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        </Stack>
      </Container>
    </Box>
  )
}

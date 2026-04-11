import AutoStoriesRoundedIcon from '@mui/icons-material/AutoStoriesRounded'
import EventRoundedIcon from '@mui/icons-material/EventRounded'
import LocationOnRoundedIcon from '@mui/icons-material/LocationOnRounded'
import PeopleAltRoundedIcon from '@mui/icons-material/PeopleAltRounded'
import PsychologyRoundedIcon from '@mui/icons-material/PsychologyRounded'
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Divider,
  Stack,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { fetchOverview } from './api'
import type { CampaignOverview } from './types'

const buildTracks = [
  'Session recap editor with prompts for clues, loot, and unresolved hooks',
  'Entity views for NPCs, locations, and factions linked back to every note',
  'Search and filtering across tags, campaigns, and session dates',
]

function formatSessionDate(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('en', { dateStyle: 'full' }).format(date)
}

function App() {
  const [overview, setOverview] = useState<CampaignOverview | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    const loadOverview = async () => {
      try {
        const nextOverview = await fetchOverview(controller.signal)
        setOverview(nextOverview)
      } catch (loadError) {
        if (controller.signal.aborted) {
          return
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Could not load the starter campaign overview.',
        )
      }
    }

    void loadOverview()

    return () => controller.abort()
  }, [])

  const statCards = useMemo(() => {
    if (!overview) {
      return []
    }

    return [
      {
        label: 'Notes captured',
        value: overview.stats.totalNotes,
        detail: 'Seeded notes ready for editor flows and list views.',
        icon: <AutoStoriesRoundedIcon color="primary" />,
      },
      {
        label: 'Party members',
        value: overview.party.length,
        detail: 'Enough characters to start relationship tracking.',
        icon: <PeopleAltRoundedIcon color="primary" />,
      },
      {
        label: 'Known locations',
        value: overview.stats.locations,
        detail: 'A good base for maps, tags, and travel context.',
        icon: <LocationOnRoundedIcon color="primary" />,
      },
      {
        label: 'Open threads',
        value: overview.stats.openThreads,
        detail: 'Hooks you can turn into timelines, tasks, or reminders.',
        icon: <PsychologyRoundedIcon color="primary" />,
      },
    ]
  }, [overview])

  if (error) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 3 }}>
        <Alert severity="error" sx={{ maxWidth: 560 }}>
          {error}
        </Alert>
      </Box>
    )
  }

  if (!overview) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <Stack spacing={2} sx={{ alignItems: 'center' }}>
          <CircularProgress />
          <Typography color="text.secondary">Loading campaign starter...</Typography>
        </Stack>
      </Box>
    )
  }

  return (
    <Box component="main" sx={{ minHeight: '100vh', py: { xs: 4, md: 6 } }}>
      <Container maxWidth="lg">
        <Stack spacing={3}>
          <Card
            sx={{
              borderRadius: 6,
              background:
                'linear-gradient(140deg, rgba(124, 58, 237, 0.9), rgba(30, 41, 59, 0.96))',
            }}
          >
            <CardContent sx={{ p: { xs: 3, md: 4 } }}>
              <Stack spacing={3}>
                <Stack
                  direction={{ xs: 'column', md: 'row' }}
                  spacing={2}
                  sx={{ justifyContent: 'space-between' }}
                >
                  <Box sx={{ maxWidth: 720 }}>
                    <Typography
                      variant="overline"
                      sx={{ color: 'rgba(255, 255, 255, 0.72)', letterSpacing: '0.18em' }}
                    >
                      Campaign dashboard starter
                    </Typography>
                    <Typography variant="h2" sx={{ mt: 1, fontSize: { xs: '2.3rem', md: '3.4rem' } }}>
                      {overview.campaign.name}
                    </Typography>
                    <Typography sx={{ mt: 2, maxWidth: 620, color: 'rgba(255, 255, 255, 0.78)' }}>
                      {overview.campaign.tagline}
                    </Typography>
                  </Box>

                  <Stack
                    spacing={1.5}
                    sx={{
                      minWidth: { md: 260 },
                      borderRadius: 4,
                      p: 2.5,
                      bgcolor: 'rgba(15, 23, 42, 0.36)',
                      backdropFilter: 'blur(12px)',
                    }}
                  >
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <EventRoundedIcon color="inherit" />
                      <Typography sx={{ fontWeight: 700 }}>Next session</Typography>
                    </Stack>
                    <Typography variant="h6">{formatSessionDate(overview.campaign.nextSession)}</Typography>
                    <Typography color="rgba(255, 255, 255, 0.72)">
                      {overview.campaign.setting} • {overview.campaign.system}
                    </Typography>
                  </Stack>
                </Stack>

                <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                  {overview.campaign.focusAreas.map((area) => (
                    <Chip
                      key={area}
                      label={area}
                      sx={{
                        bgcolor: 'rgba(255, 255, 255, 0.14)',
                        color: 'common.white',
                        borderRadius: 999,
                      }}
                    />
                  ))}
                </Stack>
              </Stack>
            </CardContent>
          </Card>

          <Box
            sx={{
              display: 'grid',
              gap: 3,
              gridTemplateColumns: {
                xs: '1fr',
                sm: 'repeat(2, minmax(0, 1fr))',
                xl: 'repeat(4, minmax(0, 1fr))',
              },
            }}
          >
            {statCards.map((card) => (
              <Card key={card.label} sx={{ borderRadius: 5 }}>
                <CardContent sx={{ p: 3 }}>
                  <Stack spacing={1.5}>
                    {card.icon}
                    <Typography color="text.secondary" variant="body2">
                      {card.label}
                    </Typography>
                    <Typography variant="h3">{card.value}</Typography>
                    <Typography color="text.secondary">{card.detail}</Typography>
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Box>

          <Box
            sx={{
              display: 'grid',
              gap: 3,
              gridTemplateColumns: { xs: '1fr', lg: '1.35fr 0.95fr' },
            }}
          >
            <Card sx={{ borderRadius: 5 }}>
              <CardContent sx={{ p: 3 }}>
                <Stack spacing={3}>
                  <Box>
                    <Typography variant="h5">Recent notes</Typography>
                    <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                      Starter data from the API, already ready to power list views and detail routes.
                    </Typography>
                  </Box>

                  <Stack divider={<Divider flexItem />}>
                    {overview.notes.map((note) => (
                      <Stack
                        key={note.id}
                        spacing={1.25}
                        sx={{ py: 2, '&:first-of-type': { pt: 0 }, '&:last-of-type': { pb: 0 } }}
                      >
                        <Stack
                          direction={{ xs: 'column', sm: 'row' }}
                          spacing={1.5}
                          sx={{ justifyContent: 'space-between' }}
                        >
                          <Box>
                            <Typography variant="h6">{note.title}</Typography>
                            <Typography color="text.secondary">
                              {note.category} • Updated {note.updatedAt}
                            </Typography>
                          </Box>
                          <Chip label={note.status} color="primary" variant="outlined" />
                        </Stack>
                        <Typography>{note.summary}</Typography>
                        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                          {note.tags.map((tag) => (
                            <Chip key={tag} label={tag} size="small" variant="filled" />
                          ))}
                        </Stack>
                      </Stack>
                    ))}
                  </Stack>
                </Stack>
              </CardContent>
            </Card>

            <Stack spacing={3}>
              <Card sx={{ borderRadius: 5 }}>
                <CardContent sx={{ p: 3 }}>
                  <Stack spacing={2}>
                    <Typography variant="h5">World state</Typography>
                    <Box>
                      <Typography color="text.secondary" variant="body2">
                        Party
                      </Typography>
                      <Stack
                        direction="row"
                        spacing={1}
                        useFlexGap
                        sx={{ mt: 1.5, flexWrap: 'wrap' }}
                      >
                        {overview.party.map((member) => (
                          <Chip key={member} label={member} />
                        ))}
                      </Stack>
                    </Box>
                    <Box>
                      <Typography color="text.secondary" variant="body2">
                        Active factions
                      </Typography>
                      <Stack
                        direction="row"
                        spacing={1}
                        useFlexGap
                        sx={{ mt: 1.5, flexWrap: 'wrap' }}
                      >
                        {overview.factions.map((faction) => (
                          <Chip key={faction} label={faction} variant="outlined" />
                        ))}
                      </Stack>
                    </Box>
                  </Stack>
                </CardContent>
              </Card>

              <Card sx={{ borderRadius: 5 }}>
                <CardContent sx={{ p: 3 }}>
                  <Stack spacing={2}>
                    <Typography variant="h5">Build next</Typography>
                    {buildTracks.map((track) => (
                      <Stack
                        key={track}
                        direction="row"
                        spacing={1.5}
                        sx={{ alignItems: 'flex-start' }}
                      >
                        <Chip label="Ready" color="secondary" size="small" />
                        <Typography color="text.secondary">{track}</Typography>
                      </Stack>
                    ))}
                  </Stack>
                </CardContent>
              </Card>
            </Stack>
          </Box>
        </Stack>
      </Container>
    </Box>
  )
}

export default App

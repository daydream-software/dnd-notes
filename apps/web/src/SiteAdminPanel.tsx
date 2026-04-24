import AdminPanelSettingsRoundedIcon from '@mui/icons-material/AdminPanelSettingsRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  Typography,
} from '@mui/material'
import type { AdminAccountSummary, AdminOverview } from './types'

interface SiteAdminPanelProps {
  accounts: AdminAccountSummary[]
  overview: AdminOverview | null
  isLoading: boolean
  error: string | null
  onRefresh: () => void
  surfaceRadius: number | string
}

interface MetricSection {
  title: string
  chips: string[]
}

function createMetricSections(overview: AdminOverview): MetricSection[] {
  return [
    {
      title: 'Accounts',
      chips: [
        `Total ${overview.accounts.total}`,
        `Site admins ${overview.accounts.siteAdmins}`,
      ],
    },
    {
      title: 'Campaigns',
      chips: [
        `Total ${overview.campaigns.total}`,
        `Archived ${overview.campaigns.archived}`,
      ],
    },
    {
      title: 'Memberships',
      chips: [
        `Total ${overview.memberships.total}`,
        `Linked accounts ${overview.memberships.linkedAccounts}`,
        `Guests ${overview.memberships.guests}`,
      ],
    },
    {
      title: 'Share links',
      chips: [
        `Active ${overview.shareLinks.active}`,
        `Revoked ${overview.shareLinks.revoked}`,
      ],
    },
    {
      title: 'Notes',
      chips: [
        `Total ${overview.notes.total}`,
        `Draft ${overview.notes.draft}`,
        `Active ${overview.notes.active}`,
        `Archived ${overview.notes.archived}`,
      ],
    },
  ]
}

function formatGeneratedAt(generatedAt: string) {
  return new Date(generatedAt).toLocaleString()
}

export default function SiteAdminPanel({
  accounts,
  overview,
  isLoading,
  error,
  onRefresh,
  surfaceRadius,
}: SiteAdminPanelProps) {
  return (
    <Card aria-label="Site admin panel" sx={{ borderRadius: surfaceRadius }}>
      <CardContent sx={{ p: 3 }}>
        <Stack spacing={2.5}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={2}
            sx={{ justifyContent: 'space-between', alignItems: { md: 'flex-start' } }}
          >
            <Box>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <AdminPanelSettingsRoundedIcon color="secondary" />
                <Typography variant="h5">Site admin panel</Typography>
              </Stack>
              <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                Review global usage counts and current site-admin assignments
                without leaving the notes workspace.
              </Typography>
              <Typography color="text.secondary" variant="body2" sx={{ mt: 1 }}>
                {overview
                  ? `Last updated ${formatGeneratedAt(overview.generatedAt)}`
                  : isLoading
                    ? 'Loading site-admin metrics...'
                    : 'No site-admin metrics loaded yet.'}
              </Typography>
            </Box>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <Button
                variant="outlined"
                startIcon={<RefreshRoundedIcon />}
                onClick={onRefresh}
                disabled={isLoading}
                aria-label="Refresh admin metrics"
              >
                {isLoading ? 'Refreshing...' : 'Refresh metrics'}
              </Button>
            </Stack>
          </Stack>

          {error ? (
            <Alert severity="error" sx={{ borderRadius: surfaceRadius }}>
              {error}
            </Alert>
          ) : null}

          {overview ? (
            <Stack
              direction={{ xs: 'column', xl: 'row' }}
              spacing={2}
              useFlexGap
              sx={{ flexWrap: 'wrap' }}
            >
              {createMetricSections(overview).map((section) => (
                <Card
                  key={section.title}
                  variant="outlined"
                  sx={{ flex: '1 1 210px', minWidth: 0, borderRadius: surfaceRadius }}
                >
                  <CardContent sx={{ p: 2 }}>
                    <Stack spacing={1.5}>
                      <Typography variant="subtitle1">{section.title}</Typography>
                      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                        {section.chips.map((chipLabel) => (
                          <Chip key={chipLabel} label={chipLabel} size="small" />
                        ))}
                      </Stack>
                    </Stack>
                  </CardContent>
                </Card>
              ))}
            </Stack>
          ) : null}

          <Stack spacing={1.5}>
            <Box>
              <Typography variant="h6">Account directory</Typography>
              <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                Review real accounts and current site-admin assignments before any
                write-side admin tools land.
              </Typography>
            </Box>

            {accounts.length > 0 ? (
              <Stack spacing={1.5}>
                {accounts.map((account) => (
                  <Card
                    key={account.id}
                    variant="outlined"
                    sx={{ borderRadius: surfaceRadius }}
                  >
                    <CardContent sx={{ p: 2 }}>
                      <Stack
                        direction={{ xs: 'column', md: 'row' }}
                        spacing={1.5}
                        sx={{ justifyContent: 'space-between' }}
                      >
                        <Box>
                          <Typography variant="subtitle1">{account.displayName}</Typography>
                          <Typography color="text.secondary" variant="body2">
                            {account.email}
                          </Typography>
                        </Box>
                        <Stack
                          direction="row"
                          spacing={1}
                          useFlexGap
                          sx={{ flexWrap: 'wrap', justifyContent: { md: 'flex-end' } }}
                        >
                          <Chip
                            label={account.isSiteAdmin ? 'Site admin' : 'Standard account'}
                            color={account.isSiteAdmin ? 'secondary' : 'default'}
                            size="small"
                          />
                          <Chip
                            label={`Owned campaigns ${account.ownedCampaignCount}`}
                            size="small"
                          />
                          <Chip
                            label={`Memberships ${account.campaignMembershipCount}`}
                            size="small"
                          />
                        </Stack>
                      </Stack>
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            ) : (
              <Typography color="text.secondary">
                No owner accounts have been created yet.
              </Typography>
            )}
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  )
}

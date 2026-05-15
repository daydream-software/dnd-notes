import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { cardBorderColor } from '@dnd-notes/theme'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import {
  describeCampaignMembership,
  campaignStarterTemplates,
  getCampaignStarterTemplate,
} from '../hooks/useCampaign'
import type { CampaignDraft, MembershipConsolidationDraft } from '../hooks/useCampaign'
import type { ShareLinkDraft, RevealedShareLink } from '../hooks/useShareLinks'
import type {
  CampaignMembership,
  CampaignShareLink,
  MembershipConsolidationSummary,
  OwnerAccount,
} from '../types'
import AdminPage from '../pages/AdminPage'

const surfaceRadius = '24px'
const noteItemRadius = '20px'

export interface CampaignAdminPaneProps {
  // Auth + ownership
  owner: OwnerAccount | null
  authToken: string | null
  isSharedMode: boolean
  isKeycloakMode: boolean
  // Shared membership claim card
  resolvedMembership: CampaignMembership | null
  accountNotice: string | null
  isLinkingAccount: boolean
  isRegisterMode: boolean
  registerDraft: { email: string; password: string; displayName: string }
  loginDraft: { email: string; password: string }

  // Campaign form
  campaignFormMode: 'create' | 'edit' | 'closed'
  campaignDraft: CampaignDraft
  selectedCampaignTemplateId: string
  isSavingCampaign: boolean

  // Membership management
  currentCampaignMemberships: CampaignMembership[]
  membershipConsolidationDraft: MembershipConsolidationDraft
  membershipConsolidationPreview: MembershipConsolidationSummary | null
  membershipConsolidationNotice: string | null
  selectedSourceMembership: CampaignMembership | null
  selectedTargetMembership: CampaignMembership | null
  hasValidMembershipConsolidationSelection: boolean
  canApplyMembershipConsolidation: boolean
  isPreviewingMembershipConsolidation: boolean
  isApplyingMembershipConsolidation: boolean

  // Share links
  shareLinks: CampaignShareLink[]
  shareLinkDraft: ShareLinkDraft
  shareLinkNotice: string | null
  revealedShareLinks: Record<string, RevealedShareLink>
  shareLinkActionErrors: Record<string, string>
  revealingShareLinkId: string | null
  copiedShareLinkId: string | null
  isCreatingShareLink: boolean

  // Handlers — campaign form
  onCampaignDraftChange: <Field extends keyof CampaignDraft>(field: Field, value: CampaignDraft[Field]) => void
  onSelectedCampaignTemplateIdChange: (id: string) => void
  onSaveCampaign: () => void
  onCancelCampaignForm: () => void

  // Handlers — membership consolidation
  onMembershipConsolidationDraftChange: <Field extends keyof MembershipConsolidationDraft>(field: Field, value: MembershipConsolidationDraft[Field]) => void
  onPreviewMembershipConsolidation: () => void
  onApplyMembershipConsolidation: () => void

  // Handlers — share links
  onShareLinkDraftChange: <Field extends keyof ShareLinkDraft>(field: Field, value: ShareLinkDraft[Field]) => void
  onCreateShareLink: () => void
  onRevealShareLink: (shareLinkId: string) => void
  onToggleShareLinkVisibility: (shareLinkId: string) => void
  onCopyShareLink: (shareLinkId: string) => void
  onRevokeShareLink: (shareLinkId: string) => void

  // Handlers — shared membership claim
  onRegisterDraftChange: (field: 'email' | 'password' | 'displayName', value: string) => void
  onLoginDraftChange: (field: 'email' | 'password', value: string) => void
  onToggleRegisterMode: () => void
  onLinkSharedMembership: () => void
}

export default function CampaignAdminPane({
  owner,
  authToken,
  isSharedMode,
  isKeycloakMode,
  resolvedMembership,
  accountNotice,
  isLinkingAccount,
  isRegisterMode,
  registerDraft,
  loginDraft,
  campaignFormMode,
  campaignDraft,
  selectedCampaignTemplateId,
  isSavingCampaign,
  currentCampaignMemberships,
  membershipConsolidationDraft,
  membershipConsolidationPreview,
  membershipConsolidationNotice,
  selectedSourceMembership,
  selectedTargetMembership,
  hasValidMembershipConsolidationSelection,
  canApplyMembershipConsolidation,
  isPreviewingMembershipConsolidation,
  isApplyingMembershipConsolidation,
  shareLinks,
  shareLinkDraft,
  shareLinkNotice,
  revealedShareLinks,
  shareLinkActionErrors,
  revealingShareLinkId,
  copiedShareLinkId,
  isCreatingShareLink,
  onCampaignDraftChange,
  onSelectedCampaignTemplateIdChange,
  onSaveCampaign,
  onCancelCampaignForm,
  onMembershipConsolidationDraftChange,
  onPreviewMembershipConsolidation,
  onApplyMembershipConsolidation,
  onShareLinkDraftChange,
  onCreateShareLink,
  onRevealShareLink,
  onToggleShareLinkVisibility,
  onCopyShareLink,
  onRevokeShareLink,
  onRegisterDraftChange,
  onLoginDraftChange,
  onToggleRegisterMode,
  onLinkSharedMembership,
}: CampaignAdminPaneProps) {
  const selectedCampaignTemplate = getCampaignStarterTemplate(selectedCampaignTemplateId)

  return (
    <>
      {!isSharedMode && owner?.isSiteAdmin && authToken ? (
        <AdminPage authToken={authToken} surfaceRadius={surfaceRadius} />
      ) : null}

      {isSharedMode && resolvedMembership?.userId === null ? (
        <Card sx={{ borderRadius: surfaceRadius }}>
          <CardContent sx={{ p: 3 }}>
            <Stack spacing={2.5}>
              <Box>
                <Typography variant="h5">Link this guest membership</Typography>
                <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                  {isKeycloakMode
                    ? 'Sign in with your tenant account to attach this guest history to a real account. The claim still has to happen from the same browser session that joined the campaign.'
                    : 'Create or connect a real account without changing the membership that already owns your shared note history. For this first release, the claim must happen from the same browser that joined the campaign.'}
                </Typography>
              </Box>

              {accountNotice ? (
                <Alert severity="success" sx={{ borderRadius: surfaceRadius }}>
                  {accountNotice}
                </Alert>
              ) : null}

              {!isKeycloakMode && isRegisterMode ? (
                <TextField
                  label="Account display name"
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
                <Button variant="contained" onClick={onLinkSharedMembership} disabled={isLinkingAccount}>
                  {isLinkingAccount
                    ? isKeycloakMode
                      ? 'Signing in…'
                      : isRegisterMode
                        ? 'Creating and linking…'
                        : 'Linking account…'
                    : isKeycloakMode
                      ? authToken
                        ? 'Link this guest membership'
                        : 'Sign in to link'
                      : isRegisterMode
                        ? 'Create and link account'
                        : 'Sign in and link account'}
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
      ) : !isSharedMode && campaignFormMode !== 'closed' ? (
        <Card sx={{ borderRadius: surfaceRadius }}>
          <CardContent sx={{ p: 3 }}>
            <Stack spacing={2.5}>
              <Box>
                <Typography variant="h5">
                  {campaignFormMode === 'create'
                    ? 'Create campaign'
                    : 'Edit campaign settings'}
                </Typography>
                <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                  {campaignFormMode === 'create'
                    ? 'Set up a campaign shell before you invite anyone else in.'
                    : 'Update campaign metadata and review the owner-side membership list.'}
                </Typography>
              </Box>

              {campaignFormMode === 'create' ? (
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
              ) : null}

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
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                <TextField
                  fullWidth
                  label="System"
                  value={campaignDraft.system}
                  onChange={(event) =>
                    onCampaignDraftChange('system', event.target.value)
                  }
                />
                <TextField
                  fullWidth
                  label="Setting"
                  value={campaignDraft.setting}
                  onChange={(event) =>
                    onCampaignDraftChange('setting', event.target.value)
                  }
                />
              </Stack>
              <TextField
                label="Next session"
                value={campaignDraft.nextSession}
                onChange={(event) =>
                  onCampaignDraftChange('nextSession', event.target.value)
                }
                helperText="Optional. Use an ISO timestamp or plain text date."
              />

              {campaignFormMode === 'edit' ? (
                <Stack spacing={2.5}>
                  <Box>
                    <Typography variant="subtitle1">Current memberships</Typography>
                    <Stack
                      direction="row"
                      spacing={1}
                      useFlexGap
                      sx={{ mt: 1, flexWrap: 'wrap' }}
                    >
                      {currentCampaignMemberships.map((membership) => (
                        <Chip
                          key={membership.id}
                          label={`${membership.displayName} (${membership.role === 'guest' && membership.userId !== null ? 'linked collaborator' : membership.role})`}
                          color={membership.role === 'owner' ? 'secondary' : membership.userId !== null ? 'primary' : 'default'}
                        />
                      ))}
                    </Stack>
                  </Box>

                  <Box>
                    <Typography variant="subtitle1">
                      Consolidate note authorship
                    </Typography>
                    <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                      Reassign note authorship and edit attribution from one
                      membership onto another without changing note text or
                      deleting memberships.
                    </Typography>
                  </Box>

                  {currentCampaignMemberships.length < 2 ? (
                    <Typography color="text.secondary">
                      Add or link another membership before consolidating note
                      attribution.
                    </Typography>
                  ) : (
                    <Stack spacing={2}>
                      <Stack
                        direction={{ xs: 'column', md: 'row' }}
                        spacing={2}
                      >
                        <TextField
                          select
                          fullWidth
                          label="Source membership"
                          value={membershipConsolidationDraft.sourceMembershipId}
                          onChange={(event) =>
                            onMembershipConsolidationDraftChange(
                              'sourceMembershipId',
                              event.target.value,
                            )
                          }
                          helperText="Move note attribution away from this membership."
                        >
                          {currentCampaignMemberships.map((membership) => (
                            <MenuItem key={membership.id} value={membership.id}>
                              {describeCampaignMembership(membership)}
                            </MenuItem>
                          ))}
                        </TextField>
                        <TextField
                          select
                          fullWidth
                          label="Target membership"
                          value={membershipConsolidationDraft.targetMembershipId}
                          onChange={(event) =>
                            onMembershipConsolidationDraftChange(
                              'targetMembershipId',
                              event.target.value,
                            )
                          }
                          helperText="This membership keeps the note attribution."
                        >
                          {currentCampaignMemberships.map((membership) => (
                            <MenuItem
                              key={membership.id}
                              value={membership.id}
                              disabled={
                                membership.id ===
                                membershipConsolidationDraft.sourceMembershipId
                              }
                            >
                              {describeCampaignMembership(membership)}
                            </MenuItem>
                          ))}
                        </TextField>
                      </Stack>

                      {selectedSourceMembership && selectedTargetMembership ? (
                        <Typography color="text.secondary" variant="body2">
                          Previewing moves note attribution from{' '}
                          {selectedSourceMembership.displayName} to{' '}
                          {selectedTargetMembership.displayName}.
                        </Typography>
                      ) : null}

                      <Stack
                        direction={{ xs: 'column', sm: 'row' }}
                        spacing={1.5}
                      >
                        <Button
                          variant="outlined"
                          onClick={onPreviewMembershipConsolidation}
                          disabled={
                            !hasValidMembershipConsolidationSelection ||
                            isPreviewingMembershipConsolidation ||
                            isApplyingMembershipConsolidation
                          }
                        >
                          {isPreviewingMembershipConsolidation
                            ? 'Previewing consolidation…'
                            : 'Preview consolidation'}
                        </Button>
                        <Button
                          variant="contained"
                          onClick={onApplyMembershipConsolidation}
                          disabled={
                            !canApplyMembershipConsolidation ||
                            isPreviewingMembershipConsolidation ||
                            isApplyingMembershipConsolidation
                          }
                        >
                          {isApplyingMembershipConsolidation
                            ? 'Applying consolidation…'
                            : 'Apply consolidation'}
                        </Button>
                      </Stack>

                      {membershipConsolidationPreview ? (
                        <Alert
                          severity={
                            membershipConsolidationPreview.applied
                              ? 'success'
                              : membershipConsolidationPreview.requiresRoleMismatchConfirmation
                                ? 'warning'
                                : 'info'
                          }
                          sx={{ borderRadius: surfaceRadius }}
                        >
                          <Stack spacing={1}>
                            <Typography variant="subtitle2">
                              {membershipConsolidationPreview.applied
                                ? 'Consolidation applied'
                                : 'Consolidation preview'}
                            </Typography>
                            <Typography variant="body2">
                              {describeCampaignMembership(
                                membershipConsolidationPreview.sourceMembership,
                              )}{' '}
                              {'->'}
                              {' '}
                              {describeCampaignMembership(
                                membershipConsolidationPreview.targetMembership,
                              )}
                            </Typography>
                            <Typography variant="body2">
                              Affected notes:{' '}
                              {
                                membershipConsolidationPreview.noteChanges
                                  .affectedNoteCount
                              }
                              . Authored:{' '}
                              {
                                membershipConsolidationPreview.noteChanges
                                  .authoredNoteCount
                              }
                              . Edited:{' '}
                              {
                                membershipConsolidationPreview.noteChanges
                                  .editedNoteCount
                              }
                              . Authored and edited:{' '}
                              {
                                membershipConsolidationPreview.noteChanges
                                  .authoredAndEditedNoteCount
                              }
                              .
                            </Typography>
                            {membershipConsolidationPreview.warnings.length > 0 ? (
                              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                                {membershipConsolidationPreview.warnings.map(
                                  (warning) => (
                                    <Typography
                                      component="li"
                                      key={warning}
                                      variant="body2"
                                    >
                                      {warning}
                                    </Typography>
                                  ),
                                )}
                              </Box>
                            ) : null}
                            {membershipConsolidationPreview.requiresRoleMismatchConfirmation ? (
                              <FormControlLabel
                                control={
                                  <Checkbox
                                    checked={
                                      membershipConsolidationDraft.confirmRoleMismatch
                                    }
                                    onChange={(event) =>
                                      onMembershipConsolidationDraftChange(
                                        'confirmRoleMismatch',
                                        event.target.checked,
                                      )
                                    }
                                  />
                                }
                                label={`I understand this moves ${membershipConsolidationPreview.sourceMembership.role} note attribution onto ${membershipConsolidationPreview.targetMembership.role}.`}
                              />
                            ) : null}
                          </Stack>
                        </Alert>
                      ) : null}

                      {membershipConsolidationNotice ? (
                        <Alert severity="success" sx={{ borderRadius: surfaceRadius }}>
                          {membershipConsolidationNotice}
                        </Alert>
                      ) : null}
                    </Stack>
                  )}

                  <Box>
                    <Typography variant="subtitle1">Shared links</Typography>
                    <Typography color="text.secondary" sx={{ mt: 0.75 }}>
                      Only the shared route can be embedded. Use frame ancestors to allow
                      specific VTT hosts or leave it blank to block embedding.
                    </Typography>
                  </Box>

                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                    <TextField
                      fullWidth
                      label="Link label"
                      value={shareLinkDraft.label}
                      onChange={(event) =>
                        onShareLinkDraftChange('label', event.target.value)
                      }
                      helperText="Optional. Use this to remember where the link is shared."
                    />
                    <TextField
                      select
                      label="Access"
                      value={shareLinkDraft.accessLevel}
                      onChange={(event) =>
                        onShareLinkDraftChange(
                          'accessLevel',
                          event.target.value as CampaignShareLink['accessLevel'],
                        )
                      }
                      sx={{ minWidth: { md: 180 } }}
                    >
                      <MenuItem value="editor">Editor</MenuItem>
                      <MenuItem value="viewer">Viewer</MenuItem>
                    </TextField>
                  </Stack>

                  <TextField
                    label="Allowed frame ancestors"
                    value={shareLinkDraft.frameAncestors}
                    onChange={(event) =>
                      onShareLinkDraftChange('frameAncestors', event.target.value)
                    }
                    helperText="Optional. Use 'self', 'none', or space-separated origins such as https://app.roll20.net."
                  />

                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                    <Button
                      variant="outlined"
                      onClick={onCreateShareLink}
                      disabled={isCreatingShareLink}
                    >
                      {isCreatingShareLink ? 'Creating link…' : 'Create shared link'}
                    </Button>
                  </Stack>

                  {shareLinkNotice ? (
                    <Alert severity="success" sx={{ borderRadius: surfaceRadius }}>
                      {shareLinkNotice}
                    </Alert>
                  ) : null}

                  {shareLinks.length === 0 ? (
                    <Typography color="text.secondary">
                      No active shared links yet.
                    </Typography>
                  ) : (
                    <Stack spacing={1.5}>
                      {shareLinks.map((shareLink) => {
                        const revealedShareLink = revealedShareLinks[shareLink.id]
                        const shareLinkError = shareLinkActionErrors[shareLink.id]
                        const isRevealingShareLink =
                          revealingShareLinkId === shareLink.id
                        const shareLinkLabel =
                          shareLink.label?.trim()
                            ? shareLink.label
                            : 'Untitled shared link'

                        return (
                          <Box
                            component="section"
                            key={shareLink.id}
                            aria-label={`${shareLinkLabel} shared link`}
                            sx={{
                              border: '1px solid',
                              borderColor: cardBorderColor,
                              borderRadius: noteItemRadius,
                              px: 2,
                              py: 1.75,
                            }}
                          >
                            <Stack
                              direction={{ xs: 'column', md: 'row' }}
                              spacing={2}
                              sx={{ justifyContent: 'space-between' }}
                            >
                              <Stack spacing={1.25} sx={{ flexGrow: 1 }}>
                                <Box>
                                  <Typography variant="subtitle1">{shareLinkLabel}</Typography>
                                  <Typography color="text.secondary" variant="body2">
                                    {shareLink.accessLevel === 'editor'
                                      ? 'Editors can view and update notes.'
                                      : 'Viewers can open the shared route without editing.'}
                                  </Typography>
                                  <Typography
                                    color="text.secondary"
                                    variant="body2"
                                    sx={{ mt: 0.5 }}
                                  >
                                    Frame ancestors:{' '}
                                    {shareLink.frameAncestors ?? 'Not embeddable'}
                                  </Typography>
                                </Box>

                                {revealedShareLink ? (
                                  <Box
                                    sx={{
                                      border: '1px solid',
                                      borderColor: cardBorderColor,
                                      borderRadius: 2,
                                      px: 1.5,
                                      py: 1.25,
                                      backgroundColor: 'background.default',
                                    }}
                                  >
                                    <Typography color="text.secondary" variant="caption">
                                      Reusable share URL
                                    </Typography>
                                    <Typography
                                      component="p"
                                      variant="body2"
                                      sx={{
                                        mt: 0.75,
                                        fontFamily: "'Geist Mono', ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace",
                                        wordBreak: 'break-all',
                                        filter: revealedShareLink.isVisible
                                          ? 'none'
                                          : 'blur(6px)',
                                        transition: 'filter 120ms ease',
                                        userSelect: revealedShareLink.isVisible
                                          ? 'text'
                                          : 'none',
                                      }}
                                    >
                                      {revealedShareLink.url}
                                    </Typography>
                                  </Box>
                                ) : (
                                  <Typography color="text.secondary" variant="body2">
                                    URL hidden until you reveal it on this card.
                                  </Typography>
                                )}

                                {shareLinkError ? (
                                  <Alert
                                    severity="warning"
                                    sx={{ borderRadius: surfaceRadius }}
                                  >
                                    {shareLinkError}
                                  </Alert>
                                ) : null}
                              </Stack>

                              <Stack
                                direction={{ xs: 'column', sm: 'row', md: 'column' }}
                                spacing={1}
                                sx={{ alignItems: { md: 'flex-end' } }}
                              >
                                {revealedShareLink ? (
                                  <>
                                    <Button
                                      variant="outlined"
                                      onClick={() =>
                                        onToggleShareLinkVisibility(shareLink.id)
                                      }
                                    >
                                      {revealedShareLink.isVisible
                                        ? 'Hide link'
                                        : 'Show link'}
                                    </Button>
                                    <Button
                                      variant="outlined"
                                      onClick={() =>
                                        onCopyShareLink(shareLink.id)
                                      }
                                    >
                                      {copiedShareLinkId === shareLink.id
                                        ? 'Copied'
                                        : 'Copy link'}
                                    </Button>
                                  </>
                                ) : (
                                  <Button
                                    variant="outlined"
                                    onClick={() =>
                                      onRevealShareLink(shareLink.id)
                                    }
                                    disabled={isRevealingShareLink}
                                  >
                                    {isRevealingShareLink
                                      ? 'Revealing link…'
                                      : 'Reveal link'}
                                  </Button>
                                )}
                                <Button
                                  color="error"
                                  variant="text"
                                  onClick={() => onRevokeShareLink(shareLink.id)}
                                >
                                  Revoke link
                                </Button>
                              </Stack>
                            </Stack>
                          </Box>
                        )
                      })}
                    </Stack>
                  )}
                </Stack>
              ) : null}

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                <Button
                  variant="contained"
                  startIcon={<SaveRoundedIcon />}
                  onClick={onSaveCampaign}
                  disabled={isSavingCampaign}
                >
                  {isSavingCampaign
                    ? campaignFormMode === 'create'
                      ? 'Creating campaign…'
                      : 'Saving settings…'
                    : campaignFormMode === 'create'
                      ? 'Create campaign'
                      : 'Save campaign settings'}
                </Button>
                <Button variant="text" onClick={onCancelCampaignForm}>
                  Cancel
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      ) : null}
    </>
  )
}

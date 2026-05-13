import { useCallback, useState } from 'react'
import {
  consolidateCampaignMemberships,
  createCampaign,
  createNote,
  updateCampaign,
} from '../api'
import {
  blankCampaignTemplateId,
  blankNoteTemplateId,
  campaignStarterTemplates,
  createStarterNoteInput,
  getCampaignStarterTemplate,
} from '../templates'
import type {
  CampaignInput,
  CampaignMembership,
  CampaignSummary,
  MembershipConsolidationSummary,
} from '../types'

export type CampaignFormMode = 'closed' | 'create' | 'edit'

export interface CampaignDraft {
  name: string
  tagline: string
  system: string
  setting: string
  nextSession: string
}

export interface MembershipConsolidationDraft {
  sourceMembershipId: string
  targetMembershipId: string
  confirmRoleMismatch: boolean
}

export { blankCampaignTemplateId, blankNoteTemplateId, campaignStarterTemplates, getCampaignStarterTemplate }
export const selectedCampaignStorageKey = 'dnd-notes:selected-campaign-id'

export function createCampaignDraft(campaign?: CampaignSummary | null): CampaignDraft {
  if (!campaign) {
    return {
      name: '',
      tagline: '',
      system: '',
      setting: '',
      nextSession: '',
    }
  }

  return {
    name: campaign.name,
    tagline: campaign.tagline,
    system: campaign.system,
    setting: campaign.setting,
    nextSession: campaign.nextSession ?? '',
  }
}

function createCampaignPayload(draft: CampaignDraft): CampaignInput {
  const trimToNull = (value: string): string | null => {
    const trimmedValue = value.trim()
    return trimmedValue === '' ? null : trimmedValue
  }

  return {
    name: draft.name,
    tagline: draft.tagline,
    system: draft.system,
    setting: draft.setting,
    nextSession: trimToNull(draft.nextSession),
  }
}

export function createMembershipConsolidationDraft(): MembershipConsolidationDraft {
  return {
    sourceMembershipId: '',
    targetMembershipId: '',
    confirmRoleMismatch: false,
  }
}

function createMembershipConsolidationDraftDefault(): MembershipConsolidationDraft {
  return {
    sourceMembershipId: '',
    targetMembershipId: '',
    confirmRoleMismatch: false,
  }
}

export function describeCampaignMembership(membership: CampaignMembership): string {
  const roleLabel =
    membership.role === 'guest' && membership.userId !== null
      ? 'linked collaborator'
      : membership.role

  return `${membership.displayName} (${roleLabel})`
}

export interface UseCampaignResult {
  campaigns: CampaignSummary[]
  selectedCampaignId: string | null
  memberships: CampaignMembership[]
  campaignDraft: CampaignDraft
  campaignFormMode: CampaignFormMode
  selectedCampaignTemplateId: string
  isSavingCampaign: boolean
  membershipConsolidationDraft: MembershipConsolidationDraft
  membershipConsolidationPreview: MembershipConsolidationSummary | null
  membershipConsolidationNotice: string | null
  isPreviewingMembershipConsolidation: boolean
  isApplyingMembershipConsolidation: boolean
  setCampaigns: React.Dispatch<React.SetStateAction<CampaignSummary[]>>
  setSelectedCampaignId: React.Dispatch<React.SetStateAction<string | null>>
  setMemberships: React.Dispatch<React.SetStateAction<CampaignMembership[]>>
  setCampaignDraft: React.Dispatch<React.SetStateAction<CampaignDraft>>
  setCampaignFormMode: React.Dispatch<React.SetStateAction<CampaignFormMode>>
  setSelectedCampaignTemplateId: React.Dispatch<React.SetStateAction<string>>
  setMembershipConsolidationDraft: React.Dispatch<React.SetStateAction<MembershipConsolidationDraft>>
  setMembershipConsolidationPreview: React.Dispatch<React.SetStateAction<MembershipConsolidationSummary | null>>
  setMembershipConsolidationNotice: React.Dispatch<React.SetStateAction<string | null>>
  resetMembershipConsolidationState: () => void
  handleCampaignDraftChange: <Field extends keyof CampaignDraft>(
    field: Field,
    value: CampaignDraft[Field],
  ) => void
  handleMembershipConsolidationDraftChange: <Field extends keyof MembershipConsolidationDraft>(
    field: Field,
    value: MembershipConsolidationDraft[Field],
  ) => void
  handleOpenCampaignCreate: (
    selectedCampaign: CampaignSummary | null,
    onResetShareLinks: () => void,
    onError: (message: string | null) => void,
  ) => void
  handleOpenCampaignSettings: (
    selectedCampaign: CampaignSummary | null,
    canManage: boolean,
    onResetShareLinks: () => void,
    onError: (message: string | null) => void,
  ) => void
  handleCancelCampaignForm: (
    selectedCampaign: CampaignSummary | null,
    onResetShareLinks: () => void,
    onError: (message: string | null) => void,
  ) => void
  handleSaveCampaign: (
    authToken: string,
    onLoadCampaigns: (token: string, preferredCampaignId?: string | null) => Promise<void>,
    onError: (message: string | null) => void,
  ) => Promise<void>
  handlePreviewMembershipConsolidation: (
    authToken: string,
    selectedCampaignId: string,
    onError: (message: string | null) => void,
  ) => Promise<void>
  handleApplyMembershipConsolidation: (
    authToken: string,
    selectedCampaignId: string,
    onLoadWorkspace: (token: string, campaignId: string, preferredNoteId: string | null, suppressError?: boolean) => Promise<boolean>,
    selectedNoteId: string | null,
    onError: (message: string | null) => void,
  ) => Promise<void>
}

export function useCampaign(): UseCampaignResult {
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([])
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null)
  const [memberships, setMemberships] = useState<CampaignMembership[]>([])
  const [campaignDraft, setCampaignDraft] = useState<CampaignDraft>(createCampaignDraft)
  const [campaignFormMode, setCampaignFormMode] = useState<CampaignFormMode>('closed')
  const [selectedCampaignTemplateId, setSelectedCampaignTemplateId] = useState(
    blankCampaignTemplateId,
  )
  const [isSavingCampaign, setIsSavingCampaign] = useState(false)
  const [membershipConsolidationDraft, setMembershipConsolidationDraft] =
    useState<MembershipConsolidationDraft>(createMembershipConsolidationDraftDefault)
  const [membershipConsolidationPreview, setMembershipConsolidationPreview] =
    useState<MembershipConsolidationSummary | null>(null)
  const [membershipConsolidationNotice, setMembershipConsolidationNotice] = useState<
    string | null
  >(null)
  const [isPreviewingMembershipConsolidation, setIsPreviewingMembershipConsolidation] =
    useState(false)
  const [isApplyingMembershipConsolidation, setIsApplyingMembershipConsolidation] =
    useState(false)

  const resetMembershipConsolidationState = useCallback(() => {
    setMembershipConsolidationDraft(createMembershipConsolidationDraftDefault())
    setMembershipConsolidationPreview(null)
    setMembershipConsolidationNotice(null)
    setIsPreviewingMembershipConsolidation(false)
    setIsApplyingMembershipConsolidation(false)
  }, [])

  const handleCampaignDraftChange = useCallback(
    <Field extends keyof CampaignDraft>(field: Field, value: CampaignDraft[Field]) => {
      setCampaignDraft((currentDraft) => ({
        ...currentDraft,
        [field]: value,
      }))
    },
    [],
  )

  const handleMembershipConsolidationDraftChange = useCallback(
    <Field extends keyof MembershipConsolidationDraft>(
      field: Field,
      value: MembershipConsolidationDraft[Field],
    ) => {
      setMembershipConsolidationDraft((currentDraft) => ({
        ...currentDraft,
        [field]: value,
        ...(field === 'confirmRoleMismatch' ? {} : { confirmRoleMismatch: false }),
      }))

      if (field !== 'confirmRoleMismatch') {
        setMembershipConsolidationPreview(null)
        setMembershipConsolidationNotice(null)
      }
    },
    [],
  )

  const handleOpenCampaignCreate = useCallback(
    (
      selectedCampaign: CampaignSummary | null,
      onResetShareLinks: () => void,
      onError: (message: string | null) => void,
    ) => {
      void selectedCampaign
      setCampaignDraft(createCampaignDraft())
      setSelectedCampaignTemplateId(blankCampaignTemplateId)
      setMemberships([])
      onResetShareLinks()
      resetMembershipConsolidationState()
      setCampaignFormMode('create')
      onError(null)
    },
    [resetMembershipConsolidationState],
  )

  const handleOpenCampaignSettings = useCallback(
    (
      selectedCampaign: CampaignSummary | null,
      canManage: boolean,
      onResetShareLinks: () => void,
      onError: (message: string | null) => void,
    ) => {
      if (!canManage) {
        onError('Campaign settings are only available to campaign owners.')
        return
      }

      setCampaignDraft(createCampaignDraft(selectedCampaign))
      setSelectedCampaignTemplateId(blankCampaignTemplateId)
      onResetShareLinks()
      resetMembershipConsolidationState()
      setCampaignFormMode('edit')
      onError(null)
    },
    [resetMembershipConsolidationState],
  )

  const handleCancelCampaignForm = useCallback(
    (
      selectedCampaign: CampaignSummary | null,
      onResetShareLinks: () => void,
      onError: (message: string | null) => void,
    ) => {
      setCampaignDraft(createCampaignDraft(selectedCampaign))
      setCampaignFormMode(campaigns.length === 0 ? 'create' : 'closed')
      setSelectedCampaignTemplateId(blankCampaignTemplateId)
      onResetShareLinks()
      resetMembershipConsolidationState()
      onError(null)
    },
    [campaigns.length, resetMembershipConsolidationState],
  )

  const handleSaveCampaign = useCallback(
    async (
      authToken: string,
      onLoadCampaigns: (token: string, preferredCampaignId?: string | null) => Promise<void>,
      onError: (message: string | null) => void,
    ): Promise<void> => {
      onError(null)
      setIsSavingCampaign(true)

      try {
        const payload = createCampaignPayload(campaignDraft)
        let starterTemplateError: string | null = null
        const selectedTemplate = getCampaignStarterTemplate(selectedCampaignTemplateId)

        if (campaignFormMode === 'create') {
          const createdCampaign = await createCampaign(authToken, payload)

          if (selectedCampaignTemplateId !== blankCampaignTemplateId) {
            try {
              for (const starterNote of selectedTemplate.starterNotes) {
                await createNote(
                  authToken,
                  createStarterNoteInput(starterNote, createdCampaign.id),
                )
              }
            } catch {
              starterTemplateError =
                'Campaign created, but the starter notes could not be added. You can still add notes manually.'
            }
          }

          await onLoadCampaigns(authToken, createdCampaign.id)
        } else if (campaignFormMode === 'edit' && selectedCampaignId) {
          const updatedCampaign = await updateCampaign(authToken, selectedCampaignId, payload)
          await onLoadCampaigns(authToken, updatedCampaign.id)
        }

        setCampaignFormMode('closed')
        setSelectedCampaignTemplateId(blankCampaignTemplateId)

        if (starterTemplateError) {
          onError(starterTemplateError)
        }
      } catch (campaignError) {
        onError(
          campaignError instanceof Error
            ? campaignError.message
            : 'Could not save the campaign.',
        )
      } finally {
        setIsSavingCampaign(false)
      }
    },
    [campaignDraft, campaignFormMode, selectedCampaignId, selectedCampaignTemplateId],
  )

  const handlePreviewMembershipConsolidation = useCallback(
    async (
      authToken: string,
      campaignId: string,
      onError: (message: string | null) => void,
    ): Promise<void> => {
      if (
        !membershipConsolidationDraft.sourceMembershipId ||
        !membershipConsolidationDraft.targetMembershipId ||
        membershipConsolidationDraft.sourceMembershipId ===
          membershipConsolidationDraft.targetMembershipId
      ) {
        return
      }

      onError(null)
      setMembershipConsolidationNotice(null)
      setIsPreviewingMembershipConsolidation(true)

      try {
        const response = await consolidateCampaignMemberships(authToken, campaignId, {
          sourceMembershipId: membershipConsolidationDraft.sourceMembershipId,
          targetMembershipId: membershipConsolidationDraft.targetMembershipId,
        })

        setMembershipConsolidationPreview(response.consolidation)
      } catch (consolidationError) {
        onError(
          consolidationError instanceof Error
            ? consolidationError.message
            : 'Could not preview the consolidation.',
        )
      } finally {
        setIsPreviewingMembershipConsolidation(false)
      }
    },
    [
      membershipConsolidationDraft.sourceMembershipId,
      membershipConsolidationDraft.targetMembershipId,
    ],
  )

  const handleApplyMembershipConsolidation = useCallback(
    async (
      authToken: string,
      campaignId: string,
      onLoadWorkspace: (token: string, campaignId: string, preferredNoteId: string | null, suppressError?: boolean) => Promise<boolean>,
      selectedNoteId: string | null,
      onError: (message: string | null) => void,
    ): Promise<void> => {
      if (!membershipConsolidationPreview || membershipConsolidationPreview.applied) {
        return
      }

      onError(null)
      setMembershipConsolidationNotice(null)
      setIsApplyingMembershipConsolidation(true)

      let response: Awaited<ReturnType<typeof consolidateCampaignMemberships>>

      try {
        response = await consolidateCampaignMemberships(authToken, campaignId, {
          sourceMembershipId: membershipConsolidationDraft.sourceMembershipId,
          targetMembershipId: membershipConsolidationDraft.targetMembershipId,
          confirm: true,
          confirmRoleMismatch: membershipConsolidationDraft.confirmRoleMismatch,
        })

        setMembershipConsolidationPreview(response.consolidation)
        setMembershipConsolidationNotice(
          `Moved note attribution from ${response.consolidation.sourceMembership.displayName} to ${response.consolidation.targetMembership.displayName}.`,
        )
      } catch (consolidationError) {
        onError(
          consolidationError instanceof Error
            ? consolidationError.message
            : 'Could not apply the consolidation.',
        )
        setIsApplyingMembershipConsolidation(false)
        return
      }

      const refreshed = await onLoadWorkspace(authToken, campaignId, selectedNoteId, true)

      if (!refreshed) {
        onError(
          'Consolidation succeeded, but the workspace could not refresh. Reload the page to see the latest note attribution.',
        )
      }

      setIsApplyingMembershipConsolidation(false)
    },
    [
      membershipConsolidationDraft.confirmRoleMismatch,
      membershipConsolidationDraft.sourceMembershipId,
      membershipConsolidationDraft.targetMembershipId,
      membershipConsolidationPreview,
    ],
  )

  return {
    campaigns,
    selectedCampaignId,
    memberships,
    campaignDraft,
    campaignFormMode,
    selectedCampaignTemplateId,
    isSavingCampaign,
    membershipConsolidationDraft,
    membershipConsolidationPreview,
    membershipConsolidationNotice,
    isPreviewingMembershipConsolidation,
    isApplyingMembershipConsolidation,
    setCampaigns,
    setSelectedCampaignId,
    setMemberships,
    setCampaignDraft,
    setCampaignFormMode,
    setSelectedCampaignTemplateId,
    setMembershipConsolidationDraft,
    setMembershipConsolidationPreview,
    setMembershipConsolidationNotice,
    resetMembershipConsolidationState,
    handleCampaignDraftChange,
    handleMembershipConsolidationDraftChange,
    handleOpenCampaignCreate,
    handleOpenCampaignSettings,
    handleCancelCampaignForm,
    handleSaveCampaign,
    handlePreviewMembershipConsolidation,
    handleApplyMembershipConsolidation,
  }
}

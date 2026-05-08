import type { Express, Request, Response } from 'express'
import type {
  CampaignMembershipsResponse,
  CampaignResponse,
  CampaignShareLinkCreateResponse,
  CampaignShareLinkRevealResponse,
  CampaignShareLinksResponse,
  CampaignsResponse,
  ErrorResponse,
  MembershipConsolidationResponse,
  SessionsResponse,
} from '../types.js'
import { createReadLimiter, createWriteLimiter } from '../rate-limiters.js'
import {
  type AppRouteContext,
  type CampaignParams,
  type ShareLinkParams,
  buildSessions,
  buildSharedUrl,
  requireAuthenticatedAccount,
  resolveAccessibleCampaign,
  resolveOwnedCampaign,
} from '../route-support.js'
import {
  validateCampaignInput,
  validateCampaignShareLinkInput,
  validateMembershipConsolidationInput,
} from '../validation.js'

export function registerOwnerCampaignRoutes(app: Express, context: AppRouteContext) {
  const readLimiter = createReadLimiter()
  const writeLimiter = createWriteLimiter()

  app.get(
    '/api/campaigns',
    readLimiter,
    async (
      request: Request,
      response: Response<CampaignsResponse | ErrorResponse>,
    ) => {
      const noteStore = context.getNoteStore()
      const owner = await requireAuthenticatedAccount(noteStore, request, response, context.runtimeAuth)

      if (!owner) {
        return
      }

      response.json({ campaigns: await noteStore.listUserCampaigns(owner.id) })
    },
  )

  app.post(
    '/api/campaigns',
    writeLimiter,
    async (
      request: Request,
      response: Response<CampaignResponse | ErrorResponse>,
    ) => {
      const noteStore = context.getNoteStore()
      const owner = await requireAuthenticatedAccount(noteStore, request, response, context.runtimeAuth)

      if (!owner) {
        return
      }

      const validation = validateCampaignInput(request.body)

      if (!validation.success) {
        response.status(400).json({
          error: 'Campaign payload is invalid.',
          details: validation.errors,
        })
        return
      }

      const campaign = await noteStore.createCampaign(validation.data, owner)
      response.status(201).json({ campaign })
    },
  )

  app.get(
    '/api/campaigns/:campaignId',
    readLimiter,
    async (
      request: Request<CampaignParams>,
      response: Response<CampaignResponse | ErrorResponse>,
    ) => {
      const noteStore = context.getNoteStore()
      const owner = await requireAuthenticatedAccount(noteStore, request, response, context.runtimeAuth)

      if (!owner) {
        return
      }

      const campaign = await resolveAccessibleCampaign(
        noteStore,
        owner,
        request.params.campaignId,
        response,
      )

      if (!campaign) {
        return
      }

      response.json({ campaign })
    },
  )

  app.get(
    '/api/campaigns/:campaignId/sessions',
    readLimiter,
    async (
      request: Request<CampaignParams>,
      response: Response<SessionsResponse | ErrorResponse>,
    ) => {
      const noteStore = context.getNoteStore()
      const owner = await requireAuthenticatedAccount(noteStore, request, response, context.runtimeAuth)

      if (!owner) {
        return
      }

      const campaign = await resolveAccessibleCampaign(
        noteStore,
        owner,
        request.params.campaignId,
        response,
      )

      if (!campaign) {
        return
      }

      response.json({ sessions: await buildSessions(noteStore, campaign.id) })
    },
  )

  app.put(
    '/api/campaigns/:campaignId',
    writeLimiter,
    async (
      request: Request<CampaignParams>,
      response: Response<CampaignResponse | ErrorResponse>,
    ) => {
      const noteStore = context.getNoteStore()
      const owner = await requireAuthenticatedAccount(noteStore, request, response, context.runtimeAuth)

      if (!owner) {
        return
      }

      const campaign = await resolveOwnedCampaign(
        noteStore,
        owner,
        request.params.campaignId,
        response,
      )

      if (!campaign) {
        return
      }

      const validation = validateCampaignInput(request.body)

      if (!validation.success) {
        response.status(400).json({
          error: 'Campaign payload is invalid.',
          details: validation.errors,
        })
        return
      }

      const updatedCampaign = await noteStore.updateCampaign(
        campaign.id,
        validation.data,
        owner.id,
      )

      if (!updatedCampaign) {
        response.status(404).json({ error: `Campaign "${campaign.id}" was not found.` })
        return
      }

      response.json({ campaign: updatedCampaign })
    },
  )

  app.get(
    '/api/campaigns/:campaignId/memberships',
    readLimiter,
    async (
      request: Request<CampaignParams>,
      response: Response<CampaignMembershipsResponse | ErrorResponse>,
    ) => {
      const noteStore = context.getNoteStore()
      const owner = await requireAuthenticatedAccount(noteStore, request, response, context.runtimeAuth)

      if (!owner) {
        return
      }

      const campaign = await resolveOwnedCampaign(
        noteStore,
        owner,
        request.params.campaignId,
        response,
      )

      if (!campaign) {
        return
      }

      response.json({
        memberships: await noteStore.listCampaignMemberships(campaign.id),
      })
    },
  )

  app.post(
    '/api/campaigns/:campaignId/memberships/consolidations',
    writeLimiter,
    async (
      request: Request<CampaignParams>,
      response: Response<MembershipConsolidationResponse | ErrorResponse>,
    ) => {
      const noteStore = context.getNoteStore()
      const owner = await requireAuthenticatedAccount(noteStore, request, response, context.runtimeAuth)

      if (!owner) {
        return
      }

      const campaign = await resolveOwnedCampaign(
        noteStore,
        owner,
        request.params.campaignId,
        response,
      )

      if (!campaign) {
        return
      }

      const validation = validateMembershipConsolidationInput(request.body)

      if (!validation.success) {
        response.status(400).json({
          error: 'Membership consolidation payload is invalid.',
          details: validation.errors,
        })
        return
      }

      const preview = await noteStore.previewMembershipConsolidation(
        campaign.id,
        validation.data.sourceMembershipId,
        validation.data.targetMembershipId,
        owner.id,
      )

      if (preview.status === 'forbidden') {
        response.status(403).json({ error: 'You do not have access to this campaign.' })
        return
      }

      if (preview.status === 'same-membership') {
        response.status(400).json({
          error: 'Membership consolidation requires two different memberships.',
          details: ['Pick a distinct source membership and target membership.'],
        })
        return
      }

      if (preview.status === 'source-not-found') {
        response.status(404).json({ error: 'Source membership was not found in this campaign.' })
        return
      }

      if (preview.status === 'target-not-found') {
        response.status(404).json({ error: 'Target membership was not found in this campaign.' })
        return
      }

      if (!validation.data.confirm) {
        response.json({
          consolidation: {
            ...preview.consolidation,
            applied: false,
          },
        })
        return
      }

      if (
        preview.consolidation.requiresRoleMismatchConfirmation &&
        !validation.data.confirmRoleMismatch
      ) {
        response.status(409).json({
          error: 'This consolidation changes note attribution roles.',
          details: [
            `Confirm the ${preview.consolidation.sourceMembership.role}-to-${preview.consolidation.targetMembership.role} change before applying it.`,
          ],
        })
        return
      }

      const consolidation = await noteStore.consolidateMemberships(
        campaign.id,
        validation.data.sourceMembershipId,
        validation.data.targetMembershipId,
        owner.id,
      )

      if (consolidation.status === 'forbidden') {
        response.status(403).json({ error: 'You do not have access to this campaign.' })
        return
      }

      if (consolidation.status === 'same-membership') {
        response.status(400).json({
          error: 'Membership consolidation requires two different memberships.',
          details: ['Pick a distinct source membership and target membership.'],
        })
        return
      }

      if (consolidation.status === 'source-not-found') {
        response.status(404).json({ error: 'Source membership was not found in this campaign.' })
        return
      }

      if (consolidation.status === 'target-not-found') {
        response.status(404).json({ error: 'Target membership was not found in this campaign.' })
        return
      }

      response.json({ consolidation: consolidation.consolidation })
    },
  )

  app.get(
    '/api/campaigns/:campaignId/share-links',
    readLimiter,
    async (
      request: Request<CampaignParams>,
      response: Response<CampaignShareLinksResponse | ErrorResponse>,
    ) => {
      const noteStore = context.getNoteStore()
      const owner = await requireAuthenticatedAccount(noteStore, request, response, context.runtimeAuth)

      if (!owner) {
        return
      }

      const campaign = await resolveOwnedCampaign(
        noteStore,
        owner,
        request.params.campaignId,
        response,
      )

      if (!campaign) {
        return
      }

      response.json({
        shareLinks: await noteStore.listCampaignShareLinks(campaign.id),
      })
    },
  )

  app.post(
    '/api/campaigns/:campaignId/share-links',
    writeLimiter,
    async (
      request: Request<CampaignParams>,
      response: Response<CampaignShareLinkCreateResponse | ErrorResponse>,
    ) => {
      const noteStore = context.getNoteStore()
      const owner = await requireAuthenticatedAccount(noteStore, request, response, context.runtimeAuth)

      if (!owner) {
        return
      }

      const campaign = await resolveOwnedCampaign(
        noteStore,
        owner,
        request.params.campaignId,
        response,
      )

      if (!campaign) {
        return
      }

      const validation = validateCampaignShareLinkInput(request.body)

      if (!validation.success) {
        response.status(400).json({
          error: 'Share link payload is invalid.',
          details: validation.errors,
        })
        return
      }

      const created = await noteStore.createCampaignShareLink(
        campaign.id,
        validation.data,
        owner.id,
      )

      if (!created) {
        response.status(403).json({ error: 'You do not have access to this campaign.' })
        return
      }

      response.status(201).json({
        shareLink: created.shareLink,
        token: created.token,
        url: buildSharedUrl(request, created.token, context.publicWebUrl),
      })
    },
  )

  app.get(
    '/api/campaigns/:campaignId/share-links/:shareLinkId',
    readLimiter,
    async (
      request: Request<ShareLinkParams>,
      response: Response<CampaignShareLinkRevealResponse | ErrorResponse>,
    ) => {
      const noteStore = context.getNoteStore()
      const owner = await requireAuthenticatedAccount(noteStore, request, response, context.runtimeAuth)

      if (!owner) {
        return
      }

      const campaign = await resolveOwnedCampaign(
        noteStore,
        owner,
        request.params.campaignId,
        response,
      )

      if (!campaign) {
        return
      }

      const reveal = await noteStore.getCampaignShareLinkReveal(
        campaign.id,
        request.params.shareLinkId,
        owner.id,
      )

      if (!reveal) {
        response.status(404).json({ error: 'Shared link was not found.' })
        return
      }

      if (reveal.status === 'legacy-unavailable') {
        response.status(409).json({
          error: 'This shared link can no longer be revealed.',
          details: [
            'This link was created before reveal support was added, so the original token was not stored. Revoke it and create a new share link to get a revealable URL.',
          ],
        })
        return
      }

      response.json({
        token: reveal.token,
        url: buildSharedUrl(request, reveal.token, context.publicWebUrl),
      })
    },
  )

  app.delete(
    '/api/campaigns/:campaignId/share-links/:shareLinkId',
    writeLimiter,
    async (
      request: Request<ShareLinkParams>,
      response: Response<undefined | ErrorResponse>,
    ) => {
      const noteStore = context.getNoteStore()
      const owner = await requireAuthenticatedAccount(noteStore, request, response, context.runtimeAuth)

      if (!owner) {
        return
      }

      const campaign = await resolveOwnedCampaign(
        noteStore,
        owner,
        request.params.campaignId,
        response,
      )

      if (!campaign) {
        return
      }

      const revoked = await noteStore.revokeCampaignShareLink(
        campaign.id,
        request.params.shareLinkId,
        owner.id,
      )

      if (!revoked) {
        response.status(404).json({ error: 'Shared link was not found.' })
        return
      }

      response.status(204).send()
    },
  )
}

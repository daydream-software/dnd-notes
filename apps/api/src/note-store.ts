import { randomUUID } from 'node:crypto'
import { initializeNoteStoreDatabase } from './note-store-bootstrap.js'
import {
  createPostgresDatabase,
  type NoteStoreDatabase,
  type PostgresPoolLike,
} from './note-store-database.js'
import {
  createAdminDomain,
  prepareAdminStatements,
} from './note-store-admin.js'
import {
  createCampaignDomain,
  prepareCampaignStatements,
} from './note-store-campaigns.js'
import {
  createMembershipDomain,
  prepareMembershipStatements,
  type ClaimGuestMembershipResult,
  type MembershipConsolidationPreviewResult,
  type MembershipConsolidationResult,
} from './note-store-memberships.js'
import {
  composeNote,
  groupReferencesBySource,
  mapNoteReferenceRow,
  mapNoteRow,
  prepareNoteStatements,
} from './note-store-notes.js'
import type {
  NoteIdentityRow,
  NoteRecord,
  NoteReferenceRow,
  NoteRow,
  StoredNoteForReferenceSyncRow,
} from './note-store-notes.js'
import {
  createOwnerAccountDomain,
  OwnerKeycloakLinkConflictError,
  ownerKeycloakLinkConflictCode,
  prepareOwnerAccountStatements,
} from './note-store-owner-accounts.js'
import {
  createShareLinkDomain,
  prepareShareLinkStatements,
  type CampaignShareLinkRevealResult,
} from './note-store-share-links.js'
import { parseInlineNoteReferences } from './note-references.js'
import type {
  AdminAccountSummary,
  AdminOverview,
  CampaignInput,
  CampaignMembership,
  CampaignShareLink,
  CampaignShareLinkInput,
  CampaignSummary,
  KeycloakOwnerIdentity,
  Note,
  NoteAttribution,
  NoteInput,
  NoteReference,
  NoteReferenceType,
  NoteStats,
  OwnerAccount,
  OwnerRegistrationInput,
  SessionSummary,
} from './types.js'

export {
  OwnerKeycloakLinkConflictError,
  ownerKeycloakLinkConflictCode,
} from './note-store-owner-accounts.js'

interface PendingReference {
  targetNoteId: string
  referenceType: NoteReferenceType
  label: string | null
  qualifier: string | null
  positionInBody: number | null
}

export interface CreateNoteStoreOptions {
  databaseUrl?: string
  postgresPool?: PostgresPoolLike
  siteAdminEmails?: readonly string[]
}

export type RuntimeNoteStoreOptions = CreateNoteStoreOptions

function normalizeEmailAddress(email: string) {
  return email.trim().toLowerCase()
}

function resolveConfiguredSiteAdminEmails(options: CreateNoteStoreOptions) {
  const configuredEmails =
    options.siteAdminEmails ??
    process.env.SITE_ADMIN_EMAILS?.split(',').map((email) => email.trim()) ??
    []

  return new Set(
    configuredEmails
      .map((email) => normalizeEmailAddress(email))
      .filter((email) => email.length > 0),
  )
}

export interface NoteStore {
  listCampaigns(): Promise<CampaignSummary[]>
  listUserCampaigns(userId: string): Promise<CampaignSummary[]>
  listOwnedCampaigns(ownerUserId: string): Promise<CampaignSummary[]>
  getPrimaryCampaignForUser(userId: string): Promise<CampaignSummary>
  getPrimaryCampaign(ownerUserId?: string): Promise<CampaignSummary>
  getCampaign(campaignId: string): Promise<CampaignSummary | null>
  createCampaign(input: CampaignInput, owner: OwnerAccount): Promise<CampaignSummary>
  updateCampaign(
    campaignId: string,
    input: CampaignInput,
    ownerUserId?: string,
  ): Promise<CampaignSummary | null>
  listCampaignMemberships(campaignId: string): Promise<CampaignMembership[]>
  listCampaignShareLinks(campaignId: string): Promise<CampaignShareLink[]>
  userHasCampaignAccess(userId: string, campaignId: string): Promise<boolean>
  userOwnsCampaign(ownerUserId: string, campaignId: string): Promise<boolean>
  createOwnerAccount(input: OwnerRegistrationInput): Promise<OwnerAccount | null>
  authenticateOwner(email: string, password: string): Promise<OwnerAccount | null>
  getOwnerBySessionToken(token: string): Promise<OwnerAccount | null>
  findOrCreateOwnerByKeycloakIdentity(
    identity: KeycloakOwnerIdentity,
  ): Promise<OwnerAccount>
  listOwnerAccounts(): Promise<AdminAccountSummary[]>
  createOwnerSession(ownerUserId: string): Promise<string>
  deleteOwnerSession(token: string): Promise<void>
  createCampaignShareLink(
    campaignId: string,
    input: CampaignShareLinkInput,
    ownerUserId: string,
  ): Promise<{ shareLink: CampaignShareLink; token: string } | null>
  revokeCampaignShareLink(
    campaignId: string,
    shareLinkId: string,
    ownerUserId: string,
  ): Promise<boolean>
  getCampaignShareLinkReveal(
    campaignId: string,
    shareLinkId: string,
    ownerUserId: string,
  ): Promise<CampaignShareLinkRevealResult | null>
  getCampaignShareLinkByToken(token: string): Promise<CampaignShareLink | null>
  createGuestMembership(
    campaignId: string,
    displayName: string,
  ): Promise<{ membership: CampaignMembership; guestToken: string }>
  getGuestMembershipByToken(token: string): Promise<CampaignMembership | null>
  claimGuestMembership(
    membershipId: string,
    ownerUserId: string,
  ): Promise<ClaimGuestMembershipResult>
  previewMembershipConsolidation(
    campaignId: string,
    sourceMembershipId: string,
    targetMembershipId: string,
    ownerUserId: string,
  ): Promise<MembershipConsolidationPreviewResult>
  consolidateMemberships(
    campaignId: string,
    sourceMembershipId: string,
    targetMembershipId: string,
    ownerUserId: string,
  ): Promise<MembershipConsolidationResult>
  getUserMembershipForCampaign(userId: string, campaignId: string): Promise<CampaignMembership | null>
  getOwnerMembershipForCampaign(
    ownerUserId: string,
    campaignId: string,
  ): Promise<CampaignMembership | null>
  listNotes(campaignId?: string): Promise<Note[]>
  listSessionNames(campaignId?: string): Promise<SessionSummary[]>
  listRecentNotes(limit: number, campaignId?: string): Promise<Note[]>
  getSessionNotes(campaignId: string, sessionName: string): Promise<Note[]>
  getNote(noteId: string): Promise<Note | null>
  getBacklinks(noteId: string): Promise<Note[]>
  createNote(input: NoteInput, membershipId?: string): Promise<Note>
  updateNote(noteId: string, input: NoteInput, membershipId?: string): Promise<Note | null>
  deleteNote(noteId: string): Promise<boolean>
  resetNotes(inputs: NoteInput[], campaignId?: string): Promise<Note[]>
  getStats(campaignId?: string): Promise<NoteStats>
  getAdminOverview(): Promise<AdminOverview>
  checkHealth(): Promise<void>
  close(): Promise<void>
}

function resolveDatabaseUrl(
  options: CreateNoteStoreOptions,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const configuredDatabaseUrl = options.databaseUrl ?? environment.DATABASE_URL
  const trimmedDatabaseUrl = configuredDatabaseUrl?.trim()
  return trimmedDatabaseUrl && trimmedDatabaseUrl.length > 0
    ? trimmedDatabaseUrl
    : null
}

function requirePostgresDatabaseUrl(
  options: CreateNoteStoreOptions,
  databaseUrl = resolveDatabaseUrl(options),
) {
  if (!options.postgresPool && !databaseUrl) {
    throw new Error('DATABASE_URL is required unless a postgresPool is provided.')
  }

  return databaseUrl
}

export async function initializeDatabaseOrClose(
  database: Pick<NoteStoreDatabase, 'close'>,
  initialize: () => Promise<void>,
) {
  try {
    await initialize()
  } catch (error) {
    try {
      await database.close()
    } catch (closeError) {
      throw new AggregateError(
        [error, closeError],
        'Failed to initialize the note store database and close it cleanly.',
        { cause: closeError },
      )
    }

    throw error
  }
}

function createTimestampAfter(previousTimestamp: string) {
  const previousMs = new Date(previousTimestamp).getTime()
  const nextMs = Math.max(Date.now(), previousMs + 1)
  return new Date(nextMs).toISOString()
}

export async function createNoteStore(
  options: CreateNoteStoreOptions = {},
): Promise<NoteStore> {
  const databaseUrl = requirePostgresDatabaseUrl(options)
  const configuredSiteAdminEmails = resolveConfiguredSiteAdminEmails(options)
  const database = createPostgresDatabase({
    connectionString: databaseUrl ?? undefined,
    pool: options.postgresPool,
  })

  await initializeDatabaseOrClose(database, () =>
    initializeNoteStoreDatabase(database, configuredSiteAdminEmails),
  )

  const checkDatabaseConnection = database.prepare('SELECT 1')

  const campaignStatements = prepareCampaignStatements(database)
  const membershipStatements = prepareMembershipStatements(database)
  const ownerAccountStatements = prepareOwnerAccountStatements(database)
  const shareLinkStatements = prepareShareLinkStatements(database)
  const adminStatements = prepareAdminStatements(database)
  const {
    deleteNoteReferencesBySourceNoteId,
    deleteNoteStatement,
    deleteNotesByCampaignIdStatement,
    insertNote,
    insertNoteReference,
    selectNoteById,
    selectNoteIdentityById,
    selectNoteReferencesByCampaignId,
    selectNoteReferencesBySourceNoteId,
    selectNotesByCampaignId,
    selectNotesBySessionName,
    selectStoredNotesForReferenceSync,
    updateNoteStatement,
  } = prepareNoteStatements(database)

  // Domains have circular helper deps. We resolve them with placeholder
  // bindings: the membership domain needs a campaign helper, and the campaign
  // domain needs the membership helpers. Build the campaign domain first using
  // membership statements directly for the helpers it needs.
  const ownsCampaign = async (campaignId: string, ownerUserId: string) =>
    Boolean(
      await membershipStatements.selectOwnerMembershipByCampaignAndUser.get(
        campaignId,
        ownerUserId,
      ),
    )

  const countOwnerMembershipsHelper = async (campaignId: string) => {
    const row = (await membershipStatements.countOwnerMembershipsStatement.get(
      campaignId,
    )) as { count: number }
    return Number(row.count)
  }

  const insertMembershipHelper = async (
    input: Parameters<
      Parameters<typeof createCampaignDomain>[0]['insertMembership']
    >[0],
  ) => {
    await membershipStatements.insertMembership.run(input)
  }

  const campaigns = createCampaignDomain({
    database,
    statements: campaignStatements,
    insertMembership: insertMembershipHelper,
    countOwnerMemberships: countOwnerMembershipsHelper,
    ownsCampaign,
  })

  const memberships = createMembershipDomain({
    database,
    statements: membershipStatements,
    requireCampaign: campaigns.requireCampaign,
    isCampaignActive: campaigns.isCampaignActive,
  })

  const ownerAccounts = createOwnerAccountDomain({
    database,
    statements: ownerAccountStatements,
    configuredSiteAdminEmails,
  })

  const shareLinks = createShareLinkDomain({
    database,
    statements: shareLinkStatements,
    isCampaignActive: campaigns.isCampaignActive,
    ownsCampaign: memberships.ownsCampaign,
    requireCampaign: campaigns.requireCampaign,
  })

  const admin = createAdminDomain({ statements: adminStatements })

  // Note CRUD + reference sync stays in the composition root because it
  // crosses the notes/references seams that were already extracted.
  const validateReferenceTarget = async (
    targetNoteId: string,
    campaignId: string,
  ) => {
    const targetNote = (await selectNoteIdentityById.get(targetNoteId)) as
      | NoteIdentityRow
      | undefined

    if (!targetNote) {
      throw new Error(`Referenced note "${targetNoteId}" was not found.`)
    }

    if (targetNote.campaign_id !== campaignId) {
      throw new Error(
        `Referenced note "${targetNoteId}" must be in the same campaign.`,
      )
    }
  }

  const buildPendingReferences = async (
    body: string,
    explicitLinkedNoteIds: string[],
    campaignId: string,
    options: { allowInvalidReferences: boolean } = {
      allowInvalidReferences: false,
    },
  ) => {
    let inlineReferences: ReturnType<typeof parseInlineNoteReferences> = []

    try {
      inlineReferences = parseInlineNoteReferences(body)
    } catch (error) {
      if (!options.allowInvalidReferences) {
        throw error
      }
    }

    const references: PendingReference[] = []
    const explicitTargetIds = new Set<string>()

    for (const linkedNoteId of explicitLinkedNoteIds) {
      const targetNoteId = linkedNoteId.trim()

      if (targetNoteId.length === 0 || explicitTargetIds.has(targetNoteId)) {
        continue
      }

      try {
        await validateReferenceTarget(targetNoteId, campaignId)
      } catch (error) {
        if (!options.allowInvalidReferences) {
          throw error
        }

        continue
      }

      explicitTargetIds.add(targetNoteId)
      references.push({
        targetNoteId,
        referenceType: 'linked',
        label: null,
        qualifier: null,
        positionInBody: null,
      })
    }

    for (const reference of inlineReferences) {
      try {
        await validateReferenceTarget(reference.targetNoteId, campaignId)
      } catch (error) {
        if (!options.allowInvalidReferences) {
          throw error
        }

        continue
      }

      references.push({
        targetNoteId: reference.targetNoteId,
        referenceType: 'inline',
        label: reference.label,
        qualifier: reference.qualifier,
        positionInBody: reference.positionInBody,
      })
    }

    return references
  }

  const replaceNoteReferences = async (
    noteId: string,
    campaignId: string,
    body: string,
    explicitLinkedNoteIds: string[],
    timestamp: string,
    options?: { allowInvalidReferences: boolean },
  ) => {
    const references = await buildPendingReferences(
      body,
      explicitLinkedNoteIds,
      campaignId,
      options,
    )
    const persistedReferences: NoteReference[] = []

    await deleteNoteReferencesBySourceNoteId.run(noteId)

    for (const reference of references) {
      const id = randomUUID()
      const persistedReference = mapNoteReferenceRow({
        id,
        source_note_id: noteId,
        target_note_id: reference.targetNoteId,
        campaign_id: campaignId,
        reference_type: reference.referenceType,
        label: reference.label,
        qualifier: reference.qualifier,
        position_in_body: reference.positionInBody,
        created_at: timestamp,
        updated_at: timestamp,
      })

      await insertNoteReference.run({
        id,
        source_note_id: persistedReference.sourceNoteId,
        target_note_id: persistedReference.targetNoteId,
        campaign_id: persistedReference.campaignId,
        reference_type: persistedReference.referenceType,
        label: persistedReference.label,
        qualifier: persistedReference.qualifier,
        position_in_body: persistedReference.positionInBody,
        created_at: persistedReference.createdAt,
        updated_at: persistedReference.updatedAt,
      })

      persistedReferences.push(persistedReference)
    }

    return persistedReferences
  }

  const syncNoteReferencesTransaction = database.transaction(
    async (
      options: { allowInvalidReferences: boolean } = {
        allowInvalidReferences: true,
      },
    ) => {
      const noteRows =
        (await selectStoredNotesForReferenceSync.all()) as StoredNoteForReferenceSyncRow[]

      for (const row of noteRows) {
        const explicitLinkedNoteIds = row.linked_notes_json
          ? (JSON.parse(row.linked_notes_json) as string[])
          : []

        await replaceNoteReferences(
          row.id,
          row.campaign_id,
          row.body,
          explicitLinkedNoteIds,
          row.updated_at ?? row.created_at,
          options,
        )
      }
    },
  )

  const listNotes = async (campaignId?: string) => {
    const campaign = await campaigns.requireCampaign(campaignId)
    const notes = (
      (await selectNotesByCampaignId.all(campaign.id)) as NoteRow[]
    ).map((row) => mapNoteRow(row))
    const referencesBySource = groupReferencesBySource(
      (await selectNoteReferencesByCampaignId.all(
        campaign.id,
      )) as NoteReferenceRow[],
    )

    return notes.map((note) =>
      composeNote(note, referencesBySource.get(note.id) ?? []),
    )
  }

  const insertPersistedNote = async (note: NoteRecord) => {
    await insertNote.run({
      id: note.id,
      campaign_id: note.campaignId,
      title: note.title,
      body: note.body,
      status: note.status,
      tags_json: JSON.stringify(note.tags),
      linked_notes_json: JSON.stringify(note.explicitLinkedNoteIds),
      session_name: note.sessionName,
      created_by_membership_id: note.createdBy?.membershipId ?? null,
      last_edited_by_membership_id: note.lastEditedBy?.membershipId ?? null,
      created_at: note.createdAt,
      updated_at: note.updatedAt,
    })
  }

  const resetNotesTransaction = database.transaction(
    async (inputs: NoteInput[], campaignId?: string) => {
      const campaign = await campaigns.requireCampaign(campaignId)
      await deleteNotesByCampaignIdStatement.run(campaign.id)

      const baseTimestamp = Date.now()
      const notes: NoteRecord[] = []

      for (const [index, input] of inputs.entries()) {
        const timestamp = new Date(baseTimestamp - index).toISOString()
        const note: NoteRecord = {
          id: randomUUID(),
          campaignId: campaign.id,
          title: input.title,
          body: input.body,
          tags: input.tags,
          status: input.status,
          sessionName: input.sessionName,
          explicitLinkedNoteIds: input.linkedNoteIds ?? [],
          createdBy: null,
          lastEditedBy: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        }

        await insertPersistedNote(note)
        notes.push(note)
      }

      for (const note of notes) {
        await replaceNoteReferences(
          note.id,
          note.campaignId,
          note.body,
          note.explicitLinkedNoteIds,
          note.updatedAt,
          { allowInvalidReferences: false },
        )
      }

      return Promise.all(
        notes.map(async (note) =>
          composeNote(
            note,
            (
              (await selectNoteReferencesBySourceNoteId.all(
                note.id,
              )) as NoteReferenceRow[]
            ).map(mapNoteReferenceRow),
          ),
        ),
      )
    },
  )

  const createNoteTransaction = database.transaction(
    async (input: NoteInput, membershipId?: string) => {
      const campaign = await campaigns.requireCampaign(input.campaignId)
      const timestamp = new Date().toISOString()

      const attribution: NoteAttribution | null = membershipId
        ? await memberships.findMembershipAttribution(membershipId)
        : null

      const note: NoteRecord = {
        id: randomUUID(),
        campaignId: campaign.id,
        title: input.title,
        body: input.body,
        tags: input.tags,
        status: input.status,
        sessionName: input.sessionName,
        explicitLinkedNoteIds: input.linkedNoteIds ?? [],
        createdBy: attribution,
        lastEditedBy: attribution,
        createdAt: timestamp,
        updatedAt: timestamp,
      }

      await insertPersistedNote(note)
      const references = await replaceNoteReferences(
        note.id,
        note.campaignId,
        note.body,
        note.explicitLinkedNoteIds,
        note.updatedAt,
        { allowInvalidReferences: false },
      )

      return composeNote(note, references)
    },
  )

  const updateNoteTransaction = database.transaction(
    async (noteId: string, input: NoteInput, membershipId?: string) => {
      const existingRow = (await selectNoteById.get(noteId)) as
        | NoteRow
        | undefined

      if (!existingRow) {
        return null
      }

      const existing = mapNoteRow(existingRow)
      const editAttribution: NoteAttribution | null = membershipId
        ? await memberships.findMembershipAttribution(membershipId)
        : existing.lastEditedBy

      const nextNote: NoteRecord = {
        ...existing,
        title: input.title,
        body: input.body,
        tags: input.tags,
        status: input.status,
        sessionName: input.sessionName,
        explicitLinkedNoteIds:
          input.linkedNoteIds ?? existing.explicitLinkedNoteIds,
        lastEditedBy: editAttribution,
        updatedAt: createTimestampAfter(existing.updatedAt),
      }

      await updateNoteStatement.run({
        id: nextNote.id,
        title: nextNote.title,
        body: nextNote.body,
        status: nextNote.status,
        tags_json: JSON.stringify(nextNote.tags),
        linked_notes_json: JSON.stringify(nextNote.explicitLinkedNoteIds),
        session_name: nextNote.sessionName,
        last_edited_by_membership_id:
          nextNote.lastEditedBy?.membershipId ?? null,
        updated_at: nextNote.updatedAt,
      })

      const references = await replaceNoteReferences(
        nextNote.id,
        nextNote.campaignId,
        nextNote.body,
        nextNote.explicitLinkedNoteIds,
        nextNote.updatedAt,
        { allowInvalidReferences: false },
      )

      return composeNote(nextNote, references)
    },
  )

  await campaigns.ensureDefaultCampaign()
  await syncNoteReferencesTransaction()

  const noteStore: NoteStore = {
    listCampaigns: campaigns.listCampaigns,
    listUserCampaigns: campaigns.listUserCampaigns,
    listOwnedCampaigns: campaigns.listOwnedCampaigns,
    getPrimaryCampaignForUser: campaigns.getPrimaryCampaignForUser,
    getPrimaryCampaign: campaigns.getPrimaryCampaign,
    getCampaign: campaigns.getCampaign,
    createCampaign: campaigns.createCampaign,
    updateCampaign: campaigns.updateCampaign,
    listCampaignMemberships: memberships.listCampaignMemberships,
    listCampaignShareLinks: shareLinks.listCampaignShareLinks,
    userHasCampaignAccess: memberships.userHasCampaignAccess,
    userOwnsCampaign: memberships.userOwnsCampaign,
    createOwnerAccount: ownerAccounts.createOwnerAccount,
    authenticateOwner: ownerAccounts.authenticateOwner,
    getOwnerBySessionToken: ownerAccounts.getOwnerBySessionToken,
    findOrCreateOwnerByKeycloakIdentity:
      ownerAccounts.findOrCreateOwnerByKeycloakIdentity,
    listOwnerAccounts: admin.listOwnerAccounts,
    createOwnerSession: ownerAccounts.createOwnerSession,
    deleteOwnerSession: ownerAccounts.deleteOwnerSession,
    createCampaignShareLink: shareLinks.createCampaignShareLink,
    revokeCampaignShareLink: shareLinks.revokeCampaignShareLink,
    getCampaignShareLinkReveal: shareLinks.getCampaignShareLinkReveal,
    getCampaignShareLinkByToken: shareLinks.getCampaignShareLinkByToken,
    createGuestMembership: memberships.createGuestMembership,
    getGuestMembershipByToken: memberships.getGuestMembershipByToken,
    claimGuestMembership: memberships.claimGuestMembership,
    previewMembershipConsolidation: memberships.previewMembershipConsolidation,
    consolidateMemberships: memberships.consolidateMemberships,
    getUserMembershipForCampaign: memberships.getUserMembershipForCampaign,
    getOwnerMembershipForCampaign: memberships.getOwnerMembershipForCampaign,
    listNotes,
    async listSessionNames(campaignId) {
      const notes = await listNotes(campaignId)
      const sessionMap = new Map<
        string,
        { noteCount: number; latestActivity: string }
      >()

      for (const note of notes) {
        if (note.sessionName === null) {
          continue
        }

        const existing = sessionMap.get(note.sessionName)

        if (existing) {
          existing.noteCount += 1
          if (note.updatedAt > existing.latestActivity) {
            existing.latestActivity = note.updatedAt
          }
        } else {
          sessionMap.set(note.sessionName, {
            noteCount: 1,
            latestActivity: note.updatedAt,
          })
        }
      }

      const sessions: SessionSummary[] = []

      for (const [sessionName, data] of sessionMap) {
        sessions.push({
          sessionName,
          noteCount: data.noteCount,
          latestActivity: data.latestActivity,
        })
      }

      sessions.sort((a, b) => b.latestActivity.localeCompare(a.latestActivity))

      return sessions
    },
    async listRecentNotes(limit, campaignId) {
      return (await listNotes(campaignId)).slice(0, limit)
    },
    async getSessionNotes(campaignId, sessionName) {
      const rows = (await selectNotesBySessionName.all(
        campaignId,
        sessionName,
      )) as NoteRow[]
      const referencesBySource = groupReferencesBySource(
        (await selectNoteReferencesByCampaignId.all(
          campaignId,
        )) as NoteReferenceRow[],
      )

      return rows.map((row) => {
        const note = mapNoteRow(row)
        return composeNote(note, referencesBySource.get(note.id) ?? [])
      })
    },
    async getNote(noteId) {
      const row = (await selectNoteById.get(noteId)) as NoteRow | undefined
      if (!row) {
        return null
      }

      const note = mapNoteRow(row)
      const references = (
        (await selectNoteReferencesBySourceNoteId.all(
          noteId,
        )) as NoteReferenceRow[]
      ).map(mapNoteReferenceRow)

      return composeNote(note, references)
    },
    async getBacklinks(noteId) {
      const targetNote = await noteStore.getNote(noteId)
      if (!targetNote) {
        return []
      }
      const allNotes = await listNotes(targetNote.campaignId)
      return allNotes.filter((note) => note.linkedNoteIds.includes(noteId))
    },
    createNote: createNoteTransaction,
    updateNote: updateNoteTransaction,
    async deleteNote(noteId) {
      const result = await deleteNoteStatement.run(noteId)
      return result.changes > 0
    },
    resetNotes: resetNotesTransaction,
    async getStats(campaignId) {
      const notes = await listNotes(campaignId)

      return {
        totalNotes: notes.length,
        draftNotes: notes.filter((note) => note.status === 'draft').length,
        activeNotes: notes.filter((note) => note.status === 'active').length,
        archivedNotes: notes.filter((note) => note.status === 'archived')
          .length,
        sessionLinkedNotes: notes.filter((note) => note.sessionName !== null)
          .length,
      }
    },
    getAdminOverview: admin.getAdminOverview,
    async checkHealth() {
      await checkDatabaseConnection.get()
    },
    close() {
      return database.close()
    },
  }

  return noteStore
}

export async function createRuntimeNoteStore(
  options: RuntimeNoteStoreOptions = {},
): Promise<NoteStore> {
  return createNoteStore(options)
}

// Suppress unused-import warning for OwnerKeycloakLinkConflictError; it is
// re-exported above for consumers that previously imported it from this module.
void OwnerKeycloakLinkConflictError
void ownerKeycloakLinkConflictCode

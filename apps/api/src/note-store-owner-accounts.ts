import { randomUUID } from 'node:crypto'
import { defaultCampaign } from './campaign.js'
import type { NoteStoreDatabase } from './note-store-database.js'
import type { KeycloakOwnerIdentity, OwnerAccount } from './types.js'

export interface OwnerAccountRow {
  id: string
  email: string
  display_name: string
  is_site_admin: number
  keycloak_sub: string | null
  created_at: string
  updated_at: string
}

export interface OwnerProvisioningInput {
  displayName: string
  email: string
}

export const ownerKeycloakLinkConflictCode = 'OWNER_KEYCLOAK_LINK_CONFLICT'

export class OwnerKeycloakLinkConflictError extends Error {
  readonly code = ownerKeycloakLinkConflictCode

  constructor(
    readonly ownerId: string,
    message = 'This owner account is already linked to a different Keycloak identity.',
  ) {
    super(message)
    this.name = 'OwnerKeycloakLinkConflictError'
  }
}

export function normalizeEmailAddress(email: string) {
  return email.trim().toLowerCase()
}

function isOwnerEmailUniqueConstraintError(error: unknown) {
  if (!(error instanceof Error)) {
    return false
  }

  const code =
    'code' in error && typeof error.code === 'string' ? error.code : undefined
  const constraint =
    'constraint' in error && typeof error.constraint === 'string'
      ? error.constraint
      : undefined
  const details = [code, constraint, error.message].filter(Boolean).join(' ')

  return (
    code === '23505' ||
    code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    code === 'SQLITE_CONSTRAINT' ||
    /owner_accounts\.email/i.test(details) ||
    /idx_owner_accounts_email_lower/i.test(details) ||
    /duplicate key value/i.test(details)
  )
}

export function mapOwnerAccountRow(row: OwnerAccountRow): OwnerAccount {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    isSiteAdmin: row.is_site_admin === 1,
    keycloakSub: row.keycloak_sub,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function prepareOwnerAccountStatements(database: NoteStoreDatabase) {
  const selectOwnerAccountById = database.prepare(`
    SELECT
      id,
      email,
      display_name,
      is_site_admin,
      keycloak_sub,
      created_at,
      updated_at
    FROM owner_accounts
    WHERE id = ?
  `)

  const selectOwnerAccountByEmail = database.prepare(`
    SELECT
      id,
      email,
      display_name,
      is_site_admin,
      keycloak_sub,
      created_at,
      updated_at
    FROM owner_accounts
    WHERE LOWER(email) = LOWER(?)
  `)

  const selectOwnerAccountByKeycloakSub = database.prepare(`
    SELECT
      id,
      email,
      display_name,
      is_site_admin,
      keycloak_sub,
      created_at,
      updated_at
    FROM owner_accounts
    WHERE keycloak_sub = ?
  `)

  const insertOwnerAccount = database.prepare(`
    INSERT INTO owner_accounts (
      id,
      email,
      display_name,
      is_site_admin,
      keycloak_sub,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @email,
      @display_name,
      @is_site_admin,
      @keycloak_sub,
      @created_at,
      @updated_at
    )
  `)

  const updateOwnerKeycloakIdentity = database.prepare(`
    UPDATE owner_accounts
    SET
      email = @email,
      display_name = @display_name,
      is_site_admin = @is_site_admin,
      keycloak_sub = @keycloak_sub,
      updated_at = @updated_at
    WHERE id = @id
  `)

  const updateUnclaimedDefaultMembership = database.prepare(`
    UPDATE campaign_memberships
    SET
      user_id = @user_id,
      display_name = @display_name,
      updated_at = @updated_at
    WHERE
      campaign_id = @campaign_id
      AND role = 'owner'
      AND user_id IS NULL
  `)

  return {
    selectOwnerAccountById,
    selectOwnerAccountByEmail,
    selectOwnerAccountByKeycloakSub,
    insertOwnerAccount,
    updateOwnerKeycloakIdentity,
    updateUnclaimedDefaultMembership,
  }
}

export type OwnerAccountStatements = ReturnType<
  typeof prepareOwnerAccountStatements
>

export function createOwnerAccountDomain(deps: {
  database: NoteStoreDatabase
  statements: OwnerAccountStatements
  configuredSiteAdminEmails: Set<string>
}) {
  const {
    database,
    statements: {
      selectOwnerAccountByEmail,
      selectOwnerAccountByKeycloakSub,
      insertOwnerAccount,
      updateOwnerKeycloakIdentity,
      updateUnclaimedDefaultMembership,
    },
    configuredSiteAdminEmails,
  } = deps

  const createOwnerAccountTransaction = database.transaction(
    async (input: OwnerProvisioningInput) => {
      const normalizedEmail = normalizeEmailAddress(input.email)
      const existing = (await selectOwnerAccountByEmail.get(normalizedEmail)) as
        | OwnerAccountRow
        | undefined

      if (existing) {
        return null
      }

      const timestamp = new Date().toISOString()
      const owner: OwnerAccount = {
        id: randomUUID(),
        email: normalizedEmail,
        displayName: input.displayName,
        isSiteAdmin: configuredSiteAdminEmails.has(normalizedEmail),
        keycloakSub: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      }

      try {
        await insertOwnerAccount.run({
          id: owner.id,
          email: owner.email,
          display_name: owner.displayName,
          is_site_admin: owner.isSiteAdmin ? 1 : 0,
          keycloak_sub: owner.keycloakSub,
          created_at: owner.createdAt,
          updated_at: owner.updatedAt,
        })
      } catch (error) {
        if (isOwnerEmailUniqueConstraintError(error)) {
          return null
        }

        throw error
      }

      await updateUnclaimedDefaultMembership.run({
        user_id: owner.id,
        display_name: owner.displayName,
        updated_at: timestamp,
        campaign_id: defaultCampaign.id,
      })

      return owner
    },
  )

  const resolveOwnerEmailForKeycloakIdentity = async (
    owner: OwnerAccountRow,
    normalizedEmail: string,
  ) => {
    const currentEmail = normalizeEmailAddress(owner.email)

    if (currentEmail === normalizedEmail) {
      return currentEmail
    }

    const existing = (await selectOwnerAccountByEmail.get(normalizedEmail)) as
      | OwnerAccountRow
      | undefined

    if (existing && existing.id !== owner.id) {
      return currentEmail
    }

    return normalizedEmail
  }

  const findOrCreateOwnerByKeycloakIdentityTransaction = database.transaction(
    async (identity: KeycloakOwnerIdentity) => {
      const normalizedEmail = normalizeEmailAddress(identity.email)
      const byKeycloakSub = (await selectOwnerAccountByKeycloakSub.get(
        identity.keycloakSub,
      )) as OwnerAccountRow | undefined

      if (byKeycloakSub) {
        const updatedAt = new Date().toISOString()
        const persistedEmail = await resolveOwnerEmailForKeycloakIdentity(
          byKeycloakSub,
          normalizedEmail,
        )
        const updatedOwner = {
          ...mapOwnerAccountRow(byKeycloakSub),
          email: persistedEmail,
          displayName: identity.displayName,
          isSiteAdmin: configuredSiteAdminEmails.has(persistedEmail),
          updatedAt,
        }

        await updateOwnerKeycloakIdentity.run({
          id: updatedOwner.id,
          email: updatedOwner.email,
          display_name: updatedOwner.displayName,
          is_site_admin: updatedOwner.isSiteAdmin ? 1 : 0,
          keycloak_sub: identity.keycloakSub,
          updated_at: updatedOwner.updatedAt,
        })

        return updatedOwner
      }

      const byEmail = (await selectOwnerAccountByEmail.get(normalizedEmail)) as
        | OwnerAccountRow
        | undefined

      if (byEmail) {
        if (
          byEmail.keycloak_sub !== null &&
          byEmail.keycloak_sub !== identity.keycloakSub
        ) {
          throw new OwnerKeycloakLinkConflictError(byEmail.id)
        }

        const updatedAt = new Date().toISOString()
        const updatedOwner = {
          ...mapOwnerAccountRow(byEmail),
          displayName: identity.displayName,
          isSiteAdmin: configuredSiteAdminEmails.has(normalizedEmail),
          keycloakSub: identity.keycloakSub,
          updatedAt,
        }

        await updateOwnerKeycloakIdentity.run({
          id: updatedOwner.id,
          email: normalizedEmail,
          display_name: updatedOwner.displayName,
          is_site_admin: updatedOwner.isSiteAdmin ? 1 : 0,
          keycloak_sub: updatedOwner.keycloakSub,
          updated_at: updatedOwner.updatedAt,
        })

        return updatedOwner
      }

      const createdOwner = await createOwnerAccountTransaction({
        displayName: identity.displayName,
        email: normalizedEmail,
      })

      if (!createdOwner) {
        throw new Error(
          `Owner account "${normalizedEmail}" could not be created.`,
        )
      }

      const updatedAt = new Date().toISOString()
      await updateOwnerKeycloakIdentity.run({
        id: createdOwner.id,
        email: normalizedEmail,
        display_name: createdOwner.displayName,
        is_site_admin: createdOwner.isSiteAdmin ? 1 : 0,
        keycloak_sub: identity.keycloakSub,
        updated_at: updatedAt,
      })

      return {
        ...createdOwner,
        keycloakSub: identity.keycloakSub,
        updatedAt,
      }
    },
  )

  return {
    createOwnerAccount: createOwnerAccountTransaction,
    findOrCreateOwnerByKeycloakIdentity:
      findOrCreateOwnerByKeycloakIdentityTransaction,
  }
}

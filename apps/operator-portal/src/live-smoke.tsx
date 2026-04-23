import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OperatorPortal from './OperatorPortal'
import type { RuntimeKeycloakClient, StoredKeycloakTokens } from './keycloak-client'

export interface OperatorPortalSmokeOptions extends StoredKeycloakTokens {
  tenantId: string
  tenantSlug: string
  ownerId: string
  initialAdminEmail: string
  version: string
  reason: string
}

class StaticRuntimeKeycloakClient implements RuntimeKeycloakClient {
  private readonly tokens: StoredKeycloakTokens

  constructor(tokens: StoredKeycloakTokens) {
    this.tokens = tokens
  }

  async init() {
    return this.tokens
  }

  async login() {
    throw new Error('Live smoke does not perform an interactive Keycloak redirect.')
  }

  async logout() {}

  async refresh() {
    return this.tokens
  }

  clear() {}
}

function createSmokeKeycloakClient(tokens: StoredKeycloakTokens) {
  return () => new StaticRuntimeKeycloakClient(tokens)
}

export async function provisionTenantThroughOperatorPortal(
  options: OperatorPortalSmokeOptions,
) {
  const user = userEvent.setup()
  const keycloakTokens: StoredKeycloakTokens = {
    accessToken: options.accessToken,
    refreshToken: options.refreshToken,
    ...(options.idToken ? { idToken: options.idToken } : {}),
  }

  render(
    <OperatorPortal
      keycloakClientFactory={createSmokeKeycloakClient(keycloakTokens)}
    />,
  )

  try {
    await screen.findByText('Operator control portal')
    const tenantIdInput = await screen.findByRole('textbox', { name: /Tenant ID/i })
    const tenantSlugInput = screen.getByRole('textbox', { name: /Tenant slug/i })
    const ownerIdInput = screen.getByRole('textbox', { name: /Owner ID/i })
    const initialAdminEmailInput = screen.getByRole('textbox', {
      name: /Initial admin email/i,
    })
    const tenantVersionInput = screen.getByRole('textbox', {
      name: /Tenant version/i,
    })
    const operatorReasonInput = screen.getByRole('textbox', {
      name: /Operator reason/i,
    })

    await user.type(tenantIdInput, options.tenantId)
    await user.type(tenantSlugInput, options.tenantSlug)
    await user.type(ownerIdInput, options.ownerId)
    await user.type(
      initialAdminEmailInput,
      options.initialAdminEmail,
    )
    await user.clear(tenantVersionInput)
    await user.type(tenantVersionInput, options.version)
    await user.type(operatorReasonInput, options.reason)

    await user.click(
      screen.getByRole('button', { name: 'Review and provision tenant' }),
    )
    await screen.findByRole('dialog', { name: 'Confirm tenant provisioning' })
    await user.click(
      screen.getByRole('button', { name: 'Create and provision tenant' }),
    )

    const notice = await screen.findByText(
      new RegExp(`^Provisioned ${options.tenantSlug}\\.`),
    )
    return {
      notice: notice.textContent ?? '',
    }
  } finally {
    cleanup()
  }
}

import { cleanup, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import type { ComponentProps } from 'react'
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
  const user = userEvent.setup({ document: globalThis.document })
  const keycloakTokens: StoredKeycloakTokens = {
    accessToken: options.accessToken,
    refreshToken: options.refreshToken,
    ...(options.idToken ? { idToken: options.idToken } : {}),
  }

  const view = render(
    React.createElement<NonNullable<ComponentProps<typeof OperatorPortal>>>(
      OperatorPortal,
      {
      keycloakClientFactory: createSmokeKeycloakClient(keycloakTokens),
      },
    ),
  )

  try {
    await view.findByText('Operator control portal')
    const tenantIdInput = await view.findByRole('textbox', { name: /Tenant ID/i })
    const tenantSlugInput = view.getByRole('textbox', { name: /Tenant slug/i })
    const ownerIdInput = view.getByRole('textbox', { name: /Owner ID/i })
    const initialAdminEmailInput = view.getByRole('textbox', {
      name: /Initial admin email/i,
    })
    const tenantVersionInput = view.getByRole('textbox', {
      name: /Tenant version/i,
    })
    const operatorReasonInput = view.getByRole('textbox', {
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
      view.getByRole('button', { name: 'Review and provision tenant' }),
    )
    await view.findByRole('dialog', { name: 'Confirm tenant provisioning' })
    await user.click(
      view.getByRole('button', { name: 'Create and provision tenant' }),
    )

    const notice = await view.findByText(
      new RegExp(`^Provisioned ${options.tenantSlug}\\.`),
    )
    return {
      notice: notice.textContent ?? '',
    }
  } finally {
    cleanup()
  }
}

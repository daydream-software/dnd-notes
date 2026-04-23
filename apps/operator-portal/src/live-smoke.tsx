import { cleanup, render, waitFor } from '@testing-library/react'
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

function readPortalAlerts(view: ReturnType<typeof render>) {
  return view
    .queryAllByRole('alert')
    .map((alert) => alert.textContent?.trim())
    .filter(
      (text): text is string =>
        Boolean(text) &&
        text !==
          'Portal writes stay on the existing /internal/tenants control-plane contract. Provisioning creates real Kubernetes and database resources, while deprovisioning deletes live resources and requires explicit confirmation.' &&
        text !==
          'Confirmation creates a real tenant record immediately, then asks the control plane to create the namespace, deployment, service, PVC, runtime secret, and database. Failures after creation stay visible in the fleet list for retry/triage.',
    )
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
    const reviewButton = (await view.findByRole(
      'button',
      { name: 'Review and provision tenant' },
      { timeout: 10_000 },
    )) as HTMLButtonElement
    const tenantIdInput = view.getByRole('textbox', { name: /Tenant ID/i })
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

    try {
      await waitFor(() => {
        if (reviewButton.disabled) {
          throw new Error('Provisioning is still disabled.')
        }
      }, { timeout: 10_000 })
    } catch {
      const alertSummary = readPortalAlerts(view).join(' ')
      throw new Error(
        alertSummary.length > 0
          ? `Operator portal never became ready to provision. ${alertSummary}`
          : 'Operator portal never became ready to provision.',
      )
    }

    await user.click(reviewButton)

    try {
      await view.findByRole('dialog', { name: 'Confirm tenant provisioning' })
    } catch {
      const alertSummary = readPortalAlerts(view).join(' ')
      throw new Error(
        alertSummary.length > 0
          ? `Provision review dialog did not open. ${alertSummary}`
          : 'Provision review dialog did not open.',
      )
    }

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

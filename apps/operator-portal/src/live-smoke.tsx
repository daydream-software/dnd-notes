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
  version: string
  reason: string
  provisionTimeoutMs?: number
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

function readPortalText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? ''
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return ''
  }

  const element = node as Element
  const tagName = element.tagName.toLowerCase()

  if (tagName === 'style' || tagName === 'script') {
    return ''
  }

  return Array.from(element.childNodes)
    .map((childNode) => readPortalText(childNode))
    .join(' ')
}

function readPortalElementText(element: Element): string {
  return readPortalText(element).replace(/\s+/g, ' ').trim()
}

function readPortalAlerts(view: ReturnType<typeof render>) {
  const ignoredAlerts = new Set([
    'Portal writes stay on the existing /internal/tenants control-plane contract. Provisioning creates real Kubernetes and database resources, while deprovisioning deletes live resources and requires explicit confirmation.',
    'Confirmation creates a real tenant record immediately, then asks the control plane to create the namespace, deployment, service, PVC, runtime secret, and database. Failures after creation stay visible in the fleet list for retry/triage.',
    'This will create the tenant record and trigger real platform work.',
    'If the create call succeeds but provisioning fails, the new tenant stays in the fleet list so the operator can retry the existing /internal/tenants/:id/provision path instead of losing the audit trail.',
  ])

  return view
    .queryAllByRole('alert', { hidden: true })
    .map((alert) => readPortalElementText(alert))
    .filter(
      (text): text is string =>
        Boolean(text) && !ignoredAlerts.has(text),
    )
}

function readPortalOutcome(view: ReturnType<typeof render>, testId: string) {
  const alert = view.queryByTestId(testId)

  if (!alert) {
    return null
  }

  const text = readPortalElementText(alert)
  return text.length > 0 ? text : null
}

export async function provisionTenantThroughOperatorPortal(
  options: OperatorPortalSmokeOptions,
) {
  const user = userEvent.setup({ document: globalThis.document })
  const provisionTimeoutMs = options.provisionTimeoutMs ?? 120_000
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
    const ownerSearchInput = view.getByRole('combobox', { name: /Search for owner/i })
    const tenantVersionInput = view.getByRole('textbox', {
      name: /Tenant version/i,
    })
    const operatorReasonInput = view.getByRole('textbox', {
      name: /Operator reason/i,
    })

    await user.type(tenantIdInput, options.tenantId)
    await user.type(tenantSlugInput, options.tenantSlug)
    await user.type(ownerSearchInput, options.ownerId)

    // Wait for the Autocomplete to show at least one option, then pick the first.
    const firstOption = await view.findByRole('option', { hidden: true }, { timeout: 5_000 })
    await user.click(firstOption)

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

    const successPrefix = `Provisioned ${options.tenantSlug}.`

    try {
      const outcome = await waitFor(() => {
        const successNotice = readPortalOutcome(view, 'operator-portal-notice')

        if (successNotice?.includes(successPrefix)) {
          return { kind: 'success' as const, message: successNotice }
        }

        const errorNotice = readPortalOutcome(view, 'operator-portal-error')

        if (errorNotice) {
          return { kind: 'error' as const, message: errorNotice }
        }

        if (view.queryByRole('dialog', { name: 'Confirm tenant provisioning' })) {
          throw new Error('Provision success notice not available yet.')
        }

        throw new Error('Provisioning result not available yet.')
      }, { timeout: provisionTimeoutMs })

      if (outcome.kind === 'error') {
        throw new Error(`Operator portal provisioning failed. ${outcome.message}`)
      }

      return {
        notice: outcome.message,
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith('Operator portal provisioning failed.')
      ) {
        throw error
      }

      const alertSummary = readPortalAlerts(view).join(' ')
      throw new Error(
        alertSummary.length > 0
          ? `Provisioning did not reach a successful outcome within ${provisionTimeoutMs}ms. ${alertSummary}`
          : `Provisioning did not reach a successful outcome within ${provisionTimeoutMs}ms.`,
        { cause: error },
      )
    }
  } finally {
    cleanup()
  }
}

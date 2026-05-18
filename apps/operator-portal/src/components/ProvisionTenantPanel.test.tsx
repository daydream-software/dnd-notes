import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createJsonResponse, readMockJsonBody, readMockRequest } from '../test-helpers'
import ProvisionTenantPanel from './ProvisionTenantPanel'

const defaultProps = {
  actor: 'tester@example.com',
  authToken: 'test-token',
  disabledReason: null,
  onError: vi.fn(),
  onProvisioned: vi.fn(),
  onRefresh: vi.fn().mockResolvedValue(undefined),
  suggestedVersion: '1.0.0',
  surfaceRadius: '18px',
}

function renderPanel(overrides: Partial<typeof defaultProps> = {}) {
  const props = { ...defaultProps, ...overrides }
  return render(
    <ProvisionTenantPanel
      actor={props.actor}
      authToken={props.authToken}
      disabledReason={props.disabledReason}
      onError={props.onError}
      onProvisioned={props.onProvisioned}
      onRefresh={props.onRefresh}
      suggestedVersion={props.suggestedVersion}
      surfaceRadius={props.surfaceRadius}
    />,
  )
}

describe('ProvisionTenantPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders the Autocomplete owner picker in the form', () => {
    renderPanel()
    expect(screen.getByRole('combobox', { name: /Search for owner/i })).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: /initial admin email/i })).toBeNull()
  })

  it('debounces the owner search — does not fetch per keystroke', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createJsonResponse([]),
    )
    renderPanel()

    const user = userEvent.setup()
    const combobox = screen.getByRole('combobox', { name: /Search for owner/i })

    // Rapid burst of keystrokes — should not trigger a fetch per keystroke.
    await user.type(combobox, 'abc')

    // Wait for the debounce to fire (300ms), then a tick for async resolution.
    await waitFor(
      () => {
        expect(fetchSpy).toHaveBeenCalled()
      },
      { timeout: 1000 },
    )

    // Only one request should have fired, not three (one per character).
    const keycloakCalls = fetchSpy.mock.calls.filter(([input]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
      return url.includes('keycloak-users')
    })
    expect(keycloakCalls.length).toBe(1)
  })

  it('shows an option and sets ownerId when a user is selected', async () => {
    const createRequests: Array<{ id: string; ownerId: string; slug: string; version: string }> = []

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)

      if (path === '/operator-api/internal/keycloak-users' && method === 'GET') {
        return createJsonResponse([
          { id: 'user-123', email: 'elaith@waterdeep.example', username: 'elaith' },
        ])
      }

      if (path === '/operator-api/internal/tenants' && method === 'POST') {
        const body = readMockJsonBody<{ id: string; ownerId: string; slug: string; version: string }>(init)
        if (body) createRequests.push(body)
        return createJsonResponse({
          tenant: {
            id: body?.id ?? 'test',
            slug: body?.slug ?? 'test',
            subdomain: null,
            ownerId: body?.ownerId ?? '',
            desiredState: 'provisioning',
            currentState: 'provisioning',
            version: body?.version ?? '1.0.0',
            storageReference: null,
            backupMetadata: null,
            createdAt: '2026-05-18T00:00:00.000Z',
            updatedAt: '2026-05-18T00:00:00.000Z',
          },
        }, 201)
      }

      if (path.includes('/provision') && method === 'POST') {
        return createJsonResponse({
          tenant: {
            id: 'waterdeep-notes',
            slug: 'waterdeep-notes',
            subdomain: null,
            ownerId: 'user-123',
            desiredState: 'ready',
            currentState: 'ready',
            version: '1.0.0',
            storageReference: null,
            backupMetadata: null,
            createdAt: '2026-05-18T00:00:00.000Z',
            updatedAt: '2026-05-18T00:00:00.000Z',
          },
          resources: {
            namespace: 'tenant-waterdeep-notes',
            deploymentName: 'tenant-waterdeep-notes-app',
            serviceName: 'tenant-waterdeep-notes-service',
            pvcName: null,
            configMapName: 'tenant-waterdeep-notes-config',
            secretName: 'tenant-waterdeep-notes-secret',
            hostname: 'waterdeep-notes.example.test',
            databaseName: 'tenant_waterdeep_notes',
            image: 'ghcr.io/daydream-software/dnd-notes:1.0.0',
          },
        })
      }

      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    const onProvisioned = vi.fn()
    renderPanel({ onProvisioned })

    const user = userEvent.setup()

    await user.type(screen.getByLabelText(/tenant slug/i), 'waterdeep-notes')

    // Type into the owner Autocomplete and pick the first result.
    await user.type(screen.getByRole('combobox', { name: /Search for owner/i }), 'elaith')
    await user.click(await screen.findByRole('option', { hidden: true }))

    await user.type(screen.getByLabelText(/^operator reason/i), 'New tenant setup')

    await user.click(screen.getByRole('button', { name: 'Review and provision tenant' }))
    await screen.findByText('Confirm tenant provisioning')
    await user.click(screen.getByRole('button', { name: 'Create and provision tenant' }))

    await waitFor(() => {
      expect(onProvisioned).toHaveBeenCalledOnce()
    })

    expect(createRequests).toEqual([
      {
        id: 'waterdeep-notes',
        slug: 'waterdeep-notes',
        ownerId: 'user-123',
        version: '1.0.0',
      },
    ])
  })

  it('shows empty state when no users match the query', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)
      if (path === '/operator-api/internal/keycloak-users' && method === 'GET') {
        return createJsonResponse([])
      }
      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    renderPanel()

    const user = userEvent.setup()
    await user.type(screen.getByRole('combobox', { name: /Search for owner/i }), 'nobody')

    await waitFor(
      () => {
        expect(screen.getByText('No users match')).toBeTruthy()
      },
      { timeout: 1000 },
    )
  })

  it('shows error state when backend returns 500', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)
      if (path === '/operator-api/internal/keycloak-users' && method === 'GET') {
        return createJsonResponse({ error: 'Internal error' }, 500)
      }
      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    renderPanel()

    const user = userEvent.setup()
    await user.type(screen.getByRole('combobox', { name: /Search for owner/i }), 'elaith')

    await waitFor(
      () => {
        expect(screen.getAllByText('Could not reach Keycloak — try again').length).toBeGreaterThan(0)
      },
      { timeout: 1000 },
    )
  })

  it('clears stale owner options when the search request fails', async () => {
    let callCount = 0

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)

      if (path === '/operator-api/internal/keycloak-users' && method === 'GET') {
        callCount++
        if (callCount === 1) {
          // First call succeeds — populates the list.
          return createJsonResponse([
            { id: 'user-abc', email: 'populateduser@example.com', username: 'populateduser' },
          ])
        }
        // Subsequent calls fail — should wipe the list.
        return createJsonResponse({ error: 'Service unavailable' }, 503)
      }

      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    renderPanel()
    const user = userEvent.setup()
    const combobox = screen.getByRole('combobox', { name: /Search for owner/i })

    // First search — list populates.
    await user.type(combobox, 'pop')
    await waitFor(
      () => {
        expect(screen.queryByRole('option', { hidden: true })).toBeTruthy()
      },
      { timeout: 1000 },
    )

    // Type more so a second debounced search fires and fails.
    await user.type(combobox, 'x')
    await waitFor(
      () => {
        expect(screen.getAllByText('Could not reach Keycloak — try again').length).toBeGreaterThan(0)
      },
      { timeout: 1000 },
    )

    // The stale option must be gone — no options should remain visible.
    expect(screen.queryByRole('option', { hidden: true })).toBeNull()
  })

  it('clears ownerId when user edits the owner input after selecting an owner', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)
      if (path === '/operator-api/internal/keycloak-users' && method === 'GET') {
        return createJsonResponse([
          { id: 'user-xyz', email: 'aragon@rivendell.example', username: 'aragon' },
        ])
      }
      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    const onError = vi.fn()
    renderPanel({ onError })

    const user = userEvent.setup()
    const combobox = screen.getByRole('combobox', { name: /Search for owner/i })

    // Select an owner.
    await user.type(combobox, 'aragon')
    await user.click(await screen.findByRole('option', { hidden: true }))

    // Now type over the input — this should clear the previously-committed ownerId.
    await user.type(combobox, 'x')

    // Fill other required fields and attempt to submit.
    await user.type(screen.getByLabelText(/tenant slug/i), 'rivendell-notes')
    await user.type(screen.getByLabelText(/^operator reason/i), 'New tenant')

    await user.click(screen.getByRole('button', { name: 'Review and provision tenant' }))

    // Because ownerId was cleared, validation must block the submit —
    // the review dialog must NOT appear and onError must be called.
    await waitFor(
      () => {
        expect(onError).toHaveBeenCalledOnce()
      },
      { timeout: 1000 },
    )
    expect(screen.queryByText('Confirm tenant provisioning')).toBeNull()
  })

  it('submitted create-tenant payload contains only id, slug, ownerId, and version', async () => {
    const createRequests: Array<Record<string, unknown>> = []

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const { path, method } = readMockRequest(input, init)

      if (path === '/operator-api/internal/keycloak-users' && method === 'GET') {
        return createJsonResponse([
          { id: 'user-456', email: 'bard@neverwinter.example', username: 'bard' },
        ])
      }

      if (path === '/operator-api/internal/tenants' && method === 'POST') {
        const body = readMockJsonBody<Record<string, unknown>>(init)
        if (body) createRequests.push(body)
        return createJsonResponse({
          tenant: {
            id: 'neverwinter-notes',
            slug: 'neverwinter-notes',
            subdomain: null,
            ownerId: 'user-456',
            desiredState: 'provisioning',
            currentState: 'provisioning',
            version: '1.0.0',
            storageReference: null,
            backupMetadata: null,
            createdAt: '2026-05-18T00:00:00.000Z',
            updatedAt: '2026-05-18T00:00:00.000Z',
          },
        }, 201)
      }

      if (path.includes('/provision') && method === 'POST') {
        return createJsonResponse({
          tenant: {
            id: 'neverwinter-notes',
            slug: 'neverwinter-notes',
            subdomain: null,
            ownerId: 'user-456',
            desiredState: 'ready',
            currentState: 'ready',
            version: '1.0.0',
            storageReference: null,
            backupMetadata: null,
            createdAt: '2026-05-18T00:00:00.000Z',
            updatedAt: '2026-05-18T00:00:00.000Z',
          },
          resources: {
            namespace: 'tenant-neverwinter-notes',
            deploymentName: 'tenant-neverwinter-notes-app',
            serviceName: 'tenant-neverwinter-notes-service',
            pvcName: null,
            configMapName: 'tenant-neverwinter-notes-config',
            secretName: 'tenant-neverwinter-notes-secret',
            hostname: 'neverwinter-notes.example.test',
            databaseName: 'tenant_neverwinter_notes',
            image: 'ghcr.io/daydream-software/dnd-notes:1.0.0',
          },
        })
      }

      return createJsonResponse({ error: `Unhandled ${method} ${path}` }, 500)
    })

    const onProvisioned = vi.fn()
    renderPanel({ onProvisioned })

    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/tenant slug/i), 'neverwinter-notes')
    await user.type(screen.getByRole('combobox', { name: /Search for owner/i }), 'bard')
    await user.click(await screen.findByRole('option', { hidden: true }))
    await user.type(screen.getByLabelText(/^operator reason/i), 'Setup new tenant')

    await user.click(screen.getByRole('button', { name: 'Review and provision tenant' }))
    await screen.findByText('Confirm tenant provisioning')
    await user.click(screen.getByRole('button', { name: 'Create and provision tenant' }))

    await waitFor(() => {
      expect(onProvisioned).toHaveBeenCalledOnce()
    })

    expect(createRequests).toHaveLength(1)
    // Payload must contain exactly these keys — no extra fields.
    expect(Object.keys(createRequests[0]).sort()).toEqual(['id', 'ownerId', 'slug', 'version'])
  })
})

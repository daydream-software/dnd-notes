import { JSDOM } from 'jsdom'
import { provisionTenantThroughOperatorPortal } from '../../apps/operator-portal/src/live-smoke'

function installDomGlobals(window: Window & typeof globalThis) {
  Object.assign(globalThis, {
    window,
    document: window.document,
    navigator: window.navigator,
    localStorage: window.localStorage,
    sessionStorage: window.sessionStorage,
    HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement,
    HTMLButtonElement: window.HTMLButtonElement,
    Node: window.Node,
    Event: window.Event,
    MouseEvent: window.MouseEvent,
    KeyboardEvent: window.KeyboardEvent,
    getComputedStyle: window.getComputedStyle.bind(window),
    atob: window.atob.bind(window),
    btoa: window.btoa.bind(window),
  })

  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    configurable: true,
    value: true,
  })

  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {
          return false
        },
      }),
    })
  }
}

async function readRequestBody(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.body !== undefined) {
    return init.body
  }

  if (input instanceof Request) {
    return Buffer.from(await input.arrayBuffer())
  }

  return undefined
}

function createRelativeFetchProxy(controlPlaneBaseUrl: string, browserOrigin: string) {
  const nativeFetch = globalThis.fetch.bind(globalThis)

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    const resolvedUrl = new URL(requestUrl, browserOrigin)

    if (
      resolvedUrl.origin === browserOrigin &&
      resolvedUrl.pathname.startsWith('/operator-api/')
    ) {
      const proxiedUrl = new URL(
        `${resolvedUrl.pathname.replace(/^\/operator-api/, '')}${resolvedUrl.search}`,
        controlPlaneBaseUrl,
      )
      const body = await readRequestBody(input, init)

      return nativeFetch(proxiedUrl, {
        method: init?.method ?? (input instanceof Request ? input.method : 'GET'),
        headers: init?.headers ?? (input instanceof Request ? input.headers : undefined),
        ...(body !== undefined ? { body } : {}),
      })
    }

    return nativeFetch(input, init)
  }
}

async function main() {
  const accessToken = process.env.OPERATOR_PORTAL_ACCESS_TOKEN
  const refreshToken =
    process.env.OPERATOR_PORTAL_REFRESH_TOKEN ?? 'operator-portal-smoke-refresh-token'
  const controlPlaneBaseUrl =
    process.env.OPERATOR_PORTAL_CONTROL_PLANE_BASE_URL ?? 'http://127.0.0.1:3101'
  const tenantId = process.env.OPERATOR_PORTAL_TENANT_ID
  const tenantSlug = process.env.OPERATOR_PORTAL_TENANT_SLUG
  const ownerId = process.env.OPERATOR_PORTAL_OWNER_ID ?? 'smoke-owner'
  const initialAdminEmail =
    process.env.OPERATOR_PORTAL_INITIAL_ADMIN_EMAIL ?? 'owner@example.com'
  const version = process.env.OPERATOR_PORTAL_TENANT_VERSION ?? 'k3d'
  const reason =
    process.env.OPERATOR_PORTAL_REASON ?? 'Run the k3d full-stack smoke workflow'

  if (!accessToken) {
    throw new Error('OPERATOR_PORTAL_ACCESS_TOKEN is required.')
  }

  if (!tenantId || !tenantSlug) {
    throw new Error('OPERATOR_PORTAL_TENANT_ID and OPERATOR_PORTAL_TENANT_SLUG are required.')
  }

  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    pretendToBeVisual: true,
    url: 'http://operator.127.0.0.1.nip.io/',
  })
  installDomGlobals(dom.window)
  globalThis.fetch = createRelativeFetchProxy(controlPlaneBaseUrl, dom.window.location.origin)

  const result = await provisionTenantThroughOperatorPortal({
    accessToken,
    refreshToken,
    tenantId,
    tenantSlug,
    ownerId,
    initialAdminEmail,
    version,
    reason,
  })

  process.stdout.write(JSON.stringify(result))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exit(1)
})

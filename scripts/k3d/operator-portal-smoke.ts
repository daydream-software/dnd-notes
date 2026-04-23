import { JSDOM } from 'jsdom'

type InstalledWindow = typeof globalThis & Record<string, any>
type AnimationFrameCallback = (timestamp: number) => void
type RequestLike = string | URL | Request
type LegacyAttachEventElement = {
  attachEvent?: () => void
  detachEvent?: () => void
}
type ProvisionTenantThroughOperatorPortal = (options: OperatorPortalSmokeOptions) => Promise<{
  notice: string
}>

interface OperatorPortalSmokeOptions {
  accessToken: string
  refreshToken: string
  idToken?: string
  tenantId: string
  tenantSlug: string
  ownerId: string
  initialAdminEmail: string
  version: string
  reason: string
  provisionTimeoutMs?: number
}

const operatorPortalLiveSmokeModulePath = '../../apps/operator-portal/src/live-smoke.tsx'

async function loadProvisionTenantThroughOperatorPortal(): Promise<ProvisionTenantThroughOperatorPortal> {
  const liveSmokeModule = (await import(operatorPortalLiveSmokeModulePath)) as {
    provisionTenantThroughOperatorPortal?: ProvisionTenantThroughOperatorPortal
  }

  const provisionTenantThroughOperatorPortal = liveSmokeModule.provisionTenantThroughOperatorPortal

  if (!provisionTenantThroughOperatorPortal) {
    throw new Error('Operator portal live smoke helper is not available.')
  }

  return provisionTenantThroughOperatorPortal
}

function installGlobalProperty(name: string, value: unknown) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name)

  if (!descriptor || descriptor.configurable) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value,
    })
    return
  }

  if (descriptor.set || descriptor.writable) {
    Reflect.set(globalThis, name, value)
    return
  }

  if (Reflect.get(globalThis, name) === value) {
    return
  }

  throw new TypeError(
    `Cannot install DOM global ${name}: existing global property is not writable.`,
  )
}

function installDomGlobals(window: InstalledWindow) {
  const requestAnimationFrame =
    window.requestAnimationFrame?.bind(window) ??
    ((callback: AnimationFrameCallback) =>
      setTimeout(() => callback(Date.now()), 0) as unknown as number)
  const cancelAnimationFrame =
    window.cancelAnimationFrame?.bind(window) ??
    ((handle: number) => clearTimeout(handle))
  const htmlElementPrototype = window.HTMLElement.prototype as LegacyAttachEventElement

  installGlobalProperty('window', window)
  installGlobalProperty('document', window.document)
  installGlobalProperty('navigator', window.navigator)
  installGlobalProperty('localStorage', window.localStorage)
  installGlobalProperty('sessionStorage', window.sessionStorage)
  installGlobalProperty('HTMLElement', window.HTMLElement)
  installGlobalProperty('Element', window.Element)
  installGlobalProperty('DocumentFragment', window.DocumentFragment)
  installGlobalProperty('HTMLInputElement', window.HTMLInputElement)
  installGlobalProperty('HTMLButtonElement', window.HTMLButtonElement)
  installGlobalProperty('HTMLTextAreaElement', window.HTMLTextAreaElement)
  installGlobalProperty('Node', window.Node)
  installGlobalProperty('SVGElement', window.SVGElement)
  installGlobalProperty('Event', window.Event)
  installGlobalProperty('MouseEvent', window.MouseEvent)
  installGlobalProperty('KeyboardEvent', window.KeyboardEvent)
  installGlobalProperty('getComputedStyle', window.getComputedStyle.bind(window))
  installGlobalProperty('requestAnimationFrame', requestAnimationFrame)
  installGlobalProperty('cancelAnimationFrame', cancelAnimationFrame)
  installGlobalProperty('atob', window.atob.bind(window))
  installGlobalProperty('btoa', window.btoa.bind(window))

  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    configurable: true,
    writable: true,
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

  if (!htmlElementPrototype.attachEvent) {
    Object.defineProperty(htmlElementPrototype, 'attachEvent', {
      configurable: true,
      writable: true,
      value() {},
    })
  }

  if (!htmlElementPrototype.detachEvent) {
    Object.defineProperty(htmlElementPrototype, 'detachEvent', {
      configurable: true,
      writable: true,
      value() {},
    })
  }
}

async function readRequestBody(input: RequestLike, init?: RequestInit) {
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

  return async (input: RequestLike, init?: RequestInit) => {
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
  const rawProvisionTimeoutMs = process.env.OPERATOR_PORTAL_PROVISION_TIMEOUT_MS?.trim()
  const provisionTimeoutMs =
    rawProvisionTimeoutMs && rawProvisionTimeoutMs.length > 0
      ? Number(rawProvisionTimeoutMs)
      : 120_000

  if (!accessToken) {
    throw new Error('OPERATOR_PORTAL_ACCESS_TOKEN is required.')
  }

  if (!tenantId || !tenantSlug) {
    throw new Error('OPERATOR_PORTAL_TENANT_ID and OPERATOR_PORTAL_TENANT_SLUG are required.')
  }

  if (!Number.isFinite(provisionTimeoutMs) || provisionTimeoutMs <= 0) {
    throw new Error(
      'OPERATOR_PORTAL_PROVISION_TIMEOUT_MS must be a positive number when provided.',
    )
  }

  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    pretendToBeVisual: true,
    url: 'http://operator.127.0.0.1.nip.io/',
  })
  installDomGlobals(dom.window as unknown as InstalledWindow)
  globalThis.fetch = createRelativeFetchProxy(controlPlaneBaseUrl, dom.window.location.origin)

  const provisionTenantThroughOperatorPortal = await loadProvisionTenantThroughOperatorPortal()
  const result = await provisionTenantThroughOperatorPortal({
    accessToken,
    refreshToken,
    tenantId,
    tenantSlug,
    ownerId,
    initialAdminEmail,
    version,
    reason,
    provisionTimeoutMs,
  })

  process.stdout.write(JSON.stringify(result))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exit(1)
})

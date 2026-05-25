/**
 * Kubernetes Watch-based cache for tenant Deployment replica counts and
 * Endpoint readiness.
 *
 * The activator maintains two in-memory caches:
 *
 *   replicaCache: Map<deploymentKey, number>
 *     Reflects spec.replicas for every watched Deployment. Updated via a
 *     Watch on apps/v1/Deployments in all tenant namespaces.
 *
 *   readyAddressCache: Map<endpointKey, number>
 *     Reflects the count of ready addresses in v1/Endpoints for each tenant
 *     Service. Updated via a Watch on v1/Endpoints.
 *
 * On cache miss (Watch hasn't seen the resource yet), the caller must fall
 * back to a direct API GET before deciding what to do. The DeploymentWatcher
 * exposes getReplicas() and getReadyAddresses() which do this fallback
 * automatically.
 *
 * Watch streams disconnect silently after the server's timeout window (~5 min
 * in most clusters). The watcher re-establishes the Watch on disconnect.
 * During the reconnect window the cache may be stale; the fallback GET in
 * getReplicas()/getReadyAddresses() ensures correctness at the cost of an
 * extra API call.
 *
 * Wake sequence:
 *   1. Caller sees replicas == 0 via getReplicas().
 *   2. Caller calls patchReplicas(ns, deploymentName, 1) to trigger the wake.
 *   3. Caller calls waitForReadyEndpoint(ns, serviceName, timeoutMs) which
 *      polls endpoint readiness and resolves when ready or rejects on timeout.
 */

import { setTimeout as delay } from 'node:timers/promises'
import {
  AppsV1Api,
  CoreV1Api,
  KubeConfig,
  PatchStrategy,
  setHeaderOptions,
  Watch,
  type V1Deployment,
  type V1Endpoints,
} from '@kubernetes/client-node'

/** Structural interface for the AppsV1Api subset used by DeploymentWatcher. */
export interface AppsV1ApiLike {
  readNamespacedDeployment(args: { name: string; namespace: string }): Promise<{ spec?: { replicas?: number } }>
  patchNamespacedDeployment(args: { name: string; namespace: string; body: unknown }, options?: unknown): Promise<unknown>
}

/**
 * Structural interface for the @kubernetes/client-node Watch subset used here.
 * `watch()` resolves once the connection is established (not when the stream
 * ends); a connection failure is surfaced via the `done` callback, which fires
 * synchronously before the promise resolves. The returned controller is
 * discarded by the watch loop.
 */
export interface WatchLike {
  watch(
    path: string,
    queryParams: Record<string, string | number | boolean | undefined>,
    callback: (type: string, obj: unknown, watchObj?: unknown) => void,
    done: (err: unknown) => void,
  ): Promise<unknown>
}

/** Structural interface for the CoreV1Api subset used by DeploymentWatcher. */
export interface CoreV1ApiLike {
  listNamespacedPod(args: { namespace: string }): Promise<{
    items: Array<{
      status?: { phase?: string }
      metadata?: { labels?: Record<string, string | undefined> }
    }>
  }>
  readNamespacedEndpoints(args: { name: string; namespace: string }): Promise<{
    subsets?: Array<{ addresses?: unknown[] }>
  }>
}

/** Key for caches: "namespace/name" */
function resourceKey(namespace: string, name: string): string {
  return `${namespace}/${name}`
}

/**
 * Label every tenant Service and Deployment carries
 * (`buildTenantSelectorLabels` in the control-plane). Used as an existence
 * selector to scope the Watches to tenant resources only, so the caches never
 * hold kube-system/platform objects the activator never routes to.
 *
 * The same selector scopes the Endpoints Watch: Kubernetes' endpoints
 * controller copies `metadata.labels` from the Service onto its auto-generated
 * Endpoints object, so the tenant-id label propagates there automatically.
 */
const TENANT_LABEL_SELECTOR = 'dnd-notes.dev/tenant-id'

/** Hard ceiling on the reconnect backoff delay. */
const DEFAULT_RECONNECT_CAP_MS = 30_000

/** Fraction of the delay applied as +/- jitter to desync reconnect waves. */
const RECONNECT_JITTER_FRACTION = 0.2

/**
 * Compute the next Watch-reconnect delay with exponential backoff and jitter.
 *
 * - `consecutiveFailures === 0` (last connect succeeded) and `=== 1` both yield
 *   the base delay; each further consecutive failure doubles it (base, base,
 *   2x, 4x, 8x, ...), capped at `capMs`.
 * - A +/-20% jitter is always applied so multiple activator replicas do not
 *   reconnect in lockstep.
 */
export function computeReconnectDelay(
  consecutiveFailures: number,
  opts: { baseMs: number; capMs: number; random?: () => number },
): number {
  const random = opts.random ?? Math.random
  const exponent = Math.max(0, consecutiveFailures - 1)
  const raw = opts.baseMs * 2 ** exponent
  const capped = Math.min(raw, opts.capMs)
  const jitter = 1 + (random() * 2 - 1) * RECONNECT_JITTER_FRACTION
  return Math.round(capped * jitter)
}

export interface DeploymentWatcherOptions {
  kubeConfig?: KubeConfig
  /**
   * Optional injected AppsV1Api client. When provided, overrides the client
   * derived from kubeConfig. Intended for testing without importing
   * @kubernetes/client-node in tests.
   */
  appsApi?: AppsV1ApiLike
  /**
   * Optional injected CoreV1Api client. When provided, overrides the client
   * derived from kubeConfig. Intended for testing.
   */
  coreApi?: CoreV1ApiLike
  /**
   * Interval in milliseconds between endpoint readiness polls when the Watch
   * is reconnecting or when a direct poll is needed.
   * Default: 500ms
   */
  readinessPollIntervalMs?: number
  /**
   * Base delay before re-establishing a Watch. Used as the floor of the
   * exponential backoff: each consecutive connection failure doubles the delay
   * (capped at reconnectCapMs) with +/-20% jitter; a successful connect resets
   * it to this base.
   * Default: 1000ms
   */
  watchReconnectDelayMs?: number
  /**
   * Ceiling on the reconnect backoff delay.
   * Default: 30000ms (30s)
   */
  reconnectCapMs?: number
  /**
   * Optional injected Watch client. When provided, overrides the client derived
   * from kubeConfig. Intended for testing without importing
   * @kubernetes/client-node.
   */
  watch?: WatchLike
  /**
   * Optional injected sleep. Intended for testing the reconnect backoff without
   * real timers. Default: node:timers/promises setTimeout.
   */
  sleep?: (ms: number) => Promise<void>
  /**
   * Optional injected random source for backoff jitter. Default: Math.random.
   */
  random?: () => number
  /**
   * If a Pod for the tenant stays in Pending phase beyond this many
   * milliseconds, emit the pod_schedule_deadline_exceeded metric.
   * Default: 30000ms (30s)
   */
  podScheduleBudgetMs?: number
}

export interface WakeResult {
  /** Whether the wake succeeded (ready endpoint appeared within budget) */
  ready: boolean
  /** Cold-start wall time in seconds */
  durationSeconds: number
  /** Set when the pod was stuck Pending past the scheduling budget */
  scheduleDeadlineExceeded: boolean
}

export interface DeploymentWatcher {
  /**
   * Start background Watch streams. Must be called before getReplicas().
   * Safe to call multiple times — re-entrant guard inside.
   */
  start(): void

  /**
   * Get the current replica count for a Deployment.
   * Falls back to a direct API GET on cache miss.
   */
  getReplicas(namespace: string, deploymentName: string): Promise<number>

  /**
   * Peek the current ready-address count for a Service (a non-blocking
   * one-shot, unlike waitForReadyEndpoint which polls until ready/timeout).
   * Cache hit, else a single direct API GET; returns 0 if the Endpoints object
   * is missing or has no ready addresses.
   */
  getReadyAddresses(namespace: string, serviceName: string): Promise<number>

  /**
   * Patch spec.replicas on a Deployment.
   */
  patchReplicas(namespace: string, deploymentName: string, replicas: number): Promise<void>

  /**
   * Wait for at least one ready Endpoint address for the given Service.
   * Polls via Watch events; falls back to direct API poll when Watch is
   * reconnecting. Resolves true when ready, false on timeout.
   * Also inspects Pod phase to detect Pending-past-budget.
   */
  waitForReadyEndpoint(
    namespace: string,
    serviceName: string,
    deploymentName: string,
    timeoutMs: number,
    onScheduleDeadlineExceeded: () => void,
  ): Promise<boolean>

  /** Stop all background Watches. */
  stop(): void
}

export function createDeploymentWatcher(options: DeploymentWatcherOptions = {}): DeploymentWatcher {
  const kubeConfig = options.kubeConfig ?? new KubeConfig()
  if (!options.appsApi || !options.coreApi) {
    kubeConfig.loadFromDefault()
  }

  const appsApi: AppsV1ApiLike = options.appsApi ?? kubeConfig.makeApiClient(AppsV1Api)
  const coreApi: CoreV1ApiLike = options.coreApi ?? kubeConfig.makeApiClient(CoreV1Api)
  const watcher: WatchLike = options.watch ?? new Watch(kubeConfig)

  const readinessPollIntervalMs = options.readinessPollIntervalMs ?? 500
  const watchReconnectDelayMs = options.watchReconnectDelayMs ?? 1000
  const reconnectCapMs = options.reconnectCapMs ?? DEFAULT_RECONNECT_CAP_MS
  const podScheduleBudgetMs = options.podScheduleBudgetMs ?? 30_000
  const sleep = options.sleep ?? delay
  const random = options.random ?? Math.random

  // namespace/deploymentName -> spec.replicas
  const replicaCache = new Map<string, number>()
  // namespace/serviceName -> ready address count
  const readyAddressCache = new Map<string, number>()

  // Listeners waiting for an endpoint to become ready
  // namespace/serviceName -> array of notify callbacks
  const readyListeners = new Map<string, Array<() => void>>()

  let stopped = false
  let started = false

  // Internal: notify all listeners for a given endpoint key
  function notifyEndpointListeners(key: string) {
    const listeners = readyListeners.get(key)
    if (listeners) {
      for (const notify of listeners) {
        notify()
      }
    }
  }

  // Live Watch controller per loop label, so stop() can abort an in-flight
  // stream promptly instead of waiting for the server to close it.
  const activeControllers = new Map<string, AbortController>()

  function handleDeploymentEvent(type: string, obj: unknown): void {
    const dep = obj as V1Deployment
    const ns = dep.metadata?.namespace
    const name = dep.metadata?.name
    if (!ns || !name) return
    const key = resourceKey(ns, name)
    if (type === 'DELETED') {
      // Prune so the cache plateaus under tenant churn (#382).
      replicaCache.delete(key)
      return
    }
    replicaCache.set(key, dep.spec?.replicas ?? 0)
  }

  function handleEndpointEvent(type: string, obj: unknown): void {
    const ep = obj as V1Endpoints
    const ns = ep.metadata?.namespace
    const name = ep.metadata?.name
    if (!ns || !name) return
    const key = resourceKey(ns, name)
    if (type === 'DELETED') {
      // Prune the cache (#382). Any in-flight waitForReadyEndpoint listener is
      // left in place: it has its own timeoutMs deadline and stops polling when
      // it expires, so it cannot leak.
      readyAddressCache.delete(key)
      return
    }

    let readyCount = 0
    for (const subset of ep.subsets ?? []) {
      readyCount += subset.addresses?.length ?? 0
    }
    readyAddressCache.set(key, readyCount)
    if (readyCount > 0) {
      notifyEndpointListeners(key)
    }
  }

  // One Watch loop, scoped to tenant resources via the label selector.
  //
  // Reconnects on STREAM END — it awaits the `done` callback, not the
  // connect-time resolution of watcher.watch(). Watch.watch() resolves as soon
  // as the connection is established (not when the stream ends), so awaiting it
  // re-opened a new connection every reconnect interval while the previous
  // stream was still live, and those connections accumulated until the process
  // OOMed (#389 — the prod activator OOMKill). Awaiting `done` keeps exactly one
  // live connection per loop: the client aborts its controller inside `done`,
  // so the previous stream is fully closed before the next opens.
  //
  // Backoff (#355) still applies between reconnects: a failed connect / errored
  // stream escalates the delay; a clean stream end resets it to the base.
  async function runWatchLoop(
    path: string,
    label: string,
    onEvent: (type: string, obj: unknown) => void,
  ): Promise<void> {
    let consecutiveFailures = 0
    while (!stopped) {
      const failed = await new Promise<boolean>((resolve) => {
        let settled = false
        const finish = (didFail: boolean) => {
          if (!settled) {
            settled = true
            resolve(didFail)
          }
        }
        void watcher
          .watch(path, { labelSelector: TENANT_LABEL_SELECTOR }, onEvent, (err: unknown) => {
            // Fires once, on stream end or connect/stream failure. A non-null
            // err is a failure (escalates backoff); a clean close resets it.
            if (err && !stopped) {
              console.warn(`[activator] ${label} Watch ended:`, err instanceof Error ? err.message : String(err))
            }
            finish(Boolean(err))
          })
          .then(
            (controller) => {
              const c = controller as AbortController | undefined
              // On a connect failure the lib calls done() (which aborts its
              // controller) before resolving here, so this can run after the
              // loop already moved past `finish` — skip an already-aborted
              // controller rather than parking a dead one in the map.
              if (c && !c.signal.aborted) {
                activeControllers.set(label, c)
                // stop() may have raced ahead of the connect — honor it.
                if (stopped) c.abort()
              }
            },
            (err: unknown) => {
              // watch() rejected before connecting (e.g. no active cluster).
              if (!stopped) {
                console.warn(`[activator] ${label} Watch error, reconnecting:`, err instanceof Error ? err.message : String(err))
              }
              finish(true)
            },
          )
      })

      activeControllers.delete(label)
      consecutiveFailures = failed ? consecutiveFailures + 1 : 0
      if (!stopped) {
        await sleep(computeReconnectDelay(consecutiveFailures, { baseMs: watchReconnectDelayMs, capMs: reconnectCapMs, random }))
      }
    }
  }

  return {
    start() {
      if (started || stopped) return
      started = true
      // Fire and forget — reconnect loops run in background
      void runWatchLoop('/apis/apps/v1/deployments', 'Deployment', handleDeploymentEvent)
      void runWatchLoop('/api/v1/endpoints', 'Endpoint', handleEndpointEvent)
    },

    async getReplicas(namespace: string, deploymentName: string): Promise<number> {
      const key = resourceKey(namespace, deploymentName)
      const cached = replicaCache.get(key)
      if (cached !== undefined) {
        return cached
      }
      // Cache miss — fall back to direct API GET (acceptance criterion)
      const resp = await appsApi.readNamespacedDeployment({ name: deploymentName, namespace })
      const replicas = resp.spec?.replicas ?? 0
      replicaCache.set(key, replicas)
      return replicas
    },

    async getReadyAddresses(namespace: string, serviceName: string): Promise<number> {
      const key = resourceKey(namespace, serviceName)
      const cached = readyAddressCache.get(key)
      if (cached !== undefined) {
        return cached
      }
      // Cache miss — one direct API GET. A missing Endpoints object (tenant not
      // up yet) or any transient error counts as zero ready addresses.
      try {
        const ep = await coreApi.readNamespacedEndpoints({ name: serviceName, namespace })
        let readyCount = 0
        for (const subset of ep.subsets ?? []) {
          readyCount += subset.addresses?.length ?? 0
        }
        readyAddressCache.set(key, readyCount)
        return readyCount
      } catch {
        return 0
      }
    },

    async patchReplicas(namespace: string, deploymentName: string, replicas: number): Promise<void> {
      await appsApi.patchNamespacedDeployment(
        { name: deploymentName, namespace, body: { spec: { replicas } } },
        setHeaderOptions('Content-Type', PatchStrategy.MergePatch),
      )
      replicaCache.set(resourceKey(namespace, deploymentName), replicas)
    },

    async waitForReadyEndpoint(
      namespace: string,
      serviceName: string,
      deploymentName: string,
      timeoutMs: number,
      onScheduleDeadlineExceeded: () => void,
    ): Promise<boolean> {
      const epKey = resourceKey(namespace, serviceName)
      const startTime = Date.now()
      let scheduleDeadlineEmitted = false

      while (Date.now() - startTime < timeoutMs) {
        // Check pod phase for resource-pressure detection
        if (!scheduleDeadlineEmitted && Date.now() - startTime > podScheduleBudgetMs) {
          try {
            const pods = await coreApi.listNamespacedPod({ namespace })
            const pendingPods = pods.items.filter(
              (pod) =>
                pod.status?.phase === 'Pending' && (
                  pod.metadata?.labels?.['app.kubernetes.io/instance'] === deploymentName ||
                  pod.metadata?.labels?.['app'] === deploymentName ||
                  pod.metadata?.labels?.['dnd-notes.dev/tenant-id'] !== undefined
                ),
            )
            if (pendingPods.length > 0) {
              scheduleDeadlineEmitted = true
              onScheduleDeadlineExceeded()
              console.warn(
                `[activator] pod_schedule_deadline_exceeded for deployment ${namespace}/${deploymentName}`,
              )
            }
          } catch {
            // pod phase inspection is best-effort
          }
        }

        // Check cache first
        const cached = readyAddressCache.get(epKey)
        if (cached !== undefined && cached > 0) {
          return true
        }

        // Fall back to direct API GET (Watch may be reconnecting)
        try {
          const ep = await coreApi.readNamespacedEndpoints({ name: serviceName, namespace })
          let readyCount = 0
          for (const subset of ep.subsets ?? []) {
            readyCount += subset.addresses?.length ?? 0
          }
          readyAddressCache.set(epKey, readyCount)
          if (readyCount > 0) {
            return true
          }
        } catch {
          // transient API error; continue polling
        }

        await delay(readinessPollIntervalMs)
      }

      return false
    },

    stop() {
      stopped = true
      // Abort any in-flight Watch so a loop parked on stream-end exits promptly
      // instead of waiting for the server to close the connection.
      for (const controller of activeControllers.values()) {
        controller.abort()
      }
      activeControllers.clear()
    },
  }
}

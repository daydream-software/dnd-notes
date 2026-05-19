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
  Watch,
  type V1Deployment,
  type V1Endpoints,
} from '@kubernetes/client-node'

/** Key for caches: "namespace/name" */
function resourceKey(namespace: string, name: string): string {
  return `${namespace}/${name}`
}

export interface DeploymentWatcherOptions {
  kubeConfig?: KubeConfig
  /**
   * Interval in milliseconds between endpoint readiness polls when the Watch
   * is reconnecting or when a direct poll is needed.
   * Default: 500ms
   */
  readinessPollIntervalMs?: number
  /**
   * How long to wait after a Watch disconnect before reconnecting.
   * Default: 1000ms
   */
  watchReconnectDelayMs?: number
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
  kubeConfig.loadFromDefault()

  const appsApi = kubeConfig.makeApiClient(AppsV1Api)
  const coreApi = kubeConfig.makeApiClient(CoreV1Api)
  const watcher = new Watch(kubeConfig)

  const readinessPollIntervalMs = options.readinessPollIntervalMs ?? 500
  const watchReconnectDelayMs = options.watchReconnectDelayMs ?? 1000
  const podScheduleBudgetMs = options.podScheduleBudgetMs ?? 30_000

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

  // Internal: watch loop for Deployments across all namespaces
  async function watchDeployments(): Promise<void> {
    while (!stopped) {
      try {
        await watcher.watch(
          '/apis/apps/v1/deployments',
          {},
          (type: string, obj: V1Deployment) => {
            const ns = obj.metadata?.namespace
            const name = obj.metadata?.name
            const replicas = obj.spec?.replicas ?? 0
            if (ns && name) {
              replicaCache.set(resourceKey(ns, name), replicas)
            }
          },
          (err: unknown) => {
            if (!stopped) {
              console.warn('[activator] Deployment Watch ended:', err instanceof Error ? err.message : String(err))
            }
          },
        )
      } catch (err) {
        if (stopped) return
        console.warn('[activator] Deployment Watch error, reconnecting:', err instanceof Error ? err.message : String(err))
      }
      if (!stopped) {
        await delay(watchReconnectDelayMs)
      }
    }
  }

  // Internal: watch loop for Endpoints across all namespaces
  async function watchEndpoints(): Promise<void> {
    while (!stopped) {
      try {
        await watcher.watch(
          '/api/v1/endpoints',
          {},
          (type: string, obj: V1Endpoints) => {
            const ns = obj.metadata?.namespace
            const name = obj.metadata?.name
            if (!ns || !name) return

            let readyCount = 0
            for (const subset of obj.subsets ?? []) {
              readyCount += subset.addresses?.length ?? 0
            }
            const key = resourceKey(ns, name)
            readyAddressCache.set(key, readyCount)
            if (readyCount > 0) {
              notifyEndpointListeners(key)
            }
          },
          (err: unknown) => {
            if (!stopped) {
              console.warn('[activator] Endpoint Watch ended:', err instanceof Error ? err.message : String(err))
            }
          },
        )
      } catch (err) {
        if (stopped) return
        console.warn('[activator] Endpoint Watch error, reconnecting:', err instanceof Error ? err.message : String(err))
      }
      if (!stopped) {
        await delay(watchReconnectDelayMs)
      }
    }
  }

  return {
    start() {
      if (started || stopped) return
      started = true
      // Fire and forget — reconnect loops run in background
      void watchDeployments()
      void watchEndpoints()
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

    async patchReplicas(namespace: string, deploymentName: string, replicas: number): Promise<void> {
      // ObjectParamAPI request object; library selects application/merge-patch+json automatically
      await appsApi.patchNamespacedDeployment({ name: deploymentName, namespace, body: { spec: { replicas } } })
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
    },
  }
}

/**
 * HTTP reverse proxy used by the activator.
 *
 * proxyRequest() streams a client request to an upstream URL and pipes the
 * response back. It does not buffer the body — chunked transfer is preserved.
 *
 * Used for both the warm-tenant fast path (direct proxy to tenant Service)
 * and the cold-start path (called after waitForReadyEndpoint resolves).
 *
 * Retry behaviour
 * ---------------
 * After a cold-start wake, kube-proxy may still be reconciling its iptables
 * rules even though the Endpoints subset.addresses is already populated. During
 * this ~100–500 ms window the ClusterIP has zero backends and the kernel returns
 * RST, producing ECONNREFUSED or ENETUNREACH depending on how far iptables has
 * converged. proxyRequest retries up to 3 attempts total on TCP-level connect
 * errors (ECONNREFUSED, ECONNRESET, EHOSTUNREACH, ENETUNREACH) so the request
 * survives the race.
 *
 * Retries are restricted to body-less HTTP methods (GET, HEAD) — body-bearing
 * methods (POST, PUT, PATCH, DELETE, …) cannot be safely replayed once the
 * request body pipe has started. Retries are also skipped once any response
 * data has been written to the client (writeHead fires only when upstream
 * responds, not on connect failure, so this guard is automatic).
 */

import http from 'node:http'
import https from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'

export interface ProxyTarget {
  /** e.g. "http://tenant-abc.tenant-abc.svc.cluster.local:3000" */
  url: string
}

/** Error codes that indicate a transient kube-proxy / endpoint-race failure. */
const RETRYABLE_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH'])

/** HTTP methods that have no request body and are safe to replay. */
const BODYLESS_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE'])

/**
 * Backoff schedule in milliseconds. Index 0 = delay before attempt 2,
 * index 1 = delay before attempt 3. Exported for test overriding.
 * Worst-case additional wait with MAX_ATTEMPTS=3: 100+300 = 400ms.
 */
export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [100, 300]

const MAX_ATTEMPTS = 3

/** Minimal abstraction over http.request / https.request — injectable in tests. */
export type RequestFactory = typeof http.request

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Forward `clientReq` to `target.url` and pipe the upstream response into
 * `clientRes`. The original Host header is preserved so the upstream can
 * identify the tenant.
 *
 * Resolves when the response has been fully piped (or the upstream closes the
 * connection). Rejects on network error.
 *
 * @param retryDelaysMs - Override the backoff schedule (test seam).
 * @param requestFactory - Override the underlying http.request (test seam).
 */
export function proxyRequest(
  clientReq: IncomingMessage,
  clientRes: ServerResponse,
  target: ProxyTarget,
  retryDelaysMs: readonly number[] = DEFAULT_RETRY_DELAYS_MS,
  requestFactory?: RequestFactory,
): Promise<void> {
  const targetUrl = new URL(target.url)
  const isHttps = targetUrl.protocol === 'https:'
  const makeRequest = requestFactory ?? (isHttps ? https.request : http.request)

  const method = clientReq.method ?? 'GET'
  const canRetry = BODYLESS_METHODS.has(method.toUpperCase())
  const totalAttempts = canRetry ? MAX_ATTEMPTS : 1

  const upstreamOptions: http.RequestOptions = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || (isHttps ? 443 : 80),
    path: clientReq.url ?? '/',
    method,
    headers: {
      ...clientReq.headers,
      // Preserve the original Host header so the upstream can identify the
      // tenant by subdomain (activator is Pattern B: sole IngressRoute backend).
      host: clientReq.headers['host'] ?? targetUrl.hostname,
    },
  }

  async function attempt(attemptNumber: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const upstreamReq = makeRequest(upstreamOptions, (upstreamRes) => {
        clientRes.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers)
        upstreamRes.pipe(clientRes)
        upstreamRes.on('end', resolve)
        upstreamRes.on('error', reject)
      })

      upstreamReq.setTimeout(30_000, () => {
        upstreamReq.destroy(new Error('upstream timeout'))
      })

      upstreamReq.on('error', (err: NodeJS.ErrnoException) => {
        const code = err.code ?? ''
        if (attemptNumber < totalAttempts && RETRYABLE_CODES.has(code)) {
          // Let the outer async loop handle the retry. Resolve this attempt's
          // promise via reject so the loop can catch and continue.
          reject(Object.assign(err, { _retryable: true }))
        } else {
          reject(err)
        }
      })

      // Stream client body to upstream; pipe() ends upstreamReq automatically.
      // For body-less methods this is a no-op read on an already-ended stream.
      clientReq.pipe(upstreamReq)
      clientReq.on('error', (err) => {
        upstreamReq.destroy(err)
        reject(err)
      })
    })
  }

  return (async () => {
    for (let i = 1; i <= totalAttempts; i++) {
      try {
        await attempt(i)
        return
      } catch (err: unknown) {
        const isRetryable = (err as { _retryable?: boolean })._retryable === true
        if (!isRetryable || i >= totalAttempts) {
          throw err
        }
        const delayMs = retryDelaysMs[i - 1] ?? 700
        console.debug('[activator] retry %d for %s after %s', i, target.url, (err as Error).message)
        await sleep(delayMs)
      }
    }
  })()
}

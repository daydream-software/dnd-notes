/**
 * HTTP reverse proxy used by the activator.
 *
 * proxyRequest() streams a client request to an upstream URL and pipes the
 * response back. It does not buffer the body — chunked transfer is preserved.
 *
 * Used for both the warm-tenant fast path (direct proxy to tenant Service)
 * and the cold-start path (called after waitForReadyEndpoint resolves).
 */

import http from 'node:http'
import https from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'

export interface ProxyTarget {
  /** e.g. "http://tenant-abc.tenant-abc.svc.cluster.local:3000" */
  url: string
}

/**
 * Forward `clientReq` to `target.url` and pipe the upstream response into
 * `clientRes`. The original Host header is preserved so the upstream can
 * identify the tenant.
 *
 * Resolves when the response has been fully piped (or the upstream closes the
 * connection). Rejects on network error.
 */
export function proxyRequest(
  clientReq: IncomingMessage,
  clientRes: ServerResponse,
  target: ProxyTarget,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const targetUrl = new URL(target.url)
    const isHttps = targetUrl.protocol === 'https:'
    const makeRequest = isHttps ? https.request : http.request

    const upstreamOptions: http.RequestOptions = {
      hostname: targetUrl.hostname,
      port: targetUrl.port || (isHttps ? 443 : 80),
      path: clientReq.url ?? '/',
      method: clientReq.method ?? 'GET',
      headers: {
        ...clientReq.headers,
        // Preserve the original Host header so the upstream can identify the
        // tenant by subdomain (activator is Pattern B: sole IngressRoute backend).
        host: clientReq.headers['host'] ?? targetUrl.hostname,
      },
    }

    const upstreamReq = makeRequest(upstreamOptions, (upstreamRes) => {
      clientRes.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers)
      upstreamRes.pipe(clientRes)
      upstreamRes.on('end', resolve)
      upstreamRes.on('error', reject)
    })

    upstreamReq.on('error', reject)

    // Stream client body to upstream
    clientReq.pipe(upstreamReq)
    clientReq.on('end', () => {
      upstreamReq.end()
    })
    clientReq.on('error', (err) => {
      upstreamReq.destroy(err)
      reject(err)
    })
  })
}

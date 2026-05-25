/**
 * Classify an incoming request as a top-level browser navigation or not, to
 * decide the cold-start UX: navigations can be shown an interstitial / held;
 * everything else (XHR/fetch, API, non-GET) gets a machine-readable response.
 *
 * Default-safe: when the signals are ambiguous, treat the request as NOT a
 * navigation. Serving an HTML page to an API/XHR client would break it
 * silently, which is worse than the alternative.
 */

import type { IncomingHttpHeaders, IncomingMessage } from 'node:http'

function firstHeader(value: IncomingHttpHeaders[string]): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export function isNavigationRequest(req: Pick<IncomingMessage, 'method' | 'headers'>): boolean {
  // Modern browsers send Sec-Fetch-Mode on every request — trust it when present.
  // A navigation (address bar, link, reload) is 'navigate'; XHR/fetch are
  // 'cors' / 'no-cors' / 'same-origin'.
  const secFetchMode = firstHeader(req.headers['sec-fetch-mode'])
  if (secFetchMode !== undefined) {
    return secFetchMode === 'navigate'
  }

  // No Sec-Fetch-* headers (older browser / non-browser client): fall back to a
  // conservative heuristic — a GET asking for HTML, not flagged as an XHR.
  if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
    return false
  }
  if (firstHeader(req.headers['x-requested-with']) !== undefined) {
    return false
  }
  return (firstHeader(req.headers['accept']) ?? '').includes('text/html')
}

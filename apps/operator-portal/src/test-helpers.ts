/**
 * Build a minimal JWT string (header.payload.sig) for use in tests.
 * The signature is a placeholder — these tokens are never verified in unit tests.
 */
export function makeJwt(payload: Record<string, unknown>): string {
  const encode = (obj: Record<string, unknown>) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const header = encode({ alg: 'RS256', typ: 'JWT' })
  const body = encode(payload)
  return `${header}.${body}.sig`
}

export function createJsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function readMockRequest(input: RequestInfo | URL, init?: RequestInit) {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url
  const parsedUrl = new URL(url, 'http://localhost')

  return {
    url,
    path: parsedUrl.pathname,
    method: init?.method?.toUpperCase() ?? 'GET',
  }
}

export function readMockJsonBody<T>(init?: RequestInit) {
  if (!init?.body) {
    return null
  }

  if (typeof init.body !== 'string') {
    throw new Error('Mock request body must be a JSON string in tests.')
  }

  return JSON.parse(init.body) as T
}

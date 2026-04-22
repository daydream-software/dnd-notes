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

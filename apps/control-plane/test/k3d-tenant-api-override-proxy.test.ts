import assert from 'node:assert'
import http from 'node:http'
import { once } from 'node:events'
import { describe, it } from 'node:test'
import proxyModule from '../../../scripts/k3d/tenant-api-override-proxy.js'

const { classifyTenantApiOverrideTarget, createTenantApiOverrideProxy } = proxyModule

async function listen(server: http.Server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')

  const address = server.address()
  assert(address && typeof address === 'object')

  return `http://127.0.0.1:${address.port}`
}

async function close(server: http.Server) {
  server.close()
  await once(server, 'close')
}

async function sendRequest(url: string) {
  return new Promise<{
    statusCode?: number
    body: string
    aborted?: boolean
    error?: Error
  }>((resolve) => {
    const request = http.get(url, (response) => {
      response.setEncoding('utf8')

      let body = ''
      let settled = false
      const settle = (result: {
        statusCode?: number
        body: string
        aborted?: boolean
        error?: Error
      }) => {
        if (settled) {
          return
        }

        settled = true
        resolve(result)
      }

      response.on('data', (chunk) => {
        body += chunk
      })
      response.on('end', () => settle({ statusCode: response.statusCode, body }))
      response.on('aborted', () =>
        settle({ statusCode: response.statusCode, body, aborted: true }),
      )
      response.on('error', (error) =>
        settle({
          statusCode: response.statusCode,
          body,
          error: error instanceof Error ? error : new Error(String(error)),
        }),
      )
      response.on('close', () => settle({ statusCode: response.statusCode, body }))
    })

    request.on('error', (error) =>
      resolve({
        body: '',
        error: error instanceof Error ? error : new Error(String(error)),
      }),
    )
  })
}

describe('tenant API override proxy routing', () => {
  it('routes tenant API and probe paths to the local API process', () => {
    for (const pathname of [
      '/api',
      '/api/auth/config',
      '/api/campaigns',
      '/ready',
      '/readyz',
      '/health',
      '/healthz',
    ]) {
      assert.equal(classifyTenantApiOverrideTarget(pathname), 'local-api')
    }
  })

  it('keeps browser document and asset requests on the k3d tenant host', () => {
    for (const pathname of ['/', '/index.html', '/assets/index.js', '/share/demo']) {
      assert.equal(classifyTenantApiOverrideTarget(pathname), 'tenant-cluster')
    }
  })

  it('normalizes traversal segments before deciding whether a path belongs to the local API', () => {
    assert.equal(classifyTenantApiOverrideTarget('/api/../admin'), 'tenant-cluster')
    assert.equal(
      classifyTenantApiOverrideTarget('/assets/../api/auth/config'),
      'local-api',
    )
  })

  it('keeps serving new requests after an upstream stream fails mid-response', async () => {
    const originalFetch = globalThis.fetch
    let requestCount = 0

    globalThis.fetch = async () => {
      requestCount += 1

      if (requestCount === 1) {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('partial'))
              queueMicrotask(() =>
                controller.error(new Error('upstream stream failed mid-response')),
              )
            },
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'text/plain',
            },
          },
        )
      }

      return new Response('ok', {
        status: 200,
        headers: {
          'Content-Type': 'text/plain',
        },
      })
    }

    const server = createTenantApiOverrideProxy({
      tenantOrigin: 'http://tenant.example.test',
      localApiOrigin: 'http://local-api.example.test',
    })

    try {
      const origin = await listen(server)
      const failedStreamResponse = await sendRequest(`${origin}/`)
      const streamFailedAfterHeaders = [
        failedStreamResponse.aborted === true,
        failedStreamResponse.error !== undefined,
        failedStreamResponse.body === 'partial',
      ].includes(true)
      assert(
        streamFailedAfterHeaders,
        'expected the failed stream response to terminate early after the upstream stream failed',
      )

      const healthyResponse = await sendRequest(`${origin}/api/auth/config`)
      assert.deepEqual(healthyResponse, {
        statusCode: 200,
        body: 'ok',
      })
    } finally {
      globalThis.fetch = originalFetch
      await close(server)
    }
  })
})

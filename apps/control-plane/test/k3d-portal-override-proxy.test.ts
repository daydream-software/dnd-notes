import assert from 'node:assert'
import http from 'node:http'
import { once } from 'node:events'
import { describe, it } from 'node:test'
import proxyModule from '../../../scripts/k3d/portal-override-proxy.js'

const { classifyPortalOverrideTarget, createPortalOverrideProxy, portalOverrideHeaderName } =
  proxyModule

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
    headers: http.IncomingHttpHeaders
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
        headers: http.IncomingHttpHeaders
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
      response.on('end', () =>
        settle({ statusCode: response.statusCode, headers: response.headers, body }),
      )
      response.on('aborted', () =>
        settle({
          statusCode: response.statusCode,
          headers: response.headers,
          body,
          aborted: true,
        }),
      )
      response.on('error', (error) =>
        settle({
          statusCode: response.statusCode,
          headers: response.headers,
          body,
          error: error instanceof Error ? error : new Error(String(error)),
        }),
      )
      response.on('close', () =>
        settle({ statusCode: response.statusCode, headers: response.headers, body }),
      )
    })

    request.on('error', (error) =>
      resolve({
        body: '',
        headers: {},
        error: error instanceof Error ? error : new Error(String(error)),
      }),
    )
  })
}

describe('portal override proxy classification', () => {
  it('classifies /env.js as injected-env', () => {
    assert.equal(classifyPortalOverrideTarget('/env.js', '/operator-api'), 'injected-env')
  })

  it('classifies exact apiPath match as k3d-api', () => {
    assert.equal(classifyPortalOverrideTarget('/operator-api', '/operator-api'), 'k3d-api')
  })

  it('classifies paths under apiPath as k3d-api', () => {
    assert.equal(
      classifyPortalOverrideTarget('/operator-api/tenants', '/operator-api'),
      'k3d-api',
    )
  })

  it('classifies root / as local-vite', () => {
    assert.equal(classifyPortalOverrideTarget('/', '/operator-api'), 'local-vite')
  })

  it('classifies asset paths as local-vite', () => {
    assert.equal(
      classifyPortalOverrideTarget('/assets/index.js', '/operator-api'),
      'local-vite',
    )
  })
})

describe('portal override proxy integration', () => {
  it('serves /env.js with injected env content and correct Content-Type', async () => {
    const proxy = createPortalOverrideProxy({
      k3dApiOrigin: 'http://127.0.0.1:1',
      localViteOrigin: 'http://127.0.0.1:1',
      apiPath: '/operator-api',
      envJs: 'window.__ENV__ = {};',
    })

    try {
      const origin = await listen(proxy)
      const response = await sendRequest(`${origin}/env.js`)

      assert.equal(response.statusCode, 200)
      assert.equal(response.body, 'window.__ENV__ = {};')
      assert.equal(response.headers['content-type'], 'application/javascript')
      assert.equal(response.headers[portalOverrideHeaderName], 'injected-env')
    } finally {
      await close(proxy)
    }
  })

  it('routes /operator-api/* to the k3d-api backend and not to local-vite', async () => {
    const k3dApiServer = http.createServer((_req, res) => {
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ source: 'k3d-api' }))
    })

    const localViteServer = http.createServer((_req, res) => {
      res.statusCode = 200
      res.setHeader('Content-Type', 'text/html')
      res.end('<html>vite</html>')
    })

    try {
      const k3dApiOrigin = await listen(k3dApiServer)
      const localViteOrigin = await listen(localViteServer)

      const proxy = createPortalOverrideProxy({
        k3dApiOrigin,
        localViteOrigin,
        apiPath: '/operator-api',
        envJs: 'window.__ENV__ = {};',
      })

      try {
        const origin = await listen(proxy)
        const response = await sendRequest(`${origin}/operator-api/tenants`)

        assert.equal(response.statusCode, 200)
        assert(
          response.body.includes('k3d-api'),
          `expected response from k3d-api backend, got: ${response.body}`,
        )
        assert.equal(response.headers[portalOverrideHeaderName], 'k3d-api')
      } finally {
        await close(proxy)
      }
    } finally {
      await close(k3dApiServer)
      await close(localViteServer)
    }
  })

  it('routes / to the local-vite backend and not to k3d-api', async () => {
    const k3dApiServer = http.createServer((_req, res) => {
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ source: 'k3d-api' }))
    })

    const localViteServer = http.createServer((_req, res) => {
      res.statusCode = 200
      res.setHeader('Content-Type', 'text/html')
      res.end('<html>vite</html>')
    })

    try {
      const k3dApiOrigin = await listen(k3dApiServer)
      const localViteOrigin = await listen(localViteServer)

      const proxy = createPortalOverrideProxy({
        k3dApiOrigin,
        localViteOrigin,
        apiPath: '/operator-api',
        envJs: 'window.__ENV__ = {};',
      })

      try {
        const origin = await listen(proxy)
        const response = await sendRequest(`${origin}/`)

        assert.equal(response.statusCode, 200)
        assert(
          response.body.includes('vite'),
          `expected response from local-vite backend, got: ${response.body}`,
        )
        assert.equal(response.headers[portalOverrideHeaderName], 'local-vite')
      } finally {
        await close(proxy)
      }
    } finally {
      await close(k3dApiServer)
      await close(localViteServer)
    }
  })

  it('responds 502 when the upstream backend is unreachable', async () => {
    // Use port 1 which is a closed port guaranteed to refuse connections.
    const proxy = createPortalOverrideProxy({
      k3dApiOrigin: 'http://127.0.0.1:1',
      localViteOrigin: 'http://127.0.0.1:1',
      apiPath: '/operator-api',
      envJs: 'window.__ENV__ = {};',
    })

    try {
      const origin = await listen(proxy)
      const response = await sendRequest(`${origin}/`)

      assert.equal(response.statusCode, 502)
    } finally {
      await close(proxy)
    }
  })

  it('includes the override target header in proxied responses', async () => {
    const backendServer = http.createServer((_req, res) => {
      res.statusCode = 200
      res.setHeader('Content-Type', 'text/plain')
      res.end('ok')
    })

    try {
      const backendOrigin = await listen(backendServer)

      const proxy = createPortalOverrideProxy({
        k3dApiOrigin: backendOrigin,
        localViteOrigin: backendOrigin,
        apiPath: '/operator-api',
        envJs: 'window.__ENV__ = {};',
      })

      try {
        const origin = await listen(proxy)

        const apiResponse = await sendRequest(`${origin}/operator-api/foo`)
        assert.equal(
          apiResponse.headers[portalOverrideHeaderName],
          'k3d-api',
          'expected override target header on k3d-api response',
        )

        const viteResponse = await sendRequest(`${origin}/`)
        assert.equal(
          viteResponse.headers[portalOverrideHeaderName],
          'local-vite',
          'expected override target header on local-vite response',
        )

        const envResponse = await sendRequest(`${origin}/env.js`)
        assert.equal(
          envResponse.headers[portalOverrideHeaderName],
          'injected-env',
          'expected override target header on injected-env response',
        )
      } finally {
        await close(proxy)
      }
    } finally {
      await close(backendServer)
    }
  })
})

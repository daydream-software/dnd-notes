#!/usr/bin/env node
const http = require('node:http')
const net = require('node:net')
const { pipeline } = require('node:stream/promises')
const { Readable } = require('node:stream')

const portalOverrideHeaderName = 'x-dnd-notes-override-target'

function classifyPortalOverrideTarget(pathname, apiPath) {
  const normalizedPathname = new URL(pathname, 'http://127.0.0.1').pathname

  if (normalizedPathname === '/env.js') {
    return 'injected-env'
  }

  if (
    normalizedPathname === apiPath ||
    normalizedPathname.startsWith(`${apiPath}/`)
  ) {
    return 'k3d-api'
  }

  return 'local-vite'
}

function createTargetUrl(requestUrl, targetOrigin) {
  const parsedRequestUrl = new URL(requestUrl, 'http://127.0.0.1')
  return new URL(`${parsedRequestUrl.pathname}${parsedRequestUrl.search}`, targetOrigin)
}

async function readRequestBody(request) {
  const chunks = []

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  return chunks.length > 0 ? Buffer.concat(chunks) : null
}

function copyRequestHeaders(headers) {
  const nextHeaders = new Headers()

  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue
    }

    if (
      name.toLowerCase() === 'host' ||
      name.toLowerCase() === 'connection' ||
      name.toLowerCase() === 'transfer-encoding' ||
      name.toLowerCase() === 'content-length'
    ) {
      continue
    }

    if (Array.isArray(value)) {
      nextHeaders.set(name, value.join(', '))
      continue
    }

    nextHeaders.set(name, value)
  }

  return nextHeaders
}

function copyResponseHeaders(response, reply) {
  for (const [name, value] of response.headers.entries()) {
    const lowerName = name.toLowerCase()
    if (
      lowerName === 'connection' ||
      lowerName === 'transfer-encoding' ||
      lowerName === 'content-length'
    ) {
      continue
    }

    if (lowerName === 'set-cookie' && typeof response.headers.getSetCookie === 'function') {
      reply.setHeader(name, response.headers.getSetCookie())
      continue
    }

    reply.setHeader(name, value)
  }
}

function createPortalOverrideProxy(options) {
  const server = http.createServer(async (request, reply) => {
    try {
      const requestPath = request.url ?? '/'
      const parsedRequestUrl = new URL(requestPath, 'http://127.0.0.1')
      const targetKind = classifyPortalOverrideTarget(parsedRequestUrl.pathname, options.apiPath)

      if (targetKind === 'injected-env') {
        reply.statusCode = 200
        reply.setHeader('Content-Type', 'application/javascript')
        reply.setHeader(portalOverrideHeaderName, targetKind)
        reply.end(options.envJs)
        return
      }

      const targetOrigin =
        targetKind === 'k3d-api' ? options.k3dApiOrigin : options.localViteOrigin
      const targetUrl = createTargetUrl(requestPath, targetOrigin)
      const body = await readRequestBody(request)
      const response = await fetch(targetUrl, {
        method: request.method ?? 'GET',
        headers: copyRequestHeaders(request.headers),
        ...(body ? { body } : {}),
      })

      reply.statusCode = response.status
      copyResponseHeaders(response, reply)
      reply.setHeader(portalOverrideHeaderName, targetKind)

      if (!response.body) {
        reply.end()
        return
      }

      await pipeline(Readable.fromWeb(response.body), reply)
    } catch (error) {
      console.error('[portal-override-proxy] upstream error:', error)

      if (reply.headersSent) {
        reply.destroy(error instanceof Error ? error : undefined)
        return
      }

      reply.statusCode = 502
      reply.setHeader('Content-Type', 'application/json')
      reply.end(
        JSON.stringify({
          error: 'Portal override proxy request failed.',
        }),
      )
    }
  })

  // Forward WebSocket upgrades (Vite HMR) directly to the local Vite server.
  server.on('upgrade', (request, socket, head) => {
    const target = new URL(options.localViteOrigin)
    const conn = net.createConnection({ port: Number(target.port), host: target.hostname })

    socket.on('error', () => conn.destroy())
    conn.on('error', () => socket.destroy())

    conn.once('connect', () => {
      const reqLine = `${request.method ?? 'GET'} ${request.url ?? '/'} HTTP/1.1\r\n`
      const headers = Object.entries(request.headers)
        .filter(([name]) => name.toLowerCase() !== 'host')
        .map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(', ') : value}`)
        .join('\r\n')
      conn.write(`${reqLine}Host: ${target.host}\r\n${headers}\r\n\r\n`)
      if (head.length > 0) conn.write(head)
      socket.pipe(conn)
      conn.pipe(socket)
    })
  })

  return server
}

// Allowlist: localhost, loopback IPs, or *.127.0.0.1.nip.io used by k3d ingress.
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.127\.0\.0\.1\.nip\.io)(:\d+)?$/

function assertLocalOrigin(value, name) {
  if (!LOCAL_ORIGIN.test(value)) {
    throw new Error(
      `${name} must target a local dev address (got ${JSON.stringify(value)}). This proxy only forwards to local dev servers.`,
    )
  }
}

async function main() {
  const listenPort = Number(process.env.K3D_PORTAL_OVERRIDE_LISTEN_PORT ?? 38080)
  const k3dApiOrigin = process.env.K3D_PORTAL_OVERRIDE_K3D_API_ORIGIN
  const localViteOrigin =
    process.env.K3D_PORTAL_OVERRIDE_LOCAL_VITE_ORIGIN ?? 'http://127.0.0.1:5173'
  const apiPath = process.env.K3D_PORTAL_OVERRIDE_API_PATH ?? '/operator-api'
  const envJs = process.env.K3D_PORTAL_OVERRIDE_ENV_JS ?? 'window.__ENV__ = {};'

  if (!k3dApiOrigin) {
    throw new Error(
      'K3D_PORTAL_OVERRIDE_K3D_API_ORIGIN is required (for example https://control-plane.127.0.0.1.nip.io).',
    )
  }

  assertLocalOrigin(k3dApiOrigin, 'K3D_PORTAL_OVERRIDE_K3D_API_ORIGIN')
  assertLocalOrigin(localViteOrigin, 'K3D_PORTAL_OVERRIDE_LOCAL_VITE_ORIGIN')

  const server = createPortalOverrideProxy({
    k3dApiOrigin,
    localViteOrigin,
    apiPath,
    envJs,
  })

  await new Promise((resolve) => server.listen(listenPort, '127.0.0.1', resolve))
  console.error(`Portal override proxy listening on http://127.0.0.1:${listenPort}`)
  console.error(`- local vite upstream: ${localViteOrigin}`)
  console.error(`- k3d api upstream:    ${k3dApiOrigin}`)
  console.error(`- api path:            ${apiPath}`)

  const stopServer = () => {
    server.close(() => process.exit(0))
  }

  process.on('SIGINT', stopServer)
  process.on('SIGTERM', stopServer)
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}

module.exports = {
  classifyPortalOverrideTarget,
  createPortalOverrideProxy,
  portalOverrideHeaderName,
}

#!/usr/bin/env node
const http = require('node:http')
const { pipeline } = require('node:stream/promises')
const { Readable } = require('node:stream')

const tenantApiOverrideHeaderName = 'x-dnd-notes-override-target'

function classifyTenantApiOverrideTarget(pathname) {
  const normalizedPathname = new URL(pathname, 'http://127.0.0.1').pathname

  if (
    normalizedPathname === '/api' ||
    normalizedPathname.startsWith('/api/') ||
    normalizedPathname === '/ready' ||
    normalizedPathname === '/readyz' ||
    normalizedPathname === '/health' ||
    normalizedPathname === '/healthz'
  ) {
    return 'local-api'
  }

  return 'tenant-cluster'
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
    if (
      name.toLowerCase() === 'connection' ||
      name.toLowerCase() === 'transfer-encoding'
    ) {
      continue
    }

    reply.setHeader(name, value)
  }
}

function createTenantApiOverrideProxy(options) {
  return http.createServer(async (request, reply) => {
    try {
      const requestPath = request.url ?? '/'
      const parsedRequestUrl = new URL(requestPath, 'http://127.0.0.1')
      const targetKind = classifyTenantApiOverrideTarget(parsedRequestUrl.pathname)
      const targetOrigin =
        targetKind === 'local-api' ? options.localApiOrigin : options.tenantOrigin
      const targetUrl = createTargetUrl(requestPath, targetOrigin)
      const body = await readRequestBody(request)
      const response = await fetch(targetUrl, {
        method: request.method ?? 'GET',
        headers: copyRequestHeaders(request.headers),
        ...(body ? { body } : {}),
      })

      reply.statusCode = response.status
      copyResponseHeaders(response, reply)
      reply.setHeader(tenantApiOverrideHeaderName, targetKind)

      if (!response.body) {
        reply.end()
        return
      }

      await pipeline(Readable.fromWeb(response.body), reply)
    } catch (error) {
      if (reply.headersSent) {
        reply.destroy(error instanceof Error ? error : undefined)
        return
      }

      reply.statusCode = 502
      reply.setHeader('Content-Type', 'application/json')
      reply.end(
        JSON.stringify({
          error: 'Tenant API override proxy request failed.',
          details: [error instanceof Error ? error.message : String(error)],
        }),
      )
    }
  })
}

async function main() {
  const listenPort = Number(process.env.K3D_TENANT_OVERRIDE_LISTEN_PORT ?? 38080)
  const tenantOrigin = process.env.K3D_TENANT_OVERRIDE_TENANT_ORIGIN
  const localApiOrigin =
    process.env.K3D_TENANT_OVERRIDE_LOCAL_API_ORIGIN ?? 'http://127.0.0.1:3001'

  if (!tenantOrigin) {
    throw new Error(
      'K3D_TENANT_OVERRIDE_TENANT_ORIGIN is required (for example http://t-tenant.127.0.0.1.nip.io:8080).',
    )
  }

  const server = createTenantApiOverrideProxy({
    tenantOrigin,
    localApiOrigin,
  })

  await new Promise((resolve) => server.listen(listenPort, '127.0.0.1', resolve))
  console.error(`Tenant API override proxy listening on http://127.0.0.1:${listenPort}`)
  console.error(`- tenant web upstream: ${tenantOrigin}`)
  console.error(`- local API upstream: ${localApiOrigin}`)

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
  classifyTenantApiOverrideTarget,
  createTenantApiOverrideProxy,
  tenantApiOverrideHeaderName,
}

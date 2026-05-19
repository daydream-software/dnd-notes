/**
 * Tests for proxyRequest retry behaviour.
 *
 * After a cold-start wake, kube-proxy may still be reconciling its iptables
 * rules even though Endpoints is already populated. During this window the
 * ClusterIP returns ECONNREFUSED. proxyRequest retries up to 3 attempts on
 * TCP-level connect errors (ECONNREFUSED, ECONNRESET, EHOSTUNREACH).
 *
 * Two strategies:
 *  - Real localhost HTTP server: happy-path and HTTP-error cases.
 *  - Fake request factory: failure and retry count cases (no real sockets,
 *    zero-delay backoff so the test suite stays fast).
 */

import assert from 'node:assert/strict'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, it, before, after } from 'node:test'
import { proxyRequest, type RequestFactory } from '../src/proxy.js'

// ---------------------------------------------------------------------------
// Helpers: fake request factory
// ---------------------------------------------------------------------------

/**
 * A minimal fake for a Node http.ClientRequest: an EventEmitter that also
 * exposes .setTimeout(), .destroy(), and .pipe() so proxyRequest can call
 * them safely without touching the network.
 */
type FakeReqHandle = {
  fakeReq: EventEmitter & {
    setTimeout: () => void
    destroy: (err?: Error) => void
    pipe: (src: IncomingMessage) => void
  }
  emitConnect: (fakeRes: FakeResHandle) => void
  emitError: (err: NodeJS.ErrnoException) => void
}

type FakeResHandle = EventEmitter & {
  statusCode: number
  headers: Record<string, string>
  pipe: (dest: ServerResponse) => void
}

function makeFakeReq(): FakeReqHandle {
  const fakeReq = Object.assign(new EventEmitter(), {
    setTimeout() {},
    destroy(_err?: Error) {},
    // write/end are called by stream.pipe() when the source drains/ends.
    write(_chunk: unknown, _enc?: unknown, cb?: () => void) { if (typeof cb === 'function') cb() },
    end(_chunk?: unknown, _enc?: unknown, cb?: () => void) { if (typeof cb === 'function') cb() },
    pipe(src: IncomingMessage) {
      // Resume the source so it doesn't block the event loop.
      src.resume()
    },
  })

  return {
    fakeReq,
    emitConnect(fakeRes: FakeResHandle) {
      fakeReq.emit('_response', fakeRes)
    },
    emitError(err: NodeJS.ErrnoException) {
      fakeReq.emit('error', err)
    },
  }
}

/**
 * Build a fake response that looks enough like IncomingMessage for
 * proxyRequest: statusCode, headers, pipe(), and automatic 'end'.
 */
function makeFakeRes(statusCode = 200): FakeResHandle {
  return Object.assign(new EventEmitter(), {
    statusCode,
    headers: { 'content-type': 'text/plain' } as Record<string, string>,
    pipe(dest: ServerResponse) {
      dest.end('ok')
      // Emit 'end' so proxyRequest's upstreamRes.on('end', resolve) fires.
      setImmediate(() => this.emit('end'))
    },
  }) as FakeResHandle
}

/**
 * Build a factory that returns a pre-configured sequence of fake requests.
 * Each call pops the next entry and calls its setup callback to schedule the
 * error or response. The response callback passed by proxyRequest is wired up
 * via the '_response' event so emitConnect can invoke it.
 */
function makeSequenceFactory(
  entries: Array<(handle: FakeReqHandle) => void>,
): { factory: RequestFactory; callCount: () => number } {
  let count = 0
  const queue = [...entries]

  const factory: RequestFactory = (_opts, responseCallback) => {
    count++
    const handle = makeFakeReq()

    const setup = queue.shift()
    if (!setup) throw new Error('factory called more times than expected')

    handle.fakeReq.on('_response', (fakeRes: FakeResHandle) => {
      responseCallback?.(fakeRes as unknown as IncomingMessage)
    })

    setup(handle)

    return handle.fakeReq as unknown as http.ClientRequest
  }

  return { factory, callCount: () => count }
}

/** Make a minimal IncomingMessage-like for GET/POST test requests. */
function makeClientReq(method = 'GET'): IncomingMessage {
  // PassThrough that is already ended — safe to pipe multiple times from
  // proxyRequest's perspective (each retry gets its own upstream, but the
  // source is the same object; for body-less methods this is fine).
  const body = new PassThrough()
  body.end()

  return Object.assign(body, {
    method,
    url: '/',
    headers: { host: 'tenant-test.notes.example.com' } as http.IncomingHttpHeaders,
    httpVersion: '1.1',
    httpVersionMajor: 1,
    httpVersionMinor: 1,
    trailers: {},
    rawTrailers: [],
    rawHeaders: [],
    socket: null,
    complete: false,
    aborted: false,
    statusCode: null,
    statusMessage: null,
    destroy() { return this },
  }) as unknown as IncomingMessage
}

/** Minimal ServerResponse substitute that captures writeHead / end calls. */
function makeClientRes(): {
  res: ServerResponse
  getStatusCode: () => number | undefined
  getBody: () => string
} {
  let statusCode: number | undefined
  let body = ''

  const res = Object.assign(new EventEmitter(), {
    headersSent: false,
    writeHead(code: number) {
      statusCode = code
      ;(res as unknown as { headersSent: boolean }).headersSent = true
    },
    write(chunk: Buffer | string) { body += chunk.toString() },
    end(chunk?: Buffer | string) { if (chunk) body += chunk.toString() },
  }) as unknown as ServerResponse

  return { res, getStatusCode: () => statusCode, getBody: () => body }
}

// Zero-delay backoff: makes retry tests instant.
const ZERO_DELAYS: readonly number[] = [0, 0, 0]

// ---------------------------------------------------------------------------
// Tests: fake-factory cases (retry count, error discrimination)
// ---------------------------------------------------------------------------

describe('proxyRequest (fake factory)', () => {
  it('success on first attempt — no retry, single upstream call', async () => {
    const { factory, callCount } = makeSequenceFactory([
      (handle) => {
        setImmediate(() => handle.emitConnect(makeFakeRes(200)))
      },
    ])

    const { res } = makeClientRes()
    await proxyRequest(makeClientReq(), res, { url: 'http://10.43.43.59:3000' }, ZERO_DELAYS, factory)

    assert.equal(callCount(), 1, 'should make exactly one upstream request on success')
  })

  it('ECONNREFUSED on attempts 1–2, success on attempt 3 — 3 upstream calls, response forwarded', async () => {
    const connRefused = Object.assign(
      new Error('connect ECONNREFUSED 10.43.43.59:3000'),
      { code: 'ECONNREFUSED' },
    ) as NodeJS.ErrnoException

    const { factory, callCount } = makeSequenceFactory([
      (handle) => { setImmediate(() => handle.emitError(connRefused)) },
      (handle) => { setImmediate(() => handle.emitError(connRefused)) },
      (handle) => { setImmediate(() => handle.emitConnect(makeFakeRes(200))) },
    ])

    const { res, getStatusCode } = makeClientRes()
    await proxyRequest(makeClientReq(), res, { url: 'http://10.43.43.59:3000' }, ZERO_DELAYS, factory)

    assert.equal(callCount(), 3, 'should try 3 times total')
    assert.equal(getStatusCode(), 200, 'should forward the successful response status')
  })

  it('ECONNREFUSED on all 3 attempts — caller sees the final error', async () => {
    const connRefused = Object.assign(
      new Error('connect ECONNREFUSED 10.43.43.59:3000'),
      { code: 'ECONNREFUSED' },
    ) as NodeJS.ErrnoException

    const { factory, callCount } = makeSequenceFactory([
      (handle) => { setImmediate(() => handle.emitError(connRefused)) },
      (handle) => { setImmediate(() => handle.emitError(connRefused)) },
      (handle) => { setImmediate(() => handle.emitError(connRefused)) },
    ])

    const { res } = makeClientRes()
    await assert.rejects(
      () => proxyRequest(makeClientReq(), res, { url: 'http://10.43.43.59:3000' }, ZERO_DELAYS, factory),
      (err: Error) => {
        // Message must contain ECONNREFUSED so the index.ts caller-side
        // string match (`err.message.includes('ECONNREFUSED')`) continues to
        // work without any change.
        assert.ok(err.message.includes('ECONNREFUSED'), `unexpected message: ${err.message}`)
        return true
      },
    )
    assert.equal(callCount(), 3, 'all 3 attempts must be exhausted before rejecting')
  })

  it('non-retryable error (ENOTFOUND) — no retry, error surfaces immediately', async () => {
    const dnsErr = Object.assign(
      new Error('getaddrinfo ENOTFOUND 10.43.43.59'),
      { code: 'ENOTFOUND' },
    ) as NodeJS.ErrnoException

    const { factory, callCount } = makeSequenceFactory([
      (handle) => { setImmediate(() => handle.emitError(dnsErr)) },
    ])

    const { res } = makeClientRes()
    await assert.rejects(
      () => proxyRequest(makeClientReq(), res, { url: 'http://10.43.43.59:3000' }, ZERO_DELAYS, factory),
      /ENOTFOUND/,
    )
    assert.equal(callCount(), 1, 'non-retryable error must not trigger a retry')
  })

  it('POST with ECONNREFUSED — no retry (body-bearing method cannot be replayed)', async () => {
    const connRefused = Object.assign(
      new Error('connect ECONNREFUSED 10.43.43.59:3000'),
      { code: 'ECONNREFUSED' },
    ) as NodeJS.ErrnoException

    const { factory, callCount } = makeSequenceFactory([
      (handle) => { setImmediate(() => handle.emitError(connRefused)) },
    ])

    const { res } = makeClientRes()
    await assert.rejects(
      () => proxyRequest(makeClientReq('POST'), res, { url: 'http://10.43.43.59:3000' }, ZERO_DELAYS, factory),
      /ECONNREFUSED/,
    )
    assert.equal(callCount(), 1, 'POST must not be retried even on ECONNREFUSED')
  })
})

// ---------------------------------------------------------------------------
// Tests: real localhost server (happy path + HTTP error forwarding)
// ---------------------------------------------------------------------------

describe('proxyRequest (real server)', () => {
  let server: http.Server
  let serverPort: number
  let upstreamHandler: (req: IncomingMessage, res: ServerResponse) => void

  before(
    () =>
      new Promise<void>((resolve) => {
        server = http.createServer((req, res) => upstreamHandler(req, res))
        server.listen(0, '127.0.0.1', () => {
          serverPort = (server.address() as { port: number }).port
          resolve()
        })
      }),
  )

  after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  )

  it('proxies a 200 response successfully', async () => {
    upstreamHandler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('hello')
    }

    const { res, getStatusCode, getBody } = makeClientRes()
    await proxyRequest(makeClientReq('GET'), res, { url: `http://127.0.0.1:${serverPort}` })

    assert.equal(getStatusCode(), 200)
    assert.equal(getBody(), 'hello')
  })

  it('forwards a 500 response without retrying', async () => {
    let upstreamCallCount = 0
    upstreamHandler = (_req, res) => {
      upstreamCallCount++
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'internal' }))
    }

    const { res, getStatusCode } = makeClientRes()
    // proxyRequest resolves (does not reject) on HTTP error responses.
    await proxyRequest(makeClientReq('GET'), res, { url: `http://127.0.0.1:${serverPort}` })

    assert.equal(getStatusCode(), 500, 'upstream 500 must be forwarded to client, not retried')
    assert.equal(upstreamCallCount, 1, 'upstream must be called exactly once — no retry on 500')
  })
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { makeRateLimiter, readPositiveIntEnv } from '../src/rate-limiters.js'

const FALLBACK = 42

test('readPositiveIntEnv — returns fallback when variable is undefined', () => {
  delete process.env['__TEST_VAR__']
  assert.equal(readPositiveIntEnv('__TEST_VAR__', FALLBACK), FALLBACK)
})

test('readPositiveIntEnv — returns fallback when variable is empty string', () => {
  process.env['__TEST_VAR__'] = ''
  assert.equal(readPositiveIntEnv('__TEST_VAR__', FALLBACK), FALLBACK)
  delete process.env['__TEST_VAR__']
})

test('readPositiveIntEnv — returns fallback when variable is non-numeric ("abc")', () => {
  process.env['__TEST_VAR__'] = 'abc'
  assert.equal(readPositiveIntEnv('__TEST_VAR__', FALLBACK), FALLBACK)
  delete process.env['__TEST_VAR__']
})

test('readPositiveIntEnv — returns fallback when variable is negative ("-5")', () => {
  process.env['__TEST_VAR__'] = '-5'
  assert.equal(readPositiveIntEnv('__TEST_VAR__', FALLBACK), FALLBACK)
  delete process.env['__TEST_VAR__']
})

test('readPositiveIntEnv — returns parsed value when variable is valid ("100")', () => {
  process.env['__TEST_VAR__'] = '100'
  assert.equal(readPositiveIntEnv('__TEST_VAR__', FALLBACK), 100)
  delete process.env['__TEST_VAR__']
})

test('readPositiveIntEnv — returns 0 when variable is "0" (zero is valid)', () => {
  process.env['__TEST_VAR__'] = '0'
  assert.equal(readPositiveIntEnv('__TEST_VAR__', FALLBACK), 0)
  delete process.env['__TEST_VAR__']
})

test('readPositiveIntEnv — returns fallback for float ("1.5")', () => {
  process.env['__TEST_VAR__'] = '1.5'
  assert.equal(readPositiveIntEnv('__TEST_VAR__', FALLBACK), FALLBACK)
  delete process.env['__TEST_VAR__']
})

test('readPositiveIntEnv — trims whitespace and returns parsed value ("  5  ")', () => {
  process.env['__TEST_VAR__'] = '  5  '
  assert.equal(readPositiveIntEnv('__TEST_VAR__', FALLBACK), 5)
  delete process.env['__TEST_VAR__']
})

test('readPositiveIntEnv — returns fallback when variable is only whitespace ("  ")', () => {
  process.env['__TEST_VAR__'] = '  '
  assert.equal(readPositiveIntEnv('__TEST_VAR__', FALLBACK), FALLBACK)
  delete process.env['__TEST_VAR__']
})

test('makeRateLimiter — limit=0 passes requests through instead of blocking all', (_, done) => {
  const middleware = makeRateLimiter({ windowMs: 60_000, limit: 0 })
  const req = { ip: '127.0.0.1', headers: {}, method: 'GET', path: '/' } as unknown as Parameters<typeof middleware>[0]
  const res = {
    setHeader: () => {},
    getHeader: () => undefined,
    status: function () { return this },
    json: function () { return this },
  } as unknown as Parameters<typeof middleware>[1]
  const next: Parameters<typeof middleware>[2] = (err?: unknown) => {
    assert.strictEqual(err, undefined, 'next(err) should not be called')
    done()
  }
  middleware(req, res, next)
})

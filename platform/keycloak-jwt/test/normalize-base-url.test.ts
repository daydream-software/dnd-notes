import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeBaseUrl } from '../src/index.js'

test('normalizeBaseUrl — correctness', async (t) => {
  await t.test('strips a single trailing slash', () => {
    assert.equal(normalizeBaseUrl('https://auth.example.com/'), 'https://auth.example.com')
  })

  await t.test('strips multiple trailing slashes', () => {
    assert.equal(normalizeBaseUrl('https://auth.example.com///'), 'https://auth.example.com')
  })

  await t.test('leaves a URL with no trailing slash unchanged', () => {
    assert.equal(
      normalizeBaseUrl('https://auth.example.com/realms/my-realm'),
      'https://auth.example.com/realms/my-realm',
    )
  })

  await t.test('handles empty string without throwing', () => {
    assert.equal(normalizeBaseUrl(''), '')
  })

  await t.test('handles a string that is only slashes', () => {
    assert.equal(normalizeBaseUrl('///'), '')
  })
})

test('normalizeBaseUrl — no catastrophic backtracking on degenerate input', () => {
  // A string with many trailing slashes is the adversarial case for a naive
  // regex-based implementation. The slice-loop must complete in constant time.
  const manySlashes = 'https://auth.example.com' + '/'.repeat(100_000)
  const start = Date.now()
  const result = normalizeBaseUrl(manySlashes)
  const elapsedMs = Date.now() - start

  assert.equal(result, 'https://auth.example.com')
  assert.ok(
    elapsedMs < 500,
    `normalizeBaseUrl took ${elapsedMs}ms on degenerate input — expected < 500ms`,
  )
})

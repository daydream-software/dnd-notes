/**
 * Tests for isNavigationRequest (#395) — the navigation vs non-navigation
 * classification that decides cold-start UX (interstitial/hold vs warming 503).
 */
import assert from 'node:assert/strict'
import type { IncomingMessage } from 'node:http'
import { describe, it } from 'node:test'
import { isNavigationRequest } from '../src/request-kind.js'

function req(
  method: string,
  headers: Record<string, string | string[] | undefined>,
): Pick<IncomingMessage, 'method' | 'headers'> {
  return { method, headers } as Pick<IncomingMessage, 'method' | 'headers'>
}

describe('isNavigationRequest', () => {
  it('Sec-Fetch-Mode: navigate is a navigation (trusted when present)', () => {
    assert.equal(isNavigationRequest(req('GET', { 'sec-fetch-mode': 'navigate' })), true)
  })

  it('Sec-Fetch-Mode: cors is not a navigation', () => {
    assert.equal(isNavigationRequest(req('GET', { 'sec-fetch-mode': 'cors' })), false)
  })

  it('Sec-Fetch-Mode: navigate wins even for POST (trusts the header)', () => {
    assert.equal(isNavigationRequest(req('POST', { 'sec-fetch-mode': 'navigate' })), true)
  })

  it('no Sec-Fetch + GET + Accept text/html → navigation (heuristic fallback)', () => {
    assert.equal(isNavigationRequest(req('GET', { accept: 'text/html,application/xhtml+xml' })), true)
  })

  it('no Sec-Fetch + GET + text/html + X-Requested-With → not a navigation (legacy XHR)', () => {
    assert.equal(
      isNavigationRequest(req('GET', { accept: 'text/html', 'x-requested-with': 'XMLHttpRequest' })),
      false,
    )
  })

  it('no Sec-Fetch + POST + text/html → not a navigation', () => {
    assert.equal(isNavigationRequest(req('POST', { accept: 'text/html' })), false)
  })

  it('no Sec-Fetch + GET + Accept application/json → not a navigation', () => {
    assert.equal(isNavigationRequest(req('GET', { accept: 'application/json' })), false)
  })

  it('no usable headers (e.g. curl Accept: */*) → not a navigation (default-safe)', () => {
    assert.equal(isNavigationRequest(req('GET', { accept: '*/*' })), false)
    assert.equal(isNavigationRequest(req('GET', {})), false)
  })

  it('reads the first value of a header array', () => {
    assert.equal(isNavigationRequest(req('GET', { 'sec-fetch-mode': ['navigate'] })), true)
  })
})

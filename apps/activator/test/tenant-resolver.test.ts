import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createTenantResolver } from '../src/tenant-resolver.js'

describe('TenantResolver', () => {
  const resolver = createTenantResolver({
    baseDomain: 'notes.daydreamsoftware.ca',
    tenantPort: 3000,
  })

  it('resolves a valid subdomain to tenant coordinates', () => {
    const coords = resolver.resolve('t1234.notes.daydreamsoftware.ca')
    assert.ok(coords)
    assert.equal(coords.subdomain, 't1234')
    assert.equal(coords.namespace, 'tenant-t1234')
    assert.equal(coords.deploymentName, 'dnd-notes')
    assert.equal(coords.serviceName, 'dnd-notes')
    assert.equal(coords.upstreamUrl, 'http://dnd-notes.tenant-t1234.svc.cluster.local:3000')
  })

  it('strips port from host header before matching', () => {
    const coords = resolver.resolve('t1234.notes.daydreamsoftware.ca:443')
    assert.ok(coords)
    assert.equal(coords.subdomain, 't1234')
  })

  it('returns null for a non-matching host', () => {
    assert.equal(resolver.resolve('other.example.com'), null)
  })

  it('returns null for a host with extra labels (not a direct tenant)', () => {
    // "a.t1234.notes.daydreamsoftware.ca" has a dot in the subdomain portion
    assert.equal(resolver.resolve('a.t1234.notes.daydreamsoftware.ca'), null)
  })

  it('returns null for an undefined host', () => {
    assert.equal(resolver.resolve(undefined), null)
  })

  it('returns null for an empty host', () => {
    assert.equal(resolver.resolve(''), null)
  })

  it('matches case-insensitively', () => {
    const coords = resolver.resolve('T1234.NOTES.DAYDREAMSOFTWARE.CA')
    assert.ok(coords)
    assert.equal(coords.subdomain, 't1234')
  })
})

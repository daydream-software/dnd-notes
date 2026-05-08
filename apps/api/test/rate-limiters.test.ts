import assert from 'node:assert/strict'
import test from 'node:test'
import { readPositiveIntEnv } from '../src/rate-limiters.js'

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

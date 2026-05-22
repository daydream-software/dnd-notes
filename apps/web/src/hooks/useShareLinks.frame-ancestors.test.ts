/**
 * Focused regression tests for the extension-checkbox compose/parse helpers
 * in useShareLinks (AboveVTT / browser-extension CSP feature).
 *
 * Covers:
 *   - composeFrameAncestors: checked box appends all three scheme-sources to the
 *     submitted value; unchecked box omits them; empty origins + checked box
 *     produces only the scheme-sources; empty everything returns null.
 *   - parseFrameAncestors: stored value containing scheme-sources sets
 *     allowExtensions = true and strips them from origins; value without
 *     scheme-sources returns allowExtensions = false and origins intact.
 */
import { describe, expect, it } from 'vitest'
import {
  composeFrameAncestors,
  parseFrameAncestors,
  EXTENSION_SCHEME_SOURCES,
} from './useShareLinks'

const [CHROME, MOZ, SAFARI] = EXTENSION_SCHEME_SOURCES

describe('composeFrameAncestors', () => {
  it('appends all three scheme-sources when allowExtensions is true', () => {
    const result = composeFrameAncestors('https://www.dndbeyond.com', true)
    expect(result).toBe(
      `https://www.dndbeyond.com ${CHROME} ${MOZ} ${SAFARI}`,
    )
  })

  it('omits scheme-sources when allowExtensions is false', () => {
    const result = composeFrameAncestors('https://www.dndbeyond.com', false)
    expect(result).toBe('https://www.dndbeyond.com')
  })

  it('returns only the scheme-sources when origins is empty and allowExtensions is true', () => {
    const result = composeFrameAncestors('', true)
    expect(result).toBe(`${CHROME} ${MOZ} ${SAFARI}`)
  })

  it('returns null when origins is empty and allowExtensions is false', () => {
    const result = composeFrameAncestors('', false)
    expect(result).toBeNull()
  })

  it('returns null when origins is whitespace-only and allowExtensions is false', () => {
    const result = composeFrameAncestors('   ', false)
    expect(result).toBeNull()
  })

  it('handles multiple origins combined with allowExtensions', () => {
    const result = composeFrameAncestors("'self' https://app.roll20.net", true)
    expect(result).toBe(
      `'self' https://app.roll20.net ${CHROME} ${MOZ} ${SAFARI}`,
    )
  })
})

describe('parseFrameAncestors', () => {
  it('returns allowExtensions = true and strips scheme-sources when all three are present', () => {
    const stored = `https://www.dndbeyond.com ${CHROME} ${MOZ} ${SAFARI}`
    const { origins, allowExtensions } = parseFrameAncestors(stored)
    expect(allowExtensions).toBe(true)
    expect(origins).toBe('https://www.dndbeyond.com')
  })

  it('returns allowExtensions = true when only chrome-extension: is present', () => {
    const { origins, allowExtensions } = parseFrameAncestors(CHROME)
    expect(allowExtensions).toBe(true)
    expect(origins).toBe('')
  })

  it('returns allowExtensions = true when only moz-extension: is present', () => {
    const { origins, allowExtensions } = parseFrameAncestors(MOZ)
    expect(allowExtensions).toBe(true)
    expect(origins).toBe('')
  })

  it('returns allowExtensions = true when only safari-web-extension: is present', () => {
    const { origins, allowExtensions } = parseFrameAncestors(SAFARI)
    expect(allowExtensions).toBe(true)
    expect(origins).toBe('')
  })

  it('returns allowExtensions = false and preserves origins when no scheme-sources are present', () => {
    const stored = 'https://www.dndbeyond.com https://app.roll20.net'
    const { origins, allowExtensions } = parseFrameAncestors(stored)
    expect(allowExtensions).toBe(false)
    expect(origins).toBe('https://www.dndbeyond.com https://app.roll20.net')
  })

  it("returns allowExtensions = false for 'none' (no scheme-sources)", () => {
    const { origins, allowExtensions } = parseFrameAncestors("'none'")
    expect(allowExtensions).toBe(false)
    expect(origins).toBe("'none'")
  })

  it('round-trips: parse then compose yields the original string', () => {
    const original = `https://www.dndbeyond.com ${CHROME} ${MOZ} ${SAFARI}`
    const { origins, allowExtensions } = parseFrameAncestors(original)
    const composed = composeFrameAncestors(origins, allowExtensions)
    // compose appends in a fixed order; original must match that order
    expect(composed).toBe(original)
  })
})

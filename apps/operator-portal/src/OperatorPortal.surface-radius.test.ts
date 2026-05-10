/**
 * Regression test for the surfaceRadius multiplier trap.
 *
 * MUI interprets a numeric `borderRadius` as `n * theme.shape.borderRadius`.
 * The project theme sets `theme.shape.borderRadius = 18`, so a numeric value of
 * 6 would produce 108px — pill territory. `surfaceRadius` must be an explicit CSS
 * string so MUI passes it through verbatim.
 *
 * See: https://github.com/FFMikha/dnd-notes/issues/174
 */
import { describe, expect, it } from 'vitest'
import { surfaceRadius } from './OperatorPortal'

describe('surfaceRadius', () => {
  it('is an explicit CSS pixel string, not a numeric MUI multiplier', () => {
    expect(typeof surfaceRadius).toBe('string')
    expect(surfaceRadius).toBe('18px')
  })
})

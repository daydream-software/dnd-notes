/**
 * Tests for the wake-retry indicator store (epic #393). Module state is global;
 * each test balances its begin/end calls so the counter returns to zero.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  beginWakeRetry,
  endWakeRetry,
  isWakeRetryActive,
  subscribeWakeRetry,
} from './wake-retry-status'

afterEach(() => {
  // Defensive: drain any imbalance so one failing test does not poison the next.
  while (isWakeRetryActive()) {
    endWakeRetry()
  }
})

describe('wake-retry-status store', () => {
  it('is inactive initially', () => {
    expect(isWakeRetryActive()).toBe(false)
  })

  it('becomes active on begin and inactive on the matching end', () => {
    beginWakeRetry()
    expect(isWakeRetryActive()).toBe(true)
    endWakeRetry()
    expect(isWakeRetryActive()).toBe(false)
  })

  it('stays active until the last concurrent retry ends (counter, not boolean)', () => {
    beginWakeRetry()
    beginWakeRetry()
    expect(isWakeRetryActive()).toBe(true)
    endWakeRetry()
    expect(isWakeRetryActive()).toBe(true)
    endWakeRetry()
    expect(isWakeRetryActive()).toBe(false)
  })

  it('end when already at zero is a no-op (no underflow)', () => {
    endWakeRetry()
    expect(isWakeRetryActive()).toBe(false)
    beginWakeRetry()
    expect(isWakeRetryActive()).toBe(true)
    endWakeRetry()
    expect(isWakeRetryActive()).toBe(false)
  })

  it('notifies subscribers only on the 0->1 and 1->0 edges', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeWakeRetry(listener)

    beginWakeRetry() // 0 -> 1 : notify
    beginWakeRetry() // 1 -> 2 : no notify
    endWakeRetry() //  2 -> 1 : no notify
    endWakeRetry() //  1 -> 0 : notify

    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it('does not notify after unsubscribe', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeWakeRetry(listener)
    unsubscribe()

    beginWakeRetry()
    endWakeRetry()

    expect(listener).not.toHaveBeenCalled()
  })
})

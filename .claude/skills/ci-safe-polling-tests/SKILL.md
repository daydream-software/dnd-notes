---
name: ci-safe-polling-tests
description: "Use when async polling tests are flaky in CI; replace brittle micro-deadlines with explicit CI-safe headroom without losing behavior assertions."
metadata:
  version: 1.0.0
disable-model-invocation: false
---

## Context

Use this when a test is verifying eventual completion after repeated async polls, but the spec fails on CI because the timeout budget is so small that scheduler overhead becomes part of the contract. The goal is to keep the real behavior under test while removing wall-clock brittleness.

## Patterns

- Keep the fake client/countdown that models several successful polls before the terminal not-found or ready state.
- Prefer increasing the overall timeout budget to a modest explicit value over rewriting production polling logic just to satisfy the test.
- Leave a very short poll interval in place when the number of loop iterations matters to the assertion.
- Assert the countdown or terminal-state marker reaches zero so the regression still proves the polling loop actually ran.
- Re-run the touched workspace's existing validation scripts after the timing change instead of inventing an ad hoc command.

## Examples

- `apps/control-plane/test/provisioning.test.ts` seeds `namespaceReadCountdown = 2`, keeps `readyPollIntervalMs = 1`, raises `deleteTimeoutMs` from `50` to `200`, then asserts the delete calls and final countdown state.
- `apps/control-plane/src/provisioning.ts` remains unchanged because the fix is in the test budget, not the production polling semantics.

## Anti-Patterns

- Encoding sub-100ms budgets that assume CI runners will schedule multiple async polls immediately.
- Changing production retry/timeout logic solely to make a fake test pass faster.
- Dropping the terminal-state assertion and calling the test "stable" even though it no longer proves the poll loop completed.

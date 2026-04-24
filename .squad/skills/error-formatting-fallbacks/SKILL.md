---
name: "error-formatting-fallbacks"
description: "Keep unknown-error formatting non-empty when callers throw blank strings."
domain: "platform"
confidence: "high"
source: "earned"
---

## Context
Use this when a service accepts `unknown` errors and turns them into log or HTTP detail strings.

## Pattern
1. Trim string throwables before returning them.
2. Treat whitespace-only strings as missing data and fall back to a stable placeholder such as `Unknown error`.
3. Add a focused regression that covers both a spaced non-empty string and a blank string path.

## Examples
- `apps/control-plane/src/error-formatting.ts`
- `apps/control-plane/test/error-formatting.test.ts`

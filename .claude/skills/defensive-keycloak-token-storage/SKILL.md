---
name: defensive-keycloak-token-storage
description: "Use when persisting Keycloak tokens to localStorage — normalize on read so malformed state clears instead of breaking auth bootstrap."
metadata:
  version: 1.0.0
disable-model-invocation: false
---

## Context

Use this when a browser app restores a Keycloak session from localStorage. Saved auth blobs are easy to corrupt during manual testing, older builds, or partial writes, and blindly trusting that JSON turns logout/bootstrap bugs into confusing runtime errors.

## Patterns

- Parse stored token JSON into a partial shape, not the full token type.
- Require `accessToken` and `refreshToken` to be strings before reusing the payload.
- Treat `idToken` as optional and only keep it when it is a string.
- When parsing fails or required fields are missing, remove the stored entry immediately and return `null`.
- Pair the storage guard with a focused regression at the token helper layer, then keep the broader logged-out UX regression in the app-shell auth test.

## Examples

- `apps/web/src/App.tsx` normalizes restored Keycloak tokens before bootstrap.
- `apps/operator-portal/src/keycloak-client.ts` now clears malformed token blobs and only returns normalized token objects.
- `apps/operator-portal/src/keycloak-client.test.ts` covers invalid shapes and malformed JSON without booting a live Keycloak client.

## Anti-Patterns

- Casting `JSON.parse()` directly to the token interface and assuming the required fields exist.
- Keeping malformed token blobs in localStorage after a failed parse, which guarantees the next bootstrap hits the same failure.
- Testing only the happy path in app-shell tests and skipping a small helper test for malformed stored tokens.

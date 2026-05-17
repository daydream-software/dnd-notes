---
name: keycloak-jwt-regression-harness
description: "Use when writing Keycloak JWT regression tests without a live IdP; stub JWKS and issue signed RSA tokens with unique key IDs."
metadata:
  version: 1.0.0
disable-model-invocation: false
---

## Context

Use this when backend auth code validates Keycloak JWTs through JWKS and you need fast regression coverage in unit/integration tests without booting a real Keycloak container.

## Patterns

- Generate an RSA keypair in the test harness and publish the public key through a JWKS-shaped response.
- Issue tokens with realistic `iss`, `aud`, `azp`, `sub`, `email`, and optional role claims so auth code sees the same shape it will get from Keycloak.
- Give each harness run a **unique `kid`**. Reusing the same key ID across tests can poison in-memory JWKS caches and create false 401s after the first test rotates keys.
- Cover both the happy path and the boundary cases: wrong client/audience, expired token, missing roles, and guest/share-token coexistence.
- For provisioning flows, assert the ConfigMap wiring that actually reaches the pod (`AUTH_MODE`, Keycloak URL/realm/client ID) instead of only validating the app-layer JWT tests.

## Examples

- `tests/fake-keycloak.ts` spins up a lightweight JWKS server and issues realistic RSA-signed Keycloak-style tokens.
- `apps/api/test/keycloak-auth.test.ts` validates `/api/auth/config`, bearer-token owner linkage, and guest/share-link coexistence against a fake Keycloak JWKS.
- `apps/control-plane/test/keycloak-auth.test.ts` validates `/internal/*` JWT gating and role enforcement without a live IdP.
- `apps/control-plane/test/provisioning.test.ts` proves tenant Keycloak config reaches provisioned resources together.

## Anti-Patterns

- Reusing one static `kid` like `test-key` across multiple auth tests.
- Mocking only a boolean `isValidToken` helper and skipping real JWT claims.
- Testing admin JWT acceptance without also proving wrong-client or missing-role rejection.
- Verifying only the happy-path tenant token and skipping guest/share-link coexistence or saved-token restore behavior.

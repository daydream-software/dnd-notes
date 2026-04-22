---
name: "keycloak-identity-reconciliation"
description: "Reconcile Keycloak-backed users onto local accounts without treating mutable email claims like stable primary keys."
domain: "auth"
confidence: "high"
source: "earned"
---

## Context

Use this when an app accepts Keycloak/OIDC tokens but still keeps local owner rows, role flags, memberships, or other authorization state in its own database.

## Patterns

- Use the IdP subject (`sub`) as the durable identity key; treat email as mutable profile data.
- If a user is already linked by subject, do not blindly overwrite a unique local email field without a collision path.
- Before updating local email, either preflight for an existing row or catch the uniqueness error and convert it into a controlled product response.
- If the reconciliation layer needs the route layer to return a specific HTTP contract (for example, 409 on "email already linked to another subject"), throw a dedicated error type or structured code from the store/service boundary instead of making routes parse `Error.message`.
- Keep authorization local after identity reconciliation: campaign access, site-admin flags, and guest/share-link rules should still flow from the tenant database.
- If the new IdP email collides with another local account, keep privilege decisions anchored to the linked local row until an explicit data reconciliation step is performed.
- Add a regression that covers the real failure mode: same `sub`, new email, another local account already owns that email.

## Examples

- `apps/api/src/note-store.ts` exports `OwnerKeycloakLinkConflictError` so `apps/api/src/route-support.ts` can map Keycloak owner-link conflicts to HTTP 409 without depending on text matching.
- `apps/api/test/keycloak-runtime-auth.test.ts` includes both the real conflicting-subject flow and a synthetic typed-conflict case with an arbitrary message to keep that contract locked down.

## Anti-Patterns

- Assuming IdP email can safely replace the local unique email on every login.
- Letting the database uniqueness error surface as a 500 during auth.
- Returning 409/403 from a route only because some lower-layer `Error.message` happened to contain a specific substring.
- Recomputing admin access from a colliding claimed email when the persisted local email had to stay unchanged.
- Testing only first-login linking and missing later profile changes.

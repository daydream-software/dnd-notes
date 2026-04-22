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
- Keep authorization local after identity reconciliation: campaign access, site-admin flags, and guest/share-link rules should still flow from the tenant database.
- If the new IdP email collides with another local account, keep privilege decisions anchored to the linked local row until an explicit data reconciliation step is performed.
- Add a regression that covers the real failure mode: same `sub`, new email, another local account already owns that email.

## Anti-Patterns

- Assuming IdP email can safely replace the local unique email on every login.
- Letting the database uniqueness error surface as a 500 during auth.
- Recomputing admin access from a colliding claimed email when the persisted local email had to stay unchanged.
- Testing only first-login linking and missing later profile changes.

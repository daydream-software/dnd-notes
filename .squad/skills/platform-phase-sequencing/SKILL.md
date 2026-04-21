---
name: "platform-phase-sequencing"
description: "Order cross-cutting platform work by landing the narrowest security seam first, then identity boundaries, then live-traffic operational UX."
domain: "planning"
confidence: "high"
source: "earned"
---

## Context

Use this when a platform backlog mixes data isolation, auth migration, and
operator workflow changes across the same control-plane/tenant boundary.

## Pattern

1. Start with the seam that already exists in provisioning or runtime config;
   prefer a slice that fixes a real security smell without requiring UI or auth
   rewrites.
2. Land data-layer isolation before broader identity migration when the current
   runtime still shares secrets or credentials across tenants.
3. Treat auth work as boundary-setting: realm/client model, token validation,
   and app responsibilities should become explicit before operational UX starts
   depending on them.
4. Leave restore/maintenance UX after the auth and credential contracts are
   clear; otherwise restore work tends to invent extra architecture while trying
   to compensate for missing boundaries.
5. Call out any hidden second feature early. If restore safety would require a
   new internal maintenance control surface or proactive client notification
   channel, split that into its own follow-up unless it is truly required for
   the first credible slice.

## Examples

- `apps/control-plane/src/provisioning.ts`
- `apps/control-plane/test/provisioning.test.ts`
- `apps/api/src/routes/admin-routes.ts`
- `RUNTIME.md`
- `.squad/decisions.md`

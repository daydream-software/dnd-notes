---
name: "same-origin-operator-portal"
description: "Ship a thin internal operator portal without opening a new browser CORS surface."
domain: "platform"
confidence: "high"
source: "earned"
---

## Context
Use this when the repo already has an internal control-plane API and the team needs an operator UI quickly, but the auth and transport contract still needs to stay boring and mergeable.

## Patterns
- Start with a dedicated frontend workspace when operator workflows should stay separate from tenant-facing navigation/state.
- Keep the read model on the existing control-plane API; do not invent portal-only endpoints for the first slice.
- Put browser API calls behind a same-origin path like `/operator-api`.
- Use a Vite dev proxy locally and a reverse proxy in deployed environments so the browser never depends on a new CORS exception.
- Reuse the existing Keycloak workforce/admin client accepted by the control-plane instead of adding a separate auth broker first.
- Make the first slice read-only (`GET /internal/fleet/status`) and add write controls only after the auth and fleet contract are stable.

## Examples
- `apps/operator-portal/vite.config.ts`
- `apps/operator-portal/src/control-plane-api.ts`
- `apps/operator-portal/src/OperatorPortal.tsx`
- `.squad/decisions/inbox/brand-issue68-first-slice.md`

## Anti-Patterns
- Mixing operator controls into the tenant SPA before platform identity boundaries are clear.
- Solving local browser access with ad hoc CORS exceptions when a same-origin proxy path would work.
- Adding portal-specific summary endpoints when the existing fleet-status contract already covers the read-only dashboard.

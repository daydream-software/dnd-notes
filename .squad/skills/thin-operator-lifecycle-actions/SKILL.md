---
name: "thin-operator-lifecycle-actions"
description: "Expose one operator lifecycle action at a time by reusing existing control-plane routes, isolating action UI in a dedicated dialog, and covering it with a focused regression."
domain: "frontend"
confidence: "high"
source: "earned"
---

## Context
Use this when an operator/admin portal needs another lifecycle control but the backend contract already exists and you want a thin, mergeable UX slice. The goal is to keep the portal honest: no browser-only orchestration, no speculative endpoint design, and no giant all-actions component.

## Patterns
- Pick the safest already-documented contract first; prefer explicit backend-owned flows over ambiguous recovery/retry actions.
- Keep reads on the canonical fleet/status endpoint and isolate the write interaction in a small dialog component per action.
- Require action-specific confirmation that matches the blast radius: destructive work gets typed-slug confirmation, while rolling updates can require a reason plus typed target version.
- Use the existing API helper layer instead of inventing portal-only mutations.
- Add the regression to a focused action test file so shell/auth smoke tests stay small.

## Examples
- `apps/operator-portal/src/ProvisionTenantPanel.tsx` composes create + provision on the existing control-plane contract.
- `apps/operator-portal/src/TenantDeprovisionDialog.tsx` keeps destructive confirmation explicit with reason + typed slug.
- `apps/operator-portal/src/TenantUpgradeDialog.tsx` reuses `POST /internal/tenants/:tenantId/provision` with a version override and typed target-version confirmation.
- `apps/operator-portal/src/OperatorPortal.actions.test.tsx` owns the lifecycle action regressions.

## Anti-Patterns
- Adding a new portal endpoint because the current contract feels awkward before confirming the backend owner wants that shape.
- Showing “retry/recover/upgrade” buttons on states where the control-plane semantics are not already documented.
- Packing every lifecycle form into the main page component and letting `App.test.tsx` become the only regression file.

---
name: "operator-control-surface-qa-slices"
description: "Stage operator/admin portals by locking the read contract first, then gate each write action on explicit side-effect UX plus audit-trail evidence."
domain: "testing"
confidence: "high"
source: "earned"
---

## Context
Use this when a platform/control-plane feature is growing a browser UI for operators. The fastest wrong move is shipping buttons before the UI has a stable source of truth or a way to explain what just happened.

## Patterns
- Land an auth-gated read surface first so the UI has one canonical source of fleet/tenant state.
- Test auth on both the primary read endpoint and at least one representative write endpoint; operator portals often accidentally secure the list page but not the action routes.
- Require every destructive or high-impact action to show pre-action side-effect copy and post-action audit evidence (`triggeredBy`, `reason`, latest transition).
- If a high-impact confirmation dialog can stay open across refreshes, feed the live mutation-disabled reason into the final confirm step too: re-check it in the submit handler, show the fresh reason in the dialog, and disable the terminal CTA before any stale click can escape.
- Keep write paths delegated to the backend control-plane contract; the frontend should not synthesize state transitions locally.

## Examples
- `apps/control-plane/test/keycloak-auth.test.ts` now locks Keycloak admin/workforce access for `GET /internal/fleet/status` and rejection on `POST /internal/tenants/:tenantId/provision` when the role is wrong.
- `apps/control-plane/test/app.test.ts` now asserts `latestTransition.triggeredBy` and `reason` for fleet status plus provision/deprovision flows, so a future portal can explain operator side effects after the action lands.
- `apps/operator-portal/src/ProvisionTenantPanel.tsx` and `apps/operator-portal/src/OperatorPortal.actions.test.tsx` now keep tenant provisioning honest after a live fleet refresh by disabling the final confirmation button and surfacing the fresh lane-disabled reason inside the already-open dialog.
- `apps/web/src/SiteAdminPanel.tsx` shows the expected UI pattern: warn before destructive restore work and keep the side effect explicit in the copy.

## Anti-Patterns
- Shipping a write-first operator shell that invents local optimistic state before the control-plane reports the real result.
- Treating auth as covered because one internal route is protected while the portal’s actual read/write endpoints stay untested.
- Hiding why a tenant moved state by omitting operator identity/reason from the surfaced transition data.
- Leaving a destructive/provisioning confirm dialog armed after the underlying fleet state changes, so a stale modal can still fire a mutation the live portal has already disabled.

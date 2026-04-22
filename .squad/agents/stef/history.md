# Project Context

- **Owner:** FFMikha
- **Project:** dnd-notes
- **Description:** A D&D note-taking app for capturing campaign notes, characters, locations, and session details.
- **Stack:** React, Material UI, Node.js
- **Created:** 2026-04-11T19:00:21.594Z

## Core Context (Summarized 2026-04-22T18:24:34Z)

Stef initialized as Frontend Dev for the initial project squad.


## Core Context (Summarized 2026-04-22T18:24:34Z)

*History summarized on 2026-04-18T22:58:15.116987 — old entries moved to archive. Keeping last 10 team updates and all learnings.*


## Recent Updates (Last 10)

📌 Team update (2026-04-22T17:17:21Z): Issue #68 control-plane contract expanded with optional `initialAdminEmail` field — persisted on tenant record, surfaced in fleet/detail reads, operator portal updated to capture/display on create flow. Field is metadata-only; provisioning does not yet create accounts. Custom-domain inputs deferred per product roadmap. All validation passing. Stef to own next portal lifecycle actions on stable contract. — Data (Backend Dev)
📌 Team initialized on 2026-04-11 with Mikey, Stef, Data, Chunk, Brand, Scribe, and Ralph.
📌 Team initialized on 2026-04-11 with Mikey, Stef, Data, Chunk, Brand, Scribe, and Ralph.
📌 Team update (2026-04-12T14:38:40Z): Campaign share links stay as reusable single links with owner-only on-demand reveal; listings stay metadata-only and legacy hash-only links must be revoked/recreated to become revealable again — decided by FFMikha (via Copilot), Mikey, Data, Stef, Chunk
📌 Team update (2026-04-12T17:35:41Z): Issue #27 session browsing backend fixes approved; frontend UI slice approved for ship; thin two-step flow (Browse by session → Select session → Browse notes) ready to merge — decided by Chunk (reviewer), Stef (implementer)

## Learnings

### Origin Architecture (2026-04-13)

- **API origin handling is already parameterized.** Single source of truth is `VITE_API_BASE_URL` in `apps/web/src/api.ts:31-32`; all 50+ API calls use this base. Falls back to `http://localhost:3001` in dev.
- **Token strategy is safe for split origins.** Auth tokens live in localStorage and are sent explicitly via `Authorization: Bearer {token}` headers—no cookies, no `credentials: 'include'`, so no same-origin leakage risk.
- **No hardcoded origins anywhere in React code.** No `window.location`, `location.origin`, or same-origin checks in component code, state management, or routing logic.
- **Shared routes already param-driven.** The `createFrameAncestorsPlugin` in `apps/web/vite.config.ts:11-65` makes API calls from the dev server middleware using the same `apiBaseUrl` pattern, then sets CSP headers dynamically.
- **Frontend is ready for split-origin deployment.** No code changes needed. Backend must configure CORS headers; deployment must set `VITE_API_BASE_URL` to the split API origin during build.
- **Client-side routing has no origin deps.** Share routes are parsed from pathname (`getShareTokenFromPath`) and navigation is explicit (`window.location.assign`), so no assumptions about URL scheme or host.

### Initial squad setup complete.
- Owner share links now stay metadata-only in the list UI until a card-level reveal action fetches that specific reusable URL, then the card handles blur/show/copy locally in `apps/web/src/App.tsx`.
- Frontend share-link reveal wiring lives in `apps/web/src/api.ts`, `apps/web/src/types.ts`, and `apps/web/src/App.test.tsx`; legacy reveal failures should be surfaced inline on the card with a recreate suggestion.
- Claimed guest memberships must unlock the authenticated workspace through any linked campaign membership, while owner-only settings stay gated; the cross-cut lives in `apps/api/src/app.ts`, `apps/api/src/note-store.ts`, and `apps/web/src/App.tsx`.
- After linking from the shared route, persist `dnd-notes:selected-campaign-id` so the next main-app bootstrap lands on the claimed campaign instead of dropping people back into the default one (`apps/web/src/SharedCampaignRoute.tsx`).
- Built-in starter templates live client-side in `apps/web/src/templates.ts`, so frontend can seed reusable campaign scaffolds and note drafts without waiting on a backend template API.
- Campaign template UI stays in create mode only inside `apps/web/src/App.tsx`, which keeps issue #32 off the owner campaign-settings surface while still seeding starter notes after `createCampaign()`.
- Note templates stay optional in create-note mode and simply replace the local draft with editable plain-text scaffolding for NPC, faction, session, or location notes.
- Membership consolidation regression coverage lives in `apps/api/test/app.test.ts`; keep the route owner-only for linked guest accounts and reject source/target membership IDs that come from another campaign with campaign-scoped 404s.
- Issue #27 session browsing stays inside the existing list/detail shell in `apps/web/src/App.tsx`: add an `All notes` / `Browse by session` toggle, a session list view, and a session-notes view instead of a broader layout rewrite.
- Session list data comes from the session endpoints in `apps/web/src/api.ts`; keep counts and detail loading separate so the flat note list still works unchanged when users stay in normal browsing mode.
- Starting a new note should reset back to the flat note list so session browsing does not interfere with the active note-creation surface; regression coverage for the browse mode lives in `apps/web/src/App.test.tsx`.
- **Issue #29 spike (graph-style tags):** Current tags are simple comma-separated strings stored as JSON in SQLite, rendered as Material UI Chips, with zero discovery/browsing UI. Graph relationships only unlock value once search and tag browsing exist (v1–v2 roadmap item). Premature implementation without discovery mechanisms creates unused complexity. Defer to v3+ after search foundations ship; start with auto-inferred relationships from tag co-occurrence, not manual curation. See `.squad/decisions/inbox/stef-issue-29.md` for full analysis.
- Issue #28 tag discovery can stay fully client-side in `apps/web/src/App.tsx`: derive tag facets and counts from the loaded campaign notes, then filter the existing note list locally instead of adding a new API contract.
- Tag entry now works best as a free-solo Material UI `Autocomplete` backed by loaded note tags, with blur/Enter committing comma-separated input so quick capture stays fast.

*96 older learning items archived.*

### Admin/Operator UI Discovery (2026-04-21)

- **Control-plane API exists** (apps/control-plane/src): thin Express REST layer with admin token auth, manages tenant lifecycle (create, state transitions, version/backup metadata). No web frontend.
- **Per-tenant SiteAdminPanel** (apps/web/src/SiteAdminPanel.tsx): read-only metrics + backup/restore for single instance only, not multi-tenant admin.
- **Fleet admin dashboard = Issue #57** (Phase 3): planned internal UI to show all tenants, pod health, PVC usage, backup age, version state. Stretch goal is customer-facing status page.
- **Portal / customer provisioning UI** = deferred post-Phase 1 until control-plane API contract stabilizes.
- **Missing piece**: Phase 1 provisioning driver/worker (Issue #54?) that actually orchestrates the control-plane API to create/manage instances. Currently no service or script calls the control-plane endpoints.
- **Decision**: Control plane plumbing is in place; next phase adds the provisioning orchestrator (backend service/worker), then the operator dashboard (#57).

### PR #77 Keycloak auth UX (2026-04-22)

- `apps/web/src/App.tsx` must treat a missing `keycloakClientRef.current` in Keycloak mode as an inline auth failure, not a silent optional-chained no-op. Reuse the existing owner-auth `error` alert so the screen stays low-friction and users get a direct reload/retry message.
- The focused regression for this lane lives in `apps/web/src/App.keycloak-auth.test.tsx`; the easiest way to drive the missing-client state is to reject `RuntimeKeycloakClient.init()` during bootstrap so `clearSession()` nulls the ref before the user clicks the Keycloak CTA again.
- Keep the runtime split clean: `/api/auth/config` still comes from `apps/web/src/api.ts`, the browser Keycloak wrapper stays in `apps/web/src/keycloak-client.ts`, and App-level UX fallbacks belong in `App.tsx` rather than in API helpers.

📌 Team update (2026-04-22T15:19:20Z): PR #77 review follow-up orchestration complete. Four agents (Brand, Data, Stef, Chunk) addressed three Copilot review comments on squad/76-complete-runtime-keycloak-auth-integration. Brand guarded `inherit_errexit` for Bash 3.2 compat (manual gate); Data typed Keycloak conflict handling (API regression); Stef surfaced missing-client UX (web regression); Chunk verified all gates green (lint/test/build/platform:validate passed). Four decisions merged to squad/decisions.md. Session log: `.squad/log/2026-04-22T15:19:20Z-pr77-review-followup.md`. Orchestration logs per agent in `.squad/orchestration-log/`. — Scribe
📌 Team update (2026-04-22T17:04:09Z): Issue #68 operator portal UX slice completed by Stef. Tenant provisioning flows as reviewed two-step control-plane composition (create → provision with operator reason). Deprovisioning requires reason + typed-slug confirmation. Decision merged: control-plane contract is canonical; portal does not invent endpoints. Follow-ups: Data extends contract for domain/admin inputs; Chunk verifies regression coverage. Session log: `.squad/log/2026-04-22T17:04:09Z-issue68-ux-batch.md`. Orchestration log: `.squad/orchestration-log/2026-04-22T17:04:09Z-stef.md`. — Scribe


### Issue #68 operator portal UX (2026-04-22)

- `apps/operator-portal/src/OperatorPortal.tsx` now treats the portal as a thin control surface: read state still comes from `GET /internal/fleet/status`, while success/error messaging stays global and action-specific state is pushed into small provisioning/deprovision components.
- Provisioning lives in `apps/operator-portal/src/ProvisionTenantPanel.tsx` as a reviewed two-step flow that creates the tenant record first, then calls the existing provision route with an explicit operator reason; the form autofills tenant ID from slug and suggests the most common fleet version to keep setup friction low.
- Deprovisioning lives in `apps/operator-portal/src/TenantDeprovisionDialog.tsx` and requires both a reason and typed-slug confirmation so destructive work is explicit before the browser sends the real control-plane request.
- Portal write helpers now live in `apps/operator-portal/src/control-plane-api.ts`, and focused lifecycle regressions live in `apps/operator-portal/src/OperatorPortal.actions.test.tsx` so `App.test.tsx` can stay closer to shell/auth smoke coverage.
- **Decision locked (2026-04-22)**: Portal provisioning flow stays a two-step control-plane composition (create + provision with operator reason). Deprovision requires reason + typed-slug confirmation. Portal does not invent write endpoints; uses existing control-plane contract. Follow-up: Data extends contract for additional inputs (domains, admin email) before portal asks for those fields.

### Issue #68 rolling update UX (2026-04-22)

- The next safe lifecycle action in `apps/operator-portal` is a rolling update, not a generic reprovision: the portal should only expose it for tenants already in `ready`, because the control-plane contract explicitly documents version-override upgrades on `POST /internal/tenants/:tenantId/provision`.
- `apps/operator-portal/src/TenantUpgradeDialog.tsx` keeps the write path thin by reusing `provisionTenant()` with a required operator reason and a typed target-version confirmation, so rollout intent is explicit without adding a second browser-only state machine.
- Focused lifecycle coverage for the upgrade flow belongs in `apps/operator-portal/src/OperatorPortal.actions.test.tsx`; keep `App.test.tsx` limited to auth/shell smoke.
- **Rolled out (2026-04-22):** TenantUpgradeDialog component + portal lifecycle menu wired. Portal lint/build/test all passing. Regression coverage in OperatorPortal.actions.test.tsx. Chunk to own QA/reviewer pass on rolling-update action next.

### PR #78 operator-portal README wording (2026-04-22)

- `apps/operator-portal/README.md` intro must not describe the portal as read-only anymore. It needs to say the current surface both reads fleet status and triggers real lifecycle writes through the existing control-plane contract: create + provision, deprovision, and rolling updates for ready tenants.


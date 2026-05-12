# Project Context

- **Owner:** FFMikha
- **Project:** dnd-notes
- **Description:** A D&D note-taking app for capturing campaign notes, characters, locations, and session details.
- **Stack:** React, Material UI, Node.js
- **Created:** 2026-04-11T19:00:21.594Z

## Core Context (Summarized 2026-04-26T15:45:50Z)

Stef is the Frontend Dev responsible for user-facing UI, portal applications, and client-side state management. Primary domains: operator portal (provisioning, lifecycle actions), customer portal, share-link UI, membership/session browsing, reactive template system, Keycloak token storage safety.

**Phase 0 Frontend Work (2026-04-11 to 2026-04-22):**
- Share links: metadata-only listing with owner-only on-demand reveal (no reusable-URL leakage)
- Session browsing: two-step flow (Browse by session → Select session → Browse notes) with flat-list fallback
- Membership consolidation: UI for preview/apply on note attribution
- Tag discovery: client-side facet generation + free-solo Autocomplete for entry
- Templates: client-side starter scaffolds (NPC, faction, session, location notes)

**Operator Portal Work (2026-04-18 to 2026-04-25):**
- Built two-step provisioning flow (create tenant record, then call provision route with operator reason)
- Built deprovision with reason + typed-slug confirmation
- Issue #68: Rolling update UI (TenantUpgradeDialog) for ready-only tenants
- Keycloak token storage defensive parsing (require string tokens, drop malformed, clear on error)
- Comprehensive lifecycle actions regression coverage (OperatorPortal.actions.test.tsx)
- PR #78: Auth cleanup + CI-safe polling, approved for merge

**Portal Utilities Consolidation (2026-04-23 to 2026-04-25):**
- normalizeBasePath + joinBasePath consolidated to packages/portal-utils (8 tests)
- Zero duplicate definitions in operator-portal or customer-portal
- All-slash input handling standardized (/// → fallback)
- Epic #87 item 4 validation: code consolidation PASS; CI gap identified (tests not wired to scripts/run-ci-tests.mjs)

**Cross-Portal Patterns:**
- API origin parameterized via VITE_API_BASE_URL (single source of truth)
- Token strategy is localStorage + explicit Authorization header (no cookies, no same-origin leakage)
- Shared routes parsed from pathname (getShareTokenFromPath), navigation explicit (window.location.assign)
- Frontend ready for split-origin deployment (no code changes needed; backend CORS + build config)

## Recent Updates

Team update (2026-05-11T22:00:00Z): #216 filed — codify `cardBorder`+`cardShadow` as named theme tokens in `packages/theme/src/index.ts`, remove hardcoded rgba from `WorkspaceSkeletons.tsx`, surface audit across all 3 apps (p2, stef). #217 filed — operator-portal sign-in card icon alignment fix, match access-denied card `Stack direction='row'` pattern (p2, stef). — decided by coordinator.





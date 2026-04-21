# Project Context

- **Owner:** FFMikha
- **Project:** dnd-notes
- **Description:** A D&D note-taking app for capturing campaign notes, characters, locations, and session details.
- **Stack:** React, Material UI, Node.js
- **Created:** 2026-04-11T19:00:21.594Z

## Core Context

Mikey is the Lead for the squad, responsible for architecture alignment, blocking decision resolution, and planning oversight across the platform.

**Historical Milestones (2026-04-11 to 2026-04-19):**
- Initialized squad on 2026-04-11 with Stef (Frontend), Data (Backend), Chunk (QA), Brand (Platform), Ralph (infra), Scribe (memory)
- Guided Issue #27 to completion (session browsing UI); PR #36 merged
- Resolved Issue #33 parallel-lane decision (activity UI post-Issue-#27)
- Approved Phase 2 notes UX roadmap (compact header + Lexical editor + inline references)
- Completed origin-model audit; recommended same-origin reverse proxy for production
- Led Issue #42 epic planning: confirmed thin control-plane + per-instance provisioning model; deferred Keycloak and K8s operator to Phase 2+
- Resolved Issue #42 architecture blockers: tenant contract (control-plane sole orchestrator), Postgres isolation (SERIALIZABLE), backend gating (`DATABASE_URL` env var)
- Closed Phase 0 gate: PR #67 completes Issue #55 (rollout contract). Phase 0 → Phase 1 transition ready

**Key Pattern:** Architecture spike (reviews) → blocking questions → explicit decisions → execution gates with measured acceptance criteria.

## Recent Updates (Last 10)

- **Roadmap Issues Created (2026-04-21T22:45Z):** Per FFMikha request, created three GitHub issues to fill scope gaps:
  - #68 "Build the operator control portal for platform administration" — distinct from #57 (fleet observability). This is the control surface: provision/deprovision, manage lifecycle, trigger operations. Operator persona + UI layer for the control-plane API.
  - #70 "Build the public landing and self-serve signup portal" — customer-facing front door. Marketing site + self-serve signup + instance dashboard. Drives control-plane provisioning (#53) from customer actions instead of manual operator scripts.
  - #71 "Implement per-tenant Postgres credentials and database isolation" — **CRITICAL SECURITY issue**. Current provisioning (#54) injects admin credentials into all tenant pods (tenant isolation violation). Each tenant needs credentials that grant access ONLY to its own database. Blocks Phase 1 production readiness.









## Learnings

- **Phase 2 sequencing for auth/restore/isolation (2026-04-21):** Recommended order is `#69 → #56 → #40`. Start with the provisioning seam in `apps/control-plane/src/provisioning.ts`: it still injects a shared runtime `DATABASE_URL` into each tenant Secret, so least-privilege per-tenant Postgres roles are the thinnest credible security slice and should land before broader auth or restore choreography. Then do `#56` to lock Keycloak realm/client boundaries across control plane + tenants without mixing restore UX into the auth migration. Keep `#40` last because the current restore path is still tenant-local (`apps/api/src/routes/admin-routes.ts`) and the docs/UI already warn that active users are not put into maintenance automatically (`README.md`, `apps/web/src/SiteAdminPanel.tsx`); that workflow should consume the auth and credential boundaries rather than define them.

- **Separate-issue threshold for restore work (2026-04-21):** No new blocker issue is required to start `#69` or `#56`. For `#40`, only split new work into a dedicated follow-up if the team wants hosted control-plane orchestration or proactive live client notifications in the first slice: `RUNTIME.md` reserves `/_control/maintenance` endpoints, but they are explicitly not implemented yet, so folding that control surface plus push-style UX into the first restore fix would create a second feature hiding inside the restore issue.

- **Key file paths for Phase 2 triage (2026-04-21):** Security seam: `apps/control-plane/src/provisioning.ts`, `apps/control-plane/test/provisioning.test.ts`. Control-plane runtime/auth entrypoint: `apps/control-plane/src/index.ts`, `apps/control-plane/README.md`. Tenant restore behavior + warnings: `apps/api/src/routes/admin-routes.ts`, `apps/api/src/note-store.ts`, `README.md`, `apps/web/src/SiteAdminPanel.tsx`. Locked contracts: `.squad/decisions.md`, `RUNTIME.md`.

- **Admin/Operator Platform Gap Analysis (2026-04-21T10:30Z):** Reviewed epic #42 and all remaining open issues to answer: "Does remaining scope cover the operator/admin application?" Found: (1) Fleet status #57 is read-only observability dashboard; (2) Keycloak #56 supplies auth boundaries but not operator UI; (3) Restore #40 assumes manual control-plane triggering without specifying operator surface. Verdict: No dedicated operator portal issue exists. Current scope covers *what* operators see (#57) and *how to authenticate them* (#56), but not *how they control the platform*. Recommendation: Split Phase 3 into two explicit issues — #57 (fleet status, observability) + NEW (control-plane operator portal, control surface). This unblocks architecture clarity on whether the control plane stays a headless API or needs a paired UI.

- **PR #60 Eligibility at Gatekeeper Trigger — Timeline Reconstruction (2026-04-19T00:28):** FFMikha's correction is CORRECT and COMPLETE. Root cause: gatekeeper design flaw — the script does not atomically check both conditions + merge; instead, it checks conditions, decides "merge", then issues merge API call asynchronously. By the time GitHub executed the merge, unresolved thread already existed. Lesson: Gatekeeper must either (a) re-check gates immediately before merge() call, (b) lock the PR state during evaluation, or (c) implement explicit gates via branch protection (GitHub-native). Current async check→merge window allows race conditions.

- **Issue #42 Control-Plane ↔ Tenant Contract Decision Locked (2026-04-19):** Accepted Option 1 (compromise shape) — control plane is sole orchestrator, tenant app never calls back. Tenant internal surface: probes (`/health`, `/ready`) + `/_control/info` (runtime state) + `/_control/maintenance` (drain mode). Kubernetes is coordination layer. No `/_control/bootstrap` in Phase 1. Key lesson: The contract got thin by asking "what must cross the boundary?" instead of "what could cross?" — three surfaces suffice when K8s already provides the reconciliation loop.

- **Epic #42 planning pattern:** Architecture spike (multiple risk reviews) → decision resolution (Mikey answers blocking questions) → execution kickoff (parallel tracks with measured acceptance). The gap between "architecture decided" and "Phase 0 underway" was the real planning debt.

- **Decision point triage:** Data's 4 blocking questions were the right forcing function. Without explicit answers to auth strategy, versioning, backup ownership, and Keycloak timing, no child issue can be confidently scoped.

- **Phase overlap reduces idle time:** Design tasks for Phase N+1 can start during Phase N implementation when outputs are interfaces/contracts rather than code. State machine, API contract, and adapter interface drafts are all non-blocking on Phase 0 code.

- **Key file paths:** Epic decisions consolidated in `.squad/decisions.md`. Sub-issues: #52 (containerize), #43 (artifacts), #39 (WAL), #53 (control plane), #54 (provisioning), #55 (rollout), #56 (OIDC), #40 (restore), #57 (fleet status).

- **Issue #42 Phase 0 verdict (2026-04-21):** Scope is effectively landed (`#52`, `#58`, `#63`, `#43` are closed and the repo now has the tenant image, Postgres adapter, k3d smoke lane, and committed control-plane artifacts). Phase 0 gate now COMPLETE: PR #67 closes #55 (rollout contract); all Phase 0 child issues resolved; Phase 1 execution can begin on #56 (Keycloak) and #40 (backup/restore).

- **Phase 2–3 Roadmap Coherence (2026-04-21T22:45Z):** Audit of open issues + decisions.md + history reveals three critical scope gaps for customer-facing SaaS rollout:
  1. *Operator control surface gap*: Issue #57 provides fleet observability (what operators see), but no control portal (how they provision/manage instances). Split now as #68 (control portal) distinct from #57 (fleet dashboard).
  2. *Customer self-serve gap*: No public landing site or self-serve signup portal. Customers cannot provision themselves; all provisioning is manual operator work. Addressed by new #70 (landing + self-serve portal).
  3. *Tenant credential isolation gap (CRITICAL)*: Issue #54 provisioning shares admin Postgres URL across all tenants — any compromised tenant container can read/modify other tenant data. Fixed by new #71 (per-tenant Postgres credentials). Blocks Phase 1 production deployment.
  Pattern: Architecture decisions are right (control-plane thin API, per-tenant databases), but operator/customer UX and security hardening require explicit issues.


---

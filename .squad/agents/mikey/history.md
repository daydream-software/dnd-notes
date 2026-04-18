# Project Context

- **Owner:** FFMikha
- **Project:** dnd-notes
- **Description:** A D&D note-taking app for capturing campaign notes, characters, locations, and session details.
- **Stack:** React, Material UI, Node.js
- **Created:** 2026-04-11T19:00:21.594Z

## Core Context

Mikey initialized as Lead for the initial project squad.


## Core Context

*History summarized on 2026-04-18T22:58:15.116575 — old entries moved to archive. Keeping last 10 team updates and all learnings.*

## Recent Updates (Last 10)

📌 Team update (2026-04-13T00:04:28Z): Issue #27 COMPLETE — Frontend UI approved and merged after @copilot's revision (PR #36). Parallel lane decision on Issue #33 (activity UI) RESOLVED: Issue #33 UI unblocked post-PR-#36 merge, Issue #28 (tag facets) remains safe parallel option. PR #36 merged on main. Issue #33 queued for immediate assignment (primary: Stef, fallback: @copilot). Frontend thin slice scope: activity feed UI, collaborator filter sidebar, created/edited attribution, empty state. Backend contract stable. Regression test plan documented (RT1–RT5 gates). Awaiting product decisions on shared-workspace activity support and filter privacy. Assignment in orchestration log. No blocking architectural decisions — decided by FFMikha, Chunk, Scribe
📌 **Coordinator action:** PR #37 moved out of draft, approved by Mikey (Lead) + Chunk (QA), and merged to `main`. Issue #28 closed as resolved.
📌 Team update (2026-04-13T18:14:27Z): UX feedback review completed—phased notes UX roadmap approved (compact header + editor + inline references), Lexical editor recommended over TipTap for markdown-native alignment, backend data model strategy for qualified references finalized — decided by Mikey (Product), Stef (Frontend), Data (Backend)
📌 **Review complete:** Mikey reviewed Phase 2 scope and approved implementation strategy.
📌 **Status:** P1 blocker diagnosed and scoped; CI workflow created; work assigned to Brand & Chunk.
📌 Team update (2026-04-16T15:30:33Z): Origin-model audit completed. Frontend ready for split-origin deployment. Backend: add PUBLIC_WEB_ORIGIN env var to buildSharedUrl(). Platform: same-origin reverse proxy recommended for prod. — decided by Stef, Data, Brand, Mikey
📌 Team update (2026-04-18T00:43:22Z): ISSUE #42 BACKEND DIRECTION CAPTURED — Data wrote `.squad/decisions/inbox/data-42-auth-persistence.md` to pin the backend recommendation: SQLite is acceptable for a thin first control plane only under single-writer, low-concurrency constraints; tenant instances need strict lifecycle boundaries from the control plane; auth should move toward centralized OIDC with a separate admin realm plus a shared tenant-aware customer realm; and #42 must measure provisioning, backup/restore, rollout, and failure-drill reality before the model is treated as production-ready.
📌 Team update (2026-04-18T00:43:37Z): ISSUE #42 PLATFORM DIRECTION DECIDED — Added `.squad/decisions/inbox/brand-42-k8s-platform.md` recommending a managed single-cluster Kubernetes shape with a provider-managed K8s control plane, a thin app-level control plane using the Kubernetes API instead of a custom operator, tenant workloads that scale to zero while keeping their PVCs, shared ingress/cert-manager in the first real hosted slice, internal fleet status before a public status page, and provider selection centered on storage, ingress, automation, and low-friction ops.
📌 Team update (2026-04-18T02:20:06Z): Platform gap analysis complete — 11 cross-cutting risks identified for #42 epic. Critical gaps: local K8s dev loop (k3d), ingress/wildcard DNS/TLS, SQLite backup strategy, control-plane SPOF, CI for containers/manifests. All gaps prioritized by phase and assigned to Brand/Data. Awaiting Mikey + FFMikha review and timeline adjustment.
📌 **Planning decision:** Resolved Data's four blocking decision points and produced concrete Phase 0 execution plan.

## Learnings

- **Issue #42 Control-Plane ↔ Tenant Contract Decision Locked (2026-04-19):** Accepted Option 1 (compromise shape) — control plane is sole orchestrator, tenant app never calls back. Tenant internal surface: probes (`/health`, `/ready`) + `/_control/info` (runtime state) + `/_control/maintenance` (drain mode). Kubernetes is coordination layer; Postgres backups run as direct DB operations, not through app. No `/_control/bootstrap` in Phase 1. Removed contract bullet from #42 clarifications list, updated issue body with locked decision, posted sync comment, and created decision artifact (`.squad/decisions/inbox/mikey-42-tenant-contract-sync.md`). **Key lesson:** The contract got thin by asking "what must cross the boundary?" instead of "what could cross?" — three surfaces suffice when K8s already provides the reconciliation loop. Phase 1 execution can now begin on #53–#55 without further architecture debate.

- **Epic #42 planning pattern:** Architecture spike (multiple risk reviews) → decision resolution (Mikey answers blocking questions) → execution kickoff (parallel tracks with measured acceptance). The gap between "architecture decided" and "Phase 0 underway" was the real planning debt.
- **Decision point triage:** Data's 4 blocking questions were the right forcing function. Without explicit answers to auth strategy, versioning, backup ownership, and Keycloak timing, no child issue can be confidently scoped.
- **Phase overlap reduces idle time:** Design tasks for Phase N+1 can start during Phase N implementation when outputs are interfaces/contracts rather than code. State machine, API contract, and adapter interface drafts are all non-blocking on Phase 0 code.
- **Key file paths:** Epic decisions consolidated in `.squad/decisions.md` lines 3492–4180. Sub-issues: #52 (containerize), #43 (artifacts), #39 (WAL), #53 (control plane), #54 (provisioning), #55 (rollout), #56 (OIDC), #40 (restore), #57 (fleet status).

## 2026-04-18: Issue #42 Platform Planning — Execution Recommendation


**Action Taken:**
1. Reviewed Brand's dependency graph, existing decisions, and issue #42 current state
2. Consolidated planning into actionable lead recommendation with three clear answers:
   - **Next planning slice:** Launch Phase 0 now (#52 Dockerfile + #43 manifests)
   - **Decision timing:** 5 decisions NOW (registry, ingress, DNS/TLS, secrets, single-writer), 2 LATER (Keycloak ops, versioning)
   - **Execution order:** Phase 0 (container + PVC proof) → Phase 1 (control plane + isolation) → Phase 2 (auth) → Phase 3 (ops maturity)

**Key Decisions Made:**
- **Image registry:** GitHub Packages (OIDC-ready, zero setup)
- **Ingress:** ingress-nginx (boring, AKS default, cert-manager proven)
- **DNS/TLS:** Wildcard DNS + cert-manager DNS-01
- **Secrets:** K8s Secrets for Phase 0–1 (document gap, upgrade Phase 2)
- **Single-writer:** Control-plane validation + tenant app readiness check

**Phase Boundaries:**
- Phase 0 gate: Rolling update proven on k3d without PVC data loss
- Phase 1 gate: Two isolated tenants, data isolation verified
- Phase 2 gate: Keycloak auth works across multiple tenants
- Phase 3 gate: Backup/restore measured, fleet dashboard exists

**Verdict:** GO. Dependency graph is clean, gates are measurable, sequencing is safe. Not a spike — measured build with exit points at each gate.

**Next:** FFMikha approves 5 NOW decisions → Brand starts #52 → Data + Brand design state machine (Phase 0→1 pre-work).

**Artifact:** `.squad/decisions/inbox/mikey-issue-42-planning.md` (updated from earlier version)

## 2026-04-18: Issue #42 Phase 0–1 Clarifications Locked

**Action Taken:**
Locked three critical Phase 0–1 clarifications into GitHub issue #42 body and squad decisions inbox. These items moved from "open clarifications" to locked decisions with clear owners and downstream implications.

**Three Decisions Locked:**

1. **Local K8s dev loop: k3d** (2026-04-18)
   - k3d for daily fast iterations; k3s on VM for stateful rehearsals (PVCs, rolling restarts, backup/restore).
   - Accepted divergence: k3d local storage vs. managed Postgres on cloud. Phase 1 acceptance includes manifest validation on both k3d and AKS.
   - Owner: Brand (deployment); Data (backup assumptions).
   - Implication: #52 Containerize must include `scripts/dev-cluster.sh` spike.

2. **Phase 0 CI scope: Build + smoke test + validate** (2026-04-18)
   - Container image build + API smoke tests + K8s manifest validation. **No automatic GHCR push on PR.**
   - Rationale: Phase 0 images not production-ready; manual promotion post-Phase-0-acceptance reduces noise and registry churn.
   - Cost impact: Lower CI spend (no every-PR push).
   - Owner: Brand (CI/CD).

3. **Phase 1 ingress/TLS model: Opaque wildcard subdomains** (2026-04-18)
   - One subdomain per tenant (`tenant-slug.dnd-notes.app`); web + API same-origin.
   - Architecture: cert-manager + ingress-nginx + wildcard DNS-01.
   - Control-plane contract: Each tenant record includes `subdomain` field; provisioning reserves subdomains + creates ingress rules atomically.
   - **GHCR private images:** Explicit clarification: Images stay private in production. Cluster pulls via Kubernetes `imagePullSecrets` (K8s Secrets with package-read credentials). No special tooling needed Phase 0–1.
   - Owner: Brand (ingress/provisioning); Data (tenant contract).
   - Implication: #53 (control-plane skeleton) and #54 (provisioning) must implement subdomain + ingress state machine.

**Removed from "Next points to clarify together":**
- ~~Local K8s dev loop (k3d/k3s)~~
- ~~Phase 1 ingress/wildcard DNS/TLS model~~
- ~~CI coverage scope~~


*Older entries archived. See .squad/decisions.md for locked decisions.*

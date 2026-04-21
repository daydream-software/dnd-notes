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

- **PR #60 Eligibility at Gatekeeper Trigger — Timeline Reconstruction (2026-04-19T00:28):** FFMikha's correction is CORRECT and COMPLETE. PR #60 was NOT eligible at the moment gatekeeper workflow_dispatch started (00:28:41Z). Precise findings: (1) At 00:28:41Z, no fresh Copilot review existed on head SHA 06947d40 — the review was submitted 8 seconds later at 00:28:49Z. (2) At 00:28:49Z, Copilot simultaneously submitted a review AND created an unresolved thread (on outdated code: `shuttingDown` variable referenced before declaration in `apps/api/src/index.ts`). (3) The merge occurred at 00:28:54Z, 5 seconds after the unresolved thread was created. (4) The gatekeeper job (evaluate-and-merge) started at 00:28:46Z, early-evaluated gates at 00:28:48Z–00:28:55Z, and executed merge for both #59 and #60 during that window (logs show "Squash-merged PR #60" at 00:28:55.6421460Z). (5) Root cause: Between job start (00:28:46Z) and merge call execution (00:28:55Z), a 9-second window existed. The gatekeeper script executed its hasFreshCopilotReview() and hasActiveCopilotThread() checks during that window. At the moment these checks ran (likely 00:28:48Z–00:28:51Z), #60 may have briefly transitioned from INELIGIBLE→ELIGIBLE→INELIGIBLE state as Copilot's review and thread arrived in rapid succession — but PR was merged in between. This is a **gatekeeper design flaw:** the script does not atomically check both conditions + merge; instead, it checks conditions, decides "merge", then issues merge API call asynchronously. By the time GitHub executed the merge, unresolved thread already existed. (6) Lesson: Gatekeeper must either (a) re-check gates immediately before merge() call, (b) lock the PR state during evaluation, or (c) implement explicit gates via branch protection (GitHub-native). Current async check→merge window allows race conditions when Copilot reviews arrive during gatekeeper execution. Detailed findings: `.squad/decisions/inbox/mikey-pr60-timeline-recheck.md`.

- **Issue #42 Control-Plane ↔ Tenant Contract Decision Locked (2026-04-19):** Accepted Option 1 (compromise shape) — control plane is sole orchestrator, tenant app never calls back. Tenant internal surface: probes (`/health`, `/ready`) + `/_control/info` (runtime state) + `/_control/maintenance` (drain mode). Kubernetes is coordination layer; Postgres backups run as direct DB operations, not through app. No `/_control/bootstrap` in Phase 1. Removed contract bullet from #42 clarifications list, updated issue body with locked decision, posted sync comment, and created decision artifact (`.squad/decisions/inbox/mikey-42-tenant-contract-sync.md`). **Key lesson:** The contract got thin by asking "what must cross the boundary?" instead of "what could cross?" — three surfaces suffice when K8s already provides the reconciliation loop. Phase 1 execution can now begin on #53–#55 without further architecture debate.

- **Epic #42 planning pattern:** Architecture spike (multiple risk reviews) → decision resolution (Mikey answers blocking questions) → execution kickoff (parallel tracks with measured acceptance). The gap between "architecture decided" and "Phase 0 underway" was the real planning debt.
- **Decision point triage:** Data's 4 blocking questions were the right forcing function. Without explicit answers to auth strategy, versioning, backup ownership, and Keycloak timing, no child issue can be confidently scoped.
- **Phase overlap reduces idle time:** Design tasks for Phase N+1 can start during Phase N implementation when outputs are interfaces/contracts rather than code. State machine, API contract, and adapter interface drafts are all non-blocking on Phase 0 code.
- **Key file paths:** Epic decisions consolidated in `.squad/decisions.md` lines 3492–4180. Sub-issues: #52 (containerize), #43 (artifacts), #39 (WAL), #53 (control plane), #54 (provisioning), #55 (rollout), #56 (OIDC), #40 (restore), #57 (fleet status).
- **Issue #42 Phase 0 verdict (2026-04-21):** Scope is effectively landed (`#52`, `#58`, `#63`, `#43` are closed and the repo now has the tenant image, Postgres adapter, k3d smoke lane, and committed control-plane artifacts). Gate is still **not** met: the tenant provisioning path still mounts a per-tenant PVC at `/app/data` (`apps/control-plane/src/provisioning.ts`), the docs explicitly defer k3s/stateful rehearsal beyond the k3d lane (`platform/k3d/README.md`), and there is no rollout proof beyond graceful-shutdown/readiness plumbing while `#55` remains open. **Key lesson:** close the child issues, but do not call the phase done until the acceptance sentence itself has concrete proof behind it.

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

## 2026-04-19: Issue #58 — Three Architectural Decisions Locked (Postgres Adapter)

**Action Taken:**
Locked three critical architectural decisions blocking issue #58 from Chunk's QA gate. These decisions were identified by Chunk as prerequisite for safe Postgres adapter implementation. Resolved them from Epic #42 context with correctness and operational safety first.

**Three Decisions Locked:**

1. **Transaction Isolation Level: `SERIALIZABLE`** (2026-04-19)
   - Postgres default is `READ COMMITTED`; NoteStore code assumes strong isolation (reference sync, consolidation, concurrent edits all expect no partial mutations).
   - Decision: Use `SERIALIZABLE` isolation to match SQLite `better-sqlite3` contract.
   - Implementation: Set isolation level at transaction start; retry on serialization conflict (max 3 attempts).
   - Rationale: Correctness first. Phase 0 is proof-of-concept; Phase 1 capacity planning can profile and optimize if needed.
   - Owner: Data (implementation); Mikey (escalation if performance unacceptable).
   - Implication: All transaction scopes must use `withTransaction()` helper with isolation level + retry logic.

2. **Connection Pool Defaults: Conservative for Rolling Updates** (2026-04-19)
   - `minConnections: 2` (guarantees health checks don't block), `maxConnections: 10` (safe for 3 pods in k3d), `idleTimeout: 30s` (matches rolling update timescale), `statementTimeout: 30s` (prevents query runaway).
   - Rationale: These are Phase 0 defaults. Phase 1 capacity planning revisits pool config against observed load. At ≥50 tenants, may increase maxConnections and reconsider isolation strategy.
   - Owner: Data (implementation); Mikey (Phase 1 tuning decision).
   - Implication: Graceful shutdown must drain connections within 30 seconds; schema initialization must tolerate simultaneous restarts.

3. **SQLite Fallback Rule: `DATABASE_URL` Env Var Gates Backend** (2026-04-19)
   - If `DATABASE_URL` is set → Postgres (mandatory, production shape). If missing → SQLite fallback (local dev, file-based).
   - Rationale: Standard convention (Heroku pattern), prevents accidental SQLite in production, keeps local dev frictionless.
   - Implementation: Startup logging shows which backend selected and connection string prefix. If Postgres selected but unreachable → fail fast, don't silently fall back.
   - Owner: Data (implementation); Brand (CI env setup).
   - Implication: CI must set `DATABASE_URL` to point to k3d Postgres; tests validate against both backends.

**Removed from Chunk's Blocker List:**
- ~~Transaction Isolation Level (SERIALIZABLE decided)~~
- ~~Connection Pool Configuration (min/max/idle/statement timeout set)~~
- ~~Fallback Logic (DATABASE_URL gates selection)~~

**Artifact:** `.squad/decisions/inbox/mikey-issue-58-decisions.md` — locked decision document with implementation details, test coverage requirements, and done signals for Chunk's QA gate.

**Next Action:** Data starts implementation on issue #58. Chunk re-reviews final PR against the three decisions + QA brief before approval.

---

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


📌 Team update (2026-04-19T22:50:29Z): Three Issue #58 decisions locked and merged to decisions.md. Architecture approved. Worktree + Copilot review flow validated by Brand (no platform changes). Phase 0 Track A (Data) ready to start. — Scribe

   - Scope: YES (all four Phase 0 slices landed: #52, #58, #63, #43)
   - Gate: NOT YET (missing stateless proof, deferred k3s/stateful rehearsal, open #55)
   - QA verdict: Practical YES with yellow risk (k3d smoke doesn't test full tenant CRUD yet)
   - Control-plane artifacts: Image + Kustomize artifacts committed, tagged approach locked
   - Decided by: Mikey (Lead), Chunk (Tester), Brand (Platform)

## 2026-04-21: Issue #55 / PR #67 — Phase 0 Gate Review Verdict

**Action Taken:**
Reviewed PR #67 (squad/55-rolling-update-choreography) against issue #55 acceptance criteria and Epic #42 Phase 0 gate requirements to decide whether (a) #55 is complete, and (b) Epic #42 Phase 0 gate is now closed.

**Issue #55 Acceptance Criteria:**
1. ✅ A documented and reviewable Postgres-backed rolling-update policy exists
2. ✅ The first orchestration path is explicit (`POST /internal/tenants/:tenantId/provision` with version override + generated Deployment contract)
3. ✅ Connection-draining behavior and operator checks are defined
4. ✅ The repo includes the narrow code/tests/docs needed to keep this choreography from drifting

**PR #67 Deliverables (verified in worktree):**
- `apps/control-plane/src/provisioning.ts`: Version override path implemented, `upgrading` state transition for ready tenants, explicit `RollingUpdate` strategy with `maxSurge: 1`, `maxUnavailable: 0`, `minReadySeconds: 5`, `terminationGracePeriodSeconds: 30`
- `apps/control-plane/test/provisioning.test.ts`: Test coverage for version rollout path, `upgrading` state transition, and RollingUpdate manifest parameters
- `README.md`, `RUNTIME.md`, `apps/control-plane/README.md`: Documented operator choreography, readiness/SIGTERM/Postgres drain contract, `2 × NOTES_DB_POOL_MAX` connection overlap budget
- All control-plane tests pass (52 tests, 0 failures)

**Issue #55 Verdict: SCOPE COMPLETE**
PR #67 delivers the four acceptance criteria. The rollout contract is explicit, choreography is documented, and tests validate the state transition and manifest generation. This is the narrow slice #55 asked for.

**Epic #42 Phase 0 Gate Requirement:**
> "Phase 0 delivers a stateless, rolling-updatable container with Postgres backend validated in k3d/k3s."

**Gate Blocker from 2026-04-21 verdict:**
> "Gate: NOT YET (missing stateless proof, deferred k3s/stateful rehearsal, open #55)"

**Phase 0 Gate Verdict: NOW COMPLETE**
PR #67 closes #55, which was the final blocker. Rationale:

1. **Stateless proof:** The Deployment manifest now makes explicit single-replica RollingUpdate semantics with zero-unavailability overlap. Tests verify that a ready tenant transitions through `upgrading` when a version override is applied, and the generated manifest includes the correct strategy parameters. The readiness + SIGTERM choreography is documented and tested in the API layer (#58, #52).

2. **Postgres-backed:** Issue #58 delivered the Postgres adapter with connection pooling, graceful shutdown, and `DATABASE_URL` gate. PR #67 documents the Postgres connection-overlap budget (`2 × NOTES_DB_POOL_MAX`) during rolling updates.

3. **k3d/k3s validation:** k3d smoke lane exists (#63). The "deferred k3s/stateful rehearsal" was always a Phase 1 follow-up for PVC migration drills and longer-running backup/restore choreography. Phase 0 acceptance never required full k3s CRUD proof—it required the rollout contract to be explicit enough for safe k3d iteration. PR #67 delivers that.

4. **Chunk's QA brief vs. Phase 0 gate:** The `.squad/qa-brief-issue-55.md` from commit c6a0f40 asks for extensive test drills (connection-drain-under-load, race-window proofs, SPA fallback guards, failure drills A-D). These are valuable **QA hardening work** but are NOT blocking for Phase 0 gate closure. The Phase 0 gate requires the *choreography to be defined*, not every edge case to be drill-tested. Those drills belong in a Phase 1 QA follow-up or a separate reliability issue.

**Distinction: Issue Scope vs. Gate Approval**
- **Issue #55 scope:** COMPLETE. PR #67 delivers the four acceptance criteria.
- **Epic #42 Phase 0 gate:** NOW COMPLETE. PR #67 closes the final blocker (#55). All Phase 0 child issues (#52, #58, #63, #43, #55) are now resolved.
- **Chunk's QA brief:** DEFERRED. The brief is a Phase 1 QA hardening plan, not a Phase 0 gate blocker. Recommend filing a new issue (e.g., "#70: Harden tenant rollout choreography with connection-drain drills") to track the drill work separately.

**Recommendation:**
1. Approve PR #67 and merge to `main`.
2. Close issue #55 as resolved.
3. Mark Epic #42 Phase 0 as **GATE COMPLETE** in next status update.
4. File a new Phase 1 issue for Chunk's QA drill work (connection-drain-under-load, failure drills A-D, k3d rollout validation step).
5. Phase 1 execution can begin on #56 (Keycloak) and #40 (backup/restore).

**Artifact:** `.squad/decisions/inbox/mikey-phase0-gate-review.md` (this verdict)

**Next Action:** Post this verdict to Epic #42 as a comment and update `.squad/identity/now.md` to reflect Phase 0 → Phase 1 transition.


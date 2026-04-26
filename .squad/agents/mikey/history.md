# Project Context

- **Owner:** FFMikha
- **Project:** dnd-notes
- **Description:** A D&D note-taking app for capturing campaign notes, characters, locations, and session details.
- **Stack:** React, Material UI, Node.js
- **Created:** 2026-04-11T19:00:21.594Z

## Core Context (Summarized 2026-04-26T15:45:50Z)

Mikey is the Lead for the squad, responsible for architecture alignment, blocking decision resolution, and planning oversight across the platform. Primary domains: epic planning, architecture reviews, gatekeeper decisions, cross-team coordination.

**Historical Milestones (2026-04-11 to 2026-04-19):**
- Initialized squad on 2026-04-11 with Stef (Frontend), Data (Backend), Chunk (QA), Brand (Platform), Ralph (infra), Scribe (memory)
- Guided Issue #27 to completion (session browsing); approved Phase 2 roadmap (Lexical editor + inline references)
- Led Issue #42 epic planning: confirmed thin control-plane + per-instance provisioning, deferred K8s operator
- Resolved Issue #42 architecture blockers: tenant contract (control-plane sole orchestrator), Postgres isolation (SERIALIZABLE)
- Closed Phase 0 gate: PR #67 completes Issue #55 (rollout contract). Phase 0 → Phase 1 transition ready

**Key Pattern:** Architecture spike (reviews) → blocking questions → explicit decisions → execution gates with measured acceptance.

**Phase 2 Architecture (2026-04-21):** Sequencing: #69 (per-tenant Postgres credentials) → #56 (Keycloak auth boundaries) → #40 (restore orchestration). Security seam is provisioning.ts; auth/restore follow boundaries.

**Roadmap Planning (2026-04-21):** Created #68 (operator control portal), #70 (landing/signup), #71 (per-tenant creds) to fill scope gaps. Admin/operator platform was missing from original scope — platform visibility exists (#57), auth exists (#56), but operator control surface (#68) was implicit.

## Recent Updates (2026-04-26)

**Epic #82 Kickoff Reframe (2026-04-26T17:00Z):**
- Clarified execution model: sub-issues (#83, #84, #85, #86) are the unit of work, not the epic itself.
- Epic-level prototype branch (`squad/82-full-local-k3d-dev-loop`) attempted all four tracks at once; Chunk rejected for missing corrupt-state recovery.
- Decision: Return to issue-first sequencing. Start with #83 (k3d orchestration + state file), then #84 (portal containerization), then #85 (override scripts), then #86 (JSON polish).
- Rationale: Thin slices, explicit contracts, state-recovery validation before fanning out. Issue #83 becomes the blocking gate.
- Decision written to `.squad/decisions/inbox/mikey-reframe-epic-82-subissues.md` for Scribe merge.

## Key Decisions & Patterns

**Phase 0 → Phase 1 Boundary (Issue #55):** Rollout contract complete — stateless control-plane with per-instance Postgres provisioning. Single-replica RollingUpdate (maxSurge:0, maxUnavailable:1) + graceful shutdown validated.

**Issue #42 Control-Plane Contract (LOCKED):** Thin control-plane is sole orchestrator; tenant app never calls back. Surfaces: /health (liveness), /ready (readiness), /_control/info (state), /_control/maintenance (drain). Kubernetes handles reconciliation. No /_control/bootstrap in Phase 1.

**Gatekeeper Race Condition (PR #60):** Check-then-merge is not atomic. Lesson: gates must either re-check immediately before merge, lock PR state during evaluation, or use GitHub-native branch protection.


## Learnings

- **PR #120 reopened gate after b73017f (2026-04-27):** The current code patch still fails the two newly opened Copilot threads, so do **not** resolve them on top of `b73017fbc2f75a903d3ac774dc3aa712e19e249c` / current local head `99d2cb20671e949eca3e38aadf94a7cf8781851d`. `scripts/k3d/down.sh --keep-cluster` still uses blocking `kubectl delete namespace` calls with no `--wait=false` or bounded timeout, and `scripts/k3d/status.sh` still populates `state_*` via eight independent `node -e` reads, which breaks the documented "all empty on failure" contract if a mid-read parse fails or the file changes. Minimum acceptable fix stays thin: make namespace teardown non-blocking/bounded, parse the status state in one snapshot (or re-clear on every failure path), and add focused regression coverage for those exact contracts. Validation remains `bash -n scripts/k3d/up.sh scripts/k3d/down.sh scripts/k3d/status.sh && node --test apps/control-plane/test/k3d-persistent-lane.test.ts`; green checks are necessary but not sufficient for review-thread closure. Key paths: `scripts/k3d/down.sh`, `scripts/k3d/status.sh`, `apps/control-plane/test/k3d-persistent-lane.test.ts`. User preference: do not use `claude-opus-4.7` without asking first.

- **PR #120 gate after b73017f (2026-04-27):** The four remaining k3d follow-up threads are satisfied on commit `b73017fbc2f75a903d3ac774dc3aa712e19e249c`. Accept the thin fixes only: README now describes `k3d:up` as safe to re-run/reconcile, `status.sh` and `down.sh --keep-cluster` use explicit `kubectl --context` targeting instead of mutating kubeconfig, and `up.sh` moves token-snippet construction into `build_token_snippet()` with regression coverage for embedded quotes. Focused gate remains `bash -n scripts/k3d/up.sh scripts/k3d/down.sh scripts/k3d/status.sh && node --test apps/control-plane/test/k3d-persistent-lane.test.ts`. Key paths: `platform/k3d/README.md`, `scripts/k3d/up.sh`, `scripts/k3d/down.sh`, `scripts/k3d/status.sh`, `apps/control-plane/test/k3d-persistent-lane.test.ts`.

- **Phase 2 sequencing for auth/restore/isolation (2026-04-21):** Recommended order is `#69 → #56 → #40`. Start with the provisioning seam in `apps/control-plane/src/provisioning.ts`: it still injects a shared runtime `DATABASE_URL` into each tenant Secret, so least-privilege per-tenant Postgres roles are the thinnest credible security slice and should land before broader auth or restore choreography. Then do `#56` to lock Keycloak realm/client boundaries across control plane + tenants without mixing restore UX into the auth migration. Keep `#40` last because the current restore path is still tenant-local (`apps/api/src/routes/admin-routes.ts`) and the docs/UI already warn that active users are not put into maintenance automatically (`README.md`, `apps/web/src/SiteAdminPanel.tsx`); that workflow should consume the auth and credential boundaries rather than define them.

- **Separate-issue threshold for restore work (2026-04-21):** No new blocker issue is required to start `#69` or `#56`. For `#40`, only split new work into a dedicated follow-up if the team wants hosted control-plane orchestration or proactive live client notifications in the first slice: `RUNTIME.md` reserves `/_control/maintenance` endpoints, but they are explicitly not implemented yet, so folding that control surface plus push-style UX into the first restore fix would create a second feature hiding inside the restore issue.

- **Key file paths for Phase 2 triage (2026-04-21):** Security seam: `apps/control-plane/src/provisioning.ts`, `apps/control-plane/test/provisioning.test.ts`. Control-plane runtime/auth entrypoint: `apps/control-plane/src/index.ts`, `apps/control-plane/README.md`. Tenant restore behavior + warnings: `apps/api/src/routes/admin-routes.ts`, `apps/api/src/note-store.ts`, `README.md`, `apps/web/src/SiteAdminPanel.tsx`. Locked contracts: `.squad/decisions.md`, `RUNTIME.md`.

- **Admin/Operator Platform Gap Analysis (2026-04-21T10:30Z):** Reviewed epic #42 and all remaining open issues to answer: "Does remaining scope cover the operator/admin application?" Found: (1) Fleet status #57 is read-only observability dashboard; (2) Keycloak #56 supplies auth boundaries but not operator UI; (3) Restore #40 assumes manual control-plane triggering without specifying operator surface. Verdict: No dedicated operator portal issue exists. Current scope covers *what* operators see (#57) and *how to authenticate them* (#56), but not *how they control the platform*. Recommendation: Split Phase 3 into two explicit issues — #57 (fleet status, observability) + NEW (control-plane operator portal, control surface). This unblocks architecture clarity on whether the control plane stays a headless API or needs a paired UI.

- **PR #120 Final Review Gate & Thread Resolution (2026-04-27T16:12:05Z):** Gated Brand's final patch for PR #120. Confirmed 7d2d7fc on PR head containing two review fixes: (1) removed unused `STATE_DIR` declaration from scripts/k3d/status.sh; (2) updated scripts/k3d/down.sh help text to describe exact teardown behavior instead of promising unconditional `.k3d-state/` removal. Decision: keep final fixes thin (no architecture changes or fresh abstractions). Posted targeted replies on both remaining Copilot threads, resolving both without widening scope. All review threads now closed. Decisions merged: mikey-final-review-gate.md. Session log: `.squad/log/2026-04-27T16:12:05Z-pr120-review-closure.md`. PR #120 ready for merge gate checks. — Mikey (Lead)

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
- **Issue #76 reviewer gate — Keycloak subject beats mutable email (2026-04-22):** Runtime Keycloak wiring is structurally sound, but owner reconciliation cannot blindly overwrite `owner_accounts.email` after matching on `keycloak_sub`. In `apps/api/src/note-store.ts`, a Keycloak user who changes their IdP email to one already held by another local owner record currently trips the unique email index and turns a normal sign-in into a 500. For IdP-backed auth, treat `sub` as the durable identity key, treat email as a mutable claim, and handle collisions explicitly with a controlled product error or a no-op email update instead of letting the database decide at request time.
- **Issue #76 re-review after 88f53dd (2026-04-22):** The rejection is resolved. `findOrCreateOwnerByKeycloakIdentity()` now treats `keycloak_sub` as the durable lookup key and preserves the stored owner email when an IdP email change would collide with another local account, so tenant sign-in no longer falls through to a unique-index 500. Branch validation (`npm run lint && npm run build && npm run test`) is green; the only leftover note is duplicate Keycloak example vars in `apps/api/.env.example`, which is config-doc churn rather than a runtime/auth blocker.

- **Issue #79 k3d validation scope (2026-04-22):** Treat the remaining k3d gap after #63 as one platform workflow issue, not two separate tracks: pair a repeatable full-stack smoke lane with one proven live component override. The thinnest credible slice is `tenant-api` live outside the cluster while `tenant-web` and the rest of the stack stay on k3d. Keep the smoke trigger at the highest operator surface available (eventually the operator portal from #68), but do not block the issue on portal completion.

- **PR #78 triage — two unresolved review comments (2026-04-22T19:25Z):** Operator-portal feature PR has 2 unresolved comments. (1) Test mock handlers for POST /internal/tenants* do not return error Response when called unexpectedly; they return `undefined`, causing confusing test failures. Route to Brand to fix test harness. (2) `.squad/agents/stef/history.md` has duplicate "## Core Context" headers (lines 16+22) with identical timestamps; documentation clarity issue. Route to Scribe for history cleanup. Both are low-risk, isolated fixes with clear ownership. No architecture questions needed.

- **PR #78 final unresolved comment — normalizeBasePath duplication (2026-04-22T19:50Z):** One unresolved thread remains on PR #78. Review comment flags `normalizeBasePath()` duplication in `vite.config.ts:5-17` and `src/config.ts:3-15`; requests extraction into shared utility (`src/normalize-base-path.ts`) to prevent config-logic drift. Scope: remove function from both sites, create utility, add imports. Routed to Brand (platform owner). No architecture blocker; straightforward 5-minute refactor.

- **PR #120 final thread closure pattern (2026-04-27):** For thin review-follow-up on platform scripts, verify the exact fix commit is the PR head before touching GitHub threads, then reply on each stale thread with the commit SHA and the specific file-level change before resolving it. This kept the closure honest for the last two PR #120 comments: `scripts/k3d/status.sh` only needed the dead `STATE_DIR` removal, and `scripts/k3d/down.sh` only needed help text that matches `remove_state_artifacts`. Key paths: `scripts/k3d/status.sh`, `scripts/k3d/down.sh`, `.squad/agents/mikey/history.md`.
- **PR #120 review gate — four k3d follow-ups still block closure (2026-04-27T16:45Z):** Current PR head still contains all four newly opened review issues, so do not resolve those threads yet. Minimum acceptable patch stays thin and platform-owned: (1) fix `platform/k3d/README.md` to say `k3d:up` is safe to re-run/reconciles instead of claiming a no-op; (2) remove kube-context side effects from `scripts/k3d/status.sh` by using `kubectl --context` or equivalent no-persist read-only targeting; (3) make `scripts/k3d/down.sh --keep-cluster` equally context-safe without leaving developers on `k3d-${CLUSTER_NAME}`; (4) simplify `scripts/k3d/up.sh` `write_state()` token snippet generation so JSON writing takes plain argv strings rather than nested shell-quote gymnastics, with a focused regression covering embedded quotes. Focused validation for this slice remains `bash -n scripts/k3d/up.sh scripts/k3d/down.sh scripts/k3d/status.sh && node --test apps/control-plane/test/k3d-persistent-lane.test.ts`. Key paths: `platform/k3d/README.md`, `scripts/k3d/up.sh`, `scripts/k3d/down.sh`, `scripts/k3d/status.sh`, `apps/control-plane/test/k3d-persistent-lane.test.ts`.

## Epic #87 Validation — Synthesis & Close Verdict (2026-04-25)

Led team synthesis after Data, Brand, Stef, Chunk completed validation pass on Epic #87 (6 acceptance criteria). Formulated and posted verdict to GitHub issue #87 (comment link in decisions.md).

### Verdict

**Close Epic #87 as completed.** Open P1 follow-up issue: "Wire shared module tests into CI (keycloak-jwt, portal-utils)".

### Key Findings

All 6 criteria are **code-complete and functional**:
1. Tenant API control endpoints — Real drain + gate
2. Control-plane backup/restore — Real pg_dump/pg_restore, full audit trail
3. Keycloak-jwt consolidation — Zero duplication, shared module wired
4. normalizeBasePath consolidation — Zero duplication, shared module wired
5. Note-store split — 880 lines → 8 focused modules
6. Tenant-registry migrations — Umzug + advisory locks, production-grade

### CI Gap

Two shared modules have tests not in CI:
- **keycloak-jwt**: 19 tests, security-critical, must lock token verification
- **portal-utils**: 8 tests, shared config, must lock API proxy setup

### Decision Rationale

Feature implementation is **complete**. CI wiring gap is **infrastructure configuration**, not missing functionality. Separating "feature complete" from "quality tooling wired" prevents artificial epic inflation and keeps roadmap signals clean.

### Session

- Log: `.squad/log/2026-04-25T22:54:46Z-87-validation.md`
- Orchestration logs: All 5 agents in `.squad/orchestration-log/2026-04-25T22:54:46Z-*`
- Decisions merged to `.squad/decisions.md`

---

### PR #120 Regression Test False-Green Fix (2026-04-26)

**Problem:** Data's revision fixed the runtime behavior but the regression test had a critical flaw: it set `STATE_FILE` env var in the test, but `status.sh` hardcodes `STATE_FILE="${ROOT}/.k3d-state/state.json"` from git root and never respects that env var. The test wrote fixtures to a temporary location the script never read, creating false-green coverage — it would pass on both broken and fixed implementations.

**Solution:** Changed the test to populate the REAL state path that `status.sh` actually reads (`${repo_root}/.k3d-state/state.json`), with backup/restore to avoid test pollution. Now the test genuinely proves:
1. Persisted cluster name is the default when no env override is set
2. `K3D_CLUSTER_NAME` override wins for both actual targeting and reported JSON output
3. The script reads the real state source/path contract used in production

**Key lesson:** When testing shell scripts that hardcode their config source paths, never fake the source by setting an env var the script doesn't read. Either populate the real path (with backup/restore for safety) or extract the config resolution into a sourceable helper that can be tested in isolation.

**Pattern applied:** Env-override contract testing (captured in `.squad/skills/env-override-contract-testing/SKILL.md`). The skill now documents the anti-pattern of setting unused env vars and the correct approach of exercising the real config path.

**Validation:** All 202 tests pass, lint clean, build green. Pushed as commit `6a00d3a`.

**Key files:** `apps/control-plane/test/k3d-persistent-lane.test.ts`, `scripts/k3d/status.sh`, `.squad/skills/env-override-contract-testing/SKILL.md`.

### PR #120 Review Gate Verdict (2026-04-27)

**Review threads:** The four still-open GitHub review threads do not appear to need fresh implementation on current head. `scripts/k3d/up.sh` already re-imports cached images during `--no-rebuild`, locks `.k3d-state` to `0700/0600`, and `apps/control-plane/test/k3d-persistent-lane.test.ts` now asserts those permissions while using temp fixtures via `K3D_STATE_FILE` instead of the repo-default state path.

**Smoke verdict:** The failing `smoke` check looks like cluster/bootstrap fragility in CI, not a clear regression from the persistent-lane PR. The uploaded diagnostics show the agent node stuck `NotReady`, `CIDRAssignmentFailed`, repeated flannel `subnet.env` sandbox failures, no captured tenant resources, and the control plane timing out waiting for tenant readiness after the cluster was already unhealthy.

**Key files:** `scripts/k3d/up.sh`, `apps/control-plane/test/k3d-persistent-lane.test.ts`, `.github/workflows/k3d-smoke.yml`, and the `k3d-smoke-diagnostics` artifact files `events.txt`, `nodes.txt`, `live-workdir/control-plane.log`.

---


### PR #120 Review Gate — Five Open Comments (2026-04-27)

**Scope:** FFMikha has addressed the first batch of 5 comments with merged fixes (image import, file permissions, test isolation, state read contract). Five NEW comments have surfaced in current head requiring review gate assessment.

**Five open comments:**
1. **down.sh:142** — `rm -rf "${STATE_DIR}"` during `--keep-cluster` lacks path validation
2. **down.sh:151** — Same `rm -rf` risk during early exit (cluster missing)
3. **down.sh:157** — Same `rm -rf` risk during full teardown
4. **up.sh:42** — `previous_kube_context` calls kubectl before `require_tool kubectl` runs → noisy error if kubectl missing
5. **up.sh:485-487** — Secret FQDNs hardcode `dnd-notes-platform` instead of `${PLATFORM_NAMESPACE}` variable

**Acceptance criteria per comment:**

| Comment | Criterion | Category | Path | Rationale |
|---------|-----------|----------|------|-----------|
| 1, 2, 3 | **Delete-safety:** Validate `STATE_DIR` is under repo root before `rm -rf` (or delete only state.json) | **Blocking** | down.sh, lines 142/151/157 | Arbitrary env override of `K3D_STATE_FILE` could delete system dirs; same pattern repeated 3x |
| 4 | **Startup clarity:** Guard kubectl call or move after `require_tool` check to avoid "command not found" noise | **Minor** | up.sh:42 | Doesn't affect correctness, only startup message clarity |
| 5 | **Config coherence:** Replace hardcoded `dnd-notes-platform` with `${PLATFORM_NAMESPACE}` in 3 Secret URIs | **Deferred** | up.sh:485-487 | Single-source principle; namespace is already a variable; safe refactor but not urgent |

**Patch scope assessment:**
- **Comments 1–3:** One surgical fix — extract path validation helper, apply to all 3 `rm -rf` sites. ~10 lines.
- **Comment 4:** One-line guard or simple reorder. ~3 lines.
- **Comment 5:** Variable substitution in 3 literal strings. ~1 line.
- **Total:** Addressable in one small platform patch (~15 lines, no logic changes, purely defensive).

**Delete-safety pattern risk:**
The three delete calls all derive `STATE_DIR` from `K3D_STATE_FILE` env var without validation:
```bash
STATE_DIR="$(dirname "${STATE_FILE}")"  # line 11
# ... later ...
rm -rf "${STATE_DIR}"  # lines 142, 151, 157
```
If `K3D_STATE_FILE=/tmp` (or unset, causing literal path mangling), `STATE_DIR` could be `/tmp`, `/`, or repo root. 
**Proposed fix:** Before each rm, validate:
```bash
if [[ ! "${STATE_DIR}" =~ ^"${ROOT}/.k3d-state" ]]; then
  log "ERROR: STATE_DIR validation failed"; exit 1
fi
rm -rf "${STATE_DIR}"
```

**Status:** All five comments are non-conflicting and can be batched into one patch. No rework of functional logic required—purely defensive + config coherence. Ready for Brand to land as platform patch.

**Next:** Confirm Brand's patch addresses all five + validate smoke re-runs green.

---

### PR #120 Review Gate — Two Remaining Copilot Threads (2026-04-27)

**Verdict:** Current PR head `fa3412d` is still not ready to close. I replied on both unresolved Copilot threads and requested changes so the scope stays explicit.

**Minimum acceptable fix:**
1. `scripts/k3d/status.sh` — remove the dead `STATE_DIR` declaration. This is cleanup, not a reason to add new logic.
2. `scripts/k3d/down.sh` — narrow the help text so it matches `remove_state_artifacts`: delete `state.json`, and remove the default `.k3d-state/` directory only when it is empty.

**Revision owner:** Brand. This is platform-script follow-up, isolated to shell maintenance and user-facing CLI wording.

**Audit update:** Brand's worktree patch is acceptable. `scripts/k3d/status.sh` now drops the dead `STATE_DIR` declaration, and `scripts/k3d/down.sh --help` now states the real `remove_state_artifacts` behavior. `bash -n` passes on both helpers, so the two GitHub threads can be resolved as soon as that patch is committed and pushed.

**Key files:** `scripts/k3d/status.sh`, `scripts/k3d/down.sh`, `.github/workflows/k3d-smoke.yml`, PR #120 review threads `discussion_r3148441136` and `discussion_r3148441222`.


### PR #120 Smoke Audit — failure category and gate (2026-04-27)

**Verdict:** The current `smoke` failure on head `d3f6fd6` is most likely **transient CI/bootstrap noise**, not a code regression from the latest diff. The only head change was another tweak inside `apps/control-plane/test/k3d-persistent-lane.test.ts`, while the failing evidence comes from the live GitHub Actions k3d lane: diagnostics show `k3d-dnd-notes-agent-0` stuck `NotReady`, early flannel sandbox errors (`subnet.env` missing), and agent startup aborting with `failed to start networking ... unexpected EOF`. The control plane then times out waiting for the tenant workload because the cluster never reaches a healthy enough state to schedule it; the later Postgres `Connection terminated unexpectedly` is teardown fallout, not the initiating cause.

**Resolution threshold:** Do not churn product code on this evidence alone. Minimum acceptable proof to call this resolved is one clean `smoke` rerun on the same implementation (or an equivalent no-behavior-change head) with diagnostics showing a healthy agent node and actual tenant resources appearing, or a narrowly scoped workflow/bootstrap hardening patch that directly addresses the agent/flannel instability and then turns the lane green. Until one of those happens, treat this as an infra-flake under observation rather than a merged runtime fix.

**Key paths / artifacts:** `.github/workflows/k3d-smoke.yml`, `scripts/k3d/smoke.sh`, `apps/control-plane/test/k3d-persistent-lane.test.ts`, Actions run `25002615780` job `73216625906`, artifact `k3d-smoke-diagnostics` (`nodes.txt`, `events.txt`, `live-workdir/control-plane.log`, `k3d-dnd-notes-agent-0.log`).

- **PR #120 Smoke & Review Gate Audit (2026-04-27T15:23:12Z):** Independently audited PR #120 smoke failure and verified review resolution. Classified smoke failure as transient CI/k3d bootstrap noise (agent NotReady, flannel sandbox failures, network startup EOF) rather than code regression; gate only on rerun or narrow hardening patch. Verified all five review comments resolved by Brand patch 6cd1545; all threads closed. Approved JSON-quote-escaping refactor gate (move snippet construction outside node -e, add shell-syntax regression test, ~27 lines). Five decisions merged to squad/decisions.md. Orchestration log: `.squad/orchestration-log/2026-04-27T15:23:12Z-mikey.md`. PR ready for merge pending CI smoke rerun. — Mikey (Agent)

- **PR #120 Review Gate Pass (2026-04-27T17:10:21Z):** Completed audit and resolution of all 4 review threads on commit b73017f. All threads resolved by reviewer. Gate clear from review side. Checks (smoke, validate x2) in progress. Orchestration log: `.squad/orchestration-log/20260427-171021-mikey.md`. Session log: `.squad/log/20260427-171021-pr120-b73017f-review-closure.md`. — Mikey (Agent)
## Epic #82 Triage & Kickoff Plan (2026-04-25T23:30Z)

**Status:** READY TO START (no blockers).

**Context:** PR #78 (operator portal, issue #68) merged 2026-04-22. Focus file stale. Epic #82 is next (labeled `squad:mikey`).

### Assessment

Platform is **ready for #82 execution**:
- Both portals (`apps/operator-portal`, `apps/customer-portal`) exist
- k3d scaffolding in place from #42 (control plane, Keycloak, Postgres, ingress)
- `tenant-api-override.sh` pattern proven from #79
- Zero architectural gaps; scope is infrastructure + orchestration only

### Decomposition (4 slices, 2–3 week delivery)

**Slice 1 (Brand):** Persistent k3d orchestration (`npm run k3d:up/down/status`, idempotent, `.k3d-state/state.json`, `--json` output). Unblocks Slices 2–3.

**Slice 2A (Brand):** Operator portal containerization (Dockerfile, k3d manifests, ingress). Parallel with 2B. Depends on Slice 1.

**Slice 2B (Stef):** Customer portal containerization (mirrors operator pattern). Parallel with 2A. Depends on Slice 1.

**Slice 3 (Brand):** Portal dev override scripts (`operator-portal-override.sh`, `customer-portal-override.sh`). Pattern: vite dev locally, rest in k3d. Depends on Slices 1–2.

**Slice 4 (Brand + Scribe):** Agent-friendliness polish (JSON schema, single-source-of-truth docs). Depends on Slices 1–3.

### Key Decisions

- **Containerization:** Nginx serving pre-built dist for production-like consistency
- **Idempotency:** All `k3d:*` scripts safe to re-run; state file drives reconciliation
- **Override pattern:** Reuse `tenant-api-override.sh` approach (local dev + routing), no new DX patterns
- **Non-goal:** No production CD changes; CI image builds optional per #42

Decision document: `.squad/decisions/inbox/mikey-epic-82-kickoff.md`

**Decision Point Triage:** Blocking questions force explicit answers (auth strategy, versioning, backup ownership, Keycloak timing) before execution. Architecture spike → decision resolution → execution kickoff.

## Learnings

**Epic Decomposition Discipline (2026-04-26):** When an epic is properly decomposed into sub-issues, the team must work **only** on the sub-issues, never on the epic branch itself. Attempting to deliver all tracks in a single epic-level PR invites massive review friction and makes it hard to validate contracts independently. Each sub-issue must have its own worktree and land independently. This prevents cross-cutting changes from getting tangled and makes rollback/pivot straightforward. Key pattern: thin contract first (e.g., orchestration + state file in #83), then everything else depends on that locked interface.

**Corrupt State as a Blocker (2026-04-26):** When a prototype is rejected for missing state-recovery logic, that gap must be resolved in the foundational issue before the team fans out. State corruption can cascade; it's not a polish-later item. The rejection of the #82 prototype for missing recovery logic is correct — that validation must happen in #83.

**Issue #83 Namespace Mutation Root Cause (2026-04-26):** State persistence bug in `mergeStoredState()` → `normalizeState()` chain. The flow spreads default resources (with default namespace) after recalculating the namespace from subdomain, overwriting custom-stored namespaces. Fix: after normalizing merged state, preserve explicitly-stored custom namespace if no subdomain was stored (indicating manual namespace assignment). Key file: `scripts/k3d/local-platform.mjs` lines 248–384. Test: `k3d-local-platform-script.test.ts:48–77`. Surgical fix preserves state contract without redesign.

**Reviewer Lockout & Cascading Rejections (2026-04-26):** When two authors in sequence are rejected on the same issue, the second rejection often surfaces a NEW bug (not just re-rejection of the same problem). Strict lockout applies only to the immediate author; if the issue has measurable progress (corrupt state recovered), a fresh perspective (Copilot or different domain owner) can revise narrowly. Pattern: Brand locked (first author, architecture cycle), Data available to review but not revise (new bug discovered), Copilot ideal for surgical fix (clear spec, failing test, isolated scope).


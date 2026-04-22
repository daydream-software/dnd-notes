# Project Context

- **Owner:** FFMikha
- **Project:** dnd-notes
- **Description:** A D&D note-taking app for capturing campaign notes, characters, locations, and session details.
- **Stack:** React, Material UI, Node.js
- **Created:** 2026-04-11T19:00:21.594Z

## Core Context

Scribe initialized as the team's memory and decision merger.

## Recent Updates

📌 Team initialized on 2026-04-11 with Mikey, Stef, Data, Chunk, Brand, Scribe, and Ralph.

**📋 2026-04-19 — Gatekeeper Traceability Enhancement Implemented**
- Decision merged from `.squad/decisions/inbox/brand-gatekeeper-trace-note.md`.
- Implementation: `.github/workflows/copilot-pr-automerge.yml` updated with merge-trace logic.
- Changes: (1) Added `mergeTracePrefix` and `mergeTraceMarker` constants; (2) `getTriggerContext()` function captures event type + run context; (3) `getFreshCopilotReview()` now returns review object (not just bool) with timestamp; (4) `getActiveCopilotThreadCount()` returns count (not just bool); (5) New `findExistingMergeTraceComment()` and `ensureMergeTraceComment()` functions post SHA-keyed idempotent PR comment before merge; (6) `mergePullRequest()` pinned to evaluated head SHA.
- Comment format: Visible grep-key `[copilot-gatekeeper] merge-trace`, hidden marker keyed to head SHA, includes: head SHA, CI run status, Copilot review state + timestamp, active thread count, trigger/run context.
- Validation: Skill documented in `.squad/skills/github-pr-gatekeeper-trace-notes/SKILL.md`. Workflow changes staged but not yet committed.
- Status: **Ready for validation & commit**. PR comment will be recorded atomically before each merge attempt, supporting post-hoc incident auditing.

**📋 2026-04-18 23:15 UTC — Gatekeeper/Autoclose Incident Reported**
- PR #59 (Containerize dnd-notes, Issue #52) did not auto-close as expected.
- Subsequent manual gatekeeper run closed #59 but also unexpectedly closed #60 (Control-plane skeleton, Issue #53).
- Status: Under investigation. No root-cause determination recorded yet. Team has context for triage.

**📋 2026-04-19 — Gatekeeper Analysis Disputed & Investigation Reopened (PR #60 Eligibility Timing)**
- FFMikha disputed prior gatekeeper analysis regarding PR #60 eligibility timing.
- Team reopened investigation focused on exact system state at manual workflow_dispatch timestamp.
- Incident context recorded; root cause TBD.

**📋 2026-04-19 00:38 UTC — Gatekeeper Traceability Enhancement Requested**
- FFMikha requested that the merge/close workflow add a traceability note directly on PRs describing observed merge conditions.
- Rationale: Improve post-hoc auditing during incident investigation (informed by #59, #60 incidents).
- Request logged to `.squad/decisions/inbox/ffmikha-pr-traceability-note.md` — awaiting implementation decision.

**📋 2026-04-19 — PR #60 Squash-Merged by Mistake; #52 Restart Requested**
- **Incident:** PR #60 (Control-plane skeleton, Issue #53) was squash-merged to main by mistake, collapsing commit history.
- **Impact:** Issue #52 (Containerize dnd-notes) now needs to be restarted from the corrupted main branch state.
- **Requested recovery steps (from FFMikha):**
  1. Push current local main changes first (includes Gatekeeper trace-note workflow implementation)
  2. Add incident note to PR #60 documenting the squash-merge mistake
  3. Recreate the #52 worktree (`squad/52-containerize-tenant-app`) from new main state
  4. Open a follow-up PR for #52 with Copilot review seeded into the queue
- **Status:** REQUEST LOGGED. Implementation pending. No success claimed until all steps complete and new PR opens.
- **Dependencies:** Copilot must handle the recovery workflow; this entry captures the request only.

**📋 2026-04-19 — #52 Follow-up Restart Completed**
- **Incident recovery:** PR #60 squash-merge corruption required #52 container work restart from corrupted main.
- **Implementation outcome:**
  - ✅ Gatekeeper trace-note workflow merged to main (`chore(ci): add merge trace notes for PR gatekeeper (#52)` commit 15d0273).
  - ✅ #52 follow-up worktree restored: `squad/52-containerize-tenant-app-followup` branch created with fix for PR #60 review follow-up blocker.
  - ✅ PR #61 opened (`fix(platform): finish PR #60 review follow-up`, state: OPEN, merged from `squad/52-containerize-tenant-app-followup` branch at commit f0e285d).
  - ✅ All recovery steps completed; #52 follow-up now proceeding independently from #60 squash-merge corruption.
- **Status:** RECOVERY VERIFIED. PR #61 awaiting review; #52 containerization work isolated and resumable.

## PR #78 Review Follow-Up Round (2026-04-22T19:12+)

**Context:** PR #78 (feat: operator-portal, issue #68) entered second review-fix cycle after Copilot re-review. Two open threads remained unresolved:

1. **ProvisionTenantPanel mutation guard (blocking):** `disabledReason` was enforced only in `handleSubmit()`, allowing `handleConfirm()` to proceed if fleet state changed while the dialog was open. Required re-check in `handleConfirm()` and confirm-button gating.
2. **OperatorPortal.actions.test rollout matrix readability:** Test case names rendered as `[object Object]` instead of readable scenario labels, making CI failures hard to diagnose.

**Resolution:**
- Copilot implemented both fixes locally on `squad/68-operator-control-portal` branch and verified with focused lint/test/build (green).
- FFMikha reviewed fixes and approved the batch; Chunk QA-validated gates.
- Stef contributed code review feedback and sign-off on test coverage.
- Outcome: Two test-helpers return explicit error responses on unexpected calls; rollout matrix now uses labeled test scenarios for readable Vitest output.

**Review threads remaining (1 unresolved):**
- `.squad/agents/stef/history.md` duplicate "## Core Context" header noted; Copilot flagged for cleanup.
- `OperatorPortal.actions.test.tsx` fetch-mock error handling: handler should return 500 instead of undefined when unexpected endpoint called (deferred; labeled as good-catch but non-blocking).

**Status:** Ready for final push + thread resolution. FFMikha batching final commit and review-comment replies.

**Team pattern:** Data's code-review classification (blocking/deferred/N/A) applied here: two fixes classified blocking + in-flight fixes; remaining lint/CI noise classified deferred. Queue state green, PR mergeable after final reply.

## PR #78 Review Follow-Up Round 2 (2026-04-22T19:22:45+)

**Triage:** Two new review comments + control-plane test failure detected.

**Review comments (new, unresolved):**
1. **`readStoredKeycloakTokens()` validation (blocking):** No validation of parsed JSON shape. If storage contains objects missing `accessToken`/`refreshToken` or with non-string values, Keycloak init/refresh throws confusingly. Should validate presence and type of both tokens before returning, clear storage and return null if invalid.
2. **`clearSession()` incomplete state reset (blocking):** Clears tokens and view state but leaves `error` and `isLoadingFleet` set. Previous errors remain visible on sign-out, misleading operators. Should also reset these fields in `clearSession()` for clean logged-out UI state.

**CI failures detected:**
- **control-plane: failed** (validate job 72572222903 completed 19:22:23). Test summary shows 3 workspaces passed (web, api, operator-portal) but control-plane test suite failed. Build succeeded. This appears to be a pre-existing flaky control-plane regression, not caused by PR #78 operator-portal changes.

**Current status:** PR mergeable after addressing two new Keycloak session-management issues. Control-plane failure flagged as out-of-scope per squad.identity/now.md guidance ("avoid disturbing the separate flaky control-plane CI diagnosis unless a dedicated follow-up is requested").

## Learnings

Initial squad setup complete.

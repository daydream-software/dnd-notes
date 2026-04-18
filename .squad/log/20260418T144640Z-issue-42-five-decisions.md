# Session Log: Issue #42 — Five Decisions Review & Gate Status

**Date:** 2026-04-18T14:46:40Z  
**Session Context:** Review phase for three parallel decision evaluations on issue #42 (Platform Direction). Conflicting recommendations require explicit user direction before Phase 0 execution can proceed.

---

## Phase Summary

**Agents reviewed:** Brand (Platform Dev), Mikey (Lead), Data (Backend Dev)  
**Proposals evaluated:** 3 independent evaluations of the same 5 cross-cutting decisions  
**Duration:** ~1 hour of parallel writing + 30 min review  
**Outcome:** 2 agree on SQLite for Phase 0; 1 recommends Postgres for Phase 0. Disagreement is on decision #5 only.

---

## Decisions 1–4: Consensus ✅

All three proposals agree on:

1. **Image Registry:** GitHub Container Registry (ghcr.io)
2. **Ingress Controller:** ingress-nginx via AKS add-on
3. **DNS & TLS:** Wildcard certificate + cert-manager DNS-01
4. **Secret Backend:** Plain Kubernetes Secrets (Phase 0–1 MVP), upgrade path documented

These are **ready to lock** into `.squad/decisions.md` without user input.

---

## Decision #5: Conflicting (BLOCKED PENDING USER INPUT) ⚠️

**Decision point:** Single-writer enforcement / tenant persistence model.

### Brand's Recommendation
- **Title:** "Single-Writer Enforcement" (control-plane validation)
- **Model:** SQLite per tenant + Azure Disk PVC + control-plane validation + readiness probe safety net.
- **Timeline:** Phase 0 proves rolling updates (2–3 weeks). Postgres deferred to Phase 1–2 after operational measurement.
- **Rationale:** SQLite + PVC is proven; the real work is orchestration. Defer database-infrastructure complexity until Phase 0 foundation is validated.
- **Risk profile:** Medium. Requires explicit rollout/restore choreography. Payoff: simpler Phase 0.

### Mikey's Recommendation
- **Title:** "Five Decisions (Revised for Postgres Pivot)"
- **Model:** Shared Postgres instance + per-tenant databases + per-instance DB users + centralized pg_dump backups.
- **Timeline:** Phase 0 includes **NoteStore Postgres migration** (5–7 days, sync → async). Pods become stateless immediately.
- **Rationale:** Eliminates single-writer risk; rolling updates become trivial (no stateful choreography). Trade-off is NoteStore rewrite.
- **Risk profile:** Medium-high effort, lower operational risk long-term. Payoff: significantly simpler K8s orchestration.

### Data's Recommendation
- **Title:** "Postgres Direction from Backend/Data Perspective"
- **Model:** Keep SQLite for tenant instances. Explicit single-writer choreography **now**. If Postgres ever enters, control plane only (not tenants), and only when evidence of multi-replica writes/high concurrency exists.
- **Timeline:** Phase 0 with SQLite. Phase 1–2 (or never) for Postgres.
- **Rationale:** Per-tenant DB users do **not** solve rolling updates. Centralized backup is necessary but insufficient for safe restore. Real work is in orchestration, not database choice. Postgres is a control-plane escalation path, not a tenant-database default.
- **Risk profile:** Low effort Phase 0, but requires explicit operational discipline. Payoff: focused, proven approach.

---

## Implications of Each Path

### SQLite Path (Brand + Data agreement)
**Phase 0:**
- App unchanged (no NoteStore rewrite).
- Control plane validates single-writer: `replicas: 1` only, no autoscaling.
- PVC mounts to one pod; readiness probe detects multi-pod scenarios.
- Rolling updates: explicit choreography (drain → scale down → scale up).

**Phase 0 gate:**
- ✅ App runs (no changes).
- ✅ PVC survives pod termination.
- ✅ Rolling update succeeds without data loss.
- ✅ k3d ↔ AKS parity validated.

**Phase 1–2 gate (Postgres optional):**
- Measure operational load (backup time, restore SLA, cost).
- If ops burden is high → **then** pivot to Postgres.
- If SQLite + Blob backups is sufficient → stay SQLite.

### Postgres Path (Mikey)
**Phase 0:**
- **New critical-path work:** NoteStore adapter (sync `better-sqlite3` → async `node-postgres`). ~2600 lines, mechanical but substantial.
- Control plane simplified: provisions Postgres users/databases instead of PVCs.
- Pods are stateless; rolling updates are standard K8s `strategy: RollingUpdate`, no special choreography.
- SQLite kept as fallback for local dev (no Postgres dependency in dev).

**Phase 0 gate:**
- ✅ NoteStore adapter works (all API tests pass against Postgres).
- ✅ App runs against Postgres.
- ✅ Rolling update is stateless (zero-downtime).
- ✅ Local dev fallback (SQLite) still works.

**Phase 1+ gate:**
- Control plane multi-replica + Postgres HA seamlessly follow.

---

## Why the Disagreement Matters

**Phase 0 scope changes significantly:**

| Item | SQLite Path | Postgres Path |
|------|-------------|---------------|
| NoteStore rewrite | Not in Phase 0 | Critical path (5–7 days) |
| PVC architecture | Central to design | Eliminated for app data |
| Backup choreography | App-level (control plane owns it) | Native Postgres pg_dump/pg_restore |
| Rollout complexity | High (explicit single-writer rules) | Low (standard K8s rolling update) |
| Phase 0 timeline | 2–3 weeks | 3–4 weeks (+ NoteStore) |
| Postgres operational debt | Deferred | Assumed now (shared instance, per-tenant DBs) |

---

## Current Status

✅ **Decisions 1–4:** Ready to lock. No disagreement.  
⚠️ **Decision #5:** **User input required.** Three competent, well-reasoned evaluations. Two prefer SQLite + defer Postgres. One prefers Postgres now. No technical blocker; this is a **strategic choice** about phase scope and risk tolerance.

**Blocking:** Phase 0 execution cannot begin until decision #5 is resolved. Waiting on explicit user direction.

---

## Next Steps (Awaiting User Decision)

1. **User decides:** SQLite for Phase 0, or Postgres for Phase 0?
2. **Scribe action:**
   - Merge chosen recommendation(s) into `.squad/decisions.md`.
   - Retire non-chosen proposals (move to archive or delete inbox file).
3. **Execution begins:**
   - Brand starts #52 (Dockerfile) + #43 (K8s manifests) with the chosen persistence model.
   - If Postgres: Data starts NoteStore adapter in parallel.
4. **Phase 0 gate:** Locked once all 5 decisions are canonical.

---

## Files Involved

- **Inbox (unapproved):**
  - `.squad/decisions/inbox/brand-42-azure-direction.md`
  - `.squad/decisions/inbox/mikey-42-five-decisions.md`
  - `.squad/decisions/inbox/data-42-postgres-direction.md`
  - `.squad/decisions/inbox/copilot-directive-2026-04-18T14-40-44Z.md` (FFMikha's original directive)

- **Canonical (approved):**
  - `.squad/decisions.md` (currently not updated; waiting for user decision)

- **Orchestration log:**
  - `.squad/orchestration-log/20260418T144640Z-issue-42-five-decisions.md` (this session's conflict summary)

---

**Recommendation:** Route decision #5 to FFMikha + Mikey + Data for sync discussion (15 min call). SQLite vs. Postgres is a team call, not a technical blocker.


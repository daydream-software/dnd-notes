# Orchestration Log: Issue #42 — Five Decisions (Conflict Resolution)

**Date:** 2026-04-18T14:46:40Z  
**Context:** Three overlapping evaluations of the same 5 cross-cutting decisions; recommendation conflict on decision #5 (tenant persistence model).

---

## Proposals Received (chronological)

### 1. Brand (Platform Dev) — "Azure-First Evaluation"
**File:** `.squad/decisions/inbox/brand-42-azure-direction.md`  
**Stance:** Lock all 5 decisions **as-is** with SQLite + Azure Disk + control-plane validation for single-writer.  
**Key claim:** SQLite + PVC proves rolling updates in Phase 0 (2–3 weeks); defer Postgres to Phase 1/2.

### 2. Mikey (Lead) — "Five Decisions (Revised for Postgres Pivot)"
**File:** `.squad/decisions/inbox/mikey-42-five-decisions.md`  
**Stance:** Adopt Postgres backend + per-instance DB users + centralized backup **immediately in Phase 0**.  
**Key claim:** Eliminates single-writer risk; makes rolling updates trivial (pods are stateless).  
**Impact:** Requires ~2600-line NoteStore migration (sync → async) as critical path.

### 3. Data (Backend Dev) — "Postgres Direction from Backend/Data Perspective"
**File:** `.squad/decisions/inbox/data-42-postgres-direction.md`  
**Stance:** Do NOT move tenant databases to Postgres in the first hosted slice.  
**Key claim:** SQLite rolling updates and single-writer choreography are the *real* work; per-tenant DB users do not solve rolling updates; centralized backup is necessary but insufficient for rolling updates.  
**Reframe:** If Postgres enters at all, only for the control plane, and only when evidence of multi-replica writes/high concurrency exists.

---

## Conflict Summary

| Aspect | Brand | Mikey | Data |
|--------|-------|-------|------|
| **Tenant persistence** | SQLite (Phase 0) | Postgres (Phase 0) | SQLite (Phase 0) |
| **Single-writer strategy** | Control-plane validation | N/A (Postgres MVCC) | Control-plane validation + explicit choreography |
| **Centralized backup** | Via Blob + scripted SQLite cp | Via Blob + pg_dump | Via Blob + SQLite backup (control plane responsibility) |
| **When Postgres enters** | Phase 1–2 after operational measurement | Phase 0 (critical path) | Phase 1+ (control plane only), never for tenants |
| **NoteStore migration** | Not in Phase 0 scope | Critical path (5–7 days) | Not needed for first slice |

---

## Decision Points Requiring User Input

### A. Tenant Database Choice (Decision #5)
**Options:**
1. **SQLite + control-plane validation** (Brand/Data consensus, lower risk) — proves PVC + rolling updates in Phase 0; Postgres deferred to Phase 1+.
2. **Postgres + per-instance users** (Mikey) — higher immediate effort (NoteStore rewrite), but simpler ops long-term (stateless pods, MVCC safety).

**Implication:**
- Option 1 → Phase 0 gate is "PVC survives rolling update" → Phase 1 pivots to Postgres if needed.
- Option 2 → Phase 0 is SQLite + Postgres in parallel tracks; NoteStore adapter is critical path.

### B. Backup Model Refinement
All three agree centralized Blob backups are required. **Disagreement is scope:**
- Brand: PVC snapshots + Blob archive (Postgres later)
- Mikey: pg_dump → Blob (Postgres now)
- Data: Explicit backup choreography (control plane owns it, SQLite or Postgres later)

---

## Unresolved Dependencies

- **Mikey's decision** depends on accepting NoteStore Postgres migration as Phase 0 work.
- **Data's decision** depends on committing to explicit rollout/restore choreography for SQLite (deferred but defined).
- **Brand's decision** assumes Postgres is Phase 1+ scope; if Postgres is Phase 0, Dockerfile + manifests change.

---

## Orchestration Status

**Stage:** Awaiting explicit user decision on tenant persistence model.

**Holding state:**
- All three proposal files remain in `.squad/decisions/inbox/` (not merged to `.squad/decisions.md`).
- Phase 0 execution **blocked** until decision #5 is resolved.
- Phase 1 planning remains open pending decision.

**Next action:** User provides explicit direction on tenant database choice. Scribe merges selected recommendation(s) into canonical `.squad/decisions.md` and retires non-selected proposals.

---

## Recommendation to User

**The real trade-off is operational complexity vs. execution time:**

- **SQLite path (Brand/Data):** Proven, boring, lower Phase 0 effort. Require explicit rollout rules *now*. Postgres is a future scale lever, not a Phase 0 must-have.
- **Postgres path (Mikey):** Higher Phase 0 effort (NoteStore rewrite). Higher confidence in long-term ops (MVCC, native backup). Requires team to commit to 5–7-day rewrite.

**Neither is wrong. Decision hinges on:** How much Phase 0 risk tolerance does the team have, and what is the cost of deferred Postgres pivots vs. upfront NoteStore work?


# QA Brief: Issue #58 — NoteStore Postgres Adapter with SQLite Fallback

**Prepared by:** Chunk (Tester)  
**Date:** 2026-04-18  
**Status:** Pre-implementation review  
**Severity of gaps:** HIGH — adapter behavior mismatch can silently corrupt writes or lose transactions

---

## Executive Summary

Issue #58 ports the core persistence adapter (`NoteStore`) from synchronous `better-sqlite3` to async `node-postgres` (Postgres primary, SQLite fallback). The happy path is well-scoped; **the parity risk is in transaction semantics, connection pooling resilience, and schema initialization idempotence under concurrent load or failure cases.**

**Top blocker:** Data should clarify whether the Postgres transaction isolation level matches SQLite's default (serializable-like ACID semantics), because note-editing conflicts and reference sync re-entrancy rely on strict ordering guarantees.

---

## 1. Highest-Risk Parity Gaps

### 1.1 Transaction Semantics Under Failure (CRITICAL)

**Current (SQLite):**
- `database.transaction(fn)` wraps mutations in `BEGIN ... COMMIT/ROLLBACK` atomically
- If `fn` throws, rollback is automatic
- No connection state to manage; single writer

**Postgres Risk:**
- Requires explicit `BEGIN/COMMIT/ROLLBACK` or connection pool abstraction
- If connection drops mid-transaction, pool may return a new connection in a different transaction state
- If async `await` is misplaced, transaction might release before all mutations complete
- **Gap:** Current code has 12+ transaction closures; each must handle async correctly

**What to watch:**
- Note creation fails partway through (note created, membership attribution missing)
- Session name mismatch in reference sync (linked notes created with stale session context)
- Membership consolidation partially applies (old membership IDs removed, notes not updated)

**Test case:** Kill the database mid-consolidation; verify notes still reference correct membership IDs.

---

### 1.2 Connection Pooling & Concurrent Mutations (HIGH)

**Current (SQLite):**
- Single `better-sqlite3` connection; writes are serialized at the SQLite level
- No pool management; connection is tied to the `NoteStore` instance lifetime

**Postgres Risk:**
- Connection pool with min/max connections; multiple statements may execute in parallel across different connections
- If connection pooling is misconfigured (timeout too aggressive, idle kill too fast), statements can fail with `ECONNREFUSED` mid-query
- If prepared statements are not reused per connection, each query re-parses (performance cliff)
- **Gap:** Current code prepares statements once at init; Postgres may require per-connection preparation or a query builder

**What to watch:**
- Race conditions: two edits to the same note arrive concurrently; both try to update `last_edited_by_membership_id` and `updated_at`
- Pool starvation: health check (`checkHealth()`) or admin queries (`listOwnerAccounts()`) hog pool connections, blocking user mutations
- Orphaned transaction state: graceful shutdown doesn't wait for active queries; connections close mid-transaction

**Test case:** Spawn 10 concurrent note edits; verify `updated_at` timestamps don't collide and no notes are lost.

---

### 1.3 Schema Initialization Idempotence (HIGH)

**Current (SQLite):**
- `initializeNoteStoreDatabase()` uses `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE IF NOT EXISTS`
- Migrations like `ensureNotesAttributionColumns()` check table existence and column presence before altering
- If the API starts twice, second run skips schema steps; idempotent

**Postgres Risk:**
- `CREATE TABLE IF NOT EXISTS` works, but concurrent calls may race on constraint creation
- `ALTER TABLE ADD COLUMN IF NOT EXISTS` syntax differs (Postgres uses `IF NOT EXISTS` in 10+, but only in `ALTER ... IF NOT EXISTS` form)
- Unique constraints and indexes may conflict if schema steps run partially in parallel
- Drop-and-recreate patterns (e.g., in future migrations) require careful locking
- **Gap:** Bootstrap code must guarantee serial execution of migrations or use explicit locks

**What to watch:**
- Startup timeout if two API instances initialize schema simultaneously
- Constraint violations on second schema attempt (unique index already exists)
- Partial schema state (table created, index failed) blocking further operations

**Test case:** Start two API instances against the same Postgres DB simultaneously; verify no errors and final schema is complete.

---

### 1.4 ACID & Isolation Level Mismatch (HIGH)

**Current (SQLite):**
- Default isolation: serializable (IMMEDIATE or DEFERRED depending on statement type)
- Foreign key constraints are enabled; cascading deletes work
- No dirty reads, phantom reads, or lost updates

**Postgres Risk:**
- Default isolation level: `READ COMMITTED` (weaker than SQLite)
- At `READ COMMITTED`, two concurrent transactions can read the same row, each believing they can update it
- If reference sync runs during note edit, row-level locks might not prevent interleaved reads
- **Gap:** Adapter must explicitly set transaction isolation to `SERIALIZABLE` or `REPEATABLE READ` for correctness

**What to watch:**
- Reference sync inserts a link while a concurrent edit deletes the same note; foreign key constraint passes but link is orphaned
- Membership consolidation reads the same note twice (once for counts, once for update); between reads, another edit changes the note; counts and update are out of sync
- `listRecentNotes()` in one transaction; `updateNote()` in another; reader sees partial write

**Test case:** Run `consolidateMemberships()` and `updateNote()` concurrently on the same campaign; verify counts and note IDs match exactly at the end.

---

### 1.5 Query Result Type Coercion (MEDIUM)

**Current (SQLite):**
- All `SELECT` results are JavaScript objects; `number` values are always JS numbers
- Boolean flags like `is_site_admin` come back as `0 | 1` (SQLite integers)
- JSON columns are returned as strings; code parses them

**Postgres Risk:**
- `node-postgres` can return `bigint` as string (depending on config) if value exceeds JS number safety
- Boolean columns might come back as `true | false` if the Postgres driver auto-coerces
- Numeric types (serial, integer, bigint) need explicit casting if types don't match expectations
- **Gap:** Result type assumptions are implicit; adapter should validate or explicitly cast

**What to watch:**
- `campaign_id` or `membership_id` returned as string when code expects a number (comparison failures)
- `is_site_admin` coerced to boolean; bitwise checks or comparisons fail
- JSON parsing throws unexpectedly if a column is null and code doesn't check

**Test case:** Create 1000 campaigns; verify IDs remain consistent in list and detail operations.

---

### 1.6 Graceful Shutdown & Connection Draining (MEDIUM)

**Current (SQLite):**
- `close()` calls `database.close()`
- No active queries to drain; file is closed

**Postgres Risk:**
- If the app is shutting down while queries are in-flight, closing the pool immediately can fail
- Postgres requires explicit draining: wait for `client.release()`, then `pool.end()`
- If the app shuts down mid-mutation, connection might not finish; data is lost
- **Gap:** Adapter needs a graceful-shutdown hook that waits for in-flight queries before closing

**What to watch:**
- Kubernetes rolling update kills the container; note edit is interrupted halfway
- Health-check query hangs on shutdown, blocking container termination
- Connection pool never fully drains; orphaned connections hang indefinitely

**Test case:** Send a slow query (large note update), trigger shutdown immediately, verify query completes or rolls back cleanly.

---

## 2. Reviewer Checklist

### Schema & Bootstrap
- [ ] All `initializeNoteStoreDatabase()` steps are idempotent and handle concurrent calls
- [ ] Postgres-specific schema (e.g., sequences for IDs if auto-increment is used) is initialized correctly
- [ ] Foreign key constraints are enabled on Postgres by default
- [ ] Test suite includes concurrent schema initialization (two instances starting together)

### Transactions & Isolation
- [ ] All 12+ transaction closures are wrapped in explicit `BEGIN/COMMIT/ROLLBACK`
- [ ] Transaction isolation level is explicitly set to `SERIALIZABLE` or `REPEATABLE READ`
- [ ] Rollback behavior on error is tested (e.g., note creation fails mid-transaction)
- [ ] No implicit connection reuse between transaction start and commit

### Connection Pooling
- [ ] Pool configuration (min/max connections, idle timeout, statement timeout) is documented
- [ ] Health check query is efficient and doesn't hog pool connections
- [ ] Prepared statements are safely re-executed across multiple connections (no per-statement state)
- [ ] Pool drains correctly on shutdown (verified with concurrent mutation + shutdown test)

### Async Handling
- [ ] All `await` statements are in the correct scope (not released before all mutations complete)
- [ ] Error handling distinguishes connection errors from constraint violations from timeout errors
- [ ] Retry logic exists for transient failures (e.g., connection timeout) but not for logic errors

### Parity with SQLite
- [ ] All existing API tests pass against Postgres without modification
- [ ] All existing API tests still pass against SQLite fallback without modification
- [ ] Result types are validated (e.g., IDs remain strings/numbers as expected)
- [ ] Query ordering and pagination behavior match exactly

### Test Coverage
- [ ] Concurrent note edits to the same campaign verify no lost writes
- [ ] Reference sync doesn't race with note deletion
- [ ] Membership consolidation is atomic; counts and applied IDs always match
- [ ] Session-name queries handle percent-encoded or special characters correctly on Postgres
- [ ] Backup/restore flow works with Postgres (currently uses `database.backup()`)

---

## 3. Critical Test Cases to Watch

### 3.1 Transaction Rollback (Must-Have)
**Goal:** Ensure atomicity on error  
**Steps:**
1. Create a note with tags and linked notes
2. Mid-creation (after note row, before reference rows), inject a connection failure
3. Verify: note is rolled back (no orphaned row)

**Expected:** Note doesn't appear in `listNotes()`; no foreign key violations

---

### 3.2 Concurrent Edits (Must-Have)
**Goal:** No lost writes or interleaved updates  
**Steps:**
1. Create a note with body "original"
2. Send 5 parallel `PUT /api/notes/:id` requests, each with a different body
3. Verify: final note body matches one of the five updates
4. Verify: `updated_at` and `last_edited_by_membership_id` are consistent

**Expected:** No partial updates; timestamp and attribution match the winning edit

---

### 3.3 Reference Sync Under Concurrent Deletion (Must-Have)
**Goal:** Foreign key constraints prevent orphaned references  
**Steps:**
1. Create note A and note B, with A → B linked
2. Concurrently: delete B and attempt to update A's references
3. Verify: either B is deleted and A's link is removed, or A's update fails cleanly

**Expected:** No orphaned references; no constraint violations in the final state

---

### 3.4 Membership Consolidation Atomicity (Must-Have)
**Goal:** Counts match applied changes  
**Steps:**
1. Create membership M1 and M2 in the same campaign
2. Create 10 notes attributed to M1
3. Call `previewMembershipConsolidation(M1, M2)` and `consolidateMemberships(M1, M2)` concurrently
4. Verify: preview counts match final applied counts

**Expected:** No mismatch between preview and applied state

---

### 3.5 Schema Idempotence (Must-Have)
**Goal:** Startup is safe when run multiple times  
**Steps:**
1. Start app instance A against Postgres
2. Before A fully initializes, start app instance B against the same Postgres
3. Wait for both to finish initialization
4. Query schema; verify all tables and constraints exist exactly once

**Expected:** No timeout, no constraint violations, schema is complete

---

### 3.6 Graceful Shutdown (Should-Have)
**Goal:** In-flight mutations complete or roll back cleanly  
**Steps:**
1. Spawn 10 concurrent `POST /api/notes` requests (slow, e.g., with a database trigger delay)
2. After 500ms, send SIGTERM to the app
3. Wait 5s for shutdown to complete
4. Verify: notes are either created completely or not at all (no partial writes)

**Expected:** App exits cleanly; all active connections are drained; transaction state is consistent

---

### 3.7 SQLite Fallback Regression (Should-Have)
**Goal:** Fallback path still works for development  
**Steps:**
1. Set `NODE_ENV=development` and no `DATABASE_URL`
2. Start app with local SQLite
3. Run all API tests against SQLite
4. Verify: all tests pass (same as current baseline)

**Expected:** No new failures; fallback is transparent to tests

---

## 4. Regression Coverage Gaps (To Add)

### Current Test Gaps
- **No async error handling tests:** No test for connection timeout, statement timeout, or pool exhaustion
- **No concurrent mutation tests:** All current tests are sequential
- **No schema migration test:** No test for idempotent re-initialization
- **No graceful shutdown test:** No test for in-flight query cleanup
- **No parity test suite:** Current tests don't explicitly compare Postgres vs. SQLite results side-by-side

### Recommended Additions
1. **`test/async-resilience.test.ts`:**
   - Simulate connection loss mid-transaction
   - Simulate statement timeout during write
   - Verify rollback and no orphaned rows

2. **`test/concurrent-mutations.test.ts`:**
   - 10+ concurrent note edits on the same campaign
   - 5+ concurrent membership consolidations on different memberships
   - Reference sync while deleting linked notes

3. **`test/schema-idempotence.test.ts`:**
   - Start two API instances against the same database
   - Verify no conflicts or timeouts

4. **`test/graceful-shutdown.test.ts`:**
   - In-flight mutations + SIGTERM
   - Verify atomic completion or rollback

5. **`test/parity.test.ts`:**
   - Run the same operations against both Postgres and SQLite
   - Assert identical results (IDs, timestamps, counts, etc.)

---

## 5. Known Assumptions & Clarifications Needed

### Q1: Transaction Isolation Level
**Current:** Postgres default is `READ COMMITTED`; SQLite is effectively `SERIALIZABLE`  
**Decision required:** Should the adapter set isolation to `REPEATABLE READ` or `SERIALIZABLE` on every transaction?  
**Impact:** If not changed, reference sync and consolidation may have race conditions.

**Recommendation:** Set `SET TRANSACTION ISOLATION LEVEL SERIALIZABLE` at the start of every transaction, or use Postgres advisory locks for critical sections.

---

### Q2: Connection Pool Configuration
**Current:** No documented pool settings in the issue  
**Decision required:** What are the min/max pool sizes? Idle timeout? Statement timeout?  
**Impact:** Wrong settings can cause cascading failures under load or sudden shutdown.

**Recommendation:** Config should match observed load pattern (26+ test cases means at least 3-5 concurrent statements). Statement timeout should be 30s+.

---

### Q3: Prepared Statement Reuse
**Current:** `better-sqlite3` prepares statements once and reuses them  
**Decision required:** Can `node-postgres` reuse prepared statements across multiple connections in the pool?  
**Impact:** If not, each query re-parses and performance drops significantly.

**Recommendation:** Use parameterized queries (already in place) and verify Postgres caches parsed statements per connection.

---

### Q4: Backup/Restore Strategy
**Current:** `backupDatabase()` uses `database.backup(sourcePath)` (SQLite-specific)  
**Decision required:** How should backup work for Postgres? Logical dump? pg_dump integration?  
**Impact:** Admin restore feature won't work for Postgres unless adapted.

**Recommendation:** For MVP, backup may remain SQLite-only (local dev) and Postgres should use native backup tools (`pg_dump` in CI/backup pipeline).

---

### Q5: Fallback Logic
**Current:** Issue says "keep backward-compatible local SQLite as fallback"  
**Decision required:** When does the app use Postgres vs. SQLite? ENV variable? Connection string presence?  
**Impact:** Ambiguous fallback logic can cause production to accidentally use SQLite.

**Recommendation:** Use `DATABASE_URL` env var presence (standard Heroku pattern): if set, use Postgres; else use SQLite.

---

## 6. Blocker Check

### Is There a Blocker?
**Status:** 🟡 **CONDITIONAL BLOCKER** — not a hard stop, but Data should clarify Q1 and Q2 before full implementation.

**Specific blocker conditions:**
1. If the isolation level is left at `READ COMMITTED` without explicit locking, **reference sync + concurrent deletes will corrupt references** (orphaned link rows).
2. If connection pool is misconfigured (timeout too short, min/max backwards), **production will fail under load or rolling restart** (cascade of connection errors).

**Recommendation:** Data should review the transaction closure patterns and explicitly document isolation level + pool configuration before the PR is submitted for review. Add a simple test (concurrent consolidation or reference sync) to validate your choice.

---

## 7. Sign-Off

This brief assumes the implementation follows the patterns described in the issue:
- Async `node-postgres` replaces `better-sqlite3`
- All 12+ transactions are ported to explicit `BEGIN/COMMIT`
- SQLite fallback is conditional on env var
- Same `NoteStore` interface (no API changes)

**If the implementation deviates** (e.g., different transaction pattern, sync wrapper around async), **this review must be updated.**

---

**Next Step:** Requestor should confirm:
1. Will you set isolation level to `SERIALIZABLE`?
2. What are the pool min/max and timeout values?
3. Will fallback logic use `DATABASE_URL` env var?

Once confirmed, flag this brief as reviewed and proceed to implementation.

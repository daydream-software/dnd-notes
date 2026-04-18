# SQLite Transaction Atomicity

## Problem

Multi-step database operations that must stay atomic (e.g., updating a row + inserting an audit record) can leave inconsistent state if not wrapped in a transaction.

## Pattern

### With better-sqlite3

```typescript
// ❌ BAD: Non-atomic (state update can succeed while audit insert fails)
this.db.prepare('UPDATE tenants SET current_state = ? WHERE id = ?').run(newState, id)
this.recordTransition({ tenantId: id, fromState, toState: newState })

// ✅ GOOD: Atomic transaction
const updateWithAudit = this.db.transaction(() => {
  this.db.prepare('UPDATE tenants SET current_state = ? WHERE id = ?').run(newState, id)
  this.recordTransition({ tenantId: id, fromState, toState: newState })
})

updateWithAudit()
```

### Key Points

1. **Define the transaction function first:** Pass a function to `.transaction()` that contains all the work
2. **Then call it:** The returned function is the transactional wrapper
3. **All-or-nothing:** If any step throws, the entire transaction rolls back
4. **No nesting:** Transactions cannot be nested; design accordingly

### Foreign Key Enforcement

SQLite disables foreign key constraints by default. Enable them immediately after opening:

```typescript
constructor(databasePath: string) {
  this.db = new Database(databasePath)
  this.db.pragma('foreign_keys = ON')  // ← Required for CASCADE to work
  this.bootstrap()
}
```

## When to Use

- State change + audit log insert
- Balance update + transaction record
- Parent deletion + child cleanup (if not using FK CASCADE)
- Any multi-table write that must stay consistent

## References

- `apps/control-plane/src/tenant-registry.ts` — state update + transition insert wrapped in transaction
- better-sqlite3 docs: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#transaction

## Related Skills

- `sqlite-startup-compatibility` — handling schema migrations
- `monorepo-workspace-patterns` — validation commands per workspace

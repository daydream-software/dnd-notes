# Decision: Issue #58 snapshot bridge

## Context

Issue #58 ports the tenant note store to Postgres, but existing admin backup and restore flows already use SQLite snapshot files and operator muscle memory depends on that format.

## Decision

Keep the admin backup artifact SQLite-compatible even when the live store runs on Postgres.

- `backupDatabase()` exports a `.sqlite` snapshot from either backend.
- `restoreNoteStoreFromBackup()` accepts that same snapshot for SQLite recovery and Postgres import.
- `DATABASE_URL` selects Postgres; unset means SQLite fallback.

## Why

This keeps the operator-facing contract boring during the adapter port. We get Postgres for hosted runtime behavior without inventing a second backup format or a separate migration lane for SQLite tenants.

## Impact

- README + runtime docs can describe one migration path: download SQLite snapshot, boot with `DATABASE_URL`, restore snapshot.
- Admin backup/restore routes stay valid during the transition.
- Future control-plane backup work can replace the artifact format later if needed, but this slice stays backward-compatible now.

---
name: "sqlite-snapshot-postgres-bridge"
description: "Keep SQLite backup artifacts stable while the live app moves to Postgres."
domain: "persistence"
confidence: "high"
source: "earned"
---

## Context

Use this when a Node service is moving from SQLite to Postgres but operators already rely on SQLite snapshot backup files or local restore fixtures.

## Pattern

- Put both backends behind one async query/statement interface so route and service contracts only change once.
- Let `DATABASE_URL` opt into Postgres and keep `NOTES_DB_PATH` or the local file path as the default fallback.
- Export live Postgres data into a SQLite-compatible snapshot for admin backup/download flows.
- Accept that same SQLite snapshot when restoring into Postgres so SQLite tenants have a boring migration path.
- Keep regression tests for both paths: the old SQLite suite plus a focused Postgres adapter suite.

## Why it helps

You get pooled Postgres runtime behavior without forcing operators to learn a second backup artifact during the same slice. It also gives you a concrete SQLite → Postgres migration path before control-plane automation exists.

## Example

- `apps/api/src/note-store-database.ts` wraps SQLite and Postgres behind async `prepare()/get()/all()/run()` helpers.
- `apps/api/src/note-store.ts` exports SQLite snapshots from Postgres and imports them back through `restoreNoteStoreFromBackup()`.
- `apps/api/test/postgres-adapter.test.ts` validates the Postgres path while the existing API suite still covers SQLite fallback behavior.

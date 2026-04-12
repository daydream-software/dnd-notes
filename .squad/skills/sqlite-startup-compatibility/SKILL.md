---
name: "sqlite-startup-compatibility"
description: "Upgrade compatible SQLite table columns in place before preparing dependent statements."
domain: "error-handling"
confidence: "high"
source: "earned"
tools:
  - name: "bash"
    description: "Inspect live SQLite schemas or verify startup against the real local database."
    when: "A runtime error points at a missing table column in the dev database."
---

## Context
Use this when the app owns SQLite schema bootstrap in code and a merge adds backward-compatible columns to an existing local database. The goal is to keep development startup working without forcing a data reset.

## Patterns
- Create or ensure base tables first, then inspect the live table shape before preparing statements that reference newer columns.
- Use `PRAGMA table_info(table_name)` to detect whether a legacy SQLite table is missing specific columns.
- For backward-compatible additions, add nullable columns in place so existing rows remain readable with null values.
- Add a regression test that creates the legacy schema, boots the real store, and confirms both schema upgrade and data preservation.

## Examples
- `apps/api/src/note-store.ts` now checks `notes` for missing membership attribution columns and adds them before note-select statements are prepared.
- `apps/api/test/app.test.ts` seeds a legacy `notes` table, boots `createNoteStore`, and asserts the note still loads with null attribution fields.

## Anti-Patterns
- Relying on `CREATE TABLE IF NOT EXISTS` alone to evolve an already-existing table.
- Fixing a startup regression by telling developers to delete the database when a nullable compatibility path is possible.
- Preparing queries that reference new columns before the schema upgrade runs.

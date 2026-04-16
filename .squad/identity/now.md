# Current Focus

- **Updated:** 2026-04-16T21:40:06Z
- **Active slice:** Issue #46 — bootstrap and migration logic extracted out of `note-store.ts`
- **New roadmap lane:** shrink the monolithic hotspots in `apps/web/src/App.tsx`, `apps/api/src/app.ts`, `apps/api/src/note-store.ts`, and the large integration specs to improve parallel work and reduce large-context edits
- **Tracked issues:** #44 (`squad:stef`), #46 (`squad:data`)
- **Production context still active:** same-origin deployment default, admin backup/restore now shipped, WAL/restore-concurrency/provisioning follow-ups tracked in #39–#43
- **Next likely task:** continue `#46` by extracting the next bounded persistence slice out of `note-store.ts`, likely statement bundles or note-reference helpers

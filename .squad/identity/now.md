# Current Focus

- **Updated:** 2026-04-16T18:58:20Z
- **Active slice:** Issue #47 — shared API/web test harness extraction completed; monolithic spec splitting still in progress
- **New roadmap lane:** shrink the monolithic hotspots in `apps/web/src/App.tsx`, `apps/api/src/app.ts`, `apps/api/src/note-store.ts`, and the large integration specs to improve parallel work and reduce large-context edits
- **Tracked issues:** #44 (`squad:stef`), #45 (`squad:data`), #46 (`squad:data`), #47 (`squad:chunk`)
- **Production context still active:** same-origin deployment default, admin backup/restore now shipped, WAL/restore-concurrency/provisioning follow-ups tracked in #39–#43
- **Next likely task:** continue issue #47 by splitting the large integration suites into feature-scoped files, or pivot to #45 if backend route modularization becomes the better parallel slice

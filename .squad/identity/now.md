# Current Focus

- **Updated:** 2026-04-16T20:06:17Z
- **Active slice:** Issue #47 — first API split completed into `core-workflows.test.ts`; remaining API monolith split still in progress
- **New roadmap lane:** shrink the monolithic hotspots in `apps/web/src/App.tsx`, `apps/api/src/app.ts`, `apps/api/src/note-store.ts`, and the large integration specs to improve parallel work and reduce large-context edits
- **Tracked issues:** #44 (`squad:stef`), #45 (`squad:data`), #46 (`squad:data`), #47 (`squad:chunk`)
- **Production context still active:** same-origin deployment default, admin backup/restore now shipped, WAL/restore-concurrency/provisioning follow-ups tracked in #39–#43
- **Next likely task:** continue issue #47 by extracting share/activity and consolidation scenarios out of `apps/api/test/app.test.ts`, then reassess whether #47 is done or whether to pivot to #45

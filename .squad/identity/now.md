# Current Focus

- **Updated:** 2026-04-16T20:16:52Z
- **Active slice:** Issue #47 completed — monolithic API/web integration specs are now split into feature-scoped suites
- **New roadmap lane:** shrink the monolithic hotspots in `apps/web/src/App.tsx`, `apps/api/src/app.ts`, `apps/api/src/note-store.ts`, and the large integration specs to improve parallel work and reduce large-context edits
- **Tracked issues:** #44 (`squad:stef`), #45 (`squad:data`), #46 (`squad:data`)
- **Production context still active:** same-origin deployment default, admin backup/restore now shipped, WAL/restore-concurrency/provisioning follow-ups tracked in #39–#43
- **Next likely task:** pivot to issue #45 and start modularizing `apps/api/src/app.ts`, now that the test hotspot lane is done

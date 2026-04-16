# Current Focus

- **Updated:** 2026-04-16T21:06:06Z
- **Active slice:** Issue #45 — auth/admin routes extracted; next candidate is the campaign/share-link owner cluster
- **New roadmap lane:** shrink the monolithic hotspots in `apps/web/src/App.tsx`, `apps/api/src/app.ts`, `apps/api/src/note-store.ts`, and the large integration specs to improve parallel work and reduce large-context edits
- **Tracked issues:** #44 (`squad:stef`), #45 (`squad:data`), #46 (`squad:data`)
- **Production context still active:** same-origin deployment default, admin backup/restore now shipped, WAL/restore-concurrency/provisioning follow-ups tracked in #39–#43
- **Next likely task:** continue `#45` by extracting the campaign/share-link owner routes using the new route-support + registrar pattern

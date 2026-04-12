# Project Context

- **Owner:** FFMikha
- **Project:** dnd-notes
- **Description:** A D&D note-taking app for capturing campaign notes, characters, locations, and session details.
- **Stack:** React, Material UI, Node.js
- **Created:** 2026-04-11T19:00:21.594Z

## Core Context

Data initialized as Backend Dev for the initial project squad.

## Recent Updates

📌 Team initialized on 2026-04-11 with Mikey, Stef, Data, Chunk, Brand, Scribe, and Ralph.

📌 Team update (2026-04-12T13:32:51Z): Fixed merged PR runtime regression—added in-place SQLite schema upgrade for note attribution columns, preserving local dev data; regression coverage validates legacy-schema bootstrap path — decided by Data, Chunk

📌 Team update (2026-04-12T14:38:40Z): Campaign share links stay as reusable single links with owner-only on-demand reveal; listings stay metadata-only and legacy hash-only links must be revoked/recreated to become revealable again — decided by FFMikha (via Copilot), Mikey, Data, Stef, Chunk

## Learnings

- Initial squad setup complete.
- `apps/api/src/note-store.ts` owns SQLite schema bootstrap, so compatibility fixes for local dev databases should run there before prepared note queries are created.
- The default dev database lives at `apps/api/data/dnd-notes.sqlite`; when note schema adds nullable attribution fields, prefer an in-place startup upgrade over asking developers to reset data.
- Backend verification for this area is `npm run lint --workspace apps/api`, `npm test --workspace apps/api`, and `npm run build --workspace apps/api`, with `npm run dev` confirming the shared dev startup path.
- Share links currently persist only `token_hash` in `apps/api/src/note-store.ts`, while owner list payloads expose metadata only and `POST /api/campaigns/:campaignId/share-links` is the lone place that returns the raw token/url. Re-revealing an existing link later will therefore require a recoverable stored secret plus an explicit owner-facing reveal API.
- Share-link reveal support now keeps `campaign_share_links.token_hash` for guest access checks and a nullable `token_plaintext` column for owner-only re-reveal of the same reusable link; legacy rows remain null and must surface a regeneration-required path instead of guessing.
- The owner reveal contract lives in `apps/api/src/app.ts` at `GET /api/campaigns/:campaignId/share-links/:shareLinkId`, which returns only `{ token, url }` on success and leaves `GET /api/campaigns/:campaignId/share-links` metadata-only.

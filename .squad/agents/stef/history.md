# Project Context

- **Owner:** FFMikha
- **Project:** dnd-notes
- **Description:** A D&D note-taking app for capturing campaign notes, characters, locations, and session details.
- **Stack:** React, Material UI, Node.js
- **Created:** 2026-04-11T19:00:21.594Z

## Core Context

Stef initialized as Frontend Dev for the initial project squad.

## Recent Updates

📌 Team initialized on 2026-04-11 with Mikey, Stef, Data, Chunk, Brand, Scribe, and Ralph.

📌 Team update (2026-04-12T14:38:40Z): Campaign share links stay as reusable single links with owner-only on-demand reveal; listings stay metadata-only and legacy hash-only links must be revoked/recreated to become revealable again — decided by FFMikha (via Copilot), Mikey, Data, Stef, Chunk

## Learnings

- Initial squad setup complete.
- Owner share links now stay metadata-only in the list UI until a card-level reveal action fetches that specific reusable URL, then the card handles blur/show/copy locally in `apps/web/src/App.tsx`.
- Frontend share-link reveal wiring lives in `apps/web/src/api.ts`, `apps/web/src/types.ts`, and `apps/web/src/App.test.tsx`; legacy reveal failures should be surfaced inline on the card with a recreate suggestion.
- Claimed guest memberships must unlock the authenticated workspace through any linked campaign membership, while owner-only settings stay gated; the cross-cut lives in `apps/api/src/app.ts`, `apps/api/src/note-store.ts`, and `apps/web/src/App.tsx`.
- After linking from the shared route, persist `dnd-notes:selected-campaign-id` so the next main-app bootstrap lands on the claimed campaign instead of dropping people back into the default one (`apps/web/src/SharedCampaignRoute.tsx`).

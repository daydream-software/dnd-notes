# Project Context

- **Owner:** FFMikha
- **Project:** dnd-notes
- **Description:** A D&D note-taking app for capturing campaign notes, characters, locations, and session details.
- **Stack:** React, Material UI, Node.js
- **Created:** 2026-04-11T19:00:21.594Z

## Core Context

Copilot enabled as autonomous coding agent for squad via auto-assignment to squad:copilot issues.

## Recent Updates

📌 Team update (2026-04-12T21:44:58Z): ASSIGNMENT — You are now owner of Issue #27 frontend UI revision. Stef's implementation was rejected by Chunk due to four critical state-management regressions: (1) `noteBrowseMode` dependency causes workspace reload on mode toggle, clobbering editor state, (2) create-note drafts lost when workspace reloads, (3) stale-response race on session switch, (4) missing regression tests. Backend (#27) is approved and ship-safe. Re-approval bar: remove `noteBrowseMode` from bootstrap dependency chain, add cancellation guard to session loading, add tests for mode toggles and create-note reset. Full details in `.squad/decisions.md` — assigned by Chunk (reviewer)

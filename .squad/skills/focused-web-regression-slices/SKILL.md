---
name: "focused-web-regression-slices"
description: "Stabilize a large React test surface by keeping one smoke suite in App.test and moving behavior checks into focused feature files."
domain: "testing"
confidence: "high"
source: "earned"
---

## Context
Use this when a broad app-level frontend test file becomes the blocker instead of the product behavior you actually need to protect. It works well for React apps where a small mount path is stable, but a monolithic integration spec grows too heavy to be a reliable gate.

## Patterns
- Keep App.test.tsx limited to boot smoke: auth shell renders, happy-path workspace load succeeds, and a saved session can reopen the workspace.
- Put feature regressions in dedicated files named for the behavior under test, with only the mocked endpoints that slice needs.
- Build fixtures around the user-facing contract, not the whole app state tree.
- For search features, cover every advertised search axis and at least one reset path so the UI cannot get stuck in a filtered state.

## Examples
- apps/web/src/App.test.tsx now proves onboarding render, owner registration workspace load, and saved-session restore.
- apps/web/src/CampaignSearch.test.tsx owns campaign-search regressions for title, body, tags, session names, collaborator names, and clearing search on new note.

## Anti-Patterns
- Re-growing App.test.tsx into a catch-all integration file for every frontend feature.
- Sharing giant mock servers across unrelated regressions when a small endpoint-scoped stub would do.
- Covering only happy-path text search and skipping the other search scopes promised by the UI copy.

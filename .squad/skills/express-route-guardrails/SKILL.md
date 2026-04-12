---
name: "express-route-guardrails"
description: "Avoid Express route shadowing and path-param decoding bugs, and test special-character route params"
domain: "testing, api-design, express"
confidence: "medium"
source: "earned through issue #27 QA on session browsing routes"
tools:
  - name: "rg"
    description: "Find route declarations and confirm ordering against dynamic param routes"
    when: "Reviewing or adding Express endpoints"
---

## Context
This skill applies when adding Express routes that mix static paths like `/sessions` with dynamic params like `/:id`. These handlers can look fine in isolation but still fail live because route ordering, auth scoping, and path decoding are easy to get subtly wrong.

## Patterns
1. Declare static subroutes before broader param routes on the same prefix, e.g. put `/api/notes/sessions` before `/api/notes/:noteId`.
2. Treat Express `req.params` as already decoded; avoid a second `decodeURIComponent()` unless you have disabled default decoding and know why.
3. Reuse the same authorization/campaign-resolution helpers as sibling endpoints unless the new route is intentionally stricter.
4. Add regression coverage for literal `%`, spaces, and collaborator-access cases when route params are derived from user-entered names.

## Examples
- Bad: `/api/notes/:noteId` registered before `/api/notes/sessions`, making `"sessions"` look like a note ID.
- Bad: `decodeURIComponent(req.params.sessionId)` when a session name like `50% done` is already decoded by Express.
- Good: route tests that prove both owners and linked collaborators can open session views if they already have authenticated note access.

## Anti-Patterns
- Adding route types and docs without any endpoint-specific regression tests.
- Assuming a path-param feature is safe because query-param CRUD tests already pass.
- Tightening auth to owner-only on a note-browsing endpoint without checking the existing linked-membership access model.

---
name: express-route-guardrails
description: "Use when defining Express routes to avoid route shadowing and path-param decoding bugs; test special-character route params."
metadata:
  version: 1.0.0
disable-model-invocation: false
---

## Context

This skill applies when adding Express routes that mix static paths like `/sessions` with dynamic params like `/:id`. These handlers can look fine in isolation but still fail live because route ordering, auth scoping, and path decoding are easy to get subtly wrong.

## Patterns

1. Declare static subroutes before broader param routes on the same prefix, e.g. put `/api/notes/sessions` before `/api/notes/:noteId`.
2. Treat Express `req.params` as already decoded; avoid a second `decodeURIComponent()` unless you have disabled default decoding and know why.
3. Reuse the same authorization/campaign-resolution helpers as sibling endpoints unless the new route is intentionally stricter.
4. Add regression coverage for literal `%`, spaces, and collaborator-access cases when route params are derived from user-entered names.
5. For authenticated browsing routes, prove the access model with a claimed-collaborator test, not just an owner test, so new endpoints do not quietly fall back to owner-only behavior.

## Examples

- Bad: `/api/notes/:noteId` registered before `/api/notes/sessions`, making `"sessions"` look like a note ID.
- Bad: `decodeURIComponent(req.params.sessionId)` when a session name like `50% done` is already decoded by Express.
- Good: route tests that prove both owners and linked collaborators can open session views if they already have authenticated note access.
- Good: frontend callers using `encodeURIComponent(sessionName)` once when building `/api/notes/sessions/:sessionId`, while the server consumes `req.params.sessionId` directly.

## Anti-Patterns

- Adding route types and docs without any endpoint-specific regression tests.
- Assuming a path-param feature is safe because query-param CRUD tests already pass.
- Tightening auth to owner-only on a note-browsing endpoint without checking the existing linked-membership access model.

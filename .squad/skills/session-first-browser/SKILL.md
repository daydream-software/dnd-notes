---
name: "session-first-browser"
description: "Layer a thin session list and session-note drill-in onto an existing note list/detail shell."
domain: "frontend"
confidence: "high"
source: "earned"
tools:
  - name: "view"
    description: "Inspect the current list/detail note shell before threading session state through it."
    when: "You need session browsing without a broader layout rewrite."
---

## Context
Use this when the product needs a faster answer to "what happened in this session?" but the app already has a working note list/detail workflow. It fits v1 scopes where the backend can list sessions and fetch notes for one session, and the safest move is to layer a session mode onto the current shell instead of inventing a new browser.

## Patterns
- Add a local browse-mode toggle (`All notes` / `Browse by session`) instead of replacing the whole note workspace.
- Keep session summary state close to the note list and fetch session detail only when a user drills into one session.
- Reuse the existing note detail/editor pane so session browsing changes navigation, not editing architecture.
- Reset back to the flat note list when users start a brand-new note if the note-creation flow is already active elsewhere.
- Use numeric-aware session-name sorting client-side when the backend contract is intentionally thin and only returns session names plus note counts.
- Give the session list and session-note list explicit accessible labels so UI tests can scope assertions cleanly.
- Read current browse-mode/selection state through refs or similarly stable state access when async workspace loaders participate in broader bootstrap effects.
- Treat per-session note fetches as cancelable/latest-wins work so rapid drill-in clicks cannot paint stale notes under a newer session heading.

## Examples
- `apps/web/src/App.tsx` layers session browsing into the existing owner workspace with a two-step session list → session notes flow.
- `apps/web/src/api.ts` adds focused helpers for `GET /api/notes/sessions` and `GET /api/notes/sessions/:sessionId`.
- `apps/web/src/App.test.tsx` covers the browse-mode toggle and session drill-in behavior at the integration level.

## Anti-Patterns
- Forking the note editor into a separate session-only screen for a thin v1.
- Pulling session browsing into campaign settings or other owner-only surfaces just because session metadata exists.
- Letting session mode hijack create-note flows when the main goal is browsing existing history faster.
- Depending on flat lexical sorting for names like `Session 2` and `Session 11` when numeric-aware ordering is enough to improve chronology.
- Letting a browse-mode toggle change callback identities that re-trigger auth/bootstrap workspace loads; that turns a thin local mode switch into a full reload and can clobber unsaved drafts.
- Accepting session-detail responses without checking they still match the latest selected session.

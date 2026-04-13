---
name: "single-pane-mobile-note-workspace"
description: "Convert a desktop note list/detail workspace into a narrow-screen single-pane flow without breaking desktop speed."
domain: "frontend"
confidence: "high"
source: "earned"
tools:
  - name: "view"
    description: "Inspect the note workspace render tree and the note-selection handlers together."
    when: "You need to change browse/editor layout without breaking save or selection flows."
---

## Context

Use this when a note-taking UI already has a productive desktop list/detail workflow, but phones and smaller tablets feel cramped because the browse pane and editor are always visible together.

## Patterns

- Keep the existing desktop split-pane workflow for wide screens.
- Use `useMediaQuery(theme.breakpoints.up('lg'))` (or the project breakpoint of record) to swap narrow screens into a single-pane browse/editor toggle.
- Store a tiny local panel state such as `'browse' | 'editor'` rather than duplicating note state.
- Auto-switch narrow screens into the editor when the user selects a note or starts a new note.
- Keep browse modes (all notes, sessions, activity, tags, future search) inside the browse pane so new discovery tools do not fork the editor architecture.
- Add viewport-aware integration tests that prove desktop dual-pane behavior still exists and mobile save flows remain reachable.

## Examples

- `apps/web/src/App.tsx` keeps split browsing at `lg`+ and adds a narrow-screen browse/editor toggle for issue #25.
- `apps/web/src/App.test.tsx` uses `setViewportWidth()` to prove desktop list+editor visibility, narrow-screen note editing, and narrow-screen new-note launch behavior.

## Anti-Patterns

- Forking mobile into a completely separate route or editor component for a thin layout fix.
- Letting responsive layout state leak into workspace bootstrap dependencies, which can re-trigger reloads and clobber drafts.
- Adding mobile toggles without regression tests for save reachability and desktop parity.

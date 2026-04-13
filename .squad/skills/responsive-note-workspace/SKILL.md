---
name: "responsive-note-workspace"
description: "Make a browse/edit note workspace work on phones and desktop without forking the editor."
domain: "frontend"
confidence: "high"
source: "earned"
tools:
  - name: "view"
    description: "Inspect the existing browse controls, note list, and editor before changing layout state."
    when: "You need to rework a note workspace without rewriting unrelated campaign flows."
---

## Context
Use this when a note workspace already has good browse and edit features, but smaller screens feel cramped because both surfaces stay on screen together. The goal is to preserve desktop speed while giving phones and tablets a clean open → edit → save loop.

## Patterns
- Keep browse concerns (mode toggles, filters, session/activity drill-ins) in one surface and the editor in another.
- Use `useMediaQuery` to keep the split layout on desktop while switching narrow screens to an explicit single-pane `browse`/`editor` state.
- Automatically open the editor on narrow screens when the user selects a note or starts a new note.
- Keep draft and browse state local so pane switches do not trigger workspace reloads or lose edits.
- Give the editor a direct route back to browsing on narrow screens.
- When adding responsive behavior, turn mobile flow risks into regression tests with a `matchMedia` mock.

## Examples
- `apps/web/src/App.tsx` keeps the desktop two-column note workspace at `lg` and up, but below that it renders a compact mobile workspace switcher plus either the browse card or the editor card.
- `apps/web/src/App.tsx` sends phones/tablets into the editor from `handleSelectNote()` and `handleStartNote()` while leaving session/tag/activity state untouched.
- `apps/web/src/App.test.tsx` mocks `window.matchMedia`, defaults to desktop width, and adds a narrow-screen test that proves the list hides during editing and saved changes reappear when the user returns to browse.

## Anti-Patterns
- Rendering the full browse card and full editor together on narrow screens just because they stack vertically.
- Creating a separate mobile-only editor implementation that drifts away from desktop behavior.
- Coupling responsive pane changes to workspace bootstrap/loading state.
- Shipping responsive layout changes without at least one mobile regression that exercises the actual note flow.

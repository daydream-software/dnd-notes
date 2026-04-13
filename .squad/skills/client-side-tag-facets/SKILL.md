---
name: "client-side-tag-facets"
description: "Add tag browsing and editor autocomplete by deriving facets from already-loaded notes."
domain: "frontend"
confidence: "high"
source: "earned"
tools:
  - name: "view"
    description: "Inspect the existing note list and editor flow before threading tag facets through them."
    when: "You need tag discovery without changing the backend contract."
---

## Context
Use this when tags already exist on loaded records, but the product needs faster reuse and browseability before investing in backend search, hierarchy, or graph relationships. It is especially useful when active backend work makes a frontend-only slice the safest path.

## Patterns
- Derive tag counts/facets from the notes already in client state instead of requesting another endpoint.
- Keep the tag browser inside the existing notes shell so the detail pane and save flow stay familiar.
- Treat a selected tag as a lightweight folder/filter, not a forced parent-child taxonomy.
- Reuse the same tag facet list as the source for note-editor autocomplete.
- If the editor allows free-form tags, commit partially typed input on blur/Enter so quick capture does not lose tags.
- Keep the selected tag filter in local UI state so switching browse modes does not reload note data or clobber draft edits.
- Auto-clear an active tag filter if refreshed note data no longer includes that tag, so the view heals after saves or deletes.

## Examples
- `apps/web/src/App.tsx` computes `tagFacets` from loaded notes, renders a tag list with counts, and filters the note list locally when a tag is selected.
- `apps/web/src/App.tsx` uses Material UI `Autocomplete` with `freeSolo` + `multiple` for tag entry, while normalizing comma-separated input into deduped tag values.
- `apps/web/src/App.tsx` keeps `selectedTagFilter` separate from workspace loading state, so tag browsing survives mode switches without repeating `/api/notes` fetches.
- `apps/web/src/App.test.tsx` covers both browsing by tag and reusing an existing tag through the editor.

## Anti-Patterns
- Adding a new tag API or schema change before proving the browse UX with existing note data.
- Requiring hierarchical tag strings like `places/towns/port` just to make browsing work.
- Hiding active tag filters so the note list looks mysteriously incomplete.
- Using autocomplete that drops partially typed tags when the field loses focus.

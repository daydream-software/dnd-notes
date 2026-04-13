---
name: "safe-markdown-note-preview"
description: "Render saved note bodies and inline previews from Markdown without introducing a rich-text editor or stored HTML."
domain: "frontend, note-authoring, rendering"
confidence: "high"
source: "earned through issue #26 in dnd-notes"
tools:
  - name: "apply_patch"
    description: "Wire a shared preview component into the owner and shared note editors."
    when: "Adding the same rendering surface to multiple React entry points"
---

## Context
Use this when notes are stored as plain strings but users need friendlier formatting than raw text. The goal is a boring contract: keep Markdown as the saved source of truth, render it safely in browse/edit surfaces, and avoid inventing a custom rich-text format too early.

## Patterns
1. Keep `note.body` as canonical stored text so existing plain-text data keeps working with no migrations.
2. Use `react-markdown` with `remark-gfm` for headings, lists, emphasis, links, and other lightweight Markdown features.
3. Do not enable raw HTML rendering; keep the rendering path safe and predictable.
4. Reuse one preview component in every note-detail surface so owner and shared routes stay aligned.
5. Add one focused renderer unit test and one app-level wiring test to prove both parsing and integration.

## Examples
- `apps/web/src/note-formatting.tsx` exports the shared Markdown preview surface.
- `apps/web/src/App.tsx` shows the rendered preview directly under the note body textarea.
- `apps/web/src/SharedCampaignRoute.tsx` reuses the same preview for shared campaigns.

## Anti-Patterns
- Storing rendered HTML alongside the note body before there is a proven backend need.
- Introducing a full WYSIWYG editor for a first formatting slice.
- Letting owner and shared note views drift into separate rendering implementations.

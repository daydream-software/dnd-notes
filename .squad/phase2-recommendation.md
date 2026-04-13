# Phase 2 Frontend Implementation Recommendation
**Frontend Lead: Stef**  
**Date: 2026-04-13**

## Overview
Three core improvements for phase 2: markdown sanitization for note excerpts, a dual-mode editor (formatted + raw markdown), and qualified inline note references with dynamic discovery.

---

## 1. Markdown Sanitization for Excerpts

**Status:** ✅ Partially ready; needs cleanup  
**Complexity:** Low (2–3 hours)

### Current State
- `excerpt()` in `App.tsx:331` calls `markdownToPlainText()` from `note-formatting.tsx`
- Strips markdown syntax but doesn't sanitize HTML or escape dangerous characters
- Used in note rows, activity feed, and linked note cards

### Recommendation
**Keep the plain-text approach—it already works.** The `markdownToPlainText()` function is doing the right thing:
- Removes markdown syntax (headings, emphasis, code blocks, links, blockquotes)
- Collapses whitespace and limits to 112 chars
- Falls back to friendly "No details yet" message

**Quick polish (30 min):**
- Ensure HTML tags like `<script>` are stripped (already handled by `/<[^>]+>/g` regex)
- Test edge cases: nested backticks, escaped characters
- Verify the regex order doesn't create side effects (backticks before emphasis, for example)

**No API change needed.** The excerpt sanitization stays pure client-side, using the same contract.

---

## 2. Dual-Mode Editor (Formatted + Raw Markdown)

**Status:** 🔴 Requires implementation  
**Complexity:** Medium (5–7 days)

### Current State
- Plain `<textarea>` for body input
- Always-visible stacked preview below
- No way to toggle between modes
- No markdown integration framework

### Recommendation

#### Phase 2a: Add a simple mode toggle (1–2 days)
**Goal:** Remove the stacked preview, add a tab/button in the editor toolbar to show preview on demand.

**Approach:**
1. Keep the existing `TextField` for now—don't introduce a new editor framework yet
2. Add `showPreview: boolean` to local editor state
3. Replace stacked `NoteBodyPreview` with a toggle:
   ```
   <Button 
     onClick={() => setShowPreview(!showPreview)}
     variant={showPreview ? "contained" : "outlined"}
   >
     {showPreview ? "Hide preview" : "Show preview"}
   </Button>
   ```
4. Conditional render: `{showPreview && <NoteBodyPreview ... />}`

**Benefit:** Immediate UX win—more breathing room in the editor, faster scrolling.

#### Phase 2b: Introduce Lexical editor (4–5 days, after 2a ships)
**Goal:** Replace the plain textarea with a markdown-native, extensible editor that supports inline note references without inventing a new document format.

**Why Lexical over TipTap:**
- **Markdown-first:** Lexical's `markdown` plugin can parse/export pure markdown, keeping the API contract (`body: string`)
- **Custom nodes:** Lexical's node system makes inline note references (`![[ref|label]]`) first-class UI elements with proper backlink/rename support
- **Mode toggle:** Can build a "raw markdown" view by toggling `contentEditable` and rendering the raw text alongside (no second format)
- **Alignment:** Backend already stores markdown; `react-markdown` renders it; Lexical completes the loop without format fragmentation

**Setup outline:**
1. Add `lexical` and `@lexical/markdown` to `apps/web/package.json`
2. Create `NoteEditor.tsx` component wrapping `LexicalComposer`
3. Implement markdown import/export via `@lexical/markdown` with a custom config
4. Add optional raw-markdown toggle (`<div contentEditable="false">` showing raw text)
5. Keep `body: string` API—markdown in, markdown out
6. Start with basic nodes (paragraph, heading, code, blockquote); defer custom reference nodes to Phase 2c

**Acceptance criteria:**
- Editor renders markdown correctly (headings, lists, emphasis, code blocks)
- Save/load cycle preserves markdown without mutations
- Switching between formatted and raw shows identical markdown
- All existing notes load without data loss
- Tab to next field, Ctrl+S save, Escape cancel work

#### Phase 2c: Inline note references (2–3 days, after 2b ships)
**Goal:** Add `![[ref-id|Display Label]]` syntax support in the editor with a reference picker and inline preview.

**Approach:**
1. Create a custom Lexical `NoteRefNode` that:
   - Parses `![[noteId|label]]` from markdown during import
   - Renders as an inline pill/chip in the editor showing title + icon
   - Exports back to markdown during save
   - Validates linked note exists on blur/save
2. Add a menu command (e.g., `/ref` or a toolbar button) to insert a new reference
3. Reference picker modal: Autocomplete filtered to current campaign notes
4. Display tooltip with note title/excerpt on hover

**No backend schema change needed yet.** References stay embedded in `body` markdown until Phase 3 (structured reference extraction/indexing).

---

## 3. Qualified Inline Note References + Dynamic Discovery

**Status:** 🟡 Partially designed; needs backend coordination  
**Complexity:** Medium (backend) + Medium (frontend)

### Current State
- `linkedNoteIds: string[]` exists in schema (Issue #30, approved/merged)
- Backend has linkage validation and migration
- Frontend shows linked notes + backlinks as separate cards below editor
- **Gap:** References are not embedded in the markdown body; they live in a separate field

### Recommendation

#### Phase 2 / Phase 3 boundary decision

**Phase 2 scope (frontend-only):**
- Editor support for inline `![[noteId|label]]` syntax in markdown
- Automatic reference extraction during save (parse body for `![[...]]` patterns)
- Display linked notes + backlinks as cards (status quo)
- Search across note titles + bodies only (references follow naturally once in body)

**Phase 3 scope (backend + frontend):**
- Add `references: Reference[]` type with `{ sourceNoteId, targetNoteId, label, qualifier? }` structure
- Backend extraction: parse markdown on save, persist structured references
- Reference-aware search: find notes that reference or are referenced by current note
- Rename safety: if note A renames, update all references to A across all notes
- Visualize reference graph (optional, post-Phase 3)

### Phase 2 Implementation Outline

1. **Inline markdown format:**
   - Use `![[noteId]]` or `![[noteId|Custom Label]]` for qualified references
   - Treat like a standard markdown image with a special syntax
   - If backend can't parse it, editor strips or converts to plain `[label](/)` fallback

2. **Editor behavior:**
   - Markdown import/export already handles it (custom Lexical node)
   - On save, send body as-is (with `![[...]]` syntax intact)
   - Backend stores in `body` field; no `linkedNoteIds` migration needed (redundant for v2)

3. **Discovery + search:**
   - `excerpt()` function already sanitizes `![[...]]` to `label` text
   - Search finds notes mentioning other notes by title (natural, no special query syntax)
   - Backlinks computed client-side: `notes.filter(n => n.body.includes(`![[${currentNoteId}`))`
   - Linked notes computed the same way

4. **Acceptance criteria:**
   - Editor supports inline `![[id|label]]` insertion and editing
   - References render as styled pills in formatted view
   - Raw markdown view shows syntax unchanged
   - Save preserves references in markdown
   - Search finds both referenced note and referencing notes
   - Backlinks panel auto-updates if a note adds a new reference to current note
   - No data loss on round-trip import/export

---

## Implementation Roadmap

| Phase | Work | Owner | Est. Days | Blocker | 
|-------|------|-------|-----------|---------|
| 2a | Mode toggle + remove stacked preview | Stef | 1–2 | None |
| 2b | Lexical editor setup + markdown import/export | Stef | 4–5 | None |
| 2c | Inline reference nodes + reference picker | Stef + Data | 2–3 | Backend validation (optional) |
| 3 | Structured reference extraction + search | Data + Stef | 3–4 | Reference type in schema |

---

## File Changes Required

### Frontend (apps/web/src/)
- **App.tsx:** Remove stacked preview section; add `showPreview` toggle in editor; integrate `NoteEditor` component
- **NoteEditor.tsx** (new): Lexical composer wrapper with markdown config, raw-mode toggle
- **note-formatting.tsx:** Add reference sanitization (optional, for excerpt safety)
- **api.ts:** No changes (body stays `string`)
- **types.ts:** No changes (references stay in `body` until Phase 3)

### Backend (apps/api/src/)
- **types.ts:** No changes for Phase 2 (references embedded in `body`)
- **validation.ts:** Optional: add lint for malformed `![[...]]` syntax on save
- **app.ts:** No changes (body validation unchanged)
- **note-store.ts:** No changes

### Dependencies
- Add `lexical` and `@lexical/markdown` to `apps/web/package.json`
- Consider `lexical-list` plugin for richer list support (optional)

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Lexical adds 50KB+ to bundle | Load time | Use code splitting; defer editor to notes route only |
| Markdown round-trip loses formatting | Data loss | Write import/export tests; compare input ≈ output byte-for-byte |
| References in markdown break search | Discovery | Update search regex to extract and index reference targets alongside titles |
| Backlink panel shows stale data | Confusion | Recompute backlinks on note save/delete in `loadWorkspace` effect |

---

## Notes for Data (Backend)

**For Phase 2c / Phase 3 planning:**
1. Schema addition: `Note.references?: Array<{ sourceId, targetId, label, qualifier? }>`
2. Migration: Add `references_json` column with default `'[]'`
3. Validation: Reject references to non-existent notes or cross-campaign notes
4. Search: Index reference targets alongside titles so `search("dragon")` finds "dragon" note + all notes that reference it

**No blocker for Phase 2** — markdown embedding doesn't require schema changes.

---

## Acceptance Criteria Summary

✅ **Phase 2 Complete when:**
- [ ] Mode toggle hides/shows preview
- [ ] Lexical editor loads markdown without data loss
- [ ] Raw markdown mode shows unformatted text
- [ ] Inline reference syntax is recognized and rendered
- [ ] References appear in excerpts as plain text (safe)
- [ ] All existing tests pass (26 tests + regression coverage for editor)
- [ ] No performance regression on load/save (measure with DevTools)

---

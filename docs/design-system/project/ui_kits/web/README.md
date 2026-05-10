# D&D Notes — Web UI Kit

A high-fidelity recreation of the dnd-notes web app (`apps/web` in `daydream-software/dnd-notes`). Open `index.html` for an interactive walkthrough: pick a campaign, browse notes, edit one, toggle split mode, send a quick capture.

## Components

- `App.jsx` — top-level state machine + screens (login → campaign → workspace)
- `BrandPill.jsx` — floating identifier (the "D&D Notes" caps pill, desktop-only)
- `WorkspaceHeader.jsx` — sticky campaign selector with action icons
- `StatPills.jsx` — 4-up overview row (notes / factions / NPCs / sessions)
- `NotesBrowsePane.jsx` — search + tag filter + note list
- `NoteListItem.jsx` — single row in the browse pane
- `NoteEditor.jsx` — title, body, tags, status, footer actions
- `Toolbar.jsx` — markdown formatting toolbar (H1 / H2 / B / I / list / link)
- `Chip.jsx` — tag/status pill
- `Button.jsx` — contained / outlined / text / danger variants
- `Field.jsx` — labeled input/textarea
- `Icon.jsx` — Material Symbols Rounded wrapper

## Fidelity caveats

Recreations are **cosmetic** — no real persistence, no real auth, no real markdown parser. The Lexical-powered rich-text editor is replaced with a plain textarea that preserves the markdown shorthand. Note links (`![[id|label]]`) render as styled chips inline but aren't navigable.

## Where each design choice came from

- Layout, padding, breakpoints → `CampaignWorkspaceSurface.tsx`
- Sticky header, blur values, opacity ramp → `CampaignWorkspaceHeader.tsx`
- Search, tag filters, quick capture → `NotesBrowsePane.tsx`
- Save / delete actions → `NoteEditorActions.tsx`
- Toolbar buttons → `NoteBodyEditor.tsx` `FormattingToolbar`
- Color tokens → `main.tsx` MUI theme + `index.css` body gradient
- Note templates → `templates.ts`

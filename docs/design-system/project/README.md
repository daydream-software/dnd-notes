# D&D Notes — Design System

A design system distilled from [`daydream-software/dnd-notes`](https://github.com/daydream-software/dnd-notes) — a mobile-friendly tabletop note-taking app you can embed in a VTT and share with your table. It's a one-person project by Mikh'a under the **Daydream Software** banner, kept intentionally professional, accessible, and mobile-first.

## Source materials

- **GitHub repo:** `daydream-software/dnd-notes` (private, default branch `main`).
  - Theme tokens live in [`apps/web/src/main.tsx`](https://github.com/daydream-software/dnd-notes/blob/main/apps/web/src/main.tsx) (MUI `createTheme`)
  - Page background in [`apps/web/src/index.css`](https://github.com/daydream-software/dnd-notes/blob/main/apps/web/src/index.css)
  - Markdown / note body styles in [`apps/web/src/note-markdown-styles.ts`](https://github.com/daydream-software/dnd-notes/blob/main/apps/web/src/note-markdown-styles.ts)
  - Surface composition in `CampaignWorkspaceSurface.tsx`, `CampaignWorkspaceHeader.tsx`, `NotesBrowsePane.tsx`, `NoteEditorActions.tsx`, `NoteBodyEditor.tsx`
  - Brand mark and SVG icon sprite in [`apps/web/public/`](https://github.com/daydream-software/dnd-notes/tree/main/apps/web/public)
- **Sister repos** (not in this design system, listed for context): `ffmikha/adventofcode`, `ffmikha/Tukui`.

## Product surface

There is **one product**: the `dnd-notes` web app (`apps/web`). It's a React + Vite + Material UI workspace where Dungeon Masters and players manage notes for a campaign — NPCs, factions, locations, session recaps — with optional shared links so guests can read or co-edit. The app is responsive: a desktop split-pane workspace (browse + editor side-by-side), and a single-pane browse-or-edit flow on mobile. There are operator/customer portals in the repo but they are internal infra, not user-facing brand surfaces, so this design system covers the notes web app only.

## Index — what's in this folder

- `README.md` — this file
- `colors_and_type.css` — all CSS variables (colors, type, spacing, radii, shadows) + base element styles
- `assets/`
  - `logo.svg` — **placeholder only** (the Vite-template bolt that ships with the repo's favicon slot — not a real brand mark yet). Flagged for design.
  - `icons.svg` — SVG sprite (bluesky / discord / docs / github / social / x icons)
  - `hero.png` — original repo hero illustration (stacked translucent cards)
- `preview/` — design-system tab cards (typography, color, components, etc.). Run `npm run design:preview` from the repo root, then open <http://127.0.0.1:7787/preview/>.
- `ui_kits/web/` — React/JSX recreation of the dnd-notes app (sidebar, browse pane, editor, etc.) with an interactive `index.html`
- `SKILL.md` — agent skill manifest (cross-compatible with Claude Code Agent Skills)

## Content fundamentals

Voice is **calm, declarative, and player-friendly**. Copy reads like a thoughtful DM speaking plainly — no marketing puff, no exclamation points, no emoji.

- **Pronoun:** prefer the implied imperative ("Search title, body, tags…", "Start writing the note body…"). When a person is referenced, it's "you" or "guests" / "owners" / "collaborators" — never "we".
- **Casing:** sentence case for everything — buttons ("Save note", "Delete note"), headings ("Faction brief"), captions ("Last updated 5 minutes ago"). The product name uses ampersand: **D&D Notes**. The brand pill in the app is uppercased with `letter-spacing: 0.08em` — this is the *only* uppercase treatment.
- **Tone examples (from templates.ts and the UI):**
  - "A lightweight scaffold for recurring people notes."
  - "Capture goals, pressure, and relationships for a faction."
  - "Log the beats, fallout, and next steps after a session."
  - "Switch between browsing and editing without stretching the page."
  - "New notes are saved straight to the selected campaign."
  - "Viewer links can read shared notes but cannot save changes."
- **Note-template microcopy** uses single-line scaffold prompts terminated with a colon: `"Role in the story:"`, `"What they want:"`, `"Hooks:"` — never full sentences, never trailing periods.
- **Vibe:** quiet competence. Nothing shouts. The product trusts the DM to fill in the imagination.

## Color modes — dark + light (proposed)

The system supports two color modes. Dark is the historical default and the only one the production apps ship today. Light is **proposed and previewable** in `colors_and_type.css` + the `preview/` HTML pages — not yet wired into `packages/theme` or the apps.

**Activation:** `data-theme="light"` on `<html>` flips the token block in `colors_and_type.css`. The preview pages load `preview/mode-toggle.js`, which reads `localStorage['dndnotes-preview-theme']` with `prefers-color-scheme` as the fallback and renders a small floating toggle button (top-right).

**Philosophy — sister-language, not mirror.** Dark mode is built around glass-on-gradient (translucent slate cards floating above a purple radial halo). Inverting those tokens naïvely in light mode produces washed-out haze. Light mode instead shares the brand DNA — purple `#a78bfa`, amber `#f59e0b`, Geist, radii 18, calm voice — but adopts its own surface logic: **solid cards, no backdrop-blur, the radial halo preserved at much lower intensity** (`0.10` vs `0.28` opacity). Dark = night of play. Light = day of prep.

**What stays constant across modes:**
- Brand purple ramp `--brand-50 → --brand-900` is **never overridden** — palette swatches stay honest. Use `--accent` (not `--brand-500`) for foreground roles that need AA contrast; it points at `--brand-500` on dark and shifts to `--brand-700` on light.
- Amber secondary `--warn: #f59e0b` is unchanged (it's the brand secondary, primarily used as a wash background).
- The contained primary button (`bg: --brand-500`, `color: --on-brand`) is mode-invariant — same light-purple pill with deep-navy text in both modes. The pair has good contrast against itself; the page around it changes.
- Radii (18px / 999px / 8px), spacing scale, type scale, Geist family.

**What changes in light mode:**
- `--bg-*`, `--fg-*` flip to violet-tinted off-white + slate-900 foreground.
- `--bg-paper*` lose translucency (solid `#ffffff`-family) — the glass aesthetic is dark-mode-only.
- `--brand-line-*` opacities lift (`0.20 → 0.35` family) so 1px purple borders remain visible on light surfaces.
- Semantic colors `--error / --success / --info` shift one step darker for AA on white.
- Shadows become lighter (slate-tinted but less opaque).
- Components should opt out of `backdrop-filter` in light mode (`[data-theme="light"] .card { backdrop-filter: none }`). Blur on solid light surfaces reads as visual haze, not depth.

**Mode-aware surfaces.** Two layers participate in the bimode:
- *Component previews* in `preview/*.html` — most flip cleanly via tokens. Palette-demo pages (`colors-brand.html`, `colors-slate.html`) intentionally keep their hardcoded swatch colors. `brand-pill.html` and `chips.html` still hardcode dark slate inline (followup).
- *App recreations* in `ui_kits/{web,customer-portal,operator-portal}/` — all three JSX recreations are mode-aware. Their `index.html` defines a `.dndn-glass` class (with `backdrop-filter` opted out in light mode) which the JSX components opt into via `className="dndn-glass"`. React inline styles use the same tokens (`var(--bg-paper)`, `var(--accent)`, `var(--brand-line-soft)`, etc.) as the component previews. The modal scrim in the operator-portal `Dialogs.jsx` keeps a literal dark RGBA — a scrim is a uniform dim overlay that works in both modes.

**Contained primary button — mode-aware fill.** The contained primary button uses a dedicated `--button-primary-bg` / `--button-primary-fg` pair (defined in `colors_and_type.css`) that shifts in light mode only. Dark: `brand-500` on slate with `#1a0f3a` text — unchanged. Light: `brand-700` on `#fbfaff` with white text — strong affordance against the page. The brand-500 ramp itself stays mode-invariant, so other primary roles (chips, focus rings, link text via `--accent`) keep brand-500 (dark) / brand-700 (light) per the existing accent rule. A side-by-side A/B preview lives at `preview/button-modes.html`. See #408 for the decision rationale.

## Visual foundations (dark mode — historical default)

The visual identity is a **dark, glassy, purple-washed slate** — late-night campaign vibes without going gothic.

- **Palette:** slate `#020617 → #0f172a → #111827` body gradient with a purple radial halo (`rgba(124,58,237,0.28)`) at the top. Brand purple `#a78bfa` is the primary; amber `#f59e0b` is the only secondary. All accents (chips, focus rings, borders, icon glyphs) live inside that purple ramp.
- **Typography:** Geist (sans) + Geist Mono (mono), both loaded from Google Fonts. MUI default scale; `font-synthesis: none`, antialiased. Markdown body uses an explicit responsive scale (h1 1.7→2rem, h2 1.45→1.7rem, h3 1.25→1.45rem). The original `apps/web` source still references Inter — when we land Geist there, swap MUI's `typography.fontFamily` value too.
- **Backgrounds:** never full-bleed photographic. The page is a single fixed gradient + radial halo; cards float above it. No textures, no patterns, no hand-drawn illustrations. The repo ships one hero PNG (translucent stacked cards) but it's decorative, not load-bearing.
- **Cards & surfaces:** translucent slate (`rgba(15,23,42,0.88–0.9)`) with a 1px purple-tinted border (`rgba(167,139,250,0.18–0.22)`), `backdrop-filter: blur(12–16px)`, and a slate-tinted drop shadow (`0 16px 40px rgba(2,6,23,0.26)`). The sticky workspace header drops to `0.44` opacity in compact mode and lifts to `0.88` on hover — a subtle reveal-on-attention pattern.
- **Corner radii:** MUI `shape.borderRadius: 18` is the global default. Pills use `999px`. Code blocks use `8px`. There is no sharp-cornered surface anywhere in the app.
- **Borders:** always 1px, always purple-tinted-translucent. No solid neutral borders, no double borders, no colored left-accent borders.
- **Shadows:** all shadows are slate-tinted, never neutral black. Default lift `0 16px 40px rgba(2,6,23,0.26)`; stat pills use a warmer-slate `0 20px 40px rgba(15,23,42,0.24)`. No inner shadows are used.
- **Transparency & blur:** liberally used on floating chrome (sticky header, brand pill). Body content stays opaque. Blur is `12–16px`.
- **Animation:** MUI's `transitions.duration.shorter` (~200ms) on color/border/shadow changes only. No bouncy easings, no entrance animations, no spinners with personality. Loading states are textual ("Saving…", "Deleting…", "Capturing…").
- **Hover states:** lift opacity (paper bg `0.44 → 0.88`), tighten border (`brand-line-faint → brand-line-strong`), deepen shadow. Buttons follow MUI defaults — no custom hover.
- **Press states:** MUI default ripple. Nothing custom.
- **Focus:** MUI default focus rings (purple, accessible).
- **Layout rules:** `Container maxWidth="xl"`, `Stack` everywhere, generous `spacing={2.5}`. The workspace switches from single-column (mobile) to a `1.1fr / 1fr` split (desktop) when split mode is on. Brand pill is `display: none` below `lg`. Header is sticky desktop-and-up, with a 360px max-width on mobile.
- **Imagery vibe:** the repo's only image is cool-toned, low-saturation, translucent-purple. If you add imagery, match: cool slate, soft purple wash, no warm tones, no grain.

## Iconography

- **Source:** the codebase uses `@mui/icons-material` (e.g. `SaveRounded`, `SearchRounded`, `BoltRounded`, `StickyNote2Rounded`) for all UI glyphs, plus a custom inline SVG sprite at [`apps/web/public/icons.svg`](https://github.com/daydream-software/dnd-notes/blob/main/apps/web/public/icons.svg) for social marks (Bluesky, Discord, Docs, GitHub, Social/star, X).
- **Style:** MUI **Rounded** variants only — never Outlined or Sharp. Filled where the metaphor is concrete (Save, Bolt), outlined where the metaphor is structural (Search, Clear). Default size `small` (~20px); `fontSize="small"` on `IconButton`.
- **Color:** glyphs inherit `currentColor` and pick up the surrounding text token. Brand-tinted icons use `#aa3bff` (see the docs / social SVGs in the sprite); social brand glyphs keep their canonical fills (`#08060d` for X / GitHub / Bluesky / Discord).
- **Emoji:** **never**. The brand has no emoji surface — substitute with a Rounded MUI icon or omit.
- **Unicode characters:** sparingly — `&` (the ampersand in "D&D Notes"), `—` em-dashes, `…` ellipsis, the typographic quote pair. No arrows, stars, or geometric shapes.
- **Substitution flag:** for design surfaces outside the codebase, use **Material Symbols Rounded** via Google Fonts (CDN-available, identical optical metrics to `@mui/icons-material`). The custom social SVGs are vendored in `assets/icons.svg`; reference them via `<svg><use href="assets/icons.svg#bluesky-icon"/></svg>`.

## Font substitution flag

> **Geist is self-hosted** — `assets/fonts/Geist-Variable.woff2` and `assets/fonts/GeistMono-Variable.woff2`. The `@font-face` rules live at the top of `colors_and_type.css`, so any artifact that imports the stylesheet gets the brand fonts automatically — no Google Fonts `<link>` needed. The original `apps/web` source still references Inter — when we land Geist there, copy these woff2 files into the app and swap MUI's `typography.fontFamily`.

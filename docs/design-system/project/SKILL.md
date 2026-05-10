---
name: dnd-notes-design
description: Use this skill to generate well-branded interfaces and assets for D&D Notes (the dnd-notes app from Daydream Software / Mikh'a), either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files (`colors_and_type.css`, `assets/`, `preview/`, `ui_kits/web/`).

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. The fastest path is: link `colors_and_type.css`, load Inter from Google Fonts, load Material Symbols Rounded, and reuse the JSX components in `ui_kits/web/`. Background should be the slate `--page-bg` gradient with the purple radial halo.

If working on production code, the source repo is `daydream-software/dnd-notes` and uses MUI dark mode with `primary: #a78bfa`, `secondary: #f59e0b`, `shape.borderRadius: 18`. Read the rules in `README.md` (especially **Visual foundations** and **Iconography**) to become an expert in designing with this brand.

If the user invokes this skill without any other guidance, ask them what they want to build or design — a new screen, a marketing slide, an empty-state, a settings page — ask a few clarifying questions about audience and scope, and then act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

Hard rules to respect:
- Sentence case for all UI copy. No emoji. No exclamation points.
- Cards are translucent slate with purple-tinted 1px borders, 18px radius, slate-tinted shadows, and `backdrop-filter: blur(12–16px)`.
- All glyphs are MUI Rounded (or Material Symbols Rounded). Never Outlined or Sharp.
- The brand mark is currently a placeholder — flag any logo work as needing a real mark.

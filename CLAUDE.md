# D&D Notes — Agent Guidelines

See `AGENTS.md` for the full project overview, commands, and contribution rules.
This file adds Claude Code-specific guidance on top of that.

---

## Design system

This project uses a defined design system. **Do not introduce tokens, fonts, or colors that contradict it.**

### Single source of truth — `packages/theme`

The MUI theme lives in `packages/theme/src/index.ts` and is imported by all three frontend apps via `@dnd-notes/theme`. **Never call `createTheme` inside an app.** If a change to the palette, typography, or radii is needed, edit the package — the apps pick it up automatically on next build.

### Typography

- **Font family:** Geist (sans) + Geist Mono. Font files are self-hosted in each app's `public/fonts/`. **Do not use Inter or any other font.**
- Swap rule: if you add or modify a `fontFamily` anywhere (MUI theme, inline `sx`, CSS), it must reference `'Geist'` or `'Geist Mono'`.

### Palette

| Token | Value | Usage |
|---|---|---|
| Primary | `#a78bfa` | Buttons, chips, focus rings, links |
| Secondary | `#f59e0b` | Amber accent |
| Background default | `#0f172a` | MUI `background.default` |
| Paper | `rgba(15, 23, 42, 0.9)` | Cards, dialogs, surfaces |

**Forbidden values:** `#38bdf8` (sky blue), `#8b5cf6` (violet-600 used by old portals), `#020617` as `background.default`. If you see these anywhere outside a gradient stop, replace them.

### Background gradient

The page body background is:

```css
radial-gradient(circle at top, rgba(124, 58, 237, 0.28), transparent 35%),
linear-gradient(180deg, #020617 0%, #0f172a 48%, #111827 100%)
```

This is set in each app's `src/index.css`. Do not override it with a flat color or a simpler gradient.

### Surfaces & borders

- `borderRadius: 18` globally (MUI `shape.borderRadius`). No sharp-cornered surfaces.
- Borders are always `1px` and purple-tinted-translucent (`rgba(167, 139, 250, 0.18–0.22)`). No solid neutral borders.
- Cards use `backdrop-filter: blur(12–16px)` and slate-tinted shadows (`rgba(2, 6, 23, 0.26)`).

### Buttons

- **Do not add `fullWidth` to submit buttons in forms.** Use `sx={{ alignSelf: 'flex-start' }}` on the `Button` when it sits inside a flex-column `Stack` without explicit `alignItems`. Full-width is only appropriate inside `Dialog` action rows.
- MUI **Rounded** icon variants only — never Outlined or Sharp.

### Copy & tone

- Sentence case everywhere: buttons, headings, labels. No Title Case, no ALL CAPS except the brand pill (`D&D NOTES` with `letter-spacing: 0.08em`).
- No emoji in UI copy or code. Use MUI Rounded icons instead.
- Voice is calm and declarative — no exclamation points, no marketing puff.

---

## Squad Framework (Multi-Agent)

This project uses the Squad AI team framework. Agent definitions for each member live in `.claude/agents/`.

### Spawning agents

Use the `Agent` tool to spawn real subagents. Never role-play or simulate a member inline.

```javascript
Agent({
  subagent_type: "stef",          // or "data", "brand", "chunk", "mikey", "scribe", "squad"
  run_in_background: true,        // true for most work; false for sync review gates
  isolation: "worktree",          // see "Worktree isolation" below
  model: "sonnet",                // "sonnet", "opus", or "haiku" — short names only
  description: "⚛️ Stef: build note editor form",
  prompt: "TEAM_ROOT: /path/to/repo\n\n..."
})
```

Always pass `TEAM_ROOT` (absolute path from `git rev-parse --show-toplevel`) in every spawn prompt.

### Worktree isolation

Use `isolation: "worktree"` whenever an agent will write code, run a build, or otherwise mutate the filesystem **and** another agent or the coordinator may be active in parallel. The runtime creates a temporary git worktree, the agent works in isolation, and the harness cleans it up automatically if no changes were made (otherwise it returns the worktree path + branch name in the result).

Without isolation, parallel agents share `git checkout` state — one agent's `checkout feat/X` swaps the coordinator's working tree out from under them, and stray commits can land on the wrong branch.

Reasonable rules of thumb:

- Single agent + coordinator idle → isolation optional (small overhead win)
- Two or more agents in parallel that each touch different branches → **always isolate**
- Coordinator is actively editing/building while an agent runs → **always isolate the agent**
- Read-only agents (Explore, scribe doing pure logging) → isolation optional

### Routing

| Work type | Agent |
|-----------|-------|
| UI, React, Material UI, forms, navigation | `stef` |
| API, backend, Node, Postgres, service logic | `data` |
| CI, scripts, Docker, k3d, tooling | `brand` |
| Tests, QA, edge cases, regression | `chunk` |
| Code review, architecture, PR gate | `mikey` |
| Session logging (always background, always last) | `scribe` |
| Orchestration, routing, multi-agent fan-out | `squad` |

### Before starting issue work

1. Read `.squad/team.md` — roster and capability profile
2. Read `.squad/routing.md` — routing rules
3. If the issue has a `squad:{member}` label, spawn that member via the `Agent` tool

---

## Memory

Project memories are stored in the standard Claude Code memory directory for this workspace. Check `MEMORY.md` there for the index.

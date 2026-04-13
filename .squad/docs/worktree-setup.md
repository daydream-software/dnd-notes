# Squad Worktree Setup

## Overview

This project uses git worktrees for isolated issue-based work. The repo-local source of truth is `.squad/config.json`, which currently enables worktrees and places them in a dedicated `.worktrees/` folder inside the repo root.

## Preferred Configuration

File: `.squad/config.json`

```json
{
  "version": 1,
  "worktrees": true,
  "workTreesFolder": ".worktrees"
}
```

- `worktrees: true` enables worktree-based issue work
- `workTreesFolder: ".worktrees"` tells Squad to create worktrees under `repo-root/.worktrees/`
- Relative `workTreesFolder` values resolve from the repo root / team root

## Fallback Behavior

If `workTreesFolder` is omitted but `worktrees` stays enabled, Squad falls back to the legacy sibling-path layout:

- Preferred in this repo: `{repo-root}/.worktrees/{issue-number}`
- Fallback without `workTreesFolder`: `{repo-parent}/{repo-name}-{issue-number}`

Example:
- Configured folder: `/workspace/dnd-notes/.worktrees/42`
- Fallback sibling path: `/workspace/dnd-notes-42`

## How Worktrees Are Resolved

When the Squad coordinator assigns issue-based work, it should:

1. Read `.squad/config.json` first when deciding whether worktree mode is enabled
2. Check `worktrees: true`
3. If `workTreesFolder` is set, resolve `{repo-root}/{workTreesFolder}/{issue-number}`
4. If `workTreesFolder` is absent, fall back to `{repo-parent}/{repo-name}-{issue-number}`
5. Create or reuse the issue-specific branch worktree
6. Link `node_modules` from the main repo when that optimization is available
7. Spawn agents with `WORKTREE_PATH` set to the resolved path

## Folder Structure Example

```text
dnd-notes/
├── .git/
├── .squad/
├── .worktrees/
│   ├── 42/
│   │   ├── .git
│   │   ├── apps/
│   │   ├── package.json
│   │   └── node_modules -> ../../node_modules
│   ├── 45/
│   └── ...
├── apps/
├── package.json
├── node_modules/
└── ...
```

## Manual Commands

Create a worktree with the configured repo-local folder:

```bash
cd /workspace/dnd-notes
git worktree add .worktrees/42 -b squad/42-descriptive-slug main
cd .worktrees/42
ln -s ../../node_modules node_modules
```

If `workTreesFolder` is not configured, use the fallback sibling path instead:

```bash
cd /workspace/dnd-notes
git worktree add ../dnd-notes-42 -b squad/42-descriptive-slug main
cd ../dnd-notes-42
ln -s ../dnd-notes/node_modules node_modules
```

List active worktrees:

```bash
git worktree list
```

Remove a worktree after merge:

```bash
cd /workspace/dnd-notes
git worktree remove .worktrees/42
git branch -d squad/42-descriptive-slug
```

Fallback cleanup without `workTreesFolder`:

```bash
cd /workspace/dnd-notes
git worktree remove ../dnd-notes-42
git branch -d squad/42-descriptive-slug
```

## Why `.worktrees/`?

- Predictable location inside the project
- Cleaner parent workspace: no sibling `dnd-notes-42` folders by default
- Easy cleanup and discovery with one dedicated folder
- Safe to ignore in git as local runtime state

## Related Governance

These files now describe the same behavior:

- `.github/agents/squad.agent.md`
- `.squad/templates/squad.agent.md`
- `.squad/templates/issue-lifecycle.md`
- `.squad/templates/skills/git-workflow/SKILL.md`
- `.squad/config.json`

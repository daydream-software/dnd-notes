# Squad Worktree Setup

## Overview

This project is configured to use git worktrees for isolated issue-based work. All worktrees are created in a dedicated .worktrees folder within the repo root, keeping the project structure clean and predictable.

## Configuration

File: .squad/config.json

{
  "version": 1,
  "worktrees": true,
  "workTreesFolder": ".worktrees"
}

- worktrees: true enables automatic worktree creation for issue-based work
- workTreesFolder: ".worktrees" means all worktrees are created under repo-root/.worktrees/

## How Worktrees Are Created

When the Squad Coordinator assigns work on an issue, it:

1. Determines the worktree path:
   {repo-root}/.worktrees/{issue-number}
   Example: Issue #42 → .worktrees/42/

2. Creates a new worktree with an issue-specific branch:
   git worktree add .worktrees/42 -b squad/42-kebab-case-slug main

3. Links node_modules from the main repo to avoid reinstalling dependencies

4. Spawns agents with WORKTREE_PATH set to the worktree location

## Folder Structure Example

dnd-notes/
├── .git/
├── .squad/
├── .worktrees/                    (All issue worktrees here)
│   ├── 42/                        (Issue 42)
│   │   ├── .git
│   │   ├── apps/
│   │   ├── package.json
│   │   └── node_modules -> ../../../node_modules (symlink)
│   ├── 45/                        (Issue 45)
│   │   ├── .git
│   │   ├── apps/
│   │   └── ...
│   └── ...
├── apps/
├── package.json
├── node_modules/
└── ...

## Usage

### For Squad Members Working in a Worktree

When the Coordinator spawns you for issue-based work:

1. Your spawn prompt includes WORKTREE_PATH: repo-root/.worktrees/{issue-number}
2. All file operations are relative to that path
3. Do NOT switch branches — you're in an isolated worktree with its own branch
4. Submit your work as usual; the Coordinator handles PR creation and worktree cleanup after merge

### For Manual Worktree Operations

If you need to create or manage worktrees manually:

Create a worktree for issue N:
cd /home/adelisle/workspace/dnd-notes
git worktree add .worktrees/N -b squad/N-descriptive-slug main
cd .worktrees/N
ln -s ../../node_modules node_modules
npm run dev

List all active worktrees:
git worktree list

Remove a worktree (after PR is merged):
cd /home/adelisle/workspace/dnd-notes
git worktree remove .worktrees/N
git branch -d squad/N-descriptive-slug

## Why .worktrees/ ?

✅ Predictable location: All issue branches are under one folder
✅ Clean repo root: No sibling dnd-notes-42 folders cluttering the workspace
✅ Easy cleanup: Remove all worktrees at once if needed
✅ Git-ignorable: Worktrees are local runtime state, excluded from version control

## Notes

- Worktrees are not tracked by git — they're in .gitignore by design
- Each worktree has its own branch and git history
- Worktrees can be created/removed freely without affecting the main repo
- node_modules is symlinked to save disk space and installation time
- The Coordinator automatically manages worktree lifecycle (create on issue start, remove on PR merge)

## See Also

- .squad/config.json — Project-level configuration
- Squad Agent Template (.squad/templates/squad.agent.md) — Coordinator worktree automation rules
- .gitignore — Excluded .worktrees/ from version control

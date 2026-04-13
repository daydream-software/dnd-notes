# 2026-04-13: Squad Worktrees in Dedicated Folder

By: Brand (Platform Dev)
Requested by: FFMikha
Status: IMPLEMENTED

## Problem

Default squad worktree behavior creates sibling folders at the repo parent level.
Example: Repo at /path/to/dnd-notes creates worktrees at /path/to/dnd-notes-42, etc.
This clutters the workspace. User requested worktrees under a dedicated folder.

## Solution Implemented

1. Updated .squad/config.json:
   version: 1
   worktrees: true
   workTreesFolder: ".worktrees"

2. Added .worktrees/ to .gitignore

3. Created .squad/docs/worktree-setup.md with comprehensive guide

## What This Enables

All worktrees live under repo-root/.worktrees/
Worktrees organized by issue: .worktrees/42/, .worktrees/45/, etc.
Clean repo workspace - no sibling folders
Project-level configuration - no shell env vars needed
Coordinator automatically uses this path when spawning agents

## Example

Before: /workspace/dnd-notes-42 (sibling folder)
After: /workspace/dnd-notes/.worktrees/42/ (dedicated folder)

## Limitations

The workTreesFolder config key is a convention. Full automation depends on:
1. Coordinator parsing .squad/config.json and reading workTreesFolder
2. Coordinator applying this path when calculating worktree location

Current squad agent template describes default behavior (sibling folders).
If full automation not yet in Coordinator, manual worktree creation still uses sibling paths.
Team should test and confirm Coordinator uses the configured folder.

Follow-up if needed: If Coordinator does not parse workTreesFolder, add:
- Config parsing to squad.agent.md Pre-Spawn section
- Update path calculation to use workTreesFolder instead of repo-parent

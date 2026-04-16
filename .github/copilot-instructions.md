# Copilot Coding Agent — Squad Instructions

You are working on a project that uses **Squad**, an AI team framework. When picking up issues autonomously, follow these guidelines.

## Team Context

Before starting work on any issue:

1. Read `.squad/team.md` for the team roster, member roles, and your capability profile.
2. Read `.squad/routing.md` for work routing rules.
3. If the issue has a `squad:{member}` label, read that member's charter at `.squad/agents/{member}/charter.md` to understand their domain expertise and coding style — work in their voice.

## Capability Self-Check

Before starting work, check your capability profile in `.squad/team.md` under the **Coding Agent** section.

- **🟢 Good fit** — proceed autonomously.
- **🟡 Needs review** — proceed, but note in the PR description that a squad member should review.
- **🔴 Not suitable** — do NOT start work. Instead, comment on the issue:
  ```
  🤖 This issue doesn't match my capability profile (reason: {why}). Suggesting reassignment to a squad member.
  ```

## Branch Naming

Use the squad branch convention:
```
squad/{issue-number}-{kebab-case-slug}
```
Example: `squad/42-fix-login-validation`

## PR Guidelines

When opening a PR:
- Reference the issue: `Closes #{issue-number}`
- If the issue had a `squad:{member}` label, mention the member: `Working as {member} ({role})`
- If this is a 🟡 needs-review task, add to the PR description: `⚠️ This task was flagged as "needs review" — please have a squad member review before merging.`
- Follow any project conventions in `.squad/decisions.md`

## Decisions

If you make a decision that affects other team members, write it to:
```
.squad/decisions/inbox/copilot-{brief-slug}.md
```
The Scribe will merge it into the shared decisions file.

## Planning Persistence

For any task that spans multiple phases, files, or sessions:

1. Create or update the session `plan.md` early with the problem, chosen approach, key decisions, current status, and next steps.
2. Do not rely on chat history or CLI-only SQL state as the only source of truth.
3. Mirror the durable handoff context in `.squad/agents/copilot/history.md` whenever work starts, meaningfully changes direction, or pauses with unfinished follow-up.
4. Treat `.squad/agents/copilot/history.md` as the cross-session recovery point for ongoing Copilot work.

## Commit Signing

When creating git commits for this repo:

1. Never bypass signing with `--no-gpg-sign`.
2. Assume signed commits are required.
3. If a signing passphrase or interactive confirmation is needed, stage the work and hand the user the exact `git commit -S ...` command before expecting the commit to be finalized.
4. When a coherent set of changes is complete and validated, stage it and commit it immediately unless the user asked not to commit yet.
5. Use a conventional commit message when creating that commit.
6. The repo enforces Conventional Commits locally through Husky + commitlint, so do not rely on memory alone for commit message format.

# Squad Team

> dnd-notes — a D&D note-taking app

## Coordinator

| Name | Role | Notes |
|------|------|-------|
| Squad | Coordinator | Routes work, enforces handoffs and reviewer gates. |

## Members

| Name | Role | Charter | Status |
|------|------|---------|--------|
| Mikey | Lead | `.squad/agents/mikey/charter.md` | ✅ Active |
| Stef | Frontend Dev | `.squad/agents/stef/charter.md` | ✅ Active |
| Data | Backend Dev | `.squad/agents/data/charter.md` | ✅ Active |
| Chunk | Tester | `.squad/agents/chunk/charter.md` | ✅ Active |
| Brand | Platform Dev | `.squad/agents/brand/charter.md` | ✅ Active |
| Scribe | Session Logger | `.squad/agents/scribe/charter.md` | 📋 Silent |
| Ralph | Work Monitor | — | 🔄 Monitor |

## Coding Agent

<!-- copilot-auto-assign: true -->

| Name | Role | Charter | Status |
|------|------|---------|--------|
| @copilot | Coding Agent | — | 🤖 Coding Agent |

Instructions live in `.github/copilot-instructions.md`.

### Capabilities

**🟢 Good fit — auto-route when enabled:**
- Bug fixes with clear reproduction steps
- Test coverage (adding missing tests, fixing flaky tests)
- Lint/format fixes and code style cleanup
- Dependency updates and version bumps
- Small isolated features with clear specs
- Boilerplate/scaffolding generation
- Documentation fixes and README updates

**🟡 Needs review — route to @copilot but flag for squad member PR review:**
- Medium features with clear specs and acceptance criteria
- Refactoring with existing test coverage
- API endpoint additions following established patterns
- Migration scripts with well-defined schemas

**🔴 Not suitable — route to squad member instead:**
- Architecture decisions and system design
- Multi-system integration requiring coordination
- Ambiguous requirements needing clarification
- Security-critical changes (auth, encryption, access control)
- Performance-critical paths requiring benchmarking
- Changes requiring cross-team discussion

## Project Context

- **Owner:** FFMikha
- **Project:** dnd-notes
- **Stack:** React, Material UI, Node.js
- **Description:** A D&D note-taking app for capturing campaign notes, characters, locations, and session details.
- **Created:** 2026-04-11T19:00:21.594Z

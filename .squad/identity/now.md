# Current Focus

- **Updated:** 2026-04-26T15:41:07Z
- **Active slice:** Epic #82 kickoff readiness — full local k3d deployment and agent-friendly dev loop for the platform.
- **Execution status:** Mikey cleared #82 to start with no blockers. Brand removed stale issue worktrees, leaving the main checkout clean for the next issue-specific worktree.
- **Primary next slice:** When implementation starts, create the dedicated `squad/82-*` worktree and begin with the orchestration core (`k3d:up` / `down` / `status` plus persistent state and JSON output).
- **Parallel tracks:** Brand owns local-platform orchestration and override scripts, Stef joins once portal containerization/UI wiring starts, Chunk prepares validation around the new k3d flows, and Scribe records the kickoff decisions.
- **QA gates:** Keep the first slice thin and idempotent, preserve existing #42/#79 flows, and avoid coupling portal containerization to the orchestration command before the contract is clear.
- **Forward-looking note:** Operator and customer portals should end up both containerized for the persistent lane and each gain a local override flow that mirrors `tenant-api-override.sh`.

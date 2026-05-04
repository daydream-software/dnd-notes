# Repository Guidelines

This repository is a full-stack D&D note-taking application managed as an npm workspace. It uses a Squad-based AI team framework for collaborative development.

## Project Structure & Module Organization

The project is organized into a monorepo using npm workspaces:

- **`apps/`**: Contains the main applications.
  - `./apps/api`: Express + TypeScript API with Postgres persistence.
  - `./apps/web`: React + Vite + Material UI frontend.
  - `./apps/control-plane`: Service for tenant registry and provisioning.
- **`packages/`**: Shared libraries used across workspaces (e.g., `./packages/portal-utils`).
- **`platform/`**: Infrastructure and platform-specific logic, including k3d configurations and Keycloak JWT handling.
- **`scripts/`**: Automation scripts for CI/CD, k3d management, and development tasks.

Local development environment is standardized on **k3d** for Kubernetes orchestration and **Postgres** for data persistence.

## Build, Test, and Development Commands

Commands should be run from the repository root:

- **Dev Mode**: `npm run dev` (starts API and Web simultaneously).
- **API Dev**: `npm run dev:api`.
- **Web Dev**: `npm run dev:web`.
- **Build All**: `npm run build`.
- **Lint All**: `npm run lint`.
- **Test All**: `npm run test`.
- **K3d Setup**: `npm run k3d:up` (bootstraps cluster, builds images, and provisions dev tenant).
- **K3d Health**: `npm run k3d:status`.
- **K3d Teardown**: `npm run k3d:down`.
- **Seed Data**: `npm run seed:data` (populates the tenant database).

## Coding Style & Naming Conventions

- **TypeScript**: Enforced strict mode (`strict: true`).
- **Commits**: Must follow **Conventional Commits**. All commits MUST be signed (`git commit -S`). Include issue references (e.g., `feat(api): add route #123`).
- **Branches**: Follow the squad convention: `squad/{issue-number}-{kebab-case-slug}`.
- **Formatting**: ESLint is used across all workspaces (`npm run lint`).

## Testing Guidelines

- **API**: Uses the native Node.js test runner (`node --test`). Tests are located in `./apps/api/test/*.test.ts`.
- **Web**: Uses **Vitest**. Tests are located alongside components.
- **CI**: Run `npm run test:ci` for full coverage and JUnit reports.

## Agent Instructions (Squad Framework)

As a Coding Agent, follow these rules:

1. **Capability Self-Check**: Before starting, verify the task matches your profile in `./.squad/team.md`. Refuse architecture or security-critical tasks.
2. **Planning Persistence**: 
   - Maintain a session `plan.md` for multi-file tasks.
   - Record progress in `./.squad/agents/copilot/history.md`.
   - Log significant decisions in `./.squad/decisions/inbox/copilot-{slug}.md`.
3. **Work Routing**: Respect domain boundaries defined in `./.squad/routing.md` (e.g., Data for API, Stef for UI).
4. **Handoffs**: Always use Conventional Commits and reference issues to maintain a durable audit trail for the squad.

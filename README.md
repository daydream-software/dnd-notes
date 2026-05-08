# D&D Notes

A full-stack note-taking application for tabletop RPG campaigns. Organize notes by campaign and session, collaborate with players through share links, and keep your world-building in one place.

Built as an npm monorepo with a React + Material UI frontend, an Express + TypeScript API backed by Postgres, and a control plane for tenant provisioning.

## Prerequisites

- Node.js 22 (use `nvm use` to pick up the pinned version from `.nvmrc`)
- Docker (required only for the k3d platform loop)
- k3d (required only for the k3d platform loop)

## Quick start

Local development runs the web app and API directly without Kubernetes.

```bash
nvm use
npm install
npm run seed:data
npm run dev
```

- Web: <http://localhost:5173>
- API: <http://localhost:3001>

`seed:data` loads sample campaigns and notes into a local Postgres database. Copy `apps/api/.env.example` to `apps/api/.env` and set `DATABASE_URL` before running.

Auth defaults to local mode (username/password). Set `AUTH_MODE=keycloak` in `apps/api/.env` and configure the Keycloak environment variables to use an external identity provider.

## k3d platform loop

For contributors working on platform or infrastructure, the full stack runs inside a local Kubernetes cluster via k3d.

```bash
npm run k3d:up       # bootstrap cluster, build and import images, provision dev tenant
npm run k3d:status   # check cluster and tenant health
npm run k3d:down     # tear down cluster and clean up state
```

`k3d:up` accepts `--no-rebuild` to skip image builds when tags already exist, and `--json` for machine-readable output. `k3d:status` also supports `--json`.

See `platform/k3d/README.md` for the full workflow.

## Workspace layout

| Workspace | Description |
|---|---|
| `apps/api` | Express + TypeScript API, Postgres persistence |
| `apps/web` | React + Vite + Material UI notes workspace |
| `apps/control-plane` | Tenant registry and provisioning orchestration |
| `apps/operator-portal` | Operator-facing management UI |
| `apps/customer-portal` | Customer-facing portal |
| `packages/theme` | Shared MUI theme consumed by all frontend apps |

## Testing

```bash
npm run test:api
npm run test:web
npm run test:control-plane
npm run test:operator-portal
npm run test:customer-portal
```

Run `npm test` to execute all suites in sequence.

## Linting

```bash
npm run lint
```

Runs ESLint across all workspaces. TypeScript strict mode is enforced.

## License

FSL-1.1-MIT. The source is available and free to use for non-competing purposes. Competing use (building a substantially similar product or service) requires a commercial license from the maintainers. Each release converts to MIT two years after its publication date.

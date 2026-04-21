# dnd-notes

A full-stack D&D notes MVP built as an npm workspace with a React + Material UI frontend and a TypeScript API that targets Postgres in hosted environments while keeping SQLite as the local fallback. Containerized for Kubernetes deployment with same-origin web + API serving.

## Getting started

### Local development

```bash
nvm use
npm install
npm run seed:data
npm run dev
```

Use Node.js `v22.21.1` for local development. The repo pins that version in
`.nvmrc`, and CI uses the same runtime.

- **Web:** `http://localhost:5173`
- **API:** `http://localhost:3001`

### Container deployment

Build and run the production container:

```bash
docker build -t dnd-notes:latest .
docker run -p 3000:3000 \
  -e SERVE_WEB=true \
  -e PUBLIC_WEB_URL=http://localhost:3000 \
  -v $(pwd)/data:/app/data \
  dnd-notes:latest
```

The container serves both web and API on the same origin at port 3000.

For detailed runtime configuration, health endpoints, and Kubernetes deployment guidance, see [RUNTIME.md](./RUNTIME.md).

## Scripts

- `npm run dev` starts both workspaces together
- `npm run build` builds the web app and syntax-checks the API
- `npm run lint` runs ESLint in both workspaces
- `npm run test` runs the web and API tests
- `npm run platform:validate` renders the committed control-plane Kustomize overlays
- `npm run k3d:build-control-plane-image` builds/imports the control-plane image into k3d
- `npm run copilot:yolo` launches the local Copilot Squad image wrapper
- `npm run copilot:wait-review -- --pr 123` waits for Copilot review on a PR and exits with `0` (clear), `10` (review finished but work remains), `124` (timeout), or `1` (error). It prefers `gh` when available and otherwise uses `GH_TOKEN` / `GITHUB_TOKEN`.
- `.github/workflows/copilot-pr-review.yml` uses the `COPILOT_ASSIGN_TOKEN` Actions secret so Copilot reviewer requests come from a real user token and fail loudly if the reviewer was not actually attached.

## Git hooks

`npm install` now provisions Husky git hooks automatically via the root
`prepare` script when the repo checkout is present and the Husky package is
installed. Production installs and container builds skip that hook bootstrap
cleanly. Commits are checked with commitlint, so commit messages must follow
the Conventional Commits format (for example `feat(api): harden CORS policy` or
`chore: update hook tooling`).

## Workspace layout

- `apps/web` — React + Vite + Material UI notes workspace
- `apps/api` — Express + TypeScript API with SQLite persistence
- `apps/control-plane` — Express + TypeScript control plane for tenant registry and provisioning orchestration

## Control-plane provisioning

Copy `apps/control-plane/.env.example` to `apps/control-plane/.env` when you want
to run the control plane locally.

For issue `#54` and related platform work, **k3d is the standard dev
environment**. The control plane keeps provisioning disabled by default; enable it
only when you have a live kube context plus an admin Postgres connection string:

- `CONTROL_PLANE_ENABLE_PROVISIONING=true`
- `TENANT_BASE_DOMAIN` — opaque tenant subdomains are created under this suffix
- `TENANT_IMAGE_REPOSITORY` — image repository used for tenant deployments
- `TENANT_DATABASE_ADMIN_URL` — admin Postgres URL used to create/drop per-tenant databases
- `TENANT_DATABASE_RUNTIME_URL` — optional runtime Postgres URL injected into tenant pods; defaults to the admin URL when unset
- `TENANT_IMAGE_PULL_SECRET` — optional imagePullSecret name for private images

When provisioning is enabled, the control plane reconciles a tenant namespace,
runtime ConfigMap/Secret, PVC, Service, Deployment, and a per-tenant Postgres
database. The tenant workload uses `/ready` for readiness and `/healthz` for
liveness, and the PVC stays mounted at `/app/data` for explicit tenant storage
lifecycle plus SQLite-compatible fallback files.

Postgres-backed tenant upgrades reuse `POST /internal/tenants/:tenantId/provision`
with a version override. The generated tenant Deployment now makes the first
rolling-update contract explicit (`RollingUpdate`, `maxSurge: 1`,
`maxUnavailable: 0`, `minReadySeconds: 5`), while the tenant runtime drains
HTTP traffic and Postgres connections on `SIGTERM`. See
[`apps/control-plane/README.md`](apps/control-plane/README.md) and
[`RUNTIME.md`](RUNTIME.md) for the operator choreography and connection-budget
notes.

## k3d platform loop

Issue `#63` formalizes the daily local Kubernetes lane for platform work.

```bash
npm run k3d:bootstrap
npm run k3d:smoke
```

- `k3d:bootstrap` creates the local cluster shape and deploys ingress-nginx,
  platform Postgres, and seeded Keycloak.
- `k3d:smoke` builds/imports the tenant image, runs the control plane locally
  against the live k3d kube context, provisions a tenant, and verifies tenant
  readiness.

Issue `#43` also commits the in-cluster control-plane packaging lane without
changing that fast smoke path:

```bash
npm run k3d:build-control-plane-image
kubectl apply -k platform/control-plane/overlays/k3d
```

See [`platform/k3d/README.md`](platform/k3d/README.md) for the full workflow and
the documented boundary between the fast k3d lane and the later k3s/stateful
rehearsal lane, plus
[`platform/control-plane/README.md`](platform/control-plane/README.md) for the
committed control-plane image + manifest set.

## Local persistence

Copy `apps/api/.env.example` to `apps/api/.env` when you want a checked-in
starting point for API configuration.

By default, local development still stores notes in a SQLite database at:

```text
apps/api/data/dnd-notes.sqlite
```

Set `DATABASE_URL` when you want the API to use Postgres instead. If `DATABASE_URL`
is unset, the API falls back to SQLite automatically.

You can override the SQLite path with `NOTES_DB_PATH`, and you can also set `PORT`
there for the API listener. When you set `NOTES_DB_PATH` in `apps/api/.env`, use
paths relative to `apps/api` (for example `data/dnd-notes.sqlite`).

Optional Postgres pool tuning env vars:

- `NOTES_DB_POOL_MIN` (default `0`)
- `NOTES_DB_POOL_MAX` (default `20`)
- `NOTES_DB_IDLE_TIMEOUT_MS` (default `30000`)
- `NOTES_DB_CONNECTION_TIMEOUT_MS` (default `10000`)
- `NOTES_DB_STATEMENT_TIMEOUT_MS` (default `30000`)

Set `PUBLIC_WEB_URL` to the canonical public web origin that should own app and
share-link URLs in production (for example `https://notes.example.com`). The API
uses that value when it returns owner-facing shared-link URLs so production links
do not depend on request headers or reverse-proxy host detection. This repo now
assumes a same-origin production model by default; only introduce split web/API
origins when you intentionally want that deployment shape.

Set `ALLOWED_ORIGINS` to a comma-separated list of origins that can access the API
via CORS (for example `http://localhost:5173,http://localhost:3000`). Defaults to
`http://localhost:5173,http://localhost:3000` for local development. Requests with
no origin header (mobile apps, curl, Postman) are always allowed. This explicit
allowlist replaces the previous permissive CORS configuration and is appropriate
for production deployments where the web app and API may be served from different
origins. For same-origin deployments (recommended), both the web app and API should
share the same domain via reverse proxy, so CORS is primarily relevant during local
development.

You can bootstrap global site-admin access with `SITE_ADMIN_EMAILS`, using a
comma-separated list of owner-account emails. Matching accounts are promoted to
site admin on registration and again on API startup so the future global admin
panel has a stable access model.

When the local database is from an older schema, the API upgrades compatible note
attribution columns in place during startup so existing note data keeps loading.

To load the starter notes into an empty local database:

```bash
npm run seed:data
```

To replace whatever is currently in the local database with the starter notes:

```bash
npm run reset:data
```

Both commands use the active database backend. With SQLite they honor
`NOTES_DB_PATH`; with Postgres they honor `DATABASE_URL`.

### SQLite → Postgres migration

For an existing SQLite tenant:

1. Download a fresh admin backup (`GET /api/admin/backup`) while the app still runs on SQLite.
2. Start the API with `DATABASE_URL` pointed at the target Postgres database.
3. Restore that backup through the admin restore flow (`POST /api/admin/restore` or the site-admin UI).

The backup format stays SQLite-compatible, so the same snapshot can seed a fresh
Postgres database. Direct admin backup downloads remain `.sqlite` snapshots.

## Current note model

- every note belongs to a campaign
- real accounts authenticate before using campaign, overview, and note endpoints
- guests join a shared campaign with a campaign-scoped display name and guest token
- notes can optionally reference a session by name
- the editable fields are `title`, `body`, `tags`, `status`, and `sessionName`
- owners can optionally start a new campaign or note from built-in starter templates
- note timestamps are managed by the API as `createdAt` and `updatedAt`

## API

- `GET /health`
- `GET /api/admin/accounts`
- `GET /api/admin/overview`
- `GET /api/admin/backup`
- `POST /api/admin/restore`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/session`
- `POST /api/auth/logout`
- `GET /api/campaigns`
- `POST /api/campaigns`
- `GET /api/campaigns/:campaignId`
- `PUT /api/campaigns/:campaignId`
- `GET /api/campaigns/:campaignId/memberships`
- `POST /api/campaigns/:campaignId/memberships/consolidations`
- `GET /api/campaigns/:campaignId/share-links`
- `POST /api/campaigns/:campaignId/share-links`
- `GET /api/campaigns/:campaignId/share-links/:shareLinkId`
- `DELETE /api/campaigns/:campaignId/share-links/:shareLinkId`
- `GET /api/overview`
- `GET /api/notes`
- `GET /api/notes/activity`
- `GET /api/notes/:noteId`
- `POST /api/notes`
- `PUT /api/notes/:noteId`
- `DELETE /api/notes/:noteId`
- `GET /api/notes/sessions`
- `GET /api/notes/sessions/:sessionId`
- `GET /api/shared/:shareToken/session`
- `POST /api/shared/:shareToken/join`
- `POST /api/shared/:shareToken/membership/claim`
- `GET /api/shared/:shareToken/overview`
- `GET /api/shared/:shareToken/notes`
- `POST /api/shared/:shareToken/notes`
- `PUT /api/shared/:shareToken/notes/:noteId`
- `DELETE /api/shared/:shareToken/notes/:noteId`

All `/api/campaigns`, `/api/overview`, and `/api/notes` routes require an
`Authorization: Bearer <token>` header from the real-account auth endpoints.
Any linked campaign membership can open the authenticated workspace, while
campaign management routes such as settings, memberships, and share links stay
owner-only.

## API Security

The API implements several security hardening measures:

- **CORS Policy:** Enforces an explicit origin allowlist via `ALLOWED_ORIGINS`. Only
  origins in the allowlist can access the API from browsers. Requests without an
  origin header (server-to-server, mobile apps, CLI tools) are always allowed.
  
- **Security Headers:** All API responses include:
  - `X-Content-Type-Options: nosniff` — prevents MIME type sniffing
  - `X-Frame-Options: DENY` — prevents clickjacking on API routes
  - `X-XSS-Protection: 1; mode=block` — legacy XSS protection
  - `Referrer-Policy: strict-origin-when-cross-origin` — restricts referrer leakage
  
- **Share Link Frame Policy:** Shared campaign routes (`/api/shared/:shareToken/*`)
  override the default `X-Frame-Options: DENY` with per-link `Content-Security-Policy`
  `frame-ancestors` directives. Campaign owners specify which origins can embed their
  shared campaigns (e.g., `'self' https://app.roll20.net`), enabling controlled
  embedding while maintaining clickjacking protection everywhere else.

- **Authentication:** Owner routes use Bearer tokens in `Authorization` headers. Guest
  routes use guest tokens in `X-Guest-Token` headers. No cookies are used for auth.

`GET /api/admin/accounts`, `GET /api/admin/overview`, `GET /api/admin/backup`,
and `POST /api/admin/restore` are site-admin-only. `/api/admin/accounts`
returns the real-account directory plus current site-admin assignments.
`/api/admin/overview` returns aggregate account, campaign, membership,
share-link, and note counts for the admin surface. `/api/admin/backup`
returns a SQLite snapshot as a downloadable attachment for operational backup
workflows. `POST /api/admin/restore` accepts a raw SQLite upload
(`application/octet-stream`) and replaces the live database after validating
that the snapshot looks like a restorable dnd-notes database.

For restore operations, use the site-admin panel upload flow and keep a freshly
downloaded backup nearby. A successful restore may invalidate the current owner
session if the restored snapshot contains different session rows, so the UI may
require signing in again immediately afterward.

## Backup and restore runbook

Use this runbook whenever you need to capture a backup, rehearse recovery, or
replace the live SQLite database with a known-good snapshot.

### Minimum operating expectations

- do not overwrite your only known-good snapshot;
- keep at least three rotating backups in durable storage, including the most
  recent known-good snapshot;
- take a fresh live backup immediately before any restore and retain that
  pre-restore snapshot until post-restore validation passes and users confirm
  the system is healthy;
- label snapshots with when they were taken and why they exist (routine backup,
  pre-maintenance backup, rehearsal fixture, incident recovery, and so on);
- treat restore as an operator action: ask active users to stop editing before
  you replace the database, because connected clients are not yet placed into a
  maintenance mode automatically.

### Backup procedure

1. Sign in as a site admin and open the Site admin panel.
2. Download a fresh backup using **Download backup** (aria label:
   **Download SQLite backup**) before any risky maintenance or before starting
   a restore.
3. Store the snapshot somewhere durable outside the running app directory.
4. Confirm the file is non-empty and keep the timestamp/provenance with it.

### Restore preparation checklist

Before uploading a snapshot to `POST /api/admin/restore` through the Site admin
panel using **Restore backup**, confirm all of the following:

1. You know why this snapshot is the correct recovery point.
2. You already downloaded a fresh backup of the current live instance.
3. Active collaborators have been told to stop editing until validation is done.
4. You have site-admin credentials ready in case the current session is
   invalidated by the restore.

### Restore procedure

1. Open the Site admin panel restore flow.
2. Select the SQLite snapshot you intend to restore.
3. Complete the required confirmation and start the restore.
4. Wait for the app to finish replacing the live database.
5. If the UI signs you out afterward, sign in again as a site admin before
   continuing validation.

### Post-restore validation

Run these checks immediately after a restore:

1. Confirm the app responds normally (for example, load the main app and
   confirm `GET /health` still succeeds if you have direct API access).
2. Sign in as a site admin and open the admin overview.
3. Check that high-level counts look plausible for the restored snapshot
   (accounts, campaigns, memberships, share links, notes).
4. Open at least one representative campaign and verify that notes load.
5. Verify one expected recent/shared workflow still works for the restored
   data set, such as loading a shared campaign or browsing a known
   notes/campaign session from the session-browsing workflow.
6. Keep the pre-restore live backup until the restored instance is accepted as
   healthy.

### Restore rehearsal checklist

Use this checklist for each non-production rehearsal:

1. Capture a fresh backup from the rehearsal source instance and store it with
   timestamp + purpose metadata.
2. Run the **Restore preparation checklist** above before you upload the
   rehearsal snapshot.
3. Perform the **Restore procedure** end to end.
4. Complete every step in **Post-restore validation** and record pass/fail for
   each check.
5. Record rehearsal timing (start/end/duration), who ran it, and any follow-up
   actions.
6. If any check fails, keep the pre-restore backup, investigate the gap, and
   update this runbook before the next rehearsal.

### Rehearsal expectations

- rehearse the backup + restore flow on a non-production copy before you need
  it for a real incident;
- repeat rehearsals at least quarterly, after meaningful backup/restore
  changes, and before first production rollout on a new hosting setup;
- treat rehearsal results as operational evidence: keep logs/screenshots of the
  restore flow plus your validation records.

`POST /api/campaigns/:campaignId/memberships/consolidations` is also owner-only.
Send `sourceMembershipId` and `targetMembershipId` to preview the note-attribution
move first, then repeat the request with `confirm: true` to apply it. The response
returns affected authored/edited note counts plus warnings, and role-changing
consolidations require `confirmRoleMismatch: true`. This backend slice only
reassigns note attribution; it does not delete notes or merge membership auth state.

`GET /api/overview` and `GET /api/notes` accept an optional `campaignId` query
parameter to scope the response to a specific linked campaign. `POST /api/notes`
accepts an optional `campaignId` in the payload and defaults to the signed-in
account's primary accessible campaign when one is not provided. The session
browsing and recent-activity routes use that same authenticated access model:
`GET /api/notes/sessions?campaignId=...` returns `{ sessions: [{ sessionName, noteCount }] }`
and `GET /api/notes/sessions/:sessionId?campaignId=...` returns the notes for that
session. `GET /api/notes/activity?campaignId=...&membershipId=...&limit=20`
returns a thin recent-activity feed plus collaborator summaries so the main app
can answer “what changed recently?” without becoming a full audit log.
Frontends should build `:sessionId` with `encodeURIComponent(sessionName)` and
can use these endpoints for any linked collaborator, not just campaign owners.

The `/api/shared/:shareToken/*` routes use `X-Guest-Token: <token>` after a
guest joins the shared campaign. Share links are campaign-scoped, support
viewer/editor access levels, and can carry owner-configured `frame-ancestors`
policy for the dedicated `/share/:shareToken` web route. Owner share-link list
responses stay metadata-only; raw `{ token, url }` values come back on creation
and from the owner-only reveal endpoint for that specific share link. Legacy
links created before reveal support return an explicit regeneration-needed
error because only their token hash was stored. Guests can also create or sign
in to a real account from the shared route and claim their existing membership
with that same browser-held guest token. Claiming rotates that guest token, so
the same browser keeps working with the replacement token while the old
anonymous token stops authenticating shared routes. Membership-based note
attribution therefore keeps the same history instead of migrating to a new
actor.

## What works now

- notes persist across API restarts
- owners can register, sign in, and resume an existing session
- owners can create campaigns, edit campaign settings, view memberships, and manage shared links
- owners can optionally seed a new campaign with starter notes for NPCs, factions, locations, and sessions
- guests can open a shared campaign route, choose a display name, and re-enter with the saved guest token
- guests can link an existing shared membership to a real account without changing prior note attribution
- linked real accounts can open that claimed campaign in the authenticated app flow without reopening anonymous access
- only the `/share/:shareToken` route is intended for embedding; the main app stays denied by default in the web server layer
- the web app can create, edit, view, and delete notes inside the selected campaign, including built-in note templates for common structures
- the authenticated note workspace keeps desktop browse/edit speed while switching to a single-pane browse-or-edit flow on smaller screens
- shared links can expose the same notes workspace to guests with viewer or editor permissions
- authenticated collaborators can switch between the flat note list and a session-focused browsing mode to answer "what happened in this session?"
- authenticated collaborators can browse campaign tags with local facet counts, keep a visible single-tag filter, and reuse those tags through note-editor autocomplete without extra API calls
- authenticated collaborators can open a recent activity view in the main workspace and optionally narrow it by collaborator

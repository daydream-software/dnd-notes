# dnd-notes

A full-stack D&D notes MVP built as an npm workspace with a React + Material UI frontend and a TypeScript + SQLite API.

## Getting started

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

## Scripts

- `npm run dev` starts both workspaces together
- `npm run build` builds the web app and syntax-checks the API
- `npm run lint` runs ESLint in both workspaces
- `npm run test` runs the web and API tests

## Workspace layout

- `apps/web` — React + Vite + Material UI notes workspace
- `apps/api` — Express + TypeScript API with SQLite persistence

## Local persistence

The API stores notes in a local SQLite database at:

```text
apps/api/data/dnd-notes.sqlite
```

You can override that path with `NOTES_DB_PATH`.

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

Both commands use `NOTES_DB_PATH` when it is set, so you can seed or reset an alternate database file without changing code.

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
- `GET /api/admin/overview`
- `GET /api/admin/backup`
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

`GET /api/admin/overview` and `GET /api/admin/backup` are site-admin-only.
`/api/admin/overview` returns aggregate account, campaign, membership, share-link,
and note counts for the admin surface. `/api/admin/backup` returns a SQLite
snapshot as a downloadable attachment for operational backup workflows.

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

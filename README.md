# dnd-notes

A full-stack D&D notes MVP built as an npm workspace with a React + Material UI frontend and a TypeScript + SQLite API.

## Getting started

```bash
npm install
npm run seed:data
npm run dev
```

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
- note timestamps are managed by the API as `createdAt` and `updatedAt`

## API

- `GET /health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/session`
- `POST /api/auth/logout`
- `GET /api/campaigns`
- `POST /api/campaigns`
- `GET /api/campaigns/:campaignId`
- `PUT /api/campaigns/:campaignId`
- `GET /api/campaigns/:campaignId/memberships`
- `GET /api/campaigns/:campaignId/share-links`
- `POST /api/campaigns/:campaignId/share-links`
- `GET /api/campaigns/:campaignId/share-links/:shareLinkId`
- `DELETE /api/campaigns/:campaignId/share-links/:shareLinkId`
- `GET /api/overview`
- `GET /api/notes`
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

`GET /api/overview` and `GET /api/notes` accept an optional `campaignId` query
parameter to scope the response to a specific linked campaign. `POST /api/notes`
accepts an optional `campaignId` in the payload and defaults to the signed-in
account's primary accessible campaign when one is not provided.

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
- guests can open a shared campaign route, choose a display name, and re-enter with the saved guest token
- guests can link an existing shared membership to a real account without changing prior note attribution
- linked real accounts can open that claimed campaign in the authenticated app flow without reopening anonymous access
- only the `/share/:shareToken` route is intended for embedding; the main app stays denied by default in the web server layer
- the web app can create, edit, view, and delete notes inside the selected campaign
- shared links can expose the same notes workspace to guests with viewer or editor permissions
- owners can browse notes grouped by session and discover "what happened in this session?" through session browsing endpoints

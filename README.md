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
- owners authenticate before using campaign, overview, and note endpoints
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
- `GET /api/overview`
- `GET /api/notes`
- `GET /api/notes/:noteId`
- `POST /api/notes`
- `PUT /api/notes/:noteId`
- `DELETE /api/notes/:noteId`

All `/api/campaigns`, `/api/overview`, and `/api/notes` routes require an
`Authorization: Bearer <token>` header from the owner auth endpoints.

`GET /api/overview` and `GET /api/notes` accept an optional `campaignId` query
parameter to scope the response to a specific owned campaign. `POST /api/notes`
accepts an optional `campaignId` in the payload and defaults to the owner's
primary campaign when one is not provided.

## What works now

- notes persist across API restarts
- owners can register, sign in, and resume an existing session
- owners can create campaigns, edit campaign settings, and view memberships
- the web app can create, edit, view, and delete notes inside the selected campaign
- the notes workspace uses the real API instead of static placeholder content

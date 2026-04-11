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

## MVP note model

The first real note contract is intentionally small:

- every note belongs to the single MVP campaign, `moonshae-ledger`
- notes can optionally reference a session by name
- the editable fields are `title`, `body`, `tags`, `status`, and `sessionName`
- note timestamps are managed by the API as `createdAt` and `updatedAt`

## API

- `GET /health`
- `GET /api/overview`
- `GET /api/notes`
- `GET /api/notes/:noteId`
- `POST /api/notes`
- `PUT /api/notes/:noteId`
- `DELETE /api/notes/:noteId`

## What works now

- notes persist across API restarts
- the web app can create, edit, view, and delete notes
- the notes workspace uses the real API instead of static placeholder content

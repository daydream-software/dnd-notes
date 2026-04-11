# dnd-notes

A full-stack starter for a D&D note-taking app, built as an npm workspace with a React + Material UI frontend and a small Node API.

## Getting started

```bash
npm install
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

- `apps/web` — React + Vite + Material UI dashboard shell
- `apps/api` — Express API with starter campaign and note data

## Starter API

- `GET /health`
- `GET /api/overview`
- `GET /api/notes`
- `GET /api/notes/:noteId`

## Next building blocks

The starter already wires a dashboard to live API data. Good next features are structured note editors, persistence, auth, and campaign-level filtering.

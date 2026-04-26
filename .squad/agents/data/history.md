# Project Context

- **Owner:** FFMikha
- **Project:** dnd-notes
- **Description:** A D&D note-taking app for capturing campaign notes, characters, locations, and session details.
- **Stack:** React, Material UI, Node.js
- **Created:** 2026-04-11T19:00:21.594Z

## Core Context (Summarized 2026-04-26T15:45:50Z)

Data is the Backend Dev responsible for control-plane, tenant orchestration, database migrations, authentication seams, and multi-tenant infrastructure. Primary domains: schema design, provisioning contracts, per-tenant credential management, Postgres adapter patterns, migration framework orchestration.

**Foundation Work (2026-04-11 to 2026-04-15):**
- Established SQLite note schema (campaign/membership/session/note tables)
- Issue #23: Membership consolidation backend (preview/apply on note attribution)
- Issue #27: Session-browsing backend with auth fixes for collaborators
- Issue #30: Note-to-note links backend (20-link limit, JSON storage, backlinks endpoint)
- Issue #33: Recent-activity read contract (campaign-scoped, latest-state only, no audit)

**Database & Platform (2026-04-15 to 2026-04-22):**
- Issue #58: Note-store async adapter supporting SQLite (dev default) and Postgres (via DATABASE_URL)
- Issue #42: Control-plane REST layer for tenant create/state transitions with rollout guardrails
- Issue #68: Tenant contract with optional initialAdminEmail metadata
- Issue #69: Per-tenant Postgres credentials (dedicated roles, tenant-scoped DATABASE_URL, safe deprovision)
- Issue #56: Auth-provider abstraction boundaries (owner_accounts.keycloak_sub, AuthenticatedUser contract)

**Recent PR Work (2026-04-22 to 2026-04-26):**
- PR #107: Tenant advisory-lock session management (checked-out client reuse, bounded retries)
- PR #108: Centralized control-plane error logging (Bash-3.2 compat, ad-hoc handler consolidation)
- Issue #97: Control-plane Postgres migration (async registry, PVC removal, multi-agent coordination)
- Epic #87: Backend validation (control endpoints, backup/restore catalog, note-store split, migration framework)

**Cross-Team Patterns:**
- Share-link metadata-only listing with owner-only reveal API
- Membership guest-token rotation on consolidation
- Session/note queries behind resolveAccessibleCampaign() for collaborator access
- Tenant Deployment single-replica RollingUpdate with drain-first (maxSurge:0, maxUnavailable:1)

## Recent Updates





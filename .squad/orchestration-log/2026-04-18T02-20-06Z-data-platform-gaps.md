# Orchestration Log: Data Platform Gaps Analysis

**Agent:** Data (Backend Dev)  
**Task:** Backend/auth/persistence gap analysis for #42 platform direction  
**Date:** 2026-04-18T02:20:06Z  
**Status:** Complete

## Work Done

Backend and data safety risk assessment for multi-tenant Kubernetes platform. Identified 12 unresolved design questions in control-plane data model, tenant boundary contract, SQLite safety, auth migration, versioning, and backup/restore semantics.

## Key Outcomes

**7 blocking risks** (must resolve Phase 0–2):
1. Control-plane state machine incompleteness
2. Tenant ↔ control-plane API contract undefined
3. SQLite safety on K8s unvalidated (WAL, overlapping pods, restore coordination)
4. Auth migration path breaks backward compatibility
5. N/N-1 version-skew compatibility undefined
6. Backup/restore semantics and failure modes undefined
7. Local auth → OIDC migration blocks backward compat

**5 later concerns** (operational maturity, post-MVP):
- Fleet observability and alerting
- Upgrade orchestration sophistication (canary, blue-green, auto-rollback)
- Billing and multi-instance accounting
- Self-hosted / on-prem support
- Keycloak HA and failover

## Critical Dependencies

- Issue #39 (WAL): Must complete before #54 (provisioning)
- Issue #40 (restore protection): Prerequisite for safe multi-tenant restore
- Issue #53 (control plane): Must formalize state machine, audit trail, versioning, bootstrap contract
- Issue #55 (rollout): Must define single-writer rules, pod lifecycle, restore handoff, overlapping-pod prevention
- Issue #56 (OIDC): Must draft AuthAdapter interface, migration strategy, bootstrap flow

## Decision Points for Mikey

1. Auth migration: Force Keycloak or support both email/password + OIDC during transition?
2. Versioning scheme: Semver + schema version tracking, or Git SHA + auto-compatibility?
3. Backup ownership: Control plane manages all (centralized), or tenant app self-manages (isolated)?
4. Keycloak timing: Required for Phase 2 (#56), or defer to Phase 3 if mock OIDC works?

## Next Steps

Mikey should review with FFMikha, clarify decision points, incorporate resolved gaps into Phase 0–2 issue descriptions.

## Related Issues

#39 (WAL), #40 (restore), #42 (epic), #53 (control plane), #54 (provisioning), #55 (rollout), #56 (OIDC), #57 (fleet status)

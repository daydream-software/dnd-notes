# Epic #42 Clarification Review — Orchestration Log

**Date:** 2026-04-18  
**Participants:** Mikey (Lead), Data, Brand  
**Status:** Discussion inputs staged; awaiting user acceptance  

---

## Summary

Three independent reviews of the 9 clarification points in GitHub epic #42 were conducted in parallel:

1. **Mikey (Lead):** Grouped all 9 points into Phase 0 blockers, Phase 1 decisions, and post-Phase-1 deferrals. Recommended a practical decision sequence.
2. **Data (Backend):** Assessed persistence, control-plane contract, state machine, auth migration, and versioning from backend/schema perspective.
3. **Brand (Platform):** Evaluated k3d dev loop, ingress/DNS/TLS, CI scope, and operational readiness from infrastructure perspective.

---

## Key Findings

**3 Phase 0 blockers identified (must decide this week):**
- Local k3d/k3s dev loop + parity definition
- CI coverage scope (container build + push + API tests + manifest lint)
- Phase 1 ingress/wildcard DNS/TLS light spec (not implementation, just architecture shape)

**4 Phase 1 critical decisions (resolve 1 week before Phase 1 kickoff):**
- Control-plane ↔ tenant API contract + internal APIs
- Control-plane state machine + tenant lifecycle states
- Backup/restore strategy (scope: snapshots vs. WAL archiving)
- Version-skew policy (N / N-1 compat or coordinated upgrades only)

**2 Phase 2+ deferrals (explicitly defer):**
- Auth migration path (OIDC/Keycloak cutover + coexistence)
- Local Keycloak dev setup (Docker Compose + realm import)

---

## Proposed Decision Rhythm

- **Today (2026-04-18):** Mikey + FFMikha review; sync with Brand, Data on Tier 1 (30 min, 3 yes/no questions)
- **Before #52 starts:** Brand publishes k3d setup doc (rough) in README
- **2026-04-25 (Phase 1 planning):** Revisit Tier 2 with full team
- **2026-04-30 (Phase 2 planning):** Revisit Tier 3 with FFMikha + Data

---

## Artifacts Created

All three review documents staged in `.squad/decisions/inbox/`:
- `mikey-42-clarification-review.md` — decision sequence + practical grouping
- `data-42-clarification-review.md` — backend impact assessment
- `brand-42-clarification-review.md` — platform/infra impact assessment

**Awaiting user acceptance before merging into `.squad/decisions.md`.**

---

## Next Step

User reviews these three inputs and confirms the proposed phase grouping and decision rhythm.

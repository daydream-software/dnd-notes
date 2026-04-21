# Auth/API Hardening Implementation Slice Kickoff

**Timestamp:** 2026-04-16T16:11:48Z  
**Scope:** API security hardening + regression test coverage  
**Requested by:** current repo user

---

## Active Implementation Slice

**Theme:** Explicit API-side origin policy + security headers + regression coverage  
**Prerequisite shipped:** `PUBLIC_WEB_URL` environment variable and `buildSharedUrl()` logic [2026-04-16 Origin-model decision]

### What We're NOT Doing Yet
- Bearer/localStorage auth transport changes remain unchanged
- Client-side auth state management is stable; this slice assumes no refactoring there
- CORS allowlisting is deferred until split-origin deployments are requested

---

## Active Lanes

| Lane | Owner | Focus | Status |
|------|-------|-------|--------|
| **Implementation** | Data | API-side origin policy enforcement; explicit security headers; env-driven URL canonicalization | In progress |
| **Testing** | Chunk | Regression coverage for auth flows; header validation tests; environment variable fallback scenarios | In progress |
| **Scoping / Scope Mgmt** | Mikey | Architecture review; decision gatekeeping; slice boundary enforcement | In progress |

---

## Prerequisite Context

**From 2026-04-16 Origin-model handoff decision:**
- API now reads `PUBLIC_WEB_URL` environment variable
- `buildSharedUrl()` prefers `PUBLIC_WEB_URL` config over request-derived origins
- Same-origin deployment is the documented default target shape
- Request origin header fallback remains for local/dev compatibility

**Previous completion (2026-04-13):**
- Campaign note search UI (#24) approved for merge

---

## Next Steps (Not in This Slice)

1. **Phase 1 (Documentation):** Production deployment guide; environment variable reference
2. **Phase 2 (Deployment artifacts):** nginx reverse-proxy template; docker-compose.prod.yml
3. **Phase 3 (Deployment runbook):** Step-by-step VPS + HTTPS setup

---

## Notes for Team

- This slice is **auth transport-safe**: existing bearer token handling and localStorage strategies remain unchanged
- Regression test coverage is mandatory before closure — no API hardening without proof of backward compatibility
- Security header decisions should be documented in the test suite for future reference
- All three lanes (Data, Chunk, Mikey) are operating in parallel; Mikey gates decisions but does not block implementation

---

**Status:** Kickoff logged | Implementation in flight  
**Logged by:** Scribe

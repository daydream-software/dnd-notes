# Session Log — Workflow SHA Pinning

**Date:** 2026-04-11T19:27:38Z  
**Topic:** Pin GitHub Actions workflow refs to commit SHAs for org compatibility  
**Requestor:** FFMikha

## Summary

Brand pinned all external GitHub Actions in four active Squad workflows and their template mirrors to commit SHAs per organization policy. Mikey audited the scope, confirmed all four workflows required updates, and flagged template-sync risk for squad-heartbeat.yml. Decision documented for team.

## Key Decisions

1. **Action Pinning Requirement:** All public actions (checkout, github-script) must reference commit SHAs, not major versions
2. **Team Rule Established:** Create governance rule for future workflow changes
3. **Template Sync:** Source templates must be updated and propagated via squad upgrade

## Agents Involved

- **Brand:** Platform engineer, pinned all workflows
- **Mikey:** Lead, audited scope and wrote review note

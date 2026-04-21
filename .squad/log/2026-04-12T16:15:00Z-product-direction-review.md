# Session Log: Product Direction Review and Roadmap Planning

**Date:** 2026-04-12T16:15:00Z  
**Agents:** Mikey (Lead), Stef, Data  
**Task:** Review user product direction, evaluate technical feasibility, propose phased roadmap  
**Outcome:** Consensus on near-term bets and long-term vision

## Summary

Team reviewed comprehensive product direction from FFMikha covering campaign management, linked memberships, search, richer note editing, graph-style tag relationships, and mobile UX. Evaluated against current architecture and identified phased approach: strengthen foundations (search, filtering, session navigation, tag browsing) before investing in complex graph relationships.

## Key Product Requests

1. **Linked membership UX** — Distinguish linked vs. unlinked guests in member list
2. **Claim flow UX** — Show history-preservation indicator only immediately post-claim
3. **Guest navigation parity** — Linked guests gain campaign switcher, New campaign, Sign out; non-owners still cannot access settings
4. **Member consolidation** — Owners merge note authorship from duplicate members without history rewrites
5. **Search** — Global search across notes and campaigns
6. **Rich-text editing** — Friendly formatting (bold, italic, lists, etc.) with proper rendering
7. **Graph-style tags** — Notes browsable via flexible tag relationships, not rigid `/` hierarchy
8. **Mobile UX** — Responsive note list/detail layout using space efficiently

## Team Consensus

### Near-Term Bets (v1–v2, 4–8 weeks)
1. **Linked-member visual differentiation** — UI signal for active account linkage in member lists
2. **Temporary claim indicator** — Post-claim banner with transition timer instead of persistent badge
3. **Collaborator navigation cleanup** — Route guards and breadcrumbs for session context
4. **Member consolidation** — Backend API to merge authorship without history duplication
5. **Search infrastructure** — Full-text search on notes and campaign metadata
6. **Mobile note UX** — Responsive flex layout for note list/detail, single-column on mobile
7. **Richer note editing** — Markdown-style or WYSIWYG editor for formatting persistence

### Long-Term Bet (v3+, post-foundations)
- **Graph-style tag relationships** — Defer until search, filtering, and tag browsing foundations are solid
  - Rationale: Complex graph relationships only shine once users can efficiently navigate and discover content; premature implementation before search/filter creates friction
  - Approach: Build rich metadata and relationships incrementally; graph UI becomes a visualization layer on top of mature tag/link semantics

## Architectural Notes

- All membership-based decisions follow `campaign_memberships` as stable actor identity (Issue #20 pattern)
- Member consolidation will require additional FK tracking or audit trail to preserve note authorship lineage
- Search will require indexing strategy (SQLite full-text search vs. external index); lightweight approach preferred for self-hosted deployments
- Mobile responsiveness should be CSS-first (Flexbox/Grid); avoid layout-specific components

## Files Affected

- **Inbox decision:** `.squad/decisions/inbox/copilot-directive-2026-04-12T161203Z.md`
- **This log:** `.squad/log/2026-04-12T16:15:00Z-product-direction-review.md`

## Next Steps

1. Create fine-grained acceptance criteria tickets for each near-term bet
2. Estimate linked-member UX and search infrastructure work
3. Prototype mobile layout changes with design team
4. Plan member consolidation schema addition

## Agents Involved

- **Mikey:** Lead facilitation, architectural guidance, near-term roadmap prioritization
- **Stef:** Backend feasibility analysis, member consolidation schema review
- **Data:** Search indexing strategy, mobile UX patterns

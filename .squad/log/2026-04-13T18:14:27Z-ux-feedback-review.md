# UX Feedback Review & Implementation Recommendations
**Session:** 2026-04-13T18:14:27Z

## Agents Involved
- **Stef** (Frontend/UX) — Reviewed low-risk frontend-only UX changes
- **Data** (Backend) — Reviewed backend/data-model changes for qualified inline note references
- **Mikey** (Product Manager) — Assembled rollout order and editor/library recommendation

## Work Completed

### Frontend UX Review (Stef)
- Reviewed changes in `apps/web/src/App.tsx` and `apps/web/src/note-formatting.tsx`
- Low-risk, frontend-only modifications
- Ready for immediate integration

### Backend Data Model Review (Data)
- Assessed requirements for qualified inline note references
- Reviewed data persistence strategy for note links and backlinks
- Endorsed markdown-as-canonical approach with structured reference extraction

### Product Recommendations (Mikey)
- **Rollout Plan:** Phased implementation starting with compact header/campaign identity UI, then editor component, then inline reference insertion
- **Editor Choice:** Lexical recommended over TipTap for:
  - Better alignment with existing markdown storage (`body: string`)
  - Cleaner path to custom inline note-reference nodes
  - Raw-markdown mode without format bifurcation
  - React + MUI integration compatibility
- **API Contract:** Maintain `body: string` as markdown; persist structured references separately for backlinking and search

## Decisions Merged
- `mikey-notes-ux-editor-plan.md` → decisions.md
  - Captures phased implementation order
  - Editor selection rationale (Lexical vs. TipTap)
  - Backend data model strategy for inline references

## Outcomes
- Clear implementation roadmap for notes UX improvements
- Editor and tooling decisions finalized
- Data model strategy aligned across frontend and backend

## Notes
- All agents aligned on thin-slice approach
- Low risk for immediate frontend work
- Backend foundation work enables future reference features

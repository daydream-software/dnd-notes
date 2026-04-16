# Current Focus

- **Updated:** 2026-04-16T17:49:00Z
- **Active slice:** Admin backup/restore implementation — completed
- **Shipped now:** site-admin `POST /api/admin/restore`, rollback-on-failure restore flow, admin-panel restore UI with mandatory confirmation, and API/web regression coverage
- **Prerequisites already shipped:** `PUBLIC_WEB_URL` canonical share URLs and API exposure hardening
- **Operational caveat:** restoring a backup can invalidate the current owner session if the restored snapshot carries different session rows
- **Next likely task:** choose the next production roadmap slice after backup/restore, most likely provisioning prototype work or deeper deployment/runbook work

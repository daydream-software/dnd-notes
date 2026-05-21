-- Guard idle-scaler against tenants never routed through the activator (#364).
--
-- Problem: the idle-scaler scales any 'ready' tenant whose last_request_at is
-- past the idle threshold, regardless of whether the activator has ever seen
-- traffic from that tenant. Tenants provisioned before ACTIVATOR_EXTERNAL_NAME
-- was set route directly to their Service — the activator is never in their
-- path, so it never records activity. The 0008 backfill seeds last_request_at =
-- NOW() for active tenants but only buys a 30-minute window; it does not fix
-- the routing mismatch.
--
-- Fix: add a boolean column that distinguishes a real activator write from the
-- migration backfill. The idle-scaler checks this flag before scaling — a
-- tenant the activator has never seen is never eligible for scale-to-zero.
--
-- This migration is additive: no @migration:destructive marker needed.
-- Existing rows (including the 0008 backfill) inherit FALSE — exactly right:
-- those tenants have not been observed by the activator yet.
--
-- schema_metadata: no column-level signature exists for tenant_activity, so
-- no UPDATE to schema_metadata is needed here.

ALTER TABLE tenant_activity
  ADD COLUMN IF NOT EXISTS seen_by_activator BOOLEAN NOT NULL DEFAULT FALSE;

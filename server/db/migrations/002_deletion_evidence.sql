-- ============================================================
-- WASL AI — FOUNDATION BUILD 01 — POST-REVIEW REMEDIATION (D-067)
-- 002_deletion_evidence.sql
-- ------------------------------------------------------------
-- Owner directive: D-067 (2026-11-07) - R-01 (full tenant deletion).
--
-- ⭐ WHY THIS TABLE EXISTS
--   `tenants.tenant_id` style foreign keys use ON DELETE CASCADE, so
--   removing the tenant row also removes `deletion_requests` and
--   `audit_events`. The old code deleted the tenant first and then
--   tried to UPDATE the request and INSERT an audit event: both
--   failed with a foreign key violation (23503) and the whole unit
--   of work rolled back, so the full deletion never happened.
--   ⭐ The proof of a deletion must survive the deletion itself.
--   This table has NO foreign key to `tenants`, so the evidence
--   outlives the tenant it describes.
--
-- ⭐ ACCESS MODEL (different from the tenant scoped tables)
--   - The request path role (`wasl_app`) may INSERT the evidence and
--     may never read it: the row level security below has an INSERT
--     policy only, and the SELECT privilege is not granted.
--   - The platform role (`wasl_owner`, the table owner) reads it.
--   - It is NOT tenant scoped: it is the platform side record of a
--     deletion, so it has no isolation policy by tenant.
--
-- ⛔ LOCAL ONLY: synthetic tenants, synthetic counts, no real data.
-- ⛔ Idempotent: safe to run again.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS tenant_deletion_evidence (
  id           text PRIMARY KEY,
  tenant_id    text NOT NULL,
  request_id   text NOT NULL,
  scope        text NOT NULL,
  requested_by text NOT NULL,
  executed_by  text NOT NULL,
  removed      jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tenant_deletion_evidence_tenant_idx
  ON tenant_deletion_evidence (tenant_id);

ALTER TABLE tenant_deletion_evidence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_deletion_evidence_insert ON tenant_deletion_evidence;
CREATE POLICY tenant_deletion_evidence_insert ON tenant_deletion_evidence
  FOR INSERT
  WITH CHECK (true);

-- ⛔ The request path writes the evidence and never reads it back.
GRANT INSERT ON tenant_deletion_evidence TO wasl_app;

INSERT INTO wasl_schema_migrations (version) VALUES ('002_deletion_evidence')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

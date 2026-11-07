-- ============================================================
-- WASL AI — FOUNDATION BUILD 02 — PHASE 01 (production readiness
-- preparation, local only) — 003_phase01_security.sql
-- ------------------------------------------------------------
-- Owner directive: FOUNDATION BUILD 02 / PHASE 01 (2026-11-07).
-- ⛔ LOCAL ONLY: synthetic tenants/users/messages only.
-- ⛔ Idempotent by design: safe to run again.
--
-- 1) LOGIN ATTEMPTS (the rate limit store)
--    ⭐ The rate limit lives in PostgreSQL, NOT in the process memory:
--      with two backend instances the in memory counter would be per
--      instance, so the limit could be doubled by restarting or by
--      running a second instance. The database is the shared state.
--    ⭐ The table is tenant scoped with row level security: the
--      request path sees only the attempts of its own tenant, and a
--      missing tenant context yields zero rows (default deny).
--
-- 2) THE DELETION EVIDENCE GUARD
--    ⭐ In D-067 the request path role (`wasl_app`) may INSERT the
--      deletion evidence and may never read it. That left a hole: any
--      code path running with the request role could write a fake
--      evidence row.
--    ⭐ The guard trigger below closes that hole inside the database:
--      an evidence row is accepted only when a real deletion request
--      row exists for the SAME tenant and the SAME scope, and that
--      request is already marked as executed. The values that describe
--      the request (`requested_by`) are stamped from the trusted row,
--      never taken from the caller.
--    ⛔ The executor must be an active user. The membership check that
--      proves the executor may act for the tenant runs in the request
--      path BEFORE the content is removed (the membership rows are
--      gone afterwards, by design).
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) the login attempt store
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS login_attempts (
  id           bigserial PRIMARY KEY,
  tenant_id    text NOT NULL,
  user_id      text NOT NULL,
  succeeded    boolean NOT NULL DEFAULT false,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS login_attempts_lookup_idx
  ON login_attempts (tenant_id, user_id, attempted_at DESC);

ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_attempts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS login_attempts_isolation ON login_attempts;
CREATE POLICY login_attempts_isolation ON login_attempts
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, DELETE ON login_attempts TO wasl_app;
-- ⭐ The identity column uses a sequence: the request role needs the
--   usage right on it, otherwise the insert fails with 42501.
GRANT USAGE, SELECT ON SEQUENCE login_attempts_id_seq TO wasl_app;

-- ------------------------------------------------------------
-- 2) the deletion evidence guard
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION wasl_guard_deletion_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  request_row deletion_requests%ROWTYPE;
  executor_status text;
BEGIN
  -- ⭐ The proof of a real deletion request.
  SELECT * INTO request_row FROM deletion_requests WHERE id = NEW.request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'deletion evidence without a deletion request'
      USING ERRCODE = '23514';
  END IF;

  IF request_row.tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'deletion evidence tenant does not match its request'
      USING ERRCODE = '23514';
  END IF;

  IF request_row.scope <> NEW.scope THEN
    RAISE EXCEPTION 'deletion evidence scope does not match its request'
      USING ERRCODE = '23514';
  END IF;

  -- ⭐ Only a request that reached the executed state can produce
  --   evidence: the request path marks it executed before this insert.
  IF request_row.status <> 'executed' THEN
    RAISE EXCEPTION 'deletion evidence request is not executed'
      USING ERRCODE = '23514';
  END IF;

  -- ⭐ The executor must be a known, active user.
  SELECT status INTO executor_status FROM users WHERE id = NEW.executed_by;
  IF executor_status IS NULL OR executor_status <> 'active' THEN
    RAISE EXCEPTION 'deletion evidence executor is not an active user'
      USING ERRCODE = '23514';
  END IF;

  -- ⭐ The requester is stamped from the trusted row, never from the
  --   caller: the caller cannot claim another requester.
  NEW.requested_by := request_row.requested_by;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenant_deletion_evidence_guard ON tenant_deletion_evidence;
CREATE TRIGGER tenant_deletion_evidence_guard
  BEFORE INSERT ON tenant_deletion_evidence
  FOR EACH ROW
  EXECUTE FUNCTION wasl_guard_deletion_evidence();

CREATE INDEX IF NOT EXISTS tenant_deletion_evidence_request_idx
  ON tenant_deletion_evidence (request_id);

INSERT INTO wasl_schema_migrations (version) VALUES ('003_phase01_security')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

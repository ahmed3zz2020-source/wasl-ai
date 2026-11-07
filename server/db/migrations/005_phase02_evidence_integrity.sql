-- ============================================================
-- WASL AI — FOUNDATION BUILD 02 — PHASE 02 (D-069)
-- 005_phase02_evidence_integrity.sql
-- ------------------------------------------------------------
-- Owner directive: FOUNDATION BUILD 02 / PHASE 02 (2026-11-07).
-- ⛔ LOCAL ONLY: synthetic tenants/users only.
-- ⛔ Idempotent by design: safe to run again.
--
-- ⭐ WHAT THIS MIGRATION ADDS (M-68)
--   1) the CONTENT HASH of the evidence: a SHA-256 over the canonical
--      content of the row, computed BY THE DATABASE inside the guard
--      trigger. The hash is what makes a later manipulation visible.
--   2) the IMMUTABILITY of the evidence: no UPDATE and no DELETE is
--      accepted, not even by the owner role. The proof of a deletion
--      cannot be rewritten after the fact.
--   3) the RECEIPT: a narrow function that answers "what happened to
--      this deletion request" WITHOUT the request role reading the
--      table. The receipt is what lets a client retry a deletion whose
--      answer was lost and learn the confirmed result.
--
-- ⭐ WHY sha256() AND NOT pgcrypto
--   `sha256(bytea)` is a BUILT-IN function of PostgreSQL (since 11),
--   so the hash needs no extension and no extra privilege: the owner
--   role computes it and the request role never does.
--
-- ⛔ The immutability trigger is UNCONDITIONAL. A retention period for
--   the evidence (a purge of old rows) is an owner decision: the
--   trigger has to be dropped on purpose, never by accident.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) the content hash
-- ------------------------------------------------------------
ALTER TABLE tenant_deletion_evidence
  ADD COLUMN IF NOT EXISTS content_hash text NOT NULL DEFAULT '';
ALTER TABLE tenant_deletion_evidence
  ADD COLUMN IF NOT EXISTS evidence_version integer NOT NULL DEFAULT 1;

-- ⭐⭐ The canonical hash. The trigger and the verification call the
--   SAME function, so the two can never drift apart.
-- ⭐ The timestamp is rendered in UTC with a fixed format: the text
--   of a timestamptz depends on the session time zone, so it must
--   never enter the hash as it is.
CREATE OR REPLACE FUNCTION wasl_deletion_evidence_hash(
  p_id            text,
  p_tenant_id     text,
  p_request_id    text,
  p_scope         text,
  p_requested_by  text,
  p_executed_by   text,
  p_removed       jsonb,
  p_occurred_at   timestamptz
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  select encode(
    sha256(
      convert_to(
        coalesce(p_id, '') || E'\n' ||
        coalesce(p_tenant_id, '') || E'\n' ||
        coalesce(p_request_id, '') || E'\n' ||
        coalesce(p_scope, '') || E'\n' ||
        coalesce(p_requested_by, '') || E'\n' ||
        coalesce(p_executed_by, '') || E'\n' ||
        coalesce(p_removed::text, '{}') || E'\n' ||
        to_char(p_occurred_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US'),
        'utf8'
      )
    ),
    'hex'
  );
$$;

-- ------------------------------------------------------------
-- 2) the guard now stamps the hash as well
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION wasl_guard_deletion_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
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
  -- caller: the caller cannot claim another requester.
  NEW.requested_by := request_row.requested_by;

  -- ⭐⭐ D-069 / M68: the content hash is computed by the DATABASE from
  --   the values of the row, so it cannot be forged by the caller.
  NEW.content_hash := wasl_deletion_evidence_hash(
    NEW.id, NEW.tenant_id, NEW.request_id, NEW.scope,
    NEW.requested_by, NEW.executed_by, NEW.removed, NEW.occurred_at
  );
  NEW.evidence_version := 1;

  RETURN NEW;
END;
$$;

-- ⭐ The rows that were written before this migration get their hash.
--   ⛔ The immutability trigger is dropped first: the migration is
--     re-runnable and the backfill is an UPDATE of the evidence.
DROP TRIGGER IF EXISTS tenant_deletion_evidence_immutable ON tenant_deletion_evidence;

UPDATE tenant_deletion_evidence
   SET content_hash = wasl_deletion_evidence_hash(
         id, tenant_id, request_id, scope, requested_by, executed_by, removed, occurred_at
       )
 WHERE content_hash = '';

-- ------------------------------------------------------------
-- 3) the immutability of the evidence
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION wasl_refuse_evidence_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'the deletion evidence is immutable: it cannot be updated nor deleted'
    USING ERRCODE = '23514';
END;
$$;

DROP TRIGGER IF EXISTS tenant_deletion_evidence_immutable ON tenant_deletion_evidence;
CREATE TRIGGER tenant_deletion_evidence_immutable
  BEFORE UPDATE OR DELETE ON tenant_deletion_evidence
  FOR EACH ROW
  EXECUTE FUNCTION wasl_refuse_evidence_change();

-- ⭐⭐ The request role may not READ the evidence and may not
--   change it: the receipt function below is the only way to learn the
--   outcome of a deletion. The INSERT right stays: the request path
--   writes the proof.
REVOKE SELECT, UPDATE, DELETE ON tenant_deletion_evidence FROM wasl_app;

-- ------------------------------------------------------------
-- 4) the receipt
-- ------------------------------------------------------------
-- ⭐ The function carries its version in its name: a change of the
--   RETURN TYPE needs a new name, because PostgreSQL refuses to change
--   the shape of an existing function with CREATE OR REPLACE.
-- ⛔ The name is new, so the first creation takes no lock on an
--   existing function: the migrations run in every test file and a
--   DROP FUNCTION would wait for the running sessions (a deadlock).
CREATE OR REPLACE FUNCTION wasl_deletion_receipt_v1(p_request_id text)
RETURNS TABLE (
  request_id     text,
  request_status text,
  tenant_id      text,
  evidence_id    text,
  scope          text,
  occurred_at    timestamptz,
  content_hash   text,
  verified       boolean,
  removed        jsonb
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- ⭐ The tenant context of the caller: it is restored before the
  --   function returns, so the context never leaks to the transaction.
  v_previous_tenant text := current_setting('app.tenant_id', true);
  v_evidence tenant_deletion_evidence%ROWTYPE;
  v_request  deletion_requests%ROWTYPE;
  -- ⭐ The tenant of the request id: the id carries it, so the receipt
  --   of a request that was NOT executed yet can be answered without a
  --   session. The id stays unguessable (128 random bits).
  v_id_tenant text;
BEGIN
  v_id_tenant := CASE
    WHEN p_request_id ~ '^del_[a-z0-9][a-z0-9_-]{2,63}_[0-9a-f]{32}$'
    THEN substring(p_request_id from 5 for length(p_request_id) - 37)
    ELSE NULL
  END;
  -- ⭐ The evidence table has the row level security ENABLED but not
  --   FORCED, so the owner (the function runs as the owner) reads it.
  SELECT * INTO v_evidence
    FROM tenant_deletion_evidence
   WHERE tenant_deletion_evidence.request_id = p_request_id;

  IF v_evidence.id IS NOT NULL THEN
    -- ⭐ The deletion happened: the request row may be gone (a full
    --   deletion removes the tenant with it), so the evidence is the
    --   proof. The request row is read under the tenant of the
    --   evidence, because its table has the row level security FORCED.
    PERFORM set_config('app.tenant_id', v_evidence.tenant_id, true);
    SELECT * INTO v_request
      FROM deletion_requests
     WHERE deletion_requests.id = p_request_id;
    PERFORM set_config('app.tenant_id', coalesce(v_previous_tenant, ''), true);
  ELSE
    -- ⭐ Nothing was executed yet: the request row is read under the
    --   tenant of the request id (the table has the row level security
    --   FORCED, so the context is what makes the row visible).
    IF v_id_tenant IS NOT NULL THEN
      PERFORM set_config('app.tenant_id', v_id_tenant, true);
    END IF;
    SELECT * INTO v_request
      FROM deletion_requests
     WHERE deletion_requests.id = p_request_id;
    PERFORM set_config('app.tenant_id', coalesce(v_previous_tenant, ''), true);
  END IF;

  RETURN QUERY
  SELECT
    p_request_id,
    CASE
      WHEN v_evidence.id IS NOT NULL THEN 'executed'
      ELSE coalesce(v_request.status, 'unknown')
    END,
    coalesce(v_evidence.tenant_id, v_request.tenant_id),
    v_evidence.id,
    v_evidence.scope,
    v_evidence.occurred_at,
    v_evidence.content_hash,
    CASE
      WHEN v_evidence.id IS NULL THEN NULL
      ELSE v_evidence.content_hash = wasl_deletion_evidence_hash(
        v_evidence.id, v_evidence.tenant_id, v_evidence.request_id, v_evidence.scope,
        v_evidence.requested_by, v_evidence.executed_by, v_evidence.removed, v_evidence.occurred_at
      )
    END,
    v_evidence.removed;
END;
$$;

REVOKE ALL ON FUNCTION wasl_deletion_receipt_v1(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wasl_deletion_receipt_v1(text) TO wasl_app;

INSERT INTO wasl_schema_migrations (version) VALUES ('005_phase02_evidence_integrity')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

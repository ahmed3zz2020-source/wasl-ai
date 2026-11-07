-- ============================================================
-- WASL AI — FOUNDATION BUILD 03 / PHASE 01 (D-070)
-- 006_phase03_login_admission.sql
-- ------------------------------------------------------------
-- Owner directive: FOUNDATION BUILD 03 / PHASE 01 (2026-11-07).
-- ⛔ LOCAL ONLY: synthetic tenants/users only.
-- ⛔ Idempotent by design: safe to run again.
--
-- ⭐⭐ WHAT THIS MIGRATION ADDS (M-73)
--   The login protection of D-069 had THREE counters and one of them
--   could take the WHOLE installation down: when the platform wide
--   budget was exhausted, EVERY login was refused with 429, including
--   the login of a legitimate user with the correct passcode.
--   ⭐ An attacker who spent the platform budget therefore switched
--     every user of the installation off, for as long as the window
--     lasted. That is the defect M-73 closes.
--
-- ⭐⭐ THE GRADED ADMISSION CONTROL
--   The platform budget no longer REFUSES: it SLOWS DOWN.
--   ⭐ ① The ACCOUNT budget (per account) still refuses the GUESSES.
--     It never refuses the owner of the account.
--   ⭐ ② The TENANT budget (per company) still refuses the GUESSES.
--   ⭐ ③ The PLATFORM budget now enters a DEGRADED MODE: every attempt
--     waits longer before the key is derived, so the flood of guesses
--     slows down while a legitimate user still gets in.
--   ⭐ ④ The ADMISSION BUCKETS are the real ceiling of the CPU: the
--     number of key derivations per second is bounded by construction,
--     on the whole installation (global bucket) AND on every company
--     (tenant bucket) ⇒ one company cannot spend the budget of the
--     others.
--
-- ⭐ THE BUCKETS ARE SHARED STATE
--   They live in PostgreSQL and not in the process memory: with two
--   backend instances an in-memory counter would be counted twice (or
--   reset by a restart). The two instances see the same buckets.
--
-- ⛔ THE BUCKETS ARE NOT READ BY THE REQUEST ROLE
--   The request role may only call the narrow function below, which
--   is the only way to take a token. The tables themselves stay
--   closed to it.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) the global admission bucket
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS login_admission_global (
  id          integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  tokens      double precision NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- ⭐⭐ A bucket that was never used is FULL, not empty: the first
  --   login of a fresh installation (and of a fresh company) must not
  --   wait for a token that nobody spent yet.
  initialized boolean NOT NULL DEFAULT false
);

-- ⭐ The row exists from the start: the bucket is never missing.
INSERT INTO login_admission_global (id, tokens)
  VALUES (1, 0)
  ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- 2) the per company admission bucket
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS login_admission_tenant (
  tenant_id   text PRIMARY KEY,
  tokens      double precision NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  initialized boolean NOT NULL DEFAULT false
);

-- ⭐⭐ SELF-HEALING: an installation that applied an earlier revision
--   of this migration gets the new columns here, so the function below
--   and the tables can never drift apart.
ALTER TABLE login_admission_global
  ADD COLUMN IF NOT EXISTS initialized boolean NOT NULL DEFAULT false;
ALTER TABLE login_admission_tenant
  ADD COLUMN IF NOT EXISTS initialized boolean NOT NULL DEFAULT false;

-- ⛔ No read grant on either table: the request role never selects
--   from them. The narrow function below is the only door.
ALTER TABLE login_admission_global ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS login_admission_global_deny ON login_admission_global;
CREATE POLICY login_admission_global_deny ON login_admission_global
  AS RESTRICTIVE
  FOR ALL
  USING (false)
  WITH CHECK (false);

ALTER TABLE login_admission_tenant ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS login_admission_tenant_deny ON login_admission_tenant;
CREATE POLICY login_admission_tenant_deny ON login_admission_tenant
  AS RESTRICTIVE
  FOR ALL
  USING (false)
  WITH CHECK (false);

-- ------------------------------------------------------------
-- 3) the narrow function that takes one admission slot
-- ------------------------------------------------------------
-- ⭐⭐ THE ALGORITHM (a token bucket that may go into debt)
--   1) the elapsed time since the last call refills the bucket at the
--      given rate, up to the burst,
--   2) the attempt ALWAYS takes one token, so the balance may become
--      negative: a negative balance is the debt of the attempts that
--      are already waiting,
--   3) the wait is the time needed to clear that debt, so the number
--      of key derivations per second is bounded BY CONSTRUCTION.
--   ⭐ The global bucket and the company bucket are BOTH needed: the
--     wait is the longest of the two, so a company that floods cannot
--     spend the budget of the others, and the installation cannot
--     spend more CPU than the global rate allows.
CREATE OR REPLACE FUNCTION wasl_login_admission_take(
  p_global_rate   double precision,
  p_global_burst  double precision,
  p_tenant_rate   double precision,
  p_tenant_burst  double precision,
  p_tenant_id     text,
  p_extra_wait_ms integer
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  g_row      login_admission_global%ROWTYPE;
  t_row      login_admission_tenant%ROWTYPE;
  now_at     timestamptz := clock_timestamp();
  g_elapsed  double precision;
  g_balance  double precision;
  g_wait_ms  integer;
  t_elapsed  double precision;
  t_balance  double precision;
  t_wait_ms  integer;
BEGIN
  -- ⛔ Fail closed: the inputs are validated here, exactly like the
  --   request path validates them before they reach the database.
  IF p_tenant_id IS NULL OR p_tenant_id !~ '^[a-z0-9][a-z0-9_-]{2,63}$' THEN
    RAISE EXCEPTION 'login admission tenant context is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_global_rate IS NULL OR p_global_rate <= 0
     OR p_tenant_rate IS NULL OR p_tenant_rate <= 0
     OR p_global_burst IS NULL OR p_global_burst < 1
     OR p_tenant_burst IS NULL OR p_tenant_burst < 1 THEN
    RAISE EXCEPTION 'login admission parameters are invalid' USING ERRCODE = '22023';
  END IF;

  -- ⭐ The buckets are always locked in the SAME order (the global one
  --   first), so two calls can never wait for each other.
  SELECT * INTO g_row FROM login_admission_global WHERE id = 1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'login admission bucket is missing' USING ERRCODE = 'XX000';
  END IF;

  SELECT * INTO t_row FROM login_admission_tenant WHERE tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO login_admission_tenant (tenant_id, tokens, updated_at)
      VALUES (p_tenant_id, 0, now_at)
      ON CONFLICT (tenant_id) DO NOTHING;
    SELECT * INTO t_row FROM login_admission_tenant WHERE tenant_id = p_tenant_id FOR UPDATE;
  END IF;

  -- ① the global bucket
  g_elapsed := extract(epoch FROM (now_at - g_row.updated_at)) * 1000.0;
  IF g_elapsed < 0 THEN g_elapsed := 0; END IF;
  IF g_row.initialized THEN
    g_balance := LEAST(p_global_burst, g_row.tokens + (g_elapsed / 1000.0) * p_global_rate) - 1.0;
  ELSE
    -- ⭐ A bucket that was never used is full.
    g_balance := p_global_burst - 1.0;
  END IF;
  IF g_balance < 0 THEN
    g_wait_ms := CEIL((-g_balance / p_global_rate) * 1000.0);
  ELSE
    g_wait_ms := 0;
  END IF;

  -- ② the company bucket
  t_elapsed := extract(epoch FROM (now_at - t_row.updated_at)) * 1000.0;
  IF t_elapsed < 0 THEN t_elapsed := 0; END IF;
  IF t_row.initialized THEN
    t_balance := LEAST(p_tenant_burst, t_row.tokens + (t_elapsed / 1000.0) * p_tenant_rate) - 1.0;
  ELSE
    -- ⭐ A bucket that was never used is full.
    t_balance := p_tenant_burst - 1.0;
  END IF;
  IF t_balance < 0 THEN
    t_wait_ms := CEIL((-t_balance / p_tenant_rate) * 1000.0);
  ELSE
    t_wait_ms := 0;
  END IF;

  UPDATE login_admission_global
     SET tokens = g_balance, updated_at = now_at, initialized = true
   WHERE id = 1;

  UPDATE login_admission_tenant
     SET tokens = t_balance, updated_at = now_at, initialized = true
   WHERE tenant_id = p_tenant_id;

  -- ⭐ The wait is the LONGEST of the two: the two buckets refill in
  --   parallel, so the attempts do not add up their waits.
  RETURN GREATEST(g_wait_ms, t_wait_ms) + GREATEST(p_extra_wait_ms, 0);
END;
$$;

-- ⭐⭐ The state of the buckets (the drill reads it, the request path
--   does not need it).
CREATE OR REPLACE FUNCTION wasl_login_admission_state(p_tenant_id text)
RETURNS TABLE (global_tokens double precision, tenant_tokens double precision)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT g.tokens, COALESCE(t.tokens, 0)
    FROM login_admission_global g
    LEFT JOIN login_admission_tenant t ON t.tenant_id = p_tenant_id
   WHERE g.id = 1;
$$;

REVOKE ALL ON FUNCTION wasl_login_admission_take(double precision, double precision, double precision, double precision, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION wasl_login_admission_state(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION wasl_login_admission_take(double precision, double precision, double precision, double precision, text, integer) TO wasl_app;
GRANT EXECUTE ON FUNCTION wasl_login_admission_state(text) TO wasl_app;

-- ⭐ The request role needs nothing on the tables themselves.
REVOKE ALL ON login_admission_global FROM wasl_app;
REVOKE ALL ON login_admission_tenant FROM wasl_app;

-- ------------------------------------------------------------
-- 4) the inbox read paths
-- ------------------------------------------------------------
-- ⭐ The inbox reads the conversations of a company with the name of
--   the customer and the last message of each one. The index makes the
--   list cheap without changing the isolation: the policy of the table
--   is what decides the rows.
CREATE INDEX IF NOT EXISTS conversations_inbox_idx
  ON conversations (tenant_id, updated_at DESC, ref);

CREATE INDEX IF NOT EXISTS messages_inbox_last_idx
  ON messages (tenant_id, conversation_ref, occurred_at DESC);

CREATE INDEX IF NOT EXISTS customers_inbox_idx
  ON customers (tenant_id, display_name);

INSERT INTO wasl_schema_migrations (version) VALUES ('006_phase03_login_admission')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

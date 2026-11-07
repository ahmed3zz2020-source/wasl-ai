-- ============================================================
-- WASL AI — FOUNDATION BUILD 02 — PHASE 02 (D-069)
-- 004_phase02_auth_hardening.sql
-- ------------------------------------------------------------
-- Owner directive: FOUNDATION BUILD 02 / PHASE 02 (2026-11-07).
-- ⛔ LOCAL ONLY: synthetic tenants/users only.
-- ⛔ Idempotent by design: safe to run again.
--
-- 1) THE PLATFORM WIDE LOGIN BUDGET
--    ⭐ The PHASE 01 counter is tenant scoped: it stops the guesses
--      against one company. An attacker that spreads the guesses over
--      many accounts (and over many companies) never touches that
--      budget, so the key derivations are unbounded.
--    ⭐ This table is the PLATFORM side counter: it is not tenant
--      scoped and it is not readable by the request role. The request
--      role may only CALL the two narrow functions below, so it can
--      neither read the counter nor forge a row in it.
--    ⭐ The functions are SECURITY DEFINER with a fixed search_path:
--      they run with the privileges of the owner role and they are
--      the ONLY way in or out of the table.
--
-- 2) THE PEER ADDRESS DIMENSION
--    ⭐ The peer address is the address of the socket, never a header.
--      X-Forwarded-For is NEVER read: a client can send any value it
--      wants, so trusting it would move the limit to the attacker.
--    ⭐ The peer budget is opt-in (WASL_LOGIN_MAX_PEER_ATTEMPTS): it
--      only makes sense when the backend is directly exposed. Behind
--      a reverse proxy every request has the address of the proxy, so
--      the peer budget would throttle everybody at once.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) the platform side counter
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS login_attempts_global (
  id           bigserial PRIMARY KEY,
  tenant_id    text NOT NULL,
  user_id      text NOT NULL,
  peer_address text,
  succeeded    boolean NOT NULL DEFAULT false,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS login_attempts_global_lookup_idx
  ON login_attempts_global (attempted_at DESC);

CREATE INDEX IF NOT EXISTS login_attempts_global_peer_idx
  ON login_attempts_global (peer_address, attempted_at DESC)
  WHERE peer_address IS NOT NULL;

-- ⛔ No read grant: the request role never selects from this table.
ALTER TABLE login_attempts_global ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS login_attempts_global_deny ON login_attempts_global;
CREATE POLICY login_attempts_global_deny ON login_attempts_global
  AS RESTRICTIVE
  FOR ALL
  USING (false)
  WITH CHECK (false);

-- ⭐ Record one attempt (and prune the old rows in the same call).
CREATE OR REPLACE FUNCTION wasl_record_global_login_attempt(
  p_tenant_id    text,
  p_user_id      text,
  p_peer_address text,
  p_succeeded    boolean
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- ⛔ Fail closed: the tenant id is validated here, exactly like the
  --   request path validates it before it reaches the RLS context.
  IF p_tenant_id IS NULL OR p_tenant_id !~ '^[a-z0-9][a-z0-9_-]{2,63}$' THEN
    RAISE EXCEPTION 'login attempt tenant context is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_user_id IS NULL OR p_user_id = '' THEN
    RAISE EXCEPTION 'login attempt user is invalid' USING ERRCODE = '22023';
  END IF;

  INSERT INTO login_attempts_global (tenant_id, user_id, peer_address, succeeded)
  VALUES (p_tenant_id, p_user_id, p_peer_address, p_succeeded);

  -- ⭐ The table is bounded: the rows older than a day are removed.
  DELETE FROM login_attempts_global WHERE attempted_at < now() - interval '24 hours';
END;
$$;

-- ⭐ The platform wide count of the recent failures.
CREATE OR REPLACE FUNCTION wasl_global_login_failures(p_window_seconds int)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  select count(*)
    from login_attempts_global
   where succeeded = false
     and attempted_at > now() - make_interval(secs => p_window_seconds);
$$;

-- ⭐ The count of the recent failures of one peer address.
CREATE OR REPLACE FUNCTION wasl_peer_login_failures(
  p_peer_address   text,
  p_window_seconds int
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  select count(*)
    from login_attempts_global
   where succeeded = false
     and peer_address is not null
     and peer_address = p_peer_address
     and attempted_at > now() - make_interval(secs => p_window_seconds);
$$;

REVOKE ALL ON FUNCTION wasl_record_global_login_attempt(text, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION wasl_global_login_failures(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION wasl_peer_login_failures(text, int) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION wasl_record_global_login_attempt(text, text, text, boolean) TO wasl_app;
GRANT EXECUTE ON FUNCTION wasl_global_login_failures(int) TO wasl_app;
GRANT EXECUTE ON FUNCTION wasl_peer_login_failures(text, int) TO wasl_app;

-- ⭐ The request role needs nothing on the table itself.
REVOKE ALL ON login_attempts_global FROM wasl_app;

INSERT INTO wasl_schema_migrations (version) VALUES ('004_phase02_auth_hardening')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

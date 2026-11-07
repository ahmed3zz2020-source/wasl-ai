-- ============================================================
-- WASL AI — FOUNDATION BUILD 01 — schema, roles and RLS
-- ------------------------------------------------------------
-- Owner directive: FOUNDATION BUILD 01 (2026-11-07).
-- Decision basis: DR-4 = B (local experimental isolation),
--                  DR-7 = C (shared PostgreSQL + row level security),
--                  DR-9 = C (configurable retention / export / deletion).
-- ⛔ This script is LOCAL ONLY: synthetic tenants/users/messages only.
-- ⛔ It never creates cloud resources, never touches a real mailbox.
-- ⛔ Idempotent by design: safe to run again (migrations must be re-runnable).
--
-- Role model (least privilege):
--   wasl_owner  -> owns the tables, used by the MIGRATION/SEED path only.
--                  Never used by the request path.
--   wasl_app    -> used by the request path. NOT a table owner,
--                  NOBYPASSRLS, no CREATEDB/CREATEROLE, no role grants.
--                  Every tenant-scoped table has RLS enabled AND forced,
--                  so the policy applies to the owner as well.
-- Tenant context is provided per transaction:
--   select set_config('app.tenant_id', $1, true);
-- A missing context yields NULL => the policy predicate is never true
-- => zero rows (default deny).
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) schema bookkeeping
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wasl_schema_migrations (
  version     text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 2) core entities
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
  id                 text PRIMARY KEY,
  name               text NOT NULL,
  status             text NOT NULL DEFAULT 'active',
  retention_profile  text NOT NULL DEFAULT 'synthetic-default',
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id            text PRIMARY KEY,
  display_name  text NOT NULL,
  email         text NOT NULL,
  status        text NOT NULL DEFAULT 'active',
  passcode_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  id          text PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('owner', 'supervisor', 'agent', 'viewer')),
  status      text NOT NULL DEFAULT 'active',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id             text PRIMARY KEY,
  tenant_id      text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id        text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  membership_id  text NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  role           text NOT NULL,
  token_hash     text NOT NULL UNIQUE,
  issued_at      timestamptz NOT NULL,
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  revoked_reason text
);

CREATE TABLE IF NOT EXISTS customers (
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  display_name  text NOT NULL,
  data_class    text NOT NULL DEFAULT 'standard',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversations (
  ref                text NOT NULL,
  tenant_id          text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id        text REFERENCES customers(id) ON DELETE SET NULL,
  state              text NOT NULL DEFAULT 'new',
  assignee_actor_id  text,
  version            integer NOT NULL DEFAULT 1,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, ref)
);

CREATE TABLE IF NOT EXISTS messages (
  message_ref      text NOT NULL,
  tenant_id        text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_ref text NOT NULL,
  channel          text NOT NULL,
  direction        text NOT NULL,
  sender           text NOT NULL,
  recipient        text NOT NULL,
  body             text NOT NULL,
  occurred_at      timestamptz NOT NULL,
  locale           text NOT NULL,
  attributes       jsonb NOT NULL DEFAULT '{}'::jsonb,
  stored_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, message_ref)
);

CREATE TABLE IF NOT EXISTS conversation_changes (
  id               bigserial PRIMARY KEY,
  tenant_id        text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_ref text NOT NULL,
  operation        text NOT NULL,
  from_state       text,
  to_state         text,
  actor_id         text NOT NULL,
  reason           text NOT NULL DEFAULT '',
  assignee_from    text,
  assignee_to      text,
  occurred_at      timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS read_audit_events (
  id          bigserial PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_id    text NOT NULL,
  operation   text NOT NULL,
  capability  text NOT NULL DEFAULT '',
  result      text NOT NULL,
  target      text,
  row_count   integer,
  occurred_at timestamptz NOT NULL
);

-- Server level auditable event log (Path A requirement).
CREATE TABLE IF NOT EXISTS audit_events (
  id          bigserial PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_id    text NOT NULL,
  session_id  text,
  operation   text NOT NULL,
  result      text NOT NULL,
  code        text,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS retention_policies (
  tenant_id      text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  data_class     text NOT NULL,
  retention_days integer NOT NULL,
  on_cancel      text NOT NULL DEFAULT 'retain' CHECK (on_cancel IN ('retain', 'delete')),
  PRIMARY KEY (tenant_id, data_class)
);

CREATE TABLE IF NOT EXISTS deletion_requests (
  id           text PRIMARY KEY,
  tenant_id    text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  requested_by text NOT NULL,
  scope        text NOT NULL DEFAULT 'tenant',
  status       text NOT NULL DEFAULT 'previewed' CHECK (status IN ('previewed', 'executed')),
  preview      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  executed_at  timestamptz
);

CREATE INDEX IF NOT EXISTS conversations_tenant_idx ON conversations (tenant_id);
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages (tenant_id, conversation_ref);
CREATE INDEX IF NOT EXISTS sessions_tenant_idx ON sessions (tenant_id);
CREATE INDEX IF NOT EXISTS audit_events_tenant_idx ON audit_events (tenant_id, occurred_at);

-- ------------------------------------------------------------
-- 3) Row Level Security
--    Every tenant scoped table: ENABLE + FORCE + one isolation policy.
--    FORCE matters: it applies the policy to the table owner too,
--    so the migration/seed path must set the tenant context as well.
-- ------------------------------------------------------------
ALTER TABLE tenants              ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers            ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages             ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE read_audit_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE retention_policies   ENABLE ROW LEVEL SECURITY;
ALTER TABLE deletion_requests    ENABLE ROW LEVEL SECURITY;

ALTER TABLE tenants              FORCE ROW LEVEL SECURITY;
ALTER TABLE memberships          FORCE ROW LEVEL SECURITY;
ALTER TABLE sessions             FORCE ROW LEVEL SECURITY;
ALTER TABLE customers            FORCE ROW LEVEL SECURITY;
ALTER TABLE conversations        FORCE ROW LEVEL SECURITY;
ALTER TABLE messages             FORCE ROW LEVEL SECURITY;
ALTER TABLE conversation_changes FORCE ROW LEVEL SECURITY;
ALTER TABLE read_audit_events    FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_events         FORCE ROW LEVEL SECURITY;
ALTER TABLE retention_policies   FORCE ROW LEVEL SECURITY;
ALTER TABLE deletion_requests    FORCE ROW LEVEL SECURITY;

-- Isolation predicate: the row belongs to the tenant of the trusted context.
-- current_setting(..., true) returns NULL when the context is absent
-- => predicate is NULL => not true => row is invisible (default deny).

DROP POLICY IF EXISTS tenants_isolation ON tenants;
CREATE POLICY tenants_isolation ON tenants
  USING (id = current_setting('app.tenant_id', true))
  WITH CHECK (id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS memberships_isolation ON memberships;
CREATE POLICY memberships_isolation ON memberships
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS sessions_isolation ON sessions;
CREATE POLICY sessions_isolation ON sessions
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS customers_isolation ON customers;
CREATE POLICY customers_isolation ON customers
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS conversations_isolation ON conversations;
CREATE POLICY conversations_isolation ON conversations
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS messages_isolation ON messages;
CREATE POLICY messages_isolation ON messages
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS conversation_changes_isolation ON conversation_changes;
CREATE POLICY conversation_changes_isolation ON conversation_changes
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS read_audit_events_isolation ON read_audit_events;
CREATE POLICY read_audit_events_isolation ON read_audit_events
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS audit_events_isolation ON audit_events;
CREATE POLICY audit_events_isolation ON audit_events
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS retention_policies_isolation ON retention_policies;
CREATE POLICY retention_policies_isolation ON retention_policies
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS deletion_requests_isolation ON deletion_requests;
CREATE POLICY deletion_requests_isolation ON deletion_requests
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- The `users` table is NOT tenant scoped (one account may hold memberships
-- in more than one tenant) => no RLS there. It is never exposed by the API
-- as a directory, and every read joins through a membership of the caller.

-- ------------------------------------------------------------
-- 4) Least privilege grants for the request path role
-- ------------------------------------------------------------
-- The roles are created by the setup tool (needs CREATEROLE), not here.
-- Fail closed with an actionable message instead of a cryptic grant error.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wasl_app') THEN
    RAISE EXCEPTION 'role wasl_app is missing — run the database setup first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wasl_owner') THEN
    RAISE EXCEPTION 'role wasl_owner is missing — run the database setup first';
  END IF;
END
$$;

-- Role attributes and the schema grants are applied by the setup tool
-- (they need a superuser connection); the table grants below are enough
-- for the request path.

GRANT SELECT, INSERT, UPDATE, DELETE ON
  tenants, memberships, sessions, customers, conversations, messages,
  conversation_changes, read_audit_events, audit_events,
  retention_policies, deletion_requests
  TO wasl_app;

GRANT USAGE, SELECT ON
  conversation_changes_id_seq, read_audit_events_id_seq, audit_events_id_seq
  TO wasl_app;

GRANT SELECT ON users TO wasl_app;
GRANT SELECT ON wasl_schema_migrations TO wasl_app;

-- ⛔ The request path role must never be able to impersonate the owner:
--    no membership of wasl_owner to wasl_app (never granted).

COMMIT;

INSERT INTO wasl_schema_migrations (version) VALUES ('001_foundation')
  ON CONFLICT (version) DO NOTHING;

-- ============================================================
-- WASL AI — FOUNDATION BUILD 03 / PHASE 04 (D-073)
-- 008_phase04_tickets.sql
-- ------------------------------------------------------------
-- Owner directive: FOUNDATION BUILD 03 / PHASE 04 (2026-11-07).
-- ⛔ LOCAL ONLY: synthetic tenants/users only.
-- ⛔ Idempotent by design: safe to run again.
--
-- ⭐⭐ WHAT THIS MIGRATION ADDS
--   The Customer Support Tickets: a ticket is a RECORD OF THE SUPPORT
--   WORK of a company, attached to a customer and (optionally) to a
--   conversation. The conversations carry the dialogue; the ticket
--   carries the WORK (a subject, a state, a priority, an owner).
--
-- ⭐⭐ THE TICKET IS NOT A CONVERSATION
--   ⭐ The states of a ticket are LOCAL to the tickets module (open,
--     in progress, resolved, closed) ⇒ ⭐⭐ they are NOT the states of
--     the core (`src/core/conversation-state.ts`) ⇒ ⭐⭐ and closing a
--     ticket does NOT close a conversation (and the other way round) ⇒
--     ⭐⭐ that coupling was NEVER approved and is NOT introduced here.
--   ⭐ The priorities are local too (low, normal, high, urgent).
--
-- ⭐⭐ THE ISOLATION IS THE SAME AS EVERY OTHER TABLE
--   ⭐ The rows are keyed by the tenant ⇒ ⭐ the policy of the table
--     (the tenant context) decides the rows ⇒ ⭐⭐ a ticket of another
--     company is invisible, exactly like a conversation.
--   ⭐ The reference of a ticket is unique PER COMPANY (the key is
--     (tenant_id, ref)) ⇒ ⭐⭐ two companies may hold the same
--     reference and the database accepts it ⇒ ⭐⭐ and the creation is
--     IDEMPOTENT per company (the same reference twice ⇒ the first
--     ticket, not a second one).
--
-- ⭐⭐ THE VERSION IS THE LOCK OF THE CONCURRENT EDIT
--   The update carries the version it read ⇒ ⭐ the write lands only
--   when the version did not move ⇒ ⭐⭐ two employees get a conflict
--   (409) instead of silently overwriting each other.
--
-- ⭐⭐ THE CHANGE LOG
--   Every important change of a ticket is written in its own table
--   (the same shape as `conversation_changes`) ⇒ ⭐⭐ the activity of a
--   ticket is a fact of the database, not a field somebody forgets.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) the tickets of a company
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS support_tickets (
  id                bigserial PRIMARY KEY,
  tenant_id         text NOT NULL,
  -- ⭐ The reference of the ticket: unique PER COMPANY.
  ref               text NOT NULL,
  -- ⭐ The customer the ticket is about (same company).
  customer_id       text NOT NULL,
  -- ⭐ The conversation the ticket came from (may be empty).
  conversation_ref  text,
  -- ⭐ The work: a subject, a short description, a state, a priority.
  subject           text NOT NULL,
  description       text NOT NULL DEFAULT '',
  state             text NOT NULL DEFAULT 'open',
  priority          text NOT NULL DEFAULT 'normal',
  -- ⭐ The employee responsible for the ticket (may be empty).
  assignee_actor_id text,
  -- ⭐⭐ The lock of the concurrent edit (the same idea as the CRM).
  version           integer NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- ⭐⭐ The reference is unique inside the company.
  CONSTRAINT support_tickets_tenant_ref_key UNIQUE (tenant_id, ref)
);

-- ⭐⭐ The isolation: the same policy as every other table of the
--   project ⇒ ⭐ the tenant context decides the rows ⇒ ⭐⭐ a ticket of
--   another company is invisible (and not "forbidden": invisible).
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS support_tickets_isolation ON support_tickets;
CREATE POLICY support_tickets_isolation ON support_tickets
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON support_tickets TO wasl_app;
GRANT USAGE, SELECT ON SEQUENCE support_tickets_id_seq TO wasl_app;

-- ⭐ The list of the tickets is ordered by the update time, and the
--   tickets of a customer are read by (customer, tenant).
CREATE INDEX IF NOT EXISTS support_tickets_list_idx
  ON support_tickets (tenant_id, updated_at DESC, id);
CREATE INDEX IF NOT EXISTS support_tickets_customer_idx
  ON support_tickets (tenant_id, customer_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_assignee_idx
  ON support_tickets (tenant_id, assignee_actor_id, updated_at DESC);

-- ------------------------------------------------------------
-- 2) the change log of a ticket
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS support_ticket_changes (
  id              bigserial PRIMARY KEY,
  tenant_id       text NOT NULL,
  ticket_ref      text NOT NULL,
  version         integer NOT NULL,
  actor_id        text NOT NULL,
  operation       text NOT NULL,
  before_state    text,
  after_state     text,
  reason          text,
  changed_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE support_ticket_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_ticket_changes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS support_ticket_changes_isolation ON support_ticket_changes;
CREATE POLICY support_ticket_changes_isolation ON support_ticket_changes
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT ON support_ticket_changes TO wasl_app;
GRANT USAGE, SELECT ON SEQUENCE support_ticket_changes_id_seq TO wasl_app;

CREATE INDEX IF NOT EXISTS support_ticket_changes_list_idx
  ON support_ticket_changes (tenant_id, ticket_ref, changed_at DESC, id);

INSERT INTO wasl_schema_migrations (version) VALUES ('008_phase04_tickets')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

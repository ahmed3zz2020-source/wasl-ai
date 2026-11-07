-- ============================================================
-- WASL AI — FOUNDATION BUILD 03 / PHASE 02 (D-071)
-- 007_phase02_crm.sql
-- ------------------------------------------------------------
-- Owner directive: FOUNDATION BUILD 03 / PHASE 02 (2026-11-07).
-- ⛔ LOCAL ONLY: synthetic tenants/users only.
-- ⛔ Idempotent by design: safe to run again.
--
-- ⭐⭐ WHAT THIS MIGRATION ADDS
--   The Customer CRM reads and edits the CUSTOMERS of a company. The
--   table `customers` carried only a name and a data class, so:
--   ⭐ ① there was no CONTACT data to show (the CRM has to show the
--     contact the employee may use),
--   ⭐ ② there was no VERSION, so two employees editing the same
--     customer could overwrite each other without knowing (a lost
--     update that nobody can see).
--
-- ⭐ THE CONTACT FIELDS ARE OPTIONAL AND EMPTY
--   They are nullable and the seed leaves them empty ⇒ ⭐ no data is
--   invented and no real contact exists anywhere.
-- ⭐ They are NOT sensitive by nature, but the interface shows them
--   only to the roles that may manage a customer (the core decides
--   that: `customer.manage`).
--
-- ⭐⭐ THE VERSION IS THE LOCK OF THE CONCURRENT EDIT
--   The update carries the version it read. The write only lands when
--   the version did not move ⇒ ⭐ **a second employee gets a conflict
--   (409) instead of silently overwriting the first one.**
--
-- ⛔ THE ISOLATION IS NOT TOUCHED
--   The policy of the table (the tenant context) still decides the
--   rows. This migration adds columns, it does not open anything.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) the contact fields and the lock of the customer
-- ------------------------------------------------------------
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS email text;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS phone text;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- ⭐ The list of the CRM is ordered by the name, so the index that
--   serves it is (tenant, name, id) — a stable order.
CREATE INDEX IF NOT EXISTS customers_crm_idx
  ON customers (tenant_id, display_name, id);

-- ⭐ The conversations of a customer are read by (customer, tenant).
CREATE INDEX IF NOT EXISTS conversations_customer_idx
  ON conversations (tenant_id, customer_id, updated_at DESC);

INSERT INTO wasl_schema_migrations (version) VALUES ('007_phase02_crm')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

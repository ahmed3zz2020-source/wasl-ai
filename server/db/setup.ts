// ============================================================
// WASL AI — FOUNDATION BUILD 01 — database setup
// ------------------------------------------------------------
// ⭐ Idempotent: running it again keeps the data and re-applies the
//   schema. Migrations use IF NOT EXISTS / DROP+CREATE POLICY.
// ⭐ Two roles with different powers:
//   wasl_owner  owns the tables (setup path only)
//   wasl_app    runs the requests (no ownership, NOBYPASSRLS)
// ⛔ No cloud resource, no subscription, no public exposure: the
//   database listens on the local machine only.
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { createPool, ADMIN_STATEMENT_TIMEOUT_MS, type PgPool } from './pool.ts';
import { UnitOfWork } from './unit-of-work.ts';
import { hashPasscode } from '../auth/sessions.ts';

export const MIGRATIONS_DIR = path.join(import.meta.dirname, 'migrations');

export interface SetupOptions {
  readonly superuserUrl: string;
  readonly databaseName: string;
  readonly host: string;
  readonly port: number;
  readonly appPassword: string;
  readonly ownerPassword: string;
  readonly testPasscode: string;
}

export interface SetupReport {
  readonly steps: string[];
  readonly appRole: string;
  readonly ownerRole: string;
  readonly database: string;
}

function quoteIdent(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`unsafe identifier: ${value}`);
  }
  return `"${value}"`;
}

/** ⭐ Create the roles and the database (superuser connection). */
export async function ensureDatabase(options: SetupOptions): Promise<string[]> {
  const steps: string[] = [];
  const pool = createPool(options.superuserUrl, 2, { statementTimeoutMs: ADMIN_STATEMENT_TIMEOUT_MS });
  try {
    const existing = await pool.query<{ exists: boolean }>(
      `select exists(select 1 from pg_database where datname = $1) as exists`,
      [options.databaseName],
    );
    if (existing.rows[0]?.exists) {
      steps.push(`database ${options.databaseName} already exists`);
    } else {
      await pool.query(`create database ${quoteIdent(options.databaseName)}`);
      steps.push(`database ${options.databaseName} created`);
    }

    const roles = await pool.query<{ rolname: string }>(
      `select rolname from pg_roles where rolname in ('wasl_app','wasl_owner')`,
    );
    const present = new Set(roles.rows.map((row) => row.rolname));
    // Password literals cannot be bound as parameters in DDL, so the
    // client escapes them instead (no string concatenation of raw input).
    const client = await pool.connect();
    try {
      const ownerLiteral = client.escapeLiteral(options.ownerPassword);
      const appLiteral = client.escapeLiteral(options.appPassword);
      const ownerAttrs = 'login nosuperuser nobypassrls nocreatedb nocreaterole';
      if (!present.has('wasl_owner')) {
        await client.query(`create role wasl_owner ${ownerAttrs} password ${ownerLiteral}`);
        steps.push('role wasl_owner created');
      } else {
        await client.query(`alter role wasl_owner ${ownerAttrs} password ${ownerLiteral}`);
        steps.push('role wasl_owner password refreshed');
      }
      if (!present.has('wasl_app')) {
        await client.query(`create role wasl_app ${ownerAttrs} password ${appLiteral}`);
        steps.push('role wasl_app created');
      } else {
        await client.query(`alter role wasl_app ${ownerAttrs} password ${appLiteral}`);
        steps.push('role wasl_app password refreshed');
      }
    } finally {
      client.release();
    }
    // The schema grants must target the application database itself:
    // every database has its own `public` schema.
    const targetUrl = options.superuserUrl.replace(/\/[^/?]*(\?.*)?$/, `/${options.databaseName}$1`);
    const targetPool = createPool(targetUrl, 1, { statementTimeoutMs: ADMIN_STATEMENT_TIMEOUT_MS });
    try {
      await targetPool.query(`grant usage, create on schema public to wasl_owner`);
      await targetPool.query(`grant usage on schema public to wasl_app`);
      await targetPool.query(`revoke create on schema public from public`);
    } finally {
      await targetPool.end();
    }
    steps.push('schema public prepared for the owner role');
    return steps;
  } finally {
    await pool.end();
  }
}

/**
 * ⭐⭐⭐ THE KEY OF THE LOCK OF THE MIGRATIONS.
 * ⭐⭐ The schema of the database is ONE resource of the installation
 *   ⇒ ⭐⭐ and the migrations take locks on it ⇒ ⭐⭐ so two processes
 *   that apply the migrations at the same time DEADLOCK (the measured
 *   failure: `deadlock detected` · the code `40P01`).
 */
export const MIGRATION_LOCK_KEY = 0x5741_4d47; // "WAMG"

/**
 * ⭐ Apply every migration file (re-runnable).
 *
 * ⭐⭐⭐ WHY A LOCK (M-82 — the measured interference)
 *   ⭐⭐ The schema is a SHARED global resource: every process that
 *   starts the server applies the migrations ⇒ ⭐⭐ and four groups
 *   that run in parallel (the measurement of the phase) applied the
 *   same file at the same time ⇒ ⭐⭐ PostgreSQL answered
 *   `deadlock detected` (40P01) ⇒ ⭐⭐ and the drills that were
 *   starting died with it ⇒ ⭐⭐ the failure was measured, not
 *   guessed.
 *   ⭐⭐⭐ THE FIX: the migrations take a PostgreSQL ADVISORY LOCK ⇒
 *   ⭐⭐ the parallel starts are serialized ⇒ ⭐⭐ and the parallelism
 *   ⭐⭐ of the groups is NOT disabled (the rule of the owner: the
 *   ⭐⭐ interference is solved, not hidden).
 *   ⭐⭐⭐ THE LOCK IS SESSION LEVEL ⇒ ⭐⭐ the migration statements
 *   ⭐⭐ MUST run on the very connection that holds the lock ⇒ ⭐⭐
 *   ⭐⭐ and the unlock is in a `finally` ⇒ ⭐⭐ a failure never
 *   ⭐⭐ leaves the schema locked for the next process.
 */
export async function runMigrations(ownerPool: PgPool): Promise<string[]> {
  const steps: string[] = [];
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  // ⭐⭐ One connection for the lock AND the statements (the advisory
  //   lock belongs to the session that takes it).
  const client = await ownerPool.connect();
  try {
    await client.query(`select pg_advisory_lock($1)`, [MIGRATION_LOCK_KEY]);
    try {
      // ⭐⭐⭐ THE VERSIONS THAT ARE ALREADY APPLIED ⇐ ⭐⭐⭐ THE DDL RUNS
      //   ONCE, NOT BY EVERY PROCESS:
      //   ⭐⭐⭐ a file that is applied again takes an ACCESS EXCLUSIVE
      //   lock on its tables ⇒ ⭐⭐⭐ and the drills of the other groups
      //   are already running and hold locks on the same tables ⇒
      //   ⭐⭐⭐ PostgreSQL answers `deadlock detected` (40P01) ⇒ ⭐⭐⭐
      //   and the drill that was starting dies with it.
      //   ⭐⭐⭐ The measurement that proved it: four groups in parallel
      //   ⭐⭐⭐ ⇒ the `integration` group died four times and the
      //   ⭐⭐⭐ `security` group twice, all with the same code.
      //   ⭐⭐⭐ THE FIX: the applied versions are read UNDER the lock
      //   ⭐⭐⭐ (⇒ no race) and an applied file is SKIPPED ⇒ ⭐⭐⭐ the
      //   ⭐⭐⭐ schema is built once and the other processes only
      //   ⭐⭐⭐ verify it ⇒ ⭐⭐⭐ no DDL while the drills are live.
      const applied = new Set<string>();
      try {
        const rows = await client.query<{ version: string }>(
          `select version from wasl_schema_migrations`,
        );
        for (const row of rows.rows) applied.add(String(row.version));
      } catch {
        // ⭐⭐ The table of the versions does not exist yet ⇒ ⭐⭐ this is
        //   the first run ⇒ ⭐⭐ the files create it.
      }
      for (const file of files) {
        const version = file.replace(/\.sql$/, '');
        if (applied.has(version)) {
          steps.push(`migration already applied: ${file}`);
          continue;
        }
        const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
        await client.query(sql);
        steps.push(`migration applied: ${file}`);
      }
    } finally {
      await client.query(`select pg_advisory_unlock($1)`, [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
  return steps;
}

interface SeedTenant {
  readonly id: string;
  readonly name: string;
  readonly members: readonly { user: string; role: string; display: string }[];
  readonly customers: readonly { id: string; name: string; dataClass: string }[];
  readonly conversations: readonly { ref: string; customer: string; body: string }[];
}

const SEED_TENANTS: readonly SeedTenant[] = [
  {
    id: 'tnt_alpha',
    name: 'Alpha (synthetic company)',
    members: [
      { user: 'usr_alpha_owner', role: 'owner', display: 'Alpha Owner' },
      { user: 'usr_alpha_super', role: 'supervisor', display: 'Alpha Supervisor' },
      { user: 'usr_alpha_agent', role: 'agent', display: 'Alpha Agent' },
      { user: 'usr_alpha_viewer', role: 'viewer', display: 'Alpha Viewer' },
    ],
    customers: [
      { id: 'cus_alpha_1', name: 'Customer Alpha One', dataClass: 'standard' },
      { id: 'cus_alpha_2', name: 'Customer Alpha Two', dataClass: 'sensitive' },
    ],
    conversations: [
      {
        ref: 'conv_alpha_1',
        customer: 'cus_alpha_1',
        body: 'My invoice is wrong, I was charged twice this month.',
      },
    ],
  },
  {
    id: 'tnt_beta',
    name: 'Beta (synthetic company)',
    members: [
      { user: 'usr_beta_owner', role: 'owner', display: 'Beta Owner' },
      { user: 'usr_beta_agent', role: 'agent', display: 'Beta Agent' },
    ],
    customers: [{ id: 'cus_beta_1', name: 'Customer Beta One', dataClass: 'standard' }],
    conversations: [
      {
        ref: 'conv_beta_1',
        customer: 'cus_beta_1',
        body: 'The device I bought stopped working after two days.',
      },
    ],
  },
  {
    id: 'tnt_gamma',
    name: 'Gamma (synthetic company)',
    members: [
      { user: 'usr_gamma_owner', role: 'owner', display: 'Gamma Owner' },
      { user: 'usr_gamma_agent', role: 'agent', display: 'Gamma Agent' },
    ],
    customers: [{ id: 'cus_gamma_1', name: 'Customer Gamma One', dataClass: 'regulated' }],
    conversations: [],
  },
];

/**
 * ⭐ Insert the synthetic fixtures (re-runnable, no real data).
 * ⭐⭐ D-072 / M-82: the optional NAMESPACE of the companies.
 *   ⭐⭐ The rows of a company are keyed by the tenant ⇒ ⭐⭐ a company
 *     with another NAME (the namespace) is another set of rows ⇒ ⭐⭐
 *     two test files that use two namespaces can NEVER touch each
 *     other's data ⇒ ⭐⭐ the files run in parallel and stay apart.
 *   ⭐⭐ The users, the customers and the conversations keep their ids
 *     (they are tenant scoped) ⇒ ⭐⭐ a file does not change its
 *     expectations when it takes a namespace.
 *   ⛔ Without a namespace the behaviour is exactly as before ⇒ ⭐ the
 *     production setup (the default seed) is untouched.
 */
export async function seedDatabase(
  ownerPool: PgPool,
  testPasscode: string,
  namespace = '',
): Promise<string[]> {
  const steps: string[] = [];
  // ⭐⭐ The namespace reaches the ids that are GLOBAL keys:
  //   ⭐ the tenants · ⭐ the users · ⭐ the memberships · ⭐ the customers.
  //   ⭐ (the conversations and the messages are keyed by the tenant ⇒
  //   ⭐ they keep their ids.)
  const scoped = (id: string): string => (namespace === '' ? id : `${namespace}_${id}`);
  for (const seeded of SEED_TENANTS) {
    const tenant = {
      ...seeded,
      id: scoped(seeded.id),
      members: seeded.members.map((member) => ({
        ...member,
        user: scoped(member.user),
      })),
      customers: seeded.customers.map((customer) => ({
        ...customer,
        id: scoped(customer.id),
      })),
    };
    await UnitOfWork.run(ownerPool, tenant.id, async (uow) => {
      await uow.query(
        `insert into tenants (id, name, status, retention_profile) values ($1,$2,'active','synthetic-default')
         on conflict (id) do update set name = excluded.name`,
        [tenant.id, tenant.name],
      );
      for (const member of tenant.members) {
        await uow.query(
          `insert into users (id, display_name, email, status, passcode_hash)
           values ($1,$2,$3,'active',$4)
           on conflict (id) do update set display_name = excluded.display_name, status = 'active',
             passcode_hash = excluded.passcode_hash`,
          [
            member.user,
            member.display,
            `${member.user}@example.invalid`,
            hashPasscode(testPasscode),
          ],
        );
        await uow.query(
          `insert into memberships (id, tenant_id, user_id, role, status)
           values ($1,$2,$3,$4,'active')
           on conflict (tenant_id, user_id) do update set role = excluded.role, status = 'active'`,
          // ⭐ The membership id is built from the SCOPED user id ⇒ it is
          //   unique per namespace without a second prefix.
          [`mem_${member.user}`, tenant.id, member.user, member.role],
        );
      }
      for (const customer of tenant.customers) {
        await uow.query(
          `insert into customers (id, tenant_id, display_name, data_class) values ($1,$2,$3,$4)
           on conflict (id) do update set display_name = excluded.display_name, data_class = excluded.data_class`,
          [customer.id, tenant.id, customer.name, customer.dataClass],
        );
      }
      for (const conversation of tenant.conversations) {
        const existing = await uow.query(`select 1 from conversations where tenant_id = $1 and ref = $2`, [
          tenant.id,
          conversation.ref,
        ]);
        if (existing.rowCount === 0) {
          await uow.query(
            `insert into conversations (tenant_id, ref, customer_id, state, version, updated_at)
             values ($1,$2,$3,'new',1, now())`,
            [tenant.id, conversation.ref, scoped(conversation.customer)],
          );
          const messageRef = `msg_${conversation.ref}_seed`;
          await uow.query(
            `insert into messages (message_ref, tenant_id, conversation_ref, channel, direction, sender,
                                   recipient, body, occurred_at, locale, attributes, stored_at)
             values ($1,$2,$3,'web','inbound','customer@example.invalid','agent@example.invalid',$4, now(),'ar','{}'::jsonb, now())
             on conflict (tenant_id, message_ref) do nothing`,
            [messageRef, tenant.id, conversation.ref, conversation.body],
          );
        }
      }
      const policies: readonly [string, number, string][] = [
        ['standard', 30, 'retain'],
        ['sensitive', 90, 'delete'],
        ['regulated', 365, 'retain'],
      ];
      for (const [dataClass, days, onCancel] of policies) {
        await uow.query(
          `insert into retention_policies (tenant_id, data_class, retention_days, on_cancel)
           values ($1,$2,$3,$4)
           on conflict (tenant_id, data_class) do update
              set retention_days = excluded.retention_days, on_cancel = excluded.on_cancel`,
          [tenant.id, dataClass, days, onCancel],
        );
      }
    });
    steps.push(`tenant seeded: ${tenant.id}`);
  }
  return steps;
}

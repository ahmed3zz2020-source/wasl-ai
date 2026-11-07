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

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createPool, type PgPool } from './pool.ts';
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
  const pool = createPool(options.superuserUrl, 2);
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
    const targetPool = createPool(targetUrl, 1);
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

/** ⭐ Apply every migration file (re-runnable). */
export async function runMigrations(ownerPool: PgPool): Promise<string[]> {
  const steps: string[] = [];
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    await ownerPool.query(sql);
    steps.push(`migration applied: ${file}`);
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

/** ⭐ Insert the synthetic fixtures (re-runnable, no real data). */
export async function seedDatabase(ownerPool: PgPool, testPasscode: string): Promise<string[]> {
  const steps: string[] = [];
  for (const tenant of SEED_TENANTS) {
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
           on conflict (id) do update set display_name = excluded.display_name, status = 'active'`,
          [
            member.user,
            member.display,
            `${member.user}@example.invalid`,
            hashPasscode(testPasscode, crypto.createHash('sha256').update(member.user).digest('hex').slice(0, 32)),
          ],
        );
        await uow.query(
          `insert into memberships (id, tenant_id, user_id, role, status)
           values ($1,$2,$3,$4,'active')
           on conflict (tenant_id, user_id) do update set role = excluded.role, status = 'active'`,
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
            [tenant.id, conversation.ref, conversation.customer],
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

// ============================================================
// WASL AI — FOUNDATION BUILD 01 — test harness
// ------------------------------------------------------------
// ⭐ The harness prepares the LOCAL synthetic database and starts the
//   real API server on the loopback interface. The tests then talk to
//   it over HTTP, so nothing is mocked.
// ⛔ It needs the local credentials written by `npm run db:setup`.
// ⛔ Every tenant, user and message it creates is synthetic.
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, type ServerConfig } from '../../server/config.ts';
import { createPool, type PgPool } from '../../server/db/pool.ts';
import { UnitOfWork } from '../../server/db/unit-of-work.ts';
import { runMigrations, seedDatabase } from '../../server/db/setup.ts';
import { WaslApiServer } from '../../server/api/server.ts';
import { LocalApiClient } from '../../server/e2e/http-client.ts';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');

export interface Harness {
  readonly config: ServerConfig;
  readonly appPool: PgPool;
  readonly ownerPool: PgPool;
  readonly api: WaslApiServer;
  readonly client: LocalApiClient;
  readonly port: number;
  readonly stop: () => Promise<void>;
}

export class HarnessError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'HarnessError';
    this.code = code;
  }
}

function readCredentials(): { owner_password: string; app_password: string } {
  const file = path.join(ROOT, '.local', 'pg-credentials.json');
  if (!fs.existsSync(file)) {
    throw new HarnessError(
      'credentials_missing',
      'the local database credentials are missing - run `npm run db:setup` first',
    );
  }
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  const owner = parsed['owner_password'];
  const app = parsed['app_password'];
  if (typeof owner !== 'string' || typeof app !== 'string') {
    throw new HarnessError('credentials_invalid', 'the local database credentials are invalid');
  }
  return { owner_password: owner, app_password: app };
}

/** ⭐ Prepare the database (migrations + seed) and start the API. */
export async function startHarness(): Promise<Harness> {
  // ⭐ The test profile: the structured log is silent and the rate
  //   limit policy is the one of the test profile.
  const config = loadConfig(process.env, ROOT, { profile: 'test' });
  const credentials = readCredentials();
  // ⭐⭐ D-070: every test file is a process of its own, and the
  //   runner starts them in parallel. ⭐ Two files that bind the same
  //   port would fight, so every process takes its own BLOCK of
  //   ports: the base plus the few the drill opens beside it.
  const blockSize = 30;
  const basePort = 8791 + (process.pid % 400) * blockSize;
  const port = Number(process.env['WASL_TEST_PORT'] ?? String(basePort));
  const testConfig: ServerConfig = { ...config, port, host: '127.0.0.1' };

  const ownerPool = createPool(
    `postgresql://wasl_owner:${encodeURIComponent(credentials.owner_password)}@127.0.0.1:5432/${
      config.databaseName
    }`,
    4,
  );
  await runMigrations(ownerPool);
  await seedDatabase(ownerPool, config.testPasscode);

  const appPool = createPool(config.appDatabaseUrl, 6);
  // ⭐ A listener on the pool error: a broken connection must not raise
  //   an unhandled error inside the test runner.
  appPool.on('error', () => undefined);
  ownerPool.on('error', () => undefined);
  const api = new WaslApiServer({ config: testConfig, pool: appPool });
  const address = await api.listen();

  return {
    config: testConfig,
    appPool,
    ownerPool,
    api,
    client: new LocalApiClient('127.0.0.1', address.port),
    port: address.port,
    stop: async () => {
      await api.close();
      await appPool.end();
      await ownerPool.end();
    },
  };
}

/** ⭐ Wipe the synthetic rows of the three seeded tenants and re-seed them. */
export async function resetSyntheticData(ownerPool: PgPool, passcode: string): Promise<void> {
  for (const tenantId of ['tnt_alpha', 'tnt_beta', 'tnt_gamma']) {
    await UnitOfWork.run(ownerPool, tenantId, async (uow) => {
      await uow.query(`delete from messages where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from conversation_changes where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from read_audit_events where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from audit_events where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from conversations where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from customers where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from sessions where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from deletion_requests where tenant_id = $1`, [tenantId]);
    });
  }
  await seedDatabase(ownerPool, passcode);
}

export interface SyntheticTenant {
  readonly tenantId: string;
  readonly userId: string;
  readonly customerId: string;
}

/**
 * ⭐ Create a synthetic company with an owner and a customer.
 * ⛔ The passcode is the fixture one: nothing real is ever written.
 */
export async function createSyntheticTenant(
  ownerPool: PgPool,
  tenantId: string,
  passcode: string,
): Promise<SyntheticTenant> {
  const userId = `usr_${tenantId}_owner`;
  const customerId = `cus_${tenantId}_1`;
  const { hashPasscode } = await import('../../server/auth/sessions.ts');
  await UnitOfWork.run(ownerPool, tenantId, async (uow) => {
    await uow.query(
      `insert into tenants (id, name, status) values ($1,$2,'active')
       on conflict (id) do update set name = excluded.name, status = 'active'`,
      [tenantId, `Synthetic ${tenantId}`],
    );
    await uow.query(
      `insert into users (id, display_name, email, status, passcode_hash) values ($1,$2,$3,'active',$4)
       on conflict (id) do update set passcode_hash = excluded.passcode_hash, status = 'active'`,
      [userId, `Owner ${tenantId}`, `${userId}@example.invalid`, hashPasscode(passcode)],
    );
    await uow.query(
      `insert into memberships (id, tenant_id, user_id, role, status) values ($1,$2,$3,'owner','active')
       on conflict (tenant_id, user_id) do update set role = excluded.role, status = 'active'`,
      [`mem_${userId}`, tenantId, userId],
    );
    await uow.query(
      `insert into customers (id, tenant_id, display_name, data_class) values ($1,$2,$3,'standard')
       on conflict (id) do update set display_name = excluded.display_name`,
      [customerId, tenantId, `Customer ${tenantId}`],
    );
  });
  return { tenantId, userId, customerId };
}

/**
 * ⭐⭐ D-069 / M68: purge the synthetic evidence of a tenant.
 * ⭐ The evidence is IMMUTABLE (the guard refuses every UPDATE and
 *   every DELETE, even for the owner role), so the cleanup of the
 *   synthetic rows has to disable the guard ON PURPOSE. ⛔ This is
 *   the only path that may remove an evidence, and it is a test tool:
 *   the request path can never reach it.
 */
export async function purgeEvidence(
  ownerPool: PgPool,
  tenantId: string,
): Promise<void> {
  await ownerPool.query(
    `alter table tenant_deletion_evidence disable trigger tenant_deletion_evidence_immutable`,
  );
  try {
    await ownerPool.query(`delete from tenant_deletion_evidence where tenant_id = $1`, [tenantId]);
  } finally {
    await ownerPool.query(
      `alter table tenant_deletion_evidence enable trigger tenant_deletion_evidence_immutable`,
    );
  }
}

export async function loginAs(
  client: LocalApiClient,
  tenantId: string,
  userId: string,
  passcode: string,
): Promise<string> {
  const response = await client.request({
    method: 'POST',
    path: '/api/session',
    payload: { tenant_id: tenantId, user_id: userId, passcode },
  });
  const token = response.body['token'];
  if (response.status !== 200 || typeof token !== 'string') {
    throw new HarnessError('login_failed', `login failed for ${tenantId}/${userId}: ${response.status}`);
  }
  return token;
}

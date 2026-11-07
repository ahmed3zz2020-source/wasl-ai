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
  const config = loadConfig(process.env, ROOT);
  const credentials = readCredentials();
  const port = Number(process.env['WASL_TEST_PORT'] ?? '8791');
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
  const { UnitOfWork } = await import('../../server/db/unit-of-work.ts');
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

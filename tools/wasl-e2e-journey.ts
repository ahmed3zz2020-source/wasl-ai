// ============================================================
// WASL AI — FOUNDATION BUILD 01 — end to end journey command
// ------------------------------------------------------------
// ⭐ npm run e2e
// ⭐ Starts the local API (or uses a running one), drives the whole
//   journey through HTTP and prints every step with its evidence.
// ============================================================

import { loadConfig } from '../server/config.ts';
import { createPool } from '../server/db/pool.ts';
import { runMigrations, seedDatabase } from '../server/db/setup.ts';
import { WaslApiServer } from '../server/api/server.ts';
import { LocalApiClient } from '../server/e2e/http-client.ts';
import { runJourney } from '../server/e2e/journey.ts';

async function main(): Promise<void> {
  const config = loadConfig();
  // The journey must not depend on the order of the commands: the
  // privacy suite deletes the synthetic rows of a tenant, so the
  // migrations and the seed are applied before every journey run.
  const seedPool = createPool(config.ownerDatabaseUrl, 2);
  try {
    await runMigrations(seedPool);
    await seedDatabase(seedPool, config.testPasscode);
  } finally {
    await seedPool.end();
  }
  const external = process.env['WASL_SERVER_URL'];
  let api: WaslApiServer | null = null;
  let pool = createPool(config.appDatabaseUrl, 4);
  let port = config.port;

  if (!external) {
    api = new WaslApiServer({ config, pool });
    const address = await api.listen();
    port = address.port;
    process.stdout.write(`local api started on ${address.host}:${address.port}\n`);
  }

  const client = new LocalApiClient('127.0.0.1', port);
  const report = await runJourney({ client, passcode: config.testPasscode });

  for (const step of report.steps) {
    process.stdout.write(
      `${step.ok ? 'PASS' : 'FAIL'} ${String(step.step).padStart(2, ' ')}. ${step.title} (expected ${step.expected}, got ${step.status}) - ${step.detail}\n`,
    );
  }
  process.stdout.write(`\n${report.ok ? 'JOURNEY OK' : `JOURNEY FAILED (${report.failures.length})`}\n`);

  if (api) {
    await api.close();
    pool = createPool(config.appDatabaseUrl, 1);
  }
  await pool.end();
  if (!report.ok) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`journey failed: ${String((error as Error)?.message ?? error)}\n`);
  process.exitCode = 1;
});

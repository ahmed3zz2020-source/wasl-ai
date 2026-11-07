// ============================================================
// WASL AI — FOUNDATION BUILD 01 — database setup command
// ------------------------------------------------------------
// ⭐ One command to get a working local database:
//   npm run db:setup
// ⭐ It creates the two roles, applies the migrations and seeds the
//   synthetic fixtures. It is safe to run again.
// ⛔ The generated passwords are written to .local/ (git ignored), never
//   into the repository.
// ============================================================

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../server/config.ts';
import { createPool } from '../server/db/pool.ts';
import { ensureDatabase, runMigrations, seedDatabase } from '../server/db/setup.ts';

const ROOT = path.resolve(import.meta.dirname, '..');

async function main(): Promise<void> {
  const config = loadConfig(process.env, ROOT, { requirePassword: false });
  const superuserUrl =
    process.env['WASL_PG_SUPERUSER_URL'] ?? 'postgresql://postgres@127.0.0.1:5432/postgres';
  const appPassword = crypto.randomBytes(18).toString('base64url');
  const ownerPassword = crypto.randomBytes(18).toString('base64url');

  const steps = await ensureDatabase({
    superuserUrl,
    databaseName: config.databaseName,
    host: '127.0.0.1',
    port: Number(process.env['WASL_PG_PORT'] ?? '5432'),
    appPassword,
    ownerPassword,
    testPasscode: config.testPasscode,
  });

  const ownerUrl = `postgresql://wasl_owner:${encodeURIComponent(ownerPassword)}@127.0.0.1:${
    process.env['WASL_PG_PORT'] ?? '5432'
  }/${config.databaseName}`;
  const ownerPool = createPool(ownerUrl, 2);
  try {
    steps.push(...(await runMigrations(ownerPool)));
    steps.push(...(await seedDatabase(ownerPool, config.testPasscode)));
  } finally {
    await ownerPool.end();
  }

  const localDir = path.join(ROOT, '.local');
  fs.mkdirSync(localDir, { recursive: true });
  fs.writeFileSync(
    path.join(localDir, 'pg-credentials.json'),
    `${JSON.stringify(
      {
        app_password: appPassword,
        owner_password: ownerPassword,
        database: config.databaseName,
        test_passcode: config.testPasscode,
        note: 'local synthetic credentials - never commit this file',
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );

  for (const step of steps) process.stdout.write(`- ${step}\n`);
  process.stdout.write(`\ncredentials written to .local/pg-credentials.json (git ignored)\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`setup failed: ${String((error as Error)?.message ?? error)}\n`);
  process.exitCode = 1;
});

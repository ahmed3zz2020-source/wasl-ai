// ============================================================
// WASL AI — FOUNDATION BUILD 02 — PHASE 01 — rebuild from zero
// ------------------------------------------------------------
// ⭐ The proof that the environment can be rebuilt from nothing:
//   npm run db:rebuild -- --yes
// ⭐ It drops the local database, then runs the whole setup again:
//   the roles, the migrations and the synthetic fixtures.
// ⛔ It NEVER touches anything else: the PostgreSQL cluster stays, the
//   other databases stay, and the local credentials file is rewritten
//   with fresh passwords.
// ⛔ It refuses to run without the explicit `--yes`: it deletes the
//   local synthetic database.
// ⛔ The database holds synthetic fixtures only.
// ============================================================

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { loadConfig } from '../server/config.ts';
import { createPool, ADMIN_STATEMENT_TIMEOUT_MS } from '../server/db/pool.ts';
import { ensureDatabase, runMigrations, seedDatabase } from '../server/db/setup.ts';

const ROOT = path.resolve(import.meta.dirname, '..');

export interface RebuildReport {
  readonly steps: string[];
  readonly databaseName: string;
}

/** ⭐ Drop the local database and build it again from zero. */
export async function rebuildDatabase(root: string = ROOT): Promise<RebuildReport> {
  const config = loadConfig(process.env, root, { requirePassword: false });
  const superuserUrl =
    process.env['WASL_PG_SUPERUSER_URL'] ?? 'postgresql://postgres@127.0.0.1:5432/postgres';
  const appPassword = crypto.randomBytes(18).toString('base64url');
  const ownerPassword = crypto.randomBytes(18).toString('base64url');
  const steps: string[] = [];

  // ⭐ The database is dropped: the open connections are stopped first
  //   (a DROP DATABASE waits for them).
  const admin = createPool(superuserUrl, 2, { statementTimeoutMs: ADMIN_STATEMENT_TIMEOUT_MS });
  try {
    await admin.query(
      `select pg_terminate_backend(pid) from pg_stat_activity
        where datname = $1 and pid <> pg_backend_pid()`,
      [config.databaseName],
    );
    await admin.query(`drop database if exists "${config.databaseName}" with (force)`);
    steps.push(`database ${config.databaseName} dropped`);
  } finally {
    await admin.end();
  }

  steps.push(
    ...(await ensureDatabase({
      superuserUrl,
      databaseName: config.databaseName,
      host: '127.0.0.1',
      port: Number(process.env['WASL_PG_PORT'] ?? '5432'),
      appPassword,
      ownerPassword,
      testPasscode: config.testPasscode,
    })),
  );

  const ownerUrl = `postgresql://wasl_owner:${encodeURIComponent(ownerPassword)}@127.0.0.1:${
    process.env['WASL_PG_PORT'] ?? '5432'
  }/${config.databaseName}`;
  const ownerPool = createPool(ownerUrl, 2, { statementTimeoutMs: ADMIN_STATEMENT_TIMEOUT_MS });
  try {
    steps.push(...(await runMigrations(ownerPool)));
    steps.push(...(await seedDatabase(ownerPool, config.testPasscode)));
  } finally {
    await ownerPool.end();
  }

  // ⭐ The fresh credentials are written to `.local/` (git ignored).
  const localDir = path.join(root, '.local');
  fs.mkdirSync(localDir, { recursive: true });
  fs.writeFileSync(
    path.join(localDir, 'pg-credentials.json'),
    `${JSON.stringify(
      {
        host: '127.0.0.1',
        port: Number(process.env['WASL_PG_PORT'] ?? '5432'),
        database: config.databaseName,
        app_password: appPassword,
        owner_password: ownerPassword,
        generated_at: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  steps.push('credentials written to .local/pg-credentials.json');
  return { steps, databaseName: config.databaseName };
}

if (import.meta.filename === process.argv[1]) {
  if (!process.argv.includes('--yes')) {
    process.stderr.write(
      'this command DELETES the local synthetic database - run it with --yes\n',
    );
    process.exitCode = 1;
  } else {
    try {
      const report = await rebuildDatabase();
      for (const step of report.steps) process.stdout.write(`- ${step}\n`);
    } catch (error) {
      process.stderr.write(`rebuild failed: ${(error as Error).message}\n`);
      process.exitCode = 1;
    }
  }
}

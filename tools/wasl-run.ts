// ============================================================
// WASL AI — the ONE command that starts the service
// ------------------------------------------------------------
// ⭐ WHAT THIS IS: the command that makes the project RUNNING on a
//   machine, with the synthetic data of the seed, and that PROVES it
//   is running before it prints anything (it asks the health endpoint
//   of the service it just started).
//
// ⭐ THE COMMAND:
//     npm run start:local
//
// ⭐ WHAT IT DOES (in this order)
//   1) reads the configuration (the same one the server reads),
//   2) makes sure the database is there (the setup is idempotent ⇒
//      it is safe to run it again),
//   3) starts the API and the UI on 127.0.0.1 (loopback only),
//   4) WAITS for the health endpoint to answer 200 ⇒ ⇒ ⇒ so the
//      URLs it prints are PROVEN and not hoped for,
//   5) prints the box: the URLs, the synthetic login, the journey.
//
// ⛔ WHAT IT IS NOT
//   ⛔ It is not a deployment: the port is the loopback of the
//     machine ⇒ and nothing outside it can reach the service.
//   ⛔ It never writes a credential in the repository: the passwords
//     live in `.local/` (git ignored) and the seed is synthetic.
//   ⛔ It never touches the production: no domain, no provider, no
//     client data, no money.
//
// ⭐ THE EXIT CODES
//   0 ⇒ the service is running and the health endpoint answered 200,
//   1 ⇒ the service could not start (the reason is printed).
// ============================================================

import { spawn } from 'node:child_process';
import path from 'node:path';
import { loadConfig } from '../server/config.ts';
import { createPool } from '../server/db/pool.ts';
import { WaslApiServer } from '../server/api/server.ts';

const ROOT = path.resolve(import.meta.dirname, '..');

function line(text = ''): void {
  process.stdout.write(`${text}\n`);
}

function box(title: string, rows: string[]): void {
  const width = Math.max(title.length, ...rows.map((row) => row.length)) + 4;
  line('');
  line(`┌${'─'.repeat(width)}┐`);
  line(`│  ${title.padEnd(width - 4)}  │`);
  for (const row of rows) {
    line(`│  ${row.padEnd(width - 4)}  │`);
  }
  line(`└${'─'.repeat(width)}┘`);
}

/** ⭐⭐ Runs the database setup (idempotent) ⇒ it is safe to call it. */
async function ensureDatabase(): Promise<void> {
  line('→ the database (the setup is safe to repeat)…');
  const child = spawn(
    process.execPath,
    ['--experimental-strip-types', path.join(ROOT, 'tools', 'wasl-db-setup.ts')],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: process.env },
  );
  child.stdout.on('data', (chunk: Buffer) => process.stdout.write(`  ${chunk.toString()}`));
  child.stderr.on('data', (chunk: Buffer) => process.stderr.write(`  ${chunk.toString()}`));
  const code = await new Promise<number>((resolve) => {
    child.on('close', (value) => resolve(value ?? 1));
  });
  if (code !== 0) {
    throw new Error('the database setup failed ⇒ is PostgreSQL running?');
  }
}

/** ⭐⭐ The proof: the health endpoint of the service we just started. */
async function waitForHealth(url: string, attempts = 40): Promise<Record<string, unknown>> {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return (await response.json()) as Record<string, unknown>;
      }
    } catch {
      // ⭐ The service is not listening yet ⇒ we wait (and we do NOT guess).
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`the health endpoint did not answer within ${attempts * 250} ms`);
}

async function main(): Promise<void> {
  line('');
  line('⭐ WASL AI — starting the service (local · synthetic data · loopback only)');
  line('');

  const config = loadConfig(process.env, ROOT, { requirePassword: false });
  await ensureDatabase();

  const pool = createPool(config.appDatabaseUrl, 8);
  const api = new WaslApiServer({ config, pool });
  const address = await api.listen();
  const base = `http://${address.host}:${address.port}`;

  const health = await waitForHealth(`${base}/api/health`);

  box('THE SERVICE IS RUNNING ⭐ (the health endpoint answered 200)', [
    `the UI      → ${base}/ui/index.html`,
    `the inbox   → ${base}/ui/inbox.html`,
    `the tickets → ${base}/ui/tickets.html`,
    `the CRM     → ${base}/ui/crm.html`,
    `the health  → ${base}/api/health`,
    '',
    'the synthetic login: tenant tnt_alpha · user usr_alpha_owner',
    '                     passcode wasl-local-test',
    '',
    `the database: ${config.databaseName} · the schema ${String(health['schema_version'] ?? '?')}`,
    `the profile : ${String(health['profile'] ?? '?')} · the db ok: ${String(health['db_ok'] ?? '?')}`,
    '',
    'the journey (the proof that it works end to end): npm run e2e',
    'the whole suite (1034+ tests):            npm test',
    'to stop: Ctrl+C',
  ]);
  line('');
  line('⛔ the port is the loopback of this machine ⇒ nothing outside it can reach it.');
  line('⛔ a public run needs: a provider · a domain · the secrets · the owner signature.');
  line('');

  const shutdown = async (): Promise<void> => {
    await api.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((error: unknown) => {
  process.stderr.write(`the service did not start: ${String((error as Error)?.message ?? error)}\n`);
  process.exitCode = 1;
});

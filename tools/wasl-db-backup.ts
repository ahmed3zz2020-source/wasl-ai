// ============================================================
// WASL AI — FOUNDATION BUILD 02 — PHASE 01 — local backup
// ------------------------------------------------------------
// ⭐ One command to take a local backup of the synthetic database:
//   npm run db:backup
// ⭐ The dump is written in `.local/backups/` (git ignored) in the
//   custom format of PostgreSQL, so it can be restored with pg_restore.
// ⛔ It is a LOCAL drill: the dump never leaves the machine and it
//   never holds real data (the database holds synthetic fixtures).
// ⛔ The command fails closed: without a readable database it writes
//   nothing.
// ============================================================

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { loadConfig } from '../server/config.ts';


const ROOT = path.resolve(import.meta.dirname, '..');

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/** ⭐ The same connection, another database (the credentials stay). */
function withDatabase(url: string, databaseName: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

export interface BackupResult {
  readonly file: string;
  readonly bytes: number;
}

export function backupDirectory(root: string = ROOT): string {
  return path.join(root, '.local', 'backups');
}

/** ⭐ Take the backup (the dump file). */
export function runBackup(root: string = ROOT): BackupResult {
  // ⭐⭐ The dump runs with a PRIVILEGED connection. The tables have
  //   row level security FORCED, so a role that does not bypass RLS
  //   cannot read them without a tenant context: pg_dump would fail
  //   with "query would be affected by row-level security policy".
  //   ⛔ The privileged password comes from the environment only and
  //     is never written to the repository.
  //   ⭐ In a real deployment this role is a dedicated backup role
  //     with BYPASSRLS, never the application role.
  const superuserUrl =
    process.env['WASL_PG_SUPERUSER_URL'] ?? 'postgresql://postgres@127.0.0.1:5432/postgres';
  const config = loadConfig(process.env, root, { requirePassword: false });
  // ⭐ The dump is of the APPLICATION database (the superuser is only
  //   the role that may read the rows), never of the `postgres` one.
  const databaseUrl = withDatabase(superuserUrl, config.databaseName);
  const directory = backupDirectory(root);
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `wasl_local_${stamp()}.dump`);

  const result = spawnSync(
    'pg_dump',
    [
      `--dbname=${databaseUrl}`,
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      `--file=${file}`,
    ],
    { encoding: 'utf8' },
  );
  if (result.error || result.status !== 0) {
    throw new Error(`pg_dump failed: ${result.error?.message ?? result.stderr}`);
  }
  const bytes = fs.statSync(file).size;
  return { file, bytes };
}

if (import.meta.filename === process.argv[1]) {
  try {
    const result = runBackup();
    process.stdout.write(`backup written: ${result.file} (${result.bytes} bytes)\n`);
  } catch (error) {
    process.stderr.write(`backup failed: ${(error as Error).message}\n`);
    process.exitCode = 1;
  }
}

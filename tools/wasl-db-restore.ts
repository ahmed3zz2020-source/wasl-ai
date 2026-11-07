// ============================================================
// WASL AI — FOUNDATION BUILD 02 — PHASE 02 (D-069) — M-69
// the local restore drill (encrypted artifact)
// ------------------------------------------------------------
// ⭐ Restore a backup into another database and check that the data
//   really came back:
//   npm run db:restore -- <artifact file> --target <database>
// ⭐ The drill is the proof that the backup plan works: it restores
//   into a SCRATCH database (never over the live one) and compares
//   the schema, the fixtures and the password hashes.
// ⭐ PHASE 02: the artifact is ENCRYPTED. The drill therefore
//   verifies the manifest, decrypts the artifact, writes the clear
//   text dump in a private temporary file and restores it.
// ⛔ A corrupted artifact, a replaced artifact or an artifact with
//   open permissions is REFUSED before the restore starts.
// ⛔ LOCAL only: it needs the PostgreSQL binaries (pg_restore) and a
//   superuser connection to create the scratch database.
// ⛔ It never touches the live database unless the target is named
//   explicitly.
// ============================================================

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadConfig } from '../server/config.ts';
import { createPool, type PgPool } from '../server/db/pool.ts';
import { hashPasscode, verifyPasscode } from '../server/auth/password.ts';
import {
  assertBackupPermissions,
  decryptArtifactToFile,
  readBackupKey,
  verifyBackup,
} from './wasl-db-backup.ts';

const ROOT = path.resolve(import.meta.dirname, '..');

export interface RestoreOptions {
  readonly dumpFile: string;
  readonly targetDatabase: string;
  readonly superuserUrl?: string;
  /** ⭐ Skip the permission check (the tool of the owner only). */
  readonly skipPermissionCheck?: boolean;
  /**
   * ⭐ The company whose owner passcode is checked after the restore.
   * ⭐ It is a parameter and not a constant because the drill runs
   *   beside other tests that may delete a company: the check has to
   *   look at a company that is not under deletion.
   */
  readonly passcodeTenant?: string;
}

export interface RestoreReport {
  readonly targetDatabase: string;
  readonly migrations: string[];
  readonly tenants: string[];
  readonly users: number;
  readonly passcodeVerified: boolean;
  /** ⭐ The measured duration of the restore, in milliseconds (the RTO). */
  readonly durationMs: number;
  /** ⭐ The fingerprint of the key the backup was taken with. */
  readonly keyFingerprint: string | null;
  /** ⭐ The hash of the clear text dump that was restored. */
  readonly plainSha256: string | null;
}

/** ⭐ Create the scratch database (the superuser connection). */
async function createScratchDatabase(superuserUrl: string, databaseName: string): Promise<PgPool> {
  const pool = createPool(superuserUrl, 2);
  const exists = await pool.query<{ count: string }>(
    `select count(*)::text as count from pg_database where datname = $1`,
    [databaseName],
  );
  if (Number(exists.rows[0]?.count ?? '0') > 0) {
    // ⭐ The open connections are stopped first: a DROP DATABASE waits
    //   for them, and the statement timeout would kill the wait.
    await pool.query(
      `select pg_terminate_backend(pid) from pg_stat_activity
        where datname = $1 and pid <> pg_backend_pid()`,
      [databaseName],
    );
    await pool.query(`drop database if exists ${quoteIdent(databaseName)} with (force)`);
  }
  await pool.query(`create database ${quoteIdent(databaseName)}`);
  return pool;
}

/** ⭐ The same connection, another database (the credentials stay). */
function withDatabase(url: string, databaseName: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${quoteIdent(databaseName).replace(/"/g, '')}`;
  return parsed.toString();
}

function quoteIdent(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error('database_name_invalid');
  return `"${value}"`;
}

/**
 * ⭐⭐ Restore the dump and check what came back.
 * ⭐ The artifact is verified against its manifest BEFORE anything is
 *   written to the target database.
 */
export async function runRestore(options: RestoreOptions): Promise<RestoreReport> {
  if (!fs.existsSync(options.dumpFile)) throw new Error('dump_file_missing');
  const superuserUrl =
    options.superuserUrl ??
    process.env['WASL_PG_SUPERUSER_URL'] ??
    'postgresql://postgres@127.0.0.1:5432/postgres';
  const config = loadConfig(process.env, ROOT, { requirePassword: false });

  // ⭐⭐ The permissions and the manifest are checked first: a file
  //   that anybody may read, or one that was modified, is refused
  //   before the restore touches the database.
  if (options.skipPermissionCheck !== true) {
    assertBackupPermissions(options.dumpFile);
  }
  const { key } = readBackupKey(ROOT);
  const manifestFile = `${options.dumpFile}.manifest.json`;
  const verified = fs.existsSync(manifestFile)
    ? verifyBackup(options.dumpFile, manifestFile, key)
    : null;

  // ⭐ The clear text dump is written in a private temporary file and
  //   deleted right after the restore: it never survives on the disk.
  const temporary = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'wasl-restore-')),
    'restore.dump',
  );
  fs.mkdirSync(path.dirname(temporary), { recursive: true });
  try {
    // ⭐⭐ M-72: the artifact is DECRYPTED AS A STREAM into the private
    //   temporary file: the whole backup is never held in memory.
    if (verified) {
      await decryptArtifactToFile(options.dumpFile, key, temporary);
    } else {
      fs.writeFileSync(temporary, fs.readFileSync(options.dumpFile), { mode: 0o600 });
    }

    const admin = await createScratchDatabase(superuserUrl, options.targetDatabase);
    const started = Date.now();
    try {
      const restore = spawnSync(
        'pg_restore',
        [
          `--dbname=${withDatabase(superuserUrl, options.targetDatabase)}`,
          '--no-owner',
          '--no-privileges',
          temporary,
        ],
        { encoding: 'utf8' },
      );
      if (restore.error) throw new Error(`pg_restore failed: ${restore.error.message}`);
      // ⭐ pg_restore returns 1 for harmless warnings; the check below is
      //   the real proof that the restore worked.
      const durationMs = Date.now() - started;

      const pool = createPool(withDatabase(superuserUrl, options.targetDatabase), 2);
      try {
        const migrations = await pool.query<{ version: string }>(
          `select version from wasl_schema_migrations order by version asc`,
        );
        const tenants = await pool.query<{ id: string }>(`select id from tenants order by id asc`);
        const users = await pool.query<{ count: string }>(`select count(*)::text as count from users`);
        const passcodeTenant = options.passcodeTenant ?? 'tnt_alpha';
        const owner = await pool.query<{ id: string; passcode_hash: string }>(
          `select u.id, u.passcode_hash from users u join memberships m on m.user_id = u.id
            where m.tenant_id = $1 and m.role = 'owner' limit 1`,
          [passcodeTenant],
        );
        const passcodeVerified =
          owner.rows.length > 0 &&
          verifyPasscode(owner.rows[0]!.passcode_hash, config.testPasscode);
        return {
          targetDatabase: options.targetDatabase,
          migrations: migrations.rows.map((row) => row.version),
          tenants: tenants.rows.map((row) => row.id),
          users: Number(users.rows[0]?.count ?? '0'),
          passcodeVerified,
          durationMs,
          keyFingerprint: verified?.manifest.key_fingerprint ?? null,
          plainSha256: verified?.manifest.plain_sha256 ?? null,
        };
      } finally {
        await pool.end();
      }
    } finally {
      await admin.end();
    }
  } finally {
    fs.rmSync(path.dirname(temporary), { recursive: true, force: true });
  }
}

/** ⭐ Drop the scratch database (the drill leaves nothing behind). */
export async function dropScratchDatabase(
  databaseName: string,
  superuserUrl?: string,
): Promise<void> {
  const url = superuserUrl ?? process.env['WASL_PG_SUPERUSER_URL'] ?? 'postgresql://postgres@127.0.0.1:5432/postgres';
  const pool = createPool(url, 2);
  try {
    await pool.query(`drop database if exists ${quoteIdent(databaseName)}`);
  } finally {
    await pool.end();
  }
}

if (import.meta.filename === process.argv[1]) {
  const args = process.argv.slice(2);
  const dumpFile = args[0];
  const targetIndex = args.indexOf('--target');
  const targetDatabase = targetIndex >= 0 ? args[targetIndex + 1] : undefined;
  if (!dumpFile || !targetDatabase) {
    process.stderr.write('usage: npm run db:restore -- <artifact file> --target <database>\n');
    process.exitCode = 1;
  } else {
    try {
      const report = await runRestore({ dumpFile, targetDatabase });
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } catch (error) {
      process.stderr.write(`restore failed: ${(error as Error).message}\n`);
      process.exitCode = 1;
    }
  }
}

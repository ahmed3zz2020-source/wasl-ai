// ============================================================
// WASL AI — FOUNDATION BUILD 02 — PHASE 02 (D-069) — M-69
// the local backup (encrypted) and the manifest
// ------------------------------------------------------------
// ⭐ One command to take a local backup of the synthetic database:
//   npm run db:backup
// ⭐ What it does (PHASE 02):
//   1) the dump (pg_dump, custom format) in a clear text file,
//   2) the clear text file is ENCRYPTED (AES-256-GCM) and DELETED,
//   3) the encrypted artifact and its MANIFEST are written with the
//      mode 0600 (the owner only).
// ⭐ The manifest holds the hash of the clear text dump, the hash of
//   the encrypted artifact, the size, the schema version and the
//   fingerprint of the key: it is what makes a corrupted or a
//   replaced backup detectable.
// ⛔ It is a LOCAL drill: the dump never leaves the machine and it
//   never holds real data (the database holds synthetic fixtures).
// ⛔ No upload, no cloud service, no network call: the off-host copy
//   is a DESIGN (see docs/FOUNDATION-BUILD-02-PHASE-02-REPORT.md),
//   not a transfer that this tool performs.
// ⛔ The command fails closed: without a readable database it writes
//   nothing.
// ============================================================

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { loadConfig } from '../server/config.ts';
import {
  buildManifest,
  decryptArtifact,
  deriveKey,
  encryptArtifact,
  keyFingerprint,
  manifestPathOf,
  sha256,
  type BackupManifest,
} from '../server/backup/cipher.ts';

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
  readonly manifestFile: string;
  readonly bytes: number;
  readonly manifest: BackupManifest;
  /** ⭐ The measured duration of the dump, in milliseconds. */
  readonly durationMs: number;
}

export function backupDirectory(root: string = ROOT): string {
  return path.join(root, '.local', 'backups');
}

/** ⭐ The local key file (a synthetic local secret, never committed). */
export function backupKeyPath(root: string = ROOT): string {
  return path.join(root, '.local', 'backup.key');
}

/**
 * ⭐ Read the local backup key.
 * ⭐ The key comes from the environment (the operator) or from the
 *   local key file, which is created on demand with the mode 0600.
 * ⛔ The key is never written to a manifest and never committed.
 */
export function readBackupKey(root: string = ROOT): { key: Buffer; source: string } {
  const fromEnv = process.env['WASL_BACKUP_KEY'];
  if (typeof fromEnv === 'string' && fromEnv !== '') {
    return { key: deriveKey(fromEnv), source: 'environment' };
  }
  const file = backupKeyPath(root);
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (raw !== '') return { key: deriveKey(raw), source: 'local file' };
  }
  // ⭐ The local key is created on demand: it is a synthetic secret of
  //   the local machine, never a production credential.
  const generated = crypto.randomBytes(32).toString('base64url');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${generated}\n`, { mode: 0o600 });
  return { key: deriveKey(generated), source: 'local file (created)' };
}

/** ⭐ Take the backup (the encrypted artifact and its manifest). */
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
  const createdAt = stamp();
  const plainFile = path.join(directory, `wasl_local_${createdAt}.dump`);
  const artifactFile = `${plainFile}.enc`;

  const started = Date.now();
  const result = spawnSync(
    'pg_dump',
    [
      `--dbname=${databaseUrl}`,
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      `--file=${plainFile}`,
    ],
    { encoding: 'utf8' },
  );
  if (result.error || result.status !== 0) {
    throw new Error(`pg_dump failed: ${result.error?.message ?? result.stderr}`);
  }
  const durationMs = Date.now() - started;

  // ⭐⭐ The clear text dump is read, encrypted and DELETED: only the
  //   encrypted artifact stays on the disk.
  const plain = fs.readFileSync(plainFile);
  const { key } = readBackupKey(root);
  const artifact = encryptArtifact(plain, key);
  fs.writeFileSync(artifactFile, artifact, { mode: 0o600 });
  fs.rmSync(plainFile, { force: true });

  const schemaVersion = readSchemaVersion(databaseUrl);
  const manifest = buildManifest({
    database: config.databaseName,
    schemaVersion,
    plain,
    artifact,
    key,
    dumpDurationMs: durationMs,
  });
  const manifestFile = manifestPathOf(artifactFile);
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

  return { file: artifactFile, manifestFile, bytes: artifact.length, manifest, durationMs };
}

/** ⭐ The version of the schema of the dumped database. */
function readSchemaVersion(databaseUrl: string): string | null {
  const result = spawnSync(
    'psql',
    [`--dbname=${databaseUrl}`, '--tuples-only', '--no-align', '-c',
      'select version from wasl_schema_migrations order by applied_at desc limit 1'],
    { encoding: 'utf8' },
  );
  if (result.error || result.status !== 0) return null;
  const value = result.stdout.trim();
  return value === '' ? null : value;
}

/**
 * ⭐⭐ Verify an artifact against its manifest.
 * ⛔ A mismatch raises: a corrupted or a replaced backup is refused
 *   before it is ever restored.
 */
export function verifyBackup(
  artifactFile: string,
  manifestFile: string,
  key: Buffer,
): { manifest: BackupManifest; plainBytes: number } {
  if (!fs.existsSync(artifactFile)) throw new Error('backup_artifact_missing');
  if (!fs.existsSync(manifestFile)) throw new Error('backup_manifest_missing');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as BackupManifest;
  const artifact = fs.readFileSync(artifactFile);
  if (sha256(artifact) !== manifest.artifact_sha256) {
    throw new Error('backup_artifact_hash_mismatch');
  }
  const plain = decryptArtifact(artifact, key);
  if (sha256(plain) !== manifest.plain_sha256) {
    throw new Error('backup_plain_hash_mismatch');
  }
  return { manifest, plainBytes: plain.length };
}

/**
 * ⭐⭐ Check the access permissions of a backup artifact.
 * ⛔ A file that anybody may read is refused: the dump holds the whole
 *   database.
 */
export function assertBackupPermissions(artifactFile: string): void {
  const mode = fs.statSync(artifactFile).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error(`backup_permissions_are_too_open: ${mode.toString(8)}`);
  }
}

if (import.meta.filename === process.argv[1]) {
  try {
    const result = runBackup();
    process.stdout.write(`backup written: ${result.file} (${result.bytes} bytes)\n`);
    process.stdout.write(`manifest written: ${result.manifestFile}\n`);
    process.stdout.write(`key fingerprint: ${result.manifest.key_fingerprint}\n`);
    process.stdout.write(`dump duration: ${result.durationMs} ms\n`);
  } catch (error) {
    process.stderr.write(`backup failed: ${(error as Error).message}\n`);
    process.exitCode = 1;
  }
}

// ============================================================
// WASL AI — FOUNDATION BUILD 03 / PHASE 01 (D-070) — M-72
// the local backup (streamed, encrypted, published atomically)
// ------------------------------------------------------------
// ⭐ One command to take a local backup of the synthetic database:
//   npm run db:backup
// ⭐⭐ WHAT IT DOES (M-72):
//   1) the dump of the database is READ AS A STREAM (pg_dump writes to
//      its standard output, never to a file),
//   2) the stream is ENCRYPTED chunk by chunk (AES-256-GCM) and only
//      the encrypted bytes are written to the disk,
//   3) the encrypted result is written to a TEMPORARY file with the
//      mode 0600, flushed, and then PUBLISHED with an atomic rename,
//   4) the manifest is published the same way,
//   5) the published artifact is VERIFIED by reading it back, so a
//      broken backup can never be reported as a success.
// ⭐⭐ THE PROPERTY THAT MATTERS: no clear text dump of the database
//   ever exists as a file on the disk, not even for a moment.
// ⛔ A failure of pg_dump, of the cipher or of the process removes the
//   temporary file and writes no manifest: a partial copy is never
//   published and never reported as a success.
// ⛔ It is a LOCAL drill: the dump never leaves the machine and it
//   never holds real data (the database holds synthetic fixtures).
// ⛔ No upload, no cloud service, no network call: the off-host copy
//   is a DESIGN (see docs/FOUNDATION-BUILD-02-PHASE-02-REPORT.md),
//   not a transfer that this tool performs.
// ⛔ The command fails closed: without a readable database it writes
//   nothing.
// ============================================================

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { loadConfig } from '../server/config.ts';
import {
  BACKUP_MAGIC,
  BACKUP_MAGIC_V2,
  buildStreamingManifest,
  createArtifactDecryptor,
  createArtifactEncryptor,
  deriveKey,
  keyFingerprint,
  manifestPathOf,
  type BackupManifest,
} from '../server/backup/cipher.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const CHUNK_LIMIT = 1024 * 1024;

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
  /** ⭐ The measured size of the clear text dump, in bytes. */
  readonly plainBytes: number;
  /** ⭐ The artifact was read back and verified after it was published. */
  readonly verified: boolean;
}

export interface BackupOptions {
  /**
   * ⭐⭐ A TEST SEAM: the backup throws once this many clear text bytes
   *   have been streamed. It reproduces a failure in the MIDDLE of the
   *   copy (a disk that fills up, a process that is killed) without
   *   touching the real code path.
   */
  readonly abortAfterBytes?: number;
  /**
   * ⭐⭐ A TEST SEAM: the backup throws right BEFORE the artifact is
   *   published. It reproduces a failure AFTER the copy is complete
   *   (the disk that fills up between the copy and the publication).
   */
  readonly failBeforePublish?: boolean;
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

/** ⭐ Write every byte of the buffer to the descriptor. */
function writeAll(fd: number, data: Buffer): void {
  let offset = 0;
  while (offset < data.length) {
    offset += fs.writeSync(fd, data, offset, data.length - offset);
  }
}

/** ⭐ Remove a file and ignore the case where it is already gone. */
function removeQuietly(file: string): void {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // ⛔ The temporary file stays encrypted on the disk: it is never
    //   a clear text dump, so a failure here is not a leak.
  }
}

/**
 * ⭐⭐ Take the backup: the dump is streamed, encrypted on the way and
 *   published atomically.
 * ⛔ Nothing but the encrypted bytes ever reach the disk.
 */
export async function runBackup(
  root: string = ROOT,
  options: BackupOptions = {},
): Promise<BackupResult> {
  // ⭐⭐ The dump runs with a PRIVILEGED connection. The tables have
  //   row level security FORCED, so a role that does not bypass RLS
  //   cannot read them without a tenant context: pg_dump would fail
  //   with "query would be affected by row-level security policy".
  // ⛔ The privileged password comes from the environment only and
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
  const artifactFile = path.join(directory, `wasl_local_${createdAt}.dump.enc`);
  const temporaryFile = `${artifactFile}.partial`;
  const manifestFile = manifestPathOf(artifactFile);
  const temporaryManifest = `${manifestFile}.partial`;

  const { key } = readBackupKey(root);
  const encryptor = createArtifactEncryptor(key);
  const plainHash = crypto.createHash('sha256');
  const artifactHash = crypto.createHash('sha256');
  let plainBytes = 0;
  let artifactBytes = 0;

  // ⭐ The temporary file is created with the mode 0600 and the flag
  //   "wx": it never overwrites an existing file.
  const fd = fs.openSync(temporaryFile, 'wx', 0o600);
  let published = false;
  const started = Date.now();

  const cleanup = (): void => {
    try {
      fs.closeSync(fd);
    } catch {
      // the descriptor may already be closed
    }
    if (!published) removeQuietly(temporaryFile);
  };

  // ⭐⭐ An interruption removes the temporary file: the process is
  //   stopped, so nothing is left half written on the disk.
  const onSignal = (): void => {
    cleanup();
    process.exit(130);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    // ⭐⭐ The header (the magic and the iv) opens the artifact: it is
    //   written before the content, so a reader knows the layout.
    artifactHash.update(encryptor.header);
    artifactBytes += encryptor.header.length;
    writeAll(fd, encryptor.header);

    // ⭐⭐ The dump goes to the standard output: no file is created by
    //   pg_dump, so no clear text dump ever touches the disk.
    const child = spawn(
      'pg_dump',
      [
        `--dbname=${databaseUrl}`,
        '--format=custom',
        '--no-owner',
        '--no-privileges',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < 4000) stderr += chunk;
    });

    const failure = await new Promise<Error | null>((resolve, reject) => {
      let settled = false;
      const settle = (error: Error | null): void => {
        if (settled) return;
        settled = true;
        resolve(error);
      };
      child.on('error', (error: Error) => {
        settle(new Error(`pg_dump failed to start: ${error.message}`));
      });
      child.on('close', (code: number | null) => {
        if (code === 0) settle(null);
        else settle(new Error(`pg_dump failed with code ${String(code)}: ${stderr.trim()}`));
      });

      // ⭐⭐ The stream of the dump is encrypted on the way: the chunks
      //   are never assembled in memory and never written in clear.
      child.stdout.on('data', (chunk: Buffer) => {
        try {
          plainHash.update(chunk);
          plainBytes += chunk.length;
          const encrypted = encryptor.update(chunk);
          artifactHash.update(encrypted);
          artifactBytes += encrypted.length;
          writeAll(fd, encrypted);
          if (
            options.abortAfterBytes !== undefined &&
            plainBytes >= options.abortAfterBytes
          ) {
            child.stdout.destroy();
            child.kill('SIGKILL');
            settle(new Error('backup_aborted_in_the_middle'));
          }
        } catch (error) {
          child.stdout.destroy();
          child.kill('SIGKILL');
          settle(error instanceof Error ? error : new Error(String(error)));
        }
      });
      child.stdout.on('error', (error: Error) => settle(error));
    });

    if (failure) throw failure;

    // ⭐ The cipher is closed: the last block and the authentication
    //   tag are written, so the artifact is complete.
    const tail = encryptor.finalize();
    artifactHash.update(tail);
    artifactBytes += tail.length;
    writeAll(fd, tail);

    // ⭐ The bytes are on the disk before the file is published.
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    const durationMs = Date.now() - started;

    const schemaVersion = await readSchemaVersion(databaseUrl);
    const manifest = buildStreamingManifest({
      database: config.databaseName,
      schemaVersion,
      plainSha256: plainHash.digest('hex'),
      artifactSha256: artifactHash.digest('hex'),
      plainBytes,
      artifactBytes,
      key,
      dumpDurationMs: durationMs,
    });

    // ⭐⭐ The publication is ATOMIC: the temporary file becomes the
    //   artifact with a single rename, so a reader never sees a half
    //   written artifact.
    if (options.failBeforePublish === true) {
      throw new Error('backup_failed_before_the_publication');
    }
    fs.renameSync(temporaryFile, artifactFile);
    published = true;

    // ⭐⭐ The manifest is published the same way.
    fs.writeFileSync(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporaryManifest, manifestFile);

    // ⭐⭐ The published artifact is read back and verified: a backup
    //   that cannot be read back is not a success.
    await verifyBackupStreaming(artifactFile, manifestFile, key);

    return {
      file: artifactFile,
      manifestFile,
      bytes: artifactBytes,
      manifest,
      durationMs,
      plainBytes,
      verified: true,
    };
  } catch (error) {
    cleanup();
    removeQuietly(temporaryManifest);
    throw error;
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }
}

/** ⭐ The version of the schema of the dumped database. */
async function readSchemaVersion(databaseUrl: string): Promise<string | null> {
  const child = spawn(
    'psql',
    [`--dbname=${databaseUrl}`, '--tuples-only', '--no-align', '-c',
      'select version from wasl_schema_migrations order by applied_at desc limit 1'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    output += chunk;
  });
  const code = await new Promise<number | null>((resolve) => {
    child.on('error', () => resolve(null));
    child.on('close', (value: number | null) => resolve(value));
  });
  if (code !== 0) return null;
  const value = output.trim();
  return value === '' ? null : value;
}

/**
 * ⭐⭐ Verify an artifact against its manifest WITHOUT loading it.
 * ⭐ The artifact is read in chunks: the hash of the encrypted bytes
 *   and the hash of the clear text bytes are both measured while the
 *   file streams, so the memory use does not depend on the size of the
 *   backup.
 * ⛔ A mismatch raises: a corrupted or a replaced backup is refused
 *   before it is ever restored.
 */
export async function verifyBackupStreaming(
  artifactFile: string,
  manifestFile: string,
  key: Buffer,
): Promise<{ manifest: BackupManifest; plainBytes: number; artifactBytes: number }> {
  if (!fs.existsSync(artifactFile)) throw new Error('backup_artifact_missing');
  if (!fs.existsSync(manifestFile)) throw new Error('backup_manifest_missing');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as BackupManifest;
  const fd = fs.openSync(artifactFile, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const head = Buffer.alloc(8);
    fs.readSync(fd, head, 0, 8, 0);
    const magic = head.toString('ascii');
    const artifactHash = crypto.createHash('sha256');
    const plainHash = crypto.createHash('sha256');
    let plainBytes = 0;

    const readAt = (position: number, length: number): Buffer => {
      const buffer = Buffer.alloc(length);
      const read = fs.readSync(fd, buffer, 0, length, position);
      return read === length ? buffer : buffer.subarray(0, read);
    };

    let iv: Buffer;
    let tag: Buffer;
    let bodyStart: number;
    let bodyEnd: number;
    if (magic === BACKUP_MAGIC_V2) {
      iv = readAt(8, 12);
      tag = readAt(size - 16, 16);
      bodyStart = 20;
      bodyEnd = size - 16;
    } else if (magic === BACKUP_MAGIC) {
      iv = readAt(8, 12);
      tag = readAt(20, 16);
      bodyStart = 36;
      bodyEnd = size;
    } else {
      throw new Error('backup_artifact_not_encrypted');
    }
    artifactHash.update(head);
    artifactHash.update(iv);
    if (magic === BACKUP_MAGIC) artifactHash.update(tag);

    const decryptor = createArtifactDecryptor(key, { iv, tag });
    const buffer = Buffer.alloc(CHUNK_LIMIT);
    let position = bodyStart;
    while (position < bodyEnd) {
      const wanted = Math.min(CHUNK_LIMIT, bodyEnd - position);
      const read = fs.readSync(fd, buffer, 0, wanted, position);
      if (read <= 0) break;
      const chunk = buffer.subarray(0, read);
      artifactHash.update(chunk);
      const plain = decryptor.update(chunk);
      plainHash.update(plain);
      plainBytes += plain.length;
      position += read;
    }
    if (magic === BACKUP_MAGIC_V2) {
      artifactHash.update(tag);
    }
    const last = decryptor.finalize();
    plainHash.update(last);
    plainBytes += last.length;

    if (artifactHash.digest('hex') !== manifest.artifact_sha256) {
      throw new Error('backup_artifact_hash_mismatch');
    }
    if (plainHash.digest('hex') !== manifest.plain_sha256) {
      throw new Error('backup_plain_hash_mismatch');
    }
    if (plainBytes !== manifest.plain_bytes) {
      throw new Error('backup_plain_size_mismatch');
    }
    return { manifest, plainBytes, artifactBytes: size };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * ⭐⭐ Verify an artifact against its manifest.
 * ⛔ A mismatch raises: a corrupted or a replaced backup is refused
 *   before it is ever restored.
 * ⭐ This is the BUFFER form: it is kept for the small artifacts and
 *   for the callers that need the plain bytes. The backup path uses
 *   the streaming verification above.
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
  if (crypto.createHash('sha256').update(artifact).digest('hex') !== manifest.artifact_sha256) {
    throw new Error('backup_artifact_hash_mismatch');
  }
  const plain = decryptArtifactBuffer(artifact, key);
  if (crypto.createHash('sha256').update(plain).digest('hex') !== manifest.plain_sha256) {
    throw new Error('backup_plain_hash_mismatch');
  }
  return { manifest, plainBytes: plain.length };
}

/** ⭐ Decrypt a whole artifact that is held in memory. */
function decryptArtifactBuffer(artifact: Buffer, key: Buffer): Buffer {
  const header = 8;
  if (artifact.length < header + 12 + 16) throw new Error('backup_artifact_truncated');
  const magic = artifact.subarray(0, header).toString('ascii');
  if (magic === BACKUP_MAGIC_V2) {
    const iv = artifact.subarray(header, header + 12);
    const tag = artifact.subarray(artifact.length - 16);
    const body = artifact.subarray(header + 12, artifact.length - 16);
    const decryptor = createArtifactDecryptor(key, { iv, tag });
    return Buffer.concat([decryptor.update(body), decryptor.finalize()]);
  }
  if (magic !== BACKUP_MAGIC) throw new Error('backup_artifact_not_encrypted');
  const iv = artifact.subarray(header, header + 12);
  const tag = artifact.subarray(header + 12, header + 12 + 16);
  const body = artifact.subarray(header + 12 + 16);
  const decryptor = createArtifactDecryptor(key, { iv, tag });
  return Buffer.concat([decryptor.update(body), decryptor.finalize()]);
}

/**
 * ⭐⭐ Decrypt an artifact into a file WITHOUT loading it in memory.
 * ⭐ The clear text is written to a private temporary file (the mode
 *   0600) that the caller removes right after the restore.
 * ⭐ The bytes are streamed, so the memory use does not depend on the
 *   size of the backup.
 * ⭐ The returned number is the size of the clear text that was written.
 */
export async function decryptArtifactToFile(
  artifactFile: string,
  key: Buffer,
  outFile: string,
): Promise<number> {
  const fdIn = fs.openSync(artifactFile, 'r');
  const fdOut = fs.openSync(outFile, 'wx', 0o600);
  try {
    const size = fs.fstatSync(fdIn).size;
    const head = Buffer.alloc(8);
    fs.readSync(fdIn, head, 0, 8, 0);
    const magic = head.toString('ascii');
    const readAt = (position: number, length: number): Buffer => {
      const buffer = Buffer.alloc(length);
      const read = fs.readSync(fdIn, buffer, 0, length, position);
      return read === length ? buffer : buffer.subarray(0, read);
    };
    let iv: Buffer;
    let tag: Buffer;
    let bodyStart: number;
    let bodyEnd: number;
    if (magic === BACKUP_MAGIC_V2) {
      iv = readAt(8, 12);
      tag = readAt(size - 16, 16);
      bodyStart = 20;
      bodyEnd = size - 16;
    } else if (magic === BACKUP_MAGIC) {
      iv = readAt(8, 12);
      tag = readAt(20, 16);
      bodyStart = 36;
      bodyEnd = size;
    } else {
      throw new Error('backup_artifact_not_encrypted');
    }
    const decryptor = createArtifactDecryptor(key, { iv, tag });
    const buffer = Buffer.alloc(CHUNK_LIMIT);
    let position = bodyStart;
    let plainBytes = 0;
    while (position < bodyEnd) {
      const wanted = Math.min(CHUNK_LIMIT, bodyEnd - position);
      const read = fs.readSync(fdIn, buffer, 0, wanted, position);
      if (read <= 0) break;
      const plain = decryptor.update(buffer.subarray(0, read));
      writeAll(fdOut, plain);
      plainBytes += plain.length;
      position += read;
    }
    const last = decryptor.finalize();
    writeAll(fdOut, last);
    plainBytes += last.length;
    fs.fsyncSync(fdOut);
    return plainBytes;
  } finally {
    fs.closeSync(fdIn);
    fs.closeSync(fdOut);
  }
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
    const result = await runBackup();
    process.stdout.write(`backup written: ${result.file} (${result.bytes} bytes)\n`);
    process.stdout.write(`manifest written: ${result.manifestFile}\n`);
    process.stdout.write(`key fingerprint: ${result.manifest.key_fingerprint}\n`);
    process.stdout.write(`dump duration: ${result.durationMs} ms\n`);
    process.stdout.write(`verified: ${result.verified}\n`);
  } catch (error) {
    process.stderr.write(`backup failed: ${(error as Error).message}\n`);
    process.exitCode = 1;
  }
}

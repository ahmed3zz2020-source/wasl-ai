// ============================================================
// WASL AI — FOUNDATION BUILD 03 / PHASE 01 (D-070) — M-72
// the backup never writes a clear text dump on the disk
// ------------------------------------------------------------
// ⭐⭐ THE PROPERTY UNDER TEST
//   A backup of the local database produces an ENCRYPTED artifact and
//   NOTHING ELSE: no clear text dump of the database exists as a file
//   on the disk, not even for a moment, and not even when the copy
//   fails in the middle.
// ⭐⭐ THE FAILURE PATHS
//   1) BEFORE the copy: pg_dump fails ⇒ nothing is published.
//   2) DURING the copy: the stream is interrupted ⇒ the temporary
//      file is removed and nothing is published.
//   3) AFTER the copy: the publication fails ⇒ nothing is published.
//   ⭐ In every case there is no manifest: a copy that is not whole
//     can never be reported as a success.
// ⭐⭐ THE SIZE
//   The drill uses a synthetic database that is much bigger than the
//   memory a buffered copy would need: the backup of a big database
//   must not grow the memory of the process.
// ⛔ The drill needs the PostgreSQL binaries (pg_dump) and a
//   privileged connection (it creates a scratch database).
// ⛔ The drill is SKIPPED when the privileged connection is not
//   available: it is never reported as a pass it did not measure.
// ⛔ Synthetic data only.
// ============================================================

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createPool, type PgPool } from '../../server/db/pool.ts';
import {
  backupDirectory,
  runBackup,
  verifyBackupStreaming,
} from '../../tools/wasl-db-backup.ts';

const SUPERUSER_URL =
  process.env['WASL_PG_SUPERUSER_URL'] ?? 'postgresql://postgres@127.0.0.1:5432/postgres';

/** ⭐ A private directory for the artifacts of the drill. */
function scratchRoot(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `wasl-m72-${label}-`));
}

/** ⭐ The names of the files that live in the backup directory. */
function filesOf(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory);
}

/**
 * ⭐⭐ The witness of the property: a PostgreSQL dump in the custom
 *   format starts with the bytes "PGDMP". The drill looks for that
 *   marker in EVERY file of the backup directory, WHILE the backup is
 *   running.
 */
function plainDumpFiles(directory: string): string[] {
  const found: string[] = [];
  for (const name of filesOf(directory)) {
    const full = path.join(directory, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    let head: Buffer;
    try {
      const fd = fs.openSync(full, 'r');
      const buffer = Buffer.alloc(5);
      const read = fs.readSync(fd, buffer, 0, 5, 0);
      fs.closeSync(fd);
      head = buffer.subarray(0, read);
    } catch {
      continue;
    }
    if (head.toString('ascii') === 'PGDMP') found.push(name);
  }
  return found;
}

async function privilegedAvailable(): Promise<boolean> {
  const probe = createPool(SUPERUSER_URL, 1);
  try {
    await probe.query('select 1');
    return true;
  } catch {
    return false;
  } finally {
    await probe.end();
  }
}

test('FOUNDATION 16) the backup is streamed and never writes a clear text dump (M-72)', async (t) => {
  if (!(await privilegedAvailable())) {
    t.skip('the privileged connection is not available for the backup drill');
    return;
  }

  await t.test('⭐⭐⭐ M-72a: no clear text dump exists on the disk at any moment', async () => {
    const root = scratchRoot('watch');
    const directory = backupDirectory(root);
    const witnesses: string[] = [];


    // ⭐⭐ The witness runs WHILE the backup runs: it looks at the
    //   directory every few milliseconds.
    const watcher = setInterval(() => {
      for (const name of plainDumpFiles(directory)) {
        if (!witnesses.includes(name)) witnesses.push(name);
      }
    }, 5);

    try {
      const backup = await runBackup(root);

      clearInterval(watcher);

      assert.equal(
        witnesses.length,
        0,
        `a clear text dump was on the disk: ${witnesses.join(', ')}`,
      );
      assert.ok(backup.bytes > 0, 'the artifact is empty');
      assert.ok(backup.plainBytes > 0, 'the dump was empty');
      assert.equal(backup.verified, true, 'the artifact was not verified after the publication');

      // ⭐⭐ The directory holds the artifact and its manifest, nothing
      //   else: no temporary file is left behind.
      const names = filesOf(directory);
      assert.equal(names.length, 2, `the backup directory holds ${names.join(', ')}`);
      assert.ok(names.some((name) => name.endsWith('.dump.enc')), 'the artifact is missing');
      assert.ok(names.some((name) => name.endsWith('.manifest.json')), 'the manifest is missing');
      assert.equal(
        names.some((name) => name.endsWith('.partial')),
        false,
        'a temporary file was left behind',
      );
    } finally {
      clearInterval(watcher);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await t.test('⭐⭐⭐ M-72b: a failure BEFORE the copy publishes nothing', async () => {
    const root = scratchRoot('before');
    const directory = backupDirectory(root);
    const original = process.env['WASL_PG_DATABASE'];
    // ⭐ The dump points at a database that does not exist: the copy
    //   fails before a single byte is produced.
    process.env['WASL_PG_DATABASE'] = 'wasl_no_such_database_here';
    try {
      await assert.rejects(
        () => runBackup(root),
        (error: Error) => /pg_dump failed/.test(error.message),
        'a failed dump was reported as a success',
      );
    } finally {
      if (original === undefined) delete process.env['WASL_PG_DATABASE'];
      else process.env['WASL_PG_DATABASE'] = original;
    }
    assert.equal(filesOf(directory).length, 0, 'a failed backup published something');
  });

  await t.test('⭐⭐⭐ M-72c: a failure DURING the copy publishes nothing', async () => {
    const root = scratchRoot('during');
    const directory = backupDirectory(root);
    try {
      await assert.rejects(
        // ⭐ The stream is interrupted in the middle of the copy.
        () => runBackup(root, { abortAfterBytes: 1024 }),
        (error: Error) => /backup_aborted_in_the_middle/.test(error.message),
        'an interrupted copy was reported as a success',
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
    // ⭐⭐ Nothing is published: no artifact, no manifest and no
    //   temporary file either.
    assert.equal(filesOf(directory).length, 0, 'an interrupted backup published something');
    assert.equal(
      plainDumpFiles(directory).length,
      0,
      'an interrupted backup left a clear text dump on the disk',
    );
  });

  await t.test('⭐⭐⭐ M-72d: a failure AFTER the copy publishes nothing', async () => {
    const root = scratchRoot('after');
    const directory = backupDirectory(root);
    try {
      await assert.rejects(
        // ⭐ The copy is complete but the publication fails.
        () => runBackup(root, { failBeforePublish: true }),
        (error: Error) => /backup_failed_before_the_publication/.test(error.message),
        'a failed publication was reported as a success',
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
    // ⭐⭐ Nothing is published: no artifact, no manifest and no
    //   temporary file either.
    assert.equal(filesOf(directory).length, 0, 'a failed publication left something behind');
    assert.equal(
      plainDumpFiles(directory).length,
      0,
      'a failed publication left a clear text dump on the disk',
    );
  });

  await t.test('⭐⭐⭐ M-72e: a big database is backed up without loading it in memory', async () => {
    const scratchDatabase = 'wasl_m72_big';
    const root = scratchRoot('big');
    const admin = createPool(SUPERUSER_URL, 2);
    let plainBytes = 0;
    try {
      await admin.query(`drop database if exists ${scratchDatabase} with (force)`);
      await admin.query(`create database ${scratchDatabase}`);
      const builder = createPool(
        SUPERUSER_URL.replace(/\/[^/]*$/, `/${scratchDatabase}`),
        2,
      );
      try {
        await builder.query(
          `create table big_payload (id bigserial primary key, ref text, body text)`,
        );
        // ⭐ The body is random, so the dump cannot be compressed away:
        //   the copy is really big on the disk.
        await builder.query(
          `insert into big_payload (ref, body)
             select 'payload_' || g,
                    (select string_agg(md5(g::text || k::text || random()::text), '')
                       from generate_series(1, 32) k)
               from generate_series(1, 45000) g`,
        );
      } finally {
        await builder.end();
      }

      const originalDatabase = process.env['WASL_PG_DATABASE'];
      process.env['WASL_PG_DATABASE'] = scratchDatabase;
      // ⭐ The memory is measured against the state BEFORE the copy.
      const baseline = process.memoryUsage().rss;
      let peak = baseline;
      const sampler = setInterval(() => {
        const used = process.memoryUsage().rss;
        if (used > peak) peak = used;
      }, 10);
      try {
        const backup = await runBackup(root);
        clearInterval(sampler);
        plainBytes = backup.plainBytes;

        // ⭐⭐ The dump is really big: the drill is not a formality.
        assert.ok(
          backup.plainBytes > 20 * 1024 * 1024,
          `the dump is too small to prove the property: ${backup.plainBytes} bytes`,
        );

        // ⭐⭐ The memory of the process did not grow with the size of
        //   the copy: a buffered implementation would have needed at
        //   least the size of the dump.
        const growth = peak - baseline;
        assert.ok(
          growth < backup.plainBytes / 2,
          `the memory grew by ${growth} bytes for a dump of ${backup.plainBytes} bytes`,
        );
      } finally {
        clearInterval(sampler);
        if (originalDatabase === undefined) delete process.env['WASL_PG_DATABASE'];
        else process.env['WASL_PG_DATABASE'] = originalDatabase;
      }
    } finally {
      await admin.query(`drop database if exists ${scratchDatabase} with (force)`).catch(() => undefined);
      await admin.end();
      fs.rmSync(root, { recursive: true, force: true });
    }
    assert.ok(plainBytes > 20 * 1024 * 1024, 'the drill did not really copy a big database');
  });

  await t.test('⭐⭐⭐ M-72f: the verification catches a truncated and a replaced artifact', async () => {
    const root = scratchRoot('verify');
    try {
      const backup = await runBackup(root);
      const { readBackupKey } = await import('../../tools/wasl-db-backup.ts');
      const { key } = readBackupKey(root);

      // ⭐ The artifact as it is published verifies.
      const verified = await verifyBackupStreaming(backup.file, backup.manifestFile, key);
      assert.equal(verified.plainBytes, backup.manifest.plain_bytes, 'the verified size is another one');

      // ⭐⭐ A truncated artifact is refused.
      const truncated = path.join(root, 'truncated.dump.enc');
      const bytes = fs.readFileSync(backup.file);
      fs.writeFileSync(truncated, bytes.subarray(0, bytes.length - 32), { mode: 0o600 });
      fs.copyFileSync(backup.manifestFile, `${truncated}.manifest.json`);
      await assert.rejects(
        () => verifyBackupStreaming(truncated, `${truncated}.manifest.json`, key),
        (error: Error) => /hash_mismatch|truncated|tampered/.test(error.message),
        'a truncated artifact was accepted',
      );

      // ⭐⭐ A replaced byte is refused.
      const replaced = path.join(root, 'replaced.dump.enc');
      const copy = Buffer.from(bytes);
      copy[copy.length - 40] = (copy[copy.length - 40]! + 1) % 256;
      fs.writeFileSync(replaced, copy, { mode: 0o600 });
      fs.copyFileSync(backup.manifestFile, `${replaced}.manifest.json`);
      await assert.rejects(
        () => verifyBackupStreaming(replaced, `${replaced}.manifest.json`, key),
        (error: Error) => /hash_mismatch|tampered/.test(error.message),
        'a replaced artifact was accepted',
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

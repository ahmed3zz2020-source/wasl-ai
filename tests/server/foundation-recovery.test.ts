// ============================================================
// WASL AI — FOUNDATION BUILD 02 — PHASE 02 (D-069)
// M-69: the backup, the encryption and the restore drill
// ------------------------------------------------------------
// ⭐ WHY THIS FILE EXISTS
//   In PHASE 01 the backup was a plain dump on the disk and there was
//   no integrity check: a corrupted or a replaced dump was restored as
//   if it were good, and the file held a copy of the whole database
//   that anybody could read.
// ⭐ THE PROPERTIES UNDER TEST
//   - the artifact is encrypted and the clear text file is gone,
//   - the manifest matches the artifact (the hashes, the schema
//     version and the fingerprint of the key),
//   - a corrupted artifact is REFUSED before the database is touched,
//   - a file with open permissions is refused,
//   - the restore really brings the data back and its duration is
//     measured (the RTO of the drill).
// ⛔ The drill needs the PostgreSQL binaries and a privileged
//   connection: when they are missing the drill is SKIPPED, and the
//   skip is visible in the report of the run.
// ⛔ Local synthetic database only. Nothing leaves the machine.
// ============================================================

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assertBackupPermissions,
  readBackupKey,
  runBackup,
  verifyBackup,
} from '../../tools/wasl-db-backup.ts';
import { dropScratchDatabase, runRestore } from '../../tools/wasl-db-restore.ts';
import { runVerify } from '../../tools/wasl-db-verify.ts';
import { createSyntheticTenant, purgeEvidence, startHarness } from './harness.ts';

const SUPERUSER_URL =
  process.env['WASL_PG_SUPERUSER_URL'] ?? 'postgresql://postgres@127.0.0.1:5432/postgres';

test('FOUNDATION 15) the backup, the encryption and the restore drill (M-69)', async (t) => {
  const scratch = 'wasl_recovery_drill';

  // ⭐ The drill needs a privileged connection (CREATE DATABASE). When
  //   the local server refuses it, the drill is SKIPPED and not failed.
  const probe = await import('../../server/db/pool.ts');
  let privileged = probe.createPool(SUPERUSER_URL, 1);
  let available = true;
  try {
    await privileged.query('select 1');
  } catch {
    available = false;
  } finally {
    await privileged.end();
  }
  if (!available) {
    t.skip('the privileged connection is not available for the restore drill');
    return;
  }

  // ⭐⭐ The drill owns a company of its own: the other test files
  //   may delete a company while the drill runs, and the check of the
  //   restored passcode must not depend on a company under deletion.
  const harness = await startHarness();
  const drillTenant = 'tnt_b02p2_backup';
  await purgeEvidence(harness.ownerPool, drillTenant);
  await createSyntheticTenant(
    harness.ownerPool,
    drillTenant,
    process.env['WASL_TEST_PASSCODE'] ?? 'wasl-local-test',
  );

  const temporary: string[] = [];
  t.after(async () => {
    await harness.stop();
    for (const file of temporary) {
      fs.rmSync(file, { force: true });
      fs.rmSync(`${file}.manifest.json`, { force: true });
    }
    await dropScratchDatabase(scratch, SUPERUSER_URL);
  });

  await t.test('⭐⭐⭐ M-69a: the artifact is encrypted and the manifest matches', async () => {
    const backup = runBackup();
    temporary.push(backup.file);

    // ⭐ The artifact is encrypted: it does not start with the magic
    //   bytes of a PostgreSQL dump.
    const artifact = fs.readFileSync(backup.file);
    assert.equal(artifact.subarray(0, 8).toString('ascii'), 'WLSLBK01', 'the artifact is not encrypted');
    assert.notEqual(
      artifact.subarray(0, 5).toString('ascii'),
      'PGDMP',
      'the artifact is a plain dump',
    );

    // ⭐ The clear text dump is GONE: only the encrypted artifact stays.
    const plainFile = backup.file.replace(/\.enc$/, '');
    assert.equal(fs.existsSync(plainFile), false, 'the clear text dump is still on the disk');

    // ⭐ The file is private.
    assertBackupPermissions(backup.file);
    const mode = fs.statSync(backup.file).mode & 0o777;
    assert.equal(mode & 0o077, 0, `the artifact is readable by others: ${mode.toString(8)}`);

    // ⭐ The manifest matches the artifact.
    const report = runVerify(backup.file);
    assert.equal(report.verified, true, 'the verification failed');
    assert.equal(report.manifest, backup.manifestFile, 'the verification read another manifest');
    assert.equal(report.keyFingerprint, backup.manifest.key_fingerprint, 'the key is another one');
    assert.equal(
      report.schemaVersion,
      backup.manifest.schema_version,
      'the manifest holds another schema version',
    );
    assert.ok(report.schemaVersion, 'the manifest holds no schema version');
  });

  await t.test('⭐⭐⭐ M-69b: the restore brings the data back and is measured', async () => {
    const backup = runBackup();
    temporary.push(backup.file);
    try {
      const report = await runRestore({
        dumpFile: backup.file,
        targetDatabase: scratch,
        superuserUrl: SUPERUSER_URL,
        passcodeTenant: drillTenant,
      });
      assert.ok(
        report.migrations.includes('005_phase02_evidence_integrity'),
        `the restored schema misses a migration: ${report.migrations.join(', ')}`,
      );
      assert.ok(report.tenants.includes(drillTenant), 'the company of the drill did not come back');
      assert.equal(report.passcodeVerified, true, 'the restored hash does not verify');
      // ⭐ The duration is measured: it is the RTO of the drill.
      assert.ok(report.durationMs > 0, 'the restore was not measured');
      assert.equal(report.plainSha256, backup.manifest.plain_sha256, 'the restored hash is another one');
    } finally {
      await dropScratchDatabase(scratch, SUPERUSER_URL);
    }
  });

  await t.test('⭐⭐⭐ M-69c: a corrupted artifact is refused', async () => {
    const backup = runBackup();
    temporary.push(backup.file);

    // ⭐⭐ One byte of the artifact is changed: the manifest hash does
    //   not match any more and the restore must refuse BEFORE it
    //   touches the database.
    const corrupted = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'wasl-corrupt-')),
      'corrupted.dump.enc',
    );
    const bytes = fs.readFileSync(backup.file);
    bytes[bytes.length - 1] = (bytes[bytes.length - 1]! + 1) % 256;
    fs.writeFileSync(corrupted, bytes, { mode: 0o600 });
    fs.copyFileSync(backup.manifestFile, `${corrupted}.manifest.json`);
    temporary.push(corrupted);

    let verifyCode = 'none';
    try {
      runVerify(corrupted);
    } catch (error) {
      verifyCode = (error as Error).message;
    }
    assert.equal(
      verifyCode,
      'backup_artifact_hash_mismatch',
      `the corrupted artifact was accepted: ${verifyCode}`,
    );

    let restoreCode = 'none';
    try {
      await runRestore({
        dumpFile: corrupted,
        targetDatabase: scratch,
        superuserUrl: SUPERUSER_URL,
      });
    } catch (error) {
      restoreCode = (error as Error).message;
    }
    assert.equal(
      restoreCode,
      'backup_artifact_hash_mismatch',
      `the corrupted artifact was restored: ${restoreCode}`,
    );

    // ⭐ The scratch database was never created: the restore refused
    //   before it touched the database.
    const check = await probe.createPool(SUPERUSER_URL, 1);
    try {
      const rows = await check.query<{ count: string }>(
        `select count(*)::text as count from pg_database where datname = $1`,
        [scratch],
      );
      assert.equal(Number(rows.rows[0]?.count ?? '0'), 0, 'the refused restore created the database');
    } finally {
      await check.end();
    }
  });

  await t.test('⭐⭐⭐ M-69d: an artifact with open permissions is refused', async () => {
    const backup = runBackup();
    temporary.push(backup.file);

    // ⭐ The artifact is made readable by everybody.
    fs.chmodSync(backup.file, 0o644);
    let code = 'none';
    try {
      assertBackupPermissions(backup.file);
    } catch (error) {
      code = (error as Error).message;
    }
    assert.ok(
      code.startsWith('backup_permissions_are_too_open'),
      `the open permissions were accepted: ${code}`,
    );
    fs.chmodSync(backup.file, 0o600);
  });

  await t.test('⭐⭐ M-69e: a replaced artifact is detected', async () => {
    const backup = runBackup();
    temporary.push(backup.file);

    // ⭐ The artifact of ANOTHER backup is put in place: the manifest
    //   does not match it any more.
    const other = runBackup();
    temporary.push(other.file);
    const original = fs.readFileSync(backup.file);
    fs.writeFileSync(backup.file, fs.readFileSync(other.file), { mode: 0o600 });

    let code = 'none';
    try {
      verifyBackup(backup.file, backup.manifestFile, readBackupKey().key);
    } catch (error) {
      code = (error as Error).message;
    }
    assert.equal(
      code,
      'backup_artifact_hash_mismatch',
      `the replaced artifact was accepted: ${code}`,
    );
    fs.writeFileSync(backup.file, original, { mode: 0o600 });
  });
});

// ============================================================
// WASL AI — FOUNDATION BUILD 02 — PHASE 01
// M-04: the backup and the restore drill
// ------------------------------------------------------------
// ⭐ THE PROPERTY UNDER TEST
//   A backup of the local database can be restored into another
//   database and the data really comes back: the schema, the
//   migrations, the fixtures and the password hashes.
// ⭐ The drill uses the real PostgreSQL binaries (pg_dump / pg_restore)
//   against the real local database.
// ⛔ The scratch database is dropped afterwards: the drill leaves
//   nothing behind and it never touches the live database.
// ⛔ The drill is SKIPPED when the superuser connection is not
//   available (it needs CREATE DATABASE).
// ⛔ Synthetic data only.
// ============================================================

import assert from 'node:assert/strict';
import test from 'node:test';

import { runBackup } from '../../tools/wasl-db-backup.ts';
import { dropScratchDatabase, runRestore } from '../../tools/wasl-db-restore.ts';

const SUPERUSER_URL =
  process.env['WASL_PG_SUPERUSER_URL'] ?? 'postgresql://postgres@127.0.0.1:5432/postgres';

test('FOUNDATION 11) the backup and the restore drill (M-04)', async (t) => {
  const scratch = 'wasl_restore_drill';

  // ⭐ The drill needs a privileged connection (CREATE DATABASE). When
  //   the local server refuses it, the drill is SKIPPED and not failed:
  //   the rest of the suite does not depend on it.
  const probe = await import('../../server/db/pool.ts');
  let privileged = probe.createPool(SUPERUSER_URL, 1);
  try {
    await privileged.query('select 1');
  } catch {
    await privileged.end();
    t.skip('the privileged connection is not available for the restore drill');
    return;
  } finally {
    await privileged.end();
  }

  await t.test('⭐⭐ M-04a: the backup is written and the restore brings the data back', async () => {
    const backup = runBackup();
    assert.ok(backup.bytes > 0, 'the backup file is empty');

    try {
      const report = await runRestore({
        dumpFile: backup.file,
        targetDatabase: scratch,
        superuserUrl: SUPERUSER_URL,
      });
      // ⭐ The schema came back with every migration.
      assert.ok(
        report.migrations.includes('003_phase01_security'),
        `the restored schema misses a migration: ${report.migrations.join(', ')}`,
      );
      // ⭐ The fixtures came back.
      assert.ok(report.tenants.includes('tnt_alpha'), 'the seeded company did not come back');
      assert.ok(report.tenants.includes('tnt_beta'), 'the seeded company did not come back');
      assert.ok(report.users >= 7, `the restored database holds ${report.users} users`);
      // ⭐ The password hashes came back and still verify: the backup
      //   holds the derived value, never the passcode.
      assert.equal(report.passcodeVerified, true, 'the restored hash does not verify');
    } finally {
      await dropScratchDatabase(scratch, SUPERUSER_URL);
    }
  });

  await t.test('⭐⭐ M-04b: the drill leaves nothing behind', async () => {
    const check = await runRestore({
      dumpFile: runBackup().file,
      targetDatabase: scratch,
      superuserUrl: SUPERUSER_URL,
    });
    assert.ok(check.tenants.length >= 3, 'the scratch database is empty');
    await dropScratchDatabase(scratch, SUPERUSER_URL);

    // ⭐ The scratch database is gone: the drill is repeatable.
    const admin = await import('../../server/db/pool.ts');
    const pool = admin.createPool(SUPERUSER_URL, 2);
    try {
      const rows = await pool.query<{ count: string }>(
        `select count(*)::text as count from pg_database where datname = $1`,
        [scratch],
      );
      assert.equal(Number(rows.rows[0]?.count ?? '0'), 0, 'the scratch database was left behind');
    } finally {
      await pool.end();
    }
  });
});

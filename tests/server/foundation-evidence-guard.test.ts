// ============================================================
// WASL AI — D-074 / M-100 — the guard of the deletion evidence
// ------------------------------------------------------------
// ⭐⭐⭐ THE QUESTION: `alter table ... disable trigger` switches the
//   guard off for the WHOLE TABLE ⇒ ⇒ ⇒ so between the `disable` and
//   the `enable` the evidence of EVERY company is unprotected ⇒ ⇒ ⇒
//   ⇒ ⇒ and an unauthorized change could slip through.
// ⭐⭐⭐ THE CLAIM OF THE FIX: the `disable`, the work and the
//   `enable` live in ONE transaction ⇒ ⇒ ⇒
//   ① the ALTER holds ACCESS EXCLUSIVE on the table for the whole
//      transaction ⇒ ⇒ ⇒ any other session that writes WAITS ⇒ ⇒ ⇒
//      ⇒ ⇒ nobody ever observes the guard as off;
//   ② a crash rolls the transaction back ⇒ ⇒ ⇒ the `disable` is undone
//      BY POSTGRESQL ⇒ ⇒ ⇒ the guard returns by itself.
// ⭐⭐⭐ THE PROOF (each one is measured, not read):
//   ① a concurrent writer is REFUSED while the purge is in flight;
//   ② the guard is restored after a SUCCESS;
//   ③ the guard is restored after an EXCEPTION;
//   ④ the guard is restored after the BACKEND is terminated;
//   ⑤ the guard is restored after the PROCESS is killed (SIGKILL).
// ⛔ It uses the local synthetic database only.
// ============================================================

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createPool, type PgPool } from '../../server/db/pool.ts';
import { purgeEvidence, startHarness, superuserUrl } from '../server/harness.ts';

const HARNESS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'server',
  'harness.ts',
);

/** ⭐⭐ Is the guard ON right now? */
async function guardState(pool: PgPool): Promise<string> {
  const result = await pool.query<{ tgenabled: string }>(
    `select tgenabled from pg_trigger where tgname = 'tenant_deletion_evidence_immutable'`,
  );
  return String(result.rows[0]?.tgenabled ?? 'missing');
}

/** ⭐⭐ Write a row of evidence that the guard will protect. */
async function seedEvidence(
  pool: PgPool,
  tenantId: string,
  requestId: string,
): Promise<void> {
  const userId = `usr_${tenantId}_m100`;
  await pool.query(
    `insert into users (id, display_name, email, status, passcode_hash)
     values ($1, $2, $3, 'active', 'not-used-here')
     on conflict (id) do update set status = 'active'`,
    [userId, `M-100 evidence`, `${userId}@example.invalid`],
  );
  await pool.query(
    `insert into tenants (id, name, status) values ($1, $2, 'active')
     on conflict (id) do update set status = 'active'`,
    [tenantId, `Synthetic ${tenantId}`],
  );
  await pool.query(
    `insert into deletion_requests (id, tenant_id, requested_by, scope, status, executed_at)
     values ($1, $2, $3, 'tenant_data', 'executed', now())
     on conflict (id) do update set status = 'executed'`,
    [requestId, tenantId, userId],
  );
  // ⭐⭐ The trigger of the INSERT computes the hash ⇒ ⇒ the row is
  // ⭐⭐ born with the right content (and it is refused if the request
  // ⭐⭐ is not in the executed state ⇒ ⇒ the drill is honest).
  await pool.query(
    `insert into tenant_deletion_evidence
       (id, tenant_id, request_id, scope, requested_by, executed_by, removed, occurred_at)
     values ($1, $2, $3, 'tenant_data', $4, $4, '{"messages":0}'::jsonb, now())`,
    [`evd_${requestId}`, tenantId, requestId, userId],
  );
}

test('FOUNDATION 04) the guard of the deletion evidence (M-100)', async (t) => {
  const harness = await startHarness();
  t.after(async () => {
    await harness.stop();
  });
  const admin = createPool(superuserUrl(harness.config.databaseName), 4);
  // ⭐⭐ A listener on the pool error: the termination of a backend
  // ⭐⭐ (M-100d) breaks a connection ⇒ ⇒ and an EventEmitter without a
  // ⭐⭐ listener turns it into an unhandled error that stops the run.
  admin.on('error', () => undefined);
  t.after(async () => {
    await admin.end();
  });

  await t.test('⭐⭐⭐ M-100a: the guard is restored after a SUCCESS', async () => {
    const tenantId = `m100-a-${Date.now()}`;
    const requestId = `m100-a-req-${Date.now()}`;
    await seedEvidence(admin, tenantId, requestId);
    assert.equal(await guardState(admin), 'O', 'the guard was not on before the purge');
    await purgeEvidence(admin, tenantId);
    assert.equal(await guardState(admin), 'O', 'the guard is not on after the purge');
    const left = await admin.query<{ count: string }>(
      `select count(*)::text as count from tenant_deletion_evidence where tenant_id = $1`,
      [tenantId],
    );
    assert.equal(left.rows[0]?.count, '0', 'the purge did not remove the evidence');
  });

  await t.test('⭐⭐⭐ M-100b: an EXCEPTION restores the guard AND the row', async () => {
    const tenantId = `m100-b-${Date.now()}`;
    const requestId = `m100-b-req-${Date.now()}`;
    await seedEvidence(admin, tenantId, requestId);
    await assert.rejects(
      () =>
        purgeEvidence(admin, tenantId, async () => {
          throw new Error('M-100: the crash of the middle of the purge');
        }),
      'the failure of the middle of the purge was swallowed',
    );
    assert.equal(await guardState(admin), 'O', 'the guard is not on after the failure');
    const left = await admin.query<{ count: string }>(
      `select count(*)::text as count from tenant_deletion_evidence where tenant_id = $1`,
      [tenantId],
    );
    assert.equal(
      left.rows[0]?.count,
      '1',
      'the rollback did not restore the evidence ⇒ the purge was not atomic',
    );
  });

  await t.test('⭐⭐⭐ M-100c: a CONCURRENT writer is refused while the purge is in flight', async () => {
    const tenantId = `m100-c-${Date.now()}`;
    const requestId = `m100-c-req-${Date.now()}`;
    await seedEvidence(admin, tenantId, requestId);
    // ⭐⭐⭐ THE ROW OF ANOTHER COMPANY: the purge of the company above
    // ⭐⭐⭐ does NOT touch it ⇒ ⇒ ⇒ so a write that succeeds on it is
    // ⭐⭐⭐ ⇒ ⇒ ⇒ really an UNAUTHORIZED write ⇒ ⇒ ⇒ and it is the
    // ⭐⭐⭐ ⇒ ⇒ ⇒ one that must be impossible.
    const otherTenant = `m100-c-other-${Date.now()}`;
    const otherRequest = `m100-c-other-req-${Date.now()}`;
    await seedEvidence(admin, otherTenant, otherRequest);

    const writer = createPool(superuserUrl(harness.config.databaseName), 1);
    writer.on('error', () => undefined);
    let writerStarted = false;
    let writerDone = false;
    let writerError = '';
    try {
      const writing = (async () => {
        const client = await writer.connect();
        try {
          await client.query(`set lock_timeout = '3s'`);
          writerStarted = true;
          await client.query(
            `update tenant_deletion_evidence set scope = 'tampered' where request_id = $1`,
            [otherRequest],
          );
        } catch (error: unknown) {
          writerError = (error as Error).message;
        } finally {
          // ⭐⭐ the client goes back to the pool ALWAYS ⇒ ⇒ ⇒ the pool
          // ⭐⭐ can be closed at the end of the drill.
          client.release();
          writerDone = true;
        }
      })();
      // ⭐⭐ The purge runs with the guard OFF inside its transaction ⇒
      // ⭐⭐ and the writer tries to write during that window.
      await purgeEvidence(admin, tenantId, async () => {
        for (let i = 0; i < 60 && !writerStarted; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        assert.ok(writerStarted, 'the writer did not start');
        await new Promise((resolve) => setTimeout(resolve, 800));
        // ⭐⭐⭐ THE PROOF, IN THE WINDOW: the writer is BLOCKED ⇒ ⇒ ⇒
        // ⭐⭐⭐ it did NOT go through while the guard was off ⇒ ⇒ ⇒
        // ⭐⭐⭐ ⇒ ⇒ ⇒ nobody can observe the guard as off.
        assert.equal(
          writerDone,
          false,
          'the unauthorized write went through WHILE the guard was off',
        );
      });
      await writing;
      assert.ok(writerDone, 'the writer did not finish');
      // ⭐⭐⭐ AND AFTER THE PURGE: the guard is back ⇒ ⇒ ⇒ the write is
      // ⭐⭐⭐ refused by the trigger itself.
      assert.notEqual(writerError, '', 'the unauthorized write SUCCEEDED');
      const left = await admin.query<{ scope: string }>(
        `select scope from tenant_deletion_evidence where request_id = $1`,
        [otherRequest],
      );
      assert.equal(
        left.rows[0]?.scope,
        'tenant_data',
        'the unauthorized write changed the evidence of another company',
      );
    } finally {
      await writer.end();
    }
  });

  await t.test('⭐⭐⭐ M-100d: the guard is restored after the BACKEND is terminated', async () => {
    const tenantId = `m100-d-${Date.now()}`;
    const requestId = `m100-d-req-${Date.now()}`;
    await seedEvidence(admin, tenantId, requestId);
    const victim = await admin.connect();
    try {
      // ⭐⭐ The client that is terminated reports the death as an
      // ⭐⭐ 'error' event ⇒ ⇒ without a listener it becomes an
      // ⭐⭐ unhandled error that stops the run.
      (victim as unknown as { on: (event: string, fn: () => void) => void }).on(
        'error',
        () => undefined,
      );
      await victim.query('begin');
      await victim.query(
        `alter table tenant_deletion_evidence disable trigger tenant_deletion_evidence_immutable`,
      );
      const backend = await victim.query<{ pid: string }>('select pg_backend_pid()::text as pid');
      const pid = Number(backend.rows[0]?.pid ?? '0');
      assert.ok(pid > 0, 'the backend did not report its pid');
      // ⭐⭐ the kill of the backend ⇐ the transaction dies with it ⇒ ⇒
      // ⭐⭐ the `disable` must be undone by PostgreSQL.
      await admin.query(`select pg_terminate_backend($1)`, [pid]);
      await new Promise((resolve) => setTimeout(resolve, 500));
      assert.equal(
        await guardState(admin),
        'O',
        'the guard is not on after the termination of the backend',
      );
    } finally {
      // ⭐⭐ the connection is DEAD ⇒ ⇒ it must not go back to the pool.
      victim.release(true);
    }
  });

  await t.test('⭐⭐⭐ M-100e: the guard is restored after the PROCESS is killed', async () => {
    const tenantId = `m100-e-${Date.now()}`;
    const requestId = `m100-e-req-${Date.now()}`;
    await seedEvidence(admin, tenantId, requestId);
    const source = `
      import { createPool } from ${JSON.stringify(path.resolve('server/db/pool.ts'))};
      import { superuserUrl } from ${JSON.stringify(HARNESS)};
      const pool = createPool(superuserUrl(${JSON.stringify(harness.config.databaseName)}), 1);
      const client = await pool.connect();
      await client.query('begin');
      await client.query(
        'alter table tenant_deletion_evidence disable trigger tenant_deletion_evidence_immutable',
      );
      process.stdout.write('ready');
      await new Promise((r) => setTimeout(r, 60000));
    `;
    const child = spawn(
      process.execPath,
      ['--experimental-strip-types', '--input-type=module', '-e', source],
      { cwd: path.resolve('.'), stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    for (let i = 0; i < 100 && stdout !== 'ready'; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(stdout, 'ready', 'the child did not open the transaction');
    // ⭐⭐⭐ THE KILL: no cleanup, no finally, no chance to restore.
    child.kill('SIGKILL');
    await new Promise((resolve) => child.on('close', resolve));
    await new Promise((resolve) => setTimeout(resolve, 800));
    assert.equal(
      await guardState(admin),
      'O',
      'the guard is not on after the kill of the process ⇒ the guard can stay off',
    );
    const left = await admin.query<{ count: string }>(
      `select count(*)::text as count from tenant_deletion_evidence where tenant_id = $1`,
      [tenantId],
    );
    assert.equal(
      left.rows[0]?.count,
      '1',
      'the evidence was deleted by the killed process ⇒ the transaction was not rolled back',
    );
  });
});

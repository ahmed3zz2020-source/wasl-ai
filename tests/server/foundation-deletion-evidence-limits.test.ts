// ============================================================
// WASL AI — FOUNDATION BUILD 03 / PHASE 01 (D-070) — M-74
// the limits of the deletion evidence
// ------------------------------------------------------------
// ⭐⭐ WHAT THIS FILE MEASURES
//   The evidence of a deletion is protected by TWO walls that live in
//   the SAME database: a trigger that refuses any change and a hash
//   that the database itself computes.
// ⭐⭐ THE HONEST LIMITS (they are part of the result, not a footnote)
//   1) the request role may WRITE the evidence and may not READ it,
//   2) the owner role may READ it and may not CHANGE it (the trigger
//      refuses the change),
//   3) ⭐⭐ A DATABASE ADMINISTRATOR (the superuser) CAN defeat both
//      walls: the superuser owns the schema, so it can drop the
//      trigger and it can write any row. ⭐ The evidence is therefore
//      NOT "immutable against the administrator of the database".
//   4) ⭐⭐ The hash and the evidence live in the SAME database: an
//      administrator who rewrites the row can recompute the hash with
//      the very function of the database. ⭐ The proof is therefore
//      NOT a final legal proof and NOT a signature of an external
//      authority.
// ⭐⭐ WHAT IS PROVED HERE
//   - the roles are separated (the request role cannot read),
//   - the trigger refuses the change for the owner role,
//   - the receipt is linked to the deletion that really happened,
//   - a tamper that changes the content WITHOUT the hash is DETECTED
//     (the receipt answers "not verified"),
//   - the deletion is not repeated when the answer is lost.
// ============================================================

import assert from 'node:assert/strict';
import test from 'node:test';

import { hashPasscode } from '../../server/auth/sessions.ts';
import { UnitOfWork } from '../../server/db/unit-of-work.ts';
import { createPool } from '../../server/db/pool.ts';
import { loginAs, purgeEvidence, startHarness } from './harness.ts';

const PASSCODE = process.env['WASL_TEST_PASSCODE'] ?? 'wasl-local-test';
/**
 * ⭐ The privileged connection, pointed at the DATABASE OF THE
 *   APPLICATION (the superuser is the role, not the database).
 */
function superuserUrl(databaseName: string): string {
  const base =
    process.env['WASL_PG_SUPERUSER_URL'] ?? 'postgresql://postgres@127.0.0.1:5432/postgres';
  const parsed = new URL(base);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function createTenant(
  harness: Awaited<ReturnType<typeof startHarness>>,
  tenantId: string,
): Promise<string> {
  const userId = `usr_${tenantId}_owner`;
  await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
    await uow.query(
      `insert into tenants (id, name, status) values ($1,$2,'active')
       on conflict (id) do update set name = excluded.name, status = 'active'`,
      [tenantId, `Synthetic ${tenantId}`],
    );
    await uow.query(
      `insert into users (id, display_name, email, status, passcode_hash)
       values ($1,$2,$3,'active',$4)
       on conflict (id) do update set passcode_hash = excluded.passcode_hash, status = 'active'`,
      [userId, `Owner ${tenantId}`, `${userId}@example.invalid`, hashPasscode(PASSCODE)],
    );
    await uow.query(
      `insert into memberships (id, tenant_id, user_id, role, status)
       values ($1,$2,$3,'owner','active')
       on conflict (tenant_id, user_id) do update set role = excluded.role, status = 'active'`,
      [`mem_${userId}`, tenantId, userId],
    );
  });
  return userId;
}

/**
 * ⭐ Preview a deletion (the request row is created by the preview)
 *   and then execute it. ⭐ The answer carries the request id.
 */
async function executeDeletion(
  harness: Awaited<ReturnType<typeof startHarness>>,
  tenantId: string,
  userId: string,
  requestId?: string,
): Promise<{ body: Record<string, unknown>; requestId: string }> {
  const token = await loginAs(harness.client, tenantId, userId, PASSCODE);
  let target = requestId;
  if (target === undefined) {
    const preview = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/deletion/preview',
      token,
      payload: { scope: 'tenant_data' },
    });
    assert.equal(preview.status, 200, `the preview failed: ${preview.status}`);
    target = String((preview.body['preview'] as Record<string, unknown> | undefined)?.['requestId'] ?? '');
    assert.ok(target, 'the preview did not return a request id');
  }
  const answer = await harness.client.request({
    method: 'POST',
    path: '/api/privacy/deletion/execute',
    token,
    payload: { request_id: target, scope: 'tenant_data' },
  });
  assert.equal(answer.status, 200, `the deletion failed: ${answer.status} ${JSON.stringify(answer.body)}`);
  return { body: answer.body, requestId: target };
}

/** ⭐ The receipt of a request (it needs no session). */
async function receipt(
  harness: Awaited<ReturnType<typeof startHarness>>,
  requestId: string,
): Promise<Record<string, unknown>> {
  const answer = await harness.client.request({
    method: 'POST',
    path: '/api/privacy/deletion/status',
    payload: { request_id: requestId },
  });
  assert.equal(answer.status, 200, `the receipt failed: ${answer.status}`);
  return answer.body;
}

test('FOUNDATION 19) the real limits of the deletion evidence (M-74)', async (t) => {
  const harness = await startHarness();
  const tenantId = 'tnt_b03_limits';
  const userId = await createTenant(harness, tenantId);
  // ⭐ The request id is created by the PREVIEW (the request row is
  //   the proof that the request really happened).
  let requestId = '';

  t.after(async () => {
    await purgeEvidence(harness.ownerPool, tenantId);
    await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
      await uow.query(`delete from tenants where id = $1`, [tenantId]);
    });
    await harness.stop();
  });

  await t.test('⭐⭐⭐ M-74a: the request role may not READ the evidence', async () => {
    // ⭐ The request path runs as `wasl_app`: it writes the evidence
    //   and it may not read it back.
    const appPool = createPool(harness.config.appDatabaseUrl, 2);
    try {
      await assert.rejects(
        () => appPool.query(`select * from tenant_deletion_evidence`),
        (error: Error) => /permission denied/i.test(error.message),
        'the request role could read the evidence',
      );
      await assert.rejects(
        () => appPool.query(`update tenant_deletion_evidence set scope = 'x'`),
        (error: Error) => /permission denied/i.test(error.message),
        'the request role could change the evidence',
      );
      await assert.rejects(
        () => appPool.query(`delete from tenant_deletion_evidence`),
        (error: Error) => /permission denied/i.test(error.message),
        'the request role could delete the evidence',
      );
    } finally {
      await appPool.end();
    }
  });

  await t.test('⭐⭐⭐ M-74b: the owner role may READ it and may NOT change it', async () => {
    const executed = await executeDeletion(harness, tenantId, userId);
    requestId = executed.requestId;
    assert.equal(executed.body['ok'], true, 'the deletion did not run');

    // ⭐⭐ The owner role may read the evidence (it owns the table).
    const rows = await harness.ownerPool.query(
      `select id, request_id, scope, content_hash from tenant_deletion_evidence where request_id = $1`,
      [requestId],
    );
    assert.equal(rows.rows.length, 1, 'the evidence is missing');

    // ⭐⭐ The trigger refuses the change, even for the owner role.
    await assert.rejects(
      () =>
        harness.ownerPool.query(
          `update tenant_deletion_evidence set scope = 'tampered' where request_id = $1`,
          [requestId],
        ),
      (error: Error) => /immutable/i.test(error.message),
      'the owner role could change the evidence',
    );
    await assert.rejects(
      () => harness.ownerPool.query(`delete from tenant_deletion_evidence where request_id = $1`, [requestId]),
      (error: Error) => /immutable/i.test(error.message),
      'the owner role could delete the evidence',
    );

    // ⭐⭐ The row is really untouched.
    const after = await harness.ownerPool.query(
      `select scope from tenant_deletion_evidence where request_id = $1`,
      [requestId],
    );
    assert.equal(after.rows[0]?.scope, rows.rows[0]?.scope, 'the scope was changed');
  });

  await t.test('⭐⭐⭐ M-74c: the receipt is linked to the deletion that really happened', async () => {
    const answer = await receipt(harness, requestId);
    assert.equal(answer['status'], 'executed', 'the receipt does not report the execution');
    assert.equal(answer['verified'], true, 'the evidence does not verify');
    const hash = String(answer['content_hash'] ?? '');
    assert.match(hash, /^[0-9a-f]{64}$/, 'the receipt carries no hash');

    // ⭐⭐ The hash of the receipt is the hash of the row: they are the
    //   same proof, not two different ones.
    const rows = await harness.ownerPool.query(
      `select content_hash from tenant_deletion_evidence where request_id = $1`,
      [requestId],
    );
    assert.equal(rows.rows[0]?.content_hash, hash, 'the receipt carries another hash');

    // ⭐⭐ The evidence carries the scope of the deletion.
    assert.equal(answer['scope'], 'tenant_data', 'the receipt carries another scope');
    assert.equal(answer['evidence_id'], rows.rows.length > 0 ? String(answer['evidence_id']) : '', 'the receipt carries no evidence id');
    assert.ok(String(answer['evidence_id'] ?? '').length > 0, 'the receipt carries no evidence id');
  });

  await t.test('⭐⭐⭐ M-74d: a tamper of the content is DETECTED by the receipt', async () => {
    // ⭐⭐ The threat model of this drill: the CONTENT of the evidence
    //   is rewritten (by whoever holds the right to write) and the hash
    //   is left alone. ⭐ The receipt must answer "not verified".
    const admin = createPool(superuserUrl(harness.config.databaseName), 2);
    try {
      await admin.query(
        `alter table tenant_deletion_evidence disable trigger tenant_deletion_evidence_immutable`,
      );
      try {
        await admin.query(
          `update tenant_deletion_evidence set scope = 'tampered_scope'
            where request_id = $1`,
          [requestId],
        );
      } finally {
        await admin.query(
          `alter table tenant_deletion_evidence enable trigger tenant_deletion_evidence_immutable`,
        );
      }
    } finally {
      await admin.end();
    }

    // ⭐⭐ The receipt now answers "not verified": the tamper is visible.
    const answer = await receipt(harness, requestId);
    assert.equal(answer['status'], 'executed', 'the receipt lost the execution');
    assert.equal(answer['verified'], false, 'the tamper was not detected');
    assert.equal(answer['scope'], 'tampered_scope', 'the receipt does not show what is really there');

    // ⭐⭐ The hash is restored so the drill is repeatable.
    const admin2 = createPool(superuserUrl(harness.config.databaseName), 2);
    try {
      await admin2.query(
        `alter table tenant_deletion_evidence disable trigger tenant_deletion_evidence_immutable`,
      );
      try {
        // ⭐ The hash is computed with the NEW scope: in an UPDATE the
        //   expressions see the OLD row, so the literal is used.
        await admin2.query(
          `update tenant_deletion_evidence
              set scope = 'tenant_data',
                  content_hash = wasl_deletion_evidence_hash(
                    id, tenant_id, request_id, 'tenant_data',
                    requested_by, executed_by, removed, occurred_at
                  )
            where request_id = $1`,
          [requestId],
        );
      } finally {
        await admin2.query(
          `alter table tenant_deletion_evidence enable trigger tenant_deletion_evidence_immutable`,
        );
      }
    } finally {
      await admin2.end();
    }
    const restored = await receipt(harness, requestId);
    assert.equal(restored['verified'], true, 'the evidence did not verify again');
  });

  await t.test('⭐⭐⭐ M-74e: the limit of the wall: the ADMINISTRATOR of the database wins', async () => {
    // ⭐⭐⭐ THE HONEST LIMIT. ⭐ The superuser owns the schema: it can
    //   drop the trigger and it can write the row. ⭐ The protection
    //   holds against the roles of the application (the request role
    //   and the owner role), and it does NOT hold against the
    //   administrator of the database.
    const admin = createPool(superuserUrl(harness.config.databaseName), 2);
    try {
      // ⭐ The administrator can read the evidence of any company.
      const rows = await admin.query(
        `select count(*)::text as count from tenant_deletion_evidence`,
      );
      assert.ok(Number(rows.rows[0]?.count ?? '0') >= 1, 'the administrator sees nothing');
      // ⭐ And it can remove the guard itself.
      await admin.query(
        `alter table tenant_deletion_evidence disable trigger tenant_deletion_evidence_immutable`,
      );
      const enabled = await admin.query(
        `select tgenabled from pg_trigger
          where tgname = 'tenant_deletion_evidence_immutable'`,
      );
      assert.notEqual(enabled.rows[0]?.tgenabled, 'O', 'the guard could not be disabled');
      await admin.query(
        `alter table tenant_deletion_evidence enable trigger tenant_deletion_evidence_immutable`,
      );
    } finally {
      await admin.end();
    }
  });

  await t.test('⭐⭐⭐ M-74f: the deletion is not repeated when the answer is lost', async () => {
    // ⭐⭐ The client that lost the answer sends the same request id
    //   again. ⭐⭐ First WITHOUT a session: the answer is the receipt
    //   of the execution that really happened, and nothing is deleted.
    const withoutSession = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/deletion/execute',
      payload: { request_id: requestId, scope: 'tenant_data' },
    });
    assert.equal(withoutSession.status, 200, 'the retry was not answered');
    assert.equal(
      withoutSession.body['already_executed'],
      true,
      'the retry did not report the first execution',
    );
    assert.equal(withoutSession.body['status'], 'executed', 'the retry did not report the execution');

    // ⭐⭐ Then WITH a session: the membership is restored (the first
    //   deletion took it away with the content), and the request is
    //   executed again. ⭐ The answer is the confirmed outcome of the
    //   first execution and NOTHING is deleted twice.
    await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
      await uow.query(
        `insert into memberships (id, tenant_id, user_id, role, status)
         values ($1,$2,$3,'owner','active')
         on conflict (tenant_id, user_id) do update set status = 'active'`,
        [`mem_usr_${tenantId}_owner`, tenantId, userId],
      );
    });
    const body = await executeDeletion(harness, tenantId, userId, requestId);
    assert.equal(
      body.body['already_executed'],
      true,
      'the second execution was not refused',
    );

    const count = await harness.ownerPool.query(
      `select count(*)::text as count from tenant_deletion_evidence where request_id = $1`,
      [requestId],
    );
    assert.equal(Number(count.rows[0]?.count ?? '0'), 1, 'the evidence was written twice');
  });
});

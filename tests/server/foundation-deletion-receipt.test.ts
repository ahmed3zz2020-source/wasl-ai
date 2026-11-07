// ============================================================
// WASL AI — FOUNDATION BUILD 02 — PHASE 02 (D-069)
// M-68: the integrity of the deletion evidence
// ------------------------------------------------------------
// ⭐ WHY THIS FILE EXISTS
//   In PHASE 01 the evidence of a deletion was protected by a guard
//   trigger: it could not be forged. But it could still be REWRITTEN or
//   REMOVED afterwards, and a client whose answer was lost had no way
//   to learn whether the deletion had happened: the retry answered
//   "unknown request", which reads exactly like "nothing happened".
// ⭐ THE PROPERTIES UNDER TEST
//   - the evidence is immutable: no UPDATE and no DELETE is accepted,
//   - the content hash is computed by the database, not by the caller,
//   - a privileged manipulation of the evidence is DETECTED,
//   - the receipt tells the three states apart: executed / previewed /
//     unknown,
//   - a re-sent request never deletes twice: it repeats the confirmed
//     outcome,
//   - a failure before the commit leaves nothing behind, and the
//     receipt says so.
// ⛔ Local synthetic database only.
// ============================================================

import assert from 'node:assert/strict';
import test from 'node:test';

import { UnitOfWork } from '../../server/db/unit-of-work.ts';
import { LocalApiClient } from '../../server/e2e/http-client.ts';
import {
  createSyntheticTenant,
  loginAs,
  purgeEvidence,
  startHarness,
  type SyntheticTenant,
} from './harness.ts';

const PASSCODE = process.env['WASL_TEST_PASSCODE'] ?? 'wasl-local-test';

test('FOUNDATION 14) the integrity of the deletion evidence (M-68)', async (t) => {
  const harness = await startHarness();
  const tenants: string[] = [];

  const makeTenant = async (name: string): Promise<SyntheticTenant> => {
    const tenantId = `tnt_b02p2_${name}`;
    tenants.push(tenantId);
    await purgeEvidence(harness.ownerPool, tenantId);
    return createSyntheticTenant(harness.ownerPool, tenantId, PASSCODE);
  };

  t.after(async () => {
    for (const tenantId of tenants) {
      await purgeEvidence(harness.ownerPool, tenantId);
      await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
        await uow.query(`delete from tenants where id = $1`, [tenantId]);
      });
    }
    await harness.stop();
  });

  const receiptOf = async (requestId: string): Promise<Record<string, unknown>> => {
    const response = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/deletion/status',
      payload: { request_id: requestId },
    });
    assert.equal(response.status, 200, `the receipt failed: ${response.status}`);
    return response.body;
  };

  await t.test('⭐⭐⭐ M-68a: the evidence is immutable', async () => {
    const fixture = await makeTenant('immutable');
    const token = await loginAs(harness.client, fixture.tenantId, fixture.userId, PASSCODE);

    const preview = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/deletion/preview',
      token,
      payload: { scope: 'tenant_data' },
    });
    assert.equal(preview.status, 200, 'the preview failed');
    const requestId = String(
      (preview.body['preview'] as Record<string, unknown> | undefined)?.['requestId'] ?? '',
    );
    assert.ok(requestId, 'the preview did not return a request id');

    const executed = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/deletion/execute',
      token,
      payload: { request_id: requestId },
    });
    assert.equal(executed.status, 200, `the deletion failed: ${executed.status}`);

    // ⭐ The UPDATE is refused, even by the owner role.
    let updateCode = 'none';
    try {
      await harness.ownerPool.query(
        `update tenant_deletion_evidence set scope = 'forged' where request_id = $1`,
        [requestId],
      );
    } catch (error) {
      updateCode = (error as { code?: string }).code ?? 'unknown';
    }
    assert.equal(updateCode, '23514', `the update was not refused: ${updateCode}`);

    // ⭐ The DELETE is refused too.
    let deleteCode = 'none';
    try {
      await harness.ownerPool.query(`delete from tenant_deletion_evidence where request_id = $1`, [
        requestId,
      ]);
    } catch (error) {
      deleteCode = (error as { code?: string }).code ?? 'unknown';
    }
    assert.equal(deleteCode, '23514', `the delete was not refused: ${deleteCode}`);
  });

  await t.test('⭐⭐⭐ M-68b: the hash is computed by the database', async () => {
    const fixture = await makeTenant('hash');
    const token = await loginAs(harness.client, fixture.tenantId, fixture.userId, PASSCODE);

    const preview = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/deletion/preview',
      token,
      payload: { scope: 'tenant_data' },
    });
    const requestId = String(
      (preview.body['preview'] as Record<string, unknown> | undefined)?.['requestId'] ?? '',
    );
    const executed = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/deletion/execute',
      token,
      payload: { request_id: requestId },
    });
    assert.equal(executed.status, 200, 'the deletion failed');

    const row = await harness.ownerPool.query<{ content_hash: string; evidence_version: number }>(
      `select content_hash, evidence_version from tenant_deletion_evidence where request_id = $1`,
      [requestId],
    );
    assert.equal(row.rows.length, 1, 'the evidence row is missing');
    assert.match(row.rows[0]!.content_hash, /^[0-9a-f]{64}$/, 'the content hash is not a sha256');
    assert.equal(row.rows[0]!.evidence_version, 1, 'the version of the evidence is wrong');

    // ⭐ The receipt verifies the hash: the row was not manipulated.
    const receipt = await receiptOf(requestId);
    assert.equal(receipt['status'], 'executed', 'the receipt does not confirm the deletion');
    assert.equal(receipt['verified'], true, 'the content hash does not verify');
    assert.equal(receipt['content_hash'], row.rows[0]!.content_hash, 'the receipt holds another hash');
  });

  await t.test('⭐⭐⭐ M-68c: a privileged manipulation is detected', async () => {
    const fixture = await makeTenant('tamper');
    const token = await loginAs(harness.client, fixture.tenantId, fixture.userId, PASSCODE);

    const preview = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/deletion/preview',
      token,
      payload: { scope: 'tenant_data' },
    });
    const requestId = String(
      (preview.body['preview'] as Record<string, unknown> | undefined)?.['requestId'] ?? '',
    );
    const executed = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/deletion/execute',
      token,
      payload: { request_id: requestId },
    });
    assert.equal(executed.status, 200, 'the deletion failed');

    // ⭐⭐ The guard is disabled ON PURPOSE (the owner role owns the
    //   table): this is the privileged manipulation the hash is there
    //   to detect.
    await harness.ownerPool.query(
      `alter table tenant_deletion_evidence disable trigger tenant_deletion_evidence_immutable`,
    );
    try {
      await harness.ownerPool.query(
        `update tenant_deletion_evidence set scope = 'forged_scope' where request_id = $1`,
        [requestId],
      );
    } finally {
      await harness.ownerPool.query(
        `alter table tenant_deletion_evidence enable trigger tenant_deletion_evidence_immutable`,
      );
    }

    // ⭐ The receipt reports the manipulation: the hash does not match.
    const receipt = await receiptOf(requestId);
    assert.equal(receipt['status'], 'executed', 'the receipt does not confirm the deletion');
    assert.equal(receipt['verified'], false, 'the manipulation was not detected');
    assert.equal(receipt['scope'], 'forged_scope', 'the forged scope is hidden');
  });

  await t.test('⭐⭐⭐ M-68d: the receipt tells the three states apart', async () => {
    const fixture = await makeTenant('states');
    const token = await loginAs(harness.client, fixture.tenantId, fixture.userId, PASSCODE);

    // ⭐ A request that was not executed yet.
    const preview = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/deletion/preview',
      token,
      payload: { scope: 'tenant_data' },
    });
    const requestId = String(
      (preview.body['preview'] as Record<string, unknown> | undefined)?.['requestId'] ?? '',
    );
    const before = await receiptOf(requestId);
    assert.equal(before['status'], 'previewed', 'the receipt does not show the pending request');

    // ⭐ A request that does not exist at all.
    const unknown = await receiptOf(`del_${'0'.repeat(32)}`);
    assert.equal(unknown['status'], 'unknown', 'the receipt invented a state');
    assert.equal(unknown['evidence_id'], null, 'the receipt invented an evidence');

    // ⭐ And the executed one.
    const executed = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/deletion/execute',
      token,
      payload: { request_id: requestId },
    });
    assert.equal(executed.status, 200, 'the deletion failed');
    const after = await receiptOf(requestId);
    assert.equal(after['status'], 'executed', 'the receipt does not confirm the deletion');
    assert.ok(after['evidence_id'], 'the receipt holds no evidence id');
  });

  await t.test('⭐⭐⭐ M-68e: a re-sent request never deletes twice', async () => {
    const fixture = await makeTenant('retry');
    const token = await loginAs(harness.client, fixture.tenantId, fixture.userId, PASSCODE);

    const preview = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/deletion/preview',
      token,
      payload: { scope: 'tenant_data' },
    });
    const requestId = String(
      (preview.body['preview'] as Record<string, unknown> | undefined)?.['requestId'] ?? '',
    );
    const first = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/deletion/execute',
      token,
      payload: { request_id: requestId },
    });
    assert.equal(first.status, 200, 'the deletion failed');
    const evidenceId = String(first.body['evidence_id'] ?? '');
    assert.ok(evidenceId, 'the answer holds no evidence id');

    // ⭐⭐ The same request is sent again: the answer is the CONFIRMED
    //   outcome of the first execution, and nothing is deleted again.
    const second = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/deletion/execute',
      token,
      payload: { request_id: requestId },
    });
    assert.equal(second.status, 200, `the retry was refused: ${second.status}`);
    assert.equal(second.body['already_executed'], true, 'the retry is not marked as already executed');
    assert.equal(second.body['evidence_id'], evidenceId, 'the retry holds another evidence id');

    const evidence = await harness.ownerPool.query<{ count: string }>(
      `select count(*)::text as count from tenant_deletion_evidence where request_id = $1`,
      [requestId],
    );
    assert.equal(Number(evidence.rows[0]?.count ?? '0'), 1, 'a second evidence was written');
  });

  await t.test('⭐⭐⭐ M-68f: a failure before the commit leaves nothing behind', async () => {
    const fixture = await makeTenant('drop');

    const preview = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/deletion/preview',
      token: await loginAs(harness.client, fixture.tenantId, fixture.userId, PASSCODE),
      payload: { scope: 'tenant_data' },
    });
    const requestId = String(
      (preview.body['preview'] as Record<string, unknown> | undefined)?.['requestId'] ?? '',
    );

    // ⭐ The transaction removes the content and then fails: the whole
    //   unit of work is rolled back, exactly like a connection that is
    //   dropped before the COMMIT.
    await assert.rejects(
      () =>
        UnitOfWork.run(harness.ownerPool, fixture.tenantId, async (uow) => {
          await uow.query(`delete from customers where tenant_id = $1`, [fixture.tenantId]);
          throw new Error('the connection was dropped before the commit');
        }),
      'the failing transaction did not reject',
    );

    // ⭐ Nothing was removed and the receipt says the request was NOT
    //   executed: the client may retry safely.
    const survived = await UnitOfWork.run(harness.ownerPool, fixture.tenantId, async (uow) => {
      const customers = await uow.query<{ count: string }>(
        `select count(*)::text as count from customers where tenant_id = $1`,
        [fixture.tenantId],
      );
      const request = await uow.query<{ status: string }>(
        `select status from deletion_requests where id = $1`,
        [requestId],
      );
      return {
        customers: Number(customers.rows[0]?.count ?? '0'),
        status: request.rows[0]?.status ?? 'missing',
      };
    });
    assert.equal(survived.customers, 1, 'the content was removed although the transaction failed');
    assert.equal(survived.status, 'previewed', 'the request was marked as executed');

    const receipt = await receiptOf(requestId);
    assert.equal(receipt['status'], 'previewed', 'the receipt does not show the pending request');
    assert.equal(receipt['evidence_id'], null, 'the receipt invented an evidence');
  });

  await t.test('⭐⭐ M-68g: the request id is not guessable', async () => {
    const fixture = await makeTenant('capability');
    const token = await loginAs(harness.client, fixture.tenantId, fixture.userId, PASSCODE);
    const preview = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/deletion/preview',
      token,
      payload: { scope: 'tenant_data' },
    });
    const requestId = String(
      (preview.body['preview'] as Record<string, unknown> | undefined)?.['requestId'] ?? '',
    );
    // ⭐ 128 random bits: the id is the capability that lets the client
    //   ask for the receipt without a session.
    assert.match(
      requestId,
      /^del_tnt_b02p2_capability_[0-9a-f]{32}$/,
      'the request id does not carry the tenant and the 128 random bits',
    );
  });
});

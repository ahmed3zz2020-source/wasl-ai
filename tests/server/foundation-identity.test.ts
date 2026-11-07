// ============================================================
// WASL AI — FOUNDATION BUILD 01 — identity, roles and sessions
// ------------------------------------------------------------
// ⭐ AC-05: a positive and a negative case per role, plus the refusal
//   of a role escalation and of a tenant switch.
// ⭐ AC-06: expiry, revocation and a membership change stop the next
//   operation.
// ⭐ M59: the role comes from the database, so copying, changing or
//   revoking it is observable on the next request.
// ⛔ Local synthetic database only.
// ============================================================

import assert from 'node:assert/strict';
import test from 'node:test';

import { WaslApiServer } from '../../server/api/server.ts';
import { createPool } from '../../server/db/pool.ts';
import { UnitOfWork } from '../../server/db/unit-of-work.ts';
import { LocalApiClient } from '../../server/e2e/http-client.ts';
import { startHarness, loginAs, resetSyntheticData } from './harness.ts';

const PASSCODE = process.env['WASL_TEST_PASSCODE'] ?? 'wasl-local-test';

test('FOUNDATION 3) identity, roles and sessions', async (t) => {
  const harness = await startHarness();
  t.after(async () => {
    await harness.stop();
  });
  await resetSyntheticData(harness.ownerPool, PASSCODE);

  await t.test('⭐ AC-05a: the owner can do the owner things', async () => {
    const owner = await loginAs(harness.client, 'tnt_alpha', 'usr_alpha_owner', PASSCODE);
    const created = await harness.client.request({
      method: 'POST',
      path: '/api/conversations',
      token: owner,
      payload: { conversation_ref: 'conv_role_owner', customer_id: 'cus_alpha_1', message: { body: 'hello' } },
    });
    assert.equal(created.status, 201);

    const exported = await harness.client.request({ method: 'POST', path: '/api/privacy/export', token: owner });
    assert.equal(exported.status, 200);

    const retention = await harness.client.request({
      method: 'POST',
      path: '/api/retention',
      token: owner,
      payload: { data_class: 'sensitive', retention_days: 45, on_cancel: 'delete' },
    });
    assert.equal(retention.status, 200);
  });

  await t.test('⭐ AC-05b: the supervisor can write but not delete', async () => {
    const supervisor = await loginAs(harness.client, 'tnt_alpha', 'usr_alpha_super', PASSCODE);
    const write = await harness.client.request({
      method: 'POST',
      path: '/api/conversations/conv_role_owner/messages',
      token: supervisor,
      payload: { body: 'supervisor writes' },
    });
    assert.equal(write.status, 201);

    const exported = await harness.client.request({ method: 'POST', path: '/api/privacy/export', token: supervisor });
    assert.equal(exported.status, 200, 'the supervisor may export');

    const deletion = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/deletion/preview',
      token: supervisor,
      payload: { scope: 'tenant_data' },
    });
    assert.equal(deletion.status, 403, 'the supervisor must not prepare a deletion');

    const retention = await harness.client.request({
      method: 'POST',
      path: '/api/retention',
      token: supervisor,
      payload: { data_class: 'standard', retention_days: 10 },
    });
    assert.equal(retention.status, 403, 'the supervisor must not change the retention policy');
  });

  await t.test('⭐ AC-05c: the agent can write but not create or export', async () => {
    const agent = await loginAs(harness.client, 'tnt_alpha', 'usr_alpha_agent', PASSCODE);
    const write = await harness.client.request({
      method: 'POST',
      path: '/api/conversations/conv_role_owner/messages',
      token: agent,
      payload: { body: 'agent writes' },
    });
    assert.equal(write.status, 201);

    const created = await harness.client.request({
      method: 'POST',
      path: '/api/conversations',
      token: agent,
      payload: { conversation_ref: 'conv_role_agent', message: { body: 'nope' } },
    });
    assert.equal(created.status, 403, 'the agent must not create a conversation');

    const exported = await harness.client.request({ method: 'POST', path: '/api/privacy/export', token: agent });
    assert.equal(exported.status, 403, 'the agent must not export');
  });

  await t.test('⭐ AC-05d: the viewer can only read', async () => {
    const viewer = await loginAs(harness.client, 'tnt_alpha', 'usr_alpha_viewer', PASSCODE);
    const list = await harness.client.request({ path: '/api/conversations', token: viewer });
    assert.equal(list.status, 200);

    const write = await harness.client.request({
      method: 'POST',
      path: '/api/conversations/conv_role_owner/messages',
      token: viewer,
      payload: { body: 'viewer writes' },
    });
    assert.equal(write.status, 403);
  });

  await t.test('⭐ AC-05e: a role sent by the client changes nothing', async () => {
    const viewer = await loginAs(harness.client, 'tnt_alpha', 'usr_alpha_viewer', PASSCODE);
    const escalated = await harness.client.request({
      method: 'POST',
      path: '/api/conversations/conv_role_owner/messages',
      token: viewer,
      payload: { body: 'escalation', role: 'owner', tenant_id: 'tnt_alpha', capabilities: ['conversation.write'] },
    });
    assert.equal(escalated.status, 403, 'the client managed to escalate its role');

    const exported = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/export',
      token: viewer,
      payload: { role: 'owner' },
    });
    assert.equal(exported.status, 403, 'the client managed to escalate its role on the export');
  });

  await t.test('⭐ AC-05f: the tenant of a session cannot be switched by the client', async () => {
    const alpha = await loginAs(harness.client, 'tnt_alpha', 'usr_alpha_owner', PASSCODE);
    const listed = await harness.client.request({
      path: '/api/conversations',
      token: alpha,
      payload: { tenant_id: 'tnt_beta' },
    });
    assert.equal(listed.status, 200);
    const rows = listed.body['conversations'] as Array<Record<string, unknown>>;
    const beta = await loginAs(harness.client, 'tnt_beta', 'usr_beta_owner', PASSCODE);
    const betaList = await harness.client.request({ path: '/api/conversations', token: beta });
    const betaRows = betaList.body['conversations'] as Array<Record<string, unknown>>;
    const alphaRefs = new Set(rows.map((row) => String(row['ref'])));
    const betaRefs = new Set(betaRows.map((row) => String(row['ref'])));
    for (const ref of betaRefs) {
      assert.ok(!alphaRefs.has(ref), `the alpha session saw the beta conversation ${ref}`);
    }
  });

  await t.test('⭐ AC-06a: an expired session is refused', async () => {
    const shortLived = new WaslApiServer({
      config: { ...harness.config, port: harness.port + 2, sessionTtlSeconds: 2 },
      pool: createPool(harness.config.appDatabaseUrl, 2),
    });
    const address = await shortLived.listen();
    const client = new LocalApiClient('127.0.0.1', address.port);
    try {
      const token = await loginAs(client, 'tnt_alpha', 'usr_alpha_owner', PASSCODE);
      const first = await client.request({ path: '/api/conversations', token });
      assert.equal(first.status, 200);
      await new Promise((resolve) => setTimeout(resolve, 2500));
      const second = await client.request({ path: '/api/conversations', token });
      assert.equal(second.status, 401, 'the expired session was still accepted');
    } finally {
      await shortLived.close();
    }
  });

  await t.test('⭐ AC-06b: a revoked session is refused', async () => {
    const owner = await loginAs(harness.client, 'tnt_alpha', 'usr_alpha_owner', PASSCODE);
    const before = await harness.client.request({ path: '/api/conversations', token: owner });
    assert.equal(before.status, 200);
    const revoked = await harness.client.request({ method: 'DELETE', path: '/api/session', token: owner });
    assert.equal(revoked.status, 200);
    const after = await harness.client.request({ path: '/api/conversations', token: owner });
    assert.equal(after.status, 401, 'the revoked session was still accepted');
  });

  await t.test('⭐ AC-06c: a disabled membership stops the next operation', async () => {
    const agent = await loginAs(harness.client, 'tnt_alpha', 'usr_alpha_agent', PASSCODE);
    const before = await harness.client.request({ path: '/api/conversations', token: agent });
    assert.equal(before.status, 200);

    await UnitOfWork.run(harness.ownerPool, 'tnt_alpha', async (uow) => {
      await uow.query(`update memberships set status = 'revoked' where tenant_id = $1 and user_id = $2`, [
        'tnt_alpha',
        'usr_alpha_agent',
      ]);
    });

    const after = await harness.client.request({ path: '/api/conversations', token: agent });
    assert.ok(after.status === 401 || after.status === 403, `unexpected status ${after.status}`);

    await UnitOfWork.run(harness.ownerPool, 'tnt_alpha', async (uow) => {
      await uow.query(`update memberships set status = 'active' where tenant_id = $1 and user_id = $2`, [
        'tnt_alpha',
        'usr_alpha_agent',
      ]);
    });
  });

  await t.test('⭐ M59: a role change in the database is effective on the next request', async () => {
    const agent = await loginAs(harness.client, 'tnt_alpha', 'usr_alpha_agent', PASSCODE);
    const before = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/export',
      token: agent,
    });
    assert.equal(before.status, 403, 'the agent could export before the change');

    await UnitOfWork.run(harness.ownerPool, 'tnt_alpha', async (uow) => {
      await uow.query(`update memberships set role = 'supervisor' where tenant_id = $1 and user_id = $2`, [
        'tnt_alpha',
        'usr_alpha_agent',
      ]);
    });

    const after = await harness.client.request({ method: 'POST', path: '/api/privacy/export', token: agent });
    assert.equal(after.status, 200, 'the role change did not reach the next request');

    await UnitOfWork.run(harness.ownerPool, 'tnt_alpha', async (uow) => {
      await uow.query(`update memberships set role = 'agent' where tenant_id = $1 and user_id = $2`, [
        'tnt_alpha',
        'usr_alpha_agent',
      ]);
    });
    const restored = await harness.client.request({ method: 'POST', path: '/api/privacy/export', token: agent });
    assert.equal(restored.status, 403, 'the role was not restored');
  });

  await t.test('⭐ M59b: a token of one company cannot be replayed in another', async () => {
    const alpha = await loginAs(harness.client, 'tnt_alpha', 'usr_alpha_owner', PASSCODE);
    const parts = alpha.split('.');
    const forged = `wsl.tnt_beta.${parts[2]}.${parts[3]}`;
    const response = await harness.client.request({ path: '/api/conversations', token: forged });
    assert.equal(response.status, 401, 'the forged tenant token was accepted');
  });
});

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
import { hashPasscode, verifyPasscode } from '../../server/auth/sessions.ts';
import { seedDatabase } from '../../server/db/setup.ts';
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

  await t.test('⭐ R-01: the migration connection uses the owner role and its own password', async () => {
    const ownerPool = createPool(harness.config.ownerDatabaseUrl, 1);
    const who = await ownerPool.query<{ current_user: string }>('select current_user');
    assert.equal(who.rows[0]?.current_user, 'wasl_owner', 'the owner url did not open as wasl_owner');
    await ownerPool.end();

    const appPool = createPool(harness.config.appDatabaseUrl, 1);
    const role = await appPool.query<{ rolbypassrls: boolean; rolsuper: boolean }>(
      'select rolbypassrls, rolsuper from pg_roles where rolname = current_user',
    );
    assert.equal(role.rows[0]?.rolbypassrls, false, 'the request role can bypass the row policies');
    assert.equal(role.rows[0]?.rolsuper, false, 'the request role is a superuser');
    await appPool.end();
  });

  await t.test('⭐ R-02: the seed restores the identity rows after a tenant wipe', async () => {
    await UnitOfWork.run(harness.ownerPool, 'tnt_alpha', async (uow) => {
      await uow.query(`delete from memberships where tenant_id = $1`, ['tnt_alpha']);
    });
    const refused = await harness.client.request({
      method: 'POST',
      path: '/api/session',
      payload: { tenant_id: 'tnt_alpha', user_id: 'usr_alpha_owner', passcode: PASSCODE },
    });
    assert.equal(refused.status, 401, 'the login still worked without a membership');

    await seedDatabase(harness.ownerPool, PASSCODE);
    const restored = await harness.client.request({
      method: 'POST',
      path: '/api/session',
      payload: { tenant_id: 'tnt_alpha', user_id: 'usr_alpha_owner', passcode: PASSCODE },
    });
    assert.equal(restored.status, 200, 'the seed did not restore the membership');
  });
  // ------------------------------------------------------------
  // D-067 / R-03: the sessions and the permissions.
  // ------------------------------------------------------------

  await t.test('⭐ R-03a: a disabled account stops the next request', async () => {
    const agent = await loginAs(harness.client, 'tnt_alpha', 'usr_alpha_agent', PASSCODE);
    const before = await harness.client.request({ path: '/api/conversations', token: agent });
    assert.equal(before.status, 200);

    await UnitOfWork.run(harness.ownerPool, 'tnt_alpha', async (uow) => {
      await uow.query(`update users set status = 'disabled' where id = $1`, ['usr_alpha_agent']);
    });
    try {
      const after = await harness.client.request({ path: '/api/conversations', token: agent });
      assert.ok(after.status === 401 || after.status === 403, `the disabled account still works: ${after.status}`);
    } finally {
      await UnitOfWork.run(harness.ownerPool, 'tnt_alpha', async (uow) => {
        await uow.query(`update users set status = 'active' where id = $1`, ['usr_alpha_agent']);
      });
    }
  });

  await t.test('⭐ R-03b: an old session stays dead after a new login', async () => {
    const first = await loginAs(harness.client, 'tnt_alpha', 'usr_alpha_owner', PASSCODE);
    const before = await harness.client.request({ path: '/api/conversations', token: first });
    assert.equal(before.status, 200);

    const revoked = await harness.client.request({ method: 'DELETE', path: '/api/session', token: first });
    assert.equal(revoked.status, 200);

    const second = await loginAs(harness.client, 'tnt_alpha', 'usr_alpha_owner', PASSCODE);
    assert.notEqual(second, first, 'the new login returned the old token');

    const oldToken = await harness.client.request({ path: '/api/conversations', token: first });
    assert.ok(oldToken.status === 401 || oldToken.status === 403, `the revoked session was accepted again: ${oldToken.status}`);
    const newToken = await harness.client.request({ path: '/api/conversations', token: second });
    assert.equal(newToken.status, 200, 'the new session does not work');
  });

  await t.test('⭐ R-03c: a tampered token is refused', async () => {
    const token = await loginAs(harness.client, 'tnt_alpha', 'usr_alpha_owner', PASSCODE);
    const parts = token.split('.');
    assert.equal(parts.length, 4, 'the token is not the expected shape');

    const forgedSecret = `${parts[0]}.${parts[1]}.${parts[2]}.${'a'.repeat(parts[3]!.length)}`;
    const forged = await harness.client.request({ path: '/api/conversations', token: forgedSecret });
    assert.ok(forged.status === 401 || forged.status === 403, `a forged secret was accepted: ${forged.status}`);

    const forgedSession = `${parts[0]}.${parts[1]}.sess_0000000000000000.${parts[3]}`;
    const unknown = await harness.client.request({ path: '/api/conversations', token: forgedSession });
    assert.ok(unknown.status === 401 || unknown.status === 403, `an unknown session id was accepted: ${unknown.status}`);

    const noToken = await harness.client.request({ path: '/api/conversations' });
    assert.ok(noToken.status === 401 || noToken.status === 403, `a request without a token was accepted: ${noToken.status}`);
  });

  await t.test('⭐ R-03d: the experimental passcode is salted and never stored in clear', async () => {
    // ⭐ Two users with the same passcode must not share a hash: the
    //   salt is what makes the stored value useless to an attacker.
    const first = hashPasscode(PASSCODE, 'salt-one');
    const second = hashPasscode(PASSCODE, 'salt-two');
    assert.notEqual(first, second, 'the hash does not depend on the salt');
    assert.ok(!first.includes(PASSCODE), 'the passcode is stored in clear');
    assert.ok(verifyPasscode(first, PASSCODE), 'the salted hash does not verify');
    assert.ok(!verifyPasscode(first, `${PASSCODE}x`), 'a wrong passcode verifies');
    assert.ok(!verifyPasscode('not-a-hash', PASSCODE), 'a malformed hash verifies');

    // ⭐ The database holds the hash, never the passcode.
    const rows = await UnitOfWork.run(harness.ownerPool, 'tnt_alpha', async (uow) => {
      const result = await uow.query<{ passcode_hash: string }>(
        `select passcode_hash from users where id = $1`,
        ['usr_alpha_owner'],
      );
      return result.rows.map((row) => row.passcode_hash);
    });
    assert.equal(rows.length, 1);
    assert.ok(!rows[0]!.includes(PASSCODE), 'the database stores the passcode in clear');
    assert.ok(rows[0]!.includes(':'), 'the stored hash is not salted');
  });
});

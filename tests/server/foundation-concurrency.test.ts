// ============================================================
// WASL AI — FOUNDATION BUILD 01 — POST-REVIEW REMEDIATION (D-067)
// R-04: the concurrent operations
// ------------------------------------------------------------
// ⭐ Two employees edit the same conversation at the same time.
//   The properties under test:
//   - a valid update is never lost silently,
//   - an illegal transition is refused even under a race,
//   - the in-memory state matches PostgreSQL after a conflict,
//   - the version conflict is reported instead of overwriting,
//   - the data is intact after a restart of the service.
// ⭐ Every check runs against the REAL local PostgreSQL through the
//   real HTTP API.
// ⛔ Local synthetic database only.
// ============================================================

import assert from 'node:assert/strict';
import test from 'node:test';

import { WaslApiServer } from '../../server/api/server.ts';
import { createPool } from '../../server/db/pool.ts';
import { UnitOfWork } from '../../server/db/unit-of-work.ts';
import { LocalApiClient } from '../../server/e2e/http-client.ts';
import { loginAs, startHarness } from './harness.ts';

// ⭐⭐ D-072 / M-82: the companies of THIS file (the namespace) ⇐
//   ⭐⭐ no other file can touch their rows ⇐ ⭐⭐ the result of the
//   ⭐⭐ file never depends on the order of the files.
const NS = 'con';


const PASSCODE = process.env['WASL_TEST_PASSCODE'] ?? 'wasl-local-test';

test('FOUNDATION 7) the concurrent operations (D-067 remediation)', async (t) => {
  const harness = await startHarness({ namespace: NS });
  t.after(async () => {
    await harness.stop();
  });

  const owner = await loginAs(harness.client, `${NS}_tnt_alpha`, `${NS}_usr_alpha_owner`, PASSCODE);
  // ⭐ The supervisor may change the state (the agent may not): the
  //   race under test is between two employees who are both allowed.
  const supervisor = await loginAs(harness.client, `${NS}_tnt_alpha`, `${NS}_usr_alpha_super`, PASSCODE);
  const agent = await loginAs(harness.client, `${NS}_tnt_alpha`, `${NS}_usr_alpha_agent`, PASSCODE);

  await t.test('⭐ R-04a: two concurrent transitions, one valid update, no silent loss', async () => {
    const ref = `conv_r04_a_${Date.now().toString(36)}`;
    const created = await harness.client.request({
      method: 'POST',
      path: '/api/conversations',
      token: owner,
      payload: {
        conversation_ref: ref,
        customer_id: `${NS}_cus_alpha_1`,
        message: { body: 'r04 race' },
      },
    });
    assert.equal(created.status, 201);

    // ⭐ Two employees move the same conversation at the same time.
    const [first, second] = await Promise.all([
      harness.client.request({
        method: 'POST',
        path: `/api/conversations/${ref}/state`,
        token: owner,
        payload: { to: 'open', reason: 'first' },
      }),
      harness.client.request({
        method: 'POST',
        path: `/api/conversations/${ref}/state`,
        token: supervisor,
        payload: { to: 'open', reason: 'second' },
      }),
    ]);

    const statuses = [first.status, second.status].sort();
    assert.ok(statuses[0] === 200, `no transition succeeded: ${statuses.join(' / ')}`);
    assert.ok(statuses[1] === 409, `the second transition was not refused: ${statuses.join(' / ')}`);
    const loser = first.status === 409 ? first : second;
    const code = String((loser.body['error'] as Record<string, unknown> | undefined)?.['code'] ?? '');
    assert.ok(
      code === 'state_conflict' || code === 'transition_not_allowed' || code === 'state_terminal',
      `the refusal carries an unexpected code: ${code}`,
    );

    // ⭐ Exactly one increment: no lost update and no double write.
    const row = await UnitOfWork.run(harness.ownerPool, `${NS}_tnt_alpha`, async (uow) => {
      const result = await uow.query<{ state: string; version: number }>(
        `select state, version from conversations where ref = $1`,
        [ref],
      );
      const changes = await uow.query<{ count: string }>(
        `select count(*)::text as count from conversation_changes where conversation_ref = $1 and operation = 'state.update'`,
        [ref],
      );
      return {
        state: result.rows[0]?.state ?? 'missing',
        version: Number(result.rows[0]?.version ?? '0'),
        changes: Number(changes.rows[0]?.count ?? '0'),
      };
    });
    assert.equal(row.state, 'open', 'the state of the conversation is not the one that was written');
    assert.equal(row.version, 2, `the version moved more than once: ${row.version}`);
    assert.equal(row.changes, 1, `the change log holds ${row.changes} state changes`);
  });

  await t.test('⭐ R-04b: a stale expected version is a reported conflict', async () => {
    const ref = `conv_r04_b_${Date.now().toString(36)}`;
    const created = await harness.client.request({
      method: 'POST',
      path: '/api/conversations',
      token: owner,
      payload: { conversation_ref: ref, customer_id: `${NS}_cus_alpha_1`, message: { body: 'r04 version' } },
    });
    assert.equal(created.status, 201);

    const first = await harness.client.request({
      method: 'POST',
      path: `/api/conversations/${ref}/state`,
      token: owner,
      payload: { to: 'open', expected_version: 1 },
    });
    assert.equal(first.status, 200, 'the first transition with the right version failed');

    const stale = await harness.client.request({
      method: 'POST',
      path: `/api/conversations/${ref}/state`,
      token: supervisor,
      payload: { to: 'pending', expected_version: 1 },
    });
    assert.equal(stale.status, 409, `the stale version was accepted: ${stale.status}`);
    assert.equal(
      String((stale.body['error'] as Record<string, unknown>)['code']),
      'state_conflict',
      'the stale version did not report a conflict',
    );

    const row = await UnitOfWork.run(harness.ownerPool, `${NS}_tnt_alpha`, async (uow) => {
      const result = await uow.query<{ state: string; version: number }>(
        `select state, version from conversations where ref = $1`,
        [ref],
      );
      return { state: result.rows[0]?.state ?? 'missing', version: Number(result.rows[0]?.version ?? '0') };
    });
    assert.equal(row.state, 'open', 'the refused transition changed the state');
    assert.equal(row.version, 2, 'the refused transition moved the version');
  });

  await t.test('⭐ R-04c: an illegal transition is refused under a race', async () => {
    const ref = `conv_r04_c_${Date.now().toString(36)}`;
    const created = await harness.client.request({
      method: 'POST',
      path: '/api/conversations',
      token: owner,
      payload: { conversation_ref: ref, customer_id: `${NS}_cus_alpha_1`, message: { body: 'r04 illegal' } },
    });
    assert.equal(created.status, 201);

    const [legal, illegal] = await Promise.all([
      harness.client.request({
        method: 'POST',
        path: `/api/conversations/${ref}/state`,
        token: owner,
        payload: { to: 'open' },
      }),
      harness.client.request({
        method: 'POST',
        path: `/api/conversations/${ref}/state`,
        token: supervisor,
        // ⭐ `closed` is illegal from every state except `resolved`, so
        //   the refusal does not depend on which request wins the race.
        payload: { to: 'closed' },
      }),
    ]);
    assert.equal(legal.status, 200, 'the legal transition failed');
    assert.equal(illegal.status, 409, `the illegal transition was accepted: ${illegal.status}`);
    assert.equal(
      String((illegal.body['error'] as Record<string, unknown>)['code']),
      'transition_not_allowed',
      'the illegal transition did not report the declared code',
    );

    const row = await UnitOfWork.run(harness.ownerPool, `${NS}_tnt_alpha`, async (uow) => {
      const result = await uow.query<{ state: string; version: number }>(
        `select state, version from conversations where ref = $1`,
        [ref],
      );
      return { state: result.rows[0]?.state ?? 'missing', version: Number(result.rows[0]?.version ?? '0') };
    });
    assert.equal(row.state, 'open', 'an illegal state reached the database');
    assert.equal(row.version, 2, 'the illegal transition moved the version');
  });

  await t.test('⭐ R-04d: two concurrent messages are both kept', async () => {
    const ref = `conv_r04_d_${Date.now().toString(36)}`;
    const created = await harness.client.request({
      method: 'POST',
      path: '/api/conversations',
      token: owner,
      payload: { conversation_ref: ref, customer_id: `${NS}_cus_alpha_1`, message: { body: 'r04 messages' } },
    });
    assert.equal(created.status, 201);

    // ⭐⭐ M-76: the agent reaches the conversations that are assigned
    //   to them ⇒ the fixture assigns the conversation before the race.
    await UnitOfWork.run(harness.ownerPool, `${NS}_tnt_alpha`, async (uow) => {
      await uow.query(
        `update conversations set assignee_actor_id = '${NS}_usr_alpha_agent' where ref = $1`,
        [ref],
      );
    });

    const [first, second] = await Promise.all([
      harness.client.request({
        method: 'POST',
        path: `/api/conversations/${ref}/messages`,
        token: owner,
        payload: { body: 'first parallel message' },
      }),
      harness.client.request({
        method: 'POST',
        path: `/api/conversations/${ref}/messages`,
        token: agent,
        payload: { body: 'second parallel message' },
      }),
    ]);
    assert.equal(first.status, 201, 'the first parallel message was refused');
    assert.equal(second.status, 201, 'the second parallel message was refused');

    const messages = await UnitOfWork.run(harness.ownerPool, `${NS}_tnt_alpha`, async (uow) => {
      const result = await uow.query<{ body: string }>(
        `select body from messages where conversation_ref = $1 and direction = 'inbound'`,
        [ref],
      );
      return result.rows.map((row) => row.body);
    });
    assert.ok(
      messages.includes('first parallel message') && messages.includes('second parallel message'),
      `a parallel message was lost: ${JSON.stringify(messages)}`,
    );
  });

  await t.test('⭐ R-04e: the memory matches the database and survives a restart', async () => {
    const ref = `conv_r04_e_${Date.now().toString(36)}`;
    const created = await harness.client.request({
      method: 'POST',
      path: '/api/conversations',
      token: owner,
      payload: { conversation_ref: ref, customer_id: `${NS}_cus_alpha_1`, message: { body: 'r04 restart' } },
    });
    assert.equal(created.status, 201);

    const [ok, refused] = await Promise.all([
      harness.client.request({
        method: 'POST',
        path: `/api/conversations/${ref}/state`,
        token: owner,
        payload: { to: 'open' },
      }),
      harness.client.request({
        method: 'POST',
        path: `/api/conversations/${ref}/state`,
        token: supervisor,
        payload: { to: 'open' },
      }),
    ]);
    assert.ok(
      [ok.status, refused.status].includes(200),
      `no transition succeeded: ${ok.status} ${JSON.stringify(ok.body).slice(0, 200)} / ${refused.status} ${JSON.stringify(refused.body).slice(0, 200)}`,
    );
    assert.ok(
      [ok.status, refused.status].includes(409),
      `the race was not refused: ${ok.status} / ${refused.status}`,
    );

    // ⭐ The read after the conflict answers with the stored version.
    const read = await harness.client.request({
      method: 'GET',
      path: `/api/conversations/${ref}`,
      token: owner,
    });
    assert.equal(read.status, 200);
    const stored = read.body['conversation'] as Record<string, unknown>;
    const inDatabase = await UnitOfWork.run(harness.ownerPool, `${NS}_tnt_alpha`, async (uow) => {
      const result = await uow.query<{ state: string; version: number }>(
        `select state, version from conversations where ref = $1`,
        [ref],
      );
      return { state: result.rows[0]?.state ?? 'missing', version: Number(result.rows[0]?.version ?? '0') };
    });
    assert.equal(String(stored['state']), inDatabase.state, 'the memory and the database disagree on the state');
    assert.equal(Number(stored['version']), inDatabase.version, 'the memory and the database disagree on the version');

    // ⭐ A restart of the service reads exactly the same row.
    const restarted = new WaslApiServer({
      config: { ...harness.config, port: harness.port + 3 },
      pool: createPool(harness.config.appDatabaseUrl, 2),
    });
    const address = await restarted.listen();
    const client = new LocalApiClient('127.0.0.1', address.port);
    try {
      const fresh = await loginAs(client, `${NS}_tnt_alpha`, `${NS}_usr_alpha_owner`, PASSCODE);
      const afterRestart = await client.request({ method: 'GET', path: `/api/conversations/${ref}`, token: fresh });
      assert.equal(afterRestart.status, 200);
      const row = afterRestart.body['conversation'] as Record<string, unknown>;
      assert.equal(String(row['state']), inDatabase.state, 'the restarted service lost the state');
      assert.equal(Number(row['version']), inDatabase.version, 'the restarted service lost the version');
      const messages = await client.request({
        method: 'GET',
        path: `/api/conversations/${ref}/messages`,
        token: fresh,
      });
      assert.equal(messages.status, 200);
      const list = messages.body['messages'] as Array<Record<string, unknown>>;
      assert.ok(list.length >= 1, `the restarted service lost the messages: ${list.length}`);
      assert.ok(
        list.some((row) => String(row['body']) === 'r04 restart'),
        'the restarted service returned another conversation message',
      );
    } finally {
      await restarted.close();
    }
  });
});

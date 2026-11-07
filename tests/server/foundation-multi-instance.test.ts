// ============================================================
// WASL AI — FOUNDATION BUILD 02 — PHASE 01
// M-01: two backend instances on the same database
// ------------------------------------------------------------
// ⭐ WHY THIS FILE EXISTS
//   The in-memory bundle of the API server is per PROCESS. The
//   per-tenant queue of D-067 serializes the requests of ONE process
//   only. With two backend instances on the same database the
//   database itself has to protect the writes.
// ⭐ THE PROPERTIES UNDER TEST
//   - a conversation written by one instance is visible to the other,
//   - two concurrent updates (one per instance) do not lose an update
//     and do not double write,
//   - a sequential update on the second instance sees the committed
//     state of the first one (no stale memory),
//   - two instances of two companies never mix their data.
// ⭐ Every check runs against the REAL local PostgreSQL through the
//   REAL HTTP API of the two instances.
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
const NS = 'multi';


const PASSCODE = process.env['WASL_TEST_PASSCODE'] ?? 'wasl-local-test';

test('FOUNDATION 8) two backend instances on one database (M-01)', async (t) => {
  const harness = await startHarness({ namespace: NS });

  // ⭐ The second instance: another process would behave exactly the
  //   same way (the state lives in PostgreSQL, not in the process).
  const secondPool = createPool(harness.config.appDatabaseUrl, 6);
  const secondConfig = { ...harness.config, port: harness.port + 1 };
  const secondApi = new WaslApiServer({ config: secondConfig, pool: secondPool });
  const secondAddress = await secondApi.listen();
  const secondClient = new LocalApiClient('127.0.0.1', secondAddress.port);

  t.after(async () => {
    await secondApi.close();
    await secondPool.end();
    await harness.stop();
  });

  const ownerA = await loginAs(harness.client, `${NS}_tnt_alpha`, `${NS}_usr_alpha_owner`, PASSCODE);
  const ownerB = await loginAs(secondClient, `${NS}_tnt_alpha`, `${NS}_usr_alpha_owner`, PASSCODE);
  const betaA = await loginAs(harness.client, `${NS}_tnt_beta`, `${NS}_usr_beta_owner`, PASSCODE);

  await t.test('⭐⭐ M-01a: a write of one instance is visible to the other', async () => {
    const ref = `conv_m01_a_${Date.now().toString(36)}`;
    const created = await harness.client.request({
      method: 'POST',
      path: '/api/conversations',
      token: ownerA,
      payload: {
        conversation_ref: ref,
        customer_id: `${NS}_cus_alpha_1`,
        message: { body: 'm01 visibility' },
      },
    });
    assert.equal(created.status, 201);

    // ⭐ The second instance never saw the conversation in its memory:
    //   it has to read it from the database.
    const read = await secondClient.request({
      method: 'GET',
      path: `/api/conversations/${ref}`,
      token: ownerB,
    });
    assert.equal(read.status, 200, `the second instance did not read the conversation: ${read.status}`);
    const conversation = read.body['conversation'] as Record<string, unknown> | undefined;
    assert.ok(conversation, 'the conversation body is missing');
    assert.equal(conversation['ref'], ref, 'the conversation body holds another reference');
  });

  await t.test('⭐⭐ M-01b: two instances update at the same time, no update is lost', async () => {
    const ref = `conv_m01_b_${Date.now().toString(36)}`;
    const created = await harness.client.request({
      method: 'POST',
      path: '/api/conversations',
      token: ownerA,
      payload: {
        conversation_ref: ref,
        customer_id: `${NS}_cus_alpha_1`,
        message: { body: 'm01 race' },
      },
    });
    assert.equal(created.status, 201);

    // ⭐ One update per instance, at the same time.
    const [first, second] = await Promise.all([
      harness.client.request({
        method: 'POST',
        path: `/api/conversations/${ref}/state`,
        token: ownerA,
        payload: { to: 'open', reason: 'from the first instance' },
      }),
      secondClient.request({
        method: 'POST',
        path: `/api/conversations/${ref}/state`,
        token: ownerB,
        payload: { to: 'open', reason: 'from the second instance' },
      }),
    ]);

    const statuses = [first.status, second.status].sort();
    assert.equal(statuses[0], 200, `no transition succeeded: ${statuses.join(' / ')}`);
    assert.equal(statuses[1], 409, `the second transition was not refused: ${statuses.join(' / ')}`);
    const loser = first.status === 409 ? first : second;
    const code = String((loser.body['error'] as Record<string, unknown> | undefined)?.['code'] ?? '');
    assert.ok(
      code === 'state_conflict' || code === 'transition_not_allowed',
      `the refusal carries an unexpected code: ${code}`,
    );

    // ⭐ Exactly one increment and one change row: no lost update.
    const row = await UnitOfWork.run(harness.ownerPool, `${NS}_tnt_alpha`, async (uow) => {
      const conversation = await uow.query<{ state: string; version: number }>(
        `select state, version from conversations where ref = $1`,
        [ref],
      );
      const changes = await uow.query<{ count: string }>(
        `select count(*)::text as count from conversation_changes where conversation_ref = $1 and operation = 'state.update'`,
        [ref],
      );
      return {
        state: conversation.rows[0]?.state ?? 'missing',
        version: Number(conversation.rows[0]?.version ?? '0'),
        changes: Number(changes.rows[0]?.count ?? '0'),
      };
    });
    assert.equal(row.state, 'open', 'the state is not the one that was written');
    assert.equal(row.version, 2, `the version moved more than once: ${row.version}`);
    assert.equal(row.changes, 1, `the change log holds ${row.changes} state changes`);
  });

  await t.test('⭐⭐⭐ M-01c: the second instance sees the committed state (no stale memory)', async () => {
    const ref = `conv_m01_c_${Date.now().toString(36)}`;
    const created = await harness.client.request({
      method: 'POST',
      path: '/api/conversations',
      token: ownerA,
      payload: {
        conversation_ref: ref,
        customer_id: `${NS}_cus_alpha_1`,
        message: { body: 'm01 sequence' },
      },
    });
    assert.equal(created.status, 201);

    const firstMove = await harness.client.request({
      method: 'POST',
      path: `/api/conversations/${ref}/state`,
      token: ownerA,
      payload: { to: 'open', reason: 'first move' },
    });
    assert.equal(firstMove.status, 200, 'the first move failed');

    // ⭐ The second instance moves the conversation again. Its memory
    //   still holds the old state: the database lock and the refresh
    //   after the lock are what make this transition legal.
    const secondMove = await secondClient.request({
      method: 'POST',
      path: `/api/conversations/${ref}/state`,
      token: ownerB,
      payload: { to: 'pending', reason: 'second move' },
    });
    assert.equal(
      secondMove.status,
      200,
      `the second instance did not see the committed state: ${secondMove.status} ${JSON.stringify(secondMove.body)}`,
    );

    const row = await UnitOfWork.run(harness.ownerPool, `${NS}_tnt_alpha`, async (uow) => {
      const conversation = await uow.query<{ state: string; version: number }>(
        `select state, version from conversations where ref = $1`,
        [ref],
      );
      const changes = await uow.query<{ count: string }>(
        `select count(*)::text as count from conversation_changes where conversation_ref = $1 and operation = 'state.update'`,
        [ref],
      );
      return {
        state: conversation.rows[0]?.state ?? 'missing',
        version: Number(conversation.rows[0]?.version ?? '0'),
        changes: Number(changes.rows[0]?.count ?? '0'),
      };
    });
    assert.equal(row.state, 'pending', 'the last write did not win');
    assert.equal(row.version, 3, `the version is not the committed one: ${row.version}`);
    assert.equal(row.changes, 2, `the change log holds ${row.changes} state changes`);
  });

  await t.test('⭐⭐ M-01d: the instances never mix the companies', async () => {
    const ref = `conv_m01_d_${Date.now().toString(36)}`;
    const created = await harness.client.request({
      method: 'POST',
      path: '/api/conversations',
      token: ownerA,
      payload: {
        conversation_ref: ref,
        customer_id: `${NS}_cus_alpha_1`,
        message: { body: 'm01 isolation' },
      },
    });
    assert.equal(created.status, 201);

    // ⭐ The second instance asks for the conversation of another
    //   company: the answer must not be the conversation.
    const other = await secondClient.request({
      method: 'GET',
      path: `/api/conversations/${ref}`,
      token: betaA,
    });
    assert.ok(other.status === 404 || other.status === 403, `the conversation leaked: ${other.status}`);
  });

  await t.test('⭐⭐ M-01e: a message written by one instance is stored once and seen by the other', async () => {
    const ref = `conv_m01_e_${Date.now().toString(36)}`;
    const created = await harness.client.request({
      method: 'POST',
      path: '/api/conversations',
      token: ownerA,
      payload: {
        conversation_ref: ref,
        customer_id: `${NS}_cus_alpha_1`,
        message: { body: 'm01 message' },
      },
    });
    assert.equal(created.status, 201);

    const appended = await secondClient.request({
      method: 'POST',
      path: `/api/conversations/${ref}/messages`,
      token: ownerB,
      payload: { body: 'written by the second instance' },
    });
    assert.equal(
      appended.status,
      201,
      `the message was not accepted: ${appended.status} ${JSON.stringify(appended.body)}`,
    );

    const rows = await UnitOfWork.run(harness.ownerPool, `${NS}_tnt_alpha`, async (uow) => {
      const result = await uow.query<{ count: string; body: string }>(
        `select count(*)::text as count, string_agg(body, '|') as body from messages where conversation_ref = $1`,
        [ref],
      );
      return { count: Number(result.rows[0]?.count ?? '0'), body: result.rows[0]?.body ?? '' };
    });
    // ⭐ The experimental server answers every appended message, so the
    //   conversation holds the first message, the new one and its reply.
    assert.equal(rows.count, 3, `the conversation holds ${rows.count} messages instead of 3`);
    const occurrences = rows.body.split('written by the second instance').length - 1;
    assert.equal(occurrences, 1, `the message was stored ${occurrences} times instead of once`);
  });
});

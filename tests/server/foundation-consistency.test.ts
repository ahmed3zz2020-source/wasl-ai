// ============================================================
// WASL AI — FOUNDATION BUILD 02 — PHASE 02 (D-069)
// M-66: the consistency between two backend instances
// ------------------------------------------------------------
// ⭐ WHY THIS FILE EXISTS
//   In PHASE 01 the in-memory bundle of the API server lived for the
//   whole life of the PROCESS (one bundle per company). A conversation
//   that was hydrated once was never read again, so a second instance
//   could work on a stale conversation, and a message that another
//   instance had already stored was silently dropped by the
//   `on conflict do nothing` of the insert.
// ⭐ THE PROPERTIES UNDER TEST
//   - a write of one instance is visible to the other one at once,
//   - the same message reference written twice is REFUSED, never
//     silently dropped and never overwritten,
//   - a new operation never reads a stale conversation,
//   - a restarted instance reads the committed state,
//   - two companies never block or mix each other.
// ⭐ Every check runs against the REAL local PostgreSQL through the
//   REAL HTTP API of two independent instances.
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
const NS = 'cons';


const PASSCODE = process.env['WASL_TEST_PASSCODE'] ?? 'wasl-local-test';

interface Instance {
  readonly api: WaslApiServer;
  readonly client: LocalApiClient;
  readonly stop: () => Promise<void>;
}

test('FOUNDATION 12) the consistency between two backend instances (M-66)', async (t) => {
  const harness = await startHarness({ namespace: NS });

  const secondPool = createPool(harness.config.appDatabaseUrl, 6);
  const secondConfig = { ...harness.config, port: harness.port + 1 };
  const secondApi = new WaslApiServer({ config: secondConfig, pool: secondPool });
  const secondAddress = await secondApi.listen();

  const instances: Instance[] = [
    {
      api: harness.api,
      client: harness.client,
      stop: async () => undefined,
    },
    {
      api: secondApi,
      client: new LocalApiClient('127.0.0.1', secondAddress.port),
      stop: async () => {
        await secondApi.close();
        await secondPool.end();
      },
    },
  ];

  t.after(async () => {
    for (const instance of instances) {
      await instance.stop();
    }
    await harness.stop();
  });

  const ownerA = await loginAs(instances[0]!.client, `${NS}_tnt_alpha`, `${NS}_usr_alpha_owner`, PASSCODE);
  const ownerB = await loginAs(instances[1]!.client, `${NS}_tnt_alpha`, `${NS}_usr_alpha_owner`, PASSCODE);

  const createConversation = async (
    client: LocalApiClient,
    token: string,
    ref: string,
    body: string,
  ): Promise<void> => {
    const created = await client.request({
      method: 'POST',
      path: '/api/conversations',
      token,
      payload: { conversation_ref: ref, customer_id: `${NS}_cus_alpha_1`, message: { body } },
    });
    assert.equal(created.status, 201, `the conversation was not created: ${created.status}`);
  };

  const countMessages = async (ref: string): Promise<{ count: number; bodies: string }> => {
    const rows = await UnitOfWork.run(harness.ownerPool, `${NS}_tnt_alpha`, async (uow) => {
      const result = await uow.query<{ count: string; bodies: string }>(
        `select count(*)::text as count, coalesce(string_agg(body, '|'), '') as bodies
           from messages where conversation_ref = $1`,
        [ref],
      );
      return {
        count: Number(result.rows[0]?.count ?? '0'),
        bodies: result.rows[0]?.bodies ?? '',
      };
    });
    return rows;
  };

  await t.test('⭐⭐⭐ M-66a: the same message reference is refused, not dropped', async () => {
    const ref = `conv_m66_a_${Date.now().toString(36)}`;
    await createConversation(instances[0]!.client, ownerA, ref, 'm66a base');

    const messageRef = `msg_m66_a_${Date.now().toString(36)}`;
    const first = await instances[0]!.client.request({
      method: 'POST',
      path: `/api/conversations/${ref}/messages`,
      token: ownerA,
      payload: { body: 'the first body', message_ref: messageRef },
    });
    assert.equal(first.status, 201, `the first write failed: ${first.status}`);

    // ⭐⭐⭐ The second instance writes the SAME message reference with a
    //   different body. The old code answered 201 and dropped the row.
    const second = await instances[1]!.client.request({
      method: 'POST',
      path: `/api/conversations/${ref}/messages`,
      token: ownerB,
      payload: { body: 'the second body', message_ref: messageRef },
    });
    assert.equal(
      second.status,
      409,
      `the duplicated write was not refused: ${second.status} ${JSON.stringify(second.body)}`,
    );
    const code = String((second.body['error'] as Record<string, unknown> | undefined)?.['code'] ?? '');
    assert.equal(code, 'message_duplicate', `the refusal carries an unexpected code: ${code}`);

    // ⭐ The first body is still the stored one: no overwrite.
    const rows = await countMessages(ref);
    const occurrences = rows.bodies.split('the first body').length - 1;
    const secondOccurrences = rows.bodies.split('the second body').length - 1;
    assert.equal(occurrences, 1, `the first body is stored ${occurrences} times`);
    assert.equal(secondOccurrences, 0, 'the refused body was stored anyway');
  });

  await t.test('⭐⭐⭐ M-66b: a write of one instance is visible to the other at once', async () => {
    const ref = `conv_m66_b_${Date.now().toString(36)}`;
    await createConversation(instances[0]!.client, ownerA, ref, 'm66b base');

    const body = `m66b written ${Date.now().toString(36)}`;
    const written = await instances[0]!.client.request({
      method: 'POST',
      path: `/api/conversations/${ref}/messages`,
      token: ownerA,
      payload: { body },
    });
    assert.equal(written.status, 201, 'the write failed');

    const read = await instances[1]!.client.request({
      method: 'GET',
      path: `/api/conversations/${ref}/messages`,
      token: ownerB,
    });
    assert.equal(read.status, 200, `the second instance did not read: ${read.status}`);
    const messages = read.body['messages'] as Record<string, unknown>[] | undefined;
    assert.ok(Array.isArray(messages), 'the message list is missing');
    const bodies = messages.map((row) => String(row['body']));
    assert.ok(bodies.includes(body), 'the committed message is not visible to the second instance');
  });

  await t.test('⭐⭐⭐ M-66c: a new operation never reads a stale conversation', async () => {
    const ref = `conv_m66_c_${Date.now().toString(36)}`;
    await createConversation(instances[0]!.client, ownerA, ref, 'm66c base');

    // ⭐ The first instance works on the conversation, so its (old)
    //   memory is warm. The second instance then changes the state.
    const firstMove = await instances[0]!.client.request({
      method: 'POST',
      path: `/api/conversations/${ref}/state`,
      token: ownerA,
      payload: { to: 'open', reason: 'm66c first move' },
    });
    assert.equal(firstMove.status, 200, 'the first move failed');

    const secondMove = await instances[1]!.client.request({
      method: 'POST',
      path: `/api/conversations/${ref}/state`,
      token: ownerB,
      payload: { to: 'pending', reason: 'm66c second move' },
    });
    assert.equal(secondMove.status, 200, `the second move failed: ${secondMove.status}`);

    // ⭐⭐ The first instance reads the conversation again: it must see
    //   the committed state of the second instance, not its own memory.
    const read = await instances[0]!.client.request({
      method: 'GET',
      path: `/api/conversations/${ref}`,
      token: ownerA,
    });
    assert.equal(read.status, 200, 'the read failed');
    const conversation = read.body['conversation'] as Record<string, unknown> | undefined;
    assert.ok(conversation, 'the conversation body is missing');
    assert.equal(conversation['state'], 'pending', 'the read returned a stale state');
    assert.equal(conversation['version'], 3, 'the read returned a stale version');
  });

  await t.test('⭐⭐⭐ M-66d: a restarted instance reads the committed state', async () => {
    const ref = `conv_m66_d_${Date.now().toString(36)}`;
    await createConversation(instances[0]!.client, ownerA, ref, 'm66d base');

    const moved = await instances[0]!.client.request({
      method: 'POST',
      path: `/api/conversations/${ref}/state`,
      token: ownerA,
      payload: { to: 'open', reason: 'm66d move' },
    });
    assert.equal(moved.status, 200, 'the move failed');

    // ⭐ A brand new instance (a restart) on the same database.
    const restartPool = createPool(harness.config.appDatabaseUrl, 4);
    const restartApi = new WaslApiServer({
      config: { ...harness.config, port: harness.port + 2 },
      pool: restartPool,
    });
    const restartAddress = await restartApi.listen();
    const restartClient = new LocalApiClient('127.0.0.1', restartAddress.port);
    try {
      const token = await loginAs(restartClient, `${NS}_tnt_alpha`, `${NS}_usr_alpha_owner`, PASSCODE);
      const read = await restartClient.request({
        method: 'GET',
        path: `/api/conversations/${ref}`,
        token,
      });
      assert.equal(read.status, 200, 'the restarted instance did not read');
      const conversation = read.body['conversation'] as Record<string, unknown> | undefined;
      assert.equal(conversation?.['state'], 'open', 'the restarted instance read a stale state');
      assert.equal(conversation?.['version'], 2, 'the restarted instance read a stale version');
    } finally {
      await restartApi.close();
      await restartPool.end();
    }
  });

  await t.test('⭐⭐ M-66e: two companies run in parallel and never mix', async () => {
    const alphaRef = `conv_m66_e_a_${Date.now().toString(36)}`;
    const betaRef = `conv_m66_e_b_${Date.now().toString(36)}`;
    const betaOwner = await loginAs(instances[1]!.client, `${NS}_tnt_beta`, `${NS}_usr_beta_owner`, PASSCODE);

    const alphaCreated = await instances[0]!.client.request({
      method: 'POST',
      path: '/api/conversations',
      token: ownerA,
      payload: {
        conversation_ref: alphaRef,
        customer_id: `${NS}_cus_alpha_1`,
        message: { body: 'm66e alpha' },
      },
    });
    assert.equal(alphaCreated.status, 201, 'the alpha conversation was not created');

    // ⭐ The two companies write at the same time: the operations must
    //   not block each other and the data must not travel.
    const [alphaWrite, betaWrite] = await Promise.all([
      instances[0]!.client.request({
        method: 'POST',
        path: `/api/conversations/${alphaRef}/messages`,
        token: ownerA,
        payload: { body: 'm66e alpha body' },
      }),
      instances[1]!.client.request({
        method: 'POST',
        path: '/api/conversations',
        token: betaOwner,
        payload: {
          conversation_ref: betaRef,
          customer_id: `${NS}_cus_beta_1`,
          message: { body: 'm66e beta body' },
        },
      }),
    ]);
    assert.equal(alphaWrite.status, 201, `the alpha write failed: ${alphaWrite.status}`);
    assert.equal(betaWrite.status, 201, `the beta write failed: ${betaWrite.status}`);

    const alphaRows = await UnitOfWork.run(harness.ownerPool, `${NS}_tnt_alpha`, async (uow) => {
      const result = await uow.query<{ count: string }>(
        `select count(*)::text as count from messages where conversation_ref = $1`,
        [alphaRef],
      );
      return Number(result.rows[0]?.count ?? '0');
    });
    const betaRows = await UnitOfWork.run(harness.ownerPool, `${NS}_tnt_beta`, async (uow) => {
      const result = await uow.query<{ count: string }>(
        `select count(*)::text as count from messages where conversation_ref = $1`,
        [betaRef],
      );
      return Number(result.rows[0]?.count ?? '0');
    });
    assert.equal(alphaRows, 3, `the alpha conversation holds ${alphaRows} messages`);
    // ⭐ The beta conversation holds only its own creation message: the
    //   alpha append did not travel.
    assert.equal(betaRows, 1, `the beta conversation holds ${betaRows} messages`);
  });

  await t.test('⭐⭐ M-66f: the append is based on the committed version', async () => {
    const ref = `conv_m66_f_${Date.now().toString(36)}`;
    await createConversation(instances[0]!.client, ownerA, ref, 'm66f base');

    const moved = await instances[1]!.client.request({
      method: 'POST',
      path: `/api/conversations/${ref}/state`,
      token: ownerB,
      payload: { to: 'open', reason: 'm66f move' },
    });
    assert.equal(moved.status, 200, 'the move failed');

    // ⭐ The first instance appends after the second one moved the
    //   conversation: the write must be based on the committed version.
    const appended = await instances[0]!.client.request({
      method: 'POST',
      path: `/api/conversations/${ref}/messages`,
      token: ownerA,
      payload: { body: 'm66f append' },
    });
    assert.equal(appended.status, 201, `the append failed: ${appended.status}`);

    const row = await UnitOfWork.run(harness.ownerPool, `${NS}_tnt_alpha`, async (uow) => {
      const result = await uow.query<{ version: number; state: string }>(
        `select version, state from conversations where ref = $1`,
        [ref],
      );
      const changes = await uow.query<{ count: string }>(
        `select count(*)::text as count from conversation_changes where conversation_ref = $1`,
        [ref],
      );
      return {
        version: Number(result.rows[0]?.version ?? '0'),
        state: String(result.rows[0]?.state ?? ''),
        changes: Number(changes.rows[0]?.count ?? '0'),
      };
    });
    assert.equal(row.state, 'open', 'the committed state was lost');
    assert.equal(row.version, 2, `the version is not the committed one: ${row.version}`);
    assert.equal(row.changes, 1, `the change log holds ${row.changes} entries`);
  });

  await t.test('⭐⭐ M-66g: read your writes on the same instance', async () => {
    const ref = `conv_m66_g_${Date.now().toString(36)}`;
    await createConversation(instances[0]!.client, ownerA, ref, 'm66g base');

    const moved = await instances[0]!.client.request({
      method: 'POST',
      path: `/api/conversations/${ref}/state`,
      token: ownerA,
      payload: { to: 'open', reason: 'm66g move' },
    });
    assert.equal(moved.status, 200, 'the move failed');

    const read = await instances[0]!.client.request({
      method: 'GET',
      path: `/api/conversations/${ref}`,
      token: ownerA,
    });
    const conversation = read.body['conversation'] as Record<string, unknown> | undefined;
    assert.equal(conversation?.['state'], 'open', 'the instance did not read its own write');
    assert.equal(conversation?.['version'], 2, 'the instance read a stale version');
  });
});

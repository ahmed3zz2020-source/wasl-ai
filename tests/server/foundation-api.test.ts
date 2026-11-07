// ============================================================
// WASL AI — FOUNDATION BUILD 01 — API contract and durability
// ------------------------------------------------------------
// ⭐ AC-01: the local backend and the database run from reproducible
//   instructions (the harness is that instruction, in code).
// ⭐ AC-02: a write through the API survives a restart of the service
//   and a new database connection.
// ⭐ AC-09: the full journey passes through the API and PostgreSQL,
//   and the rejected journey is refused.
// ⛔ Local synthetic database only.
// ============================================================

import assert from 'node:assert/strict';
import test from 'node:test';

import { WaslApiServer } from '../../server/api/server.ts';
import { createPool } from '../../server/db/pool.ts';
import { UnitOfWork } from '../../server/db/unit-of-work.ts';
import { runJourney } from '../../server/e2e/journey.ts';
import { startHarness, loginAs, resetSyntheticData, type Harness } from './harness.ts';

const PASSCODE = process.env['WASL_TEST_PASSCODE'] ?? 'wasl-local-test';

test('FOUNDATION 2) API contract, durability and the end to end journey', async (t) => {
  const harness = await startHarness();
  t.after(async () => {
    await harness.stop();
  });
  await resetSyntheticData(harness.ownerPool, PASSCODE);

  await t.test('⭐ AC-09a: the accepted journey passes every step', async () => {
    const report = await runJourney({ client: harness.client, passcode: PASSCODE });
    for (const failure of report.failures) {
      assert.fail(failure);
    }
    assert.equal(report.steps.length, 15);
    assert.ok(report.ok);
  });

  await t.test('⭐ AC-09b: the rejected journey is refused', async () => {
    const viewer = await loginAs(harness.client, 'tnt_alpha', 'usr_alpha_viewer', PASSCODE);
    const created = await harness.client.request({
      method: 'POST',
      path: '/api/conversations',
      token: viewer,
      payload: { conversation_ref: 'conv_viewer_denied', message: { body: 'hello' } },
    });
    assert.equal(created.status, 403, 'the viewer was allowed to create a conversation');

    const write = await harness.client.request({
      method: 'POST',
      path: '/api/conversations/conv_alpha_1/messages',
      token: viewer,
      payload: { body: 'let me write' },
    });
    assert.equal(write.status, 403, 'the viewer was allowed to write');
  });

  await t.test('⭐ AC-02: a write survives a service restart and a new connection', async () => {
    const owner = await loginAs(harness.client, 'tnt_alpha', 'usr_alpha_owner', PASSCODE);
    const reference = `conv_durable_${Date.now().toString(36)}`;
    const created = await harness.client.request({
      method: 'POST',
      path: '/api/conversations',
      token: owner,
      payload: { conversation_ref: reference, customer_id: 'cus_alpha_1', message: { body: 'durable message' } },
    });
    assert.equal(created.status, 201);

    // A brand new connection sees the row: the data is in PostgreSQL.
    const freshPool = createPool(harness.config.appDatabaseUrl, 2);
    try {
      const rows = await UnitOfWork.run(freshPool, 'tnt_alpha', async (uow) => {
        const result = await uow.query<{ count: string }>(
          `select count(*)::text as count from conversations where ref = $1`,
          [reference],
        );
        return Number(result.rows[0]?.count ?? '0');
      });
      assert.equal(rows, 1, 'the row is not in the database');
    } finally {
      await freshPool.end();
    }

    // A brand new server process (new in-memory bundle) still serves it.
    const second = new WaslApiServer({
      config: { ...harness.config, port: harness.port + 1 },
      pool: createPool(harness.config.appDatabaseUrl, 2),
    });
    const address = await second.listen();
    try {
      const { LocalApiClient } = await import('../../server/e2e/http-client.ts');
      const client = new LocalApiClient('127.0.0.1', address.port);
      const read = await client.request({ path: `/api/conversations/${reference}`, token: owner });
      assert.equal(read.status, 200, 'the restarted service did not serve the stored row');
    } finally {
      await second.close();
    }
  });

  await t.test('⭐ input validation: the API refuses malformed requests', async () => {
    const owner = await loginAs(harness.client, 'tnt_alpha', 'usr_alpha_owner', PASSCODE);

    const noBody = await harness.client.request({
      method: 'POST',
      path: '/api/conversations',
      token: owner,
      payload: {},
    });
    assert.equal(noBody.status, 201, 'a conversation without a message is allowed by design');

    const emptyMessage = await harness.client.request({
      method: 'POST',
      path: '/api/conversations',
      token: owner,
      payload: { conversation_ref: 'conv_bad_body', message: { body: '' } },
    });
    assert.ok(emptyMessage.status >= 400, 'an empty message body was accepted');

    const noToken = await harness.client.request({ path: '/api/conversations' });
    assert.equal(noToken.status, 401, 'a request without a token was accepted');

    const badToken = await harness.client.request({ path: '/api/conversations', token: 'not-a-token' });
    assert.equal(badToken.status, 401, 'a malformed token was accepted');

    const unknownRoute = await harness.client.request({ path: '/api/does-not-exist', token: owner });
    assert.equal(unknownRoute.status, 404, 'an unknown route did not answer 404');

    const badState = await harness.client.request({
      method: 'POST',
      path: '/api/conversations/conv_alpha_1/state',
      token: owner,
      payload: { to: 'not_a_state' },
    });
    assert.ok(badState.status >= 400, 'an unknown state was accepted');
  });

  await t.test('⭐ errors are safe: no SQL text and no secrets in the answers', async () => {
    const owner = await loginAs(harness.client, 'tnt_alpha', 'usr_alpha_owner', PASSCODE);
    const response = await harness.client.request({
      method: 'POST',
      path: '/api/conversations',
      token: owner,
      payload: { conversation_ref: 'conv_fk_probe', customer_id: 'cus_does_not_exist', message: { body: 'x' } },
    });
    assert.ok(response.status >= 400);
    const payload = JSON.stringify(response.body);
    assert.ok(!payload.includes('SELECT'), 'the SQL text leaked');
    assert.ok(!payload.includes('pg_'), 'a database object leaked');
    assert.ok(!payload.includes(PASSCODE), 'the passcode leaked');
  });

  await t.test('⭐ AC-01: the health endpoint reports the local scope', async () => {
    const response = await harness.client.request({ path: '/health' });
    assert.equal(response.status, 200);
    assert.equal(response.body['scope'], 'local-test');
  });
});

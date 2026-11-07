// ============================================================
// WASL AI — FOUNDATION BUILD 03 / PHASE 02 (D-071)
// the refresh and the lost answer — the server side
// ------------------------------------------------------------
// ⭐⭐ WHAT THIS FILE MEASURES
//   The two behaviours that only appear when TWO employees work at
//   the SAME time on TWO backend instances over ONE database:
//   ⭐ M-77: an employee on the second instance sees the message that
//     the first instance wrote, and the refresh asks only for what is
//     new,
//   ⭐ M-80: the same reply reference sent through the two instances
//     is stored ONCE (never twice), and the second instance says so.
// ⭐ EVERYTHING IS REAL
//   ⭐ Two real HTTP servers, one real PostgreSQL, real sessions.
// ⛔ Local synthetic database only.
// ============================================================

import assert from 'node:assert/strict';
import test from 'node:test';

import { WaslApiServer } from '../../server/api/server.ts';
import { createPool } from '../../server/db/pool.ts';
import { UnitOfWork } from '../../server/db/unit-of-work.ts';
import { LocalApiClient } from '../../server/e2e/http-client.ts';
import { createSyntheticCompany, loginAs, startHarness } from './harness.ts';

const PASSCODE = process.env['WASL_TEST_PASSCODE'] ?? 'wasl-local-test';
const RUN = Math.random().toString(36).slice(2, 10);

function rowsOf(body: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = body[key];
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

test('FOUNDATION 23) the refresh and the lost answer on two instances (D-071)', async (t) => {
  const harness = await startHarness();
  t.after(async () => {
    await harness.stop();
  });

  // ⭐⭐ D-071: the drill owns its company (the files run in parallel
  //   over one database ⇒ the shared tenant is not safe for a drill
  //   that counts rows).
  const tenantId = 'tnt_d071_sync';
  const ids = await createSyntheticCompany(harness.ownerPool, tenantId, PASSCODE, [
    { id: 'usr_d071_sync_owner', role: 'owner' },
  ]);
  const owner = await loginAs(harness.client, tenantId, ids.userIds['owner']!, PASSCODE);

  // ⭐ A synthetic conversation of the company.
  const ref = `conv_d071_sync_${RUN}`;
  await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
    await uow.query(
      `insert into customers (id, tenant_id, display_name, data_class)
       values ($1,$2,$3,'standard') on conflict (id) do nothing`,
      [`cus_d071_${RUN}`, tenantId, 'عميل التزامن'],
    );
    await uow.query(
      `insert into conversations (tenant_id, ref, customer_id, state, version, updated_at)
       values ($1,$2,$3,'open',1, now())`,
      [tenantId, ref, `cus_d071_${RUN}`],
    );
    await uow.query(
      `insert into messages (message_ref, tenant_id, conversation_ref, channel, direction, sender,
                             recipient, body, occurred_at, locale, attributes, stored_at)
       values ($1,$2,$3,'web','inbound','customer@example.invalid','agent@example.invalid',$4, now(),'ar','{}'::jsonb, now())`,
      [`msg_d071_${RUN}`, tenantId, ref, 'رسالة البداية'],
    );
  });

  const poolA = createPool(harness.config.appDatabaseUrl, 4);
  const poolB = createPool(harness.config.appDatabaseUrl, 4);
  const apiA = new WaslApiServer({ config: { ...harness.config, port: harness.port + 31 }, pool: poolA });
  const apiB = new WaslApiServer({ config: { ...harness.config, port: harness.port + 32 }, pool: poolB });
  const addressA = await apiA.listen();
  const addressB = await apiB.listen();
  const clientA = new LocalApiClient('127.0.0.1', addressA.port);
  const clientB = new LocalApiClient('127.0.0.1', addressB.port);

  try {
    await t.test('⭐⭐⭐ SY-01: M-77 — the second instance sees the new message of the first', async () => {
      // ⭐ The employee of the SECOND instance opens the thread.
      const opened = await clientB.request({
        method: 'GET',
        path: `/api/inbox/conversations/${ref}`,
        token: owner,
      });
      assert.equal(opened.status, 200, `the second instance failed: ${opened.status}`);
      const serverTime = String(opened.body['server_time'] ?? '');
      assert.ok(serverTime.length > 0, '⭐⭐⭐ the instant of the database is missing');
      const before = rowsOf(opened.body, 'messages').length;

      // ⭐⭐ The FIRST instance writes a new message.
      const written = await clientA.request({
        method: 'POST',
        path: `/api/inbox/conversations/${ref}/replies`,
        token: owner,
        payload: { body: 'رد من النسخة الأولى', client_message_ref: `reply_sync_a_${RUN}` },
      });
      assert.equal(written.status, 201, `the first instance refused: ${written.status}`);

      // ⭐⭐ The refresh of the SECOND instance asks for what is new.
      const refreshed = await clientB.request({
        method: 'GET',
        path: `/api/inbox/conversations/${ref}?since=${encodeURIComponent(serverTime)}`,
        token: owner,
      });
      assert.equal(refreshed.status, 200, 'the refresh failed');
      const fresh = rowsOf(refreshed.body, 'messages');
      assert.equal(fresh.length, 1, `⭐⭐⭐ the refresh did not carry the new message: ${fresh.length}`);
      assert.equal(fresh[0]!['body'], 'رد من النسخة الأولى', 'the wrong message came');
      assert.equal(
        before,
        1,
        '⭐⭐⭐ the thread of the second instance did not carry the message of the start',
      );
    });

    await t.test('⭐⭐⭐ SY-02: M-80 — the same reference through the two instances is stored ONCE', async () => {
      const clientRef = `reply_sync_same_${RUN}`;
      const body = 'رد بنفس المرجع من نسختين';

      // ⭐⭐ The SAME reference through the two instances at the SAME time.
      const [first, second] = await Promise.all([
        clientA.request({
          method: 'POST',
          path: `/api/inbox/conversations/${ref}/replies`,
          token: owner,
          payload: { body, client_message_ref: clientRef },
        }),
        clientB.request({
          method: 'POST',
          path: `/api/inbox/conversations/${ref}/replies`,
          token: owner,
          payload: { body, client_message_ref: clientRef },
        }),
      ]);
      // ⭐ One of them stores it; the other is refused (never twice).
      const statuses = [first.status, second.status].sort();
      assert.deepEqual(statuses, [201, 409], `⭐⭐⭐ the statuses are wrong: ${statuses}`);
      const refused = first.status === 409 ? first : second;
      // ⭐⭐ The refusal has TWO ways (both are a refusal):
      //   `message_duplicate` when the bundle of the instance already
      //   knows the message, and `message_conflict` when the write
      //   meets it in the database.
      const code = String((refused.body['error'] as Record<string, unknown>)['code'] ?? '');
      assert.ok(
        code === 'message_duplicate' || code === 'message_conflict',
        `⭐⭐⭐ the refusal is not announced: ${JSON.stringify(refused.body)}`,
      );

      // ⭐⭐⭐ And the database carries it ONCE.
      const stored = await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
        const result = await uow.query(
          `select count(*)::int as count from messages where tenant_id = $1 and message_ref = $2`,
          [tenantId, clientRef],
        );
        return Number(result.rows[0]?.['count'] ?? '0');
      });
      assert.equal(stored, 1, `⭐⭐⭐ the message is stored ${stored} times`);
    });

    await t.test('⭐⭐⭐ SY-03: the CRM of the two instances carries the same customers', async () => {
      const listA = await clientA.request({
        method: 'GET',
        path: '/api/crm/customers?limit=200',
        token: owner,
      });
      const listB = await clientB.request({
        method: 'GET',
        path: '/api/crm/customers?limit=200',
        token: owner,
      });
      assert.equal(listA.status, 200, 'the list of the first instance failed');
      assert.equal(listB.status, 200, 'the list of the second instance failed');
      const idsA = rowsOf(listA.body, 'customers').map((row) => String(row['id']));
      const idsB = rowsOf(listB.body, 'customers').map((row) => String(row['id']));
      assert.deepEqual(idsA, idsB, '⭐⭐⭐ the two instances do not see the same customers');
      assert.equal(listA.body['total'], listB.body['total'], '⭐⭐⭐ the totals differ');
    });

    await t.test('⭐⭐⭐ SY-04: the lock of the customer is shared by the two instances', async () => {
      const target = `cus_d071_${RUN}`;
      const profile = await clientA.request({
        method: 'GET',
        path: `/api/crm/customers/${target}`,
        token: owner,
      });
      assert.equal(profile.status, 200, `the profile failed: ${profile.status}`);
      const version = Number((profile.body['customer'] as Record<string, unknown>)['version'] ?? 0);

      // ⭐⭐ The two instances edit with the SAME version.
      const [editA, editB] = await Promise.all([
        clientA.request({
          method: 'PATCH',
          path: `/api/crm/customers/${target}`,
          token: owner,
          payload: { display_name: 'تعديل من النسخة الأولى', version },
        }),
        clientB.request({
          method: 'PATCH',
          path: `/api/crm/customers/${target}`,
          token: owner,
          payload: { display_name: 'تعديل من النسخة الثانية', version },
        }),
      ]);
      const statuses = [editA.status, editB.status].sort();
      assert.deepEqual(statuses, [200, 409], `⭐⭐⭐ the statuses are wrong: ${statuses}`);
    });
  } finally {
    await apiA.close();
    await apiB.close();
    await poolA.end();
    await poolB.end();
  }
});

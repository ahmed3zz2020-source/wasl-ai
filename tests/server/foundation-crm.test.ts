// ============================================================
// WASL AI — FOUNDATION BUILD 03 / PHASE 02 (D-071)
// the customer CRM — the API, the isolation and the lock
// ------------------------------------------------------------
// ⭐ THE PROPERTY UNDER TEST
//   The CRM is a REAL surface over the same database: the list of the
//   customers of a company, the profile of one customer with its
//   conversations, and the edit of the fields the owner approved.
// ⭐ THE PROPERTIES
//   - the list is PAGINATED and the total is real (a company with
//     more than a hundred customers sees all of them),
//   - the search narrows the list and works with the pagination,
//   - the profile carries the conversations of the customer,
//   - the edit needs the capability of the core (`customer.manage`:
//     the owner and the supervisor only),
//   - the edit refuses the invalid input,
//   - the edit refuses a company of another tenant,
//   - the edit refuses a stale version (no lost update),
//   - the edit is audited,
//   - an agent reaches only the customers of their own conversations,
//   - the refresh of the thread asks only for what is new (M-77).
// ⛔ Local synthetic database only.
// ============================================================

import assert from 'node:assert/strict';
import test from 'node:test';

import { WaslApiServer } from '../../server/api/server.ts';
import { createPool } from '../../server/db/pool.ts';
import { UnitOfWork } from '../../server/db/unit-of-work.ts';
import { LocalApiClient } from '../../server/e2e/http-client.ts';
import { createSyntheticCompany, loginAs, startHarness, type Harness } from './harness.ts';

const PASSCODE = process.env['WASL_TEST_PASSCODE'] ?? 'wasl-local-test';
const RUN = Math.random().toString(36).slice(2, 10);

interface Seeded {
  readonly customerIds: readonly string[];
  readonly conversationRefs: readonly string[];
}

/** ⭐ A synthetic company with many customers and conversations. */
async function seedCustomers(
  harness: Harness,
  tenantId: string,
  count: number,
): Promise<Seeded> {
  const customerIds: string[] = [];
  const conversationRefs: string[] = [];
  await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
    for (let index = 0; index < count; index += 1) {
      const customerId = `cus_crm_${RUN}_${index}`;
      const ref = `conv_crm_${RUN}_${index}`;
      customerIds.push(customerId);
      conversationRefs.push(ref);
      await uow.query(
        `insert into customers (id, tenant_id, display_name, data_class, email, phone)
         values ($1,$2,$3,'standard',$4,$5)
         on conflict (id) do update set display_name = excluded.display_name`,
        [customerId, tenantId, `عميل رقم ${index}`, `c${index}@example.invalid`, `+2010000${index}`],
      );
      await uow.query(
        `insert into conversations (tenant_id, ref, customer_id, state, version, updated_at)
         values ($1,$2,$3,'open',1, now())`,
        [tenantId, ref, customerId],
      );
      await uow.query(
        `insert into messages (message_ref, tenant_id, conversation_ref, channel, direction, sender,
                               recipient, body, occurred_at, locale, attributes, stored_at)
         values ($1,$2,$3,'web','inbound','customer@example.invalid','agent@example.invalid',$4, now(),'ar','{}'::jsonb, now())`,
        [`msg_${ref}_seed`, tenantId, ref, `رسالة العميل ${index}`],
      );
    }
    // ⭐⭐ ONE customer with MANY conversations (the counter of the list).
    const busy = `cus_crm_busy_${RUN}`;
    customerIds.push(busy);
    await uow.query(
      `insert into customers (id, tenant_id, display_name, data_class, email, phone)
       values ($1,$2,$3,'standard',$4,$5)
       on conflict (id) do update set display_name = excluded.display_name`,
      [busy, tenantId, 'عميل متعدد المحادثات', `busy${RUN}@example.invalid`, '+2010009999'],
    );
    for (let index = 0; index < 3; index += 1) {
      const ref = `conv_crm_busy_${RUN}_${index}`;
      conversationRefs.push(ref);
      await uow.query(
        `insert into conversations (tenant_id, ref, customer_id, state, version, updated_at)
         values ($1,$2,$3,'open',1, now())`,
        [tenantId, ref, busy],
      );
    }
  });
  return { customerIds, conversationRefs };
}

function rowsOf(body: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = body[key];
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

test('FOUNDATION 20) the customer CRM works on the real backend (D-071)', async (t) => {
  const harness = await startHarness();
  t.after(async () => {
    await harness.stop();
  });

  // ⭐⭐ D-071: the drill owns its company (the files run in parallel
  //   over one database ⇒ the shared tenant is not safe for a drill
  //   that counts rows).
  const tenantId = 'tnt_d071_crm';
  const otherTenantId = 'tnt_d071_crm_other';
  const ids = await createSyntheticCompany(harness.ownerPool, tenantId, PASSCODE, [
    { id: 'usr_d071_crm_owner', role: 'owner' },
    { id: 'usr_d071_crm_super', role: 'supervisor' },
    { id: 'usr_d071_crm_agent', role: 'agent' },
    { id: 'usr_d071_crm_viewer', role: 'viewer' },
  ]);
  const otherIds = await createSyntheticCompany(harness.ownerPool, otherTenantId, PASSCODE, [
    { id: 'usr_d071_crm_other_owner', role: 'owner' },
  ]);
  const owner = await loginAs(harness.client, tenantId, ids.userIds['owner']!, PASSCODE);
  const supervisor = await loginAs(harness.client, tenantId, ids.userIds['supervisor']!, PASSCODE);
  const agent = await loginAs(harness.client, tenantId, ids.userIds['agent']!, PASSCODE);
  const viewer = await loginAs(harness.client, tenantId, ids.userIds['viewer']!, PASSCODE);
  const otherCompany = await loginAs(harness.client, otherTenantId, otherIds.userIds['owner']!, PASSCODE);

  const seeded = await seedCustomers(harness, tenantId, 120);

  await t.test('⭐⭐⭐ CRM-01: the list is PAGINATED and the total is real', async () => {
    const first = await harness.client.request({
      method: 'GET',
      path: '/api/crm/customers?limit=25&offset=0',
      token: owner,
    });
    assert.equal(first.status, 200, `the list failed: ${first.status}`);
    const rows = rowsOf(first.body, 'customers');
    assert.equal(rows.length, 25, `the page is not 25 rows: ${rows.length}`);
    const total = Number(first.body['total'] ?? '0');
    assert.ok(total >= 120, `⭐⭐⭐ the total is not real: ${total}`);
    assert.equal(first.body['limit'], 25, 'the limit is not announced');

    // ⭐⭐⭐ The next page carries OTHER rows (no repetition, no loss).
    const second = await harness.client.request({
      method: 'GET',
      path: '/api/crm/customers?limit=25&offset=25',
      token: owner,
    });
    assert.equal(second.status, 200, 'the second page failed');
    const firstIds = new Set(rows.map((row) => String(row['id'])));
    const secondIds = rowsOf(second.body, 'customers').map((row) => String(row['id']));
    assert.equal(secondIds.length, 25, 'the second page is not full');
    for (const id of secondIds) {
      assert.ok(!firstIds.has(id), `⭐⭐⭐ the row ${id} is on two pages`);
    }
    // ⭐⭐⭐ And the LAST page carries the rest.
    const last = await harness.client.request({
      method: 'GET',
      path: `/api/crm/customers?limit=25&offset=${total - 10}`,
      token: owner,
    });
    assert.equal(last.status, 200, 'the last page failed');
    assert.ok(rowsOf(last.body, 'customers').length <= 25, 'the last page is too big');
  });

  await t.test('⭐⭐⭐ CRM-02: the search narrows the list and works with the pages', async () => {
    const found = await harness.client.request({
      method: 'GET',
      path: `/api/crm/customers?q=${encodeURIComponent(`crm_busy_${RUN}`)}`,
      token: owner,
    });
    assert.equal(found.status, 200, 'the search failed');
    const rows = rowsOf(found.body, 'customers');
    assert.ok(rows.length >= 1, '⭐⭐⭐ the search found nothing');
    for (const row of rows) {
      assert.ok(
        String(row['id']).includes(`crm_busy_${RUN}`),
        `⭐⭐⭐ the search returned a row that does not match: ${row['id']}`,
      );
    }
    // ⭐⭐⭐ The search and the pagination together.
    const paged = await harness.client.request({
      method: 'GET',
      path: `/api/crm/customers?q=${encodeURIComponent(`crm_busy_${RUN}`)}&limit=1&offset=0`,
      token: owner,
    });
    assert.equal(paged.status, 200, 'the paged search failed');
    assert.equal(rowsOf(paged.body, 'customers').length, 1, 'the paged search is not limited');
  });

  await t.test('⭐⭐⭐ CRM-03: the profile carries the customer and its conversations', async () => {
    const busy = `cus_crm_busy_${RUN}`;
    const answer = await harness.client.request({
      method: 'GET',
      path: `/api/crm/customers/${busy}`,
      token: owner,
    });
    assert.equal(answer.status, 200, `the profile failed: ${answer.status}`);
    const customer = answer.body['customer'] as Record<string, unknown>;
    assert.equal(customer['id'], busy, 'the profile is of another customer');
    const conversations = rowsOf(answer.body, 'conversations');
    assert.equal(conversations.length, 3, `⭐⭐⭐ the conversations are missing: ${conversations.length}`);
    assert.equal(answer.body['may_manage'], true, '⭐⭐⭐ the owner may not manage');
  });

  await t.test('⭐⭐⭐ CRM-04: the edit needs the capability of the core', async () => {
    const target = seeded.customerIds[0]!;
    const profile = await harness.client.request({
      method: 'GET',
      path: `/api/crm/customers/${target}`,
      token: owner,
    });
    const version = Number((profile.body['customer'] as Record<string, unknown>)['version'] ?? 0);

    const byOwner = await harness.client.request({
      method: 'PATCH',
      path: `/api/crm/customers/${target}`,
      token: owner,
      payload: { display_name: 'اسم محدَّث', version },
    });
    assert.equal(byOwner.status, 200, `⭐⭐⭐ the owner cannot edit: ${byOwner.status} ${JSON.stringify(byOwner.body)}`);
    assert.equal((byOwner.body['customer'] as Record<string, unknown>)['display_name'], 'اسم محدَّث', 'the name did not change');

    // ⭐⭐⭐ The agent and the viewer have NO capability for it.
    for (const token of [agent, viewer]) {
      const refused = await harness.client.request({
        method: 'PATCH',
        path: `/api/crm/customers/${target}`,
        token,
        payload: { display_name: 'محاولة', version },
      });
      assert.equal(refused.status, 403, `⭐⭐⭐ a role without the capability edited a customer: ${refused.status}`);
    }
  });

  await t.test('⭐⭐⭐ CRM-05: the edit refuses the invalid input', async () => {
    const target = seeded.customerIds[1]!;
    for (const payload of [
      { display_name: '', version: 1 },
      { email: 'not-an-email', version: 1 },
      { phone: 'xx', version: 1 },
      { display_name: 'بلا إصدار' },
      { version: 1 },
    ]) {
      const refused = await harness.client.request({
        method: 'PATCH',
        path: `/api/crm/customers/${target}`,
        token: owner,
        payload,
      });
      assert.equal(refused.status, 400, `⭐⭐⭐ the invalid input was accepted: ${JSON.stringify(payload)}`);
    }
  });

  await t.test('⭐⭐⭐ CRM-06: the edit refuses a customer of another company', async () => {
    const target = seeded.customerIds[2]!;
    const refused = await harness.client.request({
      method: 'PATCH',
      path: `/api/crm/customers/${target}`,
      token: otherCompany,
      payload: { display_name: 'محاولة', version: 1 },
    });
    assert.equal(refused.status, 404, `⭐⭐⭐ another company edited a customer: ${refused.status}`);
    const read = await harness.client.request({
      method: 'GET',
      path: `/api/crm/customers/${target}`,
      token: otherCompany,
    });
    assert.equal(read.status, 404, `⭐⭐⭐ another company read a customer: ${read.status}`);
  });

  await t.test('⭐⭐⭐ CRM-07: the edit refuses a stale version (no lost update)', async () => {
    const target = seeded.customerIds[3]!;
    const profile = await harness.client.request({
      method: 'GET',
      path: `/api/crm/customers/${target}`,
      token: owner,
    });
    const version = Number((profile.body['customer'] as Record<string, unknown>)['version'] ?? 0);

    const first = await harness.client.request({
      method: 'PATCH',
      path: `/api/crm/customers/${target}`,
      token: supervisor,
      payload: { display_name: 'تعديل المشرف', version },
    });
    assert.equal(first.status, 200, `the first edit failed: ${first.status}`);

    // ⭐⭐⭐ The second employee kept the OLD version ⇒ conflict.
    const second = await harness.client.request({
      method: 'PATCH',
      path: `/api/crm/customers/${target}`,
      token: owner,
      payload: { display_name: 'تعديل المالك', version },
    });
    assert.equal(second.status, 409, `⭐⭐⭐ the stale edit was accepted: ${second.status}`);
    const conflict = second.body['error'] as Record<string, unknown>;
    assert.equal(conflict['code'], 'customer_version_conflict', 'the conflict is not announced');

    // ⭐⭐⭐ And the value of the FIRST edit is still there.
    const after = await harness.client.request({
      method: 'GET',
      path: `/api/crm/customers/${target}`,
      token: owner,
    });
    const customer = after.body['customer'] as Record<string, unknown>;
    assert.equal(customer['display_name'], 'تعديل المشرف', '⭐⭐⭐ the first edit was lost');
  });

  await t.test('⭐⭐⭐ CRM-08: the edit is audited', async () => {
    const events = await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
      const result = await uow.query(
        `select operation, result from audit_events where operation = 'crm.customer.update' order by occurred_at desc limit 5`,
      );
      return result.rows;
    });
    assert.ok(events.length > 0, '⭐⭐⭐ the change is not audited');
  });

  await t.test('⭐⭐⭐ CRM-09: an agent reaches only the customers of their conversations', async () => {
    // ⭐ The owner assigns ONE conversation of ONE customer to the agent.
    const target = seeded.customerIds[4]!;
    const ref = `conv_crm_${RUN}_4`;
    await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
      await uow.query(`update conversations set assignee_actor_id = $2 where ref = $1`, [ref, ids.userIds['agent']]);
    });

    const list = await harness.client.request({
      method: 'GET',
      path: '/api/crm/customers?limit=200',
      token: agent,
    });
    assert.equal(list.status, 200, `the list of the agent failed: ${list.status}`);
    const visible = rowsOf(list.body, 'customers').map((row) => String(row['id']));
    assert.ok(visible.includes(target), '⭐⭐⭐ the agent does not see their own customer');
    assert.ok(!visible.includes(seeded.customerIds[5]!), '⭐⭐⭐ the agent sees a customer that is not theirs');

    const refused = await harness.client.request({
      method: 'GET',
      path: `/api/crm/customers/${seeded.customerIds[5]!}`,
      token: agent,
    });
    assert.equal(refused.status, 404, `⭐⭐⭐ the agent read a customer that is not theirs: ${refused.status}`);
  });

  await t.test('⭐⭐⭐ M-77: the refresh asks only for what is new', async () => {
    const target = seeded.customerIds[0]!;
    const ref = `conv_crm_${RUN}_0`;
    await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
      await uow.query(`update conversations set assignee_actor_id = $2 where ref = $1`, [ref, ids.userIds['owner']]);
    });

    const first = await harness.client.request({
      method: 'GET',
      path: `/api/inbox/conversations/${ref}`,
      token: owner,
    });
    assert.equal(first.status, 200, 'the thread failed');
    const messages = rowsOf(first.body, 'messages');
    assert.ok(messages.length >= 1, 'the thread is empty');
    const serverTime = String(first.body['server_time'] ?? '');
    assert.ok(serverTime.length > 0, '⭐⭐⭐ the instant of the database is missing');

    // ⭐⭐⭐ The poll right after ⇒ nothing new.
    const poll = await harness.client.request({
      method: 'GET',
      path: `/api/inbox/conversations/${ref}?since=${encodeURIComponent(serverTime)}`,
      token: owner,
    });
    assert.equal(poll.status, 200, 'the poll failed');
    assert.equal(rowsOf(poll.body, 'messages').length, 0, '⭐⭐⭐ the poll sent the thread again');

    // ⭐⭐⭐ A new message ⇒ the poll carries exactly it.
    await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
      await uow.query(
        `insert into messages (message_ref, tenant_id, conversation_ref, channel, direction, sender,
                               recipient, body, occurred_at, locale, attributes, stored_at)
         values ($1,$2,$3,'web','inbound','customer@example.invalid','agent@example.invalid',$4, now(),'ar','{}'::jsonb, now())`,
        [`msg_${ref}_new_${RUN}`, tenantId, ref, 'رسالة جديدة من العميل'],
      );
    });
    const poll2 = await harness.client.request({
      method: 'GET',
      path: `/api/inbox/conversations/${ref}?since=${encodeURIComponent(serverTime)}`,
      token: owner,
    });
    const fresh = rowsOf(poll2.body, 'messages');
    assert.equal(fresh.length, 1, `⭐⭐⭐ the poll did not carry the new message: ${fresh.length}`);
    assert.equal(fresh[0]!['body'], 'رسالة جديدة من العميل', 'the wrong message came');
  });

  await t.test('⭐⭐⭐ CRM-10: the data survives a RESTART of the server', async () => {
    // ⭐⭐ The server is closed and opened again on the SAME port ⇒
    //   ⭐ what survives is what is in PostgreSQL, not the memory.
    await harness.api.close();
    const pool = createPool(harness.config.appDatabaseUrl, 4);
    const restarted = new WaslApiServer({
      config: { ...harness.config, port: harness.port },
      pool,
    });
    const address = await restarted.listen();
    // ⭐⭐ A fresh connection: the socket of the closed server is not reused.
    const client = new LocalApiClient('127.0.0.1', address.port, { fresh: true });
    try {
      const again = await loginAs(client, tenantId, ids.userIds['owner']!, PASSCODE);
      const list = await client.request({
        method: 'GET',
        path: '/api/crm/customers?limit=5',
        token: again,
      });
      assert.equal(list.status, 200, `the restarted server failed: ${list.status}`);
      assert.ok(
        Number(list.body['total'] ?? '0') >= 120,
        `⭐⭐⭐ the data did not survive the restart: ${list.body['total']}`,
      );
      const profile = await client.request({
        method: 'GET',
        path: `/api/crm/customers/${seeded.customerIds[0]!}`,
        token: again,
      });
      assert.equal(profile.status, 200, '⭐⭐⭐ the profile did not survive the restart');
    } finally {
      await restarted.close();
      await pool.end();
    }
  });
});

// ============================================================
// WASL AI — FOUNDATION BUILD 03 / PHASE 01 (D-070)
// the customer inbox — the API, the isolation and the journey
// ------------------------------------------------------------
// ⭐ THE PROPERTY UNDER TEST
//   The inbox is a REAL work surface: it reads the conversations of a
//   company from PostgreSQL, it writes the replies of the employees,
//   it changes the state and the assignment, and it never shows a
//   conversation of another company.
// ⭐ THE PROPERTIES
//   - the list carries the customer, the state and the last message,
//   - the detail carries the messages in their order,
//   - a reply is stored as an OUTBOUND message of the employee,
//   - the same reply twice is REFUSED (never stored twice),
//   - the state changes only through the transitions of the core,
//   - the assignment is refused when the employee is not of the
//     company,
//   - the search and the filters narrow the list,
//   - the messages survive a restart of the server,
//   - two backends on one database see the same thing,
//   - a company cannot read the conversations of another one,
//   - a session that is over cannot change anything,
//   - an employee without the capability cannot reply or assign,
//   - the journey works from the login to the closed conversation.
// ⛔ Local synthetic database only.
// ⛔ Every value is synthetic: no real customer and no real message.
// ============================================================

import assert from 'node:assert/strict';
import test from 'node:test';

import { WaslApiServer } from '../../server/api/server.ts';
import { createPool } from '../../server/db/pool.ts';
import { UnitOfWork } from '../../server/db/unit-of-work.ts';
import { LocalApiClient } from '../../server/e2e/http-client.ts';
import { loginAs, startHarness, type Harness } from './harness.ts';

const PASSCODE = process.env['WASL_TEST_PASSCODE'] ?? 'wasl-local-test';

/**
 * ⭐ A reference that is unique per run: the database keeps the rows
 *   between two runs, so a FIXED reference would be refused by the
 *   server on the second run (which is the correct behaviour, but it
 *   would make the drill fail for the wrong reason).
 */
const RUN = Math.random().toString(36).slice(2, 10);

function rowsOf(body: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = body[key];
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

test('FOUNDATION 18) the customer inbox works on the real backend (D-070)', async (t) => {
  const harness = await startHarness();
  t.after(async () => {
    await harness.stop();
  });

  const owner = await loginAs(harness.client, 'tnt_alpha', 'usr_alpha_owner', PASSCODE);
  const agent = await loginAs(harness.client, 'tnt_alpha', 'usr_alpha_agent', PASSCODE);
  const viewer = await loginAs(harness.client, 'tnt_alpha', 'usr_alpha_viewer', PASSCODE);
  const otherCompany = await loginAs(harness.client, 'tnt_beta', 'usr_beta_owner', PASSCODE);

  await t.test('⭐⭐⭐ IN-01: the list carries the customer, the state and the last message', async () => {
    const answer = await harness.client.request({
      method: 'GET',
      path: '/api/inbox/conversations',
      token: owner,
    });
    assert.equal(answer.status, 200, `the list failed: ${answer.status}`);
    const conversations = rowsOf(answer.body, 'conversations');
    assert.ok(conversations.length > 0, 'the list is empty');
    const first = conversations[0]!;
    assert.ok(typeof first['ref'] === 'string', 'the row carries no reference');
    assert.ok(typeof first['customer_name'] === 'string', 'the row carries no customer');
    assert.ok(typeof first['state'] === 'string', 'the row carries no state');
    assert.ok(typeof first['last_message_body'] === 'string', 'the row carries no last message');
    assert.ok(typeof first['last_message_at'] === 'string', 'the row carries no time');
    // ⭐ The order is the order of the work: the most recent first.
    const times = conversations.map((row) => String(row['updated_at'] ?? ''));
    const sorted = [...times].sort().reverse();
    assert.deepEqual(times, sorted, 'the list is not ordered by the activity');
  });

  await t.test('⭐⭐⭐ IN-02: the detail carries the messages in their order', async () => {
    const list = await harness.client.request({
      method: 'GET',
      path: '/api/inbox/conversations',
      token: owner,
    });
    const ref = String(rowsOf(list.body, 'conversations')[0]!['ref']);
    const answer = await harness.client.request({
      method: 'GET',
      path: `/api/inbox/conversations/${ref}`,
      token: owner,
    });
    assert.equal(answer.status, 200, `the detail failed: ${answer.status}`);
    const messages = rowsOf(answer.body, 'messages');
    assert.ok(messages.length > 0, 'the conversation has no messages');
    const times = messages.map((row) => String(row['occurred_at'] ?? ''));
    assert.deepEqual(times, [...times].sort(), 'the messages are not in their order');
    // ⭐⭐ The interface is told which states the CORE allows.
    const allowed = answer.body['allowed_states'];
    assert.ok(Array.isArray(allowed), 'the allowed states are missing');
  });

  await t.test('⭐⭐⭐ IN-03: a reply is stored as an OUTBOUND message of the employee', async () => {
    const list = await harness.client.request({
      method: 'GET',
      path: '/api/inbox/conversations',
      token: owner,
    });
    const ref = String(rowsOf(list.body, 'conversations')[0]!['ref']);
    const answer = await harness.client.request({
      method: 'POST',
      path: `/api/inbox/conversations/${ref}/replies`,
      token: agent,
      payload: { body: 'أهلا بك، نتابع الفاتورة ونتحقق منها.', client_message_ref: `reply_test_in03_${RUN}` },
    });
    assert.equal(answer.status, 201, `the reply failed: ${answer.status} ${JSON.stringify(answer.body)}`);
    const message = answer.body['message'] as Record<string, unknown>;
    assert.equal(message['direction'], 'outbound', 'the reply is not outbound');
    assert.equal(message['from'], 'usr_alpha_agent', 'the reply is not from the employee');
    assert.equal(message['body'], 'أهلا بك، نتابع الفاتورة ونتحقق منها.', 'the body was changed');

    // ⭐⭐ It is really in PostgreSQL.
    const rows = await UnitOfWork.run(harness.ownerPool, 'tnt_alpha', async (uow) => {
      const result = await uow.query(
        `select direction, sender, body from messages where message_ref = $1`,
        [`reply_test_in03_${RUN}`],
      );
      return result.rows;
    });
    assert.equal(rows.length, 1, 'the reply is not in the database');
    assert.equal(rows[0]!['direction'], 'outbound', 'the stored reply is not outbound');
  });

  await t.test('⭐⭐⭐ IN-04: the same reply twice is REFUSED, never stored twice', async () => {
    const list = await harness.client.request({
      method: 'GET',
      path: '/api/inbox/conversations',
      token: owner,
    });
    const ref = String(rowsOf(list.body, 'conversations')[0]!['ref']);
    const payload = { body: 'رسالة واحدة يجب أن تُخزَّن مرة واحدة فقط.', client_message_ref: `reply_test_in04_${RUN}` };
    const first = await harness.client.request({
      method: 'POST',
      path: `/api/inbox/conversations/${ref}/replies`,
      token: agent,
      payload,
    });
    assert.equal(first.status, 201, 'the first reply failed');
    const second = await harness.client.request({
      method: 'POST',
      path: `/api/inbox/conversations/${ref}/replies`,
      token: agent,
      payload,
    });
    assert.equal(second.status, 409, `the double send was accepted: ${second.status}`);
    const code = String((second.body['error'] as Record<string, unknown> | undefined)?.['code'] ?? '');
    assert.equal(code, 'message_duplicate', `the refusal carries an unexpected code: ${code}`);
    const count = await UnitOfWork.run(harness.ownerPool, 'tnt_alpha', async (uow) => {
      const result = await uow.query(
        `select count(*)::text as count from messages where message_ref = $1`,
        [`reply_test_in04_${RUN}`],
      );
      return Number(result.rows[0]?.count ?? '0');
    });
    assert.equal(count, 1, `the reply was stored ${count} times`);
  });

  await t.test('⭐⭐⭐ IN-05: the state changes only through the transitions of the core', async () => {
    const ref = 'conv_alpha_1';
    // ⭐ The transition new ⇒ open is allowed by the core.
    const opened = await harness.client.request({
      method: 'POST',
      path: `/api/inbox/conversations/${ref}/state`,
      token: owner,
      payload: { to: 'open', reason: 'inbox test' },
    });
    assert.equal(opened.status, 200, `the allowed transition failed: ${opened.status}`);
    // ⭐⭐ The transition open ⇒ closed is NOT allowed by the core.
    const refused = await harness.client.request({
      method: 'POST',
      path: `/api/inbox/conversations/${ref}/state`,
      token: owner,
      payload: { to: 'closed', reason: 'inbox test' },
    });
    assert.equal(refused.status, 409, `the forbidden transition was accepted: ${refused.status}`);
    const code = String((refused.body['error'] as Record<string, unknown> | undefined)?.['code'] ?? '');
    assert.equal(
      code,
      'transition_not_allowed',
      `the refusal carries an unexpected code: ${code}`,
    );
  });

  await t.test('⭐⭐⭐ IN-06: the assignment refuses an employee of another company', async () => {
    const ref = 'conv_alpha_1';
    const refused = await harness.client.request({
      method: 'POST',
      path: `/api/inbox/conversations/${ref}/assign`,
      token: owner,
      payload: { actor_id: 'usr_beta_owner', reason: 'inbox test' },
    });
    assert.equal(refused.status, 409, `the foreign employee was accepted: ${refused.status}`);
    const code = String((refused.body['error'] as Record<string, unknown> | undefined)?.['code'] ?? '');
    assert.equal(
      code,
      'assignee_not_in_tenant',
      `the refusal carries an unexpected code: ${code}`,
    );
    // ⭐⭐ An employee of the company is accepted.
    const accepted = await harness.client.request({
      method: 'POST',
      path: `/api/inbox/conversations/${ref}/assign`,
      token: owner,
      payload: { actor_id: 'usr_alpha_agent', reason: 'inbox test' },
    });
    assert.equal(accepted.status, 200, `the employee was refused: ${accepted.status}`);
  });

  await t.test('⭐⭐⭐ IN-07: the search and the filters narrow the list', async () => {
    const byCustomer = await harness.client.request({
      method: 'GET',
      path: '/api/inbox/conversations?q=Customer%20Alpha%20One',
      token: owner,
    });
    assert.equal(byCustomer.status, 200, 'the search failed');
    const found = rowsOf(byCustomer.body, 'conversations');
    assert.ok(found.length >= 1, 'the search found nothing');
    assert.ok(
      found.every((row) => String(row['customer_name'] ?? '').includes('Customer Alpha One')),
      'the search returned another customer',
    );

    const byState = await harness.client.request({
      method: 'GET',
      path: '/api/inbox/conversations?state=open',
      token: owner,
    });
    assert.equal(byState.status, 200, 'the filter failed');
    for (const row of rowsOf(byState.body, 'conversations')) {
      assert.equal(row['state'], 'open', 'the filter returned another state');
    }

    const byAssignee = await harness.client.request({
      method: 'GET',
      path: '/api/inbox/conversations?assignee=usr_alpha_agent',
      token: owner,
    });
    assert.equal(byAssignee.status, 200, 'the assignee filter failed');
    for (const row of rowsOf(byAssignee.body, 'conversations')) {
      assert.equal(row['assignee_actor_id'], 'usr_alpha_agent', 'the filter returned another assignee');
    }

    const byText = await harness.client.request({
      method: 'GET',
      path: '/api/inbox/conversations?q=invoice',
      token: owner,
    });
    assert.equal(byText.status, 200, 'the text search failed');
    assert.ok(rowsOf(byText.body, 'conversations').length >= 1, 'the text search found nothing');
  });

  await t.test('⭐⭐⭐ IN-08: a company cannot read the conversations of another one', async () => {
    const answer = await harness.client.request({
      method: 'GET',
      path: '/api/inbox/conversations/conv_alpha_1',
      token: otherCompany,
    });
    assert.equal(answer.status, 404, `the conversation leaked: ${answer.status}`);
    const code = String((answer.body['error'] as Record<string, unknown> | undefined)?.['code'] ?? '');
    assert.equal(code, 'conversation_not_found', `the answer carries an unexpected code: ${code}`);

    const reply = await harness.client.request({
      method: 'POST',
      path: '/api/inbox/conversations/conv_alpha_1/replies',
      token: otherCompany,
      payload: { body: 'محاولة من شركة أخرى' },
    });
    assert.equal(reply.status, 404, `the reply reached the other company: ${reply.status}`);

    // ⭐⭐ The list of the other company holds only its own rows.
    const list = await harness.client.request({
      method: 'GET',
      path: '/api/inbox/conversations',
      token: otherCompany,
    });
    for (const row of rowsOf(list.body, 'conversations')) {
      assert.ok(
        !String(row['ref'] ?? '').startsWith('conv_alpha'),
        'the list of the second company holds a conversation of the first one',
      );
    }
  });

  await t.test('⭐⭐⭐ IN-09: the capabilities are respected (the viewer and the agent)', async () => {
    // ⭐⭐ The viewer may read but not reply.
    const read = await harness.client.request({
      method: 'GET',
      path: '/api/inbox/conversations/conv_alpha_1',
      token: viewer,
    });
    assert.equal(read.status, 200, `the viewer may not read: ${read.status}`);
    const reply = await harness.client.request({
      method: 'POST',
      path: '/api/inbox/conversations/conv_alpha_1/replies',
      token: viewer,
      payload: { body: 'محاولة من قارئ' },
    });
    assert.equal(reply.status, 403, `the viewer was allowed to reply: ${reply.status}`);
    const code = String((reply.body['error'] as Record<string, unknown> | undefined)?.['code'] ?? '');
    assert.equal(code, 'capability_missing', `the refusal carries an unexpected code: ${code}`);

    // ⭐⭐ The agent may reply but not assign and not change the state.
    const assign = await harness.client.request({
      method: 'POST',
      path: '/api/inbox/conversations/conv_alpha_1/assign',
      token: agent,
      payload: { actor_id: 'usr_alpha_agent' },
    });
    assert.equal(assign.status, 403, `the agent was allowed to assign: ${assign.status}`);
    const state = await harness.client.request({
      method: 'POST',
      path: '/api/inbox/conversations/conv_alpha_1/state',
      token: agent,
      payload: { to: 'pending' },
    });
    assert.equal(state.status, 403, `the agent was allowed to change the state: ${state.status}`);

    // ⭐⭐ The list of the employees is for the ones that may assign.
    const agents = await harness.client.request({
      method: 'GET',
      path: '/api/inbox/agents',
      token: viewer,
    });
    assert.equal(agents.status, 403, `the viewer may see the employees: ${agents.status}`);
  });

  await t.test('⭐⭐⭐ IN-10: the scope of an agent is the conversations that are assigned to them', async () => {
    // ⭐ conv_alpha_1 is assigned to usr_alpha_agent (IN-06).
    const list = await harness.client.request({
      method: 'GET',
      path: '/api/inbox/conversations',
      token: agent,
    });
    assert.equal(list.status, 200, 'the list of the agent failed');
    assert.equal(list.body['scope'], 'own', 'the scope of the agent is not declared');
    for (const row of rowsOf(list.body, 'conversations')) {
      assert.equal(
        row['assignee_actor_id'],
        'usr_alpha_agent',
        'the agent sees a conversation that is not assigned to them',
      );
    }
    // ⭐⭐ The owner sees the whole company.
    const ownerList = await harness.client.request({
      method: 'GET',
      path: '/api/inbox/conversations',
      token: owner,
    });
    assert.equal(ownerList.body['scope'], 'company', 'the scope of the owner is not declared');
  });

  await t.test('⭐⭐⭐ IN-11: a session that is over cannot change anything', async () => {
    const throwaway = await loginAs(harness.client, 'tnt_alpha', 'usr_alpha_agent', PASSCODE);
    const revoked = await harness.client.request({
      method: 'DELETE',
      path: '/api/session',
      token: throwaway,
    });
    assert.equal(revoked.status, 200, 'the session was not revoked');
    const answer = await harness.client.request({
      method: 'POST',
      path: '/api/inbox/conversations/conv_alpha_1/replies',
      token: throwaway,
      payload: { body: 'بعد إبطال الجلسة' },
    });
    assert.equal(answer.status, 401, `the revoked session still worked: ${answer.status}`);
  });

  await t.test('⭐⭐⭐ IN-12: the messages survive a restart of the server', async () => {
    const ref = 'conv_alpha_1';
    const before = await harness.client.request({
      method: 'GET',
      path: `/api/inbox/conversations/${ref}`,
      token: owner,
    });
    const beforeCount = rowsOf(before.body, 'messages').length;

    // ⭐⭐ A NEW instance on the same database: the state is in
    //   PostgreSQL, not in the process.
    const pool = createPool(harness.config.appDatabaseUrl, 4);
    const api = new WaslApiServer({
      config: { ...harness.config, port: harness.port + 21 },
      pool,
    });
    const address = await api.listen();
    const client = new LocalApiClient('127.0.0.1', address.port);
    try {
      const after = await client.request({
        method: 'GET',
        path: `/api/inbox/conversations/${ref}`,
        token: owner,
      });
      assert.equal(after.status, 200, `the restart lost the conversation: ${after.status}`);
      assert.equal(
        rowsOf(after.body, 'messages').length,
        beforeCount,
        'the restart lost the messages',
      );
    } finally {
      await api.close();
      await pool.end();
    }
  });

  await t.test('⭐⭐⭐ IN-13: two backends on one database see the same thing', async () => {
    const poolA = createPool(harness.config.appDatabaseUrl, 4);
    const poolB = createPool(harness.config.appDatabaseUrl, 4);
    const apiA = new WaslApiServer({ config: { ...harness.config, port: harness.port + 22 }, pool: poolA });
    const apiB = new WaslApiServer({ config: { ...harness.config, port: harness.port + 23 }, pool: poolB });
    const addressA = await apiA.listen();
    const addressB = await apiB.listen();
    const clientA = new LocalApiClient('127.0.0.1', addressA.port);
    const clientB = new LocalApiClient('127.0.0.1', addressB.port);
    try {
      // ⭐ The reply is written through the FIRST instance.
      const written = await clientA.request({
        method: 'POST',
        path: '/api/inbox/conversations/conv_alpha_1/replies',
        token: agent,
        payload: { body: 'اكتبها_instance_A', client_message_ref: `reply_test_in13_${RUN}` },
      });
      assert.equal(written.status, 201, `the first instance refused: ${written.status}`);
      // ⭐⭐ The SECOND instance reads it: the state is shared.
      const read = await clientB.request({
        method: 'GET',
        path: '/api/inbox/conversations/conv_alpha_1',
        token: agent,
      });
      assert.equal(read.status, 200, `the second instance failed: ${read.status}`);
      const bodies = rowsOf(read.body, 'messages').map((row) => String(row['body'] ?? ''));
      assert.ok(
        bodies.includes('اكتبها_instance_A'),
        'the second instance did not see the reply of the first one',
      );
    } finally {
      await apiA.close();
      await apiB.close();
      await poolA.end();
      await poolB.end();
    }
  });

  await t.test('⭐⭐⭐ IN-14: the journey from the login to the closed conversation', async () => {
    // ⭐ A fresh synthetic company with a fresh conversation.
    const tenantId = 'tnt_inbox_journey';
    const ownerId = 'usr_inbox_journey_owner';
    const agentId = 'usr_inbox_journey_agent';
    const customerId = 'cus_inbox_journey_1';
    const ref = 'conv_inbox_journey_1';
    const { hashPasscode } = await import('../../server/auth/sessions.ts');
    await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
      await uow.query(
        `insert into tenants (id, name, status) values ($1,$2,'active')
         on conflict (id) do update set name = excluded.name`,
        [tenantId, 'Inbox journey (synthetic)'],
      );
      for (const [id, display, role] of [
        [ownerId, 'Journey Owner', 'owner'],
        [agentId, 'Journey Agent', 'agent'],
      ] as const) {
        await uow.query(
          `insert into users (id, display_name, email, status, passcode_hash)
           values ($1,$2,$3,'active',$4)
           on conflict (id) do update set display_name = excluded.display_name, passcode_hash = excluded.passcode_hash`,
          [id, display, `${id}@example.invalid`, hashPasscode(PASSCODE)],
        );
        await uow.query(
          `insert into memberships (id, tenant_id, user_id, role, status)
           values ($1,$2,$3,$4,'active')
           on conflict (tenant_id, user_id) do update set role = excluded.role, status = 'active'`,
          [`mem_${id}`, tenantId, id, role],
        );
      }
      await uow.query(
        `insert into customers (id, tenant_id, display_name, data_class)
         values ($1,$2,$3,'standard')
         on conflict (id) do update set display_name = excluded.display_name`,
        [customerId, tenantId, 'Journey Customer'],
      );
      await uow.query(
        `insert into conversations (tenant_id, ref, customer_id, state, version, updated_at)
         values ($1,$2,$3,'new',1, now())`,
        [tenantId, ref, customerId],
      );
      await uow.query(
        `insert into messages (message_ref, tenant_id, conversation_ref, channel, direction, sender,
                               recipient, body, occurred_at, locale, attributes, stored_at)
         values ($1,$2,$3,'web','inbound','customer@example.invalid','agent@example.invalid',$4, now(),'ar','{}'::jsonb, now())`,
        [`msg_${ref}_seed`, tenantId, ref, 'الطلب الأول من العميل'],
      );
    });

    try {
      // ① the login of the employee.
      const journeyAgent = await loginAs(harness.client, tenantId, agentId, PASSCODE);
      const journeyOwner = await loginAs(harness.client, tenantId, ownerId, PASSCODE);

      // ② the list of the inbox.
      const list = await harness.client.request({
        method: 'GET',
        path: '/api/inbox/conversations',
        token: journeyOwner,
      });
      assert.equal(list.status, 200, 'the list of the journey failed');
      const found = rowsOf(list.body, 'conversations').find(
        (row) => row['ref'] === ref,
      );
      assert.ok(found, 'the conversation is not in the list');
      assert.equal(found!['customer_name'], 'Journey Customer', 'the customer name is wrong');
      assert.equal(found!['state'], 'new', 'the state is wrong');

      // ③ the employee reads the conversation.
      const detail = await harness.client.request({
        method: 'GET',
        path: `/api/inbox/conversations/${ref}`,
        token: journeyAgent,
      });
      assert.equal(detail.status, 200, 'the agent may not read the conversation');
      assert.equal(rowsOf(detail.body, 'messages').length, 1, 'the message is missing');

      // ④ the employee replies.
      const reply = await harness.client.request({
        method: 'POST',
        path: `/api/inbox/conversations/${ref}/replies`,
        token: journeyAgent,
        payload: { body: 'أهلًا بك، تم استلام طلبك.', client_message_ref: 'reply_journey_1' },
      });
      assert.equal(reply.status, 201, `the reply failed: ${reply.status}`);

      // ⑤⭐ the supervisor opens the conversation first: the core
      //   allows the assignment only from a state that accepts it.
      const opened = await harness.client.request({
        method: 'POST',
        path: `/api/inbox/conversations/${ref}/state`,
        token: journeyOwner,
        payload: { to: 'open', reason: 'journey' },
      });
      assert.equal(opened.status, 200, `the opening failed: ${opened.status}`);

      // ⑥ the supervisor assigns the conversation.
      const assigned = await harness.client.request({
        method: 'POST',
        path: `/api/inbox/conversations/${ref}/assign`,
        token: journeyOwner,
        payload: { actor_id: agentId, reason: 'journey' },
      });
      assert.equal(assigned.status, 200, `the assignment failed: ${assigned.status}`);

      // ⑦ the state walks the transitions of the core to the end.
      for (const to of ['pending', 'resolved', 'closed']) {
        const step = await harness.client.request({
          method: 'POST',
          path: `/api/inbox/conversations/${ref}/state`,
          token: journeyOwner,
          payload: { to, reason: 'journey' },
        });
        assert.equal(step.status, 200, `the transition to ${to} failed: ${step.status}`);
      }

      // ⑧ the final state is really in the database.
      const finalState = await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
        const result = await uow.query(`select state from conversations where ref = $1`, [ref]);
        return result.rows[0]?.state;
      });
      assert.equal(finalState, 'closed', 'the conversation is not closed');

      // ⑨ the journey left a trail.
      const changes = await harness.client.request({
        method: 'GET',
        path: `/api/conversations/${ref}/changes`,
        token: journeyOwner,
      });
      assert.equal(changes.status, 200, 'the change log is not readable');
      assert.ok(rowsOf(changes.body, 'changes').length >= 5, 'the change log is empty');
    } finally {
      await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
        await uow.query(`delete from messages where tenant_id = $1`, [tenantId]);
        await uow.query(`delete from conversation_changes where tenant_id = $1`, [tenantId]);
        await uow.query(`delete from conversations where tenant_id = $1`, [tenantId]);
        await uow.query(`delete from customers where tenant_id = $1`, [tenantId]);
        await uow.query(`delete from memberships where tenant_id = $1`, [tenantId]);
        await uow.query(`delete from sessions where tenant_id = $1`, [tenantId]);
        await uow.query(`delete from users where id in ($1,$2)`, [ownerId, agentId]);
        await uow.query(`delete from tenants where id = $1`, [tenantId]);
      });
    }
  });
});

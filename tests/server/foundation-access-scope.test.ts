// ============================================================
// WASL AI — FOUNDATION BUILD 03 / PHASE 02 (D-071)
// M76 — the access of an employee to the conversations
// ------------------------------------------------------------
// ⭐ THE PROPERTY UNDER TEST
//   The scope of the core work queue is applied to EVERY path of the
//   inbox, not only to the list:
//   ⭐ an AGENT reaches the conversations that are assigned to them,
//   ⭐ the owner and the supervisor reach the whole company,
//   ⭐ the viewer reads but changes nothing,
//   ⭐ no company reaches the conversations of another one.
// ⭐ THE METHOD
//   ⭐ Real sessions and real roles on the local synthetic database.
//   ⭐ No mock: every answer comes from the real HTTP server.
// ⛔ Local synthetic database only.
// ============================================================

import assert from 'node:assert/strict';
import test from 'node:test';

import { UnitOfWork } from '../../server/db/unit-of-work.ts';
import { createSyntheticCompany, loginAs, startHarness, type Harness } from './harness.ts';

const PASSCODE = process.env['WASL_TEST_PASSCODE'] ?? 'wasl-local-test';
const RUN = Math.random().toString(36).slice(2, 10);

interface Fixture {
  readonly refMine: string;
  readonly refOther: string;
  readonly refFree: string;
}

/** ⭐ A synthetic company with three conversations: mine, another, free. */
async function seedFixtures(
  harness: Harness,
  tenantId: string,
  agentId: string,
  supervisorId: string,
): Promise<Fixture> {
  const refMine = `conv_m76_mine_${RUN}`;
  const refOther = `conv_m76_other_${RUN}`;
  const refFree = `conv_m76_free_${RUN}`;
  await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
    for (const ref of [refMine, refOther, refFree]) {
      await uow.query(
        `insert into customers (id, tenant_id, display_name, data_class)
         values ($1,$2,$3,'standard') on conflict (id) do nothing`,
        [`cus_m76_${ref}`, tenantId, `عميل ${ref}`],
      );
      await uow.query(
        `insert into conversations (tenant_id, ref, customer_id, state, version, updated_at)
         values ($1,$2,$3,'open',1, now())`,
        [tenantId, ref, `cus_m76_${ref}`],
      );
      await uow.query(
        `insert into messages (message_ref, tenant_id, conversation_ref, channel, direction, sender,
                               recipient, body, occurred_at, locale, attributes, stored_at)
         values ($1,$2,$3,'web','inbound','customer@example.invalid','agent@example.invalid',$4, now(),'ar','{}'::jsonb, now())`,
        [`msg_${ref}_seed`, tenantId, ref, `رسالة العميل في ${ref}`],
      );
    }
    // ⭐ One conversation is assigned to the agent, one to the supervisor.
    await uow.query(`update conversations set assignee_actor_id = $2 where ref = $1`, [refMine, agentId]);
    await uow.query(
      `update conversations set assignee_actor_id = $2 where ref = $1`,
      [refOther, supervisorId],
    );
  });
  return { refMine, refOther, refFree };
}

test('FOUNDATION 19) the access of an employee to the conversations (M-76)', async (t) => {
  const harness = await startHarness();
  t.after(async () => {
    await harness.stop();
  });

  // ⭐⭐ D-071: the drill owns its company (the other files run in
  //   parallel over the same database ⇒ the shared tenant is not
  //   safe for a drill that counts).
  const tenantId = 'tnt_d071_scope';
  const otherTenantId = 'tnt_d071_scope_other';
  const ids = await createSyntheticCompany(harness.ownerPool, tenantId, PASSCODE, [
    { id: 'usr_d071_scope_owner', role: 'owner' },
    { id: 'usr_d071_scope_super', role: 'supervisor' },
    { id: 'usr_d071_scope_agent', role: 'agent' },
    { id: 'usr_d071_scope_viewer', role: 'viewer' },
  ]);
  const otherIds = await createSyntheticCompany(harness.ownerPool, otherTenantId, PASSCODE, [
    { id: 'usr_d071_scope_other_owner', role: 'owner' },
  ]);
  const owner = await loginAs(harness.client, tenantId, ids.userIds['owner']!, PASSCODE);
  const supervisor = await loginAs(harness.client, tenantId, ids.userIds['supervisor']!, PASSCODE);
  const agent = await loginAs(harness.client, tenantId, ids.userIds['agent']!, PASSCODE);
  const viewer = await loginAs(harness.client, tenantId, ids.userIds['viewer']!, PASSCODE);
  const otherCompany = await loginAs(harness.client, otherTenantId, otherIds.userIds['owner']!, PASSCODE);

  const fixtures = await seedFixtures(harness, tenantId, ids.userIds['agent']!, ids.userIds['supervisor']!);

  const refsIn = (body: Record<string, unknown>): string[] => {
    const value = body['conversations'];
    if (!Array.isArray(value)) return [];
    return (value as Record<string, unknown>[]).map((row) => String(row['ref']));
  };

  await t.test('⭐⭐⭐ SC-01: the list of an agent carries ONLY their conversations', async () => {
    const answer = await harness.client.request({
      method: 'GET',
      path: '/api/inbox/conversations?limit=200',
      token: agent,
    });
    assert.equal(answer.status, 200, `the list failed: ${answer.status}`);
    const refs = refsIn(answer.body);
    assert.ok(refs.includes(fixtures.refMine), 'the agent does not see their own conversation');
    assert.ok(!refs.includes(fixtures.refOther), '⭐ the agent sees a conversation of another employee');
    assert.ok(!refs.includes(fixtures.refFree), '⭐ the agent sees a conversation that is not assigned');
    assert.equal(answer.body['scope'], 'own', 'the scope of the agent is not announced');
  });

  await t.test('⭐⭐⭐ SC-02: an agent does NOT read a conversation that is not theirs', async () => {
    for (const ref of [fixtures.refOther, fixtures.refFree]) {
      const answer = await harness.client.request({
        method: 'GET',
        path: `/api/inbox/conversations/${ref}`,
        token: agent,
      });
      assert.ok(
        answer.status === 404 || answer.status === 403,
        `⭐⭐⭐ the agent READ a conversation that is not theirs: ${answer.status} ${JSON.stringify(answer.body)}`,
      );
      assert.equal(answer.body['ok'], false, 'the answer claims a success');
      const messages = answer.body['messages'];
      assert.ok(messages === undefined, '⭐⭐⭐ the body carries messages of a conversation that is not theirs');
    }
  });

  await t.test('⭐⭐⭐ SC-03: an agent does NOT reply to a conversation that is not theirs', async () => {
    for (const ref of [fixtures.refOther, fixtures.refFree]) {
      const answer = await harness.client.request({
        method: 'POST',
        path: `/api/inbox/conversations/${ref}/replies`,
        token: agent,
        payload: { body: 'رد من موظف على محادثة ليست له', client_message_ref: `m76_bad_${ref}_${RUN}` },
      });
      assert.ok(
        answer.status === 404 || answer.status === 403,
        `⭐⭐⭐ the agent WROTE to a conversation that is not theirs: ${answer.status}`,
      );
    }
    // ⭐⭐⭐ And nothing was stored.
    const stored = await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
      const result = await uow.query(
        `select count(*)::int as count from messages where message_ref like $1`,
        [`m76_bad_%${RUN}`],
      );
      return Number(result.rows[0]?.['count'] ?? '0');
    });
    assert.equal(stored, 0, '⭐⭐⭐ a message was stored by an agent outside their scope');
  });

  await t.test('⭐⭐⭐ SC-04: an agent DOES read and reply to their own conversation', async () => {
    const read = await harness.client.request({
      method: 'GET',
      path: `/api/inbox/conversations/${fixtures.refMine}`,
      token: agent,
    });
    assert.equal(read.status, 200, `the agent cannot read their own conversation: ${read.status}`);
    const reply = await harness.client.request({
      method: 'POST',
      path: `/api/inbox/conversations/${fixtures.refMine}/replies`,
      token: agent,
      payload: { body: 'أهلاً بك، سنراجع الفاتورة.', client_message_ref: `m76_ok_${RUN}` },
    });
    assert.equal(reply.status, 201, `the agent cannot reply to their own conversation: ${reply.status}`);
  });

  await t.test('⭐⭐⭐ SC-05: the viewer reads but writes nothing', async () => {
    const read = await harness.client.request({
      method: 'GET',
      path: `/api/inbox/conversations/${fixtures.refMine}`,
      token: viewer,
    });
    assert.equal(read.status, 200, `the viewer cannot read: ${read.status}`);
    const reply = await harness.client.request({
      method: 'POST',
      path: `/api/inbox/conversations/${fixtures.refMine}/replies`,
      token: viewer,
      payload: { body: 'رد من قارئ', client_message_ref: `m76_viewer_${RUN}` },
    });
    assert.equal(reply.status, 403, `⭐⭐⭐ the viewer WROTE: ${reply.status}`);
  });

  await t.test('⭐⭐⭐ SC-06: the supervisor and the owner reach the whole company', async () => {
    for (const token of [supervisor, owner]) {
      for (const ref of [fixtures.refMine, fixtures.refOther, fixtures.refFree]) {
        const answer = await harness.client.request({
          method: 'GET',
          path: `/api/inbox/conversations/${ref}`,
          token,
        });
        assert.equal(answer.status, 200, `the company cannot read its own conversation: ${answer.status}`);
      }
    }
  });

  await t.test('⭐⭐⭐ SC-07: no company reaches a conversation of another one', async () => {
    // ⭐⭐ A conversation of the OTHER company (it really exists).
    const otherRef = `conv_m76_otherco_${RUN}`;
    await UnitOfWork.run(harness.ownerPool, otherTenantId, async (uow) => {
      await uow.query(
        `insert into customers (id, tenant_id, display_name, data_class)
         values ($1,$2,$3,'standard') on conflict (id) do nothing`,
        [`cus_m76_otherco_${RUN}`, otherTenantId, 'عميل الشركة الأخرى'],
      );
      await uow.query(
        `insert into conversations (tenant_id, ref, customer_id, state, version, updated_at)
         values ($1,$2,$3,'open',1, now())`,
        [otherTenantId, otherRef, `cus_m76_otherco_${RUN}`],
      );
    });
    // ⭐⭐ The owner of the drill does NOT reach it.
    const answer = await harness.client.request({
      method: 'GET',
      path: `/api/inbox/conversations/${otherRef}`,
      token: owner,
    });
    assert.equal(answer.status, 404, `⭐⭐⭐ another company READ a conversation: ${answer.status}`);
    // ⭐⭐ And the other company does NOT reach the conversation of the drill.
    const other = await harness.client.request({
      method: 'GET',
      path: `/api/inbox/conversations/${fixtures.refMine}`,
      token: otherCompany,
    });
    assert.equal(other.status, 404, `⭐⭐⭐ another company READ a conversation of the drill: ${other.status}`);
  });

  await t.test('⭐⭐⭐ SC-08: the assignment opens the conversation to its agent', async () => {
    const assigned = await harness.client.request({
      method: 'POST',
      path: `/api/inbox/conversations/${fixtures.refFree}/assign`,
      token: owner,
      payload: { actor_id: ids.userIds['agent'] },
    });
    assert.equal(assigned.status, 200, `the assignment failed: ${assigned.status}`);
    const read = await harness.client.request({
      method: 'GET',
      path: `/api/inbox/conversations/${fixtures.refFree}`,
      token: agent,
    });
    assert.equal(read.status, 200, `⭐⭐⭐ the assigned conversation is still closed to its agent: ${read.status}`);
  });
});

// ============================================================
// WASL AI — FOUNDATION BUILD 03 / PHASE 03 (D-072)
// M-83: the derived data of the customer CRM must respect the scope
// ============================================================
// ⭐⭐⭐ WHAT THIS TEST IS
//   ⭐ A customer may have MORE THAN ONE conversation, and those
//     conversations may be assigned to DIFFERENT employees.
//   ⭐ The list of the customers restricts WHICH customers an agent
//     sees (the customer must have a conversation assigned to them).
//   ⭐⭐ BUT every DERIVED number (the count of the conversations, the
//     last message, the last interaction, the order of the list) can be
//     computed from the WHOLE customer — ⭐⭐ and then the agent reads
//     the activity of a conversation that is NOT theirs: ⭐⭐ the number
//     of the conversations, ⭐⭐ the text of the last message, ⭐⭐ the
//     moment of the last interaction.
//   ⭐⭐ This file is the PROOF: it must FAIL on the old code (the
//     derived data was not scoped) and PASS after the fix.
//   ⭐ It owns its company (M-82): no other file can touch its rows.
// ============================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UnitOfWork } from '../../server/db/unit-of-work.ts';
import { createSyntheticCompany, loginAs, resetCompany, startHarness, type Harness } from './harness.ts';

const PASSCODE = 'wasl-local-test';
const RUN = `m83_${process.pid}_${Date.now().toString(36)}`;
const TENANT = 'tnt_d073_crmiso';
const OTHER_TENANT = 'tnt_d073_crmiso_other';

/** ⭐⭐⭐ The secret of the conversation of the OTHER employee. */
const SECRET = `SECRET-B-${RUN}`;

// ⭐⭐ The references of the conversations (unique per run: a run never
//   collides with the rows of an old one).
const REF_A = `conv_d073_share_a_${RUN}`;
const REF_B = `conv_d073_share_b_${RUN}`;
const REF_X1 = `conv_d073_x1_${RUN}`;
const REF_X2 = `conv_d073_x2_${RUN}`;
const REF_X3 = `conv_d073_x3_${RUN}`;
const REF_Y1 = `conv_d073_y1_${RUN}`;
const REF_Y2 = `conv_d073_y2_${RUN}`;
const REF_Y3 = `conv_d073_y3_${RUN}`;

// ⭐⭐ The moment of every message (minutes in the past).
// ⭐⭐ The order of the agent (his own messages): Y (٤٠ دقيقة) before
//   X (٩٠ دقيقة). ⭐⭐ The order of the whole customer (leaked): X
//   (٣ دقائق) before Y (٦ دقائق) ⇒ ⭐⭐ the two orders are different
//   ⇒ ⭐⭐ the order of the list proves the scope of the derived data.
const MINUTES: Readonly<Record<string, string>> = {
  [REF_X1]: '90',
  [REF_X2]: '8',
  [REF_X3]: '3',
  [REF_Y1]: '40',
  [REF_Y2]: '6',
  [REF_Y3]: '5',
};

interface Row {
  readonly [key: string]: unknown;
}

function rowsOf(body: unknown, key: string): Row[] {
  const container = body as Record<string, unknown> | null;
  const value = container ? container[key] : undefined;
  return Array.isArray(value) ? (value as Row[]) : [];
}

test('FOUNDATION 24) the CRM never shows what belongs to another employee (M-83)', async (t) => {
  const harness: Harness = await startHarness();
  // ⭐⭐ M-82: the file resets ITS OWN company (never another one).
  await resetCompany(harness.ownerPool, TENANT);
  await resetCompany(harness.ownerPool, OTHER_TENANT);
  t.after(async () => {
    // ⭐ The cleanup runs BEFORE the pool ends (the same hook).
    await resetCompany(harness.ownerPool, TENANT);
    await resetCompany(harness.ownerPool, OTHER_TENANT);
    await harness.stop();
  });

  const ids = await createSyntheticCompany(harness.ownerPool, TENANT, PASSCODE, [
    { id: 'usr_d073_owner', role: 'owner' },
    { id: 'usr_d073_super', role: 'supervisor' },
    { id: 'usr_d073_agent1', role: 'agent' },
    { id: 'usr_d073_agent2', role: 'agent' },
    { id: 'usr_d073_viewer', role: 'viewer' },
  ]);
  await createSyntheticCompany(harness.ownerPool, OTHER_TENANT, PASSCODE, [
    { id: 'usr_d073_other_owner', role: 'owner' },
  ]);

  const owner = await loginAs(harness.client, TENANT, ids.userIds['owner']!, PASSCODE);
  const supervisor = await loginAs(harness.client, TENANT, ids.userIds['supervisor']!, PASSCODE);
  const agent1 = await loginAs(harness.client, TENANT, ids.userIds['usr_d073_agent1']!, PASSCODE);
  const agent2 = await loginAs(harness.client, TENANT, ids.userIds['usr_d073_agent2']!, PASSCODE);
  const viewer = await loginAs(harness.client, TENANT, ids.userIds['viewer']!, PASSCODE);
  assert.ok(agent1 && agent2, '⭐⭐⭐ the two employees of the drill did not sign in');

  // ⭐⭐ The fixture: ONE customer with TWO conversations assigned to
  //   TWO employees, and the secret inside the second one.
  const agent1Id = ids.userIds['usr_d073_agent1']!;
  const agent2Id = ids.userIds['usr_d073_agent2']!;
  await UnitOfWork.run(harness.ownerPool, TENANT, async (uow) => {
    for (const customer of ['cus_d073_share', 'cus_d073_sort_x', 'cus_d073_sort_y']) {
      await uow.query(
        `insert into customers (id, tenant_id, display_name, data_class)
         values ($1,$2,$3,'standard') on conflict (id) do nothing`,
        [customer, TENANT, customer === 'cus_d073_sort_x' ? 'AAA-sort-x' : customer === 'cus_d073_sort_y' ? 'ZZZ-sort-y' : 'عميل مشترك'],
      );
    }
    // ⭐ The conversations of the shared customer.
    const shared: readonly [string, string, string, string][] = [
      [REF_A, 'cus_d073_share', agent1Id, 'رسالة العميل في المحادثة أ'],
      [REF_B, 'cus_d073_share', agent2Id, SECRET],
    ];
    for (const [ref, customer, assignee, body] of shared) {
      await uow.query(
        `insert into conversations (tenant_id, ref, customer_id, state, version, updated_at)
         values ($1,$2,$3,'open',1, now())`,
        [TENANT, ref, customer],
      );
      await uow.query(
        `update conversations set assignee_actor_id = $3 where tenant_id = $1 and ref = $2`,
        [TENANT, ref, assignee],
      );
      await uow.query(
        `insert into messages (message_ref, tenant_id, conversation_ref, channel, direction, sender,
                               recipient, body, occurred_at, locale, attributes, stored_at)
         values ($1,$2,$3,'web','inbound','customer@example.invalid','agent@example.invalid',$4,
                 now() - ($5 || ' minutes')::interval, 'ar', '{}'::jsonb, now())`,
        [`msg_${ref}_${RUN}`, TENANT, ref, body, ref === REF_A ? '30' : '1'],
      );
    }
    // ⭐⭐ The two customers of the ORDER drill:
    //   ⭐ X: one conversation for agent1 (old) and TWO for agent2 (new).
    //   ⭐ Y: TWO conversations for agent1 and one for agent2.
    //   ⭐⭐ The order of the agent (scoped) is NOT the order of the
    //   whole customer (leaked) ⇒ the order proves the scope.
    const sortRows: readonly [string, string, string, string][] = [
      [REF_X1, 'cus_d073_sort_x', agent1Id, 'X1'],
      [REF_X2, 'cus_d073_sort_x', agent2Id, 'X2'],
      [REF_X3, 'cus_d073_sort_x', agent2Id, 'X3'],
      [REF_Y1, 'cus_d073_sort_y', agent1Id, 'Y1'],
      [REF_Y2, 'cus_d073_sort_y', agent2Id, 'Y2'],
      [REF_Y3, 'cus_d073_sort_y', agent1Id, 'Y3'],
    ];
    for (const [ref, customer, assignee, body] of sortRows) {
      await uow.query(
        `insert into conversations (tenant_id, ref, customer_id, state, version, updated_at)
         values ($1,$2,$3,'open',1, now())`,
        [TENANT, ref, customer],
      );
      await uow.query(
        `update conversations set assignee_actor_id = $3 where tenant_id = $1 and ref = $2`,
        [TENANT, ref, assignee],
      );
      await uow.query(
        `insert into messages (message_ref, tenant_id, conversation_ref, channel, direction, sender,
                               recipient, body, occurred_at, locale, attributes, stored_at)
         values ($1,$2,$3,'web','inbound','customer@example.invalid','agent@example.invalid',$4,
                 now() - ($5 || ' minutes')::interval, 'ar', '{}'::jsonb, now())`,
        [`msg_${ref}_${RUN}`, TENANT, ref, body, MINUTES[ref] ?? '5'],
      );
    }
  });

  const listCustomers = async (token: string, query: string): Promise<Row[]> => {
    const answer = await harness.client.request({
      method: 'GET',
      path: `/api/crm/customers?limit=200&${query}`,
      token,
    });
    assert.equal(answer.status, 200, `⭐⭐⭐ the list of the customers failed: ${answer.status}`);
    return rowsOf(answer.body, 'customers');
  };

  const rowOf = (rows: readonly Row[], id: string): Row | undefined =>
    rows.find((row) => String(row['id']) === id);

  await t.test('⭐⭐⭐ M-83a: the list does not leak the count of the conversations of the other employee', async () => {
    const rows = await listCustomers(agent1, 'sort=name');
    const shared = rowOf(rows, 'cus_d073_share');
    assert.ok(shared, '⭐⭐⭐ the agent does not see the customer of their own conversation');
    assert.equal(
      Number(shared['conversation_count']),
      1,
      `⭐⭐⭐ LEAK: the agent sees ${shared['conversation_count']} conversations instead of 1 (the second one is assigned to another employee)`,
    );
  });

  await t.test('⭐⭐⭐ M-83b: the list does not leak the TEXT of the last message of the other employee', async () => {
    const rows = await listCustomers(agent1, 'sort=name');
    const shared = rowOf(rows, 'cus_d073_share');
    assert.ok(shared, '⭐⭐⭐ the customer is missing');
    const body = String(shared['last_message_body'] ?? '');
    assert.ok(
      !body.includes(SECRET),
      `⭐⭐⭐ LEAK: the list of the agent carries the text of the message of another employee: ${body}`,
    );
    assert.equal(
      body,
      'رسالة العميل في المحادثة أ',
      `⭐⭐⭐ the last message must be the one of the conversation of the agent, not ${body}`,
    );
  });

  await t.test('⭐⭐⭐ M-83c: the list does not leak the moment of the last interaction of the other employee', async () => {
    const rows = await listCustomers(agent1, 'sort=name');
    const shared = rowOf(rows, 'cus_d073_share');
    assert.ok(shared, '⭐⭐⭐ the customer is missing');
    const seen = new Date(String(shared['last_interaction_at'])).getTime();
    const real = await UnitOfWork.run(harness.ownerPool, TENANT, async (uow) => {
      const result = await uow.query(
        `select occurred_at from messages
          where tenant_id = $1 and message_ref = $2`,
        [TENANT, `msg_${REF_B}_${RUN}`],
      );
      return new Date(String(result.rows[0]?.['occurred_at'])).getTime();
    });
    assert.ok(
      seen < real,
      `⭐⭐⭐ LEAK: the last interaction of the agent is the moment of the other employee (${seen} >= ${real})`,
    );
  });

  await t.test('⭐⭐⭐ M-83d: the ORDER of the list does not leak the activity of the other employee', async () => {
    // ⭐ The scoped order (by the last interaction of the agent):
    //   Y (Y1 at 40 minutes) before X (X1 at 90 minutes).
    // ⭐⭐ The leaked order (by the last interaction of the customer):
    //   X (X2/X3 at 5 minutes) before Y.
    const rows = await listCustomers(agent1, 'sort=recent');
    const order = rows.map((row) => String(row['id']));
    const indexX = order.indexOf('cus_d073_sort_x');
    const indexY = order.indexOf('cus_d073_sort_y');
    assert.ok(indexX >= 0 && indexY >= 0, `⭐⭐⭐ the customers of the order drill are missing: ${order.join(',')}`);
    assert.ok(
      indexY < indexX,
      `⭐⭐⭐ LEAK: the order of the agent follows the activity of the other employee: ${order.join(',')}`,
    );
    // ⭐⭐ And the order by the count of the conversations.
    const byCount = (await listCustomers(agent1, 'sort=conversations')).map((row) => String(row['id']));
    const countX = byCount.indexOf('cus_d073_sort_x');
    const countY = byCount.indexOf('cus_d073_sort_y');
    assert.ok(
      countY < countX,
      `⭐⭐⭐ LEAK: the order by the number of the conversations follows the count of the other employee: ${byCount.join(',')}`,
    );
  });

  await t.test('⭐⭐⭐ M-83e: the profile of the customer shows only the conversations of the agent', async () => {
    const answer = await harness.client.request({
      method: 'GET',
      path: `/api/crm/customers/cus_d073_share`,
      token: agent1,
    });
    assert.equal(answer.status, 200, `⭐⭐⭐ the profile failed: ${answer.status}`);
    const conversations = rowsOf(answer.body, 'conversations');
    const refs = conversations.map((row) => String(row['ref']));
    assert.deepEqual(refs, [REF_A], `⭐⭐⭐ the profile carries the conversations of the other employee: ${refs.join(',')}`);
    const text = JSON.stringify(answer.body);
    assert.ok(!text.includes(SECRET), '⭐⭐⭐ LEAK: the profile of the agent carries the secret of the other employee');
  });

  await t.test('⭐⭐⭐ M-83f: the SEARCH of the agent does not find the secret of the other employee', async () => {
    const crm = await harness.client.request({
      method: 'GET',
      path: `/api/crm/customers?limit=200&q=${encodeURIComponent(SECRET)}`,
      token: agent1,
    });
    assert.equal(crm.status, 200, `⭐⭐⭐ the search failed: ${crm.status}`);
    assert.equal(
      rowsOf(crm.body, 'customers').length,
      0,
      '⭐⭐⭐ LEAK: the search of the agent found the secret of the other employee',
    );
    // ⭐⭐ And the inbox search (it searches in the text of the messages).
    const inbox = await harness.client.request({
      method: 'GET',
      path: `/api/inbox/conversations?q=${encodeURIComponent(SECRET)}`,
      token: agent1,
    });
    assert.equal(inbox.status, 200, `⭐⭐⭐ the search of the inbox failed: ${inbox.status}`);
    assert.equal(
      rowsOf(inbox.body, 'conversations').length,
      0,
      '⭐⭐⭐ LEAK: the search of the inbox found the conversation of the other employee',
    );
  });

  await t.test('⭐⭐⭐ M-83g: the owner and the supervisor keep their approved scope', async () => {
    for (const [label, token] of [['the owner', owner], ['the supervisor', supervisor]] as const) {
      const rows = await listCustomers(token, 'sort=name');
      const shared = rowOf(rows, 'cus_d073_share');
      assert.ok(shared, `⭐⭐⭐ ${label} does not see the customer`);
      assert.equal(
        Number(shared['conversation_count']),
        2,
        `⭐⭐⭐ ${label} must see the two conversations of the company`,
      );
      assert.equal(
        String(shared['last_message_body'] ?? ''),
        SECRET,
        `⭐⭐⭐ ${label} must see the last message of the company`,
      );
    }
    // ⭐⭐ The second employee sees his own conversation only.
    const rows2 = await listCustomers(agent2, 'sort=name');
    const shared2 = rowOf(rows2, 'cus_d073_share');
    assert.equal(Number(shared2?.['conversation_count']), 1, '⭐⭐⭐ the second employee sees the conversations of the first');
    assert.equal(String(shared2?.['last_message_body'] ?? ''), SECRET, '⭐⭐⭐ the second employee must see his own message');
  });

  await t.test('⭐⭐⭐ M-83h: the scope follows the assignment WHILE the CRM is used', async () => {
    // ⭐⭐ The owner gives the conversation B to the first employee.
    const assigned = await harness.client.request({
      method: 'POST',
      path: `/api/inbox/conversations/${REF_B}/assign`,
      token: owner,
      payload: { actor_id: agent1Id },
    });
    assert.equal(assigned.status, 200, `⭐⭐⭐ the assignment failed: ${assigned.status}`);
    const rows = await listCustomers(agent1, 'sort=name');
    const shared = rowOf(rows, 'cus_d073_share');
    assert.equal(
      Number(shared?.['conversation_count']),
      2,
      '⭐⭐⭐ the count did not follow the assignment (the scope is cached?)',
    );
    assert.equal(
      String(shared?.['last_message_body'] ?? ''),
      SECRET,
      '⭐⭐⭐ the last message did not follow the assignment',
    );
    // ⭐⭐ And the second employee loses it at once.
    const rows2 = await listCustomers(agent2, 'sort=name');
    const shared2 = rowOf(rows2, 'cus_d073_share');
    assert.equal(
      Number(shared2?.['conversation_count'] ?? 0),
      0,
      '⭐⭐⭐ the second employee still sees the conversation after it was given to another employee',
    );
    // ⭐⭐ Back to the first state.
    await harness.client.request({
      method: 'POST',
      path: `/api/inbox/conversations/${REF_B}/assign`,
      token: owner,
      payload: { actor_id: agent2Id },
    });
    const rows3 = await listCustomers(agent1, 'sort=name');
    assert.equal(
      Number(rowOf(rows3, 'cus_d073_share')?.['conversation_count']),
      1,
      '⭐⭐⭐ the count did not go back',
    );
  });

  await t.test('⭐⭐⭐ M-83i: the viewer reads the whole company (the scope of the core)', async () => {
    const rows = await listCustomers(viewer, 'sort=name');
    const shared = rowOf(rows, 'cus_d073_share');
    assert.equal(Number(shared?.['conversation_count']), 2, '⭐⭐⭐ the viewer must see the two conversations');
  });
});

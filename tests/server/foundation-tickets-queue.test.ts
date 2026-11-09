// ============================================================
// WASL AI — M-119 (the queue of the tickets that have no assignee)
// ------------------------------------------------------------
// ⭐⭐ WHAT THIS FILE PROVES (a PERMANENT file, not a throwaway):
//   ① ⭐⭐ the queue returns ONLY the tickets that have no assignee;
//   ② ⭐⭐ the counter of the queue is EXACTLY the number of the
//      tickets that wait for an assignment;
//   ③ ⭐⭐ the counter follows the SAME filters as the list (the
//      lesson of M-83: the count and the list are ONE question);
//   ④ ⭐⭐⭐ THE ISOLATION: the queue of a company NEVER shows a
//      ticket of another company (and the counter never counts it);
//   ⑤ ⭐⭐⭐ THE SCOPE OF THE ROLE: the employee sees an EMPTY queue
//      (their scope is the tickets that are assigned to THEM) ⇒ ⭐⭐
//      and the counter is zero for them too;
//   ⑥ ⭐⭐⭐ NO NEW RIGHT: the supervisor, the employee and the
//      viewer can READ the queue but the assignment is REFUSED for
//      them ⇒ ⭐⭐ (403 and NOTHING is written);
//   ⑦ ⭐⭐ the owner MAY assign from the queue ⇒ ⭐⭐ and the ticket
//      LEAVES the queue and the counter drops by one;
//   ⑧ ⭐⭐ the queue and the ordinary list agree (the queue is a
//      FILTER of the list, not a second truth).
// ⛔ Local synthetic database only. ⛔ No new capability: the rights
//    of the assignment are the ones of the core (the bridge of D-078).
// ============================================================

import assert from 'node:assert/strict';
import test from 'node:test';

import { UnitOfWork } from '../../server/db/unit-of-work.ts';
import { loginAs, resetSyntheticData, startHarness } from './harness.ts';

const NS = 'que';
const PASSCODE = process.env['WASL_TEST_PASSCODE'] ?? 'wasl-local-test';
const ALPHA = `${NS}_tnt_alpha`;
const BETA = `${NS}_tnt_beta`;
const OWNER = `${NS}_usr_alpha_owner`;
const SUPER = `${NS}_usr_alpha_super`;
const AGENT = `${NS}_usr_alpha_agent`;
const VIEWER = `${NS}_usr_alpha_viewer`;
const BETA_OWNER = `${NS}_usr_beta_owner`;
const CUSTOMER = `${NS}_cus_alpha_1`;
const BETA_CUSTOMER = `${NS}_cus_beta_1`;

interface ListBody {
  readonly ok?: boolean;
  readonly tickets?: { readonly ref: string; readonly assignee_actor_id?: string | null }[];
  readonly total?: number;
  readonly unassigned_count?: number;
  readonly may_assign?: boolean;
  readonly may_write?: boolean;
  readonly error?: { readonly code?: string };
}

async function assigneeInDatabase(
  harness: Awaited<ReturnType<typeof startHarness>>,
  tenantId: string,
  ref: string,
): Promise<string | null> {
  return UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
    const result = await uow.query<{ assignee_actor_id: string | null }>(
      `select assignee_actor_id from support_tickets where tenant_id = $1 and ref = $2`,
      [tenantId, ref],
    );
    return result.rows[0]?.assignee_actor_id ?? null;
  });
}

test('FOUNDATION 4) M-119 — the queue of the tickets that have no assignee', async (t) => {
  const harness = await startHarness({ namespace: NS });
  t.after(async () => {
    await harness.stop();
  });
  await resetSyntheticData(harness.ownerPool, PASSCODE, ['tnt_alpha', 'tnt_beta'], NS);

  const owner = await loginAs(harness.client, ALPHA, OWNER, PASSCODE);
  const supervisor = await loginAs(harness.client, ALPHA, SUPER, PASSCODE);
  const agent = await loginAs(harness.client, ALPHA, AGENT, PASSCODE);
  const viewer = await loginAs(harness.client, ALPHA, VIEWER, PASSCODE);
  const betaOwner = await loginAs(harness.client, BETA, BETA_OWNER, PASSCODE);

  // ⭐⭐ THREE unassigned tickets of the company and ONE that is
  // ⭐⭐ assigned (it must NOT be in the queue) ⇒ ⭐⭐ and ONE ticket
  // ⭐⭐ of ANOTHER company (it must never be visible).
  const refs: string[] = [];
  for (let index = 1; index <= 3; index += 1) {
    const ref = `tkt_${NS}_open_${index}`;
    refs.push(ref);
    const created = await harness.client.request({
      method: 'POST',
      path: '/api/tickets',
      token: owner,
      payload: {
        ref,
        customer_id: CUSTOMER,
        subject: `تذكرة مفتوحة ${index}`,
        description: 'وصف',
        priority: 'normal',
      },
    });
    assert.equal(created.status, 201, `the ticket ${ref} was refused: ${created.status}`);
  }
  const assignedRef = `tkt_${NS}_assigned`;
  const assigned = await harness.client.request({
    method: 'POST',
    path: '/api/tickets',
    token: owner,
    payload: {
      ref: assignedRef,
      customer_id: CUSTOMER,
      subject: 'تذكرة مُسندة',
      description: 'وصف',
    },
  });
  assert.equal(assigned.status, 201, `the assigned ticket was refused: ${assigned.status}`);
  const assignAnswer = await harness.client.request({
    method: 'PATCH',
    path: `/api/tickets/${assignedRef}`,
    token: owner,
    payload: { version: 1, assignee_actor_id: AGENT },
  });
  assert.equal(assignAnswer.status, 200, `the assignment was refused: ${assignAnswer.status}`);

  const otherRef = `tkt_${NS}_other_company`;
  const other = await harness.client.request({
    method: 'POST',
    path: '/api/tickets',
    token: betaOwner,
    payload: {
      ref: otherRef,
      customer_id: BETA_CUSTOMER,
      subject: 'تذكرة شركة تانية',
      description: 'وصف',
    },
  });
  assert.equal(other.status, 201, `the ticket of the other company was refused: ${other.status}`);

  await t.test('⭐⭐⭐ M-119-1: the queue returns ONLY the tickets that have no assignee', async () => {
    const answer = await harness.client.request({
      method: 'GET',
      path: '/api/tickets?unassigned=1&limit=50&offset=0',
      token: owner,
      payload: {},
    });
    assert.equal(answer.status, 200, `the queue was refused: ${answer.status}`);
    const body = answer.body as ListBody;
    const list = (body.tickets ?? []).map((ticket) => ticket.ref);
    assert.equal(list.length, 3, `the queue shows ${list.length} ticket(s) instead of 3`);
    assert.ok(!list.includes(assignedRef), 'the ASSIGNED ticket is in the queue');
    for (const ref of list) {
      const ticket = (body.tickets ?? []).find((item) => item.ref === ref);
      assert.equal(
        ticket?.assignee_actor_id ?? null,
        null,
        `the ticket ${ref} of the queue has an assignee`,
      );
    }
    assert.ok(!list.includes(otherRef), '⭐⭐⭐ the ticket of ANOTHER COMPANY is in the queue');
  });

  await t.test('⭐⭐⭐ M-119-2: the counter is EXACTLY the number of the queue', async () => {
    const answer = await harness.client.request({
      method: 'GET',
      path: '/api/tickets?limit=50&offset=0',
      token: owner,
      payload: {},
    });
    const body = answer.body as ListBody;
    assert.equal(
      body.unassigned_count,
      3,
      `⭐⭐⭐ the counter of the queue is ${body.unassigned_count} instead of 3`,
    );
    const queue = await harness.client.request({
      method: 'GET',
      path: '/api/tickets?unassigned=1&limit=50&offset=0',
      token: owner,
      payload: {},
    });
    const queueBody = queue.body as ListBody;
    assert.equal(
      queueBody.unassigned_count,
      queueBody.total,
      '⭐⭐⭐ the counter and the queue of the filter disagree',
    );
  });

  await t.test('⭐⭐⭐ M-119-3: the counter follows the SAME filters as the list', async () => {
    const answer = await harness.client.request({
      method: 'GET',
      path: '/api/tickets?q=' + encodeURIComponent('مفتوحة 2') + '&limit=50&offset=0',
      token: owner,
      payload: {},
    });
    const body = answer.body as ListBody;
    assert.equal(
      body.unassigned_count,
      1,
      `⭐⭐⭐ the counter ignored the filter of the text: ${body.unassigned_count}`,
    );
    const queue = await harness.client.request({
      method: 'GET',
      path: '/api/tickets?q=' + encodeURIComponent('مفتوحة 2') + '&unassigned=1&limit=50&offset=0',
      token: owner,
      payload: {},
    });
    const queueBody = queue.body as ListBody;
    assert.equal(queueBody.total, 1, '⭐⭐⭐ the queue of the filter is wrong');
    assert.equal(
      queueBody.unassigned_count,
      1,
      '⭐⭐⭐ the counter and the filtered queue disagree',
    );
  });

  await t.test('⭐⭐⭐ M-119-4: the isolation of the queue (another company)', async () => {
    const answer = await harness.client.request({
      method: 'GET',
      path: '/api/tickets?unassigned=1&limit=50&offset=0',
      token: betaOwner,
      payload: {},
    });
    assert.equal(answer.status, 200, `the queue of the other company was refused: ${answer.status}`);
    const body = answer.body as ListBody;
    const list = (body.tickets ?? []).map((ticket) => ticket.ref);
    assert.deepEqual(list, [otherRef], `⭐⭐⭐ the queue of the other company is wrong: ${list}`);
    assert.equal(
      body.unassigned_count,
      1,
      `⭐⭐⭐ the counter of the other company counts foreign tickets: ${body.unassigned_count}`,
    );
  });

  await t.test('⭐⭐⭐ M-119-5: the queue of the EMPLOYEE is empty (the scope of the role)', async () => {
    const answer = await harness.client.request({
      method: 'GET',
      path: '/api/tickets?unassigned=1&limit=50&offset=0',
      token: agent,
      payload: {},
    });
    assert.equal(answer.status, 200, `the queue of the employee was refused: ${answer.status}`);
    const body = answer.body as ListBody;
    assert.equal(
      (body.tickets ?? []).length,
      0,
      '⭐⭐⭐ the employee sees the unassigned tickets of the company',
    );
    assert.equal(
      body.unassigned_count,
      0,
      `⭐⭐⭐ the counter of the employee counts foreign tickets: ${body.unassigned_count}`,
    );
    // ⭐⭐⭐ and the employee still sees THEIR OWN ticket (the scope of
    // ⭐⭐⭐ the role did not change).
    const own = await harness.client.request({
      method: 'GET',
      path: '/api/tickets?limit=50&offset=0',
      token: agent,
      payload: {},
    });
    const ownBody = own.body as ListBody;
    assert.equal(
      (ownBody.tickets ?? []).length,
      1,
      `⭐⭐⭐ the employee lost their own ticket: ${JSON.stringify(ownBody.tickets)}`,
    );
  });

  await t.test('⭐⭐⭐ M-119-6: NO new right of assignment (the supervisor, the employee, the viewer)', async () => {
    for (const [label, token] of [
      ['supervisor', supervisor],
      ['employee', agent],
      ['viewer', viewer],
    ] as const) {
      const read = await harness.client.request({
        method: 'GET',
        path: '/api/tickets?unassigned=1&limit=50&offset=0',
        token,
        payload: {},
      });
      assert.equal(read.status, 200, `the ${label} cannot read the queue: ${read.status}`);
      const body = read.body as ListBody;
      assert.equal(
        body.may_assign,
        false,
        `⭐⭐⭐ the server announced the right of the assignment to the ${label}`,
      );
      const write = await harness.client.request({
        method: 'PATCH',
        path: `/api/tickets/${refs[0]}`,
        token,
        payload: { version: 1, assignee_actor_id: AGENT },
      });
      assert.equal(
        write.status,
        403,
        `⭐⭐⭐ the ${label} assigned a ticket: ${write.status} ${JSON.stringify(write.body)}`,
      );
      assert.equal(
        await assigneeInDatabase(harness, ALPHA, refs[0]),
        null,
        `⭐⭐⭐ the refused assignment of the ${label} still wrote`,
      );
    }
  });

  await t.test('⭐⭐⭐ M-119-7: the owner assigns from the queue ⇒ the ticket LEAVES it', async () => {
    const before = await harness.client.request({
      method: 'GET',
      path: '/api/tickets?unassigned=1&limit=50&offset=0',
      token: owner,
      payload: {},
    });
    const beforeBody = before.body as ListBody;
    assert.equal(beforeBody.unassigned_count, 3, 'the queue did not start with three tickets');

    const answer = await harness.client.request({
      method: 'PATCH',
      path: `/api/tickets/${refs[0]}`,
      token: owner,
      payload: { version: 1, assignee_actor_id: AGENT },
    });
    assert.equal(answer.status, 200, `the owner could not assign from the queue: ${answer.status}`);

    const after = await harness.client.request({
      method: 'GET',
      path: '/api/tickets?unassigned=1&limit=50&offset=0',
      token: owner,
      payload: {},
    });
    const afterBody = after.body as ListBody;
    assert.equal(
      afterBody.unassigned_count,
      2,
      `⭐⭐⭐ the counter did not drop after the assignment: ${afterBody.unassigned_count}`,
    );
    const list = (afterBody.tickets ?? []).map((ticket) => ticket.ref);
    assert.ok(!list.includes(refs[0]), '⭐⭐⭐ the assigned ticket is still in the queue');
    assert.equal(afterBody.total, 2, '⭐⭐⭐ the total of the queue is wrong');
  });

  await t.test('⭐⭐⭐ M-119-8: the queue and the ordinary list agree', async () => {
    const all = await harness.client.request({
      method: 'GET',
      path: '/api/tickets?limit=50&offset=0',
      token: owner,
      payload: {},
    });
    const allBody = all.body as ListBody;
    const queue = await harness.client.request({
      method: 'GET',
      path: '/api/tickets?unassigned=1&limit=50&offset=0',
      token: owner,
      payload: {},
    });
    const queueBody = queue.body as ListBody;
    const unassignedOfAll = (allBody.tickets ?? []).filter(
      (ticket) => (ticket.assignee_actor_id ?? null) === null,
    );
    assert.equal(
      queueBody.total,
      unassignedOfAll.length,
      '⭐⭐⭐ the queue is not the unassigned part of the list',
    );
    assert.equal(
      allBody.unassigned_count,
      unassignedOfAll.length,
      '⭐⭐⭐ the counter is not the unassigned part of the list',
    );
  });
});

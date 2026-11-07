// ============================================================
// WASL AI — FOUNDATION BUILD 03 / PHASE 04 (D-073)
// the support tickets of a company
// ------------------------------------------------------------
// ⭐⭐ WHAT THIS FILE PROVES
//   ① the tickets live in a REAL PostgreSQL (the rows are there),
//   ② every operation is checked by the SERVER (a button in the
//      interface is not an authorization),
//   ③ the scope of the employee holds on the tickets AND on the
//      derived data (the count of the open tickets) — the lesson of
//      M-83,
//   ④ the company of another tenant is invisible (not "forbidden":
//      invisible),
//   ⑤ the creation is IDEMPOTENT (the same reference ⇒ the first
//      ticket),
//   ⑥ the lock of the concurrent edit holds (a second employee gets a
//      conflict instead of overwriting),
//   ⑦ the state machine of the tickets is closed (an unknown state is
//      refused and an illegal transition is refused),
//   ⑧ closing a ticket does NOT close the conversation (the two are
//      not coupled).
// ⛔ Local synthetic database only.
// ============================================================

import assert from 'node:assert/strict';
import test from 'node:test';

import { UnitOfWork } from '../../server/db/unit-of-work.ts';
import { loginAs, resetSyntheticData, startHarness } from './harness.ts';

// ⭐⭐ D-073: the companies of THIS file (the namespace) ⇒ ⭐⭐ no other
//   file can touch their rows.
const NS = 'tkt';

const PASSCODE = process.env['WASL_TEST_PASSCODE'] ?? 'wasl-local-test';

test('FOUNDATION 4) the support tickets and their permissions (D-073)', async (t) => {
  const harness = await startHarness({ namespace: NS });
  t.after(async () => {
    await harness.stop();
  });
  await resetSyntheticData(harness.ownerPool, PASSCODE, ['tnt_alpha', 'tnt_beta', 'tnt_gamma'], NS);

  const owner = await loginAs(harness.client, `${NS}_tnt_alpha`, `${NS}_usr_alpha_owner`, PASSCODE);
  const supervisor = await loginAs(
    harness.client,
    `${NS}_tnt_alpha`,
    `${NS}_usr_alpha_super`,
    PASSCODE,
  );
  const agent = await loginAs(harness.client, `${NS}_tnt_alpha`, `${NS}_usr_alpha_agent`, PASSCODE);
  const viewer = await loginAs(harness.client, `${NS}_tnt_alpha`, `${NS}_usr_alpha_viewer`, PASSCODE);
  const otherOwner = await loginAs(
    harness.client,
    `${NS}_tnt_beta`,
    `${NS}_usr_beta_owner`,
    PASSCODE,
  );

  const ref = `tkt_${NS}_1`;

  await t.test('⭐ the owner creates a ticket and the database really holds it', async () => {
    const created = await harness.client.request({
      method: 'POST',
      path: '/api/tickets',
      token: owner,
      payload: {
        ref,
        customer_id: `${NS}_cus_alpha_1`,
        subject: 'فاتورة مكررة',
        description: 'تم تحصيل المبلغ مرتين',
        priority: 'high',
      },
    });
    assert.equal(created.status, 201, `the ticket was refused: ${JSON.stringify(created.body)}`);
    const rows = await UnitOfWork.run(harness.ownerPool, `${NS}_tnt_alpha`, async (uow) => {
      const result = await uow.query<{ count: string }>(
        `select count(*)::text as count from support_tickets where tenant_id = $1 and ref = $2`,
        [`${NS}_tnt_alpha`, ref],
      );
      return Number(result.rows[0]?.count ?? '0');
    });
    assert.equal(rows, 1, 'the ticket is not in the database');
  });

  await t.test('⭐ the creation is idempotent (the same reference ⇒ the first ticket)', async () => {
    const again = await harness.client.request({
      method: 'POST',
      path: '/api/tickets',
      token: owner,
      payload: { ref, customer_id: `${NS}_cus_alpha_1`, subject: 'محاولة ثانية' },
    });
    assert.equal(again.status, 200, `the retry was refused: ${JSON.stringify(again.body)}`);
    assert.equal(again.body['created'], false, 'the tool created a second ticket');
    const rows = await UnitOfWork.run(harness.ownerPool, `${NS}_tnt_alpha`, async (uow) => {
      const result = await uow.query<{ count: string }>(
        `select count(*)::text as count from support_tickets where tenant_id = $1 and ref = $2`,
        [`${NS}_tnt_alpha`, ref],
      );
      return Number(result.rows[0]?.count ?? '0');
    });
    assert.equal(rows, 1, 'the retry duplicated the ticket');
  });

  await t.test('⭐⭐ the supervisor may create and edit (the decision of D-071)', async () => {
    const created = await harness.client.request({
      method: 'POST',
      path: '/api/tickets',
      token: supervisor,
      payload: {
        ref: `tkt_${NS}_sup`,
        customer_id: `${NS}_cus_alpha_1`,
        subject: 'تذكرة المشرف',
      },
    });
    assert.equal(created.status, 201, `the supervisor was refused: ${JSON.stringify(created.body)}`);
  });

  await t.test('⭐⭐⭐ the agent may NOT create or edit (the rights of the core)', async () => {
    const created = await harness.client.request({
      method: 'POST',
      path: '/api/tickets',
      token: agent,
      payload: { customer_id: `${NS}_cus_alpha_1`, subject: 'محاولة موظف' },
    });
    assert.equal(created.status, 403, `the agent created a ticket: ${created.status}`);

    const version = await currentVersion(harness, ref);
    const edited = await harness.client.request({
      method: 'PATCH',
      path: `/api/tickets/${ref}`,
      token: agent,
      payload: { version, state: 'in_progress' },
    });
    assert.equal(edited.status, 403, `the agent edited a ticket: ${edited.status}`);
  });

  await t.test('⭐⭐⭐ the viewer may NOT create or edit (read only)', async () => {
    const created = await harness.client.request({
      method: 'POST',
      path: '/api/tickets',
      token: viewer,
      payload: { customer_id: `${NS}_cus_alpha_1`, subject: 'محاولة قارئ' },
    });
    assert.equal(created.status, 403, `the viewer created a ticket: ${created.status}`);
  });

  await t.test('⭐⭐⭐ the assignment is the OWNER alone (the fact M-84 corrected)', async () => {
    const version = await currentVersion(harness, ref);
    const bySupervisor = await harness.client.request({
      method: 'PATCH',
      path: `/api/tickets/${ref}`,
      token: supervisor,
      payload: { version, assignee_actor_id: `${NS}_usr_alpha_agent` },
    });
    assert.equal(
      bySupervisor.status,
      403,
      `the supervisor assigned a ticket: ${bySupervisor.status}`,
    );

    const byOwner = await harness.client.request({
      method: 'PATCH',
      path: `/api/tickets/${ref}`,
      token: owner,
      payload: { version, assignee_actor_id: `${NS}_usr_alpha_agent` },
    });
    assert.equal(byOwner.status, 200, `the owner could not assign: ${JSON.stringify(byOwner.body)}`);
  });

  await t.test('⭐⭐ the assignee must be an employee of THIS company', async () => {
    const version = await currentVersion(harness, ref);
    const response = await harness.client.request({
      method: 'PATCH',
      path: `/api/tickets/${ref}`,
      token: owner,
      payload: { version, assignee_actor_id: `${NS}_usr_beta_owner` },
    });
    assert.equal(response.status, 409, `the assignee of another company was accepted: ${response.status}`);
  });

  await t.test('⭐⭐ the scope of the employee holds on the tickets', async () => {
    // ⭐ The agent sees the tickets that are assigned to them only.
    const listed = await harness.client.request({
      method: 'GET',
      path: '/api/tickets',
      token: agent,
    });
    assert.equal(listed.status, 200, `the agent could not list: ${listed.status}`);
    const rows = listed.body['tickets'] as Array<Record<string, unknown>>;
    for (const row of rows) {
      assert.equal(
        row['assignee_actor_id'],
        `${NS}_usr_alpha_agent`,
        `the agent sees a ticket of another employee: ${JSON.stringify(row)}`,
      );
    }
    assert.ok(
      rows.some((row) => row['ref'] === ref),
      'the agent does not see the ticket that is assigned to them',
    );
  });

  await t.test('⭐⭐⭐ the DERIVED count follows the same scope (the lesson of M-83)', async () => {
    // ⭐⭐ The scope of the CRM hides the customer from an employee who
    //   has no conversation of it ⇒ ⭐⭐ the employee is given ONE
    //   conversation of that customer (the same rule of the core work
    //   queue) ⇒ ⭐⭐ and only then the file of the customer is read.
    const conversation = await harness.client.request({
      method: 'POST',
      path: '/api/conversations',
      token: owner,
      payload: {
        conversation_ref: `conv_${NS}_scope`,
        customer_id: `${NS}_cus_alpha_1`,
        message: { body: 'the conversation of the employee' },
      },
    });
    assert.equal(conversation.status, 201, `the conversation was refused: ${conversation.status}`);
    // ⭐⭐ The state machine of the CORE: `new` ⇒ `open` ⇒ `assigned`
    //   ⇒ ⭐⭐ the assignment happens only after the opening.
    const opened = await harness.client.request({
      method: 'POST',
      path: `/api/conversations/conv_${NS}_scope/state`,
      token: owner,
      payload: { to: 'open', reason: 'the conversation is open' },
    });
    assert.equal(opened.status, 200, `the open was refused: ${JSON.stringify(opened.body)}`);
    const assigned = await harness.client.request({
      method: 'POST',
      path: `/api/conversations/conv_${NS}_scope/assign`,
      token: owner,
      payload: { actor_id: `${NS}_usr_alpha_agent` },
    });
    assert.equal(assigned.status, 200, `the assignment was refused: ${JSON.stringify(assigned.body)}`);

    // ⭐ The owner creates a SECOND ticket of the same customer and
    //   leaves it unassigned ⇒ ⭐⭐ the count of the open tickets of an
    //   agent must NOT include it.
    const created = await harness.client.request({
      method: 'POST',
      path: '/api/tickets',
      token: owner,
      payload: {
        ref: `tkt_${NS}_other`,
        customer_id: `${NS}_cus_alpha_1`,
        subject: 'تذكرة غير مُسندة',
      },
    });
    assert.equal(created.status, 201, `the second ticket was refused: ${JSON.stringify(created.body)}`);

    const asAgent = await harness.client.request({
      method: 'GET',
      path: `/api/crm/customers/${NS}_cus_alpha_1`,
      token: agent,
    });
    assert.equal(asAgent.status, 200, `the agent could not read the customer: ${asAgent.status}`);
    const agentTickets = asAgent.body['tickets'] as Array<Record<string, unknown>>;
    const agentCount = Number(asAgent.body['open_ticket_count'] ?? '-1');
    assert.ok(
      !agentTickets.some((row) => row['ref'] === `tkt_${NS}_other`),
      'the agent sees a ticket that is not assigned to them',
    );
    assert.equal(
      agentCount,
      agentTickets.filter((row) => row['state'] !== 'resolved' && row['state'] !== 'closed').length,
      'the count of the open tickets does not follow the scope',
    );

    const asOwner = await harness.client.request({
      method: 'GET',
      path: `/api/crm/customers/${NS}_cus_alpha_1`,
      token: owner,
    });
    const ownerTickets = asOwner.body['tickets'] as Array<Record<string, unknown>>;
    assert.ok(
      ownerTickets.some((row) => row['ref'] === `tkt_${NS}_other`),
      'the owner does not see the ticket of their company',
    );
  });

  await t.test('⭐⭐⭐ the company of another tenant is INVISIBLE (not forbidden)', async () => {
    const listed = await harness.client.request({
      method: 'GET',
      path: '/api/tickets',
      token: otherOwner,
    });
    assert.equal(listed.status, 200);
    const rows = listed.body['tickets'] as Array<Record<string, unknown>>;
    assert.equal(rows.length, 0, `the other company sees the tickets: ${JSON.stringify(rows)}`);

    const read = await harness.client.request({
      method: 'GET',
      path: `/api/tickets/${ref}`,
      token: otherOwner,
    });
    assert.equal(read.status, 404, `the other company read the ticket: ${read.status}`);
  });

  await t.test('⭐⭐ the lock of the concurrent edit holds (no lost update)', async () => {
    const version = await currentVersion(harness, ref);
    const first = await harness.client.request({
      method: 'PATCH',
      path: `/api/tickets/${ref}`,
      token: owner,
      payload: { version, priority: 'urgent' },
    });
    assert.equal(first.status, 200, `the first edit was refused: ${JSON.stringify(first.body)}`);

    const second = await harness.client.request({
      method: 'PATCH',
      path: `/api/tickets/${ref}`,
      token: owner,
      payload: { version, priority: 'low' },
    });
    assert.equal(second.status, 409, `the second edit overwrote the first one: ${second.status}`);
  });

  await t.test('⭐⭐ the state machine of the tickets is closed', async () => {
    const version = await currentVersion(harness, ref);
    const unknown = await harness.client.request({
      method: 'PATCH',
      path: `/api/tickets/${ref}`,
      token: owner,
      payload: { version, state: 'not_a_state' },
    });
    assert.equal(unknown.status, 400, `an unknown state was accepted: ${unknown.status}`);

    const closed = await harness.client.request({
      method: 'PATCH',
      path: `/api/tickets/${ref}`,
      token: owner,
      payload: { version, state: 'closed' },
    });
    assert.equal(closed.status, 200, `the close was refused: ${JSON.stringify(closed.body)}`);

    const afterClose = await currentVersion(harness, ref);
    const reopen = await harness.client.request({
      method: 'PATCH',
      path: `/api/tickets/${ref}`,
      token: owner,
      payload: { version: afterClose, state: 'open' },
    });
    assert.equal(reopen.status, 409, `a closed ticket was reopened: ${reopen.status}`);
  });

  await t.test('⭐⭐⭐ closing a ticket does NOT close the conversation (they are not coupled)', async () => {
    const conversation = await harness.client.request({
      method: 'POST',
      path: '/api/conversations',
      token: owner,
      payload: {
        conversation_ref: `conv_${NS}_tkt`,
        customer_id: `${NS}_cus_alpha_1`,
        message: { body: 'problem' },
      },
    });
    assert.equal(conversation.status, 201, `the conversation was refused: ${conversation.status}`);

    const created = await harness.client.request({
      method: 'POST',
      path: '/api/tickets',
      token: owner,
      payload: {
        ref: `tkt_${NS}_linked`,
        customer_id: `${NS}_cus_alpha_1`,
        conversation_ref: `conv_${NS}_tkt`,
        subject: 'تذكرة مرتبطة',
      },
    });
    assert.equal(created.status, 201, `the linked ticket was refused: ${JSON.stringify(created.body)}`);

    const version = await currentVersion(harness, `tkt_${NS}_linked`);
    const closed = await harness.client.request({
      method: 'PATCH',
      path: `/api/tickets/tkt_${NS}_linked`,
      token: owner,
      payload: { version, state: 'closed' },
    });
    assert.equal(closed.status, 200);

    const state = await UnitOfWork.run(harness.ownerPool, `${NS}_tnt_alpha`, async (uow) => {
      const result = await uow.query<{ state: string }>(
        `select state from conversations where tenant_id = $1 and ref = $2`,
        [`${NS}_tnt_alpha`, `conv_${NS}_tkt`],
      );
      return result.rows[0]?.state ?? '';
    });
    assert.notEqual(state, 'closed', 'closing the ticket closed the conversation too');
  });

  await t.test('⭐ the activity of the ticket is a fact of the database', async () => {
    const detail = await harness.client.request({
      method: 'GET',
      path: `/api/tickets/${ref}`,
      token: owner,
    });
    assert.equal(detail.status, 200);
    const changes = detail.body['changes'] as Array<Record<string, unknown>>;
    assert.ok(changes.length >= 2, `the activity is too short: ${changes.length}`);
    const operations = changes.map((row) => String(row['operation']));
    assert.ok(operations.includes('ticket.create'), 'the creation is not in the activity');
  });

  await t.test('⭐⭐ the list is filtered, ordered and paginated', async () => {
    const page = await harness.client.request({
      method: 'GET',
      path: '/api/tickets?limit=1&offset=0&sort=priority',
      token: owner,
    });
    assert.equal(page.status, 200);
    const rows = page.body['tickets'] as Array<Record<string, unknown>>;
    assert.equal(rows.length, 1, 'the pagination did not hold');
    assert.ok(Number(page.body['total'] ?? 0) >= 3, 'the total is wrong');

    const filtered = await harness.client.request({
      method: 'GET',
      path: '/api/tickets?state=closed',
      token: owner,
    });
    const closedRows = filtered.body['tickets'] as Array<Record<string, unknown>>;
    for (const row of closedRows) {
      assert.equal(row['state'], 'closed', 'the filter returned another state');
    }
  });
});

/** ⭐ The version of a ticket (the lock of the concurrent edit). */
async function currentVersion(
  harness: { ownerPool: import('../../server/db/pool.ts').PgPool },
  ref: string,
): Promise<number> {
  return UnitOfWork.run(harness.ownerPool, `${NS}_tnt_alpha`, async (uow) => {
    const result = await uow.query<{ version: number }>(
      `select version from support_tickets where tenant_id = $1 and ref = $2`,
      [`${NS}_tnt_alpha`, ref],
    );
    return Number(result.rows[0]?.version ?? 0);
  });
}

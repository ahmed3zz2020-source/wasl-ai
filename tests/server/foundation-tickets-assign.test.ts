// ============================================================
// WASL AI — FOUNDATION BUILD 03 / PHASE 04 (D-073)
// the regression proof of M-89 and M-90 (the review of reply #49)
// ------------------------------------------------------------
// ⭐⭐ WHAT THIS FILE PROVES (and it is a PERMANENT file, not a
//   throwaway harness):
//   ① M-89 — the RIGHT TO ASSIGN IS NOT THE RIGHT TO CREATE:
//      a supervisor who may create a ticket may NOT assign one at
//      the creation (the policy gives `ticket.assign` to the owner
//      alone) ⇒ ⭐⭐ the answer is 403 and NOTHING is written;
//   ② M-89 — the assignee must be an ACTIVE member of THIS company:
//      another company, a missing user and a suspended member are all
//      refused ⇒ ⭐⭐ and nothing is written;
//   ③ M-89 — the owner MAY assign at the creation (the right stays);
//   ④ M-90 — the customer of the ticket and the customer of the
//      conversation must be THE SAME ⇒ ⭐⭐ the mismatch is refused;
//   ⑤ the correct creations still work (the fix breaks nothing).
// ⭐⭐ The rule of the project: a defect is closed ONLY by a test that
//   fails on the old code and passes on the new one ⇒ ⭐⭐ this file
//   was run against the old code first (it failed) and against the
//   new code after (it passed) — the proof is in the report.
// ⛔ Local synthetic database only.
// ============================================================

import assert from 'node:assert/strict';
import test from 'node:test';

import { UnitOfWork } from '../../server/db/unit-of-work.ts';
import { loginAs, resetSyntheticData, startHarness } from './harness.ts';

const NS = 'asg';
const PASSCODE = process.env['WASL_TEST_PASSCODE'] ?? 'wasl-local-test';

async function countTickets(harness: Awaited<ReturnType<typeof startHarness>>, ref: string) {
  return UnitOfWork.run(harness.ownerPool, `${NS}_tnt_alpha`, async (uow) => {
    const result = await uow.query<{ count: string }>(
      `select count(*)::text as count from support_tickets where tenant_id = $1 and ref = $2`,
      [`${NS}_tnt_alpha`, ref],
    );
    return Number(result.rows[0]?.count ?? '0');
  });
}

test('FOUNDATION 4) the regression of M-89 and M-90 (the assignment and the customer)', async (t) => {
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

  await t.test('⭐⭐⭐ M-89 — the supervisor may create BUT may NOT assign at the creation', async () => {
    const ref = `tkt_${NS}_sup_assign`;
    const created = await harness.client.request({
      method: 'POST',
      path: '/api/tickets',
      token: supervisor,
      payload: {
        ref,
        customer_id: `${NS}_cus_alpha_1`,
        subject: 'محاولة إسناد عند الإنشاء',
        assignee_actor_id: `${NS}_usr_alpha_agent`,
      },
    });
    assert.equal(
      created.status,
      403,
      `the supervisor assigned a ticket at the creation: ${created.status} ${JSON.stringify(created.body)}`,
    );
    assert.equal(
      await countTickets(harness, ref),
      0,
      'the refused assignment still wrote a ticket',
    );
  });

  await t.test('⭐⭐⭐ M-89 — the assignee of another company is refused', async () => {
    const ref = `tkt_${NS}_other_company`;
    const created = await harness.client.request({
      method: 'POST',
      path: '/api/tickets',
      token: owner,
      payload: {
        ref,
        customer_id: `${NS}_cus_alpha_1`,
        subject: 'مُسنَد إليه من شركة أخرى',
        assignee_actor_id: `${NS}_usr_beta_owner`,
      },
    });
    assert.notEqual(created.status, 201, 'the assignee of another company was accepted');
    assert.equal(
      await countTickets(harness, ref),
      0,
      'the refused assignee still wrote a ticket',
    );
  });

  await t.test('⭐⭐⭐ M-89 — an assignee who does not exist is refused', async () => {
    const ref = `tkt_${NS}_ghost`;
    const created = await harness.client.request({
      method: 'POST',
      path: '/api/tickets',
      token: owner,
      payload: {
        ref,
        customer_id: `${NS}_cus_alpha_1`,
        subject: 'مُسنَد إليه غير موجود',
        assignee_actor_id: 'usr_does_not_exist_at_all',
      },
    });
    assert.notEqual(created.status, 201, 'a missing assignee was accepted');
    assert.equal(await countTickets(harness, ref), 0, 'the refused assignee still wrote a ticket');
  });

  await t.test('⭐⭐⭐ M-89 — a SUSPENDED member is refused', async () => {
    await UnitOfWork.run(harness.ownerPool, `${NS}_tnt_alpha`, async (uow) => {
      await uow.query(
        `update memberships set status = 'suspended'
          where tenant_id = $1 and user_id = $2`,
        [`${NS}_tnt_alpha`, `${NS}_usr_alpha_agent`],
      );
    });
    const ref = `tkt_${NS}_suspended`;
    const created = await harness.client.request({
      method: 'POST',
      path: '/api/tickets',
      token: owner,
      payload: {
        ref,
        customer_id: `${NS}_cus_alpha_1`,
        subject: 'مُسنَد إليه غير نشط',
        assignee_actor_id: `${NS}_usr_alpha_agent`,
      },
    });
    assert.notEqual(created.status, 201, 'a suspended member was accepted as an assignee');
    assert.equal(await countTickets(harness, ref), 0, 'the refused assignee still wrote a ticket');
    await UnitOfWork.run(harness.ownerPool, `${NS}_tnt_alpha`, async (uow) => {
      await uow.query(
        `update memberships set status = 'active'
          where tenant_id = $1 and user_id = $2`,
        [`${NS}_tnt_alpha`, `${NS}_usr_alpha_agent`],
      );
    });
  });

  await t.test('⭐⭐ M-89 — the OWNER may assign at the creation (the right stays)', async () => {
    const ref = `tkt_${NS}_owner_assign`;
    const created = await harness.client.request({
      method: 'POST',
      path: '/api/tickets',
      token: owner,
      payload: {
        ref,
        customer_id: `${NS}_cus_alpha_1`,
        subject: 'إسناد صحيح',
        assignee_actor_id: `${NS}_usr_alpha_agent`,
      },
    });
    assert.equal(created.status, 201, `the owner was refused: ${JSON.stringify(created.body)}`);
    assert.equal(await countTickets(harness, ref), 1, 'the ticket is not in the database');
    const stored = await UnitOfWork.run(harness.ownerPool, `${NS}_tnt_alpha`, async (uow) => {
      const result = await uow.query<{ assignee_actor_id: string | null }>(
        `select assignee_actor_id from support_tickets where tenant_id = $1 and ref = $2`,
        [`${NS}_tnt_alpha`, ref],
      );
      return result.rows[0]?.assignee_actor_id ?? null;
    });
    assert.equal(stored, `${NS}_usr_alpha_agent`, 'the assignee was not stored');
  });

  await t.test('⭐⭐⭐ M-90 — the customer of the ticket and of the conversation must be the same', async () => {
    const conversation = await harness.client.request({
      method: 'POST',
      path: '/api/conversations',
      token: owner,
      payload: {
        conversation_ref: `conv_${NS}_cus2`,
        customer_id: `${NS}_cus_alpha_2`,
        message: { body: 'problem of the second customer' },
      },
    });
    assert.equal(conversation.status, 201, `the conversation was refused: ${conversation.status}`);

    const ref = `tkt_${NS}_mismatch`;
    const created = await harness.client.request({
      method: 'POST',
      path: '/api/tickets',
      token: owner,
      payload: {
        ref,
        customer_id: `${NS}_cus_alpha_1`,
        conversation_ref: `conv_${NS}_cus2`,
        subject: 'تذكرة لعميل ومحادثة عميل آخر',
      },
    });
    assert.notEqual(
      created.status,
      201,
      `the mismatched ticket was accepted: ${JSON.stringify(created.body)}`,
    );
    assert.equal(await countTickets(harness, ref), 0, 'the mismatched ticket still wrote a row');
  });

  await t.test('⭐⭐ the correct creation with a conversation of the SAME customer still works', async () => {
    const conversation = await harness.client.request({
      method: 'POST',
      path: '/api/conversations',
      token: owner,
      payload: {
        conversation_ref: `conv_${NS}_cus1`,
        customer_id: `${NS}_cus_alpha_1`,
        message: { body: 'problem of the first customer' },
      },
    });
    assert.equal(conversation.status, 201, `the conversation was refused: ${conversation.status}`);
    const ref = `tkt_${NS}_linked_ok`;
    const created = await harness.client.request({
      method: 'POST',
      path: '/api/tickets',
      token: owner,
      payload: {
        ref,
        customer_id: `${NS}_cus_alpha_1`,
        conversation_ref: `conv_${NS}_cus1`,
        subject: 'تذكرة صحيحة',
      },
    });
    assert.equal(created.status, 201, `the correct ticket was refused: ${JSON.stringify(created.body)}`);
    assert.equal(await countTickets(harness, ref), 1, 'the correct ticket is not in the database');
  });

  await t.test('⭐⭐ the creation without an assignee and without a conversation still works', async () => {
    const ref = `tkt_${NS}_plain`;
    const created = await harness.client.request({
      method: 'POST',
      path: '/api/tickets',
      token: owner,
      payload: { ref, customer_id: `${NS}_cus_alpha_1`, subject: 'تذكرة بسيطة' },
    });
    assert.equal(created.status, 201, `the plain ticket was refused: ${JSON.stringify(created.body)}`);
  });

  await t.test('⭐⭐ the agent may NOT create a ticket (the rights did not move)', async () => {
    const created = await harness.client.request({
      method: 'POST',
      path: '/api/tickets',
      token: agent,
      payload: { customer_id: `${NS}_cus_alpha_1`, subject: 'محاولة موظف' },
    });
    assert.equal(created.status, 403, `the agent created a ticket: ${created.status}`);
  });
});

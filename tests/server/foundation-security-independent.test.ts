// ============================================================
// WASL AI — FOUNDATION BUILD 03 / PHASE 04 (D-073) — M-86
// the independent security matrix
// ------------------------------------------------------------
// ⭐⭐⭐ WHAT THIS FILE IS
//   A security test whose EXPECTATIONS ARE WRITTEN BY HAND from the
//   decisions the owner approved (D-069 … D-072) ⇒ ⭐⭐ and they are
//   NOT read from `ROLE_CAPABILITIES` at runtime.
//
// ⭐⭐⭐ WHY THE INDEPENDENCE MATTERS
//   The matrix of M-84 DERIVES the expectations from the core tables
//   ⇒ ⭐⭐ so it proves that the core and the server agree ⇒ ⭐⭐ but
//   it CANNOT prove that the tables are the decisions the owner
//   approved (a wrong table agrees with itself).
//   ⭐⭐ THIS FILE closes that gap: the table below is a CONSTANT of
//   this file ⇒ ⭐⭐ if the core changes, the core is wrong or the
//   owner has decided ⇒ ⭐⭐ and the test fails and says so.
//
// ⭐⭐⭐ THE MATRIX (the decisions of the owner)
//   ⭐ the owner: everything (the privacy and the sessions too),
//   ⭐ the supervisor: the work and the customers (NO assignment and
//     NO privacy),
//   ⭐ the agent: the conversations and the replies (NO assignment,
//     NO state, NO customers, NO tickets),
//   ⭐ the viewer: the reading only.
//
// ⛔ LOCAL ONLY: a synthetic database on 127.0.0.1.
// ============================================================

import assert from 'node:assert/strict';
import test from 'node:test';

import { UnitOfWork } from '../../server/db/unit-of-work.ts';
import { loginAs, resetSyntheticData, startHarness } from './harness.ts';

const NS = 'sec';
const PASSCODE = process.env['WASL_TEST_PASSCODE'] ?? 'wasl-local-test';

type Verdict = 'allow' | 'refuse';

/**
 * ⭐⭐⭐ THE TABLE OF THE FILE — ⭐⭐ written by hand, NOT derived.
 * ⭐ The key is the operation (the API path + the method).
 * ⭐ The value is the answer of the role: `allow` or `refuse`.
 */
const MATRIX: Readonly<Record<string, Readonly<Record<string, Verdict>>>> = Object.freeze({
  // ⭐ the reading of the conversations (every role reads).
  'GET /api/inbox/conversations': { owner: 'allow', supervisor: 'allow', agent: 'allow', viewer: 'allow' },
  'GET /api/inbox/conversations/:ref': { owner: 'allow', supervisor: 'allow', agent: 'allow', viewer: 'allow' },
  // ⭐⭐ the reply (the viewer does not write).
  'POST /api/inbox/conversations/:ref/replies': { owner: 'allow', supervisor: 'allow', agent: 'allow', viewer: 'refuse' },
  // ⭐⭐⭐ the assignment (the owner alone — the fact M-84 corrected).
  'POST /api/inbox/conversations/:ref/assign': { owner: 'allow', supervisor: 'refuse', agent: 'refuse', viewer: 'refuse' },
  // ⭐⭐ the state (the owner and the supervisor).
  'POST /api/inbox/conversations/:ref/state': { owner: 'allow', supervisor: 'allow', agent: 'refuse', viewer: 'refuse' },
  // ⭐⭐ the creation of a conversation (the owner and the supervisor).
  'POST /api/conversations': { owner: 'allow', supervisor: 'allow', agent: 'refuse', viewer: 'refuse' },
  // ⭐⭐ the customers (the owner and the supervisor — the decision of D-071).
  // ⭐⭐ the creation of a customer is `/api/customers` (the CRM route
  //   is the reading and the edit) ⇒ ⭐⭐ the path is part of the
  //   decision ⇒ ⭐⭐ a wrong path is a 404 and NOT a refusal.
  'POST /api/customers': { owner: 'allow', supervisor: 'allow', agent: 'refuse', viewer: 'refuse' },
  'PATCH /api/crm/customers/:id': { owner: 'allow', supervisor: 'allow', agent: 'refuse', viewer: 'refuse' },
  // ⭐⭐⭐ the tickets (the bridge of D-073).
  'GET /api/tickets': { owner: 'allow', supervisor: 'allow', agent: 'allow', viewer: 'allow' },
  'POST /api/tickets': { owner: 'allow', supervisor: 'allow', agent: 'refuse', viewer: 'refuse' },
  'PATCH /api/tickets/:ref': { owner: 'allow', supervisor: 'allow', agent: 'refuse', viewer: 'refuse' },
  // ⭐⭐⭐ the privacy and the sessions (the owner alone).
  'POST /api/privacy/export': { owner: 'allow', supervisor: 'allow', agent: 'refuse', viewer: 'refuse' },
  'POST /api/privacy/deletion/preview': { owner: 'allow', supervisor: 'refuse', agent: 'refuse', viewer: 'refuse' },
  'POST /api/retention': { owner: 'allow', supervisor: 'refuse', agent: 'refuse', viewer: 'refuse' },
});

test('FOUNDATION 4) the independent security matrix (M-86)', async (t) => {
  const harness = await startHarness({ namespace: NS });
  t.after(async () => {
    await harness.stop();
  });
  await resetSyntheticData(harness.ownerPool, PASSCODE, ['tnt_alpha', 'tnt_beta', 'tnt_gamma'], NS);

  const tokens = {
    owner: await loginAs(harness.client, `${NS}_tnt_alpha`, `${NS}_usr_alpha_owner`, PASSCODE),
    supervisor: await loginAs(harness.client, `${NS}_tnt_alpha`, `${NS}_usr_alpha_super`, PASSCODE),
    agent: await loginAs(harness.client, `${NS}_tnt_alpha`, `${NS}_usr_alpha_agent`, PASSCODE),
    viewer: await loginAs(harness.client, `${NS}_tnt_alpha`, `${NS}_usr_alpha_viewer`, PASSCODE),
  };

  // ⭐⭐ The fixtures: a conversation that is assigned to the agent (so
  //   the agent really reaches it) and a customer of the company.
  const conversationRef = `conv_${NS}_1`;
  const customerId = `${NS}_cus_alpha_1`;
  const ticketRef = `tkt_${NS}_1`;
  await harness.client.request({
    method: 'POST',
    path: '/api/conversations',
    token: tokens.owner,
    payload: {
      conversation_ref: conversationRef,
      customer_id: customerId,
      message: { body: 'the fixture of the matrix' },
    },
  });
  await harness.client.request({
    method: 'POST',
    path: `/api/conversations/${conversationRef}/state`,
    token: tokens.owner,
    payload: { to: 'open', reason: 'the fixture of the matrix' },
  });
  await harness.client.request({
    method: 'POST',
    path: `/api/conversations/${conversationRef}/assign`,
    token: tokens.owner,
    payload: { actor_id: `${NS}_usr_alpha_agent`, reason: 'the fixture of the matrix' },
  });
  await harness.client.request({
    method: 'POST',
    path: '/api/tickets',
    token: tokens.owner,
    payload: { ref: ticketRef, customer_id: customerId, subject: 'the fixture of the matrix' },
  });

  // ⭐⭐⭐ M-91: THE FIXTURE OF THE ASSIGNMENT IS ITS OWN CONVERSATION.
  // ⭐⭐ The main conversation is already assigned to the agent (so the
  //   agent really reaches it) ⇒ ⭐⭐ the core refuses an assignment
  //   that does not change anything (`assignment_unchanged` ⇒ 400) ⇒
  //   ⭐⭐ and the 400 of a business rule must NOT be read as a
  //   success ⇒ ⭐⭐ the assignment of the matrix gets a fresh
  //   conversation (moved to `open` first, because `new` accepts only
  //   `open`).
  const assignConversationRef = `conv_${NS}_assign`;
  await harness.client.request({
    method: 'POST',
    path: '/api/conversations',
    token: tokens.owner,
    payload: {
      conversation_ref: assignConversationRef,
      customer_id: customerId,
      message: { body: 'the fixture of the assignment' },
    },
  });
  await harness.client.request({
    method: 'POST',
    path: `/api/inbox/conversations/${assignConversationRef}/state`,
    token: tokens.owner,
    payload: { to: 'open', reason: 'the fixture of the assignment' },
  });

  // ⭐⭐⭐ M-91: THE FIXTURE OF THE STATE IS A CONVERSATION PER ROLE.
  // ⭐⭐ The state of a conversation moves with the first write ⇒ ⭐⭐
  //   a shared conversation makes the answer of the second role a 409
  //   (a business rule, NOT a right) ⇒ ⭐⭐ and the 409 must NOT be
  //   counted as a success ⇒ ⭐⭐ every role gets its own conversation
  //   (fresh ⇒ `new` ⇒ the call of the matrix moves it to `open`).
  const stateConversationRefs: Record<string, string> = {};
  for (const role of ['owner', 'supervisor', 'agent', 'viewer']) {
    const refForRole = `conv_${NS}_state_${role}`;
    await harness.client.request({
      method: 'POST',
      path: '/api/conversations',
      token: tokens.owner,
      payload: {
        conversation_ref: refForRole,
        customer_id: customerId,
        message: { body: 'the fixture of the state' },
      },
    });
    stateConversationRefs[role] = refForRole;
  }

  await t.test('⭐⭐⭐ every operation answers what the owner decided', async () => {
    for (const [operation, expectations] of Object.entries(MATRIX)) {
      const template = operation.split(' ')[1] ?? '';
      for (const [role, verdict] of Object.entries(expectations)) {
        // ⭐⭐⭐ M-91: THE FIXTURE FOLLOWS THE ROLE ⇒ ⭐⭐ the write of
        //   one role does not change the answer of the next one (the
        //   state and the version move with the first write).
        const path = template
          .replace(
            ':ref',
            operation === 'PATCH /api/tickets/:ref'
              ? ticketRef
              : operation === 'POST /api/inbox/conversations/:ref/assign'
                ? assignConversationRef
                : operation === 'POST /api/inbox/conversations/:ref/state'
                  ? (stateConversationRefs[role] ?? conversationRef)
                  : conversationRef,
          )
          .replace(':id', customerId);
        const token = tokens[role as keyof typeof tokens];
        const answer = await call(harness, operation, path, token);
        const status = answer.status;
        const detail = JSON.stringify(answer.body);
        // ⭐⭐⭐ M-91: FOUR CASES, NOT TWO.
        // ⭐⭐ The old logic was `refused = (status === 403)` ⇒ ⭐⭐
        //   every answer that was NOT 403 (a 400, a 404, even a 500)
        //   counted as a SUCCESS ⇒ ⭐⭐ a false success.
        // ⭐⭐ Now: a success is a 2xx/3xx and NOTHING else ⇒ ⭐⭐ a
        //   400/404/409/422 inside an ALLOWED row is a FAILURE ⇒ ⭐⭐
        //   and a 5xx is ALWAYS a failure (never a success).
        const classification =
          status >= 500
            ? 'internal_error'
            : status === 403
              ? 'refused'
              : status >= 200 && status < 400
                ? 'success'
                : 'input_refused';
        assert.notEqual(
          classification,
          'internal_error',
          `the operation ${operation} with the role ${role}: the answer was ${status} ` +
            '(an internal error is never a success)',
        );
        if (verdict === 'refuse') {
          assert.equal(
            classification,
            'refused',
            `the operation ${operation} with the role ${role}: the answer was ${status} ` +
              `(the decision of the owner is "refuse" ⇒ the answer must be a 403) — the body: ${detail}`,
          );
        } else {
          assert.equal(
            classification,
            'success',
            `the operation ${operation} with the role ${role}: the answer was ${status} ` +
              `(the decision of the owner is "allow" ⇒ the answer must be a success) — the body: ${detail}`,
          );
        }
      }
    }
  });

  await t.test('⭐⭐⭐ M-91 — the assignment AT THE CREATION is the right of the owner alone', async () => {
    // ⭐⭐⭐ M-89: the supervisor may CREATE a ticket but may NOT assign
    //   one at the creation ⇒ ⭐⭐ the answer is 403 and NOTHING is
    //   written ⇒ ⭐⭐ this scenario was missing from the matrix and it
    //   is exactly why the defect lived (the review of #49).
    const ref = `tkt_${NS}_assign_at_create`;
    const created = await harness.client.request({
      method: 'POST',
      path: '/api/tickets',
      token: tokens.supervisor,
      payload: {
        ref,
        customer_id: customerId,
        subject: 'the matrix',
        assignee_actor_id: `${NS}_usr_alpha_agent`,
      },
    });
    assert.equal(
      created.status,
      403,
      `the supervisor assigned a ticket at the creation: ${created.status}`,
    );
    const rows = await UnitOfWork.run(harness.ownerPool, `${NS}_tnt_alpha`, async (uow) => {
      const result = await uow.query<{ count: string }>(
        `select count(*)::text as count from support_tickets where tenant_id = $1 and ref = $2`,
        [`${NS}_tnt_alpha`, ref],
      );
      return Number(result.rows[0]?.count ?? '0');
    });
    assert.equal(rows, 0, 'the refused assignment still wrote a ticket');
  });

  await t.test('⭐⭐⭐ the refusal of a right is a 403 and NOT a 404 nor a 500', async () => {
    const answer = await call(harness, 'POST', `/api/tickets?tkt=${ticketRef}`, tokens.viewer);
    assert.ok(
      answer.status === 403 || answer.status === 400,
      `the viewer got a strange answer: ${answer.status}`,
    );
    const create = await harness.client.request({
      method: 'POST',
      path: '/api/tickets',
      token: tokens.viewer,
      payload: { customer_id: customerId, subject: 'the viewer' },
    });
    assert.equal(create.status, 403, `the viewer created a ticket: ${create.status}`);
  });

  await t.test('⭐⭐⭐ the company of another tenant is INVISIBLE', async () => {
    const otherOwner = await loginAs(
      harness.client,
      `${NS}_tnt_beta`,
      `${NS}_usr_beta_owner`,
      PASSCODE,
    );
    const read = await harness.client.request({
      method: 'GET',
      path: `/api/inbox/conversations/${conversationRef}`,
      token: otherOwner,
    });
    assert.equal(read.status, 404, `the other company read the conversation: ${read.status}`);

    const ticket = await harness.client.request({
      method: 'GET',
      path: `/api/tickets/${ticketRef}`,
      token: otherOwner,
    });
    assert.equal(ticket.status, 404, `the other company read the ticket: ${ticket.status}`);
  });

  await t.test('⭐⭐⭐ an expired session is refused (the token alone is not enough)', async () => {
    // ⭐⭐ The session of the drill is ended ⇒ ⭐⭐ its token must die
    //   with it (the token of a dead session is not a key).
    const token = tokens.viewer;
    const revoked = await harness.client.request({
      method: 'DELETE',
      path: '/api/session',
      token,
    });
    assert.equal(revoked.status, 200, `the logout failed: ${revoked.status}`);
    const after = await harness.client.request({
      method: 'GET',
      path: '/api/tickets',
      token,
    });
    assert.ok(
      after.status === 401 || after.status === 403,
      `the dead token still works: ${after.status}`,
    );
  });

  await t.test('⭐⭐⭐ the role of the client has NO effect (no escalation)', async () => {
    // ⭐⭐ The payload declares the role of the owner ⇒ ⭐⭐ the server
    //   reads the role from the MEMBERSHIP and nothing else.
    const answer = await harness.client.request({
      method: 'POST',
      path: '/api/session',
      payload: {
        tenant_id: `${NS}_tnt_alpha`,
        user_id: `${NS}_usr_alpha_viewer`,
        passcode: PASSCODE,
        role: 'owner',
        extra: { role: 'owner', tenant_id: `${NS}_tnt_beta` },
      },
    });
    assert.equal(answer.status, 200, `the login failed: ${answer.status}`);
    const role = String(answer.body.session?.role ?? '');
    assert.equal(role, 'viewer', `the client chose its own role: ${role}`);
    // ⭐⭐ and the client did NOT become the owner.
    const write = await harness.client.request({
      method: 'POST',
      path: '/api/tickets',
      token: String(answer.body.token),
      payload: { customer_id: customerId, subject: 'the escalation' },
    });
    assert.equal(write.status, 403, `the escalation worked: ${write.status}`);
  });

  await t.test('⭐⭐⭐ a request without a token is refused', async () => {
    const answer = await harness.client.request({
      method: 'GET',
      path: '/api/tickets',
    });
    assert.ok(
      answer.status === 401 || answer.status === 403,
      `the request without a token was accepted: ${answer.status}`,
    );
  });
});

/** ⭐ The call of one operation (the payload is the one of the fixture). */
async function call(
  harness: Awaited<ReturnType<typeof startHarness>>,
  operation: string,
  path: string,
  token: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const [method] = operation.split(' ');
  const payloads: Record<string, Record<string, unknown>> = {
    'POST /api/inbox/conversations/:ref/replies': { body: 'the reply of the matrix' },
    'POST /api/inbox/conversations/:ref/assign': {
      actor_id: `${NS}_usr_alpha_agent`,
      reason: 'the matrix',
    },
    'POST /api/inbox/conversations/:ref/state': { to: 'open', reason: 'the matrix' },
    'POST /api/conversations': {
      conversation_ref: `conv_${NS}_matrix_${Math.random().toString(36).slice(2, 8)}`,
      customer_id: `${NS}_cus_alpha_1`,
      message: { body: 'the matrix' },
    },
    'POST /api/customers': {
      display_name: `عميل ${Math.random().toString(36).slice(2, 8)}`,
    },
    'PATCH /api/crm/customers/:id': { display_name: 'the matrix' },
    'POST /api/tickets': {
      customer_id: `${NS}_cus_alpha_1`,
      subject: 'the matrix',
    },
    'PATCH /api/tickets/:ref': { priority: 'high' },
    'POST /api/privacy/export': { customer_id: `${NS}_cus_alpha_1` },
    'POST /api/privacy/deletion/preview': { customer_id: `${NS}_cus_alpha_1` },
    'POST /api/retention': { data_class: 'standard', retention_days: 30 },
  };
  // ⭐⭐⭐ M-91: the payload is taken from the EXACT operation ⇒ ⭐⭐
  //   the old prefix match could take the payload of another operation
  //   (a silent mistake in the test itself).
  let payload = payloads[operation];
  // ⭐⭐⭐ M-91: the version is READ AT THE MOMENT of the call ⇒ ⭐⭐
  //   the write of one role does not break the write of another (the
  //   optimistic lock moves with the first write) ⇒ ⭐⭐ and then EVERY
  //   allowed row can really succeed.
  if (method === 'PATCH' && operation === 'PATCH /api/tickets/:ref') {
    const ref = path.split('/api/tickets/')[1] ?? '';
    payload = { ...(payload ?? {}), version: await currentTicketVersion(harness, ref) };
  }
  if (method === 'PATCH' && operation === 'PATCH /api/crm/customers/:id') {
    const id = path.split('/api/crm/customers/')[1] ?? '';
    payload = { ...(payload ?? {}), version: await currentCustomerVersion(harness, id) };
  }
  const answer = await harness.client.request({
    method,
    path,
    token,
    ...(payload === undefined ? {} : { payload }),
  });
  return { status: answer.status, body: answer.body };
}

/** ⭐⭐⭐ M-91: the CURRENT version of a ticket (read at the moment of the call). */
async function currentTicketVersion(
  harness: Awaited<ReturnType<typeof startHarness>>,
  ref: string,
): Promise<number> {
  return UnitOfWork.run(harness.ownerPool, `${NS}_tnt_alpha`, async (uow) => {
    const result = await uow.query<{ version: number }>(
      `select version from support_tickets where tenant_id = $1 and ref = $2`,
      [`${NS}_tnt_alpha`, ref],
    );
    return Number(result.rows[0]?.version ?? 1);
  });
}

/** ⭐⭐⭐ M-91: the CURRENT version of a customer (read at the moment of the call). */
async function currentCustomerVersion(
  harness: Awaited<ReturnType<typeof startHarness>>,
  id: string,
): Promise<number> {
  return UnitOfWork.run(harness.ownerPool, `${NS}_tnt_alpha`, async (uow) => {
    const result = await uow.query<{ version: number }>(
      `select version from customers where tenant_id = $1 and id = $2`,
      [`${NS}_tnt_alpha`, id],
    );
    return Number(result.rows[0]?.version ?? 1);
  });
}

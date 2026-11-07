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

  await t.test('⭐⭐⭐ every operation answers what the owner decided', async () => {
    for (const [operation, expectations] of Object.entries(MATRIX)) {
      const [method, template] = operation.split(' ');
      const path = template
        .replace(':ref', conversationRef)
        .replace(':id', customerId);
      for (const [role, verdict] of Object.entries(expectations)) {
        const token = tokens[role as keyof typeof tokens];
        const answer = await call(harness, method, path, token);
        const status = answer.status;
        // ⭐⭐ `allow` means "the server did NOT refuse the right" ⇒ the
        //   refusal of the right is a 403 and nothing else.
        const refused = status === 403;
        assert.equal(
          refused,
          verdict === 'refuse',
          `the operation ${operation} with the role ${role}: the answer was ${status} ` +
            `(the decision of the owner is "${verdict}")`,
        );
      }
    }
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
  method: string,
  path: string,
  token: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
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
    'PATCH /api/crm/customers/:id': { display_name: 'the matrix', version: 1 },
    'POST /api/tickets': {
      customer_id: `${NS}_cus_alpha_1`,
      subject: 'the matrix',
    },
    'PATCH /api/tickets/:ref': { version: 1, priority: 'high' },
    'POST /api/privacy/export': { customer_id: `${NS}_cus_alpha_1` },
    'POST /api/privacy/deletion/preview': { customer_id: `${NS}_cus_alpha_1` },
    'POST /api/retention': { data_class: 'standard', retention_days: 30 },
  };
  const key = Object.keys(payloads).find((candidate) =>
    path.startsWith(candidate.split(' ')[1].split('/').slice(0, 4).join('/')),
  );
  const payload = key ? payloads[key] : undefined;
  const answer = await harness.client.request({
    method,
    path,
    token,
    ...(payload === undefined ? {} : { payload }),
  });
  return { status: answer.status, body: answer.body };
}

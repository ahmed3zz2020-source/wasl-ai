// ============================================================
// WASL AI — D-074 / M-104 — the final matrix of the rights of a ticket
// ------------------------------------------------------------
// ⭐⭐⭐ WHAT THIS FILE IS: THE MATRIX, AS CODE.
//   ⭐⭐⭐ The matrix below is the ANSWER that the owner reads, and it
//   ⭐⭐⭐ is CHECKED against the real API ⇒ ⇒ ⇒ so the document can
//   ⭐⭐⭐ never drift away from the behaviour.
// ⭐⭐⭐ THE MATRIX (one line per role and per operation):
//   ⭐⭐⭐   list   read   create   update   assign
//   ⭐⭐⭐   owner    ✓      ✓       ✓        ✓       ✓
//   ⭐⭐⭐   supervisor ✓      ✓       ✓        ✓       ✗
//   ⭐⭐⭐   agent    ✓      ✓       ✗        ✗       ✗
//   ⭐⭐⭐   viewer  ✓      ✓       ✗        ✗       ✗
// ⭐⭐⭐ AND THE LINKAGE (the customer of the ticket and the customer
//   ⭐⭐⭐ of the conversation must be the SAME).
// ⭐⭐⭐ ⛔ IT DOES NOT RATIFY THE BRIDGE: the bridge of D-073 (the
//   ⭐⭐⭐ ⛔ mapping of the operations of a ticket onto the operations
//   ⭐⭐⭐ ⛔ of the core) is still a DECISION OF THE OWNER ⇒ ⇒ ⇒ this
//   ⭐⭐⭐ ⛔ file measures it, it does not approve it.
// ⛔ Local synthetic database only.
// ============================================================

import assert from 'node:assert/strict';
import test from 'node:test';

import { UnitOfWork } from '../../server/db/unit-of-work.ts';
import { loginAs, resetSyntheticData, startHarness } from './harness.ts';

const NS = 'rgt';
const PASSCODE = process.env['WASL_TEST_PASSCODE'] ?? 'wasl-local-test';

type Role = 'owner' | 'supervisor' | 'agent' | 'viewer';
type Outcome = 'allow' | 'refuse';

/**
 * ⭐⭐⭐ THE MATRIX — the single source of the truth of the answer.
 * ⭐⭐⭐ ⛔ It is written by hand ⇒ ⇒ ⇒ and it is NOT read from the
 * ⭐⭐⭐ ⛔ core ⇒ ⇒ ⇒ ⇒ otherwise the test would prove nothing.
 * ⭐⭐⭐
 * ⭐⭐⭐ ⭐ THE SCOPE IS PART OF THE MATRIX ⇐ and this is NOT a detail:
 * ⭐⭐⭐ ⭐ the AGENT sees the tickets that are ASSIGNED to him ⇒ ⇒ ⇒
 * ⭐⭐⭐ ⭐ ⇒ ⇒ ⇒ a ticket of the company that is not his ⇒ ⇒ ⇒ ⇒ is
 * ⭐⭐⭐ ⭐ ⇒ ⇒ ⇒ OUT OF HIS SCOPE ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ (the answer is 404,
 * ⭐⭐⭐ ⭐ ⇒ ⇒ ⇒ ⇒ and not 403 ⇒ ⇒ ⇒ ⇒ ⇒ because the ticket does not
 * ⭐⭐⭐ ⭐ ⇒ ⇒ ⇒ ⇒ exist IN HIS SCOPE ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ and not
 * ⭐⭐⭐ ⭐ ⇒ ⇒ ⇒ ⇒ because he is forbidden).
 * ⭐⭐⭐ ⭐ ⇒ ⇒ ⇒ the reader of the ticket knows TWO things: what he
 * ⭐⭐⭐ ⭐ ⇒ ⇒ ⇒ ⇒ may do (the capability) ⇒ ⇒ ⇒ ⇒ and what he may
 * ⭐⭐⭐ ⭐ ⇒ ⇒ ⇒ ⇒ SEE (the scope) ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ they are not
 * ⭐⭐⭐ ⭐ ⇒ ⇒ ⇒ ⇒ the same thing.
 */
const MATRIX: Readonly<Record<Role, Readonly<Record<string, Outcome>>>> = Object.freeze({
  owner: Object.freeze({
    list: 'allow',
    read_in_scope: 'allow',
    read_out_of_scope: 'allow',
    read_assigned: 'allow',
    create: 'allow',
    update: 'allow',
    assign: 'allow',
  }),
  supervisor: Object.freeze({
    list: 'allow',
    read_in_scope: 'allow',
    read_out_of_scope: 'allow',
    read_assigned: 'allow',
    create: 'allow',
    update: 'allow',
    assign: 'refuse',
  }),
  agent: Object.freeze({
    list: 'allow',
    read_in_scope: 'allow',
    read_out_of_scope: 'refuse',
    read_assigned: 'allow',
    create: 'refuse',
    update: 'refuse',
    assign: 'refuse',
  }),
  viewer: Object.freeze({
    list: 'allow',
    read_in_scope: 'allow',
    read_out_of_scope: 'allow',
    read_assigned: 'allow',
    create: 'refuse',
    update: 'refuse',
    assign: 'refuse',
  }),
});

async function countTickets(
  harness: Awaited<ReturnType<typeof startHarness>>,
  ref: string,
): Promise<number> {
  return UnitOfWork.run(harness.ownerPool, `${NS}_tnt_alpha`, async (uow) => {
    const result = await uow.query<{ count: string }>(
      `select count(*)::text as count from support_tickets where tenant_id = $1 and ref = $2`,
      [`${NS}_tnt_alpha`, ref],
    );
    return Number(result.rows[0]?.count ?? '0');
  });
}

test('FOUNDATION 04) the matrix of the rights of a ticket (M-104)', async (t) => {
  const harness = await startHarness({ namespace: NS });
  t.after(async () => {
    await harness.stop();
  });
  await resetSyntheticData(
    harness.ownerPool,
    PASSCODE,
    ['tnt_alpha', 'tnt_beta', 'tnt_gamma'],
    NS,
  );

  const tokens: Record<Role, string> = {
    owner: await loginAs(harness.client, `${NS}_tnt_alpha`, `${NS}_usr_alpha_owner`, PASSCODE),
    supervisor: await loginAs(
      harness.client,
      `${NS}_tnt_alpha`,
      `${NS}_usr_alpha_super`,
      PASSCODE,
    ),
    agent: await loginAs(harness.client, `${NS}_tnt_alpha`, `${NS}_usr_alpha_agent`, PASSCODE),
    viewer: await loginAs(harness.client, `${NS}_tnt_alpha`, `${NS}_usr_alpha_viewer`, PASSCODE),
  };

  // ⭐⭐⭐ A ticket of the owner ⇒ ⇒ ⇒ it is the fixture of the reads.
  const fixtureRef = `tkt_${NS}_matrix`;
  const created = await harness.client.request({
    method: 'POST',
    path: '/api/tickets',
    token: tokens.owner,
    payload: {
      ref: fixtureRef,
      customer_id: `${NS}_cus_alpha_1`,
      subject: 'the fixture of the matrix',
    },
  });
  assert.equal(created.status, 201, `the owner did not create the fixture: ${created.status}`);

  // ⭐⭐⭐ A ticket ASSIGNED to the agent ⇒ ⇒ ⇒ it is the fixture of the
  // ⭐⭐⭐ ⇐ scope ⇐ ⇒ ⇒ ⇒ (the agent sees it ⇒ ⇒ ⇒ and nobody else
  // ⭐⭐⭐ ⇐ loses anything ⇒ ⇒ ⇒ because the scope of the agent is
  // ⭐⭐⭐ ⇐ his own tickets ⇒ ⇒ ⇒ ⇒ and the others see the company).
  const assignedRef = `tkt_${NS}_assigned`;
  const assigned = await harness.client.request({
    method: 'POST',
    path: '/api/tickets',
    token: tokens.owner,
    payload: {
      ref: assignedRef,
      customer_id: `${NS}_cus_alpha_1`,
      subject: 'the fixture of the scope',
      assignee_actor_id: `${NS}_usr_alpha_agent`,
    },
  });
  assert.equal(assigned.status, 201, `the owner did not assign the fixture: ${assigned.status}`);

  await t.test('⭐⭐⭐ M-104a: the LIST and the READ follow the matrix', async () => {
    for (const role of Object.keys(MATRIX) as Role[]) {
      const list = await harness.client.request({
        method: 'GET',
        path: '/api/tickets',
        token: tokens[role],
      });
      assert.equal(
        list.status === 200,
        MATRIX[role].list === 'allow',
        `the list of the ${role} does not follow the matrix (${list.status})`,
      );
      // ⭐⭐⭐ THE SCOPE: a ticket that is NOT assigned to the agent.
      const readOut = await harness.client.request({
        method: 'GET',
        path: `/api/tickets/${fixtureRef}`,
        token: tokens[role],
      });
      assert.equal(
        readOut.status === 200,
        MATRIX[role].read_out_of_scope === 'allow',
        `the read out of the scope by the ${role} does not follow the matrix (${readOut.status})`,
      );
      // ⭐⭐⭐ THE SCOPE: a ticket that IS assigned to the agent.
      const readAssigned = await harness.client.request({
        method: 'GET',
        path: `/api/tickets/${assignedRef}`,
        token: tokens[role],
      });
      assert.equal(
        readAssigned.status === 200,
        MATRIX[role].read_assigned === 'allow',
        `the read of the assigned ticket by the ${role} does not follow the matrix (${readAssigned.status})`,
      );
    }
  });

  await t.test('⭐⭐⭐ M-104b: the CREATE follows the matrix AND writes nothing when refused', async () => {
    for (const role of Object.keys(MATRIX) as Role[]) {
      const ref = `tkt_${NS}_create_${role}`;
      const answer = await harness.client.request({
        method: 'POST',
        path: '/api/tickets',
        token: tokens[role],
        payload: {
          ref,
          customer_id: `${NS}_cus_alpha_1`,
          subject: `the create of the ${role}`,
        },
      });
      assert.equal(
        answer.status === 201,
        MATRIX[role].create === 'allow',
        `the create of the ${role} does not follow the matrix (${answer.status})`,
      );
      if (MATRIX[role].create === 'refuse') {
        assert.equal(
          await countTickets(harness, ref),
          0,
          `the refused create of the ${role} wrote a ticket`,
        );
      }
    }
  });

  await t.test('⭐⭐⭐ M-104c: the UPDATE follows the matrix', async () => {
    for (const role of Object.keys(MATRIX) as Role[]) {
      const ref = `tkt_${NS}_update_${role}`;
      const createdByOwner = await harness.client.request({
        method: 'POST',
        path: '/api/tickets',
        token: tokens.owner,
        payload: {
          ref,
          customer_id: `${NS}_cus_alpha_1`,
          subject: 'the update of the matrix',
        },
      });
      assert.equal(createdByOwner.status, 201, 'the owner did not create the fixture');
      // ⭐⭐⭐ THE VERSION: the write is optimistic ⇒ ⇒ ⇒ it lands only
      // ⭐⭐⭐ ⇒ when the version is the current one ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ so
      // ⭐⭐⭐ ⇒ the version is read by the owner ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ and
      // ⭐⭐⭐ ⇒ every role writes against the same version ⇒ ⇒ ⇒ ⇒ ⇒
      // ⭐⭐⭐ ⇒ ⇒ ⇒ (the answer of a refusal is 403 ⇒ ⇒ ⇒ ⇒ and not
      // ⭐⭐⭐ ⇒ ⇒ ⇒ a conflict ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ and the version is
      // ⭐⭐⭐ ⇒ ⇒ ⇒ the same for all of them).
      const current = await harness.client.request({
        method: 'GET',
        path: `/api/tickets/${ref}`,
        token: tokens.owner,
      });
      const version = Number(
        (current.body['ticket'] as Record<string, unknown> | undefined)?.['version'],
      );
      assert.ok(Number.isInteger(version) && version >= 1, 'the version of the ticket is unknown');
      const answer = await harness.client.request({
        method: 'PATCH',
        path: `/api/tickets/${ref}`,
        token: tokens[role],
        payload: { version, subject: `the update of the ${role}` },
      });
      assert.equal(
        answer.status === 200,
        MATRIX[role].update === 'allow',
        `the update of the ${role} does not follow the matrix (${answer.status})`,
      );
    }
  });

  await t.test('⭐⭐⭐ M-104d: the ASSIGNMENT follows the matrix (the owner alone)', async () => {
    for (const role of Object.keys(MATRIX) as Role[]) {
      const ref = `tkt_${NS}_assign_${role}`;
      const answer = await harness.client.request({
        method: 'POST',
        path: '/api/tickets',
        token: tokens[role],
        payload: {
          ref,
          customer_id: `${NS}_cus_alpha_1`,
          subject: 'the assignment of the matrix',
          assignee_actor_id: `${NS}_usr_alpha_agent`,
        },
      });
      assert.equal(
        answer.status === 201,
        MATRIX[role].assign === 'allow',
        `the assignment of the ${role} does not follow the matrix (${answer.status})`,
      );
      if (MATRIX[role].assign === 'refuse') {
        assert.equal(
          await countTickets(harness, ref),
          0,
          `the refused assignment of the ${role} wrote a ticket`,
        );
      }
    }
  });

  await t.test('⭐⭐⭐ M-104e: the LINKAGE (the customer of the conversation)', async () => {
    // ⭐⭐ A ticket of the customer of ANOTHER conversation ⇒ ⇒ ⇒ the
    // ⭐⭐ server refuses it ⇒ ⇒ ⇒ and NOTHING is written.
    const conversations = await UnitOfWork.run(
      harness.ownerPool,
      `${NS}_tnt_alpha`,
      async (uow) => {
        const result = await uow.query<{ ref: string; customer_id: string }>(
          `select ref, customer_id from conversations where tenant_id = $1 limit 5`,
          [`${NS}_tnt_alpha`],
        );
        return result.rows;
      },
    );
    const other = conversations.find((row) => row.customer_id !== `${NS}_cus_alpha_1`);
    if (!other) {
      // ⭐⭐ the fixture of the company has one customer ⇒ ⇒ ⇒ we make
      // ⭐⭐ a second one ⇒ ⇒ ⇒ so the linkage really has two sides.
      await UnitOfWork.run(harness.ownerPool, `${NS}_tnt_alpha`, async (uow) => {
        await uow.query(
          `insert into customers (id, tenant_id, display_name, data_class)
           values ($1, $2, 'the second customer of the linkage', 'standard')
           on conflict (id) do update set display_name = excluded.display_name`,
          [`${NS}_cus_alpha_2`, `${NS}_tnt_alpha`],
        );
      });
    }
    const ref = `tkt_${NS}_linkage`;
    const answer = await harness.client.request({
      method: 'POST',
      path: '/api/tickets',
      token: tokens.owner,
      payload: {
        ref,
        customer_id: `${NS}_cus_alpha_2`,
        subject: 'the linkage of the matrix',
        conversation_ref: conversations[0]?.ref ?? '',
      },
    });
    assert.equal(
      answer.status,
      409,
      `the mismatched linkage was accepted (${answer.status} ${JSON.stringify(answer.body)})`,
    );
    assert.equal(
      await countTickets(harness, ref),
      0,
      'the refused linkage wrote a ticket',
    );
  });
});

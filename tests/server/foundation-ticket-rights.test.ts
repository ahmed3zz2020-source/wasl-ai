// ============================================================
// WASL AI - D-076 / M-106 - the final matrix of the rights of a ticket
// ------------------------------------------------------------
// WHAT THIS FILE IS: THE MATRIX, AS CODE.
//   The matrix below is the ANSWER that the owner reads, and it is
//   CHECKED against the real API => the document can never drift away
//   from the behaviour.
// M-106 (the review of the reply #52): the matrix must carry the EXACT
//   expected status of every row, not only "allow / refuse" => because
//   a "refuse" that is really a 500 (a server failure) is NOT a
//   refusal, and the old shape of the test accepted it.
//   => the expected status is now a NUMBER: 200 / 201 / 403 / 404 / 409
//   => a 5xx is ALWAYS an explicit failure of the test
//   => EVERY row of the matrix is exercised (the row `read_in_scope` was
//      declared and never tested)
//   => and there is a NEGATIVE PROOF: an injected 500 must break the
//      guard, so the guard is known to be able to fail.
// THE MATRIX (one line per role and per operation):
//   list   read   create   update   assign
//   owner    200      200       201        200       201
//   supervisor 200   200       201        200       403
//   agent    200      200       403        403       403
//   viewer  200      200       403        403       403
// AND THE LINKAGE (the customer of the ticket and the customer of the
//   conversation must be the SAME) => 409.
// IT DOES NOT RATIFY THE BRIDGE: the bridge of D-073 (the mapping of the
//   operations of a ticket onto the operations of the core) is still a
//   DECISION OF THE OWNER => this file measures it, it does not approve
//   it.
// Local synthetic database only.
// ============================================================

import assert from 'node:assert/strict';
import test from 'node:test';

import { UnitOfWork } from '../../server/db/unit-of-work.ts';
import {
  TICKET_OPERATIONS,
  TICKET_RIGHTS_MATRIX,
  type TicketOperation,
  type TicketRole,
  type TicketStatus,
} from './foundation-ticket-rights.matrix.ts';
import { loginAs, resetSyntheticData, startHarness } from './harness.ts';

const NS = 'rgt';
const PASSCODE = process.env['WASL_TEST_PASSCODE'] ?? 'wasl-local-test';

type Role = TicketRole;
type Status = TicketStatus;
type Operation = TicketOperation;

const OPERATIONS: readonly Operation[] = TICKET_OPERATIONS;

/**
 * THE MATRIX - the single source of the truth of the answer.
 * IT LIVES IN ITS OWN FILE (M-110) => the table of the reply and the
 * measurement of the API read the SAME numbers => a cell of the
 * document can never drift away from the behaviour.
 */
const MATRIX = TICKET_RIGHTS_MATRIX;

/**
 * THE CHECKER (M-106): the expected status is a NUMBER and a server
 * failure NEVER satisfies a refusal.
 */
export function checkStatus(actual: number, expected: number, label: string): void {
  if (actual >= 500) {
    throw new Error(
      `${label}: the server failed (${actual}) => a server error NEVER satisfies a refusal`,
    );
  }
  if (actual !== expected) {
    throw new Error(`${label}: the expected status is ${expected} and the answer was ${actual}`);
  }
}

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

test('FOUNDATION 04) the matrix of the rights of a ticket (M-104 / M-106)', async (t) => {
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

  // A ticket of the owner => it is the fixture of the reads.
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

  // A ticket ASSIGNED to the agent => it is the fixture of the scope.
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

  // M-106: every row of the matrix must be exercised, and the proof of
  // it is at the end of this file.
  const exercised = new Set<string>();
  const mark = (role: Role, operation: Operation): void => {
    exercised.add(`${role}:${operation}`);
  };

  await t.test('M-106a: the LIST and the READ follow the matrix with the EXACT status', async () => {
    for (const role of Object.keys(MATRIX) as Role[]) {
      const list = await harness.client.request({
        method: 'GET',
        path: '/api/tickets',
        token: tokens[role],
      });
      checkStatus(list.status, MATRIX[role].list, `the list of the ${role}`);
      mark(role, 'list');

      // THE SCOPE: the ticket that is INSIDE the scope of the reader
      // (it is assigned to the agent, and it belongs to the company of
      // the other roles) => it must be readable by everybody.
      const readIn = await harness.client.request({
        method: 'GET',
        path: `/api/tickets/${assignedRef}`,
        token: tokens[role],
      });
      checkStatus(readIn.status, MATRIX[role].read_in_scope, `the read in the scope by the ${role}`);
      mark(role, 'read_in_scope');

      // THE SCOPE: the ticket that is NOT assigned to the agent => the
      // agent does not see it (404) and the company sees it (200).
      const readOut = await harness.client.request({
        method: 'GET',
        path: `/api/tickets/${fixtureRef}`,
        token: tokens[role],
      });
      checkStatus(
        readOut.status,
        MATRIX[role].read_out_of_scope,
        `the read out of the scope by the ${role}`,
      );
      mark(role, 'read_out_of_scope');

      // THE ASSIGNMENT IS VISIBLE: the list of the tickets that are
      // assigned to the agent must return the assigned ticket.
      const readAssigned = await harness.client.request({
        method: 'GET',
        path: `/api/tickets?assignee=${NS}_usr_alpha_agent`,
        token: tokens[role],
      });
      checkStatus(
        readAssigned.status,
        MATRIX[role].read_assigned,
        `the read of the assigned tickets by the ${role}`,
      );
      const rows = (readAssigned.body['tickets'] as Array<Record<string, unknown>> | undefined) ?? [];
      assert.ok(
        rows.some((row) => row['ref'] === assignedRef),
        `the assigned ticket is not in the list of the ${role}`,
      );
      mark(role, 'read_assigned');
    }
  });

  await t.test('M-106b: the CREATE follows the matrix AND writes nothing when refused', async () => {
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
      checkStatus(answer.status, MATRIX[role].create, `the create of the ${role}`);
      mark(role, 'create');
      if (MATRIX[role].create === 403) {
        assert.equal(
          await countTickets(harness, ref),
          0,
          `the refused create of the ${role} wrote a ticket`,
        );
      }
    }
  });

  await t.test('M-106c: the UPDATE follows the matrix', async () => {
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
      // THE VERSION: the write is optimistic => it lands only when the
      // version is the current one => the version is read by the owner
      // and every role writes against the same version => the answer of
      // a refusal is 403 and not a conflict.
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
      checkStatus(answer.status, MATRIX[role].update, `the update of the ${role}`);
      mark(role, 'update');
    }
  });

  await t.test('M-106d: the ASSIGNMENT follows the matrix (the owner alone)', async () => {
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
      checkStatus(answer.status, MATRIX[role].assign, `the assignment of the ${role}`);
      mark(role, 'assign');
      if (MATRIX[role].assign === 403) {
        assert.equal(
          await countTickets(harness, ref),
          0,
          `the refused assignment of the ${role} wrote a ticket`,
        );
      }
    }
  });

  await t.test('M-106e: the LINKAGE (the customer of the conversation)', async () => {
    // A ticket of the customer of ANOTHER conversation => the server
    // refuses it (409) and NOTHING is written.
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
      // the fixture of the company has one customer => we make a second
      // one => so the linkage really has two sides.
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
    checkStatus(answer.status, 409, 'the mismatched linkage');
    assert.equal(
      await countTickets(harness, ref),
      0,
      'the refused linkage wrote a ticket',
    );
  });

  await t.test('M-106f: EVERY row of the matrix was exercised', async () => {
    const missing: string[] = [];
    for (const role of Object.keys(MATRIX) as Role[]) {
      for (const operation of OPERATIONS) {
        if (!exercised.has(`${role}:${operation}`)) missing.push(`${role}:${operation}`);
      }
    }
    assert.deepEqual(missing, [], `the rows of the matrix that were never tested: ${missing.join(', ')}`);
  });

  await t.test('M-106g: the NEGATIVE PROOF (an injected 500 breaks the guard)', async () => {
    // A server failure must NEVER satisfy a refusal => the guard must
    // throw when the answer is a 5xx.
    assert.throws(
      () => checkStatus(500, 403, 'the injected failure'),
      /server error NEVER satisfies a refusal/,
      'a 500 satisfied a refusal: the guard is blind',
    );
    assert.throws(
      () => checkStatus(503, 404, 'the injected failure'),
      /server error NEVER satisfies a refusal/,
      'a 503 satisfied a refusal: the guard is blind',
    );
    // and a wrong status that is NOT a server failure must throw too.
    assert.throws(
      () => checkStatus(200, 403, 'the wrong success'),
      /the expected status is 403/,
      'a 200 satisfied a refusal',
    );
    // and the exact status must pass.
    assert.doesNotThrow(() => checkStatus(403, 403, 'the exact refusal'));
    assert.doesNotThrow(() => checkStatus(201, 201, 'the exact success'));
  });
});

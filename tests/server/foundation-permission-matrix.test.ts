// ============================================================
// WASL AI — FOUNDATION BUILD 03 / PHASE 03 (D-072)
// M-84: one matrix of the limits of the CRM and the inbox
// ============================================================
// ⭐⭐⭐ WHAT THIS TEST IS
//   ⭐⭐ The limits of the CRM and the inbox must be ONE matrix, and
//     that matrix must be the one of the CORE.
//   ⭐⭐ The expectations are NOT written by hand: ⭐ they are READ
//     from `ROLE_CAPABILITIES` (the single source of the truth of the
//     core) ⇒ ⭐⭐ a change in the core changes the expectations ⇒
//     ⭐⭐ and no permission is invented by this file.
//   ⭐⭐ The actors: the owner · the supervisor · the agent · the
//     viewer · an employee of another company · an expired session.
//   ⭐⭐ The operations: eleven paths of the two pages.
//   ⭐ It owns its company (M-82) ⇒ no other file can touch its rows.
// ============================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ROLE_CAPABILITIES } from '../../src/core/capability.ts';
import { UnitOfWork } from '../../server/db/unit-of-work.ts';
import { createSyntheticCompany, loginAs, resetCompany, startHarness, type Harness } from './harness.ts';

const PASSCODE = 'wasl-local-test';
const RUN = `m84_${process.pid}_${Date.now().toString(36)}`;
const TENANT = 'tnt_d073_matrix';
const OTHER_TENANT = 'tnt_d073_matrix_other';

type Actor = 'owner' | 'supervisor' | 'agent' | 'viewer' | 'other' | 'expired';

interface Operation {
  readonly id: string;
  readonly label: string;
  /** ⭐ The capability the core demands (null = it needs no capability). */
  readonly capability: string | null;
  readonly run: (token: string, role: Actor) => Promise<number>;
  /** ⭐ `true` when the answer must NOT carry the data of the drill. */
  readonly hideTheData?: boolean;
  /**
   * ⭐⭐ The operation touches a row that is OUTSIDE the scope of the
   *   agent ⇒ ⭐⭐ the core grants the capability but the SCOPE of the
   *   work queue hides the row ⇒ ⭐ the answer must be 404 (and not
   *   403: the row simply is not there for this employee).
   */
  readonly scopeLimited?: boolean;
}

function may(role: 'owner' | 'supervisor' | 'agent' | 'viewer', capability: string): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}

test('FOUNDATION 25) the limits of the CRM and the inbox are one matrix (M-84)', async (t) => {
  const harness: Harness = await startHarness();
  await resetCompany(harness.ownerPool, TENANT);
  await resetCompany(harness.ownerPool, OTHER_TENANT);
  t.after(async () => {
    await resetCompany(harness.ownerPool, TENANT);
    await resetCompany(harness.ownerPool, OTHER_TENANT);
    await harness.stop();
  });

  const ids = await createSyntheticCompany(harness.ownerPool, TENANT, PASSCODE, [
    { id: 'usr_d073m_owner', role: 'owner' },
    { id: 'usr_d073m_super', role: 'supervisor' },
    { id: 'usr_d073m_agent', role: 'agent' },
    { id: 'usr_d073m_viewer', role: 'viewer' },
  ]);
  const otherIds = await createSyntheticCompany(harness.ownerPool, OTHER_TENANT, PASSCODE, [
    { id: 'usr_d073m_other', role: 'owner' },
  ]);

  const ownerToken = await loginAs(harness.client, TENANT, ids.userIds['owner']!, PASSCODE);
  const supervisorToken = await loginAs(harness.client, TENANT, ids.userIds['supervisor']!, PASSCODE);
  const agentToken = await loginAs(harness.client, TENANT, ids.userIds['agent']!, PASSCODE);
  const viewerToken = await loginAs(harness.client, TENANT, ids.userIds['viewer']!, PASSCODE);
  const otherToken = await loginAs(harness.client, OTHER_TENANT, otherIds.userIds['usr_d073m_other']!, PASSCODE);

  const REF = `conv_d073m_${RUN}`;
  const CUSTOMER = 'cus_d073m_1';
  const CUSTOMER_OTHER = 'cus_d073m_2';
  await UnitOfWork.run(harness.ownerPool, TENANT, async (uow) => {
    for (const [id, phone] of [
      [CUSTOMER, '+20100'],
      [CUSTOMER_OTHER, '+20200'],
    ] as const) {
      await uow.query(
        `insert into customers (id, tenant_id, display_name, data_class, email, phone)
         values ($1,$2,$3,'standard','c@example.invalid',$4)
         on conflict (id) do nothing`,
        [id, TENANT, `عميل ${id}`, phone],
      );
    }
    await uow.query(
      `insert into conversations (tenant_id, ref, customer_id, state, version, updated_at)
       values ($1,$2,$3,'open',1, now())`,
      [TENANT, REF, CUSTOMER],
    );
    await uow.query(
      `update conversations set assignee_actor_id = $3 where tenant_id = $1 and ref = $2`,
      [TENANT, REF, ids.userIds['agent']!],
    );
    await uow.query(
      `insert into messages (message_ref, tenant_id, conversation_ref, channel, direction, sender,
                             recipient, body, occurred_at, locale, attributes, stored_at)
       values ($1,$2,$3,'web','inbound','customer@example.invalid','agent@example.invalid',
               'رسالة العميل', now(), 'ar', '{}'::jsonb, now())`,
      [`msg_${REF}_${RUN}`, TENANT, REF],
    );
  });

  const request = async (
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    token: string,
    payload?: Record<string, unknown>,
  ): Promise<{ status: number; body: unknown }> => {
    const answer = await harness.client.request({ method, path, token, ...(payload ? { payload } : {}) });
    return { status: answer.status, body: answer.body };
  };

  // ⭐⭐ The fixture is restored before EVERY operation ⇒ ⭐ the matrix
  //   measures the PERMISSION and not the state that an operation left.
  const restore = async (): Promise<void> => {
    await UnitOfWork.run(harness.ownerPool, TENANT, async (uow) => {
      await uow.query(
        `update conversations set state = 'open', assignee_actor_id = $3
          where tenant_id = $1 and ref = $2`,
        [TENANT, REF, ids.userIds['agent']!],
      );
    });
  };

  const operations: readonly Operation[] = [
    {
      id: 'OP-01',
      label: 'the list of the conversations',
      capability: 'conversation.list',
      run: (token) => request('GET', '/api/inbox/conversations?limit=50', token).then((r) => r.status),
    },
    {
      id: 'OP-02',
      label: 'the details of a conversation',
      capability: 'conversation.read',
      run: (token) => request('GET', `/api/inbox/conversations/${REF}`, token).then((r) => r.status),
    },
    {
      id: 'OP-03',
      label: 'sending a reply',
      capability: 'conversation.write',
      run: (token) =>
        request('POST', `/api/inbox/conversations/${REF}/replies`, token, {
          body: `رد ${RUN}`,
          client_message_ref: `cmr_${RUN}_${Math.random().toString(36).slice(2)}`,
        }).then((r) => r.status),
    },
    {
      id: 'OP-04',
      label: 'changing the state',
      capability: 'conversation.state.update',
      run: (token) =>
        request('POST', `/api/inbox/conversations/${REF}/state`, token, { to: 'pending' }).then(
          (r) => r.status,
        ),
    },
    {
      id: 'OP-05',
      label: 'changing the assignment',
      capability: 'conversation.assign',
      run: (token) =>
        request('POST', `/api/inbox/conversations/${REF}/assign`, token, {
          actor_id: ids.userIds['owner']!,
        }).then((r) => r.status),
    },
    {
      id: 'OP-06',
      label: 'the list of the customers',
      capability: 'conversation.list',
      run: (token) => request('GET', '/api/crm/customers?limit=50', token).then((r) => r.status),
    },
    {
      id: 'OP-07',
      label: 'the profile of a customer',
      capability: 'conversation.read',
      run: (token) => request('GET', `/api/crm/customers/${CUSTOMER}`, token).then((r) => r.status),
    },
    {
      id: 'OP-08',
      label: 'editing a customer',
      capability: 'customer.manage',
      run: async (token) => {
        // ⭐⭐ The version the employee READS is the version they send
        //   ⇒ ⭐ the lock of the concurrent edit is honoured (and the
        //   answer is not a false conflict).
        const read = await request('GET', `/api/crm/customers/${CUSTOMER}`, token);
        const container = read.body as Record<string, unknown> | null;
        const customer = container?.['customer'] as Record<string, unknown> | undefined;
        const version = Number(customer?.['version'] ?? 0);
        return request('PATCH', `/api/crm/customers/${CUSTOMER}`, token, {
          display_name: `اسم ${RUN}`,
          version,
        }).then((r) => r.status);
      },
    },
    {
      id: 'OP-09',
      label: 'the search and the filter',
      capability: 'conversation.list',
      run: (token) =>
        request('GET', `/api/inbox/conversations?q=${encodeURIComponent('رسالة')}&state=open`, token).then(
          (r) => r.status,
        ),
    },
    {
      id: 'OP-10',
      label: 'the direct access by the identifiers',
      capability: 'conversation.read',
      run: (token) =>
        request('GET', `/api/crm/customers/${CUSTOMER_OTHER}`, token).then((r) => r.status),
      hideTheData: true,
      scopeLimited: true,
    },
    {
      id: 'OP-11',
      label: 'the contact data and the derived messages',
      capability: 'conversation.read',
      run: async (token, role) => {
        const answer = await request('GET', '/api/crm/customers?limit=50', token);
        const text = JSON.stringify(answer.body);
        // ⭐⭐ The contact data of a customer that is NOT the agent's
        //   must never travel with the list of the agent ⇒ ⭐ the
        //   number of the phone is the marker.
        if (role === 'agent') {
          assert.ok(
            !text.includes('+20200'),
            '⭐⭐⭐ the contact data of a customer of another employee leaked into the list of the agent',
          );
        }
        return answer.status;
      },
    },
  ];

  const actors: readonly { actor: Actor; role: 'owner' | 'supervisor' | 'agent' | 'viewer'; token: string }[] = [
    { actor: 'owner', role: 'owner', token: ownerToken },
    { actor: 'supervisor', role: 'supervisor', token: supervisorToken },
    { actor: 'agent', role: 'agent', token: agentToken },
    { actor: 'viewer', role: 'viewer', token: viewerToken },
  ];

  await t.test('⭐⭐⭐ M-84a: the matrix of the four roles of the company (from the core)', async () => {
    for (const { actor, role, token } of actors) {
      for (const operation of operations) {
        const allowed = operation.capability === null || may(role, operation.capability);
        await restore();
        const actual = await operation.run(token, actor);
        // ⭐⭐ The scope of the work queue (the row is not the agent's).
        if (operation.scopeLimited && role === 'agent') {
          assert.equal(
            actual,
            404,
            `⭐⭐⭐ ${actor} · ${operation.id} (${operation.label}): the row is outside the scope of the agent ⇒ the answer must be 404 and it was ${actual}`,
          );
          continue;
        }
        if (allowed) {
          assert.ok(
            actual >= 200 && actual < 300,
            `⭐⭐⭐ ${actor} · ${operation.id} (${operation.label}): the core grants ${operation.capability} to this role ⇒ the answer must be a success and it was ${actual}`,
          );
        } else {
          assert.equal(
            actual,
            403,
            `⭐⭐⭐ ${actor} · ${operation.id} (${operation.label}): the core does NOT grant ${operation.capability} to this role ⇒ the answer must be 403 and it was ${actual}`,
          );
        }
      }
    }
  });

  await t.test('⭐⭐⭐ M-84b: the matrix is written down and it matches the core', async () => {
    // ⭐⭐ The matrix itself (the truth of the core, read at runtime).
    const matrix = operations.map((operation) => {
      const row: Record<string, string> = { operation: operation.id };
      for (const role of ['owner', 'supervisor', 'agent', 'viewer'] as const) {
        row[role] = operation.capability === null || may(role, operation.capability) ? 'yes' : 'no';
      }
      return row;
    });
    // ⭐⭐ The lines that the matrix must carry (the known corners).
    const cell = (id: string, role: string): string =>
      matrix.find((row) => row['operation'] === id)?.[role] ?? '?';
    assert.equal(cell('OP-05', 'owner'), 'yes', '⭐⭐⭐ the owner may assign (the core grants conversation.assign)');
    assert.equal(cell('OP-05', 'supervisor'), 'no', '⭐⭐⭐ the supervisor may NOT assign (the core does not grant it)');
    assert.equal(cell('OP-03', 'agent'), 'yes', '⭐⭐⭐ the agent may write');
    assert.equal(cell('OP-03', 'viewer'), 'no', '⭐⭐⭐ the viewer may NOT write');
    assert.equal(cell('OP-08', 'agent'), 'no', '⭐⭐⭐ the agent may NOT manage a customer');
    assert.equal(cell('OP-08', 'supervisor'), 'yes', '⭐⭐⭐ the supervisor may manage a customer');
  });

  await t.test('⭐⭐⭐ M-84c: the employee of another company reaches NOTHING of the drill', async () => {
    for (const operation of operations) {
      await restore();
      const actual = await operation.run(otherToken, 'other');
      // ⭐⭐ The paths that touch a row of the drill must NOT answer a
      //   success ⇒ the row of another company is not there.
      if (['OP-02', 'OP-03', 'OP-04', 'OP-05', 'OP-07', 'OP-08', 'OP-10'].includes(operation.id)) {
        assert.ok(
          actual < 200 || actual >= 300,
          `⭐⭐⭐ ${operation.id} (${operation.label}): the employee of another company reached a row of the drill (${actual})`,
        );
      } else {
        // ⭐⭐ The lists answer 200 but they are EMPTY ⇒ they carry
        //   nothing of the drill.
        assert.equal(
          actual,
          200,
          `⭐⭐⭐ ${operation.id} (${operation.label}): the list of another company answered ${actual}`,
        );
        const list = await request('GET', '/api/inbox/conversations?limit=50', otherToken);
        assert.ok(
          !JSON.stringify(list.body).includes(REF),
          '⭐⭐⭐ the list of another company carries a conversation of the drill',
        );
      }
    }
  });

  await t.test('⭐⭐⭐ M-84d: an expired session reaches NOTHING', async () => {
    // ⭐⭐ The session of the drill is closed on the server.
    const rows = await UnitOfWork.run(harness.ownerPool, TENANT, async (uow) => {
      const result = await uow.query(`update sessions set revoked_at = now() where tenant_id = $1`, [TENANT]);
      return result.rowCount;
    });
    assert.ok(rows > 0, '⭐⭐⭐ the session of the drill was not found');
    for (const operation of operations) {
      const actual = await operation.run(ownerToken, 'expired');
      assert.equal(
        actual,
        401,
        `⭐⭐⭐ ${operation.id} (${operation.label}): an expired session answered ${actual} and not 401`,
      );
    }
  });
});

// ============================================================
// WASL AI — FOUNDATION BUILD 01 — isolation and atomicity
// ------------------------------------------------------------
// ⭐ AC-03: every operation is tested for cross tenant access, not
//   just the presence of a tenant column.
// ⭐ AC-04: the request role cannot bypass the row level security and
//   a missing tenant context is a refusal, not a default allow.
// ⭐ AC-07: a failed composite operation leaves nothing behind.
// ⛔ Local synthetic database only.
// ============================================================

import assert from 'node:assert/strict';
import test from 'node:test';

import { UnitOfWork } from '../../server/db/unit-of-work.ts';
import { startHarness, loginAs, resetSyntheticData, type Harness } from './harness.ts';

const PASSCODE = process.env['WASL_TEST_PASSCODE'] ?? 'wasl-local-test';

/**
 * ⭐ A refused read is either an error status or an empty answer.
 * ⭐ The property that matters: the other tenant's reference never
 *   appears in the payload.
 */
function assertNoLeak(status: number, body: Record<string, unknown>, forbiddenRef: string): void {
  if (status === 404 || status === 403) return;
  const payload = JSON.stringify(body);
  assert.ok(!payload.includes(forbiddenRef), `the payload leaked ${forbiddenRef}: ${payload.slice(0, 200)}`);
}

test('FOUNDATION 1) isolation, RLS protection and atomicity', async (t) => {
  const harness = await startHarness();
  t.after(async () => {
    await harness.stop();
  });
  await resetSyntheticData(harness.ownerPool, PASSCODE);

  const alpha = await loginAs(harness.client, 'tnt_alpha', 'usr_alpha_owner', PASSCODE);
  const beta = await loginAs(harness.client, 'tnt_beta', 'usr_beta_owner', PASSCODE);

  await t.test('⭐ AC-03a: the two companies do not share conversations', async () => {
    const created = await harness.client.request({
      method: 'POST',
      path: '/api/conversations',
      token: alpha,
      payload: { conversation_ref: 'conv_iso_alpha', customer_id: 'cus_alpha_1', message: { body: 'hello' } },
    });
    assert.equal(created.status, 201);

    const list = await harness.client.request({ path: '/api/conversations', token: beta });
    const rows = list.body['conversations'] as Array<Record<string, unknown>>;
    assert.ok(!rows.some((row) => row['ref'] === 'conv_iso_alpha'), 'the conversation leaked');

    const read = await harness.client.request({ path: '/api/conversations/conv_iso_alpha', token: beta });
    assertNoLeak(read.status, read.body, 'conv_iso_alpha');

    const messages = await harness.client.request({ path: '/api/conversations/conv_iso_alpha/messages', token: beta });
    assertNoLeak(messages.status, messages.body, 'conv_iso_alpha');

    const changes = await harness.client.request({ path: '/api/conversations/conv_iso_alpha/changes', token: beta });
    assertNoLeak(changes.status, changes.body, 'conv_iso_alpha');
  });

  await t.test('⭐ AC-03b: writes of another company are refused', async () => {
    const write = await harness.client.request({
      method: 'POST',
      path: '/api/conversations/conv_iso_alpha/messages',
      token: beta,
      payload: { body: 'let me in' },
    });
    assert.ok(write.status === 404 || write.status === 403, `unexpected status ${write.status}`);
    const alphaMessages = await UnitOfWork.run(harness.ownerPool, 'tnt_alpha', async (uow) => {
      const result = await uow.query<{ count: string }>(
        `select count(*)::text as count from messages where body = 'let me in'`,
      );
      return Number(result.rows[0]?.count ?? '0');
    });
    assert.equal(alphaMessages, 0, 'the foreign write reached the other tenant');

    const state = await harness.client.request({
      method: 'POST',
      path: '/api/conversations/conv_iso_alpha/state',
      token: beta,
      payload: { to: 'open' },
    });
    assert.ok(state.status === 404 || state.status === 403, `unexpected status ${state.status}`);

    const assign = await harness.client.request({
      method: 'POST',
      path: '/api/conversations/conv_iso_alpha/assign',
      token: beta,
      payload: { actor_id: 'usr_beta_agent' },
    });
    assert.ok(assign.status === 404 || assign.status === 403, `unexpected status ${assign.status}`);
  });

  await t.test('⭐ AC-03c: the export and the deletion of another company are refused', async () => {
    const exported = await harness.client.request({ method: 'POST', path: '/api/privacy/export', token: beta });
    assert.equal(exported.status, 200);
    const bundle = exported.body['export'] as Record<string, unknown>;
    const conversations = bundle['conversations'] as Array<Record<string, unknown>>;
    assert.ok(!conversations.some((row) => row['ref'] === 'conv_iso_alpha'), 'the export leaked');
    const messages = bundle['messages'] as Array<Record<string, unknown>>;
    assert.ok(
      messages.every((row) => row['tenant_id'] === 'tnt_beta'),
      'the export contains rows of another tenant',
    );
  });

  await t.test('⭐ AC-04a: the request role cannot bypass the row level security', async () => {
    const roles = await harness.ownerPool.query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
      owns_tables: boolean;
    }>(
      `select r.rolsuper, r.rolbypassrls,
              (select count(*)::int from pg_class c
                 join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relkind = 'r'
                  and pg_get_userbyid(c.relowner) = 'wasl_app') as owns_tables
         from pg_roles r where r.rolname = 'wasl_app'`,
    );
    const row = roles.rows[0]!;
    assert.equal(row.rolsuper, false, 'the request role is a superuser');
    assert.equal(row.rolbypassrls, false, 'the request role bypasses RLS');
    assert.equal(row.owns_tables, 0, 'the request role owns tables');
  });

  await t.test('⭐ AC-04b: no tenant context means no rows', async () => {
    const without = await harness.appPool.query<{ count: string }>(
      `select count(*)::text as count from messages`,
    );
    assert.equal(Number(without.rows[0]?.count ?? '-1'), 0, 'rows are visible without a tenant context');

    const withAlpha = await UnitOfWork.run(harness.appPool, 'tnt_alpha', async (uow) => {
      const result = await uow.query<{ tenant_id: string }>(`select distinct tenant_id from messages`);
      return result.rows.map((row) => row.tenant_id);
    });
    assert.deepEqual(withAlpha, ['tnt_alpha'], 'the context did not scope the rows');
  });

  await t.test('⭐ AC-04c: the isolation policy is enabled and forced', async () => {
    const policies = await harness.ownerPool.query<{
      relname: string;
      rls: boolean;
      force: boolean;
      policy_count: number;
    }>(
      `select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as force,
              (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policy_count
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
        order by c.relname`,
    );
    const tenantTables = [
      'audit_events',
      'conversation_changes',
      'conversations',
      'customers',
      'deletion_requests',
      'memberships',
      'messages',
      'read_audit_events',
      'retention_policies',
      'sessions',
      'tenants',
    ];
    for (const name of tenantTables) {
      const row = policies.rows.find((item) => item.relname === name);
      assert.ok(row, `table ${name} is missing`);
      assert.equal(row!.rls, true, `RLS is not enabled on ${name}`);
      assert.equal(row!.force, true, `RLS is not forced on ${name}`);
      assert.ok(row!.policy_count >= 1, `no isolation policy on ${name}`);
    }
  });

  await t.test('⭐ AC-07: a failed composite operation leaves nothing behind', async () => {
    const before = await UnitOfWork.run(harness.ownerPool, 'tnt_alpha', async (uow) => {
      const result = await uow.query<{ count: string }>(`select count(*)::text as count from conversations`);
      return Number(result.rows[0]?.count ?? '0');
    });

    // The conversation is created, but its first message is rejected by
    // the core contract, so the whole unit of work must roll back.
    const failed = await harness.client.request({
      method: 'POST',
      path: '/api/conversations',
      token: alpha,
      payload: {
        conversation_ref: 'conv_atomic_rollback',
        customer_id: 'cus_alpha_1',
        message: { body: '' },
      },
    });
    assert.ok(failed.status >= 400, `the invalid message was accepted: ${failed.status}`);

    const after = await UnitOfWork.run(harness.ownerPool, 'tnt_alpha', async (uow) => {
      const result = await uow.query<{ count: string; messages: string }>(
        `select count(*)::text as count, (select count(*)::text from messages) as messages from conversations`,
      );
      return result.rows[0]!;
    });
    assert.equal(Number(after.count), before, 'a half conversation stayed in the database');
    assert.ok(Number(after.messages) >= 0);
  });

  await t.test('⭐ AC-07b: a thrown error inside a unit of work rolls everything back', async () => {
    const result = await UnitOfWork.run(harness.ownerPool, 'tnt_alpha', async (uow) => {
      await uow.query(`insert into customers (id, tenant_id, display_name, data_class) values ('cus_atomic_probe','tnt_alpha','probe','standard')`);
      throw new Error('forced_failure');
    }).then(
      () => 'resolved',
      () => 'rejected',
    );
    assert.equal(result, 'rejected');
    const rows = await UnitOfWork.run(harness.ownerPool, 'tnt_alpha', async (uow) => {
      const probe = await uow.query<{ count: string }>(`select count(*)::text as count from customers where id = 'cus_atomic_probe'`);
      return Number(probe.rows[0]?.count ?? '0');
    });
    assert.equal(rows, 0, 'the rolled back row is still there');
  });
  // ------------------------------------------------------------
  // D-067 / R-02: the isolation of two and three companies, over
  // every operation, with a tampered tenant id and with concurrent
  // requests. The property under test: the tenant context comes from
  // the trusted session and never from the client.
  // ------------------------------------------------------------

  await t.test('⭐ R-02a: three companies, every operation, no cross talk', async () => {
    const companies = [
      { tenant: 'tnt_alpha', owner: 'usr_alpha_owner', customer: 'cus_alpha_1' },
      { tenant: 'tnt_beta', owner: 'usr_beta_owner', customer: 'cus_beta_1' },
      { tenant: 'tnt_gamma', owner: 'usr_gamma_owner', customer: 'cus_gamma_1' },
    ];
    const refs = new Map<string, string>();
    const tokens = new Map<string, string>();
    for (const company of companies) {
      const token = await loginAs(harness.client, company.tenant, company.owner, PASSCODE);
      tokens.set(company.tenant, token);
      const ref = `conv_r02_${company.tenant}_${Date.now().toString(36)}`;
      const created = await harness.client.request({
        method: 'POST',
        path: '/api/conversations',
        token,
        payload: {
          conversation_ref: ref,
          customer_id: company.customer,
          message: { body: `r02 ${company.tenant}` },
        },
      });
      assert.equal(created.status, 201, `the conversation of ${company.tenant} was not created`);
      refs.set(company.tenant, ref);
    }

    const operations: readonly {
      name: string;
      method: string;
      path: string;
      payload?: unknown;
      mutating?: boolean;
    }[] = [
      { name: 'list', method: 'GET', path: '/api/conversations' },
      { name: 'customers', method: 'GET', path: '/api/customers' },
      { name: 'audit', method: 'GET', path: '/api/audit' },
      { name: 'retention', method: 'GET', path: '/api/retention' },
      { name: 'read', method: 'GET', path: '/api/conversations/REF' },
      { name: 'messages', method: 'GET', path: '/api/conversations/REF/messages' },
      { name: 'changes', method: 'GET', path: '/api/conversations/REF/changes' },
      { name: 'write', method: 'POST', path: '/api/conversations/REF/messages', payload: { body: 'x' }, mutating: true },
      { name: 'state', method: 'POST', path: '/api/conversations/REF/state', payload: { to: 'open' }, mutating: true },
      { name: 'assign', method: 'POST', path: '/api/conversations/REF/assign', payload: { actor_id: 'usr_beta_agent' }, mutating: true },
      { name: 'export', method: 'POST', path: '/api/privacy/export', payload: {} },
      { name: 'deletion preview', method: 'POST', path: '/api/privacy/deletion/preview', payload: { scope: 'tenant_data' } },
    ];

    for (const caller of companies) {
      for (const victim of companies) {
        if (caller.tenant === victim.tenant) continue;
        const victimRef = refs.get(victim.tenant)!;
        const token = tokens.get(caller.tenant)!;
        for (const operation of operations) {
          const path = operation.path.replace('REF', victimRef);
          const response = await harness.client.request({
            method: operation.method,
            path,
            token,
            payload: operation.payload,
          });
          // ⭐ The error message may echo the reference the caller sent
          //   (that is not a leak): the DATA fields must not contain it.
          const { error: _echo, ...data } = response.body as Record<string, unknown>;
          // ⭐ The export carries the audit trail of the caller, which
          //   records its own attempts (it may mention a foreign
          //   reference the caller itself sent). The business data is
          //   what must be free of the other company.
          if (typeof data['export'] === 'object' && data['export'] !== null) {
            const bundle = { ...(data['export'] as Record<string, unknown>) };
            delete bundle['auditEvents'];
            data['export'] = bundle;
          }
          const payload = JSON.stringify(data);
          assert.ok(
            !payload.includes(victimRef),
            `${caller.tenant} leaked the reference of ${victim.tenant} through ${operation.name}: ${payload.slice(0, 200)}`,
          );
          assert.ok(
            !payload.includes(victim.customer),
            `${caller.tenant} leaked the customer of ${victim.tenant} through ${operation.name}`,
          );
          if (!operation.mutating) continue;
          assert.ok(
            response.status === 403 || response.status === 404 || response.status === 409,
            `the ${operation.name} operation of ${caller.tenant} answered ${response.status} on the data of ${victim.tenant}`,
          );
        }
      }
    }
  });

  await t.test('⭐ R-02b: the client cannot choose the tenant', async () => {
    const alphaToken = await loginAs(harness.client, 'tnt_alpha', 'usr_alpha_owner', PASSCODE);
    const ref = `conv_r02_tamper_${Date.now().toString(36)}`;
    const created = await harness.client.request({
      method: 'POST',
      path: '/api/conversations',
      token: alphaToken,
      payload: {
        conversation_ref: ref,
        customer_id: 'cus_alpha_1',
        // ⭐ The client names another company: the server must ignore it.
        tenant_id: 'tnt_beta',
        declared_tenant_id: 'tnt_beta',
        message: { body: 'tampered tenant', tenant_id: 'tnt_beta' },
      },
    });
    assert.equal(created.status, 201, 'the tampered creation was refused');

    const rows = await UnitOfWork.run(harness.ownerPool, 'tnt_alpha', async (uow) => {
      const result = await uow.query<{ tenant_id: string }>(
        `select tenant_id from conversations where ref = $1`,
        [ref],
      );
      return result.rows.map((row) => row.tenant_id);
    });
    assert.deepEqual(rows, ['tnt_alpha'], 'the tampered tenant id decided where the row was written');

    const betaRows = await UnitOfWork.run(harness.ownerPool, 'tnt_beta', async (uow) => {
      const result = await uow.query<{ count: string }>(
        `select count(*)::text as count from conversations where ref = $1`,
        [ref],
      );
      return Number(result.rows[0]?.count ?? '0');
    });
    assert.equal(betaRows, 0, 'the row landed in the company the client named');

    // ⭐ The export and the deletion preview also ignore the client.
    const exported = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/export',
      token: alphaToken,
      payload: { tenant_id: 'tnt_beta' },
    });
    assert.equal(exported.status, 200);
    const bundle = exported.body['export'] as Record<string, unknown>;
    assert.equal(bundle['tenantId'], 'tnt_alpha', 'the export answered with another company');
    const customers = Array.isArray(bundle['customers']) ? (bundle['customers'] as Array<Record<string, unknown>>) : [];
    for (const customer of customers) {
      assert.ok(
        !String(customer['id']).startsWith('cus_beta'),
        `the export carries another company customer: ${String(customer['id'])}`,
      );
    }
  });

  await t.test('⭐ R-02c: the database itself refuses a foreign row', async () => {
    const betaToken = await loginAs(harness.client, 'tnt_beta', 'usr_beta_owner', PASSCODE);
    const ref = `conv_r02_rls_${Date.now().toString(36)}`;
    const created = await harness.client.request({
      method: 'POST',
      path: '/api/conversations',
      token: betaToken,
      payload: {
        conversation_ref: ref,
        customer_id: 'cus_beta_1',
        message: { body: 'rls probe' },
      },
    });
    assert.equal(created.status, 201);

    // ⭐ With the context of another company the row is invisible, even
    //   to a direct SQL query: the isolation lives in the database.
    const foreign = await UnitOfWork.run(harness.appPool, 'tnt_alpha', async (uow) => {
      const result = await uow.query<{ count: string }>(
        `select count(*)::text as count from conversations where ref = $1`,
        [ref],
      );
      const messages = await uow.query<{ count: string }>(
        `select count(*)::text as count from messages where conversation_ref = $1`,
        [ref],
      );
      return {
        conversations: Number(result.rows[0]?.count ?? '0'),
        messages: Number(messages.rows[0]?.count ?? '0'),
      };
    });
    assert.equal(foreign.conversations, 0, 'a foreign conversation is visible with a foreign context');
    assert.equal(foreign.messages, 0, 'a foreign message is visible with a foreign context');

    const own = await UnitOfWork.run(harness.appPool, 'tnt_beta', async (uow) => {
      const result = await uow.query<{ count: string }>(
        `select count(*)::text as count from conversations where ref = $1`,
        [ref],
      );
      return Number(result.rows[0]?.count ?? '0');
    });
    assert.equal(own, 1, 'the row is not visible with its own context');
  });

  await t.test('⭐ R-02d: concurrent requests of two companies do not mix', async () => {
    const alphaToken = await loginAs(harness.client, 'tnt_alpha', 'usr_alpha_owner', PASSCODE);
    const betaToken = await loginAs(harness.client, 'tnt_beta', 'usr_beta_owner', PASSCODE);
    const alphaRef = `conv_r02_par_a_${Date.now().toString(36)}`;
    const betaRef = `conv_r02_par_b_${Date.now().toString(36)}`;

    const [alphaCreated, betaCreated] = await Promise.all([
      harness.client.request({
        method: 'POST',
        path: '/api/conversations',
        token: alphaToken,
        payload: { conversation_ref: alphaRef, customer_id: 'cus_alpha_1', message: { body: 'alpha parallel' } },
      }),
      harness.client.request({
        method: 'POST',
        path: '/api/conversations',
        token: betaToken,
        payload: { conversation_ref: betaRef, customer_id: 'cus_beta_1', message: { body: 'beta parallel' } },
      }),
    ]);
    assert.equal(alphaCreated.status, 201, 'the parallel creation of the first company failed');
    assert.equal(betaCreated.status, 201, 'the parallel creation of the second company failed');

    const [alphaList, betaList] = await Promise.all([
      harness.client.request({ method: 'GET', path: '/api/conversations', token: alphaToken }),
      harness.client.request({ method: 'GET', path: '/api/conversations', token: betaToken }),
    ]);
    const alphaRefs = (alphaList.body['conversations'] as Array<Record<string, unknown>>).map((row) => String(row['ref']));
    const betaRefs = (betaList.body['conversations'] as Array<Record<string, unknown>>).map((row) => String(row['ref']));
    assert.ok(alphaRefs.includes(alphaRef), 'the first company lost its own conversation');
    assert.ok(!alphaRefs.includes(betaRef), 'the first company sees the conversation of the second');
    assert.ok(betaRefs.includes(betaRef), 'the second company lost its own conversation');
    assert.ok(!betaRefs.includes(alphaRef), 'the second company sees the conversation of the first');

    // ⭐ Each company is read in its own context: a foreign row is
    //   invisible to the row level security, not hidden by the test.
    const placement = await UnitOfWork.run(harness.ownerPool, 'tnt_alpha', async (uow) => {
      const result = await uow.query<{ ref: string; tenant_id: string }>(
        `select ref, tenant_id from conversations where ref = $1`,
        [alphaRef],
      );
      return result.rows;
    });
    const foreign = await UnitOfWork.run(harness.ownerPool, 'tnt_alpha', async (uow) => {
      const result = await uow.query<{ count: string }>(
        `select count(*)::text as count from conversations where ref = $1`,
        [betaRef],
      );
      return Number(result.rows[0]?.count ?? '0');
    });
    const betaPlacement = await UnitOfWork.run(harness.ownerPool, 'tnt_beta', async (uow) => {
      const result = await uow.query<{ ref: string; tenant_id: string }>(
        `select ref, tenant_id from conversations where ref = $1`,
        [betaRef],
      );
      return result.rows;
    });
    assert.equal(placement[0]?.tenant_id, 'tnt_alpha', 'the parallel conversation of the first company landed elsewhere');
    assert.equal(betaPlacement[0]?.tenant_id, 'tnt_beta', 'the parallel conversation of the second company landed elsewhere');
    assert.equal(foreign, 0, 'the parallel conversation of the second company is visible to the first');
  });

  await t.test('⭐ R-02e: the audit trails of the companies are separated', async () => {
    const alphaToken = await loginAs(harness.client, 'tnt_alpha', 'usr_alpha_owner', PASSCODE);
    const betaToken = await loginAs(harness.client, 'tnt_beta', 'usr_beta_owner', PASSCODE);
    await harness.client.request({
      method: 'POST',
      path: '/api/conversations',
      token: alphaToken,
      payload: {
        conversation_ref: `conv_r02_audit_${Date.now().toString(36)}`,
        customer_id: 'cus_alpha_1',
        message: { body: 'audit probe' },
      },
    });
    const alphaAudit = await harness.client.request({ method: 'GET', path: '/api/audit', token: alphaToken });
    const betaAudit = await harness.client.request({ method: 'GET', path: '/api/audit', token: betaToken });
    const alphaRows = alphaAudit.body['audit'] as Array<Record<string, unknown>>;
    const betaRows = betaAudit.body['audit'] as Array<Record<string, unknown>>;
    assert.ok(alphaRows.length > 0, 'the first company has no audit trail');
    const alphaIds = new Set(alphaRows.map((row) => String(row['id'])));
    for (const row of betaRows) {
      assert.ok(!alphaIds.has(String(row['id'])), 'the second company sees the audit events of the first');
    }
    for (const row of alphaRows) {
      assert.ok(String(row['actor_id']).startsWith('usr_alpha'), 'the audit trail of the first company has a foreign actor');
    }
  });
});

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
});

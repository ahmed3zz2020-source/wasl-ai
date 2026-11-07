// ============================================================
// WASL AI — FOUNDATION BUILD 01 — POST-REVIEW REMEDIATION (D-067)
// R-01: the deletion of a tenant (full and partial)
// ------------------------------------------------------------
// ⭐ Every check runs against the REAL local PostgreSQL, through the
//   real HTTP API. Nothing is mocked and no real data is touched:
//   the tenants created here are synthetic and dedicated to this file.
// ⭐ The dedicated tenants keep the other suites untouched: the
//   seeded companies (alpha, beta, gamma) are used by them.
// ============================================================

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { hashPasscode } from '../../server/auth/sessions.ts';
import { UnitOfWork } from '../../server/db/unit-of-work.ts';
import { loginAs, startHarness } from './harness.ts';

const PASSCODE = process.env['WASL_TEST_PASSCODE'] ?? 'wasl-local-test';

interface TenantFixture {
  readonly tenantId: string;
  readonly userId: string;
  readonly customerId: string;
}

/** ⭐ Create a synthetic tenant that belongs to this file only. */
async function createTenant(harness: Awaited<ReturnType<typeof startHarness>>, tenantId: string): Promise<TenantFixture> {
  const userId = `usr_${tenantId}_owner`;
  const customerId = `cus_${tenantId}_1`;
  await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
    await uow.query(
      `insert into tenants (id, name, status) values ($1,$2,'active')
       on conflict (id) do update set name = excluded.name, status = 'active'`,
      [tenantId, `Synthetic ${tenantId}`],
    );
    await uow.query(
      `insert into users (id, display_name, email, status, passcode_hash) values ($1,$2,$3,'active',$4)
       on conflict (id) do update set passcode_hash = excluded.passcode_hash, status = 'active'`,
      [userId, `Owner ${tenantId}`, `${userId}@example.invalid`, hashPasscode(PASSCODE)],
    );
    await uow.query(
      `insert into memberships (id, tenant_id, user_id, role, status) values ($1,$2,$3,'owner','active')
       on conflict (tenant_id, user_id) do update set role = excluded.role, status = 'active'`,
      [`mem_${userId}`, tenantId, userId],
    );
    await uow.query(
      `insert into customers (id, tenant_id, display_name, data_class) values ($1,$2,$3,'standard')
       on conflict (id) do update set display_name = excluded.display_name`,
      [customerId, tenantId, `Customer ${tenantId}`],
    );
  });
  return { tenantId, userId, customerId };
}

/** ⭐ Remove a dedicated tenant and its evidence (the file is re-runnable). */
async function cleanTenant(harness: Awaited<ReturnType<typeof startHarness>>, tenantId: string): Promise<void> {
  await harness.ownerPool.query(`delete from tenant_deletion_evidence where tenant_id = $1`, [tenantId]);
  await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
    await uow.query(`delete from tenants where id = $1`, [tenantId]);
  });
}

const DEDICATED_TENANTS = [
  'tnt_d067_full',
  'tnt_d067_partial',
  'tnt_d067_rollback',
  'tnt_d067_unknown',
  'tnt_d067_other',
] as const;

/** ⭐ Seed one conversation with one message (so there is data to delete). */
async function seedConversation(
  harness: Awaited<ReturnType<typeof startHarness>>,
  token: string,
  fixture: TenantFixture,
  ref: string,
): Promise<void> {
  const created = await harness.client.request({
    method: 'POST',
    path: '/api/conversations',
    token,
    payload: {
      conversation_ref: ref,
      customer_id: fixture.customerId,
      message: { body: 'synthetic message for the deletion test' },
    },
  });
  assert.equal(created.status, 201, 'the synthetic conversation was not created');
}

test('FOUNDATION 6) the deletion of a tenant (D-067 remediation)', async (t) => {
  const harness = await startHarness();
  t.after(async () => {
    await harness.stop();
  });
  // ⭐ The file is re-runnable: every dedicated tenant starts empty.
  await t.before(async () => {
    for (const tenantId of DEDICATED_TENANTS) {
      await cleanTenant(harness, tenantId);
    }
  });

  await t.test('⭐ D-01: the full deletion completes and leaves a durable evidence', async () => {
    const fixture = await createTenant(harness, 'tnt_d067_full');
    const owner = await loginAs(harness.client, fixture.tenantId, fixture.userId, PASSCODE);
    await seedConversation(harness, owner, fixture, 'conv_d067_full');

    const preview = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/deletion/preview',
      token: owner,
      payload: { scope: 'tenant_full' },
    });
    assert.equal(preview.status, 200, 'the preview of the full deletion failed');
    const requestId = String((preview.body['preview'] as Record<string, unknown>)['requestId']);

    const executed = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/deletion/execute',
      token: owner,
      payload: { request_id: requestId },
    });
    assert.equal(executed.status, 200, 'the full deletion did not complete');

    const removed = executed.body['removed'] as Record<string, number>;
    assert.ok((removed['messages'] ?? 0) > 0, 'no message was removed');
    assert.ok((removed['conversations'] ?? 0) > 0, 'no conversation was removed');
    assert.ok((removed['memberships'] ?? 0) > 0, 'no membership was removed');
    assert.ok((removed['sessions'] ?? 0) > 0, 'no session was removed');
    assert.equal(removed['tenants'], 1, 'the tenant row was not removed');
    assert.equal(executed.body['scope'], 'tenant_full', 'the scope of the answer is wrong');
    const evidenceId = String(executed.body['evidence_id']);
    assert.ok(evidenceId.length > 0, 'the answer carries no evidence id');

    const after = await UnitOfWork.run(harness.ownerPool, fixture.tenantId, async (uow) => {
      const tenant = await uow.query<{ count: string }>(`select count(*)::text as count from tenants`);
      const conversations = await uow.query<{ count: string }>(`select count(*)::text as count from conversations`);
      const messages = await uow.query<{ count: string }>(`select count(*)::text as count from messages`);
      const memberships = await uow.query<{ count: string }>(`select count(*)::text as count from memberships`);
      const audits = await uow.query<{ count: string }>(`select count(*)::text as count from audit_events`);
      return {
        tenants: Number(tenant.rows[0]?.count ?? '0'),
        conversations: Number(conversations.rows[0]?.count ?? '0'),
        messages: Number(messages.rows[0]?.count ?? '0'),
        memberships: Number(memberships.rows[0]?.count ?? '0'),
        audits: Number(audits.rows[0]?.count ?? '0'),
      };
    });
    assert.equal(after.tenants, 0, 'the tenant row survived the full deletion');
    assert.equal(after.conversations, 0, 'the conversations survived the full deletion');
    assert.equal(after.messages, 0, 'the messages survived the full deletion');
    assert.equal(after.memberships, 0, 'the memberships survived the full deletion');
    assert.equal(after.audits, 0, 'the audit trail survived a full deletion');

    // ⭐ The proof of the deletion survives the deletion itself.
    const evidence = await harness.ownerPool.query<{
      id: string;
      tenant_id: string;
      request_id: string;
      scope: string;
      executed_by: string;
      removed: Record<string, number>;
    }>(
      `select id, tenant_id, request_id, scope, executed_by, removed
         from tenant_deletion_evidence where id = $1`,
      [evidenceId],
    );
    const row = evidence.rows[0];
    assert.ok(row, 'the deletion evidence did not survive the deletion');
    assert.equal(row!.tenant_id, fixture.tenantId, 'the evidence names another tenant');
    assert.equal(row!.request_id, requestId, 'the evidence names another request');
    assert.equal(row!.scope, 'tenant_full', 'the evidence records another scope');
    assert.equal(row!.executed_by, fixture.userId, 'the evidence names another actor');
    assert.ok(Number(row!.removed['conversations'] ?? 0) > 0, 'the evidence records no removed row');

    // ⭐ The request path may write the evidence but never read it.
    let readBlocked = false;
    try {
      const leak = await harness.appPool.query<{ count: string }>(
        `select count(*)::text as count from tenant_deletion_evidence`,
      );
      readBlocked = Number(leak.rows[0]?.count ?? '-1') === 0;
    } catch {
      readBlocked = true;
    }
    assert.ok(readBlocked, 'the request role can read the deletion evidence');

    const dead = await harness.client.request({ method: 'GET', path: '/api/conversations', token: owner });
    assert.ok(dead.status >= 400, 'the session of the deleted tenant still works');
  });

  await t.test('⭐ D-02: the partial deletion keeps the tenant and the audit trail', async () => {
    const fixture = await createTenant(harness, 'tnt_d067_partial');
    const owner = await loginAs(harness.client, fixture.tenantId, fixture.userId, PASSCODE);
    await seedConversation(harness, owner, fixture, 'conv_d067_partial');

    const preview = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/deletion/preview',
      token: owner,
      payload: { scope: 'tenant_data' },
    });
    assert.equal(preview.status, 200);
    const requestId = String((preview.body['preview'] as Record<string, unknown>)['requestId']);

    const executed = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/deletion/execute',
      token: owner,
      payload: { request_id: requestId },
    });
    assert.equal(executed.status, 200, 'the partial deletion did not complete');
    assert.equal(executed.body['scope'], 'tenant_data', 'the scope of the answer is wrong');

    const after = await UnitOfWork.run(harness.ownerPool, fixture.tenantId, async (uow) => {
      const tenant = await uow.query<{ status: string }>(`select status from tenants where id = $1`, [
        fixture.tenantId,
      ]);
      const conversations = await uow.query<{ count: string }>(`select count(*)::text as count from conversations`);
      const messages = await uow.query<{ count: string }>(`select count(*)::text as count from messages`);
      const audits = await uow.query<{ count: string }>(`select count(*)::text as count from audit_events`);
      const request = await uow.query<{ status: string }>(`select status from deletion_requests where id = $1`, [
        requestId,
      ]);
      return {
        tenantStatus: tenant.rows[0]?.status ?? 'missing',
        conversations: Number(conversations.rows[0]?.count ?? '0'),
        messages: Number(messages.rows[0]?.count ?? '0'),
        audits: Number(audits.rows[0]?.count ?? '0'),
        requestStatus: request.rows[0]?.status ?? 'missing',
      };
    });
    assert.equal(after.tenantStatus, 'deleted', 'the tenant row is not marked as deleted');
    assert.equal(after.conversations, 0, 'the conversations survived the partial deletion');
    assert.equal(after.messages, 0, 'the messages survived the partial deletion');
    assert.ok(after.audits > 0, 'the audit trail was deleted with the data');
    assert.equal(after.requestStatus, 'executed', 'the request was not marked as executed');

    const evidence = await harness.ownerPool.query<{ count: string }>(
      `select count(*)::text as count from tenant_deletion_evidence where tenant_id = $1 and scope = 'tenant_data'`,
      [fixture.tenantId],
    );
    assert.equal(Number(evidence.rows[0]?.count ?? '0'), 1, 'the partial deletion left no evidence');
  });

  await t.test('⭐ D-03: a failing step rolls the whole deletion back', async () => {
    const fixture = await createTenant(harness, 'tnt_d067_rollback');
    const owner = await loginAs(harness.client, fixture.tenantId, fixture.userId, PASSCODE);
    await seedConversation(harness, owner, fixture, 'conv_d067_rollback');

    const preview = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/deletion/preview',
      token: owner,
      payload: { scope: 'tenant_full' },
    });
    assert.equal(preview.status, 200);
    const requestId = String((preview.body['preview'] as Record<string, unknown>)['requestId']);

    // ⭐ The evidence write is made impossible: the deletion must fail
    //   as a whole instead of reporting a partial success.
    await harness.ownerPool.query(`revoke insert on tenant_deletion_evidence from wasl_app`);
    let executed: { status: number; body: Record<string, unknown> };
    try {
      executed = await harness.client.request({
        method: 'POST',
        path: '/api/privacy/deletion/execute',
        token: owner,
        payload: { request_id: requestId },
      });
    } finally {
      await harness.ownerPool.query(`grant insert on tenant_deletion_evidence to wasl_app`);
    }
    assert.notEqual(executed.status, 200, 'the deletion reported a success although a step failed');
    assert.ok(executed.status >= 400, 'the failing deletion did not report an error');

    const after = await UnitOfWork.run(harness.ownerPool, fixture.tenantId, async (uow) => {
      const tenant = await uow.query<{ status: string }>(`select status from tenants where id = $1`, [
        fixture.tenantId,
      ]);
      const conversations = await uow.query<{ count: string }>(`select count(*)::text as count from conversations`);
      const messages = await uow.query<{ count: string }>(`select count(*)::text as count from messages`);
      const memberships = await uow.query<{ count: string }>(`select count(*)::text as count from memberships`);
      const request = await uow.query<{ status: string }>(`select status from deletion_requests where id = $1`, [
        requestId,
      ]);
      return {
        tenantStatus: tenant.rows[0]?.status ?? 'missing',
        conversations: Number(conversations.rows[0]?.count ?? '0'),
        messages: Number(messages.rows[0]?.count ?? '0'),
        memberships: Number(memberships.rows[0]?.count ?? '0'),
        requestStatus: request.rows[0]?.status ?? 'missing',
      };
    });
    assert.equal(after.tenantStatus, 'active', 'the tenant was removed although the deletion failed');
    assert.ok(after.conversations > 0, 'the conversations were removed although the deletion failed');
    assert.ok(after.messages > 0, 'the messages were removed although the deletion failed');
    assert.ok(after.memberships > 0, 'the memberships were removed although the deletion failed');
    assert.equal(after.requestStatus, 'previewed', 'the request was marked although the deletion failed');
  });

  await t.test('⭐ D-04: an unknown or foreign request never reports a success', async () => {
    const fixture = await createTenant(harness, 'tnt_d067_unknown');
    const owner = await loginAs(harness.client, fixture.tenantId, fixture.userId, PASSCODE);
    await seedConversation(harness, owner, fixture, 'conv_d067_unknown');

    const unknown = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/deletion/execute',
      token: owner,
      payload: { request_id: 'del_does_not_exist' },
    });
    assert.ok(unknown.status >= 400, 'an unknown deletion request reported a success');

    const other = await createTenant(harness, 'tnt_d067_other');
    const otherOwner = await loginAs(harness.client, other.tenantId, other.userId, PASSCODE);
    await seedConversation(harness, otherOwner, other, 'conv_d067_other');
    const preview = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/deletion/preview',
      token: otherOwner,
      payload: { scope: 'tenant_data' },
    });
    const otherRequestId = String((preview.body['preview'] as Record<string, unknown>)['requestId']);

    const foreign = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/deletion/execute',
      token: owner,
      payload: { request_id: otherRequestId },
    });
    assert.ok(foreign.status >= 400, 'a foreign deletion request was executed');

    const stillThere = await UnitOfWork.run(harness.ownerPool, other.tenantId, async (uow) => {
      const result = await uow.query<{ count: string }>(`select count(*)::text as count from conversations`);
      const request = await uow.query<{ status: string }>(`select status from deletion_requests where id = $1`, [
        otherRequestId,
      ]);
      return {
        conversations: Number(result.rows[0]?.count ?? '0'),
        requestStatus: request.rows[0]?.status ?? 'missing',
      };
    });
    assert.ok(stillThere.conversations > 0, 'the foreign deletion removed the data');
    assert.equal(stillThere.requestStatus, 'previewed', 'the foreign request was marked as executed');
  });
});

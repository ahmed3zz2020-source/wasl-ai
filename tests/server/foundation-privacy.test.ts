// ============================================================
// WASL AI — FOUNDATION BUILD 01 — privacy, retention and deletion
// ------------------------------------------------------------
// ⭐ AC-08: the retention, export and deletion behaviour is tested on
//   synthetic data, and no company can see another company's rows.
// ⭐ The relationships between the tables are exercised by the
//   deletion (messages, conversations, customers and memberships).
// ⛔ No real data, no production policy: the retention windows are
//   synthetic configuration values.
// ============================================================

import assert from 'node:assert/strict';
import test from 'node:test';

import { UnitOfWork } from '../../server/db/unit-of-work.ts';
import { startHarness, loginAs, resetSyntheticData } from './harness.ts';

const PASSCODE = process.env['WASL_TEST_PASSCODE'] ?? 'wasl-local-test';

test('FOUNDATION 4) privacy, retention and deletion', async (t) => {
  const harness = await startHarness();
  t.after(async () => {
    await harness.stop();
  });
  await resetSyntheticData(harness.ownerPool, PASSCODE);

  await t.test('⭐ the retention policies round trip and are per class', async () => {
    const owner = await loginAs(harness.client, 'tnt_alpha', 'usr_alpha_owner', PASSCODE);
    const written = await harness.client.request({
      method: 'POST',
      path: '/api/retention',
      token: owner,
      payload: { data_class: 'regulated', retention_days: 120, on_cancel: 'delete' },
    });
    assert.equal(written.status, 200);

    const read = await harness.client.request({ path: '/api/retention', token: owner });
    assert.equal(read.status, 200);
    const policies = read.body['policies'] as Array<Record<string, unknown>>;
    const regulated = policies.find((row) => row['dataClass'] === 'regulated');
    assert.ok(regulated, 'the regulated policy is missing');
    assert.equal(regulated!['retentionDays'], 120);
    assert.equal(regulated!['onCancel'], 'delete');
  });

  await t.test('⭐ an unknown data class is refused', async () => {
    const owner = await loginAs(harness.client, 'tnt_alpha', 'usr_alpha_owner', PASSCODE);
    const response = await harness.client.request({
      method: 'POST',
      path: '/api/retention',
      token: owner,
      payload: { data_class: 'top_secret', retention_days: 10 },
    });
    assert.ok(response.status >= 400, 'an unknown data class was accepted');
  });

  await t.test('⭐ the export contains the tenant data and nothing else', async () => {
    const alpha = await loginAs(harness.client, 'tnt_alpha', 'usr_alpha_owner', PASSCODE);
    const beta = await loginAs(harness.client, 'tnt_beta', 'usr_beta_owner', PASSCODE);

    await harness.client.request({
      method: 'POST',
      path: '/api/conversations',
      token: alpha,
      payload: { conversation_ref: 'conv_priv_alpha', customer_id: 'cus_alpha_1', message: { body: 'private' } },
    });

    const exported = await harness.client.request({ method: 'POST', path: '/api/privacy/export', token: alpha });
    assert.equal(exported.status, 200);
    const bundle = exported.body['export'] as Record<string, unknown>;
    const conversations = bundle['conversations'] as Array<Record<string, unknown>>;
    assert.ok(conversations.some((row) => row['ref'] === 'conv_priv_alpha'), 'the export misses the conversation');
    for (const row of conversations) {
      assert.equal(row['tenant_id'], 'tnt_alpha', 'the export contains a row of another tenant');
    }

    const betaExport = await harness.client.request({ method: 'POST', path: '/api/privacy/export', token: beta });
    const betaBundle = betaExport.body['export'] as Record<string, unknown>;
    const betaConversations = betaBundle['conversations'] as Array<Record<string, unknown>>;
    assert.ok(
      !betaConversations.some((row) => row['ref'] === 'conv_priv_alpha'),
      'the beta export contains the alpha conversation',
    );
  });

  await t.test('⭐ the deletion preview changes nothing', async () => {
    const owner = await loginAs(harness.client, 'tnt_alpha', 'usr_alpha_owner', PASSCODE);
    const before = await UnitOfWork.run(harness.ownerPool, 'tnt_alpha', async (uow) => {
      const result = await uow.query<{ count: string }>(`select count(*)::text as count from conversations`);
      return Number(result.rows[0]?.count ?? '0');
    });

    const preview = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/deletion/preview',
      token: owner,
      payload: { scope: 'tenant_data' },
    });
    assert.equal(preview.status, 200);
    const body = preview.body['preview'] as Record<string, unknown>;
    const counts = body['counts'] as Record<string, number>;
    assert.ok(counts['conversations'] > 0, 'the preview does not count the conversations');
    assert.ok(Array.isArray(body['notes']) && (body['notes'] as unknown[]).length > 0, 'the preview has no notes');

    const after = await UnitOfWork.run(harness.ownerPool, 'tnt_alpha', async (uow) => {
      const result = await uow.query<{ count: string }>(`select count(*)::text as count from conversations`);
      return Number(result.rows[0]?.count ?? '0');
    });
    assert.equal(after, before, 'the preview deleted something');
  });

  await t.test('⭐ the deletion removes the data and keeps the audit trail', async () => {
    // ⭐ The deletion runs against the third company, so the other two
    //   keep their fixtures for the checks that follow.
    const owner = await loginAs(harness.client, 'tnt_gamma', 'usr_gamma_owner', PASSCODE);
    await harness.client.request({
      method: 'POST',
      path: '/api/conversations',
      token: owner,
      payload: {
        conversation_ref: 'conv_priv_gamma',
        customer_id: 'cus_gamma_1',
        message: { body: 'to be deleted' },
      },
    });
    const preview = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/deletion/preview',
      token: owner,
      payload: { scope: 'tenant_data' },
    });
    const previewBody = preview.body['preview'] as Record<string, unknown>;
    const requestId = String(previewBody['requestId']);

    const executed = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/deletion/execute',
      token: owner,
      payload: { request_id: requestId },
    });
    assert.equal(executed.status, 200);
    const removed = (executed.body['removed'] as Record<string, number>);
    assert.ok(removed['messages'] > 0, 'no message was removed');
    assert.ok(removed['conversations'] > 0, 'no conversation was removed');
    assert.ok(removed['customers'] > 0, 'no customer was removed');

    const after = await UnitOfWork.run(harness.ownerPool, 'tnt_gamma', async (uow) => {
      const conversations = await uow.query<{ count: string }>(`select count(*)::text as count from conversations`);
      const messages = await uow.query<{ count: string }>(`select count(*)::text as count from messages`);
      const customers = await uow.query<{ count: string }>(`select count(*)::text as count from customers`);
      const audits = await uow.query<{ count: string }>(`select count(*)::text as count from audit_events`);
      const tenant = await uow.query<{ status: string }>(`select status from tenants where id = $1`, ['tnt_gamma']);
      const request = await uow.query<{ status: string }>(
        `select status from deletion_requests where id = $1`,
        [requestId],
      );
      return {
        conversations: Number(conversations.rows[0]?.count ?? '0'),
        messages: Number(messages.rows[0]?.count ?? '0'),
        customers: Number(customers.rows[0]?.count ?? '0'),
        audits: Number(audits.rows[0]?.count ?? '0'),
        tenantStatus: tenant.rows[0]?.status ?? 'missing',
        requestStatus: request.rows[0]?.status ?? 'missing',
      };
    });
    assert.equal(after.conversations, 0, 'the conversations survived the deletion');
    assert.equal(after.messages, 0, 'the messages survived the deletion');
    assert.equal(after.customers, 0, 'the customers survived the deletion');
    assert.ok(after.audits > 0, 'the audit trail was deleted with the data');
    assert.equal(after.tenantStatus, 'deleted', 'the tenant row is not marked as deleted');
    assert.equal(after.requestStatus, 'executed');
  });

  await t.test('⭐ a deletion request of another company cannot be executed here', async () => {
    // ⭐ The seed comes back: the deletion removed the memberships of
    //   the third company, which is exactly what a deletion means.
    await resetSyntheticData(harness.ownerPool, PASSCODE);
    const gamma = await loginAs(harness.client, 'tnt_gamma', 'usr_gamma_owner', PASSCODE);
    await harness.client.request({
      method: 'POST',
      path: '/api/conversations',
      token: gamma,
      payload: {
        conversation_ref: 'conv_priv_gamma_keep',
        customer_id: 'cus_gamma_1',
        message: { body: 'must survive' },
      },
    });
    const preview = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/deletion/preview',
      token: gamma,
      payload: { scope: 'tenant_data' },
    });
    const requestId = String((preview.body['preview'] as Record<string, unknown>)['requestId']);
    const beta = await loginAs(harness.client, 'tnt_beta', 'usr_beta_owner', PASSCODE);
    const executed = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/deletion/execute',
      token: beta,
      payload: { request_id: requestId },
    });
    assert.ok(executed.status >= 400, 'the beta session executed the gamma deletion request');

    const stillThere = await UnitOfWork.run(harness.ownerPool, 'tnt_gamma', async (uow) => {
      const result = await uow.query<{ count: string }>(
        `select count(*)::text as count from conversations where tenant_id = 'tnt_gamma'`,
      );
      return Number(result.rows[0]?.count ?? '0');
    });
    assert.ok(stillThere > 0, 'the gamma data was deleted by the beta session');
  });

  await t.test('⭐ the deletion request cannot be executed twice', async () => {
    const owner = await loginAs(harness.client, 'tnt_alpha', 'usr_alpha_owner', PASSCODE);
    await harness.client.request({
      method: 'POST',
      path: '/api/conversations',
      token: owner,
      payload: {
        conversation_ref: 'conv_priv_twice',
        customer_id: 'cus_alpha_1',
        message: { body: 'twice' },
      },
    });
    const preview = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/deletion/preview',
      token: owner,
      payload: { scope: 'tenant_data' },
    });
    const requestId = String((preview.body['preview'] as Record<string, unknown>)['requestId']);
    const first = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/deletion/execute',
      token: owner,
      payload: { request_id: requestId },
    });
    assert.equal(first.status, 200);
    const second = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/deletion/execute',
      token: owner,
      payload: { request_id: requestId },
    });
    assert.ok(second.status >= 400, 'the same deletion request ran twice');
  });
});

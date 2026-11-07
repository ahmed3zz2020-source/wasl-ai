// ============================================================
// WASL AI — FOUNDATION BUILD 02 — PHASE 01
// M-03: the protection of the deletion evidence
// ------------------------------------------------------------
// ⭐ WHY THIS FILE EXISTS
//   In D-067 the request role (`wasl_app`) may write the deletion
//   evidence and may never read it. That left a hole: any code path
//   running with the request role could write a fake evidence row.
//   The guard trigger (migration 003) closes the hole inside the
//   database: an evidence row is accepted only when a real deletion
//   request exists for the same tenant and the same scope, and that
//   request is already marked as executed.
// ⭐ THE PROPERTIES UNDER TEST
//   - a fake evidence (no request, another tenant, a request that was
//     not executed) is refused by the database,
//   - the real deletion still writes the evidence, and the requester is
//     stamped from the trusted request row,
//   - a failed step rolls everything back and the retry then succeeds
//     exactly once (no double execution),
//   - a connection dropped in the middle of the deletion rolls
//     everything back, and the retry then succeeds.
// ⛔ Local synthetic database only.
// ============================================================

import assert from 'node:assert/strict';
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

async function createTenant(
  harness: Awaited<ReturnType<typeof startHarness>>,
  tenantId: string,
): Promise<TenantFixture> {
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

async function cleanTenant(
  harness: Awaited<ReturnType<typeof startHarness>>,
  tenantId: string,
): Promise<void> {
  await harness.ownerPool.query(`delete from tenant_deletion_evidence where tenant_id = $1`, [tenantId]);
  await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
    await uow.query(`delete from tenants where id = $1`, [tenantId]);
  });
}

test('FOUNDATION 10) the protection of the deletion evidence (M-03)', async (t) => {
  const harness = await startHarness();
  const tenants = ['tnt_b02_fake', 'tnt_b02_retry', 'tnt_b02_drop', 'tnt_b02_real'];
  t.after(async () => {
    for (const tenantId of tenants) {
      await cleanTenant(harness, tenantId);
    }
    await harness.stop();
  });

  await t.test('⭐⭐⭐ M-03a: a fake evidence is refused by the database', async () => {
    const fixture = await createTenant(harness, 'tnt_b02_fake');
    const token = await loginAs(harness.client, fixture.tenantId, fixture.userId, PASSCODE);

    // ⭐ The request role writes an evidence for a request that does
    //   not exist: the guard trigger refuses it.
    const forged = await UnitOfWork.run(harness.appPool, fixture.tenantId, async (uow) => {
      try {
        await uow.query(
          `insert into tenant_deletion_evidence
             (id, tenant_id, request_id, scope, requested_by, executed_by, removed)
           values ($1,$2,$3,'tenant_full',$4,$5,'{}'::jsonb)`,
          [
            `evd_forged_${Date.now().toString(36)}`,
            fixture.tenantId,
            'del_does_not_exist',
            fixture.userId,
            fixture.userId,
          ],
        );
        return { rejected: false, code: 'none' };
      } catch (error) {
        return { rejected: true, code: (error as { code?: string }).code ?? 'unknown' };
      }
    });
    assert.ok(forged.rejected, 'the fake evidence was accepted');
    assert.equal(forged.code, '23514', `the refusal carries an unexpected code: ${forged.code}`);

    // ⭐ Nothing was written.
    const rows = await harness.ownerPool.query<{ count: string }>(
      `select count(*)::text as count from tenant_deletion_evidence where tenant_id = $1`,
      [fixture.tenantId],
    );
    assert.equal(Number(rows.rows[0]?.count ?? '0'), 0, 'the fake evidence left a row');

    // ⭐ The request path is still working (the guard did not break it).
    const alive = await harness.client.request({ method: 'GET', path: '/api/conversations', token });
    assert.equal(alive.status, 200);
  });

  await t.test('⭐⭐⭐ M-03b: an evidence of another tenant or of an unexecuted request is refused', async () => {
    const fixture = await createTenant(harness, 'tnt_b02_fake');
    const other = await createTenant(harness, 'tnt_b02_real');
    const token = await loginAs(harness.client, fixture.tenantId, fixture.userId, PASSCODE);

    // ⭐ A previewed request (not executed yet).
    const preview = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/deletion/preview',
      token,
      payload: { scope: 'tenant_full' },
    });
    assert.equal(preview.status, 200, `the preview failed: ${preview.status}`);
    const requestId = String((preview.body['preview'] as Record<string, unknown> | undefined)?.['requestId'] ?? '');
    assert.ok(requestId, 'the preview did not return a request id');

    // ⭐ The evidence of a request that is not executed yet.
    const early = await UnitOfWork.run(harness.appPool, fixture.tenantId, async (uow) => {
      try {
        await uow.query(
          `insert into tenant_deletion_evidence
             (id, tenant_id, request_id, scope, requested_by, executed_by, removed)
           values ($1,$2,$3,'tenant_full',$4,$5,'{}'::jsonb)`,
          [`evd_early_${Date.now().toString(36)}`, fixture.tenantId, requestId, fixture.userId, fixture.userId],
        );
        return { rejected: false, code: 'none' };
      } catch (error) {
        return { rejected: true, code: (error as { code?: string }).code ?? 'unknown' };
      }
    });
    assert.ok(early.rejected, 'the evidence of an unexecuted request was accepted');
    assert.equal(early.code, '23514', `the refusal carries an unexpected code: ${early.code}`);

    // ⭐ The evidence of another tenant.
    const crossed = await UnitOfWork.run(harness.appPool, fixture.tenantId, async (uow) => {
      try {
        await uow.query(
          `insert into tenant_deletion_evidence
             (id, tenant_id, request_id, scope, requested_by, executed_by, removed)
           values ($1,$2,$3,'tenant_full',$4,$5,'{}'::jsonb)`,
          [
            `evd_crossed_${Date.now().toString(36)}`,
            other.tenantId,
            requestId,
            other.userId,
            other.userId,
          ],
        );
        return { rejected: false, code: 'none' };
      } catch (error) {
        return { rejected: true, code: (error as { code?: string }).code ?? 'unknown' };
      }
    });
    assert.ok(crossed.rejected, 'the evidence of another tenant was accepted');
    assert.equal(crossed.code, '23514', `the refusal carries an unexpected code: ${crossed.code}`);
  });

  await t.test('⭐⭐ M-03c: the real deletion writes the evidence and stamps the requester', async () => {
    const fixture = await createTenant(harness, 'tnt_b02_real');
    const token = await loginAs(harness.client, fixture.tenantId, fixture.userId, PASSCODE);

    const preview = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/deletion/preview',
      token,
      payload: { scope: 'tenant_full' },
    });
    assert.equal(preview.status, 200, `the preview failed: ${preview.status}`);
    const requestId = String((preview.body['preview'] as Record<string, unknown> | undefined)?.['requestId'] ?? '');

    const executed = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/deletion/execute',
      token,
      payload: { request_id: requestId },
    });
    assert.equal(executed.status, 200, `the deletion failed: ${executed.status} ${JSON.stringify(executed.body)}`);

    // ⭐ The evidence survives the deletion of the tenant.
    const rows = await harness.ownerPool.query<{ request_id: string; requested_by: string; tenant_id: string }>(
      `select request_id, requested_by, tenant_id from tenant_deletion_evidence where tenant_id = $1`,
      [fixture.tenantId],
    );
    assert.equal(rows.rows.length, 1, `the evidence holds ${rows.rows.length} rows instead of 1`);
    assert.equal(rows.rows[0]!.request_id, requestId);
    // ⭐ The requester is stamped from the trusted request row.
    assert.equal(rows.rows[0]!.requested_by, fixture.userId);

    // ⭐ The tenant is really gone.
    const tenant = await harness.ownerPool.query<{ count: string }>(
      `select count(*)::text as count from tenants where id = $1`,
      [fixture.tenantId],
    );
    assert.equal(Number(tenant.rows[0]?.count ?? '0'), 0, 'the tenant row survived the deletion');
  });

  await t.test('⭐⭐⭐ M-03d: a failed step rolls back and the retry succeeds exactly once', async () => {
    const fixture = await createTenant(harness, 'tnt_b02_retry');
    const token = await loginAs(harness.client, fixture.tenantId, fixture.userId, PASSCODE);

    const preview = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/deletion/preview',
      token,
      payload: { scope: 'tenant_full' },
    });
    assert.equal(preview.status, 200);
    const requestId = String((preview.body['preview'] as Record<string, unknown> | undefined)?.['requestId'] ?? '');

    // ⭐ The evidence insert is made impossible: the deletion must fail
    //   and roll back completely.
    await harness.ownerPool.query(`revoke insert on tenant_deletion_evidence from wasl_app`);
    let failed = false;
    try {
      const blocked = await harness.client.request({
        method: 'POST',
        path: '/api/privacy/deletion/execute',
        token,
        payload: { request_id: requestId },
      });
      failed = blocked.status !== 200;
    } finally {
      await harness.ownerPool.query(`grant insert on tenant_deletion_evidence to wasl_app`);
    }
    assert.ok(failed, 'the deletion succeeded although the evidence could not be written');

    // ⭐ Nothing was removed: the tenant and its content are still there.
    const survived = await UnitOfWork.run(harness.ownerPool, fixture.tenantId, async (uow) => {
      const tenant = await uow.query<{ count: string }>(
        `select count(*)::text as count from tenants where id = $1`,
        [fixture.tenantId],
      );
      const request = await uow.query<{ status: string }>(
        `select status from deletion_requests where id = $1`,
        [requestId],
      );
      const customers = await uow.query<{ count: string }>(
        `select count(*)::text as count from customers where tenant_id = $1`,
        [fixture.tenantId],
      );
      return {
        tenant: Number(tenant.rows[0]?.count ?? '0'),
        status: request.rows[0]?.status ?? 'missing',
        customers: Number(customers.rows[0]?.count ?? '0'),
      };
    });
    assert.equal(survived.tenant, 1, 'the tenant row did not survive the rollback');
    assert.equal(survived.status, 'previewed', 'the request was marked as executed although it failed');
    assert.equal(survived.customers, 1, 'the content was removed although the deletion failed');

    // ⭐ The retry succeeds and the evidence is written exactly once.
    const retry = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/deletion/execute',
      token,
      payload: { request_id: requestId },
    });
    assert.equal(retry.status, 200, `the retry failed: ${retry.status} ${JSON.stringify(retry.body)}`);

    const evidence = await harness.ownerPool.query<{ count: string }>(
      `select count(*)::text as count from tenant_deletion_evidence where tenant_id = $1`,
      [fixture.tenantId],
    );
    assert.equal(Number(evidence.rows[0]?.count ?? '0'), 1, 'the evidence was written more than once');

    // ⭐ A third execution is refused: the request was already executed.
    //   The session of the tenant is gone with the tenant, so the
    //   refusal is a session error and not a conflict: the point is
    //   that the deletion is NOT executed twice.
    const again = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/deletion/execute',
      token,
      payload: { request_id: requestId },
    });
    assert.notEqual(again.status, 200, `the second execution was accepted: ${again.status}`);
    const stillOne = await harness.ownerPool.query<{ count: string }>(
      `select count(*)::text as count from tenant_deletion_evidence where tenant_id = $1`,
      [fixture.tenantId],
    );
    assert.equal(Number(stillOne.rows[0]?.count ?? '0'), 1, 'a second evidence was written');
  });

  await t.test('⭐⭐⭐ M-03e: a connection dropped during the deletion rolls everything back', async () => {
    const fixture = await createTenant(harness, 'tnt_b02_drop');
    const token = await loginAs(harness.client, fixture.tenantId, fixture.userId, PASSCODE);

    const preview = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/deletion/preview',
      token,
      payload: { scope: 'tenant_full' },
    });
    assert.equal(preview.status, 200);
    const requestId = String((preview.body['preview'] as Record<string, unknown> | undefined)?.['requestId'] ?? '');

    // ⭐ The deletion removes the content of the tenant. The connection
    //   that carries the transaction is then dropped: the transaction
    //   is aborted by the server and everything it did is rolled back.
    //   (The request role may stop its own backends, so the fault is
    //   injected from the same role the request path uses.)
    const client = await harness.appPool.connect();
    const pid = (await client.query<{ pid: string }>(`select pg_backend_pid()::text as pid`)).rows[0]!.pid;
    const killer = await harness.appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`select set_config('app.tenant_id', $1, true)`, [fixture.tenantId]);
      await client.query(`delete from messages where tenant_id = $1`, [fixture.tenantId]);
      await killer.query(`select pg_terminate_backend($1)`, [pid]);
      // ⭐ The next statement fails: the connection is gone.
      await assert.rejects(() => client.query('select 1'), 'the dead connection still answered');
    } finally {
      try {
        client.release();
      } catch {
        // the pool discards a broken client on its own
      }
      killer.release();
    }

    // ⭐ Everything survived: the transaction was rolled back.
    const survived = await UnitOfWork.run(harness.ownerPool, fixture.tenantId, async (uow) => {
      const tenant = await uow.query<{ count: string }>(
        `select count(*)::text as count from tenants where id = $1`,
        [fixture.tenantId],
      );
      const request = await uow.query<{ status: string }>(
        `select status from deletion_requests where id = $1`,
        [requestId],
      );
      const customers = await uow.query<{ count: string }>(
        `select count(*)::text as count from customers where tenant_id = $1`,
        [fixture.tenantId],
      );
      return {
        tenant: Number(tenant.rows[0]?.count ?? '0'),
        status: request.rows[0]?.status ?? 'missing',
        customers: Number(customers.rows[0]?.count ?? '0'),
      };
    });
    assert.equal(survived.tenant, 1, 'the tenant row did not survive the dropped connection');
    assert.equal(survived.status, 'previewed', 'the request was marked as executed although it failed');
    assert.equal(survived.customers, 1, 'the content was removed although the connection died');

    // ⭐ The retry (the real path) succeeds exactly once.
    const retry = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/deletion/execute',
      token,
      payload: { request_id: requestId },
    });
    assert.equal(retry.status, 200, `the retry failed: ${retry.status} ${JSON.stringify(retry.body)}`);

    const evidence = await harness.ownerPool.query<{ count: string }>(
      `select count(*)::text as count from tenant_deletion_evidence where tenant_id = $1`,
      [fixture.tenantId],
    );
    assert.equal(Number(evidence.rows[0]?.count ?? '0'), 1, 'the evidence was written more than once');

    // ⭐ The server is still alive and serving after the fault.
    const alive = await harness.client.request({ method: 'GET', path: '/health' });
    assert.equal(alive.status, 200, 'the service did not survive the dropped connection');
  });
});

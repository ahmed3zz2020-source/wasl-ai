// ============================================================
// WASL AI — FOUNDATION BUILD 03 / PHASE 01 (D-070)
// M-67: the protection of the login and of the server
// ------------------------------------------------------------
// ⭐ WHY THIS FILE EXISTS
//   In PHASE 01 the key derivation ran on the event loop
//   (`scryptSync`), so a burst of login attempts stopped the whole
//   server: the health check waited behind the derivations. The
//   counters were tenant scoped only, so an attack that spread the
//   guesses over many accounts never reached a ceiling. The role of
//   the session was a snapshot, so a role change did not take effect
//   until the session expired.
// ⭐ THE PROPERTIES UNDER TEST
//   - the derivation does not block the event loop,
//   - the platform budget SLOWS a distributed attack down (it does not
//     switch the users off any more: that is M-73),
//   - a spoofed X-Forwarded-For changes nothing,
//   - the live role of the membership is the authority,
//   - an expired / revoked / disabled session stops working,
//   - a flood of guesses does not stop the health check.
// ⛔ Local synthetic database only.
// ============================================================

import assert from 'node:assert/strict';
import test from 'node:test';

import { WaslApiServer } from '../../server/api/server.ts';
import { verifyPasscodeAsync, hashPasscodeAsync } from '../../server/auth/password.ts';
import { createPool } from '../../server/db/pool.ts';
import { UnitOfWork } from '../../server/db/unit-of-work.ts';
import { LocalApiClient } from '../../server/e2e/http-client.ts';
import { loginAs, startHarness } from './harness.ts';

const PASSCODE = process.env['WASL_TEST_PASSCODE'] ?? 'wasl-local-test';

test('FOUNDATION 13) the login protection and the server under pressure (M-67)', async (t) => {
  const harness = await startHarness();

  // ⭐ The global counter is shared by every test file: it is emptied
  //   before and after this file so the measurement is repeatable.
  const clearGlobalCounter = async (): Promise<void> => {
    await harness.ownerPool.query(`delete from login_attempts_global`);
  };
  await clearGlobalCounter();

  t.after(async () => {
    await clearGlobalCounter();
    await harness.stop();
  });

  await t.test('⭐⭐⭐ M-67a: the key derivation does not block the event loop', async () => {
    const stored = await hashPasscodeAsync(PASSCODE);
    assert.ok(stored.startsWith('scrypt$'), 'the asynchronous hash uses another format');

    // ⭐ The lag of a 10 ms timer is measured while the derivations run.
    const lags: number[] = [];
    let previous = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      lags.push(now - previous - 10);
      previous = now;
    }, 10);

    const started = Date.now();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => verifyPasscodeAsync(stored, PASSCODE)),
    );
    const elapsed = Date.now() - started;
    clearInterval(timer);

    assert.equal(results.filter(Boolean).length, 8, 'a derivation failed');
    const maxLag = lags.length > 0 ? Math.max(...lags) : 0;
    // ⭐ With the synchronous derivation the event loop would be blocked
    //   for the whole burst (8 x ~50 ms) and the lag would grow with it.
    assert.ok(
      maxLag < 250,
      `the event loop was blocked for ${maxLag} ms during the derivations (${elapsed} ms in total)`,
    );
    // ⭐ The asynchronous derivation produces the SAME hash format, so
    //   the existing synthetic passcodes keep working.
    assert.equal(
      (await import('../../server/auth/password.ts')).verifyPasscode(stored, PASSCODE),
      true,
      'the synchronous verifier does not accept the asynchronous hash',
    );
  });

  await t.test('⭐⭐⭐ M-67b: the platform budget slows a distributed attack down', async () => {
    await clearGlobalCounter();
    // ⭐ The tenant scoped counters of the other test files are
    //   emptied too: the measurement must depend on this test only.
    //   ⛔ The delete runs inside the tenant context: the table has
    //     the row level security FORCED, so a statement without the
    //     context sees zero rows and deletes nothing.
    await UnitOfWork.run(harness.ownerPool, 'tnt_alpha', async (uow) => {
      await uow.query(`delete from login_attempts`);
    });

    // ⭐ A dedicated instance with a small platform budget: the guess
    //   is spread over MANY accounts, so the account budget of each one
    //   is never reached.
    const pool = createPool(harness.config.appDatabaseUrl, 4);
    const config = {
      ...harness.config,
      port: harness.port + 3,
      rateLimit: {
        maxAccountAttempts: 5,
        maxTenantAttempts: 20,
        // ⭐⭐ D-070 / M-73: the platform budget is the trigger of the
        //   degraded mode, not a refusal.
        maxGlobalAttempts: 3,
        maxPeerAttempts: 0,
        windowSeconds: 300,
        trustPeerAddress: false,
        globalRatePerSecond: 20,
        globalBurst: 40,
        tenantRatePerSecond: 10,
        tenantBurst: 20,
        degradedWaitMs: 300,
        maxWaitMs: 30_000,
      },
    };
    const api = new WaslApiServer({ config, pool });
    const address = await api.listen();
    const client = new LocalApiClient('127.0.0.1', address.port);
    try {
      const accounts = ['usr_alpha_agent', 'usr_alpha_viewer', 'usr_alpha_super'];
      for (const account of accounts) {
        const failed = await client.request({
          method: 'POST',
          path: '/api/session',
          payload: { tenant_id: 'tnt_alpha', user_id: account, passcode: `${PASSCODE}-wrong` },
        });
        assert.equal(failed.status, 401, `the guess was not refused: ${failed.status}`);
      }

      // ⭐⭐ D-070 / M-73: the platform budget is exhausted, so the
      //   platform is in the DEGRADED MODE. ⭐ The legitimate user with
      //   the CORRECT passcode is NOT switched off any more: the
      //   attempt waits (the flood is slowed down) and it succeeds.
      //   ⛔ The old behaviour of D-069 (a blanket 429 for everybody)
      //     is exactly the defect that M-73 closes.
      const started = Date.now();
      const allowed = await client.request({
        method: 'POST',
        path: '/api/session',
        payload: { tenant_id: 'tnt_alpha', user_id: 'usr_alpha_owner', passcode: PASSCODE },
      });
      const waited = Date.now() - started;
      assert.equal(
        allowed.status,
        200,
        `the legitimate user was switched off by the platform budget: ${allowed.status}`,
      );
      assert.ok(
        typeof allowed.body['token'] === 'string' && allowed.body['token'] !== '',
        'the legitimate login returned no token',
      );
      // ⭐ The degraded mode really slowed the attempt down.
      assert.ok(
        waited >= 300,
        `the degraded mode did not slow the attempt down: ${waited} ms`,
      );
    } finally {
      await api.close();
      await pool.end();
      await clearGlobalCounter();
    }
  });

  await t.test('⭐⭐⭐ M-67c: a spoofed X-Forwarded-For changes nothing', async () => {
    await clearGlobalCounter();

    const spoofed = await harness.client.request({
      method: 'POST',
      path: '/api/session',
      payload: { tenant_id: 'tnt_alpha', user_id: 'usr_alpha_viewer', passcode: `${PASSCODE}-wrong` },
      headers: { 'x-forwarded-for': '203.0.113.7', 'x-real-ip': '198.51.100.9' },
    });
    assert.equal(spoofed.status, 401, 'the guess was not refused');

    // ⭐ The stored peer address is the address of the SOCKET, never the
    //   value of a header sent by the client.
    const stored = await harness.ownerPool.query<{ peer_address: string | null }>(
      `select peer_address from login_attempts_global where user_id = $1 limit 1`,
      ['usr_alpha_viewer'],
    );
    const row = stored.rows[0];
    assert.ok(row, 'the attempt was not recorded');
    assert.ok(
      row.peer_address === null || row.peer_address === '127.0.0.1',
      `a client sent address was trusted: ${String(row.peer_address)}`,
    );
    await UnitOfWork.run(harness.ownerPool, 'tnt_alpha', async (uow) => {
      await uow.query(`delete from login_attempts where user_id = $1`, ['usr_alpha_viewer']);
    });
    await clearGlobalCounter();
  });

  await t.test('⭐⭐⭐ M-67d: the live role of the membership is the authority', async () => {
    const token = await loginAs(harness.client, 'tnt_alpha', 'usr_alpha_agent', PASSCODE);

    // ⭐ The agent may not export the data of the company.
    const before = await harness.client.request({
      method: 'POST',
      path: '/api/privacy/export',
      token,
    });
    assert.equal(before.status, 403, `the agent was allowed to export: ${before.status}`);

    // ⭐ The membership is promoted: the NEXT request must use the new
    //   role, without waiting for the session to expire.
    await UnitOfWork.run(harness.ownerPool, 'tnt_alpha', async (uow) => {
      await uow.query(`update memberships set role = 'owner' where user_id = $1`, [
        'usr_alpha_agent',
      ]);
    });
    try {
      const after = await harness.client.request({
        method: 'POST',
        path: '/api/privacy/export',
        token,
      });
      assert.equal(
        after.status,
        200,
        `the new role did not take effect: ${after.status} ${JSON.stringify(after.body)}`,
      );
    } finally {
      await UnitOfWork.run(harness.ownerPool, 'tnt_alpha', async (uow) => {
        await uow.query(`update memberships set role = 'agent' where user_id = $1`, [
          'usr_alpha_agent',
        ]);
      });
    }
  });

  await t.test('⭐⭐ M-67e: an expired, a revoked and a disabled session stop working', async () => {
    // ⭐ The revocation.
    const revokedToken = await loginAs(harness.client, 'tnt_alpha', 'usr_alpha_viewer', PASSCODE);
    const revoked = await harness.client.request({
      method: 'DELETE',
      path: '/api/session',
      token: revokedToken,
    });
    assert.equal(revoked.status, 200, 'the logout failed');
    const afterRevoke = await harness.client.request({
      method: 'GET',
      path: '/api/session',
      token: revokedToken,
    });
    assert.equal(afterRevoke.status, 401, `the revoked session still works: ${afterRevoke.status}`);

    // ⭐ The expiry.
    const expiringToken = await loginAs(harness.client, 'tnt_alpha', 'usr_alpha_viewer', PASSCODE);
    await UnitOfWork.run(harness.ownerPool, 'tnt_alpha', async (uow) => {
      await uow.query(`update sessions set expires_at = now() - interval '1 minute' where token_hash = (
        select token_hash from sessions where id = (split_part($1, '.', 3)) and tenant_id = $2
      )`, [expiringToken, 'tnt_alpha']);
    });
    const afterExpiry = await harness.client.request({
      method: 'GET',
      path: '/api/session',
      token: expiringToken,
    });
    assert.equal(afterExpiry.status, 401, `the expired session still works: ${afterExpiry.status}`);

    // ⭐ The disabled user.
    const disabledToken = await loginAs(harness.client, 'tnt_alpha', 'usr_alpha_viewer', PASSCODE);
    await UnitOfWork.run(harness.ownerPool, 'tnt_alpha', async (uow) => {
      await uow.query(`update users set status = 'disabled' where id = $1`, ['usr_alpha_viewer']);
    });
    try {
      const afterDisable = await harness.client.request({
        method: 'GET',
        path: '/api/session',
        token: disabledToken,
      });
      assert.equal(afterDisable.status, 403, `the disabled user still works: ${afterDisable.status}`);
    } finally {
      await UnitOfWork.run(harness.ownerPool, 'tnt_alpha', async (uow) => {
        await uow.query(`update users set status = 'active' where id = $1`, ['usr_alpha_viewer']);
      });
    }

    // ⭐ The revoked membership.
    const revokedMembershipToken = await loginAs(
      harness.client,
      'tnt_alpha',
      'usr_alpha_viewer',
      PASSCODE,
    );
    await UnitOfWork.run(harness.ownerPool, 'tnt_alpha', async (uow) => {
      await uow.query(`update memberships set status = 'revoked' where user_id = $1`, [
        'usr_alpha_viewer',
      ]);
    });
    try {
      const afterRevokeMembership = await harness.client.request({
        method: 'GET',
        path: '/api/session',
        token: revokedMembershipToken,
      });
      assert.ok(
        afterRevokeMembership.status === 401 || afterRevokeMembership.status === 403,
        `the revoked membership still works: ${afterRevokeMembership.status}`,
      );
      const revokeCode = String(
        (afterRevokeMembership.body['error'] as Record<string, unknown> | undefined)?.['code'] ?? '',
      );
      assert.equal(
        revokeCode,
        'membership_revoked',
        `the refusal carries an unexpected code: ${revokeCode}`,
      );
    } finally {
      await UnitOfWork.run(harness.ownerPool, 'tnt_alpha', async (uow) => {
        await uow.query(`update memberships set status = 'active' where user_id = $1`, [
          'usr_alpha_viewer',
        ]);
      });
    }
  });

  await t.test('⭐⭐⭐ M-67f: a flood of guesses does not stop the health check', async () => {
    await clearGlobalCounter();
    await harness.ownerPool.query(`delete from login_attempts`);

    // ⭐ The guesses and the health checks run at the same time.
    const guesses = Array.from({ length: 12 }, (_unused, index) =>
      harness.client.request({
        method: 'POST',
        path: '/api/session',
        payload: {
          tenant_id: 'tnt_alpha',
          user_id: 'usr_alpha_agent',
          passcode: `${PASSCODE}-wrong-${index}`,
        },
      }),
    );
    const healths = Array.from({ length: 12 }, () => {
      const started = Date.now();
      return harness.client
        .request({ method: 'GET', path: '/health' })
        .then((response) => ({ response, duration: Date.now() - started }));
    });
    const [guessResults, healthResults] = await Promise.all([Promise.all(guesses), Promise.all(healths)]);

    for (const result of guessResults) {
      assert.ok(result.status === 401 || result.status === 429, `unexpected guess status: ${result.status}`);
    }
    let slowest = 0;
    for (const result of healthResults) {
      assert.equal(result.response.status, 200, `the health check failed: ${result.response.status}`);
      assert.equal(result.response.body['db_ok'], true, 'the health check does not see the database');
      slowest = Math.max(slowest, result.duration);
    }
    // ⭐ The health check answered while the derivations were running.
    assert.ok(
      slowest < 3000,
      `the health check waited ${slowest} ms for the key derivations to finish`,
    );
    await UnitOfWork.run(harness.ownerPool, 'tnt_alpha', async (uow) => {
      await uow.query(`delete from login_attempts`);
    });
    await clearGlobalCounter();
  });
});

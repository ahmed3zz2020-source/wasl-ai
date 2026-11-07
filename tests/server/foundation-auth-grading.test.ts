// ============================================================
// WASL AI — FOUNDATION BUILD 03 / PHASE 01 (D-070) — M-73
// the graded login protection: slow down, do not switch off
// ------------------------------------------------------------
// ⭐⭐ THE DEFECT THAT IS CLOSED HERE
//   D-069 (M-67) refused EVERY login of the installation when the
//   platform wide budget was exhausted. ⭐ An attacker who spent that
//   budget therefore switched every user off, for the rest of the
//   window, including the users who knew the correct passcode.
// ⭐⭐ THE GRADED POLICY UNDER TEST
//   1) the ACCOUNT budget refuses the GUESSES of one account,
//   2) the TENANT budget refuses the GUESSES of one company,
//   3) the PLATFORM budget puts the platform in the DEGRADED MODE:
//      the attempts wait longer, they are NOT refused,
//   4) the ADMISSION BUCKETS bound the number of key derivations per
//      second, on the installation AND on every company,
//   5) the last resort: a wait longer than the ceiling is refused and
//      the answer says the platform is saturated.
// ⛔ Local synthetic database only.
// ⛔ No header is trusted: the peer address is the one of the socket.
// ============================================================

import assert from 'node:assert/strict';
import test from 'node:test';

import { WaslApiServer } from '../../server/api/server.ts';
import { createPool, type PgPool } from '../../server/db/pool.ts';
import { UnitOfWork } from '../../server/db/unit-of-work.ts';
import { LocalApiClient } from '../../server/e2e/http-client.ts';
import { startHarness, type Harness, withPlatformBudgetLock } from './harness.ts';

// ⭐⭐ D-072 / M-82: the companies of THIS file (the namespace) ⇐
//   ⭐⭐ no other file can touch their rows ⇐ ⭐⭐ the result of the
//   ⭐⭐ file never depends on the order of the files.
const NS = 'agr';


const PASSCODE = process.env['WASL_TEST_PASSCODE'] ?? 'wasl-local-test';

interface RateLimitOverrides {
  readonly maxAccountAttempts?: number;
  readonly maxTenantAttempts?: number;
  readonly maxGlobalAttempts?: number;
  readonly maxPeerAttempts?: number;
  readonly trustPeerAddress?: boolean;
  readonly globalRatePerSecond?: number;
  readonly globalBurst?: number;
  readonly tenantRatePerSecond?: number;
  readonly tenantBurst?: number;
  readonly degradedWaitMs?: number;
  readonly maxWaitMs?: number;
}

/** ⭐ Start a dedicated instance with a specific protection policy. */
async function startWithPolicy(
  harness: Harness,
  port: number,
  overrides: RateLimitOverrides,
): Promise<{ client: LocalApiClient; pool: PgPool; close: () => Promise<void> }> {
  const pool = createPool(harness.config.appDatabaseUrl, 8);
  const base = harness.config.rateLimit;
  const config = {
    ...harness.config,
    port,
    rateLimit: {
      ...base,
      maxAccountAttempts: overrides.maxAccountAttempts ?? base.maxAccountAttempts,
      maxTenantAttempts: overrides.maxTenantAttempts ?? base.maxTenantAttempts,
      maxGlobalAttempts: overrides.maxGlobalAttempts ?? base.maxGlobalAttempts,
      maxPeerAttempts: overrides.maxPeerAttempts ?? base.maxPeerAttempts,
      trustPeerAddress: overrides.trustPeerAddress ?? base.trustPeerAddress,
      globalRatePerSecond: overrides.globalRatePerSecond ?? base.globalRatePerSecond,
      globalBurst: overrides.globalBurst ?? base.globalBurst,
      tenantRatePerSecond: overrides.tenantRatePerSecond ?? base.tenantRatePerSecond,
      tenantBurst: overrides.tenantBurst ?? base.tenantBurst,
      degradedWaitMs: overrides.degradedWaitMs ?? base.degradedWaitMs,
      maxWaitMs: overrides.maxWaitMs ?? base.maxWaitMs,
    },
  };
  const api = new WaslApiServer({ config, pool });
  const address = await api.listen();
  return {
    client: new LocalApiClient('127.0.0.1', address.port),
    pool,
    close: async () => {
      await api.close();
      await pool.end();
    },
  };
}

test('FOUNDATION 17) the login protection is graded and never switches the users off (M-73)', async (t) => {
  const harness = await startHarness({ namespace: NS });
  // ⭐⭐ D-072 / M-82: this file MEASURES the platform budget ⇐ ⭐⭐ the
  //   platform budget is ONE resource of the installation (D-070) ⇒ ⭐⭐
  //   the measurement takes a lock ⇒ ⭐⭐ the other files keep running
  //   in parallel, and the measurement is NOT shared with another one.
  await withPlatformBudgetLock(harness.ownerPool, async () => {

  const clearGlobalCounter = async (): Promise<void> => {
    await harness.ownerPool.query(`delete from login_attempts_global`);
  };
  const clearTenantCounter = async (): Promise<void> => {
    for (const tenantId of [`${NS}_tnt_alpha`, `${NS}_tnt_beta`, `${NS}_tnt_gamma`]) {
      await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
        await uow.query(`delete from login_attempts`);
      });
    }
  };
  const clearAdmission = async (): Promise<void> => {
    // ⭐ The buckets are put back to their cold state: a bucket that
    //   was never used is FULL.
    await harness.ownerPool.query(
      `update login_admission_global set tokens = 0, updated_at = now(), initialized = false`,
    );
    await harness.ownerPool.query(
      `update login_admission_tenant set tokens = 0, updated_at = now(), initialized = false`,
    );
  };
  const reset = async (): Promise<void> => {
    await clearGlobalCounter();
    await clearTenantCounter();
    await clearAdmission();
  };
  // ⭐ The cleanup is registered BEFORE the first reset: a failure in
  //   the setup must not leave the server and the pools behind.
  t.after(async () => {
    await reset().catch(() => undefined);
    await harness.stop();
  });
  await reset();

  await t.test('⭐⭐⭐ M-73a: the attacker spends the platform budget and the legitimate user still gets in', async () => {
    await reset();
    const instance = await startWithPolicy(harness, harness.port + 11, {
      maxGlobalAttempts: 3,
      degradedWaitMs: 400,
      globalRatePerSecond: 50,
      globalBurst: 100,
      tenantRatePerSecond: 50,
      tenantBurst: 100,
    });
    try {
      // ⭐⭐ The attack: the guesses are spread over MANY accounts, so
      //   the budget of no single account is reached.
      const accounts = [`${NS}_usr_alpha_agent`, `${NS}_usr_alpha_viewer`, `${NS}_usr_alpha_super`, `${NS}_usr_alpha_owner`];
      for (const account of accounts) {
        const failed = await instance.client.request({
          method: 'POST',
          path: '/api/session',
          payload: { tenant_id: `${NS}_tnt_alpha`, user_id: account, passcode: `${PASSCODE}-wrong` },
        });
        assert.equal(failed.status, 401, `the guess was not refused: ${failed.status}`);
      }

      // ⭐⭐ The platform budget is spent: the platform is in the
      //   degraded mode now.
      const started = Date.now();
      const allowed = await instance.client.request({
        method: 'POST',
        path: '/api/session',
        payload: { tenant_id: `${NS}_tnt_alpha`, user_id: `${NS}_usr_alpha_agent`, passcode: PASSCODE },
      });
      const waited = Date.now() - started;
      assert.equal(
        allowed.status,
        200,
        `the legitimate user was switched off: ${allowed.status} ${JSON.stringify(allowed.body)}`,
      );
      assert.ok(
        typeof allowed.body['token'] === 'string' && allowed.body['token'] !== '',
        'the legitimate login returned no token',
      );
      // ⭐ The degraded mode really slowed the attempt down.
      assert.ok(waited >= 400, `the degraded mode did not slow the attempt down: ${waited} ms`);
    } finally {
      await instance.close();
    }
  });

  await t.test('⭐⭐⭐ M-73b: the account budget still refuses the guesses and never the owner', async () => {
    await reset();
    const instance = await startWithPolicy(harness, harness.port + 12, {
      maxAccountAttempts: 3,
      maxTenantAttempts: 100,
      maxGlobalAttempts: 1000,
      degradedWaitMs: 0,
    });
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const failed = await instance.client.request({
          method: 'POST',
          path: '/api/session',
          payload: { tenant_id: `${NS}_tnt_alpha`, user_id: `${NS}_usr_alpha_agent`, passcode: `${PASSCODE}-wrong` },
        });
        assert.equal(failed.status, 401, `the guess was not refused: ${failed.status}`);
      }
      // ⭐ The budget of the account is spent: the next GUESS is
      //   refused with the declared code.
      const refused = await instance.client.request({
        method: 'POST',
        path: '/api/session',
        payload: { tenant_id: `${NS}_tnt_alpha`, user_id: `${NS}_usr_alpha_agent`, passcode: `${PASSCODE}-wrong` },
      });
      assert.equal(refused.status, 429, `the guess was not refused: ${refused.status}`);
      const code = String((refused.body['error'] as Record<string, unknown> | undefined)?.['code'] ?? '');
      assert.equal(code, 'login_rate_limited', `the refusal carries an unexpected code: ${code}`);

      // ⭐⭐ The CORRECT passcode of the same account is still accepted:
      //   an attack cannot lock the owner out.
      const allowed = await instance.client.request({
        method: 'POST',
        path: '/api/session',
        payload: { tenant_id: `${NS}_tnt_alpha`, user_id: `${NS}_usr_alpha_agent`, passcode: PASSCODE },
      });
      assert.equal(allowed.status, 200, `the owner was locked out: ${allowed.status}`);
    } finally {
      await instance.close();
    }
  });

  await t.test('⭐⭐⭐ M-73c: one company cannot spend the budget of another company', async () => {
    await reset();
    const instance = await startWithPolicy(harness, harness.port + 13, {
      maxAccountAttempts: 100,
      maxTenantAttempts: 100,
      maxGlobalAttempts: 1000,
      degradedWaitMs: 0,
      // ⭐ The bucket of ONE company is slow: the flood of the first
      //   company is throttled by its own bucket.
      tenantRatePerSecond: 1,
      tenantBurst: 1,
      // ⭐ The global bucket is generous: the ceiling of the CPU is
      //   tested in the next case.
      globalRatePerSecond: 100,
      globalBurst: 200,
    });
    try {
      // ⭐⭐ The attack on the first company: four guesses at once.
      //   ⭐ The flood is NOT awaited: the second company tries to log
      //     in WHILE the flood is running.
      const flood = [1, 2, 3, 4].map((index) =>
        instance.client.request({
          method: 'POST',
          path: '/api/session',
          payload: {
            tenant_id: `${NS}_tnt_alpha`,
            user_id: `${NS}_usr_alpha_agent`,
            passcode: `${PASSCODE}-wrong-${index}`,
          },
        }),
      );

      // ⭐⭐ The SECOND company is not affected: its own bucket is
      //   untouched, so the login is immediate.
      const started = Date.now();
      const other = await instance.client.request({
        method: 'POST',
        path: '/api/session',
        payload: { tenant_id: `${NS}_tnt_beta`, user_id: `${NS}_usr_beta_owner`, passcode: PASSCODE },
      });
      const waited = Date.now() - started;
      assert.equal(other.status, 200, `the second company was blocked: ${other.status}`);
      assert.ok(
        waited < 700,
        `the second company was slowed down by the flood of the first one: ${waited} ms`,
      );
      await Promise.all(flood);
    } finally {
      await instance.close();
    }
  });

  await t.test('⭐⭐⭐ M-73d: the number of key derivations per second is bounded', async () => {
    await reset();
    const instance = await startWithPolicy(harness, harness.port + 14, {
      maxAccountAttempts: 100,
      maxTenantAttempts: 100,
      maxGlobalAttempts: 1000,
      degradedWaitMs: 0,
      // ⭐⭐ The ceiling of the CPU: two derivations per second and no
      //   burst at all.
      globalRatePerSecond: 2,
      globalBurst: 1,
      tenantRatePerSecond: 100,
      tenantBurst: 100,
      maxWaitMs: 60_000,
    });
    try {
      const started = Date.now();
      const attempts = await Promise.all(
        [1, 2, 3, 4, 5].map(() =>
          instance.client.request({
            method: 'POST',
            path: '/api/session',
            payload: { tenant_id: `${NS}_tnt_alpha`, user_id: `${NS}_usr_alpha_agent`, passcode: PASSCODE },
          }),
        ),
      );
      const elapsed = Date.now() - started;
      for (const attempt of attempts) {
        assert.equal(attempt.status, 200, `a legitimate login was refused: ${attempt.status}`);
      }
      // ⭐⭐ Five derivations at two per second cannot finish in less
      //   than about two seconds: the ceiling is real.
      assert.ok(
        elapsed >= 1500,
        `the derivations were not bounded: five attempts took ${elapsed} ms`,
      );
    } finally {
      await instance.close();
    }
  });

  await t.test('⭐⭐⭐ M-73e: the last resort refuses with a declared code', async () => {
    await reset();
    const instance = await startWithPolicy(harness, harness.port + 15, {
      maxAccountAttempts: 100,
      maxTenantAttempts: 100,
      maxGlobalAttempts: 1000,
      degradedWaitMs: 0,
      globalRatePerSecond: 1,
      globalBurst: 1,
      tenantRatePerSecond: 100,
      tenantBurst: 100,
      // ⭐ No wait at all is tolerated: the saturation is refused.
      maxWaitMs: 0,
    });
    try {
      const first = await instance.client.request({
        method: 'POST',
        path: '/api/session',
        payload: { tenant_id: `${NS}_tnt_alpha`, user_id: `${NS}_usr_alpha_agent`, passcode: PASSCODE },
      });
      assert.equal(first.status, 200, `the first login was refused: ${first.status}`);
      // ⭐⭐ The second one has to wait a whole second, and the ceiling
      //   is zero: the answer is the declared saturation.
      const second = await instance.client.request({
        method: 'POST',
        path: '/api/session',
        payload: { tenant_id: `${NS}_tnt_alpha`, user_id: `${NS}_usr_alpha_agent`, passcode: PASSCODE },
      });
      assert.equal(second.status, 429, `the saturation was not refused: ${second.status}`);
      const code = String((second.body['error'] as Record<string, unknown> | undefined)?.['code'] ?? '');
      assert.equal(
        code,
        'login_platform_saturated',
        `the refusal carries an unexpected code: ${code}`,
      );
    } finally {
      await instance.close();
    }
  });

  await t.test('⭐⭐⭐ M-73f: a spoofed header does not buy a fresh budget', async () => {
    await reset();
    const instance = await startWithPolicy(harness, harness.port + 16, {
      maxAccountAttempts: 100,
      maxTenantAttempts: 100,
      maxGlobalAttempts: 1000,
      degradedWaitMs: 0,
      maxPeerAttempts: 2,
      trustPeerAddress: true,
      globalRatePerSecond: 100,
      globalBurst: 200,
      tenantRatePerSecond: 100,
      tenantBurst: 200,
    });
    try {
      // ⭐⭐ Every guess carries a DIFFERENT header: the peer budget
      //   counts the address of the SOCKET, so the header changes
      //   nothing and the budget is spent all the same.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const failed = await instance.client.request({
          method: 'POST',
          path: '/api/session',
          headers: { 'x-forwarded-for': `10.0.0.${attempt + 1}` },
          payload: { tenant_id: `${NS}_tnt_alpha`, user_id: `${NS}_usr_alpha_agent`, passcode: `${PASSCODE}-wrong` },
        });
        assert.ok(
          failed.status === 401 || failed.status === 429,
          `the guess was answered in an unexpected way: ${failed.status}`,
        );
      }
      const refused = await instance.client.request({
        method: 'POST',
        path: '/api/session',
        headers: { 'x-forwarded-for': '10.0.0.99' },
        payload: { tenant_id: `${NS}_tnt_alpha`, user_id: `${NS}_usr_alpha_agent`, passcode: `${PASSCODE}-wrong` },
      });
      assert.equal(refused.status, 429, `the peer budget did not answer: ${refused.status}`);
      const code = String((refused.body['error'] as Record<string, unknown> | undefined)?.['code'] ?? '');
      assert.equal(code, 'login_rate_limited', `the refusal carries an unexpected code: ${code}`);
    } finally {
      await instance.close();
    }
  });
  });
});

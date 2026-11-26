// ============================================================
// WASL AI — FOUNDATION BUILD 02 — the hardening of the wave
// ------------------------------------------------------------
// ⭐ Every drill here answers ONE review finding with a MEASURED
//   behaviour ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ no finding is closed by a reading.
// ⭐ The findings (the review of the wave · `pf-24`):
//   #1 — the raw text of the engine used to reach the client.
//   #4 — `limit` / `offset` without a numeric guard (two paths of three).
//   #5 — the secret of the owner of the tables fell back to the secret
//        of the application.
//   #6 — `app.actor_id` was written as `system` in EVERY transaction.
//   #7 — the health endpoint published the ceilings of the protection.
//   #8 — the fixture passcode was written inside the HTML of the console.
// ⛔ Local synthetic database only.
// ⛔ The findings #2, #3 and #9 are NOT here: they are decisions of
//   the owner (the scope of the role), not fixes of code.
// ============================================================

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadConfig } from '../../server/config.ts';
import { WaslApiServer, clientCodeOf, clientMessageOf } from '../../server/api/server.ts';
import { createPool } from '../../server/db/pool.ts';
import { UnitOfWork } from '../../server/db/unit-of-work.ts';
import { LocalApiClient } from '../../server/e2e/http-client.ts';
import { startHarness, loginAs, resetSyntheticData, type Harness } from './harness.ts';

const NS = 'w2h';
const PASSCODE = process.env['WASL_TEST_PASSCODE'] ?? 'wasl-local-test';

test('FOUNDATION 2) the hardening of the wave — the six findings that are code', async (t) => {
  const harness: Harness = await startHarness({ namespace: NS });
  t.after(async () => {
    await harness.stop();
  });
  await resetSyntheticData(harness.ownerPool, PASSCODE, ['tnt_alpha', 'tnt_beta', 'tnt_gamma'], NS);

  const owner = await loginAs(harness.client, `${NS}_tnt_alpha`, `${NS}_usr_alpha_owner`, PASSCODE);

  await t.test('⭐ #1: the raw text of the engine NEVER reaches the client', async () => {
    // ⭐⭐ The three paths that used to leak the text of PostgreSQL.
    const leaks: string[] = [];
    for (const path of [
      '/api/tickets?limit=abc',
      '/api/inbox/conversations?offset=abc',
      '/api/crm/customers?limit=abc',
    ]) {
      const response = await harness.client.request({ method: 'GET', path, token: owner });
      const text = JSON.stringify(response.body);
      assert.ok(
        !text.includes('invalid input syntax') &&
          !text.includes('22P02') &&
          !text.includes('NaN'),
        `the engine text leaked through ${path}: ${text}`,
      );
      leaks.push(`${path} => ${response.status}`);
    }
    assert.ok(leaks.length === 3);

    // ⭐⭐ A declared failure keeps its declared code ⇒ ⇒ (the answer
    //   stays useful without carrying the internals).
    const denied = await harness.client.request({
      method: 'GET',
      path: '/api/conversations/conv_that_does_not_exist',
      token: owner,
    });
    assert.equal(denied.status, 404);
    const error = denied.body['error'] as Record<string, unknown>;
    assert.equal(error['code'], 'conversation_not_found');
    // ⭐⭐ The message of THAT answer is the ref of the client ⇒ ⇒ ⇒ ⇒
    //   ⇒ ⇒ (its own input, not an internal) ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒.
    assert.equal(error['message'], 'conv_that_does_not_exist');
  });

  await t.test('⭐ #1b: the guard itself — the raw text is mapped to a declared answer', () => {
    // ⭐⭐⭐ THE GUARD IS THE BOUNDARY ⇒ ⇒ ⇒ ⇒ ⇒ so it is measured
    //   DIRECTLY ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ (not only through the paths).
    const engine = new Error('invalid input syntax for type bigint: "NaN"');
    assert.equal(clientMessageOf(engine, 400), 'invalid_request');
    assert.equal(clientMessageOf(engine, 500), 'internal_error');
    assert.equal(clientCodeOf(engine, 400), 'invalid_request');
    assert.equal(clientCodeOf(engine, 500), 'internal_error');
    assert.equal(clientCodeOf({ code: '22P02' } as unknown, 400), 'database_error');
    assert.equal(clientCodeOf({ code: '23505' } as unknown, 409), 'database_error');
    // ⭐⭐ A DECLARED token of ours passes ⇒ ⇒ ⇒ (the answer stays
    //   useful ⇒ ⇒ ⇒ ⇒ and the internals never travel).
    assert.equal(clientMessageOf(new Error('json_invalid'), 400), 'json_invalid');
    assert.equal(clientCodeOf(new Error('json_invalid'), 400), 'json_invalid');
    assert.equal(clientMessageOf(new Error('conversation_not_found'), 404), 'conversation_not_found');
  });

  await t.test('⭐ #4: the three paging paths share ONE numeric guard', async () => {
    // ⭐⭐ The same wrong input on the three paths ⇒ ⇒ ⇒ the same answer
    //   ⇒ ⇒ ⇒ (the guard lives in ONE place now).
    for (const path of ['/api/tickets?limit=abc', '/api/inbox/conversations?limit=abc', '/api/crm/customers?limit=abc']) {
      const response = await harness.client.request({ method: 'GET', path, token: owner });
      assert.equal(response.status, 200, `${path} refused a bad limit instead of using the default`);
    }
    // ⭐⭐ A bad offset is the default too ⇒ ⇒ ⇒ never an error.
    const offset = await harness.client.request({
      method: 'GET',
      path: '/api/tickets?offset=abc',
      token: owner,
    });
    assert.equal(offset.status, 200);
    // ⭐⭐ A GOOD number still works ⇒ ⇒ ⇒ (the guard did not break
    //   the happy path).
    const good = await harness.client.request({
      method: 'GET',
      path: '/api/tickets?limit=5&offset=0',
      token: owner,
    });
    assert.equal(good.status, 200);
    // ⭐⭐ A FRACTION is a whole number ⇒ ⇒ ⇒ (never an engine error).
    const fraction = await harness.client.request({
      method: 'GET',
      path: '/api/tickets?limit=2.5',
      token: owner,
    });
    assert.equal(fraction.status, 200);
    // ⭐⭐ A HUGE number is finite ⇒ ⇒ ⇒ ⇒ and the ceiling of the query
    //   layer holds it ⇒ ⇒ ⇒ ⇒ ⇒ (never an engine error).
    const huge = await harness.client.request({
      method: 'GET',
      path: '/api/tickets?limit=1e308',
      token: owner,
    });
    assert.equal(huge.status, 200);
    // ⭐⭐ An INFINITY is not finite ⇒ ⇒ ⇒ ⇒ ⇒ (the default).
    const infinite = await harness.client.request({
      method: 'GET',
      path: '/api/tickets?limit=1e400',
      token: owner,
    });
    assert.equal(infinite.status, 200);
    // ⭐⭐ A NEGATIVE page is not a page ⇒ ⇒ ⇒ ⇒ ⇒ (the default).
    const negative = await harness.client.request({
      method: 'GET',
      path: '/api/tickets?offset=-5',
      token: owner,
    });
    assert.equal(negative.status, 200);
  });

  await t.test('⭐ #5: the secret of the owner NEVER falls back to the secret of the app', async () => {
    // ⭐⭐ An empty root ⇒ ⇒ ⇒ no credential file ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ so the
    //   ONLY source of the secrets is the environment ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ and
    //   the drill measures the FALLBACK and nothing else.
    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wasl-w2h-config-'));
    const appSecret = 'app-secret-of-the-drill';
    try {
      const env = { ...process.env, WASL_PG_PASSWORD: appSecret };
      delete env['WASL_PG_OWNER_PASSWORD'];

      // ⭐⭐ Without the secret of the owner ⇒ ⇒ ⇒ there is NO owner URL
      //   ⇒ ⇒ ⇒ ⇒ (the application secret is not a stand-in).
      const withoutOwner = loadConfig(env, emptyRoot, { profile: 'test', requirePassword: false });
      assert.equal(
        withoutOwner.ownerDatabaseUrl,
        null,
        'the owner url was built without the secret of the owner',
      );
      assert.ok(withoutOwner.appDatabaseUrl.includes('wasl_app'));
      assert.ok(withoutOwner.appDatabaseUrl.includes(appSecret));

      // ⭐⭐ With the secret ⇒ ⇒ ⇒ the owner URL exists and carries ITS
      //   OWN secret ⇒ ⇒ ⇒ ⇒ and never the secret of the application.
      const ownerSecret = 'owner-secret-of-the-drill';
      const withOwner = loadConfig(
        { ...env, WASL_PG_OWNER_PASSWORD: ownerSecret },
        emptyRoot,
        { profile: 'test', requirePassword: false },
      );
      assert.ok(withOwner.ownerDatabaseUrl !== null);
      assert.ok(withOwner.ownerDatabaseUrl.includes('wasl_owner'));
      assert.ok(
        withOwner.ownerDatabaseUrl.includes(ownerSecret),
        'the owner url does not carry the secret of the owner',
      );
      assert.ok(
        !withOwner.ownerDatabaseUrl.includes(appSecret),
        'the owner url carries the secret of the application',
      );
    } finally {
      fs.rmSync(emptyRoot, { recursive: true, force: true });
    }
  });

  await t.test('⭐ #6: `app.actor_id` is NOT written any more ⇒ and the real actor is in the column', async () => {
    // ⭐⭐ Inside a transaction of the product ⇒ ⇒ ⇒ the context holds
    //   NO actor ⇒ ⇒ ⇒ ⇒ (the variable carried no meaning before).
    const inside = await UnitOfWork.run(harness.appPool, `${NS}_tnt_alpha`, async (uow) => {
      const result = await uow.query<{ actor: string | null }>(
        `select current_setting('app.actor_id', true) as actor`,
      );
      return result.rows[0]?.actor ?? null;
    });
    assert.equal(inside, null, 'the context still carries an actor');

    // ⭐⭐ The tenant context is still there ⇒ ⇒ ⇒ (the guard of the
    //   isolation was NOT touched).
    const tenant = await UnitOfWork.run(harness.appPool, `${NS}_tnt_alpha`, async (uow) => {
      const result = await uow.query<{ tenant: string | null }>(
        `select current_setting('app.tenant_id', true) as tenant`,
      );
      return result.rows[0]?.tenant ?? null;
    });
    assert.equal(tenant, `${NS}_tnt_alpha`);

    // ⭐⭐ And the real actor is in the column of the audit table ⇒ ⇒ ⇒
    //   ⇒ ⇒ (the audit was always correct ⇒ ⇒ ⇒ ⇒ and it stays so).
    const reference = `conv_actor_${Date.now().toString(36)}`;
    await harness.client.request({
      method: 'POST',
      path: '/api/conversations',
      token: owner,
      payload: { conversation_ref: reference, customer_id: `${NS}_cus_alpha_1`, message: { body: 'who is the actor?' } },
    });
    const audit = await UnitOfWork.run(harness.ownerPool, `${NS}_tnt_alpha`, async (uow) => {
      const result = await uow.query<{ actor_id: string }>(
        `select actor_id from audit_events where tenant_id = $1 order by id desc limit 1`,
        [`${NS}_tnt_alpha`],
      );
      return result.rows[0]?.actor_id ?? '';
    });
    assert.equal(audit, `${NS}_usr_alpha_owner`);
  });

  await t.test('⭐ #7: the health endpoint publishes the ceilings ONLY in the local profiles', async () => {
    const local = await harness.client.request({ method: 'GET', path: '/api/health' });
    assert.equal(local.status, 200);
    const localRate = local.body['rate_limit'] as Record<string, unknown>;
    assert.ok(
      typeof localRate['max_account_attempts'] === 'number',
      'the local profile stopped publishing the ceilings of the operator',
    );

    // ⭐⭐ In the profile that faces the outside ⇒ ⇒ ⇒ only the MODE.
    const stagingPort = harness.port + 1;
    const stagingConfig = { ...harness.config, profile: 'staging' as const, port: stagingPort };
    const stagingPool = createPool(harness.config.appDatabaseUrl, 2);
    stagingPool.on('error', () => undefined);
    const staging = new WaslApiServer({ config: stagingConfig, pool: stagingPool });
    const address = await staging.listen();
    try {
      const client = new LocalApiClient('127.0.0.1', address.port);
      const health = await client.request({ method: 'GET', path: '/api/health' });
      assert.equal(health.status, 200);
      const rate = health.body['rate_limit'] as Record<string, unknown>;
      assert.deepEqual(Object.keys(rate), ['mode'], 'the staging health published a ceiling');
      assert.equal(rate['mode'], 'enforced');
      const text = JSON.stringify(health.body);
      assert.ok(!text.includes('max_account_attempts'), 'the staging health published the account ceiling');
      assert.ok(!text.includes('window_seconds'), 'the staging health published the window');
    } finally {
      await staging.close();
      await stagingPool.end();
    }
  });

  await t.test('⭐ #8: the fixture passcode does NOT travel with the page outside the local profiles', async () => {
    // ⭐⭐ In the LOCAL profile the console keeps its fixture ⇒ ⇒ ⇒ (the
    //   operator of the machine needs no ceremony).
    const local = await harness.client.request({ method: 'GET', path: '/ui/index.html' });
    assert.equal(local.status, 200);
    assert.ok(String(local.body['raw'] ?? '').includes('wasl-local-test'));

    // ⭐⭐ In the profile that faces the outside ⇒ ⇒ ⇒ the value is GONE
    //   ⇒ ⇒ ⇒ ⇒ and the operator types it.
    const stagingPort = harness.port + 2;
    const stagingConfig = { ...harness.config, profile: 'staging' as const, port: stagingPort };
    const stagingPool = createPool(harness.config.appDatabaseUrl, 2);
    stagingPool.on('error', () => undefined);
    const staging = new WaslApiServer({ config: stagingConfig, pool: stagingPool });
    const address = await staging.listen();
    try {
      const client = new LocalApiClient('127.0.0.1', address.port);
      for (const page of ['/ui/index.html', '/ui/inbox.html', '/ui/crm.html', '/ui/tickets.html']) {
        const response = await client.request({ method: 'GET', path: page });
        assert.equal(response.status, 200);
        const html = String(response.body['raw'] ?? '');
        assert.ok(!html.includes('wasl-local-test'), `the passcode travelled with ${page}`);
        assert.ok(html.includes('id="login-passcode"') || html.includes('id="passcode"'), `the field is gone from ${page}`);
      }
      // ⭐⭐ And the script of the console carries no default either.
      const script = await client.request({ method: 'GET', path: '/ui/app.js' });
      assert.equal(script.status, 200);
      assert.ok(!String(script.body['raw'] ?? '').includes('wasl-local-test'));
    } finally {
      await staging.close();
      await stagingPool.end();
    }
  });
});

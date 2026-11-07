// ============================================================
// WASL AI — FOUNDATION BUILD 02 — PHASE 01
// M-02: the sessions, the rate limit and the health check
// ------------------------------------------------------------
// ⭐ THE PROPERTIES UNDER TEST
//   - the login rate limit is enforced and is shared state (the
//     counter lives in PostgreSQL, so two instances share it),
//   - a business answer (a disabled account, a malformed request) is
//     not counted as a guess,
//   - a session expires, can be revoked, and follows the role that the
//     database holds (not the role the client claims),
//   - the health check exposes the profile, the database state and the
//     schema version, and nothing sensitive,
//   - the structured log drops the fields that are not on the allow
//     list and redacts the values that look like a token.
// ⛔ Local synthetic database only.
// ============================================================

import assert from 'node:assert/strict';
import test from 'node:test';

import { WaslApiServer } from '../../server/api/server.ts';
import { createLogger } from '../../server/log.ts';
import { createPool } from '../../server/db/pool.ts';
import { UnitOfWork } from '../../server/db/unit-of-work.ts';
import { LocalApiClient } from '../../server/e2e/http-client.ts';
import { loginAs, startHarness } from './harness.ts';

// ⭐⭐ D-072 / M-82: the companies of THIS file (the namespace) ⇐
//   ⭐⭐ no other file can touch their rows ⇐ ⭐⭐ the result of the
//   ⭐⭐ file never depends on the order of the files.
const NS = 'sec';


const PASSCODE = process.env['WASL_TEST_PASSCODE'] ?? 'wasl-local-test';

test('FOUNDATION 9) the sessions, the rate limit and the health check (M-02)', async (t) => {
  const harness = await startHarness({ namespace: NS });
  t.after(async () => {
    await harness.stop();
  });

  // ⭐ A second instance (the rate limit is shared state).
  const secondPool = createPool(harness.config.appDatabaseUrl, 6);
  const secondApi = new WaslApiServer({ config: { ...harness.config, port: harness.port + 1 }, pool: secondPool });
  const secondAddress = await secondApi.listen();
  const secondClient = new LocalApiClient('127.0.0.1', secondAddress.port);
  t.after(async () => {
    await secondApi.close();
    await secondPool.end();
  });

  const owner = await loginAs(harness.client, `${NS}_tnt_alpha`, `${NS}_usr_alpha_owner`, PASSCODE);

  await t.test('⭐⭐ M-02a: the health check describes the service and nothing else', async () => {
    const health = await harness.client.request({ method: 'GET', path: '/health' });
    assert.equal(health.status, 200, `the health check failed: ${health.status}`);
    const body = health.body as Record<string, unknown>;
    assert.equal(body['ok'], true);
    assert.equal(body['db_ok'], true, 'the health check does not see the database');
    assert.equal(body['profile'], 'test', `the profile is not the one of the harness: ${String(body['profile'])}`);
    assert.ok(body['schema_version'], 'the schema version is missing');
    assert.ok(typeof body['uptime_ms'] === 'number', 'the uptime is missing');
    assert.ok(body['rate_limit'], 'the rate limit policy is missing');

    // ⛔ Nothing sensitive: no password, no connection string, no host.
    const serialized = JSON.stringify(body).toLowerCase();
    for (const forbidden of ['password', 'postgresql://', 'localdevpass', 'secret', 'token']) {
      assert.ok(!serialized.includes(forbidden), `the health check exposes "${forbidden}"`);
    }
  });

  await t.test('⭐⭐⭐ M-02b: the login rate limit refuses the guesses', async () => {
    const health = await harness.client.request({ method: 'GET', path: '/health' });
    const limit = (health.body['rate_limit'] as Record<string, number>)['max_account_attempts'];
    assert.ok(Number.isInteger(limit) && limit > 0, 'the limit is not published');

    // ⭐ The wrong passcode, again and again.
    for (let attempt = 0; attempt < limit; attempt += 1) {
      const failed = await harness.client.request({
        method: 'POST',
        path: '/api/session',
        payload: { tenant_id: `${NS}_tnt_alpha`, user_id: `${NS}_usr_alpha_agent`, passcode: `${PASSCODE}-wrong` },
      });
      assert.equal(failed.status, 401, `the guess number ${attempt + 1} was not refused`);
    }

    // ⭐ The counter lives in the database: the second instance sees it.
    const attempts = await UnitOfWork.run(harness.ownerPool, `${NS}_tnt_alpha`, async (uow) => {
      const result = await uow.query<{ count: string }>(
        `select count(*)::text as count from login_attempts where user_id = $1 and succeeded = false`,
        [`${NS}_usr_alpha_agent`],
      );
      return Number(result.rows[0]?.count ?? '0');
    });
    assert.ok(attempts >= limit, `the database holds ${attempts} attempts instead of ${limit}`);

    // ⭐⭐ D-069 / M67.7 — the guess budget refuses the GUESS, never the
    //   legitimate user. A deliberate attack on an account must not be
    //   able to lock its owner out, so a CORRECT passcode is accepted
    //   even while the budget of the account is exhausted.
    //   ⭐ The declared change (PHASE 01 refused the correct passcode
    //     too): the owner directive M-67.7 puts the legitimate user
    //     first, and the CPU is protected by the platform budget
    //     instead (M-67 in the new file).
    const refused = await harness.client.request({
      method: 'POST',
      path: '/api/session',
      payload: { tenant_id: `${NS}_tnt_alpha`, user_id: `${NS}_usr_alpha_agent`, passcode: `${PASSCODE}-wrong` },
    });
    assert.equal(refused.status, 429, `the guess was not refused: ${refused.status}`);
    const code = String((refused.body['error'] as Record<string, unknown> | undefined)?.['code'] ?? '');
    assert.equal(code, 'login_rate_limited', `the refusal carries an unexpected code: ${code}`);

    // ⭐ The RIGHT passcode still opens the session: no lockout.
    const allowed = await harness.client.request({
      method: 'POST',
      path: '/api/session',
      payload: { tenant_id: `${NS}_tnt_alpha`, user_id: `${NS}_usr_alpha_agent`, passcode: PASSCODE },
    });
    assert.equal(
      allowed.status,
      200,
      `the correct passcode was refused by the guess budget: ${allowed.status} ${JSON.stringify(allowed.body)}`,
    );
    assert.ok(typeof allowed.body['token'] === 'string', 'the session was not opened');

    // ⭐ The counter is cleaned up: a successful login clears it.
    const cleared = await UnitOfWork.run(harness.ownerPool, `${NS}_tnt_alpha`, async (uow) => {
      const result = await uow.query<{ count: string }>(
        `select count(*)::text as count from login_attempts where user_id = $1 and succeeded = false`,
        [`${NS}_usr_alpha_agent`],
      );
      return Number(result.rows[0]?.count ?? '0');
    });
    assert.equal(cleared, 0, `the successful login did not clear the counter: ${cleared}`);

    // ⭐ The second instance sees the same state: the counter is shared.
    const allowedAgain = await secondClient.request({
      method: 'POST',
      path: '/api/session',
      payload: { tenant_id: `${NS}_tnt_alpha`, user_id: `${NS}_usr_alpha_agent`, passcode: PASSCODE },
    });
    assert.equal(allowedAgain.status, 200, `the login was still refused after the cleanup: ${allowedAgain.status}`);
  });

  await t.test('⭐⭐ M-02c: a business answer is not counted as a guess', async () => {
    await UnitOfWork.run(harness.ownerPool, `${NS}_tnt_alpha`, async (uow) => {
      await uow.query(`delete from login_attempts where user_id = $1`, [`${NS}_usr_alpha_viewer`]);
    });

    // ⭐ A disabled account with the RIGHT passcode is an answer, not
    //   a guess. (A disabled account with a WRONG passcode cannot be
    //   told apart from a wrong passcode without telling the caller
    //   that the account exists, so it stays a credential failure and
    //   it is counted. That order is deliberate.)
    await UnitOfWork.run(harness.ownerPool, `${NS}_tnt_alpha`, async (uow) => {
      await uow.query(`update users set status = 'disabled' where id = $1`, [`${NS}_usr_alpha_viewer`]);
    });
    const disabled = await harness.client.request({
      method: 'POST',
      path: '/api/session',
      payload: { tenant_id: `${NS}_tnt_alpha`, user_id: `${NS}_usr_alpha_viewer`, passcode: PASSCODE },
    });
    assert.equal(disabled.status, 403, `unexpected status: ${disabled.status}`);
    const code = String((disabled.body['error'] as Record<string, unknown> | undefined)?.['code'] ?? '');
    assert.equal(code, 'user_disabled', `the refusal carries an unexpected code: ${code}`);

    const counted = await UnitOfWork.run(harness.ownerPool, `${NS}_tnt_alpha`, async (uow) => {
      const result = await uow.query<{ count: string }>(
        `select count(*)::text as count from login_attempts where user_id = $1`,
        [`${NS}_usr_alpha_viewer`],
      );
      return Number(result.rows[0]?.count ?? '0');
    });
    assert.equal(counted, 0, `a disabled account was counted ${counted} times`);

    // ⭐ The account is restored for the other tests.
    await UnitOfWork.run(harness.ownerPool, `${NS}_tnt_alpha`, async (uow) => {
      await uow.query(`update users set status = 'active' where id = $1`, [`${NS}_usr_alpha_viewer`]);
    });
  });

  await t.test('⭐⭐⭐ M-02d: a session expires', async () => {
    // ⭐ A third instance with a session lifetime of one second.
    const shortPool = createPool(harness.config.appDatabaseUrl, 4);
    const shortApi = new WaslApiServer({
      config: { ...harness.config, port: harness.port + 2, sessionTtlSeconds: 1 },
      pool: shortPool,
    });
    const shortAddress = await shortApi.listen();
    const shortClient = new LocalApiClient('127.0.0.1', shortAddress.port);
    try {
      const token = await loginAs(shortClient, `${NS}_tnt_alpha`, `${NS}_usr_alpha_owner`, PASSCODE);
      const before = await shortClient.request({ method: 'GET', path: '/api/conversations', token });
      assert.equal(before.status, 200, 'the fresh session was refused');
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const after = await shortClient.request({ method: 'GET', path: '/api/conversations', token });
      assert.equal(after.status, 401, `the expired session was accepted: ${after.status}`);
      const code = String((after.body['error'] as Record<string, unknown> | undefined)?.['code'] ?? '');
      assert.equal(code, 'session_expired', `the refusal carries an unexpected code: ${code}`);
    } finally {
      await shortApi.close();
      await shortPool.end();
    }
  });

  await t.test('⭐⭐ M-02e: a session is revoked when it is deleted', async () => {
    const token = await loginAs(harness.client, `${NS}_tnt_alpha`, `${NS}_usr_alpha_owner`, PASSCODE);
    const before = await harness.client.request({ method: 'GET', path: '/api/conversations', token });
    assert.equal(before.status, 200);

    const revoked = await harness.client.request({ method: 'DELETE', path: '/api/session', token });
    assert.equal(revoked.status, 200, 'the revocation failed');

    const after = await harness.client.request({ method: 'GET', path: '/api/conversations', token });
    assert.equal(after.status, 401, `the revoked session was accepted: ${after.status}`);
    const code = String((after.body['error'] as Record<string, unknown> | undefined)?.['code'] ?? '');
    assert.equal(code, 'session_revoked', `the refusal carries an unexpected code: ${code}`);
  });

  await t.test('⭐⭐⭐ M-02f: the role comes from the database, not from the client', async () => {
    // ⭐ The agent may not change a state; the supervisor may.
    const agent = await loginAs(harness.client, `${NS}_tnt_alpha`, `${NS}_usr_alpha_agent`, PASSCODE);
    const ref = `conv_m02_f_${Date.now().toString(36)}`;
    const created = await harness.client.request({
      method: 'POST',
      path: '/api/conversations',
      token: owner,
      payload: {
        conversation_ref: ref,
        customer_id: `${NS}_cus_alpha_1`,
        message: { body: 'm02 role' },
      },
    });
    assert.equal(created.status, 201);

    const refused = await harness.client.request({
      method: 'POST',
      path: `/api/conversations/${ref}/state`,
      token: agent,
      payload: { to: 'open' },
    });
    assert.equal(refused.status, 403, `the agent was allowed to change the state: ${refused.status}`);

    // ⭐ The role is raised in the database: the NEXT request of the
    //   same session follows it.
    await UnitOfWork.run(harness.ownerPool, `${NS}_tnt_alpha`, async (uow) => {
      await uow.query(
        `update memberships set role = 'supervisor' where tenant_id = $1 and user_id = $2`,
        [`${NS}_tnt_alpha`, `${NS}_usr_alpha_agent`],
      );
    });
    const allowed = await harness.client.request({
      method: 'POST',
      path: `/api/conversations/${ref}/state`,
      token: agent,
      payload: { to: 'open' },
    });
    assert.equal(allowed.status, 200, `the raised role was not applied: ${allowed.status}`);

    // ⭐ The role is restored.
    await UnitOfWork.run(harness.ownerPool, `${NS}_tnt_alpha`, async (uow) => {
      await uow.query(
        `update memberships set role = 'agent' where tenant_id = $1 and user_id = $2`,
        [`${NS}_tnt_alpha`, `${NS}_usr_alpha_agent`],
      );
    });
  });

  await t.test('⭐⭐ M-02g: the structured log drops what is not on the allow list', async () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: 'debug',
      service: 'wasl-local-api',
      write: (line) => lines.push(line),
    });
    logger.info('http_request', {
      request_id: 'req_1',
      method: 'GET',
      path: '/api/conversations',
      status: 200,
      // ⛔ None of these may reach the log.
      passcode: 'wasl-local-test',
      token: 'wsl.tenant.session.secret',
      body: 'the message body of a customer',
      authorization: 'Bearer secret',
    });
    assert.equal(lines.length, 1);
    const line = lines[0]!;
    assert.ok(line.includes('"event":"http_request"'), 'the event is missing');
    assert.ok(line.includes('"request_id":"req_1"'), 'the request id is missing');
    assert.ok(!line.includes('wasl-local-test'), 'the passcode reached the log');
    assert.ok(!line.includes('the message body of a customer'), 'the body reached the log');
    assert.ok(!line.includes('Bearer secret'), 'the authorization header reached the log');

    // ⭐ A value that looks like a token is redacted even when the
    //   field name is allowed.
    lines.length = 0;
    logger.info('http_request', { request_id: 'wsl.tenant.session.secret' });
    assert.ok(!lines[0]!.includes('wsl.tenant'), 'a token shaped value was written');
    assert.ok(lines[0]!.includes('[redacted]'), 'the value was not redacted');
  });
});

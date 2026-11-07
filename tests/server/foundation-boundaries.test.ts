// ============================================================
// WASL AI — FOUNDATION BUILD 01 — boundaries and evidence
// ------------------------------------------------------------
// ⭐ AC-10: no request leaves the machine (static scan + a runtime
//   guard that refuses any non loopback socket).
// ⭐ AC-14: no secret, no password and no real data in the repository.
// ⭐ M60: the I/O boundary is proven, not assumed.
// ⭐ M61: the local console is connected to the real backend (a real
//   browser drives it and the database changes).
// ⭐ M62: the isolation is tested per operation, not per column.
// ⭐ M63: the declared rejection code stays declared and is reachable.
// ============================================================

import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';

import { IDENTITY_CONTRACT_CODES } from '../../src/core/index.ts';
import { UnitOfWork } from '../../server/db/unit-of-work.ts';
import { runJourney } from '../../server/e2e/journey.ts';
import { runUiBrowserCheck } from '../../tools/wasl-ui-browser-check.ts';
import { startHarness, loginAs, resetSyntheticData } from './harness.ts';

// ⭐⭐ D-072 / M-82: the companies of THIS file (the namespace) ⇐
//   ⭐⭐ no other file can touch their rows ⇐ ⭐⭐ the result of the
//   ⭐⭐ file never depends on the order of the files.
const NS = 'bnd';


const PASSCODE = process.env['WASL_TEST_PASSCODE'] ?? 'wasl-local-test';
const ROOT = path.resolve(import.meta.dirname, '..', '..');

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('FOUNDATION 5) boundaries, secrets and the notes M59 to M65', async (t) => {
  const harness = await startHarness({ namespace: NS });
  t.after(async () => {
    await harness.stop();
  });
  await resetSyntheticData(harness.ownerPool, PASSCODE, ['tnt_alpha', 'tnt_beta', 'tnt_gamma'], NS);

  await t.test('⭐ AC-10a: the server tree contains no external endpoint', () => {
    const files = listFiles(path.join(ROOT, 'server'));
    const hits: string[] = [];
    for (const file of files) {
      const text = stripComments(fs.readFileSync(file, 'utf8'));
      const urls = text.match(/https?:\/\/[^\s'"`)]+/g) ?? [];
      for (const url of urls) {
        if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(url)) {
          hits.push(`${path.relative(ROOT, file)} => ${url}`);
        }
      }
    }
    assert.deepEqual(hits, [], `an external endpoint exists: ${hits.join(' , ')}`);
  });

  await t.test('⭐ AC-10b: no integration of a forbidden service exists', () => {
    const forbidden = [
      'whatsapp',
      'graph.facebook',
      'anthropic',
      'openai',
      'api.openai',
      'generativelanguage',
      'nodemailer',
      'smtp',
      'twilio',
      'sendgrid',
      'firebase',
      'stripe',
    ];
    const hits: string[] = [];
    for (const file of listFiles(path.join(ROOT, 'server'))) {
      const text = stripComments(fs.readFileSync(file, 'utf8')).toLowerCase();
      for (const token of forbidden) {
        if (text.includes(token)) hits.push(`${path.relative(ROOT, file)} => ${token}`);
      }
    }
    assert.deepEqual(hits, [], `a forbidden integration exists: ${hits.join(' , ')}`);
  });

  await t.test('⭐ M60: the runtime refuses any connection outside the loopback', async () => {
    const original = net.Socket.prototype.connect;
    const violations: string[] = [];
    net.Socket.prototype.connect = function patched(this: net.Socket, ...args: unknown[]) {
      const options = args[0] as { host?: string; port?: number } | undefined;
      const host = typeof options === 'object' && options !== null ? options.host : undefined;
      if (host && !['127.0.0.1', 'localhost', '::1', '127.0.0.1/32'].includes(host)) {
        violations.push(`${host}`);
        throw new Error(`blocked external connection to ${host}`);
      }
      return original.apply(this, args as never);
    } as typeof net.Socket.prototype.connect;

    try {
      // ⭐⭐ D-072 / M-82: the journey drives the company of THIS file.
      const report = await runJourney({
        client: harness.client,
        passcode: PASSCODE,
        tenantId: `${NS}_tnt_alpha`,
        userId: `${NS}_usr_alpha_owner`,
        assigneeActorId: `${NS}_usr_alpha_agent`,
        otherTenantId: `${NS}_tnt_beta`,
        otherUserId: `${NS}_usr_beta_owner`,
        customerIdPrefix: `cus_e2e_${NS}`,
      });
      assert.deepEqual(report.failures, []);
      assert.deepEqual(violations, [], 'the build opened an external connection');
    } finally {
      net.Socket.prototype.connect = original;
    }
  });

  await t.test('⭐ AC-14: no secret and no real data in the tracked files', () => {
    const tracked = harness.ownerPool.query;
    assert.equal(typeof tracked, 'function');
    const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    assert.ok(gitignore.includes('.local/'), 'the local credentials are not ignored');
    assert.ok(gitignore.includes('node_modules/'), 'node_modules is not ignored');

    const credentials = JSON.parse(
      fs.readFileSync(path.join(ROOT, '.local', 'pg-credentials.json'), 'utf8'),
    ) as Record<string, unknown>;
    const appPassword = String(credentials['app_password'] ?? '');
    const ownerPassword = String(credentials['owner_password'] ?? '');

    const hits: string[] = [];
    for (const file of listFiles(ROOT)) {
      const relative = path.relative(ROOT, file);
      if (relative.startsWith('.git/') || relative.startsWith('node_modules/')) continue;
      if (relative.startsWith('.local/')) continue;
      if (relative.endsWith('.png') || relative.endsWith('.html')) continue;
      const text = fs.readFileSync(file, 'utf8');
      if (appPassword && text.includes(appPassword)) hits.push(`${relative} => app password`);
      if (ownerPassword && text.includes(ownerPassword)) hits.push(`${relative} => owner password`);
      if (/\b\d{14}\b/.test(text)) hits.push(`${relative} => national id pattern`);
      if (/\+201[0-9]{9}/.test(text)) hits.push(`${relative} => phone pattern`);
    }
    assert.deepEqual(hits, [], `a secret or real data pattern exists: ${hits.join(' , ')}`);
  });

  await t.test('⭐ M62: every operation refuses the other company', async () => {
    const alpha = await loginAs(harness.client, `${NS}_tnt_alpha`, `${NS}_usr_alpha_owner`, PASSCODE);
    const beta = await loginAs(harness.client, `${NS}_tnt_beta`, `${NS}_usr_beta_owner`, PASSCODE);
    const reference = `conv_m62_${Date.now().toString(36)}`;
    const created = await harness.client.request({
      method: 'POST',
      path: '/api/conversations',
      token: alpha,
      payload: { conversation_ref: reference, customer_id: `${NS}_cus_alpha_1`, message: { body: 'm62' } },
    });
    assert.equal(created.status, 201);

    // ⭐ A read may answer with an empty list (nothing is disclosed);
    //   a write must be refused with an error status.
    const operations: readonly {
      name: string;
      method: string;
      path: string;
      payload?: unknown;
      mutating?: boolean;
    }[] = [
      { name: 'list', method: 'GET', path: '/api/conversations' },
      { name: 'read', method: 'GET', path: `/api/conversations/${reference}` },
      { name: 'messages', method: 'GET', path: `/api/conversations/${reference}/messages` },
      { name: 'changes', method: 'GET', path: `/api/conversations/${reference}/changes` },
      { name: 'audit', method: 'GET', path: '/api/audit' },
      { name: 'write', method: 'POST', path: `/api/conversations/${reference}/messages`, payload: { body: 'x' }, mutating: true },
      { name: 'state', method: 'POST', path: `/api/conversations/${reference}/state`, payload: { to: 'open' }, mutating: true },
      { name: 'assign', method: 'POST', path: `/api/conversations/${reference}/assign`, payload: { actor_id: `${NS}_usr_beta_agent` }, mutating: true },
      // ⭐ The export and the deletion preview act on the caller's own
      //   company, so a 200 is correct: the isolation property is that
      //   their content holds nothing of the other company.
      { name: 'export', method: 'POST', path: '/api/privacy/export', payload: {} },
      { name: 'deletion', method: 'POST', path: '/api/privacy/deletion/preview', payload: { scope: 'tenant_data' } },
    ];

    for (const operation of operations) {
      const response = await harness.client.request({
        method: operation.method,
        path: operation.path,
        token: beta,
        payload: operation.payload,
      });
      // ⭐ The error message may echo the reference the caller sent:
      //   that is not a leak. The data fields must not contain it.
      const { error: _ignored, ...data } = response.body as Record<string, unknown>;
      if (operation.name === 'audit') {
        // ⭐ The audit trail of a company contains its own events only.
        const rows = Array.isArray(data['audit']) ? (data['audit'] as Array<Record<string, unknown>>) : [];
        for (const row of rows) {
          assert.ok(
            String(row['actor_id']).startsWith(`${NS}_usr_beta`),
            `the audit trail contains another company actor: ${JSON.stringify(row).slice(0, 160)}`,
          );
        }
      } else {
        // ⭐ The export carries the caller's own audit trail, which may
        //   mention the reference the caller asked for. The business
        //   data is what must be empty for the other company.
        const business = { ...data };
        if (typeof business['export'] === 'object' && business['export'] !== null) {
          const bundle = { ...(business['export'] as Record<string, unknown>) };
          delete bundle['auditEvents'];
          business['export'] = bundle;
        }
        const payload = JSON.stringify(business);
        assert.ok(
          !payload.includes(reference),
          `the ${operation.name} operation leaked the other company reference: ${payload.slice(0, 200)}`,
        );
      }
      if (!operation.mutating) {
        continue; // a read may answer with an empty result
      }
      assert.ok(
        response.status === 403 || response.status === 404 || response.status === 409,
        `the ${operation.name} operation answered ${response.status} for the other company`,
      );
    }
  });

  await t.test('⭐ M63: the declared rejection code stays declared and is reachable', async () => {
    assert.ok(
      IDENTITY_CONTRACT_CODES.includes('identity_status_invalid'),
      'the declared code was removed from the contract',
    );

    // The server produces it for a membership status outside the closed set.
    await UnitOfWork.run(harness.ownerPool, `${NS}_tnt_alpha`, async (uow) => {
      await uow.query(
        `update memberships set status = 'weird_status' where tenant_id = $1 and user_id = $2`,
        [`${NS}_tnt_alpha`, `${NS}_usr_alpha_agent`],
      );
    });
    try {
      const response = await harness.client.request({
        method: 'POST',
        path: '/api/session',
        payload: { tenant_id: `${NS}_tnt_alpha`, user_id: `${NS}_usr_alpha_agent`, passcode: PASSCODE },
      });
      assert.equal(response.status, 403);
      const body = JSON.stringify(response.body);
      assert.ok(body.includes('identity_status_invalid'), `the code was not produced: ${body.slice(0, 200)}`);
    } finally {
      await UnitOfWork.run(harness.ownerPool, `${NS}_tnt_alpha`, async (uow) => {
        await uow.query(
          `update memberships set status = 'active' where tenant_id = $1 and user_id = $2`,
          [`${NS}_tnt_alpha`, `${NS}_usr_alpha_agent`],
        );
      });
    }
  });

  await t.test('⭐ M61: the console is connected to the real backend', async () => {
    // ⭐⭐ The REAL browser drives the company of THIS file.
    const result = await runUiBrowserCheck(harness.port, {
      tenantId: `${NS}_tnt_alpha`,
      userId: `${NS}_usr_alpha_owner`,
      agentId: `${NS}_usr_alpha_agent`,
      otherTenantId: `${NS}_tnt_beta`,
      otherUserId: `${NS}_usr_beta_owner`,
    });
    for (const failure of result.failures) {
      assert.fail(failure);
    }
    assert.ok(result.ok);
    assert.ok(result.steps.length >= 4);

    // The browser drove a real conversation: the database knows about it.
    const rows = await UnitOfWork.run(harness.ownerPool, `${NS}_tnt_alpha`, async (uow) => {
      const result = await uow.query<{ count: string }>(
        `select count(*)::text as count from conversations where state = 'closed' and tenant_id = $1`,
        [`${NS}_tnt_alpha`],
      );
      return Number(result.rows[0]?.count ?? '0');
    });
    assert.ok(rows > 0, 'the browser did not change the database');
  });
});

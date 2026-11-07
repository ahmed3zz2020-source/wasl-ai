// ============================================================
// WASL AI — FOUNDATION BUILD 02 — PHASE 02 (D-069)
// M-70: the preparation of a host (without any deployment)
// ------------------------------------------------------------
// ⭐ WHY THIS FILE EXISTS
//   PHASE 01 wrote the plan of a host. PHASE 02 writes the pieces
//   that can be built and checked on a local machine: the image
//   definition, a compose file that runs with synthetic data, the
//   separation of the database roles, the liveness and the readiness
//   probes, the graceful shutdown and a local TLS termination.
// ⭐ THE PROPERTIES UNDER TEST
//   - the request role cannot read the evidence, cannot change it and
//     cannot touch the schema: the owner role is the only one that can,
//   - the readiness answer separates "the process is alive" from "the
//     service can serve",
//   - SIGTERM stops the server cleanly and releases the port,
//   - the configuration files of the host hold no secret,
//   - a TLS termination in front of the backend works locally,
//   - a broken sensitive configuration fails with a declared code and
//     without leaking a value.
// ⛔ NOTHING IS DEPLOYED: no image is published, no domain is bound,
//   no port is opened to the outside.
// ⛔ The Docker daemon is NOT available in this environment: the image
//   was not built. The checks that do not need a daemon are here, and
//   the missing ones are listed in the report as a residual risk.
// ============================================================

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';

import { loadConfig, ConfigError } from '../../server/config.ts';
import { UnitOfWork } from '../../server/db/unit-of-work.ts';
import { LocalApiClient } from '../../server/e2e/http-client.ts';
import { startHarness } from './harness.ts';

// ⭐⭐ D-072 / M-82: the companies of THIS file (the namespace) ⇐
//   ⭐⭐ no other file can touch their rows ⇐ ⭐⭐ the result of the
//   ⭐⭐ file never depends on the order of the files.
const NS = 'host';


const ROOT = path.resolve(import.meta.dirname, '..', '..');

function readRepoFile(relative: string): string {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

/** ⭐ A free port of the loopback. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

test('FOUNDATION 16) the preparation of a host (M-70)', async (t) => {
  const harness = await startHarness({ namespace: NS });

  t.after(async () => {
    await harness.stop();
  });

  await t.test('⭐⭐⭐ M-70a: the roles of the database are separated', async () => {
    // ⭐ The request role: no bypass of the row level security, no
    //   right on the schema, no right on the evidence.
    const attributes = await harness.ownerPool.query<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
    }>(
      `select rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
         from pg_roles where rolname in ('wasl_app', 'wasl_owner')`,
    );
    const app = attributes.rows.find((row) => row.rolname === 'wasl_app');
    const owner = attributes.rows.find((row) => row.rolname === 'wasl_owner');
    assert.ok(app, 'the request role is missing');
    assert.ok(owner, 'the owner role is missing');
    for (const role of [app!, owner!]) {
      assert.equal(role.rolsuper, false, `${role.rolname} is a superuser`);
      assert.equal(role.rolbypassrls, false, `${role.rolname} bypasses the row level security`);
      assert.equal(role.rolcreatedb, false, `${role.rolname} may create a database`);
      assert.equal(role.rolcreaterole, false, `${role.rolname} may create a role`);
    }

    // ⭐ The request role may not read the evidence.
    let readCode = 'none';
    try {
      await UnitOfWork.run(harness.appPool, `${NS}_tnt_alpha`, async (uow) => {
        await uow.query(`select count(*)::text as count from tenant_deletion_evidence`);
      });
    } catch (error) {
      readCode = (error as { code?: string }).code ?? 'unknown';
    }
    assert.ok(
      readCode === '42501' || readCode === '403',
      `the request role read the evidence: ${readCode}`,
    );

    // ⭐ The request role may not change the evidence either.
    let changeCode = 'none';
    try {
      await UnitOfWork.run(harness.appPool, `${NS}_tnt_alpha`, async (uow) => {
        await uow.query(`delete from tenant_deletion_evidence where tenant_id = $1`, [`${NS}_tnt_alpha`]);
      });
    } catch (error) {
      changeCode = (error as { code?: string }).code ?? 'unknown';
    }
    assert.ok(
      changeCode === '42501' || changeCode === '403',
      `the request role changed the evidence: ${changeCode}`,
    );

    // ⭐ The request role may not touch the schema.
    let ddlCode = 'none';
    try {
      await UnitOfWork.run(harness.appPool, `${NS}_tnt_alpha`, async (uow) => {
        await uow.query(`create table if not exists wasl_forbidden (id int)`);
      });
    } catch (error) {
      ddlCode = (error as { code?: string }).code ?? 'unknown';
    }
    assert.ok(
      ddlCode === '42501' || ddlCode === '403',
      `the request role touched the schema: ${ddlCode}`,
    );

    // ⭐ The owner role may read the evidence: it is the platform side.
    const ownerRead = await harness.ownerPool.query<{ count: string }>(
      `select count(*)::text as count from tenant_deletion_evidence`,
    );
    assert.ok(Number(ownerRead.rows[0]?.count ?? '0') >= 0, 'the owner role cannot read the evidence');
  });

  await t.test('⭐⭐⭐ M-70b: the liveness and the readiness are two answers', async () => {
    const live = await harness.client.request({ method: 'GET', path: '/health' });
    assert.equal(live.status, 200, `the liveness probe failed: ${live.status}`);
    assert.equal(live.body['db_ok'], true, 'the liveness probe does not see the database');
    assert.ok(live.body['schema_version'], 'the liveness probe holds no schema version');

    const ready = await harness.client.request({ method: 'GET', path: '/ready' });
    assert.equal(ready.status, 200, `the readiness probe failed: ${ready.status}`);
    assert.equal(ready.body['ok'], true, 'the readiness probe is not ready');
    assert.equal(ready.body['db_ok'], true, 'the readiness probe does not see the database');
    assert.ok(Number(ready.body['migrations'] ?? 0) >= 1, 'the readiness probe holds no migration');

    // ⛔ Neither answer exposes a secret.
    const serialized = JSON.stringify(ready.body).toLowerCase();
    for (const forbidden of ['password', 'postgresql://', 'secret', 'token']) {
      assert.ok(!serialized.includes(forbidden), `the readiness answer exposes "${forbidden}"`);
    }
  });

  await t.test('⭐⭐⭐ M-70c: SIGTERM stops the server cleanly', async () => {
    const port = await freePort();
    const child = spawn('node', ['--experimental-strip-types', 'tools/wasl-server.ts'], {
      cwd: ROOT,
      env: {
        ...process.env,
        WASL_SERVER_PORT: String(port),
        WASL_SERVER_HOST: '127.0.0.1',
        WASL_ENV: 'test',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });

    try {
      // ⭐ The server announces that it listens.
      const started = Date.now();
      while (!output.includes('listening') && Date.now() - started < 15000) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.ok(output.includes('listening'), `the server did not start: ${output}`);

      const client = new LocalApiClient('127.0.0.1', port);
      const live = await client.request({ method: 'GET', path: '/health' });
      assert.equal(live.status, 200, 'the server does not answer before the signal');

      // ⭐ The graceful shutdown.
      child.kill('SIGTERM');
      const code = await new Promise<number | null>((resolve) => {
        child.once('exit', (exitCode) => resolve(exitCode));
        setTimeout(() => resolve(null), 15000);
      });
      assert.equal(code, 0, `the server did not stop cleanly: ${String(code)} (${output})`);

      // ⭐ The port is released: nothing answers any more.
      await new Promise((resolve) => setTimeout(resolve, 200));
      let refused = false;
      try {
        await client.request({ method: 'GET', path: '/health' });
      } catch {
        refused = true;
      }
      assert.ok(refused, 'the server still answers after the shutdown');
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  });

  await t.test('⭐⭐⭐ M-70d: the configuration files of the host hold no secret', async () => {
    const dockerfile = readRepoFile('Dockerfile');
    const ignore = readRepoFile('.dockerignore');
    const composeLocal = readRepoFile('deploy/docker-compose.local.example.yml');
    const composeStaging = readRepoFile('deploy/docker-compose.staging.example.yml');
    const envExample = readRepoFile('deploy/env.example');
    const envLocal = readRepoFile('deploy/env.local.example');

    // ⭐ The image: no secret, a non root user, a health check, a
    //   graceful stop signal.
    assert.ok(/^USER\s+wasl$/m.test(dockerfile), 'the image does not run as a non root user');
    assert.ok(/HEALTHCHECK/.test(dockerfile), 'the image has no health check');
    assert.ok(/STOPSIGNAL\s+SIGTERM/.test(dockerfile), 'the image has no graceful stop signal');
    assert.ok(
      !/ENV\s+\w*PASSWORD\s*=\s*\S/i.test(dockerfile),
      'the image bakes a password in an environment variable',
    );
    assert.ok(
      !/(postgresql:\/\/)[^$\s]*:[^$\s]*@/.test(dockerfile),
      'the image bakes a connection string with a credential',
    );

    // ⭐ The build context: the local secrets stay out of it.
    assert.ok(ignore.includes('.local/'), 'the build context does not exclude the local secrets');
    assert.ok(ignore.includes('node_modules/'), 'the build context does not exclude the dependencies');

    // ⭐ The compose files: only the loopback is published and the
    //   database is never published.
    for (const [name, content] of [
      ['local', composeLocal],
      ['staging', composeStaging],
    ] as const) {
      // ⭐ Only the published port mappings are looked at (the form
      //   "host:port:port"), not every quoted line of the file.
      const published = [...content.matchAll(/"([0-9a-zA-Z.]+:\d+:\d+)"/g)].map((match) => match[1]!);
      for (const entry of published) {
        assert.ok(
          entry.startsWith('127.0.0.1:') || entry.startsWith('localhost:'),
          `the compose (${name}) publishes a port that is not the loopback: ${entry}`,
        );
      }
      assert.ok(
        !/postgresql:\/\/[^$\s]*:[^$\s]*@/.test(content),
        `the compose (${name}) holds a connection string with a credential`,
      );
    }

    // ⭐ The environment templates: placeholders or clearly synthetic.
    assert.ok(
      envExample.includes('CHANGE_ME') && envExample.includes('<paste-here>'),
      'the environment template does not hold placeholders',
    );
    for (const line of envLocal.split('\n')) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!match) continue;
      const name = match[1]!;
      const value = match[2]!;
      if (value === '' || value.startsWith('<')) continue;
      // ⭐ Only the SECRET bearing variables are checked: a database
      //   name or a port is not a credential.
      if (!/(PASSWORD|SECRET|KEY|TOKEN|PASSCODE)/.test(name)) continue;
      assert.ok(
        /local-synthetic|synthetic/i.test(value),
        `the local environment file holds a secret that is not synthetic: ${name}`,
      );
    }
  });

  await t.test('⭐⭐⭐ M-70e: the TLS termination works locally', async (t2) => {
    // ⭐⭐ The certificate is generated on the local machine with
    //   openssl and it stays in `.local/` (never committed). ⛔ It is a
    //   throw away certificate of one day for a loopback test.
    const openssl = spawnSync('openssl', ['version'], { encoding: 'utf8' });
    if (openssl.error || openssl.status !== 0) {
      t2.skip('openssl is not available for the local TLS test');
      return;
    }
    const directory = path.join(ROOT, '.local', 'tls');
    fs.mkdirSync(directory, { recursive: true });
    const keyFile = path.join(directory, 'localhost-key.pem');
    const certFile = path.join(directory, 'localhost-cert.pem');
    const generated = spawnSync(
      'openssl',
      [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', keyFile, '-out', certFile,
        '-days', '1', '-subj', '/CN=localhost',
      ],
      { encoding: 'utf8' },
    );
    if (generated.error || generated.status !== 0) {
      t2.skip('the local certificate could not be generated');
      return;
    }

    // ⭐ The proxy terminates the TLS and forwards to the backend.
    const proxyPort = await freePort();
    const proxy = https.createServer(
      { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) },
      (request, response) => {
        const upstream = http.request(
          {
            host: '127.0.0.1',
            port: harness.port,
            path: request.url ?? '/',
            method: request.method ?? 'GET',
            headers: { ...request.headers, host: `127.0.0.1:${harness.port}` },
          },
          (upstreamResponse) => {
            response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
            upstreamResponse.pipe(response);
          },
        );
        upstream.on('error', () => {
          response.writeHead(502);
          response.end();
        });
        request.pipe(upstream);
      },
    );
    await new Promise<void>((resolve) => proxy.listen(proxyPort, '127.0.0.1', () => resolve()));
    try {
      const body = await new Promise<string>((resolve, reject) => {
        const request = https.request(
          {
            host: '127.0.0.1',
            port: proxyPort,
            path: '/health',
            method: 'GET',
            rejectUnauthorized: false,
          },
          (response) => {
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => chunks.push(chunk));
            response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
          },
        );
        request.on('error', reject);
        request.end();
      });
      assert.ok(body.includes('"db_ok":true'), `the TLS answer is not the health answer: ${body}`);

      // ⭐⭐ The backend itself still speaks plain HTTP: the certificate
      //   never reaches the application.
      const plain = await new LocalApiClient('127.0.0.1', harness.port).request({
        method: 'GET',
        path: '/health',
      });
      assert.equal(plain.status, 200, 'the backend does not answer in plain HTTP any more');
    } finally {
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    }
  });

  await t.test('⭐⭐ M-70f: a broken sensitive configuration fails safely', () => {
    // ⭐ The staging profile needs an explicit bind host.
    let code = 'none';
    try {
      loadConfig({ ...process.env, WASL_ENV: 'staging', WASL_SERVER_HOST: '' }, ROOT);
    } catch (error) {
      code = error instanceof ConfigError ? error.code : 'unknown';
    }
    assert.equal(code, 'server_host_required', `the missing bind host was accepted: ${code}`);

    // ⭐ A broken budget is refused with a declared code.
    let limitCode = 'none';
    try {
      loadConfig(
        { ...process.env, WASL_ENV: 'test', WASL_LOGIN_MAX_GLOBAL_ATTEMPTS: '0' },
        ROOT,
      );
    } catch (error) {
      limitCode = error instanceof ConfigError ? error.code : 'unknown';
    }
    assert.equal(limitCode, 'login_limit_invalid', `the broken budget was accepted: ${limitCode}`);

    // ⭐ A broken profile is refused.
    let profileCode = 'none';
    try {
      loadConfig({ ...process.env, WASL_ENV: 'production' }, ROOT);
    } catch (error) {
      profileCode = error instanceof ConfigError ? error.code : 'unknown';
    }
    assert.equal(profileCode, 'profile_invalid', `the broken profile was accepted: ${profileCode}`);

    // ⛔ The message of a refused configuration holds no value of the
    //   environment.
    try {
      loadConfig({ ...process.env, WASL_ENV: 'staging', WASL_SERVER_HOST: '' }, ROOT);
      assert.fail('the configuration was accepted');
    } catch (error) {
      const message = (error as Error).message;
      assert.ok(!message.includes('localdevpass'), 'the message holds a credential');
      assert.ok(!message.includes('postgresql://'), 'the message holds a connection string');
    }
  });
});

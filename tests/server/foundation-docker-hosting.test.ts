// ============================================================
// WASL AI — FOUNDATION BUILD 03 / PHASE 01 (D-070) — M-75
// the Docker image and the local compose
// ------------------------------------------------------------
// ⭐⭐ WHAT THIS FILE MEASURES
//   1) the STATIC checks of the image definition and of the compose
//      file: they run everywhere and they catch the mistakes that a
//      human review misses (a secret in the file, a root user, a
//      missing health check, a published database port),
//   2) the DYNAMIC drill: build the image, run the compose, check the
//      health, the readiness and the graceful shutdown.
// ⛔ THE HONEST STATE OF THE DYNAMIC DRILL
//   The drill needs a container that actually STARTS. ⭐ When the
//   environment cannot start one, the drill is SKIPPED with the
//   measured reason and it is never reported as a pass.
//   ⭐⭐ The measured reason in this environment (November 2026):
//   the Docker daemon runs and the images are pulled and unpacked,
//   but the sandbox masks parts of /proc and the kernel refuses a new
//   procfs mount inside a user namespace ⇒ no container starts.
//   ⛔ LOCAL ONLY: no registry, no cloud build, no pushed image.
// ============================================================

import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const DOCKERFILE = path.join(ROOT, 'Dockerfile');
const COMPOSE = path.join(ROOT, 'deploy', 'docker-compose.local.example.yml');
const ENV_EXAMPLE = path.join(ROOT, 'deploy', 'env.local.example');

/** ⭐ Read the dockerfile of the repository. */
function dockerfile(): string {
  return fs.readFileSync(DOCKERFILE, 'utf8');
}

/** ⭐ Read the local compose file of the repository. */
function compose(): string {
  return fs.readFileSync(COMPOSE, 'utf8');
}

/**
 * ⭐ Run a command and return what it answered. ⭐ The timeout is
 *   short: the drill must never hang the suite.
 */
function run(command: string, args: string[], timeoutMs = 60_000): {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
} {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: timeoutMs });
  return {
    status: result.status ?? (result.error ? -1 : 0),
    stdout: result.stdout ?? '',
    stderr: `${result.stderr ?? ''}${result.error ? ` ${result.error.message}` : ''}`,
  };
}

/**
 * ⭐ The probe of the environment: can a container actually START?
 * ⭐ It answers with the measured reason when it cannot.
 */
function probeContainer(): { readonly canRun: boolean; readonly reason: string } {
  const version = run('docker', ['version', '--format', '{{.Server.Version}}'], 20_000);
  if (version.status !== 0) {
    return {
      canRun: false,
      reason: `no Docker daemon answers: ${version.stderr.trim() || version.stdout.trim()}`,
    };
  }
  const probe = run('docker', ['run', '--rm', '--network', 'none', 'hello-world'], 120_000);
  if (probe.status === 0) {
    return { canRun: true, reason: 'a container starts in this environment' };
  }
  return {
    canRun: false,
    reason: `the daemon answers but no container starts: ${(probe.stderr || probe.stdout).trim().split('\n').slice(-1)[0] ?? 'unknown reason'}`,
  };
}

test('FOUNDATION 20) the image definition and the local compose (M-75)', async (t) => {
  await t.test('⭐⭐⭐ M-75a: the image holds no secret and it is not a root image', () => {
    const text = dockerfile();
    // ⭐ The base image is declared and pinned to a major version.
    assert.match(text, /^FROM node:22-alpine$/m, 'the base image is not declared');
    // ⭐⭐ The process never runs as root.
    assert.match(text, /^USER wasl$/m, 'the image does not drop the root user');
    assert.match(text, /^RUN addgroup -S wasl/m, 'the image does not create the user');
    // ⭐⭐ No secret is baked into the image.
    assert.doesNotMatch(text, /ENV .*PASSWORD\s*=\s*\S/, 'the image bakes a password');
    assert.doesNotMatch(text, /ENV .*SECRET\s*=\s*\S/, 'the image bakes a secret');
    assert.doesNotMatch(text, /ENV .*TOKEN\s*=\s*\S/, 'the image bakes a token');
    // ⭐⭐ The liveness probe and the graceful shutdown are declared.
    assert.match(text, /^HEALTHCHECK/m, 'the image has no health check');
    assert.match(text, /^STOPSIGNAL SIGTERM$/m, 'the image does not declare the stop signal');
    // ⭐⭐ D-070: the PostgreSQL client is a RUNTIME dependency: a
    //   production image that installs only the dev dependencies would
    //   start without the driver of the database.
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
      readonly dependencies?: Record<string, string>;
      readonly devDependencies?: Record<string, string>;
    };
    assert.ok(manifest.dependencies?.['pg'], 'the database driver is not a runtime dependency');
    assert.ok(
      !manifest.devDependencies?.['pg'],
      'the database driver is still a dependency of the tests only',
    );
    // ⭐ The local secrets never enter the context of the build.
    const ignore = fs.readFileSync(path.join(ROOT, '.dockerignore'), 'utf8');
    assert.match(ignore, /\.local/, 'the local secrets are not excluded from the build');
    assert.match(ignore, /\.git/, 'the history of the repository is not excluded from the build');
  });

  await t.test('⭐⭐⭐ M-75b: the compose file publishes the backend on the loopback only', () => {
    const text = compose();
    // ⭐⭐ The published port is the loopback of the machine.
    assert.match(text, /"127\.0\.0\.1:8787:8787"/, 'the backend is not published on the loopback');
    // ⭐⭐ The database has NO published port: it lives on the internal
    //   network of the compose.
    const postgresSection = text.slice(text.indexOf('  postgres:'), text.indexOf('  backend:'));
    assert.doesNotMatch(postgresSection, /^\s*ports:/m, 'the database publishes a port');
    // ⭐⭐ The health check of the backend asks the readiness route.
    assert.match(text, /\/ready/, 'the health check does not use the readiness route');
    // ⭐⭐ The graceful shutdown has the time it needs.
    assert.match(text, /stop_grace_period:\s*\d+s/, 'the stop grace period is not declared');
    // ⭐⭐ No secret is written in the compose file.
    assert.doesNotMatch(
      text,
      /POSTGRES_PASSWORD:\s*[^$\s]/,
      'the compose file holds a password',
    );
    assert.match(text, /POSTGRES_PASSWORD:\s*\$\{/, 'the password is not a substitution');
    // ⭐⭐ The environment file of the example holds no real value.
    const env = fs.readFileSync(ENV_EXAMPLE, 'utf8');
    assert.match(env, /not-a-secret/, 'the environment example does not declare a synthetic value');
  });

  await t.test('⭐⭐⭐ M-75c: the dynamic drill (build, compose, health, readiness, shutdown)', async (t2) => {
    const probe = probeContainer();
    if (!probe.canRun) {
      // ⛔ The drill is BLOCKED and it says why. ⭐ It is never
      //   reported as a pass it did not measure.
      t2.skip(`the dynamic drill is BLOCKED in this environment - ${probe.reason}`);
      return;
    }

    // ⭐⭐ The build of the image (the context is the repository root).
    const build = run('docker', ['build', '-t', 'wasl-backend:m75-drill', '-f', 'Dockerfile', '.'], 900_000);
    assert.equal(build.status, 0, `the build failed: ${build.stderr.slice(-800)}`);
    const images = run('docker', ['images', '-q', 'wasl-backend:m75-drill'], 30_000);
    assert.ok(images.stdout.trim().length > 0, 'the image is not in the local store');

    // ⭐⭐ The compose file is a local example: it needs an environment
    //   file, and the drill creates one with synthetic values only.
    const envFile = path.join(ROOT, 'deploy', 'env.local');
    const existed = fs.existsSync(envFile);
    if (!existed) {
      fs.writeFileSync(
        envFile,
        [
          'WASL_PG_DATABASE=wasl_local',
          'POSTGRES_USER=wasl_local_owner',
          'POSTGRES_PASSWORD=local-synthetic-only-not-a-secret',
          'WASL_PG_OWNER_PASSWORD=local-synthetic-only-not-a-secret',
          'WASL_PG_PASSWORD=local-synthetic-only-not-a-secret',
          'WASL_SERVER_HOST=0.0.0.0',
          'WASL_SERVER_PORT=8787',
          'WASL_SESSION_TTL_SECONDS=900',
          'WASL_LOG_LEVEL=info',
          'WASL_ENV=staging',
          'WASL_TEST_PASSCODE=local-synthetic-passcode',
          '',
        ].join('\n'),
        { mode: 0o600 },
      );
    }
    try {
      const composeUp = run(
        'docker',
        [
          'compose',
          '-f',
          'deploy/docker-compose.local.example.yml',
          '--env-file',
          'deploy/env.local',
          'up',
          '--build',
          '-d',
        ],
        900_000,
      );
      assert.equal(composeUp.status, 0, `the compose failed: ${composeUp.stderr.slice(-800)}`);

      // ⭐⭐ The health and the readiness of the backend.
      let ready = false;
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const probeHealth = run(
          'docker',
          ['compose', '-f', 'deploy/docker-compose.local.example.yml', 'exec', '-T', 'backend',
            'node', '-e', "fetch('http://127.0.0.1:8787/ready').then(r=>{console.log(r.status);process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"],
          30_000,
        );
        if (probeHealth.status === 0) {
          ready = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      assert.ok(ready, 'the backend never became ready');

      // ⭐⭐ The graceful shutdown: SIGTERM and the container stops.
      const stop = run(
        'docker',
        ['compose', '-f', 'deploy/docker-compose.local.example.yml', 'stop', '-t', '30'],
        120_000,
      );
      assert.equal(stop.status, 0, `the graceful shutdown failed: ${stop.stderr.slice(-400)}`);
    } finally {
      run('docker', ['compose', '-f', 'deploy/docker-compose.local.example.yml', 'down', '-v'], 120_000);
      if (!existed) fs.rmSync(envFile, { force: true });
    }
  });
});

// ============================================================
// WASL AI — الموجة الثالثة (W3) — اختبار القبول ①
// ⭐ `production-check` — بوابة ما قبل الإصدار.
// ------------------------------------------------------------
// ⭐⭐⭐ WHAT THIS FILE PROVES
//   ① a MISSING required variable ⇒ a RED line ⇒ and the exit code
//      becomes 1 ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ so the gate can stop a release,
//   ② a PRESENT secret ⇒ the line says it is present ⇒ ⇒ ⇒ ⇒ ⇒ and
//      the VALUE of the secret is NEVER printed ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒,
//   ③ a secret written LITERALLY in a deployment file ⇒ a RED line
//      ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ and the value is not printed either,
//   ④ a port published on EVERY interface ⇒ a RED line ⇒ ⇒ ⇒ ⇒ ⇒,
//   ⑤ the schema checks read the real code ⇒ ⇒ ⇒ ⇒ ⇒ and a missing
//      migration lock ⇒ a RED line.
// ⛔ Local files only · ⛔ no database · ⛔ no network · ⛔ no docker.
// ============================================================

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  runProductionCheck,
  type CheckReport,
  type Verdict,
} from '../../tools/wasl-production-check.ts';

const REPO = path.resolve(import.meta.dirname, '..', '..');

/** ⭐ A synthetic project ⇒ ⭐ the tool is measured on a fixture. */
function fixture(overrides: {
  readonly compose?: string;
  readonly dockerfile?: string;
  readonly setup?: string;
  readonly migrations?: readonly string[];
  readonly ci?: string;
  readonly env?: string;
}): { root: string; codeRoot: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wasl-prod-'));
  fs.mkdirSync(path.join(dir, 'deploy'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'server', 'db', 'migrations'), { recursive: true });
  if (overrides.compose !== undefined) {
    fs.writeFileSync(path.join(dir, 'deploy', 'docker-compose.staging.example.yml'), overrides.compose);
  }
  if (overrides.dockerfile !== undefined) {
    fs.writeFileSync(path.join(dir, 'Dockerfile'), overrides.dockerfile);
  }
  if (overrides.setup !== undefined) {
    fs.mkdirSync(path.join(dir, 'server', 'db'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'server', 'db', 'setup.ts'), overrides.setup);
  }
  for (const name of overrides.migrations ?? []) {
    fs.writeFileSync(path.join(dir, 'server', 'db', 'migrations', name), 'select 1;\n');
  }
  if (overrides.ci !== undefined) {
    fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.github', 'workflows', 'ci.yml'), overrides.ci);
  }
  return { root: dir, codeRoot: dir };
}

function verdictOf(report: CheckReport, id: string): Verdict | null {
  return report.lines.find((line) => line.id === id)?.verdict ?? null;
}

const GOOD_COMPOSE = [
  'name: wasl-staging',
  'services:',
  '  backend:',
  '    image: wasl-backend:example',
  '    ports:',
  '      - "127.0.0.1:8787:8787"',
  '    healthcheck:',
  '      test: ["CMD", "true"]',
  '  postgres:',
  '    image: postgres:15',
  '    environment:',
  '      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}',
].join('\n');

const GOOD_DOCKERFILE = ['FROM node:22-alpine', 'USER wasl', 'HEALTHCHECK CMD true'].join('\n');

test('FOUNDATION 3) the production gate — the pre-release check', async (t) => {
  await t.test('⭐ a missing required variable is a RED line and the exit code becomes 1', () => {
    const { root, codeRoot } = fixture({});
    const report = runProductionCheck({ env: {}, root, codeRoot });
    assert.equal(verdictOf(report, 'env-WASL_PG_PASSWORD'), 'fail');
    assert.equal(verdictOf(report, 'env-WASL_ENV'), 'fail');
    assert.equal(report.exitCode, 1, 'the gate must stop the release');
    assert.ok(report.fail > 0);
    fs.rmSync(root, { recursive: true, force: true });
  });

  await t.test('⭐⭐ the value of a secret is NEVER printed', () => {
    const secret = 'the-real-secret-value-9271';
    const { root, codeRoot } = fixture({});
    const report = runProductionCheck({
      env: { WASL_PG_PASSWORD: secret, WASL_ENV: 'staging' },
      root,
      codeRoot,
    });
    const text = JSON.stringify(report);
    assert.ok(!text.includes(secret), 'the value of the secret was printed');
    assert.equal(verdictOf(report, 'env-WASL_PG_PASSWORD'), 'ok');
    fs.rmSync(root, { recursive: true, force: true });
  });

  await t.test('⭐⭐ a secret written LITERALLY in a deployment file is a RED line', () => {
    const { root, codeRoot } = fixture({
      compose: `${GOOD_COMPOSE}\n  other:\n    environment:\n      WASL_PG_PASSWORD: a-real-looking-value\n`,
    });
    const report = runProductionCheck({ env: {}, root, codeRoot });
    const line = report.lines.find((candidate) => candidate.id.startsWith('secret-'));
    assert.ok(line, 'the scan did not find the literal secret');
    assert.equal(line.verdict, 'fail');
    assert.ok(!line.reason.includes('a-real-looking-value'), 'the scan printed the value');
    fs.rmSync(root, { recursive: true, force: true });
  });

  await t.test('⭐⭐ a port published on EVERY interface is a RED line', () => {
    const { root, codeRoot } = fixture({
      compose: GOOD_COMPOSE.replace('"127.0.0.1:8787:8787"', '"8787:8787"'),
    });
    const report = runProductionCheck({ env: {}, root, codeRoot });
    assert.equal(verdictOf(report, 'compose-port'), 'fail');
    fs.rmSync(root, { recursive: true, force: true });
  });

  await t.test('⭐⭐ the schema checks read the real code of the project', () => {
    const report = runProductionCheck({ env: {}, root: REPO, codeRoot: REPO });
    assert.equal(verdictOf(report, 'schema-lock'), 'ok');
    assert.equal(verdictOf(report, 'schema-role'), 'ok');
    assert.equal(verdictOf(report, 'schema-migrations'), 'ok');
    assert.equal(verdictOf(report, 'schema-destructive'), 'ok');
  });

  await t.test('⭐⭐ a missing migration lock is a RED line', () => {
    const { root, codeRoot } = fixture({
      setup: 'export const x = 1;\n',
      migrations: ['001_foundation.sql'],
    });
    const report = runProductionCheck({ env: {}, root, codeRoot });
    assert.equal(verdictOf(report, 'schema-lock'), 'fail');
    assert.equal(verdictOf(report, 'schema-migrations'), 'ok');
    fs.rmSync(root, { recursive: true, force: true });
  });

  await t.test('⭐⭐ a healthy project has no RED line in the sections it owns', () => {
    const { root, codeRoot } = fixture({
      compose: GOOD_COMPOSE,
      dockerfile: GOOD_DOCKERFILE,
      setup: 'select pg_advisory_lock(1); select pg_advisory_unlock(1); -- nobypassrls\n',
      migrations: ['001_foundation.sql', '002_phase02.sql'],
      ci: 'env:\n  WASL_CI_POSTGRES_PASSWORD: ${{ secrets.X }}\n',
    });
    const report = runProductionCheck({
      env: {
        WASL_ENV: 'staging',
        WASL_SERVER_HOST: '0.0.0.0',
        WASL_SERVER_PORT: '8787',
        WASL_PG_HOST: 'db',
        WASL_PG_PORT: '5432',
        WASL_PG_DATABASE: 'wasl',
        WASL_PG_PASSWORD: 'x',
        WASL_PG_OWNER_PASSWORD: 'y',
        WASL_TEST_PASSCODE: 'z',
      },
      root,
      codeRoot,
    });
    const red = report.lines.filter((line) => line.verdict === 'fail');
    assert.deepEqual(red.map((line) => line.id), [], 'a healthy project must have no red line');
    assert.equal(report.exitCode, 0);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

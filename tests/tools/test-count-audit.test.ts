// ============================================================
// WASL AI — FOUNDATION BUILD 03 / PHASE 04 (D-073) — M-85
// the tests of the audit of the test numbers
// ------------------------------------------------------------
// ⭐⭐ WHY THIS FILE EXISTS
//   The tool `tools/test_count_audit.py` is the guard of the numbers
//   of the project. ⭐⭐ A guard that is never tested is a guard that
//   fails silently ⇒ ⭐⭐ this file feeds it CONTROLLED fixtures and
//   checks that it accepts the right state and refuses the wrong one.
//   ⭐⭐ The two kinds of test are both here:
//     - the POSITIVE: a correct project passes (⇒ the tool does not
//       block the work),
//     - the NEGATIVE: a broken project fails (⇒ the tool catches the
//       contradiction).
// ⭐ The fixtures are built in a temporary directory ⇒ ⭐ the tool is
//   exercised through its REAL command line (`--root`) ⇒ ⭐⭐ the test
//   measures the tool as the owner runs it.
// ⛔ No file of the real project is touched by this file.
// ============================================================

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const TOOL = path.join(ROOT, 'tools', 'test_count_audit.py');

interface Fixture {
  readonly dir: string;
  readonly run: (args: string[]) => { status: number; output: string };
}

/** ⭐ Build a synthetic project: the package, the documents and the logs. */
function buildFixture(options: {
  readonly groups: Record<string, string[]>;
  readonly testFiles: string[];
  readonly published: readonly string[];
  readonly marker: string | null;
  readonly measured?: Record<string, number>;
  readonly total?: number;
}): Fixture {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wasl-m85-'));
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });

  const scripts: Record<string, string> = {};
  scripts['test'] = ['node', '--test', ...options.testFiles].join(' ');
  for (const [group, files] of Object.entries(options.groups)) {
    scripts[`test:${group}`] = ['node', '--test', ...files].join(' ');
  }
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', scripts }, null, 2),
    'utf8',
  );

  const body = [
    '# fixture',
    '',
    ...options.published.map((line) => `> ${line}`),
    ...(options.marker === null ? [] : [options.marker]),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'CURRENT-STATE.md'), body, 'utf8');
  fs.writeFileSync(path.join(dir, 'docs', 'TEST-MATRIX.md'), body, 'utf8');

  const logs: Record<string, string> = {};
  for (const [group, count] of Object.entries(options.measured ?? {})) {
    const file = path.join(dir, `group-${group}.log`);
    fs.writeFileSync(
      file,
      `# tests ${count}\n# pass ${count}\n# fail 0\n# skipped 0\n`,
      'utf8',
    );
    logs[group] = file;
  }
  if (options.total !== undefined) {
    fs.writeFileSync(
      path.join(dir, 'full.log'),
      `# tests ${options.total}\n# pass ${options.total}\n# fail 0\n# skipped 0\n`,
      'utf8',
    );
  }

  return {
    dir,
    run: (args: string[]) => {
      const command = ['python3', TOOL, '--root', dir, ...args];
      try {
        const output = execFileSync(command[0], command.slice(1), {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        return { status: 0, output };
      } catch (error) {
        const failure = error as { status?: number; stdout?: string; stderr?: string };
        return {
          status: failure.status ?? 1,
          output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
        };
      }
    },
  };
}

const FOUR = ['tests/a.test.ts', 'tests/b.test.ts', 'tests/c.test.ts', 'tests/d.test.ts'];

test('FOUNDATION 3) the audit of the test numbers is itself tested (M-85)', async (t) => {
  await t.test('⭐⭐ M-85a: a correct project passes (the positive case)', () => {
    const fixture = buildFixture({
      groups: {
        unit: ['tests/a.test.ts'],
        integration: ['tests/b.test.ts'],
        security: ['tests/c.test.ts'],
        recovery: ['tests/d.test.ts'],
      },
      testFiles: FOUR,
      published: ['559 + 147 + 105 + 16 = 827'],
      marker: '<!-- wasl:current-partition 559 + 147 + 105 + 16 = 827 -->',
      measured: { unit: 559, integration: 147, security: 105, recovery: 16 },
      total: 827,
    });
    try {
      const result = fixture.run([
        '--docs',
        '--log',
        path.join(fixture.dir, 'full.log'),
        '--group-log',
        `unit=${path.join(fixture.dir, 'group-unit.log')}`,
        '--group-log',
        `integration=${path.join(fixture.dir, 'group-integration.log')}`,
        '--group-log',
        `security=${path.join(fixture.dir, 'group-security.log')}`,
        '--group-log',
        `recovery=${path.join(fixture.dir, 'group-recovery.log')}`,
      ]);
      assert.equal(result.status, 0, `the tool refused a correct project: ${result.output}`);
      assert.match(result.output, /TEST COUNT AUDIT OK/);
    } finally {
      fs.rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  await t.test('⭐⭐ M-85b: the history is NOT compared with the measurement', () => {
    // ⭐⭐ The past phases keep their numbers ⇒ the tool must not
    //   refuse them ⇒ ⭐⭐ only the CURRENT one is compared.
    const fixture = buildFixture({
      groups: {
        unit: ['tests/a.test.ts'],
        integration: ['tests/b.test.ts'],
        security: ['tests/c.test.ts'],
        recovery: ['tests/d.test.ts'],
      },
      testFiles: FOUR,
      published: [
        '724 = 559 + 79 + 77 + 9',
        '774 = 559 + 108 + 91 + 16',
        '812 = 559 + 137 + 100 + 16',
        '827 = 559 + 147 + 105 + 16',
      ],
      marker: '<!-- wasl:current-partition 559 + 147 + 105 + 16 = 827 -->',
      measured: { unit: 559, integration: 147, security: 105, recovery: 16 },
      total: 827,
    });
    try {
      const result = fixture.run([
        '--docs',
        '--group-log',
        `unit=${path.join(fixture.dir, 'group-unit.log')}`,
        '--group-log',
        `integration=${path.join(fixture.dir, 'group-integration.log')}`,
        '--group-log',
        `security=${path.join(fixture.dir, 'group-security.log')}`,
        '--group-log',
        `recovery=${path.join(fixture.dir, 'group-recovery.log')}`,
      ]);
      assert.equal(
        result.status,
        0,
        `the tool refused the correct history: ${result.output}`,
      );
      assert.match(result.output, /TEST COUNT AUDIT OK/);
    } finally {
      fs.rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  await t.test('⭐⭐ M-85c: a wrong sum is a real contradiction (the negative case)', () => {
    const fixture = buildFixture({
      groups: {
        unit: ['tests/a.test.ts'],
        integration: ['tests/b.test.ts'],
        security: ['tests/c.test.ts'],
        recovery: ['tests/d.test.ts'],
      },
      testFiles: FOUR,
      published: ['559 + 149 + 100 + 16 = 834'],
      marker: '<!-- wasl:current-partition 559 + 147 + 105 + 16 = 827 -->',
    });
    try {
      const result = fixture.run(['--docs']);
      assert.notEqual(result.status, 0, 'the tool accepted a wrong sum');
      assert.match(result.output, /the sum is wrong/);
    } finally {
      fs.rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  await t.test('⭐⭐ M-85d: a missing marker is refused (the current state must be explicit)', () => {
    const fixture = buildFixture({
      groups: {
        unit: ['tests/a.test.ts'],
        integration: ['tests/b.test.ts'],
        security: ['tests/c.test.ts'],
        recovery: ['tests/d.test.ts'],
      },
      testFiles: FOUR,
      published: ['559 + 147 + 105 + 16 = 827'],
      marker: null,
    });
    try {
      const result = fixture.run(['--docs']);
      assert.notEqual(result.status, 0, 'the tool accepted a project without a marker');
      assert.match(result.output, /declares no current partition/);
    } finally {
      fs.rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  await t.test('⭐⭐ M-85e: a file counted twice is refused', () => {
    const fixture = buildFixture({
      groups: {
        unit: ['tests/a.test.ts', 'tests/a.test.ts'],
        integration: ['tests/b.test.ts'],
        security: ['tests/c.test.ts'],
        recovery: ['tests/d.test.ts'],
      },
      testFiles: FOUR,
      published: ['559 + 147 + 105 + 16 = 827'],
      marker: '<!-- wasl:current-partition 559 + 147 + 105 + 16 = 827 -->',
    });
    try {
      const result = fixture.run(['--docs']);
      assert.notEqual(result.status, 0, 'the tool accepted a file counted twice');
      assert.match(result.output, /listed twice/);
    } finally {
      fs.rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  await t.test('⭐⭐ M-85f: a file in two groups is refused', () => {
    const fixture = buildFixture({
      groups: {
        unit: ['tests/a.test.ts'],
        integration: ['tests/b.test.ts', 'tests/a.test.ts'],
        security: ['tests/c.test.ts'],
        recovery: ['tests/d.test.ts'],
      },
      testFiles: FOUR,
      published: ['559 + 147 + 105 + 16 = 827'],
      marker: '<!-- wasl:current-partition 559 + 147 + 105 + 16 = 827 -->',
    });
    try {
      const result = fixture.run(['--docs']);
      assert.notEqual(result.status, 0, 'the tool accepted a file in two groups');
      assert.match(result.output, /is in the groups/);
    } finally {
      fs.rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  await t.test('⭐⭐ M-85g: a current partition that differs from the measurement is refused', () => {
    const fixture = buildFixture({
      groups: {
        unit: ['tests/a.test.ts'],
        integration: ['tests/b.test.ts'],
        security: ['tests/c.test.ts'],
        recovery: ['tests/d.test.ts'],
      },
      testFiles: FOUR,
      published: ['559 + 147 + 105 + 16 = 827'],
      marker: '<!-- wasl:current-partition 559 + 137 + 100 + 16 = 812 -->',
      measured: { unit: 559, integration: 147, security: 105, recovery: 16 },
      total: 827,
    });
    try {
      const result = fixture.run([
        '--docs',
        '--group-log',
        `unit=${path.join(fixture.dir, 'group-unit.log')}`,
        '--group-log',
        `integration=${path.join(fixture.dir, 'group-integration.log')}`,
        '--group-log',
        `security=${path.join(fixture.dir, 'group-security.log')}`,
        '--group-log',
        `recovery=${path.join(fixture.dir, 'group-recovery.log')}`,
      ]);
      assert.notEqual(result.status, 0, 'the tool accepted a stale current partition');
      assert.match(result.output, /the measured ones are/);
    } finally {
      fs.rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  await t.test('⭐⭐ M-85h: a missing log is refused (the tool never invents a number)', () => {
    const fixture = buildFixture({
      groups: {
        unit: ['tests/a.test.ts'],
        integration: ['tests/b.test.ts'],
        security: ['tests/c.test.ts'],
        recovery: ['tests/d.test.ts'],
      },
      testFiles: FOUR,
      published: ['559 + 147 + 105 + 16 = 827'],
      marker: '<!-- wasl:current-partition 559 + 147 + 105 + 16 = 827 -->',
    });
    try {
      const result = fixture.run(['--docs', '--log', path.join(fixture.dir, 'absent.log')]);
      assert.notEqual(result.status, 0, 'the tool accepted a missing log');
      assert.match(result.output, /does not exist/);
    } finally {
      fs.rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  await t.test('⭐⭐ M-85i: the real project of the owner is consistent right now', () => {
    // ⭐⭐ The tool is run against the REAL project ⇒ ⭐⭐ the numbers
    //   that are published are the numbers of the scripts of the repo.
    const result = (() => {
      try {
        const output = execFileSync('python3', [TOOL, '--docs'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        return { status: 0, output };
      } catch (error) {
        const failure = error as { status?: number; stdout?: string; stderr?: string };
        return {
          status: failure.status ?? 1,
          output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
        };
      }
    })();
    assert.equal(result.status, 0, `the real project is inconsistent: ${result.output}`);
    assert.match(result.output, /TEST COUNT AUDIT OK/);
  });
});

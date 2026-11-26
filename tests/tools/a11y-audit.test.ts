// ============================================================
// WASL AI — pf-26 — the guard of the accessibility audit
// ------------------------------------------------------------
// ⭐⭐⭐ WHAT THIS FILE PROVES
//   ① ⭐⭐⭐ THE TOOL FINDS A MISSING ELEMENT: an image with no
//      alternative text ⇒ ⭐⭐⭐ it is reported as ONE clear line
//      (the severity · the file · the line · the rule);
//   ② ⭐⭐⭐ THE CLEAN FILE PRODUCES NOTHING (⇒ the tool does not
//      invent a finding);
//   ③ ⭐⭐⭐ THE EXIT CODE IS CORRECT: 1 when a high severity finding
//      exists · 0 when the file is clean · 2 when the path is wrong;
//   ④ ⭐⭐⭐ THE OUTPUT IS REPRODUCIBLE: the same file gives the
//      same lines every time.
// ⛔ Local files only (no database, no network).
// ============================================================

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { auditFile, auditPaths, formatFinding } from '../../tools/wasl-a11y-audit.ts';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOOL = path.join(REPO, 'tools', 'wasl-a11y-audit.ts');
const FIXTURE_MISSING = path.join(REPO, 'tests', 'tools', 'fixtures', 'a11y-missing-alt.html');
const FIXTURE_CLEAN = path.join(REPO, 'tests', 'tools', 'fixtures', 'a11y-clean.html');

/** ⭐ Run the tool as a process ⇒ the exit code is observed, not assumed. */
function runTool(args: readonly string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(
      process.execPath,
      ['--experimental-strip-types', TOOL, ...args],
      { encoding: 'utf8', cwd: REPO },
    );
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

test('pf-26) the accessibility audit of the interface', async (t) => {
  await t.test('⭐⭐⭐ ① the tool reads a file and reports the missing element', () => {
    const report = auditFile(FIXTURE_MISSING);
    assert.equal(report.findings.length, 1, 'the fixture has exactly one defect');
    const finding = report.findings[0]!;
    assert.equal(finding.rule, 'img-missing-alt', 'the rule is the one of the missing alternative text');
    assert.equal(finding.severity, 'high', 'a missing alternative text is a high severity');
    assert.match(finding.file, /a11y-missing-alt\.html$/, 'the finding names the file');
    assert.ok(finding.line > 0, 'the finding names the line');
    assert.match(finding.message, /alt/, 'the message says what is missing');
  });

  await t.test('⭐⭐⭐ ② the command prints ONE clear line for the defect', () => {
    const run = runTool([FIXTURE_MISSING]);
    const lines = run.stdout.split('\n').filter((line) => line.trim() !== '');
    assert.equal(lines.length, 2, 'the defect is one line + the summary line');
    const [defect] = lines;
    assert.ok(defect !== undefined);
    assert.match(defect, /^HIGH/, 'the line starts with the severity');
    assert.match(defect, /img-missing-alt/, 'the line names the rule');
    assert.match(defect, /a11y-missing-alt\.html:\d+/, 'the line names the file and the line');
    assert.match(defect, /alt/, 'the line says what is missing');
  });

  await t.test('⭐⭐⭐ ③ the exit code is 1 with a high finding and 0 on a clean file', () => {
    const dirty = runTool([FIXTURE_MISSING]);
    assert.equal(dirty.status, 1, 'the exit code is 1 when a high severity finding exists');
    const clean = runTool([FIXTURE_CLEAN]);
    assert.equal(clean.status, 0, 'the exit code is 0 when the file is clean');
    assert.equal(
      clean.stdout.split('\n').filter((line) => line.trim() !== '').length,
      1,
      'the clean file prints only the summary line',
    );
  });

  await t.test('⭐⭐⭐ ④ the exit code is 2 when the path does not exist', () => {
    const run = runTool([path.join(REPO, 'tests', 'tools', 'fixtures', 'a11y-not-here.html')]);
    assert.equal(run.status, 2, 'the exit code is 2 for a path that cannot be read');
    assert.match(run.stderr, /a11y audit failed/, 'the error goes to the error stream');
  });

  await t.test('⭐⭐⭐ ⑤ the output is reproducible', () => {
    const first = runTool([FIXTURE_MISSING]).stdout;
    const second = runTool([FIXTURE_MISSING]).stdout;
    assert.equal(first, second, 'the same file gives the same output every time');
  });

  await t.test('⭐⭐⭐ ⑥ the clean file produces no finding at all', () => {
    const report = auditFile(FIXTURE_CLEAN);
    assert.equal(report.findings.length, 0, 'the clean fixture has no defect');
    const paths = auditPaths([FIXTURE_CLEAN]);
    assert.equal(paths.bySeverity.high, 0, 'no high severity in the clean fixture');
    assert.equal(paths.bySeverity.medium, 0, 'no medium severity in the clean fixture');
  });

  await t.test('⭐⭐⭐ ⑦ the line of a finding is readable on its own', () => {
    const report = auditFile(FIXTURE_MISSING);
    const line = formatFinding(report.findings[0]!);
    assert.match(line, /^HIGH\s/, 'the severity is padded at the start');
    assert.equal(line.split('\n').length, 1, 'the line is one line');
  });
});

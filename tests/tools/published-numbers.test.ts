// ============================================================
// WASL AI — M113 — the guard of the published numbers
// ------------------------------------------------------------
// ⭐⭐ WHAT THIS FILE PROVES
//   ① ⭐⭐⭐ NO UNREPLACED PLACEHOLDER ever reaches a published
//      document (the decision D-077 shipped with __TOTAL__ ·
//      __PASS__ · __PARTITION__ ⇒ ⭐⭐ a hole in the numbers is
//      a failure, not a warning);
//   ② ⭐⭐⭐ THE DOCUMENTS AGREE with each other: the machine-readable
//      marker `wasl:current-total` must carry the same numbers in
//      every document that states the current totals;
//   ③ ⭐⭐⭐ THE PROSE AGREES with the marker: a document cannot say
//      "931 successful" while the marker says 932;
//   ④ ⭐⭐⭐ THE MEASUREMENT agrees with the marker: the numbers are
//      read from a real run of `node --test`, never guessed.
// ⛔ Local documents only (no database, no network).
// ============================================================

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOOL = join(REPO, 'tools', 'published_numbers_audit.py');

/** ⭐⭐ The documents that the tool reads (the copy is the whole set). */
const PUBLISHED = [
  'DECISIONS.md',
  'CURRENT-STATE.md',
  'SESSION-NOTES.md',
  'docs/TEST-MATRIX.md',
  'docs/CHATGPT-REVIEW-LOG.md',
  'docs/OPEN-DECISIONS.md',
  'docs/GPT-REVIEW-054-REQUEST.md',
  'logs/2026-11-09.md',
];

/** ⭐⭐ A copy of the published documents in a temporary directory. */
function copyPublished(): string {
  const root = mkdtempSync(join(tmpdir(), 'wasl-published-'));
  for (const path of PUBLISHED) {
    const from = join(REPO, path);
    const to = join(root, path);
    cpSync(from, to, { recursive: true });
  }
  return root;
}

/** ⭐⭐ The result of the tool on a directory (never throws). */
function runTool(root: string, log?: string): { code: number; output: string } {
  const args = [TOOL, '--root', root];
  if (log) args.push('--log', log);
  try {
    const output = execFileSync('python3', args, { encoding: 'utf8', cwd: REPO });
    return { code: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      code: failure.status ?? 1,
      output: (failure.stdout ?? '') + (failure.stderr ?? ''),
    };
  }
}

test('FOUNDATION 4 bis 2) the guard of the published numbers (M113)', async (t) => {
  await t.test('⭐⭐⭐ the published documents are consistent right now', () => {
    const result = runTool(REPO);
    assert.equal(result.code, 0, `the tool refused the published documents:\n${result.output}`);
    assert.match(result.output, /PUBLISHED NUMBERS AUDIT OK/);
  });

  await t.test('⭐⭐⭐ the negative proof: an unreplaced placeholder is refused', () => {
    const root = copyPublished();
    try {
      const path = join(root, 'DECISIONS.md');
      const text = readFileSync(path, 'utf8');
      writeFileSync(path, text + '\n\nthe total is __TOTAL__ and the pass is __PASS__\n', 'utf8');
      const result = runTool(root);
      assert.notEqual(result.code, 0, 'the tool accepted an unreplaced placeholder');
      assert.match(result.output, /unreplaced placeholder/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await t.test('⭐⭐⭐ the negative proof: two documents that disagree are refused', () => {
    const root = copyPublished();
    try {
      const path = join(root, 'docs', 'TEST-MATRIX.md');
      const text = readFileSync(path, 'utf8');
      writeFileSync(
        path,
        text.replace(
          '<!-- wasl:current-total 933 = 932 pass + 0 fail + 1 skipped -->',
          '<!-- wasl:current-total 932 = 931 pass + 0 fail + 1 skipped -->',
        ),
        'utf8',
      );
      const result = runTool(root);
      assert.notEqual(result.code, 0, 'the tool accepted two documents that disagree');
      assert.match(result.output, /different current totals/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await t.test('⭐⭐⭐ the negative proof: a prose number against the marker is refused', () => {
    const root = copyPublished();
    try {
      const path = join(root, 'CURRENT-STATE.md');
      const text = readFileSync(path, 'utf8');
      writeFileSync(path, text.replace('\u0669\u0663\u0662 \u0646\u0627\u062c\u062d', '\u0669\u0663\u0661 \u0646\u0627\u062c\u062d'), 'utf8');
      const result = runTool(root);
      assert.notEqual(result.code, 0, 'the tool accepted a prose number that contradicts the marker');
      assert.match(result.output, /while the marker says/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await t.test('⭐⭐⭐ the negative proof: a measurement against the marker is refused', () => {
    const root = copyPublished();
    const log = join(mkdtempSync(join(tmpdir(), 'wasl-log-')), 'run.log');
    try {
      writeFileSync(
        log,
        '# tests 932\n# pass 931\n# fail 0\n# skipped 1\n',
        'utf8',
      );
      const result = runTool(root, log);
      assert.notEqual(result.code, 0, 'the tool accepted a measurement that contradicts the marker');
      assert.match(result.output, /the measured run is/);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(dirname(log), { recursive: true, force: true });
    }
  });
});

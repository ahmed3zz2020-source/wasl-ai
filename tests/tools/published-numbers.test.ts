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
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOOL = join(REPO, 'tools', 'published_numbers_audit.py');

// ⭐⭐⭐ M115 (٩ نوفمبر ٢٠٢٦ · ردّ #٥٦) — ⭐⭐⭐ **البراهين السالبة بتزرع القيم الحيّة**
// ------------------------------------------------------------
// ⭐⭐ **العيب الذي كشفه القياس الحيّ**: البرهانان السالبان كانا يزرعان نصوصاً
//   ثابتة من جولة #٥٤ (`933 = 932 pass` و`٩٦٢ ناجح`) ⇒ ⭐ ولما الأرقام المنشورة
//   اتغيّرت لـ`949 = 948` ⇒ ⭐⭐ **الزرع بقى بلا أثر (no-op)** ⇒ ⭐ والاختبار
//   فشل بسبب **تاني** (النسخة المؤقتة كانت فيها أقدم ملف طلب بلا marker)
//   ⇒ ⇒ ⇒ **ما عادش بيثبت حاجة**.
// ⭐⭐⭐ **القاعدة**: ⭐ **كل برهان سالب يقرأ الـmarker الحالي من الملف ويعدّله**
//   ⇒ ⇒ ⇒ فيثبت مهما صارت الأرقام المنشورة.
// ⭐⭐⭐ والنسخة المؤقتة تنسخ **أحدث** ملف طلب (اللي يحمل الـmarker) ⇒ لا أقدم ملف.

// ⭐⭐ The machine-readable marker (the one the tool reads).
const MARKER = /<!--\s*wasl:current-total\s+(\d+)\s*=\s*(\d+)\s+pass\s*\+\s*(\d+)\s+fail\s*\+\s*(\d+)\s+skipped\s*-->/;

interface Totals {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
}

/** ⭐⭐ The totals the documents declare RIGHT NOW (read ⇒ never written by hand). */
function readTotals(text: string, where: string): Totals {
  const found = MARKER.exec(text);
  assert.ok(found, `the document ${where} does not carry the current-total marker`);
  return {
    total: Number(found[1]),
    passed: Number(found[2]),
    failed: Number(found[3]),
    skipped: Number(found[4]),
  };
}

/** ⭐⭐ The marker line of a set of totals. */
function markerOf(totals: Totals): string {
  return `<!-- wasl:current-total ${totals.total} = ${totals.passed} pass + ${totals.failed} fail + ${totals.skipped} skipped -->`;
}

/** ⭐⭐ The Arabic-Indic digits (the documents write the numbers this way). */
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
function toArabicDigits(value: number): string {
  return String(value)
    .split('')
    .map((digit) => ARABIC_DIGITS[Number(digit)])
    .join('');
}

/** ⭐⭐ The start of the current scope of CURRENT-STATE.md (the same cut the tool uses). */
function currentScopeStart(text: string): number {
  const found = /^## \S+\.\S+-.+$/m.exec(text);
  return found ? found.index : 0;
}

/** ⭐⭐ The newest published reply request (the copy must carry the marker). */
function newestRequestPath(): string {
  const names = readdirSync(join(REPO, 'docs')).filter((name) =>
    /^GPT-REVIEW-\d+-REQUEST\.md$/.test(name),
  );
  assert.ok(names.length > 0, 'there is no published reply request to copy');
  const sorted = names.sort(
    (left, right) => Number(left.match(/(\d+)/)![1]) - Number(right.match(/(\d+)/)![1]),
  );
  return join('docs', sorted[sorted.length - 1]);
}

/** ⭐⭐ The documents that the tool reads (the copy is the whole set). */
const PUBLISHED = [
  'DECISIONS.md',
  'CURRENT-STATE.md',
  'SESSION-NOTES.md',
  'docs/TEST-MATRIX.md',
  'docs/CHATGPT-REVIEW-LOG.md',
  'docs/OPEN-DECISIONS.md',
];

/** ⭐⭐ A copy of the published documents in a temporary directory. */
function copyPublished(): string {
  const root = mkdtempSync(join(tmpdir(), 'wasl-published-'));
  const files = [...PUBLISHED, newestRequestPath()];
  for (const path of files) {
    const from = join(REPO, path);
    const to = join(root, path);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to, { recursive: true });
  }
  // ⭐⭐ every log of the repository (the tool reads `logs/*.md`).
  mkdirSync(join(root, 'logs'), { recursive: true });
  for (const name of readdirSync(join(REPO, 'logs'))) {
    cpSync(join(REPO, 'logs', name), join(root, 'logs', name), { recursive: true });
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
      // ⭐⭐ M115: the planted defect is DERIVED from the marker that the file
      // ⭐⭐ carries right now ⇒ ⭐⭐ the proof keeps working whatever the numbers become.
      const totals = readTotals(text, 'docs/TEST-MATRIX.md');
      const found = MARKER.exec(text);
      assert.ok(found, 'the document does not carry the marker to plant into');
      const planted = markerOf({
        total: totals.total - 1,
        passed: totals.passed - 1,
        failed: totals.failed,
        skipped: totals.skipped,
      });
      writeFileSync(
        path,
        text.slice(0, found.index) + planted + text.slice(found.index + found[0].length),
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
      // ⭐⭐ M115: the planted prose number is DERIVED from the live marker.
      const totals = readTotals(text, 'CURRENT-STATE.md');
      const scopeStart = currentScopeStart(text);
      const scope = text.slice(scopeStart);
      const prose = /([0-9٠-٩]+)\s*ناجح/.exec(scope);
      assert.ok(prose, 'the current scope does not write the passing count by hand');
      const wrong = toArabicDigits(totals.passed + 5);
      const planted =
        scope.slice(0, prose.index) + wrong + scope.slice(prose.index + prose[1].length);
      writeFileSync(path, text.slice(0, scopeStart) + planted, 'utf8');
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
      // ⭐⭐ M115: the planted measurement is DERIVED from the live marker.
      const totals = readTotals(
        readFileSync(join(root, 'docs', 'TEST-MATRIX.md'), 'utf8'),
        'the copy of docs/TEST-MATRIX.md',
      );
      writeFileSync(
        log,
        `# tests ${totals.total - 1}\n# pass ${totals.passed - 1}\n# fail ${totals.failed}\n# skipped ${totals.skipped}\n`,
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

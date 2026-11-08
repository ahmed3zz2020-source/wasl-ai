// ============================================================
// WASL AI — FOUNDATION BUILD 03 / PHASE 04 bis (D-074)
// the guard of the open decisions register (M-92 + M-94)
// ------------------------------------------------------------
// ⭐⭐ WHAT THIS FILE PROVES
//   ① ⭐⭐⭐ NO OPEN ITEM IS DROPPED: every item that the register
//      must carry is written by hand below ⇒ ⭐⭐ if a row is deleted
//      from `docs/OPEN-DECISIONS.md` ⇒ ⭐⭐ THIS TEST FAILS;
//   ② ⭐⭐⭐ NO APPROVED DECISION IS RE-OPENED: the decisions that
//      D-066 decided (DR-2 · DR-4 · DR-7 · DR-9 · AUTH) must NOT
//      appear as an OPEN item ⇒ ⭐⭐ (the rule of M-94);
//   ③ ⭐⭐⭐ NO CONTRADICTION WITH `DECISIONS.md`: the scope of D-066
//      is read from BOTH files and the two maps must be EQUAL ⇒ ⭐⭐
//      if the owner changes one file ⇒ ⭐⭐ the test fails until the
//      register is reconciled;
//   ④ the three PRODUCTION parts that are not approved are present
//      (the hosting provider · the numeric retention durations · the
//      production login mechanism) ⇒ ⭐⭐ they cannot be dropped;
//   ⑤ every OPEN row carries a source and a state (a row without a
//      source is a row that cannot be audited).
// ⛔ Local documents only (no database, no network).
// ============================================================

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REGISTER = join(REPO, 'docs', 'OPEN-DECISIONS.md');
const DECISIONS = join(REPO, 'DECISIONS.md');

const text = readFileSync(REGISTER, 'utf8');

/** ⭐⭐ the slice of one section (between the markers). */
function section(name: string): string {
  const start = text.indexOf(`<!-- wasl:open-decisions:${name} -->`);
  assert.ok(start >= 0, `the section ${name} is missing from the register`);
  const from = start + `<!-- wasl:open-decisions:${name} -->`.length;
  const end = text.indexOf('<!-- wasl:open-decisions:end -->', from);
  assert.ok(end > from, `the section ${name} is not closed`);
  return text.slice(from, end);
}

/** ⭐⭐ the rows of a table (the lines that start with a pipe). */
function rows(sectionText: string): string[][] {
  return sectionText
    .split('\n')
    .filter((line) => line.trim().startsWith('|'))
    .map((line) =>
      line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim()),
    )
    .filter((cells) => !cells.every((cell) => /^:?-+:?$/.test(cell) || cell === ''))
    .filter((cells) => cells[0] !== '#');
}

/**
 * ⭐⭐⭐ THE MANIFEST OF THE OPEN ITEMS (M94).
 * ⭐⭐ Written by hand on purpose ⇒ ⭐⭐ the file is the ground
 * truth of "what must not be dropped" ⇒ ⭐⭐ and the register must
 * match it.
 */
const REQUIRED_OPEN_ITEMS: readonly string[] = [
  'رفع الجاهزية الرسمية',
  'PHASE 05',
  'توسيع مصفوفة الصلاحيات',
  'ميزانية المقبس',
  'جدولة الاختبارات في CI',
  'معدّل التحديث',
  'آلية التحديث',
  'حقول تعديل العميل',
  'إظهار التصنيف',
  'حدّ الطرد على المزامنة',
  'تصديق جسر صلاحيات التذاكر',
  'سياسة الحفظ والتجديد',
  'التوقيع الخارجي للدليل',
];

/** ⭐⭐⭐ THE PRODUCTION PARTS THAT ARE NOT APPROVED (M94). */
const REQUIRED_PRODUCTION_ITEMS: readonly string[] = [
  'مزوّد الاستضافة',
  'المدد الرقمية للاحتفاظ',
  'آلية الدخول الإنتاجية',
];

/** ⭐⭐⭐ THE DECISIONS THAT D-066 DECIDED (they are CLOSED locally). */
const DECIDED_BY_D066: readonly string[] = ['DR-2', 'DR-4', 'DR-7', 'DR-9', 'AUTH'];

test('FOUNDATION 4 bis) the guard of the open decisions register (M-92 · M-94)', async (t) => {
  await t.test('⭐⭐⭐ no open item is dropped', () => {
    for (const item of REQUIRED_OPEN_ITEMS) {
      assert.ok(
        text.includes(item),
        `the item "${item}" fell out of the register (the manifest of M94 demands it)`,
      );
    }
  });

  await t.test('⭐⭐⭐ the three production parts are present', () => {
    for (const item of REQUIRED_PRODUCTION_ITEMS) {
      assert.ok(
        text.includes(item),
        `the production part "${item}" fell out of the register (M94 demands it)`,
      );
    }
  });

  await t.test('⭐⭐⭐ no approved decision is re-opened', () => {
    const openRows = rows(section('open')).concat(rows(section('production')));
    for (const cells of openRows) {
      const name = cells[1] ?? '';
      for (const decided of DECIDED_BY_D066) {
        assert.ok(
          !name.startsWith(decided),
          `the decision ${decided} is decided by D-066 and must not be an open item`,
        );
      }
    }
  });

  await t.test('⭐⭐⭐ every open row carries a source and a state', () => {
    for (const cells of rows(section('open'))) {
      assert.ok(cells.length >= 6, `the row "${cells[1] ?? ''}" has too few cells`);
      assert.ok((cells[2] ?? '').length > 0, `the row "${cells[1] ?? ''}" has no source`);
      assert.ok(
        (cells[3] ?? '').includes('مفتوح'),
        `the row "${cells[1] ?? ''}" is in the open section but its state is not "مفتوح"`,
      );
    }
  });

  await t.test('⭐⭐⭐ the register does NOT contradict DECISIONS.md (the scope of D-066)', () => {
    const decisions = readFileSync(DECISIONS, 'utf8');
    const start = decisions.indexOf('## D-066');
    assert.ok(start >= 0, 'D-066 is missing from DECISIONS.md');
    const end = decisions.indexOf('## D-067', start);
    const section066 = decisions.slice(start, end > start ? end : decisions.length);

    // ⭐ the decisions file ⇒ (the decision ⇒ the value).
    const fromDecisions = new Map<string, string>();
    for (const line of section066.split('\n')) {
      const cells = line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim());
      if (cells.length < 3) continue;
      const name = cells[1]?.replace(/\*/g, '').trim() ?? '';
      const value = cells[2]?.replace(/\*/g, '').trim() ?? '';
      if (DECIDED_BY_D066.includes(name) && /^[A-Z]$/.test(value)) {
        fromDecisions.set(name, value);
      }
    }

    // ⭐ the register ⇒ (the decision ⇒ the value).
    const fromRegister = new Map<string, string>();
    for (const cells of rows(section('approved'))) {
      const name = cells[0]?.replace(/\*/g, '').trim() ?? '';
      const value = cells[1]?.replace(/\*/g, '').trim().split(/\s|—|·/)[0] ?? '';
      if (DECIDED_BY_D066.includes(name) && /^[A-Z]$/.test(value)) {
        fromRegister.set(name, value);
      }
    }

    assert.equal(fromDecisions.size, DECIDED_BY_D066.length, 'D-066 does not hold the five decisions');
    assert.equal(
      fromRegister.size,
      fromDecisions.size,
      `the register holds ${fromRegister.size} of the ${fromDecisions.size} decisions of D-066`,
    );
    for (const [name, value] of fromDecisions) {
      assert.equal(
        fromRegister.get(name),
        value,
        `the register contradicts DECISIONS.md on ${name} (the register says ${
          fromRegister.get(name) ?? 'nothing'
        } · D-066 says ${value})`,
      );
    }
  });
});

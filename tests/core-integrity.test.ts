// ============================================================
// WASL AI — حارس سلامة النواة (M13 · تصريح المالك ٦ نوفمبر ٢٠٢٦)
// ------------------------------------------------------------
// ⭐⭐⭐⭐⭐ **الملاحظة التي أعقبها التنفيذ (ردّ #٣٠ · M13)**:
//   ⭐ «الاعتماد على `git diff --name-only HEAD -- src/core/` لا يكشف
//     التغييرات **الملتزم** بها» ⇒ ⇒⇒ **العيب في طريقة الإثبات**.
// ⭐⭐⭐⭐⭐ **التصحيح**: ⭐ **مقارنة بخطّ أساس ثابت** لا بـ`HEAD`.
//   ⭐ خطّ الأساس = `880dc14` (آخر commit قبل Slice 07) ⇒ ⭐ **مُثبَّت في
//     `DECISIONS.md` (D-060)** ⇒ ⇒⇒ **لا ينحرف صامتاً**.
// ⭐⭐⭐⭐⭐ **الطرد**: ⭐ كسر حقيقي في **نسخة معزولة** من المستودع ⇒ ⭐
//   نفس الفحص **يُكتشف** ⇒ ⇒⇒ **الحارس حسّاس وليس زائفاً**.
// ⛔ بلا شبكة · ⛔ بلا بيانات حقيقية · ⛔ **صفر تعديل في `src/core/`**.
// ============================================================

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  CORE_BASELINE_COMMIT,
  CORE_BASELINE_DECISION,
  CORE_PATH,
  breakTenantIsolationIn,
  changedCoreFiles,
  cloneIsolated,
  commitExists,
  commitIn,
  isAncestor,
} from './support/core-baseline.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const WORKSPACE = path.resolve(ROOT, '..');
/** ⭐ مجلد النسخة المعزولة — ⭐ **خارج المستودع** وداخل مساحة العمل. */
const ISOLATED = path.join(WORKSPACE, '.wasl-eviction-probe');

test('M13) ⭐⭐⭐⭐⭐ حارس سلامة النواة — مقارنة بخطّ أساس ثابت', async (t) => {
  await t.test('⭐ خطّ الأساس مُثبَّت في قرار المالك (لا ينحرف صامتاً)', () => {
    const decisions = fs.readFileSync(path.join(ROOT, 'DECISIONS.md'), 'utf8');
    assert.ok(
      decisions.includes(CORE_BASELINE_COMMIT),
      `خطّ الأساس (${CORE_BASELINE_COMMIT}) غير مُثبَّت في DECISIONS.md ⇒ ينحرف صامتاً`,
    );
    assert.ok(
      decisions.includes(CORE_BASELINE_DECISION),
      `القرار ${CORE_BASELINE_DECISION} غير موجود ⇒ خطّ الأساس بلا مرجع`,
    );
  });

  await t.test('⭐⭐ خطّ الأساس موجود في تاريخ المستودع وهو سلفٌ لـ`HEAD`', () => {
    assert.equal(commitExists(ROOT, CORE_BASELINE_COMMIT), true, 'خطّ الأساس غير موجود في التاريخ');
    assert.equal(
      isAncestor(ROOT, CORE_BASELINE_COMMIT),
      true,
      'خطّ الأساس ليس سلفاً لـHEAD ⇒ المرجع في فرع آخر ⇒ لازم إعادة ضبط صريحة',
    );
  });

  await t.test('⭐⭐⭐⭐⭐ `src/core/` لم تتغيّر منذ خطّ الأساس (ملتزم + غير ملتزم)', () => {
    const committed = changedCoreFiles(ROOT, CORE_BASELINE_COMMIT, 'HEAD');
    assert.deepEqual(
      committed,
      [],
      `تغيّرت ملفات النواة (ملتزم) منذ خطّ الأساس:\n${committed.join('\n')}`,
    );
    const workingTree = changedCoreFiles(ROOT, CORE_BASELINE_COMMIT, 'WORKTREE');
    assert.deepEqual(
      workingTree,
      [],
      `تغيّرت ملفات النواة (شجرة العمل) منذ خطّ الأساس:\n${workingTree.join('\n')}`,
    );
  });

  await t.test('⭐⭐⭐⭐⭐⭐ الطرد: كسر حقيقي في نسخة معزولة ⇒ الحارس يكتشفه', () => {
    cloneIsolated(ROOT, ISOLATED);
    try {
      // ① الحالة القبلية: لا تغيّر في النواة ⇒ الحارس لا يُبلّغ.
      assert.deepEqual(
        changedCoreFiles(ISOLATED, CORE_BASELINE_COMMIT, 'HEAD'),
        [],
        'النسخة المعزولة لا تطابق خطّ الأساس أصلاً ⇒ الفحص غير صالح',
      );

      // ② كسر حقيقي: تعديل ملف نواة + commit داخل النسخة المعزولة فقط.
      const broken = breakTenantIsolationIn(ISOLATED);
      commitIn(ISOLATED, 'eviction probe — كسر متعمّد لعزل المستأجر');

      // ③ نفس الفحص ⇒ لازم يكشف الملف ⇒ ⇒⇒ الحارس حسّاس.
      const detected = changedCoreFiles(ISOLATED, CORE_BASELINE_COMMIT, 'HEAD');
      assert.deepEqual(
        detected,
        [broken],
        `الحارس لم يكتشف كسراً حقيقياً في النطاق (${CORE_PATH}) ⇒ اختبار زائف`,
      );
    } finally {
      fs.rmSync(ISOLATED, { recursive: true, force: true });
    }
  });

  await t.test('⭐⭐⭐⭐⭐ النسخة المعزولة تُحذف (لا أثر خارج المستودع)', () => {
    assert.equal(fs.existsSync(ISOLATED), false, 'بقيت نسخة معزولة على القرص');
  });
});

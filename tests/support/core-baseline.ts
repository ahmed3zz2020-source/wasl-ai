// ============================================================
// WASL AI — خطّ أساس النواة (حارس M13)
// ------------------------------------------------------------
// ⭐⭐⭐⭐⭐ **«الفحص يمرّ» ≠ «الفحص يفحص»** ⇒ ⭐⇒⇒ **مقارنة `HEAD` أعمى
//   عن أي تغيير مُلتزَم** ⇒ ⇒⇒ **لازم خطّ أساس ثابت**.
// ⭐ خطّ الأساس = آخر commit **قبل** جولة التقوية (D-062) ⇒ ⇒⇒ وهو الحدّ
//   الذي يُقاس عليه «النواة لم تتغيّر منذ خطّ الأساس».
// ⭐ الرقم **مُثبَّت في `DECISIONS.md`** ⇒ ⇒⇒ **لا ينحرف صامتاً**.
// ⛔ هذا الملف **اختبار فقط** ⇒ ⛔ لا يُستورد من `src/`.
// ============================================================

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * ⭐⭐⭐ **خطّ الأساس المُعتمد** — ⭐ آخر commit **قبل** جولة التقوية.
 * ⭐ **مُثبَّت في `DECISIONS.md`** ⇒ ⇒⇒ يتغيّر فقط بقرار صريح.
 * ⭐⭐ **تحديث D-064 (٦ نوفمبر ٢٠٢٦)**: ⭐ جولة «S09-0 — عقد مصدر الهوية
 *   بلا تفعيل» غيّرت `src/core/` **عمداً** (ملف `identity-source-contract.ts`)
 *   ⇒ ⇒⇒ **فالمرجع تحرّك إلى `38ffd77`** (آخر commit قبل تحديث هذا المرجع)
 *   ⇒ ⇒⇒⇒ **وإعادة الضبط = قرار صريح (لا تلقائي)** ⇒ ⭐ وهذا الصف هو سنده.
 * ⭐ **سجلّ التتبّع**: `da897f0` (D-062 · Slice 08) ⇒ `38ffd77` (D-064 · S09-0).
 * D-065 (2026-11-06): baseline moved to fc4ec6a (Acceleration Pack 01)
 *   (M54 issuer trust + M55 contract semantics changed src/core/ on purpose)
 */
export const CORE_BASELINE_COMMIT = 'fc4ec6ac877f97012e09e69ea91fda0510b01421';

/** ⭐ القرار الذي يثبّت خطّ الأساس (⇒ يُفحص توثيقه مع الرقم). */
export const CORE_BASELINE_DECISION = 'D-065';

/** ⭐⭐⭐ نطاق الفحص — ⭐ **نواة الإنتاج** (لا الأدوات ولا الاختبارات). */
export const CORE_PATH = 'src/core/';

/** ⭐⭐⭐ ناتج `git` (نص مُقصَّص) — ⭐ بلا shell ⇒ بلا اقتباس. */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/**
 * ⭐⭐⭐⭐⭐ **الملفات المتغيّرة في النطاق بين مرجعَين** (الملتزم + غير الملتزم).
 * ⭐ `to` = `HEAD` ⇒ مقارنة **مُلتزَم** ⇒ `to` = `WORKTREE` ⇒ مقارنة
 * **شجرة العمل** (تغطي الملتزم وغير الملتزم معاً).
 */
export function changedCoreFiles(cwd: string, from: string, to: 'HEAD' | 'WORKTREE'): string[] {
  const args = ['diff', '--name-only', from];
  if (to === 'HEAD') args.push('HEAD');
  args.push('--', CORE_PATH);
  const out = git(cwd, ...args);
  return out.split('\n').map((line) => line.trim()).filter(Boolean);
}

/** ⭐⭐⭐ هل المرجع موجود في تاريخ المستودع؟ */
export function commitExists(cwd: string, ref: string): boolean {
  try {
    execFileSync('git', ['cat-file', '-e', `${ref}^{commit}`], { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** ⭐⭐⭐ هل المرجع سلفٌ لـ`HEAD`؟ (⇐ يمنع المرجع من فرع آخر) */
export function isAncestor(cwd: string, ancestor: string, descendant = 'HEAD'): boolean {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * ⭐⭐⭐⭐⭐ **نسخة معزولة من المستودع** — ⭐ لاختبار الطرد.
 * ⭐ `⛔ --no-hardlinks` ⇒ ⭐ تعديل الملفات في النسخة **لا يمسّ الأصل أبداً**.
 * ⭐ المجلد = **خارج المستودع** وداخل مساحة العمل ⇒ ⭐ لا يلوّث الريبو.
 */
/** ⭐⭐⭐ نوم متزامن قصير (بلا `async`) ⇒ ⭐ لتهدئة الملفات تحت الحمل. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * ⭐⭐⭐⭐⭐ **نسخة معزولة من المستودع** — ⭐ لاختبار الطرد.
 * ⭐ `⛔ --no-hardlinks` ⇒ ⭐ تعديل الملفات في النسخة **لا يمسّ الأصل أبداً**.
 * ⭐ المجلد = **خارج المستودع** وداخل مساحة العمل ⇒ ⭐ لا يلوّث الريبو.
 * ⭐⭐ **إعادة محاولة (٣ محاولات)**: ⭐ تحت الحمل المتوازي قد يفشل
 *   `git clone` عابراً (قفل ملف أو ضغط I/O) ⇒ ⭐⇒⇒ **والمحاولة
 *   الواحدة الفاشلة ⛔ كانت تُسقط الاختبار بلا سبب حقيقي** ⇒ ⭐⇒⇒⇒
 *   **⇒ القاعدة: كل محاولة تفشل ⇒ الخطأ الأخير يُعرض بصوت (لا إخفاء).**
 */
export function cloneIsolated(repoRoot: string, targetDir: string): void {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      fs.rmSync(targetDir, { recursive: true, force: true });
      execFileSync(
        'git',
        ['clone', '--local', '--no-hardlinks', '--quiet', repoRoot, targetDir],
        { cwd: repoRoot, stdio: 'ignore' },
      );
      return;
    } catch (error) {
      lastError = error;
      fs.rmSync(targetDir, { recursive: true, force: true });
      if (attempt < 3) sleepSync(500 * attempt);
    }
  }
  throw new Error(
    `\u2b50 فشل استنساخ النسخة المعزولة بعد 3 محاولات: ${String(lastError)}`,
  );
}

/** ⭐⭐⭐⭐⭐ **يكسر النواة عمداً داخل النسخة المعزولة فقط** — ⭐ لاختبار الطرد. */
export function breakTenantIsolationIn(cloneDir: string): string {
  const file = path.join(cloneDir, 'src', 'core', 'store.ts');
  const original = fs.readFileSync(file, 'utf8');
  const anchor =
    'const byConversation = this.#byConversation.get(context.tenantId);\n' +
    '    const rows = byConversation?.get(conversationRef) ?? [];';
  if (original.split(anchor).length - 1 !== 1) {
    throw new Error('⭐ نقطة الكسر لم تعد موجودة ⇒ لازم تحديث اختبار الطرد');
  }
  const broken = original.replace(
    anchor,
    'const byConversation = [...this.#byConversation.values()].find((m) => m.has(conversationRef));\n' +
      '    const rows = byConversation?.get(conversationRef) ?? [];',
  );
  fs.writeFileSync(file, broken, 'utf8');
  return 'src/core/store.ts';
}

/**
 * ⭐⭐⭐⭐⭐ **يكسر سطراً في نواة داخل النسخة المعزولة فقط** — ⭐ لاختبار الطرد.
 * ⭐ `anchor` لازم يكون **فريداً** ⇒ ⭐⇒⇒ لو تغيّر الكود ⇒ يفشل الاختبار بصوت
 *   (لا يكسر بصمت) ⇒ ⭐⇒⇒⇒ **والتاريخ يظهر أن الكسر كان حقيقياً.**
 */
export function breakCoreIn(
  cloneDir: string,
  relativeFile: string,
  anchor: string,
  replacement: string,
): string {
  const file = path.join(cloneDir, relativeFile);
  const original = fs.readFileSync(file, 'utf8');
  const occurrences = original.split(anchor).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `\u2b50 نقطة الكسر في ${relativeFile} ظهرت ${occurrences} مرة (المتوقع 1) \u21d2 ` +
        'لازم تحديث اختبار الطرد',
    );
  }
  fs.writeFileSync(file, original.replace(anchor, replacement), 'utf8');
  return relativeFile;
}

/** ⭐⭐⭐⭐⭐ **يُثبّت التغيير داخل النسخة المعزولة** (commit حقيقي). */
export function commitIn(cloneDir: string, message: string): void {
  execFileSync('git', ['add', '-A'], { cwd: cloneDir, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'user.name=Eviction', '-c', 'user.email=eviction@local', 'commit', '-q', '-m', message],
    { cwd: cloneDir, stdio: 'ignore' },
  );
}

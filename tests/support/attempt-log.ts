// ============================================================
// WASL AI — سجلّ المحاولات (M56 · D-065)
// ------------------------------------------------------------
// ⭐⭐⭐⭐⭐ **العيب الذي يعالجه M56**: ⭐ إعادة المحاولة كانت **تطمس**
//   نتيجة المحاولة الأولى ⇒ ⭐⇒⇒ **ففشل أمني حقيقي في المحاولة الأولى
//   كان يختفي لو نجحت المحاولة الثانية** ⇒ ⭐⇒⇒⇒ **وهذا باب ضائع خطير.**
// ⭐⭐⭐ **القاعدة بعد M56 (ثلاثة بنود)**:
//   ① **كل محاولة مسجَّلة**: رقم المحاولة + رمز الخروج + الفحوص الفاشلة
//      ⇒ ⭐⇒⇒ **ولا تُمحى محاولة ولا تُخفى نتيجة**.
//   ② **إعادة المحاولة مسموحة لفشل البنية التحتية فقط**: تعذّر تشغيل
//      العملية · انتهاء المهلة · ناتج بلا بنية TAP ⇒ ⭐⇒⇒⇒ **وليس لفشل
//      فحوص حقيقي** (⇐ باب مغلق ⇒ الفشل يُعلن من المحاولة الأولى).
//   ③ إن نجحت المحاولة الثانية بعد فشل الأولى ⇒ ⭐⇒⇒ **لا يُخفى** ⇒ ⭐⇒⇒⇒
//      **يُعلن صراحةً** (سطر في المخرجات + داخل رسالة الفحص).
// ⛔ هذا الملف **اختبار فقط** ⇒ ⛔ لا يُستورد من `src/`.
// ============================================================

/** ⭐⭐⭐ **ناتج تشغيل واحد** (ما يُعيده المشغّل). */
export interface RawRun {
  readonly code: number;
  readonly output: string;
}

/** ⭐⭐⭐ **سجلّ محاولة واحدة** — ⭐ (لا يُمحى). */
export interface AttemptRecord {
  readonly attempt: number;
  readonly code: number;
  readonly output: string;
  /** ⭐ أسماء الفحوص الفاشلة (من TAP) — ⭐ إفراغها = لا فشل فحوص. */
  readonly failed_names: readonly string[];
  /** ⭐ هل هذا فشل **بنية تحتية** (تشغيل/مهلة/ناتج بلا بنية)؟ */
  readonly infrastructure_failure: boolean;
}

/** ⭐⭐⭐ **دفتر المحاولات** — ⭐ (نتيجة `runWithLedger`). */
export interface AttemptLedger {
  readonly attempts: readonly AttemptRecord[];
  /** ⭐⭐⭐ **نتيجة المحاولة الأولى** — ⭐ (لا تُستبدل أبداً). */
  readonly first: AttemptRecord;
  readonly final: AttemptRecord;
  /** ⭐ هل أُعيدت المحاولة؟ */
  readonly retried: boolean;
  /** ⭐⭐⭐ **هل نجحت محاولة بعد فشل سابق؟** ⇒ ⭐ (إعلان لا إخفاء). */
  readonly masked_by_retry: boolean;
  /** ⭐⭐⭐ **إعلان صريح** (يُطبع ويُضمَّن في رسالة الفحص). */
  readonly notes: readonly string[];
}

/** ⭐⭐⭐ أسماء الفحوص الفاشلة من ناتج TAP. */
export function failedTestNames(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('not ok '))
    .map((line) => line.replace(/^not ok \d+ - /, '').trim());
}

/** ⭐⭐⭐ هل الناتج يحمل بنية TAP؟ (⇒ فهو ناتج فحوص حقيقي). */
export function hasTapStructure(output: string): boolean {
  return /(^|\n)(ok|not ok) \d+/.test(output);
}

/** ⭐⭐⭐ **تصنيف الفشل** — ⭐ بنية تحتية أم فشل فحوص حقيقي؟ */
export function classifyAttempt(record: AttemptRecord): boolean {
  // ⭐ فشل فحوص حقيقي ⇒ ⭐ ليس بنية تحتية ⇒ ⭐⇒⇒ **لا إعادة محاولة.**
  if (record.failed_names.length > 0) return false;
  // ⭐ ناتج بلا بنية TAP ⇒ ⭐ الأداة نفسها هي التي انكسرت ⇒ ⭐ بنية تحتية.
  if (!hasTapStructure(record.output)) return true;
  // ⭐ رمز خروج غريب (بلا فحوص وبلا TAP) ⇒ ⭐ بنية تحتية (تشغيل/مهلة).
  return record.code !== 0 && record.code !== 1;
}

/** ⭐⭐⭐ **تشغيل مع دفتر محاولات** — ⭐ (M56: فصل المحاولة الأولى عن إعادتها). */
export function runWithLedger(
  runner: () => RawRun,
  options: { readonly max_attempts: number; readonly label?: string } = { max_attempts: 3 },
): AttemptLedger {
  const attempts: AttemptRecord[] = [];
  const max = Math.max(1, options.max_attempts);

  for (let index = 1; index <= max; index += 1) {
    const raw = runner();
    const names = failedTestNames(raw.output);
    const record: AttemptRecord = {
      attempt: index,
      code: raw.code,
      output: raw.output,
      failed_names: names,
      infrastructure_failure: false,
    };
    const classified: AttemptRecord = {
      ...record,
      infrastructure_failure: classifyAttempt(record),
    };
    attempts.push(classified);

    if (classified.code === 0) break;
    // ⭐⭐⭐ **الباب المغلق (M56)**: ⭐ إعادة المحاولة **لفشل البنية التحتية فقط**.
    if (!classified.infrastructure_failure) break;
  }

  const first = attempts[0];
  const final = attempts[attempts.length - 1];
  const retried = attempts.length > 1;
  const masked_by_retry = retried && first.code !== 0 && final.code === 0;
  const notes: string[] = [];
  if (masked_by_retry) {
    notes.push(
      `⚠️ المحاولة الأولى فشلت (رمز ${String(first.code)}) ثم نجحت المحاولة ` +
        `${String(final.attempt)} ⇒ ⭐ هذا **إعلان** لا إخفاء: ` +
        `الفحوص الفاشلة في المحاولة الأولى: ${first.failed_names.join(' | ') || '(لم تُستخرج)'}`,
    );
  }
  if (retried && !masked_by_retry && final.code !== 0) {
    notes.push(
      `⚠️ أُعيدت المحاولة ${String(attempts.length)} مرات (فشل بنية تحتية) ` +
        `والنتيجة النهائية فشلت ⇒ الخطأ الأول: ${first.failed_names.join(' | ') || '(لم تُستخرج)'}`,
    );
  }
  return { attempts, first, final, retried, masked_by_retry, notes };
}

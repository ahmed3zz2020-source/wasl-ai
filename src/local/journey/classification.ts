// ============================================================
// WASL AI — التصنيف الحتمي وقوالب الردّ (محاكاة محلية · D-065)
// ------------------------------------------------------------
// ⭐⭐⭐ **قاعدة الحاكمة**: ⭐ التصنيف = **جدول كلمات ثابت** ⇒ ⭐⇒⇒ **لا
//   نموذج تعلّم ولا استدعاء خارجي** ⇒ ⭐⇒⇒⇒ **فنفس النص ⇒ نفس النتيجة
//   دائماً** (قابل للتكرار).
// ⭐⭐ **الكشف عن النية**: ⭐ **أكثر عدد مطابقات** يفوز ⇒ ⭐⇒⇒ **وعند
//   التعادل يفوز **الترتيب المُعلَن** (`JOURNEY_INTENTS`)** ⇒ ⭐⇒⇒⇒ **فلا
//   عشوائية ولا اعتماد على ترتيب كائنات.**
// ⛔ لا بيانات عميل حقيقية · ⛔ لا استدعاء خارجي.
// ============================================================

import {
  JOURNEY_INTENTS,
  type JourneyClassification,
  type JourneyIntent,
  type JourneyPriority,
} from './types.ts';

/** ⭐⭐⭐ **جدول الكلمات المفتاحية** — ⭐ ثابت ومُعلَن (بلا تعلّم). */
const INTENT_KEYWORDS: Readonly<Record<JourneyIntent, readonly string[]>> = Object.freeze({
  billing: Object.freeze(['فاتورة', 'دفع', 'تحويل', 'اشتراك', 'سعر', 'مدفوعات']),
  technical: Object.freeze(['خطأ', 'تطبيق', 'تسجيل دخول', 'كلمة مرور', 'مشكلة', 'لا يعمل', 'عطل']),
  delivery: Object.freeze(['شحن', 'توصيل', 'عنوان', 'طرد', 'مندوب', 'شحنة']),
  general: Object.freeze([]),
});

/** ⭐⭐⭐ **كلمات رفع الأولوية** — ⭐ ثابتة. */
const HIGH_PRIORITY_KEYWORDS: readonly string[] = Object.freeze([
  'عاجل',
  'ضروري',
  'فورا',
  'متوقف',
  'انقطاع',
  'خسارة',
  'فشل',
]);

/** ⭐⭐⭐ **قوالب الردّ** — ⭐ ثابتة (نصّ محفوظ · بلا توليد). */
const REPLY_TEMPLATES: Readonly<Record<JourneyIntent, string>> = Object.freeze({
  billing:
    'استلمنا استفسارك عن الفواتير. تم تحويله إلى فريق الحسابات وسيتم الرد عليك في أقرب وقت.',
  technical:
    'استلمنا بلاغك عن المشكلة التقنية. فريق الدعم التقني يراجع التفاصيل الآن.',
  delivery: 'استلمنا استفسارك عن الشحنة. فريق التوصيل يتابع حالة الشحنة الآن.',
  general: 'استلمنا رسالتك. سيتواصل معك فريق خدمة العملاء لتفاصيل الاستفسار.',
});

/** ⭐⭐⭐ **سقف الأولوية** — ⭐ ثابت. */
const HIGH_PRIORITY_PREFIX = 'طلبك عاجل — تم رفع الأولوية.';

/** ⭐⭐⭐ **تطبيع النص** — ⭐ (حروف صغيرة + مسافات مدمجة). */
function normalize(text: string): string {
  return String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * ⭐⭐⭐⭐⭐ **تصنيف رسالة الرحلة** — ⭐ **حتمي بالكامل**.
 * ⭐ نفس النص ⇒ نفس النية والأولوية ⇒ ⭐⇒⇒ **فالنتيجة قابلة للتكرار.**
 */
export function classifyJourneyMessage(text: string): JourneyClassification {
  const normalized = normalize(text);
  const matched: string[] = [];

  let intent: JourneyIntent = 'general';
  let bestCount = 0;
  for (const candidate of JOURNEY_INTENTS) {
    const keywords = INTENT_KEYWORDS[candidate];
    let count = 0;
    for (const keyword of keywords) {
      if (normalized.includes(keyword)) {
        count += 1;
        matched.push(keyword);
      }
    }
    // ⭐⭐⭐ **الأكثر مطابقة يفوز** ⇒ ⭐⇒⇒ **وعند التعادل: الأول في الترتيب
    //   المُعلَن** ⇒ ⭐⇒⇒⇒ **فالنتيجة لا تعتمد على ترتيب غير مضمون.**
    if (count > bestCount) {
      intent = candidate;
      bestCount = count;
    }
  }

  let priority: JourneyPriority = 'normal';
  for (const keyword of HIGH_PRIORITY_KEYWORDS) {
    if (normalized.includes(keyword)) {
      priority = 'high';
      matched.push(keyword);
      break;
    }
  }

  return { intent, priority, matched: Object.freeze([...matched]) };
}

/**
 * ⭐⭐⭐⭐⭐ **ردّ الرحلة** — ⭐ **قالب ثابت** (بلا توليد · بلا خارجي).
 */
export function renderJourneyReply(
  intent: JourneyIntent,
  priority: JourneyPriority,
): string {
  const base = REPLY_TEMPLATES[intent] ?? REPLY_TEMPLATES.general;
  return priority === 'high' ? `${HIGH_PRIORITY_PREFIX} ${base}` : base;
}

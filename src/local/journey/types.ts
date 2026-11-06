// ============================================================
// WASL AI — أنواع رحلة خدمة العملاء (محاكاة محلية · D-065)
// ------------------------------------------------------------
// ⭐⭐⭐ **هذه محاكاة محلية** ⇒ ⭐ **ليست نظام خدمة عملاء** ⇒ ⭐ ولا قناة
//   تواصل حقيقية ⇒ ⭐ ولا إرسال ⇒ ⭐ ولا بيانات عميل حقيقية.
// ⭐⭐ **العقد الحاكم**: ⭐ كل قرار في الرحلة = **قرار النواة** (لا نسخة
//   موازية) ⇒ ⭐⇒⇒ **وكل ردّ = قالب ثابت** (بلا توليد) ⇒ ⭐⇒⇒⇒ **فالنتيجة
//   قابلة للتكرار بالكامل.**
// ⭐⭐ **الأثر**: ⭐ الرحلة **محاكاة صناعية بالكامل** ⇒ ⭐⇒⇒ **فلن يدخل
//   شيء منها إلى الإنتاج** ⇒ ⭐⇒⇒⇒ **وهي خارج حزمة `npm` (نطاق `src/core/`).**
// ⛔ بلا شبكة · ⛔ بلا تخزين دائم · ⛔ بلا استدعاء ذكاء خارجي.
// ============================================================

/** ⭐⭐⭐ **نيّات الرحلة** — ⭐ مجموعة مغلقة. */
export const JOURNEY_INTENTS = ['billing', 'technical', 'delivery', 'general'] as const;

export type JourneyIntent = (typeof JOURNEY_INTENTS)[number];

/** ⭐⭐⭐ **الأولويات** — ⭐ مجموعة مغلقة. */
export const JOURNEY_PRIORITIES = ['normal', 'high'] as const;

export type JourneyPriority = (typeof JOURNEY_PRIORITIES)[number];

/** ⭐⭐⭐ **أنواع الخطوات** — ⭐ مجموعة مغلقة (سجل الأحداث). */
export const JOURNEY_STEP_KINDS = [
  'identity',
  'receive',
  'classify',
  'reply',
  'assign',
  'advance',
  'reject',
] as const;

export type JourneyStepKind = (typeof JOURNEY_STEP_KINDS)[number];

/** ⭐⭐⭐ **خطوة واحدة في السجل** — ⭐ (محلي · في الذاكرة). */
export interface JourneyStep {
  readonly seq: number;
  readonly kind: JourneyStepKind;
  readonly detail: string;
  /** ⭐ رمز الرفض (إن وُجد) — ⭐ `null` = خطوة ناجحة. */
  readonly code: string | null;
}

/** ⭐⭐⭐ **نتيجة عملية في الرحلة**. */
export interface JourneyOutcome {
  readonly ok: boolean;
  readonly code: string | null;
  readonly conversation_ref: string;
  readonly intent: JourneyIntent | null;
  readonly priority: JourneyPriority | null;
  readonly reply: string | null;
  readonly state: string | null;
  readonly assignee_actor_id: string | null;
  readonly steps: readonly JourneyStep[];
}

/** ⭐⭐⭐ **نتيجة التصنيف** — ⭐ (حتمية · بلا توليد). */
export interface JourneyClassification {
  readonly intent: JourneyIntent;
  readonly priority: JourneyPriority;
  /** ⭐⭐ الكلمات التي رُدّت عليها — ⭐ (تُستعمل في التشخيص). */
  readonly matched: readonly string[];
}

// ============================================================
// WASL AI — الصلاحيات المحلية (الشريحة الثالثة)
// ------------------------------------------------------------
// ⭐ **الصلاحية = اسم مُعلَن** يمنح عملية قراءة بعينها (قائمة · محادثة · تدقيق).
// ⛔ **ليست نظام مصادقة** ⇒ ⭐ لا تسجيل دخول ولا كلمة مرور ولا حساب ولا جلسة حقيقية.
// ⭐ تُشتق من ادّعاءات جلسة **تحقّق منها مصدر الجلسات** (حدّ الثقة) ⇒ ⭐
//   ولا تُؤخذ من محتوى الرسالة ولا من مدخل العميل.
// ⛔ **الافتراضي = المنع** ⇒ ⭐ جلسة بلا صلاحيات = لا قراءة ولا تسريب.
// ============================================================

import type { TenantContext } from './tenant.ts';

/** ⭐ نمط اسم الصلاحية: حروف صغيرة وأرقام وشرطة سفلية، مقسّمة بنقاط. */
export const CAPABILITY_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;

export class CapabilityError extends Error {
  readonly code: string;
  readonly capability: string;
  constructor(code: string, capability: string, message: string) {
    super(message);
    this.name = 'CapabilityError';
    this.code = code;
    this.capability = capability;
  }
}

/**
 * ⭐⭐ تطبيع الصلاحيات القادمة من ادّعاءات الجلسة.
 * ⛔ **ما لا يطابق النمط لا يمنح أي صلاحية** ⇒ ⭐ الفشل = المنع (لا تجاوز).
 * ⭐ النتيجة مُجمَّدة ومرتَّبة ⇒ ⭐ نفس المدخلات = نفس النتيجة (قابل للتكرار).
 */
export function normalizeCapabilities(input: unknown): readonly string[] {
  if (!Array.isArray(input)) {
    return Object.freeze([]);
  }
  const granted = new Set<string>();
  for (const item of input) {
    if (typeof item !== 'string') continue;
    const text = item.trim();
    if (!CAPABILITY_PATTERN.test(text)) continue;
    granted.add(text);
  }
  return Object.freeze([...granted].sort());
}

/**
 * ⭐⭐ فحص الصلاحية المطلوبة عند عملية قراءة.
 * ⛔ **الفحص قبل أي وصول للبيانات** ⇒ ⭐ بلا صلاحية = رفض صريح بلا تسريب.
 * ⛔ لا يرفع ولا ينشئ صلاحية ⇒ ⭐ ولا يوسّع نطاق المستأجر.
 */
export function assertCapability(context: TenantContext, capability: string): void {
  const granted = context.capabilities ?? [];
  if (!granted.includes(capability)) {
    throw new CapabilityError(
      'capability_missing',
      capability,
      `الصلاحية المطلوبة غير متاحة: ${capability}`,
    );
  }
}

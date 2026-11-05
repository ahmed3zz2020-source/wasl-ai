// ============================================================
// WASL AI — الصلاحيات المحلية + سياسة الأدوار (حدّ الثقة)
// ------------------------------------------------------------
// ⭐ **الصلاحية = اسم مُعلَن** يمنح عملية بعينها (قراءة · حالة · إسناد · تدقيق).
// ⛔ **ليست نظام مصادقة** ⇒ ⭐ لا تسجيل دخول ولا كلمة مرور ولا حساب ولا جلسة حقيقية.
// ⭐ تُشتق من **دور موثّق** في جدول سياسة النواة ⇒ ⭐ ولا تُؤخذ من محتوى الرسالة
//   ولا من مدخل العميل ولا من حقل في حمولة الجلسة.
// ⛔ **الافتراضي = المنع** ⇒ ⭐ جلسة بلا دور يمنح ⇒ لا قراءة ولا تسريب.
// ⭐ **إصلاح حدّ الثقة (تصريح المالك · ٥ نوفمبر ٢٠٢٦ · D-055)**:
//   ⭐ قبل ⇒ كانت الصلاحيات تُقرأ من ادّعاءات الجلسة ⇒ ⇒ ومصدر يمرّر حمولة
//   العميل كما هي يمنح العميل صلاحياته بنفسه.
//   ⭐ بعد ⇒ ⭐ **الصلاحيات تُشتق هنا من (دور · سقف)** ⇒ ⭐ والدور من **سجل
//   التسجيل المعتمد** (سلطة المالك) ⇒ ⇒ ⇒ **مدخل العميل لا يملك أي تأثير
//   على الصلاحيات** ⇒ ⇒ ⇒ **لا مدخل ⇒ ولا مسار عبور**.
// ============================================================

import type { TenantContext } from './tenant.ts';

/** ⭐ نمط اسم الصلاحية: حروف صغيرة وأرقام وشرطة سفلية، مقسّمة بنقاط. */
export const CAPABILITY_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;

/**
 * ⭐⭐ الأدوار الموثوقة — ⭐ **مجموعة مغلقة** (لا قيمة خارجها).
 * ⛔ أي دور غير معلَن ⇒ ⭐ **صفر صلاحية** (الافتراضي = المنع).
 */
export const TRUSTED_ROLES = ['owner', 'supervisor', 'agent', 'viewer', 'none'] as const;

export type TrustedRole = (typeof TRUSTED_ROLES)[number];

/**
 * ⭐⭐⭐ سياسة الصلاحيات حسب الدور — ⭐ **المصدر الوحيد للصلاحيات في النواة**.
 * ⭐ الدور `none` = ⭐ **بلا منح** (الدور الافتراضي ⇒ المنع).
 * ⭐ الهرمية: `owner` (٦) › `supervisor` (٥) › `agent` (٤) › `viewer` (٣) › `none` (٠).
 */
export const ROLE_CAPABILITIES: Readonly<Record<TrustedRole, readonly string[]>> = Object.freeze({
  owner: Object.freeze([
    'conversation.list',
    'conversation.read',
    'conversation.audit',
    'conversation.state.read',
    'conversation.state.update',
    'conversation.assign',
  ]),
  supervisor: Object.freeze([
    'conversation.list',
    'conversation.read',
    'conversation.audit',
    'conversation.state.read',
    'conversation.state.update',
  ]),
  agent: Object.freeze([
    'conversation.list',
    'conversation.read',
    'conversation.audit',
    'conversation.state.read',
  ]),
  viewer: Object.freeze(['conversation.list', 'conversation.read', 'conversation.audit']),
  none: Object.freeze([]),
});

/** ⭐ فحص الدور: ⭐ **مُعلَن فقط** ⇒ ⭐ ما عداه ⇒ صفر صلاحية. */
export function isTrustedRole(value: unknown): value is TrustedRole {
  return typeof value === 'string' && (TRUSTED_ROLES as readonly string[]).includes(value);
}

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
 * ⭐⭐ تطبيع الصلاحيات القادمة من **سقف مسجَّل** (لا من ادّعاءات العميل).
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
 * ⭐⭐⭐ اشتقاق الصلاحيات الممنوحة — ⭐ **النواة هي من يقرّر**.
 * ⭐ المدخلان: ⭐ **دور موثّق** + ⭐ **سقف مسجَّل** ⇒ ⇒ **النتيجة = تقاطعهما**.
 * ⛔ المدخل من العميل **لا يدخل هنا إطلاقاً** ⇒ ⇒ ⇒ **الصلاحيات ليست قابلة للتزوير
 *   من مدخل غير موثوق** ⇒ ⇒ ⇒ *وإن كان الدور `none` أو السقف فارغ ⇒ ⇒ ⇒ صفر*.
 */
export function resolveGrantedCapabilities(
  role: TrustedRole,
  grantCeiling: readonly string[],
): readonly string[] {
  const ceiling = new Set(normalizeCapabilities(grantCeiling));
  const granted = new Set<string>();
  for (const capability of ROLE_CAPABILITIES[role]) {
    if (ceiling.has(capability)) granted.add(capability);
  }
  return Object.freeze([...granted].sort());
}

/**
 * ⭐⭐ فحص الصلاحية المطلوبة عند عملية قراءة أو تعديل.
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

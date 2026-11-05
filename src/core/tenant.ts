// ============================================================
// WASL AI — سياق المستأجر الموثوق (المكوّن ٢ · الشريحة الأولى)
// ------------------------------------------------------------
// ⭐ المبدأ الحاكم: هوية المستأجر لا تُؤخذ من «ادّعاء» بل من «إثبات».
//   ⛔ `authenticated: true` مكتوبة في كائن وارد ⇒ قيمتها إثباتية = صفر.
//   ⇒ الادّعاءات الخام تُعالَج في `session.ts` عبر «مصدر جلسات»
//     لا يمرّ منها شيء إلى هنا إلا بعد تحقّق المصدر نفسه.
// ⛔ لا يوجد في هذا الملف أي مسار يقرأ من محتوى الرسالة.
// ============================================================

import { normalizeCapabilities } from './capability.ts';

export type TenantId = string;

/** نمط معرّف المستأجر: أحرف صغيرة وأرقام وشرطة سفلية فقط. */
export const TENANT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,63}$/;

/** نمط معرّف المنفّذ (المستخدم/العملية) داخل المستأجر. */
export const ACTOR_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@-]{1,63}$/;

/** نمط معرّف الجلسة. */
export const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/;

/**
 * ⭐⭐ نمط معرّف المحادثة — محادثة داخل نطاق مستأجر واحد.
 * ⛔ **الشكل الصحيح ≠ موثوقية** ⇒ ⭐ **الموثوقية تأتي من مصدر الجلسات (حدّ الثقة)**.
 */
export const CONVERSATION_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

export class TenantContextError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'TenantContextError';
    this.code = code;
  }
}

/**
 * ⛔ مُطالبات الجلسة الخام — «ادّعاءات واردة من طرف خارجي».
 * ⛔ قيمها لا تُصدَّق بذاتها: `authenticated: true` كُتبت في كائن
 *    يرسله الطرف الآخر ⇒ لا قيمة إثباتية لها إطلاقاً.
 * ⇒ لا تُستخدم هذه الواجهة لإنشاء سياق تنفيذ — المسار الوحيد هو
 *   `resolveTenantContext` في `session.ts`.
 */
export interface SessionClaims {
  readonly session_id: string;
  readonly tenant_id: string;
  readonly actor_id: string;
  /**
   * ⭐⭐ معرّف المحادثة — ⭐ **يضعه مصدر الجلسات بعد تحقّقه** (حدّ الثقة).
   * ⛔ **قيمة حرة من العميل لا تُعدّ موثوقة أبداً**.
   */
  readonly conversation_ref: string;
  readonly authenticated: boolean;
  /**
   * ⭐⭐ الصلاحيات الممنوحة — ⭐ **يضعها مصدر الجلسات بعد تحقّقه** (حدّ الثقة).
   * ⛔ **قائمة حرة من العميل لا تُعدّ موثوقة** ⇒ ⭐ وما لا يطابق النمط لا يمنح شيئاً.
   * ⭐ **والافتراضي = المنع** ⇒ ⭐ جلسة بلا صلاحيات = لا قراءة ولا تسريب.
   */
  readonly capabilities?: readonly string[];
}

/**
 * ⭐ معرّف مصدر الجلسات (حدّ الثقة).
 * ⭐ `auth-middleware` = المعرّف الإنتاجي الوحيد المعتمد اليوم.
 * ⛔ أي معرّف آخر يجب أن يبدأ بـ`test-` ⇒ ⇒ لا يمكن التعبير عن
 *   مصدر اختبار بمعرّف إنتاجي داخل هذا الملف.
 */
export type SessionSourceId = 'auth-middleware' | `test-${string}`;

/**
 * ⭐ إثبات الجلسة — ناتج مصدر الجلسات **بعد** تحقّقه.
 * لا يُبنى إلا عبر `issueSessionAttestation` (داخلية) ⇒ فأي كائن
 * يحمل نفس الشكل لكن بدون تسجيل ⇒ مرفوض.
 */
export interface SessionAttestation {
  readonly claims: SessionClaims;
  readonly source: SessionSourceId;
  readonly issuedAt: string;
}

/**
 * سياق التنفيذ — يُمرَّر مع كل عملية.
 * يحوي معرّف المستأجر المعتمد (source of truth).
 */
export interface TenantContext {
  readonly tenantId: TenantId;
  readonly actorId: string;
  readonly sessionId: string;
  /**
   * ⭐⭐ المحادثة الموثوقة — ⭐ **مأخوذة من ادّعاءات جلسة تحقّق منها المصدر**
   * ⭐ (وليس من محتوى الرسالة) ⇒ ⭐ **وبها يُبنى نطاق الترتيب**.
   */
  readonly conversationRef: string;
  /**
   * ⭐⭐ الصلاحيات المعتمدة — ⭐ **من ادّعاءات جلسة تحقّق منها المصدر** (حدّ الثقة).
   * ⛔ **فارغة = لا صلاحية** ⇒ ⭐ الفشل = المنع (لا تجاوز).
   */
  readonly capabilities: readonly string[];
  readonly issuedAt: string;
}

/** ساعة افتراضية — تُحقن في الاختبارات لنتائج قابلة للتكرار. */
export function defaultNow(): string {
  return new Date().toISOString();
}

// ⭐⭐ سجلّ الإثباتات — خاصة بالوحدة ولا تُصدَّر.
//    ⇒ كائن إثبات مزوَّر (من خارج الوحدة) لا يمرّ.
const TRUSTED_ATTESTATIONS = new WeakSet<object>();

function assertPattern(
  field: string,
  value: unknown,
  pattern: RegExp,
  code: string,
): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TenantContextError(code, `${field}: قيمة مطلوبة غير فارغة`);
  }
  if (!pattern.test(value)) {
    throw new TenantContextError(code, `${field}: لا يطابق النمط المسموح`);
  }
  return value;
}

/**
 * ⭐ داخلي: يُصدر إثبات جلسة **مسجَّلاً** عند مصدر الجلسات فقط.
 * ⛔ غير مُصدَّر من `index.ts` (السطح العام) — يُستدعى من `session.ts` وحده.
 */
export function issueSessionAttestation(
  claims: SessionClaims,
  source: SessionSourceId,
  issuedAt: string,
): SessionAttestation {
  const attestation: SessionAttestation = { claims, source, issuedAt };
  TRUSTED_ATTESTATIONS.add(attestation);
  return attestation;
}

/**
 * ⭐ يبني سياق التنفيذ من **إثبات جلسة** (لا من ادّعاءات خام).
 * ⛔ لا يقبل أي حمولة رسالة — عمداً: لا يوجد أي مسار من الرسالة إلى السياق.
 * ⛔ ولا يقبل ادّعاءات خام: لا إثبات ⇒ لا سياق.
 */
export function tenantContextFromSession(
  attestation: SessionAttestation,
  now: () => string = defaultNow,
): TenantContext {
  if (!attestation || typeof attestation !== 'object') {
    throw new TenantContextError('session_missing', 'إثبات الجلسة مفقود');
  }
  if (!TRUSTED_ATTESTATIONS.has(attestation)) {
    throw new TenantContextError(
      'session_unverified',
      'إثبات الجلسة غير مُصدَر من مصدر الجلسات — لا يُبنى سياق تنفيذ',
    );
  }
  const claims = attestation.claims;
  if (!claims || typeof claims !== 'object') {
    throw new TenantContextError('session_missing', 'مطالبات الجلسة مفقودة');
  }
  if (claims.authenticated !== true) {
    throw new TenantContextError(
      'session_not_authenticated',
      'الجلسة غير مُصادَق عليها — لا يُبنى سياق تنفيذ',
    );
  }
  const tenantId = assertPattern(
    'tenant_id',
    claims.tenant_id,
    TENANT_ID_PATTERN,
    'tenant_invalid',
  );
  const actorId = assertPattern('actor_id', claims.actor_id, ACTOR_ID_PATTERN, 'actor_invalid');
  const sessionId = assertPattern(
    'session_id',
    claims.session_id,
    SESSION_ID_PATTERN,
    'session_invalid',
  );
  const conversationRef = assertPattern(
    'conversation_ref',
    claims.conversation_ref,
    CONVERSATION_REF_PATTERN,
    'conversation_invalid',
  );
  const capabilities = normalizeCapabilities(claims.capabilities);
  return { tenantId, actorId, sessionId, conversationRef, capabilities, issuedAt: now() };
}

/**
 * ⭐ فحص تطابق معرّف المستأجر المُعلن مع معرّف السياق الموثوق.
 * أي اختلاف = محاولة انتحال ⇒ تُرفض العملية.
 */
export function assertTenantMatches(
  context: TenantContext,
  declaredTenantId: string | undefined,
): void {
  if (declaredTenantId === undefined) {
    return; // غير مُعلن — المصدر المعتمد هو السياق نفسه
  }
  if (declaredTenantId !== context.tenantId) {
    throw new TenantContextError(
      'tenant_mismatch',
      'معرّف المستأجر المُعلن لا يطابق سياق التنفيذ الموثوق',
    );
  }
}

/**
 * ⭐⭐ فحص تطابق معرّف المحادثة المُعلن مع المحادثة الموثوقة في السياق.
 * ⛔ **فحص صارم (بلا استثناء)**: ⭐ الحقل إجباري في العقد ⇒ ⭐ وأي اختلاف
 *   = محاولة دخول محادثة أخرى ⇒ تُرفض العملية.
 * ⭐ **والسياق نفسه يحمل محادثة واحدة موثوقة ⇒ ⇒ فلا خلط بين محادثات المستأجر الواحد.**
 */
export function assertConversationMatches(
  context: TenantContext,
  declaredConversationRef: string | undefined,
): void {
  if (declaredConversationRef === undefined) {
    throw new TenantContextError(
      'conversation_missing',
      'معرّف المحادثة مفقود — المحادثة إلزامية في عقد الرسالة',
    );
  }
  if (declaredConversationRef !== context.conversationRef) {
    throw new TenantContextError(
      'conversation_mismatch',
      'معرّف المحادثة المُعلن لا يطابق المحادثة الموثوقة في سياق التنفيذ',
    );
  }
}

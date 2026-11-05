// ============================================================
// WASL AI — سياق المستأجر الموثوق (المكوّن ٢ · الشريحة الأولى)
// ------------------------------------------------------------
// ⭐ المبدأ الحاكم: هوية المستأجر لا تُؤخذ من «ادّعاء» بل من «إثبات».
//   ⛔ `authenticated: true` مكتوبة في كائن وارد ⇒ قيمتها إثباتية = صفر.
//   ⇒ الادّعاءات الخام تُعالَج في `session.ts` عبر «مصدر جلسات»
//     لا يمرّ منها شيء إلى هنا إلا بعد تحقّق المصدر نفسه.
// ⛔ لا يوجد في هذا الملف أي مسار يقرأ من محتوى الرسالة.
// ============================================================

export type TenantId = string;

/** نمط معرّف المستأجر: أحرف صغيرة وأرقام وشرطة سفلية فقط. */
export const TENANT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,63}$/;

/** نمط معرّف المنفّذ (المستخدم/العملية) داخل المستأجر. */
export const ACTOR_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@-]{1,63}$/;

/** نمط معرّف الجلسة. */
export const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/;

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
  readonly authenticated: boolean;
}

/** ⭐ معرّف مصدر الجلسات (حدّ الثقة). */
export type SessionSourceId = 'local-test-harness' | 'auth-middleware';

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
  return { tenantId, actorId, sessionId, issuedAt: now() };
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

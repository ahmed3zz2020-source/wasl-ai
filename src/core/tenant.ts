// ============================================================
// WASL AI — سياق المستأجر الموثوق (المكوّن ٢ · الشريحة الأولى)
// ------------------------------------------------------------
// المبدأ الحاكم: هوية المستأجر تأتي من «جلسة مُصادَق عليها» فقط.
// لا يوجد في هذا الملف أي مسار يقرأ من محتوى الرسالة أو من أي
// حقل داخلها — والاختبار المعاكس في tests/slice-01.test.ts يثبت
// ذلك بالتجربة (انتحال Tenant ID داخل الحمولة ⇒ رفض).
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
 * مُطالبات الجلسة المُصادَق عليها.
 * مصدرها طبقة المصادقة (Auth) — وهي مستقلة تماماً عن حمولة الرسالة.
 */
export interface SessionClaims {
  readonly session_id: string;
  readonly tenant_id: string;
  readonly actor_id: string;
  readonly authenticated: boolean;
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
 * يبني سياق التنفيذ من مُطالبات جلسة مُصادَق عليها.
 * ⛔ لا يقبل أي حمولة رسالة — عمداً: لا يوجد أي مسار من الرسالة إلى السياق.
 */
export function tenantContextFromSession(
  claims: SessionClaims,
  now: () => string = defaultNow,
): TenantContext {
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

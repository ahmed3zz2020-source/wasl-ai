// ============================================================
// WASL AI — حدّ الثقة: مصادر الجلسات (المكوّن ٢ · الشريحة الأولى)
// ------------------------------------------------------------
// ⭐ هذا الملف هو الحدّ الفاصل بين «إدخال غير موثوق» و«سياق موثوق».
// ⛔ `authenticated: true` وحدها لا تُثبت صحة أي جلسة.
// ⛔ لا يُبنى سياق مستأجر معتمد إلا من ادّعاءات مرّت عبر مصدر جلسات.
// ⭐ المصادر:
//   ① `local-test-harness` — المصدر الوحيد اليوم: مولّد محلي للاختبارات.
//      ⛔ ليس نظام مصادقة ولا يثبت هوية حقيقية.
//   ② `auth-middleware` — ⭐ **العقد جاهز والتنفيذ خارج نطاق الشريحة**:
//      طبقة المصادقة الحقيقية ستبني `SessionSource` بنفس العقد وتُعيد
//      الادّعاءات بعد تحقّقها أو ترفض (null) ⇒ ولا تُضاف أي صلاحية أخرى.
// ============================================================

import {
  issueSessionAttestation,
  tenantContextFromSession,
  defaultNow,
  ACTOR_ID_PATTERN,
  SESSION_ID_PATTERN,
  TENANT_ID_PATTERN,
  TenantContextError,
  type SessionClaims,
  type SessionSourceId,
  type TenantContext,
} from './tenant.ts';

/**
 * ⭐ عقد مصدر الجلسات — نقطة الالتقاء بين «المصادقة» و«النواة».
 * التنفيذ المستقبلي لطبقة المصادقة ينفّذ هذا العقد بالضبط.
 */
export interface SessionSource {
  readonly id: SessionSourceId;
  readonly description: string;
  /** ⭐ يُعيد الادّعاءات بعد تحقّقها، أو `null` لل رفض. */
  verify(input: unknown): SessionClaims | null;
}

// ⭐⭐ سجلّ المدخلات المحلية المُصنَّعة — خاصة بالوحدة ولا تُصدَّر.
//    ⇒ أي كائن آخر (حتى لو طابق الشكل تماماً) ⇒ يُرفض.
const LOCAL_TEST_INPUTS = new WeakSet<object>();

/**
 * ⭐ داخلي: يعلّم مدخلاً كمُصنَّع محلياً (من مولّد البيانات الاصطناعية).
 * ⛔ غير مُصدَّر من `index.ts` (السطح العام).
 */
export function markLocalTestInput<T extends SessionClaims>(claims: T): T {
  LOCAL_TEST_INPUTS.add(claims);
  return claims;
}

function structurallyValid(claims: SessionClaims): boolean {
  return (
    typeof claims.session_id === 'string' &&
    SESSION_ID_PATTERN.test(claims.session_id) &&
    typeof claims.tenant_id === 'string' &&
    TENANT_ID_PATTERN.test(claims.tenant_id) &&
    typeof claims.actor_id === 'string' &&
    ACTOR_ID_PATTERN.test(claims.actor_id)
  );
}

/**
 * ⭐ المصدر المحلي الوحيد اليوم — مولّد بيانات اصطناعية للاختبارات.
 * ⛔ لا يُتحقّق من هوية حقيقية ولا من كلمة مرور ولا من توقيع.
 * ⇒ وظيفته إثبات مسار الإدخال غير الموثوق فقط.
 */
export const localTestSessionSource: SessionSource = {
  id: 'local-test-harness',
  description:
    'مصدر محلي للاختبارات فقط — يتحقّق من أن المُدخل مُصنَّع محلياً (سِجل داخلي) لا من هوية حقيقية',
  verify(input: unknown): SessionClaims | null {
    if (!input || typeof input !== 'object') {
      return null;
    }
    if (!LOCAL_TEST_INPUTS.has(input as object)) {
      return null; // ⛔ ليس مُصنَّعاً محلياً ⇒ غير موثوق مهما كان شكله
    }
    const claims = input as SessionClaims;
    if (claims.authenticated !== true) {
      return null;
    }
    if (!structurallyValid(claims)) {
      return null;
    }
    return claims;
  },
};

/** ⭐ المصادر المتاحة الآن (للتشخيص والعرض فقط). */
export const ACTIVE_SESSION_SOURCES: readonly SessionSource[] = [localTestSessionSource];

/**
 * ⭐⭐ المسار العام الوحيد لإنشاء سياق مستأجر معتمد.
 * ⛔ لا يُصدَّق `authenticated: true` ولا أي حقل من المُدخل مباشرة.
 * ⛔ كل مُدخل يمرّ على مصدر الجلسات، والمصدر هو من يُقرّر.
 */
export function resolveTenantContext(
  input: unknown,
  options: { now?: () => string; source?: SessionSource } = {},
): TenantContext {
  const source = options.source ?? localTestSessionSource;
  const claims = source.verify(input);
  if (!claims) {
    throw new TenantContextError(
      'session_unverified',
      `مصدر الجلسات «${source.id}» لم يوثّق المُدخل ⇒ لا يُبنى سياق مستأجر معتمد ` +
        '(و`authenticated: true` وحدها لا تُثبت صحة أي جلسة)',
    );
  }
  const now = options.now ?? defaultNow;
  const attestation = issueSessionAttestation(claims, source.id, now());
  return tenantContextFromSession(attestation, now);
}

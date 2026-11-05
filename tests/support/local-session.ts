// ============================================================
// WASL AI — مصدر الجلسات المحلي (شجرة الاختبار فقط)
// ------------------------------------------------------------
// ⛔ **هذا الملف تحت `tests/` ⇒ خارج حزمة الإنتاج** (قائمة `files` في package.json).
// ⛔ لا يُصدَّر من `src/core/index.ts` (السطح العام الإنتاجي).
// ⭐ `scope: 'test'` ⇒ `resolveProductionTenantContext` يرفضه بنيوياً.
// ⭐ سجلّ `LOCAL_TEST_INPUTS` خاص بهذه الوحدة ⇒ لا يُبنى في الإنتاج إطلاقاً.
// ============================================================

import {
  ACTOR_ID_PATTERN,
  SESSION_ID_PATTERN,
  TENANT_ID_PATTERN,
  type SessionClaims,
} from '../../src/core/tenant.ts';
import type { SessionSource } from '../../src/core/session.ts';

/** ⭐⭐ سجلّ المدخلات المحلية المُصنَّعة — خاصة بالوحدة ولا تُصدَّر. */
const LOCAL_TEST_INPUTS = new WeakSet<object>();

/**
 * ⭐ داخلي: يعلّم مدخلاً كمُصنَّع محلياً (من مولّد البيانات الاصطناعية).
 * ⛔ لا يُصدَّر من السطح العام الإنتاجي.
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
 * ⭐ المصدر المحلي الوحيد — مولّد بيانات اصطناعية للاختبارات.
 * ⛔ لا يُتحقّق من هوية حقيقية ولا من كلمة مرور ولا من توقيع.
 * ⛔ نطاقه `test` ⇒ محجوز عن كل مسار إنتاجي.
 */
export const localTestSessionSource: SessionSource = {
  id: 'test-local-harness',
  scope: 'test',
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

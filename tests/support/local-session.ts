// ============================================================
// WASL AI — مصدر الجلسات المحلي (شجرة الاختبار فقط)
// ------------------------------------------------------------
// ⛔ **هذا الملف تحت `tests/` ⇒ خارج حزمة الإنتاج** (قائمة `files` في package.json).
// ⛔ لا يُصدَّر من `src/core/index.ts` (السطح العام الإنتاجي).
// ⭐ `scope: 'test'` ⇒ `resolveProductionTenantContext` يرفضه بنيوياً.
// ⭐ سجلّ `LOCAL_TEST_ROLES` خاص بهذه الوحدة ⇒ لا يُبنى في الإنتاج إطلاقاً.
// ⭐⭐ **إصلاح D-055**: ⭐ الدور يُقرأ من **السجل الداخلي** (سلطة المصدر)
//   ⇒ ⇒ ⇒ **ولا يُقرأ من حمولة العميل** ⇒ ⇒ ⇒⇒ **حقل `role` في الحمولة
//   مُتجاهل تماماً** (ولو قال العميل `owner` ⇒ ⇒ ⇒⇒ لا صلاحية زائدة).
// ============================================================

import {
  ACTOR_ID_PATTERN,
  CONVERSATION_REF_PATTERN,
  SESSION_ID_PATTERN,
  TENANT_ID_PATTERN,
  type SessionClaims,
  type VerifiedIdentity,
} from '../../src/core/tenant.ts';
import type { TrustedRole } from '../../src/core/capability.ts';
import { registerSessionSource, type SessionSource } from '../../src/core/session.ts';

/** ⭐⭐ سجلّ الأدوار الداخلية — ⭐ خاصة بالوحدة ولا تُصدَّر. */
const LOCAL_TEST_ROLES = new WeakMap<object, TrustedRole>();

/**
 * ⭐ داخلي: يعلّم مدخلاً كمُصنَّع محلياً (من مولّد البيانات الاصطناعية)
 * ⭐ **مع دوره** ⇒ ⭐ والدور يُقرأ من هذا السجل لا من الحمولة.
 * ⛔ لا يُصدَّر من السطح العام الإنتاجي.
 */
export function markLocalTestInput<T extends SessionClaims>(
  claims: T,
  role: TrustedRole = 'none',
): T {
  LOCAL_TEST_ROLES.set(claims as object, role);
  return claims;
}

function structurallyValid(claims: SessionClaims): boolean {
  return (
    typeof claims.session_id === 'string' &&
    SESSION_ID_PATTERN.test(claims.session_id) &&
    typeof claims.tenant_id === 'string' &&
    TENANT_ID_PATTERN.test(claims.tenant_id) &&
    typeof claims.actor_id === 'string' &&
    ACTOR_ID_PATTERN.test(claims.actor_id) &&
    typeof claims.conversation_ref === 'string' &&
    CONVERSATION_REF_PATTERN.test(claims.conversation_ref)
  );
}

/**
 * ⭐⭐ بناء المصدر المحلي — ⭐ دور واحد لكل مصدر (سلطة المالك).
 * ⭐ `scope: 'test'` ⇒ محجوز عن كل مسار إنتاجي.
 */
function buildLocalSource(role: TrustedRole): SessionSource {
  return {
    id: `test-local-${role}`,
    scope: 'test',
    description: `مصدر محلي للاختبارات فقط (دور: ${role}) — يتحقّق من أن المُدخل مُصنَّع محلياً (سِجل داخلي) لا من هوية حقيقية`,
    verify(input: unknown): VerifiedIdentity | null {
      if (!input || typeof input !== 'object') {
        return null;
      }
      const granted = LOCAL_TEST_ROLES.get(input as object);
      if (!granted) {
        return null; // ⛔ ليس مُصنَّعاً محلياً ⇒ غير موثوق مهما كان شكله
      }
      const claims = input as SessionClaims;
      if (claims.authenticated !== true) {
        return null;
      }
      if (!structurallyValid(claims)) {
        return null;
      }
      // ⭐ كائن هوية **جديد** ⇒ ⭐ لا تمرير لحمولة العميل ⇒ ⭐ وبلا صلاحيات.
      return {
        session_id: claims.session_id,
        tenant_id: claims.tenant_id,
        actor_id: claims.actor_id,
        conversation_ref: claims.conversation_ref,
        authenticated: true,
      };
    },
  };
}

/**
 * ⭐⭐ المصادر المحلية المسجَّلة — ⭐ واحد لكل دور.
 * ⭐ **مصدر لكل دور** ⇒ ⇒ ⇒ **الصلاحيات ثابتة لكل مصدر** ⇒ ⇒ ⇒
 * ⭐ ⇒⇒⇒ **مدخل العميل لا يستطيع تأثيراً على مجموعة الصلاحيات أطلاقاً**.
 */
export const LOCAL_TEST_SOURCES: Readonly<Record<TrustedRole, SessionSource>> = Object.freeze({
  owner: buildLocalSource('owner'),
  supervisor: buildLocalSource('supervisor'),
  agent: buildLocalSource('agent'),
  viewer: buildLocalSource('viewer'),
  none: buildLocalSource('none'),
});

/**
 * ⭐⭐⭐ مصدر بسقف مقيّد — ⭐ **يستخدمه اختبار السقف**.
 * ⭐ الدور معيّن والسقف محدّد ⇒ ⭐ فقط المنح المنوح للدور.
 */
function buildRestrictedSource(
  id: string,
  role: TrustedRole,
  ceiling: readonly string[],
): SessionSource {
  const source: SessionSource = {
    id: `test-${id}`,
    scope: 'test',
    description: `مصدر محلي للاختبارات بسقف مقيّد (${id})`,
    verify(input: unknown): VerifiedIdentity | null {
      return LOCAL_TEST_SOURCES[role].verify(input);
    },
  };
  registerSessionSource({ source, grantedRole: role, grantCeiling: ceiling });
  return source;
}

/**
 * ⭐⭐⭐ مصادر بسقوف مقيّدة — ⭐ **إثبات أن السقف يحكم**.
 * ⭐ دور `viewer` في كل مصدر ⇒ ⭐ لكن السقف يقتص يقتطع المنح.
 */
export const LOCAL_RESTRICTED_SOURCES = Object.freeze({
  readOnly: buildRestrictedSource('local-read-only', 'viewer', ['conversation.read']),
  listOnly: buildRestrictedSource('local-list-only', 'viewer', ['conversation.list']),
  stateReadOnly: buildRestrictedSource('local-state-read-only', 'agent', ['conversation.state.read']),
  noAccess: buildRestrictedSource('local-no-access', 'owner', []),
  // ⭐⭐ الشريحة الخامسة — ⭐ **مصدر يملك الطابور بلا المؤشرات** ⇒ ⭐
  // ⭐ **إثبات أن المؤشرات تحتاج صلاحية صريحة** (السقف يقتص).
  noMetrics: buildRestrictedSource('local-no-metrics', 'owner', [
    'conversation.list',
    'conversation.read',
    'conversation.audit',
    'conversation.state.read',
    'conversation.state.update',
    'conversation.assign',
    'conversation.queue.read',
  ]),
});

/** ⭐⭐ السقف المسجَّل لكل مصدر — ⭐ **سلطة المالك على ما يُمنح**. */
const LOCAL_TEST_CEILINGS: Readonly<Record<TrustedRole, readonly string[]>> = Object.freeze({
  owner: Object.freeze([
    'conversation.list',
    'conversation.read',
    'conversation.audit',
    'conversation.state.read',
    'conversation.state.update',
    'conversation.assign',
    'conversation.queue.read',
    'conversation.metrics.read',
  ]),
  supervisor: Object.freeze([
    'conversation.list',
    'conversation.read',
    'conversation.audit',
    'conversation.state.read',
    'conversation.state.update',
    'conversation.queue.read',
    'conversation.metrics.read',
  ]),
  agent: Object.freeze([
    'conversation.list',
    'conversation.read',
    'conversation.audit',
    'conversation.state.read',
    'conversation.queue.read',
  ]),
  viewer: Object.freeze(['conversation.list', 'conversation.read', 'conversation.audit']),
  none: Object.freeze([]),
});

for (const role of Object.keys(LOCAL_TEST_SOURCES) as TrustedRole[]) {
  registerSessionSource({
    source: LOCAL_TEST_SOURCES[role],
    grantedRole: role,
    grantCeiling: LOCAL_TEST_CEILINGS[role],
  });
}

/**
 * ⭐ المصدر المحلي الافتراضي (دور `none`) — ⭐ متوافق مع الاستدعاءات القديمة.
 * ⭐ `scope: 'test'` ⇒ محجوز عن كل مسار إنتاجي.
 */
export const localTestSessionSource: SessionSource = LOCAL_TEST_SOURCES.none;

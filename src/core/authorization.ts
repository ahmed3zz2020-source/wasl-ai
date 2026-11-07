// ============================================================
// WASL AI — طبقة التفويض المحلية (Slice 08 · P0)
// ------------------------------------------------------------
// ⭐⭐⭐ **ليست نظام مصادقة** ⇒ ⭐ طبقة **محلية تجريبية** تفصل بين:
//   ⭐ ① **مصدر الهوية** (من هي؟) ⇒ ⭐ `identity.ts` (سجلّ محلي موثوق)
//   ⭐ ② **قرار السماح** (يحق له؟) ⇒ ⭐ **هذه الوحدة** (باستعمال جدول النواة)
// ⛔ بلا رموز مصادقة · ⛔ بلا جلسات حقيقية · ⛔ بلا قاعدة بيانات · ⛔ بلا شبكة.
// ⭐⭐ **المبدأ الحاكم**: ⭐ **الدور يُشتق من السجلّ لا من الطلب** ⇒
//   ⭐⇒ **مصدر الهوية يبني «هوية موثّقة» جديدة** ⇒ ⭐ **لا حقل من
//   الحمولة (دور · مستأجر · صلاحيات) يصل إلى السياق — أبداً.**
// ⭐⭐ **لا محرك صلاحيات موازٍ** ⇒ ⭐ العمليات تُترجم إلى **الصلاحيات
//   الموجودة في `src/core/capability.ts`** ⇒ **والقرار = `assertCapability`**
//   ⇒ **فالقاعدة واحدة: سياسة النواة.**
// ⭐ **الفصل عن المسار الإنتاجي**: ⭐ مصادر الهوية المحلية نطاقها `test` ⇒
//   ⇒ **`resolveProductionTenantContext` يرفضها بنيوياً.**
// ============================================================

import {
  assertCapability,
  CONVERSATION_CREATE_CAPABILITY,
  CONVERSATION_WRITE_CAPABILITY,
  CUSTOMER_MANAGE_CAPABILITY,
  PRIVACY_DELETE_CAPABILITY,
  PRIVACY_EXPORT_CAPABILITY,
  RETENTION_READ_CAPABILITY,
  ROLE_CAPABILITIES,
  SESSION_MANAGE_CAPABILITY,
  TRUSTED_ROLES,
  type TrustedRole,
} from './capability.ts';
import { CONVERSATION_REF_PATTERN, type TenantContext, type VerifiedIdentity } from './tenant.ts';
import { registerSessionSource, resolveTenantContext, type SessionSource } from './session.ts';
import {
  LOCAL_IDENTITY_ID_PATTERN,
  LocalIdentityRegistry,
} from './identity.ts';
import { CONVERSATION_LIST_CAPABILITY, CONVERSATION_READ_CAPABILITY, CONVERSATION_AUDIT_CAPABILITY } from './conversation-query.ts';
import {
  CONVERSATION_ASSIGN_CAPABILITY,
  CONVERSATION_STATE_READ_CAPABILITY,
  CONVERSATION_STATE_UPDATE_CAPABILITY,
} from './conversation-state.ts';
import { CONVERSATION_QUEUE_CAPABILITY } from './agent-queue.ts';
import { CONVERSATION_METRICS_CAPABILITY } from './service-metrics.ts';
import type { ReadAuditLog } from './read-audit.ts';

/**
 * ⭐⭐⭐ **عمليات التفويض المحلية** — ⭐ **مترجمة إلى صلاحيات النواة نفسها**.
 * ⭐ ⛔ **لا اسم صلاحية جديد هنا** ⇒ ⇒(لا محرك موازٍ).
 */
export const LOCAL_AUTHORIZATION_OPERATIONS: Readonly<Record<string, string>> = Object.freeze({
  'conversation.list': CONVERSATION_LIST_CAPABILITY,
  'conversation.read': CONVERSATION_READ_CAPABILITY,
  'conversation.audit': CONVERSATION_AUDIT_CAPABILITY,
  'conversation.state.read': CONVERSATION_STATE_READ_CAPABILITY,
  'conversation.state.update': CONVERSATION_STATE_UPDATE_CAPABILITY,
  'conversation.assign': CONVERSATION_ASSIGN_CAPABILITY,
  'conversation.changes': CONVERSATION_STATE_READ_CAPABILITY,
  'conversation.queue.read': CONVERSATION_QUEUE_CAPABILITY,
  'conversation.metrics.read': CONVERSATION_METRICS_CAPABILITY,
  'conversation.create': CONVERSATION_CREATE_CAPABILITY,
  'conversation.write': CONVERSATION_WRITE_CAPABILITY,
  'customer.create': CUSTOMER_MANAGE_CAPABILITY,
  'privacy.export': PRIVACY_EXPORT_CAPABILITY,
  'privacy.delete': PRIVACY_DELETE_CAPABILITY,
  'retention.read': RETENTION_READ_CAPABILITY,
  'session.revoke': SESSION_MANAGE_CAPABILITY,
});

/** ⭐⭐ اسم عملية التفويض المعلنة. */
export type LocalAuthorizationOperation = keyof typeof LOCAL_AUTHORIZATION_OPERATIONS;

/** ⭐⭐⭐ طلب التفويض — ⭐ **مرجع فقط** (بلا دور ولا مستأجر من العميل). */
export interface LocalAuthorizationRequest {
  /** ⭐ معرّف الهوية — ⭐ **مرجع في السجلّ المحلي**. */
  readonly identity_id: string;
  /** ⭐ المحادثة المخصوصة — ⭐ (تُفحص داخل نطاق المستأجر عند تنفيذ العملية). */
  readonly conversation_ref: string;
  /** ⭐ العملية المطلوبة. */
  readonly operation: LocalAuthorizationOperation;
  /** ⭐ مستأجر معلن من العميل (اختياري) ⇒ ⭐ لازم يطابق مستأجر الهوية. */
  readonly declared_tenant_id?: string;
  /**
   * ⭐⭐ حقول إضافية واردة من العميل ⇒ ⭐ **تُتجاهل بالكامل**.
   * ⭐ موجودة في العقد عمداً ⇒ ⭐ ليثبت الاختبار أنّ محاولة رفع الدور
   *   أو تبديل المستأجر عبر هذه الحقول **لا أثر لها**.
   */
  readonly extra?: Readonly<Record<string, unknown>>;
}

/** ⭐⭐⭐ نتيجة تفويض — ⭐ **مفصولة عن مصدر الهوية** (إجابة M34 · ①/②). */
export type LocalAuthorizationDecision =
  | {
      readonly allowed: true;
      readonly context: TenantContext;
      readonly capability: string;
      readonly role: TrustedRole;
      readonly tenant_id: string;
    }
  | {
      readonly allowed: false;
      readonly code: string;
      readonly reason: string;
    };

/** ⭐⭐⭐ اعتماديات طبقة التفويض. */
export interface LocalAuthorizationDependencies {
  /** ⭐ سجلّ الهوية المحلي (مصدر الحقيقة). */
  readonly registry: LocalIdentityRegistry;
  /** ⭐ مصادر الهوية (واحد لكل دور). */
  readonly sources: LocalIdentitySources;
  /** ⭐ سجلّ أحداث القراءة (اختياري) ⇒ توثيق قرارات التفويض. */
  readonly readAudit?: ReadAuditLog;
  /** ⭐ ساعة القرار (اختياري) ⇒ الافتراضي = ساعة السجلّ. */
  readonly now?: () => string;
}

/** ⭐⭐ مصادر الهوية المحلية — ⭐ واحد لكل دور موثّق. */
export interface LocalIdentitySources {
  readonly byRole: Readonly<Record<TrustedRole, SessionSource>>;
}

export class LocalAuthorizationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'LocalAuthorizationError';
    this.code = code;
  }
}

/**
 * ⭐⭐⭐ **بناء مصدر هوية محلية لدور واحد** — ⭐ **مصدر جلسات حقيقي** (نفس
 *   عقد `SessionSource`) ⇒ ⇒**لا مسار موازٍ لتفويض النواة**.
 * ⭐ ⭐ **يقرأ من السجلّ فقط** ⇒ ⇒**لا دور ولا مستأجر ولا صلاحية من الحمولة**.
 */
function buildLocalIdentitySource(
  registry: LocalIdentityRegistry,
  role: TrustedRole,
): SessionSource {
  return {
    id: `test-local-identity-${registry.instanceId}-${role}`,
    scope: 'test',
    description:
      `مصدر هوية محلية (Slice 08 · محاكاة محلية · بلا تسجيل دخول) — الدور ${role}`,
    verify(input: unknown): VerifiedIdentity | null {
      if (!input || typeof input !== 'object') return null;
      const raw = input as { identity_id?: unknown; conversation_ref?: unknown };
      if (typeof raw.identity_id !== 'string' || !LOCAL_IDENTITY_ID_PATTERN.test(raw.identity_id)) {
        return null;
      }
      if (
        typeof raw.conversation_ref !== 'string' ||
        !CONVERSATION_REF_PATTERN.test(raw.conversation_ref)
      ) {
        return null;
      }
      const identity = registry.find(raw.identity_id);
      if (!identity) return null;
      // ⭐⭐⇦⇦ **الدور من السجلّ** ⇒ ⇒مصدر دور أعلى لا يقبل هوية أدنى.
      if (identity.role !== role) return null;
      if (identity.status !== 'active') return null;
      if (registry.isExpired(identity.identity_id)) return null;
      // ⭐⭐⭐ **هوية جديدة بالكامل** ⇒ ⭐ **لا تمرير للحمولة إطلاقاً.
      return {
        session_id: `sess_local_${identity.identity_id}`,
        tenant_id: identity.tenant_id,
        actor_id: identity.actor_id,
        conversation_ref: raw.conversation_ref,
        authenticated: true,
      };
    },
  };
}

/**
 * ⭐⭐⭐ **إنشاء مصادر الهوية المحلية** — ⭐ **تسجيل صريح** (لا تسجيل عند
 *   تحميل الوحدة) ⇒ ⇒ **لا مصدر افتراضي** **والمسار الإنتاجي يبقى
 *   بلا مصادر** (`activeSessionSources()` فارغة).
 */
export function createLocalIdentitySources(
  registry: LocalIdentityRegistry,
): LocalIdentitySources {
  const byRole = {} as Record<TrustedRole, SessionSource>;
  for (const role of TRUSTED_ROLES) {
    const source = buildLocalIdentitySource(registry, role);
    registerSessionSource({
      source,
      grantedRole: role,
      grantCeiling: ROLE_CAPABILITIES[role],
    });
    byRole[role] = source;
  }
  return Object.freeze({ byRole: Object.freeze(byRole) });
}

function deny(code: string, reason: string): LocalAuthorizationDecision {
  return { allowed: false, code, reason };
}

/**
 * ⭐⭐⭐⭐⭐ **طبقة التفويض المحلية** — ⭐ **البوّابة الوحيدة** بين «طلب» و«سياق تنفيذ».
 * ⭐⭐ **الترتيب (Fail-closed)**:
 *   ⭐ ① **شكل الطلب** ⇒ ② **الهوية** (موجودة · غير ملغاة · غير منتهية)
 *   ⭐ ③ **المستأجر** (المعلن يطابق) ⇒ ④ **الدور** (من السجلّ مصدر مطابق)
 *   ⭐ ⇒ ⑤ **بناء السياق** (المصدر يبني هوية جديدة) ⇒ ⑥ **صلاحية العملية**
 * ⭐ ⇒ **أي خطوة تفشل = رفض صريح (بلا سياق ⇒ بلا تنفيذ).**
 */
export function authorizeLocalRequest(
  request: LocalAuthorizationRequest,
  deps: LocalAuthorizationDependencies,
): LocalAuthorizationDecision {
  const now = deps.now ? deps.now() : deps.registry.currentTime();

  // ⭐ ① شكل الطلب — ⭐ ⛔ الرفض الافتراضي عند غياب أي حقل.
  if (!request || typeof request !== 'object') {
    return deny('request_invalid', 'طلب التفويض مفقود أو غير صالح');
  }
  if (typeof request.identity_id !== 'string' || !LOCAL_IDENTITY_ID_PATTERN.test(request.identity_id)) {
    return deny('identity_id_invalid', 'معرّف الهوية غير صالح');
  }
  if (
    typeof request.conversation_ref !== 'string' ||
    !CONVERSATION_REF_PATTERN.test(request.conversation_ref)
  ) {
    return deny('conversation_invalid', 'معرّف المحادثة غير صالح');
  }
  const capability = LOCAL_AUTHORIZATION_OPERATIONS[request.operation];
  if (!capability) {
    return deny('operation_unknown', 'العملية المطلوبة خارج المجموعة المعلنة');
  }

  // ⭐ ② الهوية — ⭐ من السجلّ وحده.
  const identity = deps.registry.find(request.identity_id);
  if (!identity) {
    return deny('identity_unknown', 'الهوية غير مسجَّلة');
  }
  if (identity.status !== 'active') {
    return deny('identity_revoked', 'الهوية ملغاة');
  }
  if (deps.registry.isExpired(identity.identity_id, now)) {
    return deny('identity_expired', 'صلاحية الهوية منتهية');
  }

  // ⭐ ③ المستأجر — ⭐ المعلن من العميل لا يُقدَّم على مستأجر الهوية.
  if (
    request.declared_tenant_id !== undefined &&
    request.declared_tenant_id !== identity.tenant_id
  ) {
    return deny('tenant_mismatch', 'المستأجر المعلن لا يطابق مستأجر الهوية');
  }

  // ⭐ ④ الدور — ⭐ من السجلّ ⇒ ⇒مصدر مطابق للدور (لا دور أعلى).
  const source = deps.sources.byRole[identity.role];
  if (!source) {
    return deny('identity_role_unsupported', 'لا مصدر مسجَّل لهذا الدور');
  }

  // ⭐ ⑤ بناء السياق — ⭐ الحقول الواردة من العميل تُمرَّر **لتجاهلها** عمداً.
  let context: TenantContext;
  try {
    context = resolveTenantContext(
      {
        identity_id: identity.identity_id,
        conversation_ref: request.conversation_ref,
        ...(request.extra ?? {}),
      } as never,
      { source, now: () => now },
    );
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code: unknown }).code)
        : 'identity_rejected';
    return deny('identity_rejected', `رفض مصدر الهوية: ${code}`);
  }

  // ⭐ ⑥ قرار السماح — ⭐ **جدول النواة** (لا قاعدة موازية).
  try {
    assertCapability(context, capability);
  } catch {
    deps.readAudit?.record({
      tenant_id: context.tenantId,
      actor_id: context.actorId,
      operation: request.operation as never,
      capability,
      result: 'denied',
      target: request.conversation_ref,
    });
    return deny('capability_missing', `الصلاحية غير متاحة للدور: ${capability}`);
  }

  deps.readAudit?.record({
    tenant_id: context.tenantId,
    actor_id: context.actorId,
    operation: request.operation as never,
    capability,
    result: 'allowed',
    target: request.conversation_ref,
  });

  return {
    allowed: true,
    context,
    capability,
    role: context.role,
    tenant_id: context.tenantId,
  };
}

/**
 * ⭐⭐⭐ **بوّابة تفويض فاشلة-مغلقة** — ⭐ **ترمي عند الرفض** ⇒ ⇒
 *   لا تنفيذ بلا سياق ⇒ ⇒(الافتراضي = المنع).
 */
export function requireLocalAuthorization(
  request: LocalAuthorizationRequest,
  deps: LocalAuthorizationDependencies,
): TenantContext {
  const decision = authorizeLocalRequest(request, deps);
  if (!decision.allowed) {
    throw new LocalAuthorizationError(decision.code, decision.reason);
  }
  return decision.context;
}

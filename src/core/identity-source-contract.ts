// ============================================================
// WASL AI — S09-0 · عقد مصدر الهوية المحلي (غير مفعّل)
// ------------------------------------------------------------
// ⭐⭐⭐ **هذا ليس نظام مصادقة** ⇒ ⭐ **عقد** فقط: ⭐ يشرح ما يجب أن
//   يثبته مصدر هوية موثوق مستقبلاً، ⭐ ويرفض ما لا يثبته.
// ⛔ **غير مفعّل عمداً** ⇒ ⭐ لا مصدر إنتاجي · ⛔ لا تسجيل دخول
//   · ⛔ لا `OAuth` · ⛔ لا `JWT` · ⛔ لا خادم · ⛔ لا قاعدة بيانات.
// ⭐ **العلاقة بالنواة القائمة**: ⭐ يستعمل `TRUSTED_ROLES` وأنماط
//   المعرّفات و`isIdentityAdminAuthority` ⇒ ⭐⇒ **بلا محرك صلاحيات
//   موازٍ** ⇒ ⭐⇒⇒ **الصلاحية تبقى قرار `assertCapability` وحدها.**
// ⭐⭐ **الفصل عن طبقة التفويض (M34 · مبقى)**: ⭐ هذا العقد يقرّر
//   «هل هذا إثبات هوية موثوق؟» ⇒ ⭐⇒ **لا يقرّر «يحق له؟»**.
// ------------------------------------------------------------
// ⭐⭐⭐ **تحديث «حزمة التسريع ٠١» (٦ نوفمبر ٢٠٢٦ · D-065) — M54 + M55**:
// ⭐ **M54 (أصالة جهة الإصدار)**: ⭐ كان العقد يثق بمطابقة **الشكل**
//   ⇒ ⭐⇒⇒ فأي كائن مبني يدوياً كان يمرّ ⇒ ⭐⇒⇒⇒ **فُصل التحقّق
//   البنيوي عن الثقة في جهة الإصدار** ⇒ ⭐⇒⇒ **والقبول صار مشروطاً
//   بإثبات صادر من مصدر محلي حقيقي (سجلّ داخلي غير قابل للادعاء)
//   + إعادة تحقّق من السجلّ عند كل تقييم.**
// ⭐ **M55 (دلالة العقد)**: ⭐ **الفرق بين «تعريف العقد» و«تقييمه
//   محلياً» و«تفعيله تشغيلياً» صار معلناً** ⇒ ⭐⇒⇒ **والأكواد
//   المرفوضة كلها داخل المجموعة المغلقة** ⇒ ⭐⇒⇒⇒ **ونجاح التقييم
//   المحلي ⛔ ليس جلسة مصادقة**.
// ⛔ **لا تغيير مدمِر**: ⭐ أسماء الدوال المصدَّرة لم تتغيّر، ⭐ ولا
//   الأكواد القديمة حُذفت، ⭐ ولا حقول الادّعاء حُذفت ⇒ ⇒⇒ **توافق
//   مع كل العقود السابقة** (التفصيل في `docs/ACCELERATION-PACK-01-REPORT.md`).
// ============================================================

import { ACTOR_ID_PATTERN, TENANT_ID_PATTERN } from './tenant.ts';
import { TRUSTED_ROLES, isTrustedRole, type TrustedRole } from './capability.ts';
import {
  LOCAL_IDENTITY_ID_PATTERN,
  isIdentityAdminAuthority,

  type LocalIdentityRegistry,
} from './identity.ts';

/**
 * ⭐⭐⭐ **أنواع مصدر الهوية** — ⭐ المجموعة المغلقة.
 * ⭐ `local_test` = مصدر اختبار محلي (نشط اليوم · داخل النطاق `test`).
 * ⭐ `external_attested` = مصدر خارجي مستقبلي (معرَّف · ⛔ **غير مفعّل**).
 */
export const IDENTITY_SOURCE_KINDS = ['local_test', 'external_attested'] as const;

export type IdentitySourceKind = (typeof IDENTITY_SOURCE_KINDS)[number];

/** ⭐⭐ أنواع الإثبات — ⭐ **كل نوع يحمل ما يثبته فعلاً**. */
export type IdentitySourceProof =
  | {
      readonly kind: 'local_test';
      /** ⭐ معرّف المصدر المحلي — ⭐ داخل نطاق الاختبار فقط. */
      readonly source_id: string;
    }
  | {
      readonly kind: 'external_attested';
      /** ⭐ معرّف المصدر الخارجي (مستقبلي). */
      readonly source_id: string;
      /** ⭐ مرجع الإثبات الخارجي (مستقبلي · ⛔ غير مفعّل اليوم). */
      readonly attestation_ref: string;
    };

/** ⭐⭐⭐ **حالة الهوية الموثّقة** — ⭐ مغلقة. */
export const IDENTITY_ATTESTATION_STATUSES = ['active', 'revoked', 'expired'] as const;

export type IdentityAttestationStatus = (typeof IDENTITY_ATTESTATION_STATUSES)[number];

/**
 * ⭐⭐⭐ **إثبات هوية** — ⭐ ما يقدّمه المصدر الموثوق.
 * ⭐⭐ **قاعدة الحاكمة**: ⭐ `role` و`tenant_id` هنا **يثبتُهما المصدر**
 *   لا العميل ⇒ ⭐⇒⇒ **وأي ادّعاء موازٍ من العميل = تعارض = رفض.**
 */
export interface IdentityAttestation {
  readonly identity_id: string;
  readonly tenant_id: string;
  readonly actor_id: string;
  readonly role: TrustedRole;
  readonly status: IdentityAttestationStatus;
  readonly proof: IdentitySourceProof;
  /** ⭐⭐ ادّعاء دور من العميل — ⭐ **ليس مصدراً للحقيقة** ⇒ يُرفض. */
  readonly claimed_role?: unknown;
  /** ⭐⭐ ادّعاء مستأجر من العميل — ⭐ **ليس مصدراً للحقيقة** ⇒ يُرفض. */
  readonly claimed_tenant_id?: unknown;
  /** ⭐⭐⭐ طلب صلاحية إدارية — ⭐ **المصدر لا يمنحها بنفسه**. */
  readonly requests_admin?: boolean;
  /** ⭐⭐⭐ سلطة الإدارة — ⭐ **يجب أن تكون نَسَباً مثبتاً من النواة**. */
  readonly admin_authority?: unknown;
}

/**
 * ⭐⭐⭐ **ادّعاء الهوية الموثّقة** — ⭐ ناتج العقد.
 * ⛔ **بلا حقل صلاحيات** ⇒ ⭐⇒⇒ **لا يمكن للعقد أن يمنح صلاحية**
 *   ⇒ ⭐⇒⇒⇒ **الصلاحية = قرار `assertCapability` وحده.**
 */
export interface TrustedIdentityClaim {
  readonly identity_id: string;
  readonly tenant_id: string;
  readonly actor_id: string;
  readonly role: TrustedRole;
  readonly status: 'active';
  readonly source_kind: IdentitySourceKind;
  readonly source_id: string;
  /**
   * ⭐⭐⭐ **دليل جهة الإصدار (M54)** — ⭐ **مُثبَّت من العقد نفسه**:
   * ⭐ `issued_local_test` = صادر من مصدر الهوية المحلي (سجلّ داخلي).
   * ⛔ قيمة أخرى = لا معنى ⇒ ⭐⇒⇒ **فالحقل مُثبَّت لا مُدَّخل.**
   */
  readonly issuer_trust: 'issued_local_test';
  /**
   * ⭐⭐⭐ **دلالة التقييم (M55)** — ⭐ **حقول ثابتة تُقرأ من العقد**:
   * ⭐ `contract_state` = حالة العقد · ⭐ `evaluation_scope` = نطاق
   * التقييم · ⭐ `session_established` = ⛔ **دائماً `false`** ⇒ ⭐⇒⇒
   * **نجاح التقييم المحلي ⛔ ليس جلسة مصادقة ولا تسجيل دخول.**
   */
  readonly contract_state: IdentityContractState;
  readonly evaluation_scope: 'test';
  readonly session_established: false;
}

/** ⭐⭐⭐ **نتيجة تقييم العقد** — ⭐ **فاشلة-مغلقة**. */
export type IdentityContractDecision =
  | { readonly trusted: true; readonly claim: TrustedIdentityClaim }
  | { readonly trusted: false; readonly code: string; readonly reason: string };

/**
 * ⭐⭐⭐ **نتيجة التحقّق البنيوي وحده (M54)** — ⭐ **بلا ثقة في جهة
 *   الإصدار** ⇒ ⭐⇒⇒ **فالمطابقة الشكلية ⛔ ليست إثباتاً موثوقاً.**
 */
export interface IdentityStructureDecision {
  /** ⭐ هل الشكل سليم؟ (بلا أي معنى ثقة). */
  readonly structurally_valid: boolean;
  /** ⭐ رمز الرفض البنيوي (إن وُجد) — ⭐ `null` = سليم. */
  readonly code: string | null;
  /** ⭐ سبب الرفض (إن وُجد). */
  readonly reason: string | null;
}

/**
 * ⭐⭐⭐⭐⭐ **حالات العقد (M55)** — ⭐ مغلقة — ⭐ **ترتيبها هو ترتيب الرحلة**:
 * ⭐ ① `defined` = العقد **مُعرَّف فقط** (لا تقييم ولا تفعيل).
 * ⭐ ② `evaluated_locally` = undergoing تقييم **محلي** في النطاق `test`.
 * ⭐ ③ `activated` = **تفعيل تشغيلي** ⇒ ⭐⛔ **يحتاج تصريح المالك.**
 */
export const IDENTITY_CONTRACT_STATES = ['defined', 'evaluated_locally', 'activated'] as const;

export type IdentityContractState = (typeof IDENTITY_CONTRACT_STATES)[number];

/**
 * ⭐⭐⭐ **أكواد رفض العقد** — ⭐ مغلقة (لا قيمة خارجها).
 * ⭐⭐ **تحديث D-065 (M55)**: ⭐ **الأكواد التسعة القديمة ما زالت كلّها
 *   موجودة بالاسم نفسه** ⇒ ⇒⇒ **توافق مع ما قبل D-065** ⇒ ⭐⇒⇒⇒
 *   **وأُضيفت الأكواد التي كان العقد يُرجعها بلا تصريح مسبق** ⇒
 *   ⭐⇒⇒⇒ **فكل رمز مرفوض صار معلَناً (سلوك متسق + أسماء متسقة).**
 */
export const IDENTITY_CONTRACT_CODES = Object.freeze([
  'identity_source_missing',
  'identity_source_untrusted',
  'identity_source_inactive',
  'identity_scope_forbidden',
  'identity_attestation_invalid',
  'identity_role_conflict',
  'identity_tenant_conflict',
  'identity_status_invalid',
  'admin_authority_invalid',
  'admin_not_owner',
  'role_invalid',
  'identity_revoked',
  'identity_expired',
  'admin_revoked',
  'identity_issuer_unverified',
  'identity_registry_missing',
  'identity_unregistered',
  'identity_registry_mismatch',
]);

export type IdentityContractCode = (typeof IDENTITY_CONTRACT_CODES)[number];

export class IdentityContractError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'IdentityContractError';
    this.code = code;
  }
}

/**
 * ⭐⭐⭐⭐⭐ **مواصفات العقد** — ⭐ **الجزء الموثَّق من «العقد»**.
 * ⭐ `active: false` ⛔ ⇒ ⭐ **وجود العقد ليس تصريحاً بتفعيل أي مصدر.**
 * ⭐⭐ **D-065 (M55)**: ⭐ أُضيفت حقول الدلالة (الحالة · التقييم · شرط التفعيل).
 */
export const IDENTITY_SOURCE_CONTRACT = Object.freeze({
  version: 's09-0.2',
  /** ⭐⭐⛔ **غير مفعّل** — تفعيله يحتاج تصريح المالك منفصل. */
  active: false,
  /** ⭐⭐⭐ **حالة العقد (M55)** — ⭐ `defined` = مُعرَّف فقط. */
  state: 'defined' as IdentityContractState,
  /** ⭐⭐ الأنواع **المعروفة** (للمستقبل). */
  known_proof_kinds: Object.freeze([...IDENTITY_SOURCE_KINDS] as const),
  /** ⭐⭐ الأنواع **النشطة اليوم** — ⭐⇦ `local_test` فقط. */
  active_proof_kinds: Object.freeze(['local_test'] as const),
  /** ⭐⭐ النطاقات المسموحة اليوم — ⭐⇦ `test` فقط (لا إنتاجي). */
  supported_scopes: Object.freeze(['test'] as const),
  /** ⭐⭐ الحقول الإلزامية في الإثبات. */
  required_fields: Object.freeze([
    'identity_id',
    'tenant_id',
    'actor_id',
    'role',
    'status',
    'proof',
  ] as const),
  /** ⭐⭐⭐ **دلالة التقييم (M55)** — ⭐ معلنة صراحةً. */
  evaluation: Object.freeze({
    scope: 'test' as const,
    session_established: false as const,
    requires_issued_attestation: true as const,
    issuer_trust_required: true as const,
  }),
  /** ⭐⭐⭐ **شرط التفعيل التشغيلي** — ⭐ قرار المالك فقط. */
  activation_requires: 'owner_decision' as const,
  /** ⭐⭐⭐ ما يرفضه العقد بنيوياً. */
  forbids: Object.freeze([
    'client_supplied_role',
    'client_supplied_tenant',
    'production_scope',
    'self_asserted_admin',
    'unknown_proof_kind',
    'inactive_proof_kind',
    'forged_local_test_attestation',
    'unverified_issuer',
  ] as const),
});

/** ⭐⭐⭐ **اعتماديات العقد** — ⭐ اختيارية (بلا سجلّ ⇒ ⛔ لا سلطة إدارية). */
export interface IdentityContractOptions {
  /** ⭐⭐ النطاق — ⭐ **الافتراضي `test`** ⇒ ⭐⇦ لا مسار إنتاجي. */
  readonly scope?: 'test' | 'production';
  /** ⭐⭐ سجلّ الهوية — ⭐ **مطلوب لتحقّق السلطة الإدارية**. */
  readonly registry?: LocalIdentityRegistry;
  /** ⭐⭐ الساعة — ⭐ لقراءة حالة انتهاء الهوية. */
  readonly now?: () => string;
}

/** ⭐⭐⭐ **اعتماديات الإصدار المحلي (M54)**. */
export interface LocalAttestationIssueOptions {
  /** ⭐⭐⭐ السجلّ — ⭐ **مصدر الدور والمستأجر الوحيد**. */
  readonly registry: LocalIdentityRegistry;
  /** ⭐⭐ معرّف المصدر المحلي — ⭐ الافتراضي مشتقّ من معرّف السجلّ. */
  readonly source_id?: string;
}

function deny(code: string, reason: string): IdentityContractDecision {
  return { trusted: false, code, reason };
}

/**
 * ⭐⭐⭐⭐⭐ **سجلّ الإصدار الداخلي (M54)** — ⭐ **خاص بالوحدة ولا يُصدَّر**.
 * ⭐⭐⭐ **لماذا `WeakMap`**: ⭐ ⭐⇒ **لأنه يربط كل إثبات بما صدر منه بالضبط**
 *   ⇒ ⇒⇒ **فكائن مبنيّ يدوياً (كائن آخر) لا يُطابق ⇒ مرفوض**.
 * ⭐⭐⭐ **ولماذا لقطة (snapshot)**: ⭐ ⭐⇒ **لأن تعديل الحقول بعد الإصدار
 *   يجب أن يُكتشف** ⇒ ⇒⇒ **فالمرجع هو القيمة المثبتة وقت الإصدار** ⇒ ⇒⇒⇒
 *   **والمقارنة تتم عند كل تقييم ⇒ فالتعديل = رفض.**
 */
interface IssuedAttestationSnapshot {
  readonly identity_id: string;
  readonly tenant_id: string;
  readonly actor_id: string;
  readonly role: TrustedRole;
  readonly status: IdentityAttestationStatus;
  readonly source_id: string;
  readonly registry: LocalIdentityRegistry;
}

const ISSUED_ATTESTATIONS = new WeakMap<object, IssuedAttestationSnapshot>();

/**
 * ⭐⭐⭐⭐⭐ **إصدار إثبات هوية محلي (M54)** — ⭐ **غير مُصدَّر من `index.ts`**.
 * ⭐⭐⭐ **مبدأ الاشتقاق**: ⭐ الدور والمستأجر والمنفّذ **تُشتقّ من السجلّ**
 *   ⇒ ⭐⇒⇒ **ولا تُمرَّر من المستدعي إطلاقاً** ⇒ ⭐⇒⇒⇒ **فلا مجال لادّعاء
 *   دور أعلى ولا لتبديل مستأجر.**
 * ⛔ يُستدعى من طبقة التطبيق المحلية (المعاينة · شجرة الاختبار) فقط.
 */
export function issueLocalTestAttestation(
  identityId: string,
  options: LocalAttestationIssueOptions,
): IdentityAttestation {
  const registry = options?.registry;
  if (!registry) {
    throw new IdentityContractError('identity_registry_missing', 'لا سجلّ هوية ⇒ لا إصدار');
  }
  const identity = registry.find(identityId);
  if (!identity) {
    throw new IdentityContractError(
      'identity_unregistered',
      'الهوية غير مسجَّلة في السجلّ ⇒ لا إصدار',
    );
  }
  if (identity.status !== 'active') {
    throw new IdentityContractError('identity_revoked', 'الهوية ملغاة ⇒ لا إصدار');
  }
  if (registry.isExpired(identity.identity_id, registry.currentTime())) {
    throw new IdentityContractError('identity_expired', 'صلاحية الهوية منتهية ⇒ لا إصدار');
  }
  const sourceId = options.source_id ?? `local-test:${registry.instanceId}`;
  const attestation: IdentityAttestation = {
    identity_id: identity.identity_id,
    tenant_id: identity.tenant_id,
    actor_id: identity.actor_id,
    role: identity.role,
    status: 'active',
    proof: { kind: 'local_test', source_id: sourceId },
  };
  ISSUED_ATTESTATIONS.set(attestation, {
    identity_id: identity.identity_id,
    tenant_id: identity.tenant_id,
    actor_id: identity.actor_id,
    role: identity.role,
    status: 'active',
    source_id: sourceId,
    registry,
  });
  return attestation;
}

/**
 * ⭐⭐⭐⭐⭐ **التحقّق البنيوي وحده (M54)** — ⭐ **فصل عن الثقة**.
 * ⭐⭐⭐ **ماذا يفحص**: ⭐ أنواع الحقول ونمط المعرّفات وقيمة الدور والحالة.
 * ⭐⭐⭐ **ماذا لا يفحص**: ⭐ ⛔ **لا جهة الإصدار** · ⛔ ولا السجلّ · ⛔ ولا النطاق.
 * ⭐⇒⇒ **فمطابقة الشكل وحدها ⛔ ليست إثباتاً موثوقاً.**
 */
export function evaluateIdentityAttestationStructure(
  attestation: unknown,
): IdentityStructureDecision {
  if (!attestation || typeof attestation !== 'object') {
    return {
      structurally_valid: false,
      code: 'identity_source_missing',
      reason: 'لا يوجد إثبات هوية',
    };
  }
  const raw = attestation as IdentityAttestation;
  if (
    typeof raw.identity_id !== 'string' ||
    !LOCAL_IDENTITY_ID_PATTERN.test(raw.identity_id)
  ) {
    return {
      structurally_valid: false,
      code: 'identity_attestation_invalid',
      reason: 'معرّف الهوية في الإثبات غير صالح',
    };
  }
  if (typeof raw.tenant_id !== 'string' || !TENANT_ID_PATTERN.test(raw.tenant_id)) {
    return {
      structurally_valid: false,
      code: 'identity_attestation_invalid',
      reason: 'معرّف المستأجر في الإثبات غير صالح',
    };
  }
  if (typeof raw.actor_id !== 'string' || !ACTOR_ID_PATTERN.test(raw.actor_id)) {
    return {
      structurally_valid: false,
      code: 'identity_attestation_invalid',
      reason: 'معرّف المنفّذ في الإثبات غير صالح',
    };
  }
  if (!isTrustedRole(raw.role)) {
    return {
      structurally_valid: false,
      code: 'role_invalid',
      reason: 'الدور خارج المجموعة المغلقة',
    };
  }
  if (
    raw.status !== 'active' &&
    raw.status !== 'revoked' &&
    raw.status !== 'expired'
  ) {
    return {
      structurally_valid: false,
      code: 'identity_attestation_invalid',
      reason: 'حالة الهوية خارج المجموعة المغلقة',
    };
  }
  return { structurally_valid: true, code: null, reason: null };
}

/**
 * ⭐⭐⭐⭐⭐ **تقييم إثبات هوية** — ⭐ **البوّابة الوحيدة** في العقد.
 * ⭐⭐ **الترتيب (فاشلة-مغلقة)**: ⭐ ① وجود الإثبات ⇒ ② النطاق ⇒
 *   ③ نوع المصدر ⇒ ④ الشكل البنيوي ⇒ ⑤ حالة الهوية ⇒ ⑥ المستأجر
 *   ⇒ ⑦ الدور المُدَّعى ⇒ ⑧⭐ السياق الإداري ⇒ ⑨⭐⭐ **جهة الإصدار
 *   (M54)** ⇒ ⑩⭐⭐ **إعادة التحقّق من السجلّ (M54)** ⇒ ⑪ النتيجة.
 * ⭐⇒⇒ **أي خطوة تفشل = رفض صريح (بلا ادّعاء موثوق ⇒ بلا سياق).**
 */
export function evaluateIdentityAttestation(
  attestation: unknown,
  options: IdentityContractOptions = {},
): IdentityContractDecision {
  const scope = options.scope ?? 'test';

  // ⭐ ① وجود الإثبات — ⭐ الرفض الافتراضي عند الغياب.
  if (!attestation || typeof attestation !== 'object') {
    return deny('identity_source_missing', 'لا يوجد إثبات هوية ⇒ لا ادّعاء موثوق');
  }
  const raw = attestation as IdentityAttestation;

  // ⭐ ② النطاق — ⭐ ⛔ في هذه الشريحة: النطاق المسموح `test` فقط.
  if (scope !== 'test') {
    return deny('identity_scope_forbidden', `النطاق «${scope}» غير مفعّل في عقد S09-0`);
  }

  // ⭐ ③ نوع المصدر — ⭐ معروف ⇦ نشط · ⭐ معروف ⇦ غير مفعّل · ⭐ مجهول ⇦ مرفوض.
  if (!raw.proof || typeof raw.proof !== 'object') {
    return deny('identity_source_missing', 'الإثبات بلا نوع مصدر ⇒ لا ادّعاء موثوق');
  }
  const proofKind = (raw.proof as { kind?: unknown }).kind;
  if (proofKind === 'external_attested') {
    return deny(
      'identity_source_inactive',
      'المصدر الخارجي الموثّق غير مفعّل — تفعيله يحتاج تصريح المالك منفصل',
    );
  }
  if (proofKind !== 'local_test') {
    return deny('identity_source_untrusted', 'نوع المصدر خارج المجموعة المغلقة');
  }
  const proof = raw.proof as { kind: 'local_test'; source_id?: unknown };
  if (typeof proof.source_id !== 'string' || proof.source_id.length === 0) {
    return deny('identity_source_untrusted', 'المصدر المحلي بلا معرّف ⇒ لا ادّعاء موثوق');
  }

  // ⭐ ④ الشكل البنيوي — ⭐ (نفس أنماط النواة) ⭐⇒⇒ **بلا أي ثقة هنا.**
  const structure = evaluateIdentityAttestationStructure(raw);
  if (!structure.structurally_valid) {
    return deny(
      structure.code ?? 'identity_attestation_invalid',
      structure.reason ?? 'الإثبات غير مطابق للشكل',
    );
  }

  // ⭐ ⑤ حالة الهوية — ⭐ النشطة وحدها تُقبل.
  if (raw.status === 'revoked') {
    return deny('identity_revoked', 'الهوية ملغاة');
  }
  if (raw.status === 'expired') {
    return deny('identity_expired', 'صلاحية الهوية منتهية');
  }

  // ⭐ ⑥ المستأجر — ⭐ ادّعاء العميل لا يُقدَّم على مستأجر الإثبات.
  if (
    raw.claimed_tenant_id !== undefined &&
    raw.claimed_tenant_id !== raw.tenant_id
  ) {
    return deny('identity_tenant_conflict', 'المستأجر المُدَّعى لا يطابق مستأجر الإثبات');
  }

  // ⭐ ⑦ الدور المُدَّعى — ⭐ ⛔ رفع دور من العميل = رفض بنيوي.
  if (raw.claimed_role !== undefined && raw.claimed_role !== raw.role) {
    return deny('identity_role_conflict', 'الدور المُدَّعى لا يطابق دور الإثبات');
  }

  // ⭐ ⑧⭐ السياق الإداري — ⭐ **المصدر لا يمنح صلاحية إدارية بنفسه**.
  if (raw.requests_admin === true || raw.admin_authority !== undefined) {
    if (!isIdentityAdminAuthority(raw.admin_authority)) {
      return deny('admin_authority_invalid', 'سلطة الإدارة غير صالحة — المصدر لا يمنحها بنفسه');
    }
    const authority = raw.admin_authority as { identity_id?: unknown };
    const registry = options.registry;
    const owner = registry?.find(String(authority.identity_id ?? ''));
    if (!owner || owner.role !== 'owner') {
      return deny('admin_not_owner', 'سلطة الإدارة ليست بهوية مالك مسجَّلة');
    }
    if (owner.status !== 'active') {
      return deny('admin_revoked', 'سلطة الإدارة ملغاة');
    }
  }

  // ⭐ ⑨⭐⭐ **جهة الإصدار (M54)** — ⭐ **مطابقة الشكل ⛔ لا تكفي**.
  const snapshot = ISSUED_ATTESTATIONS.get(raw);
  if (!snapshot) {
    return deny(
      'identity_issuer_unverified',
      'الإثبات لم يصدر من المصدر المحلي ⇒ مطابقة الشكل وحدها لا تُثبت شيئاً',
    );
  }
  if (
    snapshot.identity_id !== raw.identity_id ||
    snapshot.tenant_id !== raw.tenant_id ||
    snapshot.actor_id !== raw.actor_id ||
    snapshot.role !== raw.role ||
    snapshot.status !== raw.status ||
    snapshot.source_id !== proof.source_id
  ) {
    return deny(
      'identity_registry_mismatch',
      'تعديل على إثبات مُصدَر ⇒ الرفض (القيمة المثبتة هي المرجع)',
    );
  }

  // ⭐ ⑩⭐⭐ **إعادة التحقّق من السجلّ (M54)** — ⭐ كل تقييم ⇒ فحص جديد.
  const registry = snapshot.registry;
  const current = registry.find(snapshot.identity_id);
  if (!current) {
    return deny('identity_unregistered', 'الهوية لم تعد مسجَّلة في السجلّ المُصدِر');
  }
  if (current.status !== 'active') {
    return deny('identity_revoked', 'الهوية ملغاة في السجلّ المُصدِر');
  }
  const now = options.now?.() ?? registry.currentTime();
  if (registry.isExpired(snapshot.identity_id, now)) {
    return deny('identity_expired', 'صلاحية الهوية منتهية في السجلّ المُصدِر');
  }
  if (
    current.role !== snapshot.role ||
    current.tenant_id !== snapshot.tenant_id ||
    current.actor_id !== snapshot.actor_id
  ) {
    return deny(
      'identity_registry_mismatch',
      'سجلّ الهوية لا يطابق ما صدر من الإصدار ⇒ الرفض',
    );
  }

  // ⭐ ⑪ النتيجة — ⭐ ادّعاء موثوق (بلا صلاحية: الصلاحية = قرار منفصل).
  return {
    trusted: true,
    claim: {
      identity_id: snapshot.identity_id,
      tenant_id: snapshot.tenant_id,
      actor_id: snapshot.actor_id,
      role: snapshot.role,
      status: 'active',
      source_kind: 'local_test',
      source_id: snapshot.source_id,
      issuer_trust: 'issued_local_test',
      contract_state: IDENTITY_SOURCE_CONTRACT.state,
      evaluation_scope: 'test',
      session_established: false,
    },
  };
}

/**
 * ⭐⭐⭐ **بوّابة العقد الفاشلة-مغلقة** — ⭐ ترمي عند الرفض ⇒
 *   ⭐⇒⇒ لا ادّعاء موثوق بلا سياق ⇒ ⇒⇒ (الافتراضي = المنع).
 */
export function assertIdentityAttestation(
  attestation: unknown,
  options: IdentityContractOptions = {},
): TrustedIdentityClaim {
  const decision = evaluateIdentityAttestation(attestation, options);
  if (!decision.trusted) {
    throw new IdentityContractError(decision.code, decision.reason);
  }
  return decision.claim;
}

/**
 * ⭐⭐⭐⭐⭐ **هل نوع المصدر نشط في هذه الشريحة؟** — ⭐ قراءة العقد.
 * ⭐ ⛔ `external_attested` ⇒ `false` ⇒ ⭐ **التفعيل يحتاج تصريح منفصل.**
 */
export function isActiveIdentitySourceKind(kind: unknown): kind is 'local_test' {
  return (
    typeof kind === 'string' &&
    (IDENTITY_SOURCE_CONTRACT.active_proof_kinds as readonly string[]).includes(kind)
  );
}

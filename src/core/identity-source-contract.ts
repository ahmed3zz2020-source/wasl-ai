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
}

/** ⭐⭐⭐ **نتيجة تقييم العقد** — ⭐ **فاشلة-مغلقة**. */
export type IdentityContractDecision =
  | { readonly trusted: true; readonly claim: TrustedIdentityClaim }
  | { readonly trusted: false; readonly code: string; readonly reason: string };

/** ⭐⭐⭐ **أكواد رفض العقد** — ⭐ مغلقة (لا قيمة خارجها). */
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
 */
export const IDENTITY_SOURCE_CONTRACT = Object.freeze({
  version: 's09-0.1',
  /** ⭐⭐⛔ **غير مفعّل** — تفعيله يحتاج تصريح المالك منفصل. */
  active: false,
  /** ⭐⭐ الأنواع **المعروفة** (للمستقبل) — ⭐ contrasted مع النشطة. */
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
  /** ⭐⭐⭐ ما يرفضه العقد بنيوياً. */
  forbids: Object.freeze([
    'client_supplied_role',
    'client_supplied_tenant',
    'production_scope',
    'self_asserted_admin',
    'unknown_proof_kind',
    'inactive_proof_kind',
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

function deny(code: string, reason: string): IdentityContractDecision {
  return { trusted: false, code, reason };
}

/**
 * ⭐⭐⭐⭐⭐ **تقييم إثبات هوية** — ⭐ **البوّابة الوحيدة** في العقد.
 * ⭐⭐ **الترتيب (فاشلة-مغلقة)**: ⭐ ① وجود الإثبات ⇒ ② النطاق ⇒
 *   ③ نوع المصدر ⇒ ④ شكل الحقول ⇒ ⑤ الدور ⇒ ⑥ حالة الهوية ⇒
 *   ⑦ المستأجر ⇒ ⑧ الدور المُدَّعى ⇒ ⑨⭐ السياق الإداري ⇒ ⑩ النتيجة.
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

  // ⭐ ④ شكل الحقول — ⭐ الأنماط نفسها المستعملة في النواة.
  if (
    typeof raw.identity_id !== 'string' ||
    !LOCAL_IDENTITY_ID_PATTERN.test(raw.identity_id)
  ) {
    return deny('identity_attestation_invalid', 'معرّف الهوية في الإثبات غير صالح');
  }
  if (typeof raw.tenant_id !== 'string' || !TENANT_ID_PATTERN.test(raw.tenant_id)) {
    return deny('identity_attestation_invalid', 'معرّف المستأجر في الإثبات غير صالح');
  }
  if (typeof raw.actor_id !== 'string' || !ACTOR_ID_PATTERN.test(raw.actor_id)) {
    return deny('identity_attestation_invalid', 'معرّف المنفّذ في الإثبات غير صالح');
  }

  // ⭐ ⑤ الدور — ⭐ من المجموعة المغلقة في النواة (لا قيمة خارجها).
  if (!isTrustedRole(raw.role)) {
    return deny('role_invalid', 'الدور خارج المجموعة المغلقة');
  }

  // ⭐ ⑥ حالة الهوية — ⭐ النشطة وحدها تُقبل.
  if (raw.status === 'revoked') {
    return deny('identity_revoked', 'الهوية ملغاة');
  }
  if (raw.status === 'expired') {
    return deny('identity_expired', 'صلاحية الهوية منتهية');
  }
  if (raw.status !== 'active') {
    return deny('identity_attestation_invalid', 'حالة الهوية خارج المجموعة المغلقة');
  }

  // ⭐ ⑦ المستأجر — ⭐ ادّعاء العميل لا يُقدَّم على مستأجر الإثبات.
  if (
    raw.claimed_tenant_id !== undefined &&
    raw.claimed_tenant_id !== raw.tenant_id
  ) {
    return deny('identity_tenant_conflict', 'المستأجر المُدَّعى لا يطابق مستأجر الإثبات');
  }

  // ⭐ ⑧ الدور المُدَّعى — ⭐ ⛔ رفع دور من العميل = رفض بنيوي.
  if (raw.claimed_role !== undefined && raw.claimed_role !== raw.role) {
    return deny('identity_role_conflict', 'الدور المُدَّعى لا يطابق دور الإثبات');
  }

  // ⭐ ⑨⭐ السياق الإداري — ⭐ **المصدر لا يمنح صلاحية إدارية بنفسه**.
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

  // ⭐ ⑩ النتيجة — ⭐ ادّعاء موثوق (بلا صلاحية: الصلاحية = قرار منفصل).
  return {
    trusted: true,
    claim: {
      identity_id: raw.identity_id,
      tenant_id: raw.tenant_id,
      actor_id: raw.actor_id,
      role: raw.role,
      status: 'active',
      source_kind: 'local_test',
      source_id: proof.source_id,
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

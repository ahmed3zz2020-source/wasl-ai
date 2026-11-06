// ============================================================
// WASL AI — اختبارات S09-0 (عقد مصدر الهوية المحلي + تغطية الفجوات)
// ------------------------------------------------------------
// ⭐⭐⭐ **التصريح**: ⭐ المالك (٦ نوفمبر ٢٠٢٦ · D-064) — «S09-0 — Local
//   Identity Source Contract (Inactive)» + معالجة M49–M53.
// ⭐⭐⭐ **هذا ليس نظام مصادقة** ⇒ ⭐ العقد **غير مفعّل** ⇒ ⭐ كل نتيجة
//   أدناه = نتيجة محلية على جهاز التطوير ⭐⇒ **وليست شهادة أمان إنتاجي.**
// ⭐⭐ **ما يُثبته هذا الملف** (الأسماء مرجع التغطية):
//   ⭐ S09-01 ⇒ غياب الإثبات ⇒ رفض (الافتراضي = المنع).
//   ⭐ S09-02 ⇒ نوع مصدر مجهول ⇒ رفض.
//   ⭐ S09-03 ⇒ مصدر خارجي موثّق ⇒ رفض (غير مفعّل) + العقد نفسه غير مفعّل.
//   ⭐ S09-04 ⇒ نطاق إنتاجي ⇒ رفض بنيوي.
//   ⭐ S09-05 ⇒ ادّعاء دور أعلى من العميل ⇒ رفض.
//   ⭐ S09-06 ⇒ ادّعاء مستأجر مختلف ⇒ رفض.
//   ⭐ S09-07 ⇒ دور خارج المجموعة المغلقة ⇒ رفض.
//   ⭐ S09-08 ⇒ هوية ملغاة أو منتهية ⇒ رفض.
//   ⭐ S09-09 ⇒ إثبات مشوّه ⇒ رفض.
//   ⭐ S09-10 ⇒ سياق إداري مزيف ⇒ رفض.
//   ⭐ S09-11 ⇒ طلب إداري بلا سلطة ⇒ رفض.
//   ⭐ S09-12 ⇒ سلطة إدارية من هوية ليست مالكاً ⇒ رفض.
//   ⭐ S09-13 ⇒ إثبات سليم ⇒ ادّعاء موثوق **بلا صلاحية**.
//   ⭐ S09-14 ⇒ العقد لا يُفعّل أي مصدر (بلا مصدر إنتاجي · بلا صلاحية).
//   ⭐ S09-15 ⇒ طبقة التفويض القائمة ترفض انتحال الدور وتبديل المستأجر.
//   ⭐ G-01..G-10 ⇒ تغطية رموز الرفض العشرة التي بلا تأكيد (قائمة M40).
// ⛔ بلا شبكة · ⛔ بلا بيانات حقيقية · ⛔ بلا حساب · ⛔ بلا نشر.
// ============================================================

import assert from 'node:assert/strict';
import test from 'node:test';

// ⭐⭐ استيراد الحاجز **يُركّبه** (أثر جانبي عند التحميل) ⇒ ⭐⇒⇒ لا اتصال خارجي.
import { guard } from './guard-setup.ts';
import {
  IDENTITY_CONTRACT_CODES,
  IDENTITY_CONTRACT_STATES,
  IDENTITY_SOURCE_CONTRACT,
  IdentityContractError,
  LocalAuthorizationError,
  LocalIdentityRegistry,
  ROLE_CAPABILITIES,
  activeSessionSources,
  assertIdentityAttestation,
  authorizeLocalRequest,
  createLocalIdentitySources,
  evaluateIdentityAttestation,
  evaluateIdentityAttestationStructure,
  isActiveIdentitySourceKind,
  requireLocalAuthorization,
  type IdentityAttestation,
  type LocalAuthorizationRequest,
} from '../src/core/index.ts';
// ⭐⭐ S09-0 — ⭐ **إصدار سلطة الإدارة ليس في السطح العام** ⇒ ⭐ استيراد مباشر
//    (وهو ⭐ **السبب** في أن السطح العام لا يستطيع إصدار سلطة إدارية).
import { issueIdentityAdminAuthority } from '../src/core/identity.ts';
// ⭐⭐ `registerSessionSource` **غير مُصدَّر من السطح العام** ⇒ ⭐ استيراد مباشر
//    (وهو ⭐ **السبب** في أن العميل لا يستطيع تسجيل مصدر لنفسه).
import { registerSessionSource } from '../src/core/session.ts';
// ⭐⭐⭐ **D-065 (M54)**: ⭐ `issueLocalTestAttestation` **غير مُصدَّر من السطح
//    العام** ⇒ ⭐ استيراد مباشر ⇒ ⭐⇒⇒ **وهو السبب في أن لا جهة خارجية
//    تستطيع إصدار إثبات هوية لنفسها.**
import { issueLocalTestAttestation } from '../src/core/identity-source-contract.ts';
// ⭐⭐⭐ **السطح العام كاملاً** — ⭐ يُفحص للتأكّد من خلوّه من مُصدِر الإثبات.
import * as publicSurface from '../src/core/index.ts';

const TENANT_A = 'tenant-alpha';
const TENANT_B = 'tenant-beta';
const REF_A = 'conv-alpha-1';

/** ⭐⭐ إثبات هوية محلي سليم (نطاق اختبار). */
function attestation(overrides: Partial<IdentityAttestation> = {}): IdentityAttestation {
  return {
    identity_id: 'ident-alpha-1',
    tenant_id: TENANT_A,
    actor_id: 'actor-alpha-1',
    role: 'agent',
    status: 'active',
    proof: { kind: 'local_test', source_id: 'test-local-identity-alpha' },
    ...overrides,
  };
}

/** ⭐⭐ سجلّ هوية فيه مالك (سلطة الإدارة تissued من الـowner). */
function registryWithOwner(): {
  registry: LocalIdentityRegistry;
  ownerAuthority: ReturnType<typeof issueIdentityAdminAuthority>;
} {
  const registry = new LocalIdentityRegistry();
  const owner = registry.register(
    {
      identity_id: 'ident-owner',
      tenant_id: TENANT_A,
      actor_id: 'actor-owner',
      role: 'owner',
      expires_at: null,
    },
    issueIdentityAdminAuthority({
      identity_id: 'ident-owner',
      tenant_id: TENANT_A,
      actor_id: 'actor-owner',
      role: 'owner',
      status: 'active',
      expires_at: null,
    }),
  );
  return { registry, ownerAuthority: issueIdentityAdminAuthority(owner) };
}

/**
 * ⭐⭐⭐⭐⭐ **سجلّ فيه مالك + موظّف (M54)** — ⭐ أساس إصدار إثبات حقيقي.
 * ⭐ **الدور والمستأجر يأتيان من السجلّ** ⇒ ⭐⇒⇒ **لا مدخلات من المستدعي.**
 */
function registryWithAgent(): LocalIdentityRegistry {
  const { registry, ownerAuthority } = registryWithOwner();
  registry.register(
    {
      identity_id: 'ident-agent',
      tenant_id: TENANT_A,
      actor_id: 'actor-agent',
      role: 'agent',
      expires_at: null,
    },
    ownerAuthority,
  );
  return registry;
}

/**
 * ⭐⭐⭐⭐⭐ **إثبات مُصدَر من المصدر المحلي (M54)** — ⭐ **ليس كائناً مبنيّاً يدوياً**.
 * ⭐ ⇒⇒⇒ **وهذا هو الفرق بين «شكل مطابق» و«إثبات موثوق».**
 */
function issuedAttestation(
  registry: LocalIdentityRegistry,
  identityId = 'ident-agent',
): IdentityAttestation {
  return issueLocalTestAttestation(identityId, { registry });
}

// ============================================================
// ⭐ ① — العقد: الرفض الافتراضي + حدود الثقة
// ============================================================

test('S09-01) ⭐⭐⭐⭐⭐ غياب الإثبات ⇒ رفض (الافتراضي = المنع)', () => {
  const decision = evaluateIdentityAttestation(undefined);
  assert.equal(decision.trusted, false);
  assert.equal(decision.trusted === false ? decision.code : '', 'identity_source_missing');

  const empty = evaluateIdentityAttestation({});
  assert.equal(empty.trusted === false ? empty.code : '', 'identity_source_missing');

  assert.throws(
    () => assertIdentityAttestation(null),
    (error: unknown) => {
      assert.ok(error instanceof IdentityContractError);
      assert.equal((error as { code: string }).code, 'identity_source_missing');
      return true;
    },
  );
});

test('S09-02) ⭐⭐⭐ نوع مصدر مجهول ⇒ رفض', () => {
  const decision = evaluateIdentityAttestation(
    attestation({ proof: { kind: 'made_up', source_id: 'x' } as never }),
  );
  assert.equal(decision.trusted === false ? decision.code : '', 'identity_source_untrusted');
});

test('S09-03) ⭐⭐⭐⭐⭐ مصدر خارجي موثّق ⇒ رفض (غير مفعّل) + العقد نفسه غير مفعّل', () => {
  const decision = evaluateIdentityAttestation(
    attestation({
      proof: { kind: 'external_attested', source_id: 'auth-future', attestation_ref: 'ref-1' },
    }),
  );
  assert.equal(decision.trusted === false ? decision.code : '', 'identity_source_inactive');

  // ⭐⭐⭐ **العقد نفسه معلَن غير مفعّل** ⇒ ⭐ وجوده ليس تصريحاً.
  assert.equal(IDENTITY_SOURCE_CONTRACT.active, false);
  assert.equal(isActiveIdentitySourceKind('external_attested'), false);
  assert.equal(isActiveIdentitySourceKind('local_test'), true);
  assert.deepEqual([...IDENTITY_SOURCE_CONTRACT.active_proof_kinds], ['local_test']);
  assert.deepEqual([...IDENTITY_SOURCE_CONTRACT.supported_scopes], ['test']);
});

test('S09-04) ⭐⭐⭐⭐⭐ نطاق إنتاجي ⇒ رفض بنيوي (لا مصدر إنتاجي في هذه الشريحة)', () => {
  const decision = evaluateIdentityAttestation(attestation(), { scope: 'production' });
  assert.equal(decision.trusted === false ? decision.code : '', 'identity_scope_forbidden');
});

test('S09-05) ⭐⭐⭐⭐⭐ ادّعاء دور أعلى من العميل ⇒ رفض (لا مصدر للحقيقة)', () => {
  const decision = evaluateIdentityAttestation(attestation({ claimed_role: 'owner' }));
  assert.equal(decision.trusted === false ? decision.code : '', 'identity_role_conflict');

  // ⭐ ادّعاء مطابق للدور المروَّض ⇒ لا تعارض (لا تعارض ⇒ لا رفض).
  // ⭐⭐⭐ **D-065 (M54)**: ⭐ لازم يكون الإثبات **مُصدَراً من المصدر المحلي**
  //   ⇒ ⭐⇒⇒ **فمطابقة الشكل وحدها ⛔ لا تكفي** ⇒ ⭐⇒⇒⇒ **والإثبات المُصدَر
  //   مع ادّعاء متطابق = قبول.**
  const issued = issuedAttestation(registryWithAgent());
  (issued as { claimed_role?: unknown }).claimed_role = 'agent';
  const aligned = evaluateIdentityAttestation(issued);
  assert.equal(aligned.trusted, true);
});

test('S09-06) ⭐⭐⭐⭐⭐ ادّعاء مستأجر مختلف ⇒ رفض (لا تبديل مستأجر)', () => {
  const decision = evaluateIdentityAttestation(attestation({ claimed_tenant_id: TENANT_B }));
  assert.equal(decision.trusted === false ? decision.code : '', 'identity_tenant_conflict');
});

test('S09-07) ⭐⭐⭐ دور خارج المجموعة المغلقة ⇒ رفض', () => {
  const decision = evaluateIdentityAttestation(attestation({ role: 'root' as never }));
  assert.equal(decision.trusted === false ? decision.code : '', 'role_invalid');
});

test('S09-08) ⭐⭐⭐ هوية ملغاة أو منتهية ⇒ رفض', () => {
  const revoked = evaluateIdentityAttestation(attestation({ status: 'revoked' }));
  assert.equal(revoked.trusted === false ? revoked.code : '', 'identity_revoked');

  const expired = evaluateIdentityAttestation(attestation({ status: 'expired' }));
  assert.equal(expired.trusted === false ? expired.code : '', 'identity_expired');

  const unknown = evaluateIdentityAttestation(attestation({ status: 'weird' as never }));
  assert.equal(unknown.trusted === false ? unknown.code : '', 'identity_attestation_invalid');
});

test('S09-09) ⭐⭐⭐ إثبات مشوّه ⇒ رفض (المعرّفات بنمط النواة)', () => {
  const badIdentity = evaluateIdentityAttestation(attestation({ identity_id: '!' }));
  assert.equal(badIdentity.trusted === false ? badIdentity.code : '', 'identity_attestation_invalid');

  const badTenant = evaluateIdentityAttestation(attestation({ tenant_id: 'Tenant Upper!' }));
  assert.equal(badTenant.trusted === false ? badTenant.code : '', 'identity_attestation_invalid');

  const badActor = evaluateIdentityAttestation(attestation({ actor_id: '' }));
  assert.equal(badActor.trusted === false ? badActor.code : '', 'identity_attestation_invalid');

  const noProofId = evaluateIdentityAttestation(
    attestation({ proof: { kind: 'local_test', source_id: '' } }),
  );
  assert.equal(noProofId.trusted === false ? noProofId.code : '', 'identity_source_untrusted');
});

test('S09-10) ⭐⭐⭐⭐⭐ سياق إداري مزيف ⇒ رفض (نَسَب مثبت = لا نسخ مزوّرة)', () => {
  const forged = evaluateIdentityAttestation(
    attestation({
      requests_admin: true,
      admin_authority: { kind: 'identity.admin', identity_id: 'ident-owner' },
    }),
  );
  assert.equal(forged.trusted === false ? forged.code : '', 'admin_authority_invalid');
});

test('S09-11) ⭐⭐⭐⭐⭐ طلب إداري بلا سلطة ⇒ رفض (المصدر لا يمنح صلاحية إدارية)', () => {
  const decision = evaluateIdentityAttestation(attestation({ requests_admin: true }));
  assert.equal(decision.trusted === false ? decision.code : '', 'admin_authority_invalid');
});

test('S09-12) ⭐⭐⭐⭐⭐ سلطة إدارية من هوية ليست مالكاً ⇒ رفض', () => {
  const { registry } = registryWithOwner();
  registry.register(
    {
      identity_id: 'ident-supervisor',
      tenant_id: TENANT_A,
      actor_id: 'actor-supervisor',
      role: 'supervisor',
      expires_at: null,
    },
    issueIdentityAdminAuthority({
      identity_id: 'ident-owner',
      tenant_id: TENANT_A,
      actor_id: 'actor-owner',
      role: 'owner',
      status: 'active',
      expires_at: null,
    }),
  );
  const supervisorAuthority = issueIdentityAdminAuthority({
    identity_id: 'ident-supervisor',
    tenant_id: TENANT_A,
    actor_id: 'actor-supervisor',
    role: 'supervisor',
    status: 'active',
    expires_at: null,
  });

  const decision = evaluateIdentityAttestation(
    attestation({ requests_admin: true, admin_authority: supervisorAuthority }),
    { registry },
  );
  assert.equal(decision.trusted === false ? decision.code : '', 'admin_not_owner');
});

test('S09-13) ⭐⭐⭐⭐⭐ إثبات سليم ⇒ ادّعاء موثوق **بلا صلاحية** (لا محرك موازٍ)', () => {
  const decision = evaluateIdentityAttestation(issuedAttestation(registryWithAgent()));
  assert.equal(decision.trusted, true);
  if (!decision.trusted) return;
  const claim = decision.claim;
  assert.equal(claim.tenant_id, TENANT_A);
  assert.equal(claim.actor_id, 'actor-agent');
  assert.equal(claim.role, 'agent');
  assert.equal(claim.status, 'active');
  assert.equal(claim.source_kind, 'local_test');
  // ⭐⭐⭐ **لا حقل صلاحيات في العقد** ⇒ ⭐⇒⇒ لا يستطيع منح صلاحية.
  assert.equal(
    Object.prototype.hasOwnProperty.call(claim, 'capabilities'),
    false,
    'الادّعاء يحمل صلاحيات ⇒ العقد صار محرك صلاحيات موازياً',
  );
  assert.equal(Object.prototype.hasOwnProperty.call(claim, 'granted_capabilities'), false);
});

test('S09-14) ⭐⭐⭐⭐⭐ العقد لا يُفعّل أي مصدر ولا يفتح مساراً إنتاجياً', () => {
  // ⭐⭐⭐ **لا مصدر إنتاجي مسجَّل** ⇒ ⭐⇒⇒ لا مسار افتراضي.
  assert.deepEqual([...activeSessionSources()], []);

  // ⭐⭐⭐ **الأنواع المعروفة غير النشطة** ⇒ ⭐⇒⇒ التفعيل يحتاج تصريح منفصل.
  assert.deepEqual([...IDENTITY_SOURCE_CONTRACT.known_proof_kinds], [
    'local_test',
    'external_attested',
  ]);
  assert.ok(
    IDENTITY_SOURCE_CONTRACT.forbids.includes('production_scope'),
    'العقد لا يمنع النطاق الإنتاجي',
  );
  assert.ok(
    IDENTITY_SOURCE_CONTRACT.forbids.includes('self_asserted_admin'),
    'العقد لا يمنع ادّعاء الإدارة من المصدر',
  );
});

// ============================================================
// ⭐ ② — تغطية رموز الرفض التي بلا تأكيد (قائمة M40 · ١٠ رموز)
// ⭐⭐ **الهدف**: ⭐ كل رمز رفض معرَّف في `src/core/` وله مسار قابل
//   للوصول ⇒ ⭐⇒⇒ **يُؤكَّد بالاختبار هنا** ⇒ ⭐⇒⇒⇒ **وتصبح الفجوة «صفر»**
//   ⇒ ⭐⇒⇒⇒⇒ **وهذا ما يجعل اختبارات الطرد (E-1..E-7) قابلة للاكتشاف.**
// ============================================================

/** ⭐⭐ سجلّ + مصادر + هوية موظف (مستأجر ألف). */
function agentWorld(): {
  registry: LocalIdentityRegistry;
  sources: ReturnType<typeof createLocalIdentitySources>;
  request: LocalAuthorizationRequest;
} {
  const registry = new LocalIdentityRegistry();
  const ownerAuthority = issueIdentityAdminAuthority({
    identity_id: 'ident-owner',
    tenant_id: TENANT_A,
    actor_id: 'actor-owner',
    role: 'owner',
    status: 'active',
    expires_at: null,
  });
  registry.register(
    {
      identity_id: 'ident-owner',
      tenant_id: TENANT_A,
      actor_id: 'actor-owner',
      role: 'owner',
      expires_at: null,
    },
    ownerAuthority,
  );
  registry.register(
    {
      identity_id: 'ident-agent',
      tenant_id: TENANT_A,
      actor_id: 'actor-agent',
      role: 'agent',
      expires_at: null,
    },
    ownerAuthority,
  );
  const sources = createLocalIdentitySources(registry);
  const request: LocalAuthorizationRequest = {
    identity_id: 'ident-agent',
    conversation_ref: REF_A,
    operation: 'conversation.read',
  };
  return { registry, sources, request };
}

test('G-01) ⭐⭐⭐ رمز `request_invalid` ⇒ رفض (طلب مفقود)', () => {
  const { registry, sources } = agentWorld();
  const decision = authorizeLocalRequest(null as never, { registry, sources });
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false ? decision.code : '', 'request_invalid');
});

test('G-02) ⭐⭐⭐ رمز `operation_unknown` ⇒ رفض (عملية خارج المجموعة المعلنة)', () => {
  const { registry, sources, request } = agentWorld();
  const decision = authorizeLocalRequest(
    { ...request, operation: 'conversation.unknown' as never },
    { registry, sources },
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false ? decision.code : '', 'operation_unknown');
});

test('G-03) ⭐⭐⭐⭐ رمز `identity_rejected` ⇒ رفض (مصدر مسجَّل يرفض التحقّق)', () => {
  const { registry, sources, request } = agentWorld();
  const refusing = {
    id: 'test-refusing-source',
    scope: 'test' as const,
    description: 'مصدر اختبار يرفض التحقّق عمداً',
    verify(): never {
      return null as never;
    },
  };
  registerSessionSource({
    source: refusing,
    grantedRole: 'agent',
    grantCeiling: ROLE_CAPABILITIES.agent,
  });
  const decision = authorizeLocalRequest(request, {
    registry,
    sources: { byRole: { ...sources.byRole, agent: refusing } },
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false ? decision.code : '', 'identity_rejected');
});

test('G-04) ⭐⭐⭐⭐ رمز `identity_role_unsupported` ⇒ رفض (دور بلا مصدر مسجَّل)', () => {
  const { registry, sources, request } = agentWorld();
  const byRole = { ...sources.byRole } as Record<string, typeof sources.byRole.agent>;
  delete byRole.agent;
  const decision = authorizeLocalRequest(request, {
    registry,
    sources: { byRole: byRole as never },
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false ? decision.code : '', 'identity_role_unsupported');
});

test('G-05) ⭐⭐⭐⭐ رمز `admin_not_owner` ⇒ رفض (سلطة من هوية ليست مالكاً)', () => {
  const { registry } = agentWorld();
  const supervisorAuthority = issueIdentityAdminAuthority({
    identity_id: 'ident-agent',
    tenant_id: TENANT_A,
    actor_id: 'actor-agent',
    role: 'agent',
    status: 'active',
    expires_at: null,
  });
  assert.throws(
    () =>
      registry.register(
        {
          identity_id: 'ident-new',
          tenant_id: TENANT_A,
          actor_id: 'actor-new',
          role: 'viewer',
          expires_at: null,
        },
        supervisorAuthority,
      ),
    (error: unknown) => {
      assert.equal((error as { code: string }).code, 'admin_not_owner');
      return true;
    },
  );
});

test('G-06) ⭐⭐⭐ رمز `admin_expired` ⇒ رفض (صاحب سلطة منتهية)', () => {
  const registry = new LocalIdentityRegistry();
  const ownerAuthority = issueIdentityAdminAuthority({
    identity_id: 'ident-owner-exp',
    tenant_id: TENANT_A,
    actor_id: 'actor-owner-exp',
    role: 'owner',
    status: 'active',
    expires_at: null,
  });
  registry.register(
    {
      identity_id: 'ident-owner-exp',
      tenant_id: TENANT_A,
      actor_id: 'actor-owner-exp',
      role: 'owner',
      expires_at: '2000-01-01T00:00:00.000Z',
    },
    ownerAuthority,
  );
  assert.throws(
    () =>
      registry.register(
        {
          identity_id: 'ident-other',
          tenant_id: TENANT_A,
          actor_id: 'actor-other',
          role: 'viewer',
          expires_at: null,
        },
        ownerAuthority,
      ),
    (error: unknown) => {
      assert.equal((error as { code: string }).code, 'admin_expired');
      return true;
    },
  );
});

test('G-07) ⭐⭐⭐ رمز `admin_bootstrap_requires_owner` ⇒ رفض (أول هوية ليست مالكاً)', () => {
  const registry = new LocalIdentityRegistry();
  const authority = issueIdentityAdminAuthority({
    identity_id: 'ident-first',
    tenant_id: TENANT_A,
    actor_id: 'actor-first',
    role: 'viewer',
    status: 'active',
    expires_at: null,
  });
  assert.throws(
    () =>
      registry.register(
        {
          identity_id: 'ident-first',
          tenant_id: TENANT_A,
          actor_id: 'actor-first',
          role: 'viewer',
          expires_at: null,
        },
        authority,
      ),
    (error: unknown) => {
      assert.equal((error as { code: string }).code, 'admin_bootstrap_requires_owner');
      return true;
    },
  );
});

test('G-08) ⭐⭐⭐ رمز `identity_input_missing` ⇒ رفض (مدخل هوية مفقود)', () => {
  const { registry, ownerAuthority } = registryWithOwner();
  assert.throws(
    () => registry.register(undefined as never, ownerAuthority),
    (error: unknown) => {
      assert.equal((error as { code: string }).code, 'identity_input_missing');
      return true;
    },
  );
});

test('G-09) ⭐⭐⭐ رمز `tenant_invalid` ⇒ رفض (معرّف مستأجر غير صالح)', () => {
  const { registry, ownerAuthority } = registryWithOwner();
  assert.throws(
    () =>
      registry.register(
        {
          identity_id: 'ident-bad-tenant',
          tenant_id: 'Tenant With Spaces!',
          actor_id: 'actor-bad-tenant',
          role: 'viewer',
          expires_at: null,
        },
        ownerAuthority,
      ),
    (error: unknown) => {
      assert.equal((error as { code: string }).code, 'tenant_invalid');
      return true;
    },
  );
});

test('G-10) ⭐⭐⭐ رمز `role_invalid` ⇒ رفض (دور خارج المجموعة المغلقة)', () => {
  const { registry, ownerAuthority } = registryWithOwner();
  assert.throws(
    () =>
      registry.register(
        {
          identity_id: 'ident-bad-role',
          tenant_id: TENANT_A,
          actor_id: 'actor-bad-role',
          role: 'root' as never,
          expires_at: null,
        },
        ownerAuthority,
      ),
    (error: unknown) => {
      assert.equal((error as { code: string }).code, 'role_invalid');
      return true;
    },
  );
});

// ============================================================
// ⭐ ③ — التكامل مع طبقة التفويض القائمة (بلا تغيير سلوكي)
// ============================================================

test('S09-15) ⭐⭐⭐⭐⭐ طبقة التفويض القائمة ترفض انتحال الدور وتبديل المستأجر', () => {
  const { registry, sources, request } = agentWorld();

  // ⭐⭐⭐ **ادّعاء دور أعلى في `extra`** ⇒ ⭐ الحقول تُتجاهل ⇒ الرفض بالصلاحية.
  const escalation = authorizeLocalRequest(
    { ...request, operation: 'conversation.assign', extra: { role: 'owner' } },
    { registry, sources },
  );
  assert.equal(escalation.allowed, false);
  assert.equal(escalation.allowed === false ? escalation.code : '', 'capability_missing');

  // ⭐⭐⭐ **تبديل المستأجر** ⇒ ⭐ رفض `tenant_mismatch`.
  const switched = authorizeLocalRequest(
    { ...request, declared_tenant_id: TENANT_B },
    { registry, sources },
  );
  assert.equal(switched.allowed, false);
  assert.equal(switched.allowed === false ? switched.code : '', 'tenant_mismatch');

  // ⭐⭐⭐ **البوّابة الفاشلة-المغلقة ترمي** ⇒ ⭐ لا تنفيذ بلا سياق.
  assert.throws(
    () =>
      requireLocalAuthorization({ ...request, operation: 'conversation.assign' }, {
        registry,
        sources,
      }),
    (error: unknown) => {
      assert.ok(error instanceof LocalAuthorizationError);
      assert.equal((error as { code: string }).code, 'capability_missing');
      return true;
    },
  );

  // ⭐⭐⭐ **العملية المسموحة تبقى مسموحة** ⇒ ⭐ بلا كسر للوظائف السابقة.
  const allowed = authorizeLocalRequest(request, { registry, sources });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.allowed === true ? allowed.tenant_id : '', TENANT_A);
});

// ============================================================
// ⭐ ④ — «حزمة التسريع ٠١» (D-065): ⭐ M54 (أصالة جهة الإصدار) · M55 (دلالة العقد)
// ⭐⭐ **التصريح**: ⭐ المالك (٦ نوفمبر ٢٠٢٦ · D-065) — «حزمة التسريع ٠١».
// ⭐⭐⭐ **هذا ليس نظام مصادقة** ⇒ ⭐ كل نتيجة أدناه = نتيجة محلية على جهاز
//   التطوير ⭐⇒ **وليست شهادة أمان إنتاجي.**
// ⛔ بلا شبكة · ⛔ بلا بيانات حقيقية · ⛔ بلا حساب · ⛔ بلا نشر.
// ============================================================

test('M54-01) ⭐⭐⭐⭐⭐ إثبات مبنيّ يدوياً (شكل سليم) ⇒ رفض', () => {
  // ⭐⭐⭐ **العيب الذي كان موجوداً**: ⭐ مطابقة الشكل وحدها كانت تكفي.
  const decision = evaluateIdentityAttestation(attestation());
  assert.equal(decision.trusted, false);
  assert.equal(
    decision.trusted === false ? decision.code : '',
    'identity_issuer_unverified',
    'كائن مبنيّ يدوياً مرّ ⇒ العيب M54 لم يُغلق',
  );
});

test('M54-02) ⭐⭐⭐⭐⭐ نسخة من إثبات مُصدَر ⇒ رفض (النسخ ليس الإصدار)', () => {
  const issued = issuedAttestation(registryWithAgent());
  const copy = { ...issued };
  const decision = evaluateIdentityAttestation(copy);
  assert.equal(decision.trusted, false);
  assert.equal(decision.trusted === false ? decision.code : '', 'identity_issuer_unverified');
});

test('M54-03) ⭐⭐⭐⭐⭐ تعديل الدور بعد الإصدار ⇒ رفض (القيمة المثبتة هي المرجع)', () => {
  const issued = issuedAttestation(registryWithAgent());
  (issued as { role: string }).role = 'owner';
  const decision = evaluateIdentityAttestation(issued);
  assert.equal(decision.trusted, false);
  assert.equal(decision.trusted === false ? decision.code : '', 'identity_registry_mismatch');
});

test('M54-04) ⭐⭐⭐⭐⭐ إلغاء الهوية بعد الإصدار ⇒ رفض عند إعادة التحقّق', () => {
  const { registry, ownerAuthority } = registryWithOwner();
  registry.register(
    {
      identity_id: 'ident-agent',
      tenant_id: TENANT_A,
      actor_id: 'actor-agent',
      role: 'agent',
      expires_at: null,
    },
    ownerAuthority,
  );
  const issued = issueLocalTestAttestation('ident-agent', { registry });
  assert.equal(evaluateIdentityAttestation(issued).trusted, true);

  registry.revoke('ident-agent', ownerAuthority);
  const decision = evaluateIdentityAttestation(issued);
  assert.equal(decision.trusted, false);
  assert.equal(decision.trusted === false ? decision.code : '', 'identity_revoked');
});

test('M54-05) ⭐⭐⭐⭐⭐ الإصدار يشتقّ الدور والمستأجر من السجلّ (لا من المستدعي)', () => {
  const registry = registryWithAgent();
  const issued = issueLocalTestAttestation('ident-agent', { registry });
  assert.equal(issued.role, 'agent');
  assert.equal(issued.tenant_id, TENANT_A);
  assert.equal(issued.actor_id, 'actor-agent');
  assert.equal(issued.status, 'active');

  assert.throws(
    () => issueLocalTestAttestation('ident-ghost', { registry }),
    (error: unknown) => {
      assert.equal((error as { code: string }).code, 'identity_unregistered');
      return true;
    },
  );
});

test('M54-06) ⭐⭐⭐⭐⭐ السطح العام لا يُصدّر مُصدِر الإثبات', () => {
  assert.equal(
    'issueLocalTestAttestation' in publicSurface,
    false,
    'السطح العام صار يُصدر إثبات هوية ⇒ نافذة إصدار مكشوفة',
  );
});

test('M54-07) ⭐⭐⭐⭐⭐ الفحص البنيوي لا يمنح ثقة (الفصل صريح)', () => {
  const structure = evaluateIdentityAttestationStructure(attestation());
  assert.equal(structure.structurally_valid, true);
  assert.equal(structure.code, null);

  const decision = evaluateIdentityAttestation(attestation());
  assert.equal(decision.trusted, false, 'الفحص البنيوي تحوّل إلى ثقة');
});

/**
 * ⭐⭐⭐⭐⭐ **جرد رموز الرفض القابلة للوصول (M57)** — ⭐ **قياس لا ادّعاء**.
 * ⭐⭐ **الفصل المطلوب (M57)**: ⭐ ⭐⇒ **تغطية الفروع (أي رمز رفض له مسار
 *   وصول) ≠ تغطية المتطلبات الأمنية (هل المتطلب مُنفَّذ ومُختبَر).**
 * ⭐⇒⇒ **فهذا الجرد يقيس الأول فقط** ⇒ ⭐⇒⇒⇒ **والمتطلبات تُقاس في جدول
 *   منفصل داخل التقرير.**
 */
function collectRejectionCodes(): Map<string, string> {
  const { registry, ownerAuthority } = registryWithOwner();
  registry.register(
    {
      identity_id: 'ident-agent',
      tenant_id: TENANT_A,
      actor_id: 'actor-agent',
      role: 'agent',
      expires_at: null,
    },
    ownerAuthority,
  );
  const supervisorAuthority = issueIdentityAdminAuthority({
    identity_id: 'ident-supervisor',
    tenant_id: TENANT_A,
    actor_id: 'actor-supervisor',
    role: 'supervisor',
    status: 'active',
    expires_at: null,
  });
  const secondOwnerAuthority = issueIdentityAdminAuthority({
    identity_id: 'ident-owner-2',
    tenant_id: TENANT_A,
    actor_id: 'actor-owner-2',
    role: 'owner',
    status: 'active',
    expires_at: null,
  });
  registry.register(
    {
      identity_id: 'ident-owner-2',
      tenant_id: TENANT_A,
      actor_id: 'actor-owner-2',
      role: 'owner',
      expires_at: null,
    },
    ownerAuthority,
  );
  registry.revoke('ident-owner-2', ownerAuthority);

  const issued = issueLocalTestAttestation('ident-agent', { registry });
  const tampered = issueLocalTestAttestation('ident-agent', { registry });
  (tampered as { role: string }).role = 'owner';

  const cases: { label: string; value: unknown; scope?: 'test' | 'production' }[] = [
    { label: 'غياب الإثبات', value: undefined },
    { label: 'إثبات فارغ', value: {} },
    { label: 'نوع مصدر مجهول', value: attestation({ proof: { kind: 'made_up', source_id: 'x' } as never }) },
    { label: 'مصدر خارجي موثّق', value: attestation({ proof: { kind: 'external_attested', source_id: 's', attestation_ref: 'r' } }) },
    { label: 'نطاق إنتاجي', value: issued, scope: 'production' },
    { label: 'معرّف هوية فاسد', value: attestation({ identity_id: '!' }) },
    { label: 'معرّف مستأجر فاسد', value: attestation({ tenant_id: 'Tenant Upper!' }) },
    { label: 'دور خارج المجموعة المغلقة', value: attestation({ role: 'root' as never }) },
    { label: 'هوية ملغاة', value: attestation({ status: 'revoked' }) },
    { label: 'هوية منتهية', value: attestation({ status: 'expired' }) },
    { label: 'حالة خارج المجموعة المغلقة', value: attestation({ status: 'weird' as never }) },
    { label: 'ادّعاء مستأجر مختلف', value: attestation({ claimed_tenant_id: TENANT_B }) },
    { label: 'ادّعاء دور أعلى', value: attestation({ claimed_role: 'owner' }) },
    { label: 'سياق إداري مزيف', value: attestation({ requests_admin: true, admin_authority: { kind: 'identity.admin', identity_id: 'x' } }) },
    { label: 'طلب إداري بلا سلطة', value: attestation({ requests_admin: true }) },
    { label: 'سلطة من هوية ليست مالكاً', value: attestation({ requests_admin: true, admin_authority: supervisorAuthority }) },
    { label: 'سلطة مالك ملغى', value: attestation({ requests_admin: true, admin_authority: secondOwnerAuthority }) },
    { label: 'إثبات مبنيّ يدوياً', value: attestation() },
    { label: 'تعديل إثبات مُصدَر', value: tampered },
  ];

  const codes = new Map<string, string>();
  for (const item of cases) {
    const decision = evaluateIdentityAttestation(item.value, {
      scope: item.scope ?? 'test',
      registry,
    });
    assert.equal(decision.trusted, false, `الحالة «${item.label}» قُبلت ⇒ الفحص ناقص`);
    if (decision.trusted) continue;
    if (!codes.has(decision.code)) codes.set(decision.code, item.label);
  }

  // ⭐⭐⭐ **رموز مسار الإصدار (الرمي)** ⇒ ⭐⇒⇒ **تُحتسب مع الرفض لا بدلها.
  try {
    issueLocalTestAttestation('ident-ghost', { registry });
  } catch (error) {
    const code = (error as { code: string }).code;
    if (!codes.has(code)) codes.set(code, 'إصدار لهوية غير مسجَّلة');
  }
  try {
    issueLocalTestAttestation('ident-agent', {} as never);
  } catch (error) {
    const code = (error as { code: string }).code;
    if (!codes.has(code)) codes.set(code, 'إصدار بلا سجلّ');
  }

  return codes;
}

test('M55-01) ⭐⭐⭐⭐⭐ دلالة العقد معلنة (تعريف ⇦ تقييم ⇦ تفعيل)', () => {
  assert.equal(IDENTITY_SOURCE_CONTRACT.state, 'defined');
  assert.equal(IDENTITY_SOURCE_CONTRACT.activation_requires, 'owner_decision');
  assert.equal(IDENTITY_SOURCE_CONTRACT.evaluation.scope, 'test');
  assert.equal(IDENTITY_SOURCE_CONTRACT.evaluation.session_established, false);
  assert.equal(IDENTITY_SOURCE_CONTRACT.evaluation.issuer_trust_required, true);
  assert.equal(IDENTITY_SOURCE_CONTRACT.evaluation.requires_issued_attestation, true);
  assert.deepEqual(
    [...IDENTITY_CONTRACT_STATES],
    ['defined', 'evaluated_locally', 'activated'],
  );
});

test('M55-02) ⭐⭐⭐⭐⭐ كل رمز رفض يرجّعه العقد معلَن في المجموعة المغلقة', () => {
  const declared = new Set<string>(IDENTITY_CONTRACT_CODES);
  const codes = collectRejectionCodes();
  for (const code of codes.keys()) {
    assert.ok(declared.has(code), `رمز رفض غير معلَن: ${code}`);
  }
});

test('M55-03) ⭐⭐⭐⭐⭐ ناتج التقييم يحمل دلالته (بلا جلسة مصادقة)', () => {
  const claim = assertIdentityAttestation(issuedAttestation(registryWithAgent()));
  assert.equal(claim.issuer_trust, 'issued_local_test');
  assert.equal(claim.contract_state, 'defined');
  assert.equal(claim.evaluation_scope, 'test');
  assert.equal(claim.session_established, false);
});

test('M57-01) ⭐⭐⭐⭐⭐ جرد رموز الرفض (مقيس: ١٧ قابل · ١ معلَن بلا مسار)', () => {
  const codes = collectRejectionCodes();
  const declared = [...IDENTITY_CONTRACT_CODES];
  const unreachable = declared.filter((code) => !codes.has(code));

  // ⭐⭐⭐ **القياس مكتوب في اسم الفحص** ⇒ ⭐⇒⇒ **وليس تقديراً في التقرير.**
  assert.equal(codes.size, 17, `العدد المقيس ${codes.size} ≠ 17`);
  assert.deepEqual(unreachable, ['identity_status_invalid']);
  assert.equal(declared.length, 18);
});

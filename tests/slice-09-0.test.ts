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
  const aligned = evaluateIdentityAttestation(attestation({ claimed_role: 'agent' }));
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
  const decision = evaluateIdentityAttestation(attestation());
  assert.equal(decision.trusted, true);
  if (!decision.trusted) return;
  const claim = decision.claim;
  assert.equal(claim.tenant_id, TENANT_A);
  assert.equal(claim.actor_id, 'actor-alpha-1');
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

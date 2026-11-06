// ============================================================
// WASL AI — اختبارات Slice 08 (الهوية المحلية وطبقة التفويض)
// ------------------------------------------------------------
// ⭐⭐⭐ **التصريح**: ⭐ المالك (٦ نوفمبر ٢٠٢٦ · D-062) — «Slice 08 — Local
//   Identity & Role Authorization Prototype».
// ⭐⭐⭐ **هذا ليس نظام مصادقة** ⇒ ⭐ كل ما هنا **محاكاة محلية** بهويات
//   اصطناعية ⇒ ⭐⇒ **وكل نتيجة أدناه = نتيجة محلية لا شهادة إنتاج.**
// ⭐⭐ **ماذا يُثبته هذا الملف** (الأسماء هي مرجع مصفوفة التغطية `M35`):
//   ⭐ S08-01 ⇒ قبول العمليات المسموحة لهوية موثوقة.
//   ⭐ S08-02 ⇒ رفض الهوية المجهولة.
//   ⭐ S08-03 ⇒ رفض الهوية الملغاة.
//   ⭐ S08-04 ⇒ رفض الهوية منتهية الصلاحية.
//   ⭐ S08-05 ⇒ رفض الهوية/السلطة المزوّرة.
//   ⭐ S08-06 ⇒ رفض محاولة رفع الدور.
//   ⭐ S08-07 ⇒ رفض تمرير دور أعلى عبر مدخلات المستخدم.
//   ⭐ S08-08 ⇒ رفض تغيير المستأجر.
//   ⭐ S08-09 ⇒ رفض الوصول لمستأجر آخر.
//   ⭐ S08-10 ⇒ رفض العمليات عند فقدان سياق الهوية.
//   ⭐ S08-11 ⇒ عدم تسريب بيانات أو سجلات تدقيق بين المستأجرين.
//   ⭐ S08-12 ⇒ استمرار الوظائف المحلية المصرّح بها سابقاً.
//   ⭐ S08-13 ⇒_authority: ⭐ رفض العمليات الإدارية بلا أحقية.
//   ⭐ S08-14 ⇒ فصل مصدر الهوية عن قرار السماح (M34).
// ⛔ بلا شبكة · ⛔ بلا بيانات حقيقية · ⛔ بلا حساب · ⛔ بلا نشر.
// ============================================================

import assert from 'node:assert/strict';
import test from 'node:test';

import { guard } from './guard-setup.ts';
import {
  AuditLog,
  ConversationChangeLog,
  ConversationStateStore,
  LocalAuthorizationError,
  LocalIdentityRegistry,
  MessageStore,
  OrderingState,
  ProcessingLayer,
  ReadAuditLog,
  assignConversation,
  authorizeLocalRequest,
  createLocalIdentitySources,
  getConversation,
  getConversationState,
  getServiceMetrics,
  listConversations,
  listWorkQueue,
  requireLocalAuthorization,
  unassignConversation,
  updateConversationState,
  type ConversationStateDependencies,
  type EmployeeDirectory,
  type LocalAuthorizationRequest,
  type TenantContext,
  type TrustedRole,
} from '../src/core/index.ts';
// ⭐⭐ Slice 08 — ⭐ **إصدار سلطة الإدارة ليس في السطح العام** ⇒ ⭐ استيراد مباشر
//    (وهو ⭐ **السبب** في أن السطح العام لا يستطيع تسجيل هوية أو إلغاؤها).
import { issueIdentityAdminAuthority } from '../src/core/identity.ts';

const NOW = '2026-01-01T00:00:00.000Z';
const TENANT_A = 'tnt_local_a';
const TENANT_B = 'tnt_local_b';
const TENANT_C = 'tnt_local_c';
const REF_A = 'conv_local_0001';
const REF_B = 'conv_local_0002';
const REF_C = 'conv_local_0003';

// ============================================================
// ⭐ أدوات البناء
// ============================================================

interface Seed {
  readonly identity_id: string;
  readonly tenant_id: string;
  readonly actor_id: string;
  readonly role: TrustedRole;
  readonly expires_at?: string | null;
}

function seed(
  identityId: string,
  tenantId: string,
  actorId: string,
  role: TrustedRole,
  expiresAt: string | null = null,
): Seed {
  return { identity_id: identityId, tenant_id: tenantId, actor_id: actorId, role, expires_at: expiresAt };
}

/** ⭐⭐ يبني سجلّ هوية + مصادره ⇒ ⭐ (التسجيل صريح · بلا افتراضي). */
function identityWorld(now: () => string = () => NOW) {
  const registry = new LocalIdentityRegistry({ now });
  const ownerAuthority = issueIdentityAdminAuthority({
    ...seed('ident-owner-a', TENANT_A, 'actor_local_a1', 'owner'),
    status: 'active',
    expires_at: null,
  });
  registry.register(seed('ident-owner-a', TENANT_A, 'actor_local_a1', 'owner'), ownerAuthority);
  registry.register(seed('ident-super-a', TENANT_A, 'actor_local_a2', 'supervisor'), ownerAuthority);
  registry.register(seed('ident-agent-a', TENANT_A, 'actor_local_a3', 'agent'), ownerAuthority);
  registry.register(seed('ident-view-a', TENANT_A, 'actor_local_a4', 'viewer'), ownerAuthority);
  registry.register(seed('ident-owner-b', TENANT_B, 'actor_local_b1', 'owner'), ownerAuthority);
  registry.register(seed('ident-owner-c', TENANT_C, 'actor_local_c1', 'owner'), ownerAuthority);
  const sources = createLocalIdentitySources(registry);
  return { registry, sources, ownerAuthority };
}

/** ⭐⭐ بيئة النواة الكاملة (٣ مستأجرين) — ⭐ لاختبار العزل الحقيقي. */
function coreWorld(now: () => string = () => NOW) {
  const audit = new AuditLog({ now });
  const readAudit = new ReadAuditLog({ now });
  const store = new MessageStore({ now, audit });
  const layer = new ProcessingLayer({ store, audit, orderingState: new OrderingState() });
  const states = new ConversationStateStore({ now });
  const changes = new ConversationChangeLog({ now });
  const roster: Record<string, readonly string[]> = {
    [TENANT_A]: ['actor_local_a1', 'actor_local_a2', 'actor_local_a3'],
    [TENANT_B]: ['actor_local_b1'],
    [TENANT_C]: ['actor_local_c1'],
  };
  const employees: EmployeeDirectory = {
    isEmployee(tenantId: string, actorId: string): boolean {
      return (roster[tenantId] ?? []).includes(actorId);
    },
  };
  const deps: ConversationStateDependencies = { store, states, changes, readAudit, employees };
  const queryDeps = { store, audit, readAudit };
  return { audit, readAudit, store, layer, states, changes, deps, queryDeps };
}

/** ⭐⭐ بذر محادثة لكل مستأجر (رسالتان) عبر **عمليات النواة نفسها**. */
function seedConversations(layer: ProcessingLayer): void {
  const plan: Array<{ tenant: string; ref: string; index: number }> = [
    { tenant: TENANT_A, ref: REF_A, index: 1 },
    { tenant: TENANT_B, ref: REF_B, index: 2 },
    { tenant: TENANT_C, ref: REF_C, index: 3 },
  ];
  for (const item of plan) {
    const context = {
      tenantId: item.tenant,
      actorId: 'actor_local_a1',
      sessionId: 'sess_local_seed',
      conversationRef: item.ref,
      capabilities: ['conversation.list', 'conversation.read'],
      role: 'owner' as TrustedRole,
      issuedAt: NOW,
    } as unknown as TenantContext;
    for (const messageIndex of [item.index * 10, item.index * 10 + 1]) {
      layer.process(context, {
        schema_version: '1',
        message_ref: `local-msg-${String(messageIndex).padStart(6, '0')}`,
        channel: 'local',
        direction: messageIndex % 2 === 0 ? 'inbound' : 'outbound',
        from: 'participant-local@example.invalid',
        to: 'participant-local@example.invalid',
        body: `رسالة محلية اصطناعية رقم ${String(messageIndex)}`,
        occurred_at: `2026-01-0${(messageIndex % 9) + 1}T12:00:00.000Z`,
        locale: 'ar-EG',
        attributes: { synthetic: 'true' },
        conversation_ref: item.ref,
      });
    }
  }
}

function request(
  identityId: string,
  conversationRef: string,
  operation: LocalAuthorizationRequest['operation'],
  extra: Record<string, unknown> = {},
): LocalAuthorizationRequest {
  return { identity_id: identityId, conversation_ref: conversationRef, operation, extra };
}

// ============================================================
// ⭐⭐⭐ ① القبول — هوية موثوقة ⇒ العمليات المسموحة
// ============================================================

test('S08-01) ⭐⭐⭐ قبول العمليات المسموحة لهوية موثوقة', async (t) => {
  await t.test('S08-01أ) ⭐ المالك: كل العمليات المسموحة مقبولة', () => {
    const { registry, sources } = identityWorld();
    const operations = [
      'conversation.list',
      'conversation.read',
      'conversation.audit',
      'conversation.state.read',
      'conversation.state.update',
      'conversation.assign',
      'conversation.changes',
      'conversation.queue.read',
      'conversation.metrics.read',
    ] as const;
    for (const operation of operations) {
      const decision = authorizeLocalRequest(
        request('ident-owner-a', REF_A, operation),
        { registry, sources },
      );
      assert.equal(decision.allowed, true, `عملية ${operation} رُفضت للمالك`);
      if (decision.allowed) {
        assert.equal(decision.role, 'owner');
        assert.equal(decision.tenant_id, TENANT_A);
      }
    }
  });

  await t.test('S08-01ب) ⭐ المشرف: مقبول، ودوره ودور المستأجر من السجلّ', () => {
    const { registry, sources } = identityWorld();
    const decision = authorizeLocalRequest(
      request('ident-super-a', REF_A, 'conversation.state.update'),
      { registry, sources },
    );
    assert.equal(decision.allowed, true);
    if (decision.allowed) {
      assert.equal(decision.role, 'supervisor');
      assert.equal(decision.context.tenantId, TENANT_A);
      assert.equal(decision.context.actorId, 'actor_local_a2');
    }
  });

  await t.test('S08-01ج) ⭐ الموظف: مقبول للقراءة والطابور، مرفوض للإسناد', () => {
    const { registry, sources } = identityWorld();
    const read = authorizeLocalRequest(
      request('ident-agent-a', REF_A, 'conversation.read'),
      { registry, sources },
    );
    assert.equal(read.allowed, true);
    if (read.allowed) assert.equal(read.role, 'agent');
    const assign = authorizeLocalRequest(
      request('ident-agent-a', REF_A, 'conversation.assign'),
      { registry, sources },
    );
    assert.equal(assign.allowed, false);
    if (!assign.allowed) assert.equal(assign.code, 'capability_missing');
  });

  await t.test('S08-01د) ⭐ القارئ (`viewer`): قراءة فقط', () => {
    const { registry, sources } = identityWorld();
    const read = authorizeLocalRequest(
      request('ident-view-a', REF_A, 'conversation.read'),
      { registry, sources },
    );
    assert.equal(read.allowed, true);
    if (read.allowed) assert.equal(read.role, 'viewer');
    const metrics = authorizeLocalRequest(
      request('ident-view-a', REF_A, 'conversation.metrics.read'),
      { registry, sources },
    );
    assert.equal(metrics.allowed, false);
    if (!metrics.allowed) assert.equal(metrics.code, 'capability_missing');
  });
});

// ============================================================
// ⭐⭐⭐ ② الرفض — هوية غير صالحة
// ============================================================

test('S08-02) ⭐⭐⭐ رفض الهوية المجهولة', () => {
  const { registry, sources } = identityWorld();
  const decision = authorizeLocalRequest(
    request('ident-ghost', REF_A, 'conversation.read'),
    { registry, sources },
  );
  assert.equal(decision.allowed, false);
  if (!decision.allowed) assert.equal(decision.code, 'identity_unknown');
});

test('S08-03) ⭐⭐⭐ رفض الهوية الملغاة', () => {
  const { registry, sources, ownerAuthority } = identityWorld();
  assert.equal(registry.revoke('ident-agent-a', ownerAuthority), true);
  const decision = authorizeLocalRequest(
    request('ident-agent-a', REF_A, 'conversation.read'),
    { registry, sources },
  );
  assert.equal(decision.allowed, false);
  if (!decision.allowed) assert.equal(decision.code, 'identity_revoked');
});

test('S08-04) ⭐⭐⭐ رفض الهوية منتهية الصلاحية', () => {
  const world = identityWorld(() => NOW);
  const { registry, sources } = world;
  const expired = authorizeLocalRequest(
    request('ident-owner-b', REF_B, 'conversation.read'),
    { registry, sources },
  );
  assert.equal(expired.allowed, true, 'الهوية غير المنتهية رُفضت');
  // ⭐ هوية منتهية: ⭐ تُسجَّل بتاريخ انتهاء في الماضي ⇒ ⇒تُرفض وقت التفويض.
  const authority = world.ownerAuthority;
  registry.register(
    seed('ident-expired-c', TENANT_C, 'actor_local_c2', 'agent', '2025-12-31T00:00:00.000Z'),
    authority,
  );
  const decision = authorizeLocalRequest(
    request('ident-expired-c', REF_C, 'conversation.read'),
    { registry, sources },
  );
  assert.equal(decision.allowed, false);
  if (!decision.allowed) assert.equal(decision.code, 'identity_expired');
});

test('S08-05) ⭐⭐⭐ رفض الهوية/السلطة المزوّرة', async (t) => {
  await t.test('S08-05أ) ⭐ سلطة إدارة مزوّرة (نفس الشكل) ⇒ مرفوضة', () => {
    const { registry } = identityWorld();
    const forged = { kind: 'identity.admin', identity_id: 'ident-owner-a' };
    assert.throws(
      () =>
        registry.register(
          seed('ident-forged', TENANT_A, 'actor_local_a9', 'owner'),
          forged as never,
        ),
      (error: unknown) => {
        assert.equal((error as { code: string }).code, 'admin_authority_invalid');
        return true;
      },
    );
  });

  await t.test('S08-05ب) ⭐ سلطة صادرة عن هوية غير مسجَّلة في هذا السجلّ ⇒ مرفوضة', () => {
    const { registry } = identityWorld();
    const ghostAuthority = issueIdentityAdminAuthority({
      ...seed('ident-ghost-admin', TENANT_A, 'actor_local_a9', 'owner'),
      status: 'active',
      expires_at: null,
    });
    assert.throws(
      () =>
        registry.register(
          seed('ident-imposter', TENANT_A, 'actor_local_a9', 'owner'),
          ghostAuthority,
        ),
      (error: unknown) => {
        assert.equal((error as { code: string }).code, 'admin_identity_unregistered');
        return true;
      },
    );
  });

  await t.test('S08-05ج) ⭐ تغيير دور/مستأجر هوية مسجَّلة ⇒ مرفوض (تسجيل واحد)', () => {
    const { registry, ownerAuthority } = identityWorld();
    assert.throws(
      () =>
        registry.register(
          seed('ident-view-a', TENANT_A, 'actor_local_a4', 'owner'),
          ownerAuthority,
        ),
      (error: unknown) => {
        assert.equal((error as { code: string }).code, 'identity_immutable');
        return true;
      },
    );
  });
});

// ============================================================
// ⭐⭐⭐ ③ رفع الدور وتبديل المستأجر
// ============================================================

test('S08-06) ⭐⭐⭐ رفض محاولة رفع الدور', async (t) => {
  await t.test('S08-06أ) ⭐⭕ مصدر الدور الأعلى يرفض هوية أدنى', () => {
    const { registry, sources } = identityWorld();
    // ⭐⭕ ⭐ «تسجيل» دور أعلى ⭐ عبر مصدر المالك ⭐ ⇒ ⭐ مرفوض بنيوياً.
    const ownerSource = sources.byRole.owner;
    const identity = ownerSource.verify({ identity_id: 'ident-view-a', conversation_ref: REF_A });
    assert.equal(identity, null, 'مصدر المالك قبل هوية قارئ');
  });

  await t.test('S08-06ب) ⭐⭕ إعادة تسجيل دور أعلى ⇒ مرفوضة (تسجيل واحد)', () => {
    const { registry, ownerAuthority } = identityWorld();
    assert.throws(
      () =>
        registry.register(
          seed('ident-view-a', TENANT_A, 'actor_local_a4', 'owner'),
          ownerAuthority,
        ),
      (error: unknown) => {
        assert.equal((error as { code: string }).code, 'identity_immutable');
        return true;
      },
    );
    assert.equal(registry.find('ident-view-a')?.role, 'viewer');
  });
});

test('S08-07) ⭐⭐⭐ رفض تمرير دور أعلى عبر مدخلات المستخدم', () => {
  const { registry, sources } = identityWorld();
  const decision = authorizeLocalRequest(
    request('ident-view-a', REF_A, 'conversation.assign', {
      role: 'owner',
      tenant_id: TENANT_B,
      actor_id: 'actor_local_b1',
      capabilities: ['conversation.assign', 'conversation.metrics.read'],
      authenticated: true,
    }),
    { registry, sources },
  );
  assert.equal(decision.allowed, false, 'حمولة العميل رفعت الدور');
  if (!decision.allowed) assert.equal(decision.code, 'capability_missing');
  // ⭐⭐⇒⇒ والدور في السياق بقي دور السجلّ (لا دور الحمولة).
  const allowed = authorizeLocalRequest(
    request('ident-view-a', REF_A, 'conversation.read', { role: 'owner' }),
    { registry, sources },
  );
  assert.equal(allowed.allowed, true);
  if (allowed.allowed) {
    assert.equal(allowed.role, 'viewer', 'الدور جاء من الحمولة');
    assert.equal(allowed.tenant_id, TENANT_A, 'المستأجر جاء من الحمولة');
    assert.equal(allowed.context.actorId, 'actor_local_a4');
  }
});

test('S08-08) ⭐⭐⭐ رفض تغيير المستأجر', () => {
  const { registry, sources } = identityWorld();
  const decision = authorizeLocalRequest(
    {
      identity_id: 'ident-owner-a',
      conversation_ref: REF_A,
      operation: 'conversation.read',
      declared_tenant_id: TENANT_B,
    },
    { registry, sources },
  );
  assert.equal(decision.allowed, false);
  if (!decision.allowed) assert.equal(decision.code, 'tenant_mismatch');
});

test('S08-09) ⭐⭐⭐ رفض الوصول لمستأجر آخر', async (t) => {
  await t.test('S08-09أ) ⭐ عملية على محادثة مستأجر آخر ⇒ `conversation_not_found`', () => {
    const world = coreWorld();
    seedConversations(world.layer);
    const { registry, sources } = identityWorld();
    const decision = authorizeLocalRequest(
      request('ident-owner-a', REF_B, 'conversation.read'),
      { registry, sources },
    );
    assert.equal(decision.allowed, true, 'التفويض المحلي لا يرى المستأجر ⇒ يُفحص في العملية');
    if (decision.allowed) {
      const thread = getConversation(decision.context, REF_B, world.queryDeps);
      assert.equal(thread.messages.length, 0, 'رسائل مستأجر آخر وصلت');
    }
    // ⭐⭐⇒⇒ الرفض الفعلي داخل النواة:
    assert.throws(
      () => updateConversationState(decision.context!, REF_B, 'open', world.deps),
      (error: unknown) => {
        assert.equal((error as { code: string }).code, 'conversation_not_found');
        return true;
      },
    );
  });

  await t.test('S08-09ب) ⭐ ثلاثة مستأجرين: لا تسريب بين أي اثنين', () => {
    const world = coreWorld();
    seedConversations(world.layer);
    const { registry, sources } = identityWorld();
    const pairs: Array<[string, string, string]> = [
      ['ident-owner-a', REF_B, TENANT_B],
      ['ident-owner-a', REF_C, TENANT_C],
      ['ident-owner-b', REF_A, TENANT_A],
      ['ident-owner-b', REF_C, TENANT_C],
      ['ident-owner-c', REF_A, TENANT_A],
      ['ident-owner-c', REF_B, TENANT_B],
    ];
    for (const [identityId, foreignRef, foreignTenant] of pairs) {
      const decision = authorizeLocalRequest(
        request(identityId, foreignRef, 'conversation.read'),
        { registry, sources },
      );
      assert.equal(decision.allowed, true);
      if (!decision.allowed) continue;
      assert.equal(
        decision.tenant_id === foreignTenant,
        false,
        'سياق مستأجر آخر استُخدم',
      );
      assert.equal(getConversation(decision.context, foreignRef, world.queryDeps).messages.length, 0);
      assert.throws(
        () => updateConversationState(decision.context!, foreignRef, 'open', world.deps),
        (error: unknown) => {
          assert.equal((error as { code: string }).code, 'conversation_not_found');
          return true;
        },
      );
    }
  });
});

test('S08-10) ⭐⭐⭐ رفض العمليات عند فقدان سياق الهوية', async (t) => {
  await t.test('S08-10أ) ⭐ طلب بلا هوية ⇒ رفض (والافتراضي = المنع)', () => {
    const { registry, sources } = identityWorld();
    const decision = authorizeLocalRequest(
      { conversation_ref: REF_A, operation: 'conversation.read' } as LocalAuthorizationRequest,
      { registry, sources },
    );
    assert.equal(decision.allowed, false);
    if (!decision.allowed) assert.equal(decision.code, 'identity_id_invalid');
  });

  await t.test('S08-10ب) ⭐ البوّابة الفاشلة-المغلقة ترمي ⇒ لا تنفيذ', () => {
    const { registry, sources } = identityWorld();
    assert.throws(
      () =>
        requireLocalAuthorization(
          request('ident-ghost', REF_A, 'conversation.read'),
          { registry, sources },
        ),
      (error: unknown) => {
        assert.ok(error instanceof LocalAuthorizationError);
        assert.equal((error as { code: string }).code, 'identity_unknown');
        return true;
      },
    );
  });

  await t.test('S08-10ج) ⭐ طلب ناقص/مشوَّه ⇒ رفض', () => {
    const { registry, sources } = identityWorld();
    for (const bad of [
      null,
      { identity_id: 'ident-owner-a', conversation_ref: '!!', operation: 'conversation.read' },
      { identity_id: 'ident-owner-a', conversation_ref: REF_A, operation: 'not.an.operation' },
    ]) {
      const decision = authorizeLocalRequest(bad as LocalAuthorizationRequest, { registry, sources });
      assert.equal(decision.allowed, false, 'طلب مشوَّه قُبل');
    }
  });
});

// ============================================================
// ⭐⭐⭐ ④ التسريب وسجلّات التدقيق
// ============================================================

test('S08-11) ⭐⭐⭐ عدم تسريب بيانات أو سجلات تدقيق بين المستأجرين', async (t) => {
  await t.test('S08-11أ) ⭐ سجلّ قرارات التفويض معزول بالمستأجر', () => {
    const { registry, sources } = identityWorld();
    const readAudit = new ReadAuditLog({ now: () => NOW });
    authorizeLocalRequest(request('ident-owner-a', REF_A, 'conversation.read'), {
      registry,
      sources,
      readAudit,
    });
    authorizeLocalRequest(request('ident-owner-b', REF_B, 'conversation.read'), {
      registry,
      sources,
      readAudit,
    });
    const eventsA = readAudit.eventsFor({
      tenantId: TENANT_A,
      actorId: 'actor_local_a1',
      sessionId: 'sess_local',
      conversationRef: REF_A,
      capabilities: [],
      role: 'owner',
      issuedAt: NOW,
    });
    assert.ok(eventsA.length > 0, 'لا أحداث قراءة مسجَّلة');
    for (const event of eventsA) {
      assert.equal(event.tenant_id, TENANT_A, 'سجلّ مستأجر آخر في سجلّ القراءة');
      assert.equal(event.target, REF_A);
    }
  });

  await t.test('S08-11ب) ⭐ الطابور والمؤشرات لكل مستأجر أرقامه', () => {
    const world = coreWorld();
    seedConversations(world.layer);
    const { registry, sources } = identityWorld();
    const contextFor = (identityId: string, ref: string): TenantContext => {
      const decision = authorizeLocalRequest(request(identityId, ref, 'conversation.read'), {
        registry,
        sources,
      });
      assert.equal(decision.allowed, true);
      if (!decision.allowed) throw new Error('رفض');
      return decision.context;
    };
    const a = contextFor('ident-owner-a', REF_A);
    const b = contextFor('ident-owner-b', REF_B);
    const c = contextFor('ident-owner-c', REF_C);
    const queueA = listWorkQueue(a, world.deps, { now: NOW });
    const queueB = listWorkQueue(b, world.deps, { now: NOW });
    const queueC = listWorkQueue(c, world.deps, { now: NOW });
    assert.equal(queueA.pagination.total, 1);
    assert.equal(queueB.pagination.total, 1);
    assert.equal(queueC.pagination.total, 1);
    assert.equal(queueA.items[0].conversation_ref, REF_A);
    assert.equal(queueB.items[0].conversation_ref, REF_B);
    assert.equal(queueC.items[0].conversation_ref, REF_C);
    const metricsA = getServiceMetrics(a, world.deps, { now: NOW });
    const metricsB = getServiceMetrics(b, world.deps, { now: NOW });
    assert.equal(metricsA.conversations_total, 1);
    assert.equal(metricsB.conversations_total, 1);
    const listA = listConversations(a, world.queryDeps);
    assert.equal(listA.summaries.length, 1);
    assert.equal(listA.summaries[0].conversation_ref, REF_A);
  });

  await t.test('S08-11ج) ⭐ الإسناد لا يخرج عن نطاق المستأجر', () => {
    const world = coreWorld();
    seedConversations(world.layer);
    const { registry, sources } = identityWorld();
    const decision = authorizeLocalRequest(
      request('ident-owner-a', REF_A, 'conversation.assign'),
      { registry, sources },
    );
    assert.equal(decision.allowed, true);
    if (!decision.allowed) return;
    updateConversationState(decision.context, REF_A, 'open', world.deps, { reason: 'فتح' });
    assignConversation(decision.context, REF_A, 'actor_local_a2', world.deps, { reason: 'توزيع' });
    const stateA = getConversationState(decision.context, REF_A, world.deps);
    assert.equal(stateA.assignee_actor_id, 'actor_local_a2');
    // ⭐ موظف من مستأجر آخر ⇒ رفض (لا كشف وجود).
    assert.throws(
      () => assignConversation(decision.context, REF_A, 'actor_local_b1', world.deps),
      (error: unknown) => {
        assert.equal((error as { code: string }).code, 'assignee_not_in_tenant');
        return true;
      },
    );
    // ⭐ إلغاء الإسناد ⇒ يعمل داخل النطاق.
    unassignConversation(decision.context, REF_A, world.deps, { reason: 'إلغاء' });
  });
});

// ============================================================
// ⭐⭐⭐ ⑤ استمرار الوظائف المحلية + السلطة الإدارية + فصل المصدر عن القرار
// ============================================================

test('S08-12) ⭐⭐⭐ استمرار الوظائف المحلية المصرّح بها سابقاً', async (t) => {
  await t.test('S08-12أ) ⭐ المعاينة التفاعلية تعمل وتبديل الأدوار فعّال', async () => {
    const { createPreviewRuntime, PREVIEW_OTHER_TENANT_CONVERSATION } = await import(
      '../tools/wasl-workbench-preview-runtime.ts'
    );
    const runtime = createPreviewRuntime();
    runtime.setRole('supervisor');
    assert.ok(runtime.listQueue().length >= 5, 'المشرف لم يرَ الطابور');
    runtime.setRole('agent');
    assert.equal(runtime.listQueue().length, 1, 'الموظف رأى أكثر من محادثته');
    runtime.setRole('viewer');
    assert.equal(runtime.listQueue().length, 0, 'القارئ رأى طابوراً');
    const proof = runtime.getIsolationProof();
    assert.equal(proof.leaked_total, 0, 'تسريب في المعاينة');
    assert.equal(
      runtime.listAll().some((row) => row.conversation_ref === PREVIEW_OTHER_TENANT_CONVERSATION),
      false,
      'محادثة المستأجر الآخر ظهرت',
    );
  });

  await t.test('S08-12ب) ⭐⭐ صفر اتصال خارجي', () => {
    assert.equal(guard.installed, true);
    assert.deepEqual(guard.blocked, []);
  });
});

test('S08-13) ⭐⭐⭐ رفض العمليات الإدارية بلا أحقية (M34)', async (t) => {
  await t.test('S08-13أ) ⭐ إلغاء بلا سلطة ⇒ مرفوض', () => {
    const { registry } = identityWorld();
    assert.throws(
      () => registry.revoke('ident-agent-a', { kind: 'identity.admin', identity_id: 'ident-owner-a' } as never),
      (error: unknown) => {
        assert.equal((error as { code: string }).code, 'admin_authority_invalid');
        return true;
      },
    );
  });

  await t.test('S08-13ب) ⭐ إلغاء صاحب السلطة ⇒ يفقد أحقيته فوراً', () => {
    const { registry, ownerAuthority } = identityWorld();
    // ⭐ يُلغى صاحب السلطة (لأن هنالك مالكين آخرين مُسجَّلين).
    assert.equal(registry.revoke('ident-owner-a', ownerAuthority), true);
    // ⭐⇒⇒ فالسلطة نفسها لم تعد صالحة (⇦ المصدر untrusted بعد الإلغاء).
    assert.throws(
      () => registry.list(ownerAuthority),
      (error: unknown) => {
        assert.equal((error as { code: string }).code, 'admin_revoked');
        return true;
      },
    );
  });

  await t.test('S08-13ج) ⭐ لا إلغاء المالك الأخير الفعّال', () => {
    const registry = new LocalIdentityRegistry({ now: () => NOW });
    const authority = issueIdentityAdminAuthority({
      ...seed('ident-solo-owner', TENANT_A, 'actor_local_a1', 'owner'),
      status: 'active',
      expires_at: null,
    });
    registry.register(seed('ident-solo-owner', TENANT_A, 'actor_local_a1', 'owner'), authority);
    assert.throws(
      () => registry.revoke('ident-solo-owner', authority),
      (error: unknown) => {
        assert.equal((error as { code: string }).code, 'cannot_revoke_last_owner');
        return true;
      },
    );
  });

  await t.test('S08-13د) ⭐ قائمة الهويات ⇒ تحتاج سلطة إدارية', () => {
    const { registry } = identityWorld();
    assert.throws(
      () => registry.list({ kind: 'identity.admin', identity_id: 'ident-owner-a' } as never),
      (error: unknown) => {
        assert.equal((error as { code: string }).code, 'admin_authority_invalid');
        return true;
      },
    );
  });
});

test('S08-14) ⭐⭐⭐ فصل مصدر الهوية عن قرار السماح (M34)', async (t) => {
  await t.test('S08-14أ) ⭐ الدور في السياق من السجلّ لا من مدخل الطلب', () => {
    const { registry, sources } = identityWorld();
    const decision = authorizeLocalRequest(
      request('ident-agent-a', REF_A, 'conversation.read', {
        role: 'owner',
        tenant_id: TENANT_B,
        capabilities: ['conversation.assign'],
      }),
      { registry, sources },
    );
    assert.equal(decision.allowed, true);
    if (!decision.allowed) return;
    assert.equal(decision.context.role, 'agent');
    assert.equal(decision.context.tenantId, TENANT_A);
    assert.equal(decision.context.actorId, 'actor_local_a3');
    assert.equal(decision.context.capabilities.includes('conversation.assign'), false);
  });

  await t.test('S08-14ب) ⭐ عملية بلا صلاحية ⇒ رفض (والرفض = المنع)', () => {
    const { registry, sources } = identityWorld();
    const decision = authorizeLocalRequest(
      request('ident-agent-a', REF_A, 'conversation.metrics.read'),
      { registry, sources },
    );
    assert.equal(decision.allowed, false);
    if (!decision.allowed) assert.equal(decision.code, 'capability_missing');
  });
});

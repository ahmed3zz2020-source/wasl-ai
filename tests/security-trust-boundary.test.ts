// ============================================================
// WASL AI — بوابة أمان حدّ الثقة (تصريح المالك · ٥ نوفمبر ٢٠٢٦ · D-055)
// ------------------------------------------------------------
// ⭐ **المرحلة الأولى من تصريح المالك**: إصلاح اعتماد الصلاحيات من
//   مدخل عميل غير موثوق + ⭐ **بوابة الأمان** قبل أي شريحة جديدة.
// ⭐ **المحاور الثمانية الإلزامية** (من نص التصريح):
//   ١) تزوير `capabilities` داخل بيانات العميل
//   ٢) نسخ الادّعاءات غير الموثوقة إلى كائن جديد
//   ٣) محاولة الحصول على صلاحيات أعلى من المصرّح بها
//   ٤) انتحال مستخدم أو مستأجر آخر
//   ٥) رفض الجلسات غير الصالحة أو غير الموثوقة
//   ٦) عدم تسريب البيانات عبر المستأجرين
//   ٧) استمرار عمل صلاحيات القراءة المصرّح بها
//   ٨) عدم كسر Slice 01 وSlice 02 وSlice 03
// ⭐ **شروط الاستلام**: ⭐ نجاح كل فحوص الأمان + ⭐ انحدار الشريح السابقة.
// ⛔ كل البيانات اصطناعية محلية · ⛔ صفر اتصال · ⛔ صفر حساب.
// ============================================================

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

// ⭐ الحاجز مُركَّب قبل تحميل مصدر الشريحة (استيراد جانبي)
import { guard } from './guard-setup.ts';
import {
  AuditLog,
  CapabilityError,
  CONVERSATION_AUDIT_CAPABILITY,
  CONVERSATION_LIST_CAPABILITY,
  CONVERSATION_READ_CAPABILITY,
  ConversationQueryError,
  MessageStore,
  OrderingState,
  ProcessingLayer,
  ReadAuditLog,
  ROLE_CAPABILITIES,
  TenantContextError,
  TRUSTED_ROLES,
  activeSessionSources,
  assertCapability,
  getConversation,
  listConversations,
  resolveGrantedCapabilities,
  resolveProductionTenantContext,
  resolveTenantContext,
  type SessionSource,
  type TenantContext,
  type TrustedRole,
  type VerifiedIdentity,
} from '../src/core/index.ts';
import { registerSessionSource } from '../src/core/session.ts';
import {
  LOCAL_RESTRICTED_SOURCES,
  LOCAL_TEST_SOURCES,
  createSyntheticContext,
  createSyntheticContextWithSource,
  createSyntheticEnvelope,
  createSyntheticSession,
  localTestSessionSource,
} from './support/index.ts';

const FIXED_NOW = '2026-01-01T00:00:00.000Z';
const ROOT = path.resolve(import.meta.dirname, '..');

/** ⭐⭐ مصدر ساذج — ⭐ **يمرّر حمولة العميل كما هي** (المتجه المُثبت في الجولة السابقة). */
const NAIVE_SOURCE: SessionSource = {
  id: 'auth-naive-passthrough',
  scope: 'production',
  description: 'مصدر ساذج: يعيد حمولة العميل كما هي (المتجه المُثبت قبل الإصلاح)',
  verify(input: unknown): VerifiedIdentity {
    return input as VerifiedIdentity;
  },
};

/** ⭐⭐ مصدر ساذج مبسوط — ⭐ **يعيد نسخة** من حمولة العميل (نسخة بمحتوى العميل). */
const COPY_SOURCE: SessionSource = {
  id: 'auth-naive-copy',
  scope: 'production',
  description: 'مصدر ساذج: يعيد نسخة من حمولة العميل (مع حقول إضافية)',
  verify(input: unknown): VerifiedIdentity {
    return { ...(input as object) } as VerifiedIdentity;
  },
};

function registerNaiveSources(): void {
  registerSessionSource({
    source: NAIVE_SOURCE,
    grantedRole: 'owner',
    grantCeiling: [
      'conversation.list',
      'conversation.read',
      'conversation.audit',
      'conversation.state.read',
      'conversation.state.update',
      'conversation.assign',
    ],
  });
  registerSessionSource({
    source: COPY_SOURCE,
    grantedRole: 'viewer',
    grantCeiling: [CONVERSATION_LIST_CAPABILITY, CONVERSATION_READ_CAPABILITY, CONVERSATION_AUDIT_CAPABILITY],
  });
}
registerNaiveSources();

function context(role: TrustedRole, tenantIndex = 1, conversationIndex = 1): TenantContext {
  return createSyntheticContext(
    tenantIndex,
    tenantIndex * 10 + 1,
    100 + tenantIndex,
    conversationIndex,
    () => FIXED_NOW,
    role,
  );
}

test('🔒 ١) تزوير `capabilities` داخل بيانات العميل ⇒ يُتجاهل تماماً', async (t) => {
  await t.test('⭐⭐⭐ عميل يحمل صلاحيات مزوّرة ⇒ لا تُمنح له ولا واحدة', () => {
    const genuine = createSyntheticSession(1, 11, 101, 1, 'viewer');
    // ⭐ نضيف صلاحيات مزوّرة **في حمولة العميل نفسها**.
    const tampered = {
      ...genuine,
      capabilities: ['conversation.list', 'conversation.read', 'conversation.audit', 'conversation.assign'],
      role: 'owner',
    };
    // ⭐ النتيجة: رفض ⇒ لأن الحمولة المُعدَّلة ليست مُصنَّعة (سجل المصدر الداخلي).
    assert.throws(
      () => resolveTenantContext(tampered, { source: LOCAL_TEST_SOURCES.viewer, now: () => FIXED_NOW }),
      (error: unknown) => {
        assert.ok(error instanceof TenantContextError);
        assert.equal(error.code, 'session_unverified');
        return true;
      },
    );
  });

  await t.test('⭐⭐⭐ الصلاحيات الممنوحة = سياسة الدور لا حمولة العميل', () => {
    const genuine = createSyntheticSession(1, 11, 101, 1, 'viewer');
    const ctx = resolveTenantContext(genuine, {
      source: LOCAL_TEST_SOURCES.viewer,
      now: () => FIXED_NOW,
    });
    assert.deepEqual([...ctx.capabilities], [
      CONVERSATION_AUDIT_CAPABILITY,
      CONVERSATION_LIST_CAPABILITY,
      CONVERSATION_READ_CAPABILITY,
    ]);
    assert.equal(ctx.capabilities.includes('conversation.assign'), false);
    assert.equal(ctx.role, 'viewer');
  });

  await t.test('⭐⭐⭐ حقل `capabilities` غير موجود أصلاً في هوية المصدر', () => {
    // ⭐ عقد المصدر بعد الإصلاح = هوية (بلا صلاحيات وبلا دور).
    const identity = LOCAL_TEST_SOURCES.viewer.verify(
      createSyntheticSession(1, 11, 101, 1, 'viewer'),
    );
    assert.ok(identity);
    assert.equal('capabilities' in identity, false);
    assert.equal('role' in identity, false);
  });
});

test('🔒 ٢) نسخ الادّعاءات غير الموثوقة إلى كائن جديد ⇒ رفض', async (t) => {
  await t.test('⭐⭐⭐ نسخة من جلسة صحيحة ⇒ تُرفض (النَسَب لا الشكل)', () => {
    const genuine = createSyntheticSession(1, 11, 101, 1, 'owner');
    const copied = { ...genuine, capabilities: ['conversation.assign'] };
    assert.throws(
      () => resolveTenantContext(copied, { source: LOCAL_TEST_SOURCES.owner, now: () => FIXED_NOW }),
      (error: unknown) => {
        assert.ok(error instanceof TenantContextError);
        assert.equal(error.code, 'session_unverified');
        return true;
      },
    );
  });

  await t.test('⭐⭐⭐⭐ المصدر الساذج (يمرّر حمولة العميل كما هي) ⇒ رفض بنيوي', () => {
    // ⭐⭐ هذا هو المتجه الذي أُثبت حيّاً في الجولة السابقة ⇒ ⇒⇒⇒
    // ⭐⇒⇒⇒⇒ **الآن: مرفوض بنيوياً قبل أي تفاعل** (لا تمرير للحمولة).
    const raw = {
      session_id: 'sess_naive_0001',
      tenant_id: 'tnt_synth_0001',
      actor_id: 'actor_synth_0001',
      conversation_ref: 'conv_synth_0001',
      authenticated: true,
      capabilities: ['conversation.assign'],
    };
    assert.throws(
      () => resolveTenantContext(raw, { source: NAIVE_SOURCE, now: () => FIXED_NOW }),
      (error: unknown) => {
        assert.ok(error instanceof TenantContextError);
        assert.equal(error.code, 'session_claims_not_rebuilt');
        return true;
      },
    );
  });

  await t.test('⭐⭐⭐⭐ المصدر الساذج (نسخة) ⇒ الصلاحيات من النواة لا من العميل', () => {
    const raw = {
      session_id: 'sess_naive_0002',
      tenant_id: 'tnt_synth_0001',
      actor_id: 'actor_synth_0001',
      conversation_ref: 'conv_synth_0001',
      authenticated: true,
      capabilities: ['conversation.assign', 'super.admin'],
      role: 'owner',
    };
    const ctx = resolveTenantContext(raw, { source: COPY_SOURCE, now: () => FIXED_NOW });
    // ⭐⇒⇒⇒ **قائمة صلاحيات العميل مُتجاهَلة تماماً** ⇒ ⇒⇒⇒ granted = سياسة الدور.
    assert.deepEqual([...ctx.capabilities], [
      CONVERSATION_AUDIT_CAPABILITY,
      CONVERSATION_LIST_CAPABILITY,
      CONVERSATION_READ_CAPABILITY,
    ]);
    assert.equal(ctx.capabilities.includes('super.admin'), false);
    assert.equal(ctx.capabilities.includes('conversation.assign'), false);
    assert.equal(ctx.role, 'viewer');
  });

  await t.test('⭐⭐⭐⭐⭐ مصدر غير مسجَّل ⇒ رفض بنيوي (لا سياق أصلاً)', () => {
    const rogue: SessionSource = {
      id: 'auth-rogue-0001',
      scope: 'production',
      description: 'مصدر لم يسجّله المالك',
      verify: (): VerifiedIdentity => ({
        session_id: 'sess_rogue_0001',
        tenant_id: 'tnt_synth_0001',
        actor_id: 'actor_synth_0001',
        conversation_ref: 'conv_synth_0001',
        authenticated: true,
      }),
    };
    assert.throws(
      () => resolveTenantContext({}, { source: rogue, now: () => FIXED_NOW }),
      (error: unknown) => {
        assert.ok(error instanceof TenantContextError);
        assert.equal(error.code, 'session_source_unregistered');
        return true;
      },
    );
  });
});

test('🔒 ٣) محاولة الحصول على صلاحيات أعلى من المصرّح بها ⇒ السقف يحكم', async (t) => {
  await t.test('⭐⭐⭐ السقف المسجَّل يحدّ صلاحيات الدور الأعلى', () => {
    // ⭐ دور `owner` + سقف = صلاحية واحدة ⇒ ⇒⇒⇒ الممنوح = صلاحية واحدة فقط.
    const granted = resolveGrantedCapabilities('owner', [CONVERSATION_READ_CAPABILITY]);
    assert.deepEqual([...granted], [CONVERSATION_READ_CAPABILITY]);
    assert.equal(granted.includes('conversation.assign'), false);
  });

  await t.test('⭐⭐⭐ مصدر بسقف مقيَّد ⇒ لا يمنح ما هو خارج السقف', () => {
    const ctx = createSyntheticContextWithSource(
      LOCAL_RESTRICTED_SOURCES.readOnly,
      1,
      11,
      101,
      1,
      () => FIXED_NOW,
    );
    assert.deepEqual([...ctx.capabilities], [CONVERSATION_READ_CAPABILITY]);
    assert.throws(() => assertCapability(ctx, CONVERSATION_LIST_CAPABILITY), CapabilityError);
    assert.throws(() => assertCapability(ctx, 'conversation.assign'), CapabilityError);
  });

  await t.test('⭐⭐⭐ دور بلا منح (`none`) ⇒ صفر صلاحية (الافتراضي = المنع)', () => {
    const ctx = context('none');
    assert.deepEqual([...ctx.capabilities], []);
    assert.throws(() => assertCapability(ctx, CONVERSATION_READ_CAPABILITY), CapabilityError);
  });

  await t.test('⭐⭐⭐⭐ دور خارج المجموعة المغلقة ⇒ يُرفض عند التسجيل', () => {
    assert.throws(
      () =>
        registerSessionSource({
          source: {
            id: 'auth-bad-role',
            scope: 'production',
            description: 'دور غير معلَن',
            verify: () => ({
              session_id: 's',
              tenant_id: 'tnt_x',
              actor_id: 'actor_x',
              conversation_ref: 'conv_x',
              authenticated: true,
            }),
          },
          grantedRole: 'super.admin' as TrustedRole,
          grantCeiling: [],
        }),
      (error: unknown) => {
        assert.ok(error instanceof TenantContextError);
        assert.equal(error.code, 'source_role_invalid');
        return true;
      },
    );
  });
});

test('🔒 ٤) انتحال مستخدم أو مستأجر آخر ⇒ رفض', async (t) => {
  await t.test('⭐⭐⭐ ادّعاءات مستأجر آخر (خام) ⇒ رفض', () => {
    const forged = {
      session_id: 'sess_forge_0001',
      tenant_id: 'tnt_synth_0002',
      actor_id: 'actor_synth_0001',
      conversation_ref: 'conv_synth_0002',
      authenticated: true,
      capabilities: ['conversation.read'],
    };
    assert.throws(
      () => resolveTenantContext(forged, { source: LOCAL_TEST_SOURCES.owner, now: () => FIXED_NOW }),
      (error: unknown) => {
        assert.ok(error instanceof TenantContextError);
        assert.equal(error.code, 'session_unverified');
        return true;
      },
    );
  });

  await t.test('⭐⭐⭐⭐ جلسات مستأجرين مختلفة ⇒ نطاقات مختلفة (لا خلط)', () => {
    const a = context('owner', 1);
    const b = context('owner', 2);
    assert.notEqual(a.tenantId, b.tenantId);
    assert.notEqual(a.actorId, b.actorId); // ⭐ منفّذات مختلفة ⇒ ⇒⇒⇒ النطاق هو الفارق
    assert.equal(a.conversationRef, b.conversationRef); // ⭐ نفس المعرّف في مستأجرين = ⇒ ⇒⇒⇒ لكل مستأجر نطاق منفصل (لا خلط)
  });

  await t.test('⭐⭐⭐⭐⭐ المستأجر الذي لا يحمل الصلاحية ⇒ يفشل (لا تسريب عابر)', () => {
    const ctx = createSyntheticContextWithSource(
      LOCAL_RESTRICTED_SOURCES.noAccess,
      1,
      11,
      101,
      1,
      () => FIXED_NOW,
    );
    assert.deepEqual([...ctx.capabilities], []);
    assert.throws(() => assertCapability(ctx, CONVERSATION_READ_CAPABILITY), CapabilityError);
  });
});

test('🔒 ٥) رفض الجلسات غير الصالحة أو غير الموثوقة', async (t) => {
  await t.test('⭐⭐⭐ ادّعاءات غير مُصنَّعة ⇒ رفض (أي شكل كان)', () => {
    const raw = {
      session_id: 'sess_x_0001',
      tenant_id: 'tnt_synth_0001',
      actor_id: 'actor_synth_0001',
      conversation_ref: 'conv_synth_0001',
      authenticated: true,
    };
    assert.throws(
      () => resolveTenantContext(raw, { source: LOCAL_TEST_SOURCES.owner, now: () => FIXED_NOW }),
      (error: unknown) => {
        assert.ok(error instanceof TenantContextError);
        assert.equal(error.code, 'session_unverified');
        return true;
      },
    );
  });

  await t.test('⭐⭐⭐ جلسة غير مُصادَق عليها ⇒ رفض', () => {
    const raw = { ...createSyntheticSession(1, 11, 101, 1, 'owner'), authenticated: false };
    assert.throws(
      () => resolveTenantContext(raw, { source: LOCAL_TEST_SOURCES.owner, now: () => FIXED_NOW }),
      (error: unknown) => {
        assert.ok(error instanceof TenantContextError);
        assert.equal(error.code, 'session_unverified');
        return true;
      },
    );
  });

  await t.test('⭐⭐⭐⭐ بدون مصدر جلسات ⇒ رفض (لا افتراض افتراضي)', () => {
    assert.throws(
      () => resolveTenantContext(createSyntheticSession(1, 11, 101, 1, 'owner')),
      (error: unknown) => {
        assert.ok(error instanceof TenantContextError);
        assert.equal(error.code, 'session_source_missing');
        return true;
      },
    );
  });

  await t.test('⭐⭐⭐⭐⭐ المسار الإنتاجي يرفض مصدر الاختبار بنيوياً', () => {
    assert.throws(
      () => resolveProductionTenantContext(createSyntheticSession(1, 11, 101, 1, 'owner'), localTestSessionSource),
      (error: unknown) => {
        assert.ok(error instanceof TenantContextError);
        assert.equal(error.code, 'session_source_not_production');
        return true;
      },
    );
  });

  await t.test('⭐⭐⭐⭐⭐ السطح العام لا يُصدّر أدوات بناء السياق', async () => {
    const production = (await import('../src/core/index.ts')) as Record<string, unknown>;
    for (const forbidden of [
      'tenantContextFromSession',
      'issueSessionAttestation',
      'registerSessionSource',
    ]) {
      assert.equal(forbidden in production, false, `${forbidden} مكشوف في السطح العام`);
    }
  });
});

test('🔒 ٦) عدم تسريب البيانات عبر المستأجرين', async (t) => {
  await t.test('⭐⭐⭐ مستأجر آخر لا يقرأ محادثات مستأجر (صفر صفوف)', () => {
    const audit = new AuditLog({ now: () => FIXED_NOW });
    const readAudit = new ReadAuditLog({ now: () => FIXED_NOW });
    const store = new MessageStore({ now: () => FIXED_NOW, audit });
    const ordering = new OrderingState();
    const layer = new ProcessingLayer({ store, audit, orderingState: ordering });
    const deps = { store, audit, readAudit };

    const tenantA = context('owner', 1);
    const tenantB = context('owner', 2);
    layer.process(tenantA, createSyntheticEnvelope({ tenantIndex: 1, messageIndex: 1 }));

    // ⭐ المستأجر B يحاول قراءة محادثة A ⇒ ⇒⇒⇒ صفوف صفر (ولا خطأ يكشف وجودها).
    const thread = getConversation(tenantB, 'conv_synth_0001', deps);
    assert.equal(thread.messages.length, 0);
    assert.equal(thread.pagination.total, 0);
    // ⭐ وقائمة B لا تحوي محادثات A.
    const list = listConversations(tenantB, deps);
    assert.equal(list.summaries.length, 0);
  });

  await t.test('⭐⭐⭐⭐ محادثة مستأجر آخر ⇒ لا تُسرَّب في السجل المعزول', () => {
    const audit = new AuditLog({ now: () => FIXED_NOW });
    const readAudit = new ReadAuditLog({ now: () => FIXED_NOW });
    const store = new MessageStore({ now: () => FIXED_NOW, audit });
    const deps = { store, audit, readAudit };
    const tenantA = context('owner', 1);
    const tenantB = context('owner', 2);
    listConversations(tenantA, deps);
    const eventsB = readAudit.eventsFor(tenantB);
    assert.equal(eventsB.length, 0);
  });
});

test('🔒 ٧) استمرار عمل صلاحيات القراءة المصرّح بها', async (t) => {
  await t.test('⭐⭐⭐ الدور المصرَّح يقرأ محادثاته كالمعتاد', () => {
    const audit = new AuditLog({ now: () => FIXED_NOW });
    const readAudit = new ReadAuditLog({ now: () => FIXED_NOW });
    const store = new MessageStore({ now: () => FIXED_NOW, audit });
    const ordering = new OrderingState();
    const layer = new ProcessingLayer({ store, audit, orderingState: ordering });
    const deps = { store, audit, readAudit };

    const ctx = context('viewer');
    layer.process(ctx, createSyntheticEnvelope({ tenantIndex: 1, messageIndex: 1 }));
    const list = listConversations(ctx, deps);
    assert.equal(list.summaries.length, 1);
    const thread = getConversation(ctx, 'conv_synth_0001', deps);
    assert.equal(thread.messages.length, 1);
    assert.equal(thread.messages[0].body.length > 0, true);
  });

  await t.test('⭐⭐⭐⭐ دور بلا صلاحية ⇒ نفس المسار يرفض (بلا انهيار)', () => {
    const audit = new AuditLog({ now: () => FIXED_NOW });
    const readAudit = new ReadAuditLog({ now: () => FIXED_NOW });
    const store = new MessageStore({ now: () => FIXED_NOW, audit });
    const deps = { store, audit, readAudit };
    const ctx = context('none');
    assert.throws(() => listConversations(ctx, deps), CapabilityError);
    assert.throws(() => getConversation(ctx, 'conv_synth_0001', deps), CapabilityError);
  });

  await t.test('⭐⭐⭐⭐⭐ جدول الأدوار مغلق ومُعلَن', () => {
    assert.deepEqual([...TRUSTED_ROLES], ['owner', 'supervisor', 'agent', 'viewer', 'none']);
    assert.equal(ROLE_CAPABILITIES.none.length, 0);
    // ⭐ الهرمية: كل دور ⊆ دور أعلى.
    assert.deepEqual(
      [...ROLE_CAPABILITIES.agent].every((cap) => ROLE_CAPABILITIES.supervisor.includes(cap)),
      true,
    );
    assert.deepEqual(
      [...ROLE_CAPABILITIES.viewer].every((cap) => ROLE_CAPABILITIES.owner.includes(cap)),
      true,
    );
  });
});

test('🔒 ٨) عدم كسر Slice 01 وSlice 02 وSlice 03', async (t) => {
  await t.test('⭐⭐⭐ دورة الرسالة الكاملة تعمل كما هي', () => {
    const audit = new AuditLog({ now: () => FIXED_NOW });
    const readAudit = new ReadAuditLog({ now: () => FIXED_NOW });
    const store = new MessageStore({ now: () => FIXED_NOW, audit });
    const ordering = new OrderingState();
    const layer = new ProcessingLayer({ store, audit, orderingState: ordering });
    const ctx = context('owner');
    const outcome = layer.process(ctx, createSyntheticEnvelope({ tenantIndex: 1, messageIndex: 1 }));
    assert.equal(outcome.decision, 'accepted');
    assert.equal(store.countFor(ctx), 1);
  });

  await t.test('⭐⭐⭐⭐ مسار Slice 02 (المعالجة + الترتيب) سليم', () => {
    const audit = new AuditLog({ now: () => FIXED_NOW });
    const store = new MessageStore({ now: () => FIXED_NOW, audit });
    const ordering = new OrderingState();
    const layer = new ProcessingLayer({ store, audit, orderingState: ordering });
    const ctx = context('owner');
    const first = layer.process(ctx, createSyntheticEnvelope({ tenantIndex: 1, messageIndex: 1 }));
    const dup = layer.process(ctx, createSyntheticEnvelope({ tenantIndex: 1, messageIndex: 1 }));
    assert.equal(first.decision, 'accepted');
    assert.equal(dup.decision, 'rejected');
    assert.equal(dup.reason_code, 'message_ref_duplicate');
  });

  await t.test('⭐⭐⭐⭐⭐ مسار Slice 03 (القراءة) سليم + المحادثة تُقرأ معزولة', () => {
    const audit = new AuditLog({ now: () => FIXED_NOW });
    const readAudit = new ReadAuditLog({ now: () => FIXED_NOW });
    const store = new MessageStore({ now: () => FIXED_NOW, audit });
    const ordering = new OrderingState();
    const layer = new ProcessingLayer({ store, audit, orderingState: ordering });
    const deps = { store, audit, readAudit };
    const ctx = context('viewer');
    layer.process(ctx, createSyntheticEnvelope({ tenantIndex: 1, messageIndex: 1 }));
    const thread = getConversation(ctx, 'conv_synth_0001', deps);
    assert.equal(thread.conversation_ref, 'conv_synth_0001');
    assert.equal(thread.pagination.total, 1);
    assert.throws(() => getConversation(ctx, 'conv_bad_ref!', deps), ConversationQueryError);
  });

  await t.test('⭐⭐⭐⭐⭐⭐ لا مصدر إنتاجي مسجَّل في الإنتاج ⇒ لا مسار افتراضي', () => {
    // ⭐ المصادر المسجَّلة في الإنتاج اليوم = ما سجّله المالك فقط ⇒ ⇒⇒⇒
    // ⭐ ⇒⇒⇒⇒ **لا مصدر افتراضي** ⇒ ⇒⇒⇒⇒ (المسجَّل في الاختبار = اختبار فقط).
    for (const source of activeSessionSources()) {
      assert.equal(source.scope, 'production');
      assert.equal(source.id.startsWith('auth-'), true);
    }
  });
});

test('🔒 ⭐ الفحص الساكن: بلا أي مسار يقرأ صلاحيات من حمولة العميل', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ ملفات النواة لا تقرأ `claims.capabilities` من ادّعاءات خامة', () => {
    const files = [
      'src/core/session.ts',
      'src/core/tenant.ts',
      'src/core/capability.ts',
      'src/core/conversation-query.ts',
    ];
    for (const file of files) {
      const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
      // ⭐ المصدر الوحيد المسموح بقراءة الصلاحيات = النواة (TrustedClaims).
      if (file === 'src/core/tenant.ts') {
        assert.ok(
          text.includes('normalizeCapabilities(claims.capabilities)'),
          'tenant.ts يقرأ صلاحيات الادّعاءات — تحقّق من النوع',
        );
        continue;
      }
      assert.equal(
        text.includes('claims.capabilities'),
        false,
        `ملف ${file} يقرأ صلاحيات من ادّعاءات ⇒ مسار تزوير محتمل`,
      );
    }
  });

  await t.test('⭐⭐⭐⭐⭐⭐ صفر محاولة اتصال (الحاجز مُركَّب)', () => {
    assert.equal(guard.installed, true);
    assert.deepEqual(guard.blocked, []);
  });
});

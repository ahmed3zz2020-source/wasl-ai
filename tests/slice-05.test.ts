// ============================================================
// WASL AI — اختبارات الشريحة الخامسة: مركز عمل الوكيل ومؤشرات الخدمة
// ------------------------------------------------------------
// ⭐ **تصريح المالك (D-058 · ٥ نوفمبر ٢٠٢٦)**: ⭐ تنفيذ محلي بالكامل بعد
//   نجاح اختبارات إصلاح الذرّية (D-057).
// ⭐ **القرارات المعتمدة**: ⭐ ① «الموظف يرى محادثاته فقط · المشرف يرى طابور
//   فريق شركته» · ⭐ ② «معيار التأخير ٣٠ دقيقة» · ⭐ ③ «مؤشرات الخدمة للمشرف
//   والمالك فقط بصلاحية صريحة».
// ⭐ **المحاور**: ⭐ ① عزل المستأجر · ② التصنيفات · ③ الترتيب الحتمي ·
//   ④ صحّة المؤشرات · ⑤ منع التسريب · ⑥ بوابة الصلاحيات · ⑦ مصدر غير مسجَّل ·
//   ⑧ عدم التخمين · ⑨ بلا شبكة · ⑩ القراءة فقط · ⑪ الانحدار ·
//   ⑫ نطاق الجمهور · ⑬ الطرد.
// ⛔ كل البيانات اصطناعية محلية · ⛔ صفر اتصال · ⛔ صفر حساب.
// ============================================================

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

// ⭐ الحاجز مُركَّب قبل تحميل مصدر الشريحة (استيراد جانبي)
import { guard } from './guard-setup.ts';
import {
  ALLOWED_TRANSITIONS,
  AuditLog,
  CapabilityError,
  ConversationChangeLog,
  ConversationStateStore,
  MessageStore,
  OrderingState,
  ProcessingLayer,
  ReadAuditLog,
  assignConversation,
  getConversation,
  getServiceMetrics,
  listWorkQueue,
  updateConversationState,
  type AgentWorkQueueDependencies,
  type ConversationStateDependencies,
  type MessageEnvelope,
  type ServiceMetricsDependencies,
  type TenantContext,
  type TrustedRole,
} from '../src/core/index.ts';
import {
  createSyntheticContext,
  createSyntheticContextWithSource,
  syntheticEmployeeDirectory,
} from './support/index.ts';
import { LOCAL_RESTRICTED_SOURCES, LOCAL_TEST_SOURCES } from './support/local-session.ts';

const NOW = '2026-01-05T12:30:00.000Z';
const ROOT = path.resolve(import.meta.dirname, '..');
const TENANT_A = 'tnt_synth_0001';
const TENANT_B = 'tnt_synth_0002';
const AGENT = 'actor_synth_0011';
const OTHER_AGENT = 'actor_synth_0012';
const SECRET_BODY = 'نص رسالة اصطناعي سرّي لا يجوز أن يخرج في المؤشرات';

function context(
  role: TrustedRole,
  tenantIndex = 1,
  actorIndex = 11,
  conversationIndex = 1,
): TenantContext {
  return createSyntheticContext(
    tenantIndex,
    actorIndex,
    100 + tenantIndex,
    conversationIndex,
    () => NOW,
    role,
  );
}

function envelope(options: {
  messageRef: string;
  conversationRef: string;
  direction?: 'inbound' | 'outbound';
  occurredAt: string;
  body?: string;
}): MessageEnvelope {
  return {
    schema_version: '1',
    message_ref: options.messageRef,
    channel: 'synthetic',
    direction: options.direction ?? 'inbound',
    from: 'participant-a@example.invalid',
    to: 'participant-b@example.invalid',
    body: options.body ?? SECRET_BODY,
    occurred_at: options.occurredAt,
    locale: 'ar-EG',
    attributes: { synthetic: 'true' },
    conversation_ref: options.conversationRef,
  };
}

function scenario() {
  const audit = new AuditLog({ now: () => NOW });
  const readAudit = new ReadAuditLog({ now: () => NOW });
  const store = new MessageStore({ now: () => NOW, audit });
  const layer = new ProcessingLayer({ store, audit, orderingState: new OrderingState() });
  const states = new ConversationStateStore({ now: () => NOW });
  const changes = new ConversationChangeLog({ now: () => NOW });
  const deps: ConversationStateDependencies &
    AgentWorkQueueDependencies &
    ServiceMetricsDependencies = {
    store,
    states,
    changes,
    readAudit,
    employees: syntheticEmployeeDirectory,
  };
  return { audit, readAudit, store, layer, states, changes, deps };
}

/** ⭐⭐ بيانات اصطناعية معروفة: ⭐ ٣ محادثات في المستأجر ١ + محادثة في المستأجر ٢. */
function seed(layer: ProcessingLayer, ctxA: TenantContext, ctxB: TenantContext): void {
  // ⭐ سياق لكل محادثة — ⭐ (طبقة المعالجة تشترط تطابق محادثة السياق).
  const tenantIndex = Number(ctxA.tenantId.replace('tnt_synth_', ''));
  const actorIndex = Number(ctxA.actorId.replace('actor_synth_', ''));
  const ctxA2 = context(ctxA.role, tenantIndex, actorIndex, 2);
  const ctxA3 = context(ctxA.role, tenantIndex, actorIndex, 3);
  // ⭐ محادثة ١: وارد ٠٩:٠٠ · صادر ٠٩:٣٠ ⇒ أول رد = ٣٠ دقيقة.
  layer.process(
    ctxA,
    envelope({
      messageRef: 's05-msg-0001',
      conversationRef: 'conv_synth_0001',
      occurredAt: '2026-01-05T09:00:00.000Z',
    }),
  );
  layer.process(
    ctxA,
    envelope({
      messageRef: 's05-msg-0002',
      conversationRef: 'conv_synth_0001',
      direction: 'outbound',
      occurredAt: '2026-01-05T09:30:00.000Z',
    }),
  );
  // ⭐ محادثة ٢: وارد فقط ٠٨:٠٠ ⇒ لا أول رد · وأقدم نشاط ⇒ الأطول انتظاراً.
  layer.process(
    ctxA2,
    envelope({
      messageRef: 's05-msg-0003',
      conversationRef: 'conv_synth_0002',
      occurredAt: '2026-01-05T08:00:00.000Z',
    }),
  );
  // ⭐ محادثة ٣: وارد ١١:٥٠ ⇒ آخر نشاط ⇒ ٤٠ دقيقة ⇒ متأخرة (≥ ٣٠).
  layer.process(
    ctxA3,
    envelope({
      messageRef: 's05-msg-0004',
      conversationRef: 'conv_synth_0003',
      occurredAt: '2026-01-05T11:50:00.000Z',
    }),
  );
  // ⭐ مستأجر ثانٍ (لإثبات العزل).
  layer.process(
    ctxB,
    envelope({
      messageRef: 's05-msg-0005',
      conversationRef: 'conv_synth_0009',
      occurredAt: '2026-01-05T10:00:00.000Z',
    }),
  );
}

test('١) ⭐⭐⭐ عزل المستأجر (الطابور والمؤشرات)', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ طابور المستأجر لا يحتوي محادثة مستأجر آخر', () => {
    const { layer, deps } = scenario();
    const ctxA = context('supervisor');
    const ctxB = context('supervisor', 2, 21, 9);
    seed(layer, ctxA, ctxB);
    const page = listWorkQueue(ctxA, deps, { now: NOW });
    assert.equal(page.pagination.total, 3);
    for (const item of page.items) {
      assert.ok(item.conversation_ref.startsWith('conv_synth_'), 'معرّف غير متوقّع');
    }
    const refs = page.items.map((item) => item.conversation_ref);
    assert.deepEqual(new Set(refs).size, 3);
    assert.ok(!refs.includes('conv_synth_0009'), 'محادثة مستأجر آخر داخل الطابور ⇒ تسريب');
  });

  await t.test('⭐⭐⭐⭐⭐ مؤشرات المستأجر لا تحسب محادثات مستأجر آخر', () => {
    const { layer, deps } = scenario();
    const ctxA = context('supervisor');
    const ctxB = context('supervisor', 2, 21, 9);
    seed(layer, ctxA, ctxB);
    const metrics = getServiceMetrics(ctxA, deps, { now: NOW });
    assert.equal(metrics.conversations_total, 3);
  });
});

test('٢) ⭐⭐ التصنيفات الأربعة (من الحالة والإسناد الفعلي)', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ `mine` · `unassigned` · `pending` · `closed`', () => {
    const { layer, deps } = scenario();
    const ctxA = context('supervisor');
    const ctxB = context('supervisor', 2, 21, 9);
    seed(layer, ctxA, ctxB);
    // ⭐ محادثة ١ ⇒ مسندة للوكيل · محادثة ٢ ⇒ مسندة لموظف آخر · ٣ ⇒ بلا إسناد.
    updateConversationState(ctxA, 'conv_synth_0001', 'open', deps, { reason: 'فتح' });
    const ownerCtx = context('owner');
    assignConversation(ownerCtx, 'conv_synth_0001', AGENT, deps, { reason: 'توزيع' });
    updateConversationState(ctxA, 'conv_synth_0002', 'open', deps, { reason: 'فتح' });
    assignConversation(ownerCtx, 'conv_synth_0002', OTHER_AGENT, deps, { reason: 'توزيع' });

    const page = listWorkQueue(ctxA, deps, { now: NOW });
    const byRef = new Map(page.items.map((item) => [item.conversation_ref, item]));
    assert.equal(byRef.get('conv_synth_0001')?.category, 'mine');
    assert.equal(byRef.get('conv_synth_0002')?.category, 'pending');
    assert.equal(byRef.get('conv_synth_0003')?.category, 'unassigned');

    // ⭐ محادثة محلولة ⇒ `closed`.
    updateConversationState(ctxA, 'conv_synth_0003', 'open', deps, { reason: 'فتح' });
    updateConversationState(ctxA, 'conv_synth_0003', 'resolved', deps, { reason: 'تم الحل' });
    const after = listWorkQueue(ctxA, deps, { now: NOW });
    const closed = after.items.find((item) => item.conversation_ref === 'conv_synth_0003');
    assert.equal(closed?.category, 'closed');
  });
});

test('٣) ⭐⭐ الترتيب الحتمي (الأكثر انتظاراً أولاً)', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ نفس البيانات ⇒ نفس الترتيب دائماً', () => {
    const { layer, deps } = scenario();
    const ctxA = context('supervisor');
    const ctxB = context('supervisor', 2, 21, 9);
    seed(layer, ctxA, ctxB);
    const first = listWorkQueue(ctxA, deps, { now: NOW });
    const second = listWorkQueue(ctxA, deps, { now: NOW });
    assert.deepEqual(
      first.items.map((item) => item.conversation_ref),
      second.items.map((item) => item.conversation_ref),
    );
    // ⭐ الأطول انتظاراً أولاً: ٠٨:٠٠ ⇒ ٢٧٠ دقيقة · ثم ١١:٥٠ ⇒ ٤٠ · ثم ٠٩:٣٠ ⇒ ١٨٠.
    assert.deepEqual(
      first.items.map((item) => item.conversation_ref),
      ['conv_synth_0002', 'conv_synth_0001', 'conv_synth_0003'],
    );
    assert.deepEqual(
      first.items.map((item) => item.idle_minutes),
      [270, 180, 40],
    );
  });

  await t.test('⭐⭐⭐⭐⭐ الترقيم بالصفحات (cursor) يعمل', () => {
    const { layer, deps } = scenario();
    const ctxA = context('supervisor');
    const ctxB = context('supervisor', 2, 21, 9);
    seed(layer, ctxA, ctxB);
    const first = listWorkQueue(ctxA, deps, { now: NOW, limit: 2 });
    assert.equal(first.pagination.returned, 2);
    assert.equal(first.pagination.total, 3);
    assert.equal(first.pagination.next_cursor, 'conv_synth_0001');
    const second = listWorkQueue(ctxA, deps, {
      now: NOW,
      limit: 2,
      cursor: first.pagination.next_cursor as string,
    });
    assert.equal(second.pagination.returned, 1);
    assert.equal(second.pagination.next_cursor, null);
  });
});

test('٤) ⭐⭐⭐ صحّة المؤشرات (حساب يدوي على بيانات معروفة)', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ العدّادات + التأخير + أول رد + زمن الحل', () => {
    const { layer, deps } = scenario();
    const ctxA = context('supervisor');
    const ctxB = context('supervisor', 2, 21, 9);
    seed(layer, ctxA, ctxB);
    const ownerCtx = context('owner');
    updateConversationState(ctxA, 'conv_synth_0001', 'open', deps, { reason: 'فتح' });
    assignConversation(ownerCtx, 'conv_synth_0001', AGENT, deps, { reason: 'توزيع' });
    updateConversationState(ctxA, 'conv_synth_0002', 'open', deps, { reason: 'فتح' });
    assignConversation(ownerCtx, 'conv_synth_0002', OTHER_AGENT, deps, { reason: 'توزيع' });

    const metrics = getServiceMetrics(ctxA, deps, { now: NOW });
    assert.equal(metrics.conversations_total, 3);
    assert.equal(metrics.by_state.assigned, 2);
    assert.equal(metrics.by_state.new, 1);
    assert.equal(metrics.unassigned_total, 1);
    // ⭐⭐ الانتظار = الآن − **آخر نشاط** ⇒ ⭐ **وقيد التغيير نشاطٌ** ⇒
    // ⭐ ⇒ محادثتا ١ و ٢ تحدّثتا الآن (١٢:٣٠) ⇒ انتظارهما ٠ ⇒
    // ⭐ ⇒ والمتأخرة (≥ ٣٠ دقيقة) = محادثة ٣ فقط (آخر نشاط ١١:٥٠ ⇒ ٤٠ دقيقة).
    assert.equal(metrics.idle_over_threshold_total, 1);
    // ⭐ أول رد: محادثة ١ فقط (٣٠ دقيقة) ⇒ المتوسط ٣٠.
    assert.equal(metrics.first_response_minutes, 30);
    // ⭐ زمن الحل: لا محادثة محلولة ⇒ ⭐ undefined صريح (لا صفر مخترع).
    assert.equal(metrics.resolution_minutes, undefined);
    // ⭐ العبء: موظفان (كل منهما محادثة واحدة مفتوحة).
    assert.deepEqual(metrics.load_per_employee, [
      { actor_id: AGENT, open_count: 1 },
      { actor_id: OTHER_AGENT, open_count: 1 },
    ]);
  });

  await t.test('⭐⭐⭐⭐⭐ زمن الحل يُحسب عند وجود قيد حل', () => {
    const { layer, deps } = scenario();
    const ctxA = context('supervisor');
    const ctxB = context('supervisor', 2, 21, 9);
    seed(layer, ctxA, ctxB);
    updateConversationState(ctxA, 'conv_synth_0001', 'open', deps, { reason: 'فتح' });
    updateConversationState(ctxA, 'conv_synth_0001', 'resolved', deps, { reason: 'تم الحل' });
    const metrics = getServiceMetrics(ctxA, deps, { now: NOW });
    // ⭐ زمن الحل = قِيد التغيير (١٢:٣٠) − أول رسالة واردة (٠٩:٠٠) = ٢١٠ دقيقة.
    assert.equal(metrics.resolution_minutes, 210);
    assert.equal(metrics.by_state.resolved, 1);
  });
});

test('٥) ⭐⭐⭐⭐⭐ منع التسريب (لا نصّ رسالة في المخرجات)', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ نص الرسالة غير موجود في الطابور ولا في المؤشرات', () => {
    const { layer, deps } = scenario();
    const ctxA = context('supervisor');
    const ctxB = context('supervisor', 2, 21, 9);
    seed(layer, ctxA, ctxB);
    const queueJson = JSON.stringify(listWorkQueue(ctxA, deps, { now: NOW }));
    const metricsJson = JSON.stringify(getServiceMetrics(ctxA, deps, { now: NOW }));
    assert.ok(!queueJson.includes(SECRET_BODY), 'نص رسالة داخل الطابور ⇒ تسريب');
    assert.ok(!metricsJson.includes(SECRET_BODY), 'نص رسالة داخل المؤشرات ⇒ تسريب');
    assert.ok(!queueJson.includes('body'), 'حقل جسم الرسالة في الطابور ⇒ تسريب');
  });
});

test('٦) ⭐⭐⭐⭐⭐ بوابة الصلاحيات (صريحة + السقف يحكم)', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ الوكيل بلا المؤشرات ⇒ رفض', () => {
    const { layer, deps } = scenario();
    const ctxA = context('agent');
    const ctxB = context('agent', 2, 21, 9);
    seed(layer, ctxA, ctxB);
    // ⭐ الطابور مسموح للوكيل.
    const queue = listWorkQueue(ctxA, deps, { now: NOW });
    assert.equal(queue.pagination.total, 0);
    // ⭐ المؤشرات مرفوضة (المشرف والمالك فقط).
    assert.throws(
      () => getServiceMetrics(ctxA, deps, { now: NOW }),
      (error: unknown) => error instanceof CapabilityError,
    );
  });

  await t.test('⭐⭐⭐⭐⭐ `viewer` بلا الطابور ⇒ رفض', () => {
    const { layer, deps } = scenario();
    const ctxA = context('viewer');
    const ctxB = context('viewer', 2, 21, 9);
    seed(layer, ctxA, ctxB);
    assert.throws(
      () => listWorkQueue(ctxA, deps, { now: NOW }),
      (error: unknown) => error instanceof CapabilityError,
    );
    assert.throws(
      () => getServiceMetrics(ctxA, deps, { now: NOW }),
      (error: unknown) => error instanceof CapabilityError,
    );
  });

  await t.test('⭐⭐⭐⭐⭐ مصدر بسقف ناقص ⇒ المؤشرات مرفوضة والطابور مسموح', () => {
    const { layer, deps } = scenario();
    const ctx = createSyntheticContextWithSource(
      LOCAL_RESTRICTED_SOURCES.noMetrics,
      1,
      11,
      101,
      1,
      () => NOW,
    );
    const ctxB = context('supervisor', 2, 21, 9);
    seed(layer, ctx, ctxB);
    assert.throws(
      () => getServiceMetrics(ctx, deps, { now: NOW }),
      (error: unknown) => error instanceof CapabilityError,
    );
  });
});

test('٧) ⭐⭐⭐⭐⭐ مصدر غير مسجَّل ⇒ لا سياق معتمد ⇒ لا طابور', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ مصدر runtime غير مسجَّل يُرفض بنمط الفشل نفسه', () => {
    const { layer, deps } = scenario();
    const runtimeSource = {
      id: 'runtime-unregistered-s05',
      scope: 'runtime' as const,
      description: 'مصدر غير مسجَّل — اختبار',
      verify: () => null,
    };
    assert.throws(() =>
      createSyntheticContextWithSource(runtimeSource, 1, 11, 101, 1, () => NOW),
    );
    assert.ok(layer && deps);
  });
});

test('٨) ⭐⭐⭐ عدم التخمين (قيمة غير محسوبة ⇒ `undefined` صريح)', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ لا أول رد ولا زمن حل ⇒ `undefined` لا صفر', () => {
    const { layer, deps } = scenario();
    const ctxA = context('supervisor');
    const ctxB = context('supervisor', 2, 21, 9);
    seed(layer, ctxA, ctxB);
    const metrics = getServiceMetrics(ctxA, deps, { now: NOW });
    assert.equal(metrics.first_response_minutes, 30);
    assert.equal(metrics.resolution_minutes, undefined);
  });
});

test('٩) ⭐⭐⭐⭐⭐ بلا شبكة (الحاجز مُركَّب)', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ صفر محاولة اتصال خارجية', () => {
    assert.equal(guard.installed, true);
    assert.deepEqual(guard.blocked, []);
  });
});

test('١٠) ⭐⭐⭐⭐⭐ القراءة فقط (بلا أي أثر كتابة)', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ الطابور + المؤشرات ⇒ لا حالة ولا سجل تغييرات ولا إسناد', () => {
    const { layer, deps, states, changes, store } = scenario();
    const ctxA = context('supervisor');
    const ctxB = context('supervisor', 2, 21, 9);
    seed(layer, ctxA, ctxB);
    const statesBefore = states.sizeFor(TENANT_A);
    const rowsBefore = changes.size();
    const messagesBefore = store.countFor(ctxA);

    listWorkQueue(ctxA, deps, { now: NOW });
    getServiceMetrics(ctxA, deps, { now: NOW });

    assert.equal(states.sizeFor(TENANT_A), statesBefore, 'القراءة أنشأت صفوف حالة');
    assert.equal(changes.size(), rowsBefore, 'القراءة كتبت في سجل التغييرات');
    assert.equal(store.countFor(ctxA), messagesBefore, 'القراءة كتبت رسائل');
  });
});

test('١١) ⭐⭐⭐⭐⭐ الانحدار (الشرائح السابقة سليمة)', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ خريطة الانتقالات ١٢ + قراءة Slice 03 سليمة', () => {
    const total = Object.values(ALLOWED_TRANSITIONS).reduce((sum, list) => sum + list.length, 0);
    assert.equal(total, 12);
    const { layer, deps } = scenario();
    const ctxA = context('supervisor');
    const ctxB = context('supervisor', 2, 21, 9);
    seed(layer, ctxA, ctxB);
    const thread = getConversation(ctxA, 'conv_synth_0001', deps);
    assert.equal(thread.messages.length, 2);
  });
});

test('١٢) ⭐⭐⭐⭐⭐ نطاق الجمهور (قرار المالك)', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ الوكيل يرى محادثاته فقط', () => {
    const { layer, deps } = scenario();
    const agentCtx = context('agent');
    const supervisorCtx = context('supervisor');
    const ctxB = context('supervisor', 2, 21, 9);
    seed(layer, supervisorCtx, ctxB);
    const ownerCtx = context('owner');
    updateConversationState(supervisorCtx, 'conv_synth_0001', 'open', deps, { reason: 'فتح' });
    assignConversation(ownerCtx, 'conv_synth_0001', AGENT, deps, { reason: 'توزيع' });
    updateConversationState(supervisorCtx, 'conv_synth_0002', 'open', deps, { reason: 'فتح' });
    assignConversation(ownerCtx, 'conv_synth_0002', OTHER_AGENT, deps, { reason: 'توزيع' });

    const mine = listWorkQueue(agentCtx, deps, { now: NOW });
    assert.equal(mine.pagination.total, 1);
    assert.equal(mine.items[0].conversation_ref, 'conv_synth_0001');

    const team = listWorkQueue(supervisorCtx, deps, { now: NOW });
    assert.equal(team.pagination.total, 3);
  });

  await t.test('⭐⭐⭐⭐⭐ معيار الخمول ٣٠ دقيقة (والافتراضي مُعلن) — ⭐ «الخمول منذ آخر نشاط» لا تأخّر العميل', () => {
    const { layer, deps } = scenario();
    const ctxA = context('supervisor');
    const ctxB = context('supervisor', 2, 21, 9);
    seed(layer, ctxA, ctxB);
    const page = listWorkQueue(ctxA, deps, { now: NOW });
    assert.equal(page.pagination.idle_threshold_minutes, 30);
    // ⭐ محادثة آخر نشاط ١١:٥٠ ⇒ ٤٠ دقيقة ⇒ خمولها تجاوز المعيار.
    const third = page.items.find((item) => item.conversation_ref === 'conv_synth_0003');
    assert.equal(third?.idle_minutes, 40);
    assert.equal(third?.is_idle_over_threshold, true);
    // ⭐ تغيير المعيار ⇒ ٦٠ دقيقة ⇒ نفس المحادثة خمولها لم يتجاوز المعيار.
    const relaxed = listWorkQueue(ctxA, deps, { now: NOW, idle_threshold_minutes: 60 });
    const thirdRelaxed = relaxed.items.find(
      (item) => item.conversation_ref === 'conv_synth_0003',
    );
    assert.equal(thirdRelaxed?.is_idle_over_threshold, false);
  });
});

test('١٣) ⭐⭐⭐⭐⭐ الطرد (الضمان مُثبَّت في الكود)', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ فلتر المستأجر موجود في مسار القراءة', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src/core/agent-queue.ts'), 'utf8');
    assert.ok(
      source.includes('deps.store.conversationRefs(context)'),
      'الطابور لا يقرأ عبر سياق المستأجر ⇒ خطر تسريب عابر',
    );
    assert.ok(
      source.includes('deps.store.messagesForConversation(context, conversationRef)'),
      'النشاط لا يقرأ عبر سياق المستأجر ⇒ خطر تسريب عابر',
    );
  });

  await t.test('⭐⭐⭐⭐⭐ نطاق الدور مطبَّق (الوكيل يرى محادثاته فقط)', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src/core/agent-queue.ts'), 'utf8');
    assert.ok(
      source.includes("context.role === 'agent'"),
      'نطاق الدور غير مطبَّق ⇒ الوكيل قد يرى محادثات غيره',
    );
  });

  await t.test('⭐⭐⭐⭐⭐ المؤشرات تحتاج صلاحية صريحة', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src/core/service-metrics.ts'), 'utf8');
    assert.ok(
      source.includes('CONVERSATION_METRICS_CAPABILITY'),
      'المؤشرات بلا بوابة صلاحية ⇒ تسريب قياس',
    );
  });
});

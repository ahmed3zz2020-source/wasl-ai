// ============================================================
// WASL AI — تقوية الأمان المحلي: تقييد القدرات الحسّاسة + عزل المستأجرين
// ------------------------------------------------------------
// ⭐⭐⭐⭐⭐ **التصريح**: ⭐ المالك (٦ نوفمبر ٢٠٢٦ · D-061) —
//   ⭐ «Local Security Hardening — Audit Access & Tenant Isolation».
// ⭐ **ما يُثبته هذا الملف (خمسة بنود)**:
//   ⭐ ① **تقييد القدرات الحسّاسة الخمس** (M32 · M23 · M26 · M29).
//   ⭐ ② **حدّ الثقة عند الحقن** — ⭐ مخزن الحالة **بلا معرّف مستأجر نصّي**.
//   ⭐ ③ **عزل ثلاثة مستأجرين** بأدوار مختلفة (M33 · M25 · M27 · M30).
//   ⭐ ④ **اختبارات رفض** برموز الخطأ — ⭐ لا «غياب بيانات» فقط.
//   ⭐ ⑤ **اختبار طرد** ⇒ ⭐ الكسر الحقيقي يُسقط نفس الحارس ⇒ ⭐ ⇒⇒ الحارس حسّاس.
// ⛔ بلا شبكة · ⛔ بلا بيانات حقيقية · ⛔ بلا حساب · ⛔ بلا نشر.
// ⛔⭐⭐ **حدود الضمان**: ⭐ كل ما هنا **محلي** ⇒ ⭐ ⛔ **ليس ضماناً لأمان
//   بيئة إنتاجية غير موجودة** (لا `auth-middleware` · لا قاعدة بيانات · لا شبكة)
//   ⇒ ⇒⇒ **ولا يُغلق `DR-4` ولا القيد ⑥ ولا `Q13`**.
// ⛔ **عدّاد الأدوار**: ⭐ كل دور = مصدر جلسات **مختلف** ⇒ ⭐ والدور من
//   المصدر لا من المستخدم ⇒ ⇒⇒ **وفرق الأدوار مغطّى بالاسم**.
// ============================================================

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { guard } from './guard-setup.ts';
import {
  AuditLog,
  ConversationChangeLog,
  ConversationStateStore,
  MessageStore,
  OrderingState,
  ProcessingLayer,
  ReadAuditLog,
  assignConversation,
  getConversation,
  getServiceMetrics,
  listConversations,
  listWorkQueue,
  readConversationAudit,
  unassignConversation,
  updateConversationState,
  type ConversationStateDependencies,
  type EmployeeDirectory,
  type TenantContext,
  type TrustedRole,
} from '../src/core/index.ts';
// ⭐⭐⭐ إصدار نطاق الإدارة — ⭐ **غير مُصدَّر من `src/core/index.ts`**.
//    ⇒ ⭐ السطح العام **لا يستطيع** إصدار نطاق ⇒ ⇒⇒ **لا تفريغ شامل عبره**.
//    ⇒ ⭐ والاستيراد هنا **مباشر من ملف الوحدة** (نفس نمط `registerSessionSource`).
import { issueAuditAdminScope } from '../src/core/audit-log.ts';
import { createSyntheticContext, createSyntheticEnvelope } from './support/index.ts';

const FIXED_NOW = '2026-01-01T00:00:00.000Z';
const ROOT = path.resolve(import.meta.dirname, '..');
const WORKSPACE = path.resolve(ROOT, '..');
/** ⭐ مجلد النسخة المعزولة — ⭐ **خارج المستودع** وداخل مساحة العمل. */
const ISOLATED = path.join(WORKSPACE, '.wasl-hardening-probe');
/** ⭐⭐ مجلد ثانٍ — ⭐ **لأن Node يكشّ الوحدات بالمسار** ⇒ ⇒⇒ مساران = كسران مستقلّان. */
const ISOLATED_SCOPE = path.join(WORKSPACE, '.wasl-hardening-probe-scope');

/** ⭐⭐⭐ المستأجرون الثلاثة — ⭐ بأدوار مختلفة (M33). */
const TENANT_A = 'tnt_synth_0001';
const TENANT_B = 'tnt_synth_0002';
const TENANT_C = 'tnt_synth_0003';
const REF_A = 'conv_synth_0001';
const REF_B = 'conv_synth_0002';
const REF_C = 'conv_synth_0003';

// ============================================================
// ⭐⭐⭐ أدوات الفحص
// ============================================================

/** ⭐ رمز الخطأ (أو `no_error` إن لم يرمِ شيء). */
function codeOf(fn: () => unknown): string {
  try {
    fn();
    return 'no_error';
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      return String((error as { code: unknown }).code);
    }
    return 'unknown';
  }
}

/** ⭐ نداء غير مقيَّد (بلا نطاق إداري) — ⭐ لفحص الرفض وقت التشغيل. */
interface LooseAudit {
  entries: (scope?: unknown) => unknown;
  toJsonl: (scope?: unknown) => unknown;
  size: (scope?: unknown) => unknown;
}
function loose(audit: unknown): LooseAudit {
  return audit as LooseAudit;
}

/** ⭐ سياق مستأجر — ⭐ **من مصدر جلسات لكل دور** (لا ادّعاء من الكود). */
function ctx(index: number, role: TrustedRole, conversationIndex = index): TenantContext {
  return createSyntheticContext(
    index,
    index * 10 + 1,
    100 + index,
    conversationIndex,
    () => FIXED_NOW,
    role,
  );
}

/** ⭐⭐⭐ بيئة كاملة — ⭐ ثلاث مستأجرين + سجلّات + اعتماديات. */
function scenario() {
  const audit = new AuditLog({ now: () => FIXED_NOW });
  const readAudit = new ReadAuditLog({ now: () => FIXED_NOW });
  const store = new MessageStore({ now: () => FIXED_NOW, audit });
  const layer = new ProcessingLayer({ store, audit, orderingState: new OrderingState() });
  const states = new ConversationStateStore({ now: () => FIXED_NOW });
  const changes = new ConversationChangeLog({ now: () => FIXED_NOW });
  const roster: Record<string, readonly string[]> = {
    [TENANT_A]: ['actor_synth_0011'],
    [TENANT_B]: ['actor_synth_0021'],
    [TENANT_C]: ['actor_synth_0031'],
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

/** ⭐ بذر محادثة واحدة (رسالتان: واردة + صادرة) لكل مستأجر. */
function seedAll(layer: ProcessingLayer): void {
  const plan: Array<{ index: number; role: TrustedRole; refIndex: number; messages: number[] }> = [
    { index: 1, role: 'owner', refIndex: 1, messages: [11, 12] },
    { index: 2, role: 'supervisor', refIndex: 2, messages: [21, 22] },
    { index: 3, role: 'agent', refIndex: 3, messages: [31, 32] },
  ];
  for (const item of plan) {
    const context = ctx(item.index, item.role, item.refIndex);
    for (const messageIndex of item.messages) {
      layer.process(
        context,
        createSyntheticEnvelope({
          tenantIndex: item.index,
          messageIndex,
          conversationIndex: item.refIndex,
          direction: messageIndex % 2 === 0 ? 'outbound' : 'inbound',
        }),
      );
    }
  }
}

// ============================================================
// ⭐⭐⭐ ① القدرات الحسّاسة — مقيَّدة بسلطان إداري (M32)
// ============================================================

test('M32) ⭐⭐⭐⭐⭐ القدرات الحسّاسة مقيَّدة (التفريغ الشامل = سلطان إداري)', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ التفريغ الشامل بلا نطاق ⇒ رفض `admin_scope_required`', () => {
    const { audit, readAudit, changes } = scenario();
    assert.equal(codeOf(() => loose(audit).entries()), 'admin_scope_required');
    assert.equal(codeOf(() => loose(audit).toJsonl()), 'admin_scope_required');
    assert.equal(codeOf(() => loose(audit).size()), 'admin_scope_required');
    assert.equal(codeOf(() => loose(readAudit).size()), 'admin_scope_required');
    assert.equal(codeOf(() => loose(changes).size()), 'admin_scope_required');
  });

  await t.test('⭐⭐⭐⭐⭐ نطاق مزوَّر (نفس الشكل) ⇒ مرفوض (النَسَب لا الشكل)', () => {
    const { audit } = scenario();
    const forged = { kind: 'audit.admin' };
    assert.equal(codeOf(() => loose(audit).entries(forged)), 'admin_scope_required');
    assert.equal(codeOf(() => loose(audit).toJsonl(forged)), 'admin_scope_required');
  });

  await t.test('⭐⭐⭐⭐⭐ الوظيفة الإدارية المحلية لم تُكسر (نطاق حقيقي ⇒ عمل)', () => {
    const { audit } = scenario();
    const scope = issueAuditAdminScope();
    assert.deepEqual(audit.entries(scope), []);
    assert.equal(audit.toJsonl(scope), '');
    assert.equal(audit.size(scope), 0);
  });

  await t.test('⭐⭐⭐⭐⭐ السطح العام لا يصدّر إصدار النطاق (لا تفريغ شامل عبره)', async () => {
    const surface = fs.readFileSync(path.join(ROOT, 'src', 'core', 'index.ts'), 'utf8');
    assert.ok(
      !/export\s*\{[^}]*issueAuditAdminScope/s.test(surface),
      'السطح العام يصدّر إصدار نطاق الإدارة ⇒ ⇒⇒ تفريغ شامل ممكن عبره',
    );
    const production = (await import('../src/core/index.ts')) as Record<string, unknown>;
    assert.equal(production.issueAuditAdminScope, undefined);
  });

  await t.test('⭐⭐⭐⭐⭐ العدّادات المقيَّدة بالمستأجر ⇒ لا تُحصي مستأجراً آخر', () => {
    const { audit, readAudit, changes, layer } = scenario();
    seedAll(layer);
    const a = ctx(1, 'owner');
    const b = ctx(2, 'supervisor');
    const c = ctx(3, 'agent');
    assert.ok(audit.sizeFor(a) > 0, 'عدّاد المستأجر الأول صفر');
    assert.ok(audit.sizeFor(b) > 0);
    assert.ok(audit.sizeFor(c) > 0);
    // ⭐⭐ المعنى = **كل عدّاد يعدّ صفوف مستأجره وحده** (لا مجموع الكل).
    assert.equal(audit.sizeFor(a), audit.entriesFor(a).length);
    assert.equal(audit.sizeFor(b), audit.entriesFor(b).length);
    assert.equal(audit.sizeFor(c), audit.entriesFor(c).length);
    for (const entry of audit.entriesFor(a)) {
      assert.equal(entry.tenant_id, TENANT_A, 'عدّاد A تضمّن صفّ مستأجر آخر');
    }
    assert.equal(readAudit.sizeFor(b), 0, 'قراءة بلا عملية ⇒ صفر');
    assert.equal(changes.sizeFor(b), 0, 'تغيير بلا عملية ⇒ صفر');
  });
});

// ============================================================
// ⭐⭐⭐ ② حدّ الثقة عند الحقن — الاعتماديات (M32 · البند الثاني)
// ============================================================

test('M32) ⭐⭐⭐⭐⭐ حدّ الثقة عند الحقن: مخزن الحالة بلا معرّف مستأجر نصّي', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ معرّف نصّي خام ⇒ رفض (لا استعلام عابر ممكن)', () => {
    const { states } = scenario();
    const raw = TENANT_B as unknown as TenantContext;
    for (const call of [
      () => states.get(raw, REF_B),
      () => states.ensure(raw, REF_B),
      () => states.sizeFor(raw),
    ]) {
      const code = codeOf(call);
      assert.ok(
        code === 'tenant_context_missing' || code === 'tenant_context_invalid',
        `مدخل نصّي خام لم يُرفض ⇒ رمز غير متوقّع: ${code}`,
      );
    }
  });

  await t.test('⭐⭐⭐⭐⭐ قراءة صفّ مستأجر آخر عبر سياقه ⇒ صفر (لا كشف وجود)', () => {
    const { states } = scenario();
    const a = ctx(1, 'owner');
    const b = ctx(2, 'supervisor');
    states.ensure(a, REF_A);
    states.ensure(b, REF_B);
    assert.equal(states.get(a, REF_B), undefined, 'صفّ المستأجر الثاني ظهر في سياق الأول');
    assert.equal(states.get(b, REF_A), undefined, 'صفّ المستأجر الأول ظهر في سياق الثاني');
    assert.equal(states.sizeFor(a), 1);
    assert.equal(states.sizeFor(b), 1);
  });

  await t.test('⭐⭐⭐⭐⭐ كتابة سطر باسم مستأجر آخر ⇒ رفض `tenant_mismatch`', () => {
    const { changes } = scenario();
    const a = ctx(1, 'owner');
    const code = codeOf(() =>
      changes.record(a, {
        tenant_id: TENANT_B,
        actor_id: 'actor_synth_0011',
        operation: 'state.update',
        conversation_ref: REF_A,
        from_state: 'new',
        to_state: 'open',
      }),
    );
    assert.equal(code, 'tenant_mismatch');
    assert.equal(changes.sizeFor(ctx(2, 'supervisor')), 0, 'سطر كُتب باسم مستأجر آخر');
  });
});

// ============================================================
// ⭐⭐⭐ ③ العزل — ثلاثة مستأجرين × ستّة مسارات (M33)
// ============================================================

test('M33) ⭐⭐⭐⭐⭐ العزل: ثلاثة مستأجرين × (قراءة · تعديل · إسناد · إلغاء إسناد · عدّادات · تدقيق)', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ ① القراءة: لا صفّ ولا محادثة ولا تدقيق من مستأجر آخر', () => {
    const { layer, deps, queryDeps } = scenario();
    seedAll(layer);
    const a = ctx(1, 'owner');
    const b = ctx(2, 'supervisor');
    const c = ctx(3, 'agent');

    // ⭐ قائمة المحادثات ⇒ لا محادثة لغير A.
    const listA = listConversations(a, queryDeps);
    const refsA = listA.summaries.map((row) => row.conversation_ref);
    assert.ok(refsA.includes(REF_A), 'محادثة A غير موجودة');
    assert.equal(refsA.includes(REF_B), false, 'محادثة B ظهرت في قائمة A');
    assert.equal(refsA.includes(REF_C), false, 'محادثة C ظهرت في قائمة A');

    // ⭐ قراءة محادثة ⇒ صفر رسائل (لا كشف وجود).
    assert.equal(getConversation(a, REF_B, queryDeps).messages.length, 0);
    assert.equal(getConversation(a, REF_C, queryDeps).messages.length, 0);
    assert.equal(getConversation(b, REF_A, queryDeps).messages.length, 0);

    // ⭐ تدقيق المحادثة ⇒ لا سطر من محادثة B (بلا كشف وجود).
    const auditB = readConversationAudit(a, REF_B, queryDeps);
    assert.equal(auditB.entries.length, 0);
    assert.equal(auditB.pagination.total, 0);
    void c;
  });

  await t.test('⭐⭐⭐⭐⭐ ② التعديل العابر ⇒ رفض `conversation_not_found`', () => {
    const { layer, deps } = scenario();
    seedAll(layer);
    const a = ctx(1, 'owner');
    assert.equal(codeOf(() => updateConversationState(a, REF_B, 'open', deps)), 'conversation_not_found');
    assert.equal(codeOf(() => updateConversationState(a, REF_C, 'open', deps)), 'conversation_not_found');
  });

  await t.test('⭐⭐⭐⭐⭐ ③ الإسناد العابر ⇒ رفض `conversation_not_found`', () => {
    const { layer, deps } = scenario();
    seedAll(layer);
    const a = ctx(1, 'owner');
    assert.equal(
      codeOf(() => assignConversation(a, REF_B, 'actor_synth_0021', deps)),
      'conversation_not_found',
    );
    assert.equal(
      codeOf(() => assignConversation(a, REF_A, 'actor_synth_0021', deps)),
      'assignee_not_in_tenant',
    );
  });

  await t.test('⭐⭐⭐⭐⭐ ④ إلغاء الإسناد العابر ⇒ رفض `conversation_not_found`', () => {
    const { layer, deps } = scenario();
    seedAll(layer);
    const a = ctx(1, 'owner');
    assert.equal(codeOf(() => unassignConversation(a, REF_B, deps)), 'conversation_not_found');
    assert.equal(codeOf(() => unassignConversation(a, REF_C, deps)), 'conversation_not_found');
  });

  await t.test('⭐⭐⭐⭐⭐ ⑤ العدّادات ⇒ لكل مستأجر أرقامه وحده', () => {
    const { layer, deps, store, states, changes, audit, readAudit } = scenario();
    seedAll(layer);
    const a = ctx(1, 'owner');
    const b = ctx(2, 'supervisor');
    const c = ctx(3, 'agent');

    updateConversationState(a, REF_A, 'open', deps, { reason: 'فتح الطلب' });
    assignConversation(a, REF_A, 'actor_synth_0011', deps, { reason: 'توزيع' });
    updateConversationState(b, REF_B, 'open', deps, { reason: 'فتح الطلب' });

    const metricsA = getServiceMetrics(a, deps, { now: FIXED_NOW });
    const metricsB = getServiceMetrics(b, deps, { now: FIXED_NOW });
    assert.equal(metricsA.conversations_total, 1, 'عدّاد محادثات A غير صحيح');
    assert.equal(metricsB.conversations_total, 1);
    assert.equal(
      codeOf(() => getServiceMetrics(c, deps)),
      'capability_missing',
      'الدور `agent` لا يقرأ المؤشرات ⇒ رفض (كما في سياسة الأدوار)',
    );
    assert.equal(metricsA.load_per_employee.length, 1);
    assert.equal(
      metricsA.load_per_employee[0].actor_id,
      'actor_synth_0011',
      'عبء A يحمّل موظف مستأجر آخر',
    );

    assert.equal(store.countFor(a), 2);
    assert.equal(store.countFor(b), 2);
    assert.equal(states.sizeFor(a), 1);
    assert.equal(states.sizeFor(b), 1);
    assert.equal(changes.sizeFor(a), 2, 'سجل تغييرات A يحوي تغييرات B');
    assert.equal(changes.sizeFor(b), 1);
    // ⭐ العدّاد = صفوف مستأجره وحده ⇒ ⇒⇒ (لا مجموع الكل).
    assert.equal(audit.sizeFor(a), audit.entriesFor(a).length);
    assert.equal(audit.sizeFor(b), audit.entriesFor(b).length);
    assert.equal(audit.sizeFor(a), 4, 'عدّاد سجل التدقيق لا يطابق صفوف المستأجر');
    assert.ok(readAudit.sizeFor(a) > 0, 'قراءة A لم تُسجَّل');
  });

  await t.test('⭐⭐⭐⭐⭐ ⑥ سجلّات التدقيق ⇒ لا سطر من مستأجر آخر', () => {
    const { layer, audit, readAudit } = scenario();
    seedAll(layer);
    const a = ctx(1, 'owner');
    const b = ctx(2, 'supervisor');
    const c = ctx(3, 'agent');
    const entriesA = audit.entriesFor(a);
    assert.ok(entriesA.length > 0);
    for (const entry of entriesA) {
      assert.equal(entry.tenant_id, TENANT_A, 'سجلّ A يحوي سطراً من مستأجر آخر');
    }
    const eventsA = readAudit.eventsFor(a);
    for (const event of eventsA) {
      assert.equal(event.tenant_id, TENANT_A);
    }
    assert.equal(
      audit.entriesFor(b).some((entry) => entry.tenant_id === TENANT_A),
      false,
    );
    assert.equal(
      audit.entriesFor(c).some((entry) => entry.tenant_id === TENANT_A),
      false,
    );
  });
});

// ============================================================
// ⭐⭐⭐ ④ اختلاف الأدوار — الفرق العملي مغطّى بالاسم (M33)
// ============================================================

test('M33) ⭐⭐⭐⭐⭐ فرق الأدوار: ما يُسمح به دورٌ يُرفض بدور (وكل الأدوار داخل مستأجرها)', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ `viewer` يقرأ ولا يعدّل ولا يُسند', () => {
    const { layer, deps, queryDeps } = scenario();
    seedAll(layer);
    const viewer = ctx(1, 'viewer');
    assert.equal(codeOf(() => listConversations(viewer, queryDeps)), 'no_error');
    assert.equal(
      codeOf(() => updateConversationState(viewer, REF_A, 'open', deps)),
      'capability_missing',
    );
    assert.equal(codeOf(() => assignConversation(viewer, REF_A, 'actor_synth_0011', deps)), 'capability_missing');
    assert.equal(codeOf(() => unassignConversation(viewer, REF_A, deps)), 'capability_missing');
  });

  await t.test('⭐⭐⭐⭐⭐ `agent` يقرأ ولا يعدّل ولا يُسند ولا يقرأ المؤشرات', () => {
    const { layer, deps } = scenario();
    seedAll(layer);
    const agent = ctx(3, 'agent');
    // ⭐ سياسة الأدوار: ⭐ `agent` بلا `conversation.state.update` ⇒ تعديل مرفوض.
    assert.equal(codeOf(() => updateConversationState(agent, REF_C, 'open', deps)), 'capability_missing');
    assert.equal(
      codeOf(() => assignConversation(agent, REF_C, 'actor_synth_0031', deps)),
      'capability_missing',
    );
    assert.equal(codeOf(() => getServiceMetrics(agent, deps)), 'capability_missing');
    assert.equal(codeOf(() => listWorkQueue(agent, deps)), 'no_error');
  });

  await t.test('⭐⭐⭐⭐⭐ `supervisor` يعدّل ويقرأ المؤشرات ولا يجاوز نطاق مستأجره', () => {
    const { layer, deps } = scenario();
    seedAll(layer);
    const supervisor = ctx(2, 'supervisor');
    assert.equal(codeOf(() => getServiceMetrics(supervisor, deps)), 'no_error');
    assert.equal(
      codeOf(() => updateConversationState(supervisor, REF_A, 'open', deps)),
      'conversation_not_found',
    );
  });

  await t.test('⭐⭐⭐⭐⭐ الدور بلا صلاحية (`none`) ⇒ كل عملية مرفوضة', () => {
    const { layer, deps, queryDeps } = scenario();
    seedAll(layer);
    const none = ctx(1, 'none');
    assert.equal(codeOf(() => listConversations(none, queryDeps)), 'capability_missing');
    assert.equal(codeOf(() => updateConversationState(none, REF_A, 'open', deps)), 'capability_missing');
    assert.equal(codeOf(() => getServiceMetrics(none, deps)), 'capability_missing');
  });

  await t.test('⭐⭐⭐⭐⭐ الطابور لا يخرج عن نطاق المستأجر', () => {
    const { layer, deps } = scenario();
    seedAll(layer);
    const supervisor = ctx(2, 'supervisor');
    const page = listWorkQueue(supervisor, deps, { now: FIXED_NOW });
    const refs = page.items.map((item) => item.conversation_ref);
    assert.equal(refs.includes(REF_B), true, 'محادثة B غير موجودة في طابور B');
    assert.equal(refs.includes(REF_A), false, 'محادثة A ظهرت في طابور B');
    assert.equal(refs.includes(REF_C), false, 'محادثة C ظهرت في طابور B');
  });
});

// ============================================================
// ⭐⭐⭐ ⑤ الطرد — الكسر الحقيقي يُسقط نفس الحارس (حساسية مثبتة)
// ============================================================

interface IsolatedCore {
  readonly AuditLog: typeof import('../src/core/index.ts').AuditLog;
  readonly ConversationStateStore: typeof import('../src/core/index.ts').ConversationStateStore;
}

/** ⭐⭐⭐ الحارس ① — القدرات الحسّاسة: التفريغ الشامل بلا نطاق = مرفوض. */
function sensitiveHandlesGuarded(core: IsolatedCore): boolean {
  const audit = new core.AuditLog({ now: () => FIXED_NOW });
  return (
    codeOf(() => loose(audit).entries()) === 'admin_scope_required' &&
    codeOf(() => loose(audit).toJsonl()) === 'admin_scope_required' &&
    codeOf(() => loose(audit).size()) === 'admin_scope_required'
  );
}

/** ⭐⭐⭐ الحارس ② — حدّ الثقة عند الحقن: لا معرّف نصّي ولا صفّ عابر. */
function stateStoreGuarded(core: IsolatedCore): boolean {
  const states = new core.ConversationStateStore({ now: () => FIXED_NOW });
  const a = ctx(1, 'owner');
  const b = ctx(2, 'supervisor');
  states.ensure(a, REF_A);
  states.ensure(b, REF_B);
  const rawCode = codeOf(() => states.get(TENANT_B as unknown as TenantContext, REF_B));
  const rawRejected = rawCode === 'tenant_context_missing' || rawCode === 'tenant_context_invalid';
  const crossHidden = states.get(a, REF_B) === undefined;
  return rawRejected && crossHidden;
}

/** ⭐ نسخة معزولة من النواة — ⭐ **خارج المستودع**. */
function cloneCore(target = ISOLATED): void {
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.join(target, 'core'), { recursive: true });
  for (const file of fs.readdirSync(path.join(ROOT, 'src', 'core'))) {
    if (!file.endsWith('.ts')) continue;
    fs.writeFileSync(
      path.join(target, 'core', file),
      fs.readFileSync(path.join(ROOT, 'src', 'core', file), 'utf8'),
      'utf8',
    );
  }
}

async function loadIsolated(target = ISOLATED): Promise<IsolatedCore> {
  return (await import(
    pathToFileURL(path.join(target, 'core', 'index.ts')).href
  )) as unknown as IsolatedCore;
}

/** ⭐⭐ كسر ① — حذف حدّ الثقة عند الحقن (المخزن يتجاهل المستأجر). */
function breakStateScoping(): void {
  const file = path.join(ISOLATED, 'core', 'conversation-state.ts');
  const source = fs.readFileSync(file, 'utf8');
  const anchor = '    const row = this.#rows.get(tenantIdOf(context))?.get(conversationRef);';
  assert.equal(
    source.split(anchor).length - 1,
    1,
    'نقطة الكسر (حدّ الثقة عند الحقن) لم تعد موجودة ⇒ لازم تحديث اختبار الطرد',
  );
  fs.writeFileSync(
    file,
    source.replace(
      anchor,
      '    const row = [...this.#rows.values()]\n      .flatMap((rows) => [...rows.values()])\n      .find((item) => item.conversation_ref === conversationRef);',
    ),
    'utf8',
  );
}

/** ⭐⭐ كسر ② — تعطيل حارس النطاق الإداري (التفريغ الشامل بلا سلطان). */
function breakAdminScope(target = ISOLATED_SCOPE): void {
  const file = path.join(target, 'core', 'audit-log.ts');
  const source = fs.readFileSync(file, 'utf8');
  const anchor = '  if (!isAdminScope(scope)) {';
  assert.equal(
    source.split(anchor).length - 1,
    1,
    'نقطة الكسر (حارس النطاق الإداري) لم تعد موجودة ⇒ لازم تحديث اختبار الطرد',
  );
  fs.writeFileSync(file, source.replace(anchor, '  if (!isAdminScope(scope) && false) {'), 'utf8');
}

test('M33) ⭐⭐⭐⭐⭐ الطرد: الكسر الحقيقي ⇒ نفس الحارس يفشل (الحارس حسّاس)', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ الحارسان يمرّان على النواة الحقيقية', async () => {
    const core = (await import('../src/core/index.ts')) as unknown as IsolatedCore;
    assert.equal(sensitiveHandlesGuarded(core), true, 'حارس القدرات الحسّاسة لا يمرّ على النواة الحقيقية');
    assert.equal(stateStoreGuarded(core), true, 'حارس حدّ الثقة عند الحقن لا يمرّ على النواة الحقيقية');
  });

  await t.test('⭐⭐⭐⭐⭐⭐ كسر ① — حذف حدّ الثقة عند الحقن ⇒ الحارس يفشل', async () => {
    cloneCore();
    try {
      breakStateScoping();
      const broken = await loadIsolated();
      assert.equal(
        stateStoreGuarded(broken),
        false,
        'النواة المعطوبة لم تسرّب ⇒ الكسر لم يعمل ⇒ اختبار الطرد غير حاسم',
      );
    } finally {
      fs.rmSync(ISOLATED, { recursive: true, force: true });
    }
  });

  await t.test('⭐⭐⭐⭐⭐⭐ كسر ② — تعطيل حارس النطاق ⇒ الحارس يفشل', async () => {
    cloneCore(ISOLATED_SCOPE);
    try {
      breakAdminScope(ISOLATED_SCOPE);
      const broken = await loadIsolated(ISOLATED_SCOPE);
      assert.equal(
        sensitiveHandlesGuarded(broken),
        false,
        'النواة المعطوبة لم تسرّب ⇒ الكسر لم يعمل ⇒ اختبار الطرد غير حاسم',
      );
    } finally {
      fs.rmSync(ISOLATED_SCOPE, { recursive: true, force: true });
    }
  });

  await t.test('⭐⭐⭐⭐⭐ النسخ المعزولة تُحذف (لا أثر خارج المستودع)', () => {
    assert.equal(fs.existsSync(ISOLATED), false, 'بقيت نسخة معزولة على القرص');
    assert.equal(fs.existsSync(ISOLATED_SCOPE), false, 'بقيت نسخة معزولة على القرص');
  });

  await t.test('⭐⭐ صفر اتصال خارجي', () => {
    assert.equal(guard.installed, true);
    assert.deepEqual(guard.blocked, []);
  });
});

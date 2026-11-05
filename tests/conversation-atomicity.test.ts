// ============================================================
// WASL AI — اختبارات الذرّية: لا تغيير حالة ولا إسناد دون سجل تغيير مطابق
// ------------------------------------------------------------
// ⭐ **تصريح المالك (D-057 · ٥ نوفمبر ٢٠٢٦)**: ⭐ بعد ملاحظة مراجعة الرد #٢٥
//   على إمكانية كتابة جزئية بين `ConversationStateStore.setState`
//   و`ConversationChangeLog.record`.
// ⭐ **العيب كان مُثبَتاً حيّاً** (٣ حالات) ⇒ ⭐ **والإصلاح = تحقّق مُسبق كامل
//   + تراجع مُعوَّض** ⇒ ⇒ **الضمان: صفر تغيير بلا سجل تغيير مطابق**.
// ⭐ **المحاور**: ⭐ ① فشل التسجيل ⇒ لا تغيير · ② فشل التسجيل ⇒ لا إسناد ·
//   ③ مدخل غير صالح ⇒ لا كتابة · ④ النجاح ⇒ سجل واحد مطابق ·
//   ⑤ التعارض ⇒ لا أثر · ⑥ الضمان مُثبَّت في الكود (حارس بنيوي) ·
//   ⑦ صفر اتصال.
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
  ConversationChangeLog,
  ConversationStateStore,
  MessageStore,
  OrderingState,
  ProcessingLayer,
  ReadAuditLog,
  assignConversation,
  getConversationState,
  updateConversationState,
  type ConversationChangeEntry,
  type ConversationChangeInput,
  type ConversationStateDependencies,
  type TenantContext,
  type TrustedRole,
} from '../src/core/index.ts';
import {
  createSyntheticContext,
  createSyntheticEnvelope,
  syntheticEmployeeDirectory,
} from './support/index.ts';

const FIXED_NOW = '2026-01-01T00:00:00.000Z';
const ROOT = path.resolve(import.meta.dirname, '..');
const TENANT = 'tnt_synth_0001';
const REF = 'conv_synth_0001';
const EMPLOYEE = 'actor_synth_0011';

/** ⭐ سجل تغييرات **يفشل عند الكتابة** — ⭐ يحاكي سجلاً دائماً (خطوة الإنتاج القادمة). */
class FailingChangeLog extends ConversationChangeLog {
  override record(_input: ConversationChangeInput): ConversationChangeEntry {
    throw new Error('محاكاة: فشل كتابة سجل التغييرات');
  }
}

function context(role: TrustedRole, tenantIndex = 1): TenantContext {
  return createSyntheticContext(
    tenantIndex,
    tenantIndex * 10 + 1,
    100 + tenantIndex,
    1,
    () => FIXED_NOW,
    role,
  );
}

function scenario() {
  const audit = new AuditLog({ now: () => FIXED_NOW });
  const readAudit = new ReadAuditLog({ now: () => FIXED_NOW });
  const store = new MessageStore({ now: () => FIXED_NOW, audit });
  const layer = new ProcessingLayer({ store, audit, orderingState: new OrderingState() });
  const states = new ConversationStateStore({ now: () => FIXED_NOW });
  const changes = new ConversationChangeLog({ now: () => FIXED_NOW });
  const deps: ConversationStateDependencies = {
    store,
    states,
    changes,
    readAudit,
    employees: syntheticEmployeeDirectory,
  };
  return { audit, readAudit, store, layer, states, changes, deps };
}

function seed(layer: ProcessingLayer, ctx: TenantContext): void {
  layer.process(ctx, createSyntheticEnvelope({ tenantIndex: 1, messageIndex: 1 }));
}

test('١) ⭐ فشل تسجيل التغيير ⇒ لا تغيير في الحالة ولا سطر في السجل', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ الاستثناء مرمي + لا صف حالة + صفر سطر', () => {
    const { layer, deps, states, changes } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    const failing = new FailingChangeLog();
    const brokenDeps: ConversationStateDependencies = { ...deps, changes: failing };

    assert.throws(
      () => updateConversationState(ctx, REF, 'open', brokenDeps, { reason: 'فتح الطلب' }),
      /فشل كتابة سجل التغييرات/,
    );

    // ⭐ لا صف حالة على الإطلاق ⇒ لا تغيّر ولا أثر.
    assert.equal(states.get(TENANT, REF), undefined);
    assert.equal(failing.size(), 0);
  });

  await t.test('⭐⭐⭐⭐⭐ المحاولة الفاشلة لا تُسجَّل في سجل القراءة', () => {
    const { layer, deps, readAudit } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    const brokenDeps: ConversationStateDependencies = { ...deps, changes: new FailingChangeLog() };
    assert.throws(() => updateConversationState(ctx, REF, 'open', brokenDeps, { reason: 'فتح' }));
    // ⭐Process رُفض قبل التسجيل ⇒ لا حدث «allowed» ⇒ ولا أثر مضلِّل.
    const events = readAudit.eventsFor(ctx);
    assert.equal(
      events.filter((event) => event.result === 'allowed').length,
      0,
      'تسجيل حدث مسموح رغم فشل العملية ⇒ أثر مضلِّل',
    );
  });
});

test('٢) ⭐ فشل تسجيل التغيير ⇒ لا إسناد (ولا تغيير حالة)', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ الإسناد مرفوض + الحالة كما كانت + سجل واحد فقط', () => {
    const { layer, deps, states, changes } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    updateConversationState(ctx, REF, 'open', deps, { reason: 'فتح الطلب' });
    const before = getConversationState(ctx, REF, deps);
    const rowsBefore = changes.size();

    const brokenDeps: ConversationStateDependencies = { ...deps, changes: new FailingChangeLog() };
    assert.throws(
      () => assignConversation(ctx, REF, EMPLOYEE, brokenDeps, { reason: 'توزيع' }),
      /فشل كتابة سجل التغييرات/,
    );

    const after = getConversationState(ctx, REF, deps);
    assert.equal(after.state, before.state);
    assert.equal(after.version, before.version);
    assert.equal(after.assignee_actor_id, null);
    assert.equal(changes.size(), rowsBefore, 'سطر جديد في السجل رغم فشل الإسناد');
    assert.equal(states.get(TENANT, REF)?.assignee_actor_id, null);
  });
});

test('٣) ⭐ مدخل غير صالح ⇒ لا كتابة على الإطلاق (الرفض قبل `setState`)', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ `actor_id` مخالف للنمط ⇒ رفض + لا حالة + لا سجل', () => {
    const { layer, deps, states, changes } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);

    // ⭐ سياق مبنيّ يدوياً — ⭐ يتجاوز نقطة الدخول `resolveTenantContext`
    // (والنوع لا يمنع ذلك ⇒ فالفحص يجب أن يسبق أي كتابة).
    const handMade = {
      tenantId: TENANT,
      actorId: 'منفّذ غير صالح!!',
      sessionId: 'sess_synth_0101',
      conversationRef: REF,
      capabilities: ['conversation.state.read', 'conversation.state.update'],
      role: 'owner',
      issuedAt: FIXED_NOW,
    } as unknown as TenantContext;

    assert.throws(
      () => updateConversationState(handMade, REF, 'open', deps, { reason: 'فتح الطلب' }),
      (error: unknown) => (error as { code?: string }).code === 'actor_invalid',
    );

    assert.equal(states.get(TENANT, REF), undefined);
    assert.equal(changes.size(), 0);
  });

  await t.test('⭐⭐⭐⭐⭐ سبب مرفوض (يشبه سرّاً) ⇒ لا كتابة (ضمان D-056 محفوظ)', () => {
    const { layer, deps, states, changes } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    assert.throws(() =>
      updateConversationState(ctx, REF, 'open', deps, { reason: 'token=sk-abcdef123456' }),
    );
    assert.equal(states.get(TENANT, REF), undefined);
    assert.equal(changes.size(), 0);
  });
});

test('٤) ⭐ النجاح العادي ⇒ تغيير واحد + سجل واحد مطابق', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ السجل يطابق التغيير (العملية · من · إلى · الموظف · السبب)', () => {
    const { layer, deps, states, changes } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    updateConversationState(ctx, REF, 'open', deps, { reason: 'فتح الطلب' });
    assignConversation(ctx, REF, EMPLOYEE, deps, { reason: 'توزيع على خدمة العملاء' });

    const state = states.get(TENANT, REF);
    assert.equal(state?.state, 'assigned');
    assert.equal(state?.assignee_actor_id, EMPLOYEE);

    const rows = changes.changesFor(ctx);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].operation, 'state.update');
    assert.equal(rows[0].from_state, 'new');
    assert.equal(rows[0].to_state, 'open');
    assert.equal(rows[0].reason, 'فتح الطلب');
    assert.equal(rows[1].operation, 'assignment.set');
    assert.equal(rows[1].assignee_to, EMPLOYEE);
  });
});

test('٥) ⭐ التعارض (expectedVersion) ⇒ لا تغيير ولا سطر جديد', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ `state_conflict` + الحالة كما كانت + السجل كما كان', () => {
    const { layer, deps, states, changes } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    updateConversationState(ctx, REF, 'open', deps, { reason: 'فتح الطلب' });
    const before = getConversationState(ctx, REF, deps);
    const rowsBefore = changes.size();

    assert.throws(
      () =>
        updateConversationState(ctx, REF, 'pending', deps, {
          reason: 'تعارض',
          expectedVersion: before.version + 5,
        }),
      (error: unknown) => (error as { code?: string }).code === 'state_conflict',
    );

    const after = getConversationState(ctx, REF, deps);
    assert.equal(after.state, before.state);
    assert.equal(after.version, before.version);
    assert.equal(changes.size(), rowsBefore);
    assert.equal(states.get(TENANT, REF)?.state, 'open');
  });
});

test('٦) ⭐⭐⭐ الضمان مُثبَّت بنيوياً (حارس على الكود — لا على النية)', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ التحقّق المسبق قبل `setState`', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src/core/conversation-state.ts'), 'utf8');
    const guardIndex = source.indexOf('assertChangeEntry(input)');
    const setStateIndex = source.indexOf('deps.states.setState(context.tenantId, conversationRef, next)');
    assert.ok(guardIndex >= 0, 'التحقّق المسبق (assertChangeEntry) غير موجود');
    assert.ok(setStateIndex >= 0, 'كتابة الحالة غير موجودة');
    assert.ok(
      guardIndex < setStateIndex,
      'التحقّق المسبق يجب أن يسبق كتابة الحالة ⇒ ⇒ لا كتابة بلا سجل',
    );
  });

  await t.test('⭐⭐⭐⭐⭐ التراجع المُعوَّض موجود عند فشل التسجيل', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src/core/conversation-state.ts'), 'utf8');
    assert.ok(
      source.includes('deps.states.restore('),
      'التراجع المُعوَّض (restore) غير موجود ⇒ فشل التسجيل يترك تغييراً بلا سجل',
    );
    assert.ok(
      source.includes('deps.states.discard('),
      'تجاهل الصف المُنشأ (discard) غير موجود ⇒ أثر متبقٍّ بعد فشل التسجيل',
    );
  });

  await t.test('⭐⭐⭐⭐⭐ فحوص السجل في دالة واحدة (لا ازدواج ولا فجوة)', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src/core/conversation-change-log.ts'), 'utf8');
    assert.ok(
      source.includes('export function assertChangeEntry('),
      'دالة التحقّق المشترك غير موجودة ⇒ التحقّق غير مضمون قبل الكتابة',
    );
    assert.ok(
      source.includes('assertChangeEntry(input);'),
      'السجل لا يستدعي التحقّق المشترك ⇒ فجوة بين التحقّق والكتابة',
    );
  });
});

test('٧) ⭐⭐⭐⭐⭐ صفر اتصال (الحاجز مُركَّب)', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ صفر محاولة اتصال خارجية', () => {
    assert.equal(guard.installed, true);
    assert.deepEqual(guard.blocked, []);
  });
});

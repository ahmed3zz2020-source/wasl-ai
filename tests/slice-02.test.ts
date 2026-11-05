// ============================================================
// WASL AI — اختبارات الشريحة الثانية: طبقة المعالجة (Slice 02)
// ------------------------------------------------------------
// ⭐ الاختبارات الإلزامية (تصريح المالك النهائي · ٥ نوفمبر ٢٠٢٦):
//   ١) صحة عقد MessageEnvelope بعد إضافة الحقل
//   ٢) رفض معرّفات المحادثة غير الموثوقة أو غير الصالحة
//   ٣) منع خلط المحادثات داخل المستأجر الواحد
//   ٤) منع الوصول العابر بين المستأجرين
//   ٥) قبول الرسائل بالترتيب الصحيح
//   ٦) تأجيل الرسائل الأقدم والمتساوية في التوقيت
//   ٧) عدم تغيير حالة الترتيب عند التأجيل
//   ٨) استمرار منع تكرار message_ref
//   ٩) التوافق مع Slice 01 وAuditOutcome بما فيه deferred
//  ١٠) عدم تسجيل أسرار أو بيانات حساسة
//  ١١) عدم وجود اتصالات خارجية
// ⭐ + اختبار عقد نتيجة المعالجة + ⭐ اختبار منع التصنيف.
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
  AuditLogError,
  ENVELOPE_RULES,
  MessageStore,
  PROCESSING_OUTCOME_RULES,
  ProcessingLayer,
  ProcessingOutcomeError,
  TenantContextError,
  evaluateOrdering,
  parseProcessingOutcome,
  resolveTenantContext,
  validateEnvelope,
  validateProcessingOutcome,
  type ProcessingOutcome,
  type SessionClaims,
  type SessionSource,
  type VerifiedIdentity,
} from '../src/core/index.ts';
import { registerSessionSource } from '../src/core/session.ts';
// ⭐ أدوات الاختبار موجودة في شجرة الاختبار ⇒ خارج حزمة الإنتاج
import {
  createSyntheticContext,
  createSyntheticConversationRef,
  createSyntheticEnvelope,
  createSyntheticSession,
  localTestSessionSource,
} from './support/index.ts';

const FIXED_NOW = '2026-01-01T00:00:00.000Z';
const ROOT = path.resolve(import.meta.dirname, '..');

/** ⭐ رسالة اصطناعية بتوقيت محدَّد (واختيارياً محادثة مختلفة). */
function envelopeAt(
  messageIndex: number,
  occurredAt: string,
  options: {
    tenantIndex?: number;
    conversationIndex?: number;
    conversationRef?: string;
    declaredTenantId?: string;
  } = {},
) {
  const base = createSyntheticEnvelope({
    tenantIndex: options.tenantIndex ?? 1,
    messageIndex,
    ...(options.declaredTenantId === undefined ? {} : { declaredTenantId: options.declaredTenantId }),
    ...(options.conversationIndex === undefined ? {} : { conversationIndex: options.conversationIndex }),
    ...(options.conversationRef === undefined ? {} : { conversationRef: options.conversationRef }),
  });
  return { ...base, occurred_at: occurredAt };
}

test('١) عقد MessageEnvelope بعد إضافة معرّف المحادثة', async (t) => {
  await t.test('⭐ الحقل مُعلَن في جدول القواعد وإجباري', () => {
    const rule = ENVELOPE_RULES.conversation_ref;
    assert.ok(rule, 'الحقل غير مُعلَن في ENVELOPE_RULES');
    assert.equal(rule.required, true);
    assert.ok(rule.pattern, 'لا نمط للحقل');
  });

  await t.test('الرسالة الصالحة (فيها محادثة) تُقبل ويُرجَع الحقل', () => {
    const envelope = createSyntheticEnvelope({ tenantIndex: 1, messageIndex: 1 });
    const result = validateEnvelope(envelope);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.conversation_ref, createSyntheticConversationRef(1));
  });

  await t.test('⭐ محادثة مفقودة ⇒ رفض بقاعدة «required»', () => {
    const envelope = { ...createSyntheticEnvelope({ tenantIndex: 1, messageIndex: 2 }) } as Record<
      string,
      unknown
    >;
    delete envelope.conversation_ref;
    const result = validateEnvelope(envelope);
    assert.equal(result.ok, false);
    if (result.ok) return;
    const match = result.errors.find(
      (error) => error.field === 'conversation_ref' && error.rule === 'required',
    );
    assert.ok(match, `لم تُسجَّل قاعدة required: ${JSON.stringify(result.errors)}`);
  });

  await t.test('⭐ محادثة بصيغة خاطئة ⇒ رفض بقاعدة «pattern»', () => {
    const envelope = {
      ...createSyntheticEnvelope({ tenantIndex: 1, messageIndex: 3 }),
      conversation_ref: 'محادثة غير صالحة!',
    };
    const result = validateEnvelope(envelope);
    assert.equal(result.ok, false);
    if (result.ok) return;
    const match = result.errors.find(
      (error) => error.field === 'conversation_ref' && error.rule === 'pattern',
    );
    assert.ok(match, `لم تُسجَّل قاعدة pattern: ${JSON.stringify(result.errors)}`);
  });
});

test('٢) رفض معرّفات المحادثة غير الموثوقة أو غير الصالحة', async (t) => {
  await t.test('⭐ ادّعاءات خام بمحادثة ⇒ مرفوض (لا إثبات provenance)', () => {
    const forged = {
      session_id: 'sess_forged_0001',
      tenant_id: 'tnt_synth_0001',
      actor_id: 'actor_synth_0001',
      conversation_ref: 'conv_synth_0001',
      authenticated: true,
    };
    assert.throws(
      () => resolveTenantContext(forged, { source: localTestSessionSource }),
      (error: unknown) => {
        assert.ok(error instanceof TenantContextError);
        assert.equal(error.code, 'session_unverified');
        return true;
      },
    );
  });

  await t.test('⭐ نسخة من جلسة صحيحة الشكل ⇒ مرفوض (النَسَب لا الشكل)', () => {
    const genuine = createSyntheticSession(1, 11, 101);
    const copied = { ...genuine };
    assert.deepEqual(copied, genuine, 'النسخة متطابقة الشكل');
    assert.throws(
      () => resolveTenantContext(copied, { source: localTestSessionSource }),
      (error: unknown) => {
        assert.ok(error instanceof TenantContextError);
        assert.equal(error.code, 'session_unverified');
        return true;
      },
    );
  });

  await t.test('⭐ مصدر يعيد محادثة بصيغة خاطئة ⇒ رفض عند بناء السياق', () => {
    // ⭐ مصدر اختباري ينفّذ عقد الإنتاج ⇒ ثم حدّ الثقة يرفض الصيغة.
    const looseSource: SessionSource = {
      id: 'test-loose-source',
      scope: 'test',
      description: 'مصدر اختباري يعيد هوية بلا فحص شكل (لاختبار حدّ الثقة)',
      verify: (): VerifiedIdentity => ({
        session_id: 'sess_loose_0001',
        tenant_id: 'tnt_synth_0001',
        actor_id: 'actor_synth_0001',
        conversation_ref: 'محادثة غير صالحة!',
        authenticated: true,
      }),
    };
    // ⭐ المصدر مسجّل (سلطة المالك) ⇒ ⭐ والشكل يُفحص في النواة.
    registerSessionSource({ source: looseSource, grantedRole: 'none', grantCeiling: [] });
    assert.throws(
      () => resolveTenantContext({}, { source: looseSource }),
      (error: unknown) => {
        assert.ok(error instanceof TenantContextError);
        assert.equal(error.code, 'conversation_invalid');
        return true;
      },
    );
  });

  await t.test('⭐ رسالة بمحادثة غير مطابقة للسياق ⇒ رفض صريح', () => {
    const context = createSyntheticContext(1, 11, 101, 1);
    const store = new MessageStore();
    const audit = new AuditLog({ now: () => FIXED_NOW });
    const outcome = new ProcessingLayer({ store, audit }).process(
      context,
      envelopeAt(10, '2026-01-02T10:00:00.000Z', { conversationIndex: 2 }),
    );
    assert.equal(outcome.decision, 'rejected');
    assert.equal(outcome.reason_code, 'conversation_mismatch');
    assert.equal(store.countFor(context), 0, 'الرسالة لم تُخزَّن');
  });
});

test('٣) منع خلط المحادثات داخل المستأجر الواحد', async (t) => {
  await t.test('⭐ محادثتان في نفس المستأجر ⇒ لا تختلط حالة الترتيب بينهما', () => {
    const store = new MessageStore();
    const audit = new AuditLog({ now: () => FIXED_NOW });
    const layer = new ProcessingLayer({ store, audit });
    const convA = createSyntheticContext(1, 11, 101, 1);
    const convB = createSyntheticContext(1, 12, 102, 2);

    const inA = layer.process(convA, envelopeAt(21, '2026-01-05T10:00:00.000Z', { conversationIndex: 1 }));
    assert.equal(inA.decision, 'accepted');

    // ⭐ رسالة في محادثة أخرى بتوقيت أقدم ⇒ تُقبل (نطاقها مستقل)
    const inB = layer.process(convB, envelopeAt(22, '2026-01-01T10:00:00.000Z', { conversationIndex: 2 }));
    assert.equal(inB.decision, 'accepted', 'محادثة أخرى لا تتأثر بحالة الأولى');
    assert.equal(inB.reason_code, 'accepted_in_order');
  });

  await t.test('⭐ رسالة تعلن محادثة غير محادثة الجلسة ⇒ رفض', () => {
    const store = new MessageStore();
    const audit = new AuditLog({ now: () => FIXED_NOW });
    const layer = new ProcessingLayer({ store, audit });
    const convA = createSyntheticContext(1, 11, 101, 1);
    const outcome = layer.process(
      convA,
      envelopeAt(23, '2026-01-02T10:00:00.000Z', { conversationRef: createSyntheticConversationRef(9) }),
    );
    assert.equal(outcome.decision, 'rejected');
    assert.equal(outcome.reason_code, 'conversation_mismatch');
    assert.equal(store.countFor(convA), 0);
  });
});

test('٤) منع الوصول العابر بين المستأجرين — ١٠٠ محاولة عدائية ⇒ صفر تسريب', async (t) => {
  const tenantA = createSyntheticContext(1, 11, 101, 1);
  const tenantB = createSyntheticContext(2, 22, 202, 1);
  const store = new MessageStore();
  const audit = new AuditLog({ now: () => FIXED_NOW });

  await t.test('معالجة رسالة في نطاق مستأجر ⇒ لا أثر في نطاق آخر', () => {
    const layer = new ProcessingLayer({ store, audit });
    const outcome = layer.process(
      tenantA,
      createSyntheticEnvelope({ tenantIndex: 1, messageIndex: 1 }),
    );
    assert.equal(outcome.decision, 'accepted');
    assert.equal(store.countFor(tenantA), 1);
    assert.equal(store.countFor(tenantB), 0);
  });

  await t.test('⭐ الاختبار المعاكس: المستأجر الآخر لا يرى بيانات المستأجر الأول', () => {
    const leaked = store.list(tenantB).filter((row) => row.tenant_id !== tenantB.tenantId);
    assert.equal(leaked.length, 0, 'تسريب: بيانات مستأجر ظهرت لمستأجر آخر');
    assert.equal(store.getByRef(tenantB, 'synth-msg-000001'), undefined);
    assert.equal(store.list(tenantA).length, 1, 'البيانات موجودة فعلاً في نطاق صاحبها');
  });

  await t.test('⭐ انتحال Tenant ID داخل الحمولة ⇒ رفض صريح بلا تخزين', () => {
    const layer = new ProcessingLayer({ store, audit });
    const spoofed = createSyntheticEnvelope({
      tenantIndex: 2,
      messageIndex: 9,
      declaredTenantId: tenantA.tenantId,
    });
    const outcome = layer.process(tenantB, spoofed);
    assert.equal(outcome.decision, 'rejected');
    assert.equal(outcome.reason_code, 'tenant_mismatch');
    assert.equal(store.countFor(tenantB), 0, 'الرسالة المنتحلة لم تُخزَّن');
    assert.equal(store.countFor(tenantA), 1, 'لم تُزد بيانات المستأجر الأول');
  });

  await t.test('⭐ نفس معرّف المحادثة في مستأجرين ⇒ لا تختلط حالة الترتيب', () => {
    const localStore = new MessageStore();
    const localAudit = new AuditLog({ now: () => FIXED_NOW });
    const layer = new ProcessingLayer({ store: localStore, audit: localAudit });
    const a = createSyntheticContext(1, 11, 101, 1);
    const b = createSyntheticContext(2, 22, 202, 1); // ⭐ نفس المحادثة — مستأجر مختلف
    assert.equal(a.conversationRef, b.conversationRef, 'نفس المحادثة عمداً');

    const inA = layer.process(a, envelopeAt(31, '2026-01-05T10:00:00.000Z'));
    assert.equal(inA.decision, 'accepted');
    const inB = layer.process(b, envelopeAt(32, '2026-01-01T10:00:00.000Z'));
    assert.equal(inB.decision, 'accepted', 'حالة المستأجر الأول لا تسرّب للمستأجر الثاني');
  });

  await t.test('⭐ ١٠٠ محاولة عدائية ⇒ صفر تسريب', () => {
    const localStore = new MessageStore();
    const localAudit = new AuditLog({ now: () => FIXED_NOW });
    const layer = new ProcessingLayer({ store: localStore, audit: localAudit });
    // ⭐ بيانات المستأجر الأول موجودة فعلاً ⇒ أي تغيّر فيها = تسريب
    layer.process(
      tenantA,
      createSyntheticEnvelope({ tenantIndex: 1, messageIndex: 1900 }),
    );
    assert.equal(localStore.countFor(tenantA), 1, 'البذرة لم تُخزَّن');
    let leaks = 0;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const attacker = createSyntheticContext(2, 99, 900 + attempt, 1);
      const spoof = createSyntheticEnvelope({
        tenantIndex: 2,
        messageIndex: 2000 + attempt,
        declaredTenantId: tenantA.tenantId,
      });
      const outcome = layer.process(attacker, spoof);
      if (outcome.decision !== 'rejected') leaks += 1;
      const foreign = localStore.list(attacker).filter((row) => row.tenant_id !== attacker.tenantId);
      leaks += foreign.length;
      if (localStore.countFor(tenantA) !== 1) leaks += 1;
    }
    assert.equal(leaks, 0, 'تسريب في المحاولات العدائية');
  });

  await t.test('⭐ لا دالة في طبقة المعالجة تقبل معرّف مستأجر كوسيط', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src/core/processing.ts'), 'utf8');
    const signatures = source.match(/export function \w+\(([^)]*)\)/g) ?? [];
    assert.ok(signatures.length > 0, 'لم يُعثر على أي دالة معلنة');
    for (const signature of signatures) {
      assert.ok(!/tenant_?id/i.test(signature), `دالة تقبل معرّف مستأجر كوسيط: ${signature}`);
    }
  });

  await t.test('⭐ سياق غائب ⇒ رفض صريح (لا مسار افتراضي)', () => {
    const layer = new ProcessingLayer({ store, audit });
    const outcome = layer.process(
      undefined,
      createSyntheticEnvelope({ tenantIndex: 1, messageIndex: 30 }),
    );
    assert.equal(outcome.decision, 'rejected');
    assert.equal(outcome.reason_code, 'tenant_context_missing');
  });
});

test('٥) قبول الرسائل بالترتيب الصحيح', async (t) => {
  await t.test('⭐ أول رسالة في المحادثة ⇒ تُقبل', () => {
    const store = new MessageStore();
    const audit = new AuditLog({ now: () => FIXED_NOW });
    const layer = new ProcessingLayer({ store, audit });
    const context = createSyntheticContext(1, 11, 101, 1);
    const outcome = layer.process(context, envelopeAt(41, '2026-01-01T10:00:00.000Z'));
    assert.equal(outcome.decision, 'accepted');
    assert.equal(outcome.reason_code, 'accepted_in_order');
  });

  await t.test('⭐ رسائل متتالية بتوقيت متزايد ⇒ كلها تُقبل', () => {
    const store = new MessageStore();
    const audit = new AuditLog({ now: () => FIXED_NOW });
    const layer = new ProcessingLayer({ store, audit });
    const context = createSyntheticContext(1, 11, 101, 1);
    const stamps = [
      '2026-01-01T10:00:00.000Z',
      '2026-01-02T10:00:00.000Z',
      '2026-01-03T10:00:00.000Z',
      '2026-01-04T10:00:00.000Z',
    ];
    stamps.forEach((stamp, index) => {
      const outcome = layer.process(context, envelopeAt(50 + index, stamp));
      assert.equal(outcome.decision, 'accepted', `الرسالة ${index} لم تُقبل`);
      assert.equal(outcome.reason_code, 'accepted_in_order');
    });
    assert.equal(store.countFor(context), 4);
  });
});

test('٦) تأجيل الرسائل الأقدم والمتساوية في التوقيت', async (t) => {
  await t.test('⭐ الأقدم من آخر مقبول ⇒ تأجيل (ولا رفض نهائي)', () => {
    const store = new MessageStore();
    const audit = new AuditLog({ now: () => FIXED_NOW });
    const layer = new ProcessingLayer({ store, audit });
    const context = createSyntheticContext(1, 11, 101, 1);
    layer.process(context, envelopeAt(61, '2026-01-05T10:00:00.000Z'));
    const older = layer.process(context, envelopeAt(62, '2026-01-01T10:00:00.000Z'));
    assert.equal(older.decision, 'deferred');
    assert.equal(older.reason_code, 'deferred_out_of_order');
    assert.equal(store.countFor(context), 1, 'الرسالة المؤجلة لم تُخزَّن');
  });

  await t.test('⭐ تساوي التوقيت لرسالتين مختلفتين ⇒ الثانية تُؤجَّل بلا ترتيب اعتباطي', () => {
    const store = new MessageStore();
    const audit = new AuditLog({ now: () => FIXED_NOW });
    const layer = new ProcessingLayer({ store, audit });
    const context = createSyntheticContext(1, 11, 101, 1);
    const first = layer.process(context, envelopeAt(63, '2026-01-06T10:00:00.000Z'));
    assert.equal(first.decision, 'accepted');
    const second = layer.process(context, envelopeAt(64, '2026-01-06T10:00:00.000Z'));
    assert.equal(second.decision, 'deferred');
    assert.equal(second.reason_code, 'deferred_equal_timestamp');
    assert.equal(store.countFor(context), 1);
  });

  await t.test('⭐ حالة خارج القواعد المغلقة ⇒ تأجيل لا تخمين (فحص القاعدة مباشرة)', () => {
    const decision = evaluateOrdering({
      occurredAt: 'غير-تاريخ',
      messageRef: 'synth-msg-000099',
      lastAccepted: { occurred_at: '2026-01-07T10:00:00.000Z', message_ref: 'synth-msg-000061' },
    });
    assert.equal(decision.outcome, 'deferred');
    assert.equal(decision.reason_code, 'deferred_unknown');
  });
});

test('٧) عدم تغيير حالة الترتيب عند التأجيل', async (t) => {
  await t.test('⭐ رسالة مؤجلة لا تُرجع نقطة القبول للخلف', () => {
    const store = new MessageStore();
    const audit = new AuditLog({ now: () => FIXED_NOW });
    const layer = new ProcessingLayer({ store, audit });
    const context = createSyntheticContext(1, 11, 101, 1);

    layer.process(context, envelopeAt(71, '2026-01-05T10:00:00.000Z'));
    const deferred = layer.process(context, envelopeAt(72, '2026-01-01T10:00:00.000Z'));
    assert.equal(deferred.decision, 'deferred');

    // ⭐ رسالة بين النقطة المقبولة وتوقيت الرسالة المؤجلة ⇒ تُؤجَّل (النقطة لم ترجع)
    const between = layer.process(context, envelopeAt(73, '2026-01-02T10:00:00.000Z'));
    assert.equal(between.decision, 'deferred');
    assert.equal(between.reason_code, 'deferred_out_of_order');

    // ⭐ وبعدها رسالة أحدث من النقطة المقبولة ⇒ تُقبل
    const next = layer.process(context, envelopeAt(74, '2026-01-06T10:00:00.000Z'));
    assert.equal(next.decision, 'accepted');
    assert.equal(next.reason_code, 'accepted_in_order');
  });

  await t.test('⭐ رسالة مرفوضة (انتحال) لا تُغيّر حالة الترتيب', () => {
    const store = new MessageStore();
    const audit = new AuditLog({ now: () => FIXED_NOW });
    const layer = new ProcessingLayer({ store, audit });
    const context = createSyntheticContext(1, 11, 101, 1);
    const other = createSyntheticContext(2, 22, 202, 1);

    const spoofed = layer.process(
      context,
      {
        ...envelopeAt(75, '2026-01-20T10:00:00.000Z'),
        declared_tenant_id: other.tenantId,
      },
    );
    assert.equal(spoofed.decision, 'rejected');
    assert.equal(spoofed.reason_code, 'tenant_mismatch');

    const accepted = layer.process(context, envelopeAt(76, '2026-01-02T10:00:00.000Z'));
    assert.equal(accepted.decision, 'accepted');
    assert.equal(accepted.reason_code, 'accepted_in_order');
  });
});

test('٨) استمرار منع تكرار message_ref', async (t) => {
  await t.test('التكرار ⇒ رفض بنوع سبب معلن', () => {
    const store = new MessageStore();
    const audit = new AuditLog({ now: () => FIXED_NOW });
    const layer = new ProcessingLayer({ store, audit });
    const context = createSyntheticContext(1, 11, 101, 1);
    const envelope = createSyntheticEnvelope({ tenantIndex: 1, messageIndex: 7 });

    const first = layer.process(context, envelope);
    assert.equal(first.decision, 'accepted');
    const second = layer.process(context, envelope);
    assert.equal(second.decision, 'rejected');
    assert.equal(second.reason_code, 'message_ref_duplicate');
    assert.equal(store.countFor(context), 1, 'التكرار لم يُخزَّن مرتين');
  });

  await t.test('⭐ نطاق التكرار داخل المستأجر فقط — لا تصادم بين المستأجرين', () => {
    const store = new MessageStore();
    const audit = new AuditLog({ now: () => FIXED_NOW });
    const layer = new ProcessingLayer({ store, audit });
    const tenantA = createSyntheticContext(1, 11, 101, 1);
    const tenantB = createSyntheticContext(2, 22, 202, 1);
    const envelope = createSyntheticEnvelope({ tenantIndex: 1, messageIndex: 8 });

    const inA = layer.process(tenantA, envelope);
    const inB = layer.process(tenantB, envelope);
    assert.equal(inA.decision, 'accepted');
    assert.equal(inB.decision, 'accepted', 'المعرّف نفسه في مستأجر آخر = لا تصادم');
    assert.equal(store.countFor(tenantA), 1);
    assert.equal(store.countFor(tenantB), 1);
  });
});

test('٩) التوافق مع Slice 01 وAuditOutcome بما فيه deferred', async (t) => {
  await t.test('⭐ نتائج سجل التدقيق تشمل deferred مع القيم القديمة', () => {
    const audit = new AuditLog({ now: () => FIXED_NOW });
    for (const outcome of ['accepted', 'rejected', 'duplicate', 'deferred'] as const) {
      const entry = audit.record({
        tenant_id: 'tnt_synth_0001',
        actor_id: 'actor_synth_0001',
        operation: 'message.process',
        outcome,
      });
      assert.equal(entry.outcome, outcome);
    }
    assert.equal(audit.size(), 4);
  });

  await t.test('⭐ عقد النتيجة يعلن كل الأسباب الممكنة', () => {
    const reasons = PROCESSING_OUTCOME_RULES.reason_code.oneOf;
    for (const code of [
      'accepted_in_order',
      'envelope_invalid',
      'tenant_mismatch',
      'conversation_mismatch',
      'tenant_context_missing',
      'message_ref_duplicate',
      'deferred_out_of_order',
      'deferred_equal_timestamp',
      'deferred_unknown',
    ]) {
      assert.ok(reasons.includes(code), `السبب غير مُعلَن: ${code}`);
    }
  });

  await t.test('⭐ عقد النتيجة: صالحة تُقبل · غير صالحة تُرفض بقاعدة معلنة', async (t2) => {
    const valid: ProcessingOutcome = {
      decision: 'accepted',
      reason_code: 'accepted_in_order',
      message_ref: 'synth-msg-000001',
      occurred_at: '2026-01-01T12:00:00.000Z',
      tenant_id: 'tnt_synth_0001',
    };
    const result = validateProcessingOutcome(valid);
    assert.equal(result.ok, true);

    const invalidCases: Array<{ patch: Record<string, unknown>; field: string; rule: string }> = [
      { patch: { decision: 'maybe' }, field: 'decision', rule: 'enum' },
      { patch: { reason_code: 'because' }, field: 'reason_code', rule: 'enum' },
      { patch: { decision: 5 }, field: 'decision', rule: 'type' },
      { patch: { tenant_id: undefined }, field: 'tenant_id', rule: 'required' },
      { patch: { tenant_id: 'BAD TENANT' }, field: 'tenant_id', rule: 'pattern' },
      { patch: { occurred_at: '2026-01-01T12:00:00+02:00' }, field: 'occurred_at', rule: 'pattern' },
      { patch: { occurred_at: '2026-13-45T00:00:00.000Z' }, field: 'occurred_at', rule: 'parse' },
      { patch: { message_ref: 'msg ref!' }, field: 'message_ref', rule: 'pattern' },
    ];
    for (const testCase of invalidCases) {
      await t2.test(`تُرفض ⇒ قاعدة «${testCase.rule}» على ${testCase.field}`, () => {
        const outcome = validateProcessingOutcome({ ...valid, ...testCase.patch });
        assert.equal(outcome.ok, false, 'المتوقّع رفض النتيجة');
        if (outcome.ok) return;
        const match = outcome.errors.find(
          (error) => error.field === testCase.field && error.rule === testCase.rule,
        );
        assert.ok(match, `لم تُسجَّل قاعدة ${testCase.rule}: ${JSON.stringify(outcome.errors)}`);
      });
    }

    await t2.test('parseProcessingOutcome يرمي خطأ يحمل قائمة الأخطاء', () => {
      assert.throws(
        () => parseProcessingOutcome({ ...valid, decision: 'maybe' }),
        (error: unknown) => {
          assert.ok(error instanceof ProcessingOutcomeError);
          assert.ok(error.errors.length > 0);
          return true;
        },
      );
    });
  });

  await t.test('⭐ الحقول القديمة للعقد ما زالت كما هي (توافق مع Slice 01)', () => {
    for (const field of [
      'schema_version',
      'message_ref',
      'channel',
      'direction',
      'from',
      'to',
      'body',
      'occurred_at',
      'locale',
      'attributes',
    ]) {
      assert.ok(ENVELOPE_RULES[field], `الحقل ${field} اختفى من العقد`);
    }
  });
});

test('١٠) أمان أثر التدقيق: سطر واحد لكل عملية · بلا نص رسالة · بلا أسرار', async (t) => {
  const context = createSyntheticContext(1, 11, 101, 1);
  const store = new MessageStore();
  const audit = new AuditLog({ now: () => FIXED_NOW });
  const layer = new ProcessingLayer({ store, audit });

  await t.test('أربع عمليات معالجة ⇒ أربعة أسطر معالجة', () => {
    layer.process(context, createSyntheticEnvelope({ tenantIndex: 1, messageIndex: 1 }));
    layer.process(context, { ...createSyntheticEnvelope({ tenantIndex: 1, messageIndex: 2 }), body: '' });
    layer.process(context, createSyntheticEnvelope({ tenantIndex: 1, messageIndex: 3 }));
    layer.process(context, createSyntheticEnvelope({ tenantIndex: 1, messageIndex: 3 }));

    const entries = audit.entries();
    assert.equal(audit.size(), 4);
    assert.equal(audit.toJsonl().split('\n').length, 4);
    for (const entry of entries) {
      assert.equal(entry.operation, 'message.process');
      assert.ok(entry.tenant_id.length > 0);
      assert.ok(entry.actor_id.length > 0);
      assert.ok(entry.reason_code && entry.reason_code.length > 0, 'السبب مسجَّل');
      assert.ok(['accepted', 'rejected', 'deferred', 'duplicate'].includes(entry.outcome));
    }
  });

  await t.test('⭐ التأجيل مسجَّل بسطر وسبب معلن', () => {
    const localAudit = new AuditLog({ now: () => FIXED_NOW });
    const localStore = new MessageStore();
    const localLayer = new ProcessingLayer({ store: localStore, audit: localAudit });
    const localContext = createSyntheticContext(1, 11, 101, 1);
    localLayer.process(localContext, envelopeAt(81, '2026-01-09T10:00:00.000Z'));
    localLayer.process(localContext, envelopeAt(82, '2026-01-01T10:00:00.000Z'));

    const deferred = localAudit.entries().filter((entry) => entry.outcome === 'deferred');
    assert.equal(deferred.length, 1);
    assert.equal(deferred[0].reason_code, 'deferred_out_of_order');
  });

  await t.test('⭐ نص الرسالة (منه السرّ) لا يصل إلى سجل المعالجة إطلاقاً', () => {
    const fakeSecret = ['sk', 'A'.repeat(24)].join('-');
    const localAudit = new AuditLog({ now: () => FIXED_NOW });
    const localStore = new MessageStore();
    const localLayer = new ProcessingLayer({ store: localStore, audit: localAudit });
    const outcome = localLayer.process(
      context,
      createSyntheticEnvelope({
        tenantIndex: 1,
        messageIndex: 83,
        seed: 5,
        body: `نص اصطناعي فيه شكل سر ${fakeSecret}`,
      }),
    );
    assert.equal(outcome.decision, 'accepted');
    const jsonl = localAudit.toJsonl();
    assert.ok(!jsonl.includes(fakeSecret), 'سرّ ظاهر في سجل المعالجة');
    assert.ok(!jsonl.includes('نص اصطناعي'), 'نص الرسالة ظاهر في سجل المعالجة');
  });

  await t.test('⭐ لا بريد ولا رقم ولا هاتف في سجل المعالجة', () => {
    const jsonl = audit.toJsonl();
    assert.ok(!jsonl.includes('@'), 'بريد في السجل');
    assert.ok(!/\b\d{14}\b/.test(jsonl), 'رقم قومي في السجل');
    assert.ok(!/\+201[0-9]{9}/.test(jsonl), 'هاتف في السجل');
  });

  await t.test('⭐ أي مفتاح تفاصيل خارج قائمة السماح يُرفض', () => {
    assert.throws(
      () =>
        audit.record({
          tenant_id: context.tenantId,
          actor_id: context.actorId,
          operation: 'message.process',
          outcome: 'accepted',
          meta: { body: 'محتوى الرسالة' },
        }),
      (error: unknown) => {
        assert.ok(error instanceof AuditLogError);
        assert.equal(error.code, 'meta_key_forbidden');
        return true;
      },
    );
  });
});

test('١١) لا اتصالات خارجية ولا أسرار ولا بيانات حقيقية', async (t) => {
  const NETWORK_TOKENS: readonly string[] = [
    'fetch(',
    'XMLHttpRequest',
    'WebSocket',
    'EventSource',
    'sendBeacon',
    'node:http',
    'node:https',
    'node:net',
    'node:dns',
    'node:tls',
    'node:child_process',
    'axios',
    'process.env',
  ];

  await t.test('⭐ فحص ساكن لملفات الشريحة الثانية: صفر رمز شبكة', () => {
    const hits: string[] = [];
    for (const name of ['processing.ts', 'ordering.ts']) {
      const text = fs.readFileSync(path.join(ROOT, 'src/core', name), 'utf8');
      for (const token of NETWORK_TOKENS) {
        if (text.includes(token)) hits.push(`${name} ⇒ ${token}`);
      }
      if (/\bimport\s*\(/.test(text)) hits.push(`${name} ⇒ import ديناميكي`);
    }
    assert.deepEqual(hits, [], `رموز شبكة في الشريحة الثانية: ${hits.join(' , ')}`);
  });

  await t.test('⭐ فحص وقت التشغيل: لا بيانات حقيقية في أثر المعالجة', () => {
    const context = createSyntheticContext(1, 11, 101, 1);
    const store = new MessageStore();
    const audit = new AuditLog({ now: () => FIXED_NOW });
    const layer = new ProcessingLayer({ store, audit });
    layer.process(context, createSyntheticEnvelope({ tenantIndex: 1, messageIndex: 1 }));
    const jsonl = audit.toJsonl();
    assert.ok(!jsonl.includes('@'), 'بريد في سجل المعالجة');
    assert.ok(!/\b\d{14}\b/.test(jsonl), 'رقم قومي في سجل المعالجة');
    assert.ok(!/\+201[0-9]{9}/.test(jsonl), 'هاتف في سجل المعالجة');
    for (const row of store.list(context)) {
      assert.ok(row.from.endsWith('@example.invalid'), 'عنوان غير اصطناعي');
      assert.ok(row.to.endsWith('@example.invalid'), 'عنوان غير اصطناعي');
      assert.ok(row.tenant_id.startsWith('tnt_synth_'), 'معرّف مستأجر غير اصطناعي');
    }
  });

  await t.test('⭐ الحاجز مُركَّب وصفر محاولة اتصال', () => {
    assert.equal(guard.installed, true, 'الحاجز غير مُركَّب');
    assert.equal(guard.blocked.length, 0, `محاولات اتصال: ${guard.blocked.join(' , ')}`);
  });

  await t.test('⭐ لا كود في الشريحة الثانية يذكر فئة رسالة', () => {
    const forbidden = [
      'billing',
      'invoice',
      'payment_request',
      'sales',
      'marketing',
      'urgency',
      'priority',
      'category',
      'classify',
      'classification',
    ];
    const hits: string[] = [];
    for (const name of ['processing.ts', 'ordering.ts']) {
      const text = fs.readFileSync(path.join(ROOT, 'src/core', name), 'utf8');
      for (const token of forbidden) {
        if (text.toLowerCase().includes(token)) hits.push(`${name} ⇒ ${token}`);
      }
    }
    assert.deepEqual(hits, [], `فئات رسائل داخل الشريحة الثانية: ${hits.join(' , ')}`);
  });
});

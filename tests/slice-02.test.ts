// ============================================================
// WASL AI — اختبارات الشريحة الثانية: طبقة المعالجة (Slice 02)
// ------------------------------------------------------------
// ⭐ الاختبارات الخمسة في `docs/SECOND-SLICE-PROPOSAL.md` §٣:
//   ١) صحة عقد النتيجة (ProcessingOutcome)
//   ٢) منع الوصول العابر بين المستأجرين (١٠٠ محاولة عدائية)
//   ٣) سلوك التكرار والترتيب والتأجيل
//   ٤) أمان أثر التدقيق
//   ٥) لا اتصالات خارجية ولا أسرار ولا بيانات حقيقية
// ⭐ + اختبار صريح: ⭐ **لا كود في الشريحة الثانية يذكر فئة رسالة**.
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
  MessageStore,
  PROCESSING_OUTCOME_RULES,
  ProcessingOutcomeError,
  evaluateOrdering,
  parseProcessingOutcome,
  ProcessingLayer,
  validateProcessingOutcome,
  type OrderingScopeResolver,
  type ProcessingOutcome,
} from '../src/core/index.ts';
// ⭐ أدوات الاختبار موجودة في شجرة الاختبار ⇒ خارج حزمة الإنتاج
import {
  createSyntheticContext,
  createSyntheticEnvelope,
} from './support/index.ts';

const FIXED_NOW = '2026-01-01T00:00:00.000Z';
const ROOT = path.resolve(import.meta.dirname, '..');

/** ⭐ مُحلِّل نطاق اختباري — ⭐ النطاق من بيانات الاختبار نفسها (لا حقل في العقد). */
function scopeResolver(map: Map<string, string>): OrderingScopeResolver {
  return {
    id: 'test-scope-resolver',
    description: 'مُحلِّل نطاق اختباري — النطاق من خريطة اختبار خارجية',
    resolve: (_context, envelope) => map.get(envelope.message_ref) ?? null,
  };
}

/** ⭐ رسالة تنتحل معرّف مستأجر آخر (تُرفض ⇒ ولا أثر على حالة الترتيب). */
function processSpoofed(
  context: ReturnType<typeof createSyntheticContext>,
  other: ReturnType<typeof createSyntheticContext>,
  layer: ProcessingLayer,
) {
  return layer.process(
    context,
    {
      ...createSyntheticEnvelope({ tenantIndex: 1, messageIndex: 64 }),
      occurred_at: '2026-01-20T10:00:00.000Z',
      declared_tenant_id: other.tenantId,
    },
  );
}

function envelopeAt(messageIndex: number, occurredAt: string, tenantIndex = 1) {
  return {
    ...createSyntheticEnvelope({ tenantIndex, messageIndex }),
    occurred_at: occurredAt,
  };
}

test('١) عقد النتيجة: صالحة تُقبَل · غير صالحة تُرفض بقاعدة معلنة', async (t) => {
  const valid: ProcessingOutcome = {
    decision: 'accepted',
    reason_code: 'accepted_in_order',
    message_ref: 'synth-msg-000001',
    occurred_at: '2026-01-01T12:00:00.000Z',
    tenant_id: 'tnt_synth_0001',
  };

  await t.test('نتيجة صالحة ⇒ تُقبل', () => {
    const result = validateProcessingOutcome(valid);
    assert.equal(result.ok, true);
    assert.equal(result.value.decision, 'accepted');
    assert.equal(result.value.reason_code, 'accepted_in_order');
  });

  await t.test('كل قرارات المعالجة الثلاثة داخل المجموعة المغلقة', () => {
    const decisions = PROCESSING_OUTCOME_RULES.decision.oneOf;
    assert.deepEqual([...decisions], ['accepted', 'rejected', 'deferred']);
  });

  await t.test('كل سبب ممكن مُعلَن في جدول القواعد', () => {
    const reasons = PROCESSING_OUTCOME_RULES.reason_code.oneOf;
    for (const code of [
      'accepted_in_order',
      'accepted_no_ordering_scope',
      'envelope_invalid',
      'tenant_mismatch',
      'tenant_context_missing',
      'message_ref_duplicate',
      'deferred_out_of_order',
      'deferred_equal_timestamp',
      'deferred_unknown',
    ]) {
      assert.ok(reasons.includes(code), `السبب غير مُعلَن: ${code}`);
    }
  });

  const invalidCases: Array<{
    name: string;
    patch: Record<string, unknown>;
    field: string;
    rule: string;
  }> = [
    { name: 'قرار خارج المجموعة', patch: { decision: 'maybe' }, field: 'decision', rule: 'enum' },
    { name: 'سبب خارج المجموعة', patch: { reason_code: 'because' }, field: 'reason_code', rule: 'enum' },
    { name: 'نوع القرار خطأ', patch: { decision: 5 }, field: 'decision', rule: 'type' },
    { name: 'المستأجر مفقود', patch: { tenant_id: undefined }, field: 'tenant_id', rule: 'required' },
    { name: 'معرّف المستأجر بصيغة خاطئة', patch: { tenant_id: 'BAD TENANT' }, field: 'tenant_id', rule: 'pattern' },
    { name: 'التوقيت ليس UTC', patch: { occurred_at: '2026-01-01T12:00:00+02:00' }, field: 'occurred_at', rule: 'pattern' },
    { name: 'التوقيت غير قابل للتفسير', patch: { occurred_at: '2026-13-45T00:00:00.000Z' }, field: 'occurred_at', rule: 'parse' },
    { name: 'معرّف الرسالة بصيغة خاطئة', patch: { message_ref: 'msg ref!' }, field: 'message_ref', rule: 'pattern' },
  ];

  for (const testCase of invalidCases) {
    await t.test(`تُرفض: ${testCase.name} ⇒ قاعدة «${testCase.rule}»`, () => {
      const input = { ...valid, ...testCase.patch };
      const result = validateProcessingOutcome(input);
      assert.equal(result.ok, false, 'المتوقّع رفض النتيجة');
      if (result.ok) return;
      const match = result.errors.find(
        (error) => error.field === testCase.field && error.rule === testCase.rule,
      );
      assert.ok(match, `لم تُسجَّل قاعدة ${testCase.rule}: ${JSON.stringify(result.errors)}`);
    });
  }

  await t.test('النتيجة غير كائن ⇒ رفض بنوع قاعدة معلن', () => {
    const result = validateProcessingOutcome('نص');
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.errors[0].rule, 'type');
  });

  await t.test('parseProcessingOutcome يرمي خطأ يحمل قائمة الأخطاء', () => {
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

test('٢) عزل المستأجرين: لا وصول عابر — ١٠٠ محاولة عدائية ⇒ صفر تسريب', async (t) => {
  const tenantA = createSyntheticContext(1, 11, 101);
  const tenantB = createSyntheticContext(2, 22, 202);
  const store = new MessageStore();
  const audit = new AuditLog({ now: () => FIXED_NOW });
    const layer = new ProcessingLayer({ store, audit });

  await t.test('معالجة رسالة في نطاق مستأجر ⇒ لا أثر في نطاق آخر', () => {
    const outcome = layer.process(
      tenantA,
      createSyntheticEnvelope({ tenantIndex: 1, messageIndex: 1 }),
    );
    assert.equal(outcome.decision, 'accepted');
    assert.equal(store.countFor(tenantA), 1);
    assert.equal(store.countFor(tenantB), 0);
    assert.equal(store.list(tenantB).length, 0);
  });

  await t.test('⭐ الاختبار المعاكس: المستأجر الآخر لا يرى بيانات المستأجر الأول', () => {
    const leaked = store.list(tenantB).filter((row) => row.tenant_id !== tenantB.tenantId);
    assert.equal(leaked.length, 0, 'تسريب: بيانات مستأجر ظهرت لمستأجر آخر');
    assert.equal(store.getByRef(tenantB, 'synth-msg-000001'), undefined);
    assert.equal(store.list(tenantA).length, 1, 'البيانات موجودة فعلاً في نطاق صاحبها');
  });

  await t.test('⭐ انتحال Tenant ID داخل الحمولة ⇒ رفض صريح بلا تخزين', () => {
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

  await t.test('⭐ ١٠٠ محاولة عدائية ⇒ صفر تسريب', () => {
    let leaks = 0;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const attacker = createSyntheticContext(2, 99, 900 + attempt);
      const spoof = createSyntheticEnvelope({
        tenantIndex: 2,
        messageIndex: 2000 + attempt,
        declaredTenantId: tenantA.tenantId,
      });
      const outcome = layer.process(attacker, spoof);
      if (outcome.decision !== 'rejected') leaks += 1;
      const foreign = store.list(attacker).filter((row) => row.tenant_id !== attacker.tenantId);
      leaks += foreign.length;
      if (store.countFor(tenantA) !== 1) leaks += 1;
    }
    assert.equal(leaks, 0, 'تسريب في المحاولات العدائية');
  });

  await t.test('⭐ لا دالة في طبقة المعالجة تقبل معرّف مستأجر كوسيط', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src/core/processing.ts'), 'utf8');
    const signatures = source.match(/export function \w+\(([^)]*)\)/g) ?? [];
    assert.ok(signatures.length > 0, 'لم يُعثر على أي دالة معلنة');
    for (const signature of signatures) {
      assert.ok(
        !/tenant_?id/i.test(signature),
        `دالة تقبل معرّف مستأجر كوسيط: ${signature}`,
      );
    }
  });

  await t.test('⭐ سياق غائب ⇒ رفض صريح (لا مسار افتراضي)', () => {
    const outcome = layer.process(
      undefined,
      createSyntheticEnvelope({ tenantIndex: 1, messageIndex: 30 }),
    );
    assert.equal(outcome.decision, 'rejected');
    assert.equal(outcome.reason_code, 'tenant_context_missing');
  });
});

test('٣) سلوك القواعد: التكرار · الترتيب · التأجيل', async (t) => {
  await t.test('التكرار ⇒ رفض بنوع سبب معلن', () => {
    const context = createSyntheticContext(1, 11, 101);
    const store = new MessageStore();
    const audit = new AuditLog({ now: () => FIXED_NOW });
    const layer = new ProcessingLayer({ store, audit });
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
    const tenantA = createSyntheticContext(1, 11, 101);
    const tenantB = createSyntheticContext(2, 22, 202);
    const envelope = createSyntheticEnvelope({ tenantIndex: 1, messageIndex: 8 });

    const inA = layer.process(tenantA, envelope);
    const inB = layer.process(tenantB, envelope);
    assert.equal(inA.decision, 'accepted');
    assert.equal(inB.decision, 'accepted', 'المعرّف نفسه في مستأجر آخر = لا تصادم');
    assert.equal(store.countFor(tenantA), 1);
    assert.equal(store.countFor(tenantB), 1);
  });

  await t.test('⭐ القاعدة الافتراضية: بلا معرّف محادثة موثوق ⇒ الترتيب لا يُنفَّذ', () => {
    const context = createSyntheticContext(1, 11, 101);
    const store = new MessageStore();
    const audit = new AuditLog({ now: () => FIXED_NOW });
    const layer = new ProcessingLayer({ store, audit });
    const outcome = layer.process(
      context,
      envelopeAt(11, '2026-01-01T10:00:00.000Z'),
    );
    assert.equal(outcome.decision, 'accepted');
    assert.equal(outcome.reason_code, 'accepted_no_ordering_scope');
  });

  await t.test('⭐ داخل النطاق: الأقدم من آخر مقبول ⇒ تأجيل (ولا رفض نهائي)', async (t2) => {
    const context = createSyntheticContext(1, 11, 101);
    const store = new MessageStore();
    const audit = new AuditLog({ now: () => FIXED_NOW });
    const scopes = new Map<string, string>([
      ['synth-msg-000021', 'conv-1'],
      ['synth-msg-000022', 'conv-1'],
    ]);
    const layer = new ProcessingLayer({ store, audit, orderingScope: scopeResolver(scopes) });

    const newer = layer.process(context, envelopeAt(21, '2026-01-02T10:00:00.000Z'));
    assert.equal(newer.decision, 'accepted');
    assert.equal(newer.reason_code, 'accepted_in_order');

    const older = layer.process(context, envelopeAt(22, '2026-01-01T10:00:00.000Z'));
    assert.equal(older.decision, 'deferred');
    assert.equal(older.reason_code, 'deferred_out_of_order');
    assert.equal(store.countFor(context), 1, 'الرسالة المؤجلة لم تُخزَّن');
  });

  await t.test('⭐ الرسالة المؤجلة لا تُغيّر آخر توقيت مقبول', () => {
    const context = createSyntheticContext(1, 11, 101);
    const store = new MessageStore();
    const audit = new AuditLog({ now: () => FIXED_NOW });
    const scopes = new Map<string, string>([
      ['synth-msg-000031', 'conv-1'],
      ['synth-msg-000032', 'conv-1'],
      ['synth-msg-000033', 'conv-1'],
      ['synth-msg-000034', 'conv-1'],
    ]);
    const layer = new ProcessingLayer({ store, audit, orderingScope: scopeResolver(scopes) });

    layer.process(context, envelopeAt(31, '2026-01-03T10:00:00.000Z'));
    const older = layer.process(context, envelopeAt(32, '2026-01-01T10:00:00.000Z'));
    assert.equal(older.decision, 'deferred');

    // ⭐⭐ ورسالة بين النقطة المقبولة وتوقيت الرسالة المؤجلة ⇒ تُؤجَّل (النقطة لم ترجع للخلف)
    const between = layer.process(context, envelopeAt(34, '2026-01-02T10:00:00.000Z'));
    assert.equal(between.decision, 'deferred');
    assert.equal(between.reason_code, 'deferred_out_of_order');

    // ⭐ وبعدها رسالة أحدث من النقطة المقبولة ⇒ تُقبل (النقطة لم تتغيّر)
    const next = layer.process(context, envelopeAt(33, '2026-01-04T10:00:00.000Z'));
    assert.equal(next.decision, 'accepted');
    assert.equal(next.reason_code, 'accepted_in_order');
  });

  await t.test('⭐ تساوي التوقيت لرسالتين مختلفتين ⇒ الثانية تُؤجَّل بلا ترتيب اعتباطي', () => {
    const context = createSyntheticContext(1, 11, 101);
    const store = new MessageStore();
    const audit = new AuditLog({ now: () => FIXED_NOW });
    const scopes = new Map<string, string>([
      ['synth-msg-000041', 'conv-1'],
      ['synth-msg-000042', 'conv-1'],
    ]);
    const layer = new ProcessingLayer({ store, audit, orderingScope: scopeResolver(scopes) });

    const first = layer.process(context, envelopeAt(41, '2026-01-05T10:00:00.000Z'));
    assert.equal(first.decision, 'accepted');
    const second = layer.process(context, envelopeAt(42, '2026-01-05T10:00:00.000Z'));
    assert.equal(second.decision, 'deferred');
    assert.equal(second.reason_code, 'deferred_equal_timestamp');
    assert.equal(store.countFor(context), 1);
  });

  await t.test('⭐ نطاقان مختلفان داخل نفس المستأجر ⇒ لا التصادم بينهما', () => {
    const context = createSyntheticContext(1, 11, 101);
    const store = new MessageStore();
    const audit = new AuditLog({ now: () => FIXED_NOW });
    const scopes = new Map<string, string>([
      ['synth-msg-000051', 'conv-a'],
      ['synth-msg-000052', 'conv-b'],
    ]);
    const layer = new ProcessingLayer({ store, audit, orderingScope: scopeResolver(scopes) });

    const inA = layer.process(context, envelopeAt(51, '2026-01-06T10:00:00.000Z'));
    const inB = layer.process(context, envelopeAt(52, '2026-01-01T10:00:00.000Z'));
    assert.equal(inA.decision, 'accepted');
    assert.equal(inB.decision, 'accepted', 'نطاق مختلف ⇒ توقيت أقدم لا يعني خارج الترتيب');
  });

  await t.test('⭐ توقيت غير صالح ⇒ رفض من العقد قبل الوصول إلى الترتيب', () => {
    const context = createSyntheticContext(1, 11, 101);
    const store = new MessageStore();
    const audit = new AuditLog({ now: () => FIXED_NOW });
    const scopes = new Map<string, string>([['synth-msg-000061', 'conv-1']]);
    const layer = new ProcessingLayer({ store, audit, orderingScope: scopeResolver(scopes) });
    layer.process(context, envelopeAt(61, '2026-01-07T10:00:00.000Z'));

    const outcome = layer.process(
      context,
      { ...envelopeAt(62, '2026-01-08T10:00:00.000Z'), occurred_at: 'غير-تاريخ' },
    );
    assert.equal(outcome.decision, 'rejected');
    assert.equal(outcome.reason_code, 'envelope_invalid');
    assert.equal(store.countFor(context), 1, 'الرسالة المرفوضة لم تُخزَّن');
  });

  await t.test('⭐ رسالة مرفوضة (انتحال) لا تُغيّر حالة الترتيب', () => {
    const context = createSyntheticContext(1, 11, 101);
    const other = createSyntheticContext(2, 22, 202);
    const store = new MessageStore();
    const audit = new AuditLog({ now: () => FIXED_NOW });
    // ⭐ النطاق يشمل الرسالة المنتحلة ⇒ ⇒ لو تقدّمت حالة الترتيب لكانت الفحوص تكشفها
    const scopes = new Map<string, string>([
      ['synth-msg-000064', 'conv-1'],
      ['synth-msg-000065', 'conv-1'],
    ]);
    const layer = new ProcessingLayer({ store, audit, orderingScope: scopeResolver(scopes) });

    const spoofed = processSpoofed(context, other, layer);
    assert.equal(spoofed.decision, 'rejected');
    assert.equal(spoofed.reason_code, 'tenant_mismatch');

    // ⭐ بعد رسالة مرفوضة ⇒ رسالة صالحة بتوقيت أقدم في نفس النطاق تُقبل (النقطة لم تتحرّك)
    const accepted = layer.process(context, envelopeAt(65, '2026-01-02T10:00:00.000Z'));
    assert.equal(accepted.decision, 'accepted');
    assert.equal(accepted.reason_code, 'accepted_in_order');
  });

  await t.test('⭐ حالة خارج القواعد المغلقة ⇒ تأجيل لا تخمين (فحص القاعدة مباشرة)', () => {
    const decision = evaluateOrdering({
      scope: 'conv-1',
      occurredAt: 'غير-تاريخ',
      messageRef: 'synth-msg-000099',
      lastAccepted: { occurred_at: '2026-01-07T10:00:00.000Z', message_ref: 'synth-msg-000061' },
    });
    assert.equal(decision.outcome, 'deferred');
    assert.equal(decision.reason_code, 'deferred_unknown');
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

test('٤) أمان أثر التدقيق: سطر واحد لكل عملية · بلا نص رسالة · بلا أسرار', async (t) => {
  const context = createSyntheticContext(1, 11, 101);
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

  await t.test('⭐ التاجيل مسجَّل بسطر وسبب معلن', () => {
    const scopes = new Map<string, string>([
      ['synth-msg-000071', 'conv-1'],
      ['synth-msg-000072', 'conv-1'],
    ]);
    const localAudit = new AuditLog({ now: () => FIXED_NOW });
    const localStore = new MessageStore();
    const layer = new ProcessingLayer({ store: localStore, audit: localAudit, orderingScope: scopeResolver(scopes) });
    layer.process(context, envelopeAt(71, '2026-01-09T10:00:00.000Z'));
    layer.process(context, envelopeAt(72, '2026-01-01T10:00:00.000Z'));

    const deferred = localAudit.entries().filter((entry) => entry.outcome === 'deferred');
    assert.equal(deferred.length, 1);
    assert.equal(deferred[0].reason_code, 'deferred_out_of_order');
  });

  await t.test('⭐ نص الرسالة (منه السرّ) لا يصل إلى سجل المعالجة إطلاقاً', () => {
    const fakeSecret = ['sk', 'A'.repeat(24)].join('-');
    const localAudit = new AuditLog({ now: () => FIXED_NOW });
    const localStore = new MessageStore();
    const outcome = layer.process(
      context,
      createSyntheticEnvelope({
        tenantIndex: 1,
        messageIndex: 80,
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
      () => audit.record({
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

test('٥) لا اتصالات خارجية ولا أسرار ولا بيانات حقيقية', async (t) => {
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

  await t.test('⭐ فحص ساكن لملفات الشريحة الثانية: صفر رمز شبكة · صفر سرّ', () => {
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
    const context = createSyntheticContext(1, 11, 101);
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
});

// ============================================================
// WASL AI — اختبارات حساب «زمن أول رد» (التصحيح C1 · بعد الملاحظة M4)
// ------------------------------------------------------------
// ⭐ **تصريح المالك (D-059 · ٥ نوفمبر ٢٠٢٦)**: ⭐ ① أول رسالة **واردة** من
//   العميل هي نقطة البداية · ② الردّ = **أول رسالة صادرة بعد الواردة** ·
//   ③ **تُتجاهل** الصادرة التي سبقت الواردة · ④ الزمن = الفرق بينهما ·
//   ⑤ **لا قيمة** عند عدم وجود ردّ صحيح (`undefined` — لا صفر بديل) ·
//   ⑥ **العزل والصلاحيات الحاليان محفوظان**.
// ⭐ **المحاور الإلزامية الثمانية**: ⭐ ① واردة ثم ردّ · ② صادرة ثم واردة ثم ردّ ·
//   ③ عدة صادرة قبل أول واردة · ④ عدة واردة قبل أول ردّ · ⑤ دون ردّ ·
//   ⑥ دون واردة · ⑦ تساوي التوقيتات/ترتيب غير متوقّع · ⑧ عدم تسريب النصوص.
// ⛔ كل البيانات اصطناعية محلية · ⛔ صفر اتصال · ⛔ صفر حساب.
// ============================================================

import assert from 'node:assert/strict';
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
  getServiceMetrics,
  type MessageEnvelope,
  type ServiceMetricsDependencies,
  type TenantContext,
} from '../src/core/index.ts';
import { createSyntheticContext } from './support/index.ts';

const NOW = '2026-01-05T12:00:00.000Z';
const TENANT = 'tnt_synth_0001';
const SECRET_BODY = 'نص رسالة اصطناعي سرّي لا يجوز أن يخرج في المؤشرات';

function context(conversationIndex = 1): TenantContext {
  return createSyntheticContext(1, 11, 101, conversationIndex, () => NOW, 'supervisor');
}

function envelope(options: {
  messageRef: string;
  conversationRef: string;
  direction: 'inbound' | 'outbound';
  occurredAt: string;
}): MessageEnvelope {
  return {
    schema_version: '1',
    message_ref: options.messageRef,
    channel: 'synthetic',
    direction: options.direction,
    from: 'participant-a@example.invalid',
    to: 'participant-b@example.invalid',
    body: SECRET_BODY,
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
  const deps: ServiceMetricsDependencies = { store, states, changes, readAudit };
  return { layer, deps, store };
}

/** ⭐ يبني محادثة واحدة ويقيس `first_response_minutes` وحده. */
function measure(messages: readonly {
  direction: 'inbound' | 'outbound';
  occurredAt: string;
}[]): { value: number | undefined; stored: number } {
  const { layer, deps, store } = scenario();
  const ctx = context(1);
  messages.forEach((message, index) => {
    layer.process(
      ctx,
      envelope({
        messageRef: `fr-msg-${String(index + 1).padStart(6, '0')}`,
        conversationRef: 'conv_synth_0001',
        direction: message.direction,
        occurredAt: message.occurredAt,
      }),
    );
  });
  const metrics = getServiceMetrics(ctx, deps, { now: NOW });
  return {
    value: metrics.first_response_minutes,
    stored: store.messagesForConversation(ctx, 'conv_synth_0001').length,
  };
}

test('١) ⭐ محادثة تبدأ برسالة واردة ثم ردّ صادر ⇒ يُحسب الزمن', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ وارد ٠٩:٠٠ + صادر ٠٩:٣٠ ⇒ ٣٠ دقيقة', () => {
    const result = measure([
      { direction: 'inbound', occurredAt: '2026-01-05T09:00:00.000Z' },
      { direction: 'outbound', occurredAt: '2026-01-05T09:30:00.000Z' },
    ]);
    assert.equal(result.stored, 2);
    assert.equal(result.value, 30);
  });
});

test('٢) ⭐⭐ محادثة تبدأ برسالة صادرة ثم واردة ثم ردّ ⇒ يُحسب من الواردة', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ صادر ٠٨:٠٠ (ترحيب) + وارد ٠٩:٠٠ + صادر ١٠:٠٠ ⇒ ٦٠ دقيقة', () => {
    const result = measure([
      { direction: 'outbound', occurredAt: '2026-01-05T08:00:00.000Z' },
      { direction: 'inbound', occurredAt: '2026-01-05T09:00:00.000Z' },
      { direction: 'outbound', occurredAt: '2026-01-05T10:00:00.000Z' },
    ]);
    assert.equal(result.stored, 3);
    // ⭐⭐ **هذا هو الإصلاح**: قبل التصحيح كانت النتيجة `undefined` (عيّنة مستبعدة بصمت).
    assert.equal(result.value, 60);
  });
});

test('٣) ⭐⭐ عدة رسائل صادرة قبل أول واردة ⇒ تُتجاهل', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ صادرتان ٠٨:٠٠ و٠٨:٣٠ + وارد ٠٩:٠٠ + صادر ١٠:٠٠ ⇒ ٦٠ دقيقة', () => {
    const result = measure([
      { direction: 'outbound', occurredAt: '2026-01-05T08:00:00.000Z' },
      { direction: 'outbound', occurredAt: '2026-01-05T08:30:00.000Z' },
      { direction: 'inbound', occurredAt: '2026-01-05T09:00:00.000Z' },
      { direction: 'outbound', occurredAt: '2026-01-05T10:00:00.000Z' },
    ]);
    assert.equal(result.stored, 4);
    assert.equal(result.value, 60);
  });
});

test('٤) ⭐⭐ عدة رسائل واردة قبل أول ردّ ⇒ من أول واردة', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ وارد ٠٨:٠٠ + وارد ٠٨:٣٠ + صادر ٠٩:٣٠ ⇒ ٩٠ دقيقة', () => {
    const result = measure([
      { direction: 'inbound', occurredAt: '2026-01-05T08:00:00.000Z' },
      { direction: 'inbound', occurredAt: '2026-01-05T08:30:00.000Z' },
      { direction: 'outbound', occurredAt: '2026-01-05T09:30:00.000Z' },
    ]);
    assert.equal(result.stored, 3);
    assert.equal(result.value, 90);
  });
});

test('٥) ⭐ محادثة دون ردّ ⇒ لا قيمة (لا صفر بديل)', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ وارد فقط ⇒ `undefined`', () => {
    const result = measure([
      { direction: 'inbound', occurredAt: '2026-01-05T09:00:00.000Z' },
    ]);
    assert.equal(result.stored, 1);
    assert.equal(result.value, undefined);
  });
});

test('٦) ⭐ محادثة دون رسالة واردة ⇒ لا قيمة', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ صادرة فقط ⇒ `undefined` (لا نقطة بداية)', () => {
    const result = measure([
      { direction: 'outbound', occurredAt: '2026-01-05T09:00:00.000Z' },
    ]);
    assert.equal(result.stored, 1);
    assert.equal(result.value, undefined);
  });
});

test('٧) ⭐⭐ تساوي التوقيتات أو ترتيب غير متوقّع', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ طابع متساوٍ ⇒ الرسالة الثانية تُؤجَّل عند الإدخال ⇒ `undefined`', () => {
    const result = measure([
      { direction: 'inbound', occurredAt: '2026-01-05T09:00:00.000Z' },
      { direction: 'outbound', occurredAt: '2026-01-05T09:00:00.000Z' },
    ]);
    // ⭐ الرسالة الثانية مؤجَّلة بقاعدة الترتيب ⇒ مخزَّنة واحدة فقط.
    assert.equal(result.stored, 1);
    assert.equal(result.value, undefined);
  });

  await t.test('⭐⭐⭐⭐⭐ ترتيب غير متوقّع (واردة متأخرة زمنياً) ⇒ تُؤجَّل ⇒ `undefined`', () => {
    const result = measure([
      { direction: 'inbound', occurredAt: '2026-01-05T09:00:00.000Z' },
      { direction: 'inbound', occurredAt: '2026-01-05T08:00:00.000Z' },
    ]);
    assert.equal(result.stored, 1);
    assert.equal(result.value, undefined);
  });
});

test('٨) ⭐⭐⭐ عدم تسريب نصوص الرسائل', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ لا نصّ رسالة في مخرجات المؤشرات', () => {
    const { layer, deps } = scenario();
    const ctx = context(1);
    layer.process(
      ctx,
      envelope({
        messageRef: 'fr-leak-0001',
        conversationRef: 'conv_synth_0001',
        direction: 'inbound',
        occurredAt: '2026-01-05T09:00:00.000Z',
      }),
    );
    layer.process(
      ctx,
      envelope({
        messageRef: 'fr-leak-0002',
        conversationRef: 'conv_synth_0001',
        direction: 'outbound',
        occurredAt: '2026-01-05T09:30:00.000Z',
      }),
    );
    const json = JSON.stringify(getServiceMetrics(ctx, deps, { now: NOW }));
    assert.ok(!json.includes(SECRET_BODY), 'نص رسالة داخل المؤشرات ⇒ تسريب');
    assert.ok(!json.includes('body'), 'حقل جسم الرسالة داخل المؤشرات ⇒ تسريب');
  });
});

test('٩) ⭐⭐⭐⭐⭐ العزل والصلاحيات محفوظان + صفر اتصال', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ صفر محاولة اتصال خارجية', () => {
    assert.equal(guard.installed, true);
    assert.deepEqual(guard.blocked, []);
  });

  await t.test('⭐⭐⭐⭐⭐ المؤشرات ما زالت تتطلّب صلاحية صريحة', async () => {
    const { layer, deps } = scenario();
    const agentCtx = createSyntheticContext(1, 11, 101, 1, () => NOW, 'agent');
    layer.process(
      agentCtx,
      envelope({
        messageRef: 'fr-perm-0001',
        conversationRef: 'conv_synth_0001',
        direction: 'inbound',
        occurredAt: '2026-01-05T09:00:00.000Z',
      }),
    );
    assert.throws(
      () => getServiceMetrics(agentCtx, deps, { now: NOW }),
      (error: unknown) => (error as { code?: string }).code === 'capability_missing',
    );
  });
});

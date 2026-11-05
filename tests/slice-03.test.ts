// ============================================================
// WASL AI — اختبارات الشريحة الثالثة: طبقة قراءة المحادثات (Slice 03)
// ------------------------------------------------------------
// ⭐ الاختبارات الإلزامية (تصريح المالك · ٥ نوفمبر ٢٠٢٦ · D-054):
//   ٢) حفظ `conversation_ref` واسترجاعه
//   ٣) عدم خلط المحادثات داخل المستأجر
//   ٤) عدم خلط البيانات بين المستأجرين
//   ٥) رفض قراءة قائمة المحادثات دون صلاحية مناسبة
//   ٦) رفض قراءة محادثة منفردة دون صلاحيتها
//   ٧) منع الوصول العابر حتى عند تخمين المعرّفات
//   ٨) قراءة سجل التدقيق بصورة معزولة
//   ٩) عدم تسجيل محتوى حساس في تدقيق القراءة
//   ١٠) الترقيم والترتيب واستقرار النتائج
//   ١١) عدم كسر Slice 01 وSlice 02
//   ١٢) عدم وجود اتصالات خارجية
// ⭐ (١) تجميد العقد للإصدار 1 ⇒ في `tests/contract-freeze.test.ts`.
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
  ENVELOPE_RULES,
  MessageStore,
  OrderingState,
  ProcessingLayer,
  ReadAuditError,
  ReadAuditLog,
  getConversation,
  listConversations,
  readConversationAudit,
  resolveProductionTenantContext,
  resolveTenantContext,
  validateEnvelope,
  type ConversationQueryDependencies,
  type SessionSource,
  type TenantContext,
  type TrustedRole,
} from '../src/core/index.ts';
// ⭐ أدوات الاختبار موجودة في شجرة الاختبار ⇒ خارج حزمة الإنتاج
import {
  LOCAL_RESTRICTED_SOURCES,
  LOCAL_TEST_SOURCES,
  createSyntheticContext,
  createSyntheticContextWithSource,
  createSyntheticConversationRef,
  createSyntheticEnvelope,
  createSyntheticSession,
  localTestSessionSource,
} from './support/index.ts';

const FIXED_NOW = '2026-01-01T00:00:00.000Z';
const ROOT = path.resolve(import.meta.dirname, '..');

const ALL_CAPABILITIES: readonly string[] = [
  CONVERSATION_LIST_CAPABILITY,
  CONVERSATION_READ_CAPABILITY,
  CONVERSATION_AUDIT_CAPABILITY,
];

/** ⭐⭐ الدور المقابل بسياسة الأدوار — ⭐ يُشتقق خليها من النواة. */
const ALL_ROLES: readonly TrustedRole[] = ['owner', 'supervisor', 'agent', 'viewer', 'none'];

/** ⭐ سياق موثوق — ⭐ **محادثة واحدة لكل سياق** (حدّ الثقة). */
function context(
  tenantIndex: number,
  conversationIndex = 1,
  role: TrustedRole = 'viewer',
  source?: SessionSource,
): TenantContext {
  if (source) {
    return createSyntheticContextWithSource(
      source,
      tenantIndex,
      tenantIndex * 10 + 1,
      100 + tenantIndex,
      conversationIndex,
      () => FIXED_NOW,
    );
  }
  return createSyntheticContext(
    tenantIndex,
    tenantIndex * 10 + 1,
    100 + tenantIndex,
    conversationIndex,
    () => FIXED_NOW,
    role,
  );
}

/** ⭐ رسالة اصطناعية بتوقيت محدَّد ⇒ ترتيب القبول واضح. */
function messageAt(options: {
  tenantIndex?: number;
  messageIndex: number;
  conversationIndex?: number;
  occurredAt: string;
}) {
  const base = createSyntheticEnvelope({
    tenantIndex: options.tenantIndex ?? 1,
    messageIndex: options.messageIndex,
    ...(options.conversationIndex === undefined
      ? {}
      : { conversationIndex: options.conversationIndex }),
  });
  return { ...base, occurred_at: options.occurredAt };
}

function scenario() {
  const audit = new AuditLog({ now: () => FIXED_NOW });
  const readAudit = new ReadAuditLog({ now: () => FIXED_NOW });
  const store = new MessageStore({ now: () => FIXED_NOW, audit });
  const ordering = new OrderingState();
  const layer = new ProcessingLayer({ store, audit, orderingState: ordering });
  const deps: ConversationQueryDependencies = { store, audit, readAudit };
  return { audit, readAudit, store, ordering, layer, deps };
}

test('٢) حفظ `conversation_ref` واسترجاعه', async (t) => {
  const { store } = scenario();
  const ctxA = context(1, 1);
  const conversationRef = createSyntheticConversationRef(1);
  const envelope = messageAt({
    messageIndex: 1,
    conversationIndex: 1,
    occurredAt: '2026-01-01T10:00:00.000Z',
  });
  const outcome = store.append(ctxA, envelope);
  assert.equal(outcome.status, 'accepted');
  if (outcome.status !== 'accepted') return;

  await t.test('⭐ الصف المخزَّن يحمل معرّف المحادثة', () => {
    assert.equal(outcome.message.conversation_ref, conversationRef);
  });

  await t.test('⭐ الاسترجاع بالمحادثة يُرجع الصف نفسه', () => {
    const rows = store.messagesForConversation(ctxA, conversationRef);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].conversation_ref, conversationRef);
    assert.equal(rows[0].message_ref, envelope.message_ref);
  });

  await t.test('⭐ الفهرس يربط (المستأجر · المحادثة · الرسالة)', () => {
    assert.deepEqual([...store.conversationRefs(ctxA)], [conversationRef]);
    const row = store.messagesForConversation(ctxA, conversationRef)[0];
    assert.equal(row.tenant_id, ctxA.tenantId);
  });
});

test('٣) عدم خلط المحادثات داخل المستأجر', async (t) => {
  const { layer, deps, store } = scenario();
  const convOne = createSyntheticConversationRef(1);
  const convTwo = createSyntheticConversationRef(2);

  layer.process(
    context(1, 1),
    messageAt({ messageIndex: 1, conversationIndex: 1, occurredAt: '2026-01-01T10:00:00.000Z' }),
  );
  layer.process(
    context(1, 1),
    messageAt({ messageIndex: 2, conversationIndex: 1, occurredAt: '2026-01-01T11:00:00.000Z' }),
  );
  layer.process(
    context(1, 2),
    messageAt({ messageIndex: 3, conversationIndex: 2, occurredAt: '2026-01-01T12:00:00.000Z' }),
  );

  await t.test('⭐ كل محادثة ترى رسائلها فقط', () => {
    const one = getConversation(context(1, 1), convOne, deps);
    const two = getConversation(context(1, 2), convTwo, deps);
    assert.equal(one.messages.length, 2);
    assert.equal(two.messages.length, 1);
    assert.equal(one.pagination.total, 2);
    assert.equal(two.pagination.total, 1);
  });

  await t.test('⭐ القائمة تُرجع محادثتين لا محادثة واحدة', () => {
    const page = listConversations(context(1, 1), deps);
    assert.equal(page.summaries.length, 2);
    assert.deepEqual(
      page.summaries.map((summary) => summary.message_count).sort(),
      [1, 2],
    );
  });

  await t.test('⭐ الرسائل المخزَّنة تحمل محادثتها', () => {
    assert.equal(store.messagesForConversation(context(1, 2), convTwo)[0].conversation_ref, convTwo);
    assert.equal(store.messagesForConversation(context(1, 1), convOne)[0].conversation_ref, convOne);
  });
});

test('٤) عدم خلط البيانات بين المستأجرين', async (t) => {
  const { layer, deps } = scenario();
  const convOfA = createSyntheticConversationRef(1);
  layer.process(
    context(1, 1),
    messageAt({ messageIndex: 1, conversationIndex: 1, occurredAt: '2026-01-01T10:00:00.000Z' }),
  );

  await t.test('⭐ قائمة المستأجر الآخر فارغة', () => {
    const page = listConversations(context(2, 1), deps);
    assert.equal(page.summaries.length, 0);
    assert.equal(page.pagination.total, 0);
  });

  await t.test('⭐⭐ محادثة المستأجر الأول تُقرأ عند المستأجر الآخر ⇒ صفوف صفر', () => {
    const thread = getConversation(context(2, 1), convOfA, deps);
    assert.equal(thread.messages.length, 0);
    assert.equal(thread.pagination.total, 0);
  });

  await t.test('⭐⭐ محادثة غير موجودة = نفس النتيجة تماماً (لا كشف وجود)', () => {
    const missing = getConversation(context(2, 1), 'conv_synth_9999', deps);
    assert.equal(missing.messages.length, 0);
    assert.equal(missing.pagination.total, 0);
  });

  await t.test('⭐ أحداث التدقيق معزولة بالمستأجر', () => {
    const page = readConversationAudit(context(2, 1), convOfA, deps);
    assert.equal(page.entries.length, 0);
  });
});

test('٥) رفض قراءة قائمة المحادثات دون صلاحية مناسبة', async (t) => {
  const { layer, deps } = scenario();
  layer.process(
    context(1, 1),
    messageAt({ messageIndex: 1, conversationIndex: 1, occurredAt: '2026-01-01T10:00:00.000Z' }),
  );
  const noList = context(1, 1, 'viewer', LOCAL_RESTRICTED_SOURCES.readOnly);

  await t.test('⭐⭐ الرفض صريح بخطأ صلاحية', () => {
    assert.throws(
      () => listConversations(noList, deps),
      (error: unknown) => {
        assert.ok(error instanceof CapabilityError);
        assert.equal(error.code, 'capability_missing');
        assert.equal(error.capability, CONVERSATION_LIST_CAPABILITY);
        return true;
      },
    );
  });

  await t.test('⭐ المحاولة المرفوضة تُوثَّق في سجل القراءة', () => {
    const events = deps.readAudit.eventsFor(noList);
    const denied = events.filter((event) => event.result === 'denied');
    assert.equal(denied.length, 1);
    assert.equal(denied[0].operation, 'conversation.list');
    assert.equal(denied[0].capability, CONVERSATION_LIST_CAPABILITY);
  });

  await t.test('⭐⭐ الخيار الافتراضي = المنع (جلسة بلا صلاحيات)', () => {
    const bare = context(1, 1, 'none');
    assert.deepEqual([...bare.capabilities], []);
    assert.throws(() => listConversations(bare, deps), CapabilityError);
  });
});

test('٦) رفض قراءة محادثة منفردة دون صلاحيتها', async (t) => {
  const { layer, deps } = scenario();
  const conv = createSyntheticConversationRef(1);
  layer.process(
    context(1, 1),
    messageAt({ messageIndex: 1, conversationIndex: 1, occurredAt: '2026-01-01T10:00:00.000Z' }),
  );
  const listOnly = context(1, 1, 'viewer', LOCAL_RESTRICTED_SOURCES.listOnly);

  await t.test('⭐⭐ الصلاحيتان منفصلتان: قائمة بلا قراءة محادثة', () => {
    const page = listConversations(listOnly, deps);
    assert.equal(page.summaries.length, 1, 'القائمة مسموحة');
    assert.throws(
      () => getConversation(listOnly, conv, deps),
      (error: unknown) => {
        assert.ok(error instanceof CapabilityError);
        assert.equal(error.capability, CONVERSATION_READ_CAPABILITY);
        return true;
      },
    );
  });

  await t.test('⭐⭐ قراءة التدقيق تحتاج صلاحيتها الخاصة', () => {
    assert.throws(
      () => readConversationAudit(listOnly, conv, deps),
      (error: unknown) => {
        assert.ok(error instanceof CapabilityError);
        assert.equal(error.capability, CONVERSATION_AUDIT_CAPABILITY);
        return true;
      },
    );
  });

  await t.test('⭐ الرفض لا يُسرّب أي بيانات', () => {
    const events = deps.readAudit.eventsFor(listOnly);
    assert.equal(events.filter((event) => event.result === 'allowed').length, 1);
    assert.equal(events.filter((event) => event.result === 'denied').length, 2);
  });
});

test('٧) منع الوصول العابر حتى عند تخمين المعرّفات', async (t) => {
  const { layer, deps } = scenario();
  const convOfA = createSyntheticConversationRef(1);
  layer.process(
    context(1, 1),
    messageAt({ messageIndex: 1, conversationIndex: 1, occurredAt: '2026-01-01T10:00:00.000Z' }),
  );

  await t.test('⭐⭐ ١٠٠ محاولة تخمين ⇒ صفر صفّ وصفر تسريب', () => {
    let leaked = 0;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const guessed =
        attempt % 2 === 0 ? convOfA : `conv_guessed_${String(attempt).padStart(4, '0')}`;
      const thread = getConversation(context(2, 1), guessed, deps);
      if (thread.messages.length > 0) leaked += 1;
      const auditPage = readConversationAudit(context(2, 1), guessed, deps);
      if (auditPage.entries.length > 0) leaked += 1;
    }
    assert.equal(leaked, 0, 'تسريب عبر تخمين المعرّفات');
  });

  await t.test('⭐⭐ امتلاك المعرّف ليس دليل حق وصول (بلا صلاحية = رفض)', () => {
    const noAccess = context(2, 1, 'none');
    assert.throws(() => getConversation(noAccess, convOfA, deps), CapabilityError);
  });

  await t.test('⭐⭐ معرّف مستأجر من العميل لا يبني سياقاً ⇒ لا قراءة', () => {
    // ⛔ ادّعاءات خام (لم تُصنَّع محلياً) ⇒ لا إثبات ⇒ لا سياق ⇒ لا قراءة.
    const forged = {
      ...createSyntheticSession(1, 11, 101, 1, 'viewer'),
      tenant_id: 'tnt_forged_0001',
    };
    assert.throws(
      () =>
        resolveTenantContext(forged, { source: localTestSessionSource, now: () => FIXED_NOW }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /لم يوثّق|unverified/);
        return true;
      },
    );
  });
});

test('٨) قراءة سجل التدقيق بصورة معزولة', async (t) => {
  const { layer, deps, audit } = scenario();
  const conv = createSyntheticConversationRef(1);
  layer.process(
    context(1, 1),
    messageAt({ messageIndex: 1, conversationIndex: 1, occurredAt: '2026-01-01T10:00:00.000Z' }),
  );
  layer.process(
    context(2, 1),
    messageAt({ tenantIndex: 2, messageIndex: 2, conversationIndex: 1, occurredAt: '2026-01-01T10:30:00.000Z' }),
  );

  await t.test('⭐ القراءة المعزولة ترجع أحداث المستأجر فقط', () => {
    const mine = audit.entriesFor(context(1, 1));
    assert.ok(mine.length > 0);
    assert.ok(mine.every((entry) => entry.tenant_id === context(1, 1).tenantId));
    const theirs = audit.entriesFor(context(2, 1));
    assert.ok(theirs.every((entry) => entry.tenant_id === context(2, 1).tenantId));
    assert.notEqual(mine.length, 0);
  });

  await t.test('⭐⭐ المسار الجديد لا يستدعي `entries()` غير المعزولة', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src/core/conversation-query.ts'), 'utf8');
    assert.equal(
      source.includes('.entries()'),
      false,
      'المسار العام للقراءة لا يستدعي entries() — استخدم entriesFor',
    );
  });

  await t.test('⭐ أحداث المحادثة تُقرأ بمرشّح المحادثة', () => {
    const page = readConversationAudit(context(1, 1), conv, deps);
    assert.ok(page.entries.length >= 1);
    assert.ok(
      page.entries.every((entry) => entry.meta?.conversation_ref === conv),
      'كل سطر يخصّ المحادثة المطلوبة',
    );
  });
});

test('٩) عدم تسجيل محتوى حساس في تدقيق القراءة', async (t) => {
  const { layer, deps } = scenario();
  const conv = createSyntheticConversationRef(1);
  layer.process(
    context(1, 1),
    messageAt({ messageIndex: 1, conversationIndex: 1, occurredAt: '2026-01-01T10:00:00.000Z' }),
  );
  listConversations(context(1, 1), deps);
  getConversation(context(1, 1), conv, deps);

  await t.test('⭐ أحداث القراءة لا تحمل نص الرسالة ولا سمات', () => {
    const events = deps.readAudit.eventsFor(context(1, 1));
    assert.ok(events.length >= 2);
    for (const event of events) {
      const serialized = JSON.stringify(event);
      assert.equal(serialized.includes('body'), false);
      assert.equal(serialized.includes('رسالة اصطناعية'), false);
      assert.equal(serialized.includes('participant-synth'), false);
      assert.ok(!('body' in event));
      assert.ok(!('attributes' in event));
    }
  });

  await t.test('⭐⭐ قيمة تشبه سرّاً مرفوضة في سجل القراءة', () => {
    assert.throws(
      () =>
        deps.readAudit.record({
          tenant_id: context(1, 1).tenantId,
          actor_id: context(1, 1).actorId,
          operation: 'conversation.read',
          capability: CONVERSATION_READ_CAPABILITY,
          result: 'allowed',
          target: 'sk-AAAAAAAAAAAAAAAAAAAAAAAA',
          count: 1,
        }),
      (error: unknown) => {
        assert.ok(error instanceof ReadAuditError);
        assert.equal(error.code, 'target_secret_forbidden');
        return true;
      },
    );
  });
});

test('١٠) الترقيم والترتيب واستقرار النتائج', async (t) => {
  const { layer, deps, store } = scenario();
  layer.process(
    context(1, 1),
    messageAt({ messageIndex: 1, conversationIndex: 1, occurredAt: '2026-01-01T10:00:00.000Z' }),
  );
  layer.process(
    context(1, 2),
    messageAt({ messageIndex: 2, conversationIndex: 2, occurredAt: '2026-01-02T10:00:00.000Z' }),
  );
  layer.process(
    context(1, 3),
    messageAt({ messageIndex: 3, conversationIndex: 3, occurredAt: '2026-01-03T10:00:00.000Z' }),
  );
  layer.process(
    context(1, 1),
    messageAt({ messageIndex: 4, conversationIndex: 1, occurredAt: '2026-01-01T11:00:00.000Z' }),
  );
  layer.process(
    context(1, 1),
    messageAt({ messageIndex: 5, conversationIndex: 1, occurredAt: '2026-01-01T12:00:00.000Z' }),
  );

  await t.test('⭐ الترتيب: أول توقيت تنازلياً (مفتاح لا يتغيّر)', () => {
    const page = listConversations(context(1, 1), deps);
    assert.deepEqual(
      page.summaries.map((summary) => summary.conversation_ref),
      [
        createSyntheticConversationRef(3),
        createSyntheticConversationRef(2),
        createSyntheticConversationRef(1),
      ],
    );
  });

  await t.test('⭐⭐ الترقيم: صفحة بحدّ ⇒ لا تكرار ولا فقد بين الصفحات', () => {
    const seen: string[] = [];
    let cursor: string | null | undefined;
    let rounds = 0;
    do {
      const page = listConversations(context(1, 1), deps, {
        limit: 1,
        ...(cursor ? { cursor } : {}),
      });
      seen.push(...page.summaries.map((summary) => summary.conversation_ref));
      cursor = page.pagination.next_cursor;
      rounds += 1;
    } while (cursor !== null && cursor !== undefined && rounds < 10);
    assert.equal(seen.length, 3);
    assert.equal(new Set(seen).size, 3, 'لا تكرار بين الصفحات');
  });

  await t.test('⭐⭐ رسائل المحادثة: ترتيب القبول + ترقيم بلا فقد', () => {
    const conv = createSyntheticConversationRef(1);
    const all = getConversation(context(1, 1), conv, deps);
    assert.equal(all.messages.length, 3);
    assert.deepEqual(
      all.messages.map((message) => message.occurred_at),
      [
        '2026-01-01T10:00:00.000Z',
        '2026-01-01T11:00:00.000Z',
        '2026-01-01T12:00:00.000Z',
      ],
    );
    const first = getConversation(context(1, 1), conv, deps, { limit: 2 });
    assert.equal(first.messages.length, 2);
    assert.ok(first.pagination.next_cursor);
    const second = getConversation(context(1, 1), conv, deps, {
      limit: 2,
      cursor: first.pagination.next_cursor as string,
    });
    assert.equal(second.messages.length, 1);
    const refs = [...first.messages, ...second.messages].map((message) => message.message_ref);
    assert.equal(new Set(refs).size, 3, 'لا تكرار ولا فقد بين صفحتي المحادثة');
  });

  await t.test('⭐⭐ وصول رسالة جديدة بين طلبين ⇒ لا تكرار ولا فقد ولا إعادة ترتيب', () => {
    const before = listConversations(context(1, 1), deps);
    const orderBefore = before.summaries.map((summary) => summary.conversation_ref);
    const outcome = store.append(
      context(1, 1),
      messageAt({ messageIndex: 6, conversationIndex: 1, occurredAt: '2026-01-01T13:00:00.000Z' }),
    );
    assert.equal(outcome.status, 'accepted');
    const after = listConversations(context(1, 1), deps);
    assert.deepEqual(
      after.summaries.map((summary) => summary.conversation_ref),
      orderBefore,
      'الترتيب لا يتغيّر (مفتاح الترتيب = أول توقيت لا يتغيّر)',
    );
    const conv = createSyntheticConversationRef(1);
    const page = getConversation(context(1, 1), conv, deps);
    assert.equal(page.messages.length, 4, 'الرسالة الجديدة ظهرت في النهاية');
    assert.equal(page.messages[3].occurred_at, '2026-01-01T13:00:00.000Z');
  });

  await t.test('⭐ حدّ الصفحة الأقصى مطبَّق ومؤشر خاطئ مرفوض', () => {
    const page = listConversations(context(1, 1), deps, { limit: 1000 });
    assert.ok(page.pagination.limit <= 100);
    assert.throws(
      () => listConversations(context(1, 1), deps, { cursor: 'conv_unknown_0001' }),
      ConversationQueryError,
    );
  });
});

test('١١) عدم كسر Slice 01 وSlice 02', async (t) => {
  const { layer, deps, store, audit } = scenario();

  await t.test('⭐ عقد الرسالة ما زال كما هو (١٢ حقلاً · الإصدار 1)', () => {
    assert.equal(Object.keys(ENVELOPE_RULES).length, 12);
    const result = validateEnvelope(createSyntheticEnvelope({ tenantIndex: 1, messageIndex: 1 }));
    assert.equal(result.ok, true);
  });

  await t.test('⭐ مخزن Slice 01 يعمل كما هو (قائمة · عدّ · جلب)', () => {
    layer.process(
      context(1, 1),
      messageAt({ messageIndex: 1, conversationIndex: 1, occurredAt: '2026-01-01T10:00:00.000Z' }),
    );
    assert.equal(store.countFor(context(1, 1)), 1);
    assert.equal(store.list(context(1, 1)).length, 1);
    assert.equal(
      store.getByRef(context(1, 1), 'synth-msg-000001')?.message_ref,
      'synth-msg-000001',
    );
  });

  await t.test('⭐⭐ منطق Slice 02 (ترتيب · تكرار · رفض) ما زال يعمل', () => {
    // ⭐ scenario مستقل ⇒ لا تداخل مع اختبار Slice 01 أعلاه.
    const fresh = scenario();
    const ctxConv = context(1, 1);
    const accepted = fresh.layer.process(
      ctxConv,
      messageAt({ messageIndex: 21, conversationIndex: 1, occurredAt: '2026-01-01T10:00:00.000Z' }),
    );
    assert.equal(accepted.decision, 'accepted');
    const deferred = fresh.layer.process(
      ctxConv,
      messageAt({ messageIndex: 22, conversationIndex: 1, occurredAt: '2026-01-01T09:00:00.000Z' }),
    );
    assert.equal(deferred.decision, 'deferred');
    assert.equal(deferred.reason_code, 'deferred_out_of_order');
    const duplicate = fresh.layer.process(
      ctxConv,
      messageAt({ messageIndex: 21, conversationIndex: 1, occurredAt: '2026-01-01T11:00:00.000Z' }),
    );
    assert.equal(duplicate.reason_code, 'message_ref_duplicate');
  });

  await t.test('⭐ قيم سجل التدقيق لم تتغيّر (ولا قيمة قراءة داخله)', () => {
    const outcomes = new Set(audit.entries().map((entry) => entry.outcome));
    assert.ok(outcomes.size > 0);
    for (const outcome of outcomes) {
      assert.ok(
        ['accepted', 'rejected', 'duplicate', 'deferred'].includes(outcome),
        `قيمة غير معلنة في سجل المعالجة: ${outcome}`,
      );
    }
    assert.equal(outcomes.has('allowed' as never), false);
    assert.equal(outcomes.has('denied' as never), false);
  });

  await t.test('⭐ الطبقة الجديدة لا تكسر المسار العام', () => {
    assert.ok(deps);
    assert.equal(typeof listConversations, 'function');
    assert.equal(typeof getConversation, 'function');
    assert.equal(typeof readConversationAudit, 'function');
  });
});

test('١٣) ⭐⭐ التحقّق: الصلاحيات لا تُشتق من مدخل عميل غير موثوق', async (t) => {
  const CAPS = ALL_CAPABILITIES;

  await t.test('⭐ ادّعاءات عميل خام تحمل صلاحيات ⇒ رفض (لا سياق ⇒ لا صلاحية)', () => {
    const raw = {
      session_id: 'sess_attack_0001',
      tenant_id: 'tnt_attack_0001',
      actor_id: 'actor_attack_0001',
      conversation_ref: 'conv_attack_0001',
      authenticated: true,
      capabilities: [...CAPS],
    };
    assert.throws(
      () =>
        resolveTenantContext(raw, { source: localTestSessionSource, now: () => FIXED_NOW }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /لم يوثّق|unverified/);
        return true;
      },
    );
  });

  await t.test('⭐⭐ نسخة (كائن جديد) من جلسة صحيحة مع صلاحيات مُضافة ⇒ رفض', () => {
    const genuine = createSyntheticSession(1, 11, 101, 1, 'viewer');
    const copied = { ...genuine, capabilities: [...CAPS, 'super.admin'] };
    assert.throws(
      () =>
        resolveTenantContext(copied, { source: localTestSessionSource, now: () => FIXED_NOW }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /لم يوثّق|unverified/);
        return true;
      },
    );
  });

  await t.test('⭐⭐⭐ حقل `capabilities` في الحمولة مُتجاهل تماماً (إصلاح D-055)', () => {
    // ⭐ الجلسةSynthetic مُصنَّعة ودورها `viewer` ⇒ ⇒⇒给她 صلاحيات في الحمولة ⇒ ⇒⇒
    // ⭐ ⇒⇒⇒ النتيجة: **نفس** صلاحيات الدور (لا تُضاف ولا تُزاد).
    const genuine = createSyntheticSession(1, 11, 101, 1, 'viewer');
    const tampered = { ...genuine, capabilities: [...CAPS, 'super.admin', 'conversation.assign'] };
    // ⭐ لا تمرير للحمولة ⇒ ⇒⇒ الأصل مُصنَّع ⇒ ⇒⇒ والحمولة المُعدَّلة ليست ⇒ ⇒⇒ رفض.
    assert.throws(
      () => resolveTenantContext(tampered, { source: localTestSessionSource, now: () => FIXED_NOW }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /لم يوثّق|unverified/);
        return true;
      },
    );
    // ⭐ والأصل بلا تعديل ⇒ ⇒⇒ صلاحيات الدور فقط (بلا `conversation.assign`).
    const context = resolveTenantContext(genuine, {
      source: LOCAL_TEST_SOURCES.viewer,
      now: () => FIXED_NOW,
    });
    assert.deepEqual([...context.capabilities], [
      'conversation.audit',
      'conversation.list',
      'conversation.read',
    ]);
    assert.equal(context.capabilities.includes('conversation.assign'), false);
    assert.equal(context.role, 'viewer');
  });

  await t.test('⭐ المسار الإنتاجي يرفض مصدر الاختبار ⇒ لا مسار إنتاجي من جلسة اختبار', () => {
    const genuine = createSyntheticSession(1, 11, 101, 1, 'viewer');
    assert.throws(
      () => resolveProductionTenantContext(genuine, localTestSessionSource),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /ليس إنتاجياً/);
        return true;
      },
    );
  });

  await t.test('⭐⭐ السطح العام لا يُصدّر أدوات إصدار الإثبات ⇒ لا بناء سياق من ادّعاءات', async () => {
    const production = (await import('../src/core/index.ts')) as Record<string, unknown>;
    for (const forbidden of ['tenantContextFromSession', 'issueSessionAttestation', 'registerSessionSource']) {
      assert.equal(forbidden in production, false, `${forbidden} مكشوف في السطح العام`);
    }
  });

  await t.test('⭐⭐⭐ ⭐ الفجوة مُغلقة: مصدر غير مسجَّل ⇒ رفض بنيوي', () => {
    // ⭐ مصدر لم يسجّله المالك ⇒ ⇒⇒ ⇒⇒ لا يبني سياقاً إطلاقاً.
    const rogue = {
      id: 'auth-rogue-0001' as const,
      scope: 'production' as const,
      description: 'مصدر لم يُسجَّل',
      verify: () => ({
        session_id: 'sess_rogue_0001',
        tenant_id: 'tnt_rogue_0001',
        actor_id: 'actor_rogue_0001',
        conversation_ref: 'conv_rogue_0001',
        authenticated: true,
      }),
    };
    assert.throws(
      () => resolveTenantContext({}, { source: rogue, now: () => FIXED_NOW }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /غير مسج/);
        return true;
      },
    );
  });
});

test('١٢) عدم وجود اتصالات خارجية', async (t) => {
  await t.test('⭐ الحاجز مُركَّب ولم تُسجَّل أي محاولة', () => {
    assert.equal(guard.installed, true);
    assert.deepEqual(guard.blocked, []);
  });

  await t.test('⭐⭐ فحص ساكن لملفات الشريحة الثالثة: صفر رمز شبكة', () => {
    const NETWORK_TOKENS: readonly string[] = [
      'fetch(',
      'XMLHttpRequest',
      'WebSocket',
      'http.request',
      'https.request',
      'net.connect',
      'dns.lookup',
      'require(',
      'node:fs',
      'node:http',
      'node:https',
    ];
    const files = [
      'src/core/capability.ts',
      'src/core/conversation-query.ts',
      'src/core/read-audit.ts',
    ];
    for (const file of files) {
      const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
      for (const token of NETWORK_TOKENS) {
        assert.equal(text.includes(token), false, `رمز شبكة «${token}» داخل ${file}`);
      }
    }
  });
});

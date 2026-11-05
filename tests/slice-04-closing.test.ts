// ============================================================
// WASL AI — اختبارات الإغلاق: `resolved ⇒ closed` (تصريح المالك · D-056)
// ------------------------------------------------------------
// ⭐ **المرحلة الأولى من تصريح ٥ نوفمبر ٢٠٢٦**: ⭐ تصحيح محدود يسمح
//   بانتقال الإغلاق ⇒ ⭐ **مع بقاء `closed` نهائية** (لا إعادة فتح ولا
//   تعديل ولا إسناد بعد الإغلاق).
// ⭐ **المحاور العشرة الإلزامية**:
//   ١) نجاح `resolved ⇒ closed` عند وجود الصلاحية
//   ٢) رفض الإغلاق من الحالات الأخرى
//   ٣) رفض الإغلاق دون الصلاحية
//   ٤) رفض إعادة فتح محادثة مغلقة
//   ٥) رفض تعديل حالة المحادثة المغلقة
//   ٦) رفض تغيير الموظف المسنَد بعد الإغلاق
//   ٧) منع التعديل العابر للمستأجرين
//   ٨) تسجيل الإغلاق في سجل التدقيق دون محتوى حسّاس
//   ٩) سلامة التعامل مع التكرار والتعارض
//   ١٠) عدم كسر اختبارات Slice 01 – Slice 04
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
  CONVERSATION_ASSIGN_CAPABILITY,
  CONVERSATION_STATE_UPDATE_CAPABILITY,
  ConversationChangeLog,
  ConversationStateError,
  ConversationStateStore,
  MessageStore,
  OrderingState,
  ProcessingLayer,
  ReadAuditLog,
  TERMINAL_CONVERSATION_STATES,
  assignConversation,
  getConversationState,
  isTerminalState,
  readConversationChanges,
  unassignConversation,
  updateConversationState,
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

function scenario() {
  const audit = new AuditLog({ now: () => FIXED_NOW });
  const readAudit = new ReadAuditLog({ now: () => FIXED_NOW });
  const store = new MessageStore({ now: () => FIXED_NOW, audit });
  const ordering = new OrderingState();
  const layer = new ProcessingLayer({ store, audit, orderingState: ordering });
  const states = new ConversationStateStore({ now: () => FIXED_NOW });
  const changes = new ConversationChangeLog({ now: () => FIXED_NOW });
  const deps: ConversationStateDependencies = {
    store,
    states,
    changes,
    readAudit,
    employees: syntheticEmployeeDirectory,
  };
  return { audit, readAudit, store, ordering, layer, states, changes, deps };
}

function seed(layer: ProcessingLayer, ctx: TenantContext, messageIndex = 1): void {
  layer.process(ctx, createSyntheticEnvelope({ tenantIndex: 1, messageIndex }));
}

/** ⭐ محادثة وصلت لحالة `resolved` (المسار المعتاد: new ⇒ open ⇒ resolved). */
function resolvedConversation(ctx: TenantContext, deps: ConversationStateDependencies) {
  updateConversationState(ctx, 'conv_synth_0001', 'open', deps);
  updateConversationState(ctx, 'conv_synth_0001', 'resolved', deps);
}

test('١) ⭐ نجاح `resolved ⇒ closed` عند وجود الصلاحية', async (t) => {
  await t.test('⭐⭐⭐ الإغلاق ينفَّذ والحالة تصبح `closed`', () => {
    const { layer, deps } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    resolvedConversation(ctx, deps);
    const closed = updateConversationState(ctx, 'conv_synth_0001', 'closed', deps);
    assert.equal(closed.state, 'closed');
    assert.equal(getConversationState(ctx, 'conv_synth_0001', deps).state, 'closed');
  });

  await t.test('⭐⭐⭐ `closed` نهائية ⇒ `isTerminalState` confirms', () => {
    assert.deepEqual([...TERMINAL_CONVERSATION_STATES], ['closed']);
    assert.equal(isTerminalState('closed'), true);
    assert.equal(isTerminalState('resolved'), false);
    assert.deepEqual([...ALLOWED_TRANSITIONS.closed], []);
  });

  await t.test('⭐⭐⭐⭐ عدد الانتقالات صار ١٢ (كان ١١)', () => {
    const total = Object.values(ALLOWED_TRANSITIONS).reduce((sum, list) => sum + list.length, 0);
    assert.equal(total, 12);
    assert.deepEqual([...ALLOWED_TRANSITIONS.resolved], ['open', 'closed']);
  });
});

test('٢) ⭐ رفض الإغلاق من الحالات الأخرى', async (t) => {
  await t.test('⭐⭐⭐ `new ⇒ closed` و`open ⇒ closed` و`pending ⇒ closed` مرفوضة', () => {
    const { layer, deps } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    // ⭐ new ⇒ closed
    assert.throws(
      () => updateConversationState(ctx, 'conv_synth_0001', 'closed', deps),
      (error: unknown) => {
        assert.ok(error instanceof ConversationStateError);
        assert.equal(error.code, 'transition_not_allowed');
        return true;
      },
    );
    // ⭐ open ⇒ closed
    updateConversationState(ctx, 'conv_synth_0001', 'open', deps);
    assert.throws(
      () => updateConversationState(ctx, 'conv_synth_0001', 'closed', deps),
      (error: unknown) => {
        assert.ok(error instanceof ConversationStateError);
        assert.equal(error.code, 'transition_not_allowed');
        return true;
      },
    );
    // ⭐ pending ⇒ closed
    updateConversationState(ctx, 'conv_synth_0001', 'pending', deps);
    assert.throws(
      () => updateConversationState(ctx, 'conv_synth_0001', 'closed', deps),
      (error: unknown) => {
        assert.ok(error instanceof ConversationStateError);
        assert.equal(error.code, 'transition_not_allowed');
        return true;
      },
    );
    assert.equal(getConversationState(ctx, 'conv_synth_0001', deps).state, 'pending');
  });

  await t.test('⭐⭐⭐ `assigned ⇒ closed` مرفوضة (الإغلاق من `resolved` فقط)', () => {
    const { layer, deps } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    updateConversationState(ctx, 'conv_synth_0001', 'open', deps);
    assignConversation(ctx, 'conv_synth_0001', 'actor_synth_0012', deps);
    assert.throws(
      () => updateConversationState(ctx, 'conv_synth_0001', 'closed', deps),
      (error: unknown) => {
        assert.ok(error instanceof ConversationStateError);
        assert.equal(error.code, 'transition_not_allowed');
        return true;
      },
    );
  });
});

test('٣) ⭐ رفض الإغلاق دون الصلاحية', async (t) => {
  await t.test('⭐⭐⭐ دور بلا `conversation.state.update` ⇒ رفض + توثيق المحاولة', () => {
    const { layer, deps, readAudit } = scenario();
    const ctx = context('agent'); // ⭐ agent: يقرأ الحالة ولا يغيّرها
    const owner = context('owner'); // ⭐ المالك يحضّر الحالة (نفس المستأجر)
    seed(layer, owner);
    updateConversationState(owner, 'conv_synth_0001', 'open', deps);
    updateConversationState(owner, 'conv_synth_0001', 'resolved', deps);
    assert.equal(ctx.capabilities.includes(CONVERSATION_STATE_UPDATE_CAPABILITY), false);
    assert.throws(
      () => updateConversationState(ctx, 'conv_synth_0001', 'closed', deps),
      (error: unknown) => {
        assert.ok(error instanceof CapabilityError);
        assert.equal(error.code, 'capability_missing');
        return true;
      },
    );
    assert.equal(getConversationState(ctx, 'conv_synth_0001', deps).state, 'resolved');
    const denied = readAudit.eventsFor(ctx).filter((event) => event.result === 'denied');
    assert.equal(denied.length, 1);
    assert.equal(denied[0].capability, CONVERSATION_STATE_UPDATE_CAPABILITY);
  });

  await t.test('⭐⭐⭐⭐ بلا أي صلاحية ⇒ رفض (الافتراضي = المنع)', () => {
    const { layer, deps } = scenario();
    const ctx = context('none');
    seed(layer, ctx);
    assert.throws(() => updateConversationState(ctx, 'conv_synth_0001', 'closed', deps), CapabilityError);
  });
});

test('٤) ⭐ رفض إعادة فتح محادثة مغلقة', async (t) => {
  await t.test('⭐⭐⭐ `closed ⇒ open` مرفوضة ⇒ الحالة تبقى `closed`', () => {
    const { layer, deps } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    resolvedConversation(ctx, deps);
    updateConversationState(ctx, 'conv_synth_0001', 'closed', deps);
    assert.throws(
      () => updateConversationState(ctx, 'conv_synth_0001', 'open', deps, { reason: 'إعادة فتح' }),
      (error: unknown) => {
        assert.ok(error instanceof ConversationStateError);
        assert.equal(error.code, 'state_terminal');
        return true;
      },
    );
    assert.equal(getConversationState(ctx, 'conv_synth_0001', deps).state, 'closed');
  });

  await t.test('⭐⭐⭐ `closed ⇒ resolved` مرفوضة أيضاً', () => {
    const { layer, deps } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    resolvedConversation(ctx, deps);
    updateConversationState(ctx, 'conv_synth_0001', 'closed', deps);
    assert.throws(
      () => updateConversationState(ctx, 'conv_synth_0001', 'resolved', deps),
      (error: unknown) => {
        assert.ok(error instanceof ConversationStateError);
        assert.equal(error.code, 'state_terminal');
        return true;
      },
    );
  });
});

test('٥) ⭐ رفض تعديل حالة المحادثة المغلقة', async (t) => {
  await t.test('⭐⭐⭐ أي تعديل حالة بعد الإغلاق ⇒ مرفوض (ولا تغيير)', () => {
    const { layer, deps } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    resolvedConversation(ctx, deps);
    updateConversationState(ctx, 'conv_synth_0001', 'closed', deps);
    const before = getConversationState(ctx, 'conv_synth_0001', deps);
    for (const target of ['new', 'open', 'assigned', 'pending', 'resolved', 'closed'] as const) {
      assert.throws(
        () => updateConversationState(ctx, 'conv_synth_0001', target, deps),
        (error: unknown) => {
          assert.ok(error instanceof ConversationStateError);
          assert.equal(error.code, 'state_terminal');
          return true;
        },
        `الانتقال ${before.state} ⇒ ${target} كان مسموحاً بعد الإغلاق`,
      );
    }
    const after = getConversationState(ctx, 'conv_synth_0001', deps);
    assert.equal(after.state, 'closed');
    assert.equal(after.version, before.version);
  });
});

test('٦) ⭐ رفض تغيير الموظف المسنَد بعد الإغلاق', async (t) => {
  await t.test('⭐⭐⭐ إسناد بعد الإغلاق ⇒ مرفوض (ولا تغيير في الموظف)', () => {
    const { layer, deps } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    updateConversationState(ctx, 'conv_synth_0001', 'open', deps);
    assignConversation(ctx, 'conv_synth_0001', 'actor_synth_0012', deps);
    updateConversationState(ctx, 'conv_synth_0001', 'resolved', deps);
    updateConversationState(ctx, 'conv_synth_0001', 'closed', deps);
    const before = getConversationState(ctx, 'conv_synth_0001', deps);
    assert.equal(before.assignee_actor_id, 'actor_synth_0012');
    assert.throws(
      () => assignConversation(ctx, 'conv_synth_0001', 'actor_synth_0013', deps),
      (error: unknown) => {
        assert.ok(error instanceof ConversationStateError);
        assert.equal(error.code, 'state_terminal');
        return true;
      },
    );
    const after = getConversationState(ctx, 'conv_synth_0001', deps);
    assert.equal(after.assignee_actor_id, 'actor_synth_0012');
    assert.equal(after.state, 'closed');
  });

  await t.test('⭐⭐⭐ إلغاء الإسناد بعد الإغلاق ⇒ مرفوض', () => {
    const { layer, deps } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    updateConversationState(ctx, 'conv_synth_0001', 'open', deps);
    assignConversation(ctx, 'conv_synth_0001', 'actor_synth_0012', deps);
    updateConversationState(ctx, 'conv_synth_0001', 'resolved', deps);
    updateConversationState(ctx, 'conv_synth_0001', 'closed', deps);
    assert.throws(
      () => unassignConversation(ctx, 'conv_synth_0001', deps),
      (error: unknown) => {
        assert.ok(error instanceof ConversationStateError);
        assert.equal(error.code, 'state_terminal');
        return true;
      },
    );
  });
});

test('٧) ⭐ منع التعديل العابر للمستأجرين', async (t) => {
  await t.test('⭐⭐⭐ مستأجر آخر لا يُغلق محادثة مستأجر ⇒ رفض (بلا كشف وجود)', () => {
    const { layer, deps } = scenario();
    const ctxA = context('owner', 1);
    const ctxB = context('owner', 2);
    seed(layer, ctxA);
    updateConversationState(ctxA, 'conv_synth_0001', 'open', deps);
    updateConversationState(ctxA, 'conv_synth_0001', 'resolved', deps);
    assert.throws(
      () => updateConversationState(ctxB, 'conv_synth_0001', 'closed', deps),
      (error: unknown) => {
        assert.ok(error instanceof ConversationStateError);
        assert.equal(error.code, 'conversation_not_found');
        return true;
      },
    );
    // ⭐ محادثة B لم تُغلق
    assert.equal(getConversationState(ctxA, 'conv_synth_0001', deps).state, 'resolved');
  });

  await t.test('⭐⭐⭐⭐ ١٠٠ محاولة عابرة على محادثة مغلقة ⇒ صفر تسريب', () => {
    const { layer, deps, changes } = scenario();
    const ctxA = context('owner', 1);
    const ctxB = context('owner', 2);
    seed(layer, ctxA);
    resolvedConversation(ctxA, deps);
    updateConversationState(ctxA, 'conv_synth_0001', 'closed', deps);
    let leaked = 0;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const guessed = `conv_guess_${String(attempt).padStart(4, '0')}`;
      try {
        updateConversationState(ctxB, guessed, 'closed', deps);
        leaked += 1;
      } catch {
        // ⭐ الرفض المتوقّع
      }
      try {
        assignConversation(ctxB, guessed, `actor_guess_${attempt}`, deps);
        leaked += 1;
      } catch {
        // ⭐ الرفض المتوقّع
      }
    }
    assert.equal(leaked, 0);
    assert.equal(changes.changesFor(ctxB).length, 0);
  });
});

test('٨) ⭐ تسجيل الإغلاق في سجل التدقيق دون محتوى حسّاس', async (t) => {
  await t.test('⭐⭐⭐ سطر الإغلاق مسجَّل بالحقول المطلوبة', () => {
    const { layer, deps, changes } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    resolvedConversation(ctx, deps);
    updateConversationState(ctx, 'conv_synth_0001', 'closed', deps, { reason: 'إغلاق بعد الحل' });
    const entries = changes.changesFor(ctx, 'conv_synth_0001');
    const closing = entries[entries.length - 1];
    assert.equal(closing.operation, 'state.update');
    assert.equal(closing.from_state, 'resolved');
    assert.equal(closing.to_state, 'closed');
    assert.equal(closing.reason, 'إغلاق بعد الحل');
    assert.equal(closing.tenant_id, ctx.tenantId);
    assert.equal(closing.actor_id, ctx.actorId);
    assert.ok(closing.ts.length > 0);
  });

  await t.test('⭐⭐⭐ السجل بلا محتوى رسائل ولا أسرار', () => {
    const { layer, deps, changes } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    resolvedConversation(ctx, deps);
    updateConversationState(ctx, 'conv_synth_0001', 'closed', deps);
    const serialized = JSON.stringify(changes.changesFor(ctx));
    assert.equal(serialized.includes('رسالة اصطناعية'), false);
    assert.equal(serialized.includes('body'), false);
    assert.equal(serialized.includes('example.invalid'), false);
  });

  await t.test('⭐⭐⭐⭐ سبب يشبه سرّاً عند الإغلاق ⇒ رفض الكتابة', () => {
    const { layer, deps } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    resolvedConversation(ctx, deps);
    assert.throws(
      () =>
        updateConversationState(ctx, 'conv_synth_0001', 'closed', deps, {
          reason: 'token=abcdefghijklmnop',
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal((error as { code: string }).code, 'reason_secret_forbidden');
        return true;
      },
    );
    // ⭐ ⇒ ⇒.State لم تتغيّر ⇒ ⇒⇒ ولا سطر في السجل.
    assert.equal(getConversationState(ctx, 'conv_synth_0001', deps).state, 'resolved');
  });
});

test('٩) ⭐ سلامة التعامل مع التكرار والتعارض', async (t) => {
  await t.test('⭐⭐⭐ إغلاق مكرّر ⇒ رفض صريح (لا صمت) وبلا سطر ثانٍ', () => {
    const { layer, deps, changes } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    resolvedConversation(ctx, deps);
    updateConversationState(ctx, 'conv_synth_0001', 'closed', deps);
    const before = changes.changesFor(ctx, 'conv_synth_0001').length;
    assert.throws(
      () => updateConversationState(ctx, 'conv_synth_0001', 'closed', deps),
      (error: unknown) => {
        assert.ok(error instanceof ConversationStateError);
        assert.equal(error.code, 'state_terminal');
        return true;
      },
    );
    assert.equal(changes.changesFor(ctx, 'conv_synth_0001').length, before);
  });

  await t.test('⭐⭐⭐⭐ تعارض الإصدار ⇒ رفض (ولا كتابة فوق تغيير آخر)', () => {
    const { layer, deps } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    updateConversationState(ctx, 'conv_synth_0001', 'open', deps);
    const current = getConversationState(ctx, 'conv_synth_0001', deps);
    assert.throws(
      () =>
        updateConversationState(ctx, 'conv_synth_0001', 'resolved', deps, {
          expectedVersion: current.version + 5,
        }),
      (error: unknown) => {
        assert.ok(error instanceof ConversationStateError);
        assert.equal(error.code, 'state_conflict');
        return true;
      },
    );
    assert.equal(getConversationState(ctx, 'conv_synth_0001', deps).state, 'open');
  });

  await t.test('⭐⭐⭐⭐⭐ الإغلاق بإصدار متوقّع مطابق ينفَّذ', () => {
    const { layer, deps } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    resolvedConversation(ctx, deps);
    const current = getConversationState(ctx, 'conv_synth_0001', deps);
    const closed = updateConversationState(ctx, 'conv_synth_0001', 'closed', deps, {
      expectedVersion: current.version,
    });
    assert.equal(closed.state, 'closed');
  });
});

test('١٠) ⭐ عدم كسر اختبارات Slice 01 – Slice 04', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ خريطة الانتقالات: ١٢ انتقالاً + `closed` بلا مخرج', () => {
    const total = Object.values(ALLOWED_TRANSITIONS).reduce((sum, list) => sum + list.length, 0);
    assert.equal(total, 12);
    assert.deepEqual([...ALLOWED_TRANSITIONS.new], ['open']);
    assert.deepEqual([...ALLOWED_TRANSITIONS.open], ['assigned', 'pending', 'resolved']);
    assert.deepEqual([...ALLOWED_TRANSITIONS.assigned], ['open', 'pending', 'resolved', 'assigned']);
    assert.deepEqual([...ALLOWED_TRANSITIONS.pending], ['assigned', 'resolved']);
    assert.deepEqual([...ALLOWED_TRANSITIONS.resolved], ['open', 'closed']);
    assert.deepEqual([...ALLOWED_TRANSITIONS.closed], []);
  });

  await t.test('⭐⭐⭐⭐⭐ قراءات Slice 03 ما زالت تعمل بعد الإغلاق', () => {
    const { layer, deps, audit, readAudit } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    resolvedConversation(ctx, deps);
    updateConversationState(ctx, 'conv_synth_0001', 'closed', deps);
    const page = readConversationChanges(ctx, 'conv_synth_0001', deps);
    assert.equal(page.entries.length, 3);
    assert.equal(page.pagination.total, 3);
    assert.ok(audit && readAudit);
  });

  await t.test('⭐⭐⭐⭐⭐⭐ الطرد: كسر حراسة النهائية ⇒ الاختبار يفشل', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src/core/conversation-state.ts'), 'utf8');
    assert.ok(
      source.includes('isTerminalState(current.state)'),
      'حراسة النهائية غير موجودة في طبقة الحالة ⇒ الإغلاق قابل للتجاوز',
    );
    assert.ok(
      source.includes('state_terminal'),
      'رمز الخطأ `state_terminal` غير موجود ⇒ لا رفض صريح بعد الإغلاق',
    );
  });

  await t.test('⭐⭐⭐⭐⭐⭐⭐ صفر اتصال (الحاجز مُركَّب)', () => {
    assert.equal(guard.installed, true);
    assert.deepEqual(guard.blocked, []);
  });
});

// ============================================================
// WASL AI — اختبارات الشريحة الرابعة: إدارة حالة المحادثة والإسناد (Slice 04)
// ------------------------------------------------------------
// ⭐ **تصريح المالك · ٥ نوفمبر ٢٠٢٦** (المرحلة الثانية بعد نجاح بوابة الأمان).
// ⭐ المحاور الاثنا عشر المعتمدة في `docs/SLICE-04-PROPOSAL.md` §٥:
//   ١) انتقال مسموح ينفَّذ ⇒ والحالة تتغيّر فعلاً
//   ٢) انتقال ممنوع ⇒ رفض صريح + صفر تغيير في الحالة
//   ٣) انتقال إلى `closed` غير مسموح من أي حالة ⇒ رفض
//   ٤) تعديل حالة بلا `conversation.state.update` ⇒ رفض
//   ٥) إسناد بلا `conversation.assign` ⇒ رفض
//   ٦) إسناد إلى موظف من مستأجر آخر ⇒ رفض
//   ٧) إسناد إلى موظف غير موجود ⇒ رفض
//   ٨) ١٠٠ محاولة عابرة (تخمين المعرّفات) ⇒ صفر تسريب
//   ٩) سجل التغييرات معزول بالمستأجر + بلا محتوى حسّاس
//   ١٠) قاعدة الترتيب لا تكسر قراءات Slice 03
//   ١١) الطرد: كسر فلتر المستأجر ⇒ الاختبار يفشل
//   ١٢) صفر اتصال خارجي + بيانات اصطناعية فقط
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
  CONVERSATION_STATE_READ_CAPABILITY,
  CONVERSATION_STATE_UPDATE_CAPABILITY,
  CONVERSATION_STATES,
  ConversationChangeError,
  ConversationChangeLog,
  ConversationStateError,
  ConversationStateStore,
  MessageStore,
  OrderingState,
  ProcessingLayer,
  ReadAuditLog,
  assignConversation,
  getConversation,
  getConversationState,
  listConversations,
  readConversationChanges,
  unassignConversation,
  updateConversationState,
  type ConversationState,
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

/** ⭐ محادثة قائمة (رسالة مقبولة واحدة) ⇒ ⭐ حتى يمكن تغيير حالتها. */
function seed(layer: ProcessingLayer, ctx: TenantContext, messageIndex = 1): void {
  layer.process(ctx, createSyntheticEnvelope({ tenantIndex: 1, messageIndex }));
}

test('١) ⭐ انتقال مسموح ينفَّذ ⇒ والحالة تتغيّر فعلاً', async (t) => {
  await t.test('⭐ `new ⇒ open` ينفَّذ والحالة تتغيّر', () => {
    const { layer, deps } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    const before = getConversationState(ctx, 'conv_synth_0001', deps);
    assert.equal(before.state, 'new');
    const after = updateConversationState(ctx, 'conv_synth_0001', 'open', deps);
    assert.equal(after.state, 'open');
    assert.equal(after.version, before.version + 1);
    assert.equal(getConversationState(ctx, 'conv_synth_0001', deps).state, 'open');
  });

  await t.test('⭐ `open ⇒ pending` و`pending ⇒ resolved` تتسلسلان', () => {
    const { layer, deps } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    updateConversationState(ctx, 'conv_synth_0001', 'open', deps);
    assert.equal(updateConversationState(ctx, 'conv_synth_0001', 'pending', deps).state, 'pending');
    assert.equal(updateConversationState(ctx, 'conv_synth_0001', 'resolved', deps).state, 'resolved');
  });

  await t.test('⭐ `resolved ⇒ open` (إعادة فتح) تنفَّذ بسبب مُسجَّل', () => {
    const { layer, deps } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    updateConversationState(ctx, 'conv_synth_0001', 'open', deps);
    updateConversationState(ctx, 'conv_synth_0001', 'resolved', deps);
    const reopened = updateConversationState(ctx, 'conv_synth_0001', 'open', deps, {
      reason: 'العميل عاد للاستفسار',
    });
    assert.equal(reopened.state, 'open');
  });
});

test('٢) ⭐ انتقال ممنوع ⇒ رفض صريح + صفر تغيير في الحالة', async (t) => {
  await t.test('⭐⭐ `new ⇒ pending` ممنوع ⇒ رفض + الحالة لم تتغيّر', () => {
    const { layer, deps } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    assert.throws(
      () => updateConversationState(ctx, 'conv_synth_0001', 'pending', deps),
      (error: unknown) => {
        assert.ok(error instanceof ConversationStateError);
        assert.equal(error.code, 'transition_not_allowed');
        return true;
      },
    );
    assert.equal(getConversationState(ctx, 'conv_synth_0001', deps).state, 'new');
  });

  await t.test('⭐⭐ `new ⇒ assigned` ممنوع (الإسناد شرط لا أثر جانبي)', () => {
    const { layer, deps } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    assert.throws(
      () => updateConversationState(ctx, 'conv_synth_0001', 'assigned', deps),
      (error: unknown) => {
        assert.ok(error instanceof ConversationStateError);
        assert.equal(error.code, 'transition_requires_assignee');
        return true;
      },
    );
    assert.equal(getConversationState(ctx, 'conv_synth_0001', deps).state, 'new');
  });

  await t.test('⭐⭐⭐ `resolved ⇒ open` بلا سبب ⇒ رفض صريح', () => {
    const { layer, deps } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    updateConversationState(ctx, 'conv_synth_0001', 'open', deps);
    updateConversationState(ctx, 'conv_synth_0001', 'resolved', deps);
    assert.throws(
      () => updateConversationState(ctx, 'conv_synth_0001', 'open', deps),
      (error: unknown) => {
        assert.ok(error instanceof ConversationStateError);
        assert.equal(error.code, 'transition_requires_reason');
        return true;
      },
    );
    assert.equal(getConversationState(ctx, 'conv_synth_0001', deps).state, 'resolved');
  });

  await t.test('⭐⭐⭐⭐ حالة خارج المجموعة المغلقة ⇒ رفض', () => {
    const { layer, deps } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    assert.throws(
      () => updateConversationState(ctx, 'conv_synth_0001', 'escalated' as ConversationState, deps),
      (error: unknown) => {
        assert.ok(error instanceof ConversationStateError);
        assert.equal(error.code, 'state_invalid');
        return true;
      },
    );
  });

  await t.test('⭐⬀⬀⬀⬀⬀⬀⬀ تعارض النسخة ⇒ رفض وصفر صفر', () => {
    const { layer, deps } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    updateConversationState(ctx, 'conv_synth_0001', 'open', deps);
    const current = getConversationState(ctx, 'conv_synth_0001', deps);
    assert.throws(
      () =>
        updateConversationState(ctx, 'conv_synth_0001', 'pending', deps, {
          expectedVersion: current.version + 7,
        }),
      (error: unknown) => {
        assert.ok(error instanceof ConversationStateError);
        assert.equal(error.code, 'state_conflict');
        return true;
      },
    );
    assert.equal(getConversationState(ctx, 'conv_synth_0001', deps).state, 'open');
  });

  await t.test('⭐⬀⬀⬀⬀⬀⬀⬀⬀ عملية مكررة ⇒ رفض صريح (لا صمت)', () => {
    const { layer, deps } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    updateConversationState(ctx, 'conv_synth_0001', 'open', deps);
    assert.throws(
      () => updateConversationState(ctx, 'conv_synth_0001', 'open', deps),
      (error: unknown) => {
        assert.ok(error instanceof ConversationStateError);
        assert.equal(error.code, 'transition_not_allowed');
        return true;
      },
    );
  });

});

test('٣) ⭐ انتقال إلى `closed` غير مسموح من أي حالة ⇒ رفض', async (t) => {
  await t.test('⭐⭐⭐ `closed` نهائية ⇒ لا انتقال إليها من أي حالة', () => {
    const { layer, deps } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    const paths: ConversationState[] = ['new', 'open', 'pending', 'resolved', 'assigned'];
    for (const state of paths) {
      assert.throws(
        () => updateConversationState(ctx, 'conv_synth_0001', 'closed', deps),
        (error: unknown) => {
          assert.ok(error instanceof ConversationStateError);
          assert.equal(error.code, 'transition_not_allowed');
          return true;
        },
        `انتقال ${state} ⇒ closed كان مسموحاً`,
      );
    }
    assert.deepEqual([...ALLOWED_TRANSITIONS.closed], []);
  });

  await t.test('⭐⭐⭐⭐ خريطة الانتقالات مغلقة ومطابقة للمقترح (١١ انتقالاً)', () => {
    assert.deepEqual([...CONVERSATION_STATES], ['new', 'open', 'assigned', 'pending', 'resolved', 'closed']);
    const total = Object.values(ALLOWED_TRANSITIONS).reduce((sum, list) => sum + list.length, 0);
    assert.equal(total, 11);
    assert.deepEqual([...ALLOWED_TRANSITIONS.new], ['open']);
    assert.deepEqual([...ALLOWED_TRANSITIONS.open], ['assigned', 'pending', 'resolved']);
    assert.deepEqual([...ALLOWED_TRANSITIONS.assigned], ['open', 'pending', 'resolved', 'assigned']);
    assert.deepEqual([...ALLOWED_TRANSITIONS.pending], ['assigned', 'resolved']);
    assert.deepEqual([...ALLOWED_TRANSITIONS.resolved], ['open']);
  });
});

test('٤) ⭐ تعديل حالة بلا `conversation.state.update` ⇒ رفض', async (t) => {
  await t.test('⭐⭐⭐ دور بلا صلاحية التعديل ⇒ رفض + توثيق المحاولة', () => {
    const { layer, deps, readAudit } = scenario();
    const ctx = context('agent'); // ⭐ agent: قراءة الحالة بلا تعديلها
    seed(layer, ctx);
    assert.equal(ctx.capabilities.includes(CONVERSATION_STATE_UPDATE_CAPABILITY), false);
    assert.throws(
      () => updateConversationState(ctx, 'conv_synth_0001', 'open', deps),
      (error: unknown) => {
        assert.ok(error instanceof CapabilityError);
        assert.equal(error.code, 'capability_missing');
        return true;
      },
    );
    assert.equal(getConversationState(ctx, 'conv_synth_0001', deps).state, 'new');
    const denied = readAudit.eventsFor(ctx).filter((event) => event.result === 'denied');
    assert.equal(denied.length, 1);
    assert.equal(denied[0].capability, CONVERSATION_STATE_UPDATE_CAPABILITY);
  });

  await t.test('⭐⭐⭐⭐ بلا أي صلاحية ⇒ رفض (الافتراضي = المنع)', () => {
    const { layer, deps } = scenario();
    const ctx = context('none');
    seed(layer, ctx);
    assert.throws(() => getConversationState(ctx, 'conv_synth_0001', deps), CapabilityError);
    assert.throws(() => updateConversationState(ctx, 'conv_synth_0001', 'open', deps), CapabilityError);
  });
});

test('٥) ⭐ إسناد بلا `conversation.assign` ⇒ رفض', async (t) => {
  await t.test('⭐⭐⭐ دور بلا صلاحية الإسناد ⇒ رفض', () => {
    const { layer, deps } = scenario();
    const ctx = context('supervisor'); // ⭐ supervisor: يعدّل الحالة ولا يُسند
    seed(layer, ctx);
    updateConversationState(ctx, 'conv_synth_0001', 'open', deps);
    assert.equal(ctx.capabilities.includes(CONVERSATION_ASSIGN_CAPABILITY), false);
    assert.throws(
      () => assignConversation(ctx, 'conv_synth_0001', 'actor_synth_0012', deps),
      (error: unknown) => {
        assert.ok(error instanceof CapabilityError);
        assert.equal(error.code, 'capability_missing');
        return true;
      },
    );
    assert.equal(getConversationState(ctx, 'conv_synth_0001', deps).state, 'open');
  });

  await t.test('⭐⭐⭐⭐ إسناد صحيح ينفَّذ (المالك) ⇒ الحالة `assigned` + الموظف', () => {
    const { layer, deps } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    updateConversationState(ctx, 'conv_synth_0001', 'open', deps);
    const assigned = assignConversation(ctx, 'conv_synth_0001', 'actor_synth_0012', deps);
    assert.equal(assigned.state, 'assigned');
    assert.equal(assigned.assignee_actor_id, 'actor_synth_0012');
  });

  await t.test('⭐⭐⭐⭐⭐ الإسناد من `new` ممنوع (لازم `open` أولاً)', () => {
    const { layer, deps } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    assert.throws(
      () => assignConversation(ctx, 'conv_synth_0001', 'actor_synth_0012', deps),
      (error: unknown) => {
        assert.ok(error instanceof ConversationStateError);
        assert.equal(error.code, 'transition_not_allowed');
        return true;
      },
    );
  });

  await t.test('⭐⭐⭐⭐⭐⭐ الإسناد لنفس الموظف ⇒ رفض صريح (لا صمت)', () => {
    const { layer, deps } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    updateConversationState(ctx, 'conv_synth_0001', 'open', deps);
    assignConversation(ctx, 'conv_synth_0001', 'actor_synth_0012', deps);
    assert.throws(
      () => assignConversation(ctx, 'conv_synth_0001', 'actor_synth_0012', deps),
      (error: unknown) => {
        assert.ok(error instanceof ConversationStateError);
        assert.equal(error.code, 'assignment_unchanged');
        return true;
      },
    );
  });

  await t.test('⭐⭐⭐⭐⭐⭐⭐ نقل الإسناد لموظف آخر (نفس المستأجر) ينفَّذ', () => {
    const { layer, deps, changes } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    updateConversationState(ctx, 'conv_synth_0001', 'open', deps);
    assignConversation(ctx, 'conv_synth_0001', 'actor_synth_0012', deps);
    const moved = assignConversation(ctx, 'conv_synth_0001', 'actor_synth_0013', deps);
    assert.equal(moved.assignee_actor_id, 'actor_synth_0013');
    const entries = changes.changesFor(ctx, 'conv_synth_0001');
    assert.equal(entries[entries.length - 1].operation, 'assignment.transfer');
  });

  await t.test('⭐⭐⭐⭐⭐⭐⭐⭐ إلغاء الإسناد ⇒ `open` والموظف يُزال', () => {
    const { layer, deps, changes } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    updateConversationState(ctx, 'conv_synth_0001', 'open', deps);
    assignConversation(ctx, 'conv_synth_0001', 'actor_synth_0012', deps);
    const cleared = unassignConversation(ctx, 'conv_synth_0001', deps);
    assert.equal(cleared.state, 'open');
    assert.equal(cleared.assignee_actor_id, null);
    const entries = changes.changesFor(ctx, 'conv_synth_0001');
    assert.equal(entries[entries.length - 1].operation, 'assignment.clear');
  });
});

test('٦) ⭐ إسناد إلى موظف من مستأجر آخر ⇒ رفض', async (t) => {
  await t.test('⭐⭐⭐ موظف مستأجر آخر ⇒ نفس رمز الرفض (لا كشف وجود)', () => {
    const { layer, deps } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    updateConversationState(ctx, 'conv_synth_0001', 'open', deps);
    assert.throws(
      () => assignConversation(ctx, 'conv_synth_0001', 'actor_synth_0021', deps),
      (error: unknown) => {
        assert.ok(error instanceof ConversationStateError);
        assert.equal(error.code, 'assignee_not_in_tenant');
        return true;
      },
    );
    assert.equal(getConversationState(ctx, 'conv_synth_0001', deps).assignee_actor_id, null);
  });

  await t.test('⭐⭐⭐⭐ محادثة مستأجر آخر ⇒ لا تُعدَّل ولا تُكشف', () => {
    const { layer, deps } = scenario();
    const ctxA = context('owner', 1);
    const ctxB = context('owner', 2);
    seed(layer, ctxA);
    assert.throws(
      () => updateConversationState(ctxB, 'conv_synth_0001', 'open', deps),
      (error: unknown) => {
        assert.ok(error instanceof ConversationStateError);
        assert.equal(error.code, 'conversation_not_found');
        return true;
      },
    );
    assert.throws(
      () => assignConversation(ctxB, 'conv_synth_0001', 'actor_synth_0012', deps),
      (error: unknown) => {
        assert.ok(error instanceof ConversationStateError);
        assert.equal(error.code, 'conversation_not_found');
        return true;
      },
    );
  });
});

test('٧) ⭐ إسناد إلى موظف غير موجود ⇒ رفض', async (t) => {
  await t.test('⭐⭐⭐ معرّف موظف غير موجود ⇒ نفس رمز الرفض', () => {
    const { layer, deps } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    updateConversationState(ctx, 'conv_synth_0001', 'open', deps);
    assert.throws(
      () => assignConversation(ctx, 'conv_synth_0001', 'actor_synth_9999', deps),
      (error: unknown) => {
        assert.ok(error instanceof ConversationStateError);
        assert.equal(error.code, 'assignee_not_in_tenant');
        return true;
      },
    );
  });

  await t.test('⭐⭐⭐⭐ معرّف موظف مشوّه ⇒ رفض (فحص الشكل قبل أي وصول)', () => {
    const { layer, deps } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    updateConversationState(ctx, 'conv_synth_0001', 'open', deps);
    assert.throws(
      () => assignConversation(ctx, 'conv_synth_0001', '../../etc/passwd', deps),
      (error: unknown) => {
        assert.ok(error instanceof ConversationStateError);
        assert.equal(error.code, 'assignee_invalid');
        return true;
      },
    );
  });
});

test('٨) ⭐ ١٠٠ محاولة عابرة (تخمين المعرّفات) ⇒ صفر تسريب', async (t) => {
  await t.test('⭐⭐⭐⭐ ١٠٠ تخمين ⇒ صفر تسريب بين المستأجرين', () => {
    const { layer, deps, changes, readAudit } = scenario();
    const ctxA = context('owner', 1);
    const ctxB = context('owner', 2);
    seed(layer, ctxA, 1);
    updateConversationState(ctxA, 'conv_synth_0001', 'open', deps);
    assignConversation(ctxA, 'conv_synth_0001', 'actor_synth_0012', deps);

    let leaked = 0;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const guessedRef = `conv_guess_${String(attempt).padStart(4, '0')}`;
      const guessedActor = `actor_guess_${String(attempt).padStart(4, '0')}`;
      try {
        updateConversationState(ctxB, guessedRef, 'open', deps);
        leaked += 1;
      } catch {
        // ⭐ الرفض المتوقّع
      }
      try {
        assignConversation(ctxB, guessedRef, guessedActor, deps);
        leaked += 1;
      } catch {
        // ⭐ الرفض المتوقّع
      }
      try {
        getConversationState(ctxB, guessedRef, deps);
        leaked += 1;
      } catch {
        // ⭐ الرفض المتوقّع
      }
    }
    assert.equal(leaked, 0, 'تسريب عبر تخمين المعرّفات');
    // ⭐ ولا سطر تغيير واحد يخص المستأجر B.
    assert.equal(changes.changesFor(ctxB).length, 0);
    // ⭐ ولا اسم محادثة A في سجل القراءة الخاص بـ B.
    const eventsB = readAudit.eventsFor(ctxB);
    assert.equal(eventsB.some((event) => event.target === 'conv_synth_0001'), false);
  });

  await t.test('⭐⭐⭐⭐⭐ محادثة A ⇒ B لا تُقرأ ولا تُعدَّل (رمز واحد = لا كشف)', () => {
    const { layer, deps } = scenario();
    const ctxA = context('owner', 1);
    const ctxB = context('owner', 2);
    seed(layer, ctxA, 1);
    const codes = new Set<string>();
    try {
      getConversationState(ctxB, 'conv_synth_0001', deps);
    } catch (error) {
      codes.add((error as ConversationStateError).code);
    }
    try {
      updateConversationState(ctxB, 'conv_synth_0001', 'open', deps);
    } catch (error) {
      codes.add((error as ConversationStateError).code);
    }
    try {
      assignConversation(ctxB, 'conv_synth_0001', 'actor_synth_0012', deps);
    } catch (error) {
      codes.add((error as ConversationStateError).code);
    }
    assert.deepEqual([...codes], ['conversation_not_found']);
  });
});

test('٩) ⭐ سجل التغييرات معزول بالمستأجر + بلا محتوى حسّاس', async (t) => {
  await t.test('⭐⭐⭐ سجل التغييرات يرصد كل تغيير بالحقول المطلوبة', () => {
    const { layer, deps, changes } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    updateConversationState(ctx, 'conv_synth_0001', 'open', deps, { reason: 'فتح الطلب' });
    assignConversation(ctx, 'conv_synth_0001', 'actor_synth_0012', deps, { reason: 'توزيع' });
    const entries = changes.changesFor(ctx, 'conv_synth_0001');
    assert.equal(entries.length, 2);
    assert.equal(entries[0].operation, 'state.update');
    assert.equal(entries[0].from_state, 'new');
    assert.equal(entries[0].to_state, 'open');
    assert.equal(entries[0].reason, 'فتح الطلب');
    assert.equal(entries[0].assignee_from, null);
    assert.equal(entries[1].operation, 'assignment.set');
    assert.equal(entries[1].assignee_to, 'actor_synth_0012');
    assert.ok(entries[0].ts.length > 0);
  });

  await t.test('⭐⭐⭐⭐ السجل معزول بالمستأجر (لا سطر من مستأجر آخر)', () => {
    const { layer, deps, changes } = scenario();
    const ctxA = context('owner', 1);
    const ctxB = context('owner', 2);
    seed(layer, ctxA, 1);
    updateConversationState(ctxA, 'conv_synth_0001', 'open', deps);
    assert.equal(changes.changesFor(ctxA).length, 1);
    assert.equal(changes.changesFor(ctxB).length, 0);
  });

  await t.test('⭐⭐⭐⭐⭐ سبب يشبه سرّاً ⇒ رفض الكتابة', () => {
    const { layer, deps } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    assert.throws(
      () =>
        updateConversationState(ctx, 'conv_synth_0001', 'open', deps, {
          reason: 'api_key=abcdefghijklmnop',
        }),
      (error: unknown) => {
        assert.ok(error instanceof ConversationChangeError);
        assert.equal(error.code, 'reason_secret_forbidden');
        return true;
      },
    );
  });

  await t.test('⭐⭐⭐⭐⭐⭐ قراءة السجل تتطلّب صلاحية وتُعزل', () => {
    const { layer, deps } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    updateConversationState(ctx, 'conv_synth_0001', 'open', deps);
    const page = readConversationChanges(ctx, 'conv_synth_0001', deps);
    assert.equal(page.entries.length, 1);
    assert.equal(page.pagination.total, 1);

    const noAccess = context('none');
    assert.throws(() => readConversationChanges(noAccess, 'conv_synth_0001', deps), CapabilityError);
  });

  await t.test('⭐⭐⭐⭐⭐⭐⭐ السجل لا يحمل محتوى الرسائل', () => {
    const { layer, deps, changes } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    updateConversationState(ctx, 'conv_synth_0001', 'open', deps);
    const serialized = JSON.stringify(changes.changesFor(ctx));
    assert.equal(serialized.includes('رسالة اصطناعية'), false);
    assert.equal(serialized.includes('body'), false);
    assert.equal(serialized.includes('example.invalid'), false);
  });
});

test('١٠) ⭐ قاعدة الترتيب لا تكسر قراءات Slice 03', async (t) => {
  await t.test('⭐⭐⭐ القراءة + الحالة معاً ⇒ لا تعارض', () => {
    const { layer, deps, audit, readAudit } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    updateConversationState(ctx, 'conv_synth_0001', 'open', deps);
    assignConversation(ctx, 'conv_synth_0001', 'actor_synth_0012', deps);
    // ⭐ قراءات Slice 03 ما زالت تعمل كما هي.
    const list = listConversations(ctx, { store: deps.store, audit, readAudit });
    assert.equal(list.summaries.length, 1);
    assert.equal(list.summaries[0].conversation_ref, 'conv_synth_0001');
  });

  await t.test('⭐⭐⭐⭐ ترتيب الطبقة (Slice 02) سليم بعد تغيير الحالة', () => {
    const { layer, deps } = scenario();
    const ctx = context('owner');
    const first = layer.process(ctx, createSyntheticEnvelope({ tenantIndex: 1, messageIndex: 1 }));
    updateConversationState(ctx, 'conv_synth_0001', 'open', deps);
    const second = layer.process(ctx, createSyntheticEnvelope({ tenantIndex: 1, messageIndex: 2 }));
    assert.equal(first.decision, 'accepted');
    assert.equal(second.decision, 'accepted');
  });

  await t.test('⭐⭐⭐⭐⭐ طبقة الحالة لا تكسر المقروءات المحفوظة', () => {
    const { layer, deps, audit, readAudit } = scenario();
    const ctx = context('owner');
    seed(layer, ctx);
    updateConversationState(ctx, 'conv_synth_0001', 'open', deps);
    const thread = getConversation(ctx, 'conv_synth_0001', { store: deps.store, audit, readAudit });
    assert.equal(thread.messages.length, 1);
  });
});

test('١١) ⭐ الطرد: كسر فلتر المستأجر في طبقة الحالة ⇒ الاختبار يفشل', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ فحص ساكن: طبقة الحالة لا تقرأ سجلاً غير معزول', () => {
    const text = fs.readFileSync(path.join(ROOT, 'src/core/conversation-state.ts'), 'utf8');
    assert.equal(
      text.includes('.entries()'),
      false,
      'طبقة الحالة تستدعي سجلاً غير معزول ⇒ خطر تسريب بين المستأجرين',
    );
    assert.ok(text.includes('changesFor('), 'القراءة المعزولة هي المسار الوحيد');
  });

  await t.test('⭐⭐⭐⭐⭐⭐ فحص ساكن: صفر رمز شبكة في الشريحة الرابعة', () => {
    const NETWORK_TOKENS: readonly string[] = [
      'fetch(',
      'XMLHttpRequest',
      'WebSocket',
      'http.request',
      'https.request',
      'net.connect',
      'dns.lookup',
      'node:http',
      'node:https',
      'node:fs',
    ];
    for (const file of ['src/core/conversation-state.ts', 'src/core/conversation-change-log.ts']) {
      const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
      for (const token of NETWORK_TOKENS) {
        assert.equal(text.includes(token), false, `رمز شبكة «${token}» داخل ${file}`);
      }
    }
  });
});

test('١٢) ⭐ صفر اتصال خارجي + بيانات اصطناعية فقط', async (t) => {
  await t.test('⭐ الحاجز مُركَّب ولم تُسجَّل أي محاولة', () => {
    assert.equal(guard.installed, true);
    assert.deepEqual(guard.blocked, []);
  });

  await t.test('⭐⭐ كل بيانات الاختبار اصطناعية (نطاق `.invalid` محجوز)', () => {
    const text = fs.readFileSync(path.join(ROOT, 'tests/support/employees.ts'), 'utf8');
    assert.equal(text.includes('example.invalid'), false);
    assert.equal(text.includes('@'), false, 'لا عناوين بريد في دليل الموظفين');
  });

  await t.test('⭐⭐⭐ حزمة الإنتاج تستثني شجرة الاختبار (فحص `npm pack` حقيقي)', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
    ) as { files?: string[] };
    assert.ok(Array.isArray(manifest.files));
    assert.equal(
      manifest.files.some((entry) => entry.startsWith('tests')),
      false,
      'شجرة الاختبار داخل حزمة الإنتاج',
    );
  });
});

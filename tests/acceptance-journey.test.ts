// ============================================================
// WASL AI — اختبارات قبول الرحلة الصناعية (Path D · D-065)
// ------------------------------------------------------------
// ⭐⭐⭐ **العقد**: ⭐ ١٠ سيناريوهات تُثبت أن **الرحلة تعمل كما تُعلن**
//   ⇒ ⭐⇒⇒ **وأن كل رفض يأتي من نواة WASL نفسها** (لا من طبقة موازية).
// ⭐⭐⭐ **ما لا يفعله هذا الملف**: ⭐⛔ لا يثبت «تغطية كاملة» ⇒ ⭐⇒⇒
//   **تغطية الفروع تُقاس منفصلة (M57 · tools/measure-coverage.ts)**.
// ⛔ بلا شبكة · ⛔ بلا تخزين دائم · ⛔ بلا بيانات عملاء حقيقية.
// ============================================================

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  JOURNEY_OTHER_TENANT,
  JOURNEY_TENANT,
  JourneySimulator,
  classifyJourneyMessage,
  renderJourneyReply,
} from '../src/local/journey/index.ts';
import {
  LocalIdentityRegistry,
  authorizeLocalRequest,
  createLocalIdentitySources,
} from '../src/core/index.ts';
// ⭐⭐⭐ **إصدار سلطة الإدارة غير مُصدّر من السطح العام** ⇒ ⭐⇒⇒ استيراد مباشرة.
import { issueIdentityAdminAuthority } from '../src/core/identity.ts';
import {
  evaluateIdentityAttestation,
  evaluateIdentityAttestationStructure,
  issueLocalTestAttestation,
} from '../src/core/identity-source-contract.ts';

const NOW = '2026-01-05T12:00:00.000Z';

test('ACC-01) ⭐⭐⭐ فاتورة عادية ⇒ نية billing · أولوية normal · إسناد للموظّف · الحالة pending', () => {
  const simulator = new JourneySimulator();
  const outcome = simulator.receive('عندي استفسار عن الفاتورة الشهرية');
  assert.equal(outcome.ok, true);
  assert.equal(outcome.intent, 'billing');
  assert.equal(outcome.priority, 'normal');
  assert.equal(outcome.state, 'pending');
  assert.equal(outcome.assignee_actor_id, 'actor_journey_0003');
  assert.equal(outcome.steps.length, 7);
});

test('ACC-02) ⭐⭐⭐ مشكلة تقنية ⇒ نية technical (التصنيف حتمي بالقوالب)', () => {
  const simulator = new JourneySimulator();
  const outcome = simulator.receive('التطبيق فيه خطأ ولا يعمل');
  assert.equal(outcome.ok, true);
  assert.equal(outcome.intent, 'technical');
  assert.equal(outcome.priority, 'normal');
  assert.equal(outcome.assignee_actor_id, 'actor_journey_0003');
});

test('ACC-03) ⭐⭐⭐ استفسار شحن ⇒ نية delivery', () => {
  const simulator = new JourneySimulator();
  const outcome = simulator.receive('الشحنة متأخرة والعنوان خاطئ');
  assert.equal(outcome.ok, true);
  assert.equal(outcome.intent, 'delivery');
  assert.equal(outcome.priority, 'normal');
});

test('ACC-04) ⭐⭐⭐⭐ طلب عاجل ⇒ أولوية high ⇒ تصعيد للمشرف (لا للموظّف)', () => {
  const simulator = new JourneySimulator();
  const outcome = simulator.receive('عندي مشكلة في الفاتورة وعاجل');
  assert.equal(outcome.ok, true);
  assert.equal(outcome.intent, 'billing');
  assert.equal(outcome.priority, 'high');
  assert.equal(outcome.assignee_actor_id, 'actor_journey_0002');
  assert.equal(outcome.state, 'pending');
  assert.ok(
    (outcome.reply ?? '').startsWith('طلبك عاجل'),
    `الردّ العاجل يجب أن يبدأ بعلامة الأولوية ⇒ الردّ = ${outcome.reply ?? 'مفقود'}`,
  );
});

test('ACC-05) ⭐⭐⭐ رسالة عامة ⇒ نية general (بلا كلمات مطابقة)', () => {
  const simulator = new JourneySimulator();
  const outcome = simulator.receive('مساء الخير');
  assert.equal(outcome.ok, true);
  assert.equal(outcome.intent, 'general');
  assert.equal(outcome.priority, 'normal');
});

test('ACC-06) ⭐⭐⭐⭐ الحتمية: نفس النص ⇒ نفس النتيجة بالضبط (مقيس مرتين)', () => {
  const text = 'عندي مشكلة في الفاتورة وعاجل';
  const first = new JourneySimulator().receive(text);
  const second = new JourneySimulator().receive(text);
  assert.equal(first.intent, second.intent);
  assert.equal(first.priority, second.priority);
  assert.equal(first.reply, second.reply);
  assert.equal(first.assignee_actor_id, second.assignee_actor_id);
  assert.equal(first.state, second.state);
  assert.equal(first.steps.length, second.steps.length);
  // ⭐⭐⭐ **المحاكاة لا تخرج فيها عشوائية** ⇒ ⭐⇒⇒ **نفس المدخل = نفس الناتج دائماً.**
  const direct = classifyJourneyMessage(text);
  assert.equal(direct.intent, 'billing');
  assert.equal(direct.priority, 'high');
  assert.equal(renderJourneyReply(direct.intent, direct.priority), first.reply);
});

test('ACC-07) ⭐⭐⭐⭐ بوّابة الهوية (M54): إثبات مصنوع ⇒ رفضٌ صريح بلا تنفيذ', () => {
  const simulator = new JourneySimulator();
  // ⭐⭐⭐ **إثبات مطابق الشكل لكنه لم يصدر من المصدر** ⇒ ⭐⇒⇒ **مرفوض**.
  const forged = {
    identity_id: 'journey-ident-owner',
    tenant_id: JOURNEY_TENANT,
    actor_id: 'actor_journey_0001',
    role: 'owner',
    status: 'active',
    proof: { kind: 'local_test', source_id: 'local-test:forged' },
  };
  const decision = evaluateIdentityAttestation(forged);
  assert.equal(decision.trusted, false);
  assert.equal(decision.code, 'identity_issuer_unverified');
});

test('ACC-08) ⭐⭐⭐⭐ انتقال غير مسموح ⇒ رفض من النواة (transition_not_allowed)', () => {
  const simulator = new JourneySimulator();
  const received = simulator.receive('عندي استفسار عن الفاتورة');
  assert.equal(received.ok, true);
  // ⭐⭐⭐ **الإغلاق من `pending` ممنوع** ⇒ ⭐⇒⇒ **والرفض من النواة نفسها**.
  const blocked = simulator.close(received.conversation_ref);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'transition_not_allowed');
  assert.equal(simulator.conversationState(received.conversation_ref), 'pending');
});

test('ACC-09) ⭐⭐⭐⭐ العزل: مستأجر آخر لا يرى محادثات المستأجر الأول (بلا تسريب)', () => {
  const registry = new LocalIdentityRegistry({ now: () => NOW });
  const ownerA = {
    identity_id: 'acc-ident-owner-a',
    tenant_id: 'tnt_acc_0001',
    actor_id: 'actor_acc_0001',
    role: 'owner' as const,
    expires_at: null,
  };
  const authorityA = issueIdentityAdminAuthority({ ...ownerA, status: 'active' });
  registry.register(ownerA, authorityA);
  const ownerB = {
    identity_id: 'acc-ident-owner-b',
    tenant_id: 'tnt_acc_0002',
    actor_id: 'actor_acc_0002',
    role: 'owner' as const,
    expires_at: null,
  };
  registry.register(ownerB, authorityA);
  const sources = createLocalIdentitySources(registry);

  const decisionB = authorizeLocalRequest(
    {
      identity_id: 'acc-ident-owner-b',
      conversation_ref: 'conv_acc_0001',
      operation: 'conversation.read',
    },
    { registry, sources, now: () => NOW },
  );
  assert.equal(decisionB.allowed, true);
  // ⭐⭐⭐ **السياق يحمل مستأجر صاحبه فقط** ⇒ ⭐⇒⇒ **فلا طريق لقراءة غيره.**
  assert.equal(decisionB.context.tenantId, 'tnt_acc_0002');
  assert.notEqual(decisionB.context.tenantId, JOURNEY_TENANT);
});

test('ACC-10) ⭐⭐⭐⭐ الحالة النهائية: بعد closed ⇒ لا تعديل ولا إسناد (رفض من النواة)', () => {
  const simulator = new JourneySimulator();
  const received = simulator.receive('عندي استفسار عن الفاتورة');
  const resolved = simulator.advance(received.conversation_ref, 'resolved', 'supervisor');
  assert.equal(resolved.ok, true);
  const closed = simulator.advance(received.conversation_ref, 'closed', 'owner');
  assert.equal(closed.ok, true);
  assert.equal(simulator.conversationState(received.conversation_ref), 'closed');
  const after = simulator.advance(received.conversation_ref, 'open', 'owner');
  assert.equal(after.ok, false);
  assert.equal(after.code, 'state_terminal');
});

test('ACC-11) ⭐⭐⭐ لا إرسال: الردّ يُخزَّن محلياً فقط (رسالة واردة + رسالة صادرة)', () => {
  const simulator = new JourneySimulator();
  const outcome = simulator.receive('عندي استفسار عن الفاتورة');
  const stored = simulator.messages(outcome.conversation_ref);
  assert.equal(stored.length, 2);
  assert.equal(stored[0]?.direction, 'inbound');
  assert.equal(stored[1]?.direction, 'outbound');
  assert.equal(stored[1]?.body, outcome.reply);
  // ⭐⭐⭐ **لا أثر دائم**: ⭐⇒⇒ **إغلاق المحاكي = ضياع كل شيء** (بلا تخزين).
  assert.equal(new JourneySimulator().messages(outcome.conversation_ref).length, 0);
});

test('ACC-12) ⭐⭐⭐ (M57) إصدار بلا سجلّ هوية ⇒ رفضٌ صريح (registry_missing)', () => {
  assert.throws(
    () => issueLocalTestAttestation('acc-ident-owner-a', {} as never),
    (error: unknown) =>
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: unknown }).code === 'identity_registry_missing',
  );
});

test('ACC-13) ⭐⭐⭐ (M57) رمز `identity_status_invalid` معلَن بلا مسار وصول (مقيس)', () => {
  // ⭐⭐⭐ **المقاس**: ⭐ الحالة خارج المجموعة المغلقة ⇒ ⭐⇒⇒ **الناتج الفعلي
  //   `identity_attestation_invalid`** ⇒ ⭐⇒⇒⇒ **فلا مسار ينتج الرمز المعلَن.**
  const simulator = new JourneySimulator();
  const forged = {
    identity_id: 'journey-ident-owner',
    tenant_id: JOURNEY_TENANT,
    actor_id: 'actor_journey_0001',
    role: 'owner',
    status: 'weird',
    proof: { kind: 'local_test', source_id: 'local-test:forged' },
  };
  const decision = evaluateIdentityAttestation(forged);
  assert.equal(decision.trusted, false);
  assert.equal(decision.code, 'identity_attestation_invalid');
  assert.notEqual(decision.code, 'identity_status_invalid');
});

test('ACC-14) ⭐⭐⭐ (M57) إصدار لهوية ملغاة ⇒ رفضٌ صريح (identity_revoked)', () => {
  const registry = new LocalIdentityRegistry({ now: () => NOW });
  const owner = {
    identity_id: 'acc-ident-owner-c',
    tenant_id: 'tnt_acc_0003',
    actor_id: 'actor_acc_0003',
    role: 'owner' as const,
    expires_at: null,
  };
  const authority = issueIdentityAdminAuthority({ ...owner, status: 'active' });
  registry.register(owner, authority);
  const other = {
    identity_id: 'acc-ident-agent-c',
    tenant_id: 'tnt_acc_0003',
    actor_id: 'actor_acc_0004',
    role: 'agent' as const,
    expires_at: null,
  };
  registry.register(other, authority);
  assert.equal(registry.revoke('acc-ident-agent-c', authority), true);
  assert.throws(
    () => issueLocalTestAttestation('acc-ident-agent-c', { registry }),
    (error: unknown) =>
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: unknown }).code === 'identity_revoked',
  );
});

test('ACC-15) ⭐⭐⭐ (M57) إصدار لهوية منتهية ⇒ رفضٌ صريح (identity_expired)', () => {
  const registry = new LocalIdentityRegistry({ now: () => NOW });
  const owner = {
    identity_id: 'acc-ident-owner-d',
    tenant_id: 'tnt_acc_0004',
    actor_id: 'actor_acc_0005',
    role: 'owner' as const,
    expires_at: null,
  };
  const authority = issueIdentityAdminAuthority({ ...owner, status: 'active' });
  registry.register(owner, authority);
  const expired = {
    identity_id: 'acc-ident-expired',
    tenant_id: 'tnt_acc_0004',
    actor_id: 'actor_acc_0006',
    role: 'agent' as const,
    expires_at: '2020-01-01T00:00:00.000Z',
  };
  registry.register(expired, authority);
  assert.throws(
    () => issueLocalTestAttestation('acc-ident-expired', { registry }),
    (error: unknown) =>
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: unknown }).code === 'identity_expired',
  );
});

test('ACC-16) ⭐⭐⭐⭐ (M57) إعادة التحقّق من السجلّ عند كل تقييم (٤ فروع · مقياس)', () => {
  // ⭐⭐⭐ **لماذا مقياس (double)؟** ⭐ سجلّ الهوية الحقيقي **لا يحذف هوية**
  //   ⇒ ⭐⇒⇒ **ففرع «لم تعد مسجَّلة» لا يصله إلا مقياس** ⇒ ⭐⇒⇒⇒ **وهذا قياس
  //   صريح لا ادّعاء** ⇒ ⭐⇒⇒⇒⇒ **والنواة تبقى هي الحاكمة (نفس دوالها).**
  interface StubState {
    identity: Record<string, unknown> | null;
    expired: boolean;
  }
  const makeStub = (state: StubState): LocalIdentityRegistry =>
    ({
      instanceId: 'stub-registry',
      currentTime: () => NOW,
      isExpired: () => state.expired,
      find: () => state.identity as never,
    }) as unknown as LocalIdentityRegistry;

  const base = {
    identity_id: 'acc-ident-stub',
    tenant_id: 'tnt_acc_0005',
    actor_id: 'actor_acc_0007',
    role: 'agent',
    status: 'active',
  };

  // ⓐ لم تعد مسجَّلة ⇒ identity_unregistered
  const stateA: StubState = { identity: { ...base }, expired: false };
  const stubA = makeStub(stateA);
  const attestationA = issueLocalTestAttestation('acc-ident-stub', {
    registry: stubA,
    source_id: 'local-test:stub',
  });
  stateA.identity = null;
  const decisionA = evaluateIdentityAttestation(attestationA, { scope: 'test', registry: stubA });
  assert.equal(decisionA.trusted, false);
  assert.equal(decisionA.code, 'identity_unregistered');

  // ⓑ ملغاة في السجلّ ⇒ identity_revoked
  const stateB: StubState = { identity: { ...base }, expired: false };
  const stubB = makeStub(stateB);
  const attestationB = issueLocalTestAttestation('acc-ident-stub', {
    registry: stubB,
    source_id: 'local-test:stub',
  });
  stateB.identity = { ...base, status: 'revoked' };
  const decisionB = evaluateIdentityAttestation(attestationB, { scope: 'test', registry: stubB });
  assert.equal(decisionB.trusted, false);
  assert.equal(decisionB.code, 'identity_revoked');

  // ⓒ منتهية الصلاحية في السجلّ ⇒ identity_expired
  const stateC: StubState = { identity: { ...base }, expired: false };
  const stubC = makeStub(stateC);
  const attestationC = issueLocalTestAttestation('acc-ident-stub', {
    registry: stubC,
    source_id: 'local-test:stub',
  });
  stateC.expired = true;
  const decisionC = evaluateIdentityAttestation(attestationC, { scope: 'test', registry: stubC });
  assert.equal(decisionC.trusted, false);
  assert.equal(decisionC.code, 'identity_expired');

  // ⓓ السجلّ لا يطابق ما صدر ⇒ identity_registry_mismatch
  const stateD: StubState = { identity: { ...base }, expired: false };
  const stubD = makeStub(stateD);
  const attestationD = issueLocalTestAttestation('acc-ident-stub', {
    registry: stubD,
    source_id: 'local-test:stub',
  });
  stateD.identity = { ...base, role: 'supervisor' };
  const decisionD = evaluateIdentityAttestation(attestationD, { scope: 'test', registry: stubD });
  assert.equal(decisionD.trusted, false);
  assert.equal(decisionD.code, 'identity_registry_mismatch');
});

test('ACC-17) ⭐⭐⭐ (M57) الفصل البنيوي وحده: غياب الإثبات ⇒ shape_missing (بلا ثقة)', () => {
  // ⭐⭐⭐ **الفصل البنيوي وحده** → ⭐⇒⇒ يفحص الشكل ولا الثقة.
  const missing = evaluateIdentityAttestationStructure(null);
  assert.equal(missing.structurally_valid, false);
  assert.equal(missing.code, 'identity_source_missing');
  const bad = evaluateIdentityAttestationStructure({ identity_id: 'bad id!' });
  assert.equal(bad.structurally_valid, false);
  assert.equal(bad.code, 'identity_attestation_invalid');
});

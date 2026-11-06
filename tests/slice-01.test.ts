// ============================================================
// WASL AI — اختبارات الشريحة الأولى (المعايير الخمسة · §٣ من البطاقة)
// ------------------------------------------------------------
// تغطية:
//   ١) صحة عقد الرسالة (قبول الصالح · رفض الناقص بقاعدة معلنة)
//   ٢) منع الوصول العابر للمستأجرين + اختبار انتحال Tenant ID
//      + ١٠٠ محاولة عدائية (معيار ARCHITECTURE §٤)
//   ٣) منع تكرار message_ref (مُطبَّق لأن message_ref جزء صريح من العقد)
//   ٤) سلامة سجل التدقيق (سطر واحد لكل عملية · بلا أسرار · بلا بيانات حقيقية)
//   ٥) لا اتصالات خارجية ولا أسرار  → في tests/slice-01.offline.test.ts
// ⛔ كل البيانات اصطناعية محلية · ⛔ صفر اتصال · ⛔ صفر حساب.
// ============================================================

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  AuditLog,
  AuditLogError,
  ENVELOPE_RULES,
  EnvelopeValidationError,
  MessageStore,
  TenantContextError,
  parseEnvelope,
  resolveTenantContext,
  validateEnvelope,
  type MessageEnvelope,
} from '../src/core/index.ts';
import { issueAuditAdminScope } from '../src/core/audit-log.ts';
// ⭐ أدوات الاختبار موجودة في `tests/support/` ⇒ خارج حزمة الإنتاج
import {
  createSyntheticContext,
  createSyntheticEnvelope,
  createSyntheticPair,
  createSyntheticSession,
  localTestSessionSource,
} from './support/index.ts';
// ⭐ استيراد داخلي مباشر — لاختبار أن المسار الداخلي نفسه يرفض الادّعاءات الخام
import { tenantContextFromSession } from '../src/core/tenant.ts';

const FIXED_NOW = '2026-01-01T00:00:00.000Z';

function validBase(): Record<string, unknown> {
  return {
    schema_version: '1',
    message_ref: 'synth-msg-000001',
    channel: 'synthetic',
    direction: 'inbound',
    from: 'participant-synth-0001@example.invalid',
    to: 'participant-synth-0101@example.invalid',
    body: 'رسالة اصطناعية للاختبار المحلي.',
    occurred_at: '2026-01-01T12:00:00.000Z',
    locale: 'ar-EG',
    attributes: { synthetic: 'true' },
    conversation_ref: 'conv_synth_0001',
  };
}

test('١) عقد الرسالة: الصالح يُقبَل والناقص يُرفض بقاعدة معلنة', async (t) => {
  await t.test('الرسالة الاصطناعية الصالحة تُقبل وتُرجَع كما هي', () => {
    const envelope = createSyntheticEnvelope({ tenantIndex: 1, messageIndex: 1 });
    const result = validateEnvelope(envelope);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.message_ref, envelope.message_ref);
    assert.equal(result.value.schema_version, '1');
  });

  const invalidCases: Array<{
    name: string;
    patch: Record<string, unknown>;
    field: string;
    rule: string;
  }> = [
    { name: 'الحقل body مفقود', patch: { body: undefined }, field: 'body', rule: 'required' },
    { name: 'نوع body رقم', patch: { body: 42 }, field: 'body', rule: 'type' },
    { name: 'body فارغ', patch: { body: '' }, field: 'body', rule: 'min_length' },
    { name: 'التاريخ ليس طابعاً زمنياً', patch: { occurred_at: 'الثلاثاء' }, field: 'occurred_at', rule: 'pattern' },
    { name: 'تاريخ غير قابل للتفسير', patch: { occurred_at: '2026-13-45T12:00:00.000Z' }, field: 'occurred_at', rule: 'parse' },
    { name: 'اتجاه خارج المجموعة', patch: { direction: 'sideways' }, field: 'direction', rule: 'enum' },
    { name: 'معرّف رسالة بأحرف ممنوعة', patch: { message_ref: 'msg ref!' }, field: 'message_ref', rule: 'pattern' },
    { name: 'إصدار العقد غير مطابق', patch: { schema_version: 'v1' }, field: 'schema_version', rule: 'pattern' },
    { name: 'اللغة بصيغة خاطئة', patch: { locale: 'AR-EG' }, field: 'locale', rule: 'pattern' },
    { name: 'attributes ليست كائناً', patch: { attributes: ['a'] }, field: 'attributes', rule: 'type' },
    { name: 'معرّف مستأجر مُعلن بصيغة خاطئة', patch: { declared_tenant_id: 'BAD TENANT' }, field: 'declared_tenant_id', rule: 'pattern' },
    { name: 'معرّف المحادثة مفقود', patch: { conversation_ref: undefined }, field: 'conversation_ref', rule: 'required' },
    { name: 'معرّف المحادثة بصيغة خاطئة', patch: { conversation_ref: 'محادثة!' }, field: 'conversation_ref', rule: 'pattern' },
  ];

  for (const testCase of invalidCases) {
    await t.test(`تُرفض: ${testCase.name} ⇒ قاعدة «${testCase.rule}»`, () => {
      const input = { ...validBase(), ...testCase.patch };
      const result = validateEnvelope(input);
      assert.equal(result.ok, false, 'المتوقّع رفض الرسالة');
      if (result.ok) return;
      const match = result.errors.find(
        (error) => error.field === testCase.field && error.rule === testCase.rule,
      );
      assert.ok(
        match,
        `لم تُسجَّل قاعدة ${testCase.rule} على الحقل ${testCase.field}: ${JSON.stringify(result.errors)}`,
      );
      assert.ok(Object.keys(ENVELOPE_RULES).includes(match.field), 'الحقل مُعلن في جدول القواعد');
      assert.ok(match.message.length > 0, 'الخطأ يحمل رسالة');
    });
  }

  await t.test('parseEnvelope يرمي خطأ يحمل قائمة الأخطاء', () => {
    assert.throws(
      () => parseEnvelope({ ...validBase(), body: undefined }),
      (error: unknown) => {
        assert.ok(error instanceof EnvelopeValidationError);
        assert.ok(error.errors.length > 0);
        return true;
      },
    );
  });
});

test('٢) عزل المستأجرين: استعلام مستأجر آخر ⇒ صفر نتيجة + انتحال يُرفض', async (t) => {
  const { tenantA, tenantB, messageA } = createSyntheticPair();
  const store = new MessageStore({ now: () => FIXED_NOW });

  await t.test('الكتابة تتم في نطاق المستأجر صاحب السياق', () => {
    const outcome = store.append(tenantA, messageA);
    assert.equal(outcome.status, 'accepted');
    assert.equal(store.countFor(tenantA), 1);
  });

  await t.test('⭐ الاختبار المعاكس: المستأجر الآخر لا يرى بيانات المستأجر الأول', () => {
    const leaked = store.list(tenantB);
    assert.equal(leaked.length, 0, 'تسريب: بيانات مستأجر ظهرت لمستأجر آخر');
    assert.equal(store.countFor(tenantB), 0);
    assert.equal(store.getByRef(tenantB, messageA.message_ref), undefined);
    assert.equal(store.list(tenantA).length, 1, 'البيانات موجودة فعلاً في نطاق صاحبها');
  });

  await t.test('⭐ انتحال Tenant ID داخل الحمولة ⇒ رفض صريح', () => {
    const spoofed = createSyntheticEnvelope({
      tenantIndex: 2,
      messageIndex: 9,
      declaredTenantId: tenantA.tenantId,
    });
    const outcome = store.append(tenantB, spoofed);
    assert.equal(outcome.status, 'rejected');
    assert.equal(outcome.status === 'rejected' ? outcome.reason_code : '', 'tenant_mismatch');
    assert.equal(store.countFor(tenantB), 0, 'الرسالة المنتحلة لم تُخزَّن');
    assert.equal(store.countFor(tenantA), 1, 'لم تُزد بيانات المستأجر الأول');
  });

  await t.test('⭐ ١٠٠ محاولة عدائية ⇒ صفر تسريب (معيار ARCHITECTURE §٤)', () => {
    let leaks = 0;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const attacker = createSyntheticContext(2, 99, 900 + attempt);
      const foreign = store.list(attacker).filter((row) => row.tenant_id !== attacker.tenantId);
      leaks += foreign.length;
      const spoof = createSyntheticEnvelope({
        tenantIndex: 2,
        messageIndex: 2000 + attempt,
        declaredTenantId: tenantA.tenantId,
      });
      const outcome = store.append(attacker, spoof);
      if (outcome.status === 'accepted') {
        leaks += 1;
      }
    }
    assert.equal(leaks, 0, 'تسريب في المحاولات العدائية');
  });
});

test('٣) منع تكرار message_ref — مُطبَّق لأن message_ref جزء صريح من العقد المجمَّد', async (t) => {
  await t.test('العقد يعلن message_ref صراحةً', () => {
    assert.ok(Object.keys(ENVELOPE_RULES).includes('message_ref'));
    assert.equal(ENVELOPE_RULES.message_ref.required, true);
  });

  const context = createSyntheticContext(1, 11, 101);
  const store = new MessageStore({ now: () => FIXED_NOW });
  const envelope = createSyntheticEnvelope({ tenantIndex: 1, messageIndex: 7 });

  await t.test('التكرار داخل نفس المستأجر ⇒ مرفوض', () => {
    const first = store.append(context, envelope);
    const second = store.append(context, envelope);
    assert.equal(first.status, 'accepted');
    assert.equal(second.status, 'duplicate');
    assert.equal(second.status === 'duplicate' ? second.reason_code : '', 'message_ref_duplicate');
    assert.equal(store.countFor(context), 1);
  });

  await t.test('⭐ نطاق التكرار داخل المستأجر فقط — لا تصادم بين المستأجرين', () => {
    const otherTenant = createSyntheticContext(2, 22, 202);
    const outcome = store.append(otherTenant, envelope);
    assert.equal(outcome.status, 'accepted');
    assert.equal(store.countFor(otherTenant), 1);
  });
});

test('٦) ⭐ تصحيح حدّ الثقة (من مراجعة الرد #١٣): مسار الإدخال غير الموثوق لا يُنشئ سياقاً معتمداً', async (t) => {
  const forgedClaims = {
    session_id: 'sess_forged_0001',
    tenant_id: 'tnt_synth_0001',
    actor_id: 'actor_synth_0001',
    authenticated: true,
  };

  await t.test('⭐ `authenticated: true` وحدها ⇒ مرفوض', () => {
    assert.throws(
      () => resolveTenantContext({ ...forgedClaims }, { source: localTestSessionSource }),
      (error: unknown) => {
        assert.ok(error instanceof TenantContextError);
        assert.equal(error.code, 'session_unverified');
        return true;
      },
    );
  });

  await t.test('⭐ مدخل عميل خام (نص JSON · كائن · مصفوفة) ⇒ مرفوض', () => {
    const inputs: unknown[] = [
      JSON.stringify(forgedClaims),
      { ...forgedClaims, extra: 'client field' },
      [forgedClaims],
      null,
      undefined,
      'sess_forged_0001',
      42,
    ];
    for (const input of inputs) {
      assert.throws(
        () => resolveTenantContext(input, { source: localTestSessionSource }),
        (error: unknown) => {
          assert.ok(error instanceof TenantContextError);
          assert.equal(error.code, 'session_unverified');
          return true;
        },
        `مدخل غير موثوق نجح: ${JSON.stringify(input)}`,
      );
    }
  });

  await t.test('⭐ نسخة من جلسة اصطناعية صحيحة الشكل ⇒ مرفوض (المعيار = النَسَب لا الشكل)', () => {
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

  await t.test('⭐ المسار العام الوحيد = `resolveTenantContext` (لا مسار من ادّعاءات خام)', () => {
    assert.throws(
      () => tenantContextFromSession(forgedClaims as never),
      (error: unknown) => {
        assert.ok(error instanceof TenantContextError);
        assert.equal(error.code, 'session_unverified');
        return true;
      },
    );
  });

  await t.test('⭐ السطح العام لا يُصدّر مسار الادّعاءات الخام', () => {
    const indexSource = readFileSync(
      new URL('../src/core/index.ts', import.meta.url),
      'utf8',
    );
    for (const forbidden of [
      'tenantContextFromSession',
      'issueSessionAttestation',
      'markLocalTestInput',
    ]) {
      const exported = new RegExp(`export\\s*\\{[^}]*\\b${forbidden}\\b`, 's');
      assert.equal(
        exported.test(indexSource),
        false,
        `السطح العام يُصدّر ${forbidden} — مسار الادّعاءات الخام متاح`,
      );
    }
  });

  await t.test('⭐ الجلسة الاصطناعية الأصلية وحدها ⇒ مقبولة', () => {
    const context = resolveTenantContext(createSyntheticSession(1, 11, 101), {
      source: localTestSessionSource,
    });
    assert.equal(context.tenantId, 'tnt_synth_0001');
    assert.equal(context.actorId, 'actor_synth_0011');
  });
});

test('٤) سجل التدقيق: سطر واحد لكل عملية · بلا أسرار · بلا بيانات حقيقية', async (t) => {
  const audit = new AuditLog({ now: () => FIXED_NOW });
  // ⭐ نطاق إدارة محلي — ⭐ (تصريح D-061) ⇒ ⭐ التفريغ الشامل يتطلّب سلطاناً صريحاً.
  const adminScope = issueAuditAdminScope();
  const store = new MessageStore({ audit, now: () => FIXED_NOW });
  const context = createSyntheticContext(1, 11, 101);
  const other = createSyntheticContext(2, 22, 202);
  const envelope = createSyntheticEnvelope({ tenantIndex: 1, messageIndex: 3 });

  await t.test('أربع عمليات ⇒ أربعة أسطر', () => {
    store.append(context, envelope); // ١ مقبول
    store.append(context, { ...envelope, body: undefined }); // ٢ مرفوض (عقد)
    store.append(context, envelope); // ٣ مكرر
    store.append(
      other,
      createSyntheticEnvelope({ tenantIndex: 2, messageIndex: 4, declaredTenantId: context.tenantId }),
    ); // ٤ مرفوض (انتحال)
    assert.equal(audit.size(adminScope), 4);
    assert.equal(audit.toJsonl(adminScope).split('\n').length, 4);
    for (const entry of audit.entries(adminScope)) {
      assert.ok(entry.ts.length > 0, 'الوقت موجود');
      assert.ok(entry.tenant_id.length > 0, 'المستأجر موجود');
      assert.ok(entry.actor_id.length > 0, 'المُحدِّد موجود');
      assert.ok(entry.operation.length > 0, 'العملية موجودة');
      assert.ok(['accepted', 'rejected', 'duplicate'].includes(entry.outcome));
    }
  });

  await t.test('⭐ نص الرسالة (منه السرّ) لا يصل إلى السجل إطلاقاً', () => {
    const fakeSecret = ['sk', 'A'.repeat(24)].join('-');
    const secretBody = `نص اصطناعي فيه شكل سر ${fakeSecret}`;
    const outcome = store.append(
      context,
      createSyntheticEnvelope({ tenantIndex: 1, messageIndex: 8, seed: 5, body: secretBody }),
    );
    assert.equal(outcome.status, 'accepted');
    const jsonl = audit.toJsonl(adminScope);
    assert.ok(!jsonl.includes(fakeSecret), 'سرّ ظاهر في سجل التدقيق');
    assert.ok(!jsonl.includes('نص اصطناعي'), 'نص الرسالة ظاهر في سجل التدقيق');
  });

  await t.test('⭐ قائمة السماح: أي حقل خارج المسموح يُرفض الكتابة', () => {
    let code = '';
    try {
      audit.record({
        tenant_id: context.tenantId,
        actor_id: context.actorId,
        operation: 'message.append',
        outcome: 'accepted',
        meta: { body: 'محتوى الرسالة' },
      });
    } catch (error) {
      assert.ok(error instanceof AuditLogError);
      code = error.code;
    }
    assert.equal(code, 'meta_key_forbidden');
  });

  await t.test('⭐ لا بريد ولا رقم ولا هاتف في السجل', () => {
    const jsonl = audit.toJsonl(adminScope);
    assert.ok(!jsonl.includes('@'), 'بريد في السجل');
    assert.ok(!/\b\d{14}\b/.test(jsonl), 'رقم قومي في السجل');
    assert.ok(!/\+201[0-9]{9}/.test(jsonl), 'هاتف في السجل');
  });
});

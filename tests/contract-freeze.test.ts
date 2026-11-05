// ============================================================
// WASL AI — تجميد عقد الرسالة للإصدار 1 (الاختبار الإلزامي ١)
// ------------------------------------------------------------
// ⭐ **(تصريح المالك · ٥ نوفمبر ٢٠٢٦ · D-053)**: خط أساس العقد = "1"
//   مع اختبار يمنع أي تعديل كاسر صامت.
// ⭐ الاختبار يجمّد: ⭐ أسماء الحقول ⭐ إلزاميتها ⭐ أنماطها ⭐ قيمة الإصدار
//   ⭐ وقائمة الإصدارات المدعومة ⭐ ونتائج المعالجة ⭐ وقيم سجل التدقيق.
// ⛔ كل الفحوص محلية · ⛔ صفر اتصال · ⛔ صفر حساب.
// ============================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { guard } from './guard-setup.ts';
import {
  ENVELOPE_RULES,
  ENVELOPE_SCHEMA_VERSION,
  ENVELOPE_SUPPORTED_SCHEMA_VERSIONS,
  PROCESSING_OUTCOME_RULES,
  validateEnvelope,
} from '../src/core/index.ts';
import { createSyntheticEnvelope } from './support/index.ts';

/** ⭐⭐ لقطة العقد المجمَّدة — ⭐ أي تغيير في الشكل يكسر هذا الاختبار. */
const FROZEN_FIELDS: readonly { readonly name: string; readonly required: boolean }[] = [
  { name: 'schema_version', required: true },
  { name: 'message_ref', required: true },
  { name: 'channel', required: true },
  { name: 'direction', required: true },
  { name: 'from', required: true },
  { name: 'to', required: true },
  { name: 'body', required: true },
  { name: 'occurred_at', required: true },
  { name: 'locale', required: true },
  { name: 'attributes', required: true },
  { name: 'conversation_ref', required: true },
  { name: 'declared_tenant_id', required: false },
];

test('١) تجميد عقد MessageEnvelope للإصدار 1 ورفض الإصدارات غير المدعومة', async (t) => {
  await t.test('⭐ رقم الإصدار المجمَّد = "1"', () => {
    assert.equal(ENVELOPE_SCHEMA_VERSION, '1');
  });

  await t.test('⭐ قائمة الإصدارات المدعومة = ["1"] فقط', () => {
    assert.deepEqual([...ENVELOPE_SUPPORTED_SCHEMA_VERSIONS], ['1']);
  });

  await t.test('⭐ شكل العقد = ١٢ حقلاً بالترتيب والإلزامية المجمَّدة', () => {
    const actual = Object.entries(ENVELOPE_RULES).map(([name, rule]) => ({
      name,
      required: rule.required,
    }));
    assert.deepEqual(actual, FROZEN_FIELDS);
    assert.equal(actual.length, 12);
  });

  await t.test('⭐ الحقول الإلزامية هي ١١ والحقل الاختياري واحد', () => {
    const required = FROZEN_FIELDS.filter((field) => field.required).length;
    const optional = FROZEN_FIELDS.filter((field) => !field.required).length;
    assert.equal(required, 11);
    assert.equal(optional, 1);
    assert.equal(optional, FROZEN_FIELDS.length - required);
  });

  await t.test('⭐ الرسالة الصالحة بالإصدار 1 تُقبل كما هي', () => {
    const envelope = createSyntheticEnvelope({ tenantIndex: 1, messageIndex: 1 });
    const result = validateEnvelope(envelope);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.schema_version, '1');
  });

  await t.test('⭐⭐ إصدار غير مدعوم ("2") ⇒ رفض صريح بقاعدة معلنة', () => {
    const envelope = { ...createSyntheticEnvelope({ tenantIndex: 1, messageIndex: 1 }), schema_version: '2' };
    const result = validateEnvelope(envelope);
    assert.equal(result.ok, false, 'المتوقّع رفض إصدار غير مدعوم');
    if (result.ok) return;
    const match = result.errors.find(
      (error) => error.field === 'schema_version' && error.rule === 'schema_version_unsupported',
    );
    assert.ok(
      match,
      `لم تُسجَّل قاعدة schema_version_unsupported: ${JSON.stringify(result.errors)}`,
    );
    assert.ok(match.message.length > 0, 'الخطأ يحمل رسالة');
    assert.ok(Object.keys(ENVELOPE_RULES).includes(match.field), 'الحقل مُعلن في جدول القواعد');
  });

  await t.test('⭐⭐ كل إصدار خارج القائمة المدعومة مرفوض (0 · 2 · ١٠ · v1)', () => {
    for (const version of ['0', '2', '10', 'v1']) {
      const envelope = {
        ...createSyntheticEnvelope({ tenantIndex: 1, messageIndex: 1 }),
        schema_version: version,
      };
      const result = validateEnvelope(envelope);
      assert.equal(result.ok, false, `المتوقّع رفض الإصدار ${version}`);
      if (result.ok) continue;
      const unsupported = result.errors.some(
        (error) => error.field === 'schema_version' && error.rule === 'schema_version_unsupported',
      );
      const pattern = result.errors.some(
        (error) => error.field === 'schema_version' && error.rule === 'pattern',
      );
      assert.ok(unsupported || pattern, `الإصدار ${version} مرّ بلا قاعدة معلنة`);
    }
  });

  await t.test('⭐ الإصدار الفارغ/المفقود مرفوض (لا تمرير صامت)', () => {
    const envelope = createSyntheticEnvelope({ tenantIndex: 1, messageIndex: 1 });
    const missing = validateEnvelope({ ...envelope, schema_version: undefined });
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.ok(
        missing.errors.some((error) => error.field === 'schema_version' && error.rule === 'required'),
        'المفقود ⇒ قاعدة required',
      );
    }
  });

  await t.test('⭐ نتيجة المعالجة: ٩ أسباب مغلقة بلا تغيّر صامت', () => {
    assert.equal(Object.keys(PROCESSING_OUTCOME_RULES).length, 6);
    const reasons = [...PROCESSING_OUTCOME_RULES.reason_code.oneOf];
    assert.equal(reasons.length, 9);
    assert.ok(reasons.includes('conversation_mismatch'));
    assert.ok(reasons.includes('deferred_out_of_order'));
    assert.equal(reasons.includes('accepted_no_ordering_scope'), false);
  });

  await t.test('⭐ صفر محاولة اتصال (الحاجز مُركَّب)', () => {
    assert.equal(guard.installed, true);
    assert.deepEqual(guard.blocked, []);
  });
});

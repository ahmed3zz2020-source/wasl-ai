// ============================================================
// WASL AI — اختبار «لا اتصالات خارجية ولا أسرار» (المعيار ٥ · §٣)
// ------------------------------------------------------------
// ⭐ أربعة أدلة مستقلة:
//   ١) حاجز زمني: أي نداء شبكة في الشريحة يرمي استثناءً (والشريحة لا يناديه)
//   ٢) فحص ساكن لمصدر الشريحة (src/) ⇒ صفر رمز شبكة
//   ٣) فحص أسرار + بيانات حقيقية على مصدر الشريحة ⇒ صفر
//   ٤) فحص وقت التشغيل للبيانات المولَّدة ⇒ لا بريد ولا هاتف ولا رقم قومي
// ⛔ الاختبار لا يتصل بأي شيء — هو نفسه محجوب.
// ============================================================

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { guard } from './guard-setup.ts';
import { NetworkAccessError } from './network-guard.ts';
import {
  MessageStore,
  SECRET_PATTERNS,
} from '../src/core/index.ts';
import { issueAuditAdminScope } from '../src/core/audit-log.ts';
// ⭐ أدوات الاختبار موجودة في `tests/support/` ⇒ خارج حزمة الإنتاج
import {
  createSyntheticContext,
  createSyntheticEnvelope,
} from './support/index.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const TESTS_DIR = path.join(ROOT, 'tests');

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

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
  'http.request',
  'https.request',
  'net.connect',
  'dns.lookup',
  'process.env',
];

const REAL_DATA_PATTERNS: readonly RegExp[] = [
  /\b\d{14}\b/,
  /\+201[0-9]{9}/,
];

/** ⭐ نطاق `.invalid` محجوز رسمياً (RFC 2606) ⇒ بريد غير قابل للوصول فعلياً. */
const RESERVED_EMAIL_SUFFIX = '@example.invalid';

const EMAIL_PATTERN = /[A-Za-z0-9._%-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function findRealEmails(text: string): string[] {
  return (text.match(EMAIL_PATTERN) ?? []).filter(
    (mail) => !mail.endsWith(RESERVED_EMAIL_SUFFIX),
  );
}

test('٥) لا اتصالات خارجية ولا أسرار ولا بيانات حقيقية', async (t) => {
  await t.test('⭐ صفر محاولة اتصال طوال تشغيل الاختبار', () => {
    assert.equal(guard.installed, true, 'الحاجز غير مُركَّب');
    assert.equal(guard.blocked.length, 0, `محاولات اتصال: ${guard.blocked.join(' , ')}`);
  });

  await t.test('⭐ الحاجز فعّال: نداء الشبكة يرمي استثناءً', () => {
    assert.throws(
      () => globalThis.fetch('https://example.invalid/ping'),
      NetworkAccessError,
    );
  });

  await t.test('⭐ فحص ساكن لمصدر الشريحة: صفر رمز شبكة', () => {
    const files = listFiles(SRC_DIR);
    assert.ok(files.length > 0, 'لا يوجد مصدر لفحصه');
    const hits: string[] = [];
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      for (const token of NETWORK_TOKENS) {
        if (text.includes(token)) hits.push(`${path.relative(ROOT, file)} ⇒ ${token}`);
      }
      if (/\bimport\s*\(/.test(text)) hits.push(`${path.relative(ROOT, file)} ⇒ import ديناميكي`);
    }
    assert.deepEqual(hits, [], `رموز شبكة في مصدر الشريحة: ${hits.join(' , ')}`);
  });

  await t.test('⭐ فحص ساكن: صفر سرّ في مصدر الشريحة', () => {
    const hits: string[] = [];
    for (const file of listFiles(SRC_DIR)) {
      const text = fs.readFileSync(file, 'utf8');
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.test(text)) hits.push(`${path.relative(ROOT, file)} ⇒ ${pattern.source}`);
      }
    }
    assert.deepEqual(hits, [], `أنماط أسرار في مصدر الشريحة: ${hits.join(' , ')}`);
  });

  await t.test('⭐ فحص ساكن: صفر بيانات حقيقية في مصدر الشريحة وفي الاختبارات', () => {
    const hits: string[] = [];
    for (const file of [...listFiles(SRC_DIR), ...listFiles(TESTS_DIR)]) {
      const text = fs.readFileSync(file, 'utf8');
      for (const pattern of REAL_DATA_PATTERNS) {
        if (pattern.test(text)) hits.push(`${path.relative(ROOT, file)} ⇒ ${pattern.source}`);
      }
      for (const mail of findRealEmails(text)) {
        hits.push(`${path.relative(ROOT, file)} ⇒ بريد ${mail}`);
      }
    }
    assert.deepEqual(hits, [], `بيانات حقيقية في الملفات: ${hits.join(' , ')}`);
  });

  await t.test('⭐ فحص وقت التشغيل: البيانات المولَّدة كلها اصطناعية', () => {
    const context = createSyntheticContext(1, 11, 101);
    const store = new MessageStore();
    const envelope = createSyntheticEnvelope({ tenantIndex: 1, messageIndex: 1 });
    store.append(context, envelope);
    const rows = store.list(context);
    assert.equal(rows.length, 1);
    for (const row of rows) {
      assert.ok(row.from.endsWith('@example.invalid'), 'عنوان غير اصطناعي');
      assert.ok(row.to.endsWith('@example.invalid'), 'عنوان غير اصطناعي');
      assert.ok(!/\b\d{14}\b/.test(row.body), 'رقم قومي في البيانات');
      assert.ok(!/\+201[0-9]{9}/.test(row.body), 'هاتف في البيانات');
      assert.ok(row.tenant_id.startsWith('tnt_synth_'), 'معرّف مستأجر غير اصطناعي');
    }
    const jsonl = store.audit().toJsonl(issueAuditAdminScope());
    assert.ok(!jsonl.includes('@'), 'بريد في سجل التدقيق');
    assert.ok(!/\b\d{14}\b/.test(jsonl), 'رقم قومي في سجل التدقيق');
  });
});

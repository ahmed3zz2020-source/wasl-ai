// ============================================================
// WASL AI — اختبارات الفصل الأمني (المرحلة الأولى · تصريح المالك ٥ نوفمبر ٢٠٢٦)
// ------------------------------------------------------------
// ⭐ المجموعة ٧ — تُنفّذ بنود §١١ من `docs/SLICE-01-REPORT.md`:
//   ١) السطح العام الإنتاجي لا يُصدّر أي أداة اختبار
//   ٢) لا ملف في شجرة الإنتاج يستورد من شجرة الاختبار
//   ٣) نطاق `.invalid` المحجوز غير موجود في شجرة الإنتاج
//   ٤) المسار العام لا يفترض مصدر جلسات (لا مصدر افتراضي)
//   ٥) المسار الإنتاجي يرفض مصدر الجلسات الاختباري بنيوياً
//   ٦) لا مصدر إنتاجي مسجَّل اليوم ⇒ لا مسار افتراضي
//   ٧) حزمة الإنتاج تستثني شجرة الاختبار (فحص `npm pack` حقيقي)
// ⛔ كل الفحوص محلية · ⛔ صفر اتصال · ⛔ صفر حساب.
// ============================================================

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  TenantContextError,
  activeSessionSources,
  resolveProductionTenantContext,
  resolveTenantContext,
} from '../src/core/index.ts';
import { createSyntheticSession, localTestSessionSource } from './support/index.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const PROD_SURFACE = path.join(SRC_DIR, 'core', 'index.ts');

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/** ⭐ أسماء أدوات الاختبار — ⛔ ممنوعة في السطح العام الإنتاجي. */
const FORBIDDEN_EXPORTS: readonly string[] = [
  'localTestSessionSource',
  'markLocalTestInput',
  'LOCAL_TEST_INPUTS',
  'createSyntheticContext',
  'createSyntheticEnvelope',
  'createSyntheticPair',
  'createSyntheticSession',
  'createSyntheticTenantId',
  'createSyntheticActorId',
  'createSyntheticAddress',
  'createSyntheticDisplayName',
  'createSeededRandom',
  'SYNTHETIC_EMAIL_DOMAIN',
  'toArabicDigits',
  'tenantContextFromSession',
  'issueSessionAttestation',
];

/** ⭐ رموز أدوات الاختبار — ⛔ ممنوعة في أي ملف داخل `src/`. */
const FORBIDDEN_IN_PRODUCTION: readonly string[] = [
  'tests/',
  'support/',
  'localTestSessionSource',
  'markLocalTestInput',
  'LOCAL_TEST_INPUTS',
  'createSynthetic',
  'SYNTHETIC_EMAIL_DOMAIN',
  'toArabicDigits',
  '.invalid',
];

/** ⭐ يزيل التعليقات — ⭐ فالحكم على الكود لا على الشرح. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('٧) ⭐ الفصل الأمني: أدوات الاختبار لا تدخل مسار الإنتاج', async (t) => {
  await t.test('⭐ ١) السطح العام الإنتاجي لا يُصدّر أي أداة اختبار', async () => {
    const source = fs.readFileSync(PROD_SURFACE, 'utf8');
    for (const forbidden of FORBIDDEN_EXPORTS) {
      const exported = new RegExp(`export\\s*\\{[^}]*\\b${forbidden}\\b`, 's');
      assert.equal(
        exported.test(source),
        false,
        `السطح العام يُصدّر ${forbidden} — أداة اختبار في واجهة الإنتاج`,
      );
    }
    // ⭐ فحص وقت التشغيل: التحقق من مفاتيح الوحدة الحقيقية
    const production = (await import('../src/core/index.ts')) as Record<string, unknown>;
    const present = FORBIDDEN_EXPORTS.filter((name) => name in production);
    assert.deepEqual(present, [], `مفاتيح أدوات اختبار في السطح العام: ${present.join(' , ')}`);
  });

  await t.test('⭐ ٢) لا ملف في شجرة الإنتاج يستورد من شجرة الاختبار', () => {
    const files = listFiles(SRC_DIR);
    assert.ok(files.length > 0, 'لا يوجد مصدر لفحصه');
    const hits: string[] = [];
    for (const file of files) {
      const text = stripComments(fs.readFileSync(file, 'utf8'));
      for (const token of FORBIDDEN_IN_PRODUCTION) {
        if (text.includes(token)) hits.push(`${path.relative(ROOT, file)} ⇒ ${token}`);
      }
    }
    assert.deepEqual(hits, [], `أدوات اختبار داخل شجرة الإنتاج: ${hits.join(' , ')}`);
  });

  await t.test('⭐ ٣) نطاق `.invalid` المحجوز غير موجود في شجرة الإنتاج', () => {
    const hits: string[] = [];
    for (const file of listFiles(SRC_DIR)) {
      const text = stripComments(fs.readFileSync(file, 'utf8'));
      if (text.includes('.invalid')) hits.push(path.relative(ROOT, file));
    }
    assert.deepEqual(hits, [], `بيانات اصطناعية داخل شجرة الإنتاج: ${hits.join(' , ')}`);
  });

  await t.test('⭐ ٤) المسار العام لا يفترض مصدر جلسات', () => {
    assert.throws(
      () => resolveTenantContext(createSyntheticSession(1, 11, 101)),
      (error: unknown) => {
        assert.ok(error instanceof TenantContextError);
        assert.equal(error.code, 'session_source_missing');
        return true;
      },
    );
  });

  await t.test('⭐ ٥) المسار الإنتاجي يرفض مصدر الجلسات الاختباري', () => {
    assert.equal(localTestSessionSource.scope, 'test');
    assert.throws(
      () => resolveProductionTenantContext(createSyntheticSession(1, 11, 101), localTestSessionSource),
      (error: unknown) => {
        assert.ok(error instanceof TenantContextError);
        assert.equal(error.code, 'session_source_not_production');
        return true;
      },
    );
  });

  await t.test('⭐ ٦) لا مصدر إنتاجي مسجَّل اليوم ⇒ لا مسار افتراضي', () => {
    assert.equal(activeSessionSources().length, 0);
    for (const source of activeSessionSources()) {
      assert.equal(source.scope, 'production');
    }
  });

  await t.test('⭐ ٧) حزمة الإنتاج تستثني شجرة الاختبار (فحص `npm pack` حقيقي)', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
    ) as { files?: string[] };
    assert.ok(Array.isArray(manifest.files), 'package.json بلا قائمة `files` ⇒ اختبارات داخل الحزمة');
    assert.ok(
      !manifest.files.some((entry) => entry.startsWith('tests')),
      `قائمة الإنتاج تحوي شجرة الاختبار: ${manifest.files.join(' , ')}`,
    );

    // ⭐ الدليل الحقيقي: محتوى الحزمة الفعلية كما يراها npm
    const raw = execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const packed = JSON.parse(raw) as Array<{ files: Array<{ path: string }> }>;
    const paths = packed[0].files.map((entry) => entry.path);

    const leaked = paths.filter(
      (entry) =>
        entry.startsWith('tests/') ||
        entry.includes('synthetic') ||
        entry.includes('local-session') ||
        entry.includes('support/'),
    );
    assert.deepEqual(leaked, [], `أدوات اختبار داخل حزمة الإنتاج: ${leaked.join(' , ')}`);

    const productionFiles = listFiles(path.join(SRC_DIR, 'core')).map((file) =>
      path.relative(ROOT, file).split(path.sep).join('/'),
    );
    const missing = productionFiles.filter((file) => !paths.includes(file));
    assert.deepEqual(missing, [], `ملفات إنتاج ناقصة من الحزمة: ${missing.join(' , ')}`);
  });
});

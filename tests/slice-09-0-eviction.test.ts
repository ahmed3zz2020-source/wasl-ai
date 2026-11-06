// ============================================================
// WASL AI — اختبارات الطرد E-1..E-7 (S09-0 · تصريح المالك D-064)
// ------------------------------------------------------------
// ⭐⭐⭐ **التصريح**: ⭐ المالك (٦ نوفمبر ٢٠٢٦ · D-064) — «S09-0 — Local
//   Identity Source Contract (Inactive)» + «تنفيذ اختبارات الطرد
//   الأمنية المحددة في التقرير السابق ضمن نطاق S09-0 فقط» (M53).
// ⭐⭐⭐ **الفرق الجوهري (M41)**: ⭐ حارس خطّ الأساس **يكشف التغيّر**
//   ⇒ ⭐ ولا يقول «الحماية تعمل» ⇒ ⭐⇒⇒ **وإثبات الحرس يحتاج كسراً
//   حقيقياً + **فشلاً سلوكياً** ⇒ ⭐⇒⇒⇒ **وهذا ما يثبته هذا الملف.**
// ⭐⭐ **آلية التنفيذ**: ⭐ **نسخة معزولة خارج المستودع** (`--no-hardlinks`)
//   ⇒ ⭐⇒⇒ **الكسر داخلها فقط** ⇒ ⭐⇒⇒⇒ **والريبو الأصلي لا يُمَسّ.**
// ⭐⭐ **لكل كسر فحصان**: ⭐ ① **ضابط** على الكود الحقيقي ⇒ لازم ينجح
//   ⇒ ② **الكسر** ⇒ لازم **يفشل الفحص المتوقَّع** ⇒ ⇒⇒ **فالحارس حسّاس.**
// ⛔ الكسر لا يخرج من النسخة المعزولة · ⛔ لا شبكة · ⛔ بلا بيانات حقيقية.
// ============================================================

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  breakCoreIn,
  cloneIsolated,
  commitIn,
} from './support/core-baseline.ts';
// ⭐⭐⭐ **M56** — ⭐ دفتر المحاووتات → ⭐⇒⇒ **نتيجة المحاولة الأولى محفوظة**
//   → ⭐⇒⇒⇒ **ولا إعادة محاولة إلا لفشل بنية تحتية** → ⭐⇒⇒⇒⇒ **وإعلان صريح**.
import {
  failedTestNames,
  runWithLedger,
  type AttemptLedger,
} from './support/attempt-log.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const WORKSPACE = path.resolve(ROOT, '..');
/** ⭐ مجلد النسخة المعزولة — ⭐ **خارج المستودع** وداخل مساحة العمل. */
const ISOLATED = path.join(WORKSPACE, '.wasl-eviction-s09-0');

/** ⭐⭐⭐ تشغيل ملف اختبار داخل مجلد معيّن ⇒ ⭐ (النسخة المعزولة أو الريبو). */
function runTests(cwd: string, file: string): { code: number; output: string } {
  // ⭐ `NODE_TEST_CONTEXT` لازم يُشال من بيئة الابن ⇒ ⭐ وإلا ورث الابن وضع «مشغّل اختبار»
  //   ⇒ فنادى `run()` ذاتياً ⇒ ⭐ ولم يشغّل أي ملف ⇒ ⭐ وخرج بلا مخرجات وبرمز صفر
  //   ⇒ ⭐ وكأن الكسر لم يحدث ⇒ ⭐ وسببه خطأ في الأداة لا الكسر.
  const env = { ...process.env } as Record<string, string | undefined>;
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  const result = spawnSync(
    'node',
    ['--experimental-strip-types', '--test', file],
    { cwd, encoding: 'utf8', timeout: 300000, env },
  );
  return {
    code: result.status ?? -1,
    output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
  };
}

/**
 * ⭐⭐⭐ أسماء الفحوص **الفاشلة** من ناتج TAP.
 * ⭐⭐⭐⭐⭐ **المسافات البادئة تُشال** ⇒ ⭐ وإلا ضاعت الفحوص **المتداخلة**
 *   (nested) ⇒ ⭐⇒⇒ وتPAD يُظهر الفشل الداخلي تحت الـparent ⇒ ⭐⇒⇒⇒
 *   **ولم نكن نرى إلا الـparent** ⇒ ⭐⇒⇒⇒⇒ ⇒⇒ ⇒⇒ ⇒⇒ ⇒⇒ ⇒⇒ ⇒⇒ ⇒⇒ ⇒⇒ ⇒⇒ ⇒⇒ ⇒⇒
 *   ⇒ ⭐ ولهذا تُلتقط أسماء الفحوص المتداخلة كلها ⛔ لا الـparent وحده.
 */

/** ⭐⭐⭐ بصمة ملفات النواة ⇒ ⭐ إثبات أن الكسر **لم يخرج** من النسخة. */
function coreFingerprint(repoRoot: string): string {
  const hash = crypto.createHash('sha256');
  for (const file of fs.readdirSync(path.join(repoRoot, 'src', 'core')).sort()) {
    hash.update(file);
    hash.update(fs.readFileSync(path.join(repoRoot, 'src', 'core', file)));
  }
  return hash.digest('hex');
}

interface EvictionBreak {
  /** ⭐ ملف النواة الذي يُكسَر. */
  readonly file: string;
  /** ⭐ النقطة التي تُكسَر — لازم **فريدة** (وإلا يفشل الاختبار بصوت). */
  readonly anchor: string;
  /** ⭐ البديل الكاسر. */
  readonly replacement: string;
}

interface EvictionCase {
  readonly id: string;
  readonly label: string;
  /** ⭐⭐ الكسور (واحد أو أكثر — ⭐ بعض الحمايات طبقتان ⇒ كسرهما معاً). */
  readonly breaks: readonly EvictionBreak[];
  /** ⭐ ملف الاختبار الذي يجب أن يفشل بعد الكسر. */
  readonly testFile: string;
  /** ⭐ أسماء الفحوص المتوقَّع أن تفشل (جزء منها يكفي للتحقّق). */
  readonly expected: readonly string[];
}

/**
 * ⭐⭐⭐ **ضابط الضابط** — ⭐ يُنفذ الضابط لملف واحد ولا يُعاد للحمل متزايًا خارجيًا.
 */
const CONTROL_CACHE = new Map<string, AttemptLedger>();

function controlLedger(testFile: string): AttemptLedger {
  const cached = CONTROL_CACHE.get(testFile);
  if (cached) return cached;
  const ledger = runWithLedger(() => runTests(ROOT, testFile), { max_attempts: 3 });
  CONTROL_CACHE.set(testFile, ledger);
  return ledger;
}

async function runEviction(t: any, spec: EvictionCase): Promise<void> {
  const before = coreFingerprint(ROOT);

  await t.test(`⭐ الضابط: الكود الحقيقي ⇒ الفحص ينجح (${spec.id})`, () => {
    // ⭐⭐ **إعادة محاولة للضابط (محاولتان)**: ⭐ الضابط يفشل تحت الحمل
    //   المتوازي أحياناً ⛔ بلا عيب حقيقي في الكود ⇒ ⭐⇒⇒ **ومحاولة ثانية
    //   على نفس الكود تفصل «الحمل» عن «العيب»** ⇒ ⭐⇒⇒⇒ **وإن فشل
    //   المحاولتان ⇒ الخطأ يُعرض بصوت (لا إخفاء) ⇒ ⛔ والاختبار يظل صادماً.**
    const control = controlLedger(spec.testFile);
    for (const note of control.notes) process.stdout.write(note + '\n');
    assert.equal(
      control.final.code,
      0,
      `الضابط فشل على الكود الحقيقي ⇒ اختبار الطرد غير صالح:\n`
      + `المحاولة الأولى: رمز ${String(control.first.code)} · فحوص فاشلة: ${control.first.failed_names.join(' | ') || '(لم تستخرج)'} (M56: لا إعادة محاوكة لفشل فحوص)`
      + `${control.first.output.slice(-1500)}`,
    );
  });

  await t.test(`⭐ الكسر ${spec.id} — ${spec.label} ⇒ الفحص يكشفه سلوكياً`, () => {
    cloneIsolated(ROOT, ISOLATED);
    try {
      for (const item of spec.breaks) {
        breakCoreIn(ISOLATED, item.file, item.anchor, item.replacement);
      }
      commitIn(ISOLATED, `eviction probe ${spec.id} — ${spec.label}`);
      const broken = runWithLedger(() => runTests(ISOLATED, spec.testFile), { max_attempts: 3 });
      for (const note of broken.notes) process.stdout.write(note + '\n');
      assert.notEqual(
        broken.final.code,
        0,
        `الكسر ${spec.id} (${spec.label}) لم يُنتج فشلاً ⇒ الحارس أعمى (اختبار زائف)`,
      );
      // ⭐⭐⭐ **M56**: ⭐ الكسر يفتر فشل فحوص حقيقي ⇒ ⭐⇒⇒ لا يُ فشل بنية تحتية.
      assert.ok(
        broken.final.failed_names.length > 0,
        `الكسر ${spec.id} أسقط البنية التحتية وليس فشل فحوص حقيقياً`,
      );
      const failed = broken.final.failed_names;
      const detected = spec.expected.filter((name) =>
        failed.some((entry) => entry.includes(name)),
      );
      assert.ok(
        detected.length > 0,
        `الفشل حدث لكن بدون الفحص المتوقَّع.\n` +
          `المتوقَّع: ${spec.expected.join(' | ')}\n` +
          `الفاشل فعلياً: ${failed.join(' | ') || '(لا شيء)'}`,
      );
    } finally {
      fs.rmSync(ISOLATED, { recursive: true, force: true });
    }
  });

  await t.test(`⭐ نواة الريبو الأصلي لم تُمَسّ (${spec.id})`, () => {
    assert.equal(coreFingerprint(ROOT), before, 'الكسر سرّب إلى الريبو الأصلي');
  });
}

// ============================================================
// ⭐ ٧ كسور مقصودة — ⭐ كل واحد = حارس يُفترض أن يكتشفه
// ⭐⭐ **ملاحظة مقيسة**: ⭐ بعض الحمايات **طبقتان** ⇒ ⭐ الكسر يفصلها معاً
//   (E-1) ⇒ ⭐⇒⇒ **وإلّا فشلت طبقةٌ فلم يلتقطها إلا الفحص الأقوى**.
// ============================================================

test('S09-E) ⭐⭐⭐⭐⭐ اختبارات الطرد E-1..E-7 — كل كسر يكشفه فحص سلوكي', async (t) => {
  // ⭐⭐ **E-1 — «الدور من العميل»**: ⭐ اختيار المصدر صار من حمولة العميل
  //   + ⭐ وسقط فحص مطابقة الدور ⇒ ⭐⇒⇒ تصعيد دور حقيقي.
  await runEviction(t, {
    id: 'E-1',
    label: 'الدور من العميل بدل السجلّ',
    breaks: [
      {
        file: 'src/core/authorization.ts',
        anchor: '  const source = deps.sources.byRole[identity.role];',
        replacement:
          '  const claimedRole = (request.extra ?? {}).role;\n' +
          '  const source = deps.sources.byRole[\n' +
          "    typeof claimedRole === 'string' ? claimedRole : identity.role\n" +
          '  ];',
      },
      {
        file: 'src/core/authorization.ts',
        anchor: '      if (identity.role !== role) return null;',
        replacement: '      // ⭐ كسر متعمّد (اختبار الطرد فقط): فحص «مطابقة الدور» محذوف.',
      },
    ],
    testFile: 'tests/slice-08.test.ts',
    expected: ['S08-06', 'S08-07', 'S08-14'],
  });

  // ⭐⭐ **E-2 — «الهوية غير مسجَّلة تُرفض»**: ⭐ هوية مجهولة صارت مالكاً.
  await runEviction(t, {
    id: 'E-2',
    label: 'هوية غير مسجَّلة تُقبل كمالك',
    breaks: [
      {
        file: 'src/core/authorization.ts',
        anchor:
          "  const identity = deps.registry.find(request.identity_id);\n" +
          "  if (!identity) {\n" +
          "    return deny('identity_unknown', 'الهوية غير مسجَّلة');\n" +
          '  }',
        replacement:
          '  const identity =\n' +
          '    deps.registry.find(request.identity_id) ??\n' +
          '    ({\n' +
          '      identity_id: request.identity_id,\n' +
          "      tenant_id: 'tenant-evicted',\n" +
          "      actor_id: 'actor-evicted',\n" +
          "      role: 'owner',\n" +
          "      status: 'active',\n" +
          '      expires_at: null,\n' +
          '    } as never);',
      },
    ],
    testFile: 'tests/slice-08.test.ts',
    expected: ['S08-02'],
  });

  // ⭐⭐ **E-3 — «الدور بلا مصدر مسجَّل»**: ⭐ حُذف فحص غياب المصدر.
  await runEviction(t, {
    id: 'E-3',
    label: 'قبول دور بلا مصدر مسجَّل',
    breaks: [
      {
        file: 'src/core/authorization.ts',
        anchor:
          '  const source = deps.sources.byRole[identity.role];\n' +
          '  if (!source) {\n' +
          "    return deny('identity_role_unsupported', 'لا مصدر مسجَّل لهذا الدور');\n" +
          '  }',
        replacement: '  const source = deps.sources.byRole[identity.role];',
      },
    ],
    testFile: 'tests/slice-09-0.test.ts',
    expected: ['G-04'],
  });

  // ⭐⭐ **E-4 — «سقف الصلاحيات»**: ⭐ نقص الصلاحية صار نجاحاً.
  await runEviction(t, {
    id: 'E-4',
    label: 'نقص الصلاحية يُسمح',
    breaks: [
      {
        file: 'src/core/authorization.ts',
        anchor:
          '    return deny(\'capability_missing\', `الصلاحية غير متاحة للدور: ${capability}`);',
        replacement:
          '    return { allowed: true, context, capability, role: context.role, tenant_id: context.tenantId };',
      },
    ],
    testFile: 'tests/slice-08.test.ts',
    expected: ['S08-01', 'S08-07', 'S08-14'],
  });

  // ⭐⭐ **E-5 — «مطابقة المستأجر»**: ⭐ حُذفت مقارنة المستأجر المعلن.
  await runEviction(t, {
    id: 'E-5',
    label: 'تبديل المستأجر بلا فحص',
    breaks: [
      {
        file: 'src/core/authorization.ts',
        anchor:
          '  if (\n' +
          '    request.declared_tenant_id !== undefined &&\n' +
          '    request.declared_tenant_id !== identity.tenant_id\n' +
          '  ) {\n' +
          "    return deny('tenant_mismatch', 'المستأجر المعلن لا يطابق مستأجر الهوية');\n" +
          '  }',
        replacement: '  // ⭐ كسر متعمّد (اختبار الطرد فقط): مطابقة المستأجر محذوفة.',
      },
    ],
    testFile: 'tests/slice-08.test.ts',
    expected: ['S08-08', 'S08-09'],
  });

  // ⭐⭐ **E-6 — «السلطة الإدارية = مالك مسجَّل»**: ⭐ حُذف فحص المالك.
  await runEviction(t, {
    id: 'E-6',
    label: 'سلطة إدارة من غير مالك',
    breaks: [
      {
        file: 'src/core/identity.ts',
        anchor:
          "    if (owner.role !== 'owner') {\n" +
          "      throw new LocalIdentityError('admin_not_owner', 'هوية صاحب السلطة ليست بدور مالك');\n" +
          '    }',
        replacement: '    // ⭐ كسر متعمّد (اختبار الطرد فقط): فحص «المالك» محذوف.',
      },
    ],
    testFile: 'tests/slice-09-0.test.ts',
    expected: ['G-05'],
  });

  // ⭐⭐ **E-7 — «مصدر الاختبار مرفوض إنتاجياً»**: ⭐ حُذف شرط النطاق.
  await runEviction(t, {
    id: 'E-7',
    label: 'مصدر اختبار في المسار الإنتاجي',
    breaks: [
      {
        file: 'src/core/session.ts',
        anchor:
          "  if (!source || source.scope !== 'production') {\n" +
          '    throw new TenantContextError(\n' +
          "      'session_source_not_production',\n" +
          '      `مصدر الجلسات «${source?.id ?? \'غير محدَّد\'}» ليس إنتاجياً ⇒ لا يُبنى سياق إنتاجي منه`,\n' +
          '    );\n' +
          '  }',
        replacement: '  // ⭐ كسر متعمّد (اختبار الطرد فقط): فحص النطاق الإنتاجي محذوف.',
      },
    ],
    testFile: 'tests/slice-01.separation.test.ts',
    expected: ['المسار الإنتاجي يرفض مصدر الجلسات الاختباري'],
  });
});

test('S09-E) ⭐⭐⭐⭐⭐ النسخة المعزولة تُحذف (لا أثر خارج المستودع)', () => {
  assert.equal(fs.existsSync(ISOLATED), false, 'بقيت نسخة معزولة على القرص');
});

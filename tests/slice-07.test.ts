// ============================================================
// WASL AI — اختبارات Slice 07 (P0): المعاينة التفاعلية المحلية
// ------------------------------------------------------------
// ⭐ تغطي: ⭐ **بنية الملف** · ⭐ **ثبوت المعاينة** · ⭐ **منطق النواة**
//   (لا نسخة موازية) · ⭐ **حدود التشغيل** · ⭐ **فصل أدوات الاختبار**.
// ⭐ ⛔ الاختبارات **لا تفتح متصفّحاً** ⇒ ⭐ ⇒⇒ يعمل `npm test` بلا متصفّح.
//   (اختبار المتصفّح الحقيقي: `npm run test:browser:interactive`)
// ⭐ ⛔ لا اتصال · ⛔ لا نشر · ⛔ لا بيانات حقيقية.
// ============================================================

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { SECRET_PATTERNS } from '../src/core/audit-log.ts';
import { bundleModules } from '../tools/wasl-workbench-bundle.ts';
import { createPreviewRuntime } from '../tools/wasl-workbench-preview-runtime.ts';
import { CORE_BASELINE_COMMIT, changedCoreFiles } from './support/core-baseline.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PREVIEW = path.join(ROOT, 'docs', 'wasl-workbench-interactive.html');

const readPreview = (): string => fs.readFileSync(PREVIEW, 'utf8');

/** ⭐ ⭐ يحذف تعليقات JavaScript — ⭐ ليعمل الفحص على الكود لا على الكلام. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// ============================================================
// ⭐ ١ — بنية الملف الواحد
// ============================================================

test('⭐⭐ Slice 07 — الملف الواحد مستقلّ تماماً', async (t) => {
  await t.test('⭐ الملف موجود', () => {
    assert.ok(fs.existsSync(PREVIEW), 'ملف المعاينة التفاعلية غير موجود');
  });

  await t.test('⭐ صفحة HTML واحدة بـ RTL', () => {
    const html = readPreview();
    assert.ok(html.includes('<html lang="ar" dir="rtl">'), 'الصفحة ليست RTL');
    assert.ok(html.includes('charset="utf-8"'), 'الترميز غير معلن');
  });

  await t.test('⭐ CSP محجوبة افتراضياً (default-src none)', () => {
    const html = readPreview();
    assert.ok(
      html.includes("default-src 'none'"),
      'CSP لا تحجب كلthing افتراضياً',
    );
    assert.ok(html.includes("script-src 'unsafe-inline'"), 'السكربت المضمّن غير مسموح');
    assert.ok(html.includes("style-src 'unsafe-inline'"), 'الأنماط المضمّنة غير مسموحة');
  });

  await t.test('⭐ بلا موارد خارجية (CDN · خطوط · سكربتات خارجية)', () => {
    const html = readPreview();
    assert.equal(/<script[^>]+src=/i.test(html), false, 'وسم script خارجي موجود');
    assert.equal(/<link[^>]+href=/i.test(html), false, 'وسم link خارجي موجود');
    assert.equal(/@import\s+url/i.test(html), false, 'استيراد CSS خارجي موجود');
    assert.equal(/https?:\/\//i.test(html), false, 'عنوان خارجي موجود');
  });

  await t.test('⭐ بلا طلب شبكة ولا تخزين دائم (على الكود لا التعليق)', () => {
    const code = stripComments(readPreview());
    for (const forbidden of ['fetch(', 'XMLHttpRequest', 'localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'navigator.sendBeacon', 'WebSocket', 'EventSource']) {
      assert.equal(code.includes(forbidden), false, `وجد ${forbidden} في المعاينة`);
    }
  });

  await t.test('⭐ ⭐ بلا أسرار — الفحص بماسح النواة نفسه', () => {
    // ⭐ ⭐ يُزال نصّ أنماط الماسح أولاً ⇒ ⭐ ⇒⇒ لا مطابقة ذاتية.
    let haystack = readPreview();
    for (const pattern of SECRET_PATTERNS) {
      haystack = haystack.split(pattern.source).join('');
    }
    for (const pattern of SECRET_PATTERNS) {
      assert.equal(pattern.test(haystack), false, `تطابق سرّي: ${pattern.source}`);
    }
  });

  await t.test('⭐ ⭐ بلا نصوص رسائل — أسماء فقط', () => {
    const html = readPreview();
    assert.equal(html.includes('رسالة اصطناعية'), false, 'نص رسالة داخل المعاينة');
    assert.equal(html.includes('preview-body'), true, 'مُعلَّم الرسالة مفقود');
    assert.ok(html.includes('example.invalid'), 'النطاق المحجوز للمشاركين مفقود');
    // ⭐ ⭐ لا بريد حقيقي ⇒ ⭐ ولا نطاق غير محجوز.
    const emails = html.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
    for (const email of emails) {
      assert.ok(email.endsWith('@example.invalid'), `بريد غير محجوز: ${email}`);
    }
  });
});

/** ⭐ ⭐ يزيل السلاسل النصية — ⭐ ليعمل الفحص على البنية لا على الأمثلة. */
function stripPreviewStrings(html: string): string {
  return html.replace(/'[^'\\]*(\\.[^'\\]*)*'/g, "''").replace(/"[^"\\]*(\\.[^"\\]*)*"/g, '""');
}

// ============================================================
// ⭐ ٢ — المعاينة تستخدم منطق النواة (لا نسخة موازية)
// ============================================================

test('⭐⭐ Slice 07 — المعاينة تُعيد استخدام منطق النواة', async (t) => {
  await t.test('⭐ الملف يحوي نواة النواة مُجمَّعة (ALLOWED_TRANSITIONS)', () => {
    const html = readPreview();
    assert.ok(html.includes('ALLOWED_TRANSITIONS'), 'خريطة الانتقالات غير مُضمَّنة');
    assert.ok(html.includes('CONVERSATION_CHANGE_STATES'), 'مجموعة الحالات غير مُضمَّنة');
    assert.ok(html.includes('ROLE_CAPABILITIES'), 'قدرات الأدوار غير مُضمَّنة');
    assert.ok(html.includes('state_terminal'), 'حراسة النهائية غير مُضمَّنة');
  });

  await t.test('⭐ ⭐ لا قائمة انتقالات موازية في المعاينة', () => {
    // ⭐ أي خريطة انتقالات مكتوبة يدوياً ⇒ ⭐ تُقارن مع خريطة النواة.
    const core = fs.readFileSync(path.join(ROOT, 'src', 'core', 'conversation-state.ts'), 'utf8');
    const coreMatch = /export const ALLOWED_TRANSITIONS[\s\S]*?=\s*Object\.freeze\(\{([\s\S]*?)\n\}\);/.exec(core);
    assert.ok(coreMatch, 'لم يُعثر على خريطة الانتقالات في النواة');
    const coreMap = coreMatch[1];
    const html = readPreview();
    // ⭐ كل قيمة انتقال في النواة يجب أن ترد في المعاينة.
    const pairs = coreMap.matchAll(/'?([a-z]+)'?:\s*Object\.freeze\(\[([^\]]*)\]\)/g);
    let checked = 0;
    for (const pair of pairs) {
      for (const target of pair[2].matchAll(/'([a-z]+)'/g)) {
        assert.ok(
          html.includes(`'${pair[1]}'`) && html.includes(`'${target[1]}'`),
          `انتقال ${pair[1]} ⇒ ${target[1]} غير موجود في المعاينة`,
        );
        checked += 1;
      }
    }
    assert.ok(checked >= 10, `عدد الانتقالات المفحوصة قليل (${String(checked)})`);
  });

  await t.test('⭐ ⭐ الواجهة لا تحسم القرار (القرار من النواة)', () => {
    const html = stripComments(readPreview());
    // ⭐ ⭐ **تطابق واحد فقط** = خريطة النواة نفسها ⇒ ⭐ لا خريطة موازية.
    const transitionMaps = html.match(/ALLOWED_TRANSITIONS\s*=/g) ?? [];
    assert.equal(
      transitionMaps.length,
      1,
      `عدد خرائط الانتقالات = ${String(transitionMaps.length)} (المتوقَّع ١)`,
    );
    const capabilityMaps = html.match(/ROLE_CAPABILITIES\s*=/g) ?? [];
    assert.equal(
      capabilityMaps.length,
      1,
      `عدد خرائط القدرات = ${String(capabilityMaps.length)} (المتوقَّع ١)`,
    );
    // ⭐ ⭐ ولا خريطة أسماؤها محليّة (اسم مستقلّ عن النواة).
    assert.equal(
      /const\s+(?:PREVIEW_|LOCAL_|MY_)[A-Z_]*TRANSITIONS/.test(html),
      false,
      'خريطة انتقالات محلية',
    );
  });

  await t.test('⭐ ⭐ المُجمِّع يغلّف كل وحدة ⇒ فلا تصادم أسماء', () => {
    const bundle = bundleModules(['tools/wasl-workbench-preview-entry.ts']);
    assert.ok(bundle.files.length >= 16, 'عدد الوحدات المُجمَّعة قليل');
    assert.ok(bundle.files.includes('src/core/conversation-state.ts'), 'وحدة الحالة غير مُجمَّعة');
    assert.ok(bundle.files.includes('src/core/capability.ts'), 'وحدة القدرات غير مُجمَّعة');
    // ⭐ كل وحدة = إغلاق مستقل.
    const closures = bundle.code.match(/const __m_[a-z_]+ = \(\(\) => \{/g) ?? [];
    assert.equal(closures.length, bundle.files.length, 'عدد الإغلاقات لا يطابق عدد الوحدات');
    // ⭐ بلا استيراد متبقٍّ (الوحدات مغلَّفة ⇒ لا `import` ولا `export`).
    const code = stripComments(bundle.code);
    assert.equal(/^\s*import\s/m.test(code), false, 'بقي استيراد في الحزمة');
    assert.equal(/^\s*export\s/m.test(code), false, 'بقي تصدير في الحزمة');
  });
});

// ============================================================
// ⭐ ٣ — سلوك النواة عبر مُشغِّل المعاينة (بلا متصفّح)
// ============================================================

test('⭐⭐ Slice 07 — سلوك المحرّك يطابق قواعد النواة', async (t) => {
  await t.test('⭐ الدور الافتراضي = مشرف تجريبي', () => {
    const runtime = createPreviewRuntime();
    assert.equal(runtime.getRole(), 'supervisor');
    assert.equal(runtime.default_role, 'supervisor');
    assert.deepEqual([...runtime.roles], ['supervisor', 'agent', 'owner', 'viewer']);
  });

  await t.test('⭐ ⭐ المشرف يملك تعديل الحالة ولا يملك الإسناد', () => {
    const runtime = createPreviewRuntime();
    const caps = runtime.getCapabilities();
    assert.ok(caps.includes('conversation.state.update'), 'المشرف بلا صلاحية التعديل');
    assert.equal(caps.includes('conversation.assign'), false, 'المالك يملك الإسناد (خلاف للنواة)');
  });

  await t.test('⭐ ⭐ المالك يملك الإسناد والموظف والقراءة لا يملكان التعديل', () => {
    const runtime = createPreviewRuntime();
    runtime.setRole('owner');
    assert.ok(runtime.getCapabilities().includes('conversation.assign'), 'المالك بلا إسناد');
    runtime.setRole('agent');
    assert.equal(runtime.getCapabilities().includes('conversation.state.update'), false, 'الموظف يملك التعديل');
    runtime.setRole('viewer');
    assert.equal(runtime.getCapabilities().includes('conversation.state.update'), false, 'القراءة تملك التعديل');
  });

  await t.test('⭐ ⭐ الانتقالات المسموحة = خريطة النواة نفسها', () => {
    const runtime = createPreviewRuntime();
    const detail = runtime.getDetail('conv_preview_0003');
    assert.ok(detail, 'تفاصيل المحادثة مفقودة');
    // ⭐ `open` ⇒ ['assigned','pending','resolved'] — من خريطة النواة.
    assert.deepEqual([...detail.allowed_next].sort(), ['assigned', 'pending', 'resolved']);
  });

  await t.test('⭐ انتقال مسموح ينجح', () => {
    const runtime = createPreviewRuntime();
    const result = runtime.applyTransition('conv_preview_0003', 'pending', 'اختبار');
    assert.equal(result.ok, true, `فشل: ${result.code} ${result.message}`);
    assert.equal(runtime.getDetail('conv_preview_0003')?.state, 'pending');
  });

  await t.test('⭐ انتقال غير مسموح يُرفض بلا أثر', () => {
    const runtime = createPreviewRuntime();
    const before = runtime.getDetail('conv_preview_0003')?.state;
    const result = runtime.applyTransition('conv_preview_0003', 'closed', 'اختبار');
    assert.equal(result.ok, false);
    assert.equal(result.code, 'transition_not_allowed');
    assert.equal(runtime.getDetail('conv_preview_0003')?.state, before, 'تغيّرت الحالة رغم الرفض');
  });

  await t.test('⭐ الإغلاق من resolved فقط', () => {
    const runtime = createPreviewRuntime();
    const result = runtime.applyTransition('conv_preview_0004', 'closed', 'اختبار');
    assert.equal(result.ok, true, `فشل: ${result.code}`);
    assert.equal(runtime.getDetail('conv_preview_0004')?.state, 'closed');
  });

  await t.test('⭐ ⭐ closed نهائية — لا تعديل ولا إسناد', () => {
    const runtime = createPreviewRuntime();
    const transition = runtime.applyTransition('conv_preview_0005', 'open', 'اختبار');
    assert.equal(transition.ok, false);
    assert.equal(transition.code, 'state_terminal');
    // ⭐ ⭐ الإسناد بدور المالك ⇒ ⭐ وإلا سبق فحصَه فحصُ القدرة.
    runtime.setRole('owner');
    const assign = runtime.assign('conv_preview_0005', 'actor_preview_0007', 'اختبار');
    assert.equal(assign.ok, false);
    assert.equal(assign.code, 'state_terminal');
  });

  await t.test('⭐ إسناد مسموح ينجح (مالك)', () => {
    const runtime = createPreviewRuntime();
    runtime.setRole('owner');
    const result = runtime.assign('conv_preview_0003', 'actor_preview_0008', 'اختبار');
    assert.equal(result.ok, true, `فشل: ${result.code} ${result.message}`);
    assert.equal(runtime.getDetail('conv_preview_0003')?.assignee_actor_id, 'actor_preview_0008');
  });

  await t.test('⭐ إلغاء الإسناد ينجح', () => {
    const runtime = createPreviewRuntime();
    runtime.setRole('owner');
    runtime.assign('conv_preview_0003', 'actor_preview_0008', 'اختبار');
    const result = runtime.unassign('conv_preview_0003', 'اختبار');
    assert.equal(result.ok, true, `فشل: ${result.code} ${result.message}`);
    assert.equal(runtime.getDetail('conv_preview_0003')?.assignee_actor_id, null);
  });

  await t.test('⭐ ⭐ الإسناد لموظف من مستأجر آخر يُرفض', () => {
    const runtime = createPreviewRuntime();
    runtime.setRole('owner');
    const result = runtime.assign('conv_preview_0003', 'actor_preview_0009', 'اختبار');
    assert.equal(result.ok, false);
    assert.equal(result.code, 'assignee_not_in_tenant');
  });

  await t.test('⭐ الإسناد لموظف غير موجود يُرفض', () => {
    const runtime = createPreviewRuntime();
    runtime.setRole('owner');
    const result = runtime.assign('conv_preview_0003', 'actor_preview_9999', 'اختبار');
    assert.equal(result.ok, false);
  });

  await t.test('⭐ ⭐ الكتابة من دور قراءة فقط تُرفض', () => {
    for (const role of ['viewer', 'agent'] as const) {
      const runtime = createPreviewRuntime();
      runtime.setRole(role);
      const transition = runtime.applyTransition('conv_preview_0003', 'resolved', 'اختبار');
      assert.equal(transition.ok, false, `${role} سمح بالانتقال`);
      assert.equal(transition.code, 'capability_missing');
      const assign = runtime.assign('conv_preview_0003', 'actor_preview_0007', 'اختبار');
      assert.equal(assign.ok, false, `${role} سمح بالإسناد`);
      assert.equal(assign.code, 'capability_missing');
    }
  });

  await t.test('⭐ ⭐ العزل: لا تسريب بين المستأجرين', () => {
    const runtime = createPreviewRuntime();
    const proof = runtime.getIsolationProof();
    assert.equal(proof.leaked_total, 0);
    assert.equal(proof.other_tenant_own_total, 1);
    assert.ok(proof.first_tenant_total >= 5);
    const refs = runtime.listQueue().map((item) => item.conversation_ref);
    assert.equal(refs.includes('conv_preview_0009'), false, 'محادثة المستأجر الثاني ظاهرة');
  });

  await t.test('⭐ ⭐ سجل التغييرات: الناجحة فقط', () => {
    const runtime = createPreviewRuntime();
    const before = runtime.getChanges('conv_preview_0003').length;
    runtime.applyTransition('conv_preview_0003', 'closed', 'محاولة مرفوضة');
    assert.equal(runtime.getChanges('conv_preview_0003').length, before, 'عملية مرفوضة سُجّلت');
    runtime.applyTransition('conv_preview_0003', 'pending', 'تجربة');
    assert.equal(runtime.getChanges('conv_preview_0003').length, before + 1, 'التغيير الناجح لم يُسجَّل');
  });

  await t.test('⭐ ⭐ الطابور يختلف باختلاف الدور', () => {
    const runtime = createPreviewRuntime();
    const supervisorRows = runtime.listQueue().length;
    runtime.setRole('agent');
    const agentRows = runtime.listQueue().length;
    runtime.setRole('viewer');
    const viewerRows = runtime.listQueue().length;
    assert.ok(supervisorRows >= 5, `المشرف رأى ${String(supervisorRows)}`);
    assert.equal(agentRows, 1, `الموظف رأى ${String(agentRows)} (المتوقَّع ١)`);
    assert.equal(viewerRows, 0, `القارئ رأى ${String(viewerRows)} (المتوقَّع ٠)`);
  });

  await t.test('⭐ ⭐ محاكاة الأدوار لا تعتمد على حمولة العميل', () => {
    const source = fs.readFileSync(path.join(ROOT, 'tools', 'wasl-workbench-preview-runtime.ts'), 'utf8');
    // ⭐ ⭐ لا يجوز تمرير الدور في الحمولة ⇒ ⭐ المصدر هو سجلّ داخلي.
    assert.ok(source.includes('markSynthetic'), 'لا تسجيل داخلي للدور');
    assert.ok(source.includes('SOURCES[role]'), 'الدور لا يُشتقّ من مصدر الجلسة');
    assert.ok(source.includes("scope: 'test'"), 'المصدر ليس بنطاق test');
    // ⭐ ⭐ واجهة المُشغِّل **لا تقبل دوراً من الخارج** ⇒ ⭐ لا ادّعاء هوية.
    assert.equal(
      /applyTransition\([^)]*role/.test(source),
      false,
      'الدور يُمرَّر إلى عملية التعديل',
    );
  });
});

// ============================================================
// ⭐ ٤ — فصل أدوات الاختبار عن الإنتاج + حدود التسليم
// ============================================================

test('⭐⭐ Slice 07 — حدود التسليم', async (t) => {
  await t.test('⭐ ⭐ المعاينة ليست في حزمة الإنتاج', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
      files?: string[];
    };
    assert.ok(Array.isArray(pkg.files), 'قائمة files غير موجودة');
    assert.equal(
      pkg.files.includes('docs/wasl-workbench-interactive.html'),
      false,
      'المعاينة داخل حزمة الإنتاج',
    );
    assert.equal(pkg.files.includes('tools/**'), false, 'الأدوات داخل حزمة الإنتاج');
  });

  await t.test('⭐ ⭐ لا استيراد من شجرة الاختبار داخل المعاينة', () => {
    const bundle = bundleModules(['tools/wasl-workbench-preview-entry.ts']);
    assert.equal(
      bundle.files.some((file) => file.startsWith('tests/')),
      false,
      'المعاينة تستورد من شجرة الاختبار',
    );
  });

  await t.test('⭐ ⭐ `src/core/` لم يتغيّر (المعاينة لا تعدّل النواة)', () => {
    const git = path.join(ROOT, '.git');
    if (!fs.existsSync(git)) return; // ⭐ بلا git ⇒ لا فحص
    // ⭐⭐⭐ **مقارنة بخطّ أساس ثابت** (M13) ⇒ ⭐ `HEAD` **أعمى عن الملتزم**.
    const committed = changedCoreFiles(ROOT, CORE_BASELINE_COMMIT, 'HEAD');
    assert.deepEqual(committed, [], `تغيّرت ملفات النواة:\n${committed.join('\n')}`);
    const workingTree = changedCoreFiles(ROOT, CORE_BASELINE_COMMIT, 'WORKTREE');
    assert.deepEqual(
      workingTree,
      [],
      `تغيّرت ملفات النواة (شجرة العمل):\n${workingTree.join('\n')}`,
    );
  });

  await t.test('⭐ ⭐ لا مفاتيح ولا أسرار في المعاينة (فحص مستقلّ)', () => {
    let haystack = readPreview();
    for (const pattern of SECRET_PATTERNS) {
      haystack = haystack.split(pattern.source).join('');
    }
    // ⭐ بادئات مفاتيح معروفة — ⭐ **خارج** أنماط الماسح.
    for (const prefix of ['AIza', 'eyJhbGciOi', 'xoxb-']) {
      assert.equal(haystack.includes(prefix), false, `وجد بادئة مفتاح ${prefix}`);
    }
  });
});

// ============================================================
// WASL AI — اختبارات معاينة مركز العمل (Slice 06 · P0)
// ------------------------------------------------------------
// ⭐ **التصريح**: ⭐ Slice 06 · P0 فقط — ⭐ «ملف HTML واحد مستقل يعمل من
//   `file://` بلا `fetch` ولا CDN ولا شبكة» + ⭐ أداة لقطة حتمية.
// ⭐ **المحاور**: ⭐ ① الحتمية (نفس المدخل ⇒ نفس البايت) ·
//   ② الملف المولَّد مطابق للنسخة في الريبو (لا انحراف) ·
//   ③ منع التسريب (لا نص رسائل) · ④ بلا شبكة (فحص على الملف) ·
//   ⑤ العزل مُثبَت بالأرقام · ⑥ JSON المضمَّن = ملف JSON ·
//   ⑦ RTL + لا أزرار كتابة · ⑧ صفر اتصال.
// ⛔ كل البيانات اصطناعية محلية · ⛔ صفر اتصال · ⛔ صفر حساب.
// ============================================================

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

// ⭐ الحاجز مُركَّب قبل تحميل أي مصدر (استيراد جانبي)
import { guard } from './guard-setup.ts';
import {
  PREVIEW_PATH,
  REPO_ROOT,
  SNAPSHOT_PATH,
  SYNTHETIC_BODIES,
  buildSnapshot,
  renderPreviewHtml,
  serializeSnapshot,
} from '../tools/wasl-workbench-snapshot.ts';

const ROOT = REPO_ROOT;

function readCommitted(file: string): string {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function extractEmbeddedJson(html: string): unknown {
  const open = html.indexOf('<script type="application/json" id="wasl-snapshot">');
  assert.ok(open >= 0, 'الـJSON المضمَّن غير موجود في الصفحة');
  const from = open + '<script type="application/json" id="wasl-snapshot">'.length;
  const close = html.indexOf('</script>', from);
  assert.ok(close > from, 'وسم إغلاق الـJSON المضمَّن غير موجود');
  const raw = html.slice(from, close).replace(/<\\\//g, '</');
  return JSON.parse(raw);
}

test('١) ⭐⭐⭐⭐⭐ الحتمية — نفس المدخلات ⇒ نفس البايت', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ اللقطة نفسها بايت-ببايت في تشغيلين', () => {
    const first = serializeSnapshot(buildSnapshot());
    const second = serializeSnapshot(buildSnapshot());
    assert.equal(first, second, 'اللقطة ليست حتمية — نفس المدخلات ⇒ نفس البايت');
  });

  await t.test('⭐⭐⭐⭐⭐ التوقيت مثبَّت (لا `Date.now` في اللقطة)', () => {
    const snapshot = buildSnapshot();
    assert.equal(snapshot.generated_at, '2026-01-05T12:00:00.000Z');
    assert.equal(snapshot.synthetic, true);
  });
});

test('٢) ⭐⭐⭐⭐⭐ الملف المولَّد مطابق للنسخة في الريبو (لا انحراف)', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ `docs/wasl-workbench-snapshot.json` مطابق', () => {
    const committed = readCommitted('docs/wasl-workbench-snapshot.json');
    assert.equal(committed, serializeSnapshot(buildSnapshot()), 'ملف اللقطة في الريبو قديم');
  });

  await t.test('⭐⭐⭐⭐⭐ `docs/wasl-workbench-preview.html` مطابق', () => {
    const committed = readCommitted('docs/wasl-workbench-preview.html');
    assert.equal(committed, renderPreviewHtml(buildSnapshot()), 'صفحة المعاينة في الريبو قديمة');
  });
});

test('٣) ⭐⭐⭐⭐⭐ منع التسريب — لا نص رسائل في اللقطة ولا في الصفحة', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ لا نص من نصوص الرسائل الاصطناعية', () => {
    const json = readCommitted('docs/wasl-workbench-snapshot.json');
    const html = readCommitted('docs/wasl-workbench-preview.html');
    for (const body of SYNTHETIC_BODIES) {
      assert.ok(!json.includes(body), `نص رسالة تسرّب إلى ملف اللقطة: ${body}`);
      assert.ok(!html.includes(body), `نص رسالة تسرّب إلى صفحة المعاينة: ${body}`);
    }
  });

  await t.test('⭐⭐⭐⭐⭐ لا مفتاح «body» ولا «text» ولا «content» في اللقطة', () => {
    const json = readCommitted('docs/wasl-workbench-snapshot.json');
    for (const forbidden of ['"body"', '"text"', '"message_text"', '"email"']) {
      assert.ok(!json.includes(forbidden), `مفتاح مسرِّب في اللقطة: ${forbidden}`);
    }
  });
});

test('٤) ⭐⭐⭐⭐⭐ بلا شبكة — فحص على ملف الصفحة نفسه', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ لا `fetch` ولا `XMLHttpRequest` ولا WebSocket', () => {
    const html = readCommitted('docs/wasl-workbench-preview.html');
    for (const forbidden of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'import(']) {
      assert.ok(!html.includes(forbidden), `طلب شبكة محتمل في الصفحة: ${forbidden}`);
    }
  });

  await t.test('⭐⭐⭐⭐⭐ لا رابط خارجي ولا CDN ولا خط أو سكربت خارجي', () => {
    const html = readCommitted('docs/wasl-workbench-preview.html');
    for (const forbidden of ['http://', 'https://', '//cdn', '<script src', '<link ', '@import', 'url(']) {
      assert.ok(!html.includes(forbidden), `مرجع خارجي في الصفحة: ${forbidden}`);
    }
  });

  await t.test('⭐⭐⭐⭐⭐ سياسة CSP مانعة: `default-src none`', () => {
    const html = readCommitted('docs/wasl-workbench-preview.html');
    assert.ok(
      html.includes("default-src 'none'"),
      'سياسة CSP المانعة غير موجودة ⇒ الصفحة غير مقيَّدة من الشبكة',
    );
  });

  await t.test('⭐⭐⭐⭐⭐ الصفحة ملف واحد بلا موارد مرافقة', () => {
    const html = readCommitted('docs/wasl-workbench-preview.html');
    assert.ok(html.startsWith('<!DOCTYPE html>'), 'الصفحة ليست مستند HTML مستقل');
    assert.ok(html.trimEnd().endsWith('</html>'), 'الصفحة غير مكتملة');
  });
});

test('٥) ⭐⭐⭐⭐⭐ العزل مُثبَت بالأرقام — لا تسريب بين المستأجرين', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ المحادثات المسرَّبة = صفر', () => {
    const snapshot = buildSnapshot();
    assert.equal(snapshot.isolation.leaked_total, 0, 'محادثة مستأجر آخر ظهرت في طابور المستأجر الأول');
  });

  await t.test('⭐⭐⭐⭐⭐ محادثة المستأجر الثاني غائبة عن كل طابور', () => {
    const snapshot = buildSnapshot();
    const refs = [
      ...snapshot.agent_queue.items.map((item) => item.conversation_ref),
      ...snapshot.supervisor_queue.items.map((item) => item.conversation_ref),
    ];
    assert.ok(
      !refs.includes(snapshot.isolation.other_tenant_ref),
      'محادثة المستأجر الثاني ظاهرة في طابور المستأجر الأول',
    );
    assert.equal(snapshot.supervisor_queue.pagination.total, 3);
    assert.equal(snapshot.agent_queue.pagination.total, 1);
    assert.equal(snapshot.isolation.other_tenant_own_total, 1);
  });

  await t.test('⭐⭐⭐⭐⭐ نطاق الموظف = محادثاته فقط', () => {
    const snapshot = buildSnapshot();
    for (const item of snapshot.agent_queue.items) {
      assert.equal(item.assignee_actor_id, 'actor_preview_0007', 'محادثة ليست مسنَدة للموظف في طابوره');
    }
  });
});

test('٦) ⭐⭐⭐⭐⭐ JSON المضمَّن في الصفحة = ملف JSON نفسه', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ المحتوى متطابق بايت-ببايت', () => {
    const html = readCommitted('docs/wasl-workbench-preview.html');
    const embedded = extractEmbeddedJson(html);
    const onDisk = JSON.parse(readCommitted('docs/wasl-workbench-snapshot.json'));
    assert.deepEqual(embedded, onDisk, 'الـJSON المضمَّن مختلف عن ملف اللقطة');
  });
});

test('٧) ⭐⭐⭐⭐⭐ RTL + صفحة قراءة فقط (لا أزرار كتابة)', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ الاتجاه من اليمين لليسار', () => {
    const html = readCommitted('docs/wasl-workbench-preview.html');
    assert.ok(html.includes('<html lang="ar" dir="rtl">'), 'الصفحة ليست RTL');
  });

  await t.test('⭐⭐⭐⭐⭐ لا أزرار ولا حقول إدخال ولا نماذج', () => {
    const html = readCommitted('docs/wasl-workbench-preview.html');
    for (const forbidden of ['<button', '<input', '<form', '<textarea', '<select', 'onclick']) {
      assert.ok(!html.includes(forbidden), `عنصر تفاعلي في صفحة قراءة فقط: ${forbidden}`);
    }
  });

  await t.test('⭐⭐⭐⭐⭐ لافتة «اصطناعية» موجودة في الصفحة', () => {
    const html = readCommitted('docs/wasl-workbench-preview.html');
    assert.ok(html.includes('معاينة اصطناعية'), 'لا لافتة تُعلن أن البيانات اصطناعية');
  });
});

test('٨) ⭐⭐⭐⭐⭐ صفر اتصال (الحاجز مُركَّب)', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ صفر محاولة اتصال خارجية', () => {
    assert.equal(guard.installed, true);
    assert.deepEqual(guard.blocked, []);
  });
});

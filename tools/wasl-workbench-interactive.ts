// ============================================================
// WASL AI — مولّد المعاينة التفاعلية (Slice 07 · P0)
// ------------------------------------------------------------
// ⭐ يُنتج: ⭐ **ملف HTML واحد مستقل** يعمل من `file://`.
// ⭐ المحتوى = ⭐ **نواة مُجمَّعة وقت البناء** + ⭐ **واجهة تستدعيها**.
// ⭐ ⛔ بلا خادم · بلا شبكة · بلا CDN · بلا `fetch` · بلا مفاتيح.
// ⭐ ⛔ بلا تخزين دائم (لا `localStorage` ولا `sessionStorage`).
// ⭐ تشغيل: `node --experimental-strip-types tools/wasl-workbench-interactive.ts`
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { bundleModules } from './wasl-workbench-bundle.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'docs', 'wasl-workbench-interactive.html');

/** ⭐ نقطة الدخول المُجمَّعة — ⭐ الاسم ثابت (يُحسب من اسم الملف). */
const ENTRY_MODULE = 'tools/wasl-workbench-preview-entry.ts';
const ENTRY_VAR = '__m_wasl_workbench_preview_entry';

/**
 * ⭐ ⭐ حماية النص داخل `<script>` — ⭐ `<` لا يُغلق الوسم.
 */
function escapeForScript(code: string): string {
  return code.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
}

const CSS = `
  :root {
    --bg: #0e1117;
    --panel: #161b22;
    --panel-2: #1c2230;
    --line: #2a323d;
    --ink: #e6edf3;
    --muted: #9aa7b4;
    --accent: #4c8dff;
    --warn: #f0a132;
    --ok: #3fb950;
    --err: #f85149;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 0 0 40px;
    background: var(--bg);
    color: var(--ink);
    font-family: "Segoe UI", Tahoma, Arial, sans-serif;
    line-height: 1.6;
  }
  .banner {
    background: var(--warn);
    color: #1b1200;
    padding: 12px 16px;
    text-align: center;
    font-size: 15px;
    border-bottom: 2px solid #b8770f;
  }
  .banner strong { display: block; font-size: 16px; }
  .banner span { display: block; font-size: 13px; margin-top: 4px; }
  h1 {
    font-size: 22px;
    margin: 20px 16px 6px;
    font-weight: 700;
  }
  .sub {
    margin: 0 16px 16px;
    color: var(--muted);
    font-size: 13px;
  }
  #preview-root { padding: 0 16px; }
  .role-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 10px;
  }
  .role-btn {
    background: var(--panel);
    color: var(--ink);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 8px 14px;
    font-size: 14px;
    cursor: pointer;
    font-family: inherit;
  }
  .role-btn.active { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 700; }
  .capabilities {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 14px;
    font-size: 12px;
    color: var(--muted);
  }
  .role-now { color: var(--accent); font-weight: 700; font-size: 13px; }
  .caps { direction: ltr; unicode-bidi: isolate; }
  .columns {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    align-items: start;
  }
  .panel {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 14px;
    margin-bottom: 14px;
    min-width: 0;
  }
  .panel h2 { font-size: 16px; margin: 0 0 10px; }
  .panel h3 { font-size: 13px; margin: 14px 0 6px; color: var(--muted); font-weight: 600; }
  .scroll { overflow-x: auto; }
  table.grid { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 520px; }
  table.grid th, table.grid td {
    border-bottom: 1px solid var(--line);
    padding: 7px 8px;
    text-align: right;
    white-space: nowrap;
  }
  table.grid th { color: var(--muted); font-weight: 600; font-size: 12px; }
  table.grid td.num { text-align: left; direction: ltr; unicode-bidi: isolate; }
  table.grid td.ltr { direction: ltr; unicode-bidi: isolate; text-align: left; }
  table.grid td.ref { direction: ltr; unicode-bidi: isolate; text-align: left; cursor: pointer; color: var(--accent); }
  table.grid tbody tr:hover { background: var(--panel-2); cursor: pointer; }
  table.grid tbody tr.selected { background: #1d2b45; }
  td.empty { text-align: center; color: var(--muted); padding: 16px; }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    font-size: 13px;
    margin-bottom: 10px;
  }
  .meta span { background: var(--panel-2); border-radius: 6px; padding: 4px 9px; }
  .meta span.terminal { background: #3a1d1d; color: #ffb4ac; }
  .btn-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .state-btn, .action-btn {
    background: var(--panel-2);
    color: var(--ink);
    border: 1px solid var(--line);
    border-radius: 7px;
    padding: 7px 13px;
    font-size: 13px;
    cursor: pointer;
    font-family: inherit;
  }
  .state-btn:hover:not(:disabled), .action-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .state-btn.blocked, .action-btn.blocked { opacity: .42; cursor: not-allowed; }
  select {
    background: var(--panel-2);
    color: var(--ink);
    border: 1px solid var(--line);
    border-radius: 7px;
    padding: 7px 10px;
    font-size: 13px;
    font-family: inherit;
    direction: ltr;
  }
  .result {
    margin-top: 14px;
    padding: 9px 12px;
    border-radius: 7px;
    font-size: 13px;
    background: var(--panel-2);
    border: 1px solid var(--line);
  }
  .result.ok { border-color: var(--ok); color: #7ee787; }
  .result.err { border-color: var(--err); color: #ffb4ac; }
  .proof { margin: 0; padding-right: 18px; font-size: 13px; }
  .proof li { margin: 3px 0; }
  .proof li.leak { color: #7ee787; font-weight: 700; }
  @media (max-width: 820px) {
    .columns { grid-template-columns: 1fr; }
    h1 { font-size: 19px; }
    .banner { font-size: 13px; }
    .banner strong { font-size: 14px; }
  }
`;

/** ⭐ يبني صفحة HTML كاملة. */
function buildHtml(bundleCode: string): string {
  const script = `${escapeForScript(bundleCode)}\n${ENTRY_VAR}.bootPreview();`;
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>WASL AI — معاينة مركز العمل التفاعلية (اصطناعية)</title>
<style>${CSS}</style>
</head>
<body>
<header class="banner">
  <strong>معاينة تجريبية ببيانات صناعية — تبديل الدور ليس تسجيل دخول أو تحققاً من الهوية</strong>
  <span>كل التعديلات مؤقتة داخل ذاكرة المعاينة وتُفقد عند إغلاق الصفحة أو إعادة تحميلها — بلا شبكة وبلا حفظ دائم.</span>
</header>
<h1>WASL AI — معاينة مركز العمل التفاعلية</h1>
<p class="sub">المعاينة تستدعي منطق النواة نفسه (قواعد الصلاحيات · خريطة الانتقالات · سجل التغييرات) — وكل قبول أو رفض يأتي منها.</p>
<div id="preview-root"></div>
<script>
${script}
</script>
</body>
</html>
`;
}

function main(): void {
  const bundle = bundleModules([ENTRY_MODULE]);
  const html = buildHtml(bundle.code);
  fs.writeFileSync(OUT, html, 'utf8');
  const bytes = Buffer.byteLength(html, 'utf8');
  process.stdout.write(
    `⭐ المعاينة التفاعلية: docs/wasl-workbench-interactive.html (${bytes.toLocaleString('en-US')} بايت)\n` +
      `⭐ الوحدات المُجمَّعة: ${String(bundle.files.length)}\n` +
      `⭐ الكود المُجمَّع: ${String(bundle.files.join('\n  ⭐ '))}\n`,
  );
}

main();

// ============================================================
// WASL AI — فحص المعاينة في **متصفّح حقيقي** (Slice 06 · P0)
// ------------------------------------------------------------
// ⭐ تشغيل: `node --experimental-strip-types tools/wasl-workbench-browser-check.ts`
// ⭐ **متصفّح حقيقي (Chromium عبر Playwright)** — ⭐ لا محاكاة ولا تقدير.
// ⭐ **ما يُثبته هذا الفحص**:
//   ① الصفحة تُفتح من `file://` بلا خادم.
//   ② **صفر أخطاء JavaScript** (console + page errors).
//   ③ **صفر طلبات شبكة** (لا CDN ولا خط ولا API).
//   ④ الاتجاه **RTL** مطبَّق فعلياً (computed style).
//   ⑤ المحتوى **مُعرَّض فعلاً** ( صفوف الطابور + بطاقات المؤشرات + العزل).
//   ⑥ **لقطات شاشة** (كمبيوتر + موبايل) ⇒ دليل بصري.
// ⛔ لا يحفظ بيانات · ⛔ لا يرسل شيئاً · ⛔ صفر حساب.
// ⭐ ملاحظة: ⭐ Playwright **تثبيت عام** (ليس اعتماداً للمشروع) ⇒ ⇒
//   ⇒ ولهذا الفحص **ليس** ضمن `npm test` ⇒ ⇒ بل `npm run test:browser`.
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const PREVIEW = path.join(ROOT, 'docs', 'wasl-workbench-preview.html');
const SHOT_DIR = path.join(ROOT, 'docs', 'previews');

/** ⭐ playwright إما من الاعتماد العام أو من متغيّر بيئة ⇒ ⇒ (بلا اعتماد بالمشروع). */
function resolvePlaywright(): Promise<{ chromium: unknown }> {
  const candidates: string[] = [];
  if (process.env.PLAYWRIGHT_MODULE) candidates.push(process.env.PLAYWRIGHT_MODULE);
  const globalRoot = process.env.NODE_PATH?.split(':').filter(Boolean)[0];
  if (globalRoot) candidates.push(path.join(globalRoot, 'playwright', 'index.mjs'));
  candidates.push('/usr/local/lib/node_modules/playwright/index.mjs');
  candidates.push('/usr/lib/node_modules/playwright/index.mjs');

  return (async () => {
    for (const candidate of candidates) {
      try {
        const resolved = await import(pathToFileURL(candidate).href);
        if (resolved?.chromium) return resolved as { chromium: unknown };
      } catch {
        // ⭐ مسار غير متاح ⇒ نجرّب التالي.
      }
    }
    throw new Error(`تعذّر تحميل Playwright — جرّب المسارات: ${candidates.join(' · ')}`);
  })();
}

interface Failure {
  readonly check: string;
  readonly detail: string;
}

/** ⭐ الحدّ الأدنى من واجهة Playwright التي نستخدمها ⇒ ⇒ بلا اعتماد بالمشروع. */
interface BrowserPage {
  on(event: 'request', handler: (request: { url: () => string }) => void): void;
  on(
    event: 'console',
    handler: (message: { type: () => string; text: () => string }) => void,
  ): void;
  on(event: 'pageerror', handler: (error: { message: string }) => void): void;
  goto(url: string, options: { waitUntil: string }): Promise<unknown>;
  evaluate<T>(fn: () => T): Promise<T>;
  screenshot(options: { path: string; fullPage: boolean }): Promise<unknown>;
  close(): Promise<void>;
}

interface BrowserContext {
  newPage(): Promise<BrowserPage>;
  close(): Promise<void>;
}

interface Browser {
  newContext(options: Record<string, unknown>): Promise<BrowserContext>;
  close(): Promise<void>;
}

/** ⭐ ⭐ يبحث عن **ملف Chromium الحقيقي** ⇒ ⇒ (تسمية المجلد تختلف بين الإصدارات). */
function resolveChromiumExecutable(): string | undefined {
  const roots: string[] = [];
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) roots.push(process.env.PLAYWRIGHT_BROWSERS_PATH);
  roots.push('/root/.cache/ms-playwright');
  roots.push(path.join(process.env.HOME ?? '', '.cache', 'ms-playwright'));
  roots.push(path.join(ROOT, '.cache', 'ms-playwright'));

  for (const root of roots) {
    if (!root || !fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root)) {
      for (const relative of [
        ['chrome-linux', 'chrome'],
        ['chrome-linux64', 'chrome'],
        ['chrome-headless-shell-linux64', 'chrome-headless-shell'],
      ]) {
        const candidate = path.join(root, entry, relative[0], relative[1]);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) {
    return process.env.CHROMIUM_PATH;
  }
  return undefined;
}

async function main(): Promise<void> {
  const failures: Failure[] = [];
  const fail = (check: string, detail: string): void => {
    failures.push({ check, detail });
  };

  const { chromium } = await resolvePlaywright();
  const launcher = chromium as {
    launch: (options: { args: string[]; executablePath?: string }) => Promise<Browser>;
  };
  const executablePath = resolveChromiumExecutable();
  const browser = await launcher.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    ...(executablePath ? { executablePath } : {}),
  });

  fs.mkdirSync(SHOT_DIR, { recursive: true });

  const url = pathToFileURL(PREVIEW).href;
  const requests: string[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  page.on('request', (request: { url: () => string }) => {
    requests.push(request.url());
  });
  page.on('console', (message: { type: () => string; text: () => string }) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error: { message: string }) => {
    pageErrors.push(error.message);
  });

  await page.goto(url, { waitUntil: 'load' });

  // ① الاتجاه — RTL فعلياً (computed style لا مجرد السمة).
  const direction = await page.evaluate(() => {
    const root = document.documentElement;
    const style = window.getComputedStyle(root);
    return { dir: root.getAttribute('dir'), lang: root.getAttribute('lang'), computed: style.direction };
  });
  if (direction.dir !== 'rtl' || direction.computed !== 'rtl') {
    fail('RTL', `الاتجاه غير RTL — dir=${direction.dir} · computed=${direction.computed}`);
  }
  if (direction.lang !== 'ar') fail('RTL', `اللغة ليست ar — ${direction.lang}`);

  // ② أخطاء JavaScript.
  if (pageErrors.length > 0) fail('أخطاء JS', pageErrors.join(' | '));
  if (consoleErrors.length > 0) fail('أخطاء console', consoleErrors.join(' | '));

  // ③ صفر طلبات شبكة (عدا المستند نفسه).
  const external = requests.filter((request) => request !== url);
  if (external.length > 0) fail('طلبات شبكة', external.join(' | '));

  // ④ المحتوى مُعرَّض فعلاً.
  const rendered = await page.evaluate(() => {
    const rowsOf = (selector: string): number =>
      document.querySelectorAll(selector + ' table tbody tr').length;
    const cards = document.querySelectorAll('#metrics-body .card').length;
    const text = (selector: string): string =>
      (document.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim();
    return {
      agentRows: rowsOf('#queue-agent-body'),
      supervisorRows: rowsOf('#queue-supervisor-body'),
      cards,
      guardrails: document.querySelectorAll('#guardrails-body li').length,
      decisions: document.querySelectorAll('#decisions-body .dec').length,
      isolationText: text('#isolation-body'),
      bodyText: (document.body.textContent ?? '').replace(/\s+/g, ' '),
      dateCellDirection: (() => {
        const cell = document.querySelector('#queue-supervisor-body td.ltr');
        return cell ? window.getComputedStyle(cell).direction : 'missing';
      })(),
      banner: text('header.banner'),
      title: document.title,
    };
  });

  if (rendered.agentRows !== 1) fail('المحتوى', `صفوف طابور الوكيل = ${rendered.agentRows} (المتوقّع ١)`);
  if (rendered.supervisorRows !== 3) {
    fail('المحتوى', `صفوف طابور المشرف = ${rendered.supervisorRows} (المتوقّع ٣)`);
  }
  if (rendered.cards < 5) fail('المحتوى', `بطاقات المؤشرات = ${rendered.cards} (المتوقّع ≥ ٥)`);
  if (rendered.guardrails < 5) fail('المحتوى', `بنود الحدود = ${rendered.guardrails}`);
  if (rendered.decisions < 4) fail('المحتوى', `القرارات = ${rendered.decisions}`);
  if (!rendered.banner.includes('معاينة اصطناعية')) fail('المحتوى', 'لافتة «اصطناعية» غير معروضة');
  if (!rendered.isolationText.includes('conv_preview_0009')) {
    fail('المحتوى', 'إثبات العزل غير معروض');
  }
  // ⭐ لا markdown مسرَّب داخل نص معروض ( asterisks ).
  if (rendered.bodyText.includes('**')) {
    fail('المحتوى', 'يوجد markdown مسرَّب في النص المعروض');
  }
  // ⭐ خلايا التوقيت تُعرض LTR (إلا فازت الـbidi ترتيب التاريخ).
  if (rendered.dateCellDirection !== 'ltr') {
    fail('المحتوى', `اتجاه خلية التوقيت = ${rendered.dateCellDirection} (المتوقّع ltr)`);
  }

  // ⑤ لقطات الشاشة (كمبيوتر + موبايل).
  const desktopShot = path.join(SHOT_DIR, 'wasl-workbench-preview-desktop.png');
  await page.screenshot({ path: desktopShot, fullPage: true });

  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const mobilePage = await mobileContext.newPage();
  const mobileErrors: string[] = [];
  mobilePage.on('pageerror', (error: { message: string }) => mobileErrors.push(error.message));
  await mobilePage.goto(url, { waitUntil: 'load' });
  if (mobileErrors.length > 0) fail('أخطاء JS (موبايل)', mobileErrors.join(' | '));
  const mobileOverflow = await mobilePage.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  if (mobileOverflow > 2) fail('الموبايل', `تجاوز أفقي = ${mobileOverflow}px`);
  const mobileShot = path.join(SHOT_DIR, 'wasl-workbench-preview-mobile.png');
  await mobilePage.screenshot({ path: mobileShot, fullPage: true });

  await mobileContext.close();
  await context.close();
  await browser.close();

  // ⭐ التقرير.
  console.log('⭐ فحص المتصفح الحقيقي — معاينة مركز العمل (Slice 06 · P0)');
  console.log('────────────────────────────────────────────────');
  console.log(`⭐ الملف: ${path.relative(ROOT, PREVIEW)}`);
  console.log(`⭐ العنوان: ${rendered.title}`);
  console.log(`⭐ الاتجاه: dir=${direction.dir} · computed=${direction.computed} · lang=${direction.lang}`);
  console.log(`⭐ طلبات الشبكة: ${requests.length} (خارج المستند: ${external.length})`);
  console.log(`⭐ أخطاء JS: ${pageErrors.length} · أخطاء console: ${consoleErrors.length}`);
  console.log(
    `⭐ المحتوى: صفوف الوكيل=${rendered.agentRows} · صفوف المشرف=${rendered.supervisorRows} · بطاقات=${rendered.cards} · حدود=${rendered.guardrails} · قرارات=${rendered.decisions}`,
  );
  console.log(`⭐ لقطة كمبيوتر: ${path.relative(ROOT, desktopShot)}`);
  console.log(`⭐ لقطة موبايل: ${path.relative(ROOT, mobileShot)}`);
  console.log('────────────────────────────────────────────────');

  if (failures.length > 0) {
    console.log(`⛔ فشل ${failures.length} فحص:`);
    for (const failure of failures) console.log(`  ⛔ ${failure.check}: ${failure.detail}`);
    process.exitCode = 1;
    return;
  }
  console.log('✅ كل الفحوص نجحت — الصفحة تعمل من file:// بلا أخطاء وبلا أي طلب شبكة.');
}

await main();

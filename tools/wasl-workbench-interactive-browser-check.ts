// ============================================================
// WASL AI — اختبار المتصفّح الحقيقي للمعاينة التفاعلية (Slice 07 · P0)
// ------------------------------------------------------------
// ⭐ تشغيل: `node --experimental-strip-types tools/wasl-workbench-interactive-browser-check.ts`
// ⭐ **نقر فعلي** — ⭐ لا فحص ملف فقط.
// ⭐ يغطي: ⭐ **٢٠ بند قبول** + ⭐ **العزل + الأمان + الصلاحيات**.
// ⭐ ⛔ بلا ادّعاء نجاح غير مُنفَّذ ⇒ ⭐ **وإن لم يتوفّر متصفّح ⇒ يُبلَّغ بوضوح**.
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const PREVIEW = path.join(ROOT, 'docs', 'wasl-workbench-interactive.html');
const SHOT_DIR = path.join(ROOT, 'docs', 'previews');

// ============================================================
// ⭐ تحميل Playwright (تثبيت عام — ⛔ ليس اعتماداً بالمشروع)
// ============================================================

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

/** ⭐ ⭐ بحث ديناميكي عن ملف Chromium (تسمية المجلد تختلف بين الإصدارات). */
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
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH;
  return undefined;
}

// ============================================================
// ⭐ الحدّ الأدنى من واجهة Playwright
// ============================================================

interface Page {
  on(event: 'request', handler: (request: { url: () => string }) => void): void;
  on(event: 'console', handler: (message: { type: () => string; text: () => string }) => void): void;
  on(event: 'pageerror', handler: (error: { message: string }) => void): void;
  goto(url: string, options: { waitUntil: string }): Promise<unknown>;
  evaluate<T>(fn: (...args: never[]) => T, arg?: unknown): Promise<T>;
  screenshot(options: { path: string; fullPage: boolean }): Promise<unknown>;
  click(selector: string, options?: { force?: boolean }): Promise<void>;
  reload(options?: { waitUntil: string }): Promise<unknown>;
  textContent(selector: string): Promise<string | null>;
  locator(selector: string): { count(): Promise<number> };
  isDisabled(selector: string): Promise<boolean>;
  selectOption(selector: string, value: string): Promise<unknown>;
  close(): Promise<void>;
}

interface BrowserContext {
  newPage(): Promise<Page>;
  close(): Promise<void>;
}

interface Browser {
  newContext(options: Record<string, unknown>): Promise<BrowserContext>;
  close(): Promise<void>;
}

interface Failure {
  readonly check: string;
  readonly detail: string;
}

// ============================================================
// ⭐ التنفيذ
// ============================================================

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
  if (!executablePath) {
    throw new Error(
      '⛔ لم يُعثر على ملف Chromium — ⛔ لا ادّعاء نجاح اختبار لم يُنفَّذ. ' +
        'ثبّت Playwright (npm i -g playwright && npx playwright install chromium) أو حدّد CHROMIUM_PATH.',
    );
  }
  const browser = await launcher.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    executablePath,
  });

  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const url = pathToFileURL(PREVIEW).href;

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  const requests: string[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('request', (request) => {
    requests.push(request.url());
  });
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  await page.goto(url, { waitUntil: 'load' });

  // ── ⭐ ① فتح في متصفّح حقيقي + ⑧ بلا شبكة ──
  const external = requests.filter((request) => !request.startsWith('file://'));
  if (external.length > 0) fail('①/⑧ الشبكة', `طلبات خارجية: ${external.join(' | ')}`);

  // ── ⭐ ⑳ أخطاء JavaScript ──
  if (pageErrors.length > 0) fail('⑳ أخطاء JS', pageErrors.join(' | '));
  if (consoleErrors.length > 0) fail('⑳ console', consoleErrors.join(' | '));

  // ── ⭐ ⑲ RTL + العرض على الهاتف ──
  const direction = await page.evaluate(() => {
    const html = document.documentElement;
    return {
      dir: html.getAttribute('dir') ?? '',
      computed: window.getComputedStyle(html).direction,
      lang: html.getAttribute('lang') ?? '',
    };
  });
  if (direction.dir !== 'rtl' || direction.computed !== 'rtl') {
    fail('⑲ RTL', `dir=${direction.dir} · computed=${direction.computed}`);
  }
  if (direction.lang !== 'ar') fail('⑲ RTL', `lang=${direction.lang}`);

  // ── ⭐ ② الدور الافتراضي = مشرف تجريبي ──
  const defaultRole = await page.evaluate(() => {
    const active = document.querySelector('#preview-root .role-btn.active');
    const now = document.querySelector('#preview-root .role-now');
    return { role: active?.getAttribute('data-role') ?? '', label: now?.textContent ?? '' };
  });
  if (defaultRole.role !== 'supervisor') fail('② الدور الافتراضي', `الدور = ${defaultRole.role}`);
  if (!defaultRole.label.includes('مشرف تجريبي')) {
    fail('② الدور الافتراضي', `ال	label = ${defaultRole.label}`);
  }

  // ── ⭐ ⭐ لافتة «المحاكاة» ظاهرة ──
  const banner = await page.textContent('.banner strong');
  if (!banner || !banner.includes('ليس تسجيل دخول')) {
    fail('② لافتة المحاكاة', `النص = ${banner ?? 'مفقود'}`);
  }

  // ── ⭐ ④ طابور لكل دور ──
  const queueByRole: Record<string, number> = {};
  for (const role of ['supervisor', 'owner', 'agent', 'viewer']) {
    await page.click(`#preview-root .role-btn[data-role="${role}"]`);
    await page.waitForTimeout?.(60);
    queueByRole[role] = await page.locator('#queue-body tr[data-ref]').count();
  }
  if ((queueByRole.supervisor ?? 0) < 5) {
    fail('④ طابور المشرف', `صفوف = ${String(queueByRole.supervisor)} (المتوقّع ≥ ٥)`);
  }
  if ((queueByRole.agent ?? 0) !== 1) {
    fail('④ طابور الموظف', `صفوف = ${String(queueByRole.agent)} (المتوقّع ١ — محادثته فقط)`);
  }
  if ((queueByRole.viewer ?? 0) !== 0) {
    fail('④ طابور القراءة', `صفوف = ${String(queueByRole.viewer)} (المتوقّع ٠ — بلا صلاحية الطابور)`);
  }

  // ── ⭐ ③ نجاح تبديل الأدوار ──
  await page.click('#preview-root .role-btn[data-role="owner"]');
  const switched = await page.evaluate(() => {
    const active = document.querySelector('#preview-root .role-btn.active');
    const caps = document.querySelector('#preview-root .caps');
    return {
      role: active?.getAttribute('data-role') ?? '',
      caps: caps?.textContent ?? '',
    };
  });
  if (switched.role !== 'owner') fail('③ تبديل الدور', `الدور = ${switched.role}`);
  if (!switched.caps.includes('conversation.assign')) {
    fail('③ تبديل الدور', `قدرات المالك لا تحوي الإسناد: ${switched.caps}`);
  }

  // ⭐ **خط أساس سجل التغييرات** — ⭐ يُقاس فور الفتح (قبل أي تعديل).
  const seedBaseline = await page.evaluate(() => {
    const runtime = (
      globalThis as unknown as {
        waslPreviewRuntime?: { getChanges(ref: string): unknown[] };
      }
    ).waslPreviewRuntime;
    return runtime?.getChanges('conv_preview_0003').length ?? -1;
  });

  // ── ⭐ ⑭ منع تسريب بيانات المستأجرين ──
  const isolation = await page.evaluate(() => {
    const refs = Array.from(document.querySelectorAll('#queue-body tr[data-ref]')).map((row) =>
      (row as HTMLElement).getAttribute('data-ref') ?? '',
    );
    // ⭐ ⭐ يقتصر على **المحتوى المعروض** (لا شفرة السكربت المضمَّنة).
    const body = document.getElementById('preview-root')?.textContent ?? '';
    const proof = (globalThis as unknown as { waslPreviewRuntime?: { getIsolationProof(): { leaked_total: number } } })
      .waslPreviewRuntime?.getIsolationProof();
    return { refs, leakedInDom: body.includes('conv_preview_0009'), leaked: proof?.leaked_total ?? -1 };
  });
  if (isolation.refs.some((ref) => ref.includes('conv_preview_0009'))) {
    fail('⑭ العزل', 'محادثة المستأجر الثاني ظاهرة في الطابور');
  }
  if (isolation.leakedInDom) fail('⑭ العزل', 'نص محادثة المستأجر الثاني موجود في الصفحة');
  if (isolation.leaked !== 0) fail('⑭ العزل', `leaked_total = ${String(isolation.leaked)}`);

  // ── ⭐ ⑤ نجاح انتقال حالة مسموح (نقر فعلي) ──
  await page.click('#queue-body tr[data-ref="conv_preview_0003"]');
  await page.click('#preview-root .state-btn[data-to="pending"]');
  const afterTransition = await page.evaluate(() => {
    const result = document.querySelector('#result-box');
    const detail = document.querySelector('#detail-panel .meta');
    return { result: result?.textContent ?? '', detail: detail?.textContent ?? '' };
  });
  if (!afterTransition.result.includes('✅')) {
    fail('⑤ انتقال مسموح', `النتيجة = ${afterTransition.result}`);
  }
  if (!afterTransition.detail.includes('قيد المعالجة')) {
    fail('⑤ انتقال مسموح', `الحالة بعد الانتقال = ${afterTransition.detail}`);
  }

  // ── ⭐ ⑥ رفض انتقال غير مسموح (النواة هي المرجع) ──
  const rejectedTransition = await page.evaluate(() => {
    const runtime = (
      globalThis as unknown as {
        waslPreviewRuntime?: {
          applyTransition(ref: string, to: string, reason: string): { ok: boolean; code: string };
        };
      }
    ).waslPreviewRuntime;
    if (!runtime) return { ok: true, code: 'runtime_missing' };
    return runtime.applyTransition('conv_preview_0003', 'closed', 'محاولة غير مسموحة');
  });
  if (rejectedTransition.ok || rejectedTransition.code !== 'transition_not_allowed') {
    fail('⑥ انتقال غير مسموح', `النتيجة = ${JSON.stringify(rejectedTransition)}`);
  }

  // ── ⭐ ⑯ لا تغيير جزئي عند الفشل ──
  const stateAfterFailure = await page.evaluate(() => {
    const runtime = (
      globalThis as unknown as {
        waslPreviewRuntime?: { getDetail(ref: string): { state: string } | null };
      }
    ).waslPreviewRuntime;
    return runtime?.getDetail('conv_preview_0003')?.state ?? 'unknown';
  });
  if (stateAfterFailure !== 'pending') {
    fail('⑯ لا تغيير جزئي', `الحالة بعد الرفض = ${stateAfterFailure} (المتوقَّع pending)`);
  }

  // ── ⭐ ⑮ سجل التغييرات: الناجحة فقط ──
  const changesAfter = await page.locator('#changes-body tr').count();
  const rejectedDoesNotLog = await page.evaluate(() => {
    const runtime = (
      globalThis as unknown as {
        waslPreviewRuntime?: {
          applyTransition(ref: string, to: string, reason: string): { ok: boolean };
          getChanges(ref: string): unknown[];
        };
      }
    ).waslPreviewRuntime;
    if (!runtime) return { before: -1, after: -1 };
    const before = runtime.getChanges('conv_preview_0003').length;
    runtime.applyTransition('conv_preview_0003', 'closed', 'محاولة غير مسموحة');
    return { before, after: runtime.getChanges('conv_preview_0003').length };
  });
  if (rejectedDoesNotLog.before !== rejectedDoesNotLog.after) {
    fail('⑮ سجل التغييرات', `تغيّر عدد السجل بعد عملية مرفوضة (${String(rejectedDoesNotLog.before)} ← ${String(rejectedDoesNotLog.after)})`);
  }
  if (changesAfter < 1) fail('⑮ سجل التغييرات', `صفوف السجل = ${String(changesAfter)}`);

  // ── ⭐ ⑦ نجاح الإغلاق من `resolved` فقط ──
  await page.click('#queue-body tr[data-ref="conv_preview_0004"]');
  await page.click('#preview-root .state-btn[data-to="closed"]');
  const closedResult = await page.textContent('#result-box');
  if (!closedResult || !closedResult.includes('✅')) {
    fail('⑦ الإغلاق من resolved', `النتيجة = ${closedResult ?? 'مفقود'}`);
  }

  // ── ⭐ ⑧ منع تعديل محادثة مغلقة ──
  await page.click('#queue-body tr[data-ref="conv_preview_0005"]');
  const closedDetail = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('#preview-root .state-btn')) as Array<
      HTMLButtonElement
    >;
    const assign = document.querySelector('#assign-btn') as HTMLButtonElement | null;
    const unassign = document.querySelector('#unassign-btn') as HTMLButtonElement | null;
    return {
      allDisabled: buttons.every((button) => button.disabled),
      assignDisabled: assign?.disabled ?? false,
      unassignDisabled: unassign?.disabled ?? false,
      terminalFlag: document.querySelector('#detail-panel .meta .terminal') !== null,
    };
  });
  if (!closedDetail.allDisabled) fail('⑧ محادثة مغلقة', 'توجد أزرار حالة مفعّلة');
  if (!closedDetail.assignDisabled || !closedDetail.unassignDisabled) {
    fail('⑧ محادثة مغلقة', 'أزرار الإسناد مفعّلة');
  }
  const closedRejected = await page.evaluate(() => {
    const runtime = (
      globalThis as unknown as {
        waslPreviewRuntime?: {
          updateViaApply(ref: string, to: string): unknown;
          applyTransition(ref: string, to: string, reason: string): { ok: boolean; code: string };
          assign(ref: string, actor: string, reason: string): { ok: boolean; code: string };
        };
      }
    ).waslPreviewRuntime;
    if (!runtime) return { transition: { ok: true, code: 'missing' }, assign: { ok: true, code: 'missing' } };
    return {
      transition: runtime.applyTransition('conv_preview_0005', 'open', 'محاولة'),
      assign: runtime.assign('conv_preview_0005', 'actor_preview_0007', 'محاولة'),
    };
  });
  if (closedRejected.transition.ok || closedRejected.transition.code !== 'state_terminal') {
    fail('⑧ محادثة مغلقة', `انتقال = ${JSON.stringify(closedRejected.transition)}`);
  }
  if (closedRejected.assign.ok || closedRejected.assign.code !== 'state_terminal') {
    fail('⑧ محادثة مغلقة', `إسناد = ${JSON.stringify(closedRejected.assign)}`);
  }

  // ── ⭐ ⑨ نجاح الإسناد المسموح (نقر فعلي) ──
  await page.click('#queue-body tr[data-ref="conv_preview_0003"]');
  await page.selectOption('#assign-select', 'actor_preview_0008');
  await page.click('#assign-btn');
  const assignResult = await page.textContent('#result-box');
  if (!assignResult || !assignResult.includes('✅')) {
    fail('⑨ الإسناد', `النتيجة = ${assignResult ?? 'مفقود'}`);
  }
  const assignedDetail = await page.textContent('#detail-panel .meta');
  if (!assignedDetail || !assignedDetail.includes('actor_preview_0008')) {
    fail('⑨ الإسناد', `التفاصيل = ${assignedDetail ?? 'مفقود'}`);
  }

  // ── ⭐ ⑩ نجاح إلغاء الإسناد ──
  await page.click('#unassign-btn');
  const unassignResult = await page.textContent('#result-box');
  if (!unassignResult || !unassignResult.includes('✅')) {
    fail('⑩ إلغاء الإسناد', `النتيجة = ${unassignResult ?? 'مفقود'}`);
  }
  const unassignedDetail = await page.textContent('#detail-panel .meta');
  if (!unassignedDetail || !unassignedDetail.includes('بلا إسناد')) {
    fail('⑩ إلغاء الإسناد', `التفاصيل = ${unassignedDetail ?? 'مفقود'}`);
  }

  // ── ⭐ ⑪ رفض الإسناد لموظف من مستأجر آخر ──
  const foreignAssign = await page.evaluate(() => {
    const runtime = (
      globalThis as unknown as {
        waslPreviewRuntime?: {
          assign(ref: string, actor: string, reason: string): { ok: boolean; code: string };
          getForeignEmployee(): string;
        };
      }
    ).waslPreviewRuntime;
    if (!runtime) return { ok: true, code: 'missing' };
    return runtime.assign('conv_preview_0003', runtime.getForeignEmployee(), 'محاولة');
  });
  if (foreignAssign.ok || foreignAssign.code !== 'assignee_not_in_tenant') {
    fail('⑪ إسناد مستأجر آخر', `النتيجة = ${JSON.stringify(foreignAssign)}`);
  }

  // ── ⭐ ⑫ رفض الإسناد لموظف غير موجود ──
  const unknownAssign = await page.evaluate(() => {
    const runtime = (
      globalThis as unknown as {
        waslPreviewRuntime?: {
          assign(ref: string, actor: string, reason: string): { ok: boolean; code: string };
        };
      }
    ).waslPreviewRuntime;
    if (!runtime) return { ok: true, code: 'missing' };
    return runtime.assign('conv_preview_0003', 'actor_preview_9999', 'محاولة');
  });
  if (unknownAssign.ok) fail('⑫ موظف غير موجود', `النتيجة = ${JSON.stringify(unknownAssign)}`);

  // ── ⭐ ⑬ رفض الكتابة من دور قراءة فقط ──
  for (const role of ['viewer', 'agent']) {
    await page.click(`#preview-root .role-btn[data-role="${role}"]`);
    const readOnlyWrite = await page.evaluate(() => {
      const runtime = (
        globalThis as unknown as {
          waslPreviewRuntime?: {
            applyTransition(ref: string, to: string, reason: string): { ok: boolean; code: string };
            assign(ref: string, actor: string, reason: string): { ok: boolean; code: string };
          };
        }
      ).waslPreviewRuntime;
      if (!runtime) return { transition: { ok: true, code: 'missing' }, assign: { ok: true, code: 'missing' } };
      return {
        transition: runtime.applyTransition('conv_preview_0003', 'resolved', 'محاولة'),
        assign: runtime.assign('conv_preview_0003', 'actor_preview_0007', 'محاولة'),
      };
    });
    if (readOnlyWrite.transition.ok || readOnlyWrite.transition.code !== 'capability_missing') {
      fail('⑬ دور قراءة فقط', `انتقال (${role}) = ${JSON.stringify(readOnlyWrite.transition)}`);
    }
    if (readOnlyWrite.assign.ok || readOnlyWrite.assign.code !== 'capability_missing') {
      fail('⑬ دور قراءة فقط', `إسناد (${role}) = ${JSON.stringify(readOnlyWrite.assign)}`);
    }
  }

  // ── ⭐ ⑰ فقدان التعديلات عند إعادة التحميل ──
  await page.click('#preview-root .role-btn[data-role="supervisor"]');
  const beforeReload = await page.evaluate(() => {
    const runtime = (
      globalThis as unknown as {
        waslPreviewRuntime?: { getChanges(ref: string): unknown[] };
      }
    ).waslPreviewRuntime;
    return runtime?.getChanges('conv_preview_0003').length ?? -1;
  });
  await page.reload({ waitUntil: 'load' });
  const afterReload = await page.evaluate(() => {
    const runtime = (
      globalThis as unknown as {
        waslPreviewRuntime?: { getChanges(ref: string): unknown[] };
      }
    ).waslPreviewRuntime;
    return {
      changes: runtime?.getChanges('conv_preview_0003').length ?? -1,
      rows: document.querySelectorAll('#queue-body tr[data-ref]').length,
    };
  });
  if (afterReload.changes !== seedBaseline) {
    fail(
      '⑰ إعادة التحميل',
      `سجل التغييرات بعد التحميل = ${String(afterReload.changes)} (خط الأساس ${String(seedBaseline)})`,
    );
  }
  if (!(beforeReload > afterReload.changes)) {
    fail(
      '⑰ إعادة التحميل',
      `لم تُفقد التعديلات — قبل=${String(beforeReload)} بعد=${String(afterReload.changes)}`,
    );
  }
  if (afterReload.rows < 5) fail('⑰ إعادة التحميل', `الطابور بعد التحميل = ${String(afterReload.rows)}`);

  // ── ⭐ ⑱ العمل دون اتصال + ⑳ أخطاء بعد كل النقرات ──
  const externalAfter = requests.filter((request) => !request.startsWith('file://'));
  if (externalAfter.length > 0) fail('⑱/⑧ الشبكة', `طلبات خارجية: ${externalAfter.join(' | ')}`);
  if (pageErrors.length > 0) fail('⑳ أخطاء JS', pageErrors.join(' | '));
  if (consoleErrors.length > 0) fail('⑳ console', consoleErrors.join(' | '));

  // ── ⭐ لقطات الدليل ──
  const desktopShot = path.join(SHOT_DIR, 'wasl-workbench-interactive-desktop.png');
  await page.screenshot({ path: desktopShot, fullPage: true });

  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
  });
  const mobilePage = await mobileContext.newPage();
  const mobileErrors: string[] = [];
  mobilePage.on('pageerror', (error) => mobileErrors.push(error.message));
  await mobilePage.goto(url, { waitUntil: 'load' });
  const mobileOverflow = await mobilePage.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  if (mobileOverflow > 2) fail('⑱/⑲ الموبايل', `تجاوز أفقي = ${String(mobileOverflow)}px`);
  if (mobileErrors.length > 0) fail('⑳ أخطاء JS (موبايل)', mobileErrors.join(' | '));
  const mobileShot = path.join(SHOT_DIR, 'wasl-workbench-interactive-mobile.png');
  await mobilePage.screenshot({ path: mobileShot, fullPage: true });
  await mobileContext.close();

  await context.close();
  await browser.close();

  // ── ⭐ التقرير ──
  process.stdout.write('═'.repeat(64) + '\n');
  process.stdout.write('⭐ اختبار المتصفّح الحقيقي — المعاينة التفاعلية (Slice 07 · P0)\n');
  process.stdout.write('═'.repeat(64) + '\n');
  process.stdout.write(`⭐ الملف: docs/wasl-workbench-interactive.html\n`);
  process.stdout.write(`⭐ المتصفّح: ${executablePath}\n`);
  process.stdout.write(`⭐ الدور الافتراضي: ${defaultRole.role} (${defaultRole.label})\n`);
  process.stdout.write(
    `⭐ صفوف الطابور لكل دور: مشرف=${String(queueByRole.supervisor)} · مالك=${String(queueByRole.owner)} · موظف=${String(queueByRole.agent)} · قراءة=${String(queueByRole.viewer)}\n`,
  );
  process.stdout.write(`⭐ أخطاء JS: ${String(pageErrors.length)} · console: ${String(consoleErrors.length)}\n`);
  process.stdout.write(`⭐ طلبات شبكة خارجية: ${String(external.length)}\n`);
  process.stdout.write(`⭐ اتجاه الصفحة: dir=rtl · lang=ar\n`);
  process.stdout.write(`⭐ لقطة كمبيوتر: docs/previews/wasl-workbench-interactive-desktop.png\n`);
  process.stdout.write(`⭐ لقطة موبايل: docs/previews/wasl-workbench-interactive-mobile.png\n`);
  process.stdout.write('═'.repeat(64) + '\n');

  if (failures.length > 0) {
    for (const failure of failures) {
      process.stdout.write(`⛔ ${failure.check} — ${failure.detail}\n`);
    }
    process.stdout.write(`⛔ فشل ${String(failures.length)} فحصاً.\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('✅ كل الفحوص نجحت — ٢٠ بند قبول + الأمان + العزل + الصلاحيات.\n');
  process.exit(0);
}

main().catch((error: unknown) => {
  process.stdout.write(`⛔ تعذّر تشغيل اختبار المتصفّح: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

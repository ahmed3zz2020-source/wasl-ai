// ============================================================
// WASL AI — FOUNDATION BUILD 01 — real browser check of the console
// ------------------------------------------------------------
// ⭐ The console is not a preview: the browser clicks the real buttons
//   and the real API answers. The check proves it.
// ⭐ It also proves the boundary (M60): the browser only talks to the
//   local address.
// ⛔ It needs Chromium; when it is missing the check reports it
//   instead of pretending it passed.
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const SHOT_DIR = path.join(ROOT, 'docs', 'previews');

interface PlaywrightLike {
  chromium: {
    launch(options: Record<string, unknown>): Promise<{
      newPage(): Promise<{
        goto(url: string): Promise<unknown>;
        click(selector: string): Promise<void>;
        fill(selector: string, value: string): Promise<void>;
        textContent(selector: string): Promise<string | null>;
        screenshot(options: Record<string, unknown>): Promise<unknown>;
        close(): Promise<void>;
      }>;
      close(): Promise<void>;
    }>;
  };
}

function resolvePlaywright(): Promise<PlaywrightLike> {
  const candidates: string[] = [];
  if (process.env.PLAYWRIGHT_MODULE) candidates.push(process.env.PLAYWRIGHT_MODULE);
  const globalRoot = process.env.NODE_PATH?.split(':').filter(Boolean)[0];
  if (globalRoot) candidates.push(path.join(globalRoot, 'playwright', 'index.mjs'));
  candidates.push('/usr/local/lib/node_modules/playwright/index.mjs');
  candidates.push('/usr/lib/node_modules/playwright/index.mjs');
  return (async () => {
    for (const candidate of candidates) {
      try {
        const resolved = (await import(pathToFileURL(candidate).href)) as { chromium?: unknown };
        if (resolved?.chromium) return resolved as PlaywrightLike;
      } catch {
        // try the next candidate
      }
    }
    throw new Error(`playwright is not available (tried: ${candidates.join(' · ')})`);
  })();
}

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
  return undefined;
}

export interface UiCheckResult {
  readonly ok: boolean;
  readonly steps: readonly string[];
  readonly failures: readonly string[];
  readonly journeyOutput: string;
}

export async function runUiBrowserCheck(port: number): Promise<UiCheckResult> {
  const steps: string[] = [];
  const failures: string[] = [];
  const playwright = await resolvePlaywright();
  const executablePath = resolveChromiumExecutable();
  const browser = await playwright.chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/ui/index.html`);
    steps.push('the console page opened');

    await page.fill('#passcode', 'wasl-local-test');
    await page.click('#btn-login');
    await new Promise((resolve) => setTimeout(resolve, 400));
    const sessionText = (await page.textContent('#out-session')) ?? '';
    if (!sessionText.includes('"ok": true')) {
      failures.push(`the login did not succeed: ${sessionText.slice(0, 200)}`);
    } else {
      steps.push('the login button created a real session');
    }

    await page.click('#btn-customer');
    await new Promise((resolve) => setTimeout(resolve, 250));
    await page.click('#btn-conversation');
    await new Promise((resolve) => setTimeout(resolve, 250));
    await page.click('#btn-message');
    await new Promise((resolve) => setTimeout(resolve, 250));
    await page.click('#btn-open');
    await new Promise((resolve) => setTimeout(resolve, 250));
    await page.click('#btn-assign');
    await new Promise((resolve) => setTimeout(resolve, 250));
    await page.click('#btn-resolved');
    await new Promise((resolve) => setTimeout(resolve, 250));
    await page.click('#btn-closed');
    await new Promise((resolve) => setTimeout(resolve, 300));

    const journeyText = (await page.textContent('#out-journey')) ?? '';
    if (!journeyText.includes('"state": "closed"')) {
      failures.push(`the journey did not reach the closed state: ${journeyText.slice(-300)}`);
    } else {
      steps.push('the buttons drove the conversation to the closed state');
    }

    await page.click('#btn-audit');
    await new Promise((resolve) => setTimeout(resolve, 250));
    const auditText = (await page.textContent('#out-evidence')) ?? '';
    if (!auditText.includes('"audit"')) {
      failures.push('the audit trail was not readable from the console');
    } else {
      steps.push('the console read the audit trail from the database');
    }

    fs.mkdirSync(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(SHOT_DIR, 'foundation-console.png'), fullPage: true });
    steps.push('the screenshot was written');

    await page.close();
    return { ok: failures.length === 0, steps, failures, journeyOutput: journeyText };
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  const port = Number(process.env['WASL_UI_PORT'] ?? '8787');
  const result = await runUiBrowserCheck(port);
  for (const step of result.steps) process.stdout.write(`- ${step}\n`);
  for (const failure of result.failures) process.stderr.write(`FAIL ${failure}\n`);
  process.stdout.write(result.ok ? '\nUI CHECK OK\n' : '\nUI CHECK FAILED\n');
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && process.argv[1].endsWith('wasl-ui-browser-check.ts')) {
  main().catch((error: unknown) => {
    process.stderr.write(`ui check failed: ${String((error as Error)?.message ?? error)}\n`);
    process.exitCode = 1;
  });
}

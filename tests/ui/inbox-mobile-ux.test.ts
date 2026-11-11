// ============================================================
// WASL AI — the inbox — M-127 (the gaps of the mobile experience)
// ------------------------------------------------------------
// ⭐⭐⭐ WHAT THIS FILE MEASURES
//   ① the BACK BUTTON OF THE BROWSER (not the button of the page)
//      returns to the list — it never leaves the page,
//   ② the answer of an OLD search never lands under the new text —
//      not even inside the waiting window before the new search is
//      sent,
//   ③ the waiting search is CANCELLED when the page changes · when a
//      filter changes · when the session ends,
//   ④ the state of the list is KEPT (the search · the filters · the
//      page · the place of the screen) — after the way back AND after
//      a reload,
//   ⑤ the answer of an OLD session (or of an old company) NEVER
//      paints after the session changed.
// ⭐⭐ THE PROOF IS THE REAL BROWSER (Chromium) and the real server.
// ⛔ LOCAL ONLY: the browser talks to 127.0.0.1.
// ⛔ The drill is SKIPPED when Chromium is not available.
// ============================================================

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { UnitOfWork } from '../../server/db/unit-of-work.ts';
import { startHarness } from '../server/harness.ts';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const SHOT_DIR = path.join(ROOT, 'docs', 'previews');
const PASSCODE = process.env['WASL_TEST_PASSCODE'] ?? 'wasl-local-test';
// ⭐⭐⭐ enough conversations for a SECOND page (the pagination is real).
const CONVERSATIONS = 30;
// ⭐⭐⭐ the size of a page of the list (the page shows this many rows).
const PAGE_SIZE = 25;

interface PlaywrightLike {
  chromium: {
    launch(options: Record<string, unknown>): Promise<{
      newPage(options?: Record<string, unknown>): Promise<PageLike>;
      close(): Promise<void>;
    }>;
  };
}

interface RouteLike {
  abort(): Promise<void>;
  continue(options?: Record<string, unknown>): Promise<void>;
  fulfill(options: Record<string, unknown>): Promise<void>;
}

interface PageLike {
  goto(url: string): Promise<unknown>;
  goBack(): Promise<unknown>;
  reload(): Promise<unknown>;
  url(): string;
  click(selector: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  selectOption(selector: string, value: string): Promise<void>;
  textContent(selector: string): Promise<string | null>;
  inputValue(selector: string): Promise<string>;
  innerText(selector: string): Promise<string>;
  isVisible(selector: string): Promise<boolean>;
  evaluate(script: string, arg?: unknown): Promise<unknown>;
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  screenshot(options: Record<string, unknown>): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  route(pattern: string, handler: (route: RouteLike) => void): Promise<void>;
  unroute(pattern: string): Promise<void>;
  close(): Promise<void>;
}

async function countOf(page: PageLike, selector: string): Promise<number> {
  const value = await page.evaluate(
    `(document.querySelectorAll(${JSON.stringify(selector)}).length)`,
  );
  return Number(value ?? 0);
}

async function resolvePlaywright(): Promise<PlaywrightLike | null> {
  const candidates: string[] = [];
  if (process.env.PLAYWRIGHT_MODULE) candidates.push(process.env.PLAYWRIGHT_MODULE);
  const globalRoot = process.env.NODE_PATH?.split(':').filter(Boolean)[0];
  if (globalRoot) candidates.push(path.join(globalRoot, 'playwright', 'index.mjs'));
  candidates.push('/usr/local/lib/node_modules/playwright/index.mjs');
  candidates.push('/usr/lib/node_modules/playwright/index.mjs');
  for (const candidate of candidates) {
    try {
      const resolved = (await import(pathToFileURL(candidate).href)) as { chromium?: unknown };
      if (resolved?.chromium) return resolved as PlaywrightLike;
    } catch {
      // the next candidate
    }
  }
  return null;
}

function resolveChromiumExecutable(): string | undefined {
  const roots: string[] = [];
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) roots.push(process.env.PLAYWRIGHT_BROWSERS_PATH);
  roots.push(path.join(process.env.HOME ?? '', '.cache', 'ms-playwright'));
  roots.push('/root/.cache/ms-playwright');
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

test('M-127) the mobile experience of the inbox (the real browser)', async (t) => {
  const playwright = await resolvePlaywright();
  if (!playwright) {
    t.skip('playwright is not available in this environment');
    return;
  }
  const harness = await startHarness();
  const browser = await playwright.chromium.launch({
    headless: true,
    ...(resolveChromiumExecutable() ? { executablePath: resolveChromiumExecutable() } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const tenantId = 'tnt_m127_ui';
  const userId = 'usr_m127_ui_owner';
  t.after(async () => {
    await browser.close();
    await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
      await uow.query(`delete from messages where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from conversations where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from customers where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from sessions where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from memberships where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from users where id = $1`, [userId]);
      await uow.query(`delete from tenants where id = $1`, [tenantId]);
    });
    await harness.stop();
  });

  await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
    await uow.query(`delete from messages where tenant_id = $1`, [tenantId]);
    await uow.query(`delete from conversations where tenant_id = $1`, [tenantId]);
    await uow.query(`delete from customers where tenant_id = $1`, [tenantId]);
  });
  const { hashPasscode } = await import('../../server/auth/sessions.ts');
  await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
    await uow.query(
      `insert into tenants (id, name, status) values ($1,$2,'active')
       on conflict (id) do update set name = excluded.name`,
      [tenantId, 'Inbox M127 (synthetic)'],
    );
    await uow.query(
      `insert into users (id, display_name, email, status, passcode_hash)
       values ($1,$2,$3,'active',$4)
       on conflict (id) do update set passcode_hash = excluded.passcode_hash`,
      [userId, 'M127 Owner', `${userId}@example.invalid`, hashPasscode(PASSCODE)],
    );
    await uow.query(
      `insert into memberships (id, tenant_id, user_id, role, status)
       values ($1,$2,$3,'owner','active')
       on conflict (tenant_id, user_id) do update set status = 'active'`,
      [`mem_${userId}`, tenantId, userId],
    );
    // ⭐⭐⭐ THIRTY conversations (⇒ ⇒ ⇒ a real second page) and two of
    // ⭐⭐⭐ them carry names we can read on the screen.
    for (let index = 1; index <= CONVERSATIONS; index += 1) {
      const name = index === 1 ? 'عميل ألف' : index === 2 ? 'عميل باء' : `عميل رقم ${index}`;
      const customerId = `cus_m127_${index}`;
      const ref = `conv_m127_${index}`;
      await uow.query(
        `insert into customers (id, tenant_id, display_name, data_class)
         values ($1,$2,$3,'standard')
         on conflict (id) do update set display_name = excluded.display_name`,
        [customerId, tenantId, name],
      );
      await uow.query(
        `insert into conversations (tenant_id, ref, customer_id, state, version, updated_at)
         values ($1,$2,$3,'open',1, now())
         on conflict (tenant_id, ref) do update set state = 'open'`,
        [tenantId, ref, customerId],
      );
      await uow.query(
        `insert into messages (message_ref, tenant_id, conversation_ref, channel, direction, sender,
                               recipient, body, occurred_at, locale, attributes, stored_at)
         values ($1,$2,$3,'web','inbound','customer@example.invalid','agent@example.invalid',$4, now(),'ar','{}'::jsonb, now())
         on conflict (tenant_id, message_ref) do nothing`,
        [`msg_m127_seed_${index}`, tenantId, ref, `رسالة العميل رقم ${index}`],
      );
    }
  });

  const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
  const url = `http://127.0.0.1:${harness.port}/ui/inbox.html`;

  /** ⭐⭐⭐ the login of the company of the drill. */
  async function login(): Promise<void> {
    await page.goto(url);
    await page.waitForTimeout(600);
    // ⭐⭐⭐ every drill starts with a CLEAN state of the list ⇒ ⇒ ⇒
    // ⭐⭐⭐ (the state of the previous drill never leaks into this one
    // ⭐⭐⭐ ⇒ ⇒ ⇒ and the reset is CHECKED ⇒ ⇒ ⇒ not assumed).
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.evaluate(
        `(() => { try { sessionStorage.removeItem('wasl_inbox_list_view_v1'); } catch {} })()`,
      );
      await page.reload();
      await page.waitForTimeout(1200);
      const query = await page.inputValue('#filter-query');
      const filter = await page.inputValue('#filter-state');
      if (query === '' && filter === '') break;
    }
    // ⭐⭐⭐ the session of the tab may already be there (the storage).
    if (await page.isVisible('#workspace')) return;
    await page.evaluate(
      ([tenant, user]) => {
        const tenantSelect = document.getElementById('login-tenant');
        if (!tenantSelect.querySelector(`option[value="${tenant}"]`)) {
          const tenantOption = document.createElement('option');
          tenantOption.value = tenant;
          tenantOption.textContent = 'شركة M127';
          tenantSelect.appendChild(tenantOption);
        }
        const userSelect = document.getElementById('login-user');
        if (!userSelect.querySelector(`option[value="${user}"]`)) {
          const userOption = document.createElement('option');
          userOption.value = user;
          userOption.textContent = 'موظف M127';
          userSelect.appendChild(userOption);
        }
      },
      [tenantId, userId],
    );
    await page.selectOption('#login-tenant', tenantId);
    await page.selectOption('#login-user', userId);
    await page.fill('#login-passcode', PASSCODE);
    await page.click('#btn-login');
    await page.waitForTimeout(900);
  }

  /** ⭐⭐⭐ open the conversation that carries this name. */
  async function openByName(name: string): Promise<void> {
    await page.evaluate(
      ([wanted]) => {
        const items = Array.from(document.querySelectorAll('#conversation-list .conversation'));
        const found = items.find((item) => item.textContent.includes(String(wanted)));
        if (found) found.click();
      },
      [name],
    );
    await page.waitForTimeout(900);
  }

  await t.test('M-127-0: the login of the company of the drill', async () => {
    await login();
    assert.equal(await page.isVisible('#workspace'), true, 'the workspace did not appear');
    const rows = await countOf(page, '#conversation-list .conversation');
    assert.equal(rows, PAGE_SIZE, `the list holds ${rows} rows instead of ${PAGE_SIZE}`);
    const counter = await page.innerText('#list-counter');
    assert.match(counter, /30/, `the counter does not carry the total: ${counter}`);
  });

  await t.test('⭐⭐⭐ M-127-1: the BACK BUTTON OF THE BROWSER returns to the list (it never leaves the page)', async () => {
    await login();
    await openByName('عميل ألف');
    assert.equal(await page.isVisible('#thread'), true, 'the conversation did not open');
    const address = page.url();
    assert.match(
      address,
      /conversation=/,
      `⭐⭐⭐ the address of the page does not carry the conversation: ${address}`,
    );
    // ⭐⭐⭐ THE BROWSER'S BACK BUTTON (not the button of the page).
    await page.goBack();
    await page.waitForTimeout(900);
    const after = page.url();
    assert.match(
      after,
      /inbox\.html/,
      `⭐⭐⭐ the back button of the browser LEFT the page: ${after}`,
    );
    assert.equal(
      await page.isVisible('.pane.list'),
      true,
      '⭐⭐⭐ the list did not come back after the back button of the browser',
    );
    assert.equal(
      await page.isVisible('#thread'),
      false,
      '⭐⭐⭐ the conversation is still open after the back button of the browser',
    );
  });

  await t.test('⭐⭐⭐ M-127-2: the answer of the OLD search never lands under the new text', async () => {
    await login();
    // ⭐⭐⭐ the answers of the list are HELD ⇒ ⇒ ⇒ the test decides
    // ⭐⭐⭐ WHEN each one is let go ⇒ ⇒ ⇒ (no race of the clock).
    const releases: Array<() => void> = [];
    await page.route('**/api/inbox/conversations?*', async (route) => {
      await new Promise<void>((resolve) => {
        releases.push(resolve);
      });
      await route.continue();
    });
    // ⭐⭐⭐ the FIRST search is held.
    await page.fill('#filter-query', 'ألف');
    await page.waitForTimeout(600);
    assert.ok(releases.length >= 1, '⭐⭐⭐ the first search was not held');
    // ⭐⭐⭐ the NEW search is typed (its timer is waiting) ⇒ ⇒ ⇒ and
    // ⭐⭐⭐ the answer of the OLD one is let go INSIDE that window.
    await page.fill('#filter-query', 'باء');
    await page.waitForTimeout(40);
    releases[0]!();
    await page.waitForTimeout(200);
    const rows = await countOf(page, '#conversation-list .conversation');
    assert.equal(
      rows,
      PAGE_SIZE,
      `⭐⭐⭐ the answer of the OLD search narrowed the list to ${rows} row(s) under the new text`,
    );
    // ⭐⭐⭐ now the new search is let go ⇒ ⇒ ⇒ it paints ITS answer.
    for (let attempt = 0; attempt < 40 && releases.length < 2; attempt += 1) {
      await page.waitForTimeout(50);
    }
    assert.ok(releases.length >= 2, '⭐⭐⭐ the new search was not sent');
    releases[1]!();
    await page.waitForTimeout(900);
    const after = await countOf(page, '#conversation-list .conversation');
    assert.equal(after, 1, `⭐⭐⭐ the new search did not paint its own answer (${after} rows)`);
    await page.unroute('**/api/inbox/conversations?*');
  });

  await t.test('⭐⭐⭐ M-127-3: the waiting search is cancelled (the page · the filter · the logout)', async () => {
    await login();
    let requests = 0;
    await page.route('**/api/inbox/conversations?*', async (route) => {
      requests += 1;
      await route.continue();
    });
    // ⭐⭐⭐ ① the PAGE changes while the search is waiting.
    await page.fill('#filter-query', 'ألف');
    await page.waitForTimeout(40);
    await page.click('#btn-next');
    await page.waitForTimeout(900);
    assert.equal(
      requests,
      1,
      `⭐⭐⭐ the waiting search was sent after the page changed (${requests} requests)`,
    );
    const label = await page.innerText('#page-label');
    assert.match(label, /صفحة 2/, `⭐⭐⭐ the page was taken back to the first one: ${label}`);
    // ⭐⭐⭐ ② the FILTER changes while the search is waiting.
    requests = 0;
    await page.fill('#filter-query', 'ألف');
    await page.waitForTimeout(40);
    await page.selectOption('#filter-state', 'open');
    await page.waitForTimeout(900);
    assert.equal(
      requests,
      1,
      `⭐⭐⭐ the waiting search was sent after the filter changed (${requests} requests)`,
    );
    // ⭐⭐⭐ ③ the SESSION ends while the search is waiting.
    requests = 0;
    await page.fill('#filter-query', 'ألف');
    await page.waitForTimeout(40);
    await page.click('#btn-logout');
    await page.waitForTimeout(900);
    assert.equal(
      requests,
      0,
      `⭐⭐⭐ the waiting search was sent after the logout (${requests} requests)`,
    );
    await page.unroute('**/api/inbox/conversations?*');
  });

  await t.test('⭐⭐⭐ M-127-4: the state of the list is KEPT (the search · the filters · the page)', async () => {
    await login();
    // ⭐⭐⭐ ① the PAGE of the list ⇒ ⇒ ⇒ and it survives a RELOAD.
    await page.click('#btn-next');
    await page.waitForTimeout(800);
    const label = await page.innerText('#page-label');
    assert.match(label, /صفحة 2/, `⭐⭐⭐ the page did not move: ${label}`);
    await page.reload();
    await page.waitForTimeout(1400);
    const labelAfter = await page.innerText('#page-label');
    assert.match(
      labelAfter,
      /صفحة 2/,
      `⭐⭐⭐ the page of the list was lost after the reload: ${labelAfter}`,
    );
    // ⭐⭐⭐ ② the SEARCH and the FILTERS ⇒ ⇒ ⇒ and they survive BOTH
    // ⭐⭐⭐ the way back of the conversation AND the reload.
    await page.fill('#filter-query', 'ألف');
    await page.waitForTimeout(800);
    await page.selectOption('#filter-state', 'open');
    await page.waitForTimeout(800);
    await openByName('عميل ألف');
    await page.click('#btn-back');
    await page.waitForTimeout(900);
    assert.equal(
      await page.inputValue('#filter-query'),
      'ألف',
      '⭐⭐⭐ the search was lost after the way back',
    );
    assert.equal(
      await page.inputValue('#filter-state'),
      'open',
      '⭐⭐⭐ the filter was lost after the way back',
    );
    await page.reload();
    await page.waitForTimeout(1400);
    assert.equal(
      await page.inputValue('#filter-query'),
      'ألف',
      '⭐⭐⭐ the search was lost after the reload',
    );
    assert.equal(
      await page.inputValue('#filter-state'),
      'open',
      '⭐⭐⭐ the filter was lost after the reload',
    );
  });

  await t.test('⭐⭐⭐ M-127-5: the answer of an OLD session never paints after the session changed', async () => {
    await login();
    await openByName('عميل ألف');
    // ⭐⭐⭐ the change of the state is HELD ⇒ ⇒ ⇒ the session can end
    // ⭐⭐⭐ while it is in the air.
    const releases: Array<() => void> = [];
    await page.route('**/api/inbox/conversations/*/state', async (route) => {
      await new Promise<void>((resolve) => {
        releases.push(resolve);
      });
      await route.continue();
    });
    await page.selectOption('#state-select', 'assigned');
    await page.waitForTimeout(400);
    assert.ok(releases.length >= 1, '⭐⭐⭐ the change of the state was not held');
    // ⭐⭐⭐ the session ends NOW ⇒ ⇒ ⇒ and the answer is let go after.
    await page.click('#btn-logout');
    await page.waitForTimeout(500);
    releases[0]!();
    await page.waitForTimeout(1200);
    await page.unroute('**/api/inbox/conversations/*/state');
    // ⭐⭐⭐ the STATE of the screen is read (not its visibility ⇒ ⇒ ⇒ the
    // ⭐⭐⭐ workspace is hidden after the logout ⇒ ⇒ ⇒ and the state of
    // ⭐⭐⭐ the conversation is what tells the two apart).
    const screen = await page.evaluate(`(() => ({
      thread: document.getElementById('thread').hidden,
      placeholder: document.getElementById('thread-placeholder').hidden,
      customer: document.getElementById('thread-customer').textContent,
    }))()`);
    const state = screen as { thread: boolean; placeholder: boolean; customer: string };
    assert.equal(
      state.thread,
      true,
      `⭐⭐⭐ the answer of the old session REOPENED the conversation of the old company (${JSON.stringify(state)})`,
    );
    assert.equal(
      state.placeholder,
      false,
      `⭐⭐⭐ the conversation of the old session is still on the screen (${JSON.stringify(state)})`,
    );
    assert.equal(
      await page.isVisible('#login-row'),
      true,
      '⭐⭐⭐ the page of the login is not on the screen after the session ended',
    );
  });

  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(SHOT_DIR, 'm127-inbox-mobile-ux.png'),
    fullPage: false,
  });
});

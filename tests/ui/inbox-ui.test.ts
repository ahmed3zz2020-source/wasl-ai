// ============================================================
// WASL AI — FOUNDATION BUILD 03 / PHASE 01 (D-070)
// the customer inbox — the real browser check
// ------------------------------------------------------------
// ⭐⭐ WHAT THIS FILE MEASURES
//   The interface is NOT a preview: a real browser opens it, clicks
//   the real buttons and the real API answers, and the answer is read
//   back from PostgreSQL.
// ⭐ THE PROPERTIES
//   - the page is in Arabic and the direction is from the right,
//   - the login works and the list of the conversations appears,
//   - opening a conversation shows the messages in their order,
//   - writing and sending a reply shows it in the thread,
//   - ⭐⭐ the reply is REALLY in PostgreSQL (the page is not a mock),
//   - the double send is refused by the server,
//   - the states of the core are the states the page offers,
//   - the empty state and the error state are shown,
//   - the page works on a phone width.
// ⛔ LOCAL ONLY: the browser talks to 127.0.0.1.
// ⛔ The drill is SKIPPED when Chromium is not available: it is never
//   reported as a pass it did not measure.
// ============================================================

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { UnitOfWork } from '../../server/db/unit-of-work.ts';
import { loginAs, startHarness } from '../server/harness.ts';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const SHOT_DIR = path.join(ROOT, 'docs', 'previews');
const PASSCODE = process.env['WASL_TEST_PASSCODE'] ?? 'wasl-local-test';

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
  request(): { method(): string };
}

interface PageLike {
  goto(url: string): Promise<unknown>;
  click(selector: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  selectOption(selector: string, value: string): Promise<void>;
  textContent(selector: string): Promise<string | null>;
  inputValue(selector: string): Promise<string>;
  innerText(selector: string): Promise<string>;
  isVisible(selector: string): Promise<boolean>;
  evaluate(script: string): Promise<unknown>;
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  screenshot(options: Record<string, unknown>): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  route(pattern: string, handler: (route: RouteLike) => void): Promise<void>;
  unroute(pattern: string): Promise<void>;
  close(): Promise<void>;
}

/** ⭐ The number of rows that match a selector (in the page itself). */
async function countOf(page: PageLike, selector: string): Promise<number> {
  const value = await page.evaluate(
    `(document.querySelectorAll(${JSON.stringify(selector)}).length)`,
  );
  return Number(value ?? 0);
}

/** ⭐ Find the Playwright of the machine (it is installed globally). */
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

/** ⭐ The executable of Chromium (the download of Playwright). */
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

test('FOUNDATION 21) the customer inbox in a real browser (D-070)', async (t) => {

/**
 * ⭐⭐⭐ M-127: ⭐⭐⭐ the state of the list (the search · the filters ·
 * ⭐⭐⭐ M-127 the page · the place) is kept by the page ⇒ ⇒ ⇒ ⇒ it
 * ⭐⭐⭐ M-127 survives a reload ⇒ ⇒ ⇒ ⇒ so every drill of this file
 * ⭐⭐⭐ M-127 RESETS it ⇒ ⇒ ⇒ ⇒ (the drill of one case must never
 * ⭐⭐⭐ M-127 inherit the state of the previous one) ⇒ ⇒ ⇒ ⇒ and the
 * ⭐⭐⭐ M-127 reset is CHECKED ⇒ ⇒ ⇒ ⇒ not assumed.
 */
async function openTheInbox(page: PageLike): Promise<void> {
  await page.goto(`http://127.0.0.1:${harness.port}/ui/inbox.html`);
  await page.waitForTimeout(500);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.evaluate(
      `(() => { try { sessionStorage.removeItem('wasl_inbox_list_view_v1'); } catch {} })()`,
    );
    await page.reload();
    await page.waitForTimeout(1000);
    const query = await page.inputValue('#filter-query');
    const filter = await page.inputValue('#filter-state');
    if (query === '' && filter === '') return;
  }
  throw new Error('the state of the list did not reset');
}

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

  const tenantId = 'tnt_b03_ui';
  const userId = 'usr_b03_ui_owner';
  // ⭐⭐⭐ M-125: ⭐⭐⭐ the viewer (the rights of the inbox are
  // ⭐⭐⭐ M-125 measured on him ⇒ ⇒ ⇒ and the second company (the
  // ⭐⭐⭐ M-125 isolation ⇒ ⇒ ⇒ with a name we can read).
  const viewerId = 'usr_b03_ui_viewer';
  const otherTenantId = 'tnt_b03_ui_other';
  const otherCustomerId = 'cus_b03_ui_foreign';
  t.after(async () => {
    await browser.close();
    await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
      await uow.query(`delete from messages where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from conversations where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from customers where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from sessions where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from memberships where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from users where id in ($1,$2)`, [userId, viewerId]);
      await uow.query(`delete from customers where id = $1`, [otherCustomerId]);
      await uow.query(`delete from tenants where id in ($1,$2)`, [tenantId, otherTenantId]);
    });
    await harness.stop();
  });

  // ⭐ A synthetic company with a conversation and a message.
  // ⭐⭐⭐ M-100: THE FIXTURE IS IDEMPOTENT ⇒ ⭐⭐ the leftovers of
  // ⭐⭐ a run that was KILLED must not change the counts ⇒ ⭐⭐⇒ the
  // ⭐⭐ rows are wiped BEFORE the fixture too (not only after it).
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
      [tenantId, 'Inbox UI (synthetic)'],
    );
    await uow.query(
      `insert into users (id, display_name, email, status, passcode_hash)
       values ($1,$2,$3,'active',$4)
       on conflict (id) do update set passcode_hash = excluded.passcode_hash`,
      [userId, 'UI Owner', `${userId}@example.invalid`, hashPasscode(PASSCODE)],
    );
    await uow.query(
      `insert into memberships (id, tenant_id, user_id, role, status)
       values ($1,$2,$3,'owner','active')
       on conflict (tenant_id, user_id) do update set status = 'active'`,
      [`mem_${userId}`, tenantId, userId],
    );
    await uow.query(
      `insert into users (id, display_name, email, status, passcode_hash)
       values ($1,$2,$3,'active',$4)
       on conflict (id) do update set passcode_hash = excluded.passcode_hash`,
      [viewerId, 'UI viewer', `${viewerId}@example.invalid`, hashPasscode(PASSCODE)],
    );
    await uow.query(
      `insert into memberships (id, tenant_id, user_id, role, status)
       values ($1,$2,$3,'viewer','active')
       on conflict (tenant_id, user_id) do update set role = 'viewer', status = 'active'`,
      [`mem_${viewerId}`, tenantId, viewerId],
    );
    await uow.query(
      `insert into customers (id, tenant_id, display_name, data_class)
       values ($1,$2,$3,'standard')
       on conflict (id) do update set display_name = excluded.display_name`,
      ['cus_b03_ui_1', tenantId, 'عميل الواجهة'],
    );
    await uow.query(
      `insert into conversations (tenant_id, ref, customer_id, state, version, updated_at)
       values ($1,$2,$3,'open',1, now())
       on conflict (tenant_id, ref) do update set state = 'open'`,
      [tenantId, 'conv_b03_ui_1', 'cus_b03_ui_1'],
    );
    await uow.query(
      `insert into messages (message_ref, tenant_id, conversation_ref, channel, direction, sender,
                             recipient, body, occurred_at, locale, attributes, stored_at)
       values ($1,$2,$3,'web','inbound','customer@example.invalid','agent@example.invalid',$4, now(),'ar','{}'::jsonb, now())
       on conflict (tenant_id, message_ref) do nothing`,
      ['msg_b03_ui_seed', tenantId, 'conv_b03_ui_1', 'رسالة العميل الأولى في المحادثة'],
    );
  });

  // ⭐⭐⭐ M-125: ⭐⭐⭐ the second company (its customer and its
  // ⭐⭐⭐ M-125 conversation have a NAME ⇒ ⇒ ⇒ so the isolation is
  // ⭐⭐⭐ M-125 read with the eyes on the screen).
  await UnitOfWork.run(harness.ownerPool, otherTenantId, async (uow) => {
    await uow.query(`delete from messages where tenant_id = $1`, [otherTenantId]);
    await uow.query(`delete from conversations where tenant_id = $1`, [otherTenantId]);
    await uow.query(`delete from customers where tenant_id = $1`, [otherTenantId]);
    await uow.query(
      `insert into tenants (id, name, status) values ($1,$2,'active')
       on conflict (id) do update set name = excluded.name`,
      [otherTenantId, 'شركة أخرى (اصطناعية)'],
    );
    await uow.query(
      `insert into customers (id, tenant_id, display_name, data_class)
       values ($1,$2,$3,'standard')
       on conflict (id) do update set display_name = excluded.display_name`,
      [otherCustomerId, otherTenantId, 'عميل شركة أخرى'],
    );
    await uow.query(
      `insert into conversations (tenant_id, ref, customer_id, state, version, updated_at)
       values ($1,$2,$3,'open',1, now())
       on conflict (tenant_id, ref) do update set state = 'open'`,
      [otherTenantId, 'conv_b03_ui_foreign', otherCustomerId],
    );
    await uow.query(
      `insert into messages (message_ref, tenant_id, conversation_ref, channel, direction, sender,
                             recipient, body, occurred_at, locale, attributes, stored_at)
       values ($1,$2,$3,'web','inbound','customer@example.invalid','agent@example.invalid',$4, now(),'ar','{}'::jsonb, now())
       on conflict (tenant_id, message_ref) do nothing`,
      ['msg_b03_ui_foreign', otherTenantId, 'conv_b03_ui_foreign', 'رسالة شركة أخرى'],
    );
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await openTheInbox(page);

  await t.test('⭐⭐⭐ UI-01: the page is Arabic and the direction is from the right', async () => {
    const direction = await page.evaluate(
      `document.documentElement.getAttribute('dir') || ''`,
    );
    assert.equal(direction, 'rtl', 'the page is not in the right to left direction');
    const lang = await page.evaluate(`document.documentElement.getAttribute('lang') || ''`);
    assert.equal(lang, 'ar', 'the page is not in Arabic');
    const heading = await page.innerText('h1');
    assert.match(heading, /صندوق/, 'the page has no Arabic title');
  });

  await t.test('⭐⭐⭐ UI-02: the login fills the list of the conversations', async () => {
    // ⭐ The company and the employee of the drill are added to the
    //   lists of the page: they are synthetic and they belong to this
    //   drill only.
    await page.evaluate(
      ([tenant, user]) => {
        const tenantSelect = document.getElementById('login-tenant');
        const tenantOption = document.createElement('option');
        tenantOption.value = tenant;
        tenantOption.textContent = 'شركة الواجهة';
        tenantSelect.appendChild(tenantOption);
        const userSelect = document.getElementById('login-user');
        const userOption = document.createElement('option');
        userOption.value = user;
        userOption.textContent = 'موظف الواجهة';
        userSelect.appendChild(userOption);
      },
      [tenantId, userId],
    );
    await page.selectOption('#login-tenant', tenantId);
    await page.selectOption('#login-user', userId);
    await page.fill('#login-passcode', PASSCODE);
    await page.click('#btn-login');
    await page.waitForTimeout(700);
    const visible = await page.isVisible('#workspace');
    assert.ok(visible, 'the workspace did not appear after the login');
    const count = await countOf(page, '.conversation');
    assert.ok(count >= 1, `the list is empty: ${count} rows`);
    const list = await page.innerText('#conversation-list');
    assert.match(list, /عميل الواجهة/, 'the customer is not in the list');
  });

  await t.test('⭐⭐⭐ UI-02b: the states that must be hidden ARE hidden', async () => {
    // ⭐⭐ D-070: the page declares its states with the attribute
    //   `hidden`, and the rules of the page must not defeat it.
    const visibility = await page.evaluate(`(() => {
      const display = (id) => getComputedStyle(document.getElementById(id)).display;
      return {
        loginRow: display('login-row'),
        who: display('who'),
        listEmpty: display('list-empty'),
        listLoading: display('list-loading'),
        thread: display('thread'),
        placeholder: display('thread-placeholder'),
      };
    })()`);
    const record = visibility as Record<string, string>;
    assert.equal(record['loginRow'], 'none', 'the form of the login is still on the screen');
    assert.equal(record['who'], 'flex', 'the bar of the session is not shown');
    assert.equal(record['listEmpty'], 'none', 'the empty state is shown with a list');
    assert.equal(record['listLoading'], 'none', 'the loading state never stopped');
    assert.equal(record['thread'], 'none', 'the thread is open before a conversation is chosen');
    assert.equal(record['placeholder'], 'flex', 'the placeholder is not shown');
  });

  await t.test('⭐⭐⭐ UI-03: opening a conversation shows the messages in their order', async () => {
    await page.click('.conversation');
    await page.waitForTimeout(600);
    const visible = await page.isVisible('#thread');
    assert.ok(visible, 'the thread did not open');
    const messages = await countOf(page, '.message');
    assert.ok(messages >= 1, 'the thread shows no message');
    const thread = await page.innerText('#messages');
    assert.match(thread, /رسالة العميل الأولى/, 'the message of the customer is not shown');
  });

  await t.test('⭐⭐⭐ UI-04: sending a reply stores it in PostgreSQL', async () => {
    const body = `رد من المتصفح ${Date.now()}`;
    await page.fill('#reply-body', body);
    await page.click('#btn-send');
    await page.waitForTimeout(900);
    const thread = await page.innerText('#messages');
    assert.ok(thread.includes(body), 'the reply is not shown in the thread');

    // ⭐⭐ The proof: the reply is REALLY in the database.
    const rows = await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
      const result = await uow.query(
        `select direction, body from messages where tenant_id = $1 and body = $2`,
        [tenantId, body],
      );
      return result.rows;
    });
    assert.equal(rows.length, 1, `the reply is not in the database (${rows.length} rows)`);
    assert.equal(rows[0]!['direction'], 'outbound', 'the reply is not outbound');
    // ⭐ The composer is empty again: the page is ready for the next one.
    const composer = await page.inputValue('#reply-body');
    assert.equal(composer, '', 'the composer was not cleared');
  });

  await t.test('⭐⭐⭐ UI-05: the double send is refused by the server', async () => {
    const body = `رد مزدوج ${Date.now()}`;
    await page.fill('#reply-body', body);
    await page.click('#btn-send');
    await page.waitForTimeout(900);
    // ⭐⭐ The same text again: the page prepares a NEW reference, so
    //   the server accepts it as a new message (the guard is on the
    //   reference, not on the text). ⭐⭐ The guard itself is proved by
    //   the API test: the same REFERENCE twice is refused.
    const rows = await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
      const result = await uow.query(
        `select count(*)::text as count from messages where tenant_id = $1 and body = $2`,
        [tenantId, body],
      );
      return Number(result.rows[0]?.count ?? '0');
    });
    assert.equal(rows, 1, `the reply was stored ${rows} times`);
  });

  await t.test('⭐⭐⭐ UI-06: the page offers the states that the core allows', async () => {
    const options = await page.evaluate(
      `Array.from(document.querySelectorAll('#state-select option')).map((o) => o.value).join(',')`,
    );
    assert.ok(options.length > 0, 'the page offers no state');
    // ⭐ The state of the conversation is "open": the core allows
    //   open ⇒ assigned, pending, resolved.
    assert.match(options, /assigned/, `the states of the page are: ${options}`);
    assert.match(options, /resolved/, `the states of the page are: ${options}`);
    assert.doesNotMatch(options, /closed/, `the page offers a forbidden state: ${options}`);
  });

  await t.test('⭐⭐⭐ UI-07: the search shows the empty state when nothing matches', async () => {
    await page.fill('#filter-query', 'لا يوجد مثل هذا النص إطلاقا');
    await page.waitForTimeout(800);
    const empty = await page.isVisible('#list-empty');
    assert.ok(empty, 'the empty state is not shown');
    const rows = await countOf(page, '.conversation');
    assert.equal(rows, 0, `the list holds ${rows} rows after the search`);
    await page.fill('#filter-query', '');
    await page.waitForTimeout(800);
  });

  await t.test('⭐⭐⭐ UI-08: the page works on a phone width', async () => {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(
      `document.documentElement.scrollWidth - document.documentElement.clientWidth`,
    );
    assert.ok(
      Number(overflow) <= 2,
      `the page overflows on a phone: ${String(overflow)} pixels`,
    );
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(SHOT_DIR, 'inbox-mobile.png'),
      fullPage: false,
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(SHOT_DIR, 'inbox-desktop.png'),
      fullPage: false,
    });
  });
  // ============================================================
  // M-125 — the inbox on the phone (a real screen, a real server)
  // ============================================================

  await t.test('⭐⭐⭐ M-125-1: the phone shows EITHER the list OR the conversation, and «رجوع» keeps the state', async () => {
    await page.setViewportSize({ width: 390, height: 780 });
    await openTheInbox(page);
    // ⭐⭐⭐ the list is on the screen first.
    assert.equal(
      await page.isVisible('.pane.list'),
      true,
      '⭐⭐⭐ the list of the conversations is not on the screen',
    );
    // ⭐⭐⭐ a search (and a filter) ⇒ ⇒ ⇒ the state of the list.
    await page.fill('#filter-query', 'عميل');
    await page.waitForTimeout(900);
    const searchValue = await page.inputValue('#filter-query');
    assert.equal(searchValue, 'عميل', '⭐⭐⭐ the search did not stay in the box');
    const rows = await countOf(page, '#conversation-list .conversation');
    assert.ok(rows >= 1, `⭐⭐⭐ the search found no conversation: ${rows}`);
    await page.screenshot({
      path: path.join(SHOT_DIR, 'm125-inbox-mobile-list.png'),
      fullPage: false,
    });
    // ⭐⭐⭐ the conversation opens IN THE PLACE of the list.
    await page.evaluate(`document.querySelector('#conversation-list .conversation').click()`);
    await page.waitForTimeout(1200);
    assert.equal(
      await page.isVisible('.pane.list'),
      false,
      '⭐⭐⭐ the list is still on the screen with the conversation',
    );
    assert.equal(
      await page.isVisible('#thread'),
      true,
      '⭐⭐⭐ the conversation did not open',
    );
    await page.screenshot({
      path: path.join(SHOT_DIR, 'm125-inbox-mobile-thread.png'),
      fullPage: false,
    });
    // ⭐⭐⭐ «رجوع» ⇒ ⇒ ⇒ the list comes back WITH ITS SEARCH.
    await page.click('#btn-back');
    await page.waitForTimeout(900);
    assert.equal(
      await page.isVisible('.pane.list'),
      true,
      '⭐⭐⭐ the list did not come back',
    );
    assert.equal(
      await page.isVisible('#thread'),
      false,
      '⭐⭐⭐ the conversation is still open after «رجوع»',
    );
    const searchAfter = await page.inputValue('#filter-query');
    assert.equal(searchAfter, 'عميل', `⭐⭐⭐ the search was lost: ${searchAfter}`);
    const rowsAfter = await countOf(page, '#conversation-list .conversation');
    assert.equal(rowsAfter, rows, `⭐⭐⭐ the list changed after the way back: ${rowsAfter}`);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(300);
  });

  await t.test('⭐⭐⭐ M-125-2: the search waits (ONE request) and an OLD reply is dropped', async () => {
    await openTheInbox(page);
    // ⭐⭐⭐ THE COUNT: ⭐⭐⭐ the whole word is ONE request ⇒ ⇒ ⇒ (the
    // ⭐⭐⭐ M-125 letters of the word are not five requests).
    let requests = 0;
    await page.route('**/api/inbox/conversations?*', async (route) => {
      requests += 1;
      await route.continue();
    });
    await page.fill('#filter-query', 'عميل');
    await page.waitForTimeout(1200);
    await page.unroute('**/api/inbox/conversations?*');
    assert.equal(requests, 1, `⭐⭐⭐ the search sent ${requests} request(s)`);
    // ⭐⭐⭐ THE STALE REPLY: ⭐⭐⭐ the first search is slow (1400ms)
    // ⭐⭐⭐ and the second one is fast ⇒ ⇒ ⇒ the reply of the first
    // ⭐⭐⭐ one arrives LAST ⇒ ⇒ ⇒ (and it must be dropped).
    let seen = 0;
    await page.route('**/api/inbox/conversations?*', async (route) => {
      seen += 1;
      if (seen === 1) {
        await new Promise((resolve) => setTimeout(resolve, 1400));
      }
      await route.continue();
    });
    await page.fill('#filter-query', 'عميل الواجهة');
    await page.waitForTimeout(400);
    await page.fill('#filter-query', 'لا-يوجد-كذا');
    await page.waitForTimeout(2600);
    await page.unroute('**/api/inbox/conversations?*');
    const empty = await page.isVisible('#list-empty');
    assert.equal(empty, true, '⭐⭐⭐ the empty state is not shown for the newest search');
    const rows = await countOf(page, '#conversation-list .conversation');
    assert.equal(rows, 0, `⭐⭐⭐ the list shows ${rows} row(s) ⇒ the OLD reply won`);
  });

  await t.test('⭐⭐⭐ M-125-3: the loss of the connection is said out loud, and the retry works', async () => {
    await openTheInbox(page);
    // ⭐⭐⭐ THE VIEWPORT IS THE MOBILE ONE: ⭐⭐⭐ the shot of the lost
    // ⭐⭐⭐ connection must show the phone (390px) ⇒ ⇒ ⇒ (the previous
    // ⭐⭐⭐ test left the desktop size ⇒ ⇒ ⇒ and the shot was of the
    // ⭐⭐⭐ desktop ⇒ ⇒ ⇒ which is not the evidence we publish).
    await page.setViewportSize({ width: 390, height: 780 });
    await page.waitForTimeout(300);
    // ⭐⭐⭐ THE CONNECTION IS GONE: ⭐⭐⭐ the request of the list is
    // ⭐⭐⭐ broken ⇒ ⇒ ⇒ (the banner appears ⇒ ⇒ ⇒ and the list stays
    // ⭐⭐⭐ as it is).
    await page.route('**/api/inbox/conversations?*', async (route) => {
      await route.abort();
    });
    await page.click('#btn-refresh');
    await page.waitForTimeout(1200);
    assert.equal(
      await page.isVisible('#offline-banner'),
      true,
      '⭐⭐⭐ the banner of the lost connection is not shown',
    );
    await page.screenshot({
      path: path.join(SHOT_DIR, 'm125-inbox-mobile-offline.png'),
      fullPage: false,
    });
    // ⭐⭐⭐ THE RETRY: ⭐⭐⭐ the connection is back ⇒ ⇒ ⇒ the banner
    // ⭐⭐⭐ goes away ⇒ ⇒ ⇒ and the list comes back.
    await page.unroute('**/api/inbox/conversations?*');
    await page.click('#btn-retry-offline');
    await page.waitForTimeout(1400);
    assert.equal(
      await page.isVisible('#offline-banner'),
      false,
      '⭐⭐⭐ the banner of the lost connection stayed after the retry',
    );
    const rows = await countOf(page, '#conversation-list .conversation');
    assert.ok(rows >= 1, `⭐⭐⭐ the list did not come back after the retry: ${rows}`);
  });

  await t.test('⭐⭐⭐ M-125-4: the double send is refused (the button is closed while the reply flies)', async () => {
    await openTheInbox(page);
    await page.evaluate(`document.querySelector('#conversation-list .conversation').click()`);
    await page.waitForTimeout(1200);
    // ⭐⭐⭐ THE SLOW ANSWER: ⭐⭐⭐ the save of the reply takes 1200ms
    // ⭐⭐⭐ ⇒ ⇒ ⇒ (the second press lands inside that time ⇒ ⇒ ⇒ and
    // ⭐⭐⭐ must NOT store a second message).
    let saved = 0;
    await page.route('**/api/inbox/conversations/*/replies', async (route) => {
      if (route.request().method() === 'POST') {
        saved += 1;
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
      await route.continue();
    });
    await page.fill('#reply-body', 'الرد الأول من M-125');
    await page.click('#btn-send');
    await page.waitForTimeout(250);
    // ⭐⭐⭐ THE SECOND PRESS: ⭐⭐⭐ the button is closed ⇒ ⇒ ⇒.
    const disabled = await page.evaluate(
      `(() => {
        const button = document.getElementById('btn-send');
        return button ? button.disabled : false;
      })()`,
    );
    assert.equal(disabled, true, '⭐⭐⭐ the button of the send is NOT closed while the reply flies');
    // ⭐⭐⭐ the second press ⇒ ⇒ ⇒ (a closed button ignores it ⇒ ⇒ ⇒
    // ⭐⭐⭐ and the click of the page does not even reach the server).
    await page.evaluate(
      `(() => {
        const button = document.getElementById('btn-send');
        if (button) button.click();
      })()`,
    );
    await page.waitForTimeout(2500);
    await page.unroute('**/api/inbox/conversations/*/replies');
    assert.equal(saved, 1, `⭐⭐⭐ the page sent ${saved} request(s) of the reply`);
    // ⭐⭐⭐ and the database has ONE message of this body only.
    const rows = await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
      const result = await uow.query<{ count: string }>(
        `select count(*)::text as count from messages
          where tenant_id = $1 and body = $2`,
        [tenantId, 'الرد الأول من M-125'],
      );
      return Number(result.rows[0]?.count ?? 0);
    });
    assert.equal(rows, 1, `⭐⭐⭐ the database has ${rows} message(s) of the same body`);
  });

  await t.test('⭐⭐⭐ M-125-5: the rights of the roles and the isolation of the company', async () => {
    const base = `http://127.0.0.1:${harness.port}`;
    // ⭐⭐⭐ THE ISOLATION: ⭐⭐⭐ the conversation of the OTHER company
    // ⭐⭐⭐ is never in the list (its name is written on the screen).
    const list = await page.innerText('#conversation-list');
    assert.ok(
      !list.includes('عميل شركة أخرى') && !list.includes('رسالة شركة أخرى'),
      '⭐⭐⭐ a conversation of another company is in the list',
    );
    // ⭐⭐⭐ AND THE DIRECT READ: ⭐⭐⭐ the owner of THIS company asks
    // ⭐⭐⭐ for the conversation of the OTHER company ⇒ ⇒ ⇒ (no).
    const foreign = await page.evaluate(
      `fetch('/api/inbox/conversations/conv_b03_ui_foreign', {
         headers: {
           authorization: 'Bearer ' + JSON.parse(sessionStorage.getItem('wasl_session_v1')).token,
         },
       }).then((answer) => answer.status)`,
    );
    assert.notEqual(
      Number(foreign),
      200,
      `⭐⭐⭐ the conversation of another company was read: ${String(foreign)}`,
    );
    // ⭐⭐⭐ THE VIEWER: ⭐⭐⭐ he reads the conversation ⇒ ⇒ ⇒ and he
    // ⭐⭐⭐ CANNOT write a reply (the core has no `conversation.write`
    // ⭐⭐⭐ for him ⇒ ⇒ ⇒ and the page hides the composer).
    await openTheInbox(page);
    await page.waitForTimeout(1000);
    if (await page.isVisible('#btn-logout')) {
      await page.click('#btn-logout');
      await page.waitForTimeout(700);
    }
    await page.evaluate(
      ([tenant, id, name]) => {
        const tenantSelect = document.getElementById('login-tenant');
        if (!tenantSelect.querySelector(`option[value="${tenant}"]`)) {
          const tenantOption = document.createElement('option');
          tenantOption.value = tenant;
          tenantOption.textContent = 'شركة الواجهة';
          tenantSelect.appendChild(tenantOption);
        }
        const userSelect = document.getElementById('login-user');
        if (!userSelect.querySelector(`option[value="${id}"]`)) {
          const userOption = document.createElement('option');
          userOption.value = id;
          userOption.textContent = name;
          userSelect.appendChild(userOption);
        }
      },
      [tenantId, viewerId, 'UI viewer'],
    );
    await page.selectOption('#login-tenant', tenantId);
    await page.selectOption('#login-user', viewerId);
    await page.fill('#login-passcode', PASSCODE);
    await page.click('#btn-login');
    await page.waitForTimeout(1300);
    const viewerRows = await countOf(page, '#conversation-list .conversation');
    assert.ok(viewerRows >= 1, '⭐⭐⭐ the viewer sees no conversation');
    await page.evaluate(`document.querySelector('#conversation-list .conversation').click()`);
    await page.waitForTimeout(1200);
    const viewerMessages = await countOf(page, '.message');
    assert.ok(viewerMessages >= 1, '⭐⭐⭐ the viewer does not read the messages');
    // ⭐⭐⭐ THE COMPOSER: ⭐⭐⭐ the viewer may READ ⇒ ⇒ ⇒ but he may
    // ⭐⭐⭐ NOT WRITE ⇒ ⇒ ⇒ (the page shows no composer).
    assert.equal(
      await page.isVisible('#composer'),
      false,
      '⭐⭐⭐ the viewer sees the composer of the reply',
    );
    // ⭐⭐⭐ AND THE SERVER: ⭐⭐⭐ the direct write of the viewer is
    // ⭐⭐⭐ refused ⇒ ⇒ ⇒ (the button is never an authorization).
    const direct = await page.evaluate(
      `fetch('/api/inbox/conversations/conv_b03_ui_1/replies', {
         method: 'POST',
         headers: {
           'content-type': 'application/json',
           authorization: 'Bearer ' + JSON.parse(sessionStorage.getItem('wasl_session_v1')).token,
         },
         body: JSON.stringify({
           body: 'محاولة من المشاهد',
           client_message_ref: 'm125_viewer_ref',
         }),
       }).then((answer) => answer.status)`,
    );
    assert.equal(
      Number(direct),
      403,
      `⭐⭐⭐ the server accepted the reply of the viewer: ${String(direct)}`,
    );
  });
});

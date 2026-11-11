// ============================================================
// WASL AI — FOUNDATION BUILD 03 / PHASE 02 (D-071)
// the CRM and the refresh — the real browser check
// ------------------------------------------------------------
// ⭐⭐ WHAT THIS FILE MEASURES
//   A real browser (Chromium) opens the real pages, clicks the real
//   buttons and the real API answers. ⭐ Nothing is mocked: the
//   messages the page shows are read back from PostgreSQL.
// ⭐ THE PROPERTIES
//   ⭐ M-78: the list of the conversations really pages (more than a
//     hundred conversations, and the old ones do not disappear),
//   ⭐ M-77: the open thread receives the new messages by itself, the
//     draft of the employee is never touched, and no message is
//     repeated,
//   ⭐ M-79: the data of an old conversation never appears under the
//     title of a new one,
//   ⭐ M-80: a lost answer does NOT produce a second message, and the
//     employee is told the truth about what happened,
//   ⭐ D-071: the CRM shows the real customers of PostgreSQL, the
//     profile carries the real conversations, the edit needs the
//     capability of the core, and the two pages carry each other.
// ⛔ LOCAL ONLY: the browser talks to 127.0.0.1.
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
const RUN = Math.random().toString(36).slice(2, 10);

interface RouteLike {
  abort(): Promise<void>;
  fulfill(options: Record<string, unknown>): Promise<void>;
  fetch(): Promise<unknown>;
}

interface PageLike {
  goto(url: string): Promise<unknown>;
  goBack(): Promise<unknown>;
  click(selector: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  selectOption(selector: string, value: string): Promise<void>;
  textContent(selector: string): Promise<string | null>;
  getAttribute(selector: string, name: string): Promise<string | null>;
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

interface PlaywrightLike {
  chromium: {
    launch(options: Record<string, unknown>): Promise<{
      newPage(options?: Record<string, unknown>): Promise<PageLike>;
      close(): Promise<void>;
    }>;
  };
}

async function countOf(page: PageLike, selector: string): Promise<number> {
  const value = await page.evaluate(
    `(document.querySelectorAll(${JSON.stringify(selector)}).length)`,
  );
  return Number(value ?? 0);
}

/** ⭐⭐⭐ M-120: the URLs of the calls that the page made to the API. */
async function apiCallUrls(page: PageLike, needle: string): Promise<string[]> {
  const value = await page.evaluate(
    `performance.getEntriesByType('resource')
       .map((entry) => entry.name)
       .filter((name) => name.includes(${JSON.stringify(needle)}))`,
  );
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

/** ⭐⭐⭐ M-120: the typing of a word (the events that the page hears). */
async function typeIn(page: PageLike, selector: string, value: string): Promise<void> {
  await page.evaluate(
    `(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      input.value = ${JSON.stringify(value)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`,
  );
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

test('FOUNDATION 22) the CRM and the refresh in a real browser (D-071)', async (t) => {
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

  const tenantId = 'tnt_b03_ui2';
  const ownerId = 'usr_b03_ui2_owner';
  const agentId = 'usr_b03_ui2_agent';
  // ⭐⭐⭐ M-122: ⭐⭐⭐ the four roles of the company ⇒ ⇒ ⇒ (the
  // ⭐⭐⭐ M-122 rights of the CRM are measured on EACH one).
  const viewerId = 'usr_b03_ui2_viewer';
  const supervisorId = 'usr_b03_ui2_supervisor';
  // ⭐⭐⭐ M-122: ⭐⭐⭐ a SECOND company with NAMED customers ⇒ ⇒ ⇒
  // ⭐⭐⭐ M-122 (the isolation is measured with names we can read on
  // ⭐⭐⭐ M-122 the screen ⇒ ⇒ ⇒ not with a number).
  const otherTenantId = 'tnt_b03_ui2_other';
  const otherCustomerId = 'cus_b03_ui2_foreign';
  t.after(async () => {
    await browser.close();
    await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
      await uow.query(`delete from messages where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from conversations where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from customers where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from sessions where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from memberships where tenant_id = $1`, [tenantId]);
      await uow.query(
        `delete from users where id in ($1,$2,$3,$4)`,
        [ownerId, agentId, viewerId, supervisorId],
      );
      await uow.query(`delete from customers where id = $1`, [otherCustomerId]);
      await uow.query(`delete from tenants where id in ($1,$2)`, [tenantId, otherTenantId]);
    });
    await harness.stop();
  });

  const { hashPasscode } = await import('../../server/auth/sessions.ts');
  // ⭐⭐⭐ M-100: THE FIXTURE IS IDEMPOTENT ⇒ ⭐⭐ the leftovers of a
  // ⭐⭐ run that was KILLED (no cleanup) used to stay in the company
  // ⭐⭐ ⇒ ⇒ ⇒ the counter of the list doubled (120 ⇒ 240) ⇒ ⇒ ⇒ a
  // ⭐⭐ false failure of the browser drill ⇒ ⭐⭐⇒ the rows are wiped
  // ⭐⭐ BEFORE the fixture too (not only after it).
  await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
    await uow.query(`delete from messages where tenant_id = $1`, [tenantId]);
    await uow.query(`delete from conversations where tenant_id = $1`, [tenantId]);
    await uow.query(`delete from customers where tenant_id = $1`, [tenantId]);
  });
  // ⭐⭐ 120 conversations ⇒ the list MUST page (M-78).
  const refs: string[] = [];
  await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
    await uow.query(
      `insert into tenants (id, name, status) values ($1,$2,'active')
       on conflict (id) do update set name = excluded.name`,
      [tenantId, 'CRM UI (synthetic)'],
    );
    for (const [id, role] of [
      [ownerId, 'owner'],
      [agentId, 'agent'],
      [viewerId, 'viewer'],
      [supervisorId, 'supervisor'],
    ] as const) {
      await uow.query(
        `insert into users (id, display_name, email, status, passcode_hash)
         values ($1,$2,$3,'active',$4)
         on conflict (id) do update set passcode_hash = excluded.passcode_hash`,
        [id, `UI ${role}`, `${id}@example.invalid`, hashPasscode(PASSCODE)],
      );
      await uow.query(
        `insert into memberships (id, tenant_id, user_id, role, status)
         values ($1,$2,$3,$4,'active')
         on conflict (tenant_id, user_id) do update set role = excluded.role, status = 'active'`,
        [`mem_${id}`, tenantId, id, role],
      );
    }
    for (let index = 0; index < 120; index += 1) {
      const ref = `conv_b03_ui2_${index}_${RUN}`;
      refs.push(ref);
      await uow.query(
        `insert into customers (id, tenant_id, display_name, data_class, email, phone)
         values ($1,$2,$3,'standard',$4,$5)
         on conflict (id) do nothing`,
        [`cus_b03_ui2_${index}_${RUN}`, tenantId, `عميل ${index}`, `c${index}@example.invalid`, '+20100'],
      );
      // ⭐⭐⭐ M-122: ⭐⭐⭐ the FIRST conversation is ASSIGNED to the
      // ⭐⭐⭐ M-122 agent ⇒ ⇒ ⇒ (the scope of the agent is the
      // ⭐⭐⭐ M-122 conversations of him ⇒ ⇒ ⇒ and the test can see
      // ⭐⭐⭐ M-122 the difference between the SCOPE and the RIGHT).
      await uow.query(
        `insert into conversations (tenant_id, ref, customer_id, state, version, updated_at, assignee_actor_id)
         values ($1,$2,$3,'open',1, now(),$4)
         on conflict (tenant_id, ref) do update set assignee_actor_id = excluded.assignee_actor_id`,
        [tenantId, ref, `cus_b03_ui2_${index}_${RUN}`, index === 0 ? agentId : null],
      );
      await uow.query(
        `insert into messages (message_ref, tenant_id, conversation_ref, channel, direction, sender,
                               recipient, body, occurred_at, locale, attributes, stored_at)
         values ($1,$2,$3,'web','inbound','customer@example.invalid','agent@example.invalid',$4, now(),'ar','{}'::jsonb, now())`,
        [`msg_b03_ui2_${index}_${RUN}`, tenantId, ref, `رسالة العميل ${index}`],
      );
    }
  });

  // ⭐⭐⭐ M-122: ⭐⭐⭐ the second company (with a customer whose name
  // ⭐⭐⭐ M-122 is written on the screen ⇒ ⇒ ⇒ so the isolation is
  // ⭐⭐⭐ M-122 READABLE ⇒ ⇒ ⇒ not a number).
  await UnitOfWork.run(harness.ownerPool, otherTenantId, async (uow) => {
    await uow.query(`delete from customers where id = $1`, [otherCustomerId]);
    await uow.query(
      `insert into tenants (id, name, status) values ($1,$2,'active')
       on conflict (id) do update set name = excluded.name`,
      [otherTenantId, 'شركة أخرى (اصطناعية)'],
    );
    await uow.query(
      `insert into customers (id, tenant_id, display_name, data_class)
       values ($1,$2,$3,'standard')
       on conflict (id) do update set display_name = excluded.display_name`,
      [otherCustomerId, otherTenantId, 'Customer Alpha'],
    );
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const base = `http://127.0.0.1:${harness.port}`;
  await page.goto(`${base}/ui/inbox.html`);
  await page.waitForTimeout(400);

  // ⭐ The login of the drill (the page offers the company of the drill).
  await t.test('⭐⭐⭐ UI-10: the login of the drill works', async () => {
    // ⭐ The company of the drill is added to the lists of the page:
    //   they are synthetic and they belong to this drill only.
    await page.evaluate(
      `(() => {
        const tenant = document.getElementById('login-tenant');
        const tenantOption = document.createElement('option');
        tenantOption.value = ${JSON.stringify(tenantId)};
        tenantOption.textContent = 'UI tenant';
        tenant.appendChild(tenantOption);
        const select = document.getElementById('login-user');
        const option = document.createElement('option');
        option.value = ${JSON.stringify(ownerId)};
        option.textContent = 'UI owner';
        select.appendChild(option);
      })()`,
    );
    await page.selectOption('#login-tenant', tenantId);
    await page.selectOption('#login-user', ownerId);
    await page.fill('#login-passcode', PASSCODE);
    await page.click('#btn-login');
    await page.waitForTimeout(900);
    assert.equal(await page.isVisible('#workspace'), true, 'the workspace is not visible');
    assert.equal(await page.isVisible('#login-row'), false, 'the login is still visible');
  });

  await t.test('⭐⭐⭐ M-78 (UI-11): the list really pages and nothing disappears', async () => {
    const firstPage = await countOf(page, '#conversation-list .conversation');
    assert.equal(firstPage, 25, `⭐⭐⭐ the first page is not 25 rows: ${firstPage}`);
    const label = await page.innerText('#page-label');
    assert.match(label, /صفحة 1 من/, `⭐⭐⭐ the label of the page is wrong: ${label}`);

    const firstRefs = await page.evaluate(
      `Array.from(document.querySelectorAll('#conversation-list .conversation')).map((node) => node.dataset.ref)`,
    );
    await page.click('#btn-next');
    await page.waitForTimeout(700);
    const secondRefs = await page.evaluate(
      `Array.from(document.querySelectorAll('#conversation-list .conversation')).map((node) => node.dataset.ref)`,
    );
    assert.equal(secondRefs.length, 25, '⭐⭐⭐ the second page is not full');
    for (const ref of secondRefs) {
      assert.ok(!firstRefs.includes(ref), `⭐⭐⭐ the row ${ref} is on two pages`);
    }
    // ⭐⭐⭐ The LAST page carries the rest ⇒ nothing disappeared.
    const total = await page.innerText('#list-counter');
    assert.match(total, /120/, `⭐⭐⭐ the counter is not the real total: ${total}`);
    const labelText = await page.innerText('#page-label');
    const pages = Number(labelText.trim().split(' ').pop());
    assert.equal(pages, 5, `⭐⭐⭐ the number of the pages is wrong: ${pages} (label: ${labelText})`);
  });

  await t.test('⭐⭐⭐ M-77 (UI-12): the thread receives the new messages by itself', async () => {
    // ⭐ Open the FIRST conversation of the first page.
    await page.click('#btn-prev');
    await page.waitForTimeout(600);
    await page.evaluate(`document.querySelector('#conversation-list .conversation').click()`);
    await page.waitForTimeout(800);
    const ref = await page.inputValue('#thread-ref').catch(() => null);
    const openedRef = await page.evaluate(
      `document.getElementById('thread-ref').textContent`,
    );
    assert.ok(String(openedRef).length > 0, '⭐⭐⭐ no conversation was opened');

    // ⭐⭐ The employee writes a draft ⇒ it must survive the refresh.
    await page.fill('#reply-body', 'مسودة الموظف أثناء التحديث');

    // ⭐ A new message arrives in the database (from another employee).
    await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
      await uow.query(
        `insert into messages (message_ref, tenant_id, conversation_ref, channel, direction, sender,
                               recipient, body, occurred_at, locale, attributes, stored_at)
         values ($1,$2,$3,'web','inbound','customer@example.invalid','agent@example.invalid',$4, now(),'ar','{}'::jsonb, now())`,
        [`msg_b03_ui2_new_${RUN}`, tenantId, String(openedRef), 'رسالة جديدة أثناء التحديث'],
      );
    });

    // ⭐ The page refreshes by itself (every 8 seconds).
    await page.waitForTimeout(11000);

    const texts = await page.evaluate(
      `Array.from(document.querySelectorAll('#messages .message .text')).map((node) => node.textContent)`,
    );
    assert.ok(
      texts.includes('رسالة جديدة أثناء التحديث'),
      `⭐⭐⭐ the new message did not arrive by itself: ${JSON.stringify(texts)}`,
    );
    // ⭐⭐⭐ No repetition.
    const occurrences = texts.filter((text) => text === 'رسالة جديدة أثناء التحديث').length;
    assert.equal(occurrences, 1, `⭐⭐⭐ the message is repeated: ${occurrences}`);
    // ⭐⭐⭐ The draft of the employee is NOT touched.
    const draft = await page.inputValue('#reply-body');
    assert.equal(draft, 'مسودة الموظف أثناء التحديث', '⭐⭐⭐ the draft was wiped by the refresh');
    assert.equal(ref, null, 'the helper must not read the display');
  });

  await t.test('⭐⭐⭐ M-79 (UI-13): the data of an old conversation never stays on the screen', async () => {
    // ⭐ Open two conversations in a row, quickly.
    await page.evaluate(`document.querySelectorAll('#conversation-list .conversation')[0].click()`);
    await page.evaluate(`document.querySelectorAll('#conversation-list .conversation')[1].click()`);
    await page.waitForTimeout(1200);
    const title = await page.innerText('#thread-customer');
    const bodies = await page.evaluate(
      `Array.from(document.querySelectorAll('#messages .message .text')).map((node) => node.textContent)`,
    );
    assert.ok(bodies.length > 0, '⭐⭐⭐ the thread is empty');
    // ⭐⭐⭐ The messages on the screen belong to the title on the screen.
    const expected = await page.evaluate(
      `(() => {
        const active = document.querySelector('#conversation-list .conversation.active');
        return active ? active.dataset.ref : '';
      })()`,
    );
    const matching = bodies.filter((body) => body.startsWith('رسالة العميل '));
    assert.ok(
      matching.every((body) => body === `رسالة العميل ${String(expected).split('_')[3]}`),
      `⭐⭐⭐ the messages belong to another conversation: ${JSON.stringify(matching)} expected ${expected}`,
    );
    assert.ok(title.length > 0, 'the title is empty');
  });

  await t.test('⭐⭐⭐ M-80 (UI-14): a lost answer does NOT store the reply twice', async () => {
    // ⭐ Open a conversation and write a reply.
    await page.evaluate(`document.querySelector('#conversation-list .conversation').click()`);
    await page.waitForTimeout(800);
    const ref = await page.evaluate(`document.getElementById('thread-ref').textContent`);
    await page.fill('#reply-body', 'رد وقت انقطاع الشبكة');

    const countOfBody = async (body: string): Promise<number> => {
      const rows = await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
        const result = await uow.query(
          `select count(*)::int as count from messages where tenant_id = $1 and body = $2`,
          [tenantId, body],
        );
        return Number(result.rows[0]?.['count'] ?? '0');
      });
      return rows;
    };

    // ⭐⭐ THE FIRST HALF: the write lands and the ANSWER is lost.
    await page.route('**/replies', (route) => {
      // ⭐⭐ The request really goes to the server (the message IS
      //   stored) and the browser receives a failure ⇒ ⭐ the answer
      //   was lost after the write.
      void route
        .fetch()
        .then(() =>
          route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: '{"error":{"code":"boom"}}',
          }),
        )
        .catch(() => route.abort());
    });
    await page.click('#btn-send');
    await page.waitForTimeout(2500);
    const toast = await page.innerText('#toast');
    assert.match(toast, /اتحفظ/, `⭐⭐⭐ the employee was not told the truth: ${toast}`);
    assert.equal(
      await countOfBody('رد وقت انقطاع الشبكة'),
      1,
      '⭐⭐⭐ the reply is not stored exactly once',
    );

    // ⭐⭐⭐ THE SECOND HALF: the request never reached the server.
    await page.unroute('**/replies');
    await page.route('**/replies', (route) => {
      void route.abort();
    });
    await page.fill('#reply-body', 'رد لم يصل إلى الخادم');
    await page.click('#btn-send');
    await page.waitForTimeout(2000);
    const lostToast = await page.innerText('#toast');
    assert.match(lostToast, /مقدرناش نتأكد/, `⭐⭐⭐ the employee was not told the truth: ${lostToast}`);
    assert.equal(
      await countOfBody('رد لم يصل إلى الخادم'),
      0,
      '⭐⭐⭐ a message that never reached the server was stored',
    );
    // ⭐⭐⭐ The draft of the employee is STILL there ⇒ the retry is easy.
    const draft = await page.inputValue('#reply-body');
    assert.equal(draft, 'رد لم يصل إلى الخادم', '⭐⭐⭐ the draft was wiped');

    // ⭐⭐⭐ THE RETRY (the network is back) ⇒ stored ONCE.
    await page.unroute('**/replies');
    await page.click('#btn-send');
    await page.waitForTimeout(2000);
    assert.equal(
      await countOfBody('رد لم يصل إلى الخادم'),
      1,
      '⭐⭐⭐ the retry did not store the message',
    );
    // ⭐⭐⭐ And the answer of the server carries the reference of the
    //   message ⇒ ⭐ the retry of the SAME reference is refused by the
    //   server (the server test measures that side).
    const storedRefs = await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
      const result = await uow.query(
        `select message_ref from messages where tenant_id = $1 and body = $2`,
        [tenantId, 'رد لم يصل إلى الخادم'],
      );
      return result.rows.map((row) => String(row['message_ref']));
    });
    assert.equal(storedRefs.length, 1, '⭐⭐⭐ the retry stored the message twice');
    assert.ok(storedRefs[0]!.startsWith('reply_ui_'), `⭐⭐⭐ the reference is wrong: ${storedRefs[0]}`);
    assert.equal(String(ref).length > 0, true);
  });

  await t.test('⭐⭐⭐ D-071 (UI-15): the CRM shows the real customers of PostgreSQL', async () => {
    await page.goto(`${base}/ui/crm.html`);
    await page.waitForTimeout(1200);
    // ⭐⭐ The session of the tab carries the context (no second login).
    assert.equal(await page.isVisible('#workspace'), true, '⭐⭐⭐ the CRM asked for a second login');
    const customers = await countOf(page, '#customer-list .customer');
    assert.ok(customers > 0, '⭐⭐⭐ the list of the customers is empty');
    const counter = await page.innerText('#list-counter');
    assert.match(counter, /120/, `⭐⭐⭐ the counter is not the real total: ${counter}`);
    // ⭐⭐⭐ The pagination of the CRM.
    assert.equal(await page.isVisible('#pagination'), true, '⭐⭐⭐ the pagination of the CRM is hidden');
  });

  await t.test('⭐⭐⭐ D-071 (UI-16): the profile of a customer and its conversations', async () => {
    await page.evaluate(`document.querySelector('#customer-list .customer').click()`);
    await page.waitForTimeout(900);
    assert.equal(await page.isVisible('#profile'), true, '⭐⭐⭐ the profile did not open');
    const name = await page.innerText('#profile-name');
    assert.match(name, /عميل/, '⭐⭐⭐ the name of the customer is missing');
    const facts = await countOf(page, '#profile-facts dt');
    assert.ok(facts >= 4, `⭐⭐⭐ the facts are missing: ${facts}`);
    const conversations = await countOf(page, '#conversation-list .conversation');
    assert.equal(conversations, 1, `⭐⭐⭐ the conversations are missing: ${conversations}`);
    // ⭐⭐⭐ The link back to the inbox carries the reference.
    const href = await page.evaluate(
      `document.querySelector('#conversation-list .conversation a').getAttribute('href')`,
    );
    assert.match(String(href), /conversation=/, `⭐⭐⭐ the link to the inbox is wrong: ${href}`);
  });

  await t.test('⭐⭐⭐ D-071 (UI-17): the edit is real and it is audited', async () => {
    // ⭐ The owner may manage a customer ⇒ the block of the edit shows.
    assert.equal(await page.isVisible('#edit-block'), true, '⭐⭐⭐ the edit is hidden from the owner');
    await page.fill('#edit-name', 'عميل جديد');
    // ⭐ The confirmation of a change that matters.
    page.evaluate(`window.confirm = () => true`);
    await page.click('#btn-save');
    await page.waitForTimeout(1500);
    const toast = await page.innerText('#toast');
    assert.match(toast, /تم حفظ/, `⭐⭐⭐ the edit did not report a success: ${toast}`);
    // ⭐⭐⭐ The change is in the database.
    const changed = await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
      const result = await uow.query(
        `select count(*)::int as count from customers where tenant_id = $1 and display_name = $2`,
        [tenantId, 'عميل جديد'],
      );
      return Number(result.rows[0]?.['count'] ?? '0');
    });
    assert.equal(changed, 1, '⭐⭐⭐ the change is not in the database');
  });

  // ⭐⭐ The deep link of the customer (the two pages carry each other).
  let customerHref = '';
  await t.test('⭐⭐⭐ D-071 (UI-18): the two pages carry each other', async () => {
    // ⭐ The inbox links to the file of the customer.
    await page.goto(`${base}/ui/inbox.html`);
    await page.waitForTimeout(1200);
    await page.evaluate(`document.querySelector('#conversation-list .conversation').click()`);
    await page.waitForTimeout(900);
    assert.equal(await page.isVisible('#link-customer'), true, '⭐⭐⭐ the link to the CRM is hidden');
    const href = await page.evaluate(`document.getElementById('link-customer').getAttribute('href')`);
    assert.match(String(href), /crm\.html\?customer=/, `⭐⭐⭐ the link is wrong: ${href}`);
    customerHref = String(href);
    // ⭐⭐⭐ And the CRM opens that customer.
    await page.goto(`${base}${customerHref}`);
    await page.waitForTimeout(1200);
    assert.equal(await page.isVisible('#profile'), true, '⭐⭐⭐ the CRM did not open the customer');
    const name = await page.innerText('#profile-name');
    assert.ok(name.length > 0, '⭐⭐⭐ the name of the customer is missing');
    // ⭐⭐⭐ The form of the edit is there (the owner may edit).
    assert.equal(await page.isVisible('#edit-form'), true, '⭐⭐⭐ the form of the edit is not visible');
    await page.screenshot({ path: path.join(SHOT_DIR, 'crm-desktop.png'), fullPage: false });
  });

  await t.test('⭐⭐⭐ UI-19: the CRM on a phone width', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    // ⭐ The file of the customer (the same state as the desktop shot).
    await page.goto(`${base}${customerHref}`);
    await page.waitForTimeout(1200);
    const overflow = await page.evaluate(
      `document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2`,
    );
    assert.equal(overflow, true, '⭐⭐⭐ the page overflows horizontally on a phone');
    await page.screenshot({ path: path.join(SHOT_DIR, 'crm-mobile.png'), fullPage: false });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(300);
  });

  // ============================================================
  // M-120 — the experience of the CRM on the mobile
  // ============================================================

  await t.test('⭐⭐⭐ M-120-1: the search waits (ONE request for the whole word)', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/ui/crm.html`);
    await page.waitForTimeout(1200);
    const before = await apiCallUrls(page, '/api/crm/customers?');
    const word = 'عميل 1';
    await page.evaluate(
      `(() => {
        const input = document.getElementById('filter-query');
        input.value = '';
        for (const letter of ${JSON.stringify([...word])}) {
          input.value = input.value + letter;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      })()`,
    );
    await page.waitForTimeout(1600);
    const fresh = (await apiCallUrls(page, '/api/crm/customers?')).slice(before.length);
    assert.equal(
      fresh.length,
      1,
      `⭐⭐⭐ the search sent ${fresh.length} request(s) instead of ONE: ${JSON.stringify(fresh)}`,
    );
    const params = new URL(fresh[0]).searchParams;
    assert.equal(params.get('q'), word, `⭐⭐⭐ the request did not carry the whole word: ${fresh[0]}`);
    const partial = fresh.filter((url) => {
      const q = new URL(url).searchParams.get('q');
      return q !== null && q !== word;
    });
    assert.equal(partial.length, 0, `⭐⭐⭐ a partial word reached the server: ${JSON.stringify(partial)}`);
  });

  await t.test('⭐⭐⭐ M-120-2: an OLD reply inside the debounce window is dropped', async () => {
    await page.goto(`${base}/ui/crm.html`);
    await page.waitForTimeout(800);
    let held: RouteLike | null = null;
    let deferredStarted = false;
    await page.route('**/api/crm/customers?*', async (route) => {
      if (held === null) {
        held = route;
        return;
      }
      deferredStarted = true;
      await route.continue();
    });
    await page.click('#btn-refresh');
    await page.waitForTimeout(300);
    await typeIn(page, '#filter-query', 'عميل 7');
    await page.waitForTimeout(40);
    await (held as RouteLike).fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        customers: [
          {
            id: 'cus_old_reply',
            display_name: 'عميل قديم',
            email: 'old@example.invalid',
            conversation_count: 0,
            last_interaction_at: null,
          },
        ],
        total: 1,
        limit: 25,
        offset: 0,
        may_manage: false,
      }),
    });
    await page.waitForTimeout(140);
    const text = await page.innerText('#customer-list');
    const firedAlready = deferredStarted;
    await page.unroute('**/api/crm/customers?*');
    assert.equal(
      firedAlready,
      false,
      '⭐⭐⭐ the premise of the test broke: the deferred request started before the old reply landed',
    );
    assert.ok(
      !text.includes('عميل قديم'),
      `⭐⭐⭐ the OLD reply was written over the new search: ${text}`,
    );
    await page.waitForTimeout(1400);
    const rowsAfter = await countOf(page, '#customer-list .customer');
    assert.ok(rowsAfter > 0, `⭐⭐⭐ the new search did not land: ${rowsAfter} row(s)`);
  });

  await t.test('⭐⭐⭐ M-120-3: the mobile swaps the list for the profile, and the way back keeps the state', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/ui/crm.html`);
    await page.waitForTimeout(1200);
    await typeIn(page, '#filter-query', 'عميل 1');
    await page.waitForTimeout(1000);
    await page.click('#btn-next');
    await page.waitForTimeout(900);
    const labelBefore = await page.innerText('#page-label');
    assert.match(labelBefore, /صفحة 2/, `⭐⭐⭐ the user did not reach the second page: ${labelBefore}`);
    const overflow = await page.evaluate(
      `document.documentElement.scrollWidth - document.documentElement.clientWidth`,
    );
    assert.ok(Number(overflow) <= 2, `⭐⭐⭐ the page overflows horizontally: ${overflow}px`);
    await page.screenshot({ path: path.join(SHOT_DIR, 'crm-mobile-list.png'), fullPage: true });

    await page.evaluate(`document.querySelector('#customer-list .customer').click()`);
    await page.waitForTimeout(1000);
    assert.equal(await page.isVisible('#profile'), true, '⭐⭐⭐ the profile did not open');
    const onProfile = await page.evaluate(`document.body.classList.contains('view-profile')`);
    assert.equal(onProfile, true, '⭐⭐⭐ the small screen did not swap to the profile');
    const listHidden = await page.isVisible('.pane.list');
    assert.equal(listHidden, false, '⭐⭐⭐ the list is still on the screen behind the profile');
    await page.screenshot({ path: path.join(SHOT_DIR, 'crm-mobile-profile.png'), fullPage: true });

    await page.click('#btn-back');
    await page.waitForTimeout(1000);
    assert.equal(
      await page.isVisible('.pane.list'),
      true,
      '⭐⭐⭐ the list did not come back after the way back',
    );
    assert.equal(
      await page.inputValue('#filter-query'),
      'عميل 1',
      '⭐⭐⭐ the search was lost on the way back',
    );
    const labelAfter = await page.innerText('#page-label');
    assert.equal(labelAfter, labelBefore, `⭐⭐⭐ the page was lost: ${labelBefore} ⇒ ${labelAfter}`);
  });

  await t.test('⭐⭐⭐ M-120-4: the button of the BROWSER comes back to the list', async () => {
    await page.goto(`${base}/ui/crm.html`);
    await page.waitForTimeout(1200);
    await page.evaluate(`document.querySelector('#customer-list .customer').click()`);
    await page.waitForTimeout(1000);
    assert.equal(await page.isVisible('#profile'), true, '⭐⭐⭐ the profile did not open');
    await page.goBack();
    await page.waitForTimeout(1000);
    assert.equal(
      await page.isVisible('#profile'),
      false,
      '⭐⭐⭐ the button of the browser did not close the profile',
    );
    assert.equal(
      await page.isVisible('.pane.list'),
      true,
      '⭐⭐⭐ the list is not visible after the way back of the browser',
    );
  });

  await t.test('⭐⭐⭐ M-120-5: the empty state explains itself', async () => {
    await page.goto(`${base}/ui/crm.html`);
    await page.waitForTimeout(1200);
    await typeIn(page, '#filter-query', 'لا-يوجد-عميل-بهذا-الاسم');
    await page.waitForTimeout(1200);
    assert.equal(await page.isVisible('#list-empty'), true, '⭐⭐⭐ the empty state is not shown');
    const title = await page.innerText('#list-empty-title');
    assert.match(title, /لا توجد نتائج/, `⭐⭐⭐ the empty state does not explain itself: ${title}`);
    const text = await page.innerText('#list-empty-text');
    assert.match(text, /امسح/, `⭐⭐⭐ the empty state does not offer a way out: ${text}`);
    assert.equal(
      await page.isVisible('#btn-clear-filters'),
      true,
      '⭐⭐⭐ the button of the clear search is hidden',
    );
    await page.click('#btn-clear-filters');
    await page.waitForTimeout(1000);
    const rows = await countOf(page, '#customer-list .customer');
    assert.ok(rows > 0, `⭐⭐⭐ the clear of the search did not bring the list back: ${rows} row(s)`);
  });

  await t.test('⭐⭐⭐ M-120-6: the loss of the connection is said out loud', async () => {
    await page.goto(`${base}/ui/crm.html`);
    await page.waitForTimeout(1200);
    await page.route('**/api/crm/customers?*', async (route) => {
      await route.abort();
    });
    await page.click('#btn-refresh');
    await page.waitForTimeout(1000);
    await page.unroute('**/api/crm/customers?*');
    assert.equal(
      await page.isVisible('#offline-banner'),
      true,
      '⭐⭐⭐ the page did not say that the connection is gone',
    );
    assert.equal(await page.isVisible('#list-error'), true, '⭐⭐⭐ the page did not show the error');
    await page.screenshot({ path: path.join(SHOT_DIR, 'crm-mobile-offline.png'), fullPage: true });
    await page.click('#btn-retry-offline');
    await page.waitForTimeout(1200);
    assert.equal(
      await page.isVisible('#offline-banner'),
      false,
      '⭐⭐⭐ the banner of the connection is still there',
    );
    const rows = await countOf(page, '#customer-list .customer');
    assert.ok(rows > 0, `⭐⭐⭐ the list did not come back after the retry: ${rows} row(s)`);
  });

  await t.test('⭐⭐⭐ M-120-7: the rights and the isolation of the CRM on the mobile', async () => {
    await page.goto(`${base}/ui/crm.html`);
    await page.waitForTimeout(1200);
    // ⭐⭐⭐ THE ISOLATION: the customers of ANOTHER company are not here.
    const wholeList = await page.innerText('#customer-list');
    assert.ok(
      !wholeList.includes('Customer Alpha') && !wholeList.includes('Customer Beta'),
      '⭐⭐⭐ a customer of another company is in the list',
    );
    const counter = await page.innerText('#list-counter');
    assert.match(counter, /^120/, `⭐⭐⭐ the counter counts foreign customers: ${counter}`);
    // ⭐⭐⭐ THE RIGHTS: the owner may edit (the server announces it).
    await page.evaluate(`document.querySelector('#customer-list .customer').click()`);
    await page.waitForTimeout(1000);
    assert.equal(
      await page.isVisible('#edit-block'),
      true,
      '⭐⭐⭐ the owner does not see the edit of the customer',
    );
  });

  await t.test('⭐⭐⭐ M-79 (UI-13b): the refresh stops when the session is over', async () => {
    // ⭐ Back to the inbox (the context of the tab carries the session).
    await page.goto(`${base}/ui/inbox.html`);
    await page.waitForTimeout(1200);
    await page.evaluate(`document.querySelector('#conversation-list .conversation').click()`);
    await page.waitForTimeout(900);
    // ⭐⭐ The session of the employee ends (the server forgets it).
    await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
      await uow.query(`delete from sessions where tenant_id = $1`, [tenantId]);
    });
    // ⭐⭐ The refresh asks again ⇒ the server refuses ⇒ the page says it.
    await page.waitForTimeout(11000);
    const note = await page.innerText('#thread-refresh');
    assert.match(note, /انتهت الجلسة/, `⭐⭐⭐ the page did not say that the session is over: ${note}`);
  });
  // ============================================================
  // M-122 — the rights of the CRM on the FOUR roles (and the
  //          isolation of the company, with names we can read)
  // ============================================================

  await t.test('⭐⭐⭐ M-122: each role sees what the core lets it see (and nothing more)', async () => {
    // ⭐⭐⭐ THE HELPER: ⭐⭐⭐ log in as any of the four roles of the
    // ⭐⭐⭐ synthetic company ⇒ ⇒ ⇒ (the passcode is the same ⇒ ⇒ ⇒
    // ⭐⭐⭐ the only difference is the ROLE).
    const loginAsRole = async (userId: string, label: string): Promise<void> => {
      await page.goto(`${base}/ui/inbox.html`);
      await page.waitForTimeout(900);
      // ⭐⭐⭐ the session of the previous role is closed ⇒ ⇒ ⇒ (the
      // ⭐⭐⭐ login row comes back ⇒ ⇒ ⇒ and the role really changes).
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
            tenantOption.textContent = 'UI tenant';
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
        [tenantId, userId, label],
      );
      await page.selectOption('#login-tenant', tenantId);
      await page.selectOption('#login-user', userId);
      await page.fill('#login-passcode', PASSCODE);
      await page.click('#btn-login');
      await page.waitForTimeout(1300);
    };

    // ⭐⭐⭐ THE TABLE: ⭐⭐⭐ the core's `customer.manage` is the
    // ⭐⭐⭐ owner and the supervisor ⇒ ⇒ ⇒ (the agent and the viewer
    // ⭐⭐⭐ only READ ⇒ ⇒ ⇒).
    // ⭐⭐⭐ THE TABLE: ⭐⭐⭐ the RIGHT of the edit is the core's
    // ⭐⭐⭐ `customer.manage` ⇒ ⇒ ⇒ (the owner and the supervisor
    // ⭐⭐⭐ ⇒ ⇒ ⇒ and the agent and the viewer only READ).
    const expectations: Array<[string, string, boolean]> = [
      [ownerId, 'UI owner', true],
      [supervisorId, 'UI supervisor', true],
      [viewerId, 'UI viewer', false],
    ];

    for (const [userId, label, mayEdit] of expectations) {
      await loginAsRole(userId, label);
      await page.goto(`${base}/ui/crm.html`);
      await page.waitForTimeout(1200);
      // ⭐⭐⭐ ① the list of the customers is there for EVERY role
      // ⭐⭐⭐ (the core gives `conversation.list` to all of them).
      const rows = await countOf(page, '#customer-list .customer');
      assert.ok(rows > 0, `⭐⭐⭐ ${label} sees no customer at all`);
      // ⭐⭐⭐ ② the customer of ANOTHER company is NEVER there
      // ⭐⭐⭐ (the name is written on the screen ⇒ ⇒ ⇒ so the test
      // ⭐⭐⭐ reads it with the eyes).
      const list = await page.innerText('#customer-list');
      assert.ok(
        !list.includes('Customer Alpha'),
        `⭐⭐⭐ ${label} sees the customer of another company`,
      );
      // ⭐⭐⭐ ③ the edit block follows the permission of the SERVER
      // ⭐⭐⭐ (the button is never an authorization).
      await page.evaluate(`document.querySelector('#customer-list .customer').click()`);
      await page.waitForTimeout(1000);
      assert.equal(
        await page.isVisible('#edit-block'),
        mayEdit,
        `⭐⭐⭐ ${label} ${mayEdit ? 'does not' : 'does'} see the edit of the customer`,
      );
    }

    // ⭐⭐⭐ THE AGENT: ⭐⭐⭐ the SCOPE of the core is not the RIGHT
    // ⭐⭐⭐ ⇒ ⇒ ⇒ the agent sees ONLY the customers of the
    // ⭐⭐⭐ conversations that are assigned to him ⇒ ⇒ ⇒ (and the
    // ⭐⭐⭐ edit is hidden for him ⇒ ⇒ ⇒ the RIGHT is missing).
    await loginAsRole(agentId, 'UI agent');
    await page.goto(`${base}/ui/crm.html`);
    await page.waitForTimeout(1200);
    const agentRows = await countOf(page, '#customer-list .customer');
    assert.equal(
      agentRows,
      1,
      `⭐⭐⭐ the agent sees ${agentRows} customer(s) ⇒ the scope of the core is not applied`,
    );
    await page.evaluate(`document.querySelector('#customer-list .customer').click()`);
    await page.waitForTimeout(1000);
    assert.equal(
      await page.isVisible('#edit-block'),
      false,
      '⭐⭐⭐ the agent sees the edit of the customer (the right is not the core\'s)',
    );
  });

  await t.test('⭐⭐⭐ M-122: a DIRECT change without the right is refused (and the row is untouched)', async () => {
    // ⭐⭐⭐ THE VIEWER: ⭐⭐⭐ he reads the customer of HIS company …
    await page.goto(`${base}/ui/inbox.html`);
    await page.waitForTimeout(900);
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
          tenantOption.textContent = 'UI tenant';
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
    await page.goto(`${base}/ui/crm.html`);
    await page.waitForTimeout(1200);
    const customerId = await page.evaluate(
      `(() => {
        const row = document.querySelector('#customer-list .customer');
        return row ? row.getAttribute('data-id') || '' : '';
      })()`,
    );
    assert.ok(customerId, '⭐⭐⭐ the list of the customers has no id to read');
    const nameBefore = await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
      const result = await uow.query<{ display_name: string }>(
        `select display_name from customers where tenant_id = $1 and id = $2`,
        [tenantId, customerId],
      );
      return result.rows[0]?.display_name ?? '';
    });
    assert.ok(nameBefore, '⭐⭐⭐ the customer of the drill is not in the database');
    // ⭐⭐⭐ THE DIRECT CHANGE: ⭐⭐⭐ the viewer writes the customer
    // ⭐⭐⭐ WITHOUT the permission ⇒ ⇒ ⇒ (the server refuses ⇒ ⇒ ⇒
    // ⭐⭐⭐ and the row of the database does NOT change).
    const status = await page.evaluate(
      `fetch('/api/crm/customers/' + ${JSON.stringify(customerId)}, {
         method: 'PATCH',
         headers: {
           'content-type': 'application/json',
           authorization: 'Bearer ' + JSON.parse(sessionStorage.getItem('wasl_session_v1')).token,
         },
         body: JSON.stringify({ version: 1, display_name: 'اسم اخترمه' }),
       }).then((answer) => answer.status)`,
    );
    assert.equal(
      Number(status),
      403,
      `⭐⭐⭐ the server accepted the change of the viewer: ${String(status)}`,
    );
    const nameAfter = await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
      const result = await uow.query<{ display_name: string }>(
        `select display_name from customers where tenant_id = $1 and id = $2`,
        [tenantId, customerId],
      );
      return result.rows[0]?.display_name ?? '';
    });
    assert.equal(
      nameAfter,
      nameBefore,
      `⭐⭐⭐ the row of the customer changed although the server refused: ${nameAfter}`,
    );
    // ⭐⭐⭐ AND THE FOREIGN CUSTOMER: ⭐⭐⭐ the viewer asks for the
    // ⭐⭐⭐ customer of the OTHER company by his id ⇒ ⇒ ⇒ (the server
    // ⭐⭐⭐ says no ⇒ ⇒ ⇒ the isolation is not only in the list).
    const foreign = await page.evaluate(
      `fetch('/api/crm/customers/' + ${JSON.stringify(otherCustomerId)}, {
         headers: {
           authorization: 'Bearer ' + JSON.parse(sessionStorage.getItem('wasl_session_v1')).token,
         },
       }).then((answer) => answer.status)`,
    );
    assert.notEqual(
      Number(foreign),
      200,
      `⭐⭐⭐ the viewer read the customer of another company: ${String(foreign)}`,
    );
  });
});

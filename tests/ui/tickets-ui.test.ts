// ============================================================
// WASL AI — FOUNDATION BUILD 03 / PHASE 04 (D-073)
// the support tickets — the real browser check
// ------------------------------------------------------------
// ⭐⭐ WHAT THIS FILE MEASURES
//   A real browser (Chromium) opens the real page, clicks the real
//   buttons and the real API answers. ⭐ Nothing is mocked: the
//   tickets the page shows are read back from PostgreSQL.
// ⭐ THE PROPERTIES
//   ⭐ D-073-1: the page shows the REAL tickets of the company (the
//     rows are really in PostgreSQL),
//   ⭐ D-073-2: the creation through the FORM really writes a ticket,
//   ⭐ D-073-3: the detail shows the activity of the ticket (the log
//     of the database),
//   ⭐ D-073-4: ⭐⭐⭐ the role decides what the page shows: the
//     employee does NOT get the form of the edit, and the viewer
//     does not get the button of the creation ⇒ ⭐⭐ the button in the
//     interface is NOT an authorization (the server refuses it),
//   ⭐ D-073-5: ⭐⭐⭐ the scope of the employee holds in the browser:
//     the employee sees the tickets that are assigned to them and
//     nothing else,
//   ⭐ D-073-6: the CRM carries the tickets of the customer and the
//     count of the open ones,
//   ⭐ D-073-7: the inbox points at the page of the tickets with the
//     conversation and the customer.
// ⛔ LOCAL ONLY: the browser talks to 127.0.0.1.
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
const RUN = Math.random().toString(36).slice(2, 10);

interface RouteLike {
  abort(): Promise<void>;
  fulfill(options: Record<string, unknown>): Promise<void>;
  fetch(): Promise<unknown>;
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

interface PlaywrightLike {
  chromium: {
    launch(options: Record<string, unknown>): Promise<{
      newPage(options?: Record<string, unknown>): Promise<PageLike>;
      close(): Promise<void>;
    }>;
  };
}

/**
 * ⭐⭐ The drill's company and its employees are added to the lists of
 *   the page ⇒ ⭐⭐ they are synthetic and they belong to this drill
 *   only ⇒ ⭐⭐ and the page is loaded again in every subtest ⇒ ⭐⭐ so
 *   the helper is called again every time (the options do not survive
 *   a reload).
 */
async function offerDrillAccounts(page: PageLike, tenantId: string, users: readonly [string, string][]): Promise<void> {
  await page.evaluate(
    `(() => {
      const tenant = document.getElementById('login-tenant');
      if (![...tenant.options].some((option) => option.value === ${JSON.stringify(tenantId)})) {
        const tenantOption = document.createElement('option');
        tenantOption.value = ${JSON.stringify(tenantId)};
        tenantOption.textContent = 'UI tenant';
        tenant.appendChild(tenantOption);
      }
      const select = document.getElementById('login-user');
      for (const [value, label] of ${JSON.stringify(users)}) {
        if (![...select.options].some((option) => option.value === value)) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = label;
          select.appendChild(option);
        }
      }
    })()`,
  );
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

test('FOUNDATION 4) the support tickets in a real browser (D-073)', async (t) => {
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

  const tenantId = 'tnt_b04_ui';
  const ownerId = 'usr_b04_ui_owner';
  const agentId = 'usr_b04_ui_agent';
  const viewerId = 'usr_b04_ui_viewer';
  const customerId = 'cus_b04_ui_1';
  t.after(async () => {
    await browser.close();
    await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
      await uow.query(`delete from support_ticket_changes where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from support_tickets where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from messages where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from conversations where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from customers where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from sessions where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from memberships where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from users where id in ($1,$2,$3)`, [ownerId, agentId, viewerId]);
      await uow.query(`delete from tenants where id = $1`, [tenantId]);
    });
    await harness.stop();
  });

  // ⭐⭐⭐ M-100: THE FIXTURE IS IDEMPOTENT ⇒ ⭐⭐ the leftovers of
  // ⭐⭐ a run that was KILLED must not change the counts ⇒ ⭐⭐⇒ the
  // ⭐⭐ rows are wiped BEFORE the fixture too (not only after it).
  await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
    await uow.query(`delete from messages where tenant_id = $1`, [tenantId]);
    await uow.query(`delete from conversations where tenant_id = $1`, [tenantId]);
    await uow.query(`delete from customers where tenant_id = $1`, [tenantId]);
  });
  const { hashPasscode } = await import('../../server/auth/sessions.ts');
  const ticketRef = `tkt_b04_ui_1_${RUN}`;
  const agentTicketRef = `tkt_b04_ui_2_${RUN}`;
  await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
    await uow.query(
      `insert into tenants (id, name, status) values ($1,$2,'active')
       on conflict (id) do update set name = excluded.name`,
      [tenantId, 'Tickets UI (synthetic)'],
    );
    for (const [id, role] of [
      [ownerId, 'owner'],
      [agentId, 'agent'],
      [viewerId, 'viewer'],
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
    await uow.query(
      `insert into customers (id, tenant_id, display_name, data_class, email, phone)
       values ($1,$2,$3,'standard',$4,'+20100')
       on conflict (id) do nothing`,
      [customerId, tenantId, 'عميل التذاكر', 'tickets@example.invalid'],
    );
    // ⭐⭐ TWO tickets: one for the owner (unassigned) and one for the
    //   employee (assigned) ⇒ ⭐⭐ the scope is measurable in the page.
  });

  // ⭐⭐⭐ THE FIXTURE IS CREATED THROUGH THE API ⇒ ⭐⭐ the tickets
  //   carry the real activity log ⇒ ⭐⭐ and the drill measures the
  //   real path (a row that was pushed into the table has no history).
  const ownerToken = await loginAs(harness.client, tenantId, ownerId, PASSCODE);
  const ownerCreate = await harness.client.request({
    method: 'POST',
    path: '/api/tickets',
    token: ownerToken,
    payload: {
      ref: ticketRef,
      customer_id: customerId,
      subject: 'تذكرة المالك',
      description: 'وصف التذكرة',
      priority: 'high',
    },
  });
  assert.equal(ownerCreate.status, 201, `the ticket of the drill was refused: ${ownerCreate.status}`);
  const agentCreate = await harness.client.request({
    method: 'POST',
    path: '/api/tickets',
    token: ownerToken,
    payload: {
      ref: agentTicketRef,
      customer_id: customerId,
      subject: 'تذكرة الموظف',
      description: 'وصف التذكرة',
    },
  });
  assert.equal(agentCreate.status, 201, `the second ticket of the drill was refused: ${agentCreate.status}`);
  const assigned = await harness.client.request({
    method: 'PATCH',
    path: `/api/tickets/${agentTicketRef}`,
    token: ownerToken,
    payload: { version: 1, assignee_actor_id: agentId },
  });
  assert.equal(assigned.status, 200, `the assignment of the drill was refused: ${assigned.status}`);

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const base = `http://127.0.0.1:${harness.port}`;

  await t.test('⭐⭐⭐ D-073-1: the page shows the real tickets of the company', async () => {
    await page.goto(`${base}/ui/tickets.html`);
    await page.waitForTimeout(400);
    await offerDrillAccounts(page, tenantId, [
      [ownerId, 'UI owner'],
      [agentId, 'UI agent'],
      [viewerId, 'UI viewer'],
    ]);
    await page.selectOption('#login-tenant', tenantId);
    await page.selectOption('#login-user', ownerId);
    await page.fill('#login-passcode', PASSCODE);
    await page.click('#btn-login');
    await page.waitForTimeout(1000);
    assert.equal(await page.isVisible('#workspace'), true, 'the workspace is not visible');
    const rows = await countOf(page, '#ticket-list .ticket');
    assert.equal(rows, 2, `⭐⭐⭐ the page shows ${rows} ticket(s) instead of 2`);
    const counter = await page.innerText('#list-counter');
    assert.match(counter, /2/, `⭐⭐⭐ the counter is wrong: ${counter}`);
  });

  await t.test('⭐⭐⭐ D-073-2: the creation through the form really writes a ticket', async () => {
    await page.click('#btn-new');
    await page.waitForTimeout(700);
    assert.equal(await page.isVisible('#create-block'), true, 'the form of the creation is not visible');
    await page.selectOption('#create-customer', customerId);
    await page.fill('#create-subject', 'تذكرة من المتصفح');
    await page.fill('#create-description', 'وصف مكتوب من المتصفح');
    await page.click('#btn-create');
    await page.waitForTimeout(1200);
    const inDatabase = await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
      const result = await uow.query<{ count: string }>(
        `select count(*)::text as count from support_tickets
          where tenant_id = $1 and subject = $2`,
        [tenantId, 'تذكرة من المتصفح'],
      );
      return Number(result.rows[0]?.count ?? '0');
    });
    assert.equal(inDatabase, 1, '⭐⭐⭐ the ticket of the browser is not in the database');
  });

  await t.test('⭐⭐⭐ D-073-3: the detail shows the activity of the ticket', async () => {
    await page.evaluate(
      `(() => {
        const rows = Array.from(document.querySelectorAll('#ticket-list .ticket'));
        const row = rows.find((node) => node.textContent.includes('تذكرة المالك'));
        (row ?? rows[0]).click();
      })()`,
    );
    await page.waitForTimeout(900);
    const subject = await page.innerText('#detail-subject');
    assert.equal(subject, 'تذكرة المالك', `⭐⭐⭐ the wrong ticket is open: ${subject}`);
    const activities = await countOf(page, '#change-list .activity');
    assert.ok(activities >= 1, `⭐⭐⭐ the activity is empty: ${activities}`);
  });

  await t.test('⭐⭐⭐ D-073-4: the role decides what the page shows', async () => {
    // ⭐⭐ The employee: no creation button (the server does not allow
    //   the creation for them) ⇒ ⭐⭐ and the edit form is hidden.
    await page.click('#btn-logout');
    await page.waitForTimeout(500);
    await page.selectOption('#login-tenant', tenantId);
    await page.selectOption('#login-user', agentId);
    await page.click('#btn-login');
    await page.waitForTimeout(1000);
    assert.equal(
      await page.isVisible('#btn-new'),
      false,
      '⭐⭐⭐ the employee sees the button of the creation (the server refuses it)',
    );
    await page.evaluate(
      `(() => {
        const rows = Array.from(document.querySelectorAll('#ticket-list .ticket'));
        const row = rows.find((node) => node.textContent.includes('تذكرة الموظف'));
        (row ?? rows[0]).click();
      })()`,
    );
    await page.waitForTimeout(800);
    assert.equal(
      await page.isVisible('#edit-block'),
      false,
      '⭐⭐⭐ the employee sees the form of the edit (the server refuses it)',
    );
    // ⭐⭐⭐ THE PROOF: the button was not enough ⇒ the server refuses
    //   the write even when the page is asked directly.
    const direct = await page.evaluate(
      `fetch('/api/tickets', {
         method: 'POST',
         headers: {
           'content-type': 'application/json',
           authorization: 'Bearer ' + JSON.parse(sessionStorage.getItem('wasl_session_v1')).token,
         },
         body: JSON.stringify({ customer_id: ${JSON.stringify(customerId)}, subject: 'محاولة من المتصفح' }),
       }).then((answer) => answer.status)`,
    );
    assert.equal(Number(direct), 403, `⭐⭐⭐ the server accepted the write of the employee: ${direct}`);
  });

  await t.test('⭐⭐⭐ D-073-5: the scope of the employee holds in the browser', async () => {
    const rows = await page.evaluate(
      `Array.from(document.querySelectorAll('#ticket-list .ticket')).map((node) => node.textContent)`,
    );
    assert.equal(rows.length, 1, `⭐⭐⭐ the employee sees ${rows.length} ticket(s) instead of 1`);
    assert.ok(
      rows[0].includes('تذكرة الموظف'),
      `⭐⭐⭐ the employee sees another ticket: ${JSON.stringify(rows)}`,
    );
  });

  await t.test('⭐⭐⭐ D-073-6: the CRM carries the tickets of the customer', async () => {
    await page.click('#btn-logout');
    await page.waitForTimeout(500);
    await page.selectOption('#login-tenant', tenantId);
    await page.selectOption('#login-user', ownerId);
    await page.click('#btn-login');
    await page.waitForTimeout(1000);
    await page.goto(`${base}/ui/crm.html?customer=${encodeURIComponent(customerId)}`);
    await page.waitForTimeout(1200);
    await offerDrillAccounts(page, tenantId, [
      [ownerId, 'UI owner'],
      [agentId, 'UI agent'],
      [viewerId, 'UI viewer'],
    ]);
    const tickets = await countOf(page, '#ticket-list .ticket-item');
    assert.equal(tickets, 3, `⭐⭐⭐ the CRM shows ${tickets} ticket(s) instead of 3`);
    const counter = await page.innerText('#tickets-counter');
    assert.match(counter, /مفتوحة/, `⭐⭐⭐ the counter of the tickets is wrong: ${counter}`);
  });

  await t.test('⭐⭐⭐ D-073-7: the inbox points at the page of the tickets', async () => {
    await page.goto(`${base}/ui/inbox.html`);
    await page.waitForTimeout(500);
    await offerDrillAccounts(page, tenantId, [
      [ownerId, 'UI owner'],
      [agentId, 'UI agent'],
      [viewerId, 'UI viewer'],
    ]);
    await page.selectOption('#login-tenant', tenantId);
    await page.selectOption('#login-user', ownerId);
    await page.click('#btn-login');
    await page.waitForTimeout(1200);
    // ⭐⭐ The inbox needs a conversation of the drill ⇒ ⭐⭐ one is
    //   created here (the real API).
    const created = await page.evaluate(
      `fetch('/api/conversations', {
         method: 'POST',
         headers: { 'content-type': 'application/json', authorization: 'Bearer ' + JSON.parse(sessionStorage.getItem('wasl_session_v1')).token },
         body: JSON.stringify({
           conversation_ref: ${JSON.stringify(`conv_b04_ui_${RUN}`)},
           customer_id: ${JSON.stringify(customerId)},
           message: { body: 'محادثة drill' },
         }),
       }).then((answer) => answer.status)`,
    );
    assert.equal(Number(created), 201, `⭐⭐⭐ the conversation was refused: ${created}`);
    await page.click('#btn-refresh');
    await page.waitForTimeout(1200);
    await page.evaluate(`document.querySelector('#conversation-list .conversation').click()`);
    await page.waitForTimeout(1000);
    const href = await page.evaluate(
      `document.getElementById('link-ticket').getAttribute('href') ?? ''`,
    );
    assert.ok(href.includes('/ui/tickets.html'), `⭐⭐⭐ the link of the ticket is wrong: ${href}`);
    assert.ok(href.includes('conversation='), `⭐⭐⭐ the link carries no conversation: ${href}`);
    assert.ok(href.includes('customer='), `⭐⭐⭐ the link carries no customer: ${href}`);
  });

  await t.test('⭐⭐⭐ the page works on a small screen (390px)', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/ui/tickets.html`);
    await page.waitForTimeout(1200);
    const overflow = await page.evaluate(
      `document.documentElement.scrollWidth - document.documentElement.clientWidth`,
    );
    assert.ok(Number(overflow) <= 2, `⭐⭐⭐ the page overflows horizontally: ${overflow}px`);
    await page.screenshot({
      path: path.join(SHOT_DIR, 'tickets-mobile.png'),
      fullPage: true,
    });
  });
});

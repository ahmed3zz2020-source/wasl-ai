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
import type { PgPool } from '../../server/db/pool.ts';
import { loginAs, startHarness } from '../server/harness.ts';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const SHOT_DIR = path.join(ROOT, 'docs', 'previews');
const PASSCODE = process.env['WASL_TEST_PASSCODE'] ?? 'wasl-local-test';
const RUN = Math.random().toString(36).slice(2, 10);

/**
 * ⭐⭐⭐ M-116: ⭐⭐⭐ the identifiers of the drill are at the TOP level
 *   ⭐⭐⭐ because the helpers of the round (the login, the bulk of the
 *   ⭐⭐⭐ tickets) need them too ⇒ ⭐⭐⭐ and a helper that cannot see
 *   ⭐⭐⭐ the company of the drill is a helper that measures nothing.
 */
const TENANT_ID = 'tnt_b04_ui';
const OWNER_ID = 'usr_b04_ui_owner';
const AGENT_ID = 'usr_b04_ui_agent';
const VIEWER_ID = 'usr_b04_ui_viewer';
const CUSTOMER_ID = 'cus_b04_ui_1';

interface RouteLike {
  abort(): Promise<void>;
  continue(options?: Record<string, unknown>): Promise<void>;
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

/** ⭐⭐ M-114: the number of the calls that the page made to the API. */
async function countApiCalls(page: PageLike, needle: string): Promise<number> {
  const value = await page.evaluate(
    `performance.getEntriesByType('resource').filter((entry) => entry.name.includes(${JSON.stringify(
      needle,
    )})).length`,
  );
  return Number(value ?? 0);
}

/** ⭐⭐ M-114: the typing of a word (the events that the page hears). */
async function typeIn(page: PageLike, selector: string, value: string): Promise<void> {
  await page.evaluate(
    `(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      input.value = ${JSON.stringify(value)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`,
  );
}

/**
 * ⭐⭐⭐ M-116: the URLs of the calls that the page made to the API.
 *   ⭐⭐ NOT only the number ⇒ ⭐⭐ the number alone cannot tell WHICH
 *   ⭐⭐ request was sent ⇒ ⭐⭐ and the whole point of M-116 is to
 *   ⭐⭐ prove that the request that was sent is the INTENDED one.
 */
async function apiCallUrls(page: PageLike, needle: string): Promise<string[]> {
  const value = await page.evaluate(
    `performance.getEntriesByType('resource')
       .map((entry) => entry.name)
       .filter((name) => name.includes(${JSON.stringify(needle)}))`,
  );
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

/** ⭐⭐⭐ M-116: the parameters of a call of the list (of the API). */
function paramsOf(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

/**
 * ⭐⭐⭐ M-116: the version of a ticket in the database (the lock of the
 *   ⭐⭐⭐ concurrent edit) ⇒ ⭐⭐ it is the PROOF that a write really
 *   ⭐⭐⭐ landed (and that a write did NOT land).
 */
async function ticketVersion(pool: PgPool, tenantId: string, ref: string): Promise<number> {
  return UnitOfWork.run(pool, tenantId, async (uow) => {
    const result = await uow.query<{ version: string }>(
      `select version::text as version from support_tickets where tenant_id = $1 and ref = $2`,
      [tenantId, ref],
    );
    return Number(result.rows[0]?.version ?? '0');
  });
}

/**
 * ⭐⭐⭐ M-116: the login of the OWNER.
 *   ⭐⭐ The drill of M-114-6 ends with the EMPLOYEE logged in ⇒ ⭐⭐
 *   ⭐⭐ and the employee sees ONE ticket (their own) ⇒ ⭐⭐ so a page
 *   ⭐⭐ with two pages can never exist for them ⇒ ⭐⭐ the tests of
 *   ⭐⭐ the list MUST say who they are.
 */
async function loginAsOwner(page: PageLike, base: string): Promise<void> {
  await page.goto(`${base}/ui/tickets.html`);
  await page.waitForTimeout(500);
  await offerDrillAccounts(page, TENANT_ID, [
    [OWNER_ID, 'UI owner'],
    [AGENT_ID, 'UI agent'],
    [VIEWER_ID, 'UI viewer'],
  ]);
  if (await page.isVisible('#btn-logout')) {
    await page.click('#btn-logout');
    await page.waitForTimeout(600);
  }
  await page.selectOption('#login-tenant', TENANT_ID);
  await page.selectOption('#login-user', OWNER_ID);
  await page.fill('#login-passcode', PASSCODE);
  await page.click('#btn-login');
  await page.waitForTimeout(1300);
}

/**
 * ⭐⭐⭐ M-116: the bulk of the tickets (a REAL second page).
 *   ⭐⭐ A list of one page can never prove that a deferred request
 *   ⭐⭐ did NOT throw the user back to the first page ⇒ ⭐⭐ so the
 *   ⭐⭐ bulk is created here (and wiped right after the drill).
 */
async function seedBulkTickets(pool: PgPool, count: number): Promise<void> {
  await UnitOfWork.run(pool, TENANT_ID, async (uow) => {
    await uow.query(
      `insert into support_tickets (tenant_id, ref, customer_id, subject, description, state, priority, version)
       select $1, 'tkt_b04_ui_bulk_' || g, $2, 'تذكرة الطابور ' || g, 'وصف', 'open', 'normal', 1
         from generate_series(1, $3) as g
       on conflict (tenant_id, ref) do nothing`,
      [TENANT_ID, CUSTOMER_ID, count],
    );
  });
}

async function wipeBulkTickets(pool: PgPool): Promise<void> {
  await UnitOfWork.run(pool, TENANT_ID, async (uow) => {
    await uow.query(`delete from support_tickets where tenant_id = $1 and ref like 'tkt_b04_ui_bulk_%'`, [
      TENANT_ID,
    ]);
  });
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

  const tenantId = TENANT_ID;
  const ownerId = OWNER_ID;
  const agentId = AGENT_ID;
  const viewerId = VIEWER_ID;
  const customerId = CUSTOMER_ID;
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
    // ⭐⭐⭐ M-129: ⭐⭐⭐ the BULK of the tickets is wiped too ⇒ ⇒ ⇒ (a run
    // ⭐⭐⭐ M-129 that is killed between the seeding of the bulk and its
    // ⭐⭐⭐ M-129 wipe leaves sixty rows behind ⇒ ⇒ ⇒ ⇒ and the next run
    // ⭐⭐⭐ M-129 counts them ⇒ ⇒ ⇒ ⇒ ⇒ a FALSE failure of the product).
    await uow.query(
      `delete from support_tickets where tenant_id = $1 and ref like 'tkt_b04_ui_bulk_%'`,
      [tenantId],
    );
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

  // ============================================================
  // M-114 — the package of the experience on the mobile
  // ============================================================

  await t.test('⭐⭐⭐ M-114-1: the search is NOT a call for every letter', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/ui/tickets.html`);
    await page.waitForTimeout(1200);
    const before = await countApiCalls(page, '/api/tickets');
    // ⭐⭐ FIVE letters ⇒ ⭐⭐ FIVE events of "input" ⇒ ⭐⭐ the page waits
    // ⭐⭐ until the user stops typing (ONE call for the whole word).
    await page.evaluate(
      `(() => {
        const input = document.getElementById('filter-query');
        for (const letter of ['ت','ذ','ك','ر','ة']) {
          input.value = input.value + letter;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      })()`,
    );
    await page.waitForTimeout(1600);
    const after = await countApiCalls(page, '/api/tickets');
    const calls = after - before;
    assert.ok(
      calls <= 2,
      `⭐⭐⭐ the search called the server ${calls} time(s) instead of ONE (the letters are not debounced)`,
    );
  });

  await t.test('⭐⭐⭐ M-114-2: a LATE reply of an old search is dropped', async () => {
    await page.goto(`${base}/ui/tickets.html`);
    await page.waitForTimeout(1200);
    // ⭐⭐⭐ the FIRST search is slow (1400ms) and the second one is fast
    // ⭐⭐⭐ ⇒ ⇒ ⇒ the reply of the first one arrives LAST.
    let seen = 0;
    await page.route('**/api/tickets?*', async (route) => {
      seen += 1;
      if (seen === 1) {
        await new Promise((resolve) => setTimeout(resolve, 1400));
      }
      await route.continue();
    });
    await typeIn(page, '#filter-query', 'المالك');
    await page.waitForTimeout(500);
    await typeIn(page, '#filter-query', 'لا-يوجد-كذا');
    await page.waitForTimeout(2600);
    await page.unroute('**/api/tickets?*');
    const rows = await countOf(page, '#ticket-list .ticket');
    assert.equal(
      rows,
      0,
      `⭐⭐⭐ the list shows ${rows} row(s) ⇒ the LATE reply of the old search won (the stale guard is missing)`,
    );
    const empty = await page.isVisible('#list-empty');
    assert.equal(empty, true, '⭐⭐⭐ the empty state is not shown for the newest search');
    const title = await page.innerText('#list-empty-title');
    assert.match(title, /لا توجد نتائج/, `⭐⭐⭐ the empty state does not explain itself: ${title}`);
  });

  await t.test('⭐⭐⭐ M-114-3: the way back keeps the state of the list', async () => {
    await page.goto(`${base}/ui/tickets.html`);
    await page.waitForTimeout(1200);
    await typeIn(page, '#filter-query', 'الموظف');
    await page.waitForTimeout(900);
    const rowsBefore = await countOf(page, '#ticket-list .ticket');
    assert.equal(rowsBefore, 1, `⭐⭐⭐ the search shows ${rowsBefore} row(s) instead of 1`);
    await page.evaluate(`document.querySelector('#ticket-list .ticket').click()`);
    await page.waitForTimeout(900);
    assert.equal(await page.isVisible('#detail'), true, '⭐⭐⭐ the detail did not open');
    await page.click('#btn-back');
    await page.waitForTimeout(800);
    assert.equal(
      await page.isVisible('#detail'),
      false,
      '⭐⭐⭐ the detail did not close',
    );
    const query = await page.inputValue('#filter-query');
    assert.equal(query, 'الموظف', `⭐⭐⭐ the search was lost on the way back: "${query}"`);
    const rowsAfter = await countOf(page, '#ticket-list .ticket');
    assert.equal(
      rowsAfter,
      rowsBefore,
      `⭐⭐⭐ the list changed on the way back: ${rowsBefore} ⇒ ${rowsAfter}`,
    );
  });

  await t.test('⭐⭐⭐ M-114-4: the small screen shows the list OR the detail', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/ui/tickets.html`);
    await page.waitForTimeout(1200);
    const listHiddenAtStart = await page.isVisible('.pane.list');
    assert.equal(listHiddenAtStart, true, '⭐⭐⭐ the list is not visible at the start');
    await page.evaluate(`document.querySelector('#ticket-list .ticket').click()`);
    await page.waitForTimeout(900);
    const onDetail = await page.evaluate(`document.body.classList.contains('view-detail')`);
    assert.equal(onDetail, true, '⭐⭐⭐ the page did not swap to the detail on the small screen');
    const listHidden = await page.isVisible('.pane.list');
    assert.equal(listHidden, false, '⭐⭐⭐ the list is still visible behind the detail');
    await page.screenshot({
      path: path.join(SHOT_DIR, 'tickets-mobile-detail.png'),
      fullPage: true,
    });
    await page.click('#btn-back');
    await page.waitForTimeout(700);
    const backToList = await page.evaluate(`document.body.classList.contains('view-detail')`);
    assert.equal(backToList, false, '⭐⭐⭐ the page did not come back to the list');
    const listBack = await page.isVisible('.pane.list');
    assert.equal(listBack, true, '⭐⭐⭐ the list is not visible after the way back');
  });

  await t.test('⭐⭐⭐ M-114-5: the loss of the connection is said out loud', async () => {
    await page.goto(`${base}/ui/tickets.html`);
    await page.waitForTimeout(1200);
    await page.route('**/api/tickets?*', async (route) => {
      await route.abort();
    });
    await page.click('#btn-refresh');
    await page.waitForTimeout(900);
    await page.unroute('**/api/tickets?*');
    const offline = await page.isVisible('#offline-banner');
    assert.equal(offline, true, '⭐⭐⭐ the page did not say that the connection is gone');
    const error = await page.isVisible('#list-error');
    assert.equal(error, true, '⭐⭐⭐ the page did not show the error of the list');
    await page.screenshot({
      path: path.join(SHOT_DIR, 'tickets-mobile-offline.png'),
      fullPage: true,
    });
    // ⭐⭐ the retry brings the list back.
    await page.click('#btn-retry-offline');
    await page.waitForTimeout(1200);
    const offlineAfter = await page.isVisible('#offline-banner');
    assert.equal(offlineAfter, false, '⭐⭐⭐ the banner of the connection is still there');
    const rows = await countOf(page, '#ticket-list .ticket');
    assert.ok(rows > 0, `⭐⭐⭐ the list did not come back after the retry: ${rows} row(s)`);
  });

  await t.test('⭐⭐⭐ M-114-6: the note of the rights comes from the server', async () => {
    await page.goto(`${base}/ui/tickets.html`);
    await page.waitForTimeout(600);
    await offerDrillAccounts(page, tenantId, [
      [ownerId, 'UI owner'],
      [agentId, 'UI agent'],
      [viewerId, 'UI viewer'],
    ]);
    await page.click('#btn-logout');
    await page.waitForTimeout(500);
    await page.selectOption('#login-tenant', tenantId);
    await page.selectOption('#login-user', agentId);
    await page.click('#btn-login');
    await page.waitForTimeout(1200);
    const note = await page.isVisible('#rights-note');
    assert.equal(note, true, '⭐⭐⭐ the employee does not see the note of the rights');
    const text = await page.innerText('#rights-note');
    assert.match(text, /صلاحية/, `⭐⭐⭐ the note of the rights is not clear: ${text}`);
    assert.equal(
      await page.isVisible('#btn-new'),
      false,
      '⭐⭐⭐ the employee sees the button of the creation (the server refuses it)',
    );
    assert.equal(
      await page.isVisible('#edit-block'),
      false,
      '⭐⭐⭐ the employee sees the form of the edit (the server refuses it)',
    );
  });

  // ============================================================
  // M-116 + M-117 — the strictness of the search and the proof
  //                  of the way back
  // ============================================================

  await t.test('⭐⭐⭐ M-116-1: the debounce sends THE INTENDED request (not "calls <= 2")', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAsOwner(page, base);
    const before = await apiCallUrls(page, '/api/tickets?');
    // ⭐⭐⭐ FIVE letters ⇒ ⭐⭐⭐ FIVE events of "input" ⇒ ⭐⭐⭐ the page
    // ⭐⭐⭐ waits until the user stops typing.
    const word = 'تذكرة';
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
    const fresh = (await apiCallUrls(page, '/api/tickets?')).slice(before.length);
    // ⭐⭐⭐ THE COUNT IS NOT THE PROOF ⇒ ⭐⭐⭐ the proof is WHICH request.
    assert.equal(
      fresh.length,
      1,
      `⭐⭐⭐ the search sent ${fresh.length} request(s) instead of ONE: ${JSON.stringify(fresh)}`,
    );
    const params = paramsOf(fresh[0]);
    assert.equal(
      params.get('q'),
      word,
      `⭐⭐⭐ the request did not carry the whole word: ${JSON.stringify(fresh[0])}`,
    );
    // ⭐⭐⭐ and NO request carried a PREFIX of the word ⇒ ⭐⭐⭐ the
    // ⭐⭐⭐ letters did not leak to the server one by one.
    const prefixes = fresh.filter((url) => {
      const q = paramsOf(url).get('q');
      return q !== null && q !== word;
    });
    assert.equal(
      prefixes.length,
      0,
      `⭐⭐⭐ a partial word reached the server: ${JSON.stringify(prefixes)}`,
    );
    // ⭐⭐⭐ and the list shows the RESULT of that one request.
    const rows = await countOf(page, '#ticket-list .ticket');
    assert.ok(rows > 0, `⭐⭐⭐ the list is empty after the intended request: ${rows} row(s)`);
  });

  await t.test('⭐⭐⭐ M-116-2: an OLD reply that lands inside the debounce window is dropped', async () => {
    await page.goto(`${base}/ui/tickets.html`);
    await page.waitForTimeout(800);
    // ⭐⭐⭐ the NEXT list request is HELD ⇒ ⇒ ⇒ it will land while the
    // ⭐⭐⭐ next search is still waiting for its timeout ⇒ ⭐⭐⭐ and it
    // ⭐⭐⭐ carries a body that can NEVER be the result of a search.
    let held: RouteLike | null = null;
    let deferredStarted = false;
    await page.route('**/api/tickets?*', async (route) => {
      if (held === null) {
        held = route;
        return;
      }
      deferredStarted = true;
      await route.continue();
    });
    await page.click('#btn-refresh');
    await page.waitForTimeout(300);
    // ⭐⭐ the user types ⇒ ⭐⭐ the page waits (320ms) before it asks.
    await typeIn(page, '#filter-query', 'المالك');
    await page.waitForTimeout(40);
    // ⭐⭐⭐ THE OLD REPLY LEAVES NOW ⇒ ⭐⭐⭐ it is INSIDE the window of
    // ⭐⭐⭐ the new search ⇒ ⭐⭐⭐ it must NOT be written on the screen.
    await (held as RouteLike).fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        tickets: [
          {
            ref: 'tkt_old_reply',
            customer_id: customerId,
            customer_name: 'عميل',
            subject: 'رد قديم',
            description: '',
            state: 'open',
            priority: 'normal',
            assignee_actor_id: null,
            version: 1,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
        total: 1,
        limit: 25,
        offset: 0,
        may_write: true,
        may_assign: true,
      }),
    });
    await page.waitForTimeout(140);
    const stale = await countOf(page, '#ticket-list .ticket');
    const staleText = await page.innerText('#ticket-list');
    const firedAlready = deferredStarted;
    await page.unroute('**/api/tickets?*');
    assert.equal(
      firedAlready,
      false,
      '⭐⭐⭐ the premise of the test broke: the deferred request started before the old reply landed',
    );
    assert.ok(
      !staleText.includes('رد قديم'),
      `⭐⭐⭐ the OLD reply was written over the new search (the stale guard is too late): ${stale} row(s)`,
    );
    // ⭐⭐⭐ and the NEW search still lands ⇒ ⭐⭐⭐ the list is not stuck.
    await page.waitForTimeout(1400);
    const rowsAfter = await countOf(page, '#ticket-list .ticket');
    assert.equal(rowsAfter, 1, `⭐⭐⭐ the new search did not land: ${rowsAfter} row(s)`);
    const textAfter = await page.innerText('#ticket-list');
    assert.ok(textAfter.includes('تذكرة المالك'), `⭐⭐⭐ the wrong result is on the screen: ${textAfter}`);
  });

  await t.test('⭐⭐⭐ M-116-3: a change of the filter during a deferred search ⇒ NO deferred request comes back', async () => {
    await page.goto(`${base}/ui/tickets.html`);
    await page.waitForTimeout(1200);
    const before = await apiCallUrls(page, '/api/tickets?');
    await typeIn(page, '#filter-query', 'تذكرة');
    await page.waitForTimeout(40);
    // ⭐⭐⭐ the user changes the ORDER while the search is waiting.
    await page.selectOption('#filter-sort', 'priority');
    await page.waitForTimeout(1400);
    const fresh = (await apiCallUrls(page, '/api/tickets?')).slice(before.length);
    assert.equal(
      fresh.length,
      1,
      `⭐⭐⭐ the deferred search came back after the change of the order: ${fresh.length} request(s) ${JSON.stringify(
        fresh,
      )}`,
    );
    const params = paramsOf(fresh[0]);
    assert.equal(params.get('q'), 'تذكرة', `⭐⭐⭐ the request lost the text: ${fresh[0]}`);
    assert.equal(params.get('sort'), 'priority', `⭐⭐⭐ the request lost the new order: ${fresh[0]}`);
    assert.equal(params.get('offset'), '0', `⭐⭐⭐ the request did not start at the first page: ${fresh[0]}`);
  });

  await t.test('⭐⭐⭐ M-116-4: a deferred search does NOT throw the user back to the first page', async () => {
    // ⭐⭐⭐ the bulk of the tickets ⇒ ⭐⭐⭐ a REAL second page ⇒ ⭐⭐⭐
    // ⭐⭐⭐ (a list of one page can never prove this).
    await seedBulkTickets(harness.ownerPool, 60);
    try {
      await page.goto(`${base}/ui/tickets.html`);
      await page.waitForTimeout(1200);
      await typeIn(page, '#filter-query', 'تذكرة');
      await page.waitForTimeout(1000);
      const label = await page.innerText('#page-label');
      assert.match(label, /صفحة 1 من [2-9]/, `⭐⭐⭐ the list has no second page: ${label}`);
      // ⭐⭐⭐ the user goes to the second page.
      await page.click('#btn-next');
      await page.waitForTimeout(700);
      assert.match(
        await page.innerText('#page-label'),
        /صفحة 2/,
        '⭐⭐⭐ the user did not reach the second page',
      );
      const before = await apiCallUrls(page, '/api/tickets?');
      // ⭐⭐⭐ the user types (the search is deferred) and then changes
      // ⭐⭐⭐ the order and goes to the next page ⇒ ⭐⭐⭐ the deferred
      // ⭐⭐⭐ search must not reset the page behind his back.
      await typeIn(page, '#filter-query', 'تذكرة الطابور');
      await page.waitForTimeout(30);
      await page.evaluate(
        `(() => {
          const sort = document.getElementById('filter-sort');
          sort.value = 'priority';
          sort.dispatchEvent(new Event('change', { bubbles: true }));
        })()`,
      );
      await page.waitForTimeout(30);
      await page.click('#btn-next');
      await page.waitForTimeout(1800);
      const fresh = (await apiCallUrls(page, '/api/tickets?')).slice(before.length);
      // ⭐⭐⭐ the page the user asked for must be the LAST page asked for.
      const offsets = fresh.map((url) => paramsOf(url).get('offset'));
      assert.equal(
        offsets[offsets.length - 1],
        '25',
        `⭐⭐⭐ the deferred search threw the user back to the first page: the offsets were ${JSON.stringify(
          offsets,
        )}`,
      );
      assert.match(
        await page.innerText('#page-label'),
        /صفحة 2/,
        '⭐⭐⭐ the label of the page does not match the page the user asked for',
      );
    } finally {
      await wipeBulkTickets(harness.ownerPool);
    }
  });

  await t.test('⭐⭐⭐ M-117-1: the way back keeps the SEARCH, the FILTERS and the ORDER', async () => {
    await page.goto(`${base}/ui/tickets.html`);
    await page.waitForTimeout(1200);
    await typeIn(page, '#filter-query', 'تذكرة');
    await page.waitForTimeout(1000);
    await page.selectOption('#filter-state', 'open');
    await page.waitForTimeout(700);
    await page.selectOption('#filter-priority', 'normal');
    await page.waitForTimeout(700);
    await page.selectOption('#filter-sort', 'priority');
    await page.waitForTimeout(700);
    await page.evaluate(`document.querySelector('#ticket-list .ticket').click()`);
    await page.waitForTimeout(900);
    assert.equal(await page.isVisible('#detail'), true, '⭐⭐⭐ the detail did not open');
    await page.click('#btn-back');
    await page.waitForTimeout(800);
    assert.equal(await page.inputValue('#filter-query'), 'تذكرة', '⭐⭐⭐ the search was lost');
    assert.equal(await page.inputValue('#filter-state'), 'open', '⭐⭐⭐ the state filter was lost');
    assert.equal(await page.inputValue('#filter-priority'), 'normal', '⭐⭐⭐ the priority filter was lost');
    assert.equal(await page.inputValue('#filter-sort'), 'priority', '⭐⭐⭐ the order was lost');
  });

  await t.test('⭐⭐⭐ M-117-2: the button of the BROWSER comes back to the list', async () => {
    await page.goto(`${base}/ui/tickets.html`);
    await page.waitForTimeout(1200);
    await page.evaluate(`document.querySelector('#ticket-list .ticket').click()`);
    await page.waitForTimeout(900);
    assert.equal(await page.isVisible('#detail'), true, '⭐⭐⭐ the detail did not open');
    // ⭐⭐⭐ the button of the browser (the history goes back).
    await page.goBack();
    await page.waitForTimeout(900);
    assert.equal(
      await page.isVisible('#detail'),
      false,
      '⭐⭐⭐ the button of the browser did not close the detail',
    );
    assert.equal(
      await page.isVisible('.pane.list'),
      true,
      '⭐⭐⭐ the list is not visible after the way back of the browser',
    );
  });

  await t.test('⭐⭐⭐ M-117-3: the PAGE and the PLACE of the screen survive the way back', async () => {
    await seedBulkTickets(harness.ownerPool, 60);
    try {
      await page.goto(`${base}/ui/tickets.html`);
      await page.waitForTimeout(1200);
      await typeIn(page, '#filter-query', 'تذكرة الطابور');
      await page.waitForTimeout(1000);
      await page.click('#btn-next');
      await page.waitForTimeout(800);
      const labelBefore = await page.innerText('#page-label');
      assert.match(labelBefore, /صفحة 2/, `⭐⭐⭐ the user did not reach the second page: ${labelBefore}`);
      // ⭐⭐⭐ the user scrolls down inside the list.
      await page.evaluate(`window.scrollTo(0, 400)`);
      await page.waitForTimeout(250);
      const scrollBefore = await page.evaluate(`window.scrollY`);
      assert.ok(Number(scrollBefore) > 0, '⭐⭐⭐ the page did not scroll (the premise of the test)');
      await page.evaluate(`document.querySelector('#ticket-list .ticket').click()`);
      await page.waitForTimeout(900);
      await page.click('#btn-back');
      await page.waitForTimeout(900);
      const labelAfter = await page.innerText('#page-label');
      assert.equal(labelAfter, labelBefore, `⭐⭐⭐ the page was lost: ${labelBefore} ⇒ ${labelAfter}`);
      const scrollAfter = await page.evaluate(`window.scrollY`);
      assert.equal(
        Number(scrollAfter),
        Number(scrollBefore),
        `⭐⭐⭐ the place of the screen was lost: ${scrollBefore} ⇒ ${scrollAfter}`,
      );
    } finally {
      await wipeBulkTickets(harness.ownerPool);
    }
  });

  await t.test('⭐⭐⭐ M-117-4: a FAST switch between two tickets shows NO old details', async () => {
    await page.goto(`${base}/ui/tickets.html`);
    await page.waitForTimeout(1200);
    // ⭐⭐⭐ the first ticket is opened and it loads.
    await page.evaluate(
      `(() => {
        const rows = Array.from(document.querySelectorAll('#ticket-list .ticket'));
        const row = rows.find((node) => node.textContent.includes('تذكرة المالك'));
        (row ?? rows[0]).click();
      })()`,
    );
    await page.waitForTimeout(900);
    const subjectA = await page.innerText('#detail-subject');
    assert.equal(subjectA, 'تذكرة المالك', `⭐⭐⭐ the wrong ticket is open: ${subjectA}`);
    const versionBefore = await ticketVersion(harness.ownerPool, tenantId, ticketRef);
    // ⭐⭐⭐ the SECOND ticket is slow ⇒ ⭐⭐⭐ the window of the old
    // ⭐⭐⭐ details is open while it loads.
    await page.route(`**/api/tickets/${ticketRef}*`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    await page.evaluate(
      `(() => {
        const rows = Array.from(document.querySelectorAll('#ticket-list .ticket'));
        const row = rows.find((node) => node.textContent.includes('تذكرة الموظف'));
        (row ?? rows[0]).click();
      })()`,
    );
    await page.waitForTimeout(250);
    // ⭐⭐⭐ the form still shows the FIRST ticket ⇒ ⭐⭐⭐ saving NOW
    // ⭐⭐⭐ would write the WRONG ticket ⇒ ⭐⭐⭐ it must not write.
    await page.click('#btn-save');
    await page.waitForTimeout(700);
    await page.unroute(`**/api/tickets/${ticketRef}*`);
    const versionAfter = await ticketVersion(harness.ownerPool, tenantId, ticketRef);
    assert.equal(
      versionAfter,
      versionBefore,
      `⭐⭐⭐ the save wrote the OLD ticket (its version went ${versionBefore} ⇒ ${versionAfter})`,
    );
    // ⭐⭐⭐ and the new ticket lands clean.
    await page.waitForTimeout(1600);
    const subjectB = await page.innerText('#detail-subject');
    assert.equal(subjectB, 'تذكرة الموظف', `⭐⭐⭐ the detail shows an old ticket: ${subjectB}`);
    const editSubject = await page.inputValue('#edit-subject');
    assert.equal(editSubject, 'تذكرة الموظف', `⭐⭐⭐ the form shows an old ticket: ${editSubject}`);
  });

  // ============================================================
  // M-119 — the queue of the tickets that have no assignee
  // ============================================================

  await t.test('⭐⭐⭐ M-119-1: the whole trip of the queue on the mobile (create ⇒ assign ⇒ gone)', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAsOwner(page, base);
    const subject = 'تذكرة الطابور الجديدة';
    // ⭐⭐⭐ ① the owner creates an UNASSIGNED ticket (the real form).
    await page.click('#btn-new');
    await page.waitForTimeout(800);
    await page.selectOption('#create-customer', customerId);
    await page.fill('#create-subject', subject);
    await page.fill('#create-description', 'تذكرة في طابور العمل');
    await page.click('#btn-create');
    await page.waitForTimeout(1400);
    const createdRef = await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
      const result = await uow.query<{ ref: string }>(
        `select ref from support_tickets where tenant_id = $1 and subject = $2`,
        [tenantId, subject],
      );
      return result.rows[0]?.ref ?? '';
    });
    assert.ok(createdRef, '⭐⭐⭐ the ticket was not written in the database');
    const assigneeBefore = await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
      const result = await uow.query<{ assignee_actor_id: string | null }>(
        `select assignee_actor_id from support_tickets where tenant_id = $1 and ref = $2`,
        [tenantId, createdRef],
      );
      return result.rows[0]?.assignee_actor_id ?? null;
    });
    assert.equal(assigneeBefore, null, '⭐⭐⭐ the new ticket was born assigned');
    // ⭐⭐⭐ ② the queue is open ⇒ ⭐⭐⭐ the ticket is IN it.
    await page.click('#btn-unassigned');
    await page.waitForTimeout(1200);
    assert.equal(
      await page.getAttribute('#btn-unassigned', 'aria-pressed'),
      'true',
      '⭐⭐⭐ the queue did not open',
    );
    const queueText = await page.innerText('#ticket-list');
    assert.ok(queueText.includes(subject), `⭐⭐⭐ the new ticket is not in the queue: ${queueText}`);
    const counter = await page.innerText('#unassigned-counter');
    assert.ok(Number(counter) >= 1, `⭐⭐⭐ the counter of the queue is wrong: ${counter}`);
    await page.screenshot({
      path: path.join(SHOT_DIR, 'tickets-mobile-unassigned-queue.png'),
      fullPage: true,
    });
    // ⭐⭐⭐ ③ the owner assigns it (the existing path of the assignment).
    await page.evaluate(
      `(() => {
        const rows = Array.from(document.querySelectorAll('#ticket-list .ticket'));
        const row = rows.find((node) => node.textContent.includes(${JSON.stringify(subject)}));
        (row ?? rows[0]).click();
      })()`,
    );
    await page.waitForTimeout(1000);
    assert.equal(await page.isVisible('#edit-block'), true, '⭐⭐⭐ the form of the edit is not visible');
    assert.equal(
      await page.isVisible('#assignee-field'),
      true,
      '⭐⭐⭐ the field of the assignment is not visible (the owner may assign)',
    );
    await page.selectOption('#edit-assignee', agentId);
    await page.click('#btn-save');
    await page.waitForTimeout(1500);
    const assigneeAfter = await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
      const result = await uow.query<{ assignee_actor_id: string | null }>(
        `select assignee_actor_id from support_tickets where tenant_id = $1 and ref = $2`,
        [tenantId, createdRef],
      );
      return result.rows[0]?.assignee_actor_id ?? null;
    });
    assert.equal(assigneeAfter, agentId, `⭐⭐⭐ the assignment did not land: ${assigneeAfter}`);
    // ⭐⭐⭐ ④ the ticket LEFT the queue ⇒ ⭐⭐⭐ and the counter dropped.
    await page.click('#btn-back');
    await page.waitForTimeout(900);
    await page.click('#btn-unassigned');
    await page.waitForTimeout(1200);
    const queueAfter = await page.innerText('#ticket-list');
    assert.ok(
      !queueAfter.includes(subject),
      `⭐⭐⭐ the assigned ticket is still in the queue: ${queueAfter}`,
    );
    const counterAfter = await page.innerText('#unassigned-counter');
    assert.ok(
      Number(counterAfter) < Number(counter),
      `⭐⭐⭐ the counter did not drop: ${counter} ⇒ ${counterAfter}`,
    );
  });

  await t.test('⭐⭐⭐ M-119-2: the queue keeps the RIGHTS of the role (the employee never assigns)', async () => {
    await page.goto(`${base}/ui/tickets.html`);
    await page.waitForTimeout(600);
    await offerDrillAccounts(page, TENANT_ID, [
      [OWNER_ID, 'UI owner'],
      [AGENT_ID, 'UI agent'],
      [VIEWER_ID, 'UI viewer'],
    ]);
    if (await page.isVisible('#btn-logout')) {
      await page.click('#btn-logout');
      await page.waitForTimeout(600);
    }
    await page.selectOption('#login-tenant', TENANT_ID);
    await page.selectOption('#login-user', AGENT_ID);
    await page.click('#btn-login');
    await page.waitForTimeout(1300);
    await page.click('#btn-unassigned');
    await page.waitForTimeout(1200);
    // ⭐⭐⭐ the queue of the employee is EMPTY (their scope).
    const rows = await countOf(page, '#ticket-list .ticket');
    assert.equal(rows, 0, `⭐⭐⭐ the employee sees ${rows} ticket(s) in the queue`);
    const counter = await page.innerText('#unassigned-counter');
    assert.equal(Number(counter), 0, `⭐⭐⭐ the counter of the employee is ${counter}`);
    // ⭐⭐⭐ and there is NO button of the assignment for them.
    const assignButtons = await countOf(page, '#ticket-list .assign-button');
    assert.equal(assignButtons, 0, '⭐⭐⭐ the employee sees the button of the assignment');
    // ⭐⭐⭐ and the server refuses the write even when the page is asked
    // ⭐⭐⭐ directly (the button is NEVER an authorization).
    const direct = await page.evaluate(
      `fetch('/api/tickets/tkt_${TENANT_ID}_does_not_exist', {
         method: 'PATCH',
         headers: {
           'content-type': 'application/json',
           authorization: 'Bearer ' + JSON.parse(sessionStorage.getItem('wasl_session_v1')).token,
         },
         body: JSON.stringify({ version: 1, assignee_actor_id: ${JSON.stringify(OWNER_ID)} }),
       }).then((answer) => answer.status)`,
    );
    assert.equal(
      Number(direct),
      403,
      `⭐⭐⭐ the server accepted the assignment of the employee: ${direct}`,
    );
  });

  // ============================================================
  // M-121 — the fields of the assignment appear ONLY when the
  //          ticket really opened
  // ============================================================

  await t.test('⭐⭐⭐ M-121-4: a FAILED opening leaves the fields of the assignment hidden', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/ui/tickets.html`);
    await page.waitForTimeout(700);
    await offerDrillAccounts(page, TENANT_ID, [
      [OWNER_ID, 'UI owner'],
      [AGENT_ID, 'UI agent'],
      [VIEWER_ID, 'UI viewer'],
    ]);
    if (await page.isVisible('#btn-logout')) {
      await page.click('#btn-logout');
      await page.waitForTimeout(600);
    }
    await page.selectOption('#login-tenant', TENANT_ID);
    await page.selectOption('#login-user', OWNER_ID);
    await page.click('#btn-login');
    await page.waitForTimeout(1300);
    await page.click('#btn-unassigned');
    await page.waitForTimeout(1200);
    const assignButtons = await countOf(page, '#ticket-list .assign-button');
    assert.ok(assignButtons > 0, '⭐⭐⭐ the queue of the owner has no button of the assignment');
    // ⭐⭐⭐ THE OPENING FAILS: ⭐⭐⭐ the request of the detail of the
    // ⭐⭐⭐ ticket is answered with an error ⇒ ⇒ ⇒ (the server is
    // ⭐⭐⭐ real, only ITS answer for that one request is broken).
    await page.route('**/api/tickets/*', async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: { code: 'ticket_not_found', message: 't' } }),
      });
    });
    await page.evaluate(
      `(() => {
        const button = document.querySelector('#ticket-list .assign-button');
        if (button) button.click();
      })()`,
    );
    await page.waitForTimeout(1200);
    // ⭐⭐⭐ THE ASSERTION: ⭐⭐⭐ the fields of the assignment do NOT
    // ⭐⭐⭐ appear ⇒ ⇒ ⇒ (the screen never shows a form of a ticket
    // ⭐⭐⭐ that was never loaded).
    assert.equal(
      await page.isVisible('#assignee-field'),
      false,
      '⭐⭐⭐ the fields of the assignment appeared although the opening failed',
    );
    // ⭐⭐⭐ and the failure is TOLD to the user (the message of the
    // ⭐⭐⭐ error ⇒ ⇒ ⇒ not a silent nothing).
    const failureText = (await page.textContent('#detail-error')) ?? '';
    assert.ok(
      failureText.trim().length > 0,
      '⭐⭐⭐ the failure of the opening was not told to the user',
    );
    await page.unroute('**/api/tickets/*');
  });
});

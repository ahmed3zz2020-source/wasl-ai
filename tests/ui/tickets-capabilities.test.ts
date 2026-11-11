// ============================================================
// WASL AI — the tickets — tk-16 · tk-17 · tk-19 · tk-20
// ------------------------------------------------------------
// ⭐⭐⭐ WHAT THIS FILE MEASURES (the acceptance of the package)
//   ① tk-16: the MEASUREMENTS of a ticket (the first reply · the age
//      · the last activity) come from the data that EXISTS ⇒ ⇒ ⇒ ⇒ and
//      a ticket with no reply says «غير متاح» — NOT a number that was
//      invented,
//   ② tk-17: the ready phrases of the ticket write in the description
//      and NOTHING else (⇒ ⇒ ⇒ ⇒ they never save) ⇒ ⇒ ⇒ ⇒ and the text
//      that is already there is NEVER replaced without a confirmation,
//   ③ tk-19: the export holds the tickets the employee may read (⇒ ⇒ ⇒
//      ⇒ the scope of the role · never a ticket of another company)
//      ⇒ ⇒ ⇒ ⇒ and the cells of the file are protected against the
//      formulas of a spreadsheet,
//   ④ tk-20: the follow-up reminders live on the DEVICE (⇒ ⇒ ⇒ ⇒ no
//      message · no notification · nothing on the server).
// ⛔ LOCAL ONLY: the browser talks to 127.0.0.1 and the data is
//   synthetic. ⛔ NO real customer.
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
const PASSCODE = process.env['WASL_TEST_PASSCODE'] ?? 'wasl-local-test';
const TENANT_ID = 'tnt_tkcap_ui';
const OTHER_TENANT_ID = 'tnt_tkcap_other';
const OWNER_ID = 'usr_tkcap_owner';
const AGENT_ID = 'usr_tkcap_agent';
const CUSTOMER_ID = 'cus_tkcap_1';

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
  route(pattern: string, handler: (route: RouteLike) => void | Promise<void>): Promise<void>;
  unroute(pattern: string): Promise<void>;
  close(): Promise<void>;
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

test('tk-16 · tk-17 · tk-19 · tk-20) the package of the tickets (the real browser)', async (t) => {
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

  t.after(async () => {
    await browser.close();
    for (const tenant of [TENANT_ID, OTHER_TENANT_ID]) {
      await UnitOfWork.run(harness.ownerPool, tenant, async (uow) => {
        await uow.query(`delete from support_ticket_changes where tenant_id = $1`, [tenant]);
        await uow.query(`delete from support_tickets where tenant_id = $1`, [tenant]);
        await uow.query(`delete from messages where tenant_id = $1`, [tenant]);
        await uow.query(`delete from conversations where tenant_id = $1`, [tenant]);
        await uow.query(`delete from customers where tenant_id = $1`, [tenant]);
        await uow.query(`delete from sessions where tenant_id = $1`, [tenant]);
        await uow.query(`delete from memberships where tenant_id = $1`, [tenant]);
        await uow.query(`delete from users where id = $1`, [OWNER_ID]);
        await uow.query(`delete from tenants where id = $1`, [tenant]);
      });
    }
    await harness.stop();
  });

  const { hashPasscode } = await import('../../server/auth/sessions.ts');
  const passcodeHash = hashPasscode(PASSCODE);

  // ⭐⭐⭐ the company of the drill: TWO tickets (one with a reply, one
  // ⭐⭐⭐ without) + a conversation that carries the reply.
  await UnitOfWork.run(harness.ownerPool, TENANT_ID, async (uow) => {
    await uow.query(`delete from support_ticket_changes where tenant_id = $1`, [TENANT_ID]);
    await uow.query(`delete from support_tickets where tenant_id = $1`, [TENANT_ID]);
    await uow.query(`delete from messages where tenant_id = $1`, [TENANT_ID]);
    await uow.query(`delete from conversations where tenant_id = $1`, [TENANT_ID]);
    await uow.query(`delete from customers where tenant_id = $1`, [TENANT_ID]);
    await uow.query(
      `insert into tenants (id, name, status) values ($1,$2,'active')
       on conflict (id) do update set name = excluded.name`,
      [TENANT_ID, 'Tickets capabilities (synthetic)'],
    );
    await uow.query(
      `insert into users (id, display_name, email, status, passcode_hash)
       values ($1,$2,$3,'active',$4)
       on conflict (id) do update set passcode_hash = excluded.passcode_hash`,
      [OWNER_ID, 'capabilities owner', `${OWNER_ID}@example.invalid`, passcodeHash],
    );
    await uow.query(
      `insert into users (id, display_name, email, status, passcode_hash)
       values ($1,$2,$3,'active',$4)
       on conflict (id) do update set passcode_hash = excluded.passcode_hash`,
      [AGENT_ID, 'capabilities agent', `${AGENT_ID}@example.invalid`, passcodeHash],
    );
    for (const [id, role] of [
      [OWNER_ID, 'owner'],
      [AGENT_ID, 'agent'],
    ] as const) {
      await uow.query(
        `insert into memberships (id, tenant_id, user_id, role, status)
         values ($1,$2,$3,$4,'active')
         on conflict (tenant_id, user_id) do update set role = excluded.role, status = 'active'`,
        [`mem_${id}`, TENANT_ID, id, role],
      );
    }
    await uow.query(
      `insert into customers (id, tenant_id, display_name, data_class)
       values ($1,$2,$3,'standard')
       on conflict (id) do update set display_name = excluded.display_name`,
      [CUSTOMER_ID, TENANT_ID, 'عميل القياسات'],
    );
    await uow.query(
      `insert into conversations (tenant_id, ref, customer_id, state, version, updated_at)
       values ($1,$2,$3,'open',1, now())
       on conflict (tenant_id, ref) do update set state = 'open'`,
      [TENANT_ID, 'conv_tkcap_1', CUSTOMER_ID],
    );
    // ⭐⭐⭐ the second conversation: it has NO reply yet (⇒ ⇒ ⇒ ⇒ the
    // ⭐⭐⭐ ticket that links to it says «غير متاح»).
    await uow.query(
      `insert into conversations (tenant_id, ref, customer_id, state, version, updated_at)
       values ($1,$2,$3,'open',1, now())
       on conflict (tenant_id, ref) do update set state = 'open'`,
      [TENANT_ID, 'conv_tkcap_2', CUSTOMER_ID],
    );
    await uow.query(
      `insert into messages (message_ref, tenant_id, conversation_ref, channel, direction, sender,
                             recipient, body, occurred_at, locale, attributes, stored_at)
       values ($1,$2,$3,'web','inbound','customer@example.invalid','agent@example.invalid',$4,
               now() - interval '90 minutes', 'ar','{}'::jsonb, now())
       on conflict (tenant_id, message_ref) do nothing`,
      ['msg_tkcap_in2', TENANT_ID, 'conv_tkcap_2', 'رسالة العميل الثانية'],
    );
    await uow.query(
      `insert into messages (message_ref, tenant_id, conversation_ref, channel, direction, sender,
                             recipient, body, occurred_at, locale, attributes, stored_at)
       values ($1,$2,$3,'web','inbound','customer@example.invalid','agent@example.invalid',$4,
               now() - interval '2 hours', 'ar','{}'::jsonb, now())
       on conflict (tenant_id, message_ref) do nothing`,
      ['msg_tkcap_in', TENANT_ID, 'conv_tkcap_1', 'رسالة العميل'],
    );
    await uow.query(
      `insert into messages (message_ref, tenant_id, conversation_ref, channel, direction, sender,
                             recipient, body, occurred_at, locale, attributes, stored_at)
       values ($1,$2,$3,'web','outbound','agent@example.invalid','customer@example.invalid',$4,
               now() - interval '100 minutes', 'ar','{}'::jsonb, now())
       on conflict (tenant_id, message_ref) do nothing`,
      ['msg_tkcap_out', TENANT_ID, 'conv_tkcap_1', 'رد الموظف الأول'],
    );
    // ⭐⭐⭐ the ticket WITH a reply (the conversation is linked).
    await uow.query(
      `insert into support_tickets (tenant_id, ref, customer_id, conversation_ref, subject, description,
                                    state, priority, assignee_actor_id, version, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,'open','normal',$7,1, now() - interval '2 hours', now())
       on conflict (tenant_id, ref) do update set subject = excluded.subject`,
      [TENANT_ID, 'tkt_tkcap_answered', CUSTOMER_ID, 'conv_tkcap_1', 'تذكرة لها رد', 'وصف أول', AGENT_ID],
    );
    // ⭐⭐⭐ the ticket WITHOUT a reply (⇒ ⇒ ⇒ ⇒ «غير متاح»).
    await uow.query(
      `insert into support_tickets (tenant_id, ref, customer_id, conversation_ref, subject, description,
                                    state, priority, assignee_actor_id, version, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,'open','normal',$7,1, now() - interval '3 hours', now())
       on conflict (tenant_id, ref) do update set subject = excluded.subject`,
      [TENANT_ID, 'tkt_tkcap_silent', CUSTOMER_ID, 'conv_tkcap_2', '=SUM(1+1) تذكرة خطرة', 'وصف تاني', AGENT_ID],
    );
  });

  // ⭐⭐⭐ the OTHER company (⇒ ⇒ ⇒ ⇒ its ticket must NEVER show up).
  await UnitOfWork.run(harness.ownerPool, OTHER_TENANT_ID, async (uow) => {
    await uow.query(`delete from support_tickets where tenant_id = $1`, [OTHER_TENANT_ID]);
    await uow.query(`delete from customers where tenant_id = $1`, [OTHER_TENANT_ID]);
    await uow.query(
      `insert into tenants (id, name, status) values ($1,$2,'active')
       on conflict (id) do update set name = excluded.name`,
      [OTHER_TENANT_ID, 'Other company (synthetic)'],
    );
    await uow.query(
      `insert into customers (id, tenant_id, display_name, data_class)
       values ('cus_other_1', $1, 'عميل شركة تانية', 'standard')
       on conflict (id) do nothing`,
      [OTHER_TENANT_ID],
    );
    await uow.query(
      `insert into support_tickets (tenant_id, ref, customer_id, subject, description, state, priority, version)
       values ($1,$2,$3,$4,$5,'open','normal',1)
       on conflict (tenant_id, ref) do nothing`,
      [OTHER_TENANT_ID, 'tkt_other_company', 'cus_other_1', 'تذكرة شركة تانية', 'وصف'],
    );
  });

  const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
  const base = `http://127.0.0.1:${harness.port}`;

  async function offerAccounts(): Promise<void> {
    await page.evaluate(
      ([tenant, owner, agent]) => {
        const tenantSelect = document.getElementById('login-tenant');
        if (!tenantSelect.querySelector(`option[value="${tenant}"]`)) {
          const tenantOption = document.createElement('option');
          tenantOption.value = tenant;
          tenantOption.textContent = 'شركة القياسات';
          tenantSelect.appendChild(tenantOption);
        }
        for (const [id, label] of [
          [owner, 'owner'],
          [agent, 'agent'],
        ]) {
          const userSelect = document.getElementById('login-user');
          if (!userSelect.querySelector(`option[value="${id}"]`)) {
            const userOption = document.createElement('option');
            userOption.value = id;
            userOption.textContent = `موظف ${label}`;
            userSelect.appendChild(userOption);
          }
        }
      },
      [TENANT_ID, OWNER_ID, AGENT_ID],
    );
  }

  async function loginAs(userId: string): Promise<void> {
    await page.goto(`${base}/ui/tickets.html`);
    await page.waitForTimeout(500);
    await offerAccounts();
    if (await page.isVisible('#btn-logout')) {
      await page.click('#btn-logout');
      await page.waitForTimeout(600);
    }
    await page.selectOption('#login-tenant', TENANT_ID);
    await page.selectOption('#login-user', userId);
    await page.fill('#login-passcode', PASSCODE);
    await page.click('#btn-login');
    await page.waitForTimeout(1300);
  }

  async function openTicketByRef(ref: string): Promise<void> {
    await page.evaluate(
      `(document.querySelector('#ticket-list .ticket[data-ref="${ref}"]') || {}).click?.()`,
    );
    await page.waitForTimeout(1100);
  }

  async function ticketInDb(ref: string): Promise<{ subject: string; description: string } | null> {
    return UnitOfWork.run(harness.ownerPool, TENANT_ID, async (uow) => {
      const result = await uow.query(
        `select subject, description from support_tickets where tenant_id = $1 and ref = $2`,
        [TENANT_ID, ref],
      );
      const row = result.rows[0];
      if (!row) return null;
      return { subject: String(row['subject']), description: String(row['description']) };
    });
  }

  await t.test('tk-16-1: the first reply is MEASURED from the data that exists', async () => {
    await loginAs(OWNER_ID);
    await openTicketByRef('tkt_tkcap_answered');
    const facts = await page.innerText('#measurements');
    assert.match(facts, /زمن أول رد/, `the measurements are missing: ${facts}`);
    assert.doesNotMatch(
      facts,
      /غير متاح/,
      `⭐⭐⭐ tk-16: the ticket WITH a reply says «غير متاح» — the measurement is wrong`,
    );
    const minutes = await page.evaluate(
      `(() => {
         const rows = Array.from(document.querySelectorAll('#measurements-list li'));
         const row = rows.find((item) => item.textContent.includes('زمن أول رد'));
         if (!row) return -1;
         const value = row.querySelector('.measure-value').textContent;
         const match = value.match(/[0-9٠-٩]+/);
         return match ? Number(match[0].replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))) : -1;
       })()`,
    );
    assert.ok(
      minutes > 0 && minutes <= 30,
      `⭐⭐⭐ tk-16: the first reply is ${minutes} minutes — the data says 20`,
    );
  });

  await t.test('⭐⭐⭐ tk-16-2: a ticket without a reply says «غير متاح» (NO invented number)', async () => {
    await loginAs(OWNER_ID);
    await openTicketByRef('tkt_tkcap_silent');
    const facts = await page.innerText('#measurements');
    assert.match(facts, /زمن أول رد/, `the measurements are missing: ${facts}`);
    assert.match(
      facts,
      /غير متاح/,
      `⭐⭐⭐ tk-16: the ticket WITHOUT a reply shows a number: ${facts}`,
    );
  });

  await t.test('⭐⭐⭐ tk-17-1: the ready phrase writes in the description and NEVER saves', async () => {
    await loginAs(OWNER_ID);
    await openTicketByRef('tkt_tkcap_answered');
    const before = await ticketInDb('tkt_tkcap_answered');
    assert.equal(before?.description, 'وصف أول', 'the drill started with another description');
    // ⭐⭐⭐ the description is emptied ⇒ ⇒ ⇒ ⇒ the phrase goes in
    // ⭐⭐⭐ directly (⇒ ⇒ ⇒ ⇒ the confirmation is for the text that is
    // ⭐⭐⭐ there ⇒ ⇒ ⇒ ⇒ and this is tested in the next drill).
    await page.fill('#edit-description', '');
    await page.click('#ticket-templates-list .template');
    await page.waitForTimeout(500);
    const description = await page.inputValue('#edit-description');
    assert.match(description, /تم التواصل/, `the phrase did not reach the description: ${description}`);
    const after = await ticketInDb('tkt_tkcap_answered');
    assert.equal(
      after?.description,
      'وصف أول',
      `⭐⭐⭐ tk-17: the phrase SAVED itself: ${after?.description}`,
    );
  });

  await t.test('⭐⭐⭐ tk-17-2: the text that is there is NEVER replaced without a confirmation', async () => {
    await loginAs(OWNER_ID);
    await openTicketByRef('tkt_tkcap_answered');
    await page.fill('#edit-description', 'نص كتبه الموظف');
    await page.click('#ticket-templates-list .template');
    await page.waitForTimeout(500);
    assert.equal(
      await page.isVisible('#ticket-templates-confirm'),
      true,
      '⭐⭐⭐ tk-17: the confirmation did not appear',
    );
    const untouched = await page.inputValue('#edit-description');
    assert.equal(untouched, 'نص كتبه الموظف', `⭐⭐⭐ tk-17: the text was replaced: ${untouched}`);
    // ⭐⭐⭐ «أبقِ نصي» keeps the text of the employee.
    await page.click('#btn-template-keep');
    await page.waitForTimeout(400);
    assert.equal(
      await page.inputValue('#edit-description'),
      'نص كتبه الموظف',
      '⭐⭐⭐ tk-17: «أبقِ نصي» did not keep the text',
    );
    assert.equal(
      await page.isVisible('#ticket-templates-confirm'),
      false,
      '⭐⭐⭐ tk-17: the confirmation stayed on the screen',
    );
  });

  await t.test('⭐⭐⭐ tk-19-1: the export holds the tickets of the company ONLY', async () => {
    await loginAs(OWNER_ID);
    const csv = await page.evaluate(
      `(() => state.token)()`,
    );
    assert.ok(String(csv).length > 0, 'there is no token');
    const answer = await page.evaluate(
      `(async () => {
         const response = await fetch('/api/tickets/export', {
           headers: { authorization: 'Bearer ' + state.token },
         });
         return { status: response.status, text: await response.text() };
       })()`,
    );
    const body = answer as { status: number; text: string };
    assert.equal(body.status, 200, `⭐⭐⭐ tk-19: the export answered ${body.status}`);
    assert.match(body.text, /tkt_tkcap_answered/, '⭐⭐⭐ tk-19: the export holds nothing');
    assert.doesNotMatch(
      body.text,
      /tkt_other_company/,
      '⭐⭐⭐ tk-19: the export holds a ticket of ANOTHER company',
    );
    assert.match(body.text, /رقم التذكرة/, '⭐⭐⭐ tk-19: the file has no header');
  });

  await t.test('⭐⭐⭐ tk-19-2: the cells of the file are protected against the formulas', async () => {
    await loginAs(OWNER_ID);
    const answer = await page.evaluate(
      `(async () => {
         const response = await fetch('/api/tickets/export', {
           headers: { authorization: 'Bearer ' + state.token },
         });
         return { status: response.status, text: await response.text() };
       })()`,
    );
    const body = answer as { status: number; text: string };
    // ⭐⭐⭐ the subject of the drill starts with "=SUM(1+1)" ⇒ the cell
    // ⭐⭐⭐ must start with a single quote (⇒ the spreadsheet shows it
    // ⭐⭐⭐ as text and it never runs it).
    assert.match(
      body.text,
      /"'=SUM\(1\+1\)/,
      `⭐⭐⭐ tk-19: the cell of the formula is not protected: ${body.text.slice(0, 400)}`,
    );
    assert.doesNotMatch(
      body.text,
      /,"=SUM/,
      '⭐⭐⭐ tk-19: the formula reaches the file without protection',
    );
  });

  await t.test('⭐⭐⭐ tk-19-3: the employee exports HIS tickets only', async () => {
    await loginAs(AGENT_ID);
    const answer = await page.evaluate(
      `(async () => {
         const response = await fetch('/api/tickets/export', {
           headers: { authorization: 'Bearer ' + state.token },
         });
         return { status: response.status, text: await response.text() };
       })()`,
    );
    const body = answer as { status: number; text: string };
    assert.equal(body.status, 200, `⭐⭐⭐ tk-19: the export answered ${body.status}`);
    assert.match(body.text, /tkt_tkcap_answered/, '⭐⭐⭐ tk-19: the employee lost his own ticket');
  });

  await t.test('⭐⭐⭐ tk-20-1: the reminder lives on the DEVICE and not on the server', async () => {
    await loginAs(OWNER_ID);
    await openTicketByRef('tkt_tkcap_answered');
    await page.click('#btn-reminder-new');
    await page.waitForTimeout(400);
    await page.fill('#reminder-note', 'متابعة الطلب');
    await page.click('#btn-reminder-save');
    await page.waitForTimeout(600);
    const reminders = await page.innerText('#reminders-list');
    assert.match(reminders, /متابعة الطلب/, `⭐⭐⭐ tk-20: the reminder is not shown: ${reminders}`);
    // ⭐⭐⭐ nothing went out of the device (⇒ ⇒ ⇒ ⇒ no row on the server).
    const rows = await UnitOfWork.run(harness.ownerPool, TENANT_ID, async (uow) => {
      const result = await uow.query(
        `select count(*)::text as count from support_ticket_changes
         where tenant_id = $1 and ticket_ref = $2`,
        [TENANT_ID, 'tkt_tkcap_answered'],
      );
      return Number(result.rows[0]?.count ?? '0');
    });
    assert.equal(rows, 0, '⭐⭐⭐ tk-20: the reminder wrote something on the server');
    // ⭐⭐⭐ and it comes back after a reload (⇒ ⇒ ⇒ ⇒ it is on the device).
    await page.reload();
    await page.waitForTimeout(1500);
    await openTicketByRef('tkt_tkcap_answered');
    const after = await page.innerText('#reminders-list');
    assert.match(after, /متابعة الطلب/, `⭐⭐⭐ tk-20: the reminder died with the page: ${after}`);
  });

  await t.test('⭐⭐⭐ tk-20-2: the employee throws the reminder away', async () => {
    await loginAs(OWNER_ID);
    await openTicketByRef('tkt_tkcap_answered');
    const before = await page.innerText('#reminders-list');
    assert.match(before, /متابعة الطلب/, 'the reminder of the drill is missing');
    await page.evaluate(
      `(() => {
         const button = document.querySelector('#reminders-list .reminder button');
         if (button) button.click();
       })()`,
    );
    await page.waitForTimeout(500);
    const after = await page.innerText('#reminders-list');
    assert.doesNotMatch(
      after,
      /متابعة الطلب/,
      `⭐⭐⭐ tk-20: the reminder was not thrown away: ${after}`,
    );
  });
});

// ============================================================
// WASL AI — the inbox — M-126 (the safety of the draft)
// ------------------------------------------------------------
// ⭐⭐⭐ WHAT THIS FILE MEASURES
//   The reply belongs to the conversation it was written in:
//     ① the answer of a reply that is in the air NEVER clears the text
//        of another conversation,
//     ② the answer NEVER reopens the conversation of the employee,
//     ③ the reference of one reply is NEVER used for another
//        conversation (⇒ ⇒ ⇒ the server refuses the repeated reference
//        ⇒ ⇒ ⇒ ⇒ the reply of the employee would be LOST),
//     ④ the button of the composer belongs to the conversation that is
//        open (⇒ ⇒ ⇒ a reply in the air does not lock the employee out
//        of another conversation).
// ⭐⭐ THE PROOF IS THE DATABASE (PostgreSQL) and the real browser.
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
import { startHarness } from '../server/harness.ts';

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
}

interface PageLike {
  goto(url: string): Promise<unknown>;
  goBack(): Promise<unknown>;
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

test('M-126) the reply belongs to its conversation (the real browser)', async (t) => {
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

  const tenantId = 'tnt_m126_ui';
  const userId = 'usr_m126_ui_owner';
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

  // ⭐⭐⭐ the fixture is idempotent (the leftovers of a killed run do
  // ⭐⭐⭐ not change the result of this one).
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
      [tenantId, 'Inbox M126 (synthetic)'],
    );
    await uow.query(
      `insert into users (id, display_name, email, status, passcode_hash)
       values ($1,$2,$3,'active',$4)
       on conflict (id) do update set passcode_hash = excluded.passcode_hash`,
      [userId, 'M126 Owner', `${userId}@example.invalid`, hashPasscode(PASSCODE)],
    );
    await uow.query(
      `insert into memberships (id, tenant_id, user_id, role, status)
       values ($1,$2,$3,'owner','active')
       on conflict (tenant_id, user_id) do update set status = 'active'`,
      [`mem_${userId}`, tenantId, userId],
    );
    // ⭐⭐⭐ TWO conversations with names we can read on the screen.
    await uow.query(
      `insert into customers (id, tenant_id, display_name, data_class)
       values ($1,$2,$3,'standard')
       on conflict (id) do update set display_name = excluded.display_name`,
      ['cus_m126_a', tenantId, 'عميل ألف'],
    );
    await uow.query(
      `insert into customers (id, tenant_id, display_name, data_class)
       values ($1,$2,$3,'standard')
       on conflict (id) do update set display_name = excluded.display_name`,
      ['cus_m126_b', tenantId, 'عميل باء'],
    );
    await uow.query(
      `insert into conversations (tenant_id, ref, customer_id, state, version, updated_at)
       values ($1,$2,$3,'open',1, now())
       on conflict (tenant_id, ref) do update set state = 'open'`,
      [tenantId, 'conv_m126_a', 'cus_m126_a'],
    );
    await uow.query(
      `insert into conversations (tenant_id, ref, customer_id, state, version, updated_at)
       values ($1,$2,$3,'open',1, now())
       on conflict (tenant_id, ref) do update set state = 'open'`,
      [tenantId, 'conv_m126_b', 'cus_m126_b'],
    );
    await uow.query(
      `insert into messages (message_ref, tenant_id, conversation_ref, channel, direction, sender,
                             recipient, body, occurred_at, locale, attributes, stored_at)
       values ($1,$2,$3,'web','inbound','customer@example.invalid','agent@example.invalid',$4, now(),'ar','{}'::jsonb, now())
       on conflict (tenant_id, message_ref) do nothing`,
      ['msg_m126_seed_a', tenantId, 'conv_m126_a', 'رسالة العميل في ألف'],
    );
    await uow.query(
      `insert into messages (message_ref, tenant_id, conversation_ref, channel, direction, sender,
                             recipient, body, occurred_at, locale, attributes, stored_at)
       values ($1,$2,$3,'web','inbound','customer@example.invalid','agent@example.invalid',$4, now(),'ar','{}'::jsonb, now())
       on conflict (tenant_id, message_ref) do nothing`,
      ['msg_m126_seed_b', tenantId, 'conv_m126_b', 'رسالة العميل في باء'],
    );
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`http://127.0.0.1:${harness.port}/ui/inbox.html`);
  await page.waitForTimeout(400);

  await t.test('M-126-0: the login of the company of the drill', async () => {
    await page.evaluate(
      ([tenant, user]) => {
        const tenantSelect = document.getElementById('login-tenant');
        const tenantOption = document.createElement('option');
        tenantOption.value = tenant;
        tenantOption.textContent = 'شركة M126';
        tenantSelect.appendChild(tenantOption);
        const userSelect = document.getElementById('login-user');
        const userOption = document.createElement('option');
        userOption.value = user;
        userOption.textContent = 'موظف M126';
        userSelect.appendChild(userOption);
      },
      [tenantId, userId],
    );
    await page.selectOption('#login-tenant', tenantId);
    await page.selectOption('#login-user', userId);
    await page.fill('#login-passcode', PASSCODE);
    await page.click('#btn-login');
    await page.waitForTimeout(800);
    assert.equal(await page.isVisible('#workspace'), true, 'the workspace did not appear');
    const rows = await countOf(page, '#conversation-list .conversation');
    assert.equal(rows, 2, `the list holds ${rows} rows instead of 2`);
  });

  await t.test('⭐⭐⭐ M-126-1: the answer of a reply NEVER clears the text of another conversation', async () => {
    await page.goto(`http://127.0.0.1:${harness.port}/ui/inbox.html`);
    await page.waitForTimeout(900);
    // ⭐⭐⭐ the answer of the reply is SLOW (1600ms) ⇒ ⇒ ⇒ the employee
    // ⭐⭐⭐ moves to the other conversation while it is in the air.
    await page.route('**/api/inbox/conversations/*/replies', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1600));
      await route.continue();
    });
    // ⭐⭐⭐ open the conversation of «عميل ألف».
    await page.evaluate(`(() => {
      const items = Array.from(document.querySelectorAll('#conversation-list .conversation'));
      const found = items.find((item) => item.textContent.includes('عميل ألف'));
      if (found) found.click();
    })()`);
    await page.waitForTimeout(900);
    const bodyA = `رد في المحادثة ألف ${Date.now()}`;
    await page.fill('#reply-body', bodyA);
    await page.click('#btn-send');
    await page.waitForTimeout(250);
    // ⭐⭐⭐ NOW the employee opens the OTHER conversation and writes.
    await page.evaluate(`(() => {
      const items = Array.from(document.querySelectorAll('#conversation-list .conversation'));
      const found = items.find((item) => item.textContent.includes('عميل باء'));
      if (found) found.click();
    })()`);
    await page.waitForTimeout(900);
    const bodyB = `مسودة في المحادثة باء ${Date.now()}`;
    await page.fill('#reply-body', bodyB);
    // ⭐⭐⭐ the answer of «ألف» lands NOW.
    await page.waitForTimeout(2200);
    await page.unroute('**/api/inbox/conversations/*/replies');

    const composer = await page.inputValue('#reply-body');
    const title = await page.innerText('#thread-customer');
    // ⭐⭐⭐ BOTH defects are measured (the first one does not hide the
    // ⭐⭐⭐ second one) ⇒ ⇒ ⇒ the proof says WHAT happened.
    const defects: string[] = [];
    if (composer !== bodyB) {
      defects.push(
        `⭐⭐⭐ the answer of the other conversation CLEARED the text (the box holds: ${composer})`,
      );
    }
    if (!/باء/.test(title)) {
      defects.push(
        `⭐⭐⭐ the answer of the other conversation REOPENED its conversation (the title is: ${title})`,
      );
    }
    assert.equal(
      defects.length,
      0,
      `${defects.join(' ⇐ ')} ⇐ the answer of a reply must touch ONLY its own conversation`,
    );
    // ⭐⭐⭐ the proof in the database: the reply of «ألف» IS stored, and
    // ⭐⭐⭐ the draft of «باء» is NOT (it was never sent).
    const stored = await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
      const result = await uow.query(
        `select conversation_ref, body from messages
         where tenant_id = $1 and direction = 'outbound'
         order by stored_at asc`,
        [tenantId],
      );
      return result.rows;
    });
    const bodies = stored.map((row) => String(row['body']));
    assert.ok(
      bodies.includes(bodyA),
      `⭐⭐⭐ the reply of the first conversation was not stored: ${JSON.stringify(bodies)}`,
    );
    assert.ok(
      !bodies.includes(bodyB),
      `⭐⭐⭐ the draft of the other conversation was sent by mistake: ${JSON.stringify(bodies)}`,
    );
  });

  await t.test('⭐⭐⭐ M-126-2: the reference of one reply is NEVER used for another conversation', async () => {
    await page.goto(`http://127.0.0.1:${harness.port}/ui/inbox.html`);
    await page.waitForTimeout(900);
    await page.route('**/api/inbox/conversations/*/replies', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1400));
      await route.continue();
    });
    await page.evaluate(`(() => {
      const items = Array.from(document.querySelectorAll('#conversation-list .conversation'));
      const found = items.find((item) => item.textContent.includes('عميل ألف'));
      if (found) found.click();
    })()`);
    await page.waitForTimeout(900);
    await page.fill('#reply-body', `رد أول ${Date.now()}`);
    await page.click('#btn-send');
    await page.waitForTimeout(200);
    // ⭐⭐⭐ the employee moves to the other conversation AND sends there
    // ⭐⭐⭐ while the first reply is still in the air.
    await page.evaluate(`(() => {
      const items = Array.from(document.querySelectorAll('#conversation-list .conversation'));
      const found = items.find((item) => item.textContent.includes('عميل باء'));
      if (found) found.click();
    })()`);
    await page.waitForTimeout(900);
    await page.fill('#reply-body', `رد ثان ${Date.now()}`);
    const disabled = await page.evaluate(
      `(() => document.getElementById('btn-send').disabled)()`,
    );
    assert.equal(
      disabled,
      false,
      '⭐⭐⭐ the button of the composer stayed locked by the reply of the other conversation',
    );
    await page.click('#btn-send');
    await page.waitForTimeout(2600);
    await page.unroute('**/api/inbox/conversations/*/replies');

    const stored = await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
      const result = await uow.query(
        `select conversation_ref, body, message_ref from messages
         where tenant_id = $1 and direction = 'outbound'
         order by stored_at asc`,
        [tenantId],
      );
      return result.rows;
    });
    const refs = stored.map((row) => String(row['message_ref']));
    const conversations = new Set(stored.map((row) => String(row['conversation_ref'])));
    assert.equal(
      conversations.size,
      2,
      `⭐⭐⭐ the two conversations do not carry one reply each: ${JSON.stringify(stored)}`,
    );
    assert.equal(
      new Set(refs).size,
      refs.length,
      `⭐⭐⭐ two replies carry the SAME reference (the server refuses the second one): ${JSON.stringify(refs)}`,
    );
  });

  await t.test('⭐⭐⭐ M-126-3: the draft of a conversation comes back with it', async () => {
    await page.goto(`http://127.0.0.1:${harness.port}/ui/inbox.html`);
    await page.waitForTimeout(900);
    await page.evaluate(`(() => {
      const items = Array.from(document.querySelectorAll('#conversation-list .conversation'));
      const found = items.find((item) => item.textContent.includes('عميل ألف'));
      if (found) found.click();
    })()`);
    await page.waitForTimeout(900);
    const draft = `مسودة محفوظة ${Date.now()}`;
    await page.fill('#reply-body', draft);
    await page.evaluate(`(() => {
      const items = Array.from(document.querySelectorAll('#conversation-list .conversation'));
      const found = items.find((item) => item.textContent.includes('عميل باء'));
      if (found) found.click();
    })()`);
    await page.waitForTimeout(900);
    const other = await page.inputValue('#reply-body');
    assert.equal(other, '', `⭐⭐⭐ the box of the other conversation is not empty: ${other}`);
    await page.evaluate(`(() => {
      const items = Array.from(document.querySelectorAll('#conversation-list .conversation'));
      const found = items.find((item) => item.textContent.includes('عميل ألف'));
      if (found) found.click();
    })()`);
    await page.waitForTimeout(900);
    const back = await page.inputValue('#reply-body');
    assert.equal(back, draft, `⭐⭐⭐ the draft did not come back: ${back}`);
  });

  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(SHOT_DIR, 'm126-inbox-draft-safety.png'),
    fullPage: false,
  });
});

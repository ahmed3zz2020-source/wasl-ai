// ============================================================
// WASL AI — the inbox — M-130 (the quick replies)
// ------------------------------------------------------------
// ⭐⭐⭐ WHAT THIS FILE MEASURES
//   The quick replies are a local trial of the employee:
//     ① the section is INSIDE the conversation and it is hidden from
//        the role that may only read (the server announces the right),
//     ② choosing a template puts its text in the composer and NEVER
//        sends it,
//     ③ the employee edits the text and sends it ONCE — and the reply
//        is REALLY in PostgreSQL,
//     ④ the text of the employee is NEVER replaced without a clear
//        confirmation,
//     ⑤ choosing a template does NOT change the reference of the
//        previous reply (⇒ ⇒ ⇒ no repeated reference ⇒ ⇒ ⇒ ⇒ the
//        reply is not lost) and it does NOT cause a repeated send.
// ⛔ LOCAL ONLY: the browser talks to 127.0.0.1 and the data is
//   synthetic. ⛔ NO central management · NO storage of the templates ·
//   NO AI · NO real customer.
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

test('M-130) the quick replies of the inbox (the real browser)', async (t) => {
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

  const tenantId = 'tnt_m130_ui';
  const ownerId = 'usr_m130_ui_owner';
  const viewerId = 'usr_m130_ui_viewer';
  t.after(async () => {
    await browser.close();
    await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
      await uow.query(`delete from messages where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from conversations where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from customers where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from sessions where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from memberships where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from users where id in ($1,$2)`, [ownerId, viewerId]);
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
      [tenantId, 'Inbox M130 (synthetic)'],
    );
    for (const [userId, role] of [
      [ownerId, 'owner'],
      [viewerId, 'viewer'],
    ] as const) {
      await uow.query(
        `insert into users (id, display_name, email, status, passcode_hash)
         values ($1,$2,$3,'active',$4)
         on conflict (id) do update set passcode_hash = excluded.passcode_hash`,
        [userId, `M130 ${role}`, `${userId}@example.invalid`, hashPasscode(PASSCODE)],
      );
      await uow.query(
        `insert into memberships (id, tenant_id, user_id, role, status)
         values ($1,$2,$3,$4,'active')
         on conflict (tenant_id, user_id) do update set role = excluded.role`,
        [`mem_${userId}`, tenantId, userId, role],
      );
    }
    await uow.query(
      `insert into customers (id, tenant_id, display_name, data_class)
       values ($1,$2,$3,'standard')
       on conflict (id) do update set display_name = excluded.display_name`,
      ['cus_m130_1', tenantId, 'عميل القوالب'],
    );
    await uow.query(
      `insert into conversations (tenant_id, ref, customer_id, state, version, updated_at)
       values ($1,$2,$3,'open',1, now())
       on conflict (tenant_id, ref) do update set state = 'open'`,
      [tenantId, 'conv_m130_1', 'cus_m130_1'],
    );
    await uow.query(
      `insert into messages (message_ref, tenant_id, conversation_ref, channel, direction, sender,
                             recipient, body, occurred_at, locale, attributes, stored_at)
       values ($1,$2,$3,'web','inbound','customer@example.invalid','agent@example.invalid',$4, now(),'ar','{}'::jsonb, now())
       on conflict (tenant_id, message_ref) do nothing`,
      ['msg_m130_seed', tenantId, 'conv_m130_1', 'رسالة العميل الأولى'],
    );
  });

  const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
  const url = `http://127.0.0.1:${harness.port}/ui/inbox.html`;

  /** ⭐⭐⭐ the login of a member of the company of the drill. */
  async function loginAs(userId: string): Promise<void> {
    await page.goto(url);
    await page.waitForTimeout(600);
    await page.evaluate(
      `(() => { try { sessionStorage.clear(); } catch {} })()`,
    );
    await page.reload();
    await page.waitForTimeout(900);
    if (await page.isVisible('#workspace')) return;
    await page.evaluate(
      ([tenant, user]) => {
        const tenantSelect = document.getElementById('login-tenant');
        if (!tenantSelect.querySelector(`option[value="${tenant}"]`)) {
          const tenantOption = document.createElement('option');
          tenantOption.value = tenant;
          tenantOption.textContent = 'شركة M130';
          tenantSelect.appendChild(tenantOption);
        }
        const userSelect = document.getElementById('login-user');
        if (!userSelect.querySelector(`option[value="${user}"]`)) {
          const userOption = document.createElement('option');
          userOption.value = user;
          userOption.textContent = `موظف M130 ${user}`;
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

  /** ⭐⭐⭐ open the only conversation of the drill. */
  async function openTheConversation(): Promise<void> {
    await page.evaluate(
      `(() => {
        const item = document.querySelector('#conversation-list .conversation');
        if (item) item.click();
      })()`,
    );
    await page.waitForTimeout(1000);
  }

  /** ⭐⭐⭐ the outbound replies of the company (the proof in the database). */
  async function outboundReplies(): Promise<Array<{ body: string; ref: string }>> {
    const rows = await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
      const result = await uow.query(
        `select body, message_ref from messages
         where tenant_id = $1 and direction = 'outbound'
         order by stored_at asc`,
        [tenantId],
      );
      return result.rows;
    });
    return rows.map((row) => ({ body: String(row['body']), ref: String(row['message_ref']) }));
  }

  await t.test('M-130-0: the login of the company of the drill', async () => {
    await loginAs(ownerId);
    assert.equal(await page.isVisible('#workspace'), true, 'the workspace did not appear');
    await openTheConversation();
    assert.equal(await page.isVisible('#thread'), true, 'the conversation did not open');
  });

  await t.test('⭐⭐⭐ M-130-1: the section of the quick replies is inside the conversation', async () => {
    const section = await page.innerText('#quick-replies');
    assert.match(section, /ردود سريعة/, `the section has no title: ${section}`);
    const templates = await countOf(page, '#quick-replies-list .quick-reply');
    assert.ok(templates >= 3, `the templates are ${templates} instead of 3 or more`);
    const labels = await page.evaluate(
      `Array.from(document.querySelectorAll('#quick-replies-list .quick-reply')).map((b) => b.textContent).join(' | ')`,
    );
    assert.match(labels, /ترحيب/, `the welcome template is missing: ${labels}`);
    assert.match(labels, /متابعة/, `the follow-up template is missing: ${labels}`);
  });

  await t.test('⭐⭐⭐ M-130-2: choosing a template puts the text in the box and NEVER sends it', async () => {
    await loginAs(ownerId);
    await openTheConversation();
    const before = (await outboundReplies()).length;
    await page.click('#quick-replies-list .quick-reply');
    await page.waitForTimeout(500);
    const composer = await page.inputValue('#reply-body');
    assert.ok(composer.length > 0, '⭐⭐⭐ the text of the template did not go into the box');
    const replies = await outboundReplies();
    assert.equal(
      replies.length,
      before,
      `⭐⭐⭐ choosing a template SENT a reply by itself: ${JSON.stringify(replies)}`,
    );
    const messages = await countOf(page, '#messages .message');
    assert.equal(messages, 1, `⭐⭐⭐ the thread holds ${messages} messages instead of 1`);
  });

  await t.test('⭐⭐⭐ M-130-3: the text of the employee is NEVER replaced without a confirmation', async () => {
    await loginAs(ownerId);
    await openTheConversation();
    const mine = `نص كتبه الموظف ${Date.now()}`;
    await page.fill('#reply-body', mine);
    await page.click('#quick-replies-list .quick-reply');
    await page.waitForTimeout(500);
    const composer = await page.inputValue('#reply-body');
    assert.equal(
      composer,
      mine,
      `⭐⭐⭐ the text of the employee was replaced without a confirmation: ${composer}`,
    );
    assert.equal(
      await page.isVisible('#quick-replies-confirm'),
      true,
      '⭐⭐⭐ the question of the replacement was not asked',
    );
    // ⭐⭐⭐ «أبقِ نصي» ⇒ ⇒ ⇒ the text of the employee STAYS.
    await page.click('#btn-quick-keep');
    await page.waitForTimeout(400);
    assert.equal(
      await page.inputValue('#reply-body'),
      mine,
      '⭐⭐⭐ the text of the employee was lost after the refusal',
    );
    assert.equal(
      await page.isVisible('#quick-replies-confirm'),
      false,
      '⭐⭐⭐ the question of the replacement stayed on the screen',
    );
    // ⭐⭐⭐ and now the employee says YES ⇒ ⇒ ⇒ the template replaces it.
    await page.click('#quick-replies-list .quick-reply');
    await page.waitForTimeout(400);
    await page.click('#btn-quick-replace');
    await page.waitForTimeout(400);
    const replaced = await page.inputValue('#reply-body');
    assert.notEqual(replaced, mine, '⭐⭐⭐ the template did not replace the text after the yes');
    assert.ok(replaced.length > 0, '⭐⭐⭐ the box is empty after the replacement');
  });

  await t.test('⭐⭐⭐ M-130-4: the reply is edited, sent ONCE and it is REALLY in PostgreSQL', async () => {
    await loginAs(ownerId);
    await openTheConversation();
    await page.click('#quick-replies-list .quick-reply');
    await page.waitForTimeout(400);
    // ⭐⭐⭐ the employee EDITS the text of the template.
    const edited = `${await page.inputValue('#reply-body')} — تعديل الموظف ${Date.now()}`;
    await page.fill('#reply-body', edited);
    await page.click('#btn-send');
    await page.waitForTimeout(1200);
    const replies = await outboundReplies();
    assert.equal(
      replies.length,
      1,
      `⭐⭐⭐ the reply was stored ${replies.length} times instead of once: ${JSON.stringify(replies)}`,
    );
    assert.equal(replies[0]!.body, edited, '⭐⭐⭐ the stored reply is not the edited text');
    const thread = await page.innerText('#messages');
    assert.ok(thread.includes(edited), '⭐⭐⭐ the reply is not shown in the thread');
  });

  await t.test('⭐⭐⭐ M-130-5: a template does NOT reuse the reference of the previous reply', async () => {
    await loginAs(ownerId);
    await openTheConversation();
    const before = (await outboundReplies()).length;
    // ⭐⭐⭐ the first reply.
    const first = `رد أول ${Date.now()}`;
    await page.fill('#reply-body', first);
    await page.click('#btn-send');
    await page.waitForTimeout(1200);
    const afterFirst = await outboundReplies();
    assert.equal(
      afterFirst.length,
      before + 1,
      `⭐⭐⭐ the first reply was not stored (${afterFirst.length} instead of ${before + 1})`,
    );
    // ⭐⭐⭐ now a template ⇒ ⇒ ⇒ and a second reply ⇒ ⇒ ⇒ ⇒ the two
    // ⭐⭐⭐ replies must carry TWO different references ⇒ ⇒ ⇒ (if the
    // ⭐⭐⭐ template changed the reference ⇒ ⇒ ⇒ the server would
    // ⭐⭐⭐ refuse the second one ⇒ ⇒ ⇒ ⇒ the reply would be lost).
    await page.click('#quick-replies-list .quick-reply');
    await page.waitForTimeout(400);
    const second = `${await page.inputValue('#reply-body')} ${Date.now()}`;
    await page.fill('#reply-body', second);
    await page.click('#btn-send');
    await page.waitForTimeout(1200);
    const afterSecond = await outboundReplies();
    assert.equal(
      afterSecond.length,
      before + 2,
      `⭐⭐⭐ the second reply was lost (${afterSecond.length} instead of ${before + 2}): ${JSON.stringify(afterSecond)}`,
    );
    assert.notEqual(
      afterSecond[afterSecond.length - 2]!.ref,
      afterSecond[afterSecond.length - 1]!.ref,
      '⭐⭐⭐ the two replies carry the SAME reference',
    );
  });

  await t.test('⭐⭐⭐ M-130-6: the role that may only READ does not see the quick replies', async () => {
    await loginAs(viewerId);
    await openTheConversation();
    const before = (await outboundReplies()).length;
    assert.equal(
      await page.isVisible('#quick-replies'),
      false,
      '⭐⭐⭐ the quick replies are on the screen of the role that may only read',
    );
    assert.equal(
      await page.isVisible('#composer'),
      false,
      '⭐⭐⭐ the composer is on the screen of the role that may only read',
    );
    const after = await outboundReplies();
    assert.equal(
      after.length,
      before,
      `⭐⭐⭐ the role that may only read sent a reply: ${JSON.stringify(after)}`,
    );
  });

  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(SHOT_DIR, 'm130-inbox-quick-replies.png'),
    fullPage: false,
  });
});

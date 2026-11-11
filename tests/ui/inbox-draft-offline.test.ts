// ============================================================
// WASL AI — the inbox — ui-19 (the draft when the network dies)
// ------------------------------------------------------------
// ⭐⭐⭐ WHAT THIS FILE MEASURES
//   ui-19 (the draft of the reply is kept when the connection drops):
//     ① the text of the employee survives a RELOAD (the storage of the
//        tab) ⇒ ⇒ ⇒ ⇒ the draft is NOT lost with the network,
//     ② when the network dies the page says so and keeps the draft
//        (and the REFERENCE of the reply) ⇒ ⇒ ⇒ ⇒ the employee is
//        never left guessing whether his reply went out,
//     ③ the retry is BY HAND and it carries the SAME reference ⇒ ⇒ ⇒ ⇒
//        the reply is stored EXACTLY ONCE (⇒ ⇒ ⇒ ⇒ never twice),
//     ④ the employee can throw the draft away on purpose.
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
  fetch(options?: Record<string, unknown>): Promise<unknown>;
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

test('ui-19) the draft of the reply when the network dies (the real browser)', async (t) => {
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

  const tenantId = 'tnt_ui19_ui';
  const ownerId = 'usr_ui19_ui_owner';
  const ref = 'conv_ui19_1';

  t.after(async () => {
    await browser.close();
    await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
      await uow.query(`delete from messages where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from conversations where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from customers where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from sessions where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from memberships where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from users where id = $1`, [ownerId]);
      await uow.query(`delete from tenants where id = $1`, [tenantId]);
    });
    await harness.stop();
  });

  const { hashPasscode } = await import('../../server/auth/sessions.ts');
  await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
    await uow.query(`delete from messages where tenant_id = $1`, [tenantId]);
    await uow.query(`delete from conversations where tenant_id = $1`, [tenantId]);
    await uow.query(`delete from customers where tenant_id = $1`, [tenantId]);
    await uow.query(
      `insert into tenants (id, name, status) values ($1,$2,'active')
       on conflict (id) do update set name = excluded.name`,
      [tenantId, 'Inbox ui-19 (synthetic)'],
    );
    await uow.query(
      `insert into users (id, display_name, email, status, passcode_hash)
       values ($1,$2,$3,'active',$4)
       on conflict (id) do update set passcode_hash = excluded.passcode_hash`,
      [ownerId, 'ui-19 owner', `${ownerId}@example.invalid`, hashPasscode(PASSCODE)],
    );
    await uow.query(
      `insert into memberships (id, tenant_id, user_id, role, status)
       values ($1,$2,$3,'owner','active')
       on conflict (tenant_id, user_id) do update set role = excluded.role`,
      [`mem_${ownerId}`, tenantId, ownerId],
    );
    await uow.query(
      `insert into customers (id, tenant_id, display_name, data_class)
       values ($1,$2,$3,'standard')
       on conflict (id) do update set display_name = excluded.display_name`,
      ['cus_ui19_1', tenantId, 'عميل الانقطاع'],
    );
    await uow.query(
      `insert into conversations (tenant_id, ref, customer_id, state, version, updated_at)
       values ($1,$2,$3,'open',1, now())
       on conflict (tenant_id, ref) do update set state = 'open'`,
      [tenantId, ref, 'cus_ui19_1'],
    );
    await uow.query(
      `insert into messages (message_ref, tenant_id, conversation_ref, channel, direction, sender,
                             recipient, body, occurred_at, locale, attributes, stored_at)
       values ($1,$2,$3,'web','inbound','customer@example.invalid','agent@example.invalid',$4, now(),'ar','{}'::jsonb, now())
       on conflict (tenant_id, message_ref) do nothing`,
      ['msg_ui19_seed', tenantId, ref, 'رسالة العميل الأولى'],
    );
  });

  const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
  const url = `http://127.0.0.1:${harness.port}/ui/inbox.html`;

  async function loginAs(): Promise<void> {
    await page.goto(url);
    await page.waitForTimeout(500);
    await page.evaluate(`(() => { try { sessionStorage.clear(); } catch {} })()`);
    await page.reload();
    await page.waitForTimeout(800);
    if (await page.isVisible('#workspace')) return;
    await page.evaluate(
      ([tenant, user]) => {
        const tenantSelect = document.getElementById('login-tenant');
        if (!tenantSelect.querySelector(`option[value="${tenant}"]`)) {
          const tenantOption = document.createElement('option');
          tenantOption.value = tenant;
          tenantOption.textContent = 'شركة ui-19';
          tenantSelect.appendChild(tenantOption);
        }
        const userSelect = document.getElementById('login-user');
        if (!userSelect.querySelector(`option[value="${user}"]`)) {
          const userOption = document.createElement('option');
          userOption.value = user;
          userOption.textContent = `موظف ui-19 ${user}`;
          userSelect.appendChild(userOption);
        }
      },
      [tenantId, ownerId],
    );
    await page.selectOption('#login-tenant', tenantId);
    await page.selectOption('#login-user', ownerId);
    await page.fill('#login-passcode', PASSCODE);
    await page.click('#btn-login');
    await page.waitForTimeout(900);
  }

  async function openTheConversation(): Promise<void> {
    await page.evaluate(
      `(() => { const item = document.querySelector('#conversation-list .conversation'); if (item) item.click(); })()`,
    );
    await page.waitForTimeout(900);
  }

  async function outbound(): Promise<Array<{ body: string; ref: string }>> {
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

  async function draftRef(): Promise<string> {
    const value = await page.evaluate(
      `(() => { const d = state.drafts.get(${JSON.stringify(ref)}); return d && d.messageRef ? d.messageRef : ''; })()`,
    );
    return String(value ?? '');
  }

  await t.test('ui-19-0: the login of the company of the drill', async () => {
    await loginAs();
    assert.equal(await page.isVisible('#workspace'), true, 'the workspace did not appear');
    await openTheConversation();
    assert.equal(await page.isVisible('#thread'), true, 'the conversation did not open');
  });

  await t.test('⭐⭐⭐ ui-19-1: the text of the employee survives a RELOAD', async () => {
    await loginAs();
    await openTheConversation();
    await page.fill('#reply-body', 'مسودة مكتوبة قبل ما الشبكة تقطع');
    await page.waitForTimeout(500);
    await page.reload();
    await page.waitForTimeout(1400);
    await openTheConversation();
    const composer = await page.inputValue('#reply-body');
    assert.equal(
      composer,
      'مسودة مكتوبة قبل ما الشبكة تقطع',
      `⭐⭐⭐ ui-19: the draft was lost with the reload: "${composer}"`,
    );
  });

  await t.test('⭐⭐⭐ ui-19-2: the network dies ⇒ the page keeps the draft and says so', async () => {
    await loginAs();
    await openTheConversation();
    await page.fill('#reply-body', 'الرد اللي الشبكة قطعته');
    await page.waitForTimeout(300);
    // ⭐⭐⭐ the network dies (the request never reaches the server).
    await page.route('**/api/inbox/conversations/*/replies', async (route) => {
      await route.abort();
    });
    await page.click('#btn-send');
    await page.waitForTimeout(1500);
    await page.unroute('**/api/inbox/conversations/*/replies');
    assert.equal(
      await page.isVisible('#draft-retry'),
      true,
      '⭐⭐⭐ ui-19: the page did not tell the employee that his reply did not go out',
    );
    const text = await page.innerText('#draft-retry');
    assert.match(text, /اتحفظ/, `⭐⭐⭐ ui-19: the strip says nothing useful: ${text}`);
    const replies = await outbound();
    assert.equal(
      replies.length,
      0,
      `⭐⭐⭐ ui-19: the reply was stored although the network died: ${JSON.stringify(replies)}`,
    );
    const keptRef = await draftRef();
    assert.ok(keptRef.length > 0, '⭐⭐⭐ ui-19: the reference of the reply was thrown away');
  });

  await t.test('⭐⭐⭐ ui-19-3: the retry is BY HAND and it stores the reply ONCE', async () => {
    await loginAs();
    await openTheConversation();
    await page.fill('#reply-body', 'الرد اللي اتقطع وبعدين اتعاد');
    await page.waitForTimeout(300);
    await page.route('**/api/inbox/conversations/*/replies', async (route) => {
      await route.abort();
    });
    await page.click('#btn-send');
    await page.waitForTimeout(1500);
    await page.unroute('**/api/inbox/conversations/*/replies');
    const keptRef = await draftRef();
    assert.ok(keptRef.length > 0, '⭐⭐⭐ ui-19: there is no reference to retry with');
    assert.equal((await outbound()).length, 0, '⭐⭐⭐ ui-19: the aborted attempt stored something');
    // ⭐⭐⭐ the network is back ⇒ the employee presses the retry BY HAND.
    await page.click('#btn-draft-retry');
    await page.waitForTimeout(1800);
    const replies = await outbound();
    assert.equal(
      replies.length,
      1,
      `⭐⭐⭐ ui-19: the retry stored ${replies.length} replies instead of 1: ${JSON.stringify(replies)}`,
    );
    assert.equal(
      replies[0].ref,
      keptRef,
      `⭐⭐⭐ ui-19: the retry did not carry the SAME reference (${replies[0].ref} ≠ ${keptRef})`,
    );
    assert.equal(replies[0].body, 'الرد اللي اتقطع وبعدين اتعاد', '⭐⭐⭐ ui-19: the wrong text');
    assert.equal(
      await page.isVisible('#draft-retry'),
      false,
      '⭐⭐⭐ ui-19: the strip of the retry stayed on the screen after the reply went out',
    );
  });

  await t.test('⭐⭐⭐ ui-19-4: the employee throws the draft away on purpose', async () => {
    await loginAs();
    await openTheConversation();
    await page.fill('#reply-body', 'مسودة سيبتها عن قصد');
    await page.waitForTimeout(400);
    await page.evaluate(
      `(() => { document.getElementById('btn-draft-discard').click(); })()`,
    );
    await page.waitForTimeout(500);
    const composer = await page.inputValue('#reply-body');
    assert.equal(composer, '', `⭐⭐⭐ ui-19: the draft was not thrown away: "${composer}"`);
    await page.reload();
    await page.waitForTimeout(1400);
    await openTheConversation();
    const afterReload = await page.inputValue('#reply-body');
    assert.equal(
      afterReload,
      '',
      `⭐⭐⭐ ui-19: the thrown draft came back after a reload: "${afterReload}"`,
    );
  });
});

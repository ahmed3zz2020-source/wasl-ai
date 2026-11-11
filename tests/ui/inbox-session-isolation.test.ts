// ============================================================
// WASL AI — the inbox — M-131 · M-132 · M-133 (the isolation)
// ------------------------------------------------------------
// ⭐⭐⭐ WHAT THIS FILE MEASURES
//   Three defects that the architect found in the review of #59:
//     ① M-131: a VALID session of a company that has NO conversations
//        must NOT be closed by the page (the empty list is not a
//        logout ⇒ the session dies only when the SERVER says 401/403),
//     ② M-132: a quick-reply template of conversation A must NEVER
//        replace the draft of conversation B (the confirmation of one
//        conversation does not write into another one),
//     ③ M-133: a LATE verification of a sent reply (the answer of the
//        server was lost ⇒ the page goes to check the database) must
//        NOT touch another conversation (it must not clear the
//        composer of another conversation and must not pull the
//        employee back to the old one).
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

test('M-131 · M-132 · M-133) the isolation of the session and of the drafts (the real browser)', async (t) => {
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

  const tenantId = 'tnt_m131_ui';
  const emptyTenantId = 'tnt_m131_empty';
  const ownerId = 'usr_m131_ui_owner';
  const emptyOwnerId = 'usr_m131_empty_owner';

  t.after(async () => {
    await browser.close();
    for (const tenant of [tenantId, emptyTenantId]) {
      await UnitOfWork.run(harness.ownerPool, tenant, async (uow) => {
        await uow.query(`delete from messages where tenant_id = $1`, [tenant]);
        await uow.query(`delete from conversations where tenant_id = $1`, [tenant]);
        await uow.query(`delete from customers where tenant_id = $1`, [tenant]);
        await uow.query(`delete from sessions where tenant_id = $1`, [tenant]);
        await uow.query(`delete from memberships where tenant_id = $1`, [tenant]);
        await uow.query(`delete from users where id in ($1,$2)`, [ownerId, emptyOwnerId]);
        await uow.query(`delete from tenants where id = $1`, [tenant]);
      });
    }
    await harness.stop();
  });

  const { hashPasscode } = await import('../../server/auth/sessions.ts');
  const passcodeHash = hashPasscode(PASSCODE);

  await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
    await uow.query(`delete from messages where tenant_id = $1`, [tenantId]);
    await uow.query(`delete from conversations where tenant_id = $1`, [tenantId]);
    await uow.query(`delete from customers where tenant_id = $1`, [tenantId]);
    await uow.query(
      `insert into tenants (id, name, status) values ($1,$2,'active')
       on conflict (id) do update set name = excluded.name`,
      [tenantId, 'Inbox M131 (synthetic)'],
    );
    await uow.query(
      `insert into users (id, display_name, email, status, passcode_hash)
       values ($1,$2,$3,'active',$4)
       on conflict (id) do update set passcode_hash = excluded.passcode_hash`,
      [ownerId, 'M131 owner', `${ownerId}@example.invalid`, passcodeHash],
    );
    await uow.query(
      `insert into memberships (id, tenant_id, user_id, role, status)
       values ($1,$2,$3,'owner','active')
       on conflict (tenant_id, user_id) do update set role = excluded.role`,
      [`mem_${ownerId}`, tenantId, ownerId],
    );
    for (const [customerId, customerName, ref] of [
      ['cus_m131_a', 'عميل ألف', 'conv_m131_a'],
      ['cus_m131_b', 'عميل باء', 'conv_m131_b'],
    ] as const) {
      await uow.query(
        `insert into customers (id, tenant_id, display_name, data_class)
         values ($1,$2,$3,'standard')
         on conflict (id) do update set display_name = excluded.display_name`,
        [customerId, tenantId, customerName],
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
        [`msg_${ref}_seed`, tenantId, ref, `رسالة العميل في ${ref}`],
      );
    }
  });

  // ⭐⭐⭐ the company of M-131: a valid company with NO conversations.
  await UnitOfWork.run(harness.ownerPool, emptyTenantId, async (uow) => {
    await uow.query(`delete from sessions where tenant_id = $1`, [emptyTenantId]);
    await uow.query(`delete from memberships where tenant_id = $1`, [emptyTenantId]);
    await uow.query(
      `insert into tenants (id, name, status) values ($1,$2,'active')
       on conflict (id) do update set name = excluded.name`,
      [emptyTenantId, 'Company without conversations (synthetic)'],
    );
    await uow.query(
      `insert into users (id, display_name, email, status, passcode_hash)
       values ($1,$2,$3,'active',$4)
       on conflict (id) do update set passcode_hash = excluded.passcode_hash`,
      [emptyOwnerId, 'M131 empty owner', `${emptyOwnerId}@example.invalid`, passcodeHash],
    );
    await uow.query(
      `insert into memberships (id, tenant_id, user_id, role, status)
       values ($1,$2,$3,'owner','active')
       on conflict (tenant_id, user_id) do update set role = excluded.role`,
      [`mem_${emptyOwnerId}`, emptyTenantId, emptyOwnerId],
    );
  });

  const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
  const url = `http://127.0.0.1:${harness.port}/ui/inbox.html`;

  async function loginAs(tenant: string, user: string): Promise<void> {
    await page.goto(url);
    await page.waitForTimeout(500);
    await page.evaluate(`(() => { try { sessionStorage.clear(); } catch {} })()`);
    await page.reload();
    await page.waitForTimeout(800);
    if (await page.isVisible('#workspace')) return;
    await page.evaluate(
      ([tenantId2, userId2]) => {
        const tenantSelect = document.getElementById('login-tenant');
        if (!tenantSelect.querySelector(`option[value="${tenantId2}"]`)) {
          const tenantOption = document.createElement('option');
          tenantOption.value = tenantId2;
          tenantOption.textContent = 'شركة M131';
          tenantSelect.appendChild(tenantOption);
        }
        const userSelect = document.getElementById('login-user');
        if (!userSelect.querySelector(`option[value="${userId2}"]`)) {
          const userOption = document.createElement('option');
          userOption.value = userId2;
          userOption.textContent = `موظف M131 ${userId2}`;
          userSelect.appendChild(userOption);
        }
      },
      [tenant, user],
    );
    await page.selectOption('#login-tenant', tenant);
    await page.selectOption('#login-user', user);
    await page.fill('#login-passcode', PASSCODE);
    await page.click('#btn-login');
    await page.waitForTimeout(900);
  }

  async function openConversationByRef(ref: string): Promise<void> {
    await page.evaluate(
      `(document.querySelector('#conversation-list .conversation[data-ref="${ref}"]') || {}).click?.()`,
    );
    await page.waitForTimeout(900);
  }

  await t.test('⭐⭐⭐ M-131-1: the session of a company with NO conversations is NOT closed', async () => {
    await loginAs(emptyTenantId, emptyOwnerId);
    assert.equal(await page.isVisible('#workspace'), true, 'the workspace did not appear');
    // ⭐⭐⭐ the page is reloaded ⇒ the session comes back from the
    // ⭐⭐⭐ storage ⇒ the list of a company without conversations is
    // ⭐⭐⭐ EMPTY (and that is NOT a closed session).
    await page.reload();
    await page.waitForTimeout(1400);
    assert.equal(
      await page.isVisible('#workspace'),
      true,
      '⭐⭐⭐ M-131: the session of a VALID company was closed because the list is empty',
    );
    assert.equal(
      await page.isVisible('#login-row'),
      false,
      '⭐⭐⭐ M-131: the employee was thrown out of his session by an empty list',
    );
    const empty = await page.isVisible('#list-empty');
    assert.equal(empty, true, '⭐⭐⭐ the page must say that the list is empty');
  });

  await t.test('⭐⭐⭐ M-132-1: the template of A does NOT replace the draft of B', async () => {
    await loginAs(tenantId, ownerId);
    await openConversationByRef('conv_m131_a');
    assert.equal(await page.isVisible('#thread'), true, 'the conversation A did not open');
    await page.fill('#reply-body', 'مسودة المحادثة ألف');
    await page.click('#quick-replies-list .quick-reply');
    await page.waitForTimeout(400);
    assert.equal(
      await page.isVisible('#quick-replies-confirm'),
      true,
      '⭐⭐⭐ the confirmation of the replacement did not appear',
    );
    // ⭐⭐⭐ the employee moves to conversation B and writes there.
    await openConversationByRef('conv_m131_b');
    await page.fill('#reply-body', 'مسودة المحادثة باء');
    await page.waitForTimeout(300);
    // ⭐⭐⭐ the confirmation of A is NOT shown while B is open ⇒ the
    // ⭐⭐⭐ employee is not left waiting for a button that is not his.
    assert.equal(
      await page.isVisible('#quick-replies-confirm'),
      false,
      '⭐⭐⭐ M-132: the confirmation of conversation A stayed on the screen of B',
    );
    // ⭐⭐⭐ and even if it is pressed by force (a stale event · a race)
    // ⭐⭐⭐ the template of A must NOT touch the composer of B.
    await page.evaluate(`(() => { document.getElementById('btn-quick-replace').click(); })()`);
    await page.waitForTimeout(700);
    const composer = await page.inputValue('#reply-body');
    assert.equal(
      composer,
      'مسودة المحادثة باء',
      `⭐⭐⭐ M-132: the template of conversation A replaced the draft of B: "${composer}"`,
    );
    const openRef = await page.textContent('#thread-ref');
    assert.match(
      String(openRef ?? ''),
      /conv_m131_b/,
      '⭐⭐⭐ M-132: the employee was moved to another conversation',
    );
    // ⭐⭐⭐ the confirmation of A WAITS for A ⇒ it comes back with it.
    await openConversationByRef('conv_m131_a');
    assert.equal(
      await page.isVisible('#quick-replies-confirm'),
      true,
      '⭐⭐⭐ M-132: the confirmation of conversation A was lost',
    );
    // ⭐⭐⭐ and pressing it there replaces the text of A (and only A).
    await page.click('#btn-quick-replace');
    await page.waitForTimeout(700);
    const draftA = await page.inputValue('#reply-body');
    assert.match(
      draftA,
      /أهلاً بيك|تفاصيل|متابعة|اتقفل/,
      `⭐⭐⭐ M-132: the template of A did not reach A: "${draftA}"`,
    );
    const refA = await page.textContent('#thread-ref');
    assert.match(String(refA ?? ''), /conv_m131_a/, '⭐⭐⭐ M-132: the employee was moved');
  });

  await t.test('⭐⭐⭐ M-133-1: a late verification does NOT touch another conversation', async () => {
    await loginAs(tenantId, ownerId);
    await openConversationByRef('conv_m131_a');
    await page.fill('#reply-body', 'ردّ يُكتب ثم تضيع التأكيد');
    // ⭐⭐⭐ the real request goes through (the reply IS stored) and the
    // ⭐⭐⭐ page receives a failure ⇒ it goes to verify in the database.
    await page.route('**/api/inbox/conversations/*/replies', async (route) => {
      await route.fetch();
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'the confirmation was lost' }),
      });
    });
    // ⭐⭐⭐ the verification of conversation A is slow ⇒ the employee has
    // ⭐⭐⭐ the time to move to conversation B while it is in the air.
    await page.route('**/api/inbox/conversations/conv_m131_a', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await route.continue();
    });
    await page.click('#btn-send');
    await page.waitForTimeout(900);
    await openConversationByRef('conv_m131_b');
    await page.fill('#reply-body', 'مسودة المحادثة باء أثناء التحقق');
    await page.waitForTimeout(3200);
    const composer = await page.inputValue('#reply-body');
    assert.equal(
      composer,
      'مسودة المحادثة باء أثناء التحقق',
      `⭐⭐⭐ M-133: the late verification cleared the composer of another conversation: "${composer}"`,
    );
    const openRef = await page.textContent('#thread-ref');
    assert.match(
      String(openRef ?? ''),
      /conv_m131_b/,
      '⭐⭐⭐ M-133: the late verification pulled the employee back to the old conversation',
    );
    await page.unroute('**/api/inbox/conversations/*/replies');
    await page.unroute('**/api/inbox/conversations/conv_m131_a');
  });
});

// ============================================================
// WASL AI — a picture of the new features (D-084 · local only)
//   ⭐ two pictures at 390px: the inbox (the strip of the retry) and
//     the tickets (the measurements · the ready phrases · the reminders)
//   ⭐ LOCAL ONLY: 127.0.0.1 + synthetic data.
// ============================================================
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { UnitOfWork } from '../server/db/unit-of-work.ts';
import { startHarness } from '../tests/server/harness.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'docs', 'previews');
fs.mkdirSync(OUT, { recursive: true });

const { chromium } = await import('/usr/local/lib/node_modules/playwright/index.mjs');
const { hashPasscode } = await import('../server/auth/sessions.ts');

const PASSCODE = 'wasl-local-test';
const tenantId = 'tnt_shot_ui';
const ownerId = 'usr_shot_owner';

const harness = await startHarness();
const browser = await chromium.launch({
  headless: true,
  executablePath: '/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
  await uow.query(`delete from messages where tenant_id = $1`, [tenantId]);
  await uow.query(`delete from conversations where tenant_id = $1`, [tenantId]);
  await uow.query(`delete from support_tickets where tenant_id = $1`, [tenantId]);
  await uow.query(`delete from customers where tenant_id = $1`, [tenantId]);
  await uow.query(
    `insert into tenants (id, name, status) values ($1,$2,'active') on conflict (id) do update set name = excluded.name`,
    [tenantId, 'Pictures (synthetic)'],
  );
  await uow.query(
    `insert into users (id, display_name, email, status, passcode_hash)
     values ($1,$2,$3,'active',$4) on conflict (id) do update set passcode_hash = excluded.passcode_hash`,
    [ownerId, 'صاحب التذكرة', `${ownerId}@example.invalid`, hashPasscode(PASSCODE)],
  );
  await uow.query(
    `insert into memberships (id, tenant_id, user_id, role, status)
     values ($1,$2,$3,'owner','active') on conflict (tenant_id, user_id) do update set role = excluded.role`,
    [`mem_${ownerId}`, tenantId, ownerId],
  );
  await uow.query(
    `insert into customers (id, tenant_id, display_name, data_class)
     values ('cus_shot_1', $1, 'عميل الصورة', 'standard') on conflict (id) do nothing`,
    [tenantId],
  );
  await uow.query(
    `insert into conversations (tenant_id, ref, customer_id, state, version, updated_at)
     values ($1,'conv_shot_1','cus_shot_1','open',1, now()) on conflict (tenant_id, ref) do nothing`,
    [tenantId],
  );
  await uow.query(
    `insert into messages (message_ref, tenant_id, conversation_ref, channel, direction, sender,
                           recipient, body, occurred_at, locale, attributes, stored_at)
     values ('msg_shot_in', $1,'conv_shot_1','web','inbound','customer@example.invalid','agent@example.invalid',
             'الطلب مش وصلني — ناقصني رقم الفاتورة', now() - interval '3 hours', 'ar','{}'::jsonb, now())
     on conflict (tenant_id, message_ref) do nothing`,
    [tenantId],
  );
  await uow.query(
    `insert into messages (message_ref, tenant_id, conversation_ref, channel, direction, sender,
                           recipient, body, occurred_at, locale, attributes, stored_at)
     values ('msg_shot_out', $1,'conv_shot_1','web','outbound','agent@example.invalid','customer@example.invalid',
             'أهلاً بيك! رقم الفاتورة وصلنا والحاجة اتسجّلت.', now() - interval '2 hours', 'ar','{}'::jsonb, now())
     on conflict (tenant_id, message_ref) do nothing`,
    [tenantId],
  );
  await uow.query(
    `insert into support_tickets (tenant_id, ref, customer_id, conversation_ref, subject, description,
                                  state, priority, assignee_actor_id, version, created_at, updated_at)
     values ($1,'tkt_shot_1','cus_shot_1','conv_shot_1','فاتورة ناقصة','العميل ناقصه رقم الفاتورة',
             'open','normal',$2,1, now() - interval '3 hours', now()) on conflict (tenant_id, ref) do nothing`,
    [tenantId, ownerId],
  );
});

const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
const base = `http://127.0.0.1:${harness.port}`;

async function login(url: string): Promise<void> {
  await page.goto(url);
  await page.waitForTimeout(700);
  // ⭐ the session of the previous page is still in the tab ⇒ it is
  // ⭐ cleared (the page restores it ⇒ the login row is hidden).
  await page.evaluate(`(() => { try { sessionStorage.clear(); } catch {} })()`);
  await page.reload();
  await page.waitForTimeout(900);
  await page.evaluate(
    `(() => {
       const t = document.getElementById('login-tenant');
       if (!t.querySelector('option[value="${tenantId}"]')) {
         const o = document.createElement('option'); o.value = '${tenantId}'; o.textContent = 'شركة الصورة'; t.appendChild(o);
       }
       const u = document.getElementById('login-user');
       if (!u.querySelector('option[value="${ownerId}"]')) {
         const o = document.createElement('option'); o.value = '${ownerId}'; o.textContent = 'أحمد'; u.appendChild(o);
       }
     })()`,
  );
  await page.selectOption('#login-tenant', tenantId);
  await page.selectOption('#login-user', ownerId);
  await page.fill('#login-passcode', PASSCODE);
  await page.click('#btn-login');
  await page.waitForTimeout(1500);
}

// ① the inbox: the strip of the retry (ui-19)
await login(`${base}/ui/inbox.html`);
await page.evaluate(`(() => { const i = document.querySelector('#conversation-list .conversation'); if (i) i.click(); })()`);
await page.waitForTimeout(1200);
await page.fill('#reply-body', 'ردّ مكتوب قبل ما الشبكة تقطع');
await page.waitForTimeout(400);
await page.route('**/api/inbox/conversations/*/replies', async (route) => {
  await route.abort();
});
await page.click('#btn-send');
await page.waitForTimeout(2000);
await page.screenshot({ path: path.join(OUT, 'd084-inbox-draft-retry-390.png'), fullPage: false });
console.log('the picture of the inbox is saved');

// ② the tickets: the measurements · the ready phrases · the reminders
await login(`${base}/ui/tickets.html`);
await page.waitForTimeout(800);
const dbg = await page.evaluate(`(() => ({
  items: document.querySelectorAll('#ticket-list .ticket').length,
  remindersHidden: document.getElementById('reminders') ? document.getElementById('reminders').hidden : 'no reminders',
  listHtml: document.getElementById('ticket-list') ? document.getElementById('ticket-list').innerHTML.slice(0, 300) : 'no list',
  detailHidden: document.getElementById('detail') ? document.getElementById('detail').hidden : 'no detail',
}))()`);
console.log('DEBUG', JSON.stringify(dbg));
await page.evaluate(`(() => { const i = document.querySelector('#ticket-list .ticket[data-ref="tkt_shot_1"]'); if (i) i.click(); })()`);
await page.waitForTimeout(1500);
const meas = await page.evaluate(`(() => ({
  hidden: document.getElementById('measurements') ? document.getElementById('measurements').hidden : 'none',
  list: document.getElementById('measurements-list') ? document.getElementById('measurements-list').innerText : 'none',
  note: document.getElementById('measurements-note') ? document.getElementById('measurements-note').innerText : 'none',
  txt: document.getElementById('detail') ? document.getElementById('detail').innerText.slice(0, 200) : 'none',
}))()`);
console.log('MEASUREMENTS', JSON.stringify(meas));
await page.click('#btn-reminder-new');
await page.waitForTimeout(400);
await page.fill('#reminder-note', 'متابعة رقم الفاتورة');
await page.click('#btn-reminder-save');
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(OUT, 'd084-tickets-measurements-390.png'), fullPage: true });
// ⭐ the second picture: the MEASUREMENTS (tk-16) with the toast faded.
await page.waitForTimeout(4200);
await page.evaluate(`(() => {
  const m = document.getElementById('measurements');
  if (m) m.scrollIntoView({ block: 'center' });
})()`);
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(OUT, 'd084-tickets-measurements-390.png'), fullPage: false });
console.log('the picture of the tickets is saved');

await browser.close();
await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
  await uow.query(`delete from support_ticket_changes where tenant_id = $1`, [tenantId]);
  await uow.query(`delete from support_tickets where tenant_id = $1`, [tenantId]);
  await uow.query(`delete from messages where tenant_id = $1`, [tenantId]);
  await uow.query(`delete from conversations where tenant_id = $1`, [tenantId]);
  await uow.query(`delete from customers where tenant_id = $1`, [tenantId]);
  await uow.query(`delete from sessions where tenant_id = $1`, [tenantId]);
  await uow.query(`delete from memberships where tenant_id = $1`, [tenantId]);
  await uow.query(`delete from users where id = $1`, [ownerId]);
  await uow.query(`delete from tenants where id = $1`, [tenantId]);
});
await harness.stop();
console.log('the drill is cleaned');

// ============================================================
// WASL AI — M-118 — the screenshots of the round (before / after)
// ------------------------------------------------------------
// ⭐⭐ WHAT THIS TOOL DOES
//   ① it starts the REAL local API on a REAL PostgreSQL ⇒ ⭐⭐ and
//     seeds a SYNTHETIC company (tickets + customers);
//   ② it shoots the pages of the CURRENT code (the «after») ⇐ ⭐⭐
//     and the pages of a GIVEN COMMIT (the «before») ⇐ ⭐⭐ the two
//     differ by the change and NOTHING else ⇒ ⇒ ⇒ the difference
//     on the screen is the change itself;
//   ③ the pages of the «before» are read from GIT (`git show`) ⇒ ⭐⭐
//     they are the published files, not a copy somebody kept.
// ⛔ LOCAL ONLY: the browser talks to 127.0.0.1 and the database is
//    the local synthetic one.
// ⭐⭐ THE USAGE:
//   node --experimental-strip-types tools/wasl-round-screenshots.ts \
//     --before 91f32bb4bec45f6203bb3f0355393eccf8e9749d
// ============================================================

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { UnitOfWork } from '../server/db/unit-of-work.ts';
import { startHarness } from '../tests/server/harness.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const SHOT_DIR = path.join(ROOT, 'docs', 'previews');
const PASSCODE = process.env['WASL_TEST_PASSCODE'] ?? 'wasl-local-test';
const TENANT = 'tnt_shot_ui';
const OWNER = 'usr_shot_ui_owner';
const CUSTOMER = 'cus_shot_ui_1';

function argOf(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? String(process.argv[index + 1]) : fallback;
}

const BEFORE = argOf('before', '91f32bb4bec45f6203bb3f0355393eccf8e9749d');
// ⭐⭐ the prefix of the files of THIS round ⇒ ⭐⭐ the evidence of the
// ⭐⭐ old rounds is never overwritten (its reports keep their images).
const PREFIX = argOf('prefix', 'round-');

async function resolvePlaywright(): Promise<any> {
  const candidates: string[] = [];
  if (process.env.PLAYWRIGHT_MODULE) candidates.push(process.env.PLAYWRIGHT_MODULE);
  candidates.push('/usr/local/lib/node_modules/playwright/index.mjs');
  candidates.push('/usr/lib/node_modules/playwright/index.mjs');
  for (const candidate of candidates) {
    try {
      const resolved = (await import(pathToFileURL(candidate).href)) as { chromium?: unknown };
      if (resolved?.chromium) return resolved;
    } catch {
      // the next candidate
    }
  }
  return null;
}

function chromiumExecutable(): string | undefined {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(process.env.HOME ?? '', '.cache', 'ms-playwright'),
    '/root/.cache/ms-playwright',
    path.join(ROOT, '.cache', 'ms-playwright'),
  ].filter(Boolean) as string[];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
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

/** ⭐⭐ the files of a commit (read from GIT ⇒ ⭐⭐ the published ones). */
function filesOfCommit(commit: string, paths: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const file of paths) {
    try {
      const content = execFileSync('git', ['show', `${commit}:${file}`], {
        encoding: 'utf8',
        cwd: ROOT,
      });
      map.set(file, content);
    } catch {
      // the file did not exist in that commit ⇒ it is simply not routed
    }
  }
  return map;
}

const playwright = await resolvePlaywright();
if (!playwright) {
  console.log('PLAYWRIGHT IS NOT AVAILABLE ⇒ the screenshots are skipped');
  process.exit(0);
}

fs.mkdirSync(SHOT_DIR, { recursive: true });
const harness = await startHarness({ namespace: 'shot' });

const { hashPasscode } = await import('../server/auth/sessions.ts');
await UnitOfWork.run(harness.ownerPool, TENANT, async (uow) => {
  await uow.query(`delete from support_ticket_changes where tenant_id = $1`, [TENANT]);
  await uow.query(`delete from support_tickets where tenant_id = $1`, [TENANT]);
  await uow.query(`delete from messages where tenant_id = $1`, [TENANT]);
  await uow.query(`delete from conversations where tenant_id = $1`, [TENANT]);
  await uow.query(`delete from customers where tenant_id = $1`, [TENANT]);
  await uow.query(
    `insert into tenants (id, name, status) values ($1,$2,'active')
     on conflict (id) do update set name = excluded.name`,
    [TENANT, 'Shots (synthetic)'],
  );
  await uow.query(
    `insert into users (id, display_name, email, status, passcode_hash)
     values ($1,$2,$3,'active',$4)
     on conflict (id) do update set passcode_hash = excluded.passcode_hash`,
    [OWNER, 'المالك', `${OWNER}@example.invalid`, hashPasscode(PASSCODE)],
  );
  await uow.query(
    `insert into memberships (id, tenant_id, user_id, role, status)
     values ($1,$2,$3,'owner','active')
     on conflict (tenant_id, user_id) do update set role = excluded.role, status = 'active'`,
    [`mem_${OWNER}`, TENANT, OWNER],
  );
  await uow.query(
    `insert into customers (id, tenant_id, display_name, data_class, email, phone)
     values ($1,$2,$3,'standard',$4,'+20100')
     on conflict (id) do nothing`,
    [CUSTOMER, TENANT, 'عميل تجريبي', 'shots@example.invalid'],
  );
  // ⭐⭐ three unassigned tickets (the queue of M-119) + one assigned.
  for (let index = 1; index <= 3; index += 1) {
    await uow.query(
      `insert into support_tickets (tenant_id, ref, customer_id, subject, description, state, priority, version)
       values ($1,$2,$3,$4,'وصف التذكرة','open','normal',1)
       on conflict (tenant_id, ref) do nothing`,
      [TENANT, `tkt_shot_${index}`, CUSTOMER, `تذكرة بانتظار الإسناد ${index}`],
    );
  }
});

const browser = await playwright.chromium.launch({
  headless: true,
  ...(chromiumExecutable() ? { executablePath: chromiumExecutable() } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const base = `http://127.0.0.1:${harness.port}`;

async function login(): Promise<void> {
  await page.goto(`${base}/ui/tickets.html`);
  await page.waitForTimeout(700);
  // ⭐⭐ the session of the tab may already be there (the login row is
  // ⭐⭐ hidden then) ⇒ ⭐⭐ the page is already ready.
  if (await page.isVisible('#btn-logout')) return;
  await page.evaluate(
    `(() => {
      const tenant = document.getElementById('login-tenant');
      const option = document.createElement('option');
      option.value = ${JSON.stringify(TENANT)};
      option.textContent = 'Shots';
      tenant.appendChild(option);
      const select = document.getElementById('login-user');
      const owner = document.createElement('option');
      owner.value = ${JSON.stringify(OWNER)};
      owner.textContent = 'owner';
      select.appendChild(owner);
    })()`,
  );
  await page.selectOption('#login-tenant', TENANT);
  await page.selectOption('#login-user', OWNER);
  await page.fill('#login-passcode', PASSCODE);
  await page.click('#btn-login');
  await page.waitForTimeout(1500);
}

/**
 * ⭐⭐ the shot must start at the TOP of the document ⇒ ⇒ ⇒ the page is
 * ⭐⭐ scrolled back first (a scrolled page hides its head in a full
 * ⭐⭐ page shot ⇒ ⭐⭐ and the shot would lie about the page).
 */
async function scrollTop(): Promise<void> {
  await page.evaluate(`window.scrollTo(0, 0)`);
  await page.waitForTimeout(350);
}

/** ⭐⭐ the «before» ⇒ the pages of the given commit (read from git). */
async function routeOldPages(pageRef: any, commit: string): Promise<void> {
  const files = filesOfCommit(commit, [
    'server/ui/tickets.html',
    'server/ui/tickets.js',
    'server/ui/tickets.css',
    'server/ui/crm.html',
    'server/ui/crm.js',
    'server/ui/crm.css',
  ]);
  for (const [file, content] of files) {
    const name = file.split('/').pop() as string;
    const type = name.endsWith('.html')
      ? 'text/html; charset=utf-8'
      : name.endsWith('.js')
        ? 'text/javascript; charset=utf-8'
        : 'text/css; charset=utf-8';
    await pageRef.route(`**/ui/${name}`, (route: any) =>
      route.fulfill({ status: 200, contentType: type, body: content }),
    );
  }
}

async function shootTickets(tag: string): Promise<void> {
  await page.goto(`${base}/ui/tickets.html`);
  await page.waitForTimeout(1500);
  await scrollTop();
  await page.screenshot({ path: path.join(SHOT_DIR, `${PREFIX}tickets-mobile-${tag}-list.png`), fullPage: true });
  const queue = await page.$('#btn-unassigned');
  if (queue) {
    await page.click('#btn-unassigned');
    await page.waitForTimeout(1200);
    await scrollTop();
    await page.screenshot({
      path: path.join(SHOT_DIR, `${PREFIX}tickets-mobile-${tag}-queue.png`),
      fullPage: true,
    });
  }
}

async function shootCrm(tag: string): Promise<void> {
  await page.goto(`${base}/ui/crm.html`);
  await page.waitForTimeout(1500);
  await scrollTop();
  await page.screenshot({ path: path.join(SHOT_DIR, `${PREFIX}crm-mobile-${tag}-list.png`), fullPage: true });
  await page.evaluate(`document.querySelector('#customer-list .customer').click()`);
  await page.waitForTimeout(1200);
  await scrollTop();
  await page.screenshot({ path: path.join(SHOT_DIR, `${PREFIX}crm-mobile-${tag}-profile.png`), fullPage: true });
}

await login();
await shootTickets('after');
await shootCrm('after');

await routeOldPages(page, BEFORE);
await page.goto(`${base}/ui/tickets.html`);
await page.waitForTimeout(1200);
await login();
await shootTickets('before');
await shootCrm('before');

await browser.close();
await UnitOfWork.run(harness.ownerPool, TENANT, async (uow) => {
  await uow.query(`delete from support_ticket_changes where tenant_id = $1`, [TENANT]);
  await uow.query(`delete from support_tickets where tenant_id = $1`, [TENANT]);
  await uow.query(`delete from messages where tenant_id = $1`, [TENANT]);
  await uow.query(`delete from conversations where tenant_id = $1`, [TENANT]);
  await uow.query(`delete from customers where tenant_id = $1`, [TENANT]);
  await uow.query(`delete from sessions where tenant_id = $1`, [TENANT]);
  await uow.query(`delete from memberships where tenant_id = $1`, [TENANT]);
  await uow.query(`delete from users where id = $1`, [OWNER]);
  await uow.query(`delete from tenants where id = $1`, [TENANT]);
});
await harness.stop();
console.log(`the screenshots are written: ${SHOT_DIR}`);

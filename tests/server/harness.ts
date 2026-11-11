// ============================================================
// WASL AI — FOUNDATION BUILD 01 — test harness
// ------------------------------------------------------------
// ⭐ The harness prepares the LOCAL synthetic database and starts the
//   real API server on the loopback interface. The tests then talk to
//   it over HTTP, so nothing is mocked.
// ⛔ It needs the local credentials written by `npm run db:setup`.
// ⛔ Every tenant, user and message it creates is synthetic.
// ============================================================

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, type ServerConfig } from '../../server/config.ts';
import { createPool, type PgPool, type PgClient } from '../../server/db/pool.ts';
import { UnitOfWork } from '../../server/db/unit-of-work.ts';
import { runMigrations, seedDatabase } from '../../server/db/setup.ts';
import { WaslApiServer } from '../../server/api/server.ts';
import { LocalApiClient } from '../../server/e2e/http-client.ts';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');

export interface Harness {
  readonly config: ServerConfig;
  readonly appPool: PgPool;
  readonly ownerPool: PgPool;
  readonly api: WaslApiServer;
  readonly client: LocalApiClient;
  readonly port: number;
  readonly stop: () => Promise<void>;
}

export class HarnessError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'HarnessError';
    this.code = code;
  }
}

function readCredentials(): { owner_password: string; app_password: string } {
  const file = path.join(ROOT, '.local', 'pg-credentials.json');
  if (!fs.existsSync(file)) {
    throw new HarnessError(
      'credentials_missing',
      'the local database credentials are missing - run `npm run db:setup` first',
    );
  }
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  const owner = parsed['owner_password'];
  const app = parsed['app_password'];
  if (typeof owner !== 'string' || typeof app !== 'string') {
    throw new HarnessError('credentials_invalid', 'the local database credentials are invalid');
  }
  return { owner_password: owner, app_password: app };
}

/**
* ⭐⭐ D-072 / M-82: the companies of the file.
* ⭐⭐ The tenants are the ones the file OWNS ⇒ ⭐⭐ no other file can
*   touch their rows ⇒ ⭐⭐ the result of a file never depends on the
*   order of the files or on the cleanup of another one.
*/
export interface HarnessOptions {
  /** ⭐⭐ The namespace of the companies of this file (empty = the default). */
  readonly namespace?: string;
  /**
  * ⭐⭐⭐ M-121: ⭐⭐⭐ a WRAPPER of the pool of the application ⇒ ⇒ ⇒ it
  *   ⭐⭐⭐ lets a test control WHEN a statement of the product runs ⇒
  *   ⭐⭐⭐ ⇒ ⇒ ⇒ (the window of the concurrency is DETERMINISTIC and
  *   ⭐⭐⭐ not a race of the clock) ⇒ ⇒ ⇒ and the SQL of the product
  *   ⭐⭐⭐ is never mocked.
  */
  readonly wrapPool?: (pool: PgPool) => PgPool;
}

/** ⭐ Prepare the database (migrations + seed) and start the API. */
export async function startHarness(options: HarnessOptions = {}): Promise<Harness> {
  // ⭐ The test profile: the structured log is silent and the rate
  //   limit policy is the one of the test profile.
  const config = loadConfig(process.env, ROOT, { profile: 'test' });
  const credentials = readCredentials();
  // ⭐⭐ D-070: every test file is a process of its own, and the
  //   runner starts them in parallel. ⭐ Two files that bind the same
  //   port would fight, so every process takes its own BLOCK of
  //   ports: the base plus the few the drill opens beside it.
  const blockSize = 30;
  // ⭐⭐⭐ M-99: the port is ALLOCATED under a lock (and probed) ⇒ ⭐⭐
  //   the pid is only a HINT for where to look first ⇒ ⭐⭐ two files
  //   never share a port ⇒ ⭐⭐ and the extra ports of a drill (the
  //   base + 1 .. + 16) stay inside the block of the file.
  const ownerPool = createPool(
    `postgresql://wasl_owner:${encodeURIComponent(credentials.owner_password)}@127.0.0.1:5432/${
config.databaseName
}`,
    4,
  );
  await runMigrations(ownerPool);
  // ⭐⭐ M-82: the companies of THIS file (the namespace).
  await seedDatabase(ownerPool, config.testPasscode, options.namespace ?? '');
  // ⭐⭐⭐ M-99: the block of ports is RESERVED (atomically) ⇒ ⭐⭐ two
  //   files never share a port ⇒ ⭐⭐ and the extra ports of a drill
  //   (the base + 1 .. + 16) stay inside the block of the file.
  const reserved = await reservePortBlock(blockSize);
  const port = Number(process.env['WASL_TEST_PORT'] ?? String(reserved.base));
  const testConfig: ServerConfig = { ...config, port, host: '127.0.0.1' };

  const appPool = options.wrapPool
    ? options.wrapPool(createPool(config.appDatabaseUrl, 6))
    : createPool(config.appDatabaseUrl, 6);
  // ⭐ A listener on the pool error: a broken connection must not raise
  //   an unhandled error inside the test runner.
  appPool.on('error', () => undefined);
  ownerPool.on('error', () => undefined);
  const api = new WaslApiServer({ config: testConfig, pool: appPool });
  const address = await api.listen();

  return {
    config: testConfig,
    appPool,
    ownerPool,
    api,
    client: new LocalApiClient('127.0.0.1', address.port),
    port: address.port,
    stop: async () => {
      await api.close();
      await appPool.end();
      await ownerPool.end();
      // ⭐⭐⭐ M-99: the block goes back to the pool.
      await reserved.release();
    },
  };
}

/**
* ⭐ Wipe the synthetic rows of the seeded companies and re-seed them.
* ⭐⭐ D-072 / M-82: the companies are a PARAMETER ⇒ ⭐⭐ a file wipes
*   only the companies it owns ⇒ ⭐⭐ it can never erase the data of
*   another file.
*/
export async function resetSyntheticData(
  ownerPool: PgPool,
  passcode: string,
  tenants: readonly string[] = ['tnt_alpha', 'tnt_beta', 'tnt_gamma'],
  namespace = '',
): Promise<void> {
  for (const seeded of tenants) {
    const tenantId = namespace === '' ? seeded : `${namespace}_${seeded}`;
    await UnitOfWork.run(ownerPool, tenantId, async (uow) => {
      await uow.query(`delete from messages where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from conversation_changes where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from read_audit_events where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from audit_events where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from conversations where tenant_id = $1`, [tenantId]);
      // ⭐⭐ D-073: the tickets of the company (and their activity) are
      //   part of the fixture ⇒ ⭐⭐ a leftover of a previous run must
      //   NOT change the result of this one ⇒ ⭐⭐ the lesson of M-82
      //   applies to EVERY table the company owns.
      await uow.query(`delete from support_ticket_changes where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from support_tickets where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from customers where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from sessions where tenant_id = $1`, [tenantId]);
      await uow.query(`delete from deletion_requests where tenant_id = $1`, [tenantId]);
    });
  }
  // ⭐⭐ M-82: the re-seed is the one of the OWN companies (the namespace).
  await seedDatabase(ownerPool, passcode, namespace);
}

export interface SyntheticTenant {
  readonly tenantId: string;
  readonly userId: string;
  readonly customerId: string;
}

/**
* ⭐ Create a synthetic company with an owner and a customer.
* ⛔ The passcode is the fixture one: nothing real is ever written.
*/
export async function createSyntheticTenant(
  ownerPool: PgPool,
  tenantId: string,
  passcode: string,
): Promise<SyntheticTenant> {
  const userId = `usr_${tenantId}_owner`;
  const customerId = `cus_${tenantId}_1`;
  const { hashPasscode } = await import('../../server/auth/sessions.ts');
  await UnitOfWork.run(ownerPool, tenantId, async (uow) => {
    await uow.query(
      `insert into tenants (id, name, status) values ($1,$2,'active')
on conflict (id) do update set name = excluded.name, status = 'active'`,
      [tenantId, `Synthetic ${tenantId}`],
    );
    await uow.query(
      `insert into users (id, display_name, email, status, passcode_hash) values ($1,$2,$3,'active',$4)
on conflict (id) do update set passcode_hash = excluded.passcode_hash, status = 'active'`,
      [userId, `Owner ${tenantId}`, `${userId}@example.invalid`, hashPasscode(passcode)],
    );
    await uow.query(
      `insert into memberships (id, tenant_id, user_id, role, status) values ($1,$2,$3,'owner','active')
on conflict (tenant_id, user_id) do update set role = excluded.role, status = 'active'`,
      [`mem_${userId}`, tenantId, userId],
    );
    await uow.query(
      `insert into customers (id, tenant_id, display_name, data_class) values ($1,$2,$3,'standard')
on conflict (id) do update set display_name = excluded.display_name`,
      [customerId, tenantId, `Customer ${tenantId}`],
    );
  });
  return { tenantId, userId, customerId };
}

/**
* ⭐⭐ D-071: a synthetic company with SEVERAL roles, alone.
* ⭐⭐ WHY A COMPANY OF ITS OWN
*   ⭐ The test files run in parallel over ONE database ⇒ ⭐ a file
*     that uses the SHARED seeded tenant (`tnt_alpha`) depends on the
*     moment another file wipes it (five files call
  *     `resetSyntheticData`) ⇒ ⭐ **the drill of a file must own its
*     data** ⇒ ⭐ a drill that counts rows or measures a limit
*     measures ITS OWN rows and nothing else.
*/
export async function createSyntheticCompany(
  ownerPool: PgPool,
  tenantId: string,
  passcode: string,
  members: readonly { readonly id: string; readonly role: string }[],
): Promise<{ readonly tenantId: string; readonly userIds: Record<string, string> }> {
  const { hashPasscode } = await import('../../server/auth/sessions.ts');
  const userIds: Record<string, string> = {};
  for (const member of members) {
    userIds[member.role] = member.id;
    // ⭐⭐ The file may have TWO people with the SAME role (two agents)
    //   ⇒ the id is a key as well ⇒ ⭐ no one of them is lost.
    userIds[member.id] = member.id;
  }
  await UnitOfWork.run(ownerPool, tenantId, async (uow) => {
    await uow.query(
      `insert into tenants (id, name, status) values ($1,$2,'active')
on conflict (id) do update set name = excluded.name, status = 'active'`,
      [tenantId, `Synthetic ${tenantId}`],
    );
    for (const member of members) {
      await uow.query(
        `insert into users (id, display_name, email, status, passcode_hash)
values ($1,$2,$3,'active',$4)
on conflict (id) do update set passcode_hash = excluded.passcode_hash, status = 'active'`,
        [member.id, `${member.role} ${tenantId}`, `${member.id}@example.invalid`, hashPasscode(passcode)],
      );
      await uow.query(
        `insert into memberships (id, tenant_id, user_id, role, status)
values ($1,$2,$3,$4,'active')
on conflict (tenant_id, user_id) do update set role = excluded.role, status = 'active'`,
        [`mem_${member.id}`, tenantId, member.id, member.role],
      );
    }
  });
  return { tenantId, userIds };
}

/**
* ⭐⭐ D-072 / M-82: the lock of the PLATFORM login budget.
* ⭐⭐ WHY A LOCK AND NOT A NAMESPACE
*   ⭐ The platform budget is ONE resource of the installation by design
*     (D-070): the counter of the failures (`login_attempts_global`),
*     the admission bucket of the whole installation
*     (`login_admission_global`) and the peer address budget are NOT
*     tenant scoped ⇒ ⭐⭐ a namespace cannot separate them, and that
*     is the PRODUCT, not a defect of the test.
*   ⭐⭐ The drills that MEASURE the platform budget need it to
*     themselves ⇒ ⭐⭐ they take a PostgreSQL advisory lock ⇒ ⭐⭐ they
*     measure it one after another, while EVERY OTHER file keeps
*     running in parallel.
*   ⭐⭐ The alternative (running the suite with the parallelism off)
*     would HIDE the interference instead of solving it ⇒ ⛔ it is not
*     what this helper does.
* ⛔ The lock is never taken by the product path: only a test drill
*   that measures the platform budget takes it.
*/
export const PLATFORM_BUDGET_LOCK_KEY = 0x5741_534c; // "WASL"

/**
* ⭐⭐⭐ M-99: THE PORT OF A FILE IS RESERVED, NOT DERIVED FROM THE PID.
*
* ⭐⭐⭐ WHY: `pid % 400` is NOT injective over the LIVE processes ⇒
*   two files whose pids are 400 apart land on the SAME block ⇒ the
*   second one dies with `EADDRINUSE` ⇒ ⭐⭐ a false failure of the
*   product that has nothing to do with the product.
* ⭐⭐⭐ AND WHY A PROBE ALONE IS NOT ENOUGH: the probe answers "is
*   the port free NOW?" ⇒ ⭐⭐ two files can probe the same free port
*   at the same moment and then both bind it ⇒ ⭐⭐⇒ so the block is
*   RESERVED with an atomic marker ⇒ ⭐⭐ and the probe stays as the
*   second line of defence (a port taken by something that is not a
  *   test).
* ⭐⭐⭐ M-101: THE MARKER IS A HARD LINK to the file of its owner ⇒ ⇒
*   `link()` is ATOMIC and it fails when the name is taken ⇒ ⇒ ⇒ no
*   double reservation ⇒ ⇒ ⇒ and the marker carries the IDENTITY of
*   its owner (pid AND start time) ⇒ ⇒ ⇒ a stale marker is reclaimed
*   ⇒ ⇒ ⇒ and a reused pid does not keep a block forever.
*/
const PORT_BLOCK_DIR = path.join(os.tmpdir(), 'wasl-test-port-blocks');
const PORT_OWNER_DIR = path.join(PORT_BLOCK_DIR, 'owners');
/**
* ⭐⭐⭐ M-105: THE CLAIM IS A DIRECTORY ⇒ ⇒ ⇒ and its identity is the
* ⭐⭐⭐ file `owner` inside it ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ the two facts that make
* ⭐⭐⭐ the protocol safe:
* ⭐⭐⭐ ⇒ ⇒ ⇒ ① the DIRECTORY never disappears while a claim is being
* ⭐⭐⭐ ⇒ ⇒ ⇒ ⇒ ⇒ reclaimed ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ so no other
* ⭐⭐⭐ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ process can claim the block meanwhile ⇒ ⇒ ⇒
* ⭐⭐⭐ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ (the old file could be unlinked ⇒
  * ⭐⭐⭐ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ and the name was free ⇒ ⇒ ⇒ ⇒ ⇒).
* ⭐⭐⭐ ⇒ ⇒ ⇒ ② the OWNERSHIP is decided by ONE atomic `link()` onto
* ⭐⭐⭐ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ the fixed name `owner` ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒
* ⭐⭐⭐ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ exactly one winner ⇒ ⇒ ⇒.
*/
const CLAIM_OWNER_FILE = 'owner';

function claimOwnerPath(claim: string): string {
  return path.join(claim, CLAIM_OWNER_FILE);
}

/** ⭐ Is this port free right now? (bind it and release it). */
async function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

/**
* ⭐⭐⭐ M-101: THE IDENTITY OF THE OWNER OF A BLOCK.
* ⭐⭐⭐ A PID ALONE IS NOT AN IDENTITY ⇐ the operating system REUSES
* ⭐⭐⭐ the PIDs ⇐ so a marker whose owner died an hour ago can find a
* ⭐⭐⭐ LIVE process with the SAME pid ⇐ and then the block looks taken
* ⭐⭐⭐ forever ⇐ and the run dies with `no_free_port_block`.
* ⭐⭐⭐ ⇒ THE IDENTITY IS (pid, START TIME) ⇐ the start time is the
* ⭐⭐⭐ clock of the process, in ticks since the boot ⇐ it NEVER changes
* ⭐⭐⭐ for a given process ⇐ and a NEW process with a REUSED pid has a
* ⭐⭐⭐ DIFFERENT start time ⇒ ⇒ ⇒ the reuse is detected.
*/
export interface PortOwner {
  readonly token: string;
  readonly pid: number;
  readonly start: string;
}

/**
* ⭐⭐ The identity of THIS process ⇒ ⇒ (pid, start time, a random
  * ⭐⭐ token) ⇒ ⇒ the token is what the marker carries ⇒ ⇒ and the
* ⭐⭐ release can PROVE that the marker is still ours.
*/
export function currentPortOwner(): PortOwner {
  const start = processStartTime(process.pid);
  return {
    token: `${process.pid}-${start}-${Math.random().toString(36).slice(2, 10)}`,
    pid: process.pid,
    start,
  };
}

/** ⭐⭐ The file that carries the identity of an owner. */
export function writePortOwnerFile(owner: PortOwner): string {
  return writeOwnerFile(owner);
}

/** ⭐⭐ The start time of a process ('' when the platform has no /proc). */
function processStartTime(pid: number): string {
  try {
    const raw = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    // ⭐⭐ after the `comm` field (which may contain spaces) ⇒ the
    // ⭐⭐ fields are counted from there ⇒ field 22 (starttime) is the
    // ⭐⭐ 20th token after the closing parenthesis.
    const tail = raw.slice(raw.lastIndexOf(')') + 2).trim().split(/\s+/);
    return tail[19] ?? '';
  } catch {
    return '';
  }
}

/** ⭐⭐ Is this process still alive? */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** ⭐⭐ Is the owner of a block STILL THE OWNER? (pid + start time) */
function ownerAlive(owner: PortOwner): boolean {
  if (!processAlive(owner.pid)) return false;
  if (owner.start === '') return true; // ⭐⭐ no /proc ⇒ the pid is all we have.
  const now = processStartTime(owner.pid);
  if (now === '') return false; // ⭐⭐ the process is gone (the pid is free).
  return now === owner.start; // ⭐⭐⭐ a REUSED pid has another start time.
}

function readOwner(file: string): PortOwner | null {
  try {
    const raw = fs.readFileSync(file, 'utf8').trim();
    const [token, pid, start] = raw.split('|');
    const pidNumber = Number(pid);
    if (!token || !Number.isFinite(pidNumber) || pidNumber <= 0) return null;
    return { token, pid: pidNumber, start: start ?? '' };
  } catch {
    return null;
  }
}

function writeOwnerFile(owner: PortOwner): string {
  fs.mkdirSync(PORT_OWNER_DIR, { recursive: true });
  const file = path.join(PORT_OWNER_DIR, owner.token);
  fs.writeFileSync(file, `${owner.token}|${owner.pid}|${owner.start}`, { flag: 'wx' });
  return file;
}

function unlinkQuietly(file: string): void {
  try {
    fs.unlinkSync(file);
  } catch {
    // ⭐⭐ it is gone anyway ⇒ nothing to remove.
  }
}

/**
* ⭐⭐⭐ M-101: take the marker of a block ATOMICALLY.
* ⭐⭐⭐ THE MECHANISM: the marker is a HARD LINK to the file of its
* ⭐⭐⭐ owner ⇒ ⇒ `link()` is ATOMIC and it FAILS with EEXIST when the
* ⭐⭐⭐ name is taken ⇒ ⇒ ⇒ ⇒ two files can NEVER own one block ⇒ ⇒ ⇒
* ⭐⭐⭐ ⇒ ⇒ no double reservation, ever.
* ⭐⭐⭐ THE RECLAIM: a marker whose owner is gone is stale ⇒ ⇒ but the
* ⭐⭐⭐ reclaim must not steal a FRESH marker ⇒ ⇒ so the stale marker is
* ⭐⭐⭐ first HARD LINKED to a private quarantine name (an atomic
  * ⭐⭐⭐ move) ⇒ ⇒ and the identity of the QUARANTINE is read ⇒ ⇒ and
* ⭐⭐⭐ if it is NOT the stale identity we judged ⇒ ⇒ ⇒ somebody else
* ⭐⭐⭐ replaced it ⇒ ⇒ ⇒ we give it back and try again ⇒ ⇒ ⇒ ⇒ the
* ⭐⭐⭐ ⇒ ⇒ steal of a live claim is IMPOSSIBLE.
*/
/**
* ⭐⭐⭐ M-105: THE SEAM — a hook that the test uses to freeze the two
* ⭐⭐⭐ processes at the SAME point of the protocol ⇒ ⇒ ⇒ so the race is
* ⭐⭐⭐ DETERMINISTIC (not a race that happens by luck) ⇒ ⇒ ⇒ ⇒ and it
* ⭐⭐⭐ is the SAME point in every version of this file ⇒ ⇒ ⇒ ⇒ ⇒ ⇒ ⇒
* ⭐⭐⭐ ⇒ ⇒ ⇒ so ONE test can prove the defect AND the fix.
*/
export interface PortSeam {
  /** ⭐⭐ called right after the decision and BEFORE the destructive act. */
  afterDecision?: () => void;
}

/**
* ⭐⭐⭐ M-105: the helpers of the claim — they hide whether the claim is
* ⭐⭐⭐ a file or a directory ⇒ ⇒ ⇒ so the test of the race is written
* ⭐⭐⭐ ONCE ⇒ ⇒ ⇒ and it does not know the representation.
*/
export function writeStaleClaim(claim: string, ownerFile: string): void {
  fs.rmSync(claim, { force: true, recursive: true });
  fs.mkdirSync(claim, { recursive: true });
  fs.linkSync(ownerFile, claimOwnerPath(claim));
}

export function readClaimOwner(claim: string): PortOwner | null {
  return readOwner(claimOwnerPath(claim));
}

export function replaceClaimOwner(claim: string, ownerFile: string): void {
  fs.rmSync(claimOwnerPath(claim), { force: true });
  fs.linkSync(ownerFile, claimOwnerPath(claim));
}

// ⭐⭐⭐ M-109: THE CLAIM OF A BLOCK IS ARBITRATED BY THE KERNEL.
// ⭐⭐⭐ WHY: the old protocol decided the owner with the FILE SYSTEM ⇒ ⇒
// ⭐⭐⭐ a directory + an atomic link() + a RECLAIM of a stale claim ⇒ ⇒
// ⭐⭐⭐ ⇒ ⇒ and the reclaim MOVED the identity of the claim out BEFORE
// ⭐⭐⭐ ⇒ ⇒ it checked that the identity is the stale one it judged ⇒ ⇒
// ⭐⭐⭐ ⇒ ⇒ ⇒ so a reclaimer with an OLD reading could move the FRESH
// ⭐⭐⭐ ⇒ ⇒ ⇒ identity of another process away ⇒ ⇒ ⇒ and a third
// ⭐⭐⭐ ⇒ ⇒ ⇒ process could take the free name ⇒ ⇒ ⇒ TWO
// ⭐⭐⭐ ⇒ ⇒ ⇒ processes believed they own the same block.
// ⭐⭐⭐ THE FIX: the owner of a block is the process that HOLDS a guard
// ⭐⭐⭐ ⇒ ⇒ an ABSTRACT unix socket whose name is the base port ⇒ ⇒ ⇒
// ⭐⭐⭐ ⇒ ⇒ the kernel arbitrates the name (bind() is atomic) ⇒ ⇒ ⇒
// ⭐⭐⭐ ⇒ ⇒ and the kernel RELEASES the name when the process dies ⇒ ⇒ ⇒
// ⭐⭐⭐ ⇒ ⇒ ⇒ so there is NO reclaim, NO takeover, NO window and
// ⭐⭐⭐ ⇒ ⇒ ⇒ NO stale claim ⇒ ⇒ ⇒ and the block of a
// ⭐⭐⭐ ⇒ ⇒ ⇒ dead process is free at once.
// ⭐⭐⭐ THE RECORD IN THE DIRECTORY IS ONLY A RECORD NOW ⇒ ⇒ ⇒ it says
// ⭐⭐⭐ ⇒ ⇒ ⇒ who holds the block (for the humans) ⇒ ⇒ ⇒ and it is NOT
// ⭐⭐⭐ ⇒ ⇒ ⇒ the arbitration ⇒ ⇒ ⇒ so writing it can never steal
// ⭐⭐⭐ ⇒ ⇒ ⇒ the claim of another process.
const PORT_GUARD_PREFIX = '\0wasl-pb-';

/** ⭐⭐⭐ the live guards, by the path of the claim. */
const PORT_GUARDS = new Map<string, { server: net.Server; token: string }>();

/**
* ⭐⭐⭐ M-109: the name of the guard of a claim.
* ⭐⭐⭐ It is derived from the BASE PORT (not from the path) ⇒ ⇒ ⇒ so it
* ⭐⭐⭐ does not depend on the temporary directory ⇒ ⇒ ⇒ and two
* ⭐⭐⭐ processes on the same machine always agree on it.
*/
export function portGuardName(marker: string): string {
  const match = /block-(\d+)$/.exec(marker);
  if (match?.[1]) return `${PORT_GUARD_PREFIX}${match[1]}`;
  // a claim that is not a block (the probes of the tests) ⇒ ⇒ ⇒ a hash
  // of the full path ⇒ ⇒ ⇒ it is still stable across the processes.
  let hash = 0;
  for (let index = 0; index < marker.length; index += 1) {
    hash = (hash * 31 + marker.charCodeAt(index)) >>> 0;
  }
  return `${PORT_GUARD_PREFIX}x${hash.toString(16)}`;
}

/** ⭐⭐⭐ close a guard and wait until the kernel freed the name. */
async function closeGuard(marker: string, owner?: PortOwner): Promise<void> {
  const entry = PORT_GUARDS.get(marker);
  if (!entry) return;
  if (owner && entry.token !== owner.token) {
    // the guard belongs to another owner => it is NOT ours to close =>
    // the claim of that owner survives this release.
    return;
  }
  PORT_GUARDS.delete(marker);
  await new Promise<void>((resolve) => {
    try {
      entry.server.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

/**
* ⭐⭐⭐ M-109: TAKE THE CLAIM OF A BLOCK.
* ⭐⭐⭐ THE MECHANISM: bind an abstract unix socket whose name is the
* ⭐⭐⭐ base port ⇒ ⇒ ⇒ the kernel is the judge ⇒ ⇒ ⇒ and it refuses
* ⭐⭐⭐ the second binder with EADDRINUSE ⇒ ⇒ ⇒ so two files
* ⭐⭐⭐ ⇒ ⇒ ⇒ can NEVER own one block ⇒ ⇒ ⇒ no
* ⭐⭐⭐ ⇒ ⇒ ⇒ double reservation, ever.
* ⭐⭐⭐ THE STALE CLAIM: there is none any more ⇒ ⇒ ⇒
* ⭐⭐⭐ ⇒ ⇒ ⇒ the kernel frees the name when the owner dies ⇒ ⇒ ⇒
* ⭐⭐⭐ ⇒ ⇒ ⇒ so the block of a dead process is taken
* ⭐⭐⭐ ⇒ ⇒ ⇒ at once ⇒ ⇒ ⇒ .
*/
export async function takeMarker(
  marker: string,
  owner: PortOwner,
  ownerFile: string,
  seam?: PortSeam,
): Promise<boolean> {
  const name = portGuardName(marker);
  const server = net.createServer();
  // ⭐⭐⭐ THE SEAM: the decision is taken and the ACT (the bind) did not
  // ⭐⭐⭐ happen yet ⇒ ⇒ ⇒ so the test can freeze the process HERE ⇒
  // ⭐⭐⭐ ⇒ ⇒ ⇒ and the race becomes deterministic (not by luck).
  seam?.afterDecision?.();
  const bound = await new Promise<boolean>((resolve) => {
    let settled = false;
    const settle = (value: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    // ⭐⭐⭐ fail-closed: ANY error means we do NOT own the block.
    server.once('error', () => settle(false));
    server.listen(name, () => settle(true));
  });
  if (!bound) {
    try {
      server.close();
    } catch {
      // it never listened.
    }
    return false;
  }
  server.on('error', () => undefined);
  PORT_GUARDS.set(marker, { server, token: owner.token });
  // ⭐⭐⭐ THE RECORD (who holds the block) ⇒ ⇒ ⇒ it is a convenience for
  // ⭐⭐⭐ the humans ⇒ ⇒ ⇒ and NOT the arbitration ⇒ ⇒ ⇒
  // ⭐⭐⭐ ⇒ ⇒ ⇒ so it can never steal the claim of another one.
  try {
    fs.mkdirSync(marker, { recursive: true });
    fs.writeFileSync(claimOwnerPath(marker), `${owner.token}|${owner.pid}|${owner.start}`);
  } catch {
    // the record is not the arbitration ⇒ a failure here is not fatal.
  }
  return true;
}

/**
* ⭐⭐⭐ M-109: GIVE A CLAIM BACK.
* ⭐⭐⭐ THE MECHANISM: close the guard of THIS process ⇒ ⇒ ⇒
* ⭐⭐⭐ ⇒ ⇒ ⇒ the kernel frees the name ⇒ ⇒ ⇒
* ⭐⭐⭐ ⇒ ⇒ ⇒ and only THIS process can
* ⭐⭐⭐ ⇒ ⇒ ⇒ close it ⇒ ⇒ ⇒
* ⭐⭐⭐ ⇒ ⇒ ⇒
* ⭐⭐⭐ ⇒ ⇒ ⇒
* ⭐⭐⭐ ⇒ ⇒ ⇒
* ⭐⭐⭐ ⇒ ⇒ ⇒
* ⭐⭐⭐ ⇒ ⇒ the release can NEVER touch the claim of another process.
*/
export async function releaseMarker(
  claim: string,
  owner: PortOwner,
  ownerFile: string,
  seam?: PortSeam,
): Promise<void> {
  seam?.afterDecision?.();
  await closeGuard(claim, owner);
  // the record: it is deleted ONLY when it is ours ⇒ ⇒ ⇒
  // ⇒ ⇒ ⇒ a claim that another process took survives us.
  const ownerPath = claimOwnerPath(claim);
  const held = readOwner(ownerPath);
  if (!held || held.token === owner.token) {
    unlinkQuietly(ownerPath);
    try {
      fs.rmdirSync(claim);
    } catch {
      // not empty: somebody else owns the record now.
    }
  }
  unlinkQuietly(ownerFile);
}

/**
* ⭐⭐⭐ M-109: give a claim back WITHOUT waiting for the owner ⇒ ⇒ ⇒ it
* ⭐⭐⭐ is used when the ports of the block turned out to be taken ⇒ ⇒ ⇒
* ⭐⭐⭐ ⇒ ⇒ ⇒ so the guard is closed and the block goes back to the pool.
*/
export async function dropClaim(claim: string, owner: PortOwner): Promise<void> {
  await closeGuard(claim, owner);
  const ownerPath = claimOwnerPath(claim);
  const held = readOwner(ownerPath);
  if (!held || held.token === owner.token) {
    unlinkQuietly(ownerPath);
    try {
      fs.rmdirSync(claim);
    } catch {
      // not empty: somebody else owns the record now.
    }
  }
}

/** ⭐⭐ Reserve a block of ports (atomic ⇒ two files never share one). */
export async function reservePortBlock(
  blockSize = 30,
): Promise<{ base: number; release: () => void }> {
  fs.mkdirSync(PORT_BLOCK_DIR, { recursive: true });
  // ⭐⭐⭐ M-101: the identity of THIS process ⇒ ⇒ (pid, start time, a
  // ⭐⭐⭐ random token) ⇒ ⇒ the token is what the marker carries ⇒ ⇒
  // ⭐⭐⭐ and the release can PROVE that the marker is still ours.
  const owner: PortOwner = {
    token: `${process.pid}-${processStartTime(process.pid)}-${Math.random().toString(36).slice(2, 10)}`,
    pid: process.pid,
    start: processStartTime(process.pid),
  };
  const ownerFile = writeOwnerFile(owner);
  // ⭐⭐⭐ M-99: the candidates cover EVERY block of the port space of
  //   the machine ⇒ ⭐⭐ a pid that lands high does not narrow the
  //   search (that was the bug: the block went past 65535 and the
  //   search stopped at once ⇒ `no_free_port_block`).
  const totalBlocks = Math.floor((65535 - 8791) / blockSize);
  const hint = (process.pid * 7919) % totalBlocks;
  try {
    for (let k = 0; k < totalBlocks; k += 1) {
      const base = 8791 + ((hint + k) % totalBlocks) * blockSize;
      const marker = path.join(PORT_BLOCK_DIR, `block-${base}`);
      if (!(await takeMarker(marker, owner, ownerFile))) continue;
      // ⭐⭐⭐ M-101: the marker is NOT a proof that the ports are free
      // ⭐⭐⭐ (something outside the marker system may hold a port) ⇒ ⇒
      // ⭐⭐⭐ so the probe stays as the second line of defence.
      let free = true;
      for (let offset = 0; offset < blockSize; offset += 1) {
        if (!(await portIsFree(base + offset))) {
          free = false;
          break;
        }
      }
      if (free) {
        return {
          base,
          release: async () => {
            await releaseMarker(marker, owner, ownerFile);
          },
        };
      }
      // ⭐⭐ the block is taken by something else ⇒ ⇒ give it back.
      await dropClaim(marker, owner);
    }
  } finally {
    unlinkQuietly(ownerFile);
  }
  throw new Error('no_free_port_block');
}

/**
* ⭐⭐⭐ M-100: THE ADVISORY LOCK OF THE EVIDENCE IS GONE ⇐ AND THIS IS
* ⭐⭐⭐ THE POINT.
* ⭐⭐⭐ The trigger `tenant_deletion_evidence_immutable` is a GLOBAL
* ⭐⭐⭐ resource (one table for every company) ⇒ ⭐⭐⭐ it cannot be
* ⭐⭐⭐ namespaced ⇒ ⭐⭐⭐ ⇒ the old answer was an advisory lock ⇒ ⭐⭐⭐
* ⭐⭐⭐ ⇒ but an advisory lock only binds the operations that RESPECT
* ⭐⭐⭐ ⇒ it ⇒ ⭐⭐⭐ ⇒ and the guard was ALSO disabled OUTSIDE the lock
* ⭐⭐⭐ ⇒ ⇒ ⇒ the window was real ⇒ ⇒ ⇒ the window is now closed by
* ⭐⭐⭐ ⇒ the TRANSACTION itself (ACCESS EXCLUSIVE) ⇒ ⇒ ⇒ and the
* ⭐⭐⭐ ⇒ lock key is DELETED (a key without a call site is dead code
  * ⭐⭐⭐ ⇒ ⇒ and the audit of the shared resources checks exactly that).
* ⭐⭐⭐ ⛔ There is NO key here ⇒ ⇒ the only lock of the platform
* ⭐⭐⭐ ⛔ budget keeps its own ⇒ ⇒ and the audit sees one key and one
* ⭐⭐⭐ ⛔ call site ⇒ ⇒ ⇒ as it must be.
*/

/**
* ⭐⭐ Run a drill that measures the platform login budget, alone.
* ⭐ The lock is held on ONE connection for the whole drill ⇒ ⭐ the
*   budget of the installation is not shared with another measurement.
*/
export async function withPlatformBudgetLock<T>(
  pool: PgPool,
  fn: () => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(`select pg_advisory_lock($1)`, [PLATFORM_BUDGET_LOCK_KEY]);
    try {
      return await fn();
    } finally {
      await client.query(`select pg_advisory_unlock($1)`, [PLATFORM_BUDGET_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

/**
* ⭐⭐ D-072 / M-82: the reset of ONE company of the file that owns it.
* ⭐⭐ WHY
*   ⭐⭐ The rows of a company are keyed by the tenant ⇒ a company of
*     its own is ISOLATED from every other company of the database.
*   ⭐⭐ The reset therefore CANNOT touch the rows of another file ⇒
*     ⭐⭐ no test can erase the data of another test.
*   ⭐⭐ And the leftovers of an OLD run of the same file are gone
*     before the fixture is built ⇒ ⭐⭐ the result of a file never
*     depends on what a previous run left behind.
* ⛔ It never touches a company that the file does not own.
*/
export async function resetCompany(ownerPool: PgPool, tenantId: string): Promise<void> {
  await UnitOfWork.run(ownerPool, tenantId, async (uow) => {
    await uow.query(`delete from messages where tenant_id = $1`, [tenantId]);
    await uow.query(`delete from conversation_changes where tenant_id = $1`, [tenantId]);
    await uow.query(`delete from read_audit_events where tenant_id = $1`, [tenantId]);
    await uow.query(`delete from audit_events where tenant_id = $1`, [tenantId]);
    await uow.query(`delete from conversations where tenant_id = $1`, [tenantId]);
    await uow.query(`delete from support_ticket_changes where tenant_id = $1`, [tenantId]);
    await uow.query(`delete from support_tickets where tenant_id = $1`, [tenantId]);
    await uow.query(`delete from customers where tenant_id = $1`, [tenantId]);
    await uow.query(`delete from sessions where tenant_id = $1`, [tenantId]);
    await uow.query(`delete from login_attempts where tenant_id = $1`, [tenantId]);
    await uow.query(`delete from memberships where tenant_id = $1`, [tenantId]);
    await uow.query(`delete from tenants where id = $1`, [tenantId]);
  });
}

/**
* ⭐⭐ D-069 / M68: purge the synthetic evidence of a tenant.
* ⭐ The evidence is IMMUTABLE (the guard refuses every UPDATE and
  *   every DELETE, even for the owner role), so the cleanup of the
*   synthetic rows has to disable the guard ON PURPOSE. ⛔ This is
*   the only path that may remove an evidence, and it is a test tool:
*   the request path can never reach it.
*/
export async function purgeEvidence(
  ownerPool: PgPool,
  tenantId: string,
  between?: () => Promise<void>,
): Promise<void> {
  // ⭐⭐⭐ M-100: THE TRIGGER IS NEVER LEFT OFF.
  // ⭐⭐⭐ WHY: `disable trigger` switches the guard off for the WHOLE
  //   table ⇒ ⭐⭐⭐ so the three steps MUST be ONE transaction ⇒ ⭐⭐⭐
  //   WHY IT IS ENOUGH (measured by M-100):
  //   ① `alter table ... disable trigger` is TRANSACTIONAL in
  //      PostgreSQL ⇒ ⇒ a crash or an exception ROLLS IT BACK ⇒ ⇒
  //      the guard returns to its correct state BY ITSELF ⇒ ⇒ no
  //      `finally` that can be skipped by a crash;
  //   ② the ALTER takes ACCESS EXCLUSIVE on the table ⇒ ⇒ every other
  //      session WAITS ⇒ ⇒ ⇒ nobody ever OBSERVES the guard as off ⇒
  //      ⇒ ⇒ an unauthorized change cannot slip through ⇒ ⇒ and the
  //      serialization is done by the DATABASE, not by a lock that
  //      only the polite operations respect.
  // ⭐⭐⭐ SO: NO ADVISORY LOCK HERE ANYMORE ⇐ the table lock does it,
  //   and it does it against EVERYBODY.
  // ⭐⭐ `between` is the hook of the proof: it runs INSIDE the
  //   transaction ⇒ ⭐⭐ so the test can observe the state of the
  //   guard from another connection while the purge is in flight.
  const client = await ownerPool.connect();
  try {
    await client.query('begin');
    try {
      await client.query(
        `alter table tenant_deletion_evidence disable trigger tenant_deletion_evidence_immutable`,
      );
      await client.query(`delete from tenant_deletion_evidence where tenant_id = $1`, [tenantId]);
      if (between) await between();
      await client.query(
        `alter table tenant_deletion_evidence enable trigger tenant_deletion_evidence_immutable`,
      );
      await client.query('commit');
    } catch (error) {
      // ⭐⭐ the rollback is what restores the guard ⇐ it must never be
      // ⭐⭐ swallowed ⇒ ⭐⭐ but a failure of the rollback itself must
      // ⭐⭐ not hide the original error.
      await client.query('rollback').catch(() => undefined);
      throw error;
    }
  } finally {
    client.release();
  }
}

/**
* ⭐⭐⭐ M-100: run a statement with the immutability guard OFF, safely.
* ⭐⭐⭐ WHY THIS HELPER EXISTS
* ⭐⭐⭐ `alter table ... disable trigger` switches the guard off for the
* ⭐⭐⭐ WHOLE TABLE ⇐ it is a global resource ⇐ so between the `disable`
* ⭐⭐⭐ and the `enable` the guard protects NOTHING.
* ⭐⭐⭐ THE FIX (and it is a fix, not a convention): the two ALTERs and
* ⭐⭐⭐ everything between them live in ONE transaction ⇒ ⇒
* ⭐⭐⭐ ① the ALTER holds ACCESS EXCLUSIVE on the table for the whole
* ⭐⭐⭐    transaction ⇒ ⇒ ⇒ any other session that tries to write to
* ⭐⭐⭐    the table WAITS ⇒ ⇒ ⇒ so nobody can observe the guard as
* ⭐⭐⭐    off ⇒ ⇒ ⇒ ⇒ an unauthorized change CANNOT slip through;
* ⭐⭐⭐ ② a crash or an exception ROLLS BACK the transaction ⇒ ⇒ ⇒
* ⭐⭐⭐    the `disable` is undone BY THE DATABASE ⇒ ⇒ ⇒ the guard
* ⭐⭐⭐    returns to its correct state even when the process dies ⇒ ⇒
* ⭐⭐⭐    ⇒ there is no `finally` that a crash can skip.
* ⭐⭐⭐ ⇒⇒⇒ THE SAFETY IS ENFORCED BY POSTGRESQL, NOT BY DISCIPLINE.
* ⛔ It never leaves the guard off between two statements.
*/
export async function withEvidenceGuardDisabled<T>(
  pool: PgPool,
  fn: (client: PgClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    try {
      await client.query(
        `alter table tenant_deletion_evidence disable trigger tenant_deletion_evidence_immutable`,
      );
      const value = await fn(client);
      await client.query(
        `alter table tenant_deletion_evidence enable trigger tenant_deletion_evidence_immutable`,
      );
      await client.query('commit');
      return value;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    }
  } finally {
    client.release();
  }
}

/**
* ⭐⭐ The privileged connection, pointed at the DATABASE OF THE
*   APPLICATION (the superuser is the ROLE, not the database).
* ⭐⭐ ONE PLACE ⇒ ⇒ a drill cannot connect to the wrong database by
*   ⭐⭐ accident ⇒ ⇒ (the URL was copied in three files).
*/
export function superuserUrl(databaseName: string): string {
  const base =
  process.env['WASL_PG_SUPERUSER_URL'] ?? 'postgresql://postgres@127.0.0.1:5432/postgres';
  const parsed = new URL(base);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

export async function loginAs(
  client: LocalApiClient,
  tenantId: string,
  userId: string,
  passcode: string,
): Promise<string> {
  const response = await client.request({
    method: 'POST',
    path: '/api/session',
    payload: { tenant_id: tenantId, user_id: userId, passcode },
  });
  const token = response.body['token'];
  if (response.status !== 200 || typeof token !== 'string') {
    throw new HarnessError('login_failed', `login failed for ${tenantId}/${userId}: ${response.status}`);
  }
  return token;
}

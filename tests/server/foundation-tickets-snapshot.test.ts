// ============================================================
// WASL AI — M-121 — the counter of the queue and its list
// ------------------------------------------------------------
// ⭐⭐ WHAT THIS FILE PROVES (a PERMANENT file, not a throwaway):
//   ① ⭐⭐⭐ THE SNAPSHOT: the rows of the page, its total and the
//      counter of the queue describe ONE state of the data ⇒ ⇒ ⇒
//      ⭐⭐⭐ so a ticket that is assigned WHILE the page is being
//      ⭐⭐⭐ read cannot make the page and its numbers disagree;
//   ② ⭐⭐⭐ THE WINDOW IS DETERMINISTIC: the assignment happens
//      ⭐⭐⭐ between the rows of the page and its counters ⇒ ⇒ ⇒
//      ⭐⭐⭐ (a real writer on another connection, and the SQL of the
//      ⭐⭐⭐ product is never mocked — only WHEN it runs is moved);
//   ③ ⭐⭐⭐ THE FILTERS AND THE PAGINATION follow the same snapshot
//      ⭐⭐⭐ (the filter of the queue, the limit and the offset);
//   ④ ⭐⭐⭐ THE ISOLATION: the counter of one company NEVER counts a
//      ⭐⭐⭐ ticket of another company (even inside the window).
// ⛔ Local synthetic database only. ⛔ No new capability: the rights
//    of the assignment are the ones of the core (the bridge of D-078).
// ============================================================

import assert from 'node:assert/strict';
import test from 'node:test';

import type { PgClient, PgPool } from '../../server/db/pool.ts';
import { UnitOfWork } from '../../server/db/unit-of-work.ts';
import { loginAs, resetSyntheticData, startHarness } from './harness.ts';

const NS = 'snp';
const PASSCODE = process.env['WASL_TEST_PASSCODE'] ?? 'wasl-local-test';
const ALPHA = `${NS}_tnt_alpha`;
const BETA = `${NS}_tnt_beta`;
const OWNER = `${NS}_usr_alpha_owner`;
const AGENT = `${NS}_usr_alpha_agent`;
const BETA_OWNER = `${NS}_usr_beta_owner`;
const CUSTOMER = `${NS}_cus_alpha_1`;
const BETA_CUSTOMER = `${NS}_cus_beta_1`;

interface ListBody {
  readonly ok?: boolean;
  readonly tickets?: { readonly ref: string; readonly assignee_actor_id?: string | null }[];
  readonly total?: number;
  readonly unassigned_count?: number;
}

/**
 * ⭐⭐⭐ A POOL THAT WAITS ⭐⭐⭐ — ⭐⭐⭐ the SQL of the product is NOT
 *   ⭐⭐⭐ mocked: ⭐⭐⭐ only the MOMENT of the first statement of the
 *   ⭐⭐⭐ list is moved ⇒ ⇒ ⇒ (the window of the concurrency is
 *   ⭐⭐⭐ deterministic ⇒ ⇒ ⇒ not a race of the clock).
 */
interface WindowGate {
  /** ⭐⭐⭐ is the window armed? */
  armed: boolean;
  /** ⭐⭐⭐ has the window already opened (for this scenario)? */
  paused: boolean;
}

function pausingPool(
  pool: PgPool,
  gate: WindowGate,
  afterFirstListQuery: () => Promise<void>,
): PgPool {
  const proxy = {
    connect: async (): Promise<PgClient> => {
      const client = await pool.connect();
      return {
        query: async (text: string, values?: readonly unknown[]) => {
          const result = await client.query(text, values as unknown[]);
          // ⭐⭐⭐ ONLY the list of the product pauses ⇒ ⇒ ⇒ the
          // ⭐⭐⭐ cleanup and the writes of the test are never touched.
          if (gate.armed && !gate.paused && /select\s+t\.ref/i.test(text)) {
            gate.paused = true;
            await afterFirstListQuery();
          }
          return result;
        },
        release: () => client.release(),
      } as unknown as PgClient;
    },
    on: (event: string, listener: (error: unknown) => void) => pool.on(event, listener),
    end: () => pool.end(),
  } as unknown as PgPool;
  return proxy;
}

/**
 * ⭐⭐⭐ THE WRITER OF THE WINDOW: ⭐⭐⭐ an assignment on ANOTHER
 *   ⭐⭐⭐ CONNECTION ⇒ ⇒ ⇒ (another transaction of the real database
 *   ⭐⭐⭐ ⇒ ⇒ ⇒ and it COMMITS ⇒ ⇒ ⇒ so the reader of the page sees
 *   ⭐⭐⭐ the new state or not ⇒ ⇒ ⇒ according to ITS snapshot only).
 */
async function assignFromAnotherConnection(
  harness: Awaited<ReturnType<typeof startHarness>>,
  tenantId: string,
  ref: string,
  assigneeActorId: string,
): Promise<void> {
  await UnitOfWork.run(harness.ownerPool, tenantId, async (uow) => {
    const result = await uow.query(
      `update support_tickets
          set assignee_actor_id = $3,
              version = version + 1,
              updated_at = now()
        where tenant_id = $1 and ref = $2
        returning ref`,
      [tenantId, ref, assigneeActorId],
    );
    assert.equal(result.rows.length, 1, `the assignment of ${ref} did not happen`);
  });
}

test('FOUNDATION 4) M-121 — the counter of the queue and its list are ONE snapshot', async (t) => {
  // ⭐⭐⭐ The window: the writer assigns a ticket of the queue while
  // ⭐⭐⭐ the page of the queue is being read.
  let window: (() => Promise<void>) | null = null;
  const gate: WindowGate = { armed: false, paused: false };

  const harness = await startHarness({
    namespace: NS,
    wrapPool: (pool) =>
      pausingPool(pool, gate, async () => {
        if (window) await window();
      }),
  });
  t.after(async () => {
    await harness.stop();
  });
  await resetSyntheticData(harness.ownerPool, PASSCODE, ['tnt_alpha', 'tnt_beta'], NS);

  const owner = await loginAs(harness.client, ALPHA, OWNER, PASSCODE);
  const agent = await loginAs(harness.client, ALPHA, AGENT, PASSCODE);
  const betaOwner = await loginAs(harness.client, BETA, BETA_OWNER, PASSCODE);

  const refs: string[] = [];
  for (let index = 1; index <= 3; index += 1) {
    const ref = `tkt_${NS}_open_${index}`;
    refs.push(ref);
    const created = await harness.client.request({
      method: 'POST',
      path: '/api/tickets',
      token: owner,
      payload: {
        ref,
        customer_id: CUSTOMER,
        subject: `تذكرة مفتوحة ${index}`,
        description: 'وصف',
        priority: 'normal',
      },
    });
    assert.equal(created.status, 201, `the ticket ${ref} was refused: ${created.status}`);
  }

  // ⭐⭐⭐ A ticket of ANOTHER company (it must never be counted).
  const betaRef = `tkt_${NS}_other_company`;
  const betaTicket = await harness.client.request({
    method: 'POST',
    path: '/api/tickets',
    token: betaOwner,
    payload: {
      ref: betaRef,
      customer_id: BETA_CUSTOMER,
      subject: 'تذكرة شركة تانية',
      description: 'وصف',
    },
  });
  assert.equal(betaTicket.status, 201, `the ticket of the other company was refused`);

  // ----------------------------------------------------------------
  // ① the window: the assignment lands between the rows and the counters
  // ----------------------------------------------------------------
  gate.armed = true;
  gate.paused = false;
  window = async () => {
    // ⭐⭐⭐ THE WRITER: ⭐⭐⭐ another CONNECTION (the pool of the
    // ⭐⭐⭐ owner) ⇒ ⇒ ⇒ a real transaction that COMMITS ⇒ ⇒ ⇒ so
    // ⭐⭐⭐ the reader (which is paused between its statements) sees
    // ⭐⭐⭐ the new state or not ⇒ ⇒ ⇒ according to its snapshot.
    await assignFromAnotherConnection(harness, ALPHA, refs[0], AGENT);
  };

  const page = await harness.client.request({
    method: 'GET',
    path: '/api/tickets?unassigned=1&limit=25&offset=0',
    token: owner,
  });
  assert.equal(page.status, 200, `the queue was refused: ${page.status}`);
  const body = page.body as ListBody;

  // ⭐⭐⭐ THE ASSERTION: ⭐⭐⭐ the page, its total and the counter
  // ⭐⭐⭐ describe ONE state ⇒ ⇒ ⇒ the page can never show MORE
  // ⭐⭐⭐ rows than its own total says ⇒ ⇒ ⇒ and the counter of the
  // ⭐⭐⭐ queue is the total of the queue.
  assert.equal(
    (body.tickets ?? []).length,
    3,
    'the page of the queue must show the three tickets of the snapshot',
  );
  assert.equal(body.total, 3, 'the total of the queue must be the count of the same snapshot');
  assert.equal(
    body.unassigned_count,
    body.total,
    'the counter of the queue and the total of the queue are ONE question',
  );
  assert.ok(
    (body.tickets ?? []).length <= (body.total ?? 0),
    'the page cannot show more rows than its total',
  );

  // ----------------------------------------------------------------
  // ② the same window WITHOUT the queue filter (the ordinary list)
  // ----------------------------------------------------------------
  gate.armed = true;
  gate.paused = false;
  window = async () => {
    await assignFromAnotherConnection(harness, ALPHA, refs[1], AGENT);
  };
  const ordinary = await harness.client.request({
    method: 'GET',
    path: '/api/tickets?limit=25&offset=0',
    token: owner,
  });
  assert.equal(ordinary.status, 200, `the list was refused: ${ordinary.status}`);
  const ordinaryBody = ordinary.body as ListBody;
  assert.equal(
    (ordinaryBody.tickets ?? []).length,
    3,
    'the ordinary list must show the three tickets of the snapshot',
  );
  assert.equal(ordinaryBody.total, 3, 'the total of the list must be the count of the same snapshot');
  assert.equal(
    ordinaryBody.unassigned_count,
    2,
    'the counter of the queue must be the count of the same snapshot',
  );

  // ----------------------------------------------------------------
  // ③ the filters and the pagination follow the same snapshot
  // ----------------------------------------------------------------
  window = null;
  gate.armed = false;
  const filtered = await harness.client.request({
    method: 'GET',
    path: '/api/tickets?unassigned=1&state=open&limit=1&offset=0',
    token: owner,
  });
  assert.equal(filtered.status, 200, `the filtered queue was refused: ${filtered.status}`);
  const filteredBody = filtered.body as ListBody;
  assert.equal((filteredBody.tickets ?? []).length, 1, 'the limit of the queue must be respected');
  assert.equal(filteredBody.total, 1, 'the total of the filtered queue must respect the filter');
  assert.equal(filteredBody.unassigned_count, 1, 'the counter must follow the same filter');

  // ⭐⭐⭐ THE PAGINATION of the ordinary list (three tickets) ⇒ ⇒ ⇒
  // ⭐⭐⭐ the first page and the second page are different rows and
  // ⭐⭐⭐ the total is the same for both (one snapshot each).
  const firstPage = await harness.client.request({
    method: 'GET',
    path: '/api/tickets?limit=1&offset=0',
    token: owner,
  });
  const secondPage = await harness.client.request({
    method: 'GET',
    path: '/api/tickets?limit=1&offset=1',
    token: owner,
  });
  assert.equal(firstPage.status, 200, `the first page was refused`);
  assert.equal(secondPage.status, 200, `the second page was refused`);
  const firstBody = firstPage.body as ListBody;
  const secondBody = secondPage.body as ListBody;
  assert.equal((firstBody.tickets ?? []).length, 1, 'the first page must have one row');
  assert.equal((secondBody.tickets ?? []).length, 1, 'the second page must have its own row');
  assert.equal(firstBody.total, 3, 'the total of the list is the same for every page');
  assert.equal(secondBody.total, 3, 'the total of the list is the same for every page');
  assert.notEqual(
    (secondBody.tickets ?? [])[0]?.ref,
    (firstBody.tickets ?? [])[0]?.ref,
    'the pages must not repeat the same ticket',
  );

  // ----------------------------------------------------------------
  // ④ the isolation: the counter of one company never counts another
  // ----------------------------------------------------------------
  const betaQueue = await harness.client.request({
    method: 'GET',
    path: '/api/tickets?unassigned=1',
    token: betaOwner,
  });
  assert.equal(betaQueue.status, 200, `the queue of the other company was refused`);
  const betaBody = betaQueue.body as ListBody;
  assert.equal(
    betaBody.unassigned_count,
    1,
    'the counter of the other company counts only its own ticket',
  );
  assert.equal(betaBody.total, 1, 'the total of the other company counts only its own ticket');
  for (const ticket of betaBody.tickets ?? []) {
    assert.equal(ticket.ref, betaRef, 'the queue of the other company shows only its own ticket');
  }
});

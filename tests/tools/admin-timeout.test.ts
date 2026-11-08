// ============================================================
// WASL AI — D-074 / M-102 — the scope of the statement timeout
// ------------------------------------------------------------
// ⭐⭐⭐ THE QUESTION: the 120-second timeout belongs to the
//   ADMINISTRATIVE connections only ⇒ ⇒ ⇒ and the pool of the API
//   stays at 15 seconds ⇒ ⇒ ⇒ including when a pooled connection is
//   REUSED ⇒ ⇒ ⇒ and after a FAILURE.
// ⭐⭐⭐ WHY IT IS MEASURED (and not read in the source): a number in
//   the source is an intention ⇒ ⇒ ⇒ the value that the SERVER really
//   applies is the one that PostgreSQL reports ⇒ ⇒ ⇒ so the drill asks
//   PostgreSQL itself (`show statement_timeout`).
// ⛔ It never touches a database of a customer: it uses the local one.
// ============================================================

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADMIN_STATEMENT_TIMEOUT_MS,
  API_STATEMENT_TIMEOUT_MS,
  createPool,
} from '../../server/db/pool.ts';
import { startHarness, superuserUrl } from '../server/harness.ts';

/** ⭐⭐ The timeout that the SERVER applies to this session. */
async function effectiveTimeout(
  pool: Awaited<ReturnType<typeof createPool>>,
): Promise<number> {
  const result = await pool.query<{ statement_timeout: string }>(`show statement_timeout`);
  const raw = String(result.rows[0]?.statement_timeout ?? '');
  if (raw.endsWith('ms')) return Number(raw.slice(0, -2));
  if (raw.endsWith('s')) return Number(raw.slice(0, -1)) * 1000;
  if (raw.endsWith('min')) return Number(raw.slice(0, -3)) * 60_000;
  return Number(raw);
}

test('FOUNDATION 04) the timeout of the statements (M-102)', async (t) => {
  const harness = await startHarness();
  t.after(async () => {
    await harness.stop();
  });

  await t.test('⭐⭐⭐ M-102a: the API pool keeps the 15 seconds', async () => {
    assert.equal(API_STATEMENT_TIMEOUT_MS, 15_000, 'the timeout of the product moved');
    const api = createPool(harness.config.appDatabaseUrl, 2);
    try {
      assert.equal(
        await effectiveTimeout(api),
        15_000,
        'the pool of the API does not apply 15 seconds',
      );
    } finally {
      await api.end();
    }
  });

  await t.test('⭐⭐⭐ M-102b: the administrative pool asks for 120 seconds', async () => {
    assert.equal(ADMIN_STATEMENT_TIMEOUT_MS, 120_000, 'the administrative timeout moved');
    const admin = createPool(superuserUrl(harness.config.databaseName), 2, {
      statementTimeoutMs: ADMIN_STATEMENT_TIMEOUT_MS,
    });
    try {
      assert.equal(
        await effectiveTimeout(admin),
        120_000,
        'the administrative pool does not apply 120 seconds',
      );
    } finally {
      await admin.end();
    }
  });

  await t.test('⭐⭐⭐ M-102c: a POOLED connection keeps its timeout when it is REUSED', async () => {
    const api = createPool(harness.config.appDatabaseUrl, 1);
    try {
      const first = await effectiveTimeout(api);
      // ⭐⭐ the same connection is taken again from the pool ⇒ ⇒ the
      // ⭐⭐ timeout must be the one of the session, not of the query.
      const second = await effectiveTimeout(api);
      assert.equal(first, 15_000, 'the timeout of the product is wrong');
      assert.equal(second, 15_000, 'the timeout of a reused connection moved');
      const admin = createPool(superuserUrl(harness.config.databaseName), 1, {
        statementTimeoutMs: ADMIN_STATEMENT_TIMEOUT_MS,
      });
      try {
        const adminFirst = await effectiveTimeout(admin);
        const adminSecond = await effectiveTimeout(admin);
        assert.equal(adminFirst, 120_000, 'the administrative timeout is wrong');
        assert.equal(adminSecond, 120_000, 'the timeout of a reused administrative connection moved');
      } finally {
        await admin.end();
      }
    } finally {
      await api.end();
    }
  });

  await t.test('⭐⭐⭐ M-102d: a FAILURE does not change the timeout of the pool', async () => {
    const api = createPool(harness.config.appDatabaseUrl, 2);
    try {
      await assert.rejects(
        () => api.query(`select 1 from a_table_that_does_not_exist`),
        'the failing query did not fail',
      );
      assert.equal(
        await effectiveTimeout(api),
        15_000,
        'the timeout of the product moved after a failure',
      );
    } finally {
      await api.end();
    }
    const admin = createPool(superuserUrl(harness.config.databaseName), 2, {
      statementTimeoutMs: ADMIN_STATEMENT_TIMEOUT_MS,
    });
    try {
      await assert.rejects(
        () => admin.query(`select 1 from a_table_that_does_not_exist`),
        'the failing query did not fail',
      );
      assert.equal(
        await effectiveTimeout(admin),
        120_000,
        'the administrative timeout moved after a failure',
      );
    } finally {
      await admin.end();
    }
  });

  await t.test('⭐⭐⭐ M-102e: the timeout really cuts a long statement', async () => {
    // ⭐⭐ The proof that the number is not decorative: a statement
    // ⭐⭐ that lasts longer than the timeout is KILLED by the server
    // ⭐⭐ with the error of the timeout (and not by the client).
    const admin = createPool(superuserUrl(harness.config.databaseName), 1, {
      statementTimeoutMs: 1_500,
    });
    try {
      await assert.rejects(
        () => admin.query(`select pg_sleep(30)`),
        (error: unknown) => {
          const message = (error as Error).message;
          assert.match(message, /timeout|canceling statement/i, `another error: ${message}`);
          return true;
        },
      );
    } finally {
      await admin.end();
    }
  });
});

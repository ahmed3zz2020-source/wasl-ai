// ============================================================
// WASL AI — FOUNDATION BUILD 01 — connection pools
// ------------------------------------------------------------
// ⭐ TWO pools with two different roles:
//   - appPool   : role `wasl_app`  -> request path only.
//   - ownerPool : role `wasl_owner`-> migrations + seed only.
// ⛔ The request path NEVER uses ownerPool: the owner role owns the
//   tables, so using it in a request would defeat RLS.
// ⛔ No pool is created for, and no code path talks to, the internet.
// ============================================================

import pg from 'pg';

const { Pool } = pg;

export type QueryParam = unknown;

export interface QueryResultLike<Row> {
  readonly rows: Row[];
  readonly rowCount: number;
}

export interface Queryable {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly QueryParam[],
  ): Promise<QueryResultLike<Row>>;
}

export interface PgPool extends Queryable {
  connect(): Promise<PgClient>;
  end(): Promise<void>;
  /**
   * ⭐ The pool reports a broken connection as an `error` event.
   * ⭐ A listener MUST be attached: an EventEmitter without a listener
   *   turns a dropped connection into an unhandled error that can stop
   *   the process. The server attaches one (it logs the event).
   */
  on(event: 'error', listener: (error: Error) => void): void;
}

export interface PgClient extends Queryable {
  /** ⭐⭐ Destroy the connection instead of returning it to the pool. */
  release(destroy?: boolean): void;
}

/**
 * \u2b50\u2b50\u2b50 M-98: the options of the pool.
 * \u2b50 The timeout of a statement, in milliseconds.
 * \u2b50 The default (15 seconds) fits a request of the API.
 * \u2b50 An ADMINISTRATIVE drill (a backup, a restore, the creation
 *   of a scratch database) is a long operation by nature \u21d2 \u2b50 it
 *   asks for a longer timeout \u21d2 \u2b50 and the drill is measured
 *   (the RTO), not killed by the timeout of a request.
 * \u26d4 The default of the product does not move.
 */
export interface PoolOptions {
  readonly statementTimeoutMs?: number;
}

/**
 * ⭐⭐⭐ M-102: THE TIMEOUT OF AN ADMINISTRATIVE CONNECTION.
 * ⭐⭐⭐ WHY: an administrative operation (a backup, a restore, the
 * ⭐⭐⭐ creation of a scratch database, a DROP DATABASE) is LONG by
 * ⭐⭐⭐ nature ⇒ ⭐⭐⭐ and the timeout of a request (15 seconds) kills
 * ⭐⭐⭐ it in the middle ⇒ ⭐⭐⭐ ⇒ the operation is measured (the RTO),
 * ⭐⭐⭐ ⇒ it is not killed by the timeout of a request.
 * ⭐⭐⭐ ⛔ IT IS SCOPED TO THE ADMINISTRATIVE CONNECTIONS ⇐ the pool of
 * ⭐⭐⭐ ⇐ the API KEEPS THE DEFAULT OF 15 SECONDS ⇒ ⭐⭐⭐ ⇐ a slow
 * ⭐⭐⭐ ⇐ request of a customer is still cut at 15 seconds.
 * ⭐⭐⭐ ⭐ ONE CONSTANT, ONE PLACE ⇒ ⭐⭐⭐ ⭐ a pool that forgets it
 * ⭐⭐⭐ ⭐ cannot silently keep the short timeout ⇒ ⭐⭐⭐ ⭐ (the old
 * ⭐⭐⭐ ⭐ code had the number copied in three files).
 */
export const ADMIN_STATEMENT_TIMEOUT_MS = 120_000;

/** ⭐⭐⭐ M-102: the timeout of the PRODUCT (the API) — it does not move. */
export const API_STATEMENT_TIMEOUT_MS = 15_000;

export function createPool(
  connectionString: string,
  max = 8,
  options: PoolOptions = {},
): PgPool {
  if (typeof connectionString !== 'string' || !connectionString.startsWith('postgresql://')) {
    throw new Error('invalid_connection_string');
  }
  const pool = new Pool({
    connectionString,
    max,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    // \u26d4 No statement timeout magic: the local database is disposable.
    statement_timeout: options.statementTimeoutMs ?? API_STATEMENT_TIMEOUT_MS,
  });
  return pool as unknown as PgPool;
}

/** ⭐ Convenience: run a query on a pooled client and release it. */
export async function withClient<T>(
  pool: PgPool,
  fn: (client: PgClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

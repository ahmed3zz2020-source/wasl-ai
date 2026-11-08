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
  release(): void;
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
    statement_timeout: options.statementTimeoutMs ?? 15_000,
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

// ============================================================
// WASL AI — FOUNDATION BUILD 01 — unit of work (transaction)
// ------------------------------------------------------------
// ⭐ Every request runs inside ONE transaction that also carries the
//   trusted tenant context:
//     select set_config('app.tenant_id', $1, true)
//   `true` => local to the transaction => it cannot leak to another
//   transaction or to the pooled connection afterwards.
// ⛔ Without the context the RLS predicate is NULL => zero rows
//   (default deny) => the request path cannot read another tenant.
// ⭐ Atomicity: any throw inside `fn` rolls the whole unit back, so
//   a failed composite operation never leaves half an update behind.
// ============================================================

import type { PgClient, PgPool } from './pool.ts';

export class UnitOfWorkError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'UnitOfWorkError';
    this.code = code;
  }
}

const TENANT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,63}$/;

export class UnitOfWork {
  readonly #client: PgClient;
  readonly #tenantId: string;
  #finished = false;

  constructor(client: PgClient, tenantId: string) {
    this.#client = client;
    this.#tenantId = tenantId;
  }

  get client(): PgClient {
    return this.#client;
  }

  get tenantId(): string {
    return this.#tenantId;
  }

  query<Row = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ) {
    return this.#client.query<Row>(text, values);
  }

  /**
   * ⭐ Run a unit of work for one tenant.
   * ⛔ The tenant id is validated here (fail closed) — it is the only
   *   value that may reach the RLS context.
   */
  static async run<T>(
    pool: PgPool,
    tenantId: string,
    fn: (uow: UnitOfWork) => Promise<T>,
  ): Promise<T> {
    if (typeof tenantId !== 'string' || !TENANT_ID_PATTERN.test(tenantId)) {
      throw new UnitOfWorkError('tenant_context_invalid', 'tenant id is not a valid tenant context');
    }
    const client = await pool.connect();
    const uow = new UnitOfWork(client, tenantId);
    try {
      await client.query('BEGIN');
      await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
      await client.query("select set_config('app.actor_id', $1, true)", ['system']);
      const result = await fn(uow);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ⛔ A rollback failure must not mask the original error.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * ⭐ Run a unit of work as the table owner (migrations / seed).
   * ⛔ Used by the setup tooling only — never by the request path.
   *    RLS is FORCED, so the tenant context is still required.
   */
  static async runAsOwner<T>(
    pool: PgPool,
    tenantId: string,
    fn: (uow: UnitOfWork) => Promise<T>,
  ): Promise<T> {
    return UnitOfWork.run(pool, tenantId, fn);
  }
}

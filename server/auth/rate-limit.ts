// ============================================================
// WASL AI — FOUNDATION BUILD 02 — login rate limit
// ------------------------------------------------------------
// ⭐ WHY THE LIMIT LIVES IN THE DATABASE
//   The rate limit is a SHARED state, not a per process state: with
//   two backend instances on the same database an in-memory counter
//   would be counted twice (or reset by a restart). The store is
//   therefore a PostgreSQL table with row level security, so the two
//   instances see the same counter.
// ⭐ WHAT IS COUNTED
//   Only a credential failure (`credentials_invalid`): a malformed
//   request, a disabled account or a revoked membership is an
//   answer, not a guess, and must not lock a tenant out.
// ⛔ The counter is written in its own transaction: the failed login
//   rolls back, so the attempt would be lost if it were written
//   inside it.
// ⛔ A successful login clears the failures of that account.
// ⛔ The limit is a local experiment, not a production policy: it has
//   no lockout, no notification, no second factor and no audit trail
//   of its own beyond the attempt rows.
// ============================================================

import type { PgPool } from '../db/pool.ts';
import { UnitOfWork } from '../db/unit-of-work.ts';

export interface RateLimitConfig {
  /** ⭐ Failures allowed for one account inside the window. */
  readonly maxAccountAttempts: number;
  /** ⭐ Failures allowed for the whole tenant inside the window. */
  readonly maxTenantAttempts: number;
  /** ⭐ The width of the window in seconds. */
  readonly windowSeconds: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = Object.freeze({
  maxAccountAttempts: 5,
  maxTenantAttempts: 20,
  windowSeconds: 300,
});

export interface RateLimitState {
  readonly accountFailures: number;
  readonly tenantFailures: number;
  readonly limited: boolean;
}

/** ⭐ Count the recent failures of one account (the tenant context). */
export async function countRecentFailures(
  pool: PgPool,
  tenantId: string,
  userId: string,
  windowSeconds: number,
): Promise<number> {
  return UnitOfWork.run(pool, tenantId, async (uow) => {
    const result = await uow.query<{ count: string }>(
      `select count(*)::text as count
         from login_attempts
        where tenant_id = $1 and user_id = $2 and succeeded = false
          and attempted_at > now() - make_interval(secs => $3::int)`,
      [tenantId, userId, windowSeconds],
    );
    return Number(result.rows[0]?.count ?? '0');
  });
}

/** ⭐ Count the recent failures of the whole tenant. */
export async function countRecentTenantFailures(
  pool: PgPool,
  tenantId: string,
  windowSeconds: number,
): Promise<number> {
  return UnitOfWork.run(pool, tenantId, async (uow) => {
    const result = await uow.query<{ count: string }>(
      `select count(*)::text as count
         from login_attempts
        where tenant_id = $1 and succeeded = false
          and attempted_at > now() - make_interval(secs => $2::int)`,
      [tenantId, windowSeconds],
    );
    return Number(result.rows[0]?.count ?? '0');
  });
}

/** ⭐ Read the state of the limit (used before a login is attempted). */
export async function readRateLimitState(
  pool: PgPool,
  tenantId: string,
  userId: string,
  config: RateLimitConfig,
): Promise<RateLimitState> {
  const accountFailures = await countRecentFailures(pool, tenantId, userId, config.windowSeconds);
  const tenantFailures = await countRecentTenantFailures(pool, tenantId, config.windowSeconds);
  return {
    accountFailures,
    tenantFailures,
    limited:
      accountFailures >= config.maxAccountAttempts || tenantFailures >= config.maxTenantAttempts,
  };
}

/** ⭐ Record a failed attempt (in its own transaction). */
export async function recordLoginFailure(
  pool: PgPool,
  tenantId: string,
  userId: string,
): Promise<void> {
  await UnitOfWork.run(pool, tenantId, async (uow) => {
    await uow.query(
      `insert into login_attempts (tenant_id, user_id, succeeded) values ($1,$2,false)`,
      [tenantId, userId],
    );
  });
}

/** ⭐ Clear the failures of an account after a successful login. */
export async function clearLoginFailures(
  pool: PgPool,
  tenantId: string,
  userId: string,
): Promise<void> {
  await UnitOfWork.run(pool, tenantId, async (uow) => {
    await uow.query(
      `delete from login_attempts where tenant_id = $1 and user_id = $2 and succeeded = false`,
      [tenantId, userId],
    );
  });
}

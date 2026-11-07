// ============================================================
// WASL AI — FOUNDATION BUILD 02 — PHASE 02 (D-069) — M67
// the login rate limit (three levels)
// ------------------------------------------------------------
// ⭐ WHY THE LIMIT LIVES IN THE DATABASE
//   The rate limit is a SHARED state, not a per process state: with
//   two backend instances on the same database an in-memory counter
//   would be counted twice (or reset by a restart). The store is
//   therefore a PostgreSQL table with row level security, so the two
//   instances see the same counter.
// ⭐ THE THREE LEVELS (M-67)
//   1) the ACCOUNT counter (tenant scoped, in `login_attempts`)
//      ⭐ It stops the GUESSES of one account. It never refuses a
//        correct credential: a deliberate attack on an account must
//        not be able to lock its owner out (M-67.7).
//   2) the TENANT counter (tenant scoped, in `login_attempts`)
//      ⭐ It stops a spread of guesses inside one company.
//   3) the PLATFORM counter (not tenant scoped, in
//      `login_attempts_global`) ⭐ It bounds the key derivations of
//      the whole installation, so an attack that spreads over many
//      accounts and many companies still hits a ceiling.
// ⭐ THE PEER DIMENSION
//   The peer address is the address of the SOCKET. A header sent by
//   the client (X-Forwarded-For and friends) is NEVER read: the
//   client chooses its value, so trusting it would move the limit to
//   the attacker. The peer budget is opt-in, because behind a reverse
//   proxy every request carries the address of the proxy.
// ⛔ WHAT IS COUNTED
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
  /** ⭐ Failures allowed for the whole installation inside the window. */
  readonly maxGlobalAttempts: number;
  /** ⭐ Failures allowed for one peer address (0 = the peer budget is off). */
  readonly maxPeerAttempts: number;
  /** ⭐ The width of the window in seconds. */
  readonly windowSeconds: number;
  /**
   * ⭐ The peer address is only counted when it is TRUSTED.
   * ⛔ It is trusted only when the backend is directly exposed: behind
   *   a reverse proxy the socket address is the address of the proxy.
   */
  readonly trustPeerAddress: boolean;
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = Object.freeze({
  maxAccountAttempts: 5,
  maxTenantAttempts: 20,
  maxGlobalAttempts: 200,
  maxPeerAttempts: 0,
  windowSeconds: 300,
  trustPeerAddress: false,
});

export interface RateLimitState {
  readonly accountFailures: number;
  readonly tenantFailures: number;
  readonly globalFailures: number;
  readonly peerFailures: number;
  /** ⭐ The guesses of this account are refused (a wrong passcode). */
  readonly limited: boolean;
  /**
   * ⭐ The platform budget is exhausted: the request is refused BEFORE
   *   any key derivation, so the installation keeps its CPU.
   */
  readonly platformLimited: boolean;
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

/**
 * ⭐⭐ The platform wide count (M-67).
 * ⭐ The request role may not read the table: it calls the narrow
 *   function that the migration installed.
 */
export async function countRecentGlobalFailures(
  pool: PgPool,
  windowSeconds: number,
): Promise<number> {
  return UnitOfWork.run(pool, 'wasl_platform', async (uow) => {
    const result = await uow.query<{ count: string }>(
      `select wasl_global_login_failures($1)::text as count`,
      [windowSeconds],
    );
    return Number(result.rows[0]?.count ?? '0');
  });
}

/**
 * ⭐⭐ The count of the failures of one peer address (M-67).
 * ⛔ The address comes from the socket, never from a header.
 */
export async function countRecentPeerFailures(
  pool: PgPool,
  peerAddress: string,
  windowSeconds: number,
): Promise<number> {
  return UnitOfWork.run(pool, 'wasl_platform', async (uow) => {
    const result = await uow.query<{ count: string }>(
      `select wasl_peer_login_failures($1, $2)::text as count`,
      [peerAddress, windowSeconds],
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
  peerAddress: string | null = null,
): Promise<RateLimitState> {
  const accountFailures = await countRecentFailures(pool, tenantId, userId, config.windowSeconds);
  const tenantFailures = await countRecentTenantFailures(pool, tenantId, config.windowSeconds);
  const globalFailures = await countRecentGlobalFailures(pool, config.windowSeconds);
  const trustedPeer = config.trustPeerAddress ? peerAddress : null;
  const peerFailures =
    trustedPeer && config.maxPeerAttempts > 0
      ? await countRecentPeerFailures(pool, trustedPeer, config.windowSeconds)
      : 0;
  return {
    accountFailures,
    tenantFailures,
    globalFailures,
    peerFailures,
    // ⭐⭐ D-069 / M67: the guess budget of the account and of the
    //   tenant refuses the GUESSES, not the legitimate user. A correct
    //   credential is never refused because of a throttle, so a
    //   deliberate attack cannot lock another account out.
    limited:
      accountFailures >= config.maxAccountAttempts || tenantFailures >= config.maxTenantAttempts,
    // ⭐ The platform budget is the hard ceiling: it is checked BEFORE
    //   the key derivation, so a flood of guesses cannot eat the CPU
    //   of the installation.
    platformLimited:
      globalFailures >= config.maxGlobalAttempts ||
      (config.maxPeerAttempts > 0 && peerFailures >= config.maxPeerAttempts),
  };
}

/** ⭐ Record a failed attempt (in its own transaction). */
export async function recordLoginFailure(
  pool: PgPool,
  tenantId: string,
  userId: string,
  peerAddress: string | null = null,
): Promise<void> {
  await UnitOfWork.run(pool, tenantId, async (uow) => {
    await uow.query(
      `insert into login_attempts (tenant_id, user_id, succeeded) values ($1,$2,false)`,
      [tenantId, userId],
    );
  });
  // ⭐ The platform counter is written through its narrow function:
  //   the request role has no privilege on the table itself.
  await UnitOfWork.run(pool, 'wasl_platform', async (uow) => {
    await uow.query(
      `select wasl_record_global_login_attempt($1, $2, $3, false)`,
      [tenantId, userId, peerAddress],
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

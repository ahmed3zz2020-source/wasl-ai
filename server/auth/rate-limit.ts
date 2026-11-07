// ============================================================
// WASL AI — FOUNDATION BUILD 03 / PHASE 01 (D-070) — M-73
// the login rate limit and the admission control
// ------------------------------------------------------------
// ⭐ WHY THE LIMIT LIVES IN THE DATABASE
//   The rate limit is a SHARED state, not a per process state: with
//   two backend instances on the same database an in-memory counter
//   would be counted twice (or reset by a restart). The store is
//   therefore a PostgreSQL table with row level security, so the two
//   instances see the same counter.
// ⭐ THE GRADED LEVELS (M-73)
//   1) the ACCOUNT counter (tenant scoped, in `login_attempts`)
//      ⭐ It stops the GUESSES of one account. It never refuses a
//        correct credential: a deliberate attack on an account must
//        not be able to lock its owner out (M-67.7).
//   2) the TENANT counter (tenant scoped, in `login_attempts`)
//      ⭐ It stops a spread of guesses inside one company.
//   3) the PLATFORM counter (not tenant scoped, in
//      `login_attempts_global`) ⭐⭐ It NO LONGER REFUSES: it is the
//      trigger of the DEGRADED MODE. ⭐⭐ D-069 (M-67) refused EVERY
//      login when it was reached, so an attacker who spent the platform
//      budget switched every user of the installation off for the rest
//      of the window, including the users with the correct passcode.
//      M-73 removes that switch: the platform now slows down.
//   4) the ADMISSION BUCKETS (in `login_admission_global` and
//      `login_admission_tenant`) ⭐⭐ They are the REAL ceiling of the
//      CPU: the key derivations per second are bounded by construction,
//      on the installation AND on every company ⇒ one company cannot
//      spend the budget of the others.
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
// ⭐⭐ THE HONEST LIMIT (M-73)
//   The protection DEGRADES, it never PROMISES: under a flood that
//   never stops, every login of the installation waits, and the wait
//   grows with the flood. The refusal survives only as the last
//   resort: a wait longer than the ceiling.
// ============================================================

import type { PgPool } from '../db/pool.ts';
import { UnitOfWork } from '../db/unit-of-work.ts';

export interface RateLimitConfig {
  /** ⭐ Failures allowed for one account inside the window. */
  readonly maxAccountAttempts: number;
  /** ⭐ Failures allowed for the whole tenant inside the window. */
  readonly maxTenantAttempts: number;
  /**
   * ⭐⭐ D-070 / M-73: the failures of the whole installation inside
   *   the window. ⭐ It is the TRIGGER of the degraded mode, NOT a
   *   refusal: when it is reached the platform slows down, it does not
   *   switch the users off.
   */
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
  /**
   * ⭐⭐ D-070 / M-73: the number of key derivations of the WHOLE
   *   installation that may start every second. ⭐ This is the real
   *   ceiling of the CPU: it is enforced by the admission bucket and
   *   not by a refusal.
   */
  readonly globalRatePerSecond: number;
  /** ⭐ The number of derivations that may start at once (the burst). */
  readonly globalBurst: number;
  /**
   * ⭐⭐ D-070 / M-73: the same ceiling for ONE company. ⭐ It is what
   *   stops one company from spending the budget of the others.
   */
  readonly tenantRatePerSecond: number;
  /** ⭐ The burst of one company. */
  readonly tenantBurst: number;
  /**
   * ⭐⭐ D-070 / M-73: the extra wait of every attempt while the
   *   platform is in the degraded mode. ⭐ It slows the flood down
   *   without refusing anybody.
   */
  readonly degradedWaitMs: number;
  /**
   * ⭐⭐ D-070 / M-73: the longest wait a login may endure. ⭐ Beyond
   *   it the request is refused: this is the last resort, and it is
   *   the only refusal that the platform level can cause.
   */
  readonly maxWaitMs: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = Object.freeze({
  maxAccountAttempts: 5,
  maxTenantAttempts: 20,
  maxGlobalAttempts: 200,
  maxPeerAttempts: 0,
  windowSeconds: 300,
  trustPeerAddress: false,
  globalRatePerSecond: 20,
  globalBurst: 40,
  tenantRatePerSecond: 10,
  tenantBurst: 20,
  degradedWaitMs: 1000,
  maxWaitMs: 30_000,
});

export interface RateLimitState {
  readonly accountFailures: number;
  readonly tenantFailures: number;
  readonly globalFailures: number;
  readonly peerFailures: number;
  /** ⭐ The guesses of this account are refused (a wrong passcode). */
  readonly limited: boolean;
  /**
   * ⭐⭐ D-070 / M-73: the guesses of this peer address are refused.
   * ⭐ The address is the one of the socket, never a header.
   */
  readonly peerLimited: boolean;
  /**
   * ⭐⭐ D-070 / M-73: the platform is under pressure. ⭐ The mode is
   *   DEGRADED, not REFUSED: the attempts wait longer, they are not
   *   switched off.
   */
  readonly degraded: boolean;
}

/**
 * ⭐⭐ D-070 / M-73: the decision of the admission control.
 * ⭐ `refused` is true ONLY when the wait is longer than the ceiling:
 *   that is the last resort of a platform that is completely flooded.
 */
export interface AdmissionDecision {
  /** ⭐ The number of milliseconds the attempt must wait. */
  readonly waitMs: number;
  /** ⭐ The platform is in the degraded mode. */
  readonly degraded: boolean;
  /** ⭐ The wait is beyond the ceiling: the request is refused. */
  readonly refused: boolean;
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
    // ⭐ The peer budget refuses the GUESSES of one address (the one
    //   of the socket, never a header).
    peerLimited:
      config.maxPeerAttempts > 0 && peerFailures >= config.maxPeerAttempts,
    // ⭐⭐ D-070 / M-73: the platform budget is NO LONGER a refusal.
    //   It is the TRIGGER of the degraded mode: the attempts wait
    //   longer, they are not switched off.
    degraded: globalFailures >= config.maxGlobalAttempts,
  };
}

/**
 * ⭐⭐ D-070 / M-73: the ADMISSION CONTROL of one login attempt.
 * ⭐ The attempt takes one slot from the global bucket AND from the
 *   bucket of its company: the number of key derivations per second is
 *   therefore bounded by construction, on the installation and on every
 *   company.
 * ⭐ The function returns the number of milliseconds the attempt must
 *   wait before the key is derived.
 * ⛔ It never refuses because of the platform: the refusal happens only
 *   when the wait is longer than the ceiling (the last resort).
 */
export async function admitLoginAttempt(
  pool: PgPool,
  tenantId: string,
  config: RateLimitConfig,
  degraded: boolean,
): Promise<AdmissionDecision> {
  const extraWaitMs = degraded ? config.degradedWaitMs : 0;
  const result = await UnitOfWork.run(pool, 'wasl_platform', async (uow) => {
    const rows = await uow.query<{ wait_ms: string }>(
      `select wasl_login_admission_take($1, $2, $3, $4, $5, $6)::text as wait_ms`,
      [
        config.globalRatePerSecond,
        config.globalBurst,
        config.tenantRatePerSecond,
        config.tenantBurst,
        tenantId,
        extraWaitMs,
      ],
    );
    return Number(rows.rows[0]?.wait_ms ?? '0');
  });
  const waitMs = Number.isFinite(result) && result > 0 ? result : 0;
  return {
    waitMs,
    degraded,
    refused: waitMs > config.maxWaitMs,
  };
}

/** ⭐ The state of the admission buckets (the drill reads it). */
export async function readAdmissionState(
  pool: PgPool,
  tenantId: string,
): Promise<{ globalTokens: number; tenantTokens: number }> {
  return UnitOfWork.run(pool, 'wasl_platform', async (uow) => {
    const result = await uow.query<{ global_tokens: string; tenant_tokens: string }>(
      `select global_tokens::text, tenant_tokens::text from wasl_login_admission_state($1)`,
      [tenantId],
    );
    const row = result.rows[0];
    return {
      globalTokens: Number(row?.global_tokens ?? '0'),
      tenantTokens: Number(row?.tenant_tokens ?? '0'),
    };
  });
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

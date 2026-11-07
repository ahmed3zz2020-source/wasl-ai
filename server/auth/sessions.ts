// ============================================================
// WASL AI — FOUNDATION BUILD 01 — local test sessions
// ------------------------------------------------------------
// ⭐ Scope: a LOCAL test login for the synthetic database. It is not
//   a production authentication system and it is not described as one.
// ⭐ The token carries the tenant id so the request can set the
//   trusted database context, but the tenant id alone proves nothing:
//   the session row (token hash + tenant + expiry + revocation) is the
//   proof, and the row level security policy hides every other tenant.
// ⛔ The raw token is returned once and never stored: only its hash
//   is written to the database.
// ⛔ No password is stored: the seed stores a salted hash only.
// ============================================================

import crypto from 'node:crypto';
import type { PgPool } from '../db/pool.ts';
import { UnitOfWork } from '../db/unit-of-work.ts';

const TENANT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,63}$/;
/** ⭐ The membership statuses the server understands. */
export const KNOWN_MEMBERSHIP_STATUSES: readonly string[] = Object.freeze([
  'active',
  'revoked',
  'disabled',
]);
const TOKEN_PREFIX = 'wsl';

export class SessionError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = 'SessionError';
    this.code = code;
    this.status = status;
  }
}

export interface LoginInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly passcode: string;
}

export interface SessionRecord {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly membershipId: string;
  readonly role: string;
  readonly actorId: string;
  readonly expiresAt: string;
}

export interface LoginResult {
  readonly token: string;
  readonly session: SessionRecord;
}

/**
 * ⭐ EXPERIMENTAL HASH - NOT FIT FOR PRODUCTION.
 * ⛔ SHA-256 with a per user salt is a fast hash: it is only acceptable
 *   for the synthetic local passcodes of this experimental build.
 * ⛔ A production system needs a slow, memory hard key derivation
 *   (argon2id / scrypt / bcrypt) with a tuned work factor, a per
 *   tenant and per account rate limit, a lockout policy and a second
 *   factor. No production authentication exists in this build.
 */
export function hashPasscode(passcode: string, salt?: string): string {
  const useSalt = salt ?? crypto.randomBytes(16).toString('hex');
  const digest = crypto.createHash('sha256').update(`${useSalt}:${passcode}`).digest('hex');
  return `${useSalt}:${digest}`;
}

export function verifyPasscode(stored: string, passcode: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 2) return false;
  const [salt, digest] = parts as [string, string];
  const candidate = hashPasscode(passcode, salt);
  const a = Buffer.from(candidate);
  const b = Buffer.from(stored);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function hashToken(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

export function buildToken(tenantId: string, sessionId: string, secret: string): string {
  return `${TOKEN_PREFIX}.${tenantId}.${sessionId}.${secret}`;
}

export function parseToken(token: string): { tenantId: string; sessionId: string; secret: string } | null {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [prefix, tenantId, sessionId, secret] = parts as [string, string, string, string];
  if (prefix !== TOKEN_PREFIX) return null;
  if (!TENANT_ID_PATTERN.test(tenantId)) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/.test(sessionId)) return null;
  if (secret.length < 16) return null;
  return { tenantId, sessionId, secret };
}

/** ⭐ Create a session for a synthetic user of a tenant. */
export async function login(
  pool: PgPool,
  input: LoginInput,
  ttlSeconds: number,
  now: () => Date = () => new Date(),
): Promise<LoginResult> {
  if (!TENANT_ID_PATTERN.test(input.tenantId)) {
    throw new SessionError('tenant_invalid', 400, 'tenant id is not valid');
  }
  if (typeof input.passcode !== 'string' || input.passcode.length < 4) {
    throw new SessionError('passcode_invalid', 400, 'passcode is not valid');
  }
  const issuedAt = now();
  const expiresAt = new Date(issuedAt.getTime() + ttlSeconds * 1000);

  return UnitOfWork.run(pool, input.tenantId, async (uow) => {
    const result = await uow.query<{
      user_id: string;
      display_name: string;
      passcode_hash: string;
      status: string;
      membership_id: string;
      role: string;
      membership_status: string;
    }>(
      `select u.id as user_id, u.display_name, u.passcode_hash, u.status,
              m.id as membership_id, m.role, m.status as membership_status
         from users u
         join memberships m on m.user_id = u.id
        where u.id = $1 and m.tenant_id = $2`,
      [input.userId, input.tenantId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new SessionError('credentials_invalid', 401, 'unknown user for this tenant');
    }
    if (!verifyPasscode(row.passcode_hash, input.passcode)) {
      throw new SessionError('credentials_invalid', 401, 'passcode does not match');
    }
    if (row.status !== 'active') {
      throw new SessionError('user_disabled', 403, 'user is disabled');
    }
    if (!KNOWN_MEMBERSHIP_STATUSES.includes(row.membership_status)) {
      // M63: the declared rejection code of the identity contract is
      // reachable here: an unknown membership status is not a revoked
      // membership, it is an invalid identity status.
      throw new SessionError('identity_status_invalid', 403, 'membership status is not a declared one');
    }
    if (row.membership_status !== 'active') {
      throw new SessionError('membership_revoked', 403, 'membership is not active');
    }

    const sessionId = `sess_${crypto.randomBytes(9).toString('hex')}`;
    const secret = crypto.randomBytes(24).toString('base64url');
    await uow.query(
      `insert into sessions
         (id, tenant_id, user_id, membership_id, role, token_hash, issued_at, expires_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        sessionId,
        input.tenantId,
        row.user_id,
        row.membership_id,
        row.role,
        hashToken(secret),
        issuedAt.toISOString(),
        expiresAt.toISOString(),
      ],
    );
    return {
      token: buildToken(input.tenantId, sessionId, secret),
      session: {
        sessionId,
        tenantId: input.tenantId,
        userId: row.user_id,
        membershipId: row.membership_id,
        role: row.role,
        actorId: row.user_id,
        expiresAt: expiresAt.toISOString(),
      },
    };
  });
}

/** ⭐ Resolve a bearer token into a trusted session record. */
export async function resolveSession(
  pool: PgPool,
  token: string,
  now: () => Date = () => new Date(),
): Promise<SessionRecord> {
  const parsed = parseToken(token);
  if (!parsed) {
    throw new SessionError('token_invalid', 401, 'token is not valid');
  }
  const current = now();
  return UnitOfWork.run(pool, parsed.tenantId, async (uow) => {
    const result = await uow.query<{
      id: string;
      tenant_id: string;
      user_id: string;
      membership_id: string;
      role: string;
      expires_at: string;
      revoked_at: string | null;
      user_status: string;
      membership_status: string;
    }>(
      `select s.id, s.tenant_id, s.user_id, s.membership_id, s.role, s.expires_at, s.revoked_at,
              u.status as user_status, m.status as membership_status
         from sessions s
         join users u on u.id = s.user_id
         join memberships m on m.id = s.membership_id
        where s.id = $1 and s.token_hash = $2`,
      [parsed.sessionId, hashToken(parsed.secret)],
    );
    const row = result.rows[0];
    if (!row) {
      throw new SessionError('session_unknown', 401, 'session is not known');
    }
    if (row.revoked_at) {
      throw new SessionError('session_revoked', 401, 'session was revoked');
    }
    if (new Date(row.expires_at).getTime() <= current.getTime()) {
      throw new SessionError('session_expired', 401, 'session expired');
    }
    if (row.user_status !== 'active') {
      throw new SessionError('user_disabled', 403, 'user is disabled');
    }
    if (!KNOWN_MEMBERSHIP_STATUSES.includes(row.membership_status)) {
      // M63: the declared rejection code of the identity contract is
      // reachable here: an unknown membership status is not a revoked
      // membership, it is an invalid identity status.
      throw new SessionError('identity_status_invalid', 403, 'membership status is not a declared one');
    }
    if (row.membership_status !== 'active') {
      throw new SessionError('membership_revoked', 403, 'membership is not active');
    }
    return {
      sessionId: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      membershipId: row.membership_id,
      role: row.role,
      actorId: row.user_id,
      expiresAt: row.expires_at,
    };
  });
}

/** ⭐ Revoke a session (logout / owner action). */
export async function revokeSession(
  pool: PgPool,
  tenantId: string,
  sessionId: string,
  reason = 'logout',
): Promise<boolean> {
  return UnitOfWork.run(pool, tenantId, async (uow) => {
    const result = await uow.query(
      `update sessions set revoked_at = now(), revoked_reason = $3
        where id = $1 and tenant_id = $2 and revoked_at is null`,
      [sessionId, tenantId, reason],
    );
    return result.rowCount > 0;
  });
}

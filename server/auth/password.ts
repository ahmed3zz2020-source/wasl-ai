// ============================================================
// WASL AI — FOUNDATION BUILD 02 — password key derivation
// ------------------------------------------------------------
// ⭐ A dedicated key derivation function (scrypt) replaces the
//   experimental SHA-256 of the local test path.
// ⭐ The stored value is versioned and self describing:
//   `scrypt$N$r$p$<salt>$<key>` (base64 parts).
// ⛔ The parameters are NOT read back from the stored value: only the
//   exact configured cost is accepted, so a tampered row cannot ask
//   the server for an expensive computation.
// ⛔ A legacy value (the old `salt:digest` SHA-256 form) is refused:
//   the verification fails closed and the synthetic seed must be
//   rebuilt (`npm run db:setup`).
// ⛔ This is still an EXPERIMENTAL local identity system: it is not a
//   production authentication (no second factor, no identity
//   provider, no production policy). It only removes the fast hash
//   that made the local passcodes cheap to attack.
// ⛔ scrypt is CPU bound and runs synchronously: at the configured
//   cost it takes ~50 ms per derivation on the local machine. That
//   is acceptable for the local test identity and is the reason the
//   cost is a configuration constant, not a per request parameter.
// ============================================================

import crypto from 'node:crypto';

export const PASSWORD_ALGORITHM = 'scrypt';

/** ⭐ The cost parameters. They are fixed and never read from the row. */
export const SCRYPT_COST = 16384; // N
export const SCRYPT_BLOCK_SIZE = 8; // r
export const SCRYPT_PARALLELISM = 1; // p
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
/** ⭐ scrypt needs ~128 * N * r bytes: 64 MB is a safe ceiling. */
const MAX_MEMORY = 64 * 1024 * 1024;

export interface PasswordHashParameters {
  readonly N: number;
  readonly r: number;
  readonly p: number;
  readonly maxmem: number;
}

export const PASSWORD_HASH_PARAMETERS: PasswordHashParameters = Object.freeze({
  N: SCRYPT_COST,
  r: SCRYPT_BLOCK_SIZE,
  p: SCRYPT_PARALLELISM,
  maxmem: MAX_MEMORY,
});

/** ⭐ Derive a new salted hash (the salt is random for every call). */
export function hashPasscode(passcode: string): string {
  if (typeof passcode !== 'string' || passcode.length === 0) {
    throw new Error('passcode_invalid');
  }
  const salt = crypto.randomBytes(SALT_LENGTH);
  const derived = crypto.scryptSync(passcode, salt, KEY_LENGTH, PASSWORD_HASH_PARAMETERS);
  return [
    PASSWORD_ALGORITHM,
    String(SCRYPT_COST),
    String(SCRYPT_BLOCK_SIZE),
    String(SCRYPT_PARALLELISM),
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

/** ⭐ Verify a passcode against a stored hash (constant time). */
export function verifyPasscode(stored: string, passcode: string): boolean {
  if (typeof stored !== 'string' || typeof passcode !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6) return false;
  const [algorithm, n, r, p, saltPart, keyPart] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  if (algorithm !== PASSWORD_ALGORITHM) return false;
  // ⛔ Only the configured cost is accepted (no parameter injection).
  if (n !== String(SCRYPT_COST)) return false;
  if (r !== String(SCRYPT_BLOCK_SIZE)) return false;
  if (p !== String(SCRYPT_PARALLELISM)) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltPart, 'base64');
    expected = Buffer.from(keyPart, 'base64');
  } catch {
    return false;
  }
  if (salt.length !== SALT_LENGTH) return false;
  if (expected.length !== KEY_LENGTH) return false;
  let derived: Buffer;
  try {
    derived = crypto.scryptSync(passcode, salt, KEY_LENGTH, PASSWORD_HASH_PARAMETERS);
  } catch {
    return false;
  }
  return crypto.timingSafeEqual(derived, expected);
}

/** ⭐ True when the stored value uses the current algorithm and cost. */
export function isCurrentPasswordHash(stored: string): boolean {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6) return false;
  return (
    parts[0] === PASSWORD_ALGORITHM &&
    parts[1] === String(SCRYPT_COST) &&
    parts[2] === String(SCRYPT_BLOCK_SIZE) &&
    parts[3] === String(SCRYPT_PARALLELISM)
  );
}

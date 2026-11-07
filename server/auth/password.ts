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

// ============================================================
// FOUNDATION BUILD 02 / PHASE 02 (D-069) — M67
// ⭐⭐⭐ The asynchronous key derivation
// ------------------------------------------------------------
// ⭐ WHY
//   `scryptSync` blocks the event loop for the whole derivation (~50 ms
//   at the configured cost). A burst of login attempts therefore
//   stopped the WHOLE server: the health check, the ready probe and
//   every other request waited behind the derivations of the
//   attacker. The key derivation is the most expensive thing the
//   process does, so it must not run on the event loop.
// ⭐ HOW
//   `crypto.scrypt` (the asynchronous form) runs the derivation on the
//   libuv thread pool: the event loop keeps serving the other
//   requests while the key is derived.
// ⛔ The parameters and the stored format are EXACTLY the same as the
//   synchronous ones: a hash written by one function is verified by
//   the other, so the existing synthetic passcodes keep working and
//   the security level does not change.
// ⛔ The derivation is still CPU bound: the thread pool is the
//   bottleneck, not the event loop. That is why the platform wide
//   login budget exists (server/auth/rate-limit.ts).
// ============================================================

/** ⭐ Derive the key without blocking the event loop. */
function scryptAsync(
  passcode: string,
  salt: Buffer,
  keyLength: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(passcode, salt, keyLength, PASSWORD_HASH_PARAMETERS, (error, derived) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derived);
    });
  });
}

/** ⭐⭐ Derive a new salted hash (the salt is random for every call). */
export async function hashPasscodeAsync(passcode: string): Promise<string> {
  if (typeof passcode !== 'string' || passcode.length === 0) {
    throw new Error('passcode_invalid');
  }
  const salt = crypto.randomBytes(SALT_LENGTH);
  const derived = await scryptAsync(passcode, salt, KEY_LENGTH);
  return [
    PASSWORD_ALGORITHM,
    String(SCRYPT_COST),
    String(SCRYPT_BLOCK_SIZE),
    String(SCRYPT_PARALLELISM),
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

/** ⭐⭐ Verify a passcode without blocking the event loop (constant time). */
export async function verifyPasscodeAsync(stored: string, passcode: string): Promise<boolean> {
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
    derived = await scryptAsync(passcode, salt, KEY_LENGTH);
  } catch {
    return false;
  }
  return crypto.timingSafeEqual(derived, expected);
}

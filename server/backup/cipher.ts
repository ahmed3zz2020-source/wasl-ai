// ============================================================
// WASL AI — FOUNDATION BUILD 02 — PHASE 02 (D-069) — M-69
// the backup cipher and the manifest
// ------------------------------------------------------------
// ⭐ WHY THE BACKUP IS ENCRYPTED
//   A dump holds the whole database: the messages, the conversations,
//   the customers and the password hashes. A dump that lies on the
//   disk in clear text is a copy of the production data outside of the
//   database, with the protection of the file system only.
//   ⭐ The artifact is therefore encrypted with AES-256-GCM and the
//     clear text file is deleted right after: only the encrypted
//     artifact stays.
// ⭐ THE MANIFEST
//   Every backup writes a manifest next to it: the hash of the clear
//   text dump, the hash of the encrypted file, the size, the schema
//   version and the fingerprint of the key. The manifest is what makes
//   a corrupted or a replaced artifact DETECTABLE.
// ⛔ THE KEY
//   The key never enters the repository and never enters a manifest:
//   only its fingerprint (the first 16 hex characters of its SHA-256)
//   is written down, so the operator can tell which key a backup was
//   taken with. \u26d4 The local key file is a SYNTHETIC local secret
//   (0600); a production key belongs to a secret manager, which is an
//   owner decision and is NOT implemented here.
// ⛔ NOTHING LEAVES THE MACHINE: there is no upload, no copy to a
//   cloud service and no network call in this module.
// ============================================================

import crypto from 'node:crypto';

export const BACKUP_CIPHER = 'aes-256-gcm';
export const BACKUP_MAGIC = 'WLSLBK01';
export const BACKUP_MANIFEST_VERSION = 1;

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export interface BackupManifest {
  readonly manifest_version: number;
  readonly created_at: string;
  readonly database: string;
  readonly schema_version: string | null;
  /** ⭐ The SHA-256 of the CLEAR TEXT dump. */
  readonly plain_sha256: string;
  /** ⭐ The SHA-256 of the ENCRYPTED artifact. */
  readonly artifact_sha256: string;
  readonly plain_bytes: number;
  readonly artifact_bytes: number;
  readonly cipher: string;
  /** ⭐ The fingerprint of the key (never the key). */
  readonly key_fingerprint: string;
  /** ⭐ The measured duration of the dump, in milliseconds. */
  readonly dump_duration_ms: number;
}

/** ⭐ The SHA-256 of a buffer (hex). */
export function sha256(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/** ⭐ The fingerprint of a key: the first 16 characters of its hash. */
export function keyFingerprint(key: Buffer): string {
  return sha256(key).slice(0, 16);
}

/** ⭐ Derive the encryption key from a passphrase (the local one). */
export function deriveKey(passphrase: string): Buffer {
  return crypto.scryptSync(passphrase, 'wasl-local-backup-v1', 32, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
}

/**
 * ⭐ Encrypt an artifact (AES-256-GCM).
 * ⭐ The format is: magic (8) + iv (12) + tag (16) + ciphertext.
 */
export function encryptArtifact(plain: Buffer, key: Buffer): Buffer {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(BACKUP_CIPHER, key, iv, { authTagLength: TAG_LENGTH });
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from(BACKUP_MAGIC, 'ascii'), iv, tag, ciphertext]);
}

/**
 * ⭐ Decrypt an artifact and verify its authentication tag.
 * ⛔ A wrong key or a modified file raises: the GCM tag is checked
 *   before the content is used.
 */
export function decryptArtifact(artifact: Buffer, key: Buffer): Buffer {
  const header = BACKUP_MAGIC.length;
  if (artifact.length < header + IV_LENGTH + TAG_LENGTH) {
    throw new Error('backup_artifact_truncated');
  }
  if (artifact.subarray(0, header).toString('ascii') !== BACKUP_MAGIC) {
    throw new Error('backup_artifact_not_encrypted');
  }
  const iv = artifact.subarray(header, header + IV_LENGTH);
  const tag = artifact.subarray(header + IV_LENGTH, header + IV_LENGTH + TAG_LENGTH);
  const ciphertext = artifact.subarray(header + IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(BACKUP_CIPHER, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    // ⛔ The tag does not match: the artifact was modified or the key
    //   is not the one of the backup.
    throw new Error('backup_artifact_tampered');
  }
}

/** ⭐ Build the manifest of a backup. */
export function buildManifest(input: {
  readonly database: string;
  readonly schemaVersion: string | null;
  readonly plain: Buffer;
  readonly artifact: Buffer;
  readonly key: Buffer;
  readonly dumpDurationMs: number;
}): BackupManifest {
  return {
    manifest_version: BACKUP_MANIFEST_VERSION,
    created_at: new Date().toISOString(),
    database: input.database,
    schema_version: input.schemaVersion,
    plain_sha256: sha256(input.plain),
    artifact_sha256: sha256(input.artifact),
    plain_bytes: input.plain.length,
    artifact_bytes: input.artifact.length,
    cipher: BACKUP_CIPHER,
    key_fingerprint: keyFingerprint(input.key),
    dump_duration_ms: input.dumpDurationMs,
  };
}

/** ⭐ The name of the manifest of an artifact. */
export function manifestPathOf(artifactPath: string): string {
  return `${artifactPath}.manifest.json`;
}

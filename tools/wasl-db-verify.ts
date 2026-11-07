// ============================================================
// WASL AI — FOUNDATION BUILD 02 — PHASE 02 (D-069) — M-69
// the backup verification tool
// ------------------------------------------------------------
// ⭐ Verify a backup artifact without restoring it:
//   npm run db:verify -- <artifact file>
// ⭐ The tool answers three questions:
//     1) is the artifact intact (the hash of the encrypted file)?
//   2) is the clear text inside intact (the GCM tag and the hash)?
//   3) is the file private enough (the mode of the file)?
// ⛔ It never writes to the database and it never leaves the machine.
// ⛔ A backup that is not verified is not a backup: the drill of the
//   restore calls the same checks.
// ============================================================

import fs from 'node:fs';

import {
  assertBackupPermissions,
  readBackupKey,
  verifyBackup,
} from './wasl-db-backup.ts';

export interface VerifyReport {
  readonly artifact: string;
  readonly manifest: string;
  readonly verified: boolean;
  readonly plainBytes: number;
  readonly keyFingerprint: string | null;
  readonly schemaVersion: string | null;
  readonly createdAt: string | null;
  readonly mode: string;
}

export function runVerify(artifactFile: string): VerifyReport {
  const manifestFile = `${artifactFile}.manifest.json`;
  const { key } = readBackupKey();
  const verified = verifyBackup(artifactFile, manifestFile, key);
  assertBackupPermissions(artifactFile);
  return {
    artifact: artifactFile,
    manifest: manifestFile,
    verified: true,
    plainBytes: verified.plainBytes,
    keyFingerprint: verified.manifest.key_fingerprint,
    schemaVersion: verified.manifest.schema_version,
    createdAt: verified.manifest.created_at,
    mode: (fs.statSync(artifactFile).mode & 0o777).toString(8),
  };
}

if (import.meta.filename === process.argv[1]) {
  const artifact = process.argv[2];
  if (!artifact) {
    process.stderr.write('usage: npm run db:verify -- <artifact file>\n');
    process.exitCode = 1;
  } else {
    try {
      process.stdout.write(`${JSON.stringify(runVerify(artifact), null, 2)}\n`);
    } catch (error) {
      process.stderr.write(`verify failed: ${(error as Error).message}\n`);
      process.exitCode = 1;
    }
  }
}

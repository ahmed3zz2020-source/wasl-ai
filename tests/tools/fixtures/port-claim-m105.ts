// ============================================================
// WASL AI - D-077 / M-109 - the FROZEN protocol of M-105 (the published one)
// ------------------------------------------------------------
// WHAT THIS FILE IS: a VERBATIM copy of the claim protocol that the
//   reply #53 published (commit 8f81dd6, tests/server/harness.ts)
//   with ONE addition: a pause point (`afterMove`) between the MOVE of
//   the identity and the GIVE-BACK of it.
//   The protocol statements are NOT changed: the pause only stops the
//   process at a chosen line, so the race becomes DETERMINISTIC.
// WHY A FROZEN COPY: the proof must run against the PUBLISHED protocol
//   BEFORE any change => so the published protocol is kept here as the
//   historical proof (the same pattern as tests/tools/fixtures/
//   port-claim-old.ts for M-105).
// THE DEFECT IT PROVES (M-109): the reclaim MOVES the identity of the
//   claim out BEFORE it checks that the identity is the stale one it
//   judged => so a reclaimer with an OLD reading can move the FRESH
//   identity of another process away => and a third process can then
//   take the free name => TWO processes believe they own the claim.
// IT NEVER TOUCHES A DATABASE: only the file system of the machine.
// ============================================================

import fs from 'node:fs';
import path from 'node:path';

export interface PortOwner {
  readonly token: string;
  readonly pid: number;
  readonly start: string;
}

export interface PortSeam {
  afterDecision?: () => void;
  /** M-109: the pause between the move and the give-back. */
  afterMove?: () => void;
}

const CLAIM_OWNER_FILE = 'owner';

function claimOwnerPath(claim: string): string {
  return path.join(claim, CLAIM_OWNER_FILE);
}

function processStartTime(pid: number): string {
  try {
    const raw = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const tail = raw.slice(raw.lastIndexOf(')') + 2).trim().split(/\s+/);
    return tail[19] ?? '';
  } catch {
    return '';
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function ownerAlive(owner: PortOwner): boolean {
  if (!processAlive(owner.pid)) return false;
  if (owner.start === '') return true;
  const now = processStartTime(owner.pid);
  if (now === '') return false;
  return now === owner.start;
}

function readOwner(file: string): PortOwner | null {
  try {
    const raw = fs.readFileSync(file, 'utf8').trim();
    const [token, pid, start] = raw.split('|');
    const pidNumber = Number(pid);
    if (!token || !Number.isFinite(pidNumber) || pidNumber <= 0) return null;
    return { token, pid: pidNumber, start: start ?? '' };
  } catch {
    return null;
  }
}

function unlinkQuietly(file: string): void {
  try {
    fs.unlinkSync(file);
  } catch {
    // it is gone anyway.
  }
}

export function writeStaleClaimOld(claim: string, ownerFile: string): void {
  fs.rmSync(claim, { force: true, recursive: true });
  fs.mkdirSync(claim, { recursive: true });
  fs.linkSync(ownerFile, claimOwnerPath(claim));
}

export function readClaimOwnerOld(claim: string): PortOwner | null {
  return readOwner(claimOwnerPath(claim));
}

export function replaceClaimOwnerOld(claim: string, ownerFile: string): void {
  fs.rmSync(claimOwnerPath(claim), { force: true });
  fs.linkSync(ownerFile, claimOwnerPath(claim));
}

/** ⭐⭐⭐ THE PUBLISHED PROTOCOL OF M-105 (verbatim + one pause point). */
export function takeMarkerOld(
  marker: string,
  owner: PortOwner,
  ownerFile: string,
  seam?: PortSeam,
): boolean {
  const ownerPath = claimOwnerPath(marker);
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  for (let attempt = 0; attempt < 64; attempt += 1) {
    let created = false;
    try {
      fs.mkdirSync(marker);
      created = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') return false;
    }
    if (created) {
      try {
        fs.linkSync(ownerFile, ownerPath);
        return true;
      } catch {
        try {
          fs.rmdirSync(marker);
        } catch {
          // it is not empty: somebody owns it.
        }
        return false;
      }
    }
    let hasIdentity = true;
    try {
      fs.statSync(ownerPath);
    } catch {
      hasIdentity = false;
    }
    if (!hasIdentity) {
      try {
        fs.linkSync(ownerFile, ownerPath);
        return true;
      } catch {
        continue;
      }
    }
    const existing = readOwner(ownerPath);
    if (existing && ownerAlive(existing)) {
      return false;
    }
    seam?.afterDecision?.();
    const moved = `${ownerPath}.take.${owner.token}.${attempt}`;
    try {
      fs.renameSync(ownerPath, moved);
    } catch {
      continue;
    }
    // ⭐ M-109: the pause between the MOVE and the GIVE-BACK.
    seam?.afterMove?.();
    const quarantined = readOwner(moved);
    const sameIdentity =
      existing !== null &&
      quarantined !== null &&
      quarantined.token === existing.token &&
      quarantined.pid === existing.pid &&
      quarantined.start === existing.start;
    const broken = existing === null && quarantined === null;
    if (!sameIdentity && !broken) {
      try {
        fs.linkSync(moved, ownerPath);
        fs.unlinkSync(moved);
      } catch {
        // keep the private copy.
      }
      continue;
    }
    try {
      fs.linkSync(ownerFile, ownerPath);
    } catch {
      unlinkQuietly(moved);
      return false;
    }
    unlinkQuietly(moved);
    return true;
  }
  return false;
}

export function releaseMarkerOld(
  claim: string,
  owner: PortOwner,
  ownerFile: string,
  seam?: PortSeam,
): void {
  const ownerPath = claimOwnerPath(claim);
  const moved = `${ownerPath}.release.${owner.token}.${Date.now()}`;
  try {
    fs.renameSync(ownerPath, moved);
  } catch {
    unlinkQuietly(ownerFile);
    return;
  }
  // ⭐ M-109: the pause between the MOVE and the GIVE-BACK.
  seam?.afterMove?.();
  const held = readOwner(moved);
  if (held && held.token !== owner.token) {
    try {
      fs.linkSync(moved, ownerPath);
      fs.unlinkSync(moved);
    } catch {
      // keep the private copy.
    }
    unlinkQuietly(ownerFile);
    return;
  }
  seam?.afterDecision?.();
  unlinkQuietly(moved);
  try {
    fs.rmdirSync(claim);
  } catch {
    // not empty: somebody owns the claim now.
  }
  unlinkQuietly(ownerFile);
}

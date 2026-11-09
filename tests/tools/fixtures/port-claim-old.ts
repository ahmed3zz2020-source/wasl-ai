// ============================================================
// WASL AI - D-076 / M-105 - the OLD protocol of the claim (frozen)
// ------------------------------------------------------------
// THIS FILE IS A FIXTURE: it is the protocol of the claim as it was
// BEFORE M-105, kept VERBATIM so the defect can be reproduced on every
// run of the test suite (not only once, in the past).
//
// THE DEFECT (the one the review of the reply #52 found):
//   ① the claim was a FILE, so the reclaim had to UNLINK it by name
//      before the new owner could link its own identity onto that name;
//      between the unlink and the link the name was FREE, so a second
//      process could take the same block (a double reservation);
//   ② the release read the identity and then unlinked the claim BY
//      NAME, so a claim that another process took in between was
//      deleted.
//
// THE FIX (the protocol of tests/server/harness.ts): the claim is a
// DIRECTORY, the identity is a file inside it, the ownership is one
// atomic link() onto the fixed name `owner`, and every destructive act
// targets a PRIVATE name (never the canonical one).
//
// THE TEST RUNS BOTH: the old one must produce a double reservation
// and the new one must not. So the guard is proved to be able to fail.
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

/** the OLD claim: a FILE (a hard link to the identity of the owner) */
export function writeStaleClaimOld(claim: string, ownerFile: string): void {
  fs.rmSync(claim, { force: true, recursive: true });
  fs.linkSync(ownerFile, claim);
}

export function readClaimOwnerOld(claim: string): PortOwner | null {
  return readOwner(claim);
}

export function replaceClaimOwnerOld(claim: string, ownerFile: string): void {
  fs.rmSync(claim, { force: true });
  fs.linkSync(ownerFile, claim);
}

/** the OLD take: the reclaim unlinks the claim BY NAME */
export function takeMarkerOld(
  marker: string,
  owner: PortOwner,
  ownerFile: string,
  seam?: PortSeam,
): boolean {
  for (let attempt = 0; attempt < 64; attempt += 1) {
    let exists = true;
    try {
      fs.statSync(marker);
    } catch {
      exists = false;
    }
    if (!exists) {
      try {
        fs.linkSync(ownerFile, marker);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          continue;
        }
        return false;
      }
    }
    const existing = readOwner(marker);
    if (existing && ownerAlive(existing)) {
      return false;
    }
    const quarantine = `${marker}.take.${owner.token}.${attempt}`;
    try {
      fs.linkSync(marker, quarantine);
    } catch {
      continue;
    }
    const quarantined = readOwner(quarantine);
    const sameClaim =
      existing !== null &&
      quarantined !== null &&
      quarantined.token === existing.token &&
      quarantined.pid === existing.pid &&
      quarantined.start === existing.start;
    if (!sameClaim) {
      const broken = existing === null && quarantined === null;
      if (!broken) {
        unlinkQuietly(quarantine);
        continue;
      }
    }
    seam?.afterDecision?.();
    try {
      fs.unlinkSync(marker);
    } catch {
      unlinkQuietly(quarantine);
      continue;
    }
    try {
      fs.linkSync(ownerFile, marker);
    } catch {
      unlinkQuietly(quarantine);
      continue;
    }
    unlinkQuietly(quarantine);
    return true;
  }
  return false;
}

/** the OLD release: it unlinks the claim BY NAME */
export function releaseMarkerOld(
  claim: string,
  owner: PortOwner,
  ownerFile: string,
  seam?: PortSeam,
): void {
  const current = readOwner(claim);
  if (current && current.token === owner.token) {
    seam?.afterDecision?.();
    unlinkQuietly(claim);
  }
  unlinkQuietly(ownerFile);
}

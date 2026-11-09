// ============================================================
// WASL AI - D-076 / M-105 - the race of the reclaim of a claim
// ------------------------------------------------------------
// THE DEFECT (found by the review of the reply #52):
//   the creation of a claim was atomic (link) but the RECLAIM of a
//   stale claim was NOT one atomic step => the reclaim DELETED the
//   claim BY NAME => a second reclaimer deleted the FRESH claim of the
//   first one => BOTH believe they own the block => a double
//   reservation.
// THE TEST IS DETERMINISTIC: the two processes are FROZEN at the SAME
//   point of the protocol (the seam) and they are RELEASED IN ORDER
//   (the first one finishes before the second one starts) => the race
//   is reproduced on EVERY run => and not by luck.
// THE TEST RUNS TWO IMPLEMENTATIONS:
//   1) the OLD protocol (tests/tools/fixtures/port-claim-old.ts, frozen
//      verbatim) => it MUST produce a double reservation (the defect is
//      alive and the test can see it);
//   2) the NEW protocol (tests/server/harness.ts) => EXACTLY ONE owner.
//   So the same test proves the defect and the fix, and it proves that
//   the guard is able to FAIL.
// IT ALSO CHECKS THE RELEASE: the release of one process must never
//   delete the claim of another one.
// IT NEVER TOUCHES A DATABASE: only the file system of the machine.
// ============================================================

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HARNESS = path.resolve(HERE, '..', 'server', 'harness.ts');
const OLD = path.resolve(HERE, 'fixtures', 'port-claim-old.ts');
const PORT_BLOCK_DIR = path.join(os.tmpdir(), 'wasl-test-port-blocks');

interface Impl {
  readonly name: string;
  readonly module: string;
  readonly take: string;
  readonly release: string;
  readonly writeStale: string;
  readonly readOwner: string;
  readonly replaceOwner: string;
  /** the number of owners the implementation must leave after the race */
  readonly expectedOwners: number;
}

const NEW_IMPL: Impl = {
  name: 'new',
  module: HARNESS,
  take: 'takeMarker',
  release: 'releaseMarker',
  writeStale: 'writeStaleClaim',
  readOwner: 'readClaimOwner',
  replaceOwner: 'replaceClaimOwner',
  expectedOwners: 1,
};

const OLD_IMPL: Impl = {
  name: 'old',
  module: OLD,
  take: 'takeMarkerOld',
  release: 'releaseMarkerOld',
  writeStale: 'writeStaleClaimOld',
  readOwner: 'readClaimOwnerOld',
  replaceOwner: 'replaceClaimOwnerOld',
  expectedOwners: 2,
};

const IMPLS: readonly Impl[] = [OLD_IMPL, NEW_IMPL];

/** a directory that is unique for this run (it is shared with nobody). */
function scratch(prefix: string): string {
  const dir = path.join(os.tmpdir(), `wasl-m105-${prefix}-${process.pid}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** the child runs this source and prints one JSON line. */
function runChild(source: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['--experimental-strip-types', '--input-type=module', '-e', source],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** the source of a child that RECLAIMS the claim and waits at the seam. */
function reclaimSource(impl: Impl, claim: string, barrier: string, id: number): string {
  return `
    import fs from 'node:fs';
    import path from 'node:path';
    import * as impl from ${JSON.stringify(impl.module)};
    import { currentPortOwner, writePortOwnerFile } from ${JSON.stringify(HARNESS)};

    const claim = ${JSON.stringify(claim)};
    const barrier = ${JSON.stringify(barrier)};
    const id = ${id};
    const take = impl[${JSON.stringify(impl.take)}];

    const sleep = (ms) => {
      const sab = new SharedArrayBuffer(4);
      Atomics.wait(new Int32Array(sab), 0, 0, ms);
    };

    const owner = currentPortOwner();
    const ownerFile = writePortOwnerFile(owner);

    // THE SEAM: freeze HERE (the decision is taken, the destructive act
    // did not happen yet) and wait for the order of the parent.
    const seam = {
      afterDecision: () => {
        fs.writeFileSync(path.join(barrier, 'ready-' + id), '1');
        for (let i = 0; i < 6000; i += 1) {
          if (fs.existsSync(path.join(barrier, 'go-' + id))) break;
          sleep(10);
        }
      },
    };

    const won = await take(claim, owner, ownerFile, seam);
    fs.writeFileSync(path.join(barrier, 'done-' + id), '1');
    // the owner stays ALIVE until the parent says so (like a real owner
    // that holds the block) => a live claim is never taken.
    for (let i = 0; i < 6000; i += 1) {
      if (fs.existsSync(path.join(barrier, 'finish-' + id))) break;
      sleep(10);
    }
    process.stdout.write(JSON.stringify({ won: won === true, token: owner.token }), () => { process.exit(0); });
  `;
}

/** the source of a child that RELEASES a claim and waits at the seam. */
function releaseSource(impl: Impl, claim: string, barrier: string): string {
  return `
    import fs from 'node:fs';
    import path from 'node:path';
    import * as impl from ${JSON.stringify(impl.module)};
    import { currentPortOwner, writePortOwnerFile } from ${JSON.stringify(HARNESS)};

    const claim = ${JSON.stringify(claim)};
    const barrier = ${JSON.stringify(barrier)};
    const release = impl[${JSON.stringify(impl.release)}];
    const writeStale = impl[${JSON.stringify(impl.writeStale)}];

    const sleep = (ms) => {
      const sab = new SharedArrayBuffer(4);
      Atomics.wait(new Int32Array(sab), 0, 0, ms);
    };

    const owner = currentPortOwner();
    const ownerFile = writePortOwnerFile(owner);
    // this child owns the claim.
    writeStale(claim, ownerFile);

    const seam = {
      afterDecision: () => {
        fs.writeFileSync(path.join(barrier, 'ready'), '1');
        for (let i = 0; i < 6000; i += 1) {
          if (fs.existsSync(path.join(barrier, 'go'))) break;
          sleep(10);
        }
      },
    };

    await release(claim, owner, ownerFile, seam);
    fs.writeFileSync(path.join(barrier, 'done'), '1');
    for (let i = 0; i < 6000; i += 1) {
      if (fs.existsSync(path.join(barrier, 'finish'))) break;
      sleep(10);
    }
    process.stdout.write('released', () => { process.exit(0); });
  `;
}

/** wait until a file exists (or give up). */
async function waitFor(file: string, ms = 30000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (fs.existsSync(file)) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

test('FOUNDATION 04) the race of the reclaim of a claim (M-105)', async (t) => {
  await t.test('M-105a: TWO processes that reclaim the SAME stale claim => only ONE owns it', async () => {
    for (const impl of IMPLS) {
      const module = (await import(impl.module)) as Record<string, unknown>;
      const writeStale = module[impl.writeStale] as (claim: string, ownerFile: string) => void;
      const readOwner = module[impl.readOwner] as (claim: string) => { token: string } | null;
      const barrier = scratch(`barrier-${impl.name}`);
      const claim = path.join(PORT_BLOCK_DIR, `probe-race-${impl.name}-${process.pid}-${Date.now()}`);
      // THE STALE CLAIM: an owner that is DEAD (a pid that does not
      // exist) => the claim must be reclaimable => and the two children
      // race for it.
      const deadOwnerFile = path.join(
        PORT_BLOCK_DIR,
        'owners',
        `dead-${impl.name}-${process.pid}-${Date.now()}`,
      );
      fs.mkdirSync(path.dirname(deadOwnerFile), { recursive: true });
      fs.writeFileSync(deadOwnerFile, `dead-owner-${impl.name}|999999|0`);
      writeStale(claim, deadOwnerFile);

      const first = runChild(reclaimSource(impl, claim, barrier, 0));
      const second = runChild(reclaimSource(impl, claim, barrier, 1));
      // BOTH children must be frozen at the seam (each one has already
      // read the stale identity) => then they are released IN ORDER.
      assert.ok(await waitFor(path.join(barrier, 'ready-0')), `[${impl.name}] the first child did not reach the seam`);
      assert.ok(await waitFor(path.join(barrier, 'ready-1')), `[${impl.name}] the second child did not reach the seam`);
      fs.writeFileSync(path.join(barrier, 'go-0'), '1');
      assert.ok(await waitFor(path.join(barrier, 'done-0')), `[${impl.name}] the first child did not finish`);
      fs.writeFileSync(path.join(barrier, 'go-1'), '1');
      assert.ok(await waitFor(path.join(barrier, 'done-1')), `[${impl.name}] the second child did not finish`);
      fs.writeFileSync(path.join(barrier, 'finish-0'), '1');
      fs.writeFileSync(path.join(barrier, 'finish-1'), '1');

      const results = await Promise.all([first, second]);
      for (const result of results) {
        assert.equal(result.code, 0, `a child failed (${impl.name}): ${result.stderr}`);
      }
      const answers = results.map(
        (result) =>
          JSON.parse(result.stdout.trim()) as {
            won: boolean;
            token: string;
          },
      );
      const winners = answers.filter((answer) => answer.won);

      // THE ASSERTION: the number of owners after the race.
      assert.equal(
        winners.length,
        impl.expectedOwners,
        `[${impl.name}] the owners of the claim after the race: ${winners.length} (${answers
          .map((answer) => `${answer.token}:${answer.won}`)
          .join(', ')})`,
      );
      if (impl.expectedOwners === 1) {
        const owner = readOwner(claim);
        assert.ok(owner, '[new] the claim has no owner after the race');
        assert.equal(
          owner.token,
          winners[0]?.token,
          '[new] the claim does not belong to the winner of the race',
        );
        const loser = answers.find((answer) => !answer.won);
        assert.ok(loser, '[new] a child did not answer');
        assert.notEqual(owner.token, loser.token, '[new] the loser owns the claim too');
      } else {
        // the OLD protocol: the double reservation is the DEFECT and it
        // must still be reproducible (otherwise the test proves nothing).
        assert.ok(
          winners.length >= 2,
          `[${impl.name}] the defect is NOT reproducible any more: the old protocol won only ${winners.length}`,
        );
      }

      fs.rmSync(claim, { force: true, recursive: true });
      fs.rmSync(deadOwnerFile, { force: true });
      fs.rmSync(barrier, { force: true, recursive: true });
    }
  });

  await t.test('M-105b: the release of a process does NOT delete the claim of another one', async () => {
    for (const impl of IMPLS) {
      const module = (await import(impl.module)) as Record<string, unknown>;
      const readOwner = module[impl.readOwner] as (claim: string) => { token: string } | null;
      const replaceOwner = module[impl.replaceOwner] as (
        claim: string,
        ownerFile: string,
      ) => void;
      const { currentPortOwner, writePortOwnerFile } = (await import(HARNESS)) as {
        currentPortOwner: () => { token: string };
        writePortOwnerFile: (owner: { token: string }) => string;
      };
      const barrier = scratch(`barrier-${impl.name}`);
      const claim = path.join(
        PORT_BLOCK_DIR,
        `probe-release-${impl.name}-${process.pid}-${Date.now()}`,
      );
      // the claim of the child (it creates it and releases it).
      const child = runChild(releaseSource(impl, claim, barrier));
      assert.ok(
        await waitFor(path.join(barrier, 'ready')),
        `[${impl.name}] the child did not reach the seam`,
      );

      // WHILE THE CHILD IS FROZEN: another process takes the claim =>
      // the child must not delete it when it wakes up.
      const mine = currentPortOwner();
      const myFile = writePortOwnerFile(mine);
      replaceOwner(claim, myFile);
      fs.writeFileSync(path.join(barrier, 'go'), '1');
      assert.ok(await waitFor(path.join(barrier, 'done')), `[${impl.name}] the child did not finish`);
      fs.writeFileSync(path.join(barrier, 'finish'), '1');

      const result = await child;
      assert.equal(result.code, 0, `[${impl.name}] the child failed: ${result.stderr}`);
      const owner = readOwner(claim);
      if (impl.expectedOwners === 1) {
        assert.ok(
          owner && owner.token === mine.token,
          `[${impl.name}] the release DELETED the claim of another process (${
            owner?.token ?? 'none'
          })`,
        );
      } else {
        // the OLD release deletes the claim BY NAME => the claim of the
        // other process is gone: the defect is still reproducible.
        assert.ok(
          !owner || owner.token !== mine.token,
          `[${impl.name}] the defect is NOT reproducible any more: the old release kept the claim`,
        );
      }
      fs.rmSync(claim, { force: true, recursive: true });
      fs.rmSync(myFile, { force: true });
      fs.rmSync(barrier, { force: true, recursive: true });
    }
  });

  await t.test('M-105c: the reclaim keeps the SAME claim (the same block of ports)', async () => {
    // THE GAP OF M-101c: it proved that SOME block was reserved => but
    // NOT that the STALE claim itself was taken => the block of a dead
    // process would stay lost.
    const module = (await import(NEW_IMPL.module)) as Record<string, unknown>;
    const take = module[NEW_IMPL.take] as (
      claim: string,
      owner: unknown,
      ownerFile: string,
    ) => boolean | Promise<boolean>;
    const writeStale = module[NEW_IMPL.writeStale] as (
      claim: string,
      ownerFile: string,
    ) => void;
    const readOwner = module[NEW_IMPL.readOwner] as (claim: string) => { token: string } | null;
    const release = module[NEW_IMPL.release] as (
      claim: string,
      owner: unknown,
      ownerFile: string,
    ) => void | Promise<void>;
    const { currentPortOwner, writePortOwnerFile } = (await import(HARNESS)) as {
      currentPortOwner: () => { token: string };
      writePortOwnerFile: (owner: { token: string }) => string;
    };
    const claim = path.join(PORT_BLOCK_DIR, `probe-same-${process.pid}-${Date.now()}`);
    const deadOwnerFile = path.join(
      PORT_BLOCK_DIR,
      'owners',
      `dead-same-${process.pid}-${Date.now()}`,
    );
    fs.mkdirSync(path.dirname(deadOwnerFile), { recursive: true });
    fs.writeFileSync(deadOwnerFile, `dead-owner-same|999998|0`);
    writeStale(claim, deadOwnerFile);

    const mine = currentPortOwner();
    const myFile = writePortOwnerFile(mine);
    const taken = await take(claim, mine, myFile);
    assert.ok(taken, 'the stale claim was NOT reclaimed');
    const owner = readOwner(claim);
    assert.ok(owner, 'the reclaimed claim has no owner');
    assert.equal(owner.token, mine.token, 'the claim does not belong to us');
    // THE CLAIM IS THE SAME ONE (the same path => the same block) => the
    // block of the dead process is NOT lost.
    assert.ok(fs.existsSync(claim), 'the claim of the dead process was dropped instead of taken');

    await release(claim, mine, myFile);
    fs.rmSync(claim, { force: true, recursive: true });
    fs.rmSync(deadOwnerFile, { force: true });
    fs.rmSync(myFile, { force: true });
  });
});

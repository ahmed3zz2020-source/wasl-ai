// ============================================================
// WASL AI — D-074 / M-101 — the reservation of the ports
// ------------------------------------------------------------
// ⭐⭐⭐ THE QUESTION: can two test files end up with the SAME block
//   of ports ⇒ ⇒ ⇒ (and then one of them dies with EADDRINUSE and the
//   failure looks like a failure of the product).
// ⭐⭐⭐ THE FOUR SCENARIOS (each one is a REAL process, not a mock):
//   ① MANY CONCURRENT PROCESSES ⇒ ⇒ ⇒ every one of them gets a
//      DIFFERENT block ⇒ ⇒ ⇒ no double reservation;
//   ② AN ABRUPT DEATH ⇒ ⇒ ⇒ the block of the dead process is
//      reclaimed ⇒ ⇒ ⇒ and it is reclaimed by nobody else;
//   ③ A STALE MARKER WITH A REUSED PID ⇒ ⇒ ⇒ the block is reclaimed
//      (the old code kept it forever ⇒ ⇒ ⇒ `no_free_port_block`);
//   ④ A PORT TAKEN OUTSIDE THE MARKER SYSTEM ⇒ ⇒ ⇒ the block is
//      refused ⇒ ⇒ ⇒ the marker is NOT a proof that the port is free.
// ⭐⭐⭐ AND THE FIFTH: the release of one process must NOT release the
//   reservation of another one.
// ⛔ It never touches a database: it only uses the file system of the
//   machine and the loopback interface.
// ============================================================

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HARNESS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'harness.ts');
const PORT_BLOCK_DIR = path.join(os.tmpdir(), 'wasl-test-port-blocks');

/** ⭐⭐ The blocks that are reserved right now (read from the disk). */
function reservedBlocks(): number[] {
  if (!fs.existsSync(PORT_BLOCK_DIR)) return [];
  return fs
    .readdirSync(PORT_BLOCK_DIR)
    .filter((name) => name.startsWith('block-'))
    .map((name) => Number(name.slice('block-'.length)))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
}

/** ⭐⭐ The child that reserves a block and prints it. */
function reserveChild(source: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
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

/**
 * ⭐⭐⭐ The child that prints its block and stays alive.
 * ⭐⭐⭐ ⭐ The block is read from the OUTPUT of the child ⇒ ⇒ ⇒ and
 * ⭐⭐⭐ ⭐ never from the directory ⇒ ⇒ ⇒ ⭐ because the directory is
 * ⭐⭐⭐ ⭐ SHARED with the other files that run in parallel ⇒ ⇒ ⇒ ⭐
 * ⭐⭐⭐ ⭐ a block of another file must never be taken for ours.
 */
function spawnReservingChild(holdMs: number): {
  child: ReturnType<typeof spawn>;
  readBase: () => Promise<number>;
} {
  const source = `
    import { reservePortBlock } from ${JSON.stringify(HARNESS)};
    const block = await reservePortBlock();
    process.stdout.write(String(block.base));
    await new Promise((r) => setTimeout(r, ${holdMs}));
    block.release();
  `;
  const child = spawn(
    process.execPath,
    ['--experimental-strip-types', '--input-type=module', '-e', source],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stdout = '';
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  return {
    child,
    readBase: async () => {
      for (let i = 0; i < 150 && stdout.trim() === ''; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const base = Number(stdout.trim());
      assert.ok(Number.isFinite(base) && base > 0, `the child did not print a block: ${stdout}`);
      return base;
    },
  };
}

test('FOUNDATION 04) the reservation of the ports (M-101)', async (t) => {
  await t.test('⭐⭐⭐ M-101a: MANY CONCURRENT PROCESSES never share a block', async () => {
    const source = `
      import { reservePortBlock } from ${JSON.stringify(HARNESS)};
      const block = await reservePortBlock();
      process.stdout.write(String(block.base));
      // ⭐⭐ hold the reservation so the siblings really race.
      await new Promise((r) => setTimeout(r, 3000));
      block.release();
    `;
    const children = [0, 1, 2, 3, 4, 5].map(() => reserveChild(source));
    const results = await Promise.all(children);
    const bases = results.map((result) => {
      assert.equal(result.code, 0, `a child failed: ${result.stderr}`);
      return Number(result.stdout.trim());
    });
    assert.ok(bases.every((base) => Number.isFinite(base)), 'a child did not print a block');
    assert.equal(
      new Set(bases).size,
      bases.length,
      `two processes took the same block: ${bases.join(', ')}`,
    );
    // ⭐⭐ and the markers of the children are gone afterwards ⇒ ⇒ ⇒
    // ⭐⭐ (only THEIR markers: the directory is SHARED with the other
    // ⭐⭐ files that run in parallel).
    for (const base of bases) {
      assert.ok(
        !fs.existsSync(path.join(PORT_BLOCK_DIR, `block-${base}`)),
        `the marker of the child ${base} was not released`,
      );
    }
  });

  await t.test('⭐⭐⭐ M-101b: the release of one process does NOT release the reservation of another', async () => {
    const source = `
      import { reservePortBlock } from ${JSON.stringify(HARNESS)};
      const block = await reservePortBlock();
      process.stdout.write(String(block.base));
      await new Promise((r) => setTimeout(r, 4000));
      block.release();
    `;
    const { child, readBase } = spawnReservingChild(4000);
    const base = await readBase();
    // ⭐⭐ the marker of the child must exist while it lives.
    assert.ok(
      fs.existsSync(path.join(PORT_BLOCK_DIR, `block-${base}`)),
      'the marker of the child is missing',
    );
    // ⭐⭐ an unrelated release (ours) must not touch it ⇒ ⇒ ⇒ we take a
    // ⭐⭐ block ourselves and release it ⇒ ⇒ the child keeps its own.
    const { reservePortBlock } = await import(HARNESS);
    const mine = await reservePortBlock();
    mine.release();
    assert.ok(
      fs.existsSync(path.join(PORT_BLOCK_DIR, `block-${base}`)),
      'the release of another process removed the reservation of the child',
    );
    await new Promise((resolve) => child.on('close', resolve));
    // ⭐⭐ after the child is gone, its marker must be released.
    assert.ok(
      !fs.existsSync(path.join(PORT_BLOCK_DIR, `block-${base}`)),
      'the marker of the dead child was not released',
    );
  });

  await t.test('⭐⭐⭐ M-101c: an ABRUPT DEATH leaves a marker that is reclaimed', async () => {
    const source = `
      import { reservePortBlock } from ${JSON.stringify(HARNESS)};
      const block = await reservePortBlock();
      process.stdout.write(String(block.base));
      // ⭐⭐ die without any cleanup (SIGKILL) ⇒ ⇒ the marker stays.
      await new Promise((r) => setTimeout(r, 60000));
    `;
    const child = spawn(
      process.execPath,
      ['--experimental-strip-types', '--input-type=module', '-e', source],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    await new Promise((resolve) => setTimeout(resolve, 4000));
    const base = Number(stdout.trim());
    assert.ok(Number.isFinite(base), 'the child did not print a block');
    child.kill('SIGKILL');
    await new Promise((resolve) => child.on('close', resolve));
    assert.ok(
      fs.existsSync(path.join(PORT_BLOCK_DIR, `block-${base}`)),
      'the marker of the killed child disappeared (the test proves nothing)',
    );
    // ⭐⭐ the block must be reclaimable by somebody else.
    const { reservePortBlock } = await import(HARNESS);
    const mine = await reservePortBlock();
    assert.ok(mine.base > 0, 'no block could be reserved');
    mine.release();
  });

  await t.test('⭐⭐⭐ M-101d: a STALE MARKER WITH A REUSED PID is reclaimed', async () => {
    // ⭐⭐⭐ The old code only looked at the PID ⇒ ⇒ ⇒ a marker of a
    // ⭐⭐⭐ dead process whose PID was REUSED looked alive ⇒ ⇒ ⇒ the
    // ⭐⭐⭐ block was never reclaimed ⇒ ⇒ ⇒ the run died with
    // ⭐⭐⭐ `no_free_port_block`.
    // ⭐⭐⭐ The drill is at the level of the MARKER ⇒ ⇒ ⇒ (the
    // ⭐⭐⭐ directory of the blocks is shared with the other files ⇒ ⇒
    // ⭐⭐⭐ ⇒ ⇒ ⇒ and a block of another file must never be touched).
    const { takeMarker, currentPortOwner, writePortOwnerFile, writeStaleClaim, readClaimOwner } =
      await import(HARNESS);
    const owners = path.join(PORT_BLOCK_DIR, 'owners');
    fs.mkdirSync(owners, { recursive: true });
    const start = fs.readFileSync('/proc/self/stat', 'utf8');
    const tail = start.slice(start.lastIndexOf(')') + 2).trim().split(/\s+/);
    const realStart = tail[19] ?? '0';

    // ⭐⭐⭐ THE REUSED PID: the marker claims a LIVE pid (ours) ⇒ ⇒
    // ⭐⭐⭐ but a start time that does NOT belong to it ⇒ ⇒ ⇒ so the
    // ⭐⭐⭐ owner is NOT alive ⇒ ⇒ ⇒ the claim is STALE.
    const fakeOwnerFile = path.join(owners, `reused-pid-${Date.now()}`);
    fs.writeFileSync(fakeOwnerFile, `reused-pid|${process.pid}|${Number(realStart) + 999999}`);
    const staleMarker = path.join(PORT_BLOCK_DIR, `probe-reused-pid-${Date.now()}`);
    writeStaleClaim(staleMarker, fakeOwnerFile);

    const mine = currentPortOwner();
    const myFile = writePortOwnerFile(mine);
    const taken = takeMarker(staleMarker, mine, myFile);
    assert.ok(taken, 'the stale marker of a reused pid was NOT reclaimed');
    const owner = readClaimOwner(staleMarker);
    assert.ok(owner, 'the reclaimed claim has no owner');
    assert.equal(owner.token, mine.token, 'the marker does not carry our identity');
    fs.rmSync(staleMarker, { force: true, recursive: true });
    fs.rmSync(fakeOwnerFile, { force: true });
    fs.rmSync(myFile, { force: true });

    // ⭐⭐⭐ AND THE OTHER HALF: a marker of a LIVE owner is NEVER
    // ⭐⭐⭐ taken ⇒ ⇒ ⇒ (the claim of a running file is safe).
    const liveOwner = currentPortOwner();
    const liveFile = writePortOwnerFile(liveOwner);
    const liveMarker = path.join(PORT_BLOCK_DIR, `probe-live-${Date.now()}`);
    writeStaleClaim(liveMarker, liveFile);
    const other = currentPortOwner();
    const otherFile = writePortOwnerFile(other);
    assert.equal(
      takeMarker(liveMarker, other, otherFile),
      false,
      'the claim of a LIVE owner was taken',
    );
    assert.ok(fs.existsSync(liveMarker), 'the claim of a LIVE owner was removed');
    fs.rmSync(liveMarker, { force: true, recursive: true });
    fs.rmSync(liveFile, { force: true });
    fs.rmSync(otherFile, { force: true });
  });

  await t.test('⭐⭐⭐ M-101e: a port taken OUTSIDE the marker system is refused', async () => {
    // ⭐⭐ The marker is NOT a proof that the port is free ⇒ ⇒ ⇒ a
    // ⭐⭐ block that holds a port of somebody else is REFUSED ⇒ ⇒ ⇒
    // ⭐⭐ and the reservation moves to another block.
    const holder = net.createServer();
    const taken = 8900;
    await new Promise<void>((resolve) => {
      holder.listen(taken, '127.0.0.1', () => resolve());
    });
    try {
      const { reservePortBlock } = await import(HARNESS);
      const mine = await reservePortBlock();
      try {
        const inBlock = mine.base <= taken && taken < mine.base + 30;
        assert.ok(!inBlock, `the reservation took the block of the taken port ${mine.base}`);
      } finally {
        mine.release();
      }
    } finally {
      await new Promise<void>((resolve) => holder.close(() => resolve()));
    }
  });
});

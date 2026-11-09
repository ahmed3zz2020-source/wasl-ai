// ============================================================
// WASL AI — D-077 / M-109 — the window of the takeover of a claim
// ------------------------------------------------------------
// WHAT THIS FILE IS: the proof of the defect that the review of the
// reply #53 found (M-109), and the proof of the fix.
// THE DEFECT: the reclaim of a stale claim MOVED the identity of the
// claim out BEFORE it checked that the identity is the stale one it
// judged ⇒ ⇒ ⇒ so a reclaimer with an OLD reading could move the
// FRESH identity of another process away ⇒ ⇒ ⇒ and a third process
// could take the free name ⇒ ⇒ ⇒ TWO processes believe they own
// the same block of ports.
// THE TEST IS DETERMINISTIC: the three processes are FROZEN at a
// chosen point of the protocol (the seam) and they are RELEASED IN
// ORDER ⇒ ⇒ ⇒ so the window is opened on EVERY run ⇒ ⇒ ⇒ and not
// by luck.
// THE TEST RUNS TWO IMPLEMENTATIONS:
// 1) the protocol of M-105 (frozen verbatim in
// tests/tools/fixtures/port-claim-m105.ts) ⇒ ⇒ ⇒ it MUST produce
// two owners (the defect is alive and the test can see it);
// 2) the protocol of today (tests/server/harness.ts) ⇒ ⇒ ⇒ EXACTLY ONE
// owner ⇒ ⇒ ⇒ the kernel arbitrates the claim.
// THE FOUR SCENARIOS (the reviewer asked for all of them):
// 1) the takeover window (three processes) ⇒ ⇒ ⇒ one owner;
// 2) the release ⇒ ⇒ ⇒ it never touches the claim of another one;
// 3) the death of the owner ⇒ ⇒ ⇒ the block is free at once;
// 4) the competition (eight processes) ⇒ ⇒ ⇒ one owner.
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
const M105 = path.resolve(HERE, 'fixtures', 'port-claim-m105.ts');
const PORT_BLOCK_DIR = path.join(os.tmpdir(), 'wasl-test-port-blocks');

interface Impl {
 readonly name: string;
 readonly module: string;
 readonly take: string;
 readonly release: string;
 readonly writeStale: string;
 readonly readOwner: string;
}

const NEW_IMPL: Impl = {
 name: 'new',
 module: HARNESS,
 take: 'takeMarker',
 release: 'releaseMarker',
 writeStale: 'writeStaleClaim',
 readOwner: 'readClaimOwner',
};

const OLD_IMPL: Impl = {
 name: 'm105',
 module: M105,
 take: 'takeMarkerOld',
 release: 'releaseMarkerOld',
 writeStale: 'writeStaleClaimOld',
 readOwner: 'readClaimOwnerOld',
};

const IMPLS: readonly Impl[] = [OLD_IMPL, NEW_IMPL];

type TakeFn = (
 claim: string,
 owner: unknown,
 ownerFile: string,
 seam?: unknown,
) => Promise<boolean> | boolean;
type ReleaseFn = (
 claim: string,
 owner: unknown,
 ownerFile: string,
 seam?: unknown,
) => Promise<void> | void;

/** a directory that is unique for this run (it is shared with nobody). */
function scratch(prefix: string): string {
 const dir = path.join(os.tmpdir(), `wasl-m109-${prefix}-${process.pid}-${Date.now()}`);
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

/** wait until a file exists (or give up). */
async function waitFor(file: string, ms = 30000): Promise<boolean> {
 const until = Date.now() + ms;
 while (Date.now() < until) {
 if (fs.existsSync(file)) return true;
 await new Promise((resolve) => setTimeout(resolve, 25));
 }
 return false;
}

/** wait until the text is not empty (or give up). */
async function waitForText(read: () => string, ms = 30000): Promise<string> {
 const until = Date.now() + ms;
 while (Date.now() < until) {
 const value = read().trim();
 if (value !== '') return value;
 await new Promise((resolve) => setTimeout(resolve, 25));
 }
 return '';
}

/**
 * the source of a child that TAKES the claim and waits at the seam.
 * the seam has two points:
 * afterDecision ⇒ ⇒ the decision is taken, the act did not happen;
 * afterMove ⇒ ⇒ ⇒ the identity was MOVED out (the window is open).
 */
function seamTakeSource(impl: Impl, claim: string, barrier: string, id: string): string {
 return `
 import fs from 'node:fs';
 import path from 'node:path';
 import * as impl from ${JSON.stringify(impl.module)};
 import { currentPortOwner, writePortOwnerFile } from ${JSON.stringify(HARNESS)};

 const claim = ${JSON.stringify(claim)};
 const barrier = ${JSON.stringify(barrier)};
 const id = ${JSON.stringify(id)};
 const take = impl[${JSON.stringify(impl.take)}];

 const sleep = (ms) => {
 const sab = new SharedArrayBuffer(4);
 Atomics.wait(new Int32Array(sab), 0, 0, ms);
 };
 const wait = (name) => {
 for (let i = 0; i < 9000; i += 1) {
 if (fs.existsSync(path.join(barrier, name))) break;
 sleep(10);
 }
 };

 const owner = currentPortOwner();
 const ownerFile = writePortOwnerFile(owner);

 const seam = {
 afterDecision: () => {
 fs.writeFileSync(path.join(barrier, 'ready-' + id), '1');
 wait('go-' + id);
 },
 afterMove: () => {
 fs.writeFileSync(path.join(barrier, 'moved-' + id), '1');
 wait('go-moved-' + id);
 },
 };

 const won = await take(claim, owner, ownerFile, seam);
 fs.writeFileSync(path.join(barrier, 'done-' + id), '1');
 // the owner stays ALIVE until the parent says so ⇒ ⇒ a live claim is
 // never taken.
 wait('finish-' + id);
 process.stdout.write(JSON.stringify({ won: won === true, token: owner.token }), () => { process.exit(0); });
 `;
}

/** the source of a child that TAKES the claim without any seam. */
function plainTakeSource(impl: Impl, claim: string, barrier: string, id: string): string {
 return `
 import fs from 'node:fs';
 import path from 'node:path';
 import * as impl from ${JSON.stringify(impl.module)};
 import { currentPortOwner, writePortOwnerFile } from ${JSON.stringify(HARNESS)};

 const claim = ${JSON.stringify(claim)};
 const barrier = ${JSON.stringify(barrier)};
 const id = ${JSON.stringify(id)};
 const take = impl[${JSON.stringify(impl.take)}];

 const owner = currentPortOwner();
 const ownerFile = writePortOwnerFile(owner);
 const won = await take(claim, owner, ownerFile);
 fs.writeFileSync(path.join(barrier, 'done-' + id), '1');
 // the owner stays ALIVE until the parent says so ⇒ ⇒ a live claim is
 // never taken.
 for (let i = 0; i < 9000; i += 1) {
 if (fs.existsSync(path.join(barrier, 'finish-' + id))) break;
 await new Promise((r) => setTimeout(r, 10));
 }
 process.stdout.write(JSON.stringify({ won: won === true, token: owner.token }), () => { process.exit(0); });
 `;
}

/** the source of a child that HOLDS the claim until it is killed. */
function holdSource(impl: Impl, claim: string): string {
 return `
 import * as impl from ${JSON.stringify(impl.module)};
 import { currentPortOwner, writePortOwnerFile } from ${JSON.stringify(HARNESS)};
 const claim = ${JSON.stringify(claim)};
 const take = impl[${JSON.stringify(impl.take)}];
 const owner = currentPortOwner();
 const ownerFile = writePortOwnerFile(owner);
 const won = await take(claim, owner, ownerFile);
 process.stdout.write(JSON.stringify({ won: won === true, token: owner.token }));
 await new Promise((r) => setTimeout(r, 60000));
 `;
}

test('FOUNDATION 04) the window of the takeover of a claim (M-109)', async (t) => {
 await t.test('M-109a: THREE processes ⇒ ⇒ ONE owner (the window is never open)', async () => {
 for (const impl of IMPLS) {
 const barrier = scratch(`a-${impl.name}`);
 const claim = path.join(PORT_BLOCK_DIR, `probe-m109a-${impl.name}-${process.pid}-${Date.now()}`);
 // the STALE claim ⇒ ⇒ ⇒ a record of an owner that does not exist.
 const deadOwnerFile = path.join(
 PORT_BLOCK_DIR,
 'owners',
 `dead-m109a-${impl.name}-${process.pid}-${Date.now()}`,
 );
 fs.mkdirSync(path.dirname(deadOwnerFile), { recursive: true });
 fs.writeFileSync(deadOwnerFile, `dead-m109a-${impl.name}|999999|0`);
 const module = (await import(impl.module)) as Record<string, unknown>;
 const writeStale = module[impl.writeStale] as (claim: string, ownerFile: string) => void;
 writeStale(claim, deadOwnerFile);

 // B ⇒ ⇒ ⇒ the reader with the OLD reading of the claim ⇒ ⇒ ⇒ it is
 // FROZEN after it read the stale identity.
 const b = runChild(seamTakeSource(impl, claim, barrier, 'b'));
 assert.ok(
 await waitFor(path.join(barrier, 'ready-b')),
 `[${impl.name}] the reader did not reach the seam`,
 );
 // A ⇒ ⇒ ⇒ the first reclaimer ⇒ ⇒ ⇒ it takes the claim.
 const a = runChild(plainTakeSource(impl, claim, barrier, 'a'));
 assert.ok(await waitFor(path.join(barrier, 'done-a')), `[${impl.name}] the first reclaimer did not finish`);
 // B continues ⇒ ⇒ ⇒ it moves the identity out ⇒ ⇒ ⇒ (the protocol
 // of M-105) ⇒ ⇒ ⇒ and the name is free.
 fs.writeFileSync(path.join(barrier, 'go-b'), '1');
 const windowOpen = await waitFor(path.join(barrier, 'moved-b'), 5000);
 if (!windowOpen) {
 // the protocol of today ⇒ ⇒ ⇒ the window does NOT exist ⇒ ⇒ ⇒ 
 // ⇒ ⇒ ⇒ the reader is already done.
 assert.ok(
 await waitFor(path.join(barrier, 'done-b')),
 `[${impl.name}] the reader did not finish`,
 );
 }
 // C ⇒ ⇒ ⇒ the third process ⇒ ⇒ ⇒ it takes the free name.
 const c = runChild(plainTakeSource(impl, claim, barrier, 'c'));
 assert.ok(await waitFor(path.join(barrier, 'done-c')), `[${impl.name}] the third process did not finish`);
 if (windowOpen) {
 fs.writeFileSync(path.join(barrier, 'go-moved-b'), '1');
 assert.ok(
 await waitFor(path.join(barrier, 'done-b')),
 `[${impl.name}] the reader did not finish`,
 );
 }
 fs.writeFileSync(path.join(barrier, 'finish-a'), '1');
 fs.writeFileSync(path.join(barrier, 'finish-b'), '1');
 fs.writeFileSync(path.join(barrier, 'finish-c'), '1');

 const results = await Promise.all([a, b, c]);
 for (const result of results) {
 assert.equal(result.code, 0, `a child failed (${impl.name}): ${result.stderr}`);
 }
 const answers = results.map(
 (result) => JSON.parse(result.stdout.trim()) as { won: boolean; token: string },
 );
 const winners = answers.filter((answer) => answer.won);
 console.log(
 `[M-109a] impl=${impl.name} owners=${winners.length} tokens=${answers
 .map((answer) => `${answer.token}:${answer.won}`)
 .join(', ')} windowOpen=${windowOpen}`,
 );

 if (impl.name === 'm105') {
 // the OLD protocol ⇒ ⇒ ⇒ the defect MUST still be reproducible,
 // otherwise the test proves nothing.
 assert.ok(
 winners.length >= 2,
 `[${impl.name}] the defect is NOT reproducible any more: only ${winners.length} owner`,
 );
 } else {
 assert.equal(
 winners.length,
 1,
 `[${impl.name}] the owners of the claim after the window: ${winners.length} (${answers
 .map((answer) => `${answer.token}:${answer.won}`)
 .join(', ')})`,
 );
 const readOwner = module[impl.readOwner] as (claim: string) => { token: string } | null;
 const owner = readOwner(claim);
 assert.ok(owner, '[new] the claim has no owner after the window');
 assert.equal(owner.token, winners[0]?.token, '[new] the claim does not belong to the winner');
 }

 fs.rmSync(claim, { force: true, recursive: true });
 fs.rmSync(deadOwnerFile, { force: true });
 fs.rmSync(barrier, { force: true, recursive: true });
 }
 });

 await t.test('M-109b: the RELEASE never touches the claim of another process', async () => {
 for (const impl of IMPLS) {
 const claim = path.join(PORT_BLOCK_DIR, `probe-m109b-${impl.name}-${process.pid}-${Date.now()}`);
 const module = (await import(impl.module)) as Record<string, unknown>;
 const take = module[impl.take] as TakeFn;
 const release = module[impl.release] as ReleaseFn;
 const readOwner = module[impl.readOwner] as (claim: string) => { token: string } | null;
 const { currentPortOwner, writePortOwnerFile } = (await import(HARNESS)) as {
 currentPortOwner: () => { token: string };
 writePortOwnerFile: (owner: { token: string }) => string;
 };

 const mine = currentPortOwner();
 const myFile = writePortOwnerFile(mine);
 const taken = await take(claim, mine, myFile);
 assert.ok(taken, `[${impl.name}] the claim could not be taken`);

 // a SECOND owner tries the same claim ⇒ ⇒ ⇒ it must be refused.
 const other = currentPortOwner();
 const otherFile = writePortOwnerFile(other);
 const second = await take(claim, other, otherFile);
 assert.equal(second, false, `[${impl.name}] the claim of a LIVE owner was taken`);
 assert.ok(
 fs.existsSync(claim),
 `[${impl.name}] the claim of a LIVE owner was removed`,
 );

 // the release of the owner ⇒ ⇒ ⇒ it releases ITS claim only.
 await release(claim, mine, myFile);

 // after the release ⇒ ⇒ ⇒ the claim is free ⇒ ⇒ ⇒ and it is
 // released ⇒ ⇒ ⇒ (not left behind).
 const after = readOwner(claim);
 assert.ok(
 !after || after.token === mine.token,
 `[${impl.name}] the release DELETED the claim of another process (${after?.token ?? 'none'})`,
 );
 const third = await take(claim, other, otherFile);
 assert.ok(third, `[${impl.name}] the claim was not free after the release`);
 await release(claim, other, otherFile);

 fs.rmSync(claim, { force: true, recursive: true });
 fs.rmSync(myFile, { force: true });
 fs.rmSync(otherFile, { force: true });
 }
 });

 await t.test('M-109c: the DEATH of the owner frees the block at once', async () => {
 for (const impl of IMPLS) {
 const claim = path.join(PORT_BLOCK_DIR, `probe-m109c-${impl.name}-${process.pid}-${Date.now()}`);
 const module = (await import(impl.module)) as Record<string, unknown>;
 const take = module[impl.take] as TakeFn;
 const release = module[impl.release] as ReleaseFn;
 const { currentPortOwner, writePortOwnerFile } = (await import(HARNESS)) as {
 currentPortOwner: () => { token: string };
 writePortOwnerFile: (owner: { token: string }) => string;
 };

 const child = spawn(
 process.execPath,
 ['--experimental-strip-types', '--input-type=module', '-e', holdSource(impl, claim)],
 { stdio: ['ignore', 'pipe', 'inherit'] },
 );
 let stdout = '';
 child.stdout.on('data', (chunk: Buffer) => {
 stdout += chunk.toString();
 });
 const answered = await waitForText(() => stdout, 30000);
 assert.ok(answered, `[${impl.name}] the child did not answer: ${stdout}`);
 assert.equal(
 JSON.parse(answered.trim()).won,
 true,
 `[${impl.name}] the child did not take the claim`,
 );

 // the owner DIES ⇒ ⇒ ⇒ (SIGKILL ⇒ ⇒ ⇒ no cleanup at all).
 child.kill('SIGKILL');
 await new Promise((resolve) => child.on('close', resolve));

 // the block must be free at once.
 const mine = currentPortOwner();
 const myFile = writePortOwnerFile(mine);
 const taken = await take(claim, mine, myFile);
 assert.ok(taken, `[${impl.name}] the block of the dead process was NOT free`);
 await release(claim, mine, myFile);

 fs.rmSync(claim, { force: true, recursive: true });
 fs.rmSync(myFile, { force: true });
 }
 });

 await t.test('M-109d: the COMPETITION of eight processes ⇒ ⇒ ONE owner', async () => {
 for (const impl of IMPLS) {
 const barrier = scratch(`d-${impl.name}`);
 const claim = path.join(PORT_BLOCK_DIR, `probe-m109d-${impl.name}-${process.pid}-${Date.now()}`);
 const module = (await import(impl.module)) as Record<string, unknown>;
 const writeStale = module[impl.writeStale] as (claim: string, ownerFile: string) => void;
 const deadOwnerFile = path.join(
 PORT_BLOCK_DIR,
 'owners',
 `dead-m109d-${impl.name}-${process.pid}-${Date.now()}`,
 );
 fs.mkdirSync(path.dirname(deadOwnerFile), { recursive: true });
 fs.writeFileSync(deadOwnerFile, `dead-m109d-${impl.name}|999999|0`);
 writeStale(claim, deadOwnerFile);

 const children = [0, 1, 2, 3, 4, 5, 6, 7].map((index) =>
 runChild(seamTakeSource(impl, claim, barrier, `d${index}`)),
 );
 for (let index = 0; index < 8; index += 1) {
 assert.ok(
 await waitFor(path.join(barrier, `ready-d${index}`)),
 `[${impl.name}] the child ${index} did not reach the seam`,
 );
 }
 // the ORDER is controlled ⇒ ⇒ ⇒ the result is the same on every run.
 // #0 goes first ⇒ ⇒ ⇒ it takes the stale claim ⇒ ⇒ ⇒ and it must not
 // stop at the pause of the move ⇒ ⇒ ⇒ so it is released right away.
 fs.writeFileSync(path.join(barrier, 'go-d0'), '1');
 fs.writeFileSync(path.join(barrier, 'go-moved-d0'), '1');
 assert.ok(
 await waitFor(path.join(barrier, 'done-d0')),
 `[${impl.name}] the child 0 did not finish`,
 );
 // #1 goes second ⇒ ⇒ ⇒ it holds the OLD reading of the claim ⇒ ⇒ ⇒
 // (the protocol of M-105) ⇒ ⇒ ⇒ it moves the identity of #0 away.
 fs.writeFileSync(path.join(barrier, 'go-d1'), '1');
 const windowOpen = await waitFor(path.join(barrier, 'moved-d1'), 5000);
 if (windowOpen) {
 // the name is free RIGHT NOW ⇒ ⇒ ⇒ #2 goes and takes it.
 fs.writeFileSync(path.join(barrier, 'go-d2'), '1');
 assert.ok(
 await waitFor(path.join(barrier, 'done-d2')),
 `[${impl.name}] the child 2 did not finish`,
 );
 // now #1 continues ⇒ ⇒ ⇒ it restores and it loses.
 fs.writeFileSync(path.join(barrier, 'go-moved-d1'), '1');
 assert.ok(
 await waitFor(path.join(barrier, 'done-d1')),
 `[${impl.name}] the child 1 did not finish`,
 );
 for (let index = 3; index < 8; index += 1) {
 fs.writeFileSync(path.join(barrier, `go-d${index}`), '1');
 fs.writeFileSync(path.join(barrier, `go-moved-d${index}`), '1');
 assert.ok(
 await waitFor(path.join(barrier, `done-d${index}`)),
 `[${impl.name}] the child ${index} did not finish`,
 );
 }
 } else {
 // the protocol of today ⇒ ⇒ ⇒ there is NO window ⇒ ⇒ ⇒ the
 // children are released one after the other.
 for (let index = 1; index < 8; index += 1) {
 fs.writeFileSync(path.join(barrier, `go-d${index}`), '1');
 fs.writeFileSync(path.join(barrier, `go-moved-d${index}`), '1');
 assert.ok(
 await waitFor(path.join(barrier, `done-d${index}`)),
 `[${impl.name}] the child ${index} did not finish`,
 );
 }
 }
 for (let index = 0; index < 8; index += 1) {
 fs.writeFileSync(path.join(barrier, `finish-d${index}`), '1');
 }

 const results = await Promise.all(children);
 for (const result of results) {
 assert.equal(result.code, 0, `a child failed (${impl.name}): ${result.stderr}`);
 }
 const winners = results.filter(
 (result) => (JSON.parse(result.stdout.trim()) as { won: boolean }).won,
 );
 console.log(`[M-109d] impl=${impl.name} owners=${winners.length} of 8`);
 if (impl.name === 'm105') {
 // the OLD protocol ⇒ ⇒ ⇒ the defect MUST still be reproducible,
 // otherwise the test proves nothing.
 assert.ok(
 winners.length >= 2,
 `[${impl.name}] the defect is NOT reproducible any more: only ${winners.length} owner`,
 );
 } else {
 assert.equal(
 winners.length,
 1,
 `[${impl.name}] the owners of the claim after the competition: ${winners.length}`,
 );
 }

 fs.rmSync(claim, { force: true, recursive: true });
 fs.rmSync(deadOwnerFile, { force: true });
 fs.rmSync(barrier, { force: true, recursive: true });
 }
 });
});

// ============================================================
// WASL AI — M-118 — the guard of the board of the completion
// ------------------------------------------------------------
// ⭐⭐ WHAT THIS FILE PROVES
//   ① ⭐⭐⭐ THE DENOMINATOR NEVER MOVES: the inventory holds 75
//      items in three areas with the FIXED weights (20 / 20 / 35)
//      ⇒ ⭐⭐ so no round can inflate its own percentage;
//   ② ⭐⭐⭐ EVERY DONE ITEM CARRIES ITS EVIDENCE ⇒ ⭐⭐ so a green
//      item is always backed by a test or a file;
//   ③ ⭐⭐⭐ THE PUBLISHED BOARD MATCHES THE COMPUTED ONE ⇒ ⭐⭐ the
//      published number is reproducible (the lesson of M-115: a
//      published number that cannot be recomputed is a failure);
//   ④ ⭐⭐⭐ THE METHOD DID NOT CHANGE between the rounds ⇒ ⭐⭐ the
//      area weights are the same ones of the baseline;
//   ⑤ ⭐⭐⭐ THE OVERALL ESTIMATE NEVER GOES BACKWARDS and every
//      advance carries its basis ⇒ ⭐⭐ so the scale of the owner
//      stays comparable from one round to the next.
// ⛔ Local files only (no database, no network).
// ============================================================

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOOL = path.join(REPO, 'tools', 'completion_board.py');
const INVENTORY = path.join(REPO, 'docs', 'completion-board.json');
const PUBLISHED = path.join(REPO, 'docs', 'COMPLETION-BOARD.md');

interface Area {
  readonly id: string;
  readonly name: string;
  readonly weight: number;
}
interface Item {
  readonly id: string;
  readonly area: string;
  readonly title: string;
  readonly done: boolean;
  readonly round: string;
  readonly evidence: string;
  readonly note?: string;
}
interface Inventory {
  readonly weights: Record<string, number>;
  readonly areas: Area[];
  readonly items: Item[];
  readonly project_estimate: {
    readonly round: string;
    readonly value: number;
    readonly status: string;
    readonly basis: string;
  }[];
}

function readInventory(): Inventory {
  return JSON.parse(fs.readFileSync(INVENTORY, 'utf8')) as Inventory;
}

function runTool(args: string[]): string {
  return execFileSync('python3', [TOOL, ...args], { encoding: 'utf8', cwd: REPO });
}

test('FOUNDATION 22) M-118 — the board of the completion is reproducible', async (t) => {
  await t.test('⭐⭐⭐ M-118-1: the denominator and the weights NEVER move', () => {
    const inventory = readInventory();
    assert.deepEqual(
      inventory.weights,
      { ui: 20, tickets: 20, platform: 35 },
      '⭐⭐⭐ the weights of the areas changed (the denominator must stay 75)',
    );
    assert.equal(inventory.items.length, 75, '⭐⭐⭐ the inventory does not hold 75 items');
    for (const area of inventory.areas) {
      const count = inventory.items.filter((item) => item.area === area.id).length;
      assert.equal(
        count,
        area.weight,
        `⭐⭐⭐ the area ${area.id} holds ${count} items instead of ${area.weight}`,
      );
    }
    // ⭐⭐⭐ the weights are the SAME ones of the baseline of the list
    // ⭐⭐⭐ (the rule of the owner: the method never changes).
    const baseline = 'docs/FOUNDATION-BUILD-03-PHASE-04-BIS3-REPORT.md';
    const baselineText = fs.readFileSync(path.join(REPO, baseline), 'utf8');
    assert.match(baselineText, /٧٥/, '⭐⭐⭐ the baseline report does not state the 75 items');
    assert.match(baselineText, /٣٥ بنداً/, '⭐⭐⭐ the baseline report does not state the platform area');
  });

  await t.test('⭐⭐⭐ M-118-2: every done item carries its evidence', () => {
    const inventory = readInventory();
    for (const item of inventory.items) {
      if (!item.done) continue;
      assert.ok(
        item.evidence.trim().length > 0,
        `⭐⭐⭐ the item ${item.id} is done without evidence (a green item must have a proof)`,
      );
      assert.ok(
        item.round.trim().length > 0,
        `⭐⭐⭐ the item ${item.id} is done without the round that did it`,
      );
    }
    // ⭐⭐⭐ the tool refuses an item that is done without evidence.
    const tampered = JSON.parse(fs.readFileSync(INVENTORY, 'utf8')) as Inventory;
    const victim = tampered.items.find((item) => item.done) as Item;
    victim.evidence = '';
    const temporary = path.join(REPO, 'docs', '.completion-board-tampered.json');
    fs.writeFileSync(temporary, JSON.stringify(tampered), 'utf8');
    try {
      const output = execFileSync('python3', [TOOL, '--json'], {
        encoding: 'utf8',
        cwd: REPO,
        env: { ...process.env, WASL_BOARD_INVENTORY: temporary },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      assert.fail(`⭐⭐⭐ the tool accepted an item without evidence: ${output}`);
    } catch (error) {
      const stderr = String((error as { stderr?: string }).stderr ?? '');
      assert.match(
        stderr,
        /without evidence|COMPLETION BOARD AUDIT FAILED/,
        `⭐⭐⭐ the tool did not refuse the tampered inventory: ${stderr}`,
      );
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  });

  await t.test('⭐⭐⭐ M-118-3: the published board matches the computed one', () => {
    const output = runTool(['--check']);
    assert.match(output, /COMPLETION BOARD AUDIT OK/, '⭐⭐⭐ the published board is stale');
    const computed = JSON.parse(runTool(['--json'])) as {
      done: number;
      total: number;
      percent: number;
      areas: { id: string; done: number; total: number; percent: number }[];
    };
    assert.equal(computed.total, 75, '⭐⭐⭐ the computed denominator is not 75');
    assert.equal(computed.done, 41, `⭐⭐⭐ the computed done is ${computed.done} instead of 41`);
    assert.equal(computed.percent, 54.7, `⭐⭐⭐ the computed percentage is ${computed.percent}`);
    const ui = computed.areas.find((area) => area.id === 'ui');
    const tickets = computed.areas.find((area) => area.id === 'tickets');
    const platform = computed.areas.find((area) => area.id === 'platform');
    assert.equal(ui?.done, 18, '⭐⭐⭐ the area of the interface is wrong');
    assert.equal(ui?.percent, 90, '⭐⭐⭐ the area of the interface is wrong');
    assert.equal(tickets?.done, 16, '⭐⭐⭐ the area of the tickets is wrong');
    assert.equal(tickets?.percent, 80, '⭐⭐⭐ the area of the tickets is wrong');
    assert.equal(platform?.done, 7, '⭐⭐⭐ the area of the platform is wrong');
    assert.equal(platform?.percent, 20, '⭐⭐⭐ the area of the platform is wrong');
    // ⭐⭐⭐ and the published file carries those numbers.
    const published = fs.readFileSync(PUBLISHED, 'utf8');
    assert.match(published, /41\/75 = 54\.7%/, '⭐⭐⭐ the published board does not carry the computed numbers');
    assert.match(published, /46%/, '⭐⭐⭐ the published board does not carry the estimate of this round');
  });

  await t.test('⭐⭐⭐ M-118-4: the estimate of the project never goes backwards and carries its basis', () => {
    const inventory = readInventory();
    const series = inventory.project_estimate;
    assert.ok(series.length >= 3, '⭐⭐⭐ the series of the estimate is too short');
    assert.equal(series[0]?.value, 44, '⭐⭐⭐ the baseline of the owner is not 44');
    assert.equal(series[1]?.value, 45, '⭐⭐⭐ the estimate after M-114 is not 45');
    assert.equal(series[2]?.value, 46, '⭐⭐⭐ the estimate of this round is not 46');
    let previous = -1;
    for (const entry of series) {
      assert.ok(entry.value >= previous, '⭐⭐⭐ the estimate went backwards');
      assert.ok(entry.basis.trim().length > 0, `⭐⭐⭐ the estimate ${entry.round} carries no basis`);
      previous = entry.value;
    }
    // ⭐⭐⭐ the estimate of THIS round is a proposal (it needs the owner)
    // ⭐⭐⭐ ⇐ ⭐⭐ it is never presented as an approved decision.
    assert.equal(series[2]?.status, 'proposed', '⭐⭐⭐ the estimate of this round is presented as approved');
  });

  await t.test('⭐⭐⭐ M-118-5: the items of this round are marked with their truth', () => {
    const inventory = readInventory();
    // ⭐⭐⭐ the queue of the unassigned tickets IS delivered (M-119).
    const queue = inventory.items.find((item) => item.id === 'tk-18');
    assert.ok(queue, '⭐⭐⭐ the item of the queue is missing from the inventory');
    assert.equal(queue.done, true, '⭐⭐⭐ the queue of the unassigned tickets is not marked as done');
    assert.match(queue.evidence, /foundation-tickets-queue/, '⭐⭐⭐ the queue has no evidence');
    // ⭐⭐⭐ and the audit of the inbox AND the CRM is NOT done ⇒ ⭐⭐ it
    // ⭐⭐ stays open (the half of the CRM does NOT close the item).
    const audit = inventory.items.find((item) => item.id === 'ui-20');
    assert.ok(audit, '⭐⭐⭐ the item of the audit is missing from the inventory');
    assert.equal(
      audit.done,
      false,
      '⭐⭐⭐ the audit of the inbox AND the CRM is marked as done (only the CRM was audited)',
    );
    assert.ok(audit.note && audit.note.includes('CRM'), '⭐⭐⭐ the half that was delivered is not written');
  });
});

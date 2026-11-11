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
    assert.equal(computed.done, 42, `⭐⭐⭐ the computed done is ${computed.done} instead of 42`);
    assert.equal(computed.percent, 56, `⭐⭐⭐ the computed percentage is ${computed.percent}`);
    const ui = computed.areas.find((area) => area.id === 'ui');
    const tickets = computed.areas.find((area) => area.id === 'tickets');
    const platform = computed.areas.find((area) => area.id === 'platform');
    assert.equal(ui?.done, 19, '⭐⭐⭐ the area of the interface is wrong');
    assert.equal(ui?.percent, 95, '⭐⭐⭐ the area of the interface is wrong');
    assert.equal(tickets?.done, 16, '⭐⭐⭐ the area of the tickets is wrong');
    assert.equal(tickets?.percent, 80, '⭐⭐⭐ the area of the tickets is wrong');
    assert.equal(platform?.done, 7, '⭐⭐⭐ the area of the platform is wrong');
    assert.equal(platform?.percent, 20, '⭐⭐⭐ the area of the platform is wrong');
    // ⭐⭐⭐ and the published file carries those numbers.
    const published = fs.readFileSync(PUBLISHED, 'utf8');
    assert.match(published, /42\/75 = 56\.0%/, '⭐⭐⭐ the published board does not carry the computed numbers');
    assert.match(published, /47%/, '⭐⭐⭐ the published board does not carry the estimate of this round');
  });

  await t.test('⭐⭐⭐ M-123: the board shows the areas BEFORE and AFTER (the same weights)', () => {
    const inventory = readInventory() as Inventory & {
      baseline?: { areas: Record<string, number>; done: number; total: number };
    };
    assert.ok(inventory.baseline, '⭐⭐⭐ the inventory carries no baseline of the round');
    const published = fs.readFileSync(PUBLISHED, 'utf8');
    assert.match(published, /قبل/, '⭐⭐⭐ the published board has no comparison');
    assert.match(published, /بعد/, '⭐⭐⭐ the published board has no comparison');
    // ⭐⭐⭐ the comparison uses the SAME weights (20 / 20 / 35) ⇐ ⭐⭐ and
    // ⭐⭐⭐ the difference is EXACTLY the items that really changed.
    const computed = JSON.parse(runTool(['--json'])) as {
      done: number;
      areas: { id: string; done: number }[];
    };
    const delta =
      computed.done -
      Object.values(inventory.baseline?.areas ?? {}).reduce((sum, value) => sum + value, 0);
    assert.equal(delta, 1, `⭐⭐⭐ the difference of the round is ${delta} instead of 1`);
    for (const area of computed.areas) {
      const before = inventory.baseline?.areas?.[area.id];
      assert.ok(before !== undefined, `⭐⭐⭐ the area ${area.id} has no number before`);
      assert.ok(
        area.done >= before,
        `⭐⭐⭐ the area ${area.id} went backwards (${before} ⇒ ${area.done})`,
      );
    }
  });

  await t.test('⭐⭐⭐ M-118-4: the estimate of the project never goes backwards and carries its basis', () => {
    const inventory = readInventory();
    const series = inventory.project_estimate;
    assert.ok(series.length >= 3, '⭐⭐⭐ the series of the estimate is too short');
    assert.equal(series[0]?.value, 44, '⭐⭐⭐ the baseline of the owner is not 44');
    assert.equal(series[1]?.value, 45, '⭐⭐⭐ the estimate after M-114 is not 45');
    assert.equal(series[2]?.value, 46, '⭐⭐⭐ the estimate of the round #57 is not 46');
    assert.equal(series[3]?.value, 47, '⭐⭐⭐ the estimate of this round is not 47');
    let previous = -1;
    for (const entry of series) {
      assert.ok(entry.value >= previous, '⭐⭐⭐ the estimate went backwards');
      assert.ok(entry.basis.trim().length > 0, `⭐⭐⭐ the estimate ${entry.round} carries no basis`);
      previous = entry.value;
    }
    // ⭐⭐⭐ the estimate of the round #57 is APPROVED by the owner (D-082)
    assert.equal(series[2]?.status, 'owner', '⭐⭐⭐ the estimate of the round #57 is not approved');
    // ⭐⭐⭐ the estimate of THIS round is a proposal (it needs the owner)
    // ⭐⭐⭐ ⇐ ⭐⭐ it is never presented as an approved decision.
    const last = series[series.length - 1];
    assert.equal(last?.status, 'proposed', '⭐⭐⭐ the estimate of this round is presented as approved');
    assert.equal(last?.value, 47, '⭐⭐⭐ the last estimate of the scale is not 47');
  });

  await t.test('⭐⭐⭐ M-118-5: the items of this round are marked with their truth', () => {
    const inventory = readInventory();
    // ⭐⭐⭐ the queue of the unassigned tickets IS delivered (M-119).
    const queue = inventory.items.find((item) => item.id === 'tk-18');
    assert.ok(queue, '⭐⭐⭐ the item of the queue is missing from the inventory');
    assert.equal(queue.done, true, '⭐⭐⭐ the queue of the unassigned tickets is not marked as done');
    assert.match(queue.evidence, /foundation-tickets-queue/, '⭐⭐⭐ the queue has no evidence');
    // ⭐⭐⭐ M-125: ⭐⭐⭐ the audit of the inbox AND the CRM is REALLY
    // ⭐⭐⭐ done now (both of them are audited on a phone with real
    // ⭐⭐⭐ PostgreSQL) ⇒ ⭐⭐ and it carries the evidence of both.
    const audit = inventory.items.find((item) => item.id === 'ui-20');
    assert.ok(audit, '⭐⭐⭐ the item of the audit is missing from the inventory');
    assert.equal(
      audit.done,
      true,
      '⭐⭐⭐ the audit of the inbox AND the CRM is not marked as done (it IS audited now)',
    );
    assert.match(audit.evidence, /inbox-ui/, '⭐⭐⭐ the audit has no evidence of the inbox');
    assert.match(audit.evidence, /crm-ui/, '⭐⭐⭐ the audit has no evidence of the CRM');
    // ⭐⭐⭐ and the item of the writing queue stays OPEN (the queue of
    // ⭐⭐⭐ the messages while the connection is cut is NOT built).
    const queueOfWriting = inventory.items.find((item) => item.id === 'ui-19');
    assert.ok(queueOfWriting, '⭐⭐⭐ the item of the writing queue is missing');
    assert.equal(
      queueOfWriting.done,
      false,
      '⭐⭐⭐ the writing queue is marked as done (it is not built)',
    );
  });

  // ============================================================
  // M-128 — the twelve commercial domains (a THIRD scale)
  // ============================================================
  await t.test('⭐⭐⭐ M-128-1: the twelve domains carry EQUAL weights that never move', () => {
    const inventory = readInventory() as Inventory & {
      commercial_domains?: {
        id: string;
        name: string;
        weight: number;
        capabilities: { id: string; title: string; evidence: string[] }[];
      }[];
    };
    const domains = inventory.commercial_domains ?? [];
    assert.equal(domains.length, 12, `⭐⭐⭐ the inventory holds ${domains.length} domains instead of 12`);
    const ids = new Set(domains.map((domain) => domain.id));
    assert.equal(ids.size, 12, '⭐⭐⭐ two commercial domains carry the same identifier');
    for (const domain of domains) {
      assert.equal(
        domain.weight,
        8.33,
        `⭐⭐⭐ the weight of ${domain.id} is ${domain.weight} instead of 8.33 (the weights never move)`,
      );
      assert.ok(domain.capabilities.length > 0, `⭐⭐⭐ the domain ${domain.id} holds no capability`);
    }
    const total = domains.reduce((sum, domain) => sum + domain.weight, 0);
    assert.ok(
      Math.abs(total - 100) <= 0.1,
      `⭐⭐⭐ the weights of the domains sum to ${total} instead of 100`,
    );
  });

  await t.test('⭐⭐⭐ M-128-2: every claimed evidence REALLY exists (the tool refuses a made up one)', () => {
    const inventory = readInventory() as Inventory & {
      commercial_domains?: {
        id: string;
        capabilities: { id: string; evidence: string[] }[];
      }[];
    };
    for (const domain of inventory.commercial_domains ?? []) {
      for (const capability of domain.capabilities) {
        for (const file of capability.evidence) {
          assert.ok(
            fs.existsSync(path.join(REPO, file)),
            `⭐⭐⭐ the capability ${capability.id} claims a file that does not exist: ${file}`,
          );
        }
      }
    }
    // ⭐⭐⭐ and the tool REFUSES a tampered inventory (a file that is
    // ⭐⭐⭐ not there ⇒ the audit fails ⇒ ⇒ ⇒ the number cannot be
    // ⭐⭐⭐ written by hand).
    const tampered = JSON.parse(fs.readFileSync(INVENTORY, 'utf8')) as {
      commercial_domains: { capabilities: { id: string; evidence: string[] }[] }[];
    };
    tampered.commercial_domains[0]!.capabilities[0]!.evidence = ['docs/does-not-exist.md'];
    const temporary = path.join(REPO, 'docs', '.completion-domains-tampered.json');
    fs.writeFileSync(temporary, JSON.stringify(tampered), 'utf8');
    try {
      const output = execFileSync('python3', [TOOL, '--json'], {
        encoding: 'utf8',
        cwd: REPO,
        env: { ...process.env, WASL_BOARD_INVENTORY: temporary },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      assert.fail(`⭐⭐⭐ the tool accepted a made up evidence: ${output}`);
    } catch (error) {
      const stderr = String((error as { stderr?: string }).stderr ?? '');
      assert.match(
        stderr,
        /does NOT exist|COMPLETION BOARD AUDIT FAILED/,
        `⭐⭐⭐ the tool did not refuse the tampered inventory: ${stderr}`,
      );
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  });

  await t.test('⭐⭐⭐ M-128-3: the numbers are MEASURED (the disk now · the baseline commit before)', () => {
    const computed = JSON.parse(runTool(['--json'])) as {
      domains: {
        baseline: { sha: string };
        rows: {
          id: string;
          done: number;
          total: number;
          percent: number;
          percent_before: number;
          needs_review: boolean;
          changed: { id: string }[];
        }[];
        reviewed: number;
        pending_review: number;
        weighted_percent: number;
        weighted_percent_before: number;
      };
    };
    const domains = computed.domains;
    assert.equal(domains.rows.length, 12, '⭐⭐⭐ the computed domains are not 12');
    assert.match(domains.baseline.sha, /^[0-9a-f]{40}$/, '⭐⭐⭐ the baseline carries no commit');
    // ⭐⭐⭐ the conversations domain moved BECAUSE of the three new
    // ⭐⭐⭐ capabilities of this round (the proof is the file itself).
    const conversations = domains.rows.find((row) => row.id === 'conversations');
    assert.ok(conversations, '⭐⭐⭐ the domain of the conversations is missing');
    assert.ok(
      conversations.percent > conversations.percent_before,
      '⭐⭐⭐ the domain of the conversations did not move',
    );
    assert.equal(conversations.done, conversations.total, '⭐⭐⭐ the conversations are not complete');
    for (const id of ['conv-draft', 'conv-ux', 'conv-quick']) {
      assert.ok(
        conversations.changed.some((capability) => capability.id === id),
        `⭐⭐⭐ the capability ${id} is not reported as new`,
      );
    }
    // ⭐⭐⭐ a domain that needs a review is NOT given a number ⇒ ⇒ ⇒
    // ⭐⭐⭐ and it is NOT in the total ⇒ ⇒ ⇒ ⇒ no inflation.
    const staff = domains.rows.find((row) => row.id === 'staff');
    assert.ok(staff?.needs_review, '⭐⭐⭐ the domain of the staff has no review');
    assert.equal(domains.pending_review, 2, '⭐⭐⭐ the number of the domains that need a review is wrong');
    assert.ok(
      domains.weighted_percent >= domains.weighted_percent_before,
      '⭐⭐⭐ the weighted total went backwards',
    );
    // ⭐⭐⭐ the published file carries the table of the twelve.
    const published = fs.readFileSync(PUBLISHED, 'utf8');
    assert.match(published, /المجالات الأصلية الاثنا عشر/, '⭐⭐⭐ the published board has no third scale');
    assert.match(published, /يحتاج إعادة تقييم/, '⭐⭐⭐ the published board does not mark the domains that need a review');
    assert.match(published, /المحادثات/, '⭐⭐⭐ the published board has no row of the conversations');
    // ⭐⭐⭐ and the third scale does NOT replace the scale of the owner.
    assert.match(published, /42\/75 = 56\.0%/, '⭐⭐⭐ the internal list is not published any more');
    assert.match(published, /46%/, '⭐⭐⭐ the estimate of the owner is not published any more');
  });
});

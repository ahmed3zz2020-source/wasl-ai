// ============================================================
// WASL AI — pf-30 — the guard of the cost tracker
// ------------------------------------------------------------
// ⭐⭐ WHAT THIS FILE PROVES
//   ① ⭐⭐⭐ THE TRACKER READS ITS CONFIGURATION FILE ⇒ ⭐⭐ the
//      numbers of the report are the numbers of the file;
//   ② ⭐⭐⭐ IT COMPUTES THE TOTAL of the lines ⇒ ⭐⭐ the sum is
//      reproducible and not typed by hand;
//   ③ ⭐⭐⭐ IT REFUSES AN EMPTY OR A NEGATIVE PRICE ⇒ ⭐⭐⭐ and it
//      refuses the WHOLE report (a half report is a lie);
//   ④ ⭐⭐⭐ IT NEVER PRINTS A DEFAULT PRICE ⇒ ⭐⭐⭐ no price is ever
//      invented, neither by the code nor by the shipped example;
//   ⑤ ⭐⭐⭐ THE EXIT CODE IS THE CONTRACT: 0 (report) · 1 (refused)
//      · 2 (the ceiling was exceeded).
// ⛔ Local files only (no database, no network, no provider).
// ============================================================

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildCostReport,
  parseCostConfig,
  readCostConfig,
  type CostConfig,
} from '../../tools/wasl-cost-tracker.ts';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOOL = path.join(REPO, 'tools', 'wasl-cost-tracker.ts');
const EXAMPLE = path.join(REPO, 'docs', 'ops-pilot-package', 'cost-config.example.json');

/** ⭐⭐⭐ A temporary configuration file (cleaned up after every test). */
function withConfigFile(body: unknown, run: (file: string) => void): void {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wasl-cost-'));
  const file = path.join(directory, 'cost-config.json');
  fs.writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
  try {
    run(file);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

/** ⭐⭐⭐ Run the CLI and capture both streams and the exit code. */
function runTool(args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(
      process.execPath,
      ['--experimental-strip-types', TOOL, ...args],
      { encoding: 'utf8', cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      code: failure.status ?? 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

/** ⭐⭐⭐ A configuration that the tracker accepts. */
function validConfig(): CostConfig {
  return parseCostConfig(
    JSON.stringify({
      currency: 'EGP',
      period: 'monthly',
      ceiling: 1000,
      items: [
        {
          id: 'hosting_server',
          category: 'hosting',
          label: 'server',
          quantity: 1,
          unit: 'month',
          unit_cost: 300,
          enabled: true,
        },
        {
          id: 'backup_storage',
          category: 'backup',
          label: 'storage',
          quantity: 50,
          unit: 'GB',
          unit_cost: 2,
          enabled: true,
        },
        {
          id: 'messaging_variable',
          category: 'messaging',
          label: 'messages',
          quantity: 1000,
          unit: 'message',
          unit_cost: 0.05,
          enabled: true,
        },
      ],
    }),
  );
}

test('pf-30 — the cost tracker reads, computes, and refuses', async (t) => {
  await t.test('⭐⭐⭐ ① the tracker READS the configuration file', () => {
    withConfigFile(
      {
        currency: 'EGP',
        period: 'monthly',
        ceiling: null,
        items: [
          {
            id: 'hosting_server',
            category: 'hosting',
            label: 'server',
            quantity: 1,
            unit: 'month',
            unit_cost: 300,
            enabled: true,
          },
        ],
      },
      (file) => {
        const config = readCostConfig({ configPath: file });
        assert.equal(config.currency, 'EGP', '⭐⭐⭐ the tracker did not read the currency');
        assert.equal(config.period, 'monthly', '⭐⭐⭐ the tracker did not read the period');
        assert.equal(config.items.length, 1, '⭐⭐⭐ the tracker did not read the line');
        assert.equal(config.items[0]?.unit_cost, 300, '⭐⭐⭐ the tracker did not read the price');

        // ⭐⭐⭐ and the CLI prints the file it read.
        const run = runTool(['--config', file]);
        assert.equal(run.code, 0, `⭐⭐⭐ the tracker refused a valid configuration: ${run.stderr}`);
        assert.match(run.stdout, /cost-config\.json/, '⭐⭐⭐ the report does not name its file');
        assert.match(run.stdout, /300\.00/, '⭐⭐⭐ the report does not carry the price of the file');
      },
    );
  });

  await t.test('⭐⭐⭐ ② it COMPUTES the total of the lines', () => {
    const config = validConfig();
    const report = buildCostReport(config, 'test');
    // ⭐⭐⭐ 300 + (50 * 2) + (1000 * 0.05) = 450
    assert.equal(report.lines.length, 3, '⭐⭐⭐ the report does not hold the three lines');
    assert.equal(report.total, 450, `⭐⭐⭐ the computed total is ${report.total} instead of 450`);
    assert.equal(
      report.lines[1]?.total,
      100,
      '⭐⭐⭐ the total of the storage line is wrong',
    );
    assert.equal(report.over_ceiling, false, '⭐⭐⭐ the report says the ceiling is exceeded');
    assert.equal(report.ceiling, 1000, '⭐⭐⭐ the report lost the ceiling');

    // ⭐⭐⭐ and the CLI prints the same number (the report is reproducible).
    withConfigFile(
      {
        currency: 'EGP',
        period: 'monthly',
        ceiling: 1000,
        items: validConfig().items.map((item) => ({
          id: item.id,
          category: item.category,
          label: item.label,
          quantity: item.quantity,
          unit: item.unit,
          unit_cost: item.unit_cost,
          enabled: item.enabled,
        })),
      },
      (file) => {
        const run = runTool(['--config', file, '--json']);
        assert.equal(run.code, 0, `⭐⭐⭐ the tracker refused a valid configuration: ${run.stderr}`);
        const parsed = JSON.parse(run.stdout) as { total: number; lines: unknown[] };
        assert.equal(parsed.total, 450, '⭐⭐⭐ the CLI total differs from the computed one');
        assert.equal(parsed.lines.length, 3, '⭐⭐⭐ the CLI lines differ from the computed ones');
      },
    );
  });

  await t.test('⭐⭐⭐ ③ it REFUSES an empty price (and prints no report at all)', () => {
    // ⭐⭐⭐ a line without a price (null) ⇒ REFUSED.
    withConfigFile(
      {
        currency: 'EGP',
        period: 'monthly',
        ceiling: null,
        items: [
          {
            id: 'hosting_server',
            category: 'hosting',
            label: 'server',
            quantity: 1,
            unit: 'month',
            unit_cost: null,
            enabled: true,
          },
        ],
      },
      (file) => {
        const run = runTool(['--config', file]);
        assert.equal(run.code, 1, '⭐⭐⭐ the tracker accepted a line without a price');
        assert.match(run.stderr, /cost_item_price_missing/, '⭐⭐⭐ the refusal has no code');
        assert.equal(run.stdout, '', '⭐⭐⭐ the tracker printed a report beside the refusal');
      },
    );

    // ⭐⭐⭐ an empty string is not a price either ⇒ REFUSED.
    withConfigFile(
      {
        currency: 'EGP',
        period: 'monthly',
        ceiling: null,
        items: [
          {
            id: 'hosting_server',
            category: 'hosting',
            label: 'server',
            quantity: 1,
            unit: 'month',
            unit_cost: '',
            enabled: true,
          },
        ],
      },
      (file) => {
        const run = runTool(['--config', file]);
        assert.equal(run.code, 1, '⭐⭐⭐ the tracker accepted an empty price');
        assert.match(run.stderr, /cost_item_price_invalid/, '⭐⭐⭐ the refusal has no code');
        assert.equal(run.stdout, '', '⭐⭐⭐ the tracker printed a report beside the refusal');
      },
    );

    // ⭐⭐⭐ the price key may be absent altogether ⇒ REFUSED.
    withConfigFile(
      {
        currency: 'EGP',
        period: 'monthly',
        ceiling: null,
        items: [
          {
            id: 'hosting_server',
            category: 'hosting',
            label: 'server',
            quantity: 1,
            unit: 'month',
            enabled: true,
          },
        ],
      },
      (file) => {
        const run = runTool(['--config', file]);
        assert.equal(run.code, 1, '⭐⭐⭐ the tracker accepted a line without a price key');
        assert.match(run.stderr, /cost_item_price_missing/, '⭐⭐⭐ the refusal has no code');
      },
    );
  });

  await t.test('⭐⭐⭐ ③ it REFUSES a negative price and a negative quantity', () => {
    withConfigFile(
      {
        currency: 'EGP',
        period: 'monthly',
        ceiling: null,
        items: [
          {
            id: 'hosting_server',
            category: 'hosting',
            label: 'server',
            quantity: 1,
            unit: 'month',
            unit_cost: -5,
            enabled: true,
          },
        ],
      },
      (file) => {
        const run = runTool(['--config', file]);
        assert.equal(run.code, 1, '⭐⭐⭐ the tracker accepted a negative price');
        assert.match(run.stderr, /cost_item_price_negative/, '⭐⭐⭐ the refusal has no code');
        assert.equal(run.stdout, '', '⭐⭐⭐ the tracker printed a report beside the refusal');
      },
    );

    withConfigFile(
      {
        currency: 'EGP',
        period: 'monthly',
        ceiling: null,
        items: [
          {
            id: 'hosting_server',
            category: 'hosting',
            label: 'server',
            quantity: -1,
            unit: 'month',
            unit_cost: 5,
            enabled: true,
          },
        ],
      },
      (file) => {
        const run = runTool(['--config', file]);
        assert.equal(run.code, 1, '⭐⭐⭐ the tracker accepted a negative quantity');
        assert.match(run.stderr, /cost_item_quantity_negative/, '⭐⭐⭐ the refusal has no code');
      },
    );
  });

  await t.test('⭐⭐⭐ ④ it NEVER prints a default price', () => {
    // ⭐⭐⭐ ④-A: the shipped example holds NO price ⇒ the tool refuses it
    // ⭐⭐⭐ (⇒ the example can never be mistaken for a price list).
    const example = JSON.parse(fs.readFileSync(EXAMPLE, 'utf8')) as {
      items: { id: string; unit_cost: number | null; enabled: boolean }[];
    };
    assert.ok(example.items.length > 0, '⭐⭐⭐ the example holds no line');
    for (const item of example.items) {
      assert.equal(
        item.unit_cost,
        null,
        `⭐⭐⭐ the example carries a price for ${item.id} (an invented price is forbidden)`,
      );
    }
    const run = runTool(['--config', EXAMPLE]);
    assert.equal(run.code, 1, '⭐⭐⭐ the tracker accepted the example without prices');
    assert.match(run.stderr, /cost_item_price_missing/, '⭐⭐⭐ the refusal has no code');
    assert.equal(run.stdout, '', '⭐⭐⭐ the tracker printed a report beside the refusal');

    // ⭐⭐⭐ ④-B: the source of the tool holds NO numeric default price:
    // ⭐⭐⭐ there is no literal price assigned to `unit_cost` anywhere.
    const source = fs.readFileSync(TOOL, 'utf8');
    assert.doesNotMatch(
      source,
      /unit_cost\s*:\s*-?\d/,
      '⭐⭐⭐ the tool bakes a default price into the source',
    );
    assert.doesNotMatch(
      source,
      /DEFAULT_PRICE|DEFAULT_COST|FALLBACK_PRICE/i,
      '⭐⭐⭐ the tool holds a default price constant',
    );

    // ⭐⭐⭐ ④-C: every price of the report is the price of the file
    // ⭐⭐⭐ (nothing is invented, nothing is rounded away).
    withConfigFile(
      {
        currency: 'EGP',
        period: 'monthly',
        ceiling: null,
        items: [
          {
            id: 'hosting_server',
            category: 'hosting',
            label: 'server',
            quantity: 3,
            unit: 'month',
            unit_cost: 137.5,
            enabled: true,
          },
        ],
      },
      (file) => {
        const run = runTool(['--config', file]);
        assert.equal(run.code, 0, `⭐⭐⭐ the tracker refused a valid configuration: ${run.stderr}`);
        assert.match(run.stdout, /137\.50/, '⭐⭐⭐ the report does not carry the price of the file');
        assert.match(run.stdout, /412\.50/, '⭐⭐⭐ the report does not carry the computed total');
        assert.doesNotMatch(
          run.stdout,
          /\b0\.00\b/,
          '⭐⭐⭐ the report carries a zero price (a default price?)',
        );
      },
    );
  });

  await t.test('⭐⭐⭐ ⑤ the exit code is the contract', () => {
    // ⭐⭐⭐ 0 ⇒ a report was produced.
    withConfigFile(
      {
        currency: 'EGP',
        period: 'monthly',
        ceiling: 1000,
        items: [
          {
            id: 'hosting_server',
            category: 'hosting',
            label: 'server',
            quantity: 1,
            unit: 'month',
            unit_cost: 300,
            enabled: true,
          },
        ],
      },
      (file) => {
        assert.equal(runTool(['--config', file]).code, 0, '⭐⭐⭐ the exit code of a report is not 0');
      },
    );

    // ⭐⭐⭐ 1 ⇒ the configuration was refused.
    const refused = runTool(['--config', path.join(os.tmpdir(), 'wasl-missing-config.json')]);
    assert.equal(refused.code, 1, '⭐⭐⭐ the exit code of a refusal is not 1');
    assert.match(refused.stderr, /cost_config_missing/, '⭐⭐⭐ the refusal has no code');

    // ⭐⭐⭐ 2 ⇒ the report exists AND the ceiling was exceeded.
    withConfigFile(
      {
        currency: 'EGP',
        period: 'monthly',
        ceiling: 10,
        items: [
          {
            id: 'hosting_server',
            category: 'hosting',
            label: 'server',
            quantity: 1,
            unit: 'month',
            unit_cost: 300,
            enabled: true,
          },
        ],
      },
      (file) => {
        const run = runTool(['--config', file]);
        assert.equal(run.code, 2, '⭐⭐⭐ the exit code of an exceeded ceiling is not 2');
        assert.match(run.stdout, /متجاوز/, '⭐⭐⭐ the report does not say the ceiling is exceeded');
      },
    );
  });
});

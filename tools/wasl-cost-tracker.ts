// ============================================================
// WASL AI — حزمة التشغيل — متتبّع التكاليف (pf-30)
// ------------------------------------------------------------
// ⭐ متتبّع التكاليف يقرأ أرقام التكلفة من ملف إعدادONLY — ⭐⭐
//   **بلا أي سعر افتراضي**: بند بلا سعر ⇒ يرفض الأداة كلها.
// ⭐⭐⭐ WHY (the rule of the owner):
//   A cost tracker that invents a price is worse than no tracker:
//   it publishes a number nobody measured and nobody approved ⇒
//   ⇒⇒ the ceiling becomes a fiction ⇒ ⇒⇒ and a fiction cannot
//   ⇒⇒⇒ stop a bill. So: every number in the report is READ from
//   the configuration file, and a missing price is a REFUSAL —
//   ⇒⇒⇒ never a default.
// ⭐ WHAT IT DOES:
//   1) reads the configuration file (JSON) — the five cost buckets
//      of the review: hosting · database · backup · monitoring ·
//      messaging (a variable channel),
//   2) validates every line (a price that is empty, negative or
//      not a number ⇒ the tool refuses and exits with 1),
//   3) computes the total of the period and compares it with the
//      ceiling (a value of the owner, also read from the file),
//   4) prints the periodic report as a table (or as JSON),
//   5) can save the report and compare it with the previous cycle
//      (the delta of a real periodic report).
// ⭐ EXIT CODES (a correct exit code is part of the contract):
//   0 ⇒ the report was produced,
//   1 ⇒ the configuration was refused (nothing was printed),
//   2 ⇒ the report was produced AND the ceiling was exceeded.
// ⛔ LOCAL only: it reads local files and prints. It never calls a
//   provider, never reads an account, never spends anything.
// ⛔ No new dependency: the Node built-ins only (`node:fs`,
//   `node:path`).
// ============================================================

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

/** ⭐ The five buckets of the review (docs/REVIEW-060 · §4). */
export const COST_CATEGORIES = [
  'hosting',
  'database',
  'backup',
  'monitoring',
  'messaging',
] as const;

export type CostCategory = (typeof COST_CATEGORIES)[number];

/** ⭐ The Arabic name of every bucket (the report speaks Arabic). */
export const CATEGORY_LABELS: Readonly<Record<CostCategory, string>> = Object.freeze({
  hosting: 'استضافة',
  database: 'قاعدة بيانات',
  backup: 'نسخ احتياطي',
  monitoring: 'مراقبة',
  messaging: 'قناة متغيّرة',
});

export interface CostItem {
  readonly id: string;
  readonly category: CostCategory;
  readonly label: string;
  readonly quantity: number;
  readonly unit: string;
  /** ⭐ NULL means "no price yet" ⇒ the tool REFUSES (never defaults). */
  readonly unit_cost: number | null;
  readonly enabled: boolean;
}

export interface CostConfig {
  readonly currency: string;
  readonly period: string;
  /** ⭐ The ceiling of the owner (null ⇒ no ceiling is declared). */
  readonly ceiling: number | null;
  readonly items: readonly CostItem[];
}

export interface CostLine {
  readonly id: string;
  readonly category: CostCategory;
  readonly label: string;
  readonly quantity: number;
  readonly unit: string;
  readonly unit_cost: number;
  readonly total: number;
}

export interface CostReport {
  readonly config_path: string;
  readonly currency: string;
  readonly period: string;
  readonly lines: readonly CostLine[];
  readonly total: number;
  readonly ceiling: number | null;
  readonly over_ceiling: boolean;
  /** ⭐ The lines that were switched off (they carry no price). */
  readonly disabled: readonly string[];
  /** ⭐ The report of the previous cycle (when --compare was given). */
  readonly previous_total: number | null;
  readonly previous_period: string | null;
  readonly delta: number | null;
}

/** ⭐ The error of the tool: a code and a human message. */
export class CostConfigError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'CostConfigError';
    this.code = code;
  }
}

export interface CostConfigOptions {
  /** ⭐ The path of the configuration file. */
  readonly configPath?: string;
}

/** ⭐⭐ The default path of the configuration (a local file). */
export function defaultConfigPath(root: string = ROOT): string {
  return path.join(root, '.local', 'cost-config.json');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** ⭐⭐⭐ Parse the configuration — ⭐ every failure is a REFUSAL. */
export function parseCostConfig(raw: string): CostConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new CostConfigError(
      'cost_config_invalid_json',
      `cost_config_invalid_json: ${(error as Error).message}`,
    );
  }
  if (!isPlainObject(parsed)) {
    throw new CostConfigError('cost_config_not_an_object', 'cost_config_not_an_object');
  }

  const currency = parsed['currency'];
  if (typeof currency !== 'string' || currency.trim() === '') {
    throw new CostConfigError('cost_currency_missing', 'cost_currency_missing');
  }
  const period = parsed['period'];
  if (typeof period !== 'string' || period.trim() === '') {
    throw new CostConfigError('cost_period_missing', 'cost_period_missing');
  }

  // ⭐ The ceiling is optional — ⭐ but when it is there it is a number
  //   and it is never negative.
  let ceiling: number | null = null;
  const rawCeiling = parsed['ceiling'];
  if (rawCeiling !== undefined && rawCeiling !== null) {
    if (typeof rawCeiling !== 'number' || !Number.isFinite(rawCeiling)) {
      throw new CostConfigError('cost_ceiling_invalid', 'cost_ceiling_invalid');
    }
    if (rawCeiling < 0) {
      throw new CostConfigError('cost_ceiling_negative', 'cost_ceiling_negative');
    }
    ceiling = rawCeiling;
  }

  const rawItems = parsed['items'];
  if (!Array.isArray(rawItems)) {
    throw new CostConfigError('cost_items_missing', 'cost_items_missing');
  }

  const items: CostItem[] = [];
  const seen = new Set<string>();
  for (const [index, rawItem] of rawItems.entries()) {
    if (!isPlainObject(rawItem)) {
      throw new CostConfigError('cost_item_not_an_object', `cost_item_not_an_object: ${String(index)}`);
    }
    const id = rawItem['id'];
    if (typeof id !== 'string' || id.trim() === '') {
      throw new CostConfigError('cost_item_id_missing', `cost_item_id_missing: ${String(index)}`);
    }
    if (seen.has(id)) {
      throw new CostConfigError('cost_item_id_duplicated', `cost_item_id_duplicated: ${id}`);
    }
    seen.add(id);

    const category = rawItem['category'];
    if (
      typeof category !== 'string' ||
      !(COST_CATEGORIES as readonly string[]).includes(category)
    ) {
      throw new CostConfigError(
        'cost_item_category_unknown',
        `cost_item_category_unknown: ${id} (the known buckets: ${COST_CATEGORIES.join(' · ')})`,
      );
    }
    const label = rawItem['label'];
    if (typeof label !== 'string' || label.trim() === '') {
      throw new CostConfigError('cost_item_label_missing', `cost_item_label_missing: ${id}`);
    }
    const unit = rawItem['unit'];
    if (typeof unit !== 'string' || unit.trim() === '') {
      throw new CostConfigError('cost_item_unit_missing', `cost_item_unit_missing: ${id}`);
    }

    const quantity = rawItem['quantity'];
    if (typeof quantity !== 'number' || !Number.isFinite(quantity)) {
      throw new CostConfigError('cost_item_quantity_invalid', `cost_item_quantity_invalid: ${id}`);
    }
    if (quantity < 0) {
      throw new CostConfigError('cost_item_quantity_negative', `cost_item_quantity_negative: ${id}`);
    }

    const enabled = rawItem['enabled'];
    if (enabled !== undefined && typeof enabled !== 'boolean') {
      throw new CostConfigError('cost_item_enabled_invalid', `cost_item_enabled_invalid: ${id}`);
    }

    // ⭐⭐⭐ THE PRICE: ⭐⭐⭐ empty (null / missing / not a number) ⇒
    //   REFUSED — ⭐⭐⭐ and a negative price ⇒ REFUSED. ⭐⭐⭐ There is
    //   ⭐⭐⭐ NO default price anywhere in this file: a line without a
    //   ⭐⭐⭐ price stops the whole report.
    const unitCost = rawItem['unit_cost'];
    let price: number | null = null;
    if (unitCost !== undefined && unitCost !== null) {
      if (typeof unitCost !== 'number' || !Number.isFinite(unitCost)) {
        throw new CostConfigError(
          'cost_item_price_invalid',
          `cost_item_price_invalid: ${id} (the price must be a number written in the configuration file)`,
        );
      }
      if (unitCost < 0) {
        throw new CostConfigError('cost_item_price_negative', `cost_item_price_negative: ${id}`);
      }
      price = unitCost;
    }
    const isEnabled = enabled !== false;
    if (isEnabled && price === null) {
      throw new CostConfigError(
        'cost_item_price_missing',
        `cost_item_price_missing: ${id} (⭐ no default price is ever invented ⇒ write the price of the owner in the configuration file)`,
      );
    }

    items.push({
      id,
      category: category as CostCategory,
      label,
      quantity,
      unit,
      unit_cost: price,
      enabled: isEnabled,
    });
  }

  return {
    currency: currency.trim(),
    period: period.trim(),
    ceiling,
    items,
  };
}

/** ⭐⭐⭐ The path of the configuration — ⭐⭐⭐ the flag wins, then the
 *  ⭐⭐⭐ environment, then the default local file. */
export function resolveConfigPath(options: CostConfigOptions = {}): string {
  return options.configPath ?? process.env['WASL_COST_CONFIG'] ?? defaultConfigPath();
}

/** ⭐⭐⭐ Read the configuration file — ⭐⭐⭐ and refuse it when it is not there. */
export function readCostConfig(options: CostConfigOptions = {}): CostConfig {
  const configPath = resolveConfigPath(options);
  if (!fs.existsSync(configPath)) {
    throw new CostConfigError(
      'cost_config_missing',
      `cost_config_missing: ${configPath} (copy the example: docs/ops-pilot-package/cost-config.example.json)`,
    );
  }
  return parseCostConfig(fs.readFileSync(configPath, 'utf8'));
}

/** ⭐⭐⭐ Compute the report — ⭐⭐⭐ the total is the sum of the lines. */
export function buildCostReport(
  config: CostConfig,
  configPath: string,
  previous: { readonly total: number; readonly period: string } | null = null,
): CostReport {
  const lines: CostLine[] = [];
  const disabled: string[] = [];
  let total = 0;
  for (const item of config.items) {
    if (!item.enabled) {
      disabled.push(item.id);
      continue;
    }
    // ⭐ The price is guaranteed here: the parser refused a line without.
    const unitCost = item.unit_cost as number;
    const lineTotal = item.quantity * unitCost;
    total += lineTotal;
    lines.push({
      id: item.id,
      category: item.category,
      label: item.label,
      quantity: item.quantity,
      unit: item.unit,
      unit_cost: unitCost,
      total: lineTotal,
    });
  }
  const previousTotal = previous ? previous.total : null;
  return {
    config_path: configPath,
    currency: config.currency,
    period: config.period,
    lines,
    total,
    ceiling: config.ceiling,
    over_ceiling: config.ceiling !== null && total > config.ceiling,
    disabled,
    previous_total: previousTotal,
    previous_period: previous ? previous.period : null,
    delta: previousTotal === null ? null : total - previousTotal,
  };
}

/** ⭐⭐⭐ Read a report that was saved by --save (the previous cycle). */
export function readSavedReport(file: string): { readonly total: number; readonly period: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new CostConfigError(
      'cost_saved_report_invalid',
      `cost_saved_report_invalid: ${(error as Error).message}`,
    );
  }
  if (!isPlainObject(parsed)) {
    throw new CostConfigError('cost_saved_report_invalid', 'cost_saved_report_invalid');
  }
  const total = parsed['total'];
  const period = parsed['period'];
  if (typeof total !== 'number' || !Number.isFinite(total)) {
    throw new CostConfigError('cost_saved_report_invalid', 'cost_saved_report_invalid: total');
  }
  if (typeof period !== 'string' || period.trim() === '') {
    throw new CostConfigError('cost_saved_report_invalid', 'cost_saved_report_invalid: period');
  }
  return { total, period };
}

/** ⭐⭐⭐ Format a number — ⭐⭐⭐ two decimals and no invented digits. */
function money(value: number): string {
  return value.toFixed(2);
}

/** ⭐⭐⭐ The periodic report — ⭐⭐⭐ a table, not a paragraph. */
export function formatCostReport(report: CostReport): string {
  const out: string[] = [];
  const rule = '='.repeat(92);
  const thin = '-'.repeat(92);
  out.push(rule);
  out.push('⭐ متتبّع التكاليف (pf-30) — تقرير دوري');
  out.push(`   الدورة: ${report.period} · العملة: ${report.currency}`);
  out.push(`   ملف الإعداد: ${report.config_path}`);
  out.push(rule);
  out.push('# | البند | الفئة | الكمية | الوحدة | سعر الوحدة | الإجمالي');
  report.lines.forEach((line, index) => {
    out.push(
      `${String(index + 1)} | ${line.label} | ${CATEGORY_LABELS[line.category]} | ` +
        `${line.quantity} | ${line.unit} | ${money(line.unit_cost)} | ${money(line.total)}`,
    );
  });
  if (report.lines.length === 0) {
    out.push('— | (لا بند مفعّل) | — | — | — | — | —');
  }
  out.push(thin);
  out.push(`⭐ الإجمالي: ${money(report.total)} ${report.currency}`);
  if (report.ceiling === null) {
    out.push('⭐ السقف: (غير معلَن في ملف الإعداد)');
  } else {
    out.push(
      `⭐ السقف: ${money(report.ceiling)} ${report.currency} ⇒ ` +
        (report.over_ceiling
          ? `⭐⭐ متجاوز بمقدار ${money(report.total - report.ceiling)} ${report.currency}`
          : `متبقٍ ${money(report.ceiling - report.total)} ${report.currency}`),
    );
  }
  if (report.previous_total !== null) {
    const sign = (report.delta ?? 0) >= 0 ? '+' : '-';
    out.push(
      `⭐ الدورة السابقة (${report.previous_period}): ${money(report.previous_total)} ${report.currency} ` +
        `⇒ التغيّر: ${sign}${money(Math.abs(report.delta ?? 0))} ${report.currency}`,
    );
  }
  if (report.disabled.length > 0) {
    out.push(`⭐ بنود موقوفة (بلا سعر محتسب): ${report.disabled.join(' · ')}`);
  }
  out.push(rule);
  return `${out.join('\n')}\n`;
}

/** ⭐⭐⭐ The CLI — ⭐⭐⭐ a correct exit code is part of the contract. */
export function main(argv: readonly string[]): number {
  const args = [...argv];
  let configPath: string | undefined;
  let compareFile: string | null = null;
  let saveFile: string | null = null;
  let asJson = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--config') {
      configPath = args[index + 1];
      index += 1;
    } else if (arg === '--compare') {
      compareFile = args[index + 1] ?? null;
      index += 1;
    } else if (arg === '--save') {
      saveFile = args[index + 1] ?? null;
      index += 1;
    } else if (arg === '--json') {
      asJson = true;
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        'usage: node --experimental-strip-types tools/wasl-cost-tracker.ts ' +
          '[--config <file>] [--compare <report.json>] [--save <report.json>] [--json]\n',
      );
      return 0;
    }
  }

  try {
    const config = readCostConfig(configPath === undefined ? {} : { configPath });
    const resolvedPath = resolveConfigPath(configPath === undefined ? {} : { configPath });
    const previous = compareFile === null ? null : readSavedReport(compareFile);
    const report = buildCostReport(config, resolvedPath, previous);
    if (asJson) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      process.stdout.write(formatCostReport(report));
    }
    if (saveFile !== null) {
      fs.mkdirSync(path.dirname(path.resolve(saveFile)), { recursive: true });
      fs.writeFileSync(saveFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      process.stderr.write(`report saved: ${saveFile}\n`);
    }
    // ⭐⭐⭐ 2 ⇒ the report exists AND the ceiling was exceeded.
    return report.over_ceiling ? 2 : 0;
  } catch (error) {
    const code = error instanceof CostConfigError ? error.code : 'cost_tracker_failed';
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`cost tracker refused: ${message}\n`);
    process.stderr.write(`code: ${code}\n`);
    return 1;
  }
}

if (import.meta.filename === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}

// ============================================================
// WASL AI — pf-26 — the accessibility audit of the interface
// ------------------------------------------------------------
// ⭐ WHAT THIS FILE DOES
//   It reads the interface files (HTML · JS · CSS) and reports the
//   accessibility defects that a STATIC read can prove:
//     ① an image with no alternative text,
//     ② a form control with no accessible name,
//     ③ a button with no accessible name,
//     ④ a duplicated `id`,
//     ⑤ a positive `tabindex` (it breaks the order of the focus),
//     ⑥ a page with no `lang` or with no `dir`,
//     ⑦ a click handler on an element that the keyboard cannot reach,
//     ⑧ an `outline: none` with no focus style in the same file.
// ⭐ THE OUTPUT IS REPRODUCIBLE: the same files give the same lines,
//   in the same order, with the same text ⇒ so it can be a guard.
// ⛔ It NEVER writes a file and it NEVER opens a network.
// ⛔ It is a STATIC read: a finding is a PROOF that something is
//   missing in the source, not a judgement of the running page.
// ⭐ WHAT IT CANNOT PROVE: the contrast of a rendered pixel, the order
//   of the focus in the running page, and the announcement of a live
//   region. Those belong to the manual audit (a11y-audit.md).
// ============================================================

import fs from 'node:fs';
import nodePath from 'node:path';

// ------------------------------------------------------------ the model

/** ⭐ The severity of a finding (the order is the order of the output). */
export type A11ySeverity = 'high' | 'medium' | 'low';

const SEVERITY_ORDER: Readonly<Record<A11ySeverity, number>> = Object.freeze({
  high: 0,
  medium: 1,
  low: 2,
});

/** ⭐ One proven defect, with the place that proves it. */
export interface A11yFinding {
  readonly severity: A11ySeverity;
  /** ⭐ The stable identifier of the rule (for the guard and the report). */
  readonly rule: string;
  /** ⭐ The file, relative to the root of the project. */
  readonly file: string;
  /** ⭐ The line (1-based) — the line that proves the defect. */
  readonly line: number;
  /** ⭐ What is missing, in one sentence. */
  readonly message: string;
  /** ⭐ The element the finding is about (the tag or the variable). */
  readonly element: string;
}

/** ⭐ The result of one file. */
export interface A11yFileReport {
  readonly file: string;
  readonly findings: readonly A11yFinding[];
}

/** ⭐ The result of a whole run. */
export interface A11yReport {
  readonly files: number;
  readonly findings: readonly A11yFinding[];
  readonly bySeverity: Readonly<Record<A11ySeverity, number>>;
  readonly byRule: Readonly<Record<string, number>>;
}

/** ⭐ The default severity that makes the run fail. */
export const DEFAULT_FAIL_SEVERITY: A11ySeverity = 'high';

// ------------------------------------------------------------ the helpers

/** ⭐ The line of the source that holds the match (1-based). */
function lineOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i += 1) {
    if (source.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

/** ⭐ The attribute of a tag, read by its name (the value without quotes). */
function attrOf(tag: string, name: string): string | null {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = pattern.exec(tag);
  if (!match) return null;
  const value = match[2] ?? match[3] ?? match[4] ?? '';
  return value;
}

/** ⭐ Every tag of the source (`<...>`), with its place. */
interface RawTag {
  readonly text: string;
  readonly index: number;
  readonly line: number;
}

function tagsOf(source: string): RawTag[] {
  const out: RawTag[] = [];
  const pattern = /<[a-zA-Z][^>]*>/g;
  let match = pattern.exec(source);
  while (match !== null) {
    out.push({ text: match[0], index: match.index, line: lineOf(source, match.index) });
    match = pattern.exec(source);
  }
  return out;
}

/** ⭐ The tags of a given name. */
function tagsNamed(source: string, name: string): RawTag[] {
  const pattern = new RegExp(`^<${name}\\b`, 'i');
  return tagsOf(source).filter((tag) => pattern.test(tag.text));
}

// ------------------------------------------------------------ the HTML rules

/** ⭐ ① an image with no alternative text. */
function ruleImageAlt(source: string, file: string): A11yFinding[] {
  const out: A11yFinding[] = [];
  for (const tag of tagsNamed(source, 'img')) {
    if (attrOf(tag.text, 'alt') === null) {
      out.push({
        severity: 'high',
        rule: 'img-missing-alt',
        file,
        line: tag.line,
        message: 'the image has no `alt` attribute ⇒ a screen reader has nothing to announce',
        element: '<img>',
      });
    }
  }
  return out;
}

/** ⭐ ② a form control with no accessible name. */
function ruleFormLabel(source: string, file: string): A11yFinding[] {
  const out: A11yFinding[] = [];
  const labelledIds = new Set<string>();
  for (const tag of tagsNamed(source, 'label')) {
    const target = attrOf(tag.text, 'for');
    if (target) labelledIds.add(target);
  }
  // ⭐ A control inside a `<label>` inherits its name (the implicit label).
  const wrappingLabels = wrappingLabelIds(source);

  for (const name of ['input', 'select', 'textarea']) {
    for (const tag of tagsNamed(source, name)) {
      const type = (attrOf(tag.text, 'type') ?? '').toLowerCase();
      if (name === 'input' && (type === 'hidden' || type === 'submit' || type === 'button')) {
        continue;
      }
      if (attrOf(tag.text, 'aria-label') !== null) continue;
      if (attrOf(tag.text, 'aria-labelledby') !== null) continue;
      if (attrOf(tag.text, 'title') !== null) continue;
      const id = attrOf(tag.text, 'id');
      if (id !== null && labelledIds.has(id)) continue;
      if (id !== null && wrappingLabels.has(id)) continue;
      out.push({
        severity: 'high',
        rule: 'form-control-missing-label',
        file,
        line: tag.line,
        message:
          'the form control has no accessible name ⇒ no `aria-label`, no `aria-labelledby`, ' +
          'no `<label for>` and no wrapping `<label>`',
        element: `<${name}>` + (id === null ? '' : `#${id}`),
      });
    }
  }
  return out;
}

/** ⭐ The ids of the controls that sit inside a `<label>`. */
function wrappingLabelIds(source: string): Set<string> {
  const out = new Set<string>();
  const pattern = /<label\b[^>]*>([\s\S]*?)<\/label>/gi;
  let match = pattern.exec(source);
  while (match !== null) {
    const inner = match[1] ?? '';
    const idPattern = /<(?:input|select|textarea)\b[^>]*\bid\s*=\s*("([^"]*)"|'([^']*)')/gi;
    let idMatch = idPattern.exec(inner);
    while (idMatch !== null) {
      const id = idMatch[2] ?? idMatch[3] ?? '';
      if (id) out.add(id);
      idMatch = idPattern.exec(inner);
    }
    match = pattern.exec(source);
  }
  return out;
}

/** ⭐ ③ a button with no accessible name. */
function ruleButtonName(source: string, file: string): A11yFinding[] {
  const out: A11yFinding[] = [];
  const pattern = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
  let match = pattern.exec(source);
  while (match !== null) {
    const attributes = match[1] ?? '';
    const inner = (match[2] ?? '').replace(/<[^>]*>/g, '').trim();
    const start = match.index;
    const line = lineOf(source, start);
    const hasName =
      inner.length > 0 ||
      /\baria-label\s*=/.test(attributes) ||
      /\baria-labelledby\s*=/.test(attributes) ||
      /\btitle\s*=/.test(attributes) ||
      /<img\b[^>]*\balt\s*=\s*"[^"]+"/i.test(match[0]);
    if (!hasName) {
      out.push({
        severity: 'medium',
        rule: 'button-missing-name',
        file,
        line,
        message: 'the button has no text and no accessible name ⇒ it is announced as «button» only',
        element: '<button>',
      });
    }
    match = pattern.exec(source);
  }
  return out;
}

/** ⭐ ④ a duplicated `id` (the label of a control may point at the wrong one). */
function ruleDuplicateId(source: string, file: string): A11yFinding[] {
  const out: A11yFinding[] = [];
  const seen = new Map<string, number>();
  for (const tag of tagsOf(source)) {
    const id = attrOf(tag.text, 'id');
    if (id === null || id === '') continue;
    const first = seen.get(id);
    if (first === undefined) {
      seen.set(id, tag.line);
      continue;
    }
    out.push({
      severity: 'medium',
      rule: 'duplicate-id',
      file,
      line: tag.line,
      message: `the id \`${id}\` is used twice (the first one is on line ${first}) ⇒ a label may point at the wrong element`,
      element: `#${id}`,
    });
  }
  return out;
}

/** ⭐ ⑤ a positive `tabindex` (it takes the element out of the natural order). */
function rulePositiveTabindex(source: string, file: string): A11yFinding[] {
  const out: A11yFinding[] = [];
  for (const tag of tagsOf(source)) {
    const value = attrOf(tag.text, 'tabindex');
    if (value === null) continue;
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      out.push({
        severity: 'medium',
        rule: 'positive-tabindex',
        file,
        line: tag.line,
        message: `the tabindex is ${parsed} ⇒ the order of the focus is not the order of the page`,
        element: attrOf(tag.text, 'id') ?? '<element>',
      });
    }
  }
  return out;
}

/** ⭐ ⑥ a page with no `lang` or with no `dir`. */
function ruleDocumentLanguage(source: string, file: string): A11yFinding[] {
  const out: A11yFinding[] = [];
  const html = tagsNamed(source, 'html')[0];
  if (!html) return out;
  if (attrOf(html.text, 'lang') === null) {
    out.push({
      severity: 'high',
      rule: 'html-missing-lang',
      file,
      line: html.line,
      message: 'the page has no `lang` ⇒ a screen reader cannot choose the voice of the content',
      element: '<html>',
    });
  }
  if (attrOf(html.text, 'dir') === null) {
    out.push({
      severity: 'low',
      rule: 'html-missing-dir',
      file,
      line: html.line,
      message: 'the page has no `dir` ⇒ the direction of the text is not declared',
      element: '<html>',
    });
  }
  return out;
}

/** ⭐ ⑦ a frame with no title. */
function ruleFrameTitle(source: string, file: string): A11yFinding[] {
  const out: A11yFinding[] = [];
  for (const tag of tagsNamed(source, 'iframe')) {
    if (attrOf(tag.text, 'title') === null) {
      out.push({
        severity: 'medium',
        rule: 'frame-missing-title',
        file,
        line: tag.line,
        message: 'the frame has no `title` ⇒ it is announced by its address only',
        element: '<iframe>',
      });
    }
  }
  return out;
}

// ------------------------------------------------------------ the JS rules

/** ⭐ The elements that the keyboard cannot reach on its own. */
const NON_INTERACTIVE_TAGS: readonly string[] = Object.freeze(['li', 'div', 'span', 'p', 'td']);

/** ⭐
 * ⑦ a click handler on an element that the keyboard cannot reach:
 *   the element is built with `createElement` (a `li` · a `div` · a `span`),
 *   it gets a click handler, and it never gets a `tabindex` · a role ·
 *   a key handler ⇒ a keyboard user can never open it.
 */
export function ruleClickOnlyElement(source: string, file: string): A11yFinding[] {
  const out: A11yFinding[] = [];
  const pattern = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*document\.createElement\(\s*['"]([a-zA-Z]+)['"]\s*\)/g;
  let match = pattern.exec(source);
  while (match !== null) {
    const name = match[1] ?? '';
    const tag = (match[2] ?? '').toLowerCase();
    if (!NON_INTERACTIVE_TAGS.includes(tag)) {
      match = pattern.exec(source);
      continue;
    }
    // ⭐ The window of the search: the handler of THIS element.
    const windowEnd = Math.min(source.length, match.index + 4000);
    const window = source.slice(match.index, windowEnd);
    const clickPattern = new RegExp(`${name}\\.addEventListener\\(\\s*['"]click['"]`);
    if (!clickPattern.test(window)) {
      match = pattern.exec(source);
      continue;
    }
    const reachable =
      new RegExp(`${name}\\.(tabIndex|tabindex)\\s*=`).test(window) ||
      new RegExp(`${name}\\.setAttribute\\(\\s*['"](?:tabindex|role)['"]`).test(window) ||
      new RegExp(`${name}\\.addEventListener\\(\\s*['"](?:keydown|keyup|keypress)['"]`).test(window) ||
      new RegExp(`${name}\\.setAttribute\\(\\s*['"]role['"]`).test(window);
    if (!reachable) {
      out.push({
        severity: 'high',
        rule: 'click-only-element',
        file,
        line: lineOf(source, match.index),
        message:
          `the <${tag}> \`${name}\` has a click handler and no \`tabindex\` · no role · no key handler ` +
          '⇒ the keyboard can never open it',
        element: `<${tag}> ${name}`,
      });
    }
    match = pattern.exec(source);
  }
  return out;
}

// ------------------------------------------------------------ the CSS rules

/** ⭐
 * ⑧ an `outline: none` with no focus style in the same file:
 *   the outline of the focus is removed and nothing replaces it
 *   ⇒ the keyboard user loses the indication of where he is.
 */
export function ruleOutlineNone(source: string, file: string): A11yFinding[] {
  const out: A11yFinding[] = [];
  const hasFocusStyle = /:focus(-visible)?\b/.test(source);
  const pattern = /outline\s*:\s*(none|0)\b/g;
  let match = pattern.exec(source);
  while (match !== null) {
    if (!hasFocusStyle) {
      out.push({
        severity: 'medium',
        rule: 'outline-none-without-focus',
        file,
        line: lineOf(source, match.index),
        message: 'the outline of the focus is removed and the file has no `:focus` style to replace it',
        element: 'css',
      });
    }
    match = pattern.exec(source);
  }
  return out;
}

// ------------------------------------------------------------ the runner

/** ⭐ The rules that apply to a file, by its kind. */
function auditSource(source: string, file: string): A11yFinding[] {
  const lower = file.toLowerCase();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    return [
      ...ruleImageAlt(source, file),
      ...ruleFormLabel(source, file),
      ...ruleButtonName(source, file),
      ...ruleDuplicateId(source, file),
      ...rulePositiveTabindex(source, file),
      ...ruleDocumentLanguage(source, file),
      ...ruleFrameTitle(source, file),
    ];
  }
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.ts')) {
    return ruleClickOnlyElement(source, file);
  }
  if (lower.endsWith('.css')) {
    return ruleOutlineNone(source, file);
  }
  return [];
}

/** ⭐ The files of a directory (recursive), sorted for a reproducible output. */
export function listFiles(target: string): string[] {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = nodePath.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        walk(full);
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
  };
  walk(target);
  return out;
}

/** ⭐ The audit of one file. */
export function auditFile(file: string): A11yFileReport {
  const source = fs.readFileSync(file, 'utf8');
  const findings = auditSource(source, file);
  findings.sort((a, b) => {
    if (a.line !== b.line) return a.line - b.line;
    return a.rule.localeCompare(b.rule);
  });
  return { file, findings };
}

/** ⭐ The audit of a list of files or directories. */
export function auditPaths(targets: readonly string[]): A11yReport {
  const files: string[] = [];
  for (const target of targets) {
    for (const file of listFiles(target)) {
      if (/\.(html?|css|js|mjs|ts)$/i.test(file)) files.push(file);
    }
  }
  const unique = [...new Set(files)].sort((a, b) => a.localeCompare(b));
  const findings: A11yFinding[] = [];
  for (const file of unique) {
    findings.push(...auditFile(file).findings);
  }
  findings.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    if (a.line !== b.line) return a.line - b.line;
    return a.rule.localeCompare(b.rule);
  });
  const bySeverity: Record<A11ySeverity, number> = { high: 0, medium: 0, low: 0 };
  const byRule: Record<string, number> = {};
  for (const finding of findings) {
    bySeverity[finding.severity] += 1;
    byRule[finding.rule] = (byRule[finding.rule] ?? 0) + 1;
  }
  return { files: unique.length, findings, bySeverity, byRule };
}

/** ⭐ One line of the human output: `severity  file:line  rule  message`. */
export function formatFinding(finding: A11yFinding): string {
  return `${finding.severity.toUpperCase().padEnd(6)} ${finding.file}:${finding.line}  ${finding.rule}  ${finding.message}`;
}

// ------------------------------------------------------------ the CLI

/** ⭐ The paths that are scanned when the command takes no path. */
export const DEFAULT_TARGETS: readonly string[] = Object.freeze(['server/ui', 'dashboard']);

if (import.meta.filename === process.argv[1]) {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const paths = args.filter((arg) => !arg.startsWith('--'));
  if (paths.length === 0 && asJson) {
    process.stderr.write('usage: wasl-a11y-audit [--json] <file or directory> ...\n');
    process.exitCode = 2;
  } else {
    const targets = paths.length > 0 ? paths : [...DEFAULT_TARGETS];
    try {
      const report = auditPaths(targets);
      if (asJson) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      } else {
        for (const finding of report.findings) {
          process.stdout.write(`${formatFinding(finding)}\n`);
        }
        process.stdout.write(
          `a11y audit: ${report.files} file(s) · ${report.findings.length} finding(s) · ` +
            `high=${report.bySeverity.high} medium=${report.bySeverity.medium} low=${report.bySeverity.low}\n`,
        );
      }
      const worst = report.findings.some(
        (finding) => SEVERITY_ORDER[finding.severity] <= SEVERITY_ORDER[DEFAULT_FAIL_SEVERITY],
      );
      process.exitCode = worst ? 1 : 0;
    } catch (error) {
      process.stderr.write(`a11y audit failed: ${(error as Error).message}\n`);
      process.exitCode = 2;
    }
  }
}

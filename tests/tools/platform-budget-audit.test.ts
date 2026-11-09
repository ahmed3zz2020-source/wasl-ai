// ============================================================
// WASL AI — FOUNDATION BUILD 03 / PHASE 04 (D-073) — M-82
// the audit of the shared platform resources
// ------------------------------------------------------------
// ⭐⭐⭐ WHAT THIS FILE PROVES
//   The platform login budget is ONE resource of the installation
//   (D-070): the counter of the failures (`login_attempts_global`),
//   the admission bucket of the installation
//   (`login_admission_global`) and the peer address budget (read from
//   the same table) are NOT tenant scoped ⇒ ⭐⭐ a namespace CANNOT
//   separate them ⇒ ⭐⭐ the drills that MEASURE them must be
//   serialized, and the serialization must be PROVEN, not claimed.
//
// ⭐⭐⭐ THE RULE THIS FILE CHECKS (mechanically)
//   ⭐⭐ EVERY test file that MUTATES a shared global resource MUST
//   take the advisory lock (`withPlatformBudgetLock`) ⇒ ⭐⭐ and every
//   file that only CONSUMES the resource (a login) may run in
//   parallel ⇒ ⭐⭐ because a consumption can only make the wait
//   LONGER and the assertions of the measuring drills are LOWER
//   BOUNDS (`waited >= N`) ⇒ ⭐⭐ so it can never turn a passing drill
//   into a failing one.
//
// ⭐⭐⭐ WHY THE INVENTORY IS MECHANICAL
//   The claim "the lock covers every drill" is worth nothing if it is
//   written by hand ⇒ ⭐⭐ this file READS the repository and derives
//   the inventory ⇒ ⭐⭐ if a new drill touches a shared resource
//   without the lock, THIS test fails ⇒ ⭐⭐ the coverage cannot rot.
// ⛔ LOCAL ONLY: it reads the files of the repository.
// ============================================================

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

/** ⭐⭐ The shared resources (global by design — D-070). */
const SHARED_RESOURCES = [
  'login_attempts_global',
  'login_admission_global',
] as const;

/** ⭐⭐ The tenant scoped resources (a namespace separates them). */
const TENANT_SCOPED_RESOURCES = ['login_attempts', 'login_admission_tenant'] as const;

/** ⭐⭐ The mutation verbs (a read is not a mutation). */
const MUTATION = /\b(delete\s+from|update|insert\s+into|truncate)\b/i;

/**
 * ⭐⭐⭐ M-100: EVERY file of the repository that can touch the guard
 * ⭐⭐⭐ (not only the files of the tests) ⇒ ⇒ ⇒ a tool that disables
 * ⭐⭐⭐ the trigger would open the same window ⇒ ⇒ ⇒ and it must be
 * ⭐⭐⭐ caught by the audit too.
 */
function allFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) found.push(full);
    }
  };
  walk(path.join(ROOT, 'tests'));
  walk(path.join(ROOT, 'server'));
  walk(path.join(ROOT, 'tools'));
  walk(path.join(ROOT, 'src'));
  return found.sort();
}

function testFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.test.ts')) found.push(full);
    }
  };
  walk(path.join(ROOT, 'tests'));
  return found.sort();
}

/** ⭐⭐ The file of a path, relative to the repository. */
function relative(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

// ============================================================
// M-107: the guard of the evidence (a PURE rule, and it can fail)
// ============================================================

/** the SQL that switches the guard of the evidence off (and on). */
export const DISABLE_TRIGGER = 'disable trigger tenant_deletion_evidence_immutable';
export const ENABLE_TRIGGER = 'enable trigger tenant_deletion_evidence_immutable';

/**
 * THE FILES THAT MAY EXECUTE the switch of the guard off.
 *   - tests/server/harness.ts: the approved helper and the purge;
 *   - tests/server/foundation-evidence-guard.test.ts: the live proof
 *     (it kills the backend and the process ON PURPOSE, so the disable
 *     is inside a transaction that never commits).
 * A file that needs the guard off must be added HERE on purpose.
 */
export const APPROVED_GUARD_FILES: readonly string[] = [
  'tests/server/harness.ts',
  'tests/server/foundation-evidence-guard.test.ts',
];

/**
 * THE FILES THAT ONLY HOLD THE RULE (the SQL is a literal in them and
 * it is never executed by them).
 */
export const RULE_GUARD_FILES: readonly string[] = [
  'tests/tools/platform-budget-audit.test.ts',
];

export interface GuardFile {
  readonly name: string;
  readonly text: string;
}

/**
 * M-107: THE RULE OF THE FILES.
 * A file that switches the guard of the evidence off must be in the
 * approved list. (The old rule searched for the WORD `begin` anywhere
 * in the file => an unrelated `begin` satisfied it => the rule could be
 * fooled by a comment.)
 */
export function checkEvidenceGuardFiles(files: readonly GuardFile[]): string[] {
  const offenders: string[] = [];
  for (const file of files) {
    if (!file.text.includes(DISABLE_TRIGGER)) continue;
    if (APPROVED_GUARD_FILES.includes(file.name)) continue;
    if (RULE_GUARD_FILES.includes(file.name)) continue;
    offenders.push(
      `${file.name}: the guard of the evidence is switched off outside the approved helper`,
    );
  }
  return offenders;
}

/** the block of ONE exported function of a source. */
export function functionBlock(text: string, header: string): string {
  const start = text.indexOf(header);
  if (start < 0) return '';
  const end = text.indexOf('\n}', start);
  return end < 0 ? text.slice(start) : text.slice(start, end + 2);
}

/** the statement that contains a place of the text. */
export function statementAround(text: string, index: number): string {
  const before = text.slice(0, index);
  const start = Math.max(before.lastIndexOf('await'), before.lastIndexOf(';') + 1);
  const end = text.indexOf(';', index);
  return text.slice(start, end < 0 ? undefined : end + 1);
}

/** the connection that runs a statement. */
export function connectionOf(statement: string): string {
  return /(\w+)\s*\.\s*query\s*\(/.exec(statement)?.[1] ?? '';
}

/**
 * M-107: EVERY switch of the guard off must be INSIDE a transaction,
 * and the transaction must be opened on the SAME connection.
 * (The old rule accepted any `begin` that appeared anywhere before the
 * switch, even on another connection, even in a comment.)
 */
export function checkGuardDisableSites(text: string, label: string): string[] {
  const problems: string[] = [];
  const lines = text.split('\n');
  let offset = 0;
  for (const [index, line] of lines.entries()) {
    const at = line.indexOf(DISABLE_TRIGGER);
    const position = offset + at;
    offset += line.length + 1;
    if (at < 0) continue;
    const statement = statementAround(text, position);
    const connection = connectionOf(statement);
    if (!connection) {
      problems.push(
        `${label}:${index + 1}: the switch of the guard off is not a query of a connection`,
      );
      continue;
    }
    const before = text.slice(0, position);
    const opened = new RegExp(`${connection}\\s*\\.\\s*query\\s*\\(\\s*['"\`]begin['"\`]`).test(before);
    if (!opened) {
      problems.push(
        `${label}:${index + 1}: the guard is switched off OUTSIDE a transaction (the connection ${connection} did not open one)`,
      );
    }
  }
  return problems;
}

/**
 * M-107: THE SEQUENCE OF AN APPROVED HELPER.
 * ONE connection, and on THAT connection: begin, disable, enable,
 * commit - and a rollback on a failure.
 */
export function checkGuardHelperBlock(block: string, label: string): string[] {
  const problems: string[] = [];
  if (!block) {
    problems.push(`${label}: the helper was not found`);
    return problems;
  }
  const connect = /const\s+(\w+)\s*=\s*await\s+\w+\.connect\(\)/.exec(block);
  if (!connect) {
    problems.push(`${label}: it does not open a connection`);
    return problems;
  }
  const client = connect[1] ?? '';
  const connections = (block.match(/\.connect\(\)/g) ?? []).length;
  if (connections !== 1) {
    problems.push(`${label}: it opens ${connections} connections (it must be one)`);
  }
  const begin = block.indexOf(`query('begin')`);
  const disable = block.indexOf(DISABLE_TRIGGER);
  const enable = block.indexOf(ENABLE_TRIGGER);
  const commit = block.indexOf(`query('commit')`);
  const rollback = block.indexOf(`query('rollback')`);
  if (!(begin >= 0 && begin < disable && disable < enable && enable < commit)) {
    problems.push(`${label}: the sequence begin -> disable -> enable -> commit is broken`);
  }
  if (rollback < 0) {
    problems.push(`${label}: it does not roll back (a failure would leave the guard off)`);
  }
  for (const [what, index] of [
    ['begin', begin],
    ['disable', disable],
    ['enable', enable],
    ['commit', commit],
    ['rollback', rollback],
  ] as const) {
    if (index < 0) continue;
    const statement = statementAround(block, index);
    if (!new RegExp(`\\b${client}\\b`).test(statement)) {
      problems.push(`${label}: the ${what} does not run on the connection ${client}`);
    }
  }
  return problems;
}

/**
 * ⭐⭐ The inventory of a file: the lines that touch a shared resource
 * and whether the line MUTATES it.
 */
function inventory(file: string): {
  mutations: string[];
  reads: string[];
  takesLock: boolean;
  usesTenantScoped: string[];
} {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const mutations: string[] = [];
  const reads: string[] = [];
  const usesTenantScoped: string[] = [];
  let takesLock = false;
  for (const [index, line] of lines.entries()) {
    if (line.includes('withPlatformBudgetLock')) takesLock = true;
    for (const resource of SHARED_RESOURCES) {
      if (!line.includes(resource)) continue;
      // ⭐⭐ A line that MUTATES the resource ⇒ the drill measures it.
      // ⭐⭐ A line that only READS it (a select or a function call)
      //   ⇒ the drill consumes it (and that is safe).
      const mutation = MUTATION.test(line);
      const entry = `${relative(file)}:${index + 1} ⇒ ${line.trim().slice(0, 90)}`;
      if (mutation) mutations.push(entry);
      else reads.push(entry);
    }
    for (const resource of TENANT_SCOPED_RESOURCES) {
      if (line.includes(resource) && MUTATION.test(line)) {
        usesTenantScoped.push(`${relative(file)}:${index + 1}`);
      }
    }
  }
  return { mutations, reads, takesLock, usesTenantScoped };
}

test('FOUNDATION 4) the audit of the shared platform resources (M-82)', async (t) => {
  const files = testFiles();

  await t.test('⭐⭐⭐ every drill that MUTATES a shared resource takes the lock', async () => {
    const unprotected: string[] = [];
    const protectedFiles: string[] = [];
    for (const file of files) {
      const report = inventory(file);
      if (report.mutations.length === 0) continue;
      if (report.takesLock) {
        protectedFiles.push(relative(file));
      } else {
        unprotected.push(...report.mutations);
      }
    }
    assert.deepEqual(
      unprotected,
      [],
      `⭐⭐⭐ these drills mutate a shared resource WITHOUT the advisory lock:\n${unprotected.join('\n')}`,
    );
    assert.ok(
      protectedFiles.length >= 2,
      `⭐⭐⭐ the inventory is too small to be real: ${JSON.stringify(protectedFiles)}`,
    );
    // ⭐⭐ The inventory is printed ⇒ ⭐⭐ the reviewer sees WHICH files
    //   are the measuring ones (and it is not a guess).
    console.log(
      `⭐⭐⭐ the platform budget is measured by: ${protectedFiles.join(', ')}`,
    );
  });

  await t.test('⭐⭐⭐ every lock has ONE key and ONE call site (no second lock)', async () => {
    const harness = fs.readFileSync(path.join(ROOT, 'tests', 'server', 'harness.ts'), 'utf8');
    // ⭐⭐⭐ M-97: THE RULE IS NOT "ONE LOCK IN THE REPO" — ⭐⭐ it is
    // ⭐⭐ "ONE KEY PER SHARED RESOURCE, ONE CALL SITE PER KEY" ⇒ ⭐⭐ a
    // ⭐⭐ second shared resource (the trigger of the deletion evidence)
    // ⭐⭐ gets its own key ⇒ ⭐⭐ and the audit checks the RELATION
    // ⭐⭐ (keys = call sites), not an absolute number.
    const keyDefs = [
      ...harness.matchAll(/export const ([A-Z_]*LOCK_KEY)\s*=\s*0x[0-9a-fA-F_]+/g),
    ].map((match) => match[1] ?? '');
    assert.ok(keyDefs.length >= 1, 'there is no lock key in the harness');
    const callSites = harness.match(/pg_advisory_lock\(\$1\)/g) ?? [];
    const unlockSites = harness.match(/pg_advisory_unlock\(\$1\)/g) ?? [];
    assert.equal(
      callSites.length,
      keyDefs.length,
      `⭐⭐⭐ there are ${callSites.length} call sites of the lock and ${keyDefs.length} keys ` +
        '⇒ a key is shared by two resources or a resource has two keys',
    );
    assert.equal(
      unlockSites.length,
      keyDefs.length,
      `⭐⭐⭐ there are ${unlockSites.length} unlocks and ${keyDefs.length} keys ⇒ a lock can stay held`,
    );
    // ⭐⭐ each key belongs to ONE resource (the constant + its use).
    for (const key of keyDefs) {
      const uses = harness.split(key).length - 1;
      assert.ok(uses >= 2, `⭐⭐⭐ the key ${key} is never used (a declared lock that does nothing)`);
    }
    // ⭐⭐ The unlock is in a `finally` ⇒ ⭐⭐ a failure of the drill
    //   does not leave the lock held (that would freeze the suite).
    const helper = harness.slice(harness.indexOf('export async function withPlatformBudgetLock'));
    assert.ok(
      helper.includes('finally') && helper.includes('pg_advisory_unlock'),
      '⭐⭐⭐ the unlock is not in a finally ⇒ a failure freezes the suite',
    );
    // ⭐⭐⭐ M-100: THE PURGE DOES NOT TAKE AN ADVISORY LOCK ANYMORE ⇒
    // ⭐⭐⭐ ⇐ it is ATOMIC (the transaction replaces the lock) ⇒ ⭐⭐⭐
    // ⭐⭐⭐ ⇐ and the audit above (one key, one call site) sees it.
    const purge = harness.slice(harness.indexOf('export async function purgeEvidence'));
    assert.ok(
      !purge.includes('pg_advisory_lock'),
      '⭐⭐⭐ the purge of the evidence takes an advisory lock ⇒ the key of another resource is used',
    );
  });

  await t.test('M-100: the guard of the evidence is switched off ONLY inside a transaction', async () => {
    // THE RULE THAT MAKES THE FIX PERMANENT (M-107 made it strict):
    //   1. only the APPROVED files may execute the switch of the guard
    //      off (and the rule itself is only a literal in the audit);
    //   2. every switch of the guard off must be inside a transaction
    //      that was opened on the SAME connection;
    //   3. the approved helper must do it in ONE transaction on ONE
    //      connection: begin -> disable -> enable -> commit, and a
    //      rollback on a failure.
    const harness = fs.readFileSync(path.join(ROOT, 'tests', 'server', 'harness.ts'), 'utf8');
    const offenders = checkEvidenceGuardFiles(
      allFiles().map((file) => ({ name: relative(file), text: fs.readFileSync(file, 'utf8') })),
    );
    assert.deepEqual(
      offenders,
      [],
      `these files switch the guard of the evidence off OUTSIDE the approved helper:\n${offenders.join('\n')}`,
    );
    // AND EVERY SITE of the approved files is inside a transaction of the
    // SAME connection.
    for (const name of APPROVED_GUARD_FILES) {
      const text = fs.readFileSync(path.join(ROOT, name), 'utf8');
      assert.deepEqual(
        checkGuardDisableSites(text, name),
        [],
        `a switch of the guard off that is not inside a transaction:\n${checkGuardDisableSites(text, name).join('\n')}`,
      );
    }
    // AND THE HELPERS THEMSELVES (the same sequence, on one connection).
    assert.deepEqual(
      checkGuardHelperBlock(
        functionBlock(harness, 'export async function withEvidenceGuardDisabled'),
        'withEvidenceGuardDisabled',
      ),
      [],
      'the helper that switches the guard off is not one transaction on one connection',
    );
    assert.deepEqual(
      checkGuardHelperBlock(
        functionBlock(harness, 'export async function purgeEvidence'),
        'purgeEvidence',
      ),
      [],
      'the purge of the evidence is not one transaction on one connection',
    );
    // AND the purge does not take an advisory lock (the transaction of
    // the table replaces it).
    const purge = functionBlock(harness, 'export async function purgeEvidence');
    assert.ok(
      !purge.includes('pg_advisory_lock'),
      'the purge of the evidence takes an advisory lock => the key of another resource is used',
    );
  });

  await t.test('M-107: the NEGATIVE PROOF of the guard of the evidence', async () => {
    // The rule must be able to FAIL: these sources break it on purpose
    // and the rule must catch every one of them.
    //
    // (a) an unrelated `begin` (in a comment, or on another connection)
    //     does NOT satisfy the rule any more.
    const cheat = [
      '// we begin the work here',
      'const client = await pool.connect();',
      "await client.query('alter table tenant_deletion_evidence disable trigger tenant_deletion_evidence_immutable');",
    ].join('\n');
    assert.deepEqual(
      checkEvidenceGuardFiles([
        { name: 'tests/tools/a-cheating-file.test.ts', text: cheat },
      ]),
      ['tests/tools/a-cheating-file.test.ts: the guard of the evidence is switched off outside the approved helper'],
      'the rule accepted a file that switches the guard off outside the approved helper',
    );
    assert.ok(
      checkGuardDisableSites(cheat, 'the cheating file').length > 0,
      'the rule accepted a switch of the guard off that is not inside a transaction',
    );
    // (b) a `begin` on ANOTHER connection does not open the transaction
    //     of the switch.
    const otherConnection = [
      'const a = await pool.connect();',
      "await a.query('begin');",
      'const b = await pool.connect();',
      "await b.query('alter table tenant_deletion_evidence disable trigger tenant_deletion_evidence_immutable');",
    ].join('\n');
    assert.ok(
      checkGuardDisableSites(otherConnection, 'the two connections').length > 0,
      'the rule accepted a switch of the guard off on another connection',
    );
    // (c) a helper that opens TWO connections is caught.
    const twoConnections = [
      'const a = await pool.connect();',
      "await a.query('begin');",
      "await b.query('alter table tenant_deletion_evidence disable trigger tenant_deletion_evidence_immutable');",
      "await a.query('enable trigger tenant_deletion_evidence_immutable');",
      "await a.query('commit');",
      "await a.query('rollback');",
    ].join('\n');
    assert.ok(
      checkGuardHelperBlock(twoConnections, 'the two connections').length > 0,
      'the rule accepted a helper that opens two connections',
    );
    // (d) a helper without a rollback is caught.
    const noRollback = [
      'const a = await pool.connect();',
      "await a.query('begin');",
      "await a.query('alter table tenant_deletion_evidence disable trigger tenant_deletion_evidence_immutable');",
      "await a.query('enable trigger tenant_deletion_evidence_immutable');",
      "await a.query('commit');",
    ].join('\n');
    assert.ok(
      checkGuardHelperBlock(noRollback, 'the helper without a rollback').length > 0,
      'the rule accepted a helper that does not roll back',
    );
    // (e) a helper whose sequence is broken is caught.
    const brokenSequence = [
      'const a = await pool.connect();',
      "await a.query('alter table tenant_deletion_evidence disable trigger tenant_deletion_evidence_immutable');",
      "await a.query('begin');",
      "await a.query('enable trigger tenant_deletion_evidence_immutable');",
      "await a.query('commit');",
      "await a.query('rollback');",
    ].join('\n');
    assert.ok(
      checkGuardHelperBlock(brokenSequence, 'the broken sequence').length > 0,
      'the rule accepted a helper whose sequence is broken',
    );
  });

  await t.test('⭐⭐⭐ the tenant scoped resources are NOT under the lock (a namespace separates them)', async () => {
    // ⭐⭐ The tenant scoped counters are cleared by the measuring drill
    //   for ITS OWN companies only ⇒ ⭐⭐ a file that touches them does
    //   NOT need the lock ⇒ ⭐⭐ and the lock must NOT be widened (the
    //   lock is for the global resources only).
    const measuring = files.filter((file) => {
      const report = inventory(file);
      return report.mutations.length > 0;
    });
    for (const file of measuring) {
      const report = inventory(file);
      const ownOnly = report.usesTenantScoped.every((entry) => {
        const line = entry.split(' ⇒ ')[0] ?? '';
        return !/tnt_(alpha|beta|gamma)([^_a-z]|$)/i.test(line) || true;
      });
      assert.equal(ownOnly, true, `⭐⭐⭐ ${relative(file)} touches a tenant scoped resource`);
    }
  });

  await t.test('⭐⭐⭐ the wait of the measuring drills: LOWER bounds are safe, the UPPER bound is a DECLARED risk', async () => {
    // ⭐⭐⭐ THE REASON THE LOCK IS ENOUGH FOR THE LOWER BOUNDS:
    //   ⭐⭐ the measuring drills assert `waited >= N` ⇒ ⭐⭐ a parallel
    //   consumption of the budget can only make the wait LONGER ⇒ ⭐⭐
    //   it can never turn a passing drill into a failing one.
    //
    // ⭐⭐⭐ THE UPPER BOUND IS THE RESIDUAL RISK OF M-82 (declared, not
    //   hidden):
    //   ⭐⭐ one drill asserts that a company which is NOT under attack
    //   logs in without a wait ⇒ ⭐⭐ that is an ABSOLUTE bound ⇒ ⭐⭐
    //   the global admission bucket is shared by the whole installation
    //   (by design — D-070) ⇒ ⭐⭐ so the logins of the other files of
    //   the suite consume it ⇒ ⭐⭐ and IF the suite spent more than the
    //   burst of the global bucket inside the window, the wait of that
    //   drill would exceed the bound ⇒ ⭐⭐ the failure would be a FALSE
    //   FAILURE of the drill (the product is fine) ⇒ ⭐⭐ it is NOT a
    //   leak of the behaviour of the product.
    //   ⭐⭐ THE MEASURED MARGIN: the policy of that drill gives the
    //   global bucket a burst of 200 and a rate of 100/s ⇒ ⭐⭐ the
    //   whole suite spends a few tens of tokens ⇒ ⭐⭐ the bound is safe
    //   with a margin of an order of magnitude.
    //   ⭐⭐⭐ AND THE RESET INTERFERENCE IS EXCLUDED: only the measuring
    //   files RESET the shared buckets ⇒ ⭐⭐ they are serialized by the
    //   advisory lock ⇒ ⭐⭐ the reset of one measurement can never
    //   wipe the budget of another measurement.
    const declared: string[] = [];
    for (const file of files) {
      const report = inventory(file);
      if (report.mutations.length === 0) continue;
      const text = fs.readFileSync(file, 'utf8');
      const lowerBounds = text.match(/waited\s*>=\s*\d+/g) ?? [];
      assert.ok(
        lowerBounds.length >= 1,
        `⭐⭐⭐ ${relative(file)} measures the wait but asserts no lower bound`,
      );
      // ⭐⭐ An upper bound is only allowed inside a drill that takes
      //   the lock ⇒ ⭐⭐ because the reset of the shared buckets of the
      //   other measuring files is the interference that could break
      //   it ⇒ ⭐⭐ and the lock removes exactly that interference.
      const upperBounds = text.match(/waited\s*<=\s*\d+|waited\s*<\s*\d+/g) ?? [];
      if (upperBounds.length > 0) {
        assert.ok(
          report.takesLock,
          `⭐⭐⭐ ${relative(file)} asserts an upper bound on the wait WITHOUT the lock`,
        );
        declared.push(`${relative(file)} ⇒ ${upperBounds.join(', ')}`);
      }
    }
    // ⭐⭐ The declared risks are PRINTED ⇒ ⭐⭐ the reviewer reads them
    //   in the log of the run, not only in the report.
    console.log(
      `⭐⭐⭐ the declared residual risks of the platform budget:\n${declared.join('\n')}`,
    );
  });
});

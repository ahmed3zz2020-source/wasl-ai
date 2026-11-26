// ============================================================
// WASL AI — the doctor of the readiness
// ------------------------------------------------------------
// ⭐ WHAT THIS IS: one command that answers the only question that
//   matters before a run ⇒ ⭐⭐ "what is ready, what is missing, and
//   who owns each missing piece" ⇒ ⇒ ⇒ with the EVIDENCE of every
//   line ⇒ ⇒ ⇒ and never with a number that was not measured.
//
// ⭐ THE COMMAND:
//     npm run doctor
//
// ⭐ WHAT IT CHECKS
//   ① the runtime (Node · PostgreSQL · the database · the schema),
//   ② the service (the configuration resolves · the port is free),
//   ③ the interface (the pages are there),
//   ④ the tools (the ones of the wave and the old ones),
//   ⑤ the guards (the four audits, run for real),
//   ⑥ the published state (the numbers · the readiness · the estimate),
//   ⑦ the CI (the workflows and the secret they wait for),
//   ⑧ the PUBLIC run — what is missing and who owns it.
//
// ⛔ IT NEVER CHANGES ANYTHING ⇒ it only reads and runs the audits.
// ⛔ IT NEVER INVENTS A NUMBER ⇒ every number it prints is read.
// ============================================================

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { loadConfig } from '../server/config.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const line = (text = ''): void => process.stdout.write(`${text}\n`);
const read = (relative: string): string => {
  const path_ = path.join(ROOT, relative);
  return fs.existsSync(path_) ? fs.readFileSync(path_, 'utf8') : '';
};

let good = 0;
let bad = 0;

function check(ok: boolean, label: string, detail = ''): void {
  if (ok) {
    good += 1;
    line(`  ✅ ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    bad += 1;
    line(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function run(command: string, args: string[]): { code: number; tail: string } {
  try {
    const output = execFileSync(command, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, tail: output.trim().split('\n').slice(-1)[0] ?? '' };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    const text = `${failure.stdout ?? ''}${failure.stderr ?? ''}`.trim();
    return { code: failure.status ?? 1, tail: text.split('\n').slice(-1)[0] ?? '' };
  }
}

function portFree(host: string, port: number): boolean {
  const socket = net.connect({ host, port });
  return new Promise<boolean>((resolve) => {
    socket.on('connect', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => resolve(true));
    setTimeout(() => {
      socket.destroy();
      resolve(true);
    }, 700);
  });
}

/** ⭐⭐⭐ the health endpoint of the service that is ALREADY running (if any). */
async function healthOf(host: string, port: number): Promise<Record<string, unknown> | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const response = await fetch(`http://${host}:${port}/api/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return null;
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  line('');
  line('⭐ WASL AI — the doctor of the readiness (it changes nothing)');
  line('');

  // ---------------------------------------------------------------- ① the runtime
  line('① ⭐ the runtime');
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  check(nodeMajor >= 22, 'Node', `v${process.versions.node}`);
  const config = (() => {
    try {
      return loadConfig(process.env, ROOT, { requirePassword: false });
    } catch (error) {
      line(`  ❌ the configuration does not resolve — ${String((error as Error)?.message)}`);
      bad += 1;
      return null;
    }
  })();
  if (config) {
    const host = process.env['WASL_PG_HOST'] ?? '127.0.0.1';
    const port = Number(process.env['WASL_PG_PORT'] ?? '5432');
    const reachable = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ host, port });
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('error', () => resolve(false));
      setTimeout(() => {
        socket.destroy();
        resolve(false);
      }, 900);
    });
    check(reachable, 'PostgreSQL', `${host}:${port}`);
    const credentials = read('.local/pg-credentials.json');
    check(credentials.length > 0, 'the credentials of the database', credentials ? '.local/pg-credentials.json' : 'MISSING ⇒ npm run db:setup');
    check(
      Boolean(config.databaseName),
      'the database of the service',
      `${config.databaseName} · the profile ${config.profile}`,
    );
  }

  // ---------------------------------------------------------------- ② the service
  line('');
  line('② ⭐ the service');
  const serverHost = process.env['WASL_SERVER_HOST'] ?? '127.0.0.1';
  const serverPort = Number(process.env['WASL_SERVER_PORT'] ?? '8787');
  // ⭐⭐⭐ the port may be taken by the service THAT IS ALREADY RUNNING ⇒
  //   ⇒ ⇒ ⇒ and that is not a broken thing ⇒ ⇒ ⇒ so we ask it.
  const running = await healthOf(serverHost, serverPort);
  if (running) {
    check(
      true,
      'the service is already running on this port',
      `${serverHost}:${serverPort} · the db ok: ${String(running['db_ok'] ?? '?')} · the schema ${String(running['schema_version'] ?? '?')}`,
    );
  } else {
    check(await portFree(serverHost, serverPort), 'the port is free', `${serverHost}:${serverPort}`);
  }
  const health = read('server/api/server.ts');
  check(health.includes("'/api/health'"), 'the health endpoint exists', '/api/health');
  check(health.includes('/ui/index.html'), 'the interface is served by the service', '/ui/*.html');

  // ---------------------------------------------------------------- ③ the interface
  line('');
  line('③ ⭐ the interface');
  for (const page of ['index.html', 'inbox.html', 'tickets.html', 'crm.html']) {
    check(fs.existsSync(path.join(ROOT, 'server', 'ui', page)), `the page ${page}`);
  }
  check(fs.existsSync(path.join(ROOT, 'dashboard', 'worker.js')), 'the dashboard of the worker');

  // ---------------------------------------------------------------- ④ the tools
  line('');
  line('④ ⭐ the tools');
  for (const tool of [
    'tools/wasl-run.ts',
    'tools/wasl-doctor.ts',
    'tools/wasl-cost-tracker.ts',
    'tools/wasl-a11y-audit.ts',
    'tools/wasl-db-setup.ts',
    'tools/wasl-db-backup.ts',
    'tools/wasl-db-restore.ts',
    'tools/wasl-db-verify.ts',
    'tools/check-lang.py',
    'tools/published_numbers_audit.py',
    'tools/test_count_audit.py',
    'tools/completion_board.py',
  ]) {
    check(fs.existsSync(path.join(ROOT, tool)), tool);
  }

  // ---------------------------------------------------------------- ⑤ the guards
  line('');
  line('⑤ ⭐ the guards (they are run for real)');
  const guards: [string, string, string[]][] = [
    ['the language', 'python3', ['tools/check-lang.py', '--quiet', '.']],
    ['the published numbers', 'python3', ['tools/published_numbers_audit.py']],
    ['the count of the tests', 'python3', ['tools/test_count_audit.py', '--docs']],
    ['the board of the completion', 'python3', ['tools/completion_board.py', '--check']],
  ];
  for (const [label, command, args] of guards) {
    const result = run(command, args);
    check(result.code === 0, label, result.code === 0 ? 'OK' : result.tail.slice(0, 90));
  }

  // ---------------------------------------------------------------- ⑥ the published state
  line('');
  line('⑥ ⭐ the published state (read, never guessed)');
  const currentState = read('CURRENT-STATE.md');
  const total = currentState.match(/wasl:current-total\s+(\d+)\s*=\s*(\d+)\s+pass\s*\+\s*(\d+)\s+fail\s*\+\s*(\d+)\s+skipped/);
  if (total) {
    check(true, 'the published tests', `${total[1]} = ${total[2]} pass + ${total[3]} fail + ${total[4]} skipped`);
  } else {
    check(false, 'the published tests', 'no marker in CURRENT-STATE.md');
  }
  check(currentState.includes('47%') || currentState.includes('47٪'), 'the approved estimate of the project', '47%');
  check(currentState.includes('9/21'), 'the official readiness', '9/21');
  check(currentState.includes('BLOCKED'), 'M75 (the Docker drill) is still BLOCKED');

  // ---------------------------------------------------------------- ⑦ the CI
  line('');
  line('⑦ ⭐ the CI');
  const ci = read('.github/workflows/ci.yml');
  check(ci.length > 0, 'the workflow of the CI', '.github/workflows/ci.yml');
  check(ci.includes('guards'), 'the guards run on every push', 'no secret needed');
  check(ci.includes('WASL_CI_POSTGRES_PASSWORD'), 'the full test job waits for ONE secret', 'the settings of the repository');

  // ---------------------------------------------------------------- ⑧ the public run
  line('');
  line('⑧ ⭐⭐ the PUBLIC run — what is missing and who owns it');
  const publicRun: [string, string][] = [
    ['a provider + a database in it', 'the owner (D-3)'],
    ['a domain + a certificate', 'the owner (D-3)'],
    ['the secrets of the production', 'the owner (D-7)'],
    ['the legal basis + the agreement of the data', 'the owner + a lawyer (D-2)'],
    ['the identity of the production', 'the owner (D-4)'],
    ['the channel of the client', 'the owner (D-5)'],
    ['the data of a real client', 'the owner (D-1)'],
    ['the price ceiling of the running', 'the owner (D-7)'],
  ];
  for (const [item, owner] of publicRun) {
    line(`  ⬜ ${item} — ${owner}`);
  }

  line('');
  line(`⭐ the summary: ${good} ready · ${bad} broken · ⭐⭐ and the public run needs the owner's signature`);
  line('');
  process.exitCode = bad === 0 ? 0 : 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`the doctor failed: ${String((error as Error)?.message ?? error)}\n`);
  process.exitCode = 1;
});

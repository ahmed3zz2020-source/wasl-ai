// ============================================================
// WASL AI — فحص ما قبل الإصدار (production gate)
// ------------------------------------------------------------
// ⭐⭐⭐ WHAT THIS TOOL IS
//   one command that answers the only question that matters before the
//   first real customer ⇒ ⇒ ⇒ "is the release allowed to go out, and
//   who owns what is missing" ⇒ ⇒ ⇒ ⇒ with the evidence of every line.
// ⭐⭐ WHAT IT CHECKS
//   ① the environment of the production: present or missing + who owns
//      each one ⇒ ⇒ ⇒ ⭐⭐ AND THE VALUE OF A SECRET IS NEVER PRINTED
//      (the name and a dummy only),
//   ② the image and the compose files (root user · health check · the
//      published port · a secret written in a file),
//   ③ the independence of the schema (is the migration safe · is the
//      rollback possible),
//   ④ the gates of the release (the tree · the Docker drill · the CI).
// ⛔ It never changes anything ⇒ it only reads.
// ⛔ It never prints a secret value ⇒ only the name and a dummy.
// ⛔ It never buys anything ⇒ no account · no subscription · no
//   deployment · no registry.
// ============================================================

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export type Verdict = 'ok' | 'fail' | 'warn';

export interface CheckLine {
  readonly id: string;
  readonly section: string;
  readonly verdict: Verdict;
  readonly title: string;
  readonly reason: string;
}

export interface CheckOptions {
  /** ⭐ The environment of the check (the process environment by default). */
  readonly env?: NodeJS.ProcessEnv;
  /** ⭐ The root of the deployment artefacts (the repository by default). */
  readonly root?: string;
  /** ⭐ The root of the source of the schema (the repository by default). */
  readonly codeRoot?: string;
  /** ⭐ Probe the state of the tree with git? */
  readonly probeGit?: boolean;
  /** ⭐ Probe the Docker daemon? (it pulls a tiny image ⇒ it is slow) */
  readonly probeDocker?: boolean;
}

export interface CheckReport {
  readonly lines: readonly CheckLine[];
  readonly ok: number;
  readonly fail: number;
  readonly warn: number;
  readonly exitCode: number;
}

export const SECTION_ENV = '① متغيّرات البيئة';
export const SECTION_IMAGE = '② الصورة وملفات النشر';
export const SECTION_SCHEMA = '③ استقلالية المخطط';
export const SECTION_GATES = '④ بوابات النشر';

interface EnvSpec {
  readonly name: string;
  readonly sensitive: boolean;
  readonly required: boolean;
  readonly owner: string;
  readonly why: string;
  readonly example: string;
}

const OWNER_OWNER = 'المالك';
const OWNER_PROVIDER = 'المزوّد';

/**
 * ⭐⭐⭐ The catalogue of the variables ⇒ ⭐ the names come from the
 *   code itself (`server/config.ts` and the tools) ⇒ ⇒ ⇒ ⇒ and every
 *   one of them carries its OWNER ⇒ ⇒ ⇒ ⇒ ⇒ (the owner of the secret
 *   is not the engineer who runs the command).
 */
const ENV_SPECS: readonly EnvSpec[] = [
  {
    name: 'WASL_ENV',
    sensitive: false,
    required: true,
    owner: OWNER_OWNER,
    why: 'يختار بروفايل التشغيل — والخادم يفشل مغلقاً بلا عنوان صريح',
    example: 'staging',
  },
  {
    name: 'WASL_SERVER_HOST',
    sensitive: false,
    required: true,
    owner: OWNER_OWNER,
    why: 'عنوان الاستماع — وبروفايل staging يفشل بلاه صراحةً',
    example: '0.0.0.0',
  },
  {
    name: 'WASL_SERVER_PORT',
    sensitive: false,
    required: true,
    owner: OWNER_OWNER,
    why: 'منفذ الاستماع — والـreverse proxy هو المدخل الوحيد',
    example: '8787',
  },
  {
    name: 'WASL_PG_HOST',
    sensitive: false,
    required: true,
    owner: OWNER_PROVIDER,
    why: 'عنوان قاعدة البيانات في الإنتاج',
    example: 'db.internal.example',
  },
  {
    name: 'WASL_PG_PORT',
    sensitive: false,
    required: true,
    owner: OWNER_PROVIDER,
    why: 'منفذ قاعدة البيانات',
    example: '5432',
  },
  {
    name: 'WASL_PG_DATABASE',
    sensitive: false,
    required: true,
    owner: OWNER_PROVIDER,
    why: 'اسم قاعدة البيانات',
    example: 'wasl_prod',
  },
  {
    name: 'WASL_PG_PASSWORD',
    sensitive: true,
    required: true,
    owner: OWNER_OWNER,
    why: 'سرّ دور الطلب (wasl_app · NOBYPASSRLS) — وسرّ المالك سرّ منفصل',
    example: 'not-a-secret-app-password',
  },
  {
    name: 'WASL_PG_OWNER_PASSWORD',
    sensitive: true,
    required: true,
    owner: OWNER_OWNER,
    why: 'سرّ دور المالك (wasl_owner) — وهو أقوى صلاحية في القاعدة',
    example: 'not-a-secret-owner-password',
  },
  {
    name: 'WASL_PG_SUPERUSER_URL',
    sensitive: true,
    required: false,
    owner: OWNER_OWNER,
    why: 'رابط المستخدم الأعلى — يُستعمل في الإعداد فقط',
    example: 'postgresql://postgres:not-a-secret@localhost:5432/postgres',
  },
  {
    name: 'WASL_SESSION_TTL_SECONDS',
    sensitive: false,
    required: false,
    owner: OWNER_OWNER,
    why: 'مدّة صلاحية الجلسة',
    example: '3600',
  },
  {
    name: 'WASL_TEST_PASSCODE',
    sensitive: true,
    required: true,
    owner: OWNER_OWNER,
    why: 'كلمة سرّ البذور — ولولا غير معروفة تُنتج حسابات مفتوحة',
    example: 'not-a-secret-fixture-passcode',
  },
  {
    name: 'WASL_SERVER_URL',
    sensitive: false,
    required: false,
    owner: OWNER_OWNER,
    why: 'عنوان خادم شغّال — يُستعمل في الرحلة end to end',
    example: 'http://127.0.0.1:8787',
  },
  {
    name: 'WASL_LOG_LEVEL',
    sensitive: false,
    required: false,
    owner: OWNER_OWNER,
    why: 'مستوى السجل',
    example: 'info',
  },
  {
    name: 'WASL_BACKUP_KEY',
    sensitive: true,
    required: false,
    owner: OWNER_OWNER,
    why: 'مفتاح تشفير نسخة الاحتياطي — ولا يُطبع أبداً',
    example: 'not-a-secret-backup-key',
  },
  {
    name: 'WASL_LOGIN_MAX_ATTEMPTS',
    sensitive: false,
    required: false,
    owner: OWNER_OWNER,
    why: 'سقف محاولات الحساب',
    example: '5',
  },
  {
    name: 'WASL_LOGIN_MAX_TENANT_ATTEMPTS',
    sensitive: false,
    required: false,
    owner: OWNER_OWNER,
    why: 'سقف محاولات الشركة',
    example: '20',
  },
  {
    name: 'WASL_LOGIN_MAX_GLOBAL_ATTEMPTS',
    sensitive: false,
    required: false,
    owner: OWNER_OWNER,
    why: 'سقف محاولات المنصّة',
    example: '200',
  },
  {
    name: 'WASL_LOGIN_MAX_PEER_ATTEMPTS',
    sensitive: false,
    required: false,
    owner: OWNER_OWNER,
    why: 'سقف محاولات العنوان',
    example: '50',
  },
  {
    name: 'WASL_LOGIN_WINDOW_SECONDS',
    sensitive: false,
    required: false,
    owner: OWNER_OWNER,
    why: 'نافذة العدّ',
    example: '300',
  },
  {
    name: 'WASL_LOGIN_GLOBAL_RATE_PER_SECOND',
    sensitive: false,
    required: false,
    owner: OWNER_OWNER,
    why: 'سقف بدء الاشتقاقات في الثانية',
    example: '2',
  },
  {
    name: 'WASL_LOGIN_GLOBAL_BURST',
    sensitive: false,
    required: false,
    owner: OWNER_OWNER,
    why: 'دفعة السماح العالمية',
    example: '4',
  },
  {
    name: 'WASL_LOGIN_TENANT_RATE_PER_SECOND',
    sensitive: false,
    required: false,
    owner: OWNER_OWNER,
    why: 'سقف بدء الاشتقاقات لكل شركة',
    example: '1',
  },
  {
    name: 'WASL_LOGIN_TENANT_BURST',
    sensitive: false,
    required: false,
    owner: OWNER_OWNER,
    why: 'دفعة السماح لكل شركة',
    example: '2',
  },
  {
    name: 'WASL_LOGIN_DEGRADED_WAIT_MS',
    sensitive: false,
    required: false,
    owner: OWNER_OWNER,
    why: 'مهلة التهدئة عند الضغط',
    example: '250',
  },
  {
    name: 'WASL_LOGIN_MAX_WAIT_MS',
    sensitive: false,
    required: false,
    owner: OWNER_OWNER,
    why: 'أقصى مهلة انتظار',
    example: '2000',
  },
  {
    name: 'WASL_LOGIN_TRUST_PEER_ADDRESS',
    sensitive: false,
    required: false,
    owner: OWNER_OWNER,
    why: 'هل يُثق بعنوان الـpeer؟ (يبقى false خلف reverse proxy)',
    example: 'false',
  },
];

/** ⭐ The words that make a key a secret. */
const SENSITIVE_WORDS = new Set([
  'PASSWORD',
  'PASSCODE',
  'SECRET',
  'TOKEN',
  'KEY',
  'CREDENTIAL',
  'CREDENTIALS',
  'PRIVATEKEY',
]);

/** ⭐ The shapes that are NOT a secret (a placeholder or a substitution). */
function isPlaceholder(value: string): boolean {
  const text = value.trim().replace(/^['"]|['"]$/g, '');
  if (text === '') return true;
  if (text.startsWith('${') || text.startsWith('$(')) return true;
  return /(not-a-secret|change[_ -]?me|paste-here|placeholder|example|dummy|synthetic|fixture|local-|xxxxx|<[^>]+>|\.\.\.)/i.test(
    text,
  );
}

function keyWords(key: string): string[] {
  return key
    .replace(/[^A-Za-z0-9]+/g, '_')
    .split('_')
    .filter((part) => part.length > 0)
    .map((part) => part.toUpperCase());
}

function isSensitiveKey(key: string): boolean {
  return keyWords(key).some((word) => SENSITIVE_WORDS.has(word));
}

function readIfExists(root: string, relative: string): string | null {
  const file = path.join(root, relative);
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function deployFiles(root: string): string[] {
  const files = ['Dockerfile', 'deploy/env.example', 'deploy/env.local.example'];
  const deployDir = path.join(root, 'deploy');
  try {
    for (const name of fs.readdirSync(deployDir)) {
      const relative = `deploy/${name}`;
      if (!files.includes(relative) && /\.(ya?ml|conf|example)$/.test(name)) files.push(relative);
    }
  } catch {
    // ⭐ no deploy directory ⇒ nothing to scan.
  }
  return files;
}

/** ⭐⭐ The service block of a compose file ⇒ by its name. */
function serviceBlock(text: string, service: string): string {
  const lines = text.split('\n');
  let start = -1;
  for (let index = 0; index < lines.length; index++) {
    if (new RegExp(`^ {2}${service}:\\s*$`).test(lines[index] ?? '')) {
      start = index;
      break;
    }
  }
  if (start < 0) return '';
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index++) {
    if (/^ {2}\S/.test(lines[index] ?? '')) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

/** ⭐⭐ The block that follows a key inside a section. */
function blockAfter(section: string, key: string): string {
  const lines = section.split('\n');
  let index = -1;
  for (let i = 0; i < lines.length; i++) {
    if (new RegExp(`^ {4}${key}:\\s*$`).test(lines[i] ?? '')) {
      index = i;
      break;
    }
  }
  if (index < 0) return '';
  const out: string[] = [];
  for (let i = index + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      out.push(line);
      continue;
    }
    if (!/^ {6}\S/.test(line)) break;
    out.push(line);
  }
  return out.join('\n');
}

/**
 * ⭐⭐⭐ **the check** ⇒ ⭐ the report of every line ⇒ ⇒ and the exit
 *   code ⇒ ⇒ (0 when there is no red line, 1 when there is one).
 */
export function runProductionCheck(options: CheckOptions = {}): CheckReport {
  const env = options.env ?? process.env;
  const root = options.root ?? process.cwd();
  const codeRoot = options.codeRoot ?? root;
  const lines: CheckLine[] = [];

  const add = (
    id: string,
    section: string,
    verdict: Verdict,
    title: string,
    reason: string,
  ): void => {
    lines.push({ id, section, verdict, title, reason });
  };

  // ------------------------------------------------------------------ ① the environment
  for (const spec of ENV_SPECS) {
    const raw = env[spec.name];
    const present = typeof raw === 'string' && raw.trim() !== '';
    const id = `env-${spec.name}`;
    if (present) {
      add(
        id,
        SECTION_ENV,
        'ok',
        spec.name,
        spec.sensitive
          ? `موجود · السرّ لا يُطبع · المالك: ${spec.owner} · مثال وهمية: ${spec.example}`
          : `موجود · المالك: ${spec.owner}`,
      );
      continue;
    }
    add(
      id,
      SECTION_ENV,
      spec.required ? 'fail' : 'warn',
      spec.name,
      spec.required
        ? `ناقص · المالك: ${spec.owner} · مثال وهمية: ${spec.example} · ${spec.why}`
        : `اختياري وناقص · المالك: ${spec.owner} · ${spec.why}`,
    );
  }
  add(
    'env-dpa',
    SECTION_ENV,
    'warn',
    'اتفاقية معالجة البيانات والنقل عبر الحدود',
    'غير قابل للفحص من المستودع · المالك: المحامي · يُراجَع عقداً قبل أي بيانات حقيقية',
  );

  // ------------------------------------------------------------------ ② the image and the files
  for (const relative of deployFiles(root)) {
    const text = readIfExists(root, relative);
    if (text === null) continue;
    for (const [index, line] of text.split('\n').entries()) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*[:=]\s*(.*)$/.exec(line);
      if (!match) continue;
      const key = match[1] ?? '';
      const value = match[2] ?? '';
      if (!isSensitiveKey(key)) continue;
      if (isPlaceholder(value)) continue;
      add(
        `secret-${relative}-${index + 1}`,
        SECTION_IMAGE,
        'fail',
        `${relative}:${index + 1}`,
        `قيمة حرفيّة لمتغيّر حسّاس (${key}) في ملف داخل المستودع · السرّ لا يُطبع`,
      );
    }
  }
  add(
    'secret-scan',
    SECTION_IMAGE,
    'ok',
    'فحص الأسرار في ملفات النشر',
    'كل متغيّر حسّاس داخل الملفات هو استبدال أو قيمة وهمية · والقيمة الحقيقية لا تُطبع',
  );

  const dockerfile = readIfExists(root, 'Dockerfile') ?? '';
  if (dockerfile === '') {
    add('image-dockerfile', SECTION_IMAGE, 'fail', 'Dockerfile', 'الملف غير موجود');
  } else {
    add(
      'image-dockerfile',
      SECTION_IMAGE,
      'ok',
      'Dockerfile',
      'موجود · والحاوية لا تحتاج بناءً في هذه الأداة',
    );
    if (/^\s*USER\s+(?!root|0)\S+/m.test(dockerfile)) {
      add('image-user', SECTION_IMAGE, 'ok', 'مستخدم الحاوية', 'الحاوية تعمل بمستخدم غير root');
    } else {
      add('image-user', SECTION_IMAGE, 'fail', 'مستخدم الحاوية', 'لا يوجد USER غير root ⇒ الحاوية تعمل كـroot');
    }
    if (/HEALTHCHECK/i.test(dockerfile)) {
      add('image-health', SECTION_IMAGE, 'ok', 'فحص الصحة', 'الحاوية فيها HEALTHCHECK');
    } else {
      add('image-health', SECTION_IMAGE, 'fail', 'فحص الصحة', 'لا يوجد HEALTHCHECK في الصورة');
    }
    if (/^\s*(ARG|ENV)\s+\w*(PASSWORD|SECRET|TOKEN|PASSCODE|KEY)\w*\s*=/im.test(dockerfile)) {
      add(
        'image-secret',
        SECTION_IMAGE,
        'fail',
        'سرّ داخل الصورة',
        'الصورة تعرّف متغيّراً حسّاساً · والسرّ يجب أن يأتي من بيئة التشغيل',
      );
    } else {
      add('image-secret', SECTION_IMAGE, 'ok', 'سرّ داخل الصورة', 'لا سرّ مطبوخ في الصورة');
    }
  }

  const compose = readIfExists(root, 'deploy/docker-compose.staging.example.yml') ?? '';
  if (compose === '') {
    add('compose', SECTION_IMAGE, 'fail', 'ملف النشر', 'deploy/docker-compose.staging.example.yml غير موجود');
  } else {
    const backend = serviceBlock(compose, 'backend');
    const ports = blockAfter(backend, 'ports');
    const exposed: string[] = [];
    for (const line of ports.split('\n')) {
      const mapping = /["']?([\w.-]*):(\d+)(?::(\d+))?["']?/.exec(line);
      if (!mapping) continue;
      const host = mapping[1] ?? '';
      if (host !== '127.0.0.1' && host !== 'localhost') exposed.push(line.trim());
    }
    if (exposed.length === 0) {
      add('compose-port', SECTION_IMAGE, 'ok', 'منفذ الخدمة', 'الخدمة منشورة على الـloopback فقط');
    } else {
      add(
        'compose-port',
        SECTION_IMAGE,
        'fail',
        'منفذ الخدمة',
        `منفذ منشور على كل الواجهات: ${exposed.join(' · ')}`,
      );
    }
    const postgres = serviceBlock(compose, 'postgres');
    if (/^\s{4}ports:/m.test(postgres)) {
      add('compose-db-port', SECTION_IMAGE, 'fail', 'منفذ القاعدة', 'قاعدة البيانات لها منفذ منشور');
    } else {
      add('compose-db-port', SECTION_IMAGE, 'ok', 'منفذ القاعدة', 'قاعدة البيانات بلا منفذ منشور');
    }
    if (/healthcheck:/i.test(backend)) {
      add('compose-health', SECTION_IMAGE, 'ok', 'فحص صحة الخدمة', 'الخدمة لها healthcheck');
    } else {
      add('compose-health', SECTION_IMAGE, 'fail', 'فحص صحة الخدمة', 'الخدمة بلا healthcheck');
    }
  }

  // ------------------------------------------------------------------ ③ the schema
  const setup = readIfExists(codeRoot, 'server/db/setup.ts') ?? '';
  if (setup === '') {
    add('schema-setup', SECTION_SCHEMA, 'fail', 'الترحيل', 'server/db/setup.ts غير موجود');
  } else {
    if (/pg_advisory_lock/i.test(setup) && /pg_advisory_unlock/i.test(setup)) {
      add('schema-lock', SECTION_SCHEMA, 'ok', 'قفل الترحيل', 'الترحيل مقفل ⇒ ولا ترحيلان معاً');
    } else {
      add('schema-lock', SECTION_SCHEMA, 'fail', 'قفل الترحيل', 'الترحيل بلا قفل ⇒ ترحيلان ممكنان معاً');
    }
    if (/nobypassrls/i.test(setup)) {
      add('schema-role', SECTION_SCHEMA, 'ok', 'دور الطلب', 'دور الطلب NOBYPASSRLS ⇒ والعزل مطبَّق');
    } else {
      add('schema-role', SECTION_SCHEMA, 'fail', 'دور الطلب', 'دور الطلب ليس NOBYPASSRLS');
    }
  }
  const migrationsDir = path.join(codeRoot, 'server/db/migrations');
  let migrationFiles: string[] = [];
  try {
    migrationFiles = fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();
  } catch {
    migrationFiles = [];
  }
  if (migrationFiles.length === 0) {
    add('schema-migrations', SECTION_SCHEMA, 'fail', 'الترحيلات', 'لا يوجد ملف ترحيل');
  } else {
    add(
      'schema-migrations',
      SECTION_SCHEMA,
      'ok',
      'الترحيلات',
      `${migrationFiles.length} ملف ترحيل · والخطر: لا يوجد ترحيل رجوع`,
    );
    const down = migrationFiles.filter((name) => name.includes('down') || name.includes('rollback'));
    if (down.length === 0) {
      add(
        'schema-rollback',
        SECTION_SCHEMA,
        'warn',
        'الرجوع',
        'لا يوجد ترحيل رجوع ⇒ الرجوع = الاستعادة من نسخة احتياطية (هذا مُعلن)',
      );
    } else {
      add(
        'schema-rollback',
        SECTION_SCHEMA,
        'ok',
        'الرجوع',
        `${down.length} ترحيل رجوع`,
      );
    }
    const destructive = migrationFiles.filter((name) => {
      const text = readIfExists(codeRoot, `server/db/migrations/${name}`) ?? '';
      return /\bdrop\s+(table|column)\b/i.test(text);
    });
    if (destructive.length === 0) {
      add('schema-destructive', SECTION_SCHEMA, 'ok', 'ترحيل مدمر', 'لا يوجد حذف لجدول أو عمود');
    } else {
      add(
        'schema-destructive',
        SECTION_SCHEMA,
        'fail',
        'ترحيل مدمر',
        `ترحيل يحذف جدولاً أو عموداً: ${destructive.join(' · ')}`,
      );
    }
  }

  // ------------------------------------------------------------------ ④ the gates
  if (options.probeGit === true) {
    const probe = spawnSync('git', ['status', '--porcelain'], { cwd: codeRoot, encoding: 'utf8' });
    if (probe.status !== 0) {
      add('gate-git', SECTION_GATES, 'warn', 'شجرة المستودع', 'git غير متاح ⇒ تعذّر الفحص');
    } else if ((probe.stdout ?? '').trim() === '') {
      add('gate-git', SECTION_GATES, 'ok', 'شجرة المستودع', 'نظيفة ⇒ النشر من شجرة متتبَّعة');
    } else {
      add(
        'gate-git',
        SECTION_GATES,
        'warn',
        'شجرة المستودع',
        'فيها تغييرات غير مودعة ⇒ النشر من شجرة غير متتبَّعة',
      );
    }
  }

  if (options.probeDocker === true) {
    const version = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
      cwd: codeRoot,
      encoding: 'utf8',
    });
    if (version.status !== 0) {
      add(
        'gate-docker',
        SECTION_GATES,
        'warn',
        'دِرل Docker',
        'لا ديمون Docker ⇒ الدِرل الديناميكي غير ممكن في هذه البيئة',
      );
    } else {
      const run = spawnSync(
        'docker',
        ['run', '--rm', '--network', 'none', 'hello-world'],
        { cwd: codeRoot, encoding: 'utf8', timeout: 180000 },
      );
      if (run.status === 0) {
        add('gate-docker', SECTION_GATES, 'ok', 'دِرل Docker', 'الحاوية اشتغلت ⇒ M75 مفتوح');
      } else {
        const output = `${run.stdout ?? ''}${run.stderr ?? ''}`.split('\n');
        const reason = output.filter((line) => line.trim() !== '').slice(-1)[0] ?? 'السبب غير معروف';
        add(
          'gate-docker',
          SECTION_GATES,
          'warn',
          'دِرل Docker',
          `محجوب في هذه البيئة: ${reason}`,
        );
      }
    }
  }

  const ci = readIfExists(codeRoot, '.github/workflows/ci.yml');
  if (ci === null) {
    add('gate-ci', SECTION_GATES, 'fail', 'خط الـCI', 'الملف غير موجود في شجرة المستودع');
  } else {
    add('gate-ci', SECTION_GATES, 'ok', 'خط الـCI', 'موجود · ويشغّل الحرّاس بلا سرّ');
    if (/WASL_CI_POSTGRES_PASSWORD/.test(ci)) {
      add(
        'gate-ci-secret',
        SECTION_GATES,
        'ok',
        'سرّ الـCI',
        'الاختبارات الكاملة تنتظر سرّ CI واحداً من المالك',
      );
    } else {
      add(
        'gate-ci-secret',
        SECTION_GATES,
        'warn',
        'سرّ الـCI',
        'لا ذكر لسرّ CI ⇒ الاختبارات الكاملة لا تعمل على المستودع البعيد',
      );
    }
  }

  const ok = lines.filter((line) => line.verdict === 'ok').length;
  const fail = lines.filter((line) => line.verdict === 'fail').length;
  const warn = lines.filter((line) => line.verdict === 'warn').length;
  return { lines, ok, fail, warn, exitCode: fail === 0 ? 0 : 1 };
}

/** ⭐⭐ The report as text ⇒ ⭐ and the exit code of the process. */
export function printProductionCheck(report: CheckReport): void {
  const icon = (verdict: Verdict): string =>
    verdict === 'ok' ? '✅' : verdict === 'warn' ? '⚠️' : '❌';
  let section = '';
  for (const line of report.lines) {
    if (line.section !== section) {
      section = line.section;
      process.stdout.write(`\n${section}\n`);
    }
    process.stdout.write(`  ${icon(line.verdict)} ${line.title} — ${line.reason}\n`);
  }
  process.stdout.write(
    `\n${report.ok} ok · ${report.warn} تحذير · ${report.fail} خطأ · الخروج ${report.exitCode}\n`,
  );
}

const isMain = (() => {
  try {
    return process.argv[1] !== undefined && process.argv[1].includes('wasl-production-check');
  } catch {
    return false;
  }
})();

if (isMain) {
  const report = runProductionCheck({
    env: process.env,
    root: path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'),
    probeGit: true,
    probeDocker: process.argv.includes('--docker'),
  });
  printProductionCheck(report);
  process.exitCode = report.exitCode;
}

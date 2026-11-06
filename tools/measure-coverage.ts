// ============================================================
// WASL AI — قياس التغطية (M57 · D-065)
// ------------------------------------------------------------
// ⭐ تشغيل:
//   node --experimental-strip-types tools/measure-coverage.ts \
//        [--coverage <تقرير node>]
// ⭐⭐⭐ **فصل M57 (الدرس الذي يثبته هذا الملف)**: ⭐ تغطية الفروع
//   (نِسب الأسطر والفروع) ⭐≠ ⭐ تغطية المتطلبات الأمنية (هل كل رمز رفض
//   مُغطّى باختبار؟) ⇒ ⭐⇒⇒ **فلا يصحّ أن نعلن «تغطية كاملة» برقم واحد**.
// ⭐⭐⭐ **ما يقيسه هذا الملف (بلا ادّعاء)**: ⭐① **رموز الرفض**: أيّها
//   يُنتَج فعلياً (قياس حيّ) وأيّها مُعلَن بلا مسار ⇒ ⭐② **مرجع الاختبار**:
//   أي ملف اختبار يذكر الرمز ⇒ ⭐③ **تغطية الفروع**: من تقرير Node (إن وُجد).
// ⛔ بلا شبكة · ⛔ بلا بيانات حقيقية · ⛔ بلا تعديل على `src/core/`.
// ============================================================

import fs from 'node:fs';
import path from 'node:path';

import {
  IDENTITY_CONTRACT_CODES,
  evaluateIdentityAttestation,
  issueLocalTestAttestation,
  type IdentityAttestation,
} from '../src/core/identity-source-contract.ts';
import {
  LocalIdentityRegistry,
  issueIdentityAdminAuthority,
  type IdentityAdminAuthority,
} from '../src/core/identity.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const TESTS_DIR = path.join(ROOT, 'tests');
const NOW = '2026-01-05T12:00:00.000Z';

interface Fixture {
  readonly registry: LocalIdentityRegistry;
  readonly ownerAuthority: IdentityAdminAuthority;
  readonly agentAuthority: IdentityAdminAuthority;
}

/** ⭐⭐⭐ سجلّ هوية نظيف — ⭐ مالك + موظّف + مالك ثانٍ (لاختبار الإلغاء). */
function freshFixture(): Fixture {
  const registry = new LocalIdentityRegistry({ now: () => NOW });
  const ownerInput = {
    identity_id: 'cov-ident-owner',
    tenant_id: 'tnt_cov_0001',
    actor_id: 'actor_cov_0001',
    role: 'owner' as const,
    expires_at: null,
  };
  const ownerAuthority = issueIdentityAdminAuthority({ ...ownerInput, status: 'active' });
  registry.register(ownerInput, ownerAuthority);

  const secondOwnerInput = {
    identity_id: 'cov-ident-owner-2',
    tenant_id: 'tnt_cov_0001',
    actor_id: 'actor_cov_0002',
    role: 'owner' as const,
    expires_at: null,
  };
  registry.register(secondOwnerInput, ownerAuthority);

  const agentInput = {
    identity_id: 'cov-ident-agent',
    tenant_id: 'tnt_cov_0001',
    actor_id: 'actor_cov_0003',
    role: 'agent' as const,
    expires_at: null,
  };
  registry.register(agentInput, ownerAuthority);

  const agentAuthority = issueIdentityAdminAuthority({ ...agentInput, status: 'active' });
  return { registry, ownerAuthority, agentAuthority };
}

/** ⭐⭐⭐ إثبات صادر من المصدر المحلي (المالك). */
function issued(fixture: Fixture, identityId = 'cov-ident-owner'): IdentityAttestation {
  return issueLocalTestAttestation(identityId, { registry: fixture.registry });
}

/** ⭐⭐⭐ إثبات مبنيّ يدوياً (بلا جهة إصدار) — ⭐ لاختبار رفض «المطابقة وحدها». */
function handmade(overrides: Partial<IdentityAttestation> = {}): IdentityAttestation {
  return {
    identity_id: 'cov-ident-owner',
    tenant_id: 'tnt_cov_0001',
    actor_id: 'actor_cov_0001',
    role: 'owner',
    status: 'active',
    proof: { kind: 'local_test', source_id: 'local-test:manual' },
    ...overrides,
  } as IdentityAttestation;
}

interface Probe {
  readonly code: string;
  readonly label: string;
  /** ⭐⭐⭐ يعيد الرمز المُنتَج فعلاً (لا المتوقَّع) ⇒ ⭐ فالقياس حيّ. */
  readonly run: () => string | null;
}

/** ⭐⭐⭐ **Capture** — ⭐ الرمز من قرار التقييم أو من الاستثناء. */
function codeOfDecision(attestation: unknown, options: Record<string, unknown>): string | null {
  const decision = evaluateIdentityAttestation(attestation, options as never);
  return decision.trusted ? null : decision.code;
}

/** ⭐⭐⭐ **Capture من الاستثناء** — ⭐ (مسار الإصدار). */
function codeOfThrow(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      return String((error as { code: unknown }).code);
    }
    return `throw:${String(error)}`;
  }
}

const PROBES: readonly Probe[] = [
  {
    code: 'identity_source_missing',
    label: 'غياب الإثبات',
    run: () => codeOfDecision(null, { scope: 'test' }),
  },
  {
    code: 'identity_source_untrusted',
    label: 'نوع مصدر خارج المجموعة المغلقة',
    run: () =>
      codeOfDecision(handmade({ proof: { kind: 'unknown_kind' } as never }), { scope: 'test' }),
  },
  {
    code: 'identity_source_inactive',
    label: 'مصدر خارجي معرَّف وغير مفعّل',
    run: () =>
      codeOfDecision(handmade({ proof: { kind: 'external_attested' } as never }), { scope: 'test' }),
  },
  {
    code: 'identity_scope_forbidden',
    label: 'نطاق غير مفعّل',
    run: () => {
      const fixture = freshFixture();
      return codeOfDecision(issued(fixture), { scope: 'production', registry: fixture.registry });
    },
  },
  {
    code: 'identity_attestation_invalid',
    label: 'معرّف هوية خارج النمط',
    run: () => {
      const fixture = freshFixture();
      const attestation = issued(fixture);
      (attestation as { identity_id: string }).identity_id = 'bad id!';
      return codeOfDecision(attestation, { scope: 'test', registry: fixture.registry });
    },
  },
  {
    code: 'identity_role_conflict',
    label: 'دور مُدَّعى يخالف سجلّ الإثبات',
    run: () => {
      const fixture = freshFixture();
      const attestation = issued(fixture, 'cov-ident-agent');
      (attestation as { claimed_role?: string }).claimed_role = 'owner';
      return codeOfDecision(attestation, { scope: 'test', registry: fixture.registry });
    },
  },
  {
    code: 'identity_tenant_conflict',
    label: 'مستأجر مُدَّعى يخالف سجلّ الإثبات',
    run: () => {
      const fixture = freshFixture();
      const attestation = issued(fixture);
      (attestation as { claimed_tenant_id?: string }).claimed_tenant_id = 'tnt_cov_0002';
      return codeOfDecision(attestation, { scope: 'test', registry: fixture.registry });
    },
  },
  {
    code: 'identity_status_invalid',
    label: 'حالة خارج المجموعة المغلقة',
    run: () => {
      const fixture = freshFixture();
      const attestation = issued(fixture);
      (attestation as { status: string }).status = 'weird';
      return codeOfDecision(attestation, { scope: 'test', registry: fixture.registry });
    },
  },
  {
    code: 'admin_authority_invalid',
    label: 'طلب صلاحية إدارية بلا سلطة صالحة',
    run: () =>
      codeOfDecision(handmade({ requests_admin: true }), { scope: 'test' }),
  },
  {
    code: 'admin_not_owner',
    label: 'سلطة إدارة من غير مالك',
    run: () => {
      const fixture = freshFixture();
      return codeOfDecision(
        handmade({ admin_authority: fixture.agentAuthority }),
        { scope: 'test', registry: fixture.registry },
      );
    },
  },
  {
    code: 'role_invalid',
    label: 'دور خارج المجموعة المغلقة',
    run: () => codeOfDecision(handmade({ role: 'root' as never }), { scope: 'test' }),
  },
  {
    code: 'identity_revoked',
    label: 'هوية ملغاة',
    run: () => {
      const fixture = freshFixture();
      const attestation = issued(fixture);
      (attestation as { status: string }).status = 'revoked';
      return codeOfDecision(attestation, { scope: 'test', registry: fixture.registry });
    },
  },
  {
    code: 'identity_expired',
    label: 'هوية منتهية الصلاحية',
    run: () => {
      const fixture = freshFixture();
      const attestation = issued(fixture);
      (attestation as { status: string }).status = 'expired';
      return codeOfDecision(attestation, { scope: 'test', registry: fixture.registry });
    },
  },
  {
    code: 'admin_revoked',
    label: 'سلطة إدارة ملغاة',
    run: () => {
      const fixture = freshFixture();
      fixture.registry.revoke('cov-ident-owner-2', fixture.ownerAuthority);
      const revokedAuthority = issueIdentityAdminAuthority({
        identity_id: 'cov-ident-owner-2',
        tenant_id: 'tnt_cov_0001',
        actor_id: 'actor_cov_0002',
        role: 'owner',
        status: 'active',
        expires_at: null,
      });
      return codeOfDecision(handmade({ admin_authority: revokedAuthority }), {
        scope: 'test',
        registry: fixture.registry,
      });
    },
  },
  {
    code: 'identity_issuer_unverified',
    label: 'إثبات لم يصدر من المصدر المحلي',
    run: () => codeOfDecision(handmade(), { scope: 'test' }),
  },
  {
    code: 'identity_registry_missing',
    label: 'إصدار بلا سجلّ هوية',
    run: () => codeOfThrow(() => issueLocalTestAttestation('cov-ident-owner', {} as never)),
  },
  {
    code: 'identity_unregistered',
    label: 'إصدار لهوية غير مسجَّلة',
    run: () =>
      codeOfThrow(() => {
        const fixture = freshFixture();
        return issueLocalTestAttestation('cov-ident-ghost', { registry: fixture.registry });
      }),
  },
  {
    code: 'identity_registry_mismatch',
    label: 'تعديل على إثبات مُصدَر',
    run: () => {
      const fixture = freshFixture();
      const attestation = issued(fixture);
      (attestation as { role: string }).role = 'agent';
      return codeOfDecision(attestation, { scope: 'test', registry: fixture.registry });
    },
  },
];

/** ⭐⭐⭐ **ملفات الاختبار التي تذكر الرمز** (مسح ثابت — ⭐ مرجع لا تنفيذ). */
function testFilesMentioning(code: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(TESTS_DIR)) {
    if (!entry.endsWith('.ts')) continue;
    const body = fs.readFileSync(path.join(TESTS_DIR, entry), 'utf8');
    if (body.includes(code)) out.push(entry);
  }
  return out.sort();
}

interface CoverageRow {
  readonly file: string;
  readonly line_pct: string;
  readonly branch_pct: string;
  readonly funcs_pct: string;
  readonly uncovered: string;
}

/** ⭐⭐⭐ **تحليل تقرير تغطية Node** (نصّي) — ⭐ بلا ادّعاء خارج المعطيات. */
function parseCoverage(reportPath: string): CoverageRow[] {
  const text = fs.readFileSync(reportPath, 'utf8');
  const rows: CoverageRow[] = [];
  for (const line of text.split('\n')) {
    if (!line.includes('|')) continue;
    const cells = line.split('|').map((cell) => cell.trim());
    if (cells.length < 5) continue;
    const file = cells[0];
    if (!file || file.startsWith('-')) continue;
    if (!/%|all files/i.test(file) && !/\d/.test(cells[1])) continue;
    rows.push({
      file,
      line_pct: cells[1] ?? '',
      branch_pct: cells[2] ?? '',
      funcs_pct: cells[3] ?? '',
      uncovered: cells[4] ?? '',
    });
  }
  return rows;
}

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

function main(): void {
  // ① القياس الحيّ لرموز الرفض.
  const declared = [...IDENTITY_CONTRACT_CODES];
  const produced = new Map<string, string>();
  for (const probe of PROBES) {
    let observed: string | null = null;
    try {
      observed = probe.run();
    } catch (error) {
      observed = `throw:${String(error)}`;
    }
    produced.set(probe.code, observed ?? '(بلا رمز)');
  }

  process.stdout.write('═'.repeat(96) + '\n');
  process.stdout.write('⭐ قياس التغطية — M57 (رموز الرفض: قياس حيّ · مرجع الاختبار: مسح ثابت)\n');
  process.stdout.write('═'.repeat(96) + '\n');
  process.stdout.write('الرمز | مُنتَج فعلياً (مقيس) | ملف(ات) الاختبار | الحكم\n');

  let reachable = 0;
  let referenced = 0;
  const notReachable: string[] = [];
  const notReferenced: string[] = [];

  for (const code of declared) {
    const observed = produced.get(code) ?? '(لم يُقَس)';
    const files = testFilesMentioning(code);
    const isReachable = observed === code;
    const hasTest = files.length > 0;
    if (isReachable) reachable += 1;
    else notReachable.push(`${code} (${observed})`);
    if (hasTest) referenced += 1;
    else notReferenced.push(code);
    const verdict = isReachable
      ? hasTest
        ? 'مُغطّى (مقيس)'
        : 'قابل للوصول · بلا مرجع اختبار'
      : 'مُعلَن بلا مسار وصول (مقيس)';
    process.stdout.write(
      `${code} | ${observed} | ${files.join(' · ') || '—'} | ${verdict}\n`,
    );
  }

  process.stdout.write('\n');
  process.stdout.write(
    `⭐ رموز الرفض المعلَنة: ${String(declared.length)} · القابلة للوصول (مقيس): ${String(reachable)} · ` +
      `ذات مرجع اختبار (مسح): ${String(referenced)}\n`,
  );
  if (notReachable.length > 0) {
    process.stdout.write(`⭐ بلا مسار وصول (مقيس): ${notReachable.join(' | ')}\n`);
  }
  if (notReferenced.length > 0) {
    process.stdout.write(`⭐ بلا مرجع اختبار (مسح): ${notReferenced.join(' | ')}\n`);
  }

  // ② تغطية الفروع (من تقرير Node — ⭐ إن وُجد الملف).
  const coveragePath = argValue('--coverage');
  if (coveragePath && fs.existsSync(coveragePath)) {
    const rows = parseCoverage(coveragePath);
    process.stdout.write('\n' + '─'.repeat(96) + '\n');
    process.stdout.write('⭐ تغطية الفروع (من تقرير Node) — ⭐ رقم **مختلف** عن تغطية المتطلبات الأمنية\n');
    process.stdout.write('─'.repeat(96) + '\n');
    process.stdout.write('الملف | line % | branch % | funcs % | أسطر الأسطر\n');
    for (const row of rows) {
      process.stdout.write(
        `${row.file} | ${row.line_pct} | ${row.branch_pct} | ${row.funcs_pct} | ${row.uncovered}\n`,
      );
    }
  } else {
    process.stdout.write('\n⚠️ لم يُمرَّر تقرير تغطية (‑‑coverage <ملف>) ⇒ لم تُقَس تغطية الفروع.\n');
  }

  process.stdout.write('\n');
  process.stdout.write(
    '⭐ الخلاصة (M57): ⭐ تغطية الفروع ≠ تغطية المتطلبات الأمنية ⇒ ⭐⇒⇒ **لا إعلان تغطية كاملة بلا الرقمين معاً.**\n',
  );
}

main();

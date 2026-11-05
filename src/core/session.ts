// ============================================================
// WASL AI — حدّ الثقة: مصادر الجلسات (المكوّن ٢ · الشريحة الأولى)
// ------------------------------------------------------------
// ⭐ هذا الملف هو الحدّ الفاصل بين «إدخال غير موثوق» و«سياق موثوق».
// ⛔ `authenticated: true` وحدها لا تُثبت صحة أي جلسة.
// ⛔ لا يُبنى سياق مستأجر معتمد إلا من ادّعاءات مرّت عبر مصدر جلسات.
// ⭐ المصادر:
//   ① `auth-middleware` — ⭐ **العقد جاهز والتنفيذ خارج نطاق الشريحة**:
//      طبقة المصادقة الحقيقية ستبني `SessionSource` بنفس العقد وتُعيد
//      الادّعاءات بعد تحقّقها أو ترفض (null) ⇒ ولا تُضاف أي صلاحية أخرى.
//   ② ⭐ **لا مصدر اختبار هنا** — ⛔ أدوات الاختبار في `tests/support/`
//      ⇒ خارج حزمة الإنتاج ⇒ ولا يمكن أن يعتمد عليها مسار إنتاجي.
// ============================================================

import {
  issueSessionAttestation,
  tenantContextFromSession,
  defaultNow,
  ACTOR_ID_PATTERN,
  SESSION_ID_PATTERN,
  TENANT_ID_PATTERN,
  TenantContextError,
  type SessionClaims,
  type SessionSourceId,
  type TenantContext,
} from './tenant.ts';

/**
 * ⭐ نطاق مصدر الجلسات.
 * ⛔ `test` = مصدر اختباري ⇒ أي مسار إنتاجي يرفضه بنيوياً.
 * ⭐ `production` = مصدر قادم من طبقة مصادقة حقيقية.
 */
export type SessionScope = 'production' | 'test';

/**
 * ⭐ عقد مصدر الجلسات — نقطة الالتقاء بين «المصادقة» و«النواة».
 * التنفيذ المستقبلي لطبقة المصادقة ينفّذ هذا العقد بالضبط.
 */
export interface SessionSource {
  readonly id: SessionSourceId;
  /** ⭐ نطاق المصدر — ⛔ مصدر نطاقه `test` لا يُبنى منه سياق إنتاجي. */
  readonly scope: SessionScope;
  readonly description: string;
  /** ⭐ يُعيد الادّعاءات بعد تحقّقها، أو `null` للرفض. */
  verify(input: unknown): SessionClaims | null;
}

/**
 * ⭐ المصادر الإنتاجية المسجَّلة — ⛔ **فارغة اليوم**.
 * ⛔ لا مصدر إنتاجي معتمد حتى تنفيذ طبقة المصادقة (`auth-middleware`) مستقبلاً.
 * ⛔ ⇒ لا يوجد أي مصدر افتراضي يمكن أن يعتمد عليه مسار إنتاجي بالخطأ.
 */
export const ACTIVE_SESSION_SOURCES: readonly SessionSource[] = Object.freeze([]);

/**
 * ⭐⭐ المسار العام الوحيد لإنشاء سياق مستأجر معتمد.
 * ⛔ لا يُصدَّق `authenticated: true` ولا أي حقل من المُدخل مباشرة.
 * ⛔ كل مُدخل يمرّ على مصدر جلسات، والمصدر هو من يُقرّر.
 * ⛔ **مصدر الجلسات إلزامي** — لا افتراض افتراضي (خصوصاً لا مصدر اختبار).
 */
export function resolveTenantContext(
  input: unknown,
  options: { now?: () => string; source?: SessionSource } = {},
): TenantContext {
  const source = options.source;
  if (!source) {
    throw new TenantContextError(
      'session_source_missing',
      'لا يوجد مصدر جلسات محدَّد — المسار العام لا يفترض أي مصدر ' +
        '(⇐ لا افتراض افتراضي لمصدر اختبار)',
    );
  }
  const claims = source.verify(input);
  if (!claims) {
    throw new TenantContextError(
      'session_unverified',
      `مصدر الجلسات «${source.id}» لم يوثّق المُدخل ⇒ لا يُبنى سياق مستأجر معتمد ` +
        '(و`authenticated: true` وحدها لا تُثبت صحة أي جلسة)',
    );
  }
  const now = options.now ?? defaultNow;
  const attestation = issueSessionAttestation(claims, source.id, now());
  return tenantContextFromSession(attestation, now);
}

/**
 * ⭐⭐ نقطة الدخول الإنتاجية — ⛔ ترفض أي مصدر نطاقه `test` بنيوياً.
 * ⇒ فلا يستطيع مسار إنتاجي أن يعتمد على جلسة اختبارية مهما استوردها.
 * ⛔ **لا تنشئ نظام تسجيل دخول هنا** — هذا حارس فقط، والتنفيذ في `auth-middleware`.
 */
export function resolveProductionTenantContext(
  input: unknown,
  source: SessionSource,
  options: { now?: () => string } = {},
): TenantContext {
  if (!source || source.scope !== 'production') {
    throw new TenantContextError(
      'session_source_not_production',
      `مصدر الجلسات «${source?.id ?? 'غير محدَّد'}» ليس إنتاجياً ⇒ لا يُبنى سياق إنتاجي منه`,
    );
  }
  return resolveTenantContext(input, { now: options.now, source });
}

// ⛔ `markLocalTestInput` و`localTestSessionSource` **ليسا هنا** —
//    ⭐ نُقلا إلى شجرة الاختبار ⇒ خارج حزمة الإنتاج
//    ⭐ والحاجز الثاني: `scope: 'test'` يرفضه `resolveProductionTenantContext`.

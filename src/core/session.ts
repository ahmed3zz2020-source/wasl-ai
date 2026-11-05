// ============================================================
// WASL AI — حدّ الثقة: مصادر الجلسات (المكوّن ٢ · الشريحة الأولى)
// ------------------------------------------------------------
// ⭐ هذا الملف هو الحدّ الفاصل بين «إدخال غير موثوق» و«سياق موثوق».
// ⛔ `authenticated: true` وحدها لا تُثبت صحة أي جلسة.
// ⛔ لا يُبنى سياق مستأجر معتمد إلا من ادّعاءات مرّت عبر مصدر جلسات.
// ⭐ المصادر:
//   ① `auth-middleware` — ⭐ **العقد جاهز والتنفيذ خارج نطاق الشريحة**:
//      طبقة المصادقة الحقيقية ستبني `SessionSource` بنفس العقد وتُعيد
//      الهوية بعد تحقّقها أو ترفض (null) ⇒ ولا تُضاف أي صلاحية أخرى.
//   ② ⭐ **لا مصدر اختبار هنا** — ⛔ أدوات الاختبار في `tests/support/`
//      ⇒ خارج حزمة الإنتاج ⇒ ولا يمكن أن يعتمد عليها مسار إنتاجي.
// ============================================================
// ⭐⭐⭐ **إصلاح حدّ الثقة (تصريح المالك · ٥ نوفمبر ٢٠٢٦ · D-055)**:
//   ⭐ **الثغرة**: ⭐ `SessionSource.verify` كان يُعيد ادّعاءات الجلسة كما هي ⇒
//     ⇒ ⇒⇒ **ومن ثمّ كان بإمكان مصدر أن يمرّر حمولة العميل كما هي فيمنح العميل
//     صلاحياته بنفسه** (أُثبت حيّاً في الجولة السابقة ⇒ ردّ #٢٣).
//   ⭐ **الإصلاح (ثلاثة ضوابط بنيوية — كل واحد له أثر مُختبَر)**:
//     ① ⭐ **سجلّ تسجيل معتمد** ⇒ ⭐ لا مصدر غير مسجَّل يبني سياقاً إطلاقاً
//        ⇒ ⇒ ⇒ **المصدر الساذج يُرفض قبل أي تفاعل مع المدخل**.
//     ② ⭐ **لا تمرير للحمولة** ⇒ ⭐ المصدر يبني «هوية موثّقة» جديدة ⇒
//        ⇒ ⇒ ⇒ **ومن ثمّ لا يمكن أن يحمل حقل `capabilities` ولا دوراً من العميل**.
//     ③ ⭐ **الصلاحيات = (دور · سقف) في النواة** ⇒ ⭐ الدور والسقف من **سجل
//        التسجيل المعتمد** (سلطة المالك) ⇒ ⇒ ⇒⇒ **مدخل العميل لا يملك أي
//        تأثير على الصلاحيات** ⇒ ⇒ ⇒⇒ **وإن كان الدور `none` ⇒ ⇒ ⇒⇒ صفر**.
//   ⛔ **وملاحظة إجرائية**: ⭐ اختلاف هوية الكائن (المدخل ≠ الخرج) **ليس
//     إثباتاً للثقة** ⇒ ⇒ ⭐ هو **مؤشّر خطر** (يُرفض) لا **دليل ثقة** ⇒
//     ⇒ ⇒⇒ **والدليل الفعلي = (١) التسجيل المعتمد + (٣) اشتقاق النواة**.
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
  type TrustedClaims,
  type VerifiedIdentity,
} from './tenant.ts';
import {
  isTrustedRole,
  normalizeCapabilities,
  resolveGrantedCapabilities,
  type TrustedRole,
} from './capability.ts';

/**
 * ⭐ نطاق مصدر الجلسات.
 * ⛔ `test` = مصدر اختباري ⇒ أي مسار إنتاجي يرفضه بنيوياً.
 * ⭐ `production` = مصدر قادم من طبقة مصادقة حقيقية.
 */
export type SessionScope = 'production' | 'test';

/**
 * ⭐⭐ عقد مصدر الجلسات — نقطة الالتقاء بين «المصادقة» و«النواة».
 * ⭐ **بعد إصلاح D-055**: ⭐ يُعيد **هوية موثّقة** (بلا صلاحيات وبلا دور).
 *
 * ⛔⭐⭐ **واجب إلزامي على `verify`**:
 *   ⛔ **لا يعيد ادّعاءات العميل كما هي** ⇒ ⭐ يبني كائن هوية **جديداً**.
 *   ⛔ **لا يمرّر `capabilities` ولا `role`** ⇒ ⭐ ⇒ ⇒ ولا يقول حقلونا في العقد.
 *   ⛔ **لا يقرأ الدور من حمولة العميل** ⇒ ⭐ ⇒ ⇒ **الدور من سجل التسجيل** (سلطة المالك).
 */
export interface SessionSource {
  readonly id: SessionSourceId;
  /** ⭐ نطاق المصدر — ⛔ مصدر نطاقه `test` لا يُبنى منه سياق إنتاجي. */
  readonly scope: SessionScope;
  readonly description: string;
  /**
   * ⭐ يُعيد الهوية الموثّقة بعد تحقّقه، أو `null` للرفض.
   * ⛔ **يجب أن يبني كائناً جديداً** — ⭐ لا تمرير حمولة العميل كما هي.
   * ⛔ **بلا صلاحيات وبلا دور** ⇒ ⭐ (الصلاحيات تُشتق في النواة).
   */
  verify(input: unknown): VerifiedIdentity | null;
}

/**
 * ⭐⭐⭐ تسجيل مصدر الجلسات المعتمد — ⭐ **سلطة المالك على ما يُمنح**.
 * ⭐ **لا يُبنى من مدخل العميل** ⇒ ⭐ ⇒ ⇒ **مدخل العميل لا يملك أي تأثير**.
 */
export interface SessionSourceRegistration {
  readonly source: SessionSource;
  /**
   * ⭐⭐ الدور الممنوح لهذا المصدر — ⭐ **سلطة المالك** (لا من مدخل العميل).
   * ⛔ `none` = ⭐ **بلا صلاحية** (الافتراضي = المنع).
   */
  readonly grantedRole: TrustedRole;
  /**
   * ⭐⭐ سقف الصلاحيات — ⭐ **ما لا يذكره السقف لا يُمنح أبداً**
   * ⇒ ⭐ ⇒ ⇒ **حتى لو كان الدور أعلى ⇒ ⇒ ⇒ السقف يبقى الحاكم**.
   */
  readonly grantCeiling: readonly string[];
}

/**
 * ⭐⭐ سجلّ التسجيل — ⭐ **خاص بالوحدة** ⇒ ⭐ ⛔ لا يُكتب من الخارج.
 * ⭐ مفتاحه = معرّف المصدر ⇒ ⭐ والتسجيل لازم يكون لنفس كائن المصدر تماماً.
 */
const SOURCE_REGISTRATIONS = new Map<string, SessionSourceRegistration>();

/**
 * ⭐⭐ تسجيل مصدر جلسات معتمد.
 * ⛔ **غير مُصدَّر من `index.ts`** (السطح العام) ⇒ ⭐ يُستدعى من تمهيد التطبيق
 *   ومن شجرة الاختبار فقط ⇒ ⇒ ⇒ **لا يمكن لعميل أن يسجّل مصدراً لنفسه**.
 * ⛔ التسجيل مرفوض إن كان الدور خارج المجموعة المغلقة أو السقف غير صالح.
 */
export function registerSessionSource(registration: SessionSourceRegistration): void {
  if (!registration || typeof registration !== 'object') {
    throw new TenantContextError('source_registration_invalid', 'تسجيل مصدر الجلسات مفقود');
  }
  const { source, grantedRole, grantCeiling } = registration;
  if (!source || typeof source !== 'object' || typeof source.id !== 'string') {
    throw new TenantContextError('source_registration_invalid', 'مصدر الجلسات غير صالح');
  }
  if (!isTrustedRole(grantedRole)) {
    throw new TenantContextError(
      'source_role_invalid',
      `دور المصدر «${source.id}» خارج المجموعة المغلقة ⇒ لا صلاحية`,
    );
  }
  const ceiling = normalizeCapabilities(grantCeiling);
  SOURCE_REGISTRATIONS.set(source.id, {
    source,
    grantedRole,
    grantCeiling: ceiling,
  });
}

/**
 * ⭐⭐ المصادر المسجَّلة نطاقها إنتاجي — ⭐ **لقطة حيّة** (الدالة لا ثابتة).
 * ⛔ **فارغة اليوم** ⇒ ⭐ ⇒ ⇒ **لا مصدر إنتاجي ⇒ لا مسار افتراضي**.
 * ⭐ (تُقرأ من `src/core/index.ts` كواجهة تشخيص ⇒ ⭐ ولا تكشف أي صلاحية).
 */
export function activeSessionSources(): readonly SessionSource[] {
  return Object.freeze(
    [...SOURCE_REGISTRATIONS.values()]
      .filter((registration) => registration.source.scope === 'production')
      .map((registration) => registration.source),
  );
}

/**
 * ⭐⭐⭐ المسار العام الوحيد لإنشاء سياق مستأجر معتمد.
 * ⛔ لا يُصدَّق `authenticated: true` ولا أي حقل من المُدخل مباشرة.
 * ⛔ كل مُدخل يمرّ على مصدر جلسات **مسجَّل**، والمصدر هو من يُقرّر.
 * ⛔ **مصدر الجلسات إلزامي** — لا افتراض افتراضي (خصوصاً لا مصدر اختبار).
 * ⛔ **ومصدر غير مسجَّل ⇒ رفض** ⇒ ⭐ (هذا هو الحارس البنيوي الأول).
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
  const registration = SOURCE_REGISTRATIONS.get(source.id);
  if (!registration || registration.source !== source) {
    throw new TenantContextError(
      'session_source_unregistered',
      `مصدر الجلسات «${source.id}» غير مسجَّل ⇒ لا يُبنى سياق مستأجر معتمد ` +
        '(⇐ التسجيل المعتمد هو سلطة المالك على ما يُمنح)',
    );
  }
  const identity = source.verify(input);
  if (!identity) {
    throw new TenantContextError(
      'session_unverified',
      `مصدر الجلسات «${source.id}» لم يوثّق المُدخل ⇒ لا يُبنى سياق مستأجر معتمد ` +
        '(و`authenticated: true` وحدها لا تُثبت صحة أي جلسة)',
    );
  }
  // ⭐⭐ الحارس البنيوي الثاني — ⛔ **ليس إثبات ثقة** ⭐ بل مؤشّر خطر ⇒ رفض.
  if (Object.is(identity, input)) {
    throw new TenantContextError(
      'session_claims_not_rebuilt',
      `مصدر الجلسات «${source.id}» أعاد حمولة المُدخل كما هي ⇒ لا يُبنى سياق ` +
        '(⇐ المصدر يبني هوية جديدة — لا تمرير لحمولة العميل)',
    );
  }
  // ⭐⭐⭐ الحارس البنيوي الثالث — ⭐ **الصلاحيات من النواة لا من المدخل**.
  const granted = resolveGrantedCapabilities(registration.grantedRole, registration.grantCeiling);
  const now = options.now ?? defaultNow;
  const claims: TrustedClaims = {
    session_id: identity.session_id,
    tenant_id: identity.tenant_id,
    actor_id: identity.actor_id,
    conversation_ref: identity.conversation_ref,
    authenticated: true,
    role: registration.grantedRole,
    capabilities: granted,
  };
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
// ⛔ و`registerSessionSource` **غير مُصدَّر من السطح العام** ⇒ ⭐
//    ⇒ ⇒ **العميل لا يستطيع تسجيل مصدر لنفسه** ⇒ ⇒ ⇒ **سلطة المالك وحده**.

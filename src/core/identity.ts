// ============================================================
// WASL AI — الهوية المحلية (Slice 08 · P0)
// ------------------------------------------------------------
// ⭐⭐⭐ **هذا ليس نظام مصادقة** ⇒ ⭐ نموذج أولي **محلي** لطبقة الهوية
//   والدور (Local Identity & Role Authorization Prototype).
// ⛔ بلا كلمات مرور · ⛔ بلا حسابات حقيقية · ⛔ بلا رموز مصادقة إنتاجية
//   · ⛔ بلا جلسات حقيقية · ⛔ بلا قاعدة بيانات · ⛔ بلا شبكة.
// ⭐ **المبدأ الحاكم**: ⭐ الهوية = (مستأجر · دور · حالة) **مسجَّلة من جهة
//   موثوقة** ⇒ ⭐⇒ **والدور يُشتق من السجلّ لا من مدخلات الطلب.**
// ⭐ **نطاق المصادر**: ⭐ كل مصدر هوية محلية نطاقه `test` ⇒ ⇒
//   ⇒ ⇒**المسار الإنتاجي يرفضها بنيوياً** (`resolveProductionTenantContext`).
// ⭐⭐ **إجابة M34 (مصدر صلاحية الإدارة)**: ⭐ «إثبات الأصل» بـ`WeakSet` يكفي
//   لقراءة نطاق إداري، ⭐ **لكنه لا يثبت الأحقية** ⇒ ⇒**فصّلنا الأمرين**:
//   ⭐ ① **سلطة الإدارة** = كائن بنَسَب مثبت **+mربوطة بهوية مالك مسجَّلة**
//   ⭐ ② **صلاحية العملية** = قرار منفصل في طبقة التفويض (يستعمل جدول النواة)
// ⭐⇒⇒ **فلا طبقة واحدة تفعل الاثنين معاً.**
// ============================================================

import { ACTOR_ID_PATTERN, TENANT_ID_PATTERN } from './tenant.ts';
import { isTrustedRole, type TrustedRole } from './capability.ts';

/** ⭐ نمط معرّف الهوية المحلية. */
export const LOCAL_IDENTITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/;

/** ⭐⭐ حالة الهوية — ⭐ مغلقة (لا قيمة خارجها). */
export type LocalIdentityStatus = 'active' | 'revoked';

/** ⭐⭐ هوية محلية — ⭐ **(مستأجر · دور · حالة)** ⇒ ⭐ محفوظة في السجلّ. */
export interface LocalIdentity {
  readonly identity_id: string;
  readonly tenant_id: string;
  readonly actor_id: string;
  readonly role: TrustedRole;
  readonly status: LocalIdentityStatus;
  /** ⭐ تاريخ الانتهاء (ISO) — ⭐ `null` = بلا انتهاء. */
  readonly expires_at: string | null;
}

/** ⭐ مدخل تسجيل هوية (قبل الحفظ). */
export interface LocalIdentityInput {
  readonly identity_id: string;
  readonly tenant_id: string;
  readonly actor_id: string;
  readonly role: TrustedRole;
  readonly expires_at?: string | null;
}

export class LocalIdentityError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'LocalIdentityError';
    this.code = code;
  }
}

/**
 * ⭐⭐⭐ **سلطة الإدارة المحلية** — ⭐ **نَسَب مثبت + هوية مالك**.
 * ⭐ تُصدر **داخل هذه الوحدة فقط** ⇒ ⇒**نسخة مزوَّرة مرفوضة بنيوياً.**
 * ⭐ ⭐ **ولا تكفي وحدها** ⇒ ⭐⇒ **السجلّ نفسه يعيد التحقّق**: ⭐ الهوية
 *   المصدِرة يجب أن تكون **مسجَّلة في هذا السجلّ · بدور `owner` · غير ملغاة
 *   وغير منتهية** ⇒ ⇒**فمن يُلغى أو تنتهي صلاحيته يفقد الأحقية فوراً.**
 */
export interface IdentityAdminAuthority {
  readonly kind: 'identity.admin';
  readonly identity_id: string;
}

/** ⭐ سجلّ السلطات — ⭐ خاصة بالوحدة ولا تُصدَّر. */
const ADMIN_AUTHORITIES = new WeakSet<object>();

/**
 * ⭐ إصدار سلطة إدارة — ⭐ **غير مُصدَّر من `index.ts`**.
 * ⛔ يُستدعى من طبقة التطبيق المحلية (المعاينة · شجرة الاختبار) فقط.
 */
export function issueIdentityAdminAuthority(identity: LocalIdentity): IdentityAdminAuthority {
  const authority: IdentityAdminAuthority = {
    kind: 'identity.admin',
    identity_id: identity.identity_id,
  };
  ADMIN_AUTHORITIES.add(authority);
  return authority;
}

/** ⭐⭐ فحص النَسَب — ⭐ **كائن مزوَّر = مرفوض**. */
export function isIdentityAdminAuthority(value: unknown): value is IdentityAdminAuthority {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'identity.admin' &&
    ADMIN_AUTHORITIES.has(value as object)
  );
}

function assertIdentityShape(input: LocalIdentityInput): void {
  if (!input || typeof input !== 'object') {
    throw new LocalIdentityError('identity_input_missing', 'مدخل الهوية مفقود');
  }
  if (!LOCAL_IDENTITY_ID_PATTERN.test(String(input.identity_id ?? ''))) {
    throw new LocalIdentityError('identity_id_invalid', 'معرّف الهوية غير صالح');
  }
  if (!TENANT_ID_PATTERN.test(String(input.tenant_id ?? ''))) {
    throw new LocalIdentityError('tenant_invalid', 'معرّف المستأجر غير صالح');
  }
  if (!ACTOR_ID_PATTERN.test(String(input.actor_id ?? ''))) {
    throw new LocalIdentityError('actor_invalid', 'معرّف المنفّذ غير صالح');
  }
  if (!isTrustedRole(input.role)) {
    throw new LocalIdentityError('role_invalid', 'الدور خارج المجموعة المغلقة');
  }
}

/**
 * ⭐⭐⭐ **سجلّ الهوية المحلي** — ⭐ **السلطة الوحيدة** على (المستأجر · الدور).
 * ⭐ ⭐ **قواعد ثابتة**:
 *   ⭐ ① **تسجيل واحد** ⇒ ⭐ لا تغيير دور ولا مستأجر ولا منفّذ بعد التسجيل.
 *   ⭐ ② **لا كتابة بلا سلطة** ⇒ ⭐ والسلطة يجب أن تكون **لهوية مالك فعّالة**.
 *   ⭐ ③ **التأسيس**: ⭐ أول هوية تُسجَّل هي **المالك نفسه** (دور `owner`).
 *   ⭐ ④ **لا إلغاء المالك الأخير الفعّال** (إلا يتعطّل سلطة الحكم).
 *   ⭐ ⑤ **القراءة تُعيد نسخة** ⇒ ⭐ لا تعديل من الخارج.
 */
/** ⭐⭐ عدّاد السجلّات — ⭐ (وحدة فقط) ⇒ ⭐ يميّز النسخ. */
let REGISTRY_COUNTER = 0;

export class LocalIdentityRegistry {
  readonly #identities = new Map<string, LocalIdentity>();
  readonly #now: () => string;
  /** ⭐⭐ معرّف النسخة — ⭐ **فريد داخل العملية** ⇒ ⭐ ⇒ مصادر الهوية تأخذ منه فلا تصادم بين سجلّين. */
  readonly instanceId: string;

  constructor(options: { now?: () => string } = {}) {
    this.#now = options.now ?? (() => new Date().toISOString());
    REGISTRY_COUNTER += 1;
    this.instanceId = `ident-${REGISTRY_COUNTER}`;
  }

  /** ⭐⭐ اللحظة الحالية من ساعة السجلّ نفسه ⇒ ⭐ (خطّ زمني واحد للتسجيل والتفويض). */
  currentTime(): string {
    return this.#now();
  }

  /** ⭐⭐⭐ إعادة التحقّق من **الأحقية** — ⭐ (مصدرُها السجلّ نفسه). */
  #assertEntitled(authority: IdentityAdminAuthority): LocalIdentity {
    if (!isIdentityAdminAuthority(authority)) {
      throw new LocalIdentityError('admin_authority_invalid', 'سلطة الإدارة غير صالحة');
    }
    const owner = this.#identities.get(authority.identity_id);
    if (!owner) {
      throw new LocalIdentityError(
        'admin_identity_unregistered',
        'هوية صاحب السلطة غير مسجَّلة في هذا السجلّ',
      );
    }
    if (owner.role !== 'owner') {
      throw new LocalIdentityError('admin_not_owner', 'هوية صاحب السلطة ليست بدور مالك');
    }
    if (owner.status !== 'active') {
      throw new LocalIdentityError('admin_revoked', 'سلطة الإدارة ملغاة');
    }
    if (this.#isExpired(owner, this.#now())) {
      throw new LocalIdentityError('admin_expired', 'صلاحية صاحب السلطة منتهية');
    }
    return owner;
  }

  #isExpired(identity: LocalIdentity, now: string): boolean {
    if (identity.expires_at === null || identity.expires_at === undefined) return false;
    const expiry = Date.parse(identity.expires_at);
    if (!Number.isFinite(expiry)) return false;
    return expiry <= Date.parse(now);
  }

  /**
   * ⭐⭐⭐ تسجيل هوية — ⭐ **يستلزم سلطة إدارة صالحة**.
   * ⭐ **تسجيل واحد** ⇒ ⭐ إعادة التسجيل لنفس المعرّف = نفس القيم أو رفض.
   */
  register(input: LocalIdentityInput, authority: IdentityAdminAuthority): LocalIdentity {
    assertIdentityShape(input);
    if (!isIdentityAdminAuthority(authority)) {
      throw new LocalIdentityError('admin_authority_invalid', 'سلطة الإدارة غير صالحة');
    }
    if (authority.identity_id !== input.identity_id) {
      // ⭐ ⭐التأسيس: ⭐ المالك يسجّل نفسه أو يسجّل غيره.
      this.#assertEntitled(authority);
    } else {
      // ⭐ ⭐ التأسيس: ⭐ لا سجلّ بعد ⇒ ⭐ لازم يكون المالك نفسه.
      if (this.#identities.size > 0) {
        this.#assertEntitled(authority);
      } else if (input.role !== 'owner') {
        throw new LocalIdentityError(
          'admin_bootstrap_requires_owner',
          'أول هوية مسجَّلة لازم تكون بدور المالك',
        );
      }
    }
    const existing = this.#identities.get(input.identity_id);
    if (existing) {
      if (existing.role !== input.role || existing.tenant_id !== input.tenant_id) {
        throw new LocalIdentityError(
          'identity_immutable',
          'الهوية مسجَّلة بدور أو مستأجر مختلف ⇒ لا تعديل',
        );
      }
      return existing;
    }
    const identity: LocalIdentity = {
      identity_id: input.identity_id,
      tenant_id: input.tenant_id,
      actor_id: input.actor_id,
      role: input.role,
      status: 'active',
      expires_at: input.expires_at ?? null,
    };
    this.#identities.set(identity.identity_id, identity);
    return identity;
  }

  /** ⭐⭐⭐ إلغاء هوية — ⭐ **يستلزم مالكاً فعّالاً** ⇒ ⭐ و⛔ لا إلغاء المالك الأخير. */
  revoke(identityId: string, authority: IdentityAdminAuthority): boolean {
    this.#assertEntitled(authority);
    const identity = this.#identities.get(identityId);
    if (!identity) {
      throw new LocalIdentityError('identity_unknown', 'الهوية غير مسجَّلة');
    }
    if (identity.status === 'revoked') return false;
    if (identity.role === 'owner') {
      const activeOwners = [...this.#identities.values()].filter(
        (row) => row.role === 'owner' && row.status === 'active',
      );
      if (activeOwners.length <= 1) {
        throw new LocalIdentityError(
          'cannot_revoke_last_owner',
          'لا يمكن إلغاء آخر مالك فعّال — يتعطّل الحكم الإداري',
        );
      }
    }
    this.#identities.set(identityId, { ...identity, status: 'revoked' });
    return true;
  }

  /** ⭐⭐⭐ قراءة هوية — ⭐ **نسخة** (لا تعديل من الخارج). */
  find(identityId: string): LocalIdentity | undefined {
    const identity = this.#identities.get(identityId);
    return identity ? { ...identity } : undefined;
  }

  /** ⭐⭐⭐ قائمة الهويات — ⭐ **تستلزم سلطة إدارة** (بيانات إدارية). */
  list(authority: IdentityAdminAuthority): readonly LocalIdentity[] {
    this.#assertEntitled(authority);
    return [...this.#identities.values()].map((identity) => ({ ...identity }));
  }

  /** ⭐⭐ عدد الهويات (تشخيص محلّي فقط — ⛔ بلا كشف تركيبة المستأجرين). */
  size(): number {
    return this.#identities.size;
  }

  /** ⭐⭐ هل انتهت صلاحية الهوية عند لحظة معيّنة؟ */
  isExpired(identityId: string, now: string = this.#now()): boolean {
    const identity = this.#identities.get(identityId);
    if (!identity) return true;
    return this.#isExpired(identity, now);
  }
}

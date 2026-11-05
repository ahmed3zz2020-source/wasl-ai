// ============================================================
// WASL AI — طبقة إدارة حالة المحادثة والإسناد المحلي (الشريحة الرابعة)
// ------------------------------------------------------------
// ⭐⭐ المبدأ الحاكم: تغيير حالة المحادثة = **عملية مُصرَّح بها داخل نطاق
//   مستأجر واحد** ⇒ ⭐ المستأجر من **سياق جلسة موثوق** ⇒ ⭐ والصلاحية تُفحص
//   **قبل** أي وصول ⇒ ⭐ والإسناد لموظف **داخل المستأجر نفسه**.
// ⛔ لا مدخل في أي دالة هنا يقبل معرّف مستأجر من العميل.
// ⛔ ومعرّف المحادثة ومعرّف الموظف **ليسا دليل حق وصول** ⇒ ⭐ يُفحصان.
// ⭐ الحالات الست + انتقالات مغلقة ⇒ ⭐ **أي انتقال غير مدرَّج = رفض صريح**
//   بصفر تغيير في الحالة.
// ⛔ لا ذكاء اصطناعي ولا CRM ولا إشعارات ولا قاعدة بيانات ولا نشر.
// ============================================================

import { assertCapability } from './capability.ts';
import { ACTOR_ID_PATTERN, CONVERSATION_REF_PATTERN } from './tenant.ts';
import type { TenantContext } from './tenant.ts';
import type { MessageStore } from './store.ts';
import type { ReadAuditLog } from './read-audit.ts';
import {
  assertChangeEntry,
  assertChangeReason,
  type ConversationChangeLog,
  type ConversationChangeEntry,
  type ConversationChangeInput,
  type ConversationChangeOperation,
} from './conversation-change-log.ts';
import { CONVERSATION_CHANGE_STATES } from './conversation-change-log.ts';

// ============================================================
// ⭐⭐ الصلاحيات الثلاث (مفصولة) — ⭐ **نمط الشريحة الثالثة**
// ============================================================

/** ⭐ صلاحية قراءة حالة المحادثة ومُسنَدها. */
export const CONVERSATION_STATE_READ_CAPABILITY = 'conversation.state.read';
/** ⭐ صلاحية تغيير الحالة (بانتقالات مسموحة فقط). */
export const CONVERSATION_STATE_UPDATE_CAPABILITY = 'conversation.state.update';
/** ⭐ صلاحية الإسناد ونقله وإلغاؤه. */
export const CONVERSATION_ASSIGN_CAPABILITY = 'conversation.assign';

/** ⭐⭐ أسماء عمليات الحالة — ⭐ **مجموعة مغلقة**. */
export const CONVERSATION_STATE_OPERATIONS = [
  'conversation.state.read',
  'conversation.state.update',
  'conversation.assign',
  'conversation.changes',
] as const;

export type ConversationStateOperation = (typeof CONVERSATION_STATE_OPERATIONS)[number];

// ============================================================
// ⭐⭐ الحالات والانتقالات (قائمة مغلقة)
// ============================================================

/** ⭐⭐ الحالات الست — ⭐ **مجموعة مغلقة**. */
export const CONVERSATION_STATES = CONVERSATION_CHANGE_STATES;

export type ConversationState = (typeof CONVERSATION_STATES)[number];

/**
 * ⭐⭐⭐ الانتقالات المسموحة — ⭐⭐ **خريطة مغلقة** (١٢ انتقالاً — بعد `D-056`).
 * ⭐⭐ `closed` = **نهائية** ⇒ ⭐⭐ **لا انتقال إليها من أي حالة** ⇒ ⭐⭐ **ولا إسناد ولا تعديل حالة ولا إعادة موظف بعد الإغلاق**.
 * ⭐⭐ **الإغلاق** (تصريح المالك — `D-056`): ⭐⭐ `resolved ⇒ closed` هو الإغلاق الوحيد ⇒ ⭐⭐ وليس إغلاقً من حالة أخرى ⇒ ⭐⭐ ولا تعديل لمحادثة مغلقة بعد الإغلاق.
 */
export const ALLOWED_TRANSITIONS: Readonly<
  Record<ConversationState, readonly ConversationState[]>
> = Object.freeze({
  new: Object.freeze(['open']),
  open: Object.freeze(['assigned', 'pending', 'resolved']),
  assigned: Object.freeze(['open', 'pending', 'resolved', 'assigned']),
  pending: Object.freeze(['assigned', 'resolved']),
  resolved: Object.freeze(['open', 'closed']),
  closed: Object.freeze([]),
});

/**
 * ⭐⭐ الحالات النهائية — ⭐⭐ **مجموعة مغلقة**.
 * ⭐⭐ حالة `closed` انتهاء من كل طريق ⇒ ⭐⭐ ولا تُعدَّل ولا تُسند.
 */
export const TERMINAL_CONVERSATION_STATES: readonly ConversationState[] = Object.freeze(['closed']);

/**
 * ⭐⭐ فحص النهائية — ⭐⭐ **الحالة لا تُعدَّل ولا تُسند منها**.
 */
export function isTerminalState(state: ConversationState): boolean {
  return TERMINAL_CONVERSATION_STATES.includes(state);
}

/** ⭐⭐ حالة المحادثة كما يراها المستخدم. */
export interface ConversationStateView {
  readonly conversation_ref: string;
  readonly state: ConversationState;
  /** ⭐ الموظف المسنَد — ⭐ `null` = بلا إسناد. */
  readonly assignee_actor_id: string | null;
  readonly updated_at: string;
  /** ⭐⭐ رقم النسخة — ⭐ **كاشف التعارض** (تحديث متفائل). */
  readonly version: number;
}

/** ⭐⭐ سجلّ الحالات (في الذاكرة) — ⭐ **معزول بالمستأجر بنيوياً**. */
export class ConversationStateStore {
  readonly #rows: Map<string, Map<string, ConversationStateView>> = new Map();
  readonly #now: () => string;

  constructor(options: { now?: () => string } = {}) {
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  /** ⭐ قراءة حالة — ⭐ **لنطاق مستأجر واحد فقط**. */
  get(tenantId: string, conversationRef: string): ConversationStateView | undefined {
    const row = this.#rows.get(tenantId)?.get(conversationRef);
    return row ? { ...row } : undefined;
  }

  /**
   * ⭐ إنشاء صف الحالة (لو لم يوجد) — ⭐ الحالة الابتدائية `new`.
   * ⭐ **لا يُنشئ صفاً لمحادثة لا تخص المستأجر** ⇒ ⭐ (الم existence يُفحص قبل).
   */
  ensure(tenantId: string, conversationRef: string): ConversationStateView {
    const existing = this.get(tenantId, conversationRef);
    if (existing) return existing;
    const row: ConversationStateView = {
      conversation_ref: conversationRef,
      state: 'new',
      assignee_actor_id: null,
      updated_at: this.#now(),
      version: 1,
    };
    const tenantRows = this.#rows.get(tenantId) ?? new Map<string, ConversationStateView>();
    tenantRows.set(conversationRef, row);
    this.#rows.set(tenantId, tenantRows);
    return { ...row };
  }

  /** ⭐⭐ تحديث الحالة — ⭐ **ما لم تتغيّر حالة أخرى** (كاشف التعارض). */
  setState(
    tenantId: string,
    conversationRef: string,
    next: { state: ConversationState; assignee: string | null; expectedVersion?: number },
  ): ConversationStateView {
    const current = this.get(tenantId, conversationRef);
    if (!current) {
      throw new ConversationStateError('conversation_not_found', 'لا يوجد صف حالة لهذه المحادثة');
    }
    if (next.expectedVersion !== undefined && next.expectedVersion !== current.version) {
      throw new ConversationStateError(
        'state_conflict',
        'الحالة تغيّرت قبل هذا التعديل ⇒ أُلغي (لا الكتابة فوق تغيير آخر)',
      );
    }
    const row: ConversationStateView = {
      conversation_ref: conversationRef,
      state: next.state,
      assignee_actor_id: next.assignee,
      updated_at: this.#now(),
      version: current.version + 1,
    };
    const tenantRows = this.#rows.get(tenantId) ?? new Map<string, ConversationStateView>();
    tenantRows.set(conversationRef, row);
    this.#rows.set(tenantId, tenantRows);
    return { ...row };
  }

  /**
   * ⭐⭐⭐ تراجع مُعوَّض — ⭐ **يستعيد الصف السابق تماماً** (بلا أثر في السجل).
   * ⭐⭐ **يُستخدم فقط عند فشل تسجيل التغيير** ⇒ ⇒ ⇒ **لا تغيير حالة بلا سجل**.
   * ⛔ لا يُنشئ صفاً ولا يحذف شيئاً — ⭐ يستعيد ما كان موجوداً فقط.
   */
  restore(
    tenantId: string,
    conversationRef: string,
    previous: ConversationStateView,
  ): void {
    const tenantRows = this.#rows.get(tenantId);
    if (!tenantRows || !tenantRows.has(conversationRef)) return;
    tenantRows.set(conversationRef, { ...previous });
  }

  /**
   * ⭐⭐⭐ تجاهل صف لم يكن موجوداً — ⭐ **يُستخدم مع التراجع المعوَّض**
   * ⭐ (حين أُنشئ الصف لأول مرة في محاولة فاشلة ⇒ ⇒ يُحذف ⇒ ⇒ ولا أثر).
   */
  discard(tenantId: string, conversationRef: string): void {
    this.#rows.get(tenantId)?.delete(conversationRef);
  }

  /** ⭐ عدد الصفوف لمستخدم واحد — ⭐ (تشخيص محلي فقط). */
  sizeFor(tenantId: string): number {
    return this.#rows.get(tenantId)?.size ?? 0;
  }
}

// ============================================================
// ⭐⭐ الأخطاء (أكواد معلنة — ⭐ لا تسريب لوجود بيانات مستأجر آخر)
// ============================================================

export class ConversationStateError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ConversationStateError';
    this.code = code;
  }
}

/**
 * ⭐⭐⭐ دليل الموظفين — ⭐ **سلطة خارجية موثوقة** (يوفّرها التطبيق).
 * ⛔ **لا يُبنى في هذه الطبقة** ⇒ ⭐ ولا نظام مستخدمين إنتاجي.
 * ⛔ **لا معرّفات من العميل** ⇒ ⭐ ⇒⇒ المعيار هو نطاق المستأجر لا المُدخل.
 */
export interface EmployeeDirectory {
  /** ⭐ هل الموظف داخل نطاق هذا المستأجر؟ */
  isEmployee(tenantId: string, actorId: string): boolean;
}

export interface ConversationStateDependencies {
  /** ⭐ مصدر وجود المحادثة — ⭐ (المخزن الحصري بالمستأجر). */
  readonly store: MessageStore;
  /** ⭐ تخزين الحالة والإسناد. */
  readonly states: ConversationStateStore;
  /** ⭐ سجل التغييرات — ⭐ إلزامي (كل تغيير موثّق). */
  readonly changes: ConversationChangeLog;
  /** ⭐ سجل أحداث القراءة — ⭐ لتوثيق المحاولات المرفوضة. */
  readonly readAudit: ReadAuditLog;
  /** ⭐ دليل الموظفين — ⭐ إلزامي (لا إسناد بلا سلطة). */
  readonly employees: EmployeeDirectory;
}

// ============================================================
// ⭐⭐⭐ الأدوات الداخلية
// ============================================================

function isConversationState(value: unknown): value is ConversationState {
  return typeof value === 'string' && (CONVERSATION_STATES as readonly string[]).includes(value);
}

function isTransitionAllowed(from: ConversationState, to: ConversationState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

function auditDenied(
  context: TenantContext,
  operation: ConversationStateOperation,
  capability: string,
  deps: ConversationStateDependencies,
  target: string,
): void {
  deps.readAudit.record({
    tenant_id: context.tenantId,
    actor_id: context.actorId,
    operation,
    capability,
    result: 'denied',
    target,
  });
}

/**
 * ⭐⭐⭐ وجود المحادثة — ⭐ **ضمن نطاق المستأجر فقط**.
 * ⛔ محادثة لا تخص المستأجر ⇒ ⭐ **نفس الرمز** (لا كشف وجود) ⇒ ⭐ صفر تسريب.
 */
function requireConversation(
  context: TenantContext,
  conversationRef: string,
  deps: ConversationStateDependencies,
): void {
  const exists = deps.store.messagesForConversation(context, conversationRef).length > 0;
  if (!exists) {
    throw new ConversationStateError(
      'conversation_not_found',
      'لا توجد محادثة بهذا المعرّف في نطاق المستأجر',
    );
  }
}

function requireCapability(
  context: TenantContext,
  capability: string,
  operation: ConversationStateOperation,
  deps: ConversationStateDependencies,
  target: string,
): void {
  try {
    assertCapability(context, capability);
  } catch (error) {
    auditDenied(context, operation, capability, deps, target);
    throw error;
  }
}

/**
 * ⭐⭐⭐⭐⭐ **الالتزام الذرّي** — ⭐ **تعديل الحالة + سجل التغيير أو لا شيء**.
 * ⭐ **الترتيب**: ⭐ (١) تحقّق كامل من مدخل السجل **قبل** أي كتابة ⇒
 *   (٢) إنشاء صف الحالة (إن لم يكن موجوداً) ⇒ (٣) تعديل الحالة ⇒
 *   (٤) تسجيل التغيير ⇒ ⭐ ولو فشل (٤) ⇒
 *   ⭐ **تراجع مُعوَّض** ⇒ ⇒ ⇒ **النتيجة: لا تغيير حالة ولا إسناد بلا سجل تغيير مطابق**.
 * ⭐ **سبب التراجع**: ⭐ لو فشل التسجيل (فشل كتابة دائم مثلاً) ⇒ كانت الحالة
 *   تغيّرت وتغيّرها بلا أثر في أي سجل ⇒ ⇒ **التراجع يُبطل ذلك بالكامل**.
 * ⛔ التراجع **لا يُسجّل** (لأنه لا تغيير في النهاية) ⇒ ⇒ ولا سجل بلا تغيير.
 *
 * ⭐⭐⭐ **حدود الضمان (C4 · تصريح ٥ نوفمبر ٢٠٢٦)** — ⭐ الضمان **محليّ**
 *   ويعتمد على **افتراضين مُصمَّمين**:
 *   ⭐ **① التشغيل متسلسل**: ⭐ المسار **بلا `await`** ⇒ ⇒ فلا تداخل بين
 *     الكتابة والتسجيل (حدث واحد = نداء متزامن) ⇒ ⇒ **لو أُضيف `await`
 *     (مثلاً لربط سجل دائم) ⇒ يفقد التراجع أمانه** ⇒⇒⇒ **ولذلك حارس
 *     اختبار** في `tests/conversation-atomicity.test.ts` **يُسقط الاختبار
 *     فور ظهور `await` داخل `commitStateChange` أو داخل سجل التغييرات**.
 *   ⭐ **② التخزين في الذاكرة**: ⭐ مخزن الحالة وسجل التغييرات **خرائط في
 *     الذاكرة** ⇒ ⇒ **التراجع يُعيد ما لم يعد موجوداً** ⇒⇒⇒ **فلا يُعلن
 *     ضمان معاملات إنتاجية (Transaction)**.
 * ⛔ **الانتقال إلى تخزين دائم أو تنفيذ متزامن** ⇒ ⇒ **مراجعة + تصريح
 *   مستقل من المالك** ⇒ ⇒ ولا يُفترض ضمن هذا التصريح.
 */
function commitStateChange(
  context: TenantContext,
  conversationRef: string,
  current: ConversationStateView,
  existedBefore: boolean,
  next: { state: ConversationState; assignee: string | null; expectedVersion?: number },
  input: ConversationChangeInput,
  deps: ConversationStateDependencies,
): ConversationStateView {
  // ⭐⬀ (١) كل فحوص السجل قبل أي كتابة ⇒ ⇒ لا كتابة على مدخل مرفوض
  // (ولا حتى إنشاء صف الحالة ⇒ ⇒ ولا أثر متبقٍّ بعد الرفض).
  assertChangeEntry(input);
  // ⭐ (٢) صف الحالة — ⭐ **بعد** كل الفحوص ⇒ ⇒ رفضٌ لا يترك صفاً خلفه.
  deps.states.ensure(context.tenantId, conversationRef);
  const updated = deps.states.setState(context.tenantId, conversationRef, next);
  try {
    // ⭐ (٤) تسجيل التغيير — ⭐ نفس المدخل الذي تحقّق منه قبل الكتابة.
    deps.changes.record(input);
  } catch (error) {
    // ⭐⬀ (٤ب) تراجع مُعوَّض ⇒ ⇒ **لا تغيير بلا سجل**.
    if (existedBefore) {
      deps.states.restore(context.tenantId, conversationRef, current);
    } else {
      deps.states.discard(context.tenantId, conversationRef);
    }
    throw error;
  }
  return updated;
}

/**
 * ⭐⭐ الحالة الابتدائية — ⭐ **للمحادثة التي لا يوجد لها صف بعد**.
 * ⭐ تُستخدم **قبل** إنشاء الصف ⇒ ⇒ **فحص بحت بلا أثر** ⇒ ⇒ ورفضٌ لا يترك أثراً.
 */
function initialConversationState(conversationRef: string): ConversationStateView {
  return {
    conversation_ref: conversationRef,
    state: 'new',
    assignee_actor_id: null,
    updated_at: '',
    version: 0,
  };
}

// ============================================================
// ⭐⭐⭐ العمليات العامة
// ============================================================

/**
 * ⭐⭐⭐ قراءة حالة المحادثة ومُسنَدها.
 * ⛔ **الفحص قبل أي وصول** ⇒ ⭐ بلا صلاحية = رفض صريح بلا تسريب.
 */
export function getConversationState(
  context: TenantContext,
  conversationRef: string,
  deps: ConversationStateDependencies,
): ConversationStateView {
  if (!CONVERSATION_REF_PATTERN.test(conversationRef)) {
    throw new ConversationStateError('conversation_ref_invalid', 'معرّف المحادثة غير صالح');
  }
  requireCapability(
    context,
    CONVERSATION_STATE_READ_CAPABILITY,
    'conversation.state.read',
    deps,
    conversationRef,
  );
  requireConversation(context, conversationRef, deps);
  const row = deps.states.ensure(context.tenantId, conversationRef);
  deps.readAudit.record({
    tenant_id: context.tenantId,
    actor_id: context.actorId,
    operation: 'conversation.state.read',
    capability: CONVERSATION_STATE_READ_CAPABILITY,
    result: 'allowed',
    target: conversationRef,
  });
  return { ...row };
}

/**
 * ⭐⭐⭐ تغيير حالة المحادثة — ⭐ **بانتقالات مسموحة فقط**.
 * ⛔ `to = 'assigned'` ⇒ ⭐ **مرفوض دائماً** ⇒ ⭐ (الإسناد شرط لا أثر جانبي ⇒
 *   الإسناد عبر `assignConversation` وحده).
 * ⛔ `resolved ⇒ open` ⇒ ⭐ **سبب مُسجَّل إلزامي**.
 * ⛔ `expectedVersion` ⇒ ⭐ كاشف تعارض (لا الكتابة فوق تغيير آخر).
 */
export function updateConversationState(
  context: TenantContext,
  conversationRef: string,
  to: ConversationState,
  deps: ConversationStateDependencies,
  options: { reason?: string; expectedVersion?: number } = {},
): ConversationStateView {
  if (!CONVERSATION_REF_PATTERN.test(conversationRef)) {
    throw new ConversationStateError('conversation_ref_invalid', 'معرّف المحادثة غير صالح');
  }
  requireCapability(
    context,
    CONVERSATION_STATE_UPDATE_CAPABILITY,
    'conversation.state.update',
    deps,
    conversationRef,
  );
  if (!isConversationState(to)) {
    throw new ConversationStateError('state_invalid', 'الحالة المطلوبة خارج المجموعة المغلقة');
  }
  requireConversation(context, conversationRef, deps);
  // ⭐⭐ قراءة بحت — ⭐ **بدون إنشاء صف** ⇒ ⇒ رفضٌ لا يترك أثراً.
  const existedBefore = deps.states.get(context.tenantId, conversationRef) !== undefined;
  const current = existedBefore
    ? (deps.states.get(context.tenantId, conversationRef) as ConversationStateView)
    : initialConversationState(conversationRef);

  // ⭐⬀ حارس النهائية — ⭐ المحادثة المغلقة لا تُعدل ولا تُسند (ولا حتى إغلاقً مريرًاً).
  if (isTerminalState(current.state)) {
    throw new ConversationStateError(
      'state_terminal',
      `المحادثة مغلقة (${current.state}) ⇒ لا تغيير ولا إسناد`,
    );
  }

  if (to === 'assigned') {
    throw new ConversationStateError(
      'transition_requires_assignee',
      'الانتقال إلى «مسندة» يتم عبر الإسناد وحده (شرط لا أثر جانبي)',
    );
  }
  if (!isTransitionAllowed(current.state, to)) {
    throw new ConversationStateError(
      'transition_not_allowed',
      `انتقال غير مسموح: ${current.state} ⇒ ${to}`,
    );
  }
  const reason = options.reason ?? '';
  // ⭐⬀ فحص السبب **قبل أي معاملة الحالة** ⇒ ⬀ لا تموت قابل أو تسجيل السبب.
  assertChangeReason(reason);
  if (current.state === 'resolved' && to === 'open' && reason.trim() === '') {
    throw new ConversationStateError(
      'transition_requires_reason',
      'إعادة الفتح تتطلّب سبباً مُسجَّلاً',
    );
  }
  // ⭐ «open» = غير مسندة ⇒ ⇒ الإسناد يُلغى تلقائياً عند الانتقال إليها.
  const assignee = to === 'open' ? null : current.assignee_actor_id;
  // ⭐⭐⭐ التزام ذرّي — ⭐ تعديل الحالة + سجل التغيير أو لا شيء.
  const updated = commitStateChange(
    context,
    conversationRef,
    current,
    existedBefore,
    {
      state: to,
      assignee,
      ...(options.expectedVersion === undefined ? {} : { expectedVersion: options.expectedVersion }),
    },
    {
      tenant_id: context.tenantId,
      actor_id: context.actorId,
      operation: 'state.update',
      conversation_ref: conversationRef,
      from_state: current.state,
      to_state: to,
      reason,
      assignee_from: current.assignee_actor_id,
      assignee_to: assignee,
    },
    deps,
  );
  deps.readAudit.record({
    tenant_id: context.tenantId,
    actor_id: context.actorId,
    operation: 'conversation.state.update',
    capability: CONVERSATION_STATE_UPDATE_CAPABILITY,
    result: 'allowed',
    target: conversationRef,
  });
  return updated;
}

/**
 * ⭐⭐⭐ إسناد المحادثة لموظف — ⭐ **داخل المستأجر نفسه فقط**.
 * ⛔ **الموظف من دليل الموظفين** (سلطة موثوقة) ⇒ ⭐ لا معرّف من العميل يُعتمد.
 * ⛔ **موظف من مستأجر آخر ⇒ نفس رمز الرفض** (لا كشف وجود).
 * ⛔ إسناد لنفس الموظف ⇒ ⭐ رفض صريح (لا صمت).
 */
export function assignConversation(
  context: TenantContext,
  conversationRef: string,
  assigneeActorId: string,
  deps: ConversationStateDependencies,
  options: { reason?: string } = {},
): ConversationStateView {
  if (!CONVERSATION_REF_PATTERN.test(conversationRef)) {
    throw new ConversationStateError('conversation_ref_invalid', 'معرّف المحادثة غير صالح');
  }
  requireCapability(context, CONVERSATION_ASSIGN_CAPABILITY, 'conversation.assign', deps, conversationRef);
  if (typeof assigneeActorId !== 'string' || !ACTOR_ID_PATTERN.test(assigneeActorId)) {
    throw new ConversationStateError('assignee_invalid', 'معرّف الموظف غير صالح');
  }
  requireConversation(context, conversationRef, deps);
  // ⭐⭐ قراءة بحت — ⭐ **بدون إنشاء صف** ⇒ ⇒ رفضٌ لا يترك أثراً.
  const existedBefore = deps.states.get(context.tenantId, conversationRef) !== undefined;
  const current = existedBefore
    ? (deps.states.get(context.tenantId, conversationRef) as ConversationStateView)
    : initialConversationState(conversationRef);

  // ⭐⬀ حارس النهائية — ⭐ لا إسناد لمحادثة مغلقة أبداً.
  if (isTerminalState(current.state)) {
    throw new ConversationStateError(
      'state_terminal',
      `المحادثة مغلقة (${current.state}) ⇒ لا إسناد`,
    );
  }

  if (!deps.employees.isEmployee(context.tenantId, assigneeActorId)) {
    throw new ConversationStateError(
      'assignee_not_in_tenant',
      'الموظف غير موجود في نطاق المستأجر ⇒ لا إسناد',
    );
  }
  if (!isTransitionAllowed(current.state, 'assigned')) {
    throw new ConversationStateError(
      'transition_not_allowed',
      `انتقال غير مسموح: ${current.state} ⇒ assigned`,
    );
  }
  if (current.assignee_actor_id === assigneeActorId) {
    throw new ConversationStateError(
      'assignment_unchanged',
      'المحادثة مسندة للموظف نفسه ⇒ لا تغيير (رفض صريح لا صمت)',
    );
  }
  // ⭐⬀ فحص السبب قبل أي معاملة الإسناد.
  assertChangeReason(options.reason ?? '');
  const operation: ConversationChangeOperation =
    current.state === 'assigned' ? 'assignment.transfer' : 'assignment.set';
  // ⭐⭐⭐ التزام ذرّي — ⭐ إسناد + سجل التغيير أو لا شيء.
  const updated = commitStateChange(
    context,
    conversationRef,
    current,
    existedBefore,
    { state: 'assigned', assignee: assigneeActorId },
    {
      tenant_id: context.tenantId,
      actor_id: context.actorId,
      operation,
      conversation_ref: conversationRef,
      from_state: current.state,
      to_state: 'assigned',
      reason: options.reason ?? '',
      assignee_from: current.assignee_actor_id,
      assignee_to: assigneeActorId,
    },
    deps,
  );
  deps.readAudit.record({
    tenant_id: context.tenantId,
    actor_id: context.actorId,
    operation: 'conversation.assign',
    capability: CONVERSATION_ASSIGN_CAPABILITY,
    result: 'allowed',
    target: conversationRef,
  });
  return updated;
}

/**
 * ⭐⭐⭐ إلغاء الإسناد — ⭐ (`assigned ⇒ open`).
 * ⛔ إن لم تكن مسندة ⇒ ⭐ رفض صريح.
 */
export function unassignConversation(
  context: TenantContext,
  conversationRef: string,
  deps: ConversationStateDependencies,
  options: { reason?: string } = {},
): ConversationStateView {
  if (!CONVERSATION_REF_PATTERN.test(conversationRef)) {
    throw new ConversationStateError('conversation_ref_invalid', 'معرّف المحادثة غير صالح');
  }
  requireCapability(context, CONVERSATION_ASSIGN_CAPABILITY, 'conversation.assign', deps, conversationRef);
  requireConversation(context, conversationRef, deps);
  // ⭐⭐ قراءة بحت — ⭐ **بدون إنشاء صف** ⇒ ⇒ رفضٌ لا يترك أثراً.
  const existedBefore = deps.states.get(context.tenantId, conversationRef) !== undefined;
  const current = existedBefore
    ? (deps.states.get(context.tenantId, conversationRef) as ConversationStateView)
    : initialConversationState(conversationRef);
  // ⭐⬀ حارس النهائية — ⭐ لا إلغاء إسناد لمحادثة مغلقة.
  if (isTerminalState(current.state)) {
    throw new ConversationStateError(
      'state_terminal',
      `المحادثة مغلقة (${current.state}) ⇒ لا إلغاء إسناد`,
    );
  }
  if (current.state !== 'assigned' || current.assignee_actor_id === null) {
    throw new ConversationStateError(
      'transition_not_allowed',
      `المحادثة غير مسندة ⇒ لا إلغاء إسناد (الحالة: ${current.state})`,
    );
  }
  // ⭐⭐⭐ التزام ذرّي — ⭐ إلغاء الإسناد + سجل التغيير أو لا شيء.
  const updated = commitStateChange(
    context,
    conversationRef,
    current,
    existedBefore,
    { state: 'open', assignee: null },
    {
      tenant_id: context.tenantId,
      actor_id: context.actorId,
      operation: 'assignment.clear',
      conversation_ref: conversationRef,
      from_state: 'assigned',
      to_state: 'open',
      reason: options.reason ?? '',
      assignee_from: current.assignee_actor_id,
      assignee_to: null,
    },
    deps,
  );
  deps.readAudit.record({
    tenant_id: context.tenantId,
    actor_id: context.actorId,
    operation: 'conversation.assign',
    capability: CONVERSATION_ASSIGN_CAPABILITY,
    result: 'allowed',
    target: conversationRef,
  });
  return updated;
}

/** ⭐⭐ صفحة سجل التغييرات — ⭐ **معزولة بالمستأجر + الصلاحية**. */
export interface ConversationChangePage {
  readonly conversation_ref: string;
  readonly entries: readonly ConversationChangeEntry[];
  readonly pagination: { readonly limit: number; readonly returned: number; readonly total: number; readonly next_cursor: string | null };
}

/** ⭐ أقصى حجم صفحة في سجل التغييرات. */
export const MAX_CHANGE_PAGE_SIZE = 100;

/**
 * ⭐⭐⭐ قراءة سجل تغييرات محادثة — ⭐ **معزولة بالمستأجر** (نمط الشريحة الثالثة).
 * ⛔ بلا `entries()` غير المعزولة ⇒ ⭐ العزل بنيوي.
 */
export function readConversationChanges(
  context: TenantContext,
  conversationRef: string,
  deps: ConversationStateDependencies,
  options: { limit?: number; cursor?: string } = {},
): ConversationChangePage {
  if (!CONVERSATION_REF_PATTERN.test(conversationRef)) {
    throw new ConversationStateError('conversation_ref_invalid', 'معرّف المحادثة غير صالح');
  }
  requireCapability(
    context,
    CONVERSATION_STATE_READ_CAPABILITY,
    'conversation.changes',
    deps,
    conversationRef,
  );
  const limit = Math.min(
    options.limit === undefined ? 50 : Math.max(1, Math.floor(options.limit)),
    MAX_CHANGE_PAGE_SIZE,
  );
  const all = deps.changes.changesFor(context, conversationRef);
  let start = 0;
  if (options.cursor !== undefined) {
    const parsed = Number.parseInt(options.cursor, 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new ConversationStateError('cursor_invalid', 'مؤشر الصفحات غير صالح');
    }
    start = parsed;
  }
  const page = all.slice(start, start + limit);
  const next =
    start + page.length < all.length && page.length > 0 ? String(start + page.length) : null;
  deps.readAudit.record({
    tenant_id: context.tenantId,
    actor_id: context.actorId,
    operation: 'conversation.changes',
    capability: CONVERSATION_STATE_READ_CAPABILITY,
    result: 'allowed',
    target: conversationRef,
    count: page.length,
  });
  return {
    conversation_ref: conversationRef,
    entries: page,
    pagination: { limit, returned: page.length, total: all.length, next_cursor: next },
  };
}

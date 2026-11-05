// ============================================================
// WASL AI — مركز عمل الوكيل (الشريحة الخامسة)
// ------------------------------------------------------------
// ⭐⭐ **قراءة فقط فوق الشريحتين ٣ و ٤** ⇒ ⭐ لا تُنشأ حالة ولا يُسند ولا
//   يُعدَّل سجل تغييرات ⇒ ⭐ **الشريحة لا توسّع سطح الكتابة**.
// ⛔ **بلا نص رسائل** ⇒ ⭐ المخرجات: معرّفات + أرقام + توقيتات فقط.
// ⭐ **عزل بالمستأجر** ⇒ ⭐ والصلاحية تُفحص **قبل** أي وصول.
// ⭐ **نطاق الجمهور (قرار المالك · ٥ نوفمبر ٢٠٢٦)**: ⭐ «الموظف يرى محادثاته
//   فقط» · ⭐ «المشرف يرى طابور فريق شركته» ⇒ ⭐ **الفصل بنطاق الدور**.
// ⭐ **معيار الخمول**: ⭐ **٣٠ دقيقة** (افتراضي — قابل للضبط بالمعامل). ⭐ ⛔ **ليس** معيار تأخّر العميل.
// ⛔ لا اتصال خارجي · ⛔ لا تخزين دائم · ⛔ لا نشر.
// ============================================================

import { assertCapability } from './capability.ts';
import type { TenantContext } from './tenant.ts';
import type { MessageStore } from './store.ts';
import type {
  ConversationState,
  ConversationStateStore,
  ConversationStateView,
} from './conversation-state.ts';
import type { ConversationChangeLog } from './conversation-change-log.ts';
import type { ReadAuditLog } from './read-audit.ts';

/** ⭐ صلاحية قراءة مركز عمل الوكيل. */
export const CONVERSATION_QUEUE_CAPABILITY = 'conversation.queue.read';

/** ⭐⭐ معيار الخمول الافتراضي — ⭐ **٣٠ دقيقة** (قرار المالك · ٥ نوفمبر ٢٠٢٦). ⭐ ⛔ **ليس** معيار تأخّر العميل. */
export const DEFAULT_IDLE_THRESHOLD_MINUTES = 30;

/** ⭐ أقصى حجم صفحة في الطابور. */
export const MAX_QUEUE_PAGE_SIZE = 100;

/** ⭐ حجم الصفحة الافتراضي. */
export const DEFAULT_QUEUE_PAGE_SIZE = 50;

/** ⭐⭐ تصنيف عنصر الطابور — ⭐ **مجموعة مغلقة** (لا قيمة خارجها). */
export type WorkQueueCategory = 'mine' | 'unassigned' | 'pending' | 'closed';

/** ⭐⭐ عنصر واحد في طابور العمل — ⭐ **بلا نص رسالة**. */
export interface WorkQueueItem {
  readonly conversation_ref: string;
  /** ⭐ حالة المحادثة. */
  readonly state: ConversationState;
  /** ⭐ الموظف المسنَد — ⭐ `null` = بلا إسناد. */
  readonly assignee_actor_id: string | null;
  /** ⭐ التصنيف — ⭐ محسوب من الحالة والإسناد الفعلي. */
  readonly category: WorkQueueCategory;
  /** ⭐ عدد الرسائل المخزَّنة — ⭐ رقم فقط (بلا نصوص). */
  readonly message_count: number;
  /** ⭐ أول توقيت مقبول. */
  readonly first_occurred_at: string;
  /** ⭐ آخر نشاط (آخر رسالة أو آخر تغيير في الحالة). */
  readonly last_activity_at: string;
  /**
   * ⭐⭐ **الخمول منذ آخر نشاط** — ⭐ بالدقائق (مقرّبة للأرض).
   * ⛔ **ليس «زمن انتظار العميل»** ⇒ ⭐ وليس قياساً لسرعة الرد ولا لتقييم الموظف.
   * ⭐ التعريف: ⭐ **الآن − آخر نشاط** (آخر رسالة أو آخر تغيير في الحالة).
   */
  readonly idle_minutes: number;
  /**
   * ⭐⭐ هل تجاوز **الخمول** المعيارَ المعتمد (٣٠ دقيقة افتراضياً)؟
   * ⛔ **ليس «تأخّر العميل»** ⇒ ⭐ ولا يُستعمل لقياس سرعة الرد.
   */
  readonly is_idle_over_threshold: boolean;
}

export interface WorkQueuePageInfo {
  readonly limit: number;
  readonly returned: number;
  readonly total: number;
  readonly next_cursor: string | null;
  /** ⭐ **معيار الخمول** المستخدَم في هذه الصفحة. */
  readonly idle_threshold_minutes: number;
}

export interface AgentWorkQueueDependencies {
  readonly store: MessageStore;
  readonly states: ConversationStateStore;
  readonly changes: ConversationChangeLog;
  /** ⭐ سجل أحداث القراءة — ⭐ **إلزامي** ⇒ كل عملية قراءة موثّقة. */
  readonly readAudit: ReadAuditLog;
}

export interface AgentWorkQueueOptions {
  readonly limit?: number;
  /** ⭐ مؤشر الصفحة — ⭐ = معرّف آخر عنصر في الصفحة السابقة. */
  readonly cursor?: string;
  /** ⭐ لحظة القياس (ISO) — ⭐ **deterministic** ⇒ نفس البيانات ⇒ نفس الأرقام. */
  readonly now?: string;
  /** ⭐ **معيار الخمول** بالدقائق — ⭐ افتراضي ٣٠. ⭐ ⛔ **ليس** معيار تأخّر العميل. */
  readonly idle_threshold_minutes?: number;
}

export class AgentWorkQueueError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'AgentWorkQueueError';
    this.code = code;
  }
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_QUEUE_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new AgentWorkQueueError('limit_invalid', 'حدّ الصفحة لازم يكون عدداً صحيحاً ≥ ١');
  }
  return Math.min(limit, MAX_QUEUE_PAGE_SIZE);
}

function clampThreshold(value: number | undefined): number {
  if (value === undefined) return DEFAULT_IDLE_THRESHOLD_MINUTES;
  if (!Number.isFinite(value) || value < 1) {
    throw new AgentWorkQueueError(
      'idle_threshold_invalid',
      'معيار الخمول لازم يكون رقماً ≥ ١ دقيقة',
    );
  }
  return Math.floor(value);
}

function requireCapability(
  context: TenantContext,
  deps: AgentWorkQueueDependencies,
): void {
  try {
    assertCapability(context, CONVERSATION_QUEUE_CAPABILITY);
  } catch (error) {
    deps.readAudit.record({
      tenant_id: context.tenantId,
      actor_id: context.actorId,
      operation: 'conversation.queue.read',
      capability: CONVERSATION_QUEUE_CAPABILITY,
      result: 'denied',
    });
    throw error;
  }
}

/**
 * ⭐⭐⭐ نطاق الدور — ⭐ **«الوكيل يرى محادثاته» · «المشرف يرى فريقه»**.
 * ⭐⭐ **قرار نطاق المالك (C2(أ) · تصريح ٥ نوفمبر ٢٠٢٦)**: ⭐ **المشرف يرى
 *   جميع موظفي ومحادثات المستأجر نفسه** ⇒ ⭐ **وليس فريقاً فرعياً**.
 * ⛔ **دعم الفرق الفرعية غير متاح حالياً** — ⭐ **لا يوجد كيان «فريق» في
 *   النموذج** (`EmployeeDirectory` = `isEmployee(tenantId, actorId)` فقط).
 * ⛔ **هذا قرار نطاق — وليس تصريحاً بالوصول إلى مستأجر آخر**: ⭐ كل قراءة
 *   تبقى مقيَّدة بـ`context.tenantId` ⇒ ⇒ **العزل بالمستأجر غير مُمساس**.
 * ⭐ ⇒ ⇒ **فرق فرعية = كيان جديد ⇒ شريحة/قرار مستقل — لا تعديل في هذه الشريحة**.
 */
function scopeIsOwnOnly(context: TenantContext): boolean {
  return context.role === 'agent';
}

/** ⭐⭐⭐ نشاط محادثة واحد — ⭐ **أرقام وتوقيتات فقط (بلا نصوص)**. */
export interface ConversationActivity {
  readonly conversation_ref: string;
  readonly message_count: number;
  readonly first_occurred_at: string;
  readonly last_activity_at: string;
  /** ⭐⭐ **الخمول منذ آخر نشاط** (دقائق) — ⭐ **ليس** زمن انتظار العميل. */
  readonly idle_minutes: number;
  /** ⭐⭐ تجاوز الخمول المعيارَ ⇒ ⭐ **ليس** تأخّر العميل. */
  readonly is_idle_over_threshold: boolean;
}

/** ⭐⭐ حساب نشاط محادثة — ⭐ **آخر رسالة أو آخر تغيير في الحالة** (الأحدث). */
export function computeConversationActivity(
  context: TenantContext,
  conversationRef: string,
  deps: AgentWorkQueueDependencies,
  options: { readonly now: string; readonly idle_threshold_minutes: number },
): ConversationActivity {
  const rows = deps.store.messagesForConversation(context, conversationRef);
  const first = rows[0];
  const last = rows[rows.length - 1];
  const changes = deps.changes.changesFor(context, conversationRef);
  const lastChange = changes[changes.length - 1];

  let lastActivity = '';
  if (last) lastActivity = last.occurred_at;
  if (lastChange && lastChange.ts > lastActivity) lastActivity = lastChange.ts;

  const nowMs = Date.parse(options.now);
  const lastMs = lastActivity ? Date.parse(lastActivity) : Number.NaN;
  // ⭐ مدة الانتظار = الآن − آخر نشاط ⇒ ⭐ **لا تُقدَّر** ⇒ ⭐ ولو تعذّر الحساب
  // (لا نشاط ولا توقيت صالح) ⇒ ٠ ⇒ ⭐ **والمحادثة بلا رسائل لا تدخل الطابور أصلاً**.
  const idleMinutes =
    Number.isFinite(nowMs) && Number.isFinite(lastMs) && nowMs >= lastMs
      ? Math.floor((nowMs - lastMs) / 60000)
      : 0;

  return {
    conversation_ref: conversationRef,
    message_count: rows.length,
    first_occurred_at: first?.occurred_at ?? '',
    last_activity_at: lastActivity,
    idle_minutes: idleMinutes,
    is_idle_over_threshold: idleMinutes >= options.idle_threshold_minutes,
  };
}

/** ⭐⭐ التصنيف — ⭐ من الحالة والإسناد الفعلي (لا تقدير). */
function categorize(
  context: TenantContext,
  state: ConversationState,
  assignee: string | null,
): WorkQueueCategory {
  if (state === 'resolved' || state === 'closed') return 'closed';
  if (assignee === context.actorId) return 'mine';
  if (assignee === null) return 'unassigned';
  return 'pending';
}

/** ⭐⭐⭐ الترتيب — ⭐ **الأكثر انتظاراً أولاً** ⇒ ثم المعرّف تصاعدياً (حتمي). */
function compareItems(a: WorkQueueItem, b: WorkQueueItem): number {
  if (a.idle_minutes !== b.idle_minutes) {
    return b.idle_minutes - a.idle_minutes;
  }
  return a.conversation_ref < b.conversation_ref ? -1 : 1;
}

/**
 * ⭐⭐⭐⭐⭐ **مركز عمل الوكيل** — ⭐ **الطابور التشغيلي** (قراءة فقط).
 * ⛔ لا تقبل معرّف مستأجر — ⭐ النطاق من السياق وحده.
 * ⛔ لا تُعيد نص رسالة — ⭐ معرّفات وأرقام وتوقيتات فقط.
 */
export function listWorkQueue(
  context: TenantContext,
  deps: AgentWorkQueueDependencies,
  options: AgentWorkQueueOptions = {},
): { readonly items: readonly WorkQueueItem[]; readonly pagination: WorkQueuePageInfo } {
  requireCapability(context, deps);
  const limit = clampLimit(options.limit);
  const threshold = clampThreshold(options.idle_threshold_minutes);
  const now = options.now ?? new Date().toISOString();
  const ownOnly = scopeIsOwnOnly(context);

  const refs = deps.store.conversationRefs(context);
  const items: WorkQueueItem[] = [];
  for (const ref of refs) {
    const row: ConversationStateView | undefined = deps.states.get(context.tenantId, ref);
    const state: ConversationState = row?.state ?? 'new';
    const assignee = row?.assignee_actor_id ?? null;
    // ⭐⭐ نطاق الدور: ⭐ الوكيل يرى **محادثاته فقط**.
    if (ownOnly && assignee !== context.actorId) continue;
    const activity = computeConversationActivity(context, ref, deps, {
      now,
      idle_threshold_minutes: threshold,
    });
    items.push({
      conversation_ref: ref,
      state,
      assignee_actor_id: assignee,
      category: categorize(context, state, assignee),
      message_count: activity.message_count,
      first_occurred_at: activity.first_occurred_at,
      last_activity_at: activity.last_activity_at,
      idle_minutes: activity.idle_minutes,
      is_idle_over_threshold: activity.is_idle_over_threshold,
    });
  }

  items.sort(compareItems);

  let start = 0;
  if (options.cursor !== undefined) {
    const index = items.findIndex((item) => item.conversation_ref === options.cursor);
    if (index === -1) {
      throw new AgentWorkQueueError(
        'cursor_invalid',
        'مؤشر الصفحات غير معروف في نطاق المستأجر',
      );
    }
    start = index + 1;
  }

  const page = items.slice(start, start + limit);
  const next =
    start + page.length < items.length && page.length > 0
      ? page[page.length - 1].conversation_ref
      : null;

  deps.readAudit.record({
    tenant_id: context.tenantId,
    actor_id: context.actorId,
    operation: 'conversation.queue.read',
    capability: CONVERSATION_QUEUE_CAPABILITY,
    result: 'allowed',
    count: page.length,
  });

  return {
    items: page,
    pagination: {
      limit,
      returned: page.length,
      total: items.length,
      next_cursor: next,
      idle_threshold_minutes: threshold,
    },
  };
}

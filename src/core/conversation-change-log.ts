// ============================================================
// WASL AI — سجل تغييرات المحادثات (الشريحة الرابعة)
// ------------------------------------------------------------
// ⭐⭐ **سجل مستقل تماماً** ⇒ ⭐ لا علاقة له بسجل تدقيق المعالجة
//   (`AuditOutcome`) ولا بسجل أحداث القراءة (`ReadAuditLog`).
// ⭐ الغرض: توثيق **من غيّر حالة أي محادثة ومتى ولماذا**.
// ⛔ **بلا نص رسائل · بلا أسرار · بلا بيانات حسّاسة** ⇒ ⭐ ما يُسجَّل:
//   معرّفات (مستأجر · منفّذ · محادثة · موظف) + العملية + من/إلى + السبب + الوقت.
// ⛔ لا اتصال خارجي · ⛔ لا استيراد من أي مصدر خارجي.
// ⭐ والقراءة **معزولة بالمستأجر** ⇒ ⭐ ولا `entries()` غير المعزولة في مسار القراءة.
// ============================================================

import { SECRET_PATTERNS } from './audit-log.ts';
import { ACTOR_ID_PATTERN, CONVERSATION_REF_PATTERN } from './tenant.ts';
import type { TenantContext } from './tenant.ts';

/** ⭐⭐ عمليات التغيير المعلنة — ⭐ **مجموعة مغلقة**. */
export const CONVERSATION_CHANGE_OPERATIONS = [
  'state.update',
  'assignment.set',
  'assignment.transfer',
  'assignment.clear',
] as const;

export type ConversationChangeOperation = (typeof CONVERSATION_CHANGE_OPERATIONS)[number];

/** ⭐⭐ حالات المحادثة — ⭐ **مجموعة مغلقة** (نفس مجموعة الشريحة الرابعة). */
export const CONVERSATION_CHANGE_STATES = [
  'new',
  'open',
  'assigned',
  'pending',
  'resolved',
  'closed',
] as const;

export type ConversationChangeState = (typeof CONVERSATION_CHANGE_STATES)[number];

/** ⭐ سطر تغيير واحد — ⭐ **(المستأجر · المنفّذ · العملية · من · إلى · السبب · الإسناد · الوقت)**. */
export interface ConversationChangeEntry {
  readonly ts: string;
  readonly tenant_id: string;
  readonly actor_id: string;
  readonly operation: ConversationChangeOperation;
  readonly conversation_ref: string;
  readonly from_state: ConversationChangeState;
  readonly to_state: ConversationChangeState;
  /** ⭐ سبب التعديل — ⭐ نص قصير بلا أسرار (قد يكون فارغاً). */
  readonly reason: string;
  /** ⭐ الموظف قبل الإسناد — ⭐ `null` = بلا إسناد. */
  readonly assignee_from: string | null;
  /** ⭐ الموظف بعد الإسناد — ⭐ `null` = بلا إسناد. */
  readonly assignee_to: string | null;
}

export interface ConversationChangeInput {
  readonly tenant_id: string;
  readonly actor_id: string;
  readonly operation: ConversationChangeOperation;
  readonly conversation_ref: string;
  readonly from_state: ConversationChangeState;
  readonly to_state: ConversationChangeState;
  readonly reason?: string;
  readonly assignee_from?: string | null;
  readonly assignee_to?: string | null;
}

export class ConversationChangeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ConversationChangeError';
    this.code = code;
  }
}

/** ⭐ أقصى طول للسبب — ⭐ يمنع إخفاء بيانات حسّاسة في نص طويل. */
export const MAX_CHANGE_REASON_LENGTH = 200;

function containsSecret(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

function assertOptionalActor(value: string | null | undefined, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (!ACTOR_ID_PATTERN.test(value)) {
    throw new ConversationChangeError('assignee_invalid', `${field}: معرّف موظف غير صالح`);
  }
  return value;
}

/**
 * ⭐⬀ فحص سبب السبب — ⭐ يُستخدم **قبل** أي معاملة الحالة.
 * ⛔ علامة في الاستخداع ⇒ ⭐ معاملة السبب (لا تعديل حالة ثم تسجيل السبب فيستور الحالة).
 */
export function assertChangeReason(reason: string): void {
  if (reason.length > MAX_CHANGE_REASON_LENGTH) {
    throw new ConversationChangeError(
      'reason_too_long',
      `سبب التعديل أطول من الحدّ (٠٠٠ حرفاً)`,
    );
  }
  if (containsSecret(reason)) {
    throw new ConversationChangeError('reason_secret_forbidden', 'سبب التعديل يشبه سرًّاً');
  }
}

/**
 * ⭐ سجل تغييرات المحادثات (في الذاكرة) — ⭐ **append-only**.
 * ⛔ يرفض أي قيمة تشبه سرّاً · ⛔ يرفض أي عملية أو حالة خارج المُعلَن.
 */
export class ConversationChangeLog {
  readonly #entries: ConversationChangeEntry[] = [];
  readonly #now: () => string;

  constructor(options: { now?: () => string } = {}) {
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  /** ⭐ يسجّل تغييراً واحداً — ⭐ **بتحقّق كامل قبل الكتابة**. */
  record(input: ConversationChangeInput): ConversationChangeEntry {
    if (!input || typeof input !== 'object') {
      throw new ConversationChangeError('input_missing', 'مدخل سجل التغييرات مفقود');
    }
    if (!ACTOR_ID_PATTERN.test(String(input.tenant_id ?? ''))) {
      throw new ConversationChangeError('tenant_invalid', 'tenant_id غير صالح');
    }
    if (!ACTOR_ID_PATTERN.test(String(input.actor_id ?? ''))) {
      throw new ConversationChangeError('actor_invalid', 'actor_id غير صالح');
    }
    if (!CONVERSATION_CHANGE_OPERATIONS.includes(input.operation)) {
      throw new ConversationChangeError('operation_invalid', 'عملية تغيير غير معلنة');
    }
    if (!CONVERSATION_REF_PATTERN.test(String(input.conversation_ref ?? ''))) {
      throw new ConversationChangeError('conversation_invalid', 'conversation_ref غير صالح');
    }
    if (!CONVERSATION_CHANGE_STATES.includes(input.from_state)) {
      throw new ConversationChangeError('state_invalid', 'الحالة الأصلية غير معلنة');
    }
    if (!CONVERSATION_CHANGE_STATES.includes(input.to_state)) {
      throw new ConversationChangeError('state_invalid', 'الحالة الجديدة غير معلنة');
    }
    const reason = input.reason ?? '';
    if (reason.length > MAX_CHANGE_REASON_LENGTH) {
      throw new ConversationChangeError(
        'reason_too_long',
        `سبب التعديل أطول من الحدّ (${MAX_CHANGE_REASON_LENGTH} حرفاً)`,
      );
    }
    if (containsSecret(reason)) {
      throw new ConversationChangeError('reason_secret_forbidden', 'سبب التعديل يشبه سرّاً');
    }
    const assigneeFrom = assertOptionalActor(input.assignee_from, 'assignee_from');
    const assigneeTo = assertOptionalActor(input.assignee_to, 'assignee_to');
    const entry: ConversationChangeEntry = {
      ts: this.#now(),
      tenant_id: input.tenant_id,
      actor_id: input.actor_id,
      operation: input.operation,
      conversation_ref: input.conversation_ref,
      from_state: input.from_state,
      to_state: input.to_state,
      reason,
      assignee_from: assigneeFrom,
      assignee_to: assigneeTo,
    };
    this.#entries.push(entry);
    return entry;
  }

  /**
   * ⭐⭐ قراءة معزولة بحسب المستأجر — ⭐ **لا تُعيد أحداث مستأجر آخر أبداً**.
   * ⭐ `conversationRef` اختياري ⇒ ⭐ تصفية على مستوى المحادثة أيضاً.
   */
  changesFor(context: TenantContext, conversationRef?: string): readonly ConversationChangeEntry[] {
    return this.#entries
      .filter((entry) => entry.tenant_id === context.tenantId)
      .filter((entry) => conversationRef === undefined || entry.conversation_ref === conversationRef)
      .map((entry) => ({ ...entry }));
  }

  /** ⭐⭐ **لا `entries()` غير المعزولة** ⇒ ⭐ مسار القراءة معزول بنيوياً. */
  size(): number {
    return this.#entries.length;
  }
}

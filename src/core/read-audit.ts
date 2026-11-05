// ============================================================
// WASL AI — سجل أحداث القراءة (الشريحة الثالثة)
// ------------------------------------------------------------
// ⭐⭐ **مسار منفصل عن `AuditOutcome`** ⇒ ⭐ نوع قيمة مستقل + سجل مستقل.
// ⭐ الغرض: توثيق **من قرأ ماذا ومتى وبأي صلاحية**.
// ⛔ **لا محتوى رسائل ولا أسرار ولا بيانات حسّاسة** ⇒ ⭐ ما يُسجَّل:
//   معرّفات (مستأجر · منفّذ · محادثة) + اسم العملية + الصلاحية + النتيجة + عدّاد.
// ⛔ لا اتصال خارجي · ⛔ لا استيراد من أي مصدر خارجي.
// ============================================================

import { SECRET_PATTERNS } from './audit-log.ts';
import { CONVERSATION_REF_PATTERN } from './tenant.ts';
import type { TenantContext } from './tenant.ts';

/** ⭐ نتيجة عملية قراءة — ⭐ **مستقلة عن `AuditOutcome`**. */
export type ReadAuditResult = 'allowed' | 'denied';

/** ⭐ عمليات القراءة المعلنة. */
export type ReadAuditOperation = 'conversation.list' | 'conversation.read' | 'conversation.audit';

export interface ReadAuditEvent {
  readonly ts: string;
  readonly tenant_id: string;
  readonly actor_id: string;
  readonly operation: ReadAuditOperation;
  readonly capability: string;
  readonly result: ReadAuditResult;
  /** ⭐ معرّف المحادثة فقط — ⛔ لا نص رسالة ولا سمة شخصية. */
  readonly target?: string;
  /** ⭐ عدد الصفوف المُعادة — ⛔ لا محتوى. */
  readonly count?: number;
}

export interface ReadAuditInput {
  readonly tenant_id: string;
  readonly actor_id: string;
  readonly operation: ReadAuditOperation;
  readonly capability: string;
  readonly result: ReadAuditResult;
  readonly target?: string;
  readonly count?: number;
}

export class ReadAuditError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ReadAuditError';
    this.code = code;
  }
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@-]{1,63}$/;
const CAPABILITY_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const OPERATIONS: readonly ReadAuditOperation[] = [
  'conversation.list',
  'conversation.read',
  'conversation.audit',
];

function containsSecret(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * ⭐ سجل أحداث القراءة (في الذاكرة) — ⭐ **منفصل عن سجل تدقيق المعالجة**.
 */
export class ReadAuditLog {
  readonly #events: ReadAuditEvent[] = [];
  readonly #now: () => string;

  constructor(options: { now?: () => string } = {}) {
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  /**
   * ⭐ يسجّل عملية قراءة واحدة.
   * ⛔ يرفض أي قيمة تشبه سرّاً · ⛔ يرفض أي عملية أو صلاحية خارج المُعلَن.
   */
  record(input: ReadAuditInput): ReadAuditEvent {
    if (!input || typeof input !== 'object') {
      throw new ReadAuditError('input_missing', 'مدخل سجل القراءة مفقود');
    }
    if (!ID_PATTERN.test(String(input.tenant_id ?? ''))) {
      throw new ReadAuditError('tenant_invalid', 'tenant_id غير صالح');
    }
    if (!ID_PATTERN.test(String(input.actor_id ?? ''))) {
      throw new ReadAuditError('actor_invalid', 'actor_id غير صالح');
    }
    if (!OPERATIONS.includes(input.operation)) {
      throw new ReadAuditError('operation_invalid', 'عملية قراءة غير معلنة');
    }
    if (!CAPABILITY_PATTERN.test(String(input.capability ?? ''))) {
      throw new ReadAuditError('capability_invalid', 'اسم صلاحية غير صالح');
    }
    if (input.result !== 'allowed' && input.result !== 'denied') {
      throw new ReadAuditError('result_invalid', 'نتيجة قراءة غير صالحة');
    }
    if (input.target !== undefined) {
      if (!CONVERSATION_REF_PATTERN.test(input.target)) {
        throw new ReadAuditError('target_invalid', 'هدف القراءة غير صالح');
      }
      if (containsSecret(input.target)) {
        throw new ReadAuditError('target_secret_forbidden', 'هدف القراءة يشبه سرّاً');
      }
    }
    if (input.count !== undefined) {
      if (!Number.isInteger(input.count) || input.count < 0) {
        throw new ReadAuditError('count_invalid', 'عدّاد القراءة غير صالح');
      }
    }
    const event: ReadAuditEvent = {
      ts: this.#now(),
      tenant_id: input.tenant_id,
      actor_id: input.actor_id,
      operation: input.operation,
      capability: input.capability,
      result: input.result,
      ...(input.target !== undefined ? { target: input.target } : {}),
      ...(input.count !== undefined ? { count: input.count } : {}),
    };
    this.#events.push(event);
    return event;
  }

  /**
   * ⭐⭐ قراءة معزولة بحسب المستأجر — ⭐ `eventsFor` لا تكشف عن مستأجر آخر.
   * ⛔ أحداث المستأجرين الآخرين لا تُعاد أبداً.
   */
  eventsFor(context: TenantContext): readonly ReadAuditEvent[] {
    return this.#events
      .filter((event) => event.tenant_id === context.tenantId)
      .map((event) => ({ ...event }));
  }

  size(): number {
    return this.#events.length;
  }
}

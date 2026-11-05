// ============================================================
// WASL AI — مخزن الرسائل المحلي (عزل المستأجر على مستوى التطبيق)
// ------------------------------------------------------------
// ⭐ القاعدة البنيوية: كل عملية تستقبل «سياق التنفيذ» وتقرأ/تكتب
//   صفوف المستأجر الذي في السياق فقط.
// ⛔ لا توجد أي دالة في هذا الملف تقبل معرّف مستأجر كوسائط —
//   ⇒ استعلام مستأجر آخر غير ممكن بنيوياً، لا بالمصادفة.
// ⛔ هذا عزل على مستوى التطبيق فقط — لا يعادل عزل الصفوف (DR-4)
//   ولا يغلق بوابة DR-4.
// ============================================================

import {
  EnvelopeValidationError,
  validateEnvelope,
  type EnvelopeFieldError,
  type MessageEnvelope,
} from './envelope.ts';
import { AuditLog } from './audit-log.ts';
import { assertTenantMatches, TenantContextError, type TenantContext } from './tenant.ts';

export interface StoredMessage {
  readonly message_ref: string;
  readonly tenant_id: string;
  readonly channel: string;
  readonly direction: string;
  readonly from: string;
  readonly to: string;
  readonly body: string;
  readonly occurred_at: string;
  readonly locale: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly stored_at: string;
}

export type AppendOutcome =
  | { readonly status: 'accepted'; readonly message: StoredMessage }
  | { readonly status: 'duplicate'; readonly reason_code: 'message_ref_duplicate'; readonly message_ref: string }
  | {
      readonly status: 'rejected';
      readonly reason_code: 'envelope_invalid' | 'tenant_mismatch' | 'tenant_context_missing';
      readonly errors: readonly EnvelopeFieldError[];
    };

const OPERATION = 'message.append';

export class MessageStore {
  readonly #rows: Map<string, StoredMessage[]> = new Map();
  readonly #audit: AuditLog;
  readonly #now: () => string;

  constructor(options: { audit?: AuditLog; now?: () => string } = {}) {
    this.#audit = options.audit ?? new AuditLog();
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  /**
   * ⭐ إضافة رسالة لمستأجر السياق.
   * الترتيب: التحقق من العقد ⇒ مطابقة المستأجر ⇒ منع التكرار ⇒ التخزين.
   */
  append(context: TenantContext | undefined, input: unknown): AppendOutcome {
    if (!context) {
      throw new TenantContextError('tenant_context_missing', 'سياق التنفيذ مطلوب');
    }
    const validation = validateEnvelope(input);
    if (!validation.ok) {
      this.#audit.record({
        tenant_id: context.tenantId,
        actor_id: context.actorId,
        operation: OPERATION,
        outcome: 'rejected',
        reason_code: 'envelope_invalid',
        meta: { field: validation.errors[0]?.field ?? 'envelope' },
      });
      return { status: 'rejected', reason_code: 'envelope_invalid', errors: validation.errors };
    }
    const envelope = validation.value;
    try {
      assertTenantMatches(context, envelope.declared_tenant_id);
    } catch (error) {
      this.#audit.record({
        tenant_id: context.tenantId,
        actor_id: context.actorId,
        operation: OPERATION,
        outcome: 'rejected',
        reason_code: 'tenant_mismatch',
        meta: { field: 'declared_tenant_id' },
      });
      return {
        status: 'rejected',
        reason_code: 'tenant_mismatch',
        errors: [
          {
            field: 'declared_tenant_id',
            rule: 'tenant_match',
            message: 'معرّف المستأجر المُعلن لا يطابق سياق التنفيذ الموثوق',
          },
        ],
      };
    }
    const existing = this.#rows.get(context.tenantId) ?? [];
    if (existing.some((row) => row.message_ref === envelope.message_ref)) {
      this.#audit.record({
        tenant_id: context.tenantId,
        actor_id: context.actorId,
        operation: OPERATION,
        outcome: 'duplicate',
        reason_code: 'message_ref_duplicate',
        meta: { message_ref: envelope.message_ref },
      });
      return {
        status: 'duplicate',
        reason_code: 'message_ref_duplicate',
        message_ref: envelope.message_ref,
      };
    }
    const stored: StoredMessage = {
      message_ref: envelope.message_ref,
      tenant_id: context.tenantId,
      channel: envelope.channel,
      direction: envelope.direction,
      from: envelope.from,
      to: envelope.to,
      body: envelope.body,
      occurred_at: envelope.occurred_at,
      locale: envelope.locale,
      attributes: envelope.attributes,
      stored_at: this.#now(),
    };
    existing.push(stored);
    this.#rows.set(context.tenantId, existing);
    this.#audit.record({
      tenant_id: context.tenantId,
      actor_id: context.actorId,
      operation: OPERATION,
      outcome: 'accepted',
      meta: { message_ref: stored.message_ref },
    });
    return { status: 'accepted', message: stored };
  }

  /**
   * ⭐ قراءة صفوف المستأجر في السياق فقط.
   * ⛔ لا معرّف مستأجر كوسيطة ⇒ لا استعلام عابر ممكن.
   */
  list(context: TenantContext, options: { limit?: number } = {}): StoredMessage[] {
    const rows = this.#rows.get(context.tenantId) ?? [];
    const limit = options.limit === undefined ? rows.length : options.limit;
    return rows.slice(0, Math.max(0, limit)).map((row) => ({ ...row }));
  }

  /** ⭐ قراءة رسالة واحدة بمعرّفها داخل نطاق المستأجر فقط. */
  getByRef(context: TenantContext, messageRef: string): StoredMessage | undefined {
    const row = (this.#rows.get(context.tenantId) ?? []).find(
      (item) => item.message_ref === messageRef,
    );
    return row ? { ...row } : undefined;
  }

  /** ⭐ عدّ صفوف المستأجر في السياق فقط. */
  countFor(context: TenantContext): number {
    return (this.#rows.get(context.tenantId) ?? []).length;
  }

  /** ⭐ سجل التدقيق المرتبط. */
  audit(): AuditLog {
    return this.#audit;
  }
}

export { EnvelopeValidationError };

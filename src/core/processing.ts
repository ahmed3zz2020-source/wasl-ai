// ============================================================
// WASL AI — طبقة المعالجة: عقد النتيجة + خط المعالجة (Slice 02)
// ------------------------------------------------------------
// ⭐ الوظيفة: ⭐ **طبقة نقلة خالقة** بين عقد الرسالة المُتحقَّق منه والسياق
//   الموثوق ⇒ تقرّر: **قبول · رفض · تأجيل** بقواعد ثابتة مغلقة.
// ⛔ بلا تصنيف · ⛔ بلا رد آلي · ⛔ بلا إسناد موظفين · ⛔ بلا ذكاء اصطناعي.
// ⛔ بلا أي دالة تقبل معرّف مستأجر كوسيط ⇒ ⇒ **لا وصول عابر ممكن بنيوياً**.
// ⭐ إعادة استخدام: ⭐ **منع التكرار = آلية Slice 01 نفسها** (المخزن +
//   القاعدة داخل نطاق المستأجر) ⇒ ⭐ **و`reason_code` هنا يُعرَّف فوقها لا بجانبها**.
// ⭐ الترتيب: ⭐ مواصفة `docs/SLICE-02-ORDERING-RULE.md` (قرار المالك).
// ⭐⭐ النطاق = (المستأجر · المحادثة الموثوقة) ⇒ ⭐ **المحادثة من السياق
//   الموثوق (حدّ الثقة) — لا من محتوى الرسالة** ⇒ ⭐ **ولا خلط بين المستأجرين
//   ولا بين محادثات المستأجر الواحد**.
// ============================================================

import {
  validateEnvelope,
  type EnvelopeFieldError,
  type MessageEnvelope,
} from './envelope.ts';
import { assertConversationMatches, assertTenantMatches, type TenantContext } from './tenant.ts';
import { MessageStore } from './store.ts';
import { AuditLog } from './audit-log.ts';
import {
  evaluateOrdering,
  OrderingState,
  type OrderingScope,
} from './ordering.ts';

/** ⭐ قرارات المعالجة الثلاثة. */
export type ProcessingDecision = 'accepted' | 'rejected' | 'deferred';

/**
 * ⭐⭐ قائمة أسباب مغلقة — كل سبب مُعلَن وقابل للفحص.
 * ⭐ **أسباب الرفض = أسماء أسباب `MessageStore` نفسها** ⇒ ⇒ **لا آلية موازية**.
 */
export type ProcessingReasonCode =
  | 'accepted_in_order'
  | 'envelope_invalid'
  | 'tenant_mismatch'
  | 'conversation_mismatch'
  | 'tenant_context_missing'
  | 'message_ref_duplicate'
  | 'deferred_out_of_order'
  | 'deferred_equal_timestamp'
  | 'deferred_unknown';

/** ⭐⭐ عقد نتيجة المعالجة — الشكل المجمَّد. */
export interface ProcessingOutcome {
  readonly decision: ProcessingDecision;
  readonly reason_code: ProcessingReasonCode;
  readonly tenant_id: string;
  /** ⭐ معرّف الرسالة — متاح متى كانت الرسالة صالحة الشكل. */
  readonly message_ref?: string;
  /** ⭐ توقيت الرسالة بتوقيت UTC — متاح متى كانت الرسالة صالحة الشكل. */
  readonly occurred_at?: string;
  readonly errors?: readonly EnvelopeFieldError[];
}

/** ⭐ قواعد عقد النتيجة — مصدر الحقيقة الوحيد للتحقق من النتيجة. */
export const PROCESSING_OUTCOME_RULES = {
  decision: { type: 'string', required: true, oneOf: ['accepted', 'rejected', 'deferred'] },
  reason_code: { type: 'string', required: true, oneOf: [
    'accepted_in_order',
    'envelope_invalid',
    'tenant_mismatch',
    'conversation_mismatch',
    'tenant_context_missing',
    'message_ref_duplicate',
    'deferred_out_of_order',
    'deferred_equal_timestamp',
    'deferred_unknown',
  ] },
  message_ref: { type: 'string', required: false, pattern: /^[A-Za-z0-9._:-]{1,64}$/ },
  occurred_at: { type: 'string', required: false, pattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/ },
  tenant_id: { type: 'string', required: true, pattern: /^[a-z0-9][a-z0-9_-]{2,63}$/ },
  errors: { type: 'array', required: false },
} as const;

export type ProcessingOutcomeRuleName = keyof typeof PROCESSING_OUTCOME_RULES;

export type ProcessingOutcomeValidation =
  | { readonly ok: true; readonly value: ProcessingOutcome }
  | { readonly ok: false; readonly errors: readonly EnvelopeFieldError[] };

/** ⭐ خطأ عقد النتيجة — يحمل قواعد الفشل. */
export class ProcessingOutcomeError extends Error {
  readonly errors: readonly EnvelopeFieldError[];
  constructor(errors: readonly EnvelopeFieldError[]) {
    super(`نتيجة معالجة غير صالحة (${errors.length} خطأ)`);
    this.name = 'ProcessingOutcomeError';
    this.errors = errors;
  }
}

function outcomeError(field: string, rule: string, message: string): EnvelopeFieldError {
  return { field, rule, message };
}

/**
 * ⭐⭐ التحقق من عقد النتيجة — خالص بلا أثر.
 * ⭐ **نتيجة صالحة تُقبل · ونتيجة غير صالحة تُرفض بقاعدة معلنة**.
 */
export function validateProcessingOutcome(input: unknown): ProcessingOutcomeValidation {
  const errors: EnvelopeFieldError[] = [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return {
      ok: false,
      errors: [outcomeError('outcome', 'type', 'النتيجة ليست كائناً')],
    };
  }
  const value = input as Record<string, unknown>;
  for (const field of Object.keys(PROCESSING_OUTCOME_RULES)) {
    const rule = PROCESSING_OUTCOME_RULES[field] as {
      type: string;
      required: boolean;
      pattern?: RegExp;
      oneOf?: readonly string[];
    };
    const raw = value[field];
    if (raw === undefined) {
      if (rule.required) errors.push(outcomeError(field, 'required', `${field}: حقل مطلوب`));
      continue;
    }
    if (typeof raw !== rule.type) {
      errors.push(outcomeError(field, 'type', `${field}: النوع المتوقع ${rule.type}`));
      continue;
    }
    const text = raw as string;
    if (rule.oneOf && !rule.oneOf.includes(text)) {
      errors.push(outcomeError(field, 'enum', `${field}: القيمة خارج المجموعة المسموحة`));
      continue;
    }
    if (rule.pattern && !rule.pattern.test(text)) {
      errors.push(outcomeError(field, 'pattern', `${field}: لا يطابق الصيغة المسموحة`));
    }
  }
  if (value.occurred_at !== undefined && typeof value.occurred_at === 'string') {
    if (Number.isNaN(Date.parse(value.occurred_at))) {
      errors.push(outcomeError('occurred_at', 'parse', 'occurred_at: تاريخ غير صالح'));
    }
  }
  if (!errors.length) {
    const errorsField = value.errors;
    const base = {
      decision: value.decision as ProcessingDecision,
      reason_code: value.reason_code as ProcessingReasonCode,
      tenant_id: value.tenant_id as string,
      ...(value.message_ref === undefined
        ? {}
        : { message_ref: value.message_ref as string }),
      ...(value.occurred_at === undefined
        ? {}
        : { occurred_at: value.occurred_at as string }),
    };
    if (Array.isArray(errorsField)) {
      return { ok: true, value: { ...base, errors: errorsField as EnvelopeFieldError[] } };
    }
    return { ok: true, value: base };
  }
  return { ok: false, errors };
}

/** ⭐ التحقق المُنتج — يرمي استثناءً يحمل قائمة الأخطاء. */
export function parseProcessingOutcome(input: unknown): ProcessingOutcome {
  const result = validateProcessingOutcome(input);
  if (!result.ok) {
    throw new ProcessingOutcomeError(result.errors);
  }
  return result.value;
}

/** ⭐ اعتماديات خط المعالجة — كلها محلية. */
export interface ProcessingDependencies {
  /** ⭐ المخزن = آلية منع التكرار والتخزين (نفس آلية Slice 01 — لا آلية ثانية). */
  readonly store: MessageStore;
  /** ⭐ سجل التدقيق الخاص بالمعالجة (سطر واحد لكل عملية معالجة). */
  readonly audit: AuditLog;
  /** ⭐ حالة الترتيب — نقطة مقبولة لكل (مستأجر · نطاق). */
  readonly orderingState?: OrderingState;
}

const OPERATION = 'message.process';

/** ⭐ اسم نظامي لغياب السياق — ⭐ وليس معرّف مستأجر حقيقياً. */
const NO_TENANT = 'no_tenant_context';

function auditOutcome(decision: ProcessingDecision): 'accepted' | 'rejected' | 'deferred' {
  if (decision === 'accepted') return 'accepted';
  if (decision === 'rejected') return 'rejected';
  return 'deferred';
}

/**
 * ⭐⭐⭐ طبقة المعالجة — كائن واحد يحمل حالة الترتيب.
 * ⭐ **سبب الكائن**: ⭐ **حالة الترتيب (آخر توقيت مقبول) يجب أن تعيش بين
 *   المعالجات المتتالية** ⇒ ⭐ **فلو كانت دالة تُنشئ الحالة في كل نداء
 *   ⇒ ضاعت الذاكرة ⇒ ولم تُطبَّق قاعدة الترتيب أصلاً.**
 */
export class ProcessingLayer {
  readonly #store: MessageStore;
  readonly #audit: AuditLog;
  readonly #orderingState: OrderingState;

  constructor(deps: ProcessingDependencies) {
    this.#store = deps.store;
    this.#audit = deps.audit;
    this.#orderingState = deps.orderingState ?? new OrderingState();
  }

  /** ⭐ حالة الترتيب (للتشخيص والفحص). */
  orderingState(): OrderingState {
    return this.#orderingState;
  }

  /**
   * ⭐⭐⭐ معالجة رسالة واحدة — القرار الوحيد في الشريحة.
   *
   * ⭐ الترتيب المنفَّذ (كله داخل نطاق المستأجر من السياق الموثوق):
   * ⭐ **١)** عقد الرسالة ⇒ **٢)** مطابقة المستأجر ⇒ **٣)** منع التكرار
   * ⭐ **٤)** الترتيب ⇒ **٥)** القبول والتخزين.
   *
   * ⛔ **لا تقبل معرّف مستأجر كوسيط** ⇒ ⛔ **لا وصول عابر ممكن بنيوياً**.
   * ⛔ **الرسالة المؤجلة لا تُخزَّن ولا تُعالَج تلقائياً**.
   */
  process(context: TenantContext | undefined, input: unknown): ProcessingOutcome {
      const audit = this.#audit;
        const orderingState = this.#orderingState;

    const finish = (
      decision: ProcessingDecision,
      reason_code: ProcessingReasonCode,
      tenant_id: string,
      message_ref?: string,
      occurred_at?: string,
      errors?: readonly EnvelopeFieldError[],
    ): ProcessingOutcome => {
      const outcome: ProcessingOutcome = {
        decision,
        reason_code,
        tenant_id,
        ...(message_ref ? { message_ref } : {}),
        ...(occurred_at ? { occurred_at } : {}),
        ...(errors && errors.length ? { errors } : {}),
      };
      audit.record({
        tenant_id,
        actor_id: context?.actorId ?? 'system',
        operation: OPERATION,
        outcome: auditOutcome(decision),
        reason_code,
        ...(message_ref ? { meta: { message_ref } } : {}),
      });
      return outcome;
    };

    // ⓪ السياق الموثوق — غيابه = رفض صريح (لا مسار افتراضي).
    if (!context) {
      return finish('rejected', 'tenant_context_missing', NO_TENANT);
  }

  // ① عقد الرسالة — نفس تحقق Slice 01 (بلا نسخة ثانية).
  const validation = validateEnvelope(input);
  if (!validation.ok) {
    // ⭐ الرسالة مخالفة للعقد ⇒ لا معرّف ولا توقيت موثوق ⇒ النتيجة بلا الحقلين.
    return finish('rejected', 'envelope_invalid', context.tenantId, undefined, undefined, validation.errors);
  }
  const envelope: MessageEnvelope = validation.value;

  // ② مطابقة المستأجر — لا معرّف حر من الرسالة.
  try {
    assertTenantMatches(context, envelope.declared_tenant_id);
  } catch {
    return finish('rejected', 'tenant_mismatch', context.tenantId, envelope.message_ref, envelope.occurred_at);
  }

  // ②.ب مطابقة المحادثة — محادثة موثوقة واحدة في السياق ⇒ لا خلط.
  try {
    assertConversationMatches(context, envelope.conversation_ref);
  } catch {
    return finish('rejected', 'conversation_mismatch', context.tenantId, envelope.message_ref, envelope.occurred_at);
  }

  // ③ منع التكرار — قراءة من نفس مخزن Slice 01 (لا آلية ثانية).
  if (this.#store.getByRef(context, envelope.message_ref)) {
    return finish('rejected', 'message_ref_duplicate', context.tenantId, envelope.message_ref, envelope.occurred_at);
  }

  // ④ الترتيب — النطاق = (المستأجر · المحادثة الموثوقة) ⇒ لا افتراض ولا اشتقاق.
  const scope: OrderingScope = context.conversationRef;
  const decision = evaluateOrdering({
    occurredAt: envelope.occurred_at,
    messageRef: envelope.message_ref,
    lastAccepted: orderingState.lastAccepted(context, scope),
  });
  if (decision.outcome === 'deferred') {
    // ⭐ الرسالة المؤجلة: لا تُخزَّن · ولا تُغيّر آخر توقيت مقبول · ولا تُعالَج تلقائياً.
    return finish('deferred', decision.reason_code, context.tenantId, envelope.message_ref, envelope.occurred_at);
  }

  // ⑤ القبول والتخزين — نفس آلية Slice 01 (المخزن يفرض التحقق والتكرار مرة أخرى).
  const appended = this.#store.append(context, envelope);
  if (appended.status === 'duplicate') {
    return finish('rejected', appended.reason_code, context.tenantId, envelope.message_ref, envelope.occurred_at);
  }
  if (appended.status === 'rejected') {
    return finish('rejected', appended.reason_code, context.tenantId, envelope.message_ref, envelope.occurred_at, appended.errors);
  }
  orderingState.recordAccepted(context, scope, {
    occurred_at: envelope.occurred_at,
    message_ref: envelope.message_ref,
  });
  return finish('accepted', decision.reason_code, context.tenantId, envelope.message_ref, envelope.occurred_at);
  }
}

// ============================================================
// WASL AI — قاعدة ترتيب الرسائل (Slice 02 · طبقة المعالجة)
// ------------------------------------------------------------
// ⭐ مواصفة مقبولة: `docs/SLICE-02-ORDERING-RULE.md` (قرار المالك)
// ⭐ المبدأ: ⭐ **النطاق = محادثة موثوقة داخل مستأجر** ⇒ ⭐ **والمفتاح
//   = (المستأجر · النطاق)** ⇒ ⭐ **فلا تتسرب نقطة بين مستأجرين بنيوياً**.
// ⛔ `occurred_at` بتوقيت UTC — والعقد يفرض `Z` ويفحص صحته.
// ⭐ الرسالة المؤجلة ⛔ لا تُغيّر آخر توقيت مقبول · ⛔ ولا تُعالَج تلقائياً.
// ⛔ لا إعادة ترتيب · ⛔ لا مزامنة · ⛔ لا افتراض «كل رسائل المستأجر محادثة».
// ============================================================

import type { MessageEnvelope } from './envelope.ts';
import type { TenantContext } from './tenant.ts';

/** ⭐ معرّف النطاق (محادثة) — نصّ داخل نطاق مستأجر واحد. */
export type OrderingScope = string;

/**
 * ⭐ مُحلِّل النطاق — يحوّل (سياق · رسالة) إلى نطاق موثوق أو `null`.
 * ⛔ `null` = لا يوجد نطاق موثوق ⇒ ⇒ **قاعدة الترتيب لا تُنفَّذ**.
 */
export interface OrderingScopeResolver {
  readonly id: string;
  readonly description: string;
  resolve(context: TenantContext, envelope: MessageEnvelope): OrderingScope | null;
}

/**
 * ⭐⭐ المُحلِّل الافتراضي — **يرجع `null` دائماً**.
 * ⭐ السبب (موثّق في `docs/SLICE-02-ORDERING-RULE.md` §٢):
 * ⭐ **العقد المجمَّد `MessageEnvelope` لا يحوي أي معرّف محادثة** ⇒
 * ⭐ واشتقاق النطاق من `from`/`to`/`attributes` = افتراض ⇒ ⛔ ممنوع.
 * ⇒ **إذن قاعدة الترتيب مُوقَّفة تنفيذاً — وحدها** — وبانتظار قرار المالك.
 */
export const defaultOrderingScopeResolver: OrderingScopeResolver = {
  id: 'no-trusted-conversation-id',
  description:
    'لا يوجد معرّف محادثة موثوق في العقد الحالي ⇒ لا نطاق ⇒ قاعدة الترتيب لا تُنفَّذ',
  resolve(): OrderingScope | null {
    return null;
  },
};

/** ⭐ أسباب التأجيل — قائمة مغلقة. */
export type OrderingDeferReason =
  | 'deferred_out_of_order'
  | 'deferred_equal_timestamp'
  | 'deferred_unknown';

/** ⭐ نتيجة فحص الترتيب. */
export type OrderingDecision =
  | { readonly outcome: 'in_order'; readonly reason_code: 'accepted_in_order' }
  | { readonly outcome: 'not_applicable'; readonly reason_code: 'accepted_no_ordering_scope' }
  | { readonly outcome: 'deferred'; readonly reason_code: OrderingDeferReason };

/** ⭐ آخر نقطة مقبولة في نطاق واحد. */
export interface OrderingPoint {
  readonly occurred_at: string;
  readonly message_ref: string;
}

/**
 * ⭐⭐ حالة الترتيب — نقطة مقبولة واحدة لكل (مستأجر · نطاق).
 * ⛔ الحالة لا تُكتب إلا على القبول — ⭐ لا على التأجيل.
 * ⛔ ولا تُقرأ نطاقاً لمستأجر آخر.
 */
export class OrderingState {
  readonly #points: Map<string, Map<string, OrderingPoint>> = new Map();

  /** ⭐ آخر نقطة مقبولة في نطاق المستأجر — أو `undefined`. */
  lastAccepted(context: TenantContext, scope: OrderingScope): OrderingPoint | undefined {
    const scopes = this.#points.get(context.tenantId);
    const point = scopes?.get(scope);
    return point ? { ...point } : undefined;
  }

  /** ⭐ تسجيل نقطة مقبولة جديدة (على القبول فقط). */
  recordAccepted(
    context: TenantContext,
    scope: OrderingScope,
    point: OrderingPoint,
  ): void {
    const scopes = this.#points.get(context.tenantId) ?? new Map<string, OrderingPoint>();
    scopes.set(scope, { ...point });
    this.#points.set(context.tenantId, scopes);
  }
}

/**
 * ⭐⭐⭐ فحص الترتيب — تنفيذ قاعدة المالك كما هي.
 *
 * @param scope  النطاق الموثوق · أو `null` ⇒ **القاعدة لا تُنفَّذ** (لا تأجيل ولا ترتيب).
 * @param lastAccepted  آخر نقطة مقبولة في نفس النطاق · أو `undefined` ⇒ أول رسالة.
 *
 * ⭐ القاعدة:
 * ⭐ **الأقدم ⇒ تأجيل** (ولا رفض نهائي) · ⭐ **تساوي التوقيت لرسالة مختلفة ⇒ تأجيل الثانية**
 * ⭐ **ولا ترتيب اعتباطي · ولا تحديث للنقطة المقبولة على التأجيل**.
 */
export function evaluateOrdering(options: {
  scope: OrderingScope | null;
  occurredAt: string;
  messageRef: string;
  lastAccepted: OrderingPoint | undefined;
}): OrderingDecision {
  const { scope, occurredAt, messageRef, lastAccepted } = options;
  if (scope === null) {
    // ⭐ لا نطاق موثوق ⇒ القاعدة مُوقَّفة (قرار المالك) ⇒ لا تأجيل ولا ترتيب.
    return { outcome: 'not_applicable', reason_code: 'accepted_no_ordering_scope' };
  }
  if (!lastAccepted) {
    return { outcome: 'in_order', reason_code: 'accepted_in_order' };
  }
  const current = Date.parse(occurredAt);
  const last = Date.parse(lastAccepted.occurred_at);
  if (Number.isNaN(current) || Number.isNaN(last)) {
    // ⭐ حالة خارج القائمة المغلقة ⇒ تأجيل لا تخمين.
    return { outcome: 'deferred', reason_code: 'deferred_unknown' };
  }
  if (current < last) {
    return { outcome: 'deferred', reason_code: 'deferred_out_of_order' };
  }
  if (current === last && messageRef !== lastAccepted.message_ref) {
    return { outcome: 'deferred', reason_code: 'deferred_equal_timestamp' };
  }
  return { outcome: 'in_order', reason_code: 'accepted_in_order' };
}

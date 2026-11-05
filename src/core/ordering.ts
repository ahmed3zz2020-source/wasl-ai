// ============================================================
// WASL AI — قاعدة ترتيب الرسائل (Slice 02 · طبقة المعالجة)
// ------------------------------------------------------------
// ⭐ مواصفة مقبولة: `docs/SLICE-02-ORDERING-RULE.md` (قرار المالك)
// ⭐ المبدأ: ⭐ **النطاق = (المستأجر · المحادثة الموثوقة)** ⇒ ⭐ **وكلاهما
//   من السياق الموثوق — لا من محتوى الرسالة** ⇒ ⭐ **فلا تسرب بين المستأجرين
//   ولا خلط بين محادثات المستأجر الواحد**.
// ⛔ `occurred_at` بتوقيت UTC — والعقد يفرض `Z` ويفحص صحته.
// ⭐ الرسالة المؤجلة ⛔ لا تُغيّر آخر توقيت مقبول · ⛔ ولا تُعالَج تلقائياً.
// ⛔ لا إعادة ترتيب · ⛔ لا مزامنة · ⛔ لا طابور جديد.
// ============================================================

import type { TenantContext } from './tenant.ts';

/**
 * ⭐ معرّف النطاق (محادثة) — ⭐ **قيمة موثوقة من السياق** (لا من الرسالة).
 */
export type OrderingScope = string;

/** ⭐ أسباب التأجيل — قائمة مغلقة. */
export type OrderingDeferReason = 'deferred_out_of_order' | 'deferred_equal_timestamp' | 'deferred_unknown';

/** ⭐ نتيجة فحص الترتيب. */
export type OrderingDecision =
  | { readonly outcome: 'in_order'; readonly reason_code: 'accepted_in_order' }
  | { readonly outcome: 'deferred'; readonly reason_code: OrderingDeferReason };

/** ⭐ آخر نقطة مقبولة في نطاق واحد. */
export interface OrderingPoint {
  readonly occurred_at: string;
  readonly message_ref: string;
}

/**
 * ⭐⭐ حالة الترتيب — نقطة مقبولة واحدة لكل (مستأجر · محادثة).
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
 * @param lastAccepted  آخر نقطة مقبولة في نفس النطاق (المستأجر · المحادثة) · أو `undefined` ⇒ أول رسالة.
 *
 * ⭐ القاعدة:
 * ⭐ **الأقدم ⇒ تأجيل** (ولا رفض نهائي) · ⭐ **تساوي التوقيت لرسالة مختلفة ⇒ تأجيل الثانية**
 * ⭐ **ولا ترتيب اعتباطي · ولا تحديث للنقطة المقبولة على التأجيل**.
 */
export function evaluateOrdering(options: {
  occurredAt: string;
  messageRef: string;
  lastAccepted: OrderingPoint | undefined;
}): OrderingDecision {
  const { occurredAt, messageRef, lastAccepted } = options;
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

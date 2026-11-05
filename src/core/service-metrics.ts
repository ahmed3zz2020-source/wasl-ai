// ============================================================
// WASL AI — مؤشرات الخدمة (الشريحة الخامسة)
// ------------------------------------------------------------
// ⭐⭐ **قراءة فقط** ⇒ ⭐ محسوبة لحظياً من الشريحتين ٣ و ٤ ⇒ ⭐
//   **بلا تخزين دائم** (لا جداول مجمّعة · لا حالة جديدة).
// ⛔ **بلا نص رسائل ولا أسرار** ⇒ ⭐ المخرجات: معرّفات + أرقام.
// ⛔ **لا قيمة مخترَعة** ⇒ ⭐ أي مؤشر لا تسمح البيانات بحسابه يُعيد
//   `undefined` **صراحةً** (لا صفر بديل ولا تقدير).
// ⭐ **الجمهور (قرار المالك · ٥ نوفمبر ٢٠٢٦)**: ⭐ **المشرف والمالك فقط**
//   ⇒ ⭐ صلاحية صريحة `conversation.metrics.read`.
// ⛔ لا اتصال خارجي · ⛔ لا نشر.
// ============================================================

import { assertCapability } from './capability.ts';
import type { TenantContext } from './tenant.ts';
import type { MessageStore } from './store.ts';
import type { ConversationState, ConversationStateStore } from './conversation-state.ts';
import type { ConversationChangeLog } from './conversation-change-log.ts';
import type { ReadAuditLog } from './read-audit.ts';
import {
  computeConversationActivity,
  DEFAULT_LATE_THRESHOLD_MINUTES,
  type AgentWorkQueueDependencies,
} from './agent-queue.ts';

/** ⭐ صلاحية قراءة مؤشرات الخدمة — ⭐ **المشرف والمالك فقط**. */
export const CONVERSATION_METRICS_CAPABILITY = 'conversation.metrics.read';

export interface ServiceMetricsDependencies extends AgentWorkQueueDependencies {
  readonly store: MessageStore;
  readonly states: ConversationStateStore;
  readonly changes: ConversationChangeLog;
  readonly readAudit: ReadAuditLog;
}

export interface ServiceMetricsOptions {
  /** ⭐ لحظة القياس (ISO) — ⭐ **deterministic**. */
  readonly now?: string;
  /** ⭐ معيار التأخير بالدقائق — ⭐ افتراضي ٣٠ (نفس معيار الطابور). */
  readonly late_threshold_minutes?: number;
}

/** ⭐⭐⭐ مؤشرات الخدمة — ⭐ **أرقام فقط** (لا نصوص ولا أسرار). */
export interface ServiceMetrics {
  /** ⭐ إجمالي محادثات المستأجر. */
  readonly conversations_total: number;
  /** ⭐ عدد المحادثات لكل حالة — ⭐ **كل الحالات الست** (صفر محسوب لا مخترع). */
  readonly by_state: Readonly<Record<ConversationState, number>>;
  /** ⭐ محادثات بلا مُسندة. */
  readonly unassigned_total: number;
  /** ⭐ محادثات تجاوزت معيار التأخير. */
  readonly late_total: number;
  /** ⭐ متوسط زمن أول رد (بالدقائق) — ⭐ `undefined` إن لم تُحسب بيانات كافية. */
  readonly first_response_minutes: number | undefined;
  /** ⭐ متوسط زمن الحل (بالدقائق) — ⭐ `undefined` إن لم تُحسب بيانات كافية. */
  readonly resolution_minutes: number | undefined;
  /** ⭐ العبء لكل موظف — ⭐ معرّف + عدد (بلا أسماء ولا نصوص). */
  readonly load_per_employee: readonly { readonly actor_id: string; readonly open_count: number }[];
}

export class ServiceMetricsError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ServiceMetricsError';
    this.code = code;
  }
}

function requireCapability(
  context: TenantContext,
  deps: ServiceMetricsDependencies,
): void {
  try {
    assertCapability(context, CONVERSATION_METRICS_CAPABILITY);
  } catch (error) {
    deps.readAudit.record({
      tenant_id: context.tenantId,
      actor_id: context.actorId,
      operation: 'conversation.metrics.read',
      capability: CONVERSATION_METRICS_CAPABILITY,
      result: 'denied',
    });
    throw error;
  }
}

function emptyStateCounts(): Record<ConversationState, number> {
  return {
    new: 0,
    open: 0,
    assigned: 0,
    pending: 0,
    resolved: 0,
    closed: 0,
  };
}

function average(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sum = values.reduce((total, value) => total + value, 0);
  return Math.round((sum / values.length) * 100) / 100;
}

/**
 * ⭐⭐⭐⭐⭐ **مؤشرات الخدمة** — ⭐ **قراءة فقط + لا قيمة مخترَعة**.
 * ⛔ لا تُعيد نص رسالة — ⭐ أرقام ومعرّفات فقط.
 * ⛔ النطاق من السياق وحده — ⭐ ولا مدخل مستأجر من العميل.
 */
export function getServiceMetrics(
  context: TenantContext,
  deps: ServiceMetricsDependencies,
  options: ServiceMetricsOptions = {},
): ServiceMetrics {
  requireCapability(context, deps);
  const now = options.now ?? new Date().toISOString();
  const threshold =
    options.late_threshold_minutes === undefined
      ? DEFAULT_LATE_THRESHOLD_MINUTES
      : Math.floor(options.late_threshold_minutes);
  if (!Number.isFinite(threshold) || threshold < 1) {
    throw new ServiceMetricsError(
      'late_threshold_invalid',
      'معيار التأخير لازم يكون رقماً ≥ ١ دقيقة',
    );
  }

  const refs = deps.store.conversationRefs(context);
  const byState = emptyStateCounts();
  const load = new Map<string, number>();
  const firstResponseSamples: number[] = [];
  const resolutionSamples: number[] = [];
  let unassignedTotal = 0;
  let lateTotal = 0;

  for (const ref of refs) {
    const row = deps.states.get(context.tenantId, ref);
    const state: ConversationState = row?.state ?? 'new';
    const assignee = row?.assignee_actor_id ?? null;
    byState[state] += 1;
    if (assignee === null) unassignedTotal += 1;

    const activity = computeConversationActivity(context, ref, deps, {
      now,
      late_threshold_minutes: threshold,
    });
    if (activity.is_late) lateTotal += 1;

    // ⭐ العبء = محادثات **غير مغلقة** لكل موظف.
    if (assignee !== null && state !== 'resolved' && state !== 'closed') {
      load.set(assignee, (load.get(assignee) ?? 0) + 1);
    }

    const rows = deps.store.messagesForConversation(context, ref);
    const firstInbound = rows.find((row) => row.direction === 'inbound');
    const firstOutbound = rows.find((row) => row.direction === 'outbound');
    // ⭐ زمن أول رد = ⭐ **أول رسالة صادرة − أول رسالة واردة** ⇒ ⭐ ولو لم توجد
    // رسالة صادرة ⇒ ⭐ لا عيّنة (ولا صفراً مخترعاً).
    if (firstInbound && firstOutbound) {
      const delta = Date.parse(firstOutbound.occurred_at) - Date.parse(firstInbound.occurred_at);
      if (Number.isFinite(delta) && delta >= 0) {
        firstResponseSamples.push(Math.floor(delta / 60000));
      }
    }

    // ⭐ زمن الحل = ⭐ **قيد التغيير الذي بلغ `resolved`/`closed` − أول رسالة واردة**.
    const changes = deps.changes.changesFor(context, ref);
    const solved = changes.find(
      (entry) => entry.to_state === 'resolved' || entry.to_state === 'closed',
    );
    if (firstInbound && solved) {
      const delta = Date.parse(solved.ts) - Date.parse(firstInbound.occurred_at);
      if (Number.isFinite(delta) && delta >= 0) {
        resolutionSamples.push(Math.floor(delta / 60000));
      }
    }
  }

  const loadPerEmployee = [...load.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([actor_id, open_count]) => ({ actor_id, open_count }));

  deps.readAudit.record({
    tenant_id: context.tenantId,
    actor_id: context.actorId,
    operation: 'conversation.metrics.read',
    capability: CONVERSATION_METRICS_CAPABILITY,
    result: 'allowed',
    count: refs.length,
  });

  return {
    conversations_total: refs.length,
    by_state: byState,
    unassigned_total: unassignedTotal,
    late_total: lateTotal,
    first_response_minutes: average(firstResponseSamples),
    resolution_minutes: average(resolutionSamples),
    load_per_employee: loadPerEmployee,
  };
}

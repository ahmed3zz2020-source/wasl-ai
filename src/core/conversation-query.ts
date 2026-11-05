// ============================================================
// WASL AI — طبقة قراءة محادثات المستأجر (الشريحة الثالثة)
// ------------------------------------------------------------
// ⭐⭐ المبدأ الحاكم: القراءة = عملية مُصرَّح بها داخل نطاق مستأجر واحد.
//   ⇒ ⭐ المستأجر من **سياق جلسة موثوق** · ⭐ والصلاحية تُفحص **قبل** أي وصول.
//   ⛔ لا مدخل في أي دالة هنا يقبل معرّف مستأجر من العميل.
//   ⛔ ومعرّف المحادثة مُحدِّد داخل بيانات المستأجر — ⭐ **ليس دليل حق وصول**.
// ⭐ قدرتان منفصلتان: ⭐ «قائمة المحادثات» ⭐ و«قراءة محادثة واحدة» ⭐ و«قراءة التدقيق».
// ⛔ لا واجهة منشورة ولا API خارجي — ⭐ مسار قراءة محلي بالكامل.
// ============================================================

import { assertCapability } from './capability.ts';
import { CONVERSATION_REF_PATTERN } from './tenant.ts';
import type { TenantContext } from './tenant.ts';
import type { AuditEntry, AuditLog } from './audit-log.ts';
import type { MessageStore, StoredMessage } from './store.ts';
import type { ReadAuditLog } from './read-audit.ts';

/** ⭐ صلاحية عرض قائمة محادثات المستأجر. */
export const CONVERSATION_LIST_CAPABILITY = 'conversation.list';
/** ⭐ صلاحية قراءة محادثة واحدة. */
export const CONVERSATION_READ_CAPABILITY = 'conversation.read';
/** ⭐ صلاحية قراءة أحداث التدقيق (قرارات القبول والتأجيل والرفض). */
export const CONVERSATION_AUDIT_CAPABILITY = 'conversation.audit';

/** ⭐ أقصى حجم صفحة — ⭐ حدّ أعلى ثابت يمنع صفحة بلا حدّ. */
export const MAX_PAGE_SIZE = 100;
/** ⭐ حجم الصفحة الافتراضي. */
export const DEFAULT_PAGE_SIZE = 50;

export interface ConversationSummary {
  readonly conversation_ref: string;
  readonly message_count: number;
  /** ⭐ أول توقيت مقبول — ⭐ **مفتاح ترتيب لا يتغيّر** ⇒ ترقيم مستقر. */
  readonly first_occurred_at: string;
  /** ⭐ آخر توقيت مقبول — ⭐ معروض للمشغّل ⭐ وليس مفتاح الترتيب. */
  readonly last_occurred_at: string;
}

export interface ConversationMessage {
  readonly message_ref: string;
  readonly direction: string;
  readonly occurred_at: string;
  readonly locale: string;
  /** ⭐ نص الرسالة — ⭐ **لرسائل مقبولة مخزَّنة فقط** (المرفوضة والمؤجلة ليست مخزَّنة). */
  readonly body: string;
  readonly stored_at: string;
}

export interface ConversationThread {
  readonly conversation_ref: string;
  readonly messages: readonly ConversationMessage[];
  readonly pagination: ConversationPageInfo;
}

/** ⭐ معلومات الصفحة — ⭐ المؤشر (cursor) هو مفتاح الصفحة التالية. */
export interface ConversationPageInfo {
  readonly limit: number;
  readonly returned: number;
  readonly total: number;
  readonly next_cursor: string | null;
}

export interface ConversationAuditPage {
  readonly conversation_ref: string;
  readonly entries: readonly AuditEntry[];
  readonly pagination: ConversationPageInfo;
}

export interface ConversationQueryDependencies {
  readonly store: MessageStore;
  readonly audit: AuditLog;
  /** ⭐ سجل أحداث القراءة — ⭐ **إلزامي** ⇒ كل عملية قراءة موثّقة (لا مسار افتراضي). */
  readonly readAudit: ReadAuditLog;
}

export class ConversationQueryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ConversationQueryError';
    this.code = code;
  }
}

interface PageOptions {
  readonly limit?: number;
  /** ⭐ مؤشر الصفحة السابقة — ⭐ دلالته تختلف حسب العملية (مُعلَن في كل دالة). */
  readonly cursor?: string;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new ConversationQueryError('limit_invalid', 'حدّ الصفحة لازم يكون عدداً صحيحاً ≥ ١');
  }
  return Math.min(limit, MAX_PAGE_SIZE);
}

/** ⭐⭐ فحص الصلاحية + توثيق المحاولة — ⭐ الفحص قبل أي وصول للبيانات. */
function requireCapability(
  context: TenantContext,
  capability: string,
  operation: 'conversation.list' | 'conversation.read' | 'conversation.audit',
  deps: ConversationQueryDependencies,
  target?: string,
): void {
  try {
    assertCapability(context, capability);
  } catch (error) {
    deps.readAudit.record({
      tenant_id: context.tenantId,
      actor_id: context.actorId,
      operation,
      capability,
      result: 'denied',
      ...(target !== undefined ? { target } : {}),
    });
    throw error;
  }
}

function summarize(
  store: MessageStore,
  context: TenantContext,
  conversationRef: string,
): ConversationSummary {
  const rows = store.messagesForConversation(context, conversationRef);
  const first = rows[0];
  const last = rows[rows.length - 1];
  return {
    conversation_ref: conversationRef,
    message_count: rows.length,
    first_occurred_at: first?.occurred_at ?? '',
    last_occurred_at: last?.occurred_at ?? '',
  };
}

/** ⭐ ترتيب حتمي: ⭐ أول توقيت (لا يتغيّر) تنازلياً · ⭐ ثم المعرّف تصاعدياً. */
function compareSummaries(a: ConversationSummary, b: ConversationSummary): number {
  if (a.first_occurred_at !== b.first_occurred_at) {
    return a.first_occurred_at < b.first_occurred_at ? 1 : -1;
  }
  return a.conversation_ref < b.conversation_ref ? -1 : 1;
}

/**
 * ⭐⭐ قائمة محادثات المستأجر.
 * ⛔ لا تقبل معرّف مستأجر — ⭐ النطاق من السياق وحده.
 * ⭐ المؤشر (cursor) = معرّف آخر محادثة في الصفحة السابقة.
 */
export function listConversations(
  context: TenantContext,
  deps: ConversationQueryDependencies,
  options: PageOptions = {},
): { readonly summaries: readonly ConversationSummary[]; readonly pagination: ConversationPageInfo } {
  requireCapability(context, CONVERSATION_LIST_CAPABILITY, 'conversation.list', deps);
  const limit = clampLimit(options.limit);

  const all = deps.store
    .conversationRefs(context)
    .map((ref) => summarize(deps.store, context, ref))
    .sort(compareSummaries);

  let start = 0;
  if (options.cursor !== undefined) {
    const index = all.findIndex((item) => item.conversation_ref === options.cursor);
    if (index === -1) {
      throw new ConversationQueryError(
        'cursor_invalid',
        'مؤشر الصفحات غير معروف في نطاق المستأجر',
      );
    }
    start = index + 1;
  }

  const items = all.slice(start, start + limit);
  const next =
    start + items.length < all.length && items.length > 0
      ? items[items.length - 1].conversation_ref
      : null;

  deps.readAudit.record({
    tenant_id: context.tenantId,
    actor_id: context.actorId,
    operation: 'conversation.list',
    capability: CONVERSATION_LIST_CAPABILITY,
    result: 'allowed',
    count: items.length,
  });

  return {
    summaries: items,
    pagination: { limit, returned: items.length, total: all.length, next_cursor: next },
  };
}

/**
 * ⭐⭐ رسائل محادثة واحدة — ⭐ **المخزَّنة (المقبولة) فقط**.
 * ⛔ محادثة لا تخص المستأجر ⇒ ⭐ صفوف صفر (ولا خطأ يكشف وجودها).
 * ⭐ المؤشر (cursor) = معرّف آخر رسالة في الصفحة السابقة.
 */
export function getConversation(
  context: TenantContext,
  conversationRef: string,
  deps: ConversationQueryDependencies,
  options: PageOptions = {},
): ConversationThread {
  if (!CONVERSATION_REF_PATTERN.test(conversationRef)) {
    throw new ConversationQueryError('conversation_ref_invalid', 'معرّف المحادثة غير صالح');
  }
  requireCapability(context, CONVERSATION_READ_CAPABILITY, 'conversation.read', deps, conversationRef);
  const limit = clampLimit(options.limit);

  const rows = deps.store.messagesForConversation(context, conversationRef);
  let start = 0;
  if (options.cursor !== undefined) {
    const index = rows.findIndex((row) => row.message_ref === options.cursor);
    if (index === -1) {
      throw new ConversationQueryError(
        'cursor_invalid',
        'مؤشر الصفحات غير معروف في نطاق المستأجر',
      );
    }
    start = index + 1;
  }

  const page = rows.slice(start, start + limit);
  const messages = page.map((row: StoredMessage) => ({
    message_ref: row.message_ref,
    direction: row.direction,
    occurred_at: row.occurred_at,
    locale: row.locale,
    body: row.body,
    stored_at: row.stored_at,
  }));
  const next =
    start + messages.length < rows.length && messages.length > 0
      ? messages[messages.length - 1].message_ref
      : null;

  deps.readAudit.record({
    tenant_id: context.tenantId,
    actor_id: context.actorId,
    operation: 'conversation.read',
    capability: CONVERSATION_READ_CAPABILITY,
    result: 'allowed',
    target: conversationRef,
    count: messages.length,
  });

  return {
    conversation_ref: conversationRef,
    messages,
    pagination: { limit, returned: messages.length, total: rows.length, next_cursor: next },
  };
}

/**
 * ⭐⭐ أحداث تدقيق محادثة واحدة — ⭐ **المصدر الوحيد لقرارات الرسائل غير المخزَّنة**.
 * ⛔ لا نص رسالة ولا أسرار — ⭐ السجل يحمل القرار وسببه فقط.
 * ⭐ المؤشر (cursor) = ترتيب السطر داخل سجل التدقيق (السجل append-only ⇒ مستقر).
 */
export function readConversationAudit(
  context: TenantContext,
  conversationRef: string,
  deps: ConversationQueryDependencies,
  options: PageOptions = {},
): ConversationAuditPage {
  if (!CONVERSATION_REF_PATTERN.test(conversationRef)) {
    throw new ConversationQueryError('conversation_ref_invalid', 'معرّف المحادثة غير صالح');
  }
  requireCapability(context, CONVERSATION_AUDIT_CAPABILITY, 'conversation.audit', deps, conversationRef);
  const limit = clampLimit(options.limit);

  const all = deps.audit.entriesFor(context, { conversationRef });
  let start = 0;
  if (options.cursor !== undefined) {
    const parsed = Number.parseInt(options.cursor, 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new ConversationQueryError('cursor_invalid', 'مؤشر الصفحات غير صالح');
    }
    start = parsed;
  }

  const page = all.slice(start, start + limit);
  const next =
    start + page.length < all.length && page.length > 0
      ? String(start + page.length)
      : null;

  deps.readAudit.record({
    tenant_id: context.tenantId,
    actor_id: context.actorId,
    operation: 'conversation.audit',
    capability: CONVERSATION_AUDIT_CAPABILITY,
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

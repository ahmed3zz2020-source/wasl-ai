// ============================================================
// WASL AI — النواة الداخلية للشريحة الأولى (تصدير موحّد)
// ------------------------------------------------------------
// المكوّنات الأربعة المعتمدة في تصريح المالك (MISSION 004):
//   ١) عقد الرسالة الداخلي  → envelope.ts
//   ٢) عزل المستأجر        → tenant.ts + store.ts
//   ٣) البيانات الاصطناعية → ⛔ NOT HERE (tests/support/synthetic.ts)
//   ٤) سجل التدقيق المحلي  → audit-log.ts
// ⛔ لا تكامل خارجي · ⛔ لا شبكة · ⛔ لا حساب · ⛔ لا نشر.
// ============================================================
// ⭐⭐ هذا هو السطح العام الإنتاجي الوحيد.
// ⛔ لا يُصدَّر منه أي أداة اختبار · ولا مولّد بيانات اصطناعية.
// ⛔ ولا `localTestSessionSource` ولا `markLocalTestInput`.
// ⛔ ولا أي دالة تُنتج ادّعاءات خام أو تُصدر إثبات جلسة.
// ⭐ ⇒ المصدر الوحيد لإنشاء سياق مستأجر معتمد = `resolveTenantContext`
//    (بمصدر جلسات إلزامي) و`resolveProductionTenantContext` (يرفض مصدر الاختبار).
// ============================================================

export {
  ENVELOPE_RULES,
  ENVELOPE_SCHEMA_VERSION,
  ENVELOPE_SUPPORTED_SCHEMA_VERSIONS,
  EnvelopeValidationError,
  parseEnvelope,
  validateEnvelope,
  type EnvelopeFieldError,
  type EnvelopeRuleName,
  type EnvelopeValidation,
  type MessageAttributes,
  type MessageDirection,
  type MessageEnvelope,
} from './envelope.ts';

// ⭐ Slice 03 — الصلاحيات المحلية (حدّ الثقة نفسه · ⭐ الافتراضي = المنع)
// ⭐ الدور وسياسة الأدوار (حدّ الثقة — الاصلاحية من النواة)
export {
  CAPABILITY_PATTERN,
  CapabilityError,
  ROLE_CAPABILITIES,
  TRUSTED_ROLES,
  assertCapability,
  isTrustedRole,
  normalizeCapabilities,
  resolveGrantedCapabilities,
  type TrustedRole,
} from './capability.ts';

export {
  ACTOR_ID_PATTERN,
  CONVERSATION_REF_PATTERN,
  SESSION_ID_PATTERN,
  TENANT_ID_PATTERN,
  TenantContextError,
  assertConversationMatches,
  assertTenantMatches,
  defaultNow,
  type SessionAttestation,
  type SessionClaims,
  type SessionSourceId,
  type TenantContext,
  type TenantId,
  type TrustedClaims,
  type VerifiedIdentity,
} from './tenant.ts';

// ⛔ `tenantContextFromSession` و`issueSessionAttestation` و`registerSessionSource`
//    و`markLocalTestInput`
//    **غير مُصدرة من السطح العام** ⇒ المسار العام الوحيد = `resolveTenantContext`
//    (بمصدر جلسات إلزامي **مسجّل**) و`resolveProductionTenantContext` (يرفض مصدر الاختبار).

export {
  activeSessionSources,
  resolveProductionTenantContext,
  resolveTenantContext,
  type SessionScope,
  type SessionSource,
} from './session.ts';

export {
  AUDIT_META_ALLOWLIST,
  AuditLog,
  AuditLogError,
  SECRET_PATTERNS,
  type AuditEntry,
  type AuditInput,
  type AuditOutcome,
  type AuditSink,
} from './audit-log.ts';

export {
  MessageStore,
  type AppendOutcome,
  type StoredMessage,
} from './store.ts';

// ⭐ Slice 02 — طبقة المعالجة (عقد النتيجة + خط المعالجة)
export {
  PROCESSING_OUTCOME_RULES,
  ProcessingLayer,
  ProcessingOutcomeError,
  parseProcessingOutcome,
  validateProcessingOutcome,
  type ProcessingDecision,
  type ProcessingDependencies,
  type ProcessingOutcome,
  type ProcessingOutcomeRuleName,
  type ProcessingOutcomeValidation,
  type ProcessingReasonCode,
} from './processing.ts';

// ⭐ Slice 02 — قاعدة الترتيب (قرار المالك: `docs/SLICE-02-ORDERING-RULE.md`)
export {
  OrderingState,
  evaluateOrdering,
  type OrderingDecision,
  type OrderingDeferReason,
  type OrderingPoint,
  type OrderingScope,
} from './ordering.ts';

// ⭐ Slice 03 — سجل أحداث القراءة (⭐ مسار منفصل عن `AuditOutcome`)
export {
  ReadAuditError,
  ReadAuditLog,
  type ReadAuditEvent,
  type ReadAuditInput,
  type ReadAuditOperation,
  type ReadAuditResult,
} from './read-audit.ts';

// ⭐ Slice 03 — طبقة قراءة محادثات المستأجر (⭐ قدرتان منفصلتان · ⭐ بلا واجهة منشورة)
export {
  CONVERSATION_AUDIT_CAPABILITY,
  CONVERSATION_LIST_CAPABILITY,
  CONVERSATION_READ_CAPABILITY,
  ConversationQueryError,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  getConversation,
  listConversations,
  readConversationAudit,
  type ConversationAuditPage,
  type ConversationMessage,
  type ConversationPageInfo,
  type ConversationQueryDependencies,
  type ConversationSummary,
  type ConversationThread,
} from './conversation-query.ts';

// ⭐ Slice 04 — سجل تغييرات المحادثات (⭐ مستقل عن سجل المعالجة وسجل أحداث القراءة)
export {
  CONVERSATION_CHANGE_OPERATIONS,
  CONVERSATION_CHANGE_STATES,
  ConversationChangeError,
  ConversationChangeLog,
  assertChangeEntry,
  assertChangeReason,
  MAX_CHANGE_REASON_LENGTH,
  type ConversationChangeEntry,
  type ConversationChangeInput,
  type ConversationChangeOperation,
  type ConversationChangeState,
} from './conversation-change-log.ts';

// ⭐ Slice 04 — طبقة إدارة حالة المحادثة والإسناد
export {
  ALLOWED_TRANSITIONS,
  CONVERSATION_ASSIGN_CAPABILITY,
  CONVERSATION_STATE_OPERATIONS,
  CONVERSATION_STATE_READ_CAPABILITY,
  CONVERSATION_STATE_UPDATE_CAPABILITY,
  CONVERSATION_STATES,
  ConversationStateError,
  ConversationStateStore,
  TERMINAL_CONVERSATION_STATES,
  isTerminalState,
  MAX_CHANGE_PAGE_SIZE,
  assignConversation,
  getConversationState,
  readConversationChanges,
  unassignConversation,
  updateConversationState,
  type ConversationChangePage,
  type ConversationState,
  type ConversationStateDependencies,
  type ConversationStateOperation,
  type ConversationStateView,
  type EmployeeDirectory,
} from './conversation-state.ts';

// ⭐ Slice 05 — مركز عمل الوكيل (⭐ قراءة فقط · بلا نص رسائل · عزل بالمستأجر)
export {
  AgentWorkQueueError,
  CONVERSATION_QUEUE_CAPABILITY,
  DEFAULT_IDLE_THRESHOLD_MINUTES,
  DEFAULT_QUEUE_PAGE_SIZE,
  MAX_QUEUE_PAGE_SIZE,
  computeConversationActivity,
  listWorkQueue,
  type AgentWorkQueueDependencies,
  type AgentWorkQueueOptions,
  type ConversationActivity,
  type WorkQueueCategory,
  type WorkQueueItem,
  type WorkQueuePageInfo,
} from './agent-queue.ts';

// ⭐ Slice 05 — مؤشرات الخدمة (⭐ قراءة فقط · لا قيمة مخترَعة · المشرف والمالك فقط)
export {
  CONVERSATION_METRICS_CAPABILITY,
  ServiceMetricsError,
  getServiceMetrics,
  type ServiceMetrics,
  type ServiceMetricsDependencies,
  type ServiceMetricsOptions,
} from './service-metrics.ts';

// ⛔⛔ لا مولّد بيانات اصطناعية هنا.
// ⭐ نُقل إلى شجرة الاختبار (خارج حزمة الإنتاج) ⇒ ولا ذكر لأدوات الاختبار هنا.
// ⛔ لا مصدر جلسات اختباري هنا — ولا حتى واحد.
// ⛔ ولا مصدر إنتاجي مسجَّل ⇒ لا افتراض افتراضي لمصدر الجلسات.

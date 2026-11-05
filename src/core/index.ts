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

export {
  ACTOR_ID_PATTERN,
  SESSION_ID_PATTERN,
  TENANT_ID_PATTERN,
  TenantContextError,
  assertTenantMatches,
  defaultNow,
  type SessionAttestation,
  type SessionClaims,
  type SessionSourceId,
  type TenantContext,
  type TenantId,
} from './tenant.ts';

// ⛔ `tenantContextFromSession` و`issueSessionAttestation` و`markLocalTestInput`
//    **غير مُصدَّرة من السطح العام** ⇒ المسار العام الوحيد لإنشاء سياق
//    مستأجر معتمد = `resolveTenantContext` (يمرّ بمصدر جلسات).

export {
  ACTIVE_SESSION_SOURCES,
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

// ⛔⛔ لا مولّد بيانات اصطناعية هنا.
// ⭐ نُقل إلى شجرة الاختبار (خارج حزمة الإنتاج) ⇒ ولا ذكر لأدوات الاختبار هنا.
// ⛔ لا مصدر جلسات اختباري هنا — ولا حتى واحد.
// ⛔ ولا مصدر إنتاجي مسجَّل ⇒ لا افتراض افتراضي لمصدر الجلسات.

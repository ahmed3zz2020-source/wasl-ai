// ============================================================
// WASL AI — النواة الداخلية للشريحة الأولى (تصدير موحّد)
// ------------------------------------------------------------
// المكوّنات الأربعة المعتمدة في تصريح المالك (MISSION 004):
//   ١) عقد الرسالة الداخلي  → envelope.ts
//   ٢) عزل المستأجر        → tenant.ts + store.ts
//   ٣) البيانات الاصطناعية → synthetic.ts
//   ٤) سجل التدقيق المحلي  → audit-log.ts
// ⛔ لا تكامل خارجي · ⛔ لا شبكة · ⛔ لا حساب · ⛔ لا نشر.
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
  localTestSessionSource,
  resolveTenantContext,
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

export {
  SYNTHETIC_EMAIL_DOMAIN,
  createSeededRandom,
  createSyntheticActorId,
  createSyntheticAddress,
  createSyntheticContext,
  createSyntheticDisplayName,
  createSyntheticEnvelope,
  createSyntheticPair,
  createSyntheticSession,
  createSyntheticTenantId,
  toArabicDigits,
} from './synthetic.ts';

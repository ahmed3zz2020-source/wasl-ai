// ============================================================
// WASL AI — عقد الرسالة الداخلي (المكوّن ١ · الشريحة الأولى)
// ------------------------------------------------------------
// عقد مستقل عن أي مزوّد خارجي:
//   ⛔ لا حقل من Meta · ⛔ لا حقل Webhook · ⛔ لا منطق معالجة.
// ⭐ الحقول والأنواع والصيغ معلنة في جدول قواعد واحد (ENVELOPE_RULES)
//   ⇒ فأي رفض يكون بقاعدة معلنة، لا بذوق.
// ⭐ message_ref هو معرّف idempotency داخلي نضعه نحن (لا اسم مزوّد)
//   ⇒ وبه يكون بند «منع التكرار» من معايير القبول مُطبَّقاً صراحةً.
// ============================================================

import { TENANT_ID_PATTERN } from './tenant.ts';

export const ENVELOPE_SCHEMA_VERSION = '1';

export type MessageDirection = 'inbound' | 'outbound';

export type MessageAttributes = Readonly<Record<string, string>>;

/** شكل الرسالة الداخلي بعد التحقق. */
export interface MessageEnvelope {
  readonly schema_version: string;
  readonly message_ref: string;
  readonly channel: string;
  readonly direction: MessageDirection;
  readonly from: string;
  readonly to: string;
  readonly body: string;
  readonly occurred_at: string;
  readonly locale: string;
  readonly attributes: MessageAttributes;
  readonly declared_tenant_id?: string;
}

/** خطأ تحقق واحد — يحمل اسم القاعدة المعلنة. */
export interface EnvelopeFieldError {
  readonly field: string;
  readonly rule: string;
  readonly message: string;
}

export class EnvelopeValidationError extends Error {
  readonly errors: readonly EnvelopeFieldError[];
  constructor(errors: readonly EnvelopeFieldError[]) {
    super(`فشل التحقق من عقد الرسالة (${errors.length} خطأ)`);
    this.name = 'EnvelopeValidationError';
    this.errors = errors;
  }
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const ADDRESS = /^[A-Za-z0-9._:+@-]{1,128}$/;
const MESSAGE_REF = /^[A-Za-z0-9._:-]{1,64}$/;
const CHANNEL = /^[a-z0-9_]{1,32}$/;
const LOCALE = /^[a-z]{2,3}(-[A-Z]{2})?$/;
const ATTR_KEY = /^[a-z][a-z0-9_]{0,31}$/;

/**
 * ⭐ جدول القواعد المعلنة — مصدر الحقيقة الوحيد للتحقق.
 * مُستخدَم في: التحقق · رسائل الخطأ · اختبار «القاعدة المعلنة».
 */
export const ENVELOPE_RULES = {
  schema_version: { type: 'string', required: true, pattern: /^\d+$/ },
  message_ref: { type: 'string', required: true, pattern: MESSAGE_REF },
  channel: { type: 'string', required: true, pattern: CHANNEL },
  direction: { type: 'string', required: true, oneOf: ['inbound', 'outbound'] },
  from: { type: 'string', required: true, pattern: ADDRESS },
  to: { type: 'string', required: true, pattern: ADDRESS },
  body: { type: 'string', required: true, minLength: 1, maxLength: 4096 },
  occurred_at: { type: 'string', required: true, pattern: ISO_UTC },
  locale: { type: 'string', required: true, pattern: LOCALE },
  attributes: { type: 'object', required: true, maxEntries: 16, keyPattern: ATTR_KEY, maxValueLength: 256 },
  declared_tenant_id: { type: 'string', required: false, pattern: TENANT_ID_PATTERN },
} as const;

export type EnvelopeRuleName = keyof typeof ENVELOPE_RULES;

export type EnvelopeValidation =
  | { readonly ok: true; readonly value: MessageEnvelope }
  | { readonly ok: false; readonly errors: readonly EnvelopeFieldError[] };

function err(field: string, rule: string, message: string): EnvelopeFieldError {
  return { field, rule, message };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkScalar(
  field: string,
  value: unknown,
  errors: EnvelopeFieldError[],
): void {
  const rule = ENVELOPE_RULES[field] as {
    type: string;
    required: boolean;
    pattern?: RegExp;
    oneOf?: readonly string[];
    minLength?: number;
    maxLength?: number;
  };
  if (value === undefined) {
    if (rule.required) errors.push(err(field, 'required', `${field}: حقل مطلوب`));
    return;
  }
  if (value === null) {
    errors.push(err(field, 'type', `${field}: القيمة null غير مسموحة`));
    return;
  }
  if (typeof value !== rule.type) {
    errors.push(err(field, 'type', `${field}: النوع المتوقع ${rule.type}`));
    return;
  }
  const text = value as string;
  if (rule.minLength !== undefined && text.length < rule.minLength) {
    errors.push(err(field, 'min_length', `${field}: أقصر من ${rule.minLength}`));
    return;
  }
  if (rule.maxLength !== undefined && text.length > rule.maxLength) {
    errors.push(err(field, 'max_length', `${field}: أطول من ${rule.maxLength}`));
    return;
  }
  if (rule.oneOf !== undefined && !rule.oneOf.includes(text)) {
    errors.push(err(field, 'enum', `${field}: القيمة خارج المجموعة المسموحة`));
    return;
  }
  if (rule.pattern !== undefined && !rule.pattern.test(text)) {
    errors.push(err(field, 'pattern', `${field}: لا يطابق الصيغة المسموحة`));
  }
}

function checkAttributes(value: unknown, errors: EnvelopeFieldError[]): MessageAttributes {
  if (!isPlainObject(value)) {
    errors.push(err('attributes', 'type', 'attributes: النوع المتوقع object'));
    return {};
  }
  const keys = Object.keys(value);
  if (keys.length > 16) {
    errors.push(err('attributes', 'max_entries', 'attributes: عدد المدخلات أكبر من الحد'));
    return {};
  }
  const out: Record<string, string> = {};
  for (const key of keys) {
    if (!ATTR_KEY.test(key)) {
      errors.push(err(`attributes.${key}`, 'key_pattern', 'attributes: اسم المفتاح غير مسموح'));
      continue;
    }
    const val = value[key];
    if (typeof val !== 'string') {
      errors.push(err(`attributes.${key}`, 'type', 'attributes: القيمة لازم تكون نص'));
      continue;
    }
    if (val.length > 256) {
      errors.push(err(`attributes.${key}`, 'max_length', 'attributes: القيمة أطول من الحد'));
      continue;
    }
    out[key] = val;
  }
  return out;
}

/**
 * ⭐ التحقق الخالص (بلا أثر) — يرجع إمّا الرسالة مُتحقَّقاً منها أو قائمة أخطاء بقواعد معلنة.
 */
export function validateEnvelope(input: unknown): EnvelopeValidation {
  const errors: EnvelopeFieldError[] = [];
  if (!isPlainObject(input)) {
    return { ok: false, errors: [err('envelope', 'type', 'الرسالة ليست كائناً')] };
  }
  for (const field of Object.keys(ENVELOPE_RULES)) {
    checkScalar(field, input[field], errors);
  }
  if (input.occurred_at !== undefined && typeof input.occurred_at === 'string') {
    if (ISO_UTC.test(input.occurred_at) && Number.isNaN(Date.parse(input.occurred_at))) {
      errors.push(err('occurred_at', 'parse', 'occurred_at: تاريخ غير صالح'));
    }
  }
  const attributes = checkAttributes(input.attributes, errors);
  if (!errors.length) {
    const value: MessageEnvelope = {
      schema_version: input.schema_version as string,
      message_ref: input.message_ref as string,
      channel: input.channel as string,
      direction: input.direction as MessageDirection,
      from: input.from as string,
      to: input.to as string,
      body: input.body as string,
      occurred_at: input.occurred_at as string,
      locale: input.locale as string,
      attributes,
    };
    const declared = input.declared_tenant_id;
    if (declared !== undefined) {
      return { ok: true, value: { ...value, declared_tenant_id: declared as string } };
    }
    return { ok: true, value };
  }
  return { ok: false, errors };
}

/**
 * ⭐ التحقق المُنتج — يرمي استثناءً يحمل قائمة الأخطاء.
 */
export function parseEnvelope(input: unknown): MessageEnvelope {
  const result = validateEnvelope(input);
  if (!result.ok) {
    throw new EnvelopeValidationError(result.errors);
  }
  return result.value;
}

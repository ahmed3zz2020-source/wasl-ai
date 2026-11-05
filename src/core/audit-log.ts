// ============================================================
// WASL AI — سجل التدقيق المحلي (المكوّن ٤ · الشريحة الأولى)
// ------------------------------------------------------------
// ⭐ سطر واحد لكل عملية: (المستأجر · المُحدِّد · العملية · الوقت).
// ⛔ لا سر · ⛔ لا بيانات شخصية · ⛔ لا اتصال خارجي · ⛔ لا وصول شبكي.
// ⭐ الحماية بنيوية: سجل التدقيق لا يقبل حقل نص الرسالة أصلاً —
//   فالمحتوى (body) لا يستطيع الوصول إلى السجل لا من حيث النوع
//   ولا من حيث المسار.
// ⭐ حماية إضافية: قائمة سماح صريحة لمفاتيح التفاصيل + كاشف أسرار.
// ============================================================

export type AuditOutcome = 'accepted' | 'rejected' | 'duplicate';

export interface AuditEntry {
  readonly ts: string;
  readonly tenant_id: string;
  readonly actor_id: string;
  readonly operation: string;
  readonly outcome: AuditOutcome;
  readonly reason_code?: string;
  readonly meta?: Readonly<Record<string, string>>;
}

export interface AuditInput {
  readonly tenant_id: string;
  readonly actor_id: string;
  readonly operation: string;
  readonly outcome: AuditOutcome;
  readonly reason_code?: string;
  readonly meta?: Readonly<Record<string, string>>;
}

/** ⭐ قائمة السماح: أي مفتاح خارجها = رفض الكتابة (إمكان تسرّب). */
export const AUDIT_META_ALLOWLIST: readonly string[] = [
  'message_ref',
  'reason_code',
  'field',
  'count',
  'limit',
];

/** ⭐ أنماط الأسرار — أي تطابق في التفاصيل = رفض الكتابة. */
export const SECRET_PATTERNS: readonly RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/,
  /gh[pousr]_[A-Za-z0-9]{20,}/,
  /AKIA[0-9A-Z]{12,}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /(?:api[_-]?key|secret|password|passwd|token|authorization)\s*[:=]\s*\S{8,}/i,
];

export class AuditLogError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'AuditLogError';
    this.code = code;
  }
}

const OPERATION_PATTERN = /^[a-z][a-z0-9._]{1,47}$/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@-]{1,63}$/;

function containsSecret(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * ⭐ واجهة الإخراج — يوفّرها المستدعي (محلياً).
 * مثال الاختبار: يكتب في ملف JSONL على القرص.
 * (الوحدة نفسها تبقى صالحة للتشغيل على `Worker`: لا fs ولا node APIs.)
 */
export interface AuditSink {
  write(line: string): void;
}

/**
 * ⭐ سجل تدقيق محلي (في الذاكرة) — اختيارياً يُصرَّف إلى مخرَج محلي.
 */
export class AuditLog {
  readonly #entries: AuditEntry[] = [];
  readonly #now: () => string;
  readonly #sink: AuditSink | undefined;

  constructor(options: { now?: () => string; sink?: AuditSink } = {}) {
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#sink = options.sink;
  }

  /**
   * ⭐ يكتب سطراً واحداً لعملية واحدة.
   * ⛔ يرفض أي مفتاح تفاصيل خارج قائمة السماح · ⛔ يرفض أي قيمة تشبه سرّاً.
   */
  record(input: AuditInput): AuditEntry {
    if (!input || typeof input !== 'object') {
      throw new AuditLogError('input_missing', 'مدخل السجل مفقود');
    }
    if (!ID_PATTERN.test(String(input.tenant_id ?? ''))) {
      throw new AuditLogError('tenant_invalid', 'tenant_id غير صالح');
    }
    if (!ID_PATTERN.test(String(input.actor_id ?? ''))) {
      throw new AuditLogError('actor_invalid', 'actor_id غير صالح');
    }
    if (!OPERATION_PATTERN.test(String(input.operation ?? ''))) {
      throw new AuditLogError('operation_invalid', 'operation غير صالح');
    }
    if (!['accepted', 'rejected', 'duplicate'].includes(input.outcome)) {
      throw new AuditLogError('outcome_invalid', 'outcome غير صالح');
    }
    const meta: Record<string, string> = {};
    const rawMeta = input.meta;
    if (rawMeta !== undefined) {
      if (typeof rawMeta !== 'object' || rawMeta === null || Array.isArray(rawMeta)) {
        throw new AuditLogError('meta_invalid', 'meta لازم يكون كائناً');
      }
      for (const [key, value] of Object.entries(rawMeta)) {
        if (!AUDIT_META_ALLOWLIST.includes(key)) {
          throw new AuditLogError(
            'meta_key_forbidden',
            `مفتاح تفاصيل خارج قائمة السماح: ${key}`,
          );
        }
        const text = String(value);
        if (containsSecret(text)) {
          throw new AuditLogError('meta_secret_forbidden', 'قيمة تفاصيل تشبه سرّاً');
        }
        meta[key] = text;
      }
    }
    if (input.reason_code !== undefined) {
      if (!/^[a-z0-9_]{1,48}$/.test(input.reason_code)) {
        throw new AuditLogError('reason_code_invalid', 'reason_code غير صالح');
      }
      if (containsSecret(input.reason_code)) {
        throw new AuditLogError('reason_code_secret_forbidden', 'reason_code يشبه سرّاً');
      }
    }
    const entry: AuditEntry = {
      ts: this.#now(),
      tenant_id: input.tenant_id,
      actor_id: input.actor_id,
      operation: input.operation,
      outcome: input.outcome,
      ...(input.reason_code !== undefined ? { reason_code: input.reason_code } : {}),
      ...(Object.keys(meta).length ? { meta } : {}),
    };
    this.#entries.push(entry);
    if (this.#sink) {
      this.#sink.write(JSON.stringify(entry));
    }
    return entry;
  }

  /** ⭐ نسخة للقراءة — غير قابلة للتعديل. */
  entries(): readonly AuditEntry[] {
    return this.#entries.map((entry) => ({ ...entry }));
  }

  /** ⭐ سطر JSONL لكل عملية (للعرض أو الحفظ). */
  toJsonl(): string {
    return this.#entries.map((entry) => JSON.stringify(entry)).join('\n');
  }

  size(): number {
    return this.#entries.length;
  }
}

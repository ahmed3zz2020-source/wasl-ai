// ============================================================
// WASL AI — البيانات الاصطناعية المحلية (شجرة الاختبار فقط)
// ------------------------------------------------------------
// ⭐ نُقل من `src/core/synthetic.ts` (٥ نوفمبر ٢٠٢٦ · المرحلة الأولى
//   من تصريح المالك) ⇒ ⛔ خارج حزمة الإنتاج.
// ⭐ كل المخرجات اصطناعية بالكامل ومولَّدة محلياً بمُولِّد شبه عشوائي
//   مُبذَّر (deterministic) ⇒ نفس البذرة = نفس البيانات ⇒ نتائج الاختبار قابلة للتكرار.
// ⛔ لا بيانات عميل حقيقي · ⛔ لا استيراد من أي مصدر خارجي.
// ⭐ عناوين المشاركين تنتهي بنطاق `.invalid` المحجوز (RFC 2606)
//   ⇒ عنوان لا يمكن أن يوجد فعلياً على الإنترنت.
// ============================================================

import type { MessageEnvelope } from '../../src/core/envelope.ts';
import { resolveTenantContext } from '../../src/core/session.ts';
import type { SessionClaims, TenantContext } from '../../src/core/tenant.ts';
import { localTestSessionSource, markLocalTestInput } from './local-session.ts';

/** نطاق محجوز رسمياً — لا يمكن أن يوجد فعلياً. */
export const SYNTHETIC_EMAIL_DOMAIN = 'example.invalid';

/**
 * ⭐ مُولِّد شبه عشوائي (xorshift32) — مُبذَّر ⇒ قابل للتكرار.
 */
export function createSeededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

/** ⭐ معرّف مستأجر اصطناعي. */
export function createSyntheticTenantId(index: number): string {
  return `tnt_synth_${String(index).padStart(4, '0')}`;
}

/** ⭐ معرّف منفذ اصطناعي. */
export function createSyntheticActorId(index: number): string {
  return `actor_synth_${String(index).padStart(4, '0')}`;
}

/** ⭐ عنوان مشارك اصطناعي — نطاق `.invalid` محجوز. */
export function createSyntheticAddress(index: number): string {
  return `participant-synth-${String(index).padStart(4, '0')}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

/** ⭐ اسم عرض اصطناعي. */
export function createSyntheticDisplayName(index: number): string {
  return `مشترك تجريبي ${toArabicDigits(index)}`;
}

/** ⭐ تحويل الأرقام العربية-الهندية. */
export function toArabicDigits(value: number | string): string {
  return String(value).replace(/[0-9]/g, (digit) => '٠١٢٣٤٥٦٧٨٩'[Number(digit)]);
}

/**
 * ⭐ مُطالبات جلسة اصطناعية — مصدر السياق الموثوق في الاختبارات.
 * ⭐ تُعلَّم داخلياً كمُصنَّعة ⇒ يمرّ بها مصدر الجلسات المحلي فقط.
 */
export function createSyntheticSession(
  tenantIndex: number,
  actorIndex: number,
  sessionIndex: number,
): SessionClaims {
  return markLocalTestInput({
    session_id: `sess_synth_${String(sessionIndex).padStart(4, '0')}`,
    tenant_id: createSyntheticTenantId(tenantIndex),
    actor_id: createSyntheticActorId(actorIndex),
    authenticated: true,
  });
}

/**
 * ⭐ سياق تنفيذ اصطناعي — يمرّ بالمسار العام `resolveTenantContext`
 * (وليس بمسار مباشر من الادّعاءات الخام)
 * ⭐ وبمصدر الجلسات الاختباري **محدَّد صراحةً** ⇒ لا افتراض افتراضي.
 */
export function createSyntheticContext(
  tenantIndex: number,
  actorIndex: number,
  sessionIndex: number,
  now: () => string = () => '2026-01-01T00:00:00.000Z',
): TenantContext {
  return resolveTenantContext(
    createSyntheticSession(tenantIndex, actorIndex, sessionIndex),
    { now, source: localTestSessionSource },
  );
}

/**
 * ⭐ رسالة اصطناعية صالحة الشكل.
 * `declaredTenantId` يُمرَّر فقط في اختبار الانتحال.
 */
export function createSyntheticEnvelope(options: {
  tenantIndex: number;
  messageIndex: number;
  seed?: number;
  direction?: 'inbound' | 'outbound';
  declaredTenantId?: string;
  body?: string;
}): MessageEnvelope {
  const random = createSeededRandom((options.seed ?? 1337) + options.messageIndex * 7919);
  const from = createSyntheticAddress(options.messageIndex + 1);
  const to = createSyntheticAddress(options.messageIndex + 100);
  const envelope: MessageEnvelope = {
    schema_version: '1',
    message_ref: `synth-msg-${String(options.messageIndex).padStart(6, '0')}`,
    channel: 'synthetic',
    direction: options.direction ?? 'inbound',
    from,
    to,
    body: options.body ?? `رسالة اصطناعية للاختبار المحلي رقم ${toArabicDigits(options.messageIndex)}.`,
    occurred_at: `2026-01-0${(options.messageIndex % 9) + 1}T12:00:00.000Z`,
    locale: 'ar-EG',
    attributes: {
      synthetic: 'true',
      sample_index: String(options.messageIndex),
      jitter: Math.floor(random() * 1000).toString(),
    },
  };
  if (options.declaredTenantId === undefined) {
    return envelope;
  }
  return { ...envelope, declared_tenant_id: options.declaredTenantId };
}

/** ⭐ حزمة بيانات اصطناعية كاملة (مستأجران) — تُستخدم في اختبار العزل. */
export function createSyntheticPair(): {
  tenantA: TenantContext;
  tenantB: TenantContext;
  messageA: MessageEnvelope;
  messageB: MessageEnvelope;
} {
  const tenantA = createSyntheticContext(1, 11, 101);
  const tenantB = createSyntheticContext(2, 22, 202);
  return {
    tenantA,
    tenantB,
    messageA: createSyntheticEnvelope({ tenantIndex: 1, messageIndex: 1 }),
    messageB: createSyntheticEnvelope({ tenantIndex: 2, messageIndex: 2 }),
  };
}

// ============================================================
// WASL AI — سطح الاختبار (شجرة الاختبار فقط)
// ------------------------------------------------------------
// ⛔ **هذا السطح غير إنتاجي** — كل ما فيه أدوات اختبار.
// ⛔ لا يُستورد من أي ملف في `src/` (يفحصه اختبار الفصل الأمني).
// ⭐ نقطة الدخول الوحيدة للاختبارات ⇒ `src/core/index.ts` يبقى نظيفاً.
// ============================================================

export {
  localTestSessionSource,
  markLocalTestInput,
} from './local-session.ts';

export {
  SYNTHETIC_EMAIL_DOMAIN,
  createSeededRandom,
  createSyntheticActorId,
  createSyntheticAddress,
  createSyntheticContext,
  createSyntheticConversationRef,
  createSyntheticDisplayName,
  createSyntheticEnvelope,
  createSyntheticPair,
  createSyntheticSession,
  createSyntheticTenantId,
  toArabicDigits,
} from './synthetic.ts';

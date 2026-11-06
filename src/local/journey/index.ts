// ============================================================
// WASL AI — محاكاة رحلة خدمة العملاء (سطح شجرة المحلي · D-065)
// ------------------------------------------------------------
// ⭐⭐⭐ **هذا ليس نظام خدمة عملاء** ⇒ ⭐ محاكاة صناعية محلية بالكامل.
// ⭐⭐ **مبدآن غير قابلين للتفاوض**:
// ⭐   ① **لا نسخة موازية** ⇒ ⭐⇒⇒ كل قرار يمرّ على دوال النواة نفسها.
// ⭐   ② **لا باب جانبي** ⇒ ⭐⇒⇒⇒ **وإصدار إثبات الهوية (M54) غير مُصدَّر
//   من السطح العام** ⇒ ⭐⇒⇒⇒⇒ **فلا جهة خارجية تُصدر إثباتاً لهذه الرحلة.**
// ⛔ بلا شبكة · ⛔ بلا تخزين دائم · ⛔ بلا إرسال · ⛔ بلا استدعاء خارجي.
// ⛔ الشجرة خارج حزمة `npm` (نطاق الحزمة = `src/core/` فقط).
// ============================================================

export {
  JOURNEY_NOW,
  JOURNEY_OTHER_TENANT,
  JOURNEY_TENANT,
  JourneySimulator,
  type JourneyActor,
  type JourneySimulatorOptions,
} from './engine.ts';

export { classifyJourneyMessage, renderJourneyReply } from './classification.ts';

export {
  JOURNEY_INTENTS,
  JOURNEY_PRIORITIES,
  JOURNEY_STEP_KINDS,
  type JourneyClassification,
  type JourneyIntent,
  type JourneyOutcome,
  type JourneyPriority,
  type JourneyStep,
  type JourneyStepKind,
} from './types.ts';

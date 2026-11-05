// ============================================================
// WASL AI — نقطة دخول المعاينة التفاعلية (Slice 07 · P0)
// ------------------------------------------------------------
// ⭐ يجمع: ⭐ المُشغِّل (منطق النواة) + ⭐ الواجهة ⇒ ⭐ ويعرض.
// ⭐ ⛔ لا يقرّر شيئاً بنفسه ⇒ ⭐ كل قبول/رعب من النواة.
// ============================================================

import { createPreviewRuntime } from './wasl-workbench-preview-runtime.ts';
import { installPreviewUi } from './wasl-workbench-preview-ui.ts';

/** ⭐ ⭐ يثبّت المعاينة كاملة على الصفحة. */
export function bootPreview(): void {
  const runtime = createPreviewRuntime();
  installPreviewUi(runtime);
  // ⭐⭐ **خطّاف اختبار** ⇒ ⭐ يتيح إثبات أن **النواة هي المرجع النهائي**
    //   (أن استدعاء المحرّك مباشرةً يُنتج نفس الرفض الذي تُظهره الواجهة).
  // ⭐ محلي بالكامل · ⭐ لا مفاتيح · ⭐ لا أثر على أي قرار أمني.
  (globalThis as unknown as { waslPreviewRuntime?: unknown }).waslPreviewRuntime = runtime;
}

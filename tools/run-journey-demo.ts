// ============================================================
// WASL AI — عرض رحلة خدمة العملاء (محاكاة محلية · D-065)
// ------------------------------------------------------------
// ⭐ تشغيل: `node --experimental-strip-types tools/run-journey-demo.ts`
// ⭐ الغرض: ⭐ **قياس حيّ** للمحاكاة ⇒ ⭐ نفس المدخل ⇒ نفس النتيجة.
// ⭐ ⛔ بلا شبكة · ⛔ بلا تخزين دائم · ⛔ بلا بيانات حقيقية.
// ============================================================

import { JourneySimulator } from '../src/local/journey/index.ts';

/** ⭐⭐⭐ **سيناريوهات العرض** — ⭐ (نصوص صناعية بالكامل). */
const SCENARIOS: readonly { readonly label: string; readonly text: string }[] = Object.freeze([
  { label: 'فاتورة عادية', text: 'عندي استفسار عن الفاتورة الشهري' },
  { label: 'مشكلة فنية', text: 'التطبيق فيه خطأ ولا يعمل properly' },
  { label: 'شحن', text: 'الشحنة متأخرة والعنوان خاطئ' },
  { label: 'طلب عاجل', text: 'عندي مشكلة في الفاتورة وعاجل' },
  { label: 'رسالة عامة', text: 'مساء الخير' },
]);

function main(): void {
  const simulator = new JourneySimulator();
  const rows: string[] = [];

  for (const scenario of SCENARIOS) {
    const outcome = simulator.receive(scenario.text);
    rows.push(
      [
        scenario.label,
        outcome.ok ? 'نجاح' : `رفض:${outcome.code ?? 'غير_محدد'}`,
        outcome.intent ?? '-',
        outcome.priority ?? '-',
        outcome.state ?? '-',
        outcome.assignee_actor_id ?? '-',
        String(outcome.steps.length),
      ].join(' | '),
    );
  }

  process.stdout.write('السيناريو | النتيجة | النية | الأولوية | الحالة | المسند | الخطوات\n');
  for (const row of rows) process.stdout.write(`${row}\n`);

  // ⭐⭐⭐ **إثبات عدم قابلية الإغلاق** — ⭐ (الانتقال غير المسموح مرفوض من النواة).
  const blocked = simulator.advance('conv_journey_0001', 'closed');
  process.stdout.write(
    `\nإغلاق من حالة pending: ${blocked.ok ? 'نجاح' : `رفض:${blocked.code ?? 'غير_محدد'}`}\n`,
  );

  const messages = simulator.messages('conv_journey_0001');
  process.stdout.write(`رسائل المحادثة الأولى: ${String(messages.length)}\n`);
  process.stdout.write(`إجمالي خطوات سجل الرحلة: ${String(simulator.steps().length)}\n`);
}

main();

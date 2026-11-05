// ============================================================
// WASL AI — دليل الموظفين الاصطناعي (شجرة الاختبار فقط)
// ------------------------------------------------------------
// ⛔ تحت `tests/` ⇒ خارج حزمة الإنتاج.
// ⭐ **سلطة خارجية اصطناعية** — ⭐ تُحقن في طبقة الحالة (لا تُبنى فيها).
// ⭐ الموظف ضمن نطاق مستأجره فقط ⇒ ⭐ ⇒⇒⇒ **إسناد موظف من مستأجر آخر
//   ⇒ نفس رمز الرفض** (لا كشف وجود).
// ⛔ لا نظام مستخدمين إنتاجي · ⛔ لا بيانات حقيقية.
// ============================================================

import type { EmployeeDirectory } from '../../src/core/index.ts';

/** ⭐⭐ خريطة الموظفين — ⭐ **مستأجر ⇒ قائمة موظفين**. */
const EMPLOYEES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  tnt_synth_0001: Object.freeze(['actor_synth_0011', 'actor_synth_0012', 'actor_synth_0013']),
  tnt_synth_0002: Object.freeze(['actor_synth_0021', 'actor_synth_0022']),
});

/** ⭐⭐ الموظفون في نطاق مستأجر — ⭐ (اختبار). */
export function syntheticEmployeesFor(tenantId: string): readonly string[] {
  return EMPLOYEES[tenantId] ?? [];
}

/** ⭐⭐ دليل الموظفين الاصطناعي — ⭐ **السلطة الوحيدة لفحص الإسناد**. */
export const syntheticEmployeeDirectory: EmployeeDirectory = {
  isEmployee(tenantId: string, actorId: string): boolean {
    return (EMPLOYEES[tenantId] ?? []).includes(actorId);
  },
};

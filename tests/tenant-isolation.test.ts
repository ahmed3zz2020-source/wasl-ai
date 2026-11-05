// ============================================================
// WASL AI — اختبار عزل المستأجرين (M15 · تصريح المالك ٦ نوفمبر ٢٠٢٦)
// ------------------------------------------------------------
// ⭐⭐⭐⭐⭐ **الملاحظة التي أعقبها التنفيذ (ردّ #٣٠ · M15)**:
//   ⭐ «هل يتحقّق اختبار العزل من **رفض الوصول غير المصرّح به داخل
//     المشغّل** — لا من مجرد **غياب البيانات عن الـHTML**؟»
// ⭐⭐⭐⭐⭐ **الإجابة (مُثبَتة حيّاً)**: ⭐ نعم — الرفض يقع **داخل النواة**
//   (`conversation_not_found`) ⇒ ⭐ **لكن الاختبار القديم لم يكن يُثبته**.
// ⭐⭐⭐⭐⭐ **ما يفعله هذا الملف**:
//   ⭐ **١) الحارس نفسه** — ⭐ أربعة عمليات عابرة (قراءة · تعديل · إسناد ·
//     إلغاء إسناد) ⇒ ⭐ لازم **ترفض كلها** داخل المشغّل.
//   ⭐ **٢) مستوى النواة** — ⭐ نفس العمليات على `src/core/` مباشرة (بلا
//     dependence على المعاينة) ⇒ ⭐ ⇒⇒ **السلوك مضمون في الطبقة السفلى**.
//   ⭐ **٣) الطرد** — ⭐ **كسر حقيقي** لعزل المستأجر في **نسخة معزولة من
//     النواة** ⇒ ⭐ نفس الحارس **يجب أن يفشل** ⇒ ⇒⇒ **الحارس حسّاس**.
// ⛔ بلا شبكة · ⛔ بلا بيانات حقيقية · ⛔ **صفر تعديل في `src/core/`**.
// ============================================================

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { guard } from './guard-setup.ts';
import * as realCore from '../src/core/index.ts';
import {
  assignConversation,
  unassignConversation,
  updateConversationState,
  type ConversationStateDependencies,
  type TenantContext,
} from '../src/core/index.ts';
import {
  createPreviewRuntime,
  PREVIEW_OTHER_TENANT_CONVERSATION,
  PREVIEW_OTHER_TENANT_EMPLOYEE,
} from '../tools/wasl-workbench-preview-runtime.ts';
import {
  createSyntheticContext,
  createSyntheticEnvelope,
  syntheticEmployeeDirectory,
} from './support/index.ts';

const FIXED_NOW = '2026-01-01T00:00:00.000Z';
const ROOT = path.resolve(import.meta.dirname, '..');
const WORKSPACE = path.resolve(ROOT, '..');
/** ⭐ مجلد النسخة المعزولة — ⭐ **خارج المستودع** وداخل مساحة العمل. */
const ISOLATED = path.join(WORKSPACE, '.wasl-isolation-probe');

/** ⭐⭐⭐ خطأ ثابت — ⭐ الرفض المتوقع لكل عملية عابرة. */
const EXPECTED_CODE = 'conversation_not_found';

// ============================================================
// ⭐⭐⭐⭐⭐ ١) الحارس — داخل مشغّل المعاينة
// ============================================================

test('M15) ⭐⭐⭐⭐⭐ رفض الوصول العابر داخل المشغّل (لا في العرض فقط)', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ القراءة العابرة ⇒ `null` (لا تفصيل لمحادثة مستأجر آخر)', () => {
    const runtime = createPreviewRuntime();
    runtime.setRole('owner');
    assert.equal(
      runtime.getDetail(PREVIEW_OTHER_TENANT_CONVERSATION),
      null,
      'رجع تفصيل لمحادثة تخصّ مستأجراً آخر',
    );
  });

  await t.test('⭐⭐⭐⭐⭐ التعديل العابر ⇒ رفض `conversation_not_found`', () => {
    const runtime = createPreviewRuntime();
    runtime.setRole('owner');
    const result = runtime.applyTransition(PREVIEW_OTHER_TENANT_CONVERSATION, 'open', 'محاولة عابرة');
    assert.equal(result.ok, false, 'سمح بتعديل محادثة مستأجر آخر');
    assert.equal(result.code, EXPECTED_CODE, `رمز رفض غير متوقّع: ${result.code}`);
  });

  await t.test('⭐⭐⭐⭐⭐ الإسناد العابر ⇒ رفض `conversation_not_found`', () => {
    const runtime = createPreviewRuntime();
    runtime.setRole('owner');
    // ⭐ موظف **من المستأجر نفسه** ⇒ ⇒⇒ العزل هو سبب الرفض (لا الموظف).
    const own = runtime.getEmployees()[0];
    const result = runtime.assign(PREVIEW_OTHER_TENANT_CONVERSATION, own, 'محاولة عابرة');
    assert.equal(result.ok, false, 'سمح بإسناد محادثة مستأجر آخر');
    assert.equal(result.code, EXPECTED_CODE, `رمز رفض غير متوقّع: ${result.code}`);
  });

  await t.test('⭐⭐⭐⭐⭐ الإسناد لموظف من مستأجر آخر ⇒ رفض `conversation_not_found`', () => {
    const runtime = createPreviewRuntime();
    runtime.setRole('owner');
    const result = runtime.assign(
      PREVIEW_OTHER_TENANT_CONVERSATION,
      PREVIEW_OTHER_TENANT_EMPLOYEE,
      'محاولة عابرة',
    );
    assert.equal(result.ok, false, 'سمح بالإسناد لموظف من مستأجر آخر');
    assert.equal(result.code, EXPECTED_CODE, `رمز رفض غير متوقّع: ${result.code}`);
  });

  await t.test('⭐⭐⭐⭐⭐ إلغاء الإسناد العابر ⇒ رفض `conversation_not_found`', () => {
    const runtime = createPreviewRuntime();
    runtime.setRole('owner');
    const result = runtime.unassign(PREVIEW_OTHER_TENANT_CONVERSATION, 'محاولة عابرة');
    assert.equal(result.ok, false, 'سمح بإلغاء إسناد محادثة مستأجر آخر');
    assert.equal(result.code, EXPECTED_CODE, `رمز رفض غير متوقّع: ${result.code}`);
  });

  await t.test('⭐⭐⭐⭐⭐ الطابور لا يحوي محادثة المستأجر الآخر + دليل التسريب = صفر', () => {
    const runtime = createPreviewRuntime();
    runtime.setRole('owner');
    const refs = runtime.listAll().map((row) => row.conversation_ref);
    assert.equal(
      refs.includes(PREVIEW_OTHER_TENANT_CONVERSATION),
      false,
      'محادثة المستأجر الآخر ظهرت في الطابور',
    );
    const proof = runtime.getIsolationProof();
    assert.equal(proof.leaked_total, 0, `تسريب مرصود: ${proof.leaked_total}`);
  });
});

// ============================================================
// ⭐⭐⭐⭐⭐ ٢) مستوى النواة — بلا dependence على المعاينة
// ============================================================

interface CoreApi {
  readonly MessageStore: typeof import('../src/core/index.ts').MessageStore;
  readonly AuditLog: typeof import('../src/core/index.ts').AuditLog;
  readonly ReadAuditLog: typeof import('../src/core/index.ts').ReadAuditLog;
  readonly OrderingState: typeof import('../src/core/index.ts').OrderingState;
  readonly ProcessingLayer: typeof import('../src/core/index.ts').ProcessingLayer;
  readonly ConversationStateStore: typeof import('../src/core/index.ts').ConversationStateStore;
  readonly ConversationChangeLog: typeof import('../src/core/index.ts').ConversationChangeLog;
}

/** ⭐⭐⭐ يبني مشغّلاً على نواة معطاة (الحقيقية أو المعطوبة). */
function scenarioOf(core: CoreApi) {
  const audit = new core.AuditLog({ now: () => FIXED_NOW });
  const readAudit = new core.ReadAuditLog({ now: () => FIXED_NOW });
  const store = new core.MessageStore({ now: () => FIXED_NOW, audit });
  const layer = new core.ProcessingLayer({
    store,
    audit,
    orderingState: new core.OrderingState(),
  });
  const states = new core.ConversationStateStore({ now: () => FIXED_NOW });
  const changes = new core.ConversationChangeLog({ now: () => FIXED_NOW });
  const deps: ConversationStateDependencies = {
    store,
    states,
    changes,
    readAudit,
    employees: syntheticEmployeeDirectory,
  };
  return { store, layer, deps };
}

/** ⭐ سياق مستأجر (بيانات خام — ⭐ لا اعتماد على نواة معيّنة). */
function contextOf(tenantIndex: number): TenantContext {
  return createSyntheticContext(tenantIndex, tenantIndex * 10 + 1, 100 + tenantIndex, 1, () => FIXED_NOW, 'owner');
}

/** ⭐⭐⭐⭐⭐ **الحارس** — ⭐ نفس الفحص على أي نواة ⇒ يُستخدم في الطرد. */
function crossTenantVerdicts(core: CoreApi): {
  readLeaked: boolean;
  transitionRejected: boolean;
  assignRejected: boolean;
  unassignRejected: boolean;
} {
  const { store, layer, deps } = scenarioOf(core);
  const tenantOne = contextOf(1);
  const tenantTwo = contextOf(2);
  // ⭐ محادثة المستأجر الثاني (بذرة واحدة) ⇒ ⇒⇒ نطاق المستأجر الآخر.
  layer.process(tenantTwo, createSyntheticEnvelope({ tenantIndex: 2, messageIndex: 1 }));
  const foreignRef = 'conv_synth_0001';

  const readLeaked = store.messagesForConversation(tenantOne, foreignRef).length > 0;

  const rejected = (fn: () => unknown): boolean => {
    try {
      fn();
      return false;
    } catch (error) {
      return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        String((error as { code: unknown }).code) === EXPECTED_CODE
      );
    }
  };

  return {
    readLeaked,
    transitionRejected: rejected(() =>
      updateConversationState(tenantOne, foreignRef, 'open', deps),
    ),
    assignRejected: rejected(() =>
      assignConversation(tenantOne, foreignRef, 'actor_synth_0007', deps),
    ),
    unassignRejected: rejected(() => unassignConversation(tenantOne, foreignRef, deps)),
  };
}

test('M15) ⭐⭐⭐⭐⭐ الحارس على مستوى النواة نفسها', async (t) => {
  await t.test('⭐⭐⭐⭐⭐ القراءة العابرة ⇒ صفر صفوف', () => {
    const verdicts = crossTenantVerdicts(realCore as unknown as CoreApi);
    assert.equal(verdicts.readLeaked, false, 'تسريب قراءة بين المستأجرين');
  });

  await t.test('⭐⭐⭐⭐⭐ التعديل · الإسناد · إلغاء الإسناد العابرة ⇒ رفض', () => {
    const verdicts = crossTenantVerdicts(realCore as unknown as CoreApi);
    assert.equal(verdicts.transitionRejected, true, 'التعديل العابر لم يُرفض');
    assert.equal(verdicts.assignRejected, true, 'الإسناد العابر لم يُرفض');
    assert.equal(verdicts.unassignRejected, true, 'إلغاء الإسناد العابر لم يُرفض');
  });
});

// ============================================================
// ⭐⭐⭐⭐⭐ ٣) الطرد — كسر حقيقي ⇒ الحارس يفشل (حساسية مثبتة)
// ============================================================

test('M15) ⭐⭐⭐⭐⭐⭐ الطرد: كسر عزل المستأجر ⇒ الحارس يفشل (ليس زائفاً)', async (t) => {
  await t.test('⭐⭐⭐⭐⭐⭐ كسر حقيقي داخل نسخة معزولة من النواة', async () => {
    fs.rmSync(ISOLATED, { recursive: true, force: true });
    fs.mkdirSync(path.join(ISOLATED, 'core'), { recursive: true });
    for (const file of fs.readdirSync(path.join(ROOT, 'src', 'core'))) {
      if (!file.endsWith('.ts')) continue;
      fs.writeFileSync(
        path.join(ISOLATED, 'core', file),
        fs.readFileSync(path.join(ROOT, 'src', 'core', file), 'utf8'),
        'utf8',
      );
    }

    // ⭐⭐⭐ الكسر: ⭐ `messagesForConversation` يتجاهل المستأجر ⇒ ⇒⇒ تسريب.
    const storeFile = path.join(ISOLATED, 'core', 'store.ts');
    const original = fs.readFileSync(storeFile, 'utf8');
    const anchor =
      'const byConversation = this.#byConversation.get(context.tenantId);\n' +
      '    const rows = byConversation?.get(conversationRef) ?? [];';
    assert.equal(
      original.split(anchor).length - 1,
      1,
      'نقطة الكسر لم تعد موجودة ⇒ لازم تحديث اختبار الطرد',
    );
    fs.writeFileSync(
      storeFile,
      original.replace(
        anchor,
        'const byConversation = [...this.#byConversation.values()].find((m) => m.has(conversationRef));\n' +
          '    const rows = byConversation?.get(conversationRef) ?? [];',
      ),
      'utf8',
    );

    try {
      const brokenCore = (await import(
        pathToFileURL(path.join(ISOLATED, 'core', 'index.ts')).href
      )) as unknown as CoreApi;
      const verdicts = crossTenantVerdicts(brokenCore);

      // ⭐⭐⭐⭐⭐ **الحساسية**: ⭐ النواة المعطوبة **تسرّب** ⇒ ⇒⇒
      //   نفس الحارس **كان سيُسقط الاختبار** ⇒ ⇒⇒ **الحارس حسّاس**.
      assert.equal(
        verdicts.readLeaked,
        true,
        'النواة المعطوبة لم تسرّب ⇒ الكسر لم يعمل ⇒ اختبار الطرد غير حاسم',
      );
      assert.equal(
        verdicts.transitionRejected,
        false,
        'النواة المعطوبة رفضت التعديل العابر ⇒ الكسر لم يعمل ⇒ اختبار الطرد غير حاسم',
      );
      assert.equal(
        verdicts.assignRejected,
        false,
        'النواة المعطوبة رفضت الإسناد العابر ⇒ الكسر لم يعمل ⇒ اختبار الطرد غير حاسم',
      );
      assert.equal(
        verdicts.unassignRejected,
        false,
        'النواة المعطوبة رفضت إلغاء الإسناد العابر ⇒ الكسر لم يعمل ⇒ اختبار الطرد غير حاسم',
      );
    } finally {
      fs.rmSync(ISOLATED, { recursive: true, force: true });
    }
  });

  await t.test('⭐⭐⭐⭐⭐ النسخة المعزولة تُحذف (لا أثر خارج المستودع)', () => {
    assert.equal(fs.existsSync(ISOLATED), false, 'بقيت نسخة معزولة على القرص');
  });

  await t.test('⭐⭐ صفر اتصال خارجي', () => {
    assert.equal(guard.installed, true);
    assert.deepEqual(guard.blocked, []);
  });
});

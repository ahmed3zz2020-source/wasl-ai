// ============================================================
// WASL AI — واجهة المعاينة التفاعلية (Slice 07 · P0)
// ------------------------------------------------------------
// ⭐ ⭐ **الواجهة لا تحسم أي قرار** ⇒ ⭐ هي تستدعي مُشغِّل المعاينة
//   (الذي يستدعي **منطق النواة**) ⇒ ⇒⇒ **كل قبول/رفض من النواة**.
// ⭐ ⭐ **الأزرار المعطَّلة تُعطَّل بناءً على ability حقيقية من النواة**
//   (`allowed_next` من `ALLOWED_TRANSITIONS` + قدرات الدور من حدّ الثقة)
//   ⇒ ⇒⇒ **وإخفاء الزر ليس ضماناً — النقر يمرّ على النواة دائماً**.
// ⛔ لا طلبات شبكة · لا مكتبات خارجية · لا تخزين دائم · لا نصوص رسائل.
// ============================================================

import type {
  PreviewDetail,
  PreviewJourneyResult,
  PreviewQueueRow,
  PreviewRuntime,
} from './wasl-workbench-preview-runtime.ts';

interface PreviewElement {
  textContent: string | null;
  innerHTML: string;
  className: string;
  value: string;
  disabled: boolean;
  title: string;
  dataset: Record<string, string>;
  appendChild(child: PreviewElement): void;
  replaceChildren(...children: PreviewElement[]): void;
  querySelector(selectors: string): PreviewElement | null;
  querySelectorAll(selectors: string): PreviewElement[];
  addEventListener(type: string, handler: () => void): void;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  classList: { add(name: string): void; remove(name: string): void };
  createElement(tag: string): PreviewElement;
}

const doc = (globalThis as unknown as { document: PreviewElement }).document;

/** ⭐ ⭐ خرائط أسماء الأدوار (ترجمة فقط — ⭐ **لا منطق**). */
const ROLE_LABELS: Record<string, string> = {
  supervisor: 'مشرف تجريبي',
  agent: 'موظف تجريبي',
  owner: 'مالك تجريبي',
  viewer: 'دور قراءة فقط',
};

/** ⭐ ⭐ ترجمة أسماء الحالات (ترجمة فقط — ⭐ **لا منطق**). */
const STATE_LABELS: Record<string, string> = {
  new: 'جديدة',
  open: 'مفتوحة',
  assigned: 'مُسندة',
  pending: 'قيد المعالجة',
  resolved: 'تم حلّها',
  closed: 'مغلقة',
};

/** ⭐ ⭐ ترجمة تصنيفات الطابور (ترجمة فقط — ⭐ **لا منطق**). */
const CATEGORY_LABELS: Record<string, string> = {
  mine: 'مُسندة إليّ',
  unassigned: 'بلا إسناد',
  pending: 'قيد المعالجة',
  closed: 'مغلقة',
};

/** ⭐ ⭐ ترجمة رموز الأخطاء (ترجمة فقط — ⭐ **لا منطق**). */
const CODE_LABELS: Record<string, string> = {
  state_terminal: 'المحادثة مغلقة — لا تُعدَّل ولا تُسند',
  transition_not_allowed: 'انتقال غير مسموح',
  capability_missing: 'الدور الحالي لا يملك الصلاحية المطلوبة',
  assignee_not_in_tenant: 'الموظف خارج نطاق المستأجر — رُفض الإسناد',
  assignee_invalid: 'معرّف الموظف غير صالح',
  assignment_unchanged: 'المحادثة مسندة لنفس الموظف — لا تغيير',
  conversation_ref_invalid: 'معرّف المحادثة غير صالح',
  state_invalid: 'حالة خارج المجموعة المغلقة',
  reason_too_long: 'سبب التعديل أطول من الحدّ',
  reason_secret_forbidden: 'سبب التعديل يشبه سرّاً — رُفض',
  conversation_not_found: 'المحادثة غير موجودة',
  tenant_mismatch: 'المحادثة لا تخصّ المستأجر — رُفض',
};

function el(tag: string, className?: string, text?: string): PreviewElement {
  const node = doc.createElement(tag) as unknown as PreviewElement;
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function translate(map: Record<string, string>, key: string): string {
  return map[key] ?? key;
}

/**
 * ⭐ ⭐ يثبّت واجهة المعاينة على مُشغّل معيّن.
 */
export function installPreviewUi(runtime: PreviewRuntime): void {
  const root = doc.getElementById('preview-root') as unknown as PreviewElement;
  if (!root) return;

  // ── ⭐ شريط الأدوار ──
  const roleBar = el('div', 'role-bar');
  const roleButtons = new Map<string, PreviewElement>();
  for (const role of runtime.roles) {
    const button = el('button', 'role-btn', translate(ROLE_LABELS, role));
    button.setAttribute('data-role', role);
    button.setAttribute('type', 'button');
    button.addEventListener('click', () => {
      runtime.setRole(role);
      render();
    });
    roleButtons.set(role, button);
    roleBar.appendChild(button);
  }
  root.appendChild(roleBar);

  // ⭐⭐ Slice 08 — ⭐ **وسم دائم: هذه محاكاة محلية بهويات اصطناعية**
  //   (بلا تسجيل دخول · بلا مستخدم حقيقي · بلا مصادقة) ⇒ ⭐ فلا تُقرأ
  //   كأنّها بيانات حقيقية.
  root.appendChild(
    el(
      'div',
      'sim-badge',
      'محاكاة محلية — شخصيات اصطناعية (بلا تسجيل دخول) · Slice 08',
    ),
  );

  const capabilities = el('div', 'capabilities');
  root.appendChild(capabilities);

  // ── ⭐ العمودان ──
  const columns = el('div', 'columns');

  const queuePanel = el('section', 'panel');
  queuePanel.appendChild(el('h2', undefined, 'طابور المحادثات (رؤية الدور الحالي)'));
  const queueTable = el('table', 'grid');
  const queueHead = el('thead');
  const queueHeadRow = el('tr');
  for (const label of ['المحادثة', 'الحالة', 'الموظف', 'التصنيف', 'الرسائل', 'الخمول (دقيقة)']) {
    queueHeadRow.appendChild(el('th', undefined, label));
  }
  queueHead.appendChild(queueHeadRow);
  queueTable.appendChild(queueHead);
  const queueBody = el('tbody');
  queueBody.setAttribute('id', 'queue-body');
  queueTable.appendChild(queueBody);
  const queueScroll = el('div', 'scroll');
  queueScroll.appendChild(queueTable);
  queuePanel.appendChild(queueScroll);
  columns.appendChild(queuePanel);

  const detailPanel = el('section', 'panel');
  detailPanel.setAttribute('id', 'detail-panel');
  columns.appendChild(detailPanel);
  root.appendChild(columns);

  // ── ⭐ سجل التغييرات ──
  const changesPanel = el('section', 'panel');
  changesPanel.appendChild(el('h2', undefined, 'سجل التغييرات (الناجحة فقط)'));
  const changesTable = el('table', 'grid');
  const changesHead = el('thead');
  const changesHeadRow = el('tr');
  for (const label of ['الوقت', 'العملية', 'من', 'إلى', 'السبب', 'الإسناد من', 'الإسناد إلى']) {
    changesHeadRow.appendChild(el('th', undefined, label));
  }
  changesHead.appendChild(changesHeadRow);
  changesTable.appendChild(changesHead);
  const changesBody = el('tbody');
  changesBody.setAttribute('id', 'changes-body');
  changesTable.appendChild(changesBody);
  const changesScroll = el('div', 'scroll');
  changesScroll.appendChild(changesTable);
  changesPanel.appendChild(changesScroll);
  root.appendChild(changesPanel);

  // ── ⭐ إثبات العزل ──
  const isolationPanel = el('section', 'panel');
  isolationPanel.setAttribute('id', 'isolation-panel');
  root.appendChild(isolationPanel);

  // ── ⭐⭐ D-065 · المسار C — ⭐ مشهد الرحلة الصناعية ──
  const journeyPanel = el('section', 'panel');
  journeyPanel.setAttribute('id', 'journey-panel');
  root.appendChild(journeyPanel);

  const journeyInput = el('input', 'journey-input');
  journeyInput.setAttribute('id', 'journey-input');
  journeyInput.setAttribute('type', 'text');
  journeyInput.setAttribute('placeholder', 'اكتب رسالة عميل صناعية…');
  let journeyResult: PreviewJourneyResult | null = null;

  const JOURNEY_PRESETS: readonly { readonly label: string; readonly text: string }[] = [
    { label: 'فاتورة', text: 'عندي استفسار عن الفاتورة الشهرية' },
    { label: 'مشكلة تقنية', text: 'التطبيق فيه خطأ ولا يعمل' },
    { label: 'شحن', text: 'الشحنة متأخرة والعنوان خاطئ' },
    { label: 'عاجل', text: 'عندي مشكلة في الفاتورة وعاجل' },
  ];

  const renderJourney = (): void => {
    journeyPanel.replaceChildren();
    journeyPanel.appendChild(
      el('h2', undefined, 'مشهد الرحلة الصناعية (محاكاة محلية · بلا إرسال)'),
    );
    journeyPanel.appendChild(
      el(
        'p',
        'sub',
        'التصنيف حتمي بقوالب ثابتة (بلا توليد) — وكل رفض ييصدر من نواة WASL نفسها.',
      ),
    );

    const presetRow = el('div', 'btn-row');
    for (const preset of JOURNEY_PRESETS) {
      const button = el('button', 'journey-btn', preset.label);
      button.setAttribute('type', 'button');
      button.setAttribute('data-preset', preset.label);
      button.addEventListener('click', () => {
        journeyInput.value = preset.text;
        journeyResult = runtime.runJourney(preset.text);
        render();
      });
      presetRow.appendChild(button);
    }
    journeyPanel.appendChild(presetRow);

    const inputRow = el('div', 'btn-row');
    inputRow.appendChild(journeyInput);
    const runButton = el('button', 'action-btn', 'شغّل الرحلة');
    runButton.setAttribute('id', 'journey-run');
    runButton.setAttribute('type', 'button');
    runButton.addEventListener('click', () => {
      journeyResult = runtime.runJourney(journeyInput.value);
      render();
    });
    inputRow.appendChild(runButton);
    journeyPanel.appendChild(inputRow);

    if (!journeyResult) {
      journeyPanel.appendChild(el('p', 'empty', 'لم تُشغَّل رحلة بعد.'));
      return;
    }

    const meta = el('div', 'meta');
    meta.appendChild(el('span', undefined, `النتيجة: ${journeyResult.ok ? 'نجاح' : 'رفض'}`));
    meta.appendChild(el('span', undefined, `النية: ${journeyResult.intent ?? '—'}`));
    meta.appendChild(el('span', undefined, `الأولوية: ${journeyResult.priority ?? '—'}`));
    meta.appendChild(el('span', undefined, `الحالة: ${journeyResult.state ?? '—'}`));
    meta.appendChild(el('span', undefined, `المُسنَد: ${journeyResult.assignee_actor_id ?? '—'}`));
    meta.appendChild(el('span', undefined, `المحادثة: ${journeyResult.conversation_ref}`));
    journeyPanel.appendChild(meta);

    if (journeyResult.reply) {
      journeyPanel.appendChild(el('p', 'reply', `ردّ الموظّف (لم يُرسل): ${journeyResult.reply}`));
    }
    if (journeyResult.code) {
      journeyPanel.appendChild(el('p', 'err', `رمز الرفض: ${journeyResult.code}`));
    }

    const stepsList = el('ol', 'journey-steps');
    for (const step of journeyResult.steps) {
      stepsList.appendChild(
        el('li', undefined, `[${step.kind}] ${step.detail}`),
      );
    }
    journeyPanel.appendChild(stepsList);
  };


  // ── ⭐ الحالة المختارة ──
  let selectedRef: string | null = null;
  let lastOperation: { ok: boolean; message: string; code: string } | null = null;

  const renderQueue = (rows: PreviewQueueRow[]): void => {
    queueBody.replaceChildren();
    if (rows.length === 0) {
      const row = el('tr');
      const cell = el('td', 'empty', 'لا عناصر في الطابور لهذا الدور.');
      cell.setAttribute('colspan', '6');
      row.appendChild(cell);
      queueBody.appendChild(row);
      return;
    }
    for (const item of rows) {
      const row = el('tr');
      row.setAttribute('data-ref', item.conversation_ref);
      if (item.conversation_ref === selectedRef) row.classList.add('selected');
      const refCell = el('td', 'ref', item.conversation_ref);
      row.appendChild(refCell);
      row.appendChild(el('td', undefined, translate(STATE_LABELS, item.state)));
      row.appendChild(el('td', undefined, item.assignee_actor_id ?? 'بلا إسناد'));
      row.appendChild(el('td', undefined, translate(CATEGORY_LABELS, item.category)));
      row.appendChild(el('td', 'num', String(item.message_count)));
      row.appendChild(el('td', 'num', String(item.idle_minutes)));
      row.addEventListener('click', () => {
        selectedRef = item.conversation_ref;
        render();
      });
      queueBody.appendChild(row);
    }
  };

  const renderDetail = (detail: PreviewDetail | null): void => {
    detailPanel.replaceChildren();
    detailPanel.appendChild(el('h2', undefined, 'تفاصيل المحادثة + الإجراءات'));
    if (!detail) {
      detailPanel.appendChild(el('p', 'empty', 'اختر محادثة من الطابور.'));
      return;
    }

    const meta = el('div', 'meta');
    meta.appendChild(el('span', undefined, `المحادثة: ${detail.conversation_ref}`));
    meta.appendChild(el('span', undefined, `الحالة: ${translate(STATE_LABELS, detail.state)}`));
    meta.appendChild(
      el('span', undefined, `الموظف: ${detail.assignee_actor_id ?? 'بلا إسناد'}`),
    );
    meta.appendChild(el('span', undefined, `النسخة: ${String(detail.version)}`));
    if (detail.is_terminal) {
      meta.appendChild(el('span', 'terminal', 'حالة نهائية — لا تُعدَّل ولا تُسند'));
    }
    detailPanel.appendChild(meta);

    // ── ⭐ ⭐ أزرار الانتقالات — ⭐ **من `allowed_next` في النواة** ──
    const transitionSection = el('div', 'actions');
    transitionSection.appendChild(el('h3', undefined, 'انتقالات الحالة المسموحة (من خريطة النواة)'));
    const transitionRow = el('div', 'btn-row');
    for (const state of runtime.getStates()) {
      const allowed = detail.allowed_next.includes(state);
      const button = el('button', 'state-btn', translate(STATE_LABELS, state));
      button.setAttribute('data-to', state);
      button.setAttribute('type', 'button');
      if (!allowed) {
        button.disabled = true;
        button.title = `انتقال غير مسموح من «${translate(STATE_LABELS, detail.state)}»`;
        button.classList.add('blocked');
      } else if (!detail.can_update) {
        button.disabled = true;
        button.title = 'الدور الحالي لا يملك صلاحية conversation.state.update';
        button.classList.add('blocked');
      } else {
        button.addEventListener('click', () => {
          const result = runtime.applyTransition(detail.conversation_ref, state, 'تجربة تفاعلية من المعاينة');
          lastOperation = { ok: result.ok, message: result.message, code: result.code };
          render();
        });
      }
      transitionRow.appendChild(button);
    }
    transitionSection.appendChild(transitionRow);
    detailPanel.appendChild(transitionSection);

    // ── ⭐ ⭐ الإسناد ──
    const assignSection = el('div', 'actions');
    assignSection.appendChild(el('h3', undefined, 'الإسناد'));
    const assignRow = el('div', 'btn-row');
    const employeeSelect = doc.createElement('select') as unknown as PreviewElement;
    employeeSelect.setAttribute('id', 'assign-select');
    employeeSelect.setAttribute('name', 'assign-select');
    for (const employee of detail.employees) {
      const option = doc.createElement('option') as unknown as PreviewElement;
      option.setAttribute('value', employee);
      option.textContent = employee;
      employeeSelect.appendChild(option);
    }
    assignRow.appendChild(employeeSelect);

    const assignButton = el('button', 'action-btn', 'إسناد');
    assignButton.setAttribute('id', 'assign-btn');
    assignButton.setAttribute('type', 'button');
    if (!detail.can_assign) {
      assignButton.disabled = true;
      assignButton.title = detail.is_terminal
        ? 'المحادثة مغلقة — لا إسناد'
        : 'الدور الحالي لا يملك صلاحية conversation.assign';
      assignButton.classList.add('blocked');
    } else {
      assignButton.addEventListener('click', () => {
        const result = runtime.assign(
          detail.conversation_ref,
          employeeSelect.value,
          'تجربة تفاعلية من المعاينة',
        );
        lastOperation = { ok: result.ok, message: result.message, code: result.code };
        render();
      });
    }
    assignRow.appendChild(assignButton);

    const unassignButton = el('button', 'action-btn', 'إلغاء الإسناد');
    unassignButton.setAttribute('id', 'unassign-btn');
    unassignButton.setAttribute('type', 'button');
    if (!detail.can_unassign) {
      unassignButton.disabled = true;
      unassignButton.title = detail.is_terminal
        ? 'المحادثة مغلقة — لا إلغاء إسناد'
        : 'الدور الحالي لا يملك صلاحية conversation.assign';
      unassignButton.classList.add('blocked');
    } else {
      unassignButton.addEventListener('click', () => {
        const result = runtime.unassign(
          detail.conversation_ref,
          'تجربة تفاعلية من المعاينة',
        );
        lastOperation = { ok: result.ok, message: result.message, code: result.code };
        render();
      });
    }
    assignRow.appendChild(unassignButton);
    assignSection.appendChild(assignRow);
    detailPanel.appendChild(assignSection);

    // ── ⭐ نتيجة آخر عملية ──
    const resultBox = el('div', 'result');
    resultBox.setAttribute('id', 'result-box');
    if (lastOperation) {
      resultBox.classList.add(lastOperation.ok ? 'ok' : 'err');
      resultBox.textContent = lastOperation.ok
        ? `✅ ${lastOperation.message}`
        : `⛔ ${translate(CODE_LABELS, lastOperation.code)} — ${lastOperation.message}`;
    } else {
      resultBox.textContent = 'لم تُنفَّذ أي عملية بعد.';
    }
    detailPanel.appendChild(resultBox);
  };

  const renderChanges = (rows: readonly unknown[]): void => {
    changesBody.replaceChildren();
    const list = rows as Array<Record<string, string | null>>;
    if (list.length === 0) {
      const row = el('tr');
      const cell = el('td', 'empty', 'لا تغييرات مسجَّلة.');
      cell.setAttribute('colspan', '7');
      row.appendChild(cell);
      changesBody.appendChild(row);
      return;
    }
    for (const entry of list) {
      const row = el('tr');
      row.appendChild(el('td', 'ltr', String(entry.ts)));
      row.appendChild(el('td', undefined, String(entry.operation)));
      row.appendChild(el('td', undefined, translate(STATE_LABELS, String(entry.from_state))));
      row.appendChild(el('td', undefined, translate(STATE_LABELS, String(entry.to_state))));
      row.appendChild(el('td', undefined, String(entry.reason ?? '')));
      row.appendChild(el('td', undefined, String(entry.assignee_from ?? '—')));
      row.appendChild(el('td', undefined, String(entry.assignee_to ?? '—')));
      changesBody.appendChild(row);
    }
  };

  const renderIsolation = (): void => {
    const proof = runtime.getIsolationProof();
    isolationPanel.replaceChildren();
    isolationPanel.appendChild(el('h2', undefined, 'إثبات العزل (رقمي)'));
    const list = el('ul', 'proof');
    list.appendChild(
      el('li', undefined, `محادثات المستأجر الأول: ${String(proof.first_tenant_total)}`),
    );
    list.appendChild(
      el('li', undefined, `محادثات المستأجر الثاني (رؤيته هو): ${String(proof.other_tenant_own_total)}`),
    );
    list.appendChild(el('li', 'leak', `تسريب عبر المستأجر: ${String(proof.leaked_total)}`));
    isolationPanel.appendChild(list);
  };

  const render = (): void => {
    for (const [role, button] of roleButtons) {
      if (role === runtime.getRole()) {
        button.classList.add('active');
      } else {
        button.classList.remove('active');
      }
      button.setAttribute('aria-pressed', role === runtime.getRole() ? 'true' : 'false');
    }

    const caps = runtime.getCapabilities();
    capabilities.replaceChildren();
    capabilities.appendChild(
      el('span', 'role-now', `الدور الحالي: ${translate(ROLE_LABELS, runtime.getRole())}`),
    );
    capabilities.appendChild(el('span', 'caps', `الصلاحيات: ${caps.join(' · ') || 'لا شيء'}`));

    const rows = runtime.listQueue();
    if (selectedRef && !rows.some((row) => row.conversation_ref === selectedRef)) {
      selectedRef = null;
    }
    renderQueue(rows);
    const detail = selectedRef ? runtime.getDetail(selectedRef) : null;
    renderDetail(detail);
    renderChanges(detail ? detail.changes : []);
    renderIsolation();
    renderJourney();
  };

  render();
}

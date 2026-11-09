// ============================================================
// WASL AI — FOUNDATION BUILD 03 / PHASE 04 (D-073)
// the support tickets — the page
// ------------------------------------------------------------
// ⭐ WHAT THIS PAGE IS
//   The list of the support tickets of the company, the detail of one
//   ticket, and the creation of a new one.
// ⭐ EVERYTHING COMES FROM THE REAL API
//   ⭐ There is no fixed data in this file: the list and the detail
//     are read from PostgreSQL through the local API, and every write
//     is a real write that the server audits.
// ⭐ THE DECISIONS ARE NOT OURS
//   ⭐ The server announces the rights (`may_write` and `may_assign`)
//     and the page only shows what the server allows ⇒ ⭐⭐ a button
//     in the interface is NEVER an authorization.
// ⭐⭐ THE SCOPE IS THE SCOPE OF THE ROLE
//   ⭐ An employee sees the tickets that are assigned to them, and
//     the counts follow the same scope (the lesson of M-83).
// ⛔ No external service: no font, no asset, no call outside this
//   machine.
// ============================================================

const $ = (id) => document.getElementById(id);

const STATE_LABELS = {
  open: 'مفتوحة',
  in_progress: 'قيد التنفيذ',
  resolved: 'تم الحل',
  closed: 'مغلقة',
};

const PRIORITY_LABELS = {
  low: 'منخفضة',
  normal: 'عادية',
  high: 'عالية',
  urgent: 'عاجلة',
};

const ROLE_LABELS = {
  owner: 'مالك',
  supervisor: 'مشرف',
  agent: 'موظف',
  viewer: 'قارئ',
};

const ERROR_LABELS = {
  capability_missing: 'لا تملك صلاحية تنفيذ هذا الإجراء.',
  ticket_not_found: 'التذكرة غير موجودة أو خارج نطاق صلاحياتك.',
  ticket_conflict: 'التذكرة اتعدّلت من موظف تاني. افتحها تاني قبل ما تحفظ.',
  ticket_operation_unknown: 'العملية دي غير معرّفة في سياسات التذاكر.',
  transition_not_allowed: 'الانتقال ده مش مسموح في حالة التذكرة.',
  state_invalid: 'الحالة المطلوبة مش من الحالات المسموحة.',
  priority_invalid: 'الأولوية المطلوبة مش من الأولويات المسموحة.',
  subject_invalid: 'العنوان مطلوب (٢٠٠ حرف على الأكثر).',
  customer_required: 'اختر العميل اللي التذكرة دي ليه.',
  customer_not_found: 'العميل غير موجود في هذه الشركة.',
  conversation_not_found: 'المحادثة غير موجودة في هذه الشركة.',
  assignee_not_in_tenant: 'الموظف المختار ليس من هذه الشركة.',
  version_required: 'افتح التذكرة تاني قبل الحفظ.',
  network_error: 'تعذّر الاتصال بالخادم. تحقق من الاتصال ثم أعد المحاولة.',
  session_expired: 'انتهت الجلسة. سجّل الدخول من جديد.',
};

const SESSION_KEY = 'wasl_session_v1';

/** ⭐⭐ M-114: how long the page waits before it asks the server. */
const SEARCH_DEBOUNCE_MS = 320;

const state = {
  token: null,
  role: '',
  userId: '',
  sessionTenantId: '',
  tickets: [],
  selected: null,
  /** ⭐⭐ the ticket that is on the screen (the version of the lock). */
  detailTicket: null,
  mayWrite: false,
  mayAssign: false,
  page: 0,
  pageSize: 25,
  total: 0,
  sort: 'recent',
  agents: [],
  customers: [],
  /** ⭐⭐⭐ M-114: the number of the last request of the list. */
  listSeq: 0,
  /** ⭐⭐⭐ M-114: the number of the last request of the detail. */
  detailSeq: 0,
  /** ⭐⭐⭐ M-114: the state of the list before the detail (to come back to it). */
  listView: { query: '', state: '', priority: '', sort: 'recent', page: 0, scroll: 0 },
  /** ⭐⭐⭐ M-114: the page is on the detail now (the small screen). */
  detailView: false,
};

/** ⭐⭐ The session of the tab (the same key the inbox and the CRM use). */
function restoreSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (typeof saved?.token !== 'string' || saved.token.length === 0) return false;
    state.token = saved.token;
    state.role = typeof saved.role === 'string' ? saved.role : '';
    state.userId = typeof saved.user_id === 'string' ? saved.user_id : '';
    state.sessionTenantId = typeof saved.tenant_id === 'string' ? saved.tenant_id : '';
    return true;
  } catch {
    return false;
  }
}

function saveSession() {
  try {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        token: state.token,
        role: state.role,
        user_id: state.userId,
        tenant_id: state.sessionTenantId,
      }),
    );
  } catch {
    // ⭐ A browser that refuses the storage is not a failure of the work.
  }
}

function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ⭐ Nothing to do.
  }
}

/** ⭐ The call to the local API. */
async function api(method, path, body) {
  const headers = {};
  if (state.token) headers.authorization = `Bearer ${state.token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, body: { error: { code: 'network_error' } } };
  }
  const text = await response.text();
  let parsed = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { error: { code: 'unknown' } };
  }
  return { ok: response.ok, status: response.status, body: parsed };
}

function errorMessage(body, fallback) {
  const code = String((body?.error?.code) ?? '');
  if (code && ERROR_LABELS[code]) return ERROR_LABELS[code];
  if (code === 'token_missing' || code === 'token_invalid' || code === 'session_expired') {
    return ERROR_LABELS.session_expired;
  }
  return fallback;
}

let toastTimer = null;
function toast(text, isError) {
  const node = $('toast');
  node.textContent = text;
  node.classList.toggle('error', Boolean(isError));
  node.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.hidden = true;
  }, 4000);
}

/** ⭐ The time in a readable Arabic form. */
function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const relative = new Intl.RelativeTimeFormat('ar', { numeric: 'auto' });
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const units = [
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) {
      return relative.format(Math.round(seconds / size), unit);
    }
  }
  return relative.format(seconds, 'second');
}

function formatAbsolute(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function stateBadge(stateValue) {
  const badge = document.createElement('span');
  badge.className = 'state-badge';
  badge.dataset.state = stateValue;
  badge.textContent = STATE_LABELS[stateValue] ?? stateValue;
  return badge;
}

function priorityBadge(priority) {
  const badge = document.createElement('span');
  badge.className = 'priority-badge';
  badge.dataset.priority = priority;
  badge.textContent = PRIORITY_LABELS[priority] ?? priority;
  return badge;
}

function rowsOf(body, key) {
  const value = body?.[key];
  return Array.isArray(value) ? value : [];
}

// ------------------------------------------------------------ the list
/**
 * ⭐⭐⭐ M-114: the call to the server waits for the user to stop typing.
 * ⭐⭐⭐ The old timer is cancelled every time ⇒ ⇒ ⇒ one call for the
 * ⭐⭐⭐ whole word and NOT one call for every letter.
 */
function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  };
}

/** ⭐⭐⭐ M-114: the request of the search (debounced). */
const searchTickets = debounce(() => {
  void loadTickets({ resetPage: true });
}, SEARCH_DEBOUNCE_MS);

/** ⭐⭐ M-114: is the screen of the small size? */
function isSmallScreen() {
  return window.matchMedia('(max-width: 860px)').matches;
}

/** ⭐⭐ M-114: the connection with the server is gone? */
function setOffline(offline) {
  state.offline = offline;
  $('offline-banner').hidden = !offline;
}

async function loadTickets(options = {}) {
  if (options.resetPage) state.page = 0;
  // ⭐⭐⭐ M-114: the number of this request ⇒ ⇒ ⇒ a reply that arrives
  // ⭐⭐⭐ late (after a newer request) is DROPPED ⇒ ⇒ ⇒ the list never
  // ⭐⭐⭐ shows the results of an old search.
  const seq = ++state.listSeq;
  const firstLoad = state.tickets.length === 0 && state.total === 0;
  $('list-loading').hidden = !firstLoad;
  $('list-refreshing').hidden = firstLoad;
  $('list-error').hidden = true;

  const params = new URLSearchParams();
  const query = $('filter-query').value.trim();
  const ticketState = $('filter-state').value;
  const priority = $('filter-priority').value;
  if (query) params.set('q', query);
  if (ticketState) params.set('state', ticketState);
  if (priority) params.set('priority', priority);
  params.set('sort', state.sort);
  params.set('limit', String(state.pageSize));
  params.set('offset', String(state.page * state.pageSize));

  const answer = await api('GET', `/api/tickets?${params.toString()}`);
  // ⭐⭐⭐ M-114: a late reply of an old request ⇒ ⇒ ⇒ it is dropped.
  if (seq !== state.listSeq) return;
  $('list-loading').hidden = true;
  $('list-refreshing').hidden = true;
  if (!answer.ok) {
    // ⭐⭐ M-114: the connection with the server is gone.
    if (answer.status === 0) setOffline(true);
    $('list-error-text').textContent = errorMessage(answer.body, 'تعذّر تحميل التذاكر.');
    $('list-error').hidden = false;
    $('list-empty').hidden = true;
    return;
  }
  setOffline(false);
  state.tickets = rowsOf(answer.body, 'tickets');
  state.total = Number(answer.body.total ?? 0);
  state.mayWrite = answer.body.may_write === true;
  state.mayAssign = answer.body.may_assign === true;
  renderTickets();
  renderPagination();
  renderEmptyState();
  $('list-counter').textContent = `${state.total} تذكرة`;
  // ⭐⭐ The rights of the server decide what the page shows.
  $('btn-new').hidden = !state.mayWrite;
  renderRightsNote();
}

/** ⭐⭐ M-114: the empty state says WHY the list is empty. */
function renderEmptyState() {
  const box = $('list-empty');
  if (state.tickets.length > 0) {
    box.hidden = true;
    return;
  }
  const filtered =
    $('filter-query').value.trim() !== '' ||
    $('filter-state').value !== '' ||
    $('filter-priority').value !== '';
  $('list-empty-title').textContent = filtered ? 'لا توجد نتائج للبحث ده.' : 'لا توجد تذاكر بعد.';
  $('list-empty-text').textContent = filtered
    ? 'جرّب كلمة تانية أو امسح الفلتر.'
    : 'أول ما حد يبعت تذكرة هتظهر هنا.';
  $('btn-clear-filters').hidden = !filtered;
  box.hidden = false;
}

/** ⭐⭐ M-114: the note of the rights (the server decides). */
function renderRightsNote() {
  const note = $('rights-note');
  if (state.mayWrite) {
    note.hidden = true;
    return;
  }
  note.textContent = '⛔ ما عندك صلاحية إنشاء تذاكر — زر «تذكرة جديدة» مخفي لأن الخادم مش هيسمح.';
  note.hidden = false;
}

function renderTickets() {
  const list = $('ticket-list');
  list.textContent = '';
  if (state.tickets.length === 0) {
    // ⭐⭐ M-114: the empty state explains WHY (the search or the filter).
    renderEmptyState();
    return;
  }
  // ⭐⭐ M-114: when the list has rows ⇒ the empty box goes away.
  $('list-empty').hidden = true;
  for (const ticket of state.tickets) {
    const item = document.createElement('li');
    item.className = 'ticket';
    if (state.selected && state.selected.ref === ticket.ref) {
      item.classList.add('active');
    }
    item.dataset.ref = ticket.ref;

    const top = document.createElement('div');
    top.className = 'row-top';
    const subject = document.createElement('span');
    subject.className = 'name';
    subject.textContent = ticket.subject ?? '';
    top.appendChild(subject);
    top.appendChild(stateBadge(ticket.state));
    top.appendChild(priorityBadge(ticket.priority));
    item.appendChild(top);

    const meta = document.createElement('div');
    meta.className = 'meta';
    const customer = document.createElement('span');
    customer.textContent = ticket.customer_name ?? ticket.customer_id ?? '';
    meta.appendChild(customer);
    const ref = document.createElement('span');
    ref.textContent = ticket.ref ?? '';
    meta.appendChild(ref);
    const updated = document.createElement('span');
    updated.textContent = `آخر تحديث: ${formatTime(ticket.updated_at)}`;
    updated.title = formatAbsolute(ticket.updated_at);
    meta.appendChild(updated);
    if (ticket.assignee_actor_id) {
      const assignee = document.createElement('span');
      assignee.textContent = `مُسنَد إلى ${ticket.assignee_actor_id}`;
      meta.appendChild(assignee);
    }
    item.appendChild(meta);

    item.addEventListener('click', () => openTicket(ticket.ref));
    list.appendChild(item);
  }
}

function renderPagination() {
  const pages = Math.max(1, Math.ceil(state.total / state.pageSize));
  const bar = $('pagination');
  bar.hidden = pages <= 1;
  $('page-label').textContent = `صفحة ${state.page + 1} من ${pages}`;
  $('btn-prev').disabled = state.page <= 0;
  $('btn-next').disabled = state.page + 1 >= pages;
}

// ------------------------------------------------------------ the detail
/**
 * ⭐⭐ M-114: the page remembers the state of the list before it opens
 * ⭐⭐ a ticket ⇒ ⇒ ⇒ the way back returns to the SAME place.
 */
function rememberListView() {
  state.listView = {
    query: $('filter-query').value,
    state: $('filter-state').value,
    priority: $('filter-priority').value,
    sort: state.sort,
    page: state.page,
    scroll: window.scrollY,
  };
}

/** ⭐⭐ M-114: the state of the list comes back as it was. */
function restoreListView() {
  $('filter-query').value = state.listView.query;
  $('filter-state').value = state.listView.state;
  $('filter-priority').value = state.listView.priority;
  $('filter-sort').value = state.listView.sort;
  state.sort = state.listView.sort;
  state.page = state.listView.page;
  renderPagination();
}

/** ⭐⭐ M-114: the small screen shows EITHER the list OR the detail. */
function setDetailView(on) {
  state.detailView = on;
  document.body.classList.toggle('view-detail', on);
  const list = document.querySelector('.pane.list');
  const detail = document.getElementById('detail-pane');
  if (list) list.hidden = on;
  if (detail) detail.hidden = !on;
}

async function openTicket(ref) {
  // ⭐⭐ M-114: the state of the list is remembered before the detail.
  if (!state.detailView) rememberListView();
  const seq = ++state.detailSeq;
  state.selected = { ref };
  $('detail-placeholder').hidden = true;
  $('detail').hidden = false;
  $('detail-error').hidden = true;
  $('detail-subject').textContent = '…';

  const answer = await api('GET', `/api/tickets/${encodeURIComponent(ref)}`);
  // ⭐⭐⭐ M-114: a late reply of an old ticket ⇒ ⇒ ⇒ it is dropped
  // ⭐⭐⭐ (the screen shows the ticket that was asked for LAST).
  if (seq !== state.detailSeq) return;
  if (!answer.ok) {
    $('detail-error').textContent = errorMessage(answer.body, 'تعذّر فتح التذكرة.');
    $('detail-error').hidden = false;
    $('detail-subject').textContent = '—';
    return;
  }
  const ticket = answer.body.ticket ?? {};
  state.detailTicket = ticket;
  state.mayWrite = answer.body.may_write === true;
  state.mayAssign = answer.body.may_assign === true;

  $('detail-subject').textContent = ticket.subject ?? '—';
  $('detail-ref').textContent = ticket.ref ?? '';

  renderFacts(ticket);
  renderEdit(ticket);
  renderChanges(rowsOf(answer.body, 'changes'));
  renderTickets();
  renderDetailRightsNote();

  if (isSmallScreen()) {
    // ⭐⭐ M-114: the small screen swaps the list for the detail ⇒ ⇒ ⇒
    // ⭐⭐ M-114 and the button of the browser comes back to the list.
    setDetailView(true);
    if (!window.location.hash.startsWith('#ticket=')) {
      window.history.pushState({ waslTicket: ref }, '', `#ticket=${encodeURIComponent(ref)}`);
    }
    $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

/** ⭐⭐ M-114: the note of the rights inside the detail. */
function renderDetailRightsNote() {
  const note = $('detail-rights-note');
  if (state.mayWrite) {
    note.hidden = true;
    return;
  }
  note.textContent = '⛔ ما عندك صلاحية تعديل التذاكر — نموذج التعديل مخفي لأن الخادم مش هيسمح.';
  note.hidden = false;
}

/**
 * ⭐⭐ M-114: THE WAY BACK ⇒ ⇒ ⇒ the list comes back with the state it
 * ⭐⭐ M-114 had (the search, the filters, the page and the place of the
 * ⭐⭐ M-114 screen).
 */
function closeDetail() {
  state.detailSeq += 1;
  $('detail').hidden = true;
  $('detail-placeholder').hidden = false;
  state.detailTicket = null;
  restoreListView();
  if (state.detailView) {
    setDetailView(false);
    if (window.location.hash.startsWith('#ticket=')) {
      window.history.back();
    }
    window.scrollTo({ top: state.listView.scroll, behavior: 'auto' });
  }
  renderTickets();
}

function renderFacts(ticket) {
  const facts = $('detail-facts');
  facts.textContent = '';
  const rows = [
    ['العميل', ticket.customer_name ?? ticket.customer_id ?? '—'],
    ['الحالة', STATE_LABELS[ticket.state] ?? ticket.state ?? '—'],
    ['الأولوية', PRIORITY_LABELS[ticket.priority] ?? ticket.priority ?? '—'],
    ['المُسنَد إليه', ticket.assignee_actor_id ?? 'غير مُسندة'],
    ['المحادثة المرتبطة', ticket.conversation_ref ?? '—'],
    ['أُنشئت', ticket.created_at ? formatAbsolute(ticket.created_at) : '—'],
    ['آخر تعديل', ticket.updated_at ? formatAbsolute(ticket.updated_at) : '—'],
    ['الوصف', ticket.description || '—'],
  ];
  for (const [label, value] of rows) {
    const term = document.createElement('dt');
    term.textContent = label;
    const item = document.createElement('dd');
    item.textContent = String(value);
    facts.appendChild(term);
    facts.appendChild(item);
  }
  // ⭐⭐ D-073: the link to the conversation of the ticket.
  if (ticket.conversation_ref) {
    const link = document.createElement('dd');
    const anchor = document.createElement('a');
    anchor.className = 'ghost link small';
    anchor.href = `/ui/inbox.html?conversation=${encodeURIComponent(ticket.conversation_ref)}`;
    anchor.textContent = 'افتح المحادثة';
    link.appendChild(anchor);
    facts.appendChild(document.createElement('dt'));
    facts.appendChild(link);
  }
}

function renderEdit(ticket) {
  const block = $('edit-block');
  // ⭐⭐ The permission comes from the server (the core decided it).
  block.hidden = !state.mayWrite;
  if (!state.mayWrite) return;
  $('edit-state').value = ticket.state ?? 'open';
  $('edit-priority').value = ticket.priority ?? 'normal';
  $('edit-subject').value = ticket.subject ?? '';
  $('edit-description').value = ticket.description ?? '';
  $('edit-note').textContent = '';
  // ⭐⭐ The assignment is the owner's alone ⇒ ⭐⭐ the field appears
  //   only when the server allows it.
  $('assignee-field').hidden = !state.mayAssign;
  if (state.mayAssign) {
    const select = $('edit-assignee');
    select.textContent = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'غير مُسندة';
    select.appendChild(none);
    for (const agent of state.agents) {
      const option = document.createElement('option');
      option.value = agent.actor_id ?? '';
      option.textContent = `${agent.display_name ?? agent.actor_id} (${ROLE_LABELS[agent.role] ?? agent.role})`;
      select.appendChild(option);
    }
    select.value = ticket.assignee_actor_id ?? '';
  }
}

function renderChanges(changes) {
  const list = $('change-list');
  list.textContent = '';
  $('activity-empty').hidden = changes.length > 0;
  for (const change of changes) {
    const item = document.createElement('li');
    item.className = 'activity';
    const top = document.createElement('div');
    top.className = 'row-top';
    const operation = document.createElement('span');
    operation.className = 'name';
    operation.textContent = OPERATION_LABELS[String(change.operation)] ?? String(change.operation);
    top.appendChild(operation);
    const when = document.createElement('span');
    when.className = 'muted';
    when.textContent = formatAbsolute(change.changed_at);
    top.appendChild(when);
    item.appendChild(top);
    const meta = document.createElement('div');
    meta.className = 'meta';
    const actor = document.createElement('span');
    actor.textContent = change.actor_id ?? '';
    meta.appendChild(actor);
    if (change.before_state || change.after_state) {
      const transition = document.createElement('span');
      transition.textContent = `${STATE_LABELS[String(change.before_state)] ?? change.before_state ?? '—'} ← ${STATE_LABELS[String(change.after_state)] ?? change.after_state ?? '—'}`;
      meta.appendChild(transition);
    }
    if (change.reason) {
      const reason = document.createElement('span');
      reason.textContent = change.reason;
      meta.appendChild(reason);
    }
    item.appendChild(meta);
    list.appendChild(item);
  }
}

const OPERATION_LABELS = {
  'ticket.create': 'إنشاء التذكرة',
  'ticket.update': 'تعديل التذكرة',
  'ticket.assign': 'إسناد التذكرة',
};

// ------------------------------------------------------------ the edit
async function saveTicket(event) {
  event.preventDefault();
  const ticket = state.detailTicket;
  if (!ticket) return;
  const subject = $('edit-subject').value.trim();
  if (subject.length === 0) {
    toast(ERROR_LABELS.subject_invalid, true);
    return;
  }
  const payload = {
    version: Number(ticket.version ?? 1),
    subject,
    description: $('edit-description').value,
    state: $('edit-state').value,
    priority: $('edit-priority').value,
  };
  // ⭐⭐ The assignment travels only when the server allows it.
  if (state.mayAssign) {
    payload.assignee_actor_id = $('edit-assignee').value || null;
  }
  const answer = await api('PATCH', `/api/tickets/${encodeURIComponent(ticket.ref)}`, payload);
  if (!answer.ok) {
    if (answer.status === 409) {
      $('edit-note').textContent = ERROR_LABELS.ticket_conflict;
      toast(ERROR_LABELS.ticket_conflict, true);
      await openTicket(ticket.ref);
      return;
    }
    toast(errorMessage(answer.body, 'تعذّر حفظ التعديل.'), true);
    return;
  }
  toast('تم حفظ تعديلات التذكرة.');
  await openTicket(ticket.ref);
  await loadTickets();
}

// ------------------------------------------------------------ the creation
async function loadCustomers() {
  const answer = await api('GET', '/api/crm/customers?limit=100&sort=name');
  if (!answer.ok) return;
  state.customers = rowsOf(answer.body, 'customers');
  const select = $('create-customer');
  select.textContent = '';
  for (const customer of state.customers) {
    const option = document.createElement('option');
    option.value = customer.id ?? '';
    option.textContent = customer.display_name ?? customer.id ?? '';
    select.appendChild(option);
  }
}

async function loadAgents() {
  const answer = await api('GET', '/api/inbox/agents');
  if (!answer.ok) return;
  state.agents = rowsOf(answer.body, 'agents');
}

function openCreate() {
  $('create-block').hidden = false;
  $('create-note').textContent = '';
  void loadCustomers();
  $('create-block').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function createTicket(event) {
  event.preventDefault();
  const subject = $('create-subject').value.trim();
  const customerId = $('create-customer').value;
  if (subject.length === 0) {
    toast(ERROR_LABELS.subject_invalid, true);
    return;
  }
  if (!customerId) {
    toast(ERROR_LABELS.customer_required, true);
    return;
  }
  const payload = {
    subject,
    customer_id: customerId,
    description: $('create-description').value,
    priority: $('create-priority').value,
  };
  const conversation = $('create-conversation').value.trim();
  if (conversation) payload.conversation_ref = conversation;

  const answer = await api('POST', '/api/tickets', payload);
  if (!answer.ok) {
    toast(errorMessage(answer.body, 'تعذّر إنشاء التذكرة.'), true);
    return;
  }
  toast('تم إنشاء التذكرة.');
  $('create-form').reset();
  $('create-block').hidden = true;
  await loadTickets({ resetPage: true });
  const ref = answer.body.ticket?.ref;
  if (ref) await openTicket(ref);
}

// ------------------------------------------------------------ the session
async function login() {
  const payload = {
    tenant_id: $('login-tenant').value,
    user_id: $('login-user').value,
    passcode: $('login-passcode').value,
  };
  const answer = await api('POST', '/api/session', payload);
  const notice = $('login-notice');
  if (!answer.ok) {
    notice.textContent = errorMessage(answer.body, 'تعذّر تسجيل الدخول.');
    notice.hidden = false;
    return;
  }
  notice.hidden = true;
  state.token = answer.body.token;
  state.role = answer.body.session?.role ?? '';
  state.userId = answer.body.session?.user_id ?? '';
  state.sessionTenantId = answer.body.session?.tenant_id ?? $('login-tenant').value;
  saveSession();
  showWorkspace();
  await loadTickets({ resetPage: true });
  await loadAgents();
}

function showWorkspace() {
  $('login-row').hidden = true;
  $('who').hidden = false;
  $('who-name').textContent = state.userId;
  $('who-role').textContent = ROLE_LABELS[state.role] ?? state.role;
  $('workspace').hidden = false;
}

async function logout() {
  clearSession();
  await api('DELETE', '/api/session');
  state.token = null;
  state.selected = null;
  state.detailTicket = null;
  state.listSeq += 1;
  state.detailSeq += 1;
  setOffline(false);
  setDetailView(false);
  $('login-row').hidden = false;
  $('who').hidden = true;
  $('workspace').hidden = true;
  $('detail').hidden = true;
  $('detail-placeholder').hidden = false;
  $('ticket-list').textContent = '';
  $('create-block').hidden = true;
}

// ------------------------------------------------------------ the wiring
$('btn-login').addEventListener('click', () => {
  void login();
});
$('btn-logout').addEventListener('click', () => {
  void logout();
});
$('btn-refresh').addEventListener('click', () => {
  void loadTickets({ resetPage: true });
});
$('btn-prev').addEventListener('click', () => {
  if (state.page <= 0) return;
  state.page -= 1;
  void loadTickets();
});
$('btn-next').addEventListener('click', () => {
  state.page += 1;
  void loadTickets();
});
$('filter-query').addEventListener('input', () => {
  // ⭐⭐⭐ M-114: the page does NOT ask the server on every letter ⇒ ⇒ ⇒
  // ⭐⭐⭐ it waits until the user stops typing.
  state.page = 0;
  searchTickets();
});
$('filter-state').addEventListener('change', () => {
  void loadTickets({ resetPage: true });
});
$('filter-priority').addEventListener('change', () => {
  void loadTickets({ resetPage: true });
});
$('filter-sort').addEventListener('change', () => {
  state.sort = $('filter-sort').value;
  void loadTickets({ resetPage: true });
});
$('btn-back').addEventListener('click', () => {
  // ⭐⭐ M-114: the way back keeps the state of the list.
  closeDetail();
});
$('btn-retry').addEventListener('click', () => {
  void loadTickets();
});
$('btn-retry-offline').addEventListener('click', () => {
  setOffline(false);
  void loadTickets();
});
$('btn-clear-filters').addEventListener('click', () => {
  $('filter-query').value = '';
  $('filter-state').value = '';
  $('filter-priority').value = '';
  void loadTickets({ resetPage: true });
});
// ⭐⭐ M-114: the browser says that the connection is gone (or back).
window.addEventListener('offline', () => {
  setOffline(true);
});
window.addEventListener('online', () => {
  setOffline(false);
  void loadTickets();
});
// ⭐⭐ M-114: the button of the browser comes back to the list.
window.addEventListener('popstate', () => {
  if (state.detailView) closeDetail();
});
$('edit-form').addEventListener('submit', (event) => {
  void saveTicket(event);
});
$('btn-new').addEventListener('click', () => {
  openCreate();
});
$('btn-cancel-create').addEventListener('click', () => {
  $('create-block').hidden = true;
});
$('create-form').addEventListener('submit', (event) => {
  void createTicket(event);
});

// ⭐⭐ D-073: the page opens the ticket that another page pointed at.
async function boot() {
  if (restoreSession()) {
    showWorkspace();
    await loadTickets({ resetPage: true });
    await loadAgents();
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get('ticket');
    if (wanted) {
      await openTicket(wanted);
      return;
    }
    // ⭐⭐ D-073: the inbox pointed at this page with a customer and a
    //   conversation ⇒ ⭐⭐ the form of the creation opens ready (the
    //   customer is chosen and the conversation is written) ⇒ ⭐⭐ the
    //   SERVER is the one that checks the right to create it.
    const customer = params.get('customer');
    const conversation = params.get('conversation');
    if (customer || conversation) {
      await loadCustomers();
      if (customer && $('create-customer')) $('create-customer').value = customer;
      if (conversation && $('create-conversation')) {
        $('create-conversation').value = conversation;
      }
      $('create-block').hidden = false;
    }
    return;
  }
  const notice = $('login-notice');
  notice.textContent = 'سجّل الدخول من صندوق الوارد أو من هنا.';
  notice.hidden = false;
}

void boot();

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
  /** ⭐⭐⭐ M-119: the queue of the tickets that have no assignee. */
  unassignedOnly: false,
  /** ⭐⭐⭐ M-119: how many tickets are waiting for an assignment. */
  unassignedCount: 0,
  /** ⭐⭐⭐ M-114: the number of the last request of the list. */
  listSeq: 0,
  /** ⭐⭐⭐ M-114: the number of the last request of the detail. */
  detailSeq: 0,
  /** ⭐⭐⭐ M-114: the state of the list before the detail (to come back to it). */
  listView: { query: '', state: '', priority: '', sort: 'recent', page: 0, scroll: 0, unassigned: false },
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
 * ⭐⭐⭐ M-116: ⭐⭐⭐ the timer can also be cancelled FROM THE OUTSIDE
 * ⭐⭐⭐ (⇒ ⇒ ⇒ a change of the filter or of the order cancels the
 * ⭐⭐⭐ deferred search ⇒ ⇒ ⇒ the deferred request never comes back
 * ⭐⭐⭐ to reset the page behind the back of the user).
 */
function debounce(fn, wait) {
  let timer = null;
  const wrapped = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  };
  wrapped.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return wrapped;
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
  // ⭐⭐⭐ M-119: the queue of the unassigned tickets.
  if (state.unassignedOnly) params.set('unassigned', '1');
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
  // ⭐⭐⭐ M-119: the counter of the queue (it comes from the server ⇒
  // ⭐⭐⭐ M-119 it follows the scope of the role and the filters).
  state.unassignedCount = Number(answer.body.unassigned_count ?? 0);
  renderTickets();
  renderPagination();
  renderEmptyState();
  renderUnassignedBadge();
  $('list-counter').textContent = `${state.total} تذكرة`;
  // ⭐⭐ The rights of the server decide what the page shows.
  $('btn-new').hidden = !state.mayWrite;
  renderRightsNote();
}

/**
 * ⭐⭐⭐ M-119: ⭐⭐⭐ the badge of the queue ⇒ ⭐⭐⭐ the number comes
 *   ⭐⭐⭐ from the server (never from the page) ⇒ ⭐⭐⭐ and the button
 *   ⭐⭐⭐ says whether the queue is open.
 */
function renderUnassignedBadge() {
  const badge = $('unassigned-counter');
  if (badge) badge.textContent = String(state.unassignedCount);
  const button = $('btn-unassigned');
  if (!button) return;
  button.setAttribute('aria-pressed', state.unassignedOnly ? 'true' : 'false');
  button.title = state.unassignedOnly
    ? 'الطابور مفتوح — دوس تاني عشان تشوف كل التذاكر.'
    : 'اعرض التذاكر اللي لسه ما اتأسندتش.';
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
  // ⭐⭐⭐ M-119: the queue has its OWN empty state (the queue is empty
  // ⭐⭐⭐ M-119 ⇐ ⇒ the work is done ⇒ ⭐⭐⭐ it is not a failure).
  if (state.unassignedOnly) {
    $('list-empty-title').textContent = 'مفيش تذاكر غير مُسندة.';
    $('list-empty-text').textContent =
      'كل التذاكر في نطاقك اتأسندت. دوس «غير مُسندة» تاني عشان تشوف كل التذاكر.';
    $('btn-clear-filters').hidden = false;
    box.hidden = false;
    return;
  }
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
    // ⭐⭐⭐ tk-16: the measurement of the first reply (⇒ ⇒ ⇒ ⇒ a real
    // ⭐⭐⭐ tk-16 number ⇒ ⇒ ⇒ ⇒ and «بانتظار أول رد» when there is
    // ⭐⭐⭐ tk-16 none ⇒ ⇒ ⇒ ⇒ — never a number that was invented).
    meta.appendChild(measurementBadge(ticket));
    if (ticket.assignee_actor_id) {
      const assignee = document.createElement('span');
      assignee.textContent = `مُسنَد إلى ${ticket.assignee_actor_id}`;
      meta.appendChild(assignee);
    }
    item.appendChild(meta);

    // ⭐⭐⭐ M-119: ⭐⭐⭐ the button of the assignment ⇒ ⭐⭐⭐ it appears
    // ⭐⭐⭐ M-119 ONLY when the server announces the right
    // ⭐⭐⭐ M-119 (`may_assign`) ⇒ ⭐⭐⭐ and it uses the EXISTING path
    // ⭐⭐⭐ M-119 of the assignment (the form of the ticket) ⇒ ⭐⭐⭐ no
    // ⭐⭐⭐ M-119 new capability and no new rule of rights.
    if (state.unassignedOnly && state.mayAssign) {
      const assign = document.createElement('button');
      assign.className = 'ghost small assign-button';
      assign.type = 'button';
      assign.dataset.assign = ticket.ref;
      assign.textContent = 'إسناد…';
      assign.addEventListener('click', (event) => {
        event.stopPropagation();
        // ⭐⭐⭐ M-121: ⭐⭐⭐ the fields of the assignment appear ONLY
        // ⭐⭐⭐ M-121 when the ticket really opened ⇒ ⇒ ⇒ a failed
        // ⭐⭐⭐ M-121 opening leaves the screen honest (no form of a
        // ⭐⭐⭐ M-121 ticket that was never loaded).
        void openTicket(ticket.ref).then((opened) => {
          if (!opened) return;
          const field = $('assignee-field');
          if (field) field.hidden = false;
          const select = $('edit-assignee');
          if (select) select.focus();
          $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      });
      item.appendChild(assign);
    }

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
    // ⭐⭐⭐ M-119: the queue comes back as it was.
    unassigned: state.unassignedOnly,
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
  // ⭐⭐⭐ M-119: the queue comes back as it was.
  state.unassignedOnly = state.listView.unassigned === true;
  renderUnassignedBadge();
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
  // ⭐⭐⭐ M-116: ⭐⭐⭐ the ticket of the PREVIOUS open is dropped ⇒ ⇒ ⇒
  // ⭐⭐⭐ M-116 the form of the edit is emptied ⇒ ⇒ ⇒ and the save
  // ⭐⭐⭐ M-116 button can NEVER write the old ticket while the new
  // ⭐⭐⭐ M-116 one is still loading (the proof: the version of the
  // ⭐⭐⭐ M-116 old ticket in the database does NOT move).
  state.detailTicket = null;
  $('edit-subject').value = '';
  $('edit-description').value = '';
  $('edit-note').textContent = '';
  $('detail-placeholder').hidden = true;
  $('detail').hidden = false;
  $('detail-error').hidden = true;
  $('detail-subject').textContent = '…';

  const answer = await api('GET', `/api/tickets/${encodeURIComponent(ref)}`);
  // ⭐⭐⭐ M-114: a late reply of an old ticket ⇒ ⇒ ⇒ it is dropped
  // ⭐⭐⭐ (the screen shows the ticket that was asked for LAST).
  if (seq !== state.detailSeq) return false;
  if (!answer.ok) {
    $('detail-error').textContent = errorMessage(answer.body, 'تعذّر فتح التذكرة.');
    $('detail-error').hidden = false;
    $('detail-subject').textContent = '—';
    // ⭐⭐⭐ M-121: the opening FAILED ⇒ ⇒ ⇒ `false` ⇒ ⇒ ⇒ and the
    // ⭐⭐⭐ M-121 fields of the assignment stay HIDDEN.
    return false;
  }
  const ticket = answer.body.ticket ?? {};
  state.detailTicket = ticket;
  state.mayWrite = answer.body.may_write === true;
  state.mayAssign = answer.body.may_assign === true;

  $('detail-subject').textContent = ticket.subject ?? '—';
  $('detail-ref').textContent = ticket.ref ?? '';

  renderFacts(ticket);
  // ⭐⭐⭐ tk-16: the measurements of THIS ticket (from the data that
  // ⭐⭐⭐ tk-16 exists ⇒ ⇒ ⇒ ⇒ and nothing is invented).
  renderMeasurements(ticket);
  renderEdit(ticket);
  // ⭐⭐⭐ tk-17: the pending confirmation belongs to the ticket that is
  // ⭐⭐⭐ tk-17 on the screen ⇒ ⇒ ⇒ ⇒ (it never crosses over).
  clearPendingTicketTemplate();
  renderChanges(rowsOf(answer.body, 'changes'));
  renderTickets();
  renderDetailRightsNote();
  // ⭐⭐⭐ tk-20: the reminders of the company are always in reach.
  renderReminders();

  if (isSmallScreen()) {
    // ⭐⭐ M-114: the small screen swaps the list for the detail ⇒ ⇒ ⇒
    // ⭐⭐ M-114 and the button of the browser comes back to the list.
    setDetailView(true);
    if (!window.location.hash.startsWith('#ticket=')) {
      window.history.pushState({ waslTicket: ref }, '', `#ticket=${encodeURIComponent(ref)}`);
    }
    $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  // ⭐⭐⭐ M-121: ⭐⭐⭐ the ticket really opened ⇒ ⇒ ⇒ `true`.
  // ⭐⭐⭐ M-121 ⭐⭐⭐ (the caller of the assignment needs it ⇒ ⇒ ⇒
  // ⭐⭐⭐ M-121 ⭐⭐⭐ so the fields of the assignment do NOT appear
  // ⭐⭐⭐ M-121 ⭐⭐⭐ when the opening FAILED).
  return true;
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

// ============================================================
// ⭐⭐⭐ tk-16: the MEASUREMENTS of a ticket
// ------------------------------------------------------------
// ⭐⭐⭐ They come from the data that ALREADY EXISTS (the database) ⇒ ⇒
// ⭐⭐⭐ ⇒ and nothing is invented ⇒ ⇒ ⇒ ⇒ (⇒ ⇒ ⇒ ⇒ when there is
// ⭐⭐⭐ nothing to measure the answer is «غير متاح» — NOT a zero).
// ⭐⭐⭐ ⭐ AND THERE IS NO TARGET IN THE PROJECT ⇒ ⇒ ⇒ ⇒ ⇒ the page
// ⭐⭐⭐ shows the MEASUREMENT and says that the target is a decision
// ⭐⭐⭐ of the commercial slice (⇒ ⇒ ⇒ ⇒ it is not guessed here).
// ============================================================
function formatMinutes(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'غير متاح';
  const total = Math.max(0, Math.round(Number(value)));
  if (total < 60) return `${new Intl.NumberFormat('ar-EG').format(total)} دقيقة`;
  if (total < 60 * 24) {
    const hours = Math.floor(total / 60);
    const rest = total % 60;
    const hoursText = new Intl.NumberFormat('ar-EG').format(hours);
    if (rest === 0) return `${hoursText} ساعة`;
    return `${hoursText} ساعة و${new Intl.NumberFormat('ar-EG').format(rest)} دقيقة`;
  }
  const days = Math.floor(total / (60 * 24));
  return `${new Intl.NumberFormat('ar-EG').format(days)} يوم`;
}

/** ⭐⭐⭐ tk-16: the measurements of the ticket on the screen. */
function renderMeasurements(ticket) {
  const block = $('measurements');
  const list = $('measurements-list');
  if (!block || !list) return;
  list.textContent = '';
  const rows = [
    [
      'زمن أول رد',
      ticket.first_response_minutes === null || ticket.first_response_minutes === undefined
        ? 'غير متاح'
        : formatMinutes(ticket.first_response_minutes),
    ],
    ['عمر التذكرة', formatMinutes(ticket.age_minutes)],
    ['آخر نشاط', formatMinutes(ticket.idle_minutes)],
  ];
  for (const [label, value] of rows) {
    const item = document.createElement('li');
    const term = document.createElement('span');
    term.className = 'measure-label';
    term.textContent = label;
    const amount = document.createElement('span');
    amount.className = 'measure-value';
    amount.textContent = value;
    item.appendChild(term);
    item.appendChild(amount);
    list.appendChild(item);
  }
  const note = $('measurements-note');
  if (note) {
    note.textContent =
      'القياسات مقيسة من البيانات الموجودة — مفيش هدف متفق عليه في المشروع، والهدف قرار تجاري.';
  }
  block.hidden = false;
}

/** ⭐⭐⭐ tk-16: the short badge of the measurement in the list. */
function measurementBadge(ticket) {
  const badge = document.createElement('span');
  badge.className = 'measure-badge';
  const first = ticket.first_response_minutes;
  if (first === null || first === undefined) {
    badge.textContent = ticket.conversation_ref ? 'بانتظار أول رد' : 'بلا محادثة';
    badge.title = 'مفيش رد أول بعد — أو مفيش محادثة مرتبطة بالتذكرة';
    badge.dataset.state = 'waiting';
    return badge;
  }
  badge.textContent = `أول رد: ${formatMinutes(first)}`;
  badge.title = 'الزمن بين إنشاء التذكرة وأول رد على محادثتها';
  badge.dataset.state = 'done';
  return badge;
}

// ============================================================
// ⭐⭐⭐ tk-17: the ready phrases of the ticket
// ------------------------------------------------------------
// ⭐⭐⭐ They live in the page (⇒ ⇒ ⇒ NO central management · NO
// ⭐⭐⭐ storage on the server · NO AI) ⇒ ⇒ ⇒ ⇒ and they write in the
// ⭐⭐⭐ description ONLY ⇒ ⇒ ⇒ ⇒ (⇒ ⇒ ⇒ ⇒ they never save) ⇒ ⇒ ⇒ ⇒
// ⭐⭐⭐ and the text that is already there is NEVER replaced without
// ⭐⭐⭐ a clear confirmation.
// ============================================================
const TICKET_TEMPLATES = [
  {
    id: 'contacted',
    label: 'تم التواصل',
    text: 'تم التواصل مع العميل وتم الاتفاق على خطوة تالية للمتابعة.',
  },
  {
    id: 'waiting_customer',
    label: 'بانتظار العميل',
    text: 'بانتظار رد العميل — المتابعة بعد وصول رده.',
  },
  {
    id: 'need_info',
    label: 'مطلوب تفاصيل',
    text: 'تم طلب تفاصيل إضافية من العميل (رقم الطلب ووقت حدوث المشكلة).',
  },
  {
    id: 'resolved',
    label: 'تم الحل',
    text: 'تم حل الطلب بالكامل ولا يحتاج متابعة إضافية.',
  },
];

/** ⭐⭐⭐ tk-17: the pending confirmation (it belongs to the ticket on the screen). */
let pendingTicketTemplate = null;

function renderTicketTemplates() {
  const list = $('ticket-templates-list');
  if (!list) return;
  list.textContent = '';
  for (const template of TICKET_TEMPLATES) {
    const button = document.createElement('button');
    // ⭐⭐⭐ tk-17: the button is NOT a submit (⇒ ⇒ ⇒ ⇒ it never saves).
    button.type = 'button';
    button.className = 'ghost template';
    button.dataset.template = template.id;
    button.textContent = template.label;
    button.title = template.text;
    button.addEventListener('click', () => applyTicketTemplate(template));
    list.appendChild(button);
  }
}

function applyTicketTemplate(template) {
  const box = $('edit-description');
  if (!box) return;
  const confirm = $('ticket-templates-confirm');
  if (box.value.trim().length > 0) {
    // ⭐⭐⭐ tk-17: the text is NEVER replaced without a confirmation.
    pendingTicketTemplate = template;
    if (confirm) confirm.hidden = false;
    return;
  }
  writeTicketTemplate(template);
}

function writeTicketTemplate(template) {
  const box = $('edit-description');
  if (!box) return;
  box.value = template.text;
  box.focus();
  pendingTicketTemplate = null;
  const confirm = $('ticket-templates-confirm');
  if (confirm) confirm.hidden = true;
  const note = $('edit-note');
  if (note) note.textContent = 'العبارة اتكتبت في الوصف — دوس «حفظ التعديل» لتثبيتها.';
  toast('العبارة الجاهزة اتكتبت في الوصف — لسه لازم تحفظ.');
}

function clearPendingTicketTemplate() {
  pendingTicketTemplate = null;
  const confirm = $('ticket-templates-confirm');
  if (confirm) confirm.hidden = true;
}

// ============================================================
// ⭐⭐⭐ tk-19: the export of the tickets
// ------------------------------------------------------------
// ⭐⭐⭐ The file comes from the SERVER with the same right and the same
// ⭐⭐⭐ scope as the list ⇒ ⇒ ⇒ ⇒ (⇒ ⇒ ⇒ ⇒ the export of an employee
// ⭐⭐⭐ holds HIS tickets only) ⇒ ⇒ ⇒ ⇒ and the file is fetched with
// ⭐⭐⭐ the token of the session ⇒ ⇒ ⇒ ⇒ (⇒ ⇒ ⇒ ⇒ the token never goes
// ⭐⭐⭐ into the address of the page ⇒ ⇒ ⇒ ⇒ ⇒ it never lands in the
// ⭐⭐⭐ history of the browser).
// ============================================================
async function exportTickets() {
  const button = $('btn-export');
  if (button) button.disabled = true;
  try {
    const params = new URLSearchParams();
    const query = $('filter-query').value.trim();
    const state = $('filter-state').value;
    const priority = $('filter-priority').value;
    if (query) params.set('q', query);
    if (state) params.set('state', state);
    if (priority) params.set('priority', priority);
    const answer = await api('GET', `/api/tickets/export?${params.toString()}`);
    if (!answer.ok) {
      toast(errorMessage(answer.body, 'تعذّر تصدير التذاكر.'), true);
      return;
    }
    // ⭐⭐⭐ tk-19: the file is made in the browser from the answer ⇒ ⇒ ⇒ ⇒
    // ⭐⭐⭐ (⇒ ⇒ ⇒ ⇒ the token is not in the address of the download).
    const blob = new Blob([String(answer.body ?? '')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `wasl-tickets-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('الملف اتحمّل.');
  } finally {
    if (button) button.disabled = false;
  }
}

// ============================================================
// ⭐⭐⭐ tk-20: the follow-up reminders (LOCAL)
// ------------------------------------------------------------
// ⭐⭐⭐ They live in the browser of the employee ⇒ ⇒ ⇒ ⇒ (⇒ ⇒ ⇒ ⇒ no
// ⭐⭐⭐ message goes out · no notification · no push · no server) ⇒ ⇒
// ⭐⭐⭐ ⇒ and they are bound to the company of the session ⇒ ⇒ ⇒ ⇒ (⇒
// ⭐⭐⭐ ⇒ the reminders of one company never show in another).
// ============================================================
const REMINDERS_KEY = 'wasl_ticket_reminders_v1';

function readReminders() {
  try {
    const raw = localStorage.getItem(REMINDERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item === 'object');
  } catch {
    return [];
  }
}

function writeReminders(list) {
  try {
    localStorage.setItem(REMINDERS_KEY, JSON.stringify(list));
  } catch {
    // ⭐⭐⭐ tk-20: the storage may be refused ⇒ the page keeps working.
  }
}

function remindersOfThisCompany() {
  const tenant = state.sessionTenantId ?? '';
  return readReminders().filter((item) => item.tenant === tenant);
}

function renderReminders() {
  const block = $('reminders');
  const list = $('reminders-list');
  if (!block || !list) return;
  const reminders = remindersOfThisCompany().sort((a, b) => String(a.due).localeCompare(String(b.due)));
  list.textContent = '';
  for (const reminder of reminders) {
    const item = document.createElement('li');
    item.className = 'reminder';
    const subject = document.createElement('span');
    subject.className = 'reminder-subject';
    subject.textContent = reminder.subject || reminder.ref;
    const due = document.createElement('span');
    due.className = 'reminder-due';
    const when = new Date(reminder.due);
    due.textContent = Number.isNaN(when.getTime())
      ? String(reminder.due)
      : new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(when);
    item.appendChild(subject);
    item.appendChild(due);
    if (reminder.note) {
      const note = document.createElement('span');
      note.className = 'reminder-note';
      note.textContent = reminder.note;
      item.appendChild(note);
    }
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'ghost small';
    remove.textContent = 'امسح';
    remove.addEventListener('click', () => {
      const rest = readReminders().filter((entry) => entry.id !== reminder.id);
      writeReminders(rest);
      renderReminders();
    });
    item.appendChild(remove);
    list.appendChild(item);
  }
  const empty = $('reminders-empty');
  if (empty) empty.hidden = reminders.length > 0;
  block.hidden = false;
}

function saveReminder(event) {
  event.preventDefault();
  const ref = state.selected?.ref;
  if (!ref) return;
  const due = $('reminder-due').value;
  if (!due) {
    toast('اختار وقت المتابعة.', true);
    return;
  }
  const ticket = state.detailTicket;
  const reminder = {
    id: `rem_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    tenant: state.sessionTenantId ?? '',
    ref,
    subject: ticket?.subject ?? ref,
    due: new Date(due).toISOString(),
    note: $('reminder-note').value.trim(),
  };
  writeReminders([...readReminders(), reminder]);
  $('reminder-form').hidden = true;
  $('reminder-note').value = '';
  renderReminders();
  toast('التذكير اتحفظ على جهازك — مفيش أي إشعار برّه.');
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
  if (!ticket) {
    // ⭐⭐⭐ M-116: the ticket is still loading ⇒ ⇒ ⇒ there is nothing
    // ⭐⭐⭐ M-116 to save ⇒ ⇒ ⇒ and the page says so out loud (it
    // ⭐⭐⭐ M-116 never writes a ticket that is not on the screen).
    const note = $('edit-note');
    note.textContent = 'التذكرة لسه بتتحمّل — استنى ثانية وحاول تاني.';
    toast('التذكرة لسه بتتحمّل — استنى ثانية وحاول تاني.', true);
    return;
  }
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
  // ⭐⭐⭐ M-119: the queue of another company never stays on the screen.
  state.unassignedOnly = false;
  state.unassignedCount = 0;
  renderUnassignedBadge();
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
// ⭐⭐⭐ tk-19: the export of the tickets that the employee may read.
$('btn-export').addEventListener('click', () => {
  void exportTickets();
});
// ⭐⭐⭐ tk-17: the confirmation of the ready phrase (⇒ ⇒ ⇒ ⇒ it is the
// ⭐⭐⭐ tk-17 phrase of the ticket on the screen ⇒ ⇒ ⇒ ⇒ and it never
// ⭐⭐⭐ tk-17 crosses over to another ticket).
$('btn-template-replace').addEventListener('click', () => {
  const template = pendingTicketTemplate;
  clearPendingTicketTemplate();
  if (!template) return;
  writeTicketTemplate(template);
});
$('btn-template-keep').addEventListener('click', () => {
  clearPendingTicketTemplate();
});
// ⭐⭐⭐ tk-20: the reminders (local ⇒ ⇒ ⇒ ⇒ nothing goes out of the
// ⭐⭐⭐ tk-20 device).
$('btn-reminder-new').addEventListener('click', () => {
  const form = $('reminder-form');
  if (!form) return;
  form.hidden = !form.hidden;
  if (!form.hidden) {
    const due = $('reminder-due');
    if (due && !due.value) {
      // ⭐⭐⭐ tk-20: the default is tomorrow at the beginning of the
      // ⭐⭐⭐ tk-20 next hour (⇒ ⇒ ⇒ ⇒ the employee does not hunt for
      // ⭐⭐⭐ tk-20 a date).
      const when = new Date(Date.now() + 24 * 60 * 60 * 1000);
      when.setMinutes(0, 0, 0);
      due.value = when.toISOString().slice(0, 16);
    }
    const note = $('reminder-note');
    if (note) note.focus();
  }
});
$('btn-reminder-cancel').addEventListener('click', () => {
  $('reminder-form').hidden = true;
});
$('reminder-form').addEventListener('submit', (event) => {
  saveReminder(event);
});

$('btn-refresh').addEventListener('click', () => {
  void loadTickets({ resetPage: true });
});
// ⭐⭐⭐ M-119: the toggle of the queue of the unassigned tickets.
$('btn-unassigned').addEventListener('click', () => {
  searchTickets.cancel();
  state.unassignedOnly = !state.unassignedOnly;
  renderUnassignedBadge();
  void loadTickets({ resetPage: true });
});
$('btn-prev').addEventListener('click', () => {
  if (state.page <= 0) return;
  // ⭐⭐⭐ M-116: the deferred search is cancelled ⇒ ⇒ ⇒ it cannot
  // ⭐⭐⭐ M-116 throw the user back to the first page.
  searchTickets.cancel();
  state.page -= 1;
  void loadTickets();
});
$('btn-next').addEventListener('click', () => {
  // ⭐⭐⭐ M-116: the same (the page the user chose is HIS page).
  searchTickets.cancel();
  state.page += 1;
  void loadTickets();
});
$('filter-query').addEventListener('input', () => {
  // ⭐⭐⭐ M-114: the page does NOT ask the server on every letter ⇒ ⇒ ⇒
  // ⭐⭐⭐ it waits until the user stops typing.
  // ⭐⭐⭐ M-116: ⭐⭐⭐ the request that is ALREADY on its way belongs
  // ⭐⭐⭐ M-116 to the OLD text ⇒ ⇒ ⇒ it is invalidated HERE (not
  // ⭐⭐⭐ M-116 when the next request starts) ⇒ ⇒ ⇒ the old rows never
  // ⭐⭐⭐ M-116 appear under the new text ⇒ ⇒ ⇒ (the guard of the
  // ⭐⭐⭐ M-116 sequence alone was TOO LATE).
  state.listSeq += 1;
  state.page = 0;
  searchTickets();
});
$('filter-state').addEventListener('change', () => {
  // ⭐⭐⭐ M-116: the deferred search is cancelled ⇒ ⇒ ⇒ it does not
  // ⭐⭐⭐ M-116 come back and reset the page that the user chose.
  searchTickets.cancel();
  void loadTickets({ resetPage: true });
});
$('filter-priority').addEventListener('change', () => {
  searchTickets.cancel();
  void loadTickets({ resetPage: true });
});
$('filter-sort').addEventListener('change', () => {
  searchTickets.cancel();
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
  searchTickets.cancel();
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
  // ⭐⭐⭐ tk-17: the ready phrases are drawn once (⇒ ⇒ ⇒ ⇒ they live in
  // ⭐⭐⭐ tk-17 the page and not on the server).
  renderTicketTemplates();
  if (restoreSession()) {
    showWorkspace();
    // ⭐⭐⭐ tk-20: the reminders of the company come back with the
    // ⭐⭐⭐ tk-20 page (⇒ ⇒ ⇒ ⇒ they live on the device).
    renderReminders();
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

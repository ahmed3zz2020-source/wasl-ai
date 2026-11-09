// ============================================================
// WASL AI — FOUNDATION BUILD 03 / PHASE 02 (D-071)
// the customer CRM — the page
// ------------------------------------------------------------
// ⭐ WHAT THIS PAGE IS
//   The list of the customers of the company and the file of one
//   customer: the data, the conversations, and the edit of the fields
//   the owner approved.
// ⭐ EVERYTHING COMES FROM THE REAL API
//   ⭐ There is no fixed data in this file: the list and the profile
//     are read from PostgreSQL through the local API, and the edit is
//     a real write that the server audits.
// ⭐ THE DECISIONS ARE NOT OURS
//   ⭐ The permission to edit is the one of the core
//     (`customer.manage`): the server announces it (`may_manage`) and
//     the page only shows what the server allows.
// ⛔ No external service: no font, no asset, no call outside this
//   machine.
// ============================================================

const $ = (id) => document.getElementById(id);

const STATE_LABELS = {
  new: 'جديدة',
  open: 'مفتوحة',
  assigned: 'مُسندة',
  pending: 'معلّقة',
  resolved: 'تم الحل',
  closed: 'مغلقة',
  owner: 'مالك',
  supervisor: 'مشرف',
  agent: 'موظف',
  viewer: 'قارئ',
};

// ⭐⭐ D-073: the labels of the tickets (the states of the module).
const TICKET_STATE_LABELS = {
  open: 'مفتوحة',
  in_progress: 'قيد التنفيذ',
  resolved: 'تم الحل',
  closed: 'مغلقة',
};

const TICKET_PRIORITY_LABELS = {
  low: 'منخفضة',
  normal: 'عادية',
  high: 'عالية',
  urgent: 'عاجلة',
};

const ERROR_LABELS = {
  capability_missing: 'لا تملك صلاحية تنفيذ هذا الإجراء.',
  customer_not_found: 'العميل غير موجود أو خارج نطاق صلاحياتك.',
  customer_version_conflict: 'العميل اتعدّل من موظف تاني. افتح الملف تاني قبل ما تحفظ.',
  name_invalid: 'الاسم غير صالح.',
  email_invalid: 'البريد الإلكتروني غير صالح.',
  phone_invalid: 'رقم الهاتف غير صالح.',
  version_required: 'الملف لازم يتفتح تاني قبل الحفظ.',
  nothing_to_change: 'مفيش حاجة تتغيّر.',
  network_error: 'تعذّر الاتصال بالخادم. تحقق من الاتصال ثم أعد المحاولة.',
  session_expired: 'انتهت الجلسة. سجّل الدخول من جديد.',
};

const SESSION_KEY = 'wasl_session_v1';

/** ⭐⭐ M-120: how long the page waits before it asks the server. */
const SEARCH_DEBOUNCE_MS = 320;

const state = {
  token: null,
  role: '',
  userId: '',
  sessionTenantId: '',
  customers: [],
  selected: null,
  /** ⭐⭐ the customer that is on the screen (the version of the lock). */
  profileCustomer: null,
  mayManage: false,
  page: 0,
  pageSize: 25,
  total: 0,
  sort: 'name',
  /** ⭐⭐⭐ M-120: the number of the last request of the list. */
  listSeq: 0,
  /** ⭐⭐⭐ M-120: the number of the last request of the profile. */
  profileSeq: 0,
  /** ⭐⭐⭐ M-120: the state of the list before the profile (to come back). */
  listView: { query: '', sort: 'name', page: 0, scroll: 0 },
  /** ⭐⭐⭐ M-120: the page is on the profile now (the small screen). */
  profileView: false,
  /** ⭐⭐⭐ M-120: the connection with the server is gone? */
  offline: false,
};

/** ⭐⭐ The session of the tab (the same key the inbox uses). */
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

function rowsOf(body, key) {
  const value = body?.[key];
  return Array.isArray(value) ? value : [];
}

// ------------------------------------------------------------ the list
/**
 * ⭐⭐⭐ M-120: ⭐⭐⭐ the search waits until the user stops typing ⇒ ⇒ ⇒
 *   ⭐⭐⭐ one call for the whole word and NOT one call for every letter
 *   ⭐⭐⭐ ⇒ ⇒ ⇒ (the same rule as the page of the tickets).
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

/** ⭐⭐⭐ M-120: the request of the search (debounced). */
const searchCustomers = debounce(() => {
  void loadCustomers({ resetPage: true });
}, SEARCH_DEBOUNCE_MS);

/** ⭐⭐⭐ M-120: is the screen of the small size? */
function isSmallScreen() {
  return window.matchMedia('(max-width: 860px)').matches;
}

/** ⭐⭐⭐ M-120: the connection with the server is gone? */
function setOffline(offline) {
  state.offline = offline;
  const banner = $('offline-banner');
  if (banner) banner.hidden = !offline;
}

async function loadCustomers(options = {}) {
  if (options.resetPage) state.page = 0;
  // ⭐⭐⭐ M-120: the number of this request ⇒ ⇒ ⇒ a reply that arrives
  // ⭐⭐⭐ M-120 late (after a newer request) is DROPPED ⇒ ⇒ ⇒ the list
  // ⭐⭐⭐ M-120 never shows the results of an old search.
  const seq = ++state.listSeq;
  const firstLoad = state.customers.length === 0 && state.total === 0;
  $('list-loading').hidden = !firstLoad;
  $('list-error').hidden = true;

  const params = new URLSearchParams();
  const query = $('filter-query').value.trim();
  if (query) params.set('q', query);
  params.set('sort', state.sort);
  params.set('limit', String(state.pageSize));
  params.set('offset', String(state.page * state.pageSize));

  const answer = await api('GET', `/api/crm/customers?${params.toString()}`);
  // ⭐⭐⭐ M-120: a late reply of an old request ⇒ ⇒ ⇒ it is dropped.
  if (seq !== state.listSeq) return;
  $('list-loading').hidden = true;
  if (!answer.ok) {
    // ⭐⭐⭐ M-120: the connection with the server is gone.
    if (answer.status === 0) setOffline(true);
    $('list-error-text').textContent = errorMessage(answer.body, 'تعذّر تحميل العملاء.');
    $('list-error').hidden = false;
    $('list-empty').hidden = true;
    return;
  }
  setOffline(false);
  state.customers = rowsOf(answer.body, 'customers');
  state.total = Number(answer.body.total ?? 0);
  state.mayManage = answer.body.may_manage === true;
  renderCustomers();
  renderPagination();
  renderEmptyState();
  $('list-counter').textContent = `${state.total} عميل`;
}

/** ⭐⭐⭐ M-120: the empty state says WHY the list is empty. */
function renderEmptyState() {
  const box = $('list-empty');
  if (state.customers.length > 0) {
    box.hidden = true;
    return;
  }
  const filtered = $('filter-query').value.trim() !== '';
  $('list-empty-title').textContent = filtered ? 'لا توجد نتائج للبحث ده.' : 'لا يوجد عملاء بعد.';
  $('list-empty-text').textContent = filtered
    ? 'جرّب كلمة تانية أو امسح البحث.'
    : 'أول ما يتسجل عميل هيظهر هنا.';
  $('btn-clear-filters').hidden = !filtered;
  box.hidden = false;
}

function renderCustomers() {
  const list = $('customer-list');
  list.textContent = '';
  if (state.customers.length === 0) {
    $('list-empty').hidden = false;
    return;
  }
  for (const customer of state.customers) {
    const item = document.createElement('li');
    item.className = 'customer';
    if (state.selected && state.selected.id === customer.id) {
      item.classList.add('active');
    }
    item.dataset.id = customer.id;

    const top = document.createElement('div');
    top.className = 'row-top';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = customer.display_name ?? 'عميل بلا اسم';
    top.appendChild(name);

    const meta = document.createElement('div');
    meta.className = 'meta';
    const conversations = document.createElement('span');
    conversations.textContent = `${customer.conversation_count} محادثة`;
    meta.appendChild(conversations);
    const last = document.createElement('span');
    last.textContent = `آخر تفاعل: ${formatTime(customer.last_interaction_at)}`;
    last.title = formatAbsolute(customer.last_interaction_at);
    meta.appendChild(last);
    if (customer.email) {
      const email = document.createElement('span');
      email.textContent = customer.email;
      meta.appendChild(email);
    }

    item.appendChild(top);
    item.appendChild(meta);
    item.addEventListener('click', () => openCustomer(customer.id));
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

// ------------------------------------------------------------ the profile
/**
 * ⭐⭐⭐ M-120: ⭐⭐⭐ the page remembers the state of the list before it
 *   ⭐⭐⭐ opens a customer ⇒ ⇒ ⇒ the way back returns to the SAME
 *   ⭐⭐⭐ place (the search, the order, the page and the screen).
 */
function rememberListView() {
  state.listView = {
    query: $('filter-query').value,
    sort: state.sort,
    page: state.page,
    scroll: window.scrollY,
  };
}

/** ⭐⭐⭐ M-120: the state of the list comes back as it was. */
function restoreListView() {
  $('filter-query').value = state.listView.query;
  $('filter-sort').value = state.listView.sort;
  state.sort = state.listView.sort;
  state.page = state.listView.page;
  renderPagination();
}

/**
 * ⭐⭐⭐ M-120: ⭐⭐⭐ the small screen shows EITHER the list OR the
 *   ⭐⭐⭐ profile ⇒ ⇒ ⇒ the customer opens at once (and the button of
 *   ⭐⭐⭐ the browser comes back to the list).
 */
function setProfileView(on) {
  state.profileView = on;
  document.body.classList.toggle('view-profile', on);
  const list = document.querySelector('.pane.list');
  const profile = document.getElementById('profile-pane');
  if (list) list.hidden = on;
  if (profile) profile.hidden = !on;
}

async function openCustomer(customerId) {
  // ⭐⭐⭐ M-120: the state of the list is remembered before the profile.
  if (!state.profileView) rememberListView();
  // ⭐⭐⭐ M-120: the number of this request ⇒ ⇒ ⇒ a late reply of an
  // ⭐⭐⭐ M-120 old customer is DROPPED (the screen shows the customer
  // ⭐⭐⭐ M-120 that was asked for LAST).
  const seq = ++state.profileSeq;
  state.selected = { id: customerId };
  // ⭐⭐⭐ M-120: the customer of the PREVIOUS open is dropped ⇒ ⇒ ⇒ the
  // ⭐⭐⭐ M-120 form of the edit can never write the old customer.
  state.profileCustomer = null;
  $('profile-placeholder').hidden = true;
  $('profile').hidden = false;
  $('profile-error').hidden = true;
  $('profile-name').textContent = '…';

  const answer = await api('GET', `/api/crm/customers/${encodeURIComponent(customerId)}`);
  // ⭐⭐⭐ M-120: a late reply of an old customer ⇒ ⇒ ⇒ it is dropped.
  if (seq !== state.profileSeq) return;
  if (!answer.ok) {
    if (answer.status === 0) setOffline(true);
    $('profile-error').textContent = errorMessage(answer.body, 'تعذّر فتح ملف العميل.');
    $('profile-error').hidden = false;
    $('profile-name').textContent = '—';
    return;
  }
  setOffline(false);
  const customer = answer.body.customer ?? {};
  state.profileCustomer = customer;
  state.mayManage = answer.body.may_manage === true;

  $('profile-name').textContent = customer.display_name ?? 'عميل بلا اسم';
  $('profile-id').textContent = customer.id ?? '';

  renderFacts(customer);
  renderConversations(rowsOf(answer.body, 'conversations'));
  // ⭐⭐ D-073: the tickets of the customer (the server sends them
  //   with the same scope as the count).
  renderTickets(rowsOf(answer.body, 'tickets'), answer.body.open_ticket_count);
  renderEdit(customer);
  renderCustomers();

  if (isSmallScreen()) {
    // ⭐⭐⭐ M-120: the small screen swaps the list for the profile ⇒ ⇒ ⇒
    // ⭐⭐⭐ M-120 and the button of the browser comes back to the list.
    setProfileView(true);
    if (!window.location.hash.startsWith('#customer=')) {
      window.history.pushState({ waslCustomer: customerId }, '', `#customer=${encodeURIComponent(customerId)}`);
    }
    $('profile').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

/**
 * ⭐⭐⭐ M-120: THE WAY BACK ⇒ ⇒ ⇒ the list comes back with the state it
 *   ⭐⭐⭐ had (the search, the order, the page and the place of the
 *   ⭐⭐⭐ screen).
 */
function closeProfile() {
  state.profileSeq += 1;
  $('profile').hidden = true;
  $('profile-placeholder').hidden = false;
  state.profileCustomer = null;
  restoreListView();
  if (state.profileView) {
    setProfileView(false);
    if (window.location.hash.startsWith('#customer=')) {
      window.history.back();
    }
    window.scrollTo({ top: state.listView.scroll, behavior: 'auto' });
  }
}

function renderFacts(customer) {
  const facts = $('profile-facts');
  facts.textContent = '';
  const rows = [
    ['الاسم', customer.display_name ?? '—'],
    ['البريد الإلكتروني', customer.email || '—'],
    ['رقم الهاتف', customer.phone || '—'],
    ['التصنيف', customer.data_class ?? '—'],
    ['آخر تفاعل', customer.last_interaction_at ? formatAbsolute(customer.last_interaction_at) : '—'],
    ['آخر تعديل', customer.updated_at ? formatAbsolute(customer.updated_at) : '—'],
  ];
  for (const [label, value] of rows) {
    const term = document.createElement('dt');
    term.textContent = label;
    const item = document.createElement('dd');
    item.textContent = String(value);
    facts.appendChild(term);
    facts.appendChild(item);
  }
}

function renderConversations(conversations) {
  const list = $('conversation-list');
  list.textContent = '';
  $('conversations-empty').hidden = conversations.length > 0;
  for (const conversation of conversations) {
    const item = document.createElement('li');
    item.className = 'conversation';

    const top = document.createElement('div');
    top.className = 'row-top';
    const ref = document.createElement('span');
    ref.className = 'name';
    ref.textContent = conversation.ref ?? '';
    top.appendChild(ref);
    top.appendChild(stateBadge(conversation.state));
    item.appendChild(top);

    const meta = document.createElement('div');
    meta.className = 'meta';
    const count = document.createElement('span');
    count.textContent = `${conversation.message_count} رسالة`;
    meta.appendChild(count);
    const last = document.createElement('span');
    last.textContent = `آخر نشاط: ${formatTime(conversation.last_message_at ?? conversation.updated_at)}`;
    meta.appendChild(last);
    item.appendChild(meta);

    if (conversation.last_message_body) {
      const preview = document.createElement('div');
      preview.className = 'preview';
      preview.textContent = conversation.last_message_body;
      item.appendChild(preview);
    }

    // ⭐⭐ D-071: the conversation opens in the inbox (with its reference).
    const open = document.createElement('a');
    open.className = 'ghost link small';
    open.href = `/ui/inbox.html?conversation=${encodeURIComponent(conversation.ref ?? '')}`;
    open.textContent = 'افتح المحادثة';
    item.appendChild(open);
    list.appendChild(item);
  }
}

/**
 * ⭐⭐ D-073: the tickets of the customer.
 * ⭐⭐ THE COUNT FOLLOWS THE SAME SCOPE as the list (the server sends
 *   both) ⇒ ⭐⭐ the number can never include a ticket of another
 *   employee (the lesson of M-83).
 */
function renderTickets(tickets, openCount) {
  const block = $('tickets-block');
  const list = $('ticket-list');
  list.textContent = '';
  const rows = Array.isArray(tickets) ? tickets : [];
  $('tickets-empty').hidden = rows.length > 0;
  $('tickets-counter').textContent = `${Number(openCount ?? 0)} مفتوحة من ${rows.length}`;
  const link = $('link-new-ticket');
  const customerId = state.selected?.id ?? '';
  if (customerId) {
    link.hidden = false;
    link.href = `/ui/tickets.html?customer=${encodeURIComponent(customerId)}`;
  } else {
    link.hidden = true;
    link.href = '#';
  }
  for (const ticket of rows) {
    const item = document.createElement('li');
    item.className = 'ticket-item';

    const top = document.createElement('div');
    top.className = 'row-top';
    const subject = document.createElement('span');
    subject.className = 'name';
    subject.textContent = ticket.subject ?? '';
    top.appendChild(subject);
    const badge = document.createElement('span');
    badge.className = 'state-badge';
    badge.dataset.state = ticket.state;
    badge.textContent = TICKET_STATE_LABELS[ticket.state] ?? ticket.state;
    top.appendChild(badge);
    item.appendChild(top);

    const meta = document.createElement('div');
    meta.className = 'meta';
    const ref = document.createElement('span');
    ref.textContent = ticket.ref ?? '';
    meta.appendChild(ref);
    const priority = document.createElement('span');
    priority.textContent = `الأولوية: ${TICKET_PRIORITY_LABELS[ticket.priority] ?? ticket.priority ?? '—'}`;
    meta.appendChild(priority);
    if (ticket.assignee_actor_id) {
      const assignee = document.createElement('span');
      assignee.textContent = `مُسنَد إلى ${ticket.assignee_actor_id}`;
      meta.appendChild(assignee);
    }
    item.appendChild(meta);

    const open = document.createElement('a');
    open.className = 'ghost link small';
    open.href = `/ui/tickets.html?ticket=${encodeURIComponent(ticket.ref ?? '')}`;
    open.textContent = 'افتح التذكرة';
    item.appendChild(open);
    list.appendChild(item);
  }
  block.hidden = false;
}

function renderEdit(customer) {
  const block = $('edit-block');
  // ⭐⭐ The permission comes from the server (the core decided it).
  block.hidden = !state.mayManage;
  if (!state.mayManage) return;
  $('edit-name').value = customer.display_name ?? '';
  $('edit-email').value = customer.email ?? '';
  $('edit-phone').value = customer.phone ?? '';
  $('edit-note').textContent = '';
}

// ------------------------------------------------------------ the edit
async function saveCustomer(event) {
  event.preventDefault();
  const selected = state.selected;
  if (!selected) return;
  const customer = state.profileCustomer;
  if (!customer) {
    // ⭐⭐⭐ M-120: the customer is still loading ⇒ ⇒ ⇒ there is nothing
    // ⭐⭐⭐ M-120 to save ⇒ ⇒ ⇒ (and the page NEVER writes a customer
    // ⭐⭐⭐ M-120 that is not on the screen).
    $('edit-note').textContent = 'ملف العميل لسه بيتحمّل — استنى ثانية وحاول تاني.';
    toast('ملف العميل لسه بيتحمّل — استنى ثانية وحاول تاني.', true);
    return;
  }

  const displayName = $('edit-name').value.trim();
  const email = $('edit-email').value.trim();
  const phone = $('edit-phone').value.trim();
  if (displayName.length === 0) {
    toast(ERROR_LABELS.name_invalid, true);
    return;
  }
  // ⭐⭐ A confirmation before a change that matters.
  const changed =
    displayName !== (customer.display_name ?? '') ||
    email !== (customer.email ?? '') ||
    phone !== (customer.phone ?? '');
  if (!changed) {
    toast('مفيش تغيير.');
    return;
  }
  if (!window.confirm('هل تريد حفظ التعديل على بيانات العميل؟')) {
    return;
  }

  const answer = await api('PATCH', `/api/crm/customers/${encodeURIComponent(selected.id)}`, {
    display_name: displayName,
    email,
    phone,
    version: Number(customer.version ?? 1),
  });
  if (!answer.ok) {
    if (answer.status === 409) {
      // ⭐⭐ The lock fired: the file must be opened again.
      $('edit-note').textContent = ERROR_LABELS.customer_version_conflict;
      toast(ERROR_LABELS.customer_version_conflict, true);
      await openCustomer(selected.id);
      return;
    }
    toast(errorMessage(answer.body, 'تعذّر حفظ التعديل.'), true);
    return;
  }
  toast('تم حفظ بيانات العميل.');
  state.profileCustomer = answer.body.customer ?? null;
  await openCustomer(selected.id);
  await loadCustomers();
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
  await loadCustomers({ resetPage: true });
}

function showWorkspace() {
  $('login-row').hidden = true;
  $('who').hidden = false;
  $('who-name').textContent = state.userId;
  $('who-role').textContent = STATE_LABELS[state.role] ?? state.role;
  $('workspace').hidden = false;
}

async function logout() {
  clearSession();
  await api('DELETE', '/api/session');
  state.token = null;
  state.selected = null;
  state.profileCustomer = null;
  state.listSeq += 1;
  state.profileSeq += 1;
  setProfileView(false);
  setOffline(false);
  $('login-row').hidden = false;
  $('who').hidden = true;
  $('workspace').hidden = true;
  $('profile').hidden = true;
  $('profile-placeholder').hidden = false;
  $('customer-list').textContent = '';
}

// ------------------------------------------------------------ the wiring
$('btn-login').addEventListener('click', () => {
  void login();
});
$('btn-logout').addEventListener('click', () => {
  void logout();
});
$('btn-refresh').addEventListener('click', () => {
  void loadCustomers({ resetPage: true });
});
$('btn-prev').addEventListener('click', () => {
  if (state.page <= 0) return;
  // ⭐⭐⭐ M-120: the deferred search is cancelled ⇒ ⇒ ⇒ it cannot
  // ⭐⭐⭐ M-120 throw the user back to the first page.
  searchCustomers.cancel();
  state.page -= 1;
  void loadCustomers();
});
$('btn-next').addEventListener('click', () => {
  searchCustomers.cancel();
  state.page += 1;
  void loadCustomers();
});
$('filter-query').addEventListener('input', () => {
  // ⭐⭐⭐ M-120: ⭐⭐⭐ the page does NOT ask the server on every letter
  // ⭐⭐⭐ M-120 ⇒ ⇒ ⇒ it waits until the user stops typing.
  // ⭐⭐⭐ M-120: ⭐⭐⭐ the request that is ALREADY on its way belongs
  // ⭐⭐⭐ M-120 to the OLD text ⇒ ⇒ ⇒ it is invalidated HERE ⇒ ⇒ ⇒ the
  // ⭐⭐⭐ M-120 old rows never appear under the new text.
  state.listSeq += 1;
  state.page = 0;
  searchCustomers();
});
$('filter-sort').addEventListener('change', () => {
  searchCustomers.cancel();
  state.sort = $('filter-sort').value;
  void loadCustomers({ resetPage: true });
});
$('btn-back').addEventListener('click', () => {
  // ⭐⭐⭐ M-120: the way back keeps the state of the list.
  closeProfile();
});
$('btn-clear-filters').addEventListener('click', () => {
  searchCustomers.cancel();
  $('filter-query').value = '';
  void loadCustomers({ resetPage: true });
});
$('btn-retry').addEventListener('click', () => {
  void loadCustomers();
});
$('btn-retry-offline').addEventListener('click', () => {
  setOffline(false);
  void loadCustomers();
});
// ⭐⭐⭐ M-120: the browser says that the connection is gone (or back).
window.addEventListener('offline', () => {
  setOffline(true);
});
window.addEventListener('online', () => {
  setOffline(false);
  void loadCustomers();
});
// ⭐⭐⭐ M-120: the button of the browser comes back to the list.
window.addEventListener('popstate', () => {
  if (state.profileView) closeProfile();
});
$('edit-form').addEventListener('submit', (event) => {
  void saveCustomer(event);
});

// ⭐⭐ D-071: the page opens the customer that the inbox pointed at.
async function boot() {
  if (restoreSession()) {
    showWorkspace();
    await loadCustomers({ resetPage: true });
    const wanted = new URLSearchParams(window.location.search).get('customer');
    if (wanted) await openCustomer(wanted);
    return;
  }
  const notice = $('login-notice');
  notice.textContent = 'سجّل الدخول من صندوق الوارد أو من هنا.';
  notice.hidden = false;
}

void boot();

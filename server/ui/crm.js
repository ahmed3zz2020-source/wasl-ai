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
async function loadCustomers(options = {}) {
  if (options.resetPage) state.page = 0;
  $('list-loading').hidden = false;
  $('list-error').hidden = true;
  $('list-empty').hidden = true;

  const params = new URLSearchParams();
  const query = $('filter-query').value.trim();
  if (query) params.set('q', query);
  params.set('sort', state.sort);
  params.set('limit', String(state.pageSize));
  params.set('offset', String(state.page * state.pageSize));

  const answer = await api('GET', `/api/crm/customers?${params.toString()}`);
  $('list-loading').hidden = true;
  if (!answer.ok) {
    $('list-error').textContent = errorMessage(answer.body, 'تعذّر تحميل العملاء.');
    $('list-error').hidden = false;
    return;
  }
  state.customers = rowsOf(answer.body, 'customers');
  state.total = Number(answer.body.total ?? 0);
  state.mayManage = answer.body.may_manage === true;
  renderCustomers();
  renderPagination();
  $('list-counter').textContent = `${state.total} عميل`;
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
async function openCustomer(customerId) {
  state.selected = { id: customerId };
  $('profile-placeholder').hidden = true;
  $('profile').hidden = false;
  $('profile-error').hidden = true;
  $('profile-name').textContent = '…';

  const answer = await api('GET', `/api/crm/customers/${encodeURIComponent(customerId)}`);
  if (!answer.ok) {
    $('profile-error').textContent = errorMessage(answer.body, 'تعذّر فتح ملف العميل.');
    $('profile-error').hidden = false;
    $('profile-name').textContent = '—';
    return;
  }
  const customer = answer.body.customer ?? {};
  state.profileCustomer = customer;
  state.mayManage = answer.body.may_manage === true;

  $('profile-name').textContent = customer.display_name ?? 'عميل بلا اسم';
  $('profile-id').textContent = customer.id ?? '';

  renderFacts(customer);
  renderConversations(rowsOf(answer.body, 'conversations'));
  renderEdit(customer);
  renderCustomers();

  if (window.matchMedia('(max-width: 860px)').matches) {
    $('profile').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  if (!customer) return;

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
  state.page -= 1;
  void loadCustomers();
});
$('btn-next').addEventListener('click', () => {
  state.page += 1;
  void loadCustomers();
});
$('filter-query').addEventListener('input', () => {
  state.page = 0;
  void loadCustomers({ resetPage: true });
});
$('filter-sort').addEventListener('change', () => {
  state.sort = $('filter-sort').value;
  void loadCustomers({ resetPage: true });
});
$('btn-back').addEventListener('click', () => {
  $('profile').hidden = true;
  $('profile-placeholder').hidden = false;
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

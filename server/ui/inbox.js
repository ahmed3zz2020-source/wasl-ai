// ============================================================
// WASL AI — FOUNDATION BUILD 03 / PHASE 01 (D-070)
// the customer inbox — the behaviour
// ------------------------------------------------------------
// ⭐ The page is NOT a preview: every value it shows comes from the
//   real local API, and every action it offers is a real request that
//   reaches PostgreSQL.
// ⭐ The interface speaks the language of the core: the states it
//   offers are the states the core allows from the current one, and
//   the assignment list is the list of the database.
// ⭐ The double send is impossible: the reply carries the reference the
//   page prepared, so a retry of the same reply is refused by the
//   server instead of being stored twice.
// ⛔ No technical detail of the database ever reaches the screen.
// ============================================================

'use strict';

const $ = (id) => document.getElementById(id);

const STATE_LABELS = {
  new: 'جديدة',
  open: 'مفتوحة',
  assigned: 'مُسندة',
  pending: 'معلّقة',
  resolved: 'تم الحل',
  closed: 'مغلقة',
};

/** ⭐ The messages of the declared codes (no raw technical detail). */
const ERROR_LABELS = {
  body_required: 'اكتب نص الرد أولًا.',
  message_duplicate: 'تم إرسال هذه الرسالة من قبل.',
  message_conflict: 'تم إرسال رد مشابه للتو. حدّث المحادثة قبل الإرسال.',
  conversation_not_found: 'المحادثة غير موجودة.',
  transition_not_allowed: 'هذه الحالة غير مسموحة من الحالة الحالية.',
  state_terminal: 'المحادثة مغلقة ولا تقبل أي تغيير.',
  transition_requires_assignee: 'يجب إسناد المحادثة إلى موظف أولًا.',
  assignee_not_in_tenant: 'الموظف المختار ليس من هذه الشركة.',
  capability_missing: 'لا تملك صلاحية تنفيذ هذا الإجراء.',
  login_rate_limited: 'محاولات كثيرة فاشلة. انتظر قليلًا ثم حاول مجددًا.',
  login_platform_saturated: 'خدمة الدخول مشغولة حاليًا. حاول بعد قليل.',
  network_error: 'تعذّر الاتصال بالخادم. تحقق من الاتصال ثم أعد المحاولة.',
  session_expired: 'انتهت الجلسة. سجّل الدخول من جديد.',
};

const state = {
  token: null,
  role: '',
  userId: '',
  conversations: [],
  selected: null,
  allowedStates: [],
  agents: [],
  /** ⭐ The reference of the reply that is being prepared. */
  draftRef: null,
  sending: false,
};

/** ⭐ A reference that the server cannot guess (the double send guard). */
function newDraftRef() {
  const random = Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `reply_ui_${random}`;
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

/** ⭐ The message of an error (the code decides, never the raw text). */
function errorMessage(body, fallback) {
  const code = String((body?.error?.code) ?? '');
  if (code && ERROR_LABELS[code]) return ERROR_LABELS[code];
  if (code === 'token_missing' || code === 'session_expired' || code === 'token_invalid') {
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

/** ⭐ The time of a message, in a readable Arabic form. */
function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
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
  return new Intl.DateTimeFormat('ar-EG', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function stateBadge(stateValue) {
  const badge = document.createElement('span');
  badge.className = 'state-badge';
  badge.dataset.state = stateValue;
  badge.textContent = STATE_LABELS[stateValue] ?? stateValue;
  return badge;
}

// ------------------------------------------------------------ the list
async function loadConversations() {
  $('list-loading').hidden = false;
  $('list-error').hidden = true;
  $('list-empty').hidden = true;

  const params = new URLSearchParams();
  const query = $('filter-query').value.trim();
  const filterState = $('filter-state').value;
  const assignee = $('filter-assignee').value;
  if (query) params.set('q', query);
  if (filterState) params.set('state', filterState);
  if (assignee) params.set('assignee', assignee);
  params.set('limit', '100');

  const answer = await api('GET', `/api/inbox/conversations?${params.toString()}`);
  $('list-loading').hidden = true;

  if (!answer.ok) {
    $('list-error').textContent = errorMessage(answer.body, 'تعذّر تحميل المحادثات.');
    $('list-error').hidden = false;
    return;
  }
  state.conversations = answer.body.conversations ?? [];
  renderConversations();
  $('list-counter').textContent = `${state.conversations.length} محادثة`;
}

function renderConversations() {
  const list = $('conversation-list');
  list.textContent = '';
  if (state.conversations.length === 0) {
    $('list-empty').hidden = false;
    return;
  }
  for (const conversation of state.conversations) {
    const item = document.createElement('li');
    item.className = 'conversation';
    if (state.selected && state.selected.ref === conversation.ref) {
      item.classList.add('active');
    }
    item.dataset.ref = conversation.ref;

    const top = document.createElement('div');
    top.className = 'row-top';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = conversation.customer_name ?? 'محادثة بلا اسم عميل';
    top.appendChild(name);
    top.appendChild(stateBadge(conversation.state));

    const preview = document.createElement('div');
    preview.className = 'preview';
    preview.textContent = conversation.last_message_body ?? 'لا توجد رسائل بعد.';

    const meta = document.createElement('div');
    meta.className = 'meta';
    const time = document.createElement('span');
    time.textContent = formatTime(conversation.last_message_at ?? conversation.updated_at);
    time.title = formatAbsolute(conversation.last_message_at ?? conversation.updated_at);
    meta.appendChild(time);
    const count = document.createElement('span');
    count.textContent = `${conversation.message_count} رسالة`;
    meta.appendChild(count);
    if (conversation.assignee_actor_id) {
      const assigned = document.createElement('span');
      assigned.textContent = 'مُسندة';
      meta.appendChild(assigned);
    }

    item.appendChild(top);
    item.appendChild(preview);
    item.appendChild(meta);
    item.addEventListener('click', () => openConversation(conversation.ref));
    list.appendChild(item);
  }
}

// ------------------------------------------------------------ the thread
async function openConversation(ref) {
  state.selected = { ref };
  $('thread-placeholder').hidden = true;
  $('thread').hidden = false;
  $('thread-error').hidden = true;
  $('messages').textContent = '';
  $('thread-customer').textContent = '…';

  const answer = await api('GET', `/api/inbox/conversations/${encodeURIComponent(ref)}`);
  if (!answer.ok) {
    $('thread-error').textContent = errorMessage(answer.body, 'تعذّر فتح المحادثة.');
    $('thread-error').hidden = false;
    $('thread-customer').textContent = '—';
    return;
  }

  const conversation = answer.body.conversation ?? {};
  state.allowedStates = answer.body.allowed_states ?? [];
  $('thread-customer').textContent = conversation.customer_name ?? 'محادثة بلا اسم عميل';
  $('thread-ref').textContent = conversation.ref ?? '';
  const badge = $('thread-state');
  badge.textContent = STATE_LABELS[conversation.state] ?? conversation.state;
  badge.dataset.state = conversation.state;

  renderMessages(answer.body.messages ?? []);
  renderStateOptions(conversation.state);
  await loadAgents();
  renderConversations();

  if (window.matchMedia('(max-width: 860px)').matches) {
    $('thread').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function renderMessages(messages) {
  const list = $('messages');
  list.textContent = '';
  if (messages.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'state-box';
    empty.textContent = 'لا توجد رسائل في هذه المحادثة بعد.';
    list.appendChild(empty);
    return;
  }
  for (const message of messages) {
    const item = document.createElement('li');
    item.className = `message ${message.direction === 'outbound' ? 'outbound' : 'inbound'}`;
    const who = document.createElement('div');
    who.className = 'who-line';
    const whoName = document.createElement('span');
    whoName.textContent = message.direction === 'outbound' ? 'رد الموظف' : 'العميل';
    const time = document.createElement('span');
    time.textContent = formatTime(message.occurred_at);
    time.title = formatAbsolute(message.occurred_at);
    who.appendChild(whoName);
    who.appendChild(time);
    const text = document.createElement('div');
    text.className = 'text';
    text.textContent = message.body;
    item.appendChild(who);
    item.appendChild(text);
    list.appendChild(item);
  }
  list.scrollTop = list.scrollHeight;
}

function renderStateOptions(current) {
  const select = $('state-select');
  select.textContent = '';
  const options = state.allowedStates.length > 0 ? state.allowedStates : [];
  if (options.length === 0) {
    const option = document.createElement('option');
    option.value = current;
    option.textContent = STATE_LABELS[current] ?? current;
    select.appendChild(option);
    select.disabled = true;
    return;
  }
  select.disabled = false;
  for (const value of options) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = STATE_LABELS[value] ?? value;
    select.appendChild(option);
  }
  select.value = current;
}

async function loadAgents() {
  const answer = await api('GET', '/api/inbox/agents');
  const field = $('assign-field');
  if (!answer.ok) {
    // ⭐ The employee may not assign: the control disappears.
    field.hidden = true;
    state.agents = [];
    return;
  }
  state.agents = answer.body.agents ?? [];
  const select = $('assign-select');
  select.textContent = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'بلا إسناد';
  select.appendChild(none);
  for (const agent of state.agents) {
    const option = document.createElement('option');
    option.value = agent.actor_id;
    option.textContent = `${agent.display_name} (${agent.role})`;
    select.appendChild(option);
  }
  const current = state.selected?.assignee ?? '';
  select.value = current;
  field.hidden = false;
}

// ------------------------------------------------------------ the actions
async function sendReply(event) {
  event.preventDefault();
  if (state.sending) return;
  const body = $('reply-body').value.trim();
  if (!body) {
    toast(ERROR_LABELS.body_required, true);
    return;
  }
  // ⭐⭐ The reference is prepared once and kept until the answer
  //   arrives: a retry of the same reply is refused by the server, so
  //   the message can never be stored twice.
  if (!state.draftRef) state.draftRef = newDraftRef();
  state.sending = true;
  const button = $('btn-send');
  button.disabled = true;
  button.textContent = 'جارٍ الإرسال…';

  const ref = state.selected?.ref;
  const answer = await api('POST', `/api/inbox/conversations/${encodeURIComponent(ref)}/replies`, {
    body,
    client_message_ref: state.draftRef,
  });

  state.sending = false;
  button.disabled = false;
  button.textContent = 'إرسال';

  if (!answer.ok) {
    toast(errorMessage(answer.body, 'تعذّر إرسال الرد.'), true);
    // ⭐ The reference is kept: a retry sends the SAME reply and the
    //   server refuses the duplicate instead of storing it twice.
    if (answer.status === 409) {
      state.draftRef = newDraftRef();
      $('reply-body').value = '';
    }
    return;
  }
  state.draftRef = null;
  $('reply-body').value = '';
  toast('تم إرسال الرد وحفظه.');
  await openConversation(ref);
  await loadConversations();
}

async function changeState() {
  const ref = state.selected?.ref;
  const to = $('state-select').value;
  const answer = await api('POST', `/api/inbox/conversations/${encodeURIComponent(ref)}/state`, {
    to,
    reason: 'inbox',
  });
  if (!answer.ok) {
    toast(errorMessage(answer.body, 'تعذّر تغيير الحالة.'), true);
    await openConversation(ref);
    return;
  }
  toast('تم تغيير حالة المحادثة.');
  await openConversation(ref);
  await loadConversations();
}

async function changeAssignee() {
  const ref = state.selected?.ref;
  const actor = $('assign-select').value;
  const answer = await api('POST', `/api/inbox/conversations/${encodeURIComponent(ref)}/assign`, {
    actor_id: actor,
    reason: 'inbox',
  });
  if (!answer.ok) {
    toast(errorMessage(answer.body, 'تعذّر إسناد المحادثة.'), true);
    return;
  }
  toast('تم إسناد المحادثة.');
  await openConversation(ref);
  await loadConversations();
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
  $('login-row').hidden = true;
  $('who').hidden = false;
  $('who-name').textContent = state.userId;
  $('who-role').textContent = STATE_LABELS[state.role] ?? state.role;
  $('workspace').hidden = false;
  // ⭐ The scope of the filter follows the role: an employee that sees
  //   only the conversations of the company may filter them.
  $('assignee-filter-field').hidden = state.role === 'agent';
  await loadConversations();
}

async function logout() {
  await api('DELETE', '/api/session');
  state.token = null;
  state.selected = null;
  $('login-row').hidden = false;
  $('who').hidden = true;
  $('workspace').hidden = true;
  $('thread').hidden = true;
  $('thread-placeholder').hidden = false;
  $('conversation-list').textContent = '';
}

// ------------------------------------------------------------ the wiring
$('btn-login').addEventListener('click', () => {
  void login();
});
$('btn-logout').addEventListener('click', () => {
  void logout();
});
$('btn-refresh').addEventListener('click', () => {
  void loadConversations();
});
$('composer').addEventListener('submit', (event) => {
  void sendReply(event);
});
$('state-select').addEventListener('change', () => {
  void changeState();
});
$('assign-select').addEventListener('change', () => {
  void changeAssignee();
});
$('btn-back').addEventListener('click', () => {
  $('thread').hidden = true;
  $('thread-placeholder').hidden = false;
});
let searchTimer = null;
$('filter-query').addEventListener('input', () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    void loadConversations();
  }, 250);
});
$('filter-state').addEventListener('change', () => {
  void loadConversations();
});
$('filter-assignee').addEventListener('change', () => {
  void loadConversations();
});

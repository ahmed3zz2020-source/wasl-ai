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
  /** ⭐⭐ D-071: the company of the session (the context of the CRM). */
  sessionTenantId: '',
  conversations: [],
  selected: null,
  allowedStates: [],
  agents: [],
  /** ⭐ The reference of the reply that is being prepared. */
  draftRef: null,
  sending: false,
  /** ⭐⭐ M-78: the page of the list (the pagination is real). */
  page: 0,
  pageSize: 25,
  total: 0,
  /** ⭐⭐ M-77: the instant of the last refresh of the thread. */
  lastServerTime: null,
  /** ⭐⭐ M-77: the timer of the refresh. */
  pollTimer: null,
  pollBusy: false,
  /** ⭐⭐ M-77: the messages that are already on the screen. */
  knownMessageRefs: new Set(),
};

/**
 * ⭐⭐ The session of the tab.
 * ⭐ The CRM and the inbox are two pages of the same work: ⭐ the
 *   context (the company and the permissions) must SURVIVE the move
 *   from one to the other ⇒ ⭐ the token is kept in the storage of
 *   the tab (and it dies with the tab).
 */
const SESSION_KEY = 'wasl_session_v1';

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

function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ⭐ Nothing to do: the tab dies with the storage.
  }
}

/** ⭐ A reference that the server cannot guess (the double send guard). */
function newDraftRef() {
  const random = Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `reply_ui_${random}`;
}

/**
 * ⭐⭐⭐ M-79: the race of the requests.
 * ⭐ Every request that paints the screen belongs to a CHANNEL (the
 *   list, the thread, the refresh). ⭐ A new request in a channel
 *   ABORTS the one before it and takes its number ⇒ ⭐ an answer that
 *   arrives late is DROPPED ⇒ ⭐⭐ **the data of an old conversation
 *   can never be painted under the title of a new one.**
 */
const channels = new Map();

/** ⭐ The call to the local API. */
async function api(method, path, body, channel = null) {
  const headers = {};
  if (state.token) headers.authorization = `Bearer ${state.token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  let seq = 0;
  let controller = null;
  if (channel !== null) {
    const previous = channels.get(channel);
    seq = (previous?.seq ?? 0) + 1;
    controller = new AbortController();
    if (previous?.controller) previous.controller.abort();
    channels.set(channel, { seq, controller });
  }
  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      ...(controller ? { signal: controller.signal } : {}),
    });
  } catch {
    // ⭐ A request that was replaced is not a failure of the network.
    if (channel !== null && channels.get(channel)?.seq !== seq) {
      return { ok: false, status: 0, body: {}, stale: true };
    }
    return { ok: false, status: 0, body: { error: { code: 'network_error' } } };
  }
  const text = await response.text();
  let parsed = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { error: { code: 'unknown' } };
  }
  // ⭐⭐ M-79: a late answer is dropped, never painted.
  if (channel !== null && channels.get(channel)?.seq !== seq) {
    return { ok: response.ok, status: response.status, body: parsed, stale: true };
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
async function loadConversations(options = {}) {
  // ⭐⭐ M-78: a new filter starts at the first page (a page of the
  //   old filter would show rows that do not match the new one).
  if (options.resetPage) state.page = 0;
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
  // ⭐⭐ M-78: the page is real ⇒ a company with more than a hundred
  //   conversations reaches all of them, none of them disappears.
  params.set('limit', String(state.pageSize));
  params.set('offset', String(state.page * state.pageSize));

  const answer = await api('GET', `/api/inbox/conversations?${params.toString()}`, undefined, 'list');
  if (answer.stale) return; // ⭐⭐ M-79: a late answer never paints.
  $('list-loading').hidden = true;

  if (!answer.ok) {
    $('list-error').textContent = errorMessage(answer.body, 'تعذّر تحميل المحادثات.');
    $('list-error').hidden = false;
    return;
  }
  state.conversations = answer.body.conversations ?? [];
  state.total = Number(answer.body.total ?? 0);
  renderConversations();
  renderPagination();
  $('list-counter').textContent = `${state.total} محادثة`;
}

/** ⭐⭐ M-78: the controls of the pages. */
function renderPagination() {
  const pages = Math.max(1, Math.ceil(state.total / state.pageSize));
  const bar = $('pagination');
  bar.hidden = pages <= 1;
  $('page-label').textContent = `صفحة ${state.page + 1} من ${pages}`;
  $('btn-prev').disabled = state.page <= 0;
  $('btn-next').disabled = state.page + 1 >= pages;
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

// ------------------------------------------------------------ the refresh (M-77)
/**
 * ⭐⭐ How often the open thread asks for what is new.
 * ⭐ It is a LOCAL refresh: no service outside this machine, and the
 *   request carries the instant of the last answer ⇒ ⭐ only the new
 *   messages travel, never the whole thread.
 */
const POLL_INTERVAL_MS = 8000;

function startPolling() {
  stopPolling();
  $('thread-refresh').textContent = 'التحديث التلقائي يعمل';
  state.pollTimer = setInterval(() => {
    void pollThread();
  }, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

/**
 * ⭐⭐ M-77: the refresh of the open thread.
 * ⭐ ① it asks only for what is newer than the last answer,
 * ⭐ ② it never repeats a message,
 * ⭐ ③ it never touches the text the employee is writing,
 * ⭐ ④ a lost connection does not clear the thread and does not stop
 *      the refresh (the next tick tries again),
 * ⭐ ⑤ a session that is over stops the refresh and says it.
 */
async function pollThread() {
  if (state.pollBusy) return; // ⭐ no two refreshes at the same time
  const ref = state.selected?.ref;
  if (!ref || !state.token) return;
  // ⭐ A tab that is not visible asks nothing.
  if (document.visibilityState === 'hidden') return;
  state.pollBusy = true;
  try {
    const answer = await api(
      'GET',
      `/api/inbox/conversations/${encodeURIComponent(ref)}?since=${encodeURIComponent(
        state.lastServerTime ?? '',
      )}`,
      undefined,
      'poll',
    );
    if (answer.stale) return;
    // ⭐⭐ The employee may have opened another conversation meanwhile.
    if (state.selected?.ref !== ref) return;
    if (answer.status === 401 || answer.status === 403) {
      stopPolling();
      $('thread-refresh').textContent = 'انتهت الجلسة. سجّل الدخول من جديد.';
      return;
    }
    if (!answer.ok) {
      $('thread-refresh').textContent = 'تعذّر التحديث — سنحاول مرة أخرى.';
      return;
    }
    state.lastServerTime = answer.body.server_time ?? state.lastServerTime;
    const added = appendNewMessages(answer.body.messages ?? []);
    $('thread-refresh').textContent =
      added > 0 ? `وصلت ${added} رسالة جديدة` : 'آخر تحديث: الآن';
  } finally {
    state.pollBusy = false;
  }
}

// ------------------------------------------------------------ the thread
async function openConversation(ref, options = {}) {
  state.selected = { ref };
  state.knownMessageRefs = new Set();
  $('thread-placeholder').hidden = true;
  $('thread').hidden = false;
  $('thread-error').hidden = true;
  $('messages').textContent = '';
  $('thread-customer').textContent = '…';

  const answer = await api(
    'GET',
    `/api/inbox/conversations/${encodeURIComponent(ref)}`,
    undefined,
    'thread',
  );
  // ⭐⭐ M-79: the answer of a conversation that is not the one on the
  //   screen is dropped ⇒ ⭐ no data of an old conversation is ever
  //   painted under the title of a new one.
  if (answer.stale) return;
  if (!answer.ok) {
    $('thread-error').textContent = errorMessage(answer.body, 'تعذّر فتح المحادثة.');
    $('thread-error').hidden = false;
    $('thread-customer').textContent = '—';
    stopPolling();
    return;
  }

  const conversation = answer.body.conversation ?? {};
  state.allowedStates = answer.body.allowed_states ?? [];
  state.lastServerTime = answer.body.server_time ?? null;
  $('thread-customer').textContent = conversation.customer_name ?? 'محادثة بلا اسم عميل';
  $('thread-ref').textContent = conversation.ref ?? '';
  const badge = $('thread-state');
  badge.textContent = STATE_LABELS[conversation.state] ?? conversation.state;
  badge.dataset.state = conversation.state;

  renderMessages(answer.body.messages ?? []);
  renderStateOptions(conversation.state);
  await loadAgents();
  renderConversations();
  startPolling(); // ⭐⭐ M-77: the thread refreshes by itself.

  // ⭐⭐ D-071: the link to the file of the customer (the CRM).
  const customerId = conversation.customer_id;
  const customerLink = $('link-customer');
  if (typeof customerId === 'string' && customerId.length > 0) {
    customerLink.hidden = false;
    customerLink.href = `/ui/crm.html?customer=${encodeURIComponent(customerId)}`;
  } else {
    customerLink.hidden = true;
    customerLink.href = '#';
  }

  if (window.matchMedia('(max-width: 860px)').matches) {
    $('thread').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function renderMessages(messages) {
  const list = $('messages');
  list.textContent = '';
  state.knownMessageRefs = new Set();
  if (messages.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'state-box';
    empty.textContent = 'لا توجد رسائل في هذه المحادثة بعد.';
    list.appendChild(empty);
    return;
  }
  for (const message of messages) {
    list.appendChild(messageNode(message));
    state.knownMessageRefs.add(String(message.message_ref));
  }
  list.scrollTop = list.scrollHeight;
}

/** ⭐ One message of the thread. */
function messageNode(message) {
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
  return item;
}

/**
 * ⭐⭐ M-77: the NEW messages only.
 * ⭐ The thread is never painted again ⇒ ⭐⭐ **the text the employee
 *   is writing is never touched** ⇒ ⭐ and a message that arrives
 *   twice is shown once.
 */
function appendNewMessages(messages) {
  const list = $('messages');
  const empty = list.querySelector('.state-box');
  if (empty) empty.remove();
  let added = 0;
  for (const message of messages) {
    const ref = String(message.message_ref);
    if (state.knownMessageRefs.has(ref)) continue; // ⭐ no repetition
    state.knownMessageRefs.add(ref);
    list.appendChild(messageNode(message));
    added += 1;
  }
  if (added > 0) list.scrollTop = list.scrollHeight;
  return added;
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
    // ⭐⭐⭐ M-80: the answer was LOST. ⭐ The failure is NOT declared
    //   before the result is verified in the database ⇒ ⭐ the employee
    //   is never told «it failed» while the message is stored.
    // ⭐⭐⭐ M-80: the outcome is UNKNOWN when the connection died (0)
    //   or when the server failed AFTER the write (5xx) ⇒ ⭐ the result
    //   is verified before any failure is declared.
    if (answer.status === 0 || answer.status >= 500) {
      const stored = await verifyStoredReply(ref, state.draftRef);
      if (stored) {
        state.draftRef = null;
        $('reply-body').value = '';
        toast('الرد اتحفظ — الشبكة وقعت قبل ما يوصل التأكيد. مش محتاج تبعت تاني.');
        await openConversation(ref);
        await loadConversations();
        return;
      }
      // ⭐ The text and the reference STAY ⇒ the retry sends the same
      //   reply and the server refuses the duplicate.
      toast('مقدرناش نتأكد إن الرد اتحفظ. ابعت تاني بنفس المرجع — التكرار ممنوع.', true);
      return;
    }
    if (answer.status === 409) {
      // ⭐⭐ The server refused the duplicate ⇒ the FIRST one is stored.
      state.draftRef = null;
      $('reply-body').value = '';
      toast('الرد كان متحفظ من قبل — مش تكرار.');
      await openConversation(ref);
      return;
    }
    toast(errorMessage(answer.body, 'تعذّر إرسال الرد.'), true);
    // ⭐ The reference is kept: a retry sends the SAME reply and the
    //   server refuses the duplicate instead of storing it twice.
    return;
  }
  state.draftRef = null;
  $('reply-body').value = '';
  toast('تم إرسال الرد وحفظه.');
  await openConversation(ref);
  await loadConversations();
}

/**
 * ⭐⭐ M-80: is the reply really in the database?
 * ⭐ The check is a READ of the thread, and it looks for the reference
 *   of the reply ⇒ ⭐ the answer is the fact and not a guess.
 */
async function verifyStoredReply(ref, messageRef) {
  if (!ref || !messageRef) return false;
  const answer = await api('GET', `/api/inbox/conversations/${encodeURIComponent(ref)}`);
  if (!answer.ok) return false;
  const messages = answer.body.messages ?? [];
  return messages.some((message) => String(message.message_ref) === String(messageRef));
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
  state.sessionTenantId = answer.body.session?.tenant_id ?? $('login-tenant').value;
  saveSession();
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
  stopPolling();
  clearSession();
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
  void loadConversations({ resetPage: true });
});
// ⭐⭐ M-78: the pages of the list.
$('btn-prev').addEventListener('click', () => {
  if (state.page <= 0) return;
  state.page -= 1;
  void loadConversations();
});
$('btn-next').addEventListener('click', () => {
  state.page += 1;
  void loadConversations();
});
// ⭐⭐ M-77: the manual refresh of the open thread.
$('btn-refresh-thread').addEventListener('click', () => {
  void pollThread();
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
    void loadConversations({ resetPage: true });
  }, 250);
});
$('filter-state').addEventListener('change', () => {
  void loadConversations({ resetPage: true });
});
$('filter-assignee').addEventListener('change', () => {
  void loadConversations({ resetPage: true });
});
void bootSession();
/**
 * ⭐⭐ D-071: the page comes back with the session of the tab.
 * ⭐ The token is checked by the SERVER (the first call decides) ⇒
 *   ⭐ a token that is over sends the employee back to the login.
 */
async function bootSession() {
  if (!restoreSession()) return;
  $('login-row').hidden = true;
  $('who').hidden = false;
  $('who-name').textContent = state.userId;
  $('who-role').textContent = STATE_LABELS[state.role] ?? state.role;
  $('workspace').hidden = false;
  $('assignee-filter-field').hidden = state.role === 'agent';
  await loadConversations({ resetPage: true });
  if (state.conversations.length === 0 && $('list-error').hidden) {
    // ⭐ The session may be over: the answer said so.
    await logout();
    return;
  }
  // ⭐⭐ D-071: the CRM points at a conversation ⇒ the inbox opens it.
  const wanted = new URLSearchParams(window.location.search).get('conversation');
  if (wanted) {
    await openConversation(wanted);
    const url = new URL(window.location.href);
    url.searchParams.delete('conversation');
    window.history.replaceState({}, '', url.toString());
  }
}

// ⭐⭐ M-77: the tab that comes back to the front asks for what is new.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void pollThread();
});
// ⭐⭐ M-79: leaving the page stops the refresh (no requests in the void).
window.addEventListener('pagehide', () => {
  stopPolling();
});

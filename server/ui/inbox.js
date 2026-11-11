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
  /**
   * ⭐⭐⭐ M-126: ⭐⭐⭐ the drafts belong to the CONVERSATION ⇒ ⇒ ⇒
   * ⭐⭐⭐ (a map: the reference of the conversation ⇒ ⇒ ⇒ { the
   * ⭐⭐⭐ reference of the reply · the text · the sending }) ⇒ ⇒ ⇒
   * ⭐⭐⭐ ⇒ ⇒ ⇒ and the text of one conversation NEVER touches
   * ⭐⭐⭐ another one ⇒ ⇒ ⇒ nor the reference of one reply is ever
   * ⭐⭐⭐ used for another conversation ⇒ ⇒ ⇒ (the server refuses a
   * ⭐⭐⭐ repeated reference ⇒ ⇒ ⇒ ⇒ the reply of the employee would
   * ⭐⭐⭐ be LOST).
   */
  drafts: new Map(),
  /**
   * ⭐⭐⭐ M-127: ⭐⭐⭐ the number of the session ⇒ ⇒ ⇒ (an answer of
   * ⭐⭐⭐ an old session is NEVER painted ⇒ ⇒ ⇒ nor the answer of an
   * ⭐⭐⭐ old company ⇒ ⇒ ⇒ ⇒ the data of a company never appears
   * ⭐⭐⭐ under the name of another one).
   */
  epoch: 0,
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
  /** ⭐⭐⭐ M-125: the connection with the server is gone. */
  offline: false,
  /** ⭐⭐⭐ M-127: the status of the last answer of the list. */
  listStatus: null,
  /** ⭐⭐⭐ M-125: the place of the list before the conversation. */
  listScroll: 0,
  /**
   * ⭐⭐⭐ M-127: ⭐⭐⭐ the state of the list (the search · the filters
   * ⭐⭐⭐ M-127 · the page · the place of the screen) ⇒ ⇒ ⇒ and the way
   * ⭐⭐⭐ M-127 back returns to exactly the same place.
   */
  listView: { query: '', state: '', assignee: '', page: 0, scroll: 0 },
  /** ⭐⭐⭐ M-125: the small screen shows EITHER the list OR the thread. */
  threadView: false,
  /** ⭐⭐⭐ M-125: what to do when the connection comes back. */
  retry: null,
  // ⭐⭐⭐ M-125: ⭐⭐⭐ the rights of the CORE (the server announces
  // ⭐⭐⭐ M-125 them ⇒ ⇒ ⇒ and the page hides what may NOT be done).
  mayReply: false,
  mayChangeState: false,
  mayAssign: false,
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
 * ⭐⭐⭐ M-126: ⭐⭐⭐ the draft of ONE conversation ⇒ ⇒ ⇒ (the map is
 * ⭐⭐⭐ keyed by the reference of the conversation ⇒ ⇒ ⇒ ⇒ the text
 * ⭐⭐⭐ and the reference of the reply belong to it alone).
 */
function draftOf(ref) {
  let draft = state.drafts.get(ref);
  if (!draft) {
    draft = { messageRef: null, text: '', sending: false };
    state.drafts.set(ref, draft);
  }
  return draft;
}

/**
 * ⭐⭐⭐ M-126: ⭐⭐⭐ the text of the composer belongs to the
 * ⭐⭐⭐ conversation that is open NOW ⇒ ⇒ ⇒ (it is saved in its
 * ⭐⭐⭐ draft ⇒ ⇒ ⇒ ⇒ it comes back when the employee returns to
 * ⭐⭐⭐ that conversation ⇒ ⇒ ⇒ ⇒ and it NEVER touches the text of
 * ⭐⭐⭐ another conversation).
 */
function saveComposerToDraft() {
  const ref = state.selected?.ref;
  if (!ref) return;
  const box = $('reply-body');
  if (!box) return;
  draftOf(ref).text = box.value;
}

/**
 * ⭐⭐⭐ M-126: ⭐⭐⭐ the draft of the conversation that is open comes
 * ⭐⭐⭐ into the composer ⇒ ⇒ ⇒ (and the composer of the employee is
 * ⭐⭐⭐ NEVER emptied by the answer of another conversation).
 */
function restoreDraftToComposer(ref) {
  const box = $('reply-body');
  if (!box) return;
  box.value = draftOf(ref).text;
}

/**
 * ⭐⭐⭐ M-127: ⭐⭐⭐ the state of the list is kept in the storage of
 * ⭐⭐⭐ M-127 the tab ⇒ ⇒ ⇒ ⇒ the search · the filters · the page · and
 * ⭐⭐⭐ M-127 the place of the screen come back after a RELOAD ⇒ ⇒ ⇒
 * ⭐⭐⭐ M-127 (and after the way back of the conversation) ⇒ ⇒ ⇒ ⇒ the
 * ⭐⭐⭐ M-127 employee never loses the place where he was.
 */
const LIST_VIEW_KEY = 'wasl_inbox_list_view_v1';

function saveListViewToStorage() {
  try {
    const scroller = $('conversation-list');
    sessionStorage.setItem(
      LIST_VIEW_KEY,
      JSON.stringify({
        query: $('filter-query').value,
        state: $('filter-state').value,
        assignee: $('filter-assignee').value,
        page: state.page,
        scroll: window.scrollY,
        listScroll: scroller ? scroller.scrollTop : 0,
      }),
    );
  } catch {
    // ⭐⭐ a browser that refuses the storage is not a failure of the work.
  }
}

function loadListViewFromStorage() {
  try {
    const raw = sessionStorage.getItem(LIST_VIEW_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (typeof saved !== 'object' || saved === null) return;
    state.listView = {
      query: typeof saved.query === 'string' ? saved.query : '',
      state: typeof saved.state === 'string' ? saved.state : '',
      assignee: typeof saved.assignee === 'string' ? saved.assignee : '',
      page: Number.isFinite(saved.page) && saved.page > 0 ? Number(saved.page) : 0,
      scroll: Number.isFinite(saved.scroll) ? Number(saved.scroll) : 0,
    };
    state.listScroll = Number.isFinite(saved.listScroll) ? Number(saved.listScroll) : 0;
  } catch {
    // ⭐⭐ nothing to restore.
  }
}

/**
 * ⭐⭐⭐ M-127: ⭐⭐⭐ the state of the list is remembered before the
 * ⭐⭐⭐ conversation opens ⇒ ⇒ ⇒ (the way back returns to the SAME
 * ⭐⭐⭐ place: the search · the filters · the page · the scroll).
 */
function rememberListView() {
  state.listView = {
    query: $('filter-query').value,
    state: $('filter-state').value,
    assignee: $('filter-assignee').value,
    page: state.page,
    scroll: window.scrollY,
  };
  const scroller = $('conversation-list');
  state.listScroll = scroller ? scroller.scrollTop : 0;
  saveListViewToStorage();
}

/** ⭐⭐⭐ M-127: the state of the list comes back as it was. */
function restoreListView() {
  $('filter-query').value = state.listView.query;
  $('filter-state').value = state.listView.state;
  $('filter-assignee').value = state.listView.assignee;
  state.page = state.listView.page;
  renderPagination();
  const scroller = $('conversation-list');
  if (scroller && state.listScroll > 0) scroller.scrollTop = state.listScroll;
  if (state.listView.scroll > 0) window.scrollTo(0, state.listView.scroll);
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

/**
 * ⭐⭐⭐ M-127: ⭐⭐⭐ the answer of a request that is NOT wanted anymore
 * ⭐⭐⭐ is dropped BEFORE the new request is sent ⇒ ⇒ ⇒ (the search
 * ⭐⭐⭐ that is typed drops the answer of the old search at once ⇒
 * ⭐⭐⭐ ⇒ ⇒ ⇒ the old list NEVER lands under the new text).
 */
function invalidateChannel(name) {
  const entry = channels.get(name);
  if (!entry) return;
  entry.seq = entry.seq + 1;
  if (entry.controller) {
    try {
      entry.controller.abort();
    } catch {
      // ⭐⭐ the request is already done ⇒ nothing to abort.
    }
  }
}

/**
 * ⭐⭐⭐ M-127: ⭐⭐⭐ the search that waits is cancelled ⇒ ⇒ ⇒ (a page
 * ⭐⭐⭐ M-127 that changes · a filter that changes · a logout ⇒ ⇒ ⇒
 * ⭐⭐⭐ ⇒ ⇒ ⇒ the search of the old text NEVER lands).
 */
function cancelPendingSearch() {
  if (searchTimer) {
    clearTimeout(searchTimer);
    searchTimer = null;
  }
  invalidateChannel('list');
}

/** ⭐ The call to the local API. */
async function api(method, path, body, channel = null) {
  const headers = {};
  if (state.token) headers.authorization = `Bearer ${state.token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  // ⭐⭐⭐ M-127: ⭐⭐⭐ the session of this call ⇒ ⇒ ⇒ (an answer that
  // ⭐⭐⭐ M-127 belongs to an OLD session is NEVER painted).
  const epoch = state.epoch;
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
    // ⭐⭐⭐ M-127: the session changed while the request was in the air.
    if (epoch !== state.epoch) {
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
  // ⭐⭐⭐ M-127: ⭐⭐⭐ the answer of an OLD session (or of an old
  // ⭐⭐⭐ M-127 company) is dropped ⇒ ⇒ ⇒ ⇒ the data of a company
  // ⭐⭐⭐ M-127 NEVER appears under the name of another one.
  if (epoch !== state.epoch) {
    return { ok: response.ok, status: response.status, body: parsed, stale: true };
  }
  return { ok: response.ok, status: response.status, body: parsed };
}

/** ⭐⭐⭐ M-125: ⭐⭐⭐ the connection with the server is gone? */
function setOffline(offline) {
  state.offline = offline;
  const banner = $('offline-banner');
  if (banner) banner.hidden = !offline;
}

/** ⭐⭐⭐ M-125: ⭐⭐⭐ is the screen of the small size? */
function isSmallScreen() {
  return window.matchMedia('(max-width: 860px)').matches;
}

/**
 * ⭐⭐⭐ M-125: ⭐⭐⭐ the small screen shows EITHER the list OR the
 * ⭐⭐⭐ M-125 conversation ⇒ ⇒ ⇒ (the big screen shows the two).
 */
function setThreadView(on) {
  // ⭐⭐⭐ M-125: ⭐⭐⭐ the swap is for the SMALL screen only ⇒ ⇒ ⇒
  // ⭐⭐⭐ M-125 (the big screen keeps the list and the conversation
  // ⭐⭐⭐ M-125 together ⇒ ⇒ ⇒ as it always was).
  const small = isSmallScreen();
  state.threadView = small && on;
  document.body.classList.toggle('view-thread', small && on);
  const listPane = document.querySelector('.pane.list');
  const threadPane = document.querySelector('.pane.thread');
  if (listPane) listPane.hidden = small && on;
  if (threadPane) threadPane.hidden = false;
  if (!on) {
    // ⭐⭐⭐ M-125: ⭐⭐⭐ the list comes back AT ITS PLACE ⇒ ⇒ ⇒ (the
    // ⭐⭐⭐ M-125 user does not hunt for the conversation again).
    const scroller = $('conversation-list');
    if (scroller && state.listScroll > 0) scroller.scrollTop = state.listScroll;
  }
}

/** ⭐⭐⭐ M-125: ⭐⭐⭐ the conversation is closed and the list is back. */
function closeThread(options = {}) {
  // ⭐⭐⭐ M-126: the text of the composer is saved in the draft of the
  // ⭐⭐⭐ M-126 conversation that closes ⇒ ⇒ ⇒ ⇒ it comes back when
  // ⭐⭐⭐ M-126 the employee returns to it.
  saveComposerToDraft();
  // ⭐⭐⭐ M-127: ⭐⭐⭐ the way back goes through the history of the
  // ⭐⭐⭐ M-127 browser ⇒ ⇒ ⇒ ⇒ the button of the page and the button
  // ⭐⭐⭐ M-127 of the browser are ONE thing ⇒ ⇒ ⇒ (and the address
  // ⭐⭐⭐ M-127 of the page comes back to the list).
  if (!options.fromHistory && window.history.state?.waslConversation) {
    window.history.back();
    return;
  }
  state.selected = null;
  // ⭐⭐⭐ M-132: ⭐⭐⭐ no conversation on the screen ⇒ ⇒ ⇒ ⇒ no
  // ⭐⭐⭐ M-132 confirmation on the screen (the pending of each
  // ⭐⭐⭐ M-132 conversation waits for its own conversation).
  syncQuickReplyStrip();
  setThreadView(false);
  $('thread').hidden = true;
  $('thread-placeholder').hidden = false;
  stopPolling();
  renderConversations();
  // ⭐⭐⭐ M-127: ⭐⭐⭐ the list comes back with its search · its
  // ⭐⭐⭐ M-127 filters · its page · and its place on the screen.
  restoreListView();
  if (!options.fromHistory) clearConversationInUrl();
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
  // ⭐⭐⭐ M-127: ⭐⭐⭐ the status of the answer of the list ⇒ ⇒ ⇒ (it
  // ⭐⭐⭐ M-127 tells an expired session from an empty result).
  state.listStatus = answer.status;
  // ⭐⭐⭐ M-127: ⭐⭐⭐ the answer paints ONLY if the search it carries
  // ⭐⭐⭐ M-127 is still the one in the box ⇒ ⇒ ⇒ ⇒ the list of the
  // ⭐⭐⭐ M-127 old search NEVER lands under the new text ⇒ ⇒ ⇒ (the
  // ⭐⭐⭐ M-127 answer of the old search is dropped even if it arrives
  // ⭐⭐⭐ M-127 INSIDE the waiting window of the new one).
  if ($('filter-query').value.trim() !== query) return;
  $('list-loading').hidden = true;
  // ⭐⭐⭐ M-125: ⭐⭐⭐ the network is gone ⇒ ⇒ ⇒ (the banner + the
  // ⭐⭐⭐ M-125 button of the retry ⇒ ⇒ ⇒ and the list stays as it is).
  if (answer.status === 0) {
    setOffline(true);
    state.retry = () => loadConversations();
  } else {
    setOffline(false);
  }

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
  // ⭐⭐⭐ M-127: the state of the list is kept (the search · the
  // ⭐⭐⭐ M-127 filters · the page · the place) ⇒ ⇒ ⇒ ⇒ it comes back
  // ⭐⭐⭐ M-127 after a reload of the page.
  saveListViewToStorage();
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
/**
 * ⭐⭐⭐ M-127: ⭐⭐⭐ the conversation that is open lives in the address
 * ⭐⭐⭐ M-127 of the page ⇒ ⇒ ⇒ ⇒ the back button of the BROWSER
 * ⭐⭐⭐ M-127 returns to the list (and NOT out of the page) ⇒ ⇒ ⇒ and
 * ⭐⭐⭐ M-127 the way back is the same on every screen.
 */
function conversationInUrl() {
  try {
    return new URLSearchParams(window.location.search).get('conversation');
  } catch {
    return null;
  }
}

/** ⭐⭐⭐ M-127: the conversation joins the history of the browser. */
function pushConversation(ref) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('conversation', ref);
    window.history.pushState({ waslConversation: ref }, '', url.toString());
  } catch {
    // ⭐⭐ a browser that refuses the history still works (the button
    // ⭐⭐ of the page closes the conversation).
  }
}

/** ⭐⭐⭐ M-127: the conversation leaves the address (without a new entry). */
function clearConversationInUrl() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('conversation');
    window.history.replaceState({}, '', url.toString());
  } catch {
    // ⭐⭐ nothing to do.
  }
}

async function openConversation(ref, options = {}) {
  // ⭐⭐⭐ M-126: ⭐⭐⭐ the text of the composer belongs to the
  // ⭐⭐⭐ M-126 conversation that is open NOW ⇒ ⇒ ⇒ (it is saved
  // ⭐⭐⭐ M-126 before the switch ⇒ ⇒ ⇒ ⇒ it comes back with its
  // ⭐⭐⭐ M-126 conversation ⇒ ⇒ ⇒ ⇒ and it NEVER touches the text of
  // ⭐⭐⭐ M-126 another conversation).
  const changed = state.selected?.ref !== ref;
  if (changed) saveComposerToDraft();
  // ⭐⭐⭐ M-127: the state of the list is remembered before the thread.
  if (changed && !state.threadView) rememberListView();
  state.selected = { ref };
  // ⭐⭐⭐ M-132: ⭐⭐⭐ the confirmation on the screen belongs to the
  // ⭐⭐⭐ M-132 conversation that is on the screen NOW ⇒ ⇒ ⇒ ⇒ (the
  // ⭐⭐⭐ M-132 confirmation of A is NOT shown while B is open ⇒ ⇒ ⇒ ⇒
  // ⭐⭐⭐ M-132 and it comes back with A).
  syncQuickReplyStrip();
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
  // ⭐⭐⭐ M-125: ⭐⭐⭐ the network is gone ⇒ ⇒ ⇒ (the banner + the
  // ⭐⭐⭐ M-125 retry ⇒ ⇒ ⇒ the conversation is NOT lost).
  if (answer.status === 0) {
    setOffline(true);
    state.retry = () => openConversation(ref, { keepScroll: true });
    $('thread-error').textContent = errorMessage(answer.body, 'تعذّر فتح المحادثة.');
    $('thread-error').hidden = false;
    stopPolling();
    return;
  }
  setOffline(false);
  if (!answer.ok) {
    $('thread-error').textContent = errorMessage(answer.body, 'تعذّر فتح المحادثة.');
    $('thread-error').hidden = false;
    $('thread-customer').textContent = '—';
    stopPolling();
    return;
  }

  const conversation = answer.body.conversation ?? {};
  state.allowedStates = answer.body.allowed_states ?? [];
  // ⭐⭐⭐ M-125: ⭐⭐⭐ the rights of the core (the server decides ⇒ ⇒ ⇒
  // ⭐⭐⭐ M-125 and the page NEVER decides for itself).
  state.mayReply = answer.body.may_reply === true;
  state.mayChangeState = answer.body.may_change_state === true;
  state.mayAssign = answer.body.may_assign === true;
  renderRights();
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

  // ⭐⭐⭐ M-126: ⭐⭐⭐ the draft of THIS conversation comes into the
  // ⭐⭐⭐ M-126 composer ⇒ ⇒ ⇒ (the text of the employee comes back
  // ⭐⭐⭐ M-126 with his conversation ⇒ ⇒ ⇒ ⇒ and the composer of
  // ⭐⭐⭐ M-126 another conversation is NEVER touched).
  restoreDraftToComposer(ref);
  // ⭐⭐⭐ M-126: the button follows the conversation that is open.
  renderComposerState(ref);
  // ⭐⭐⭐ M-127: ⭐⭐⭐ the conversation joins the history of the
  // ⭐⭐⭐ M-127 browser ⇒ ⇒ ⇒ ⇒ the back button of the browser
  // ⭐⭐⭐ M-127 returns to the list (and not out of the page).
  if (changed && !options.fromHistory) pushConversation(ref);

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

  // ⭐⭐ D-073: the ticket of this conversation.
  // ⭐ The link carries the conversation and the customer ⇒ ⭐⭐ the
  //   page of the tickets opens with the form ready (the customer and
  //   the conversation are already chosen) ⇒ ⭐⭐ and the SERVER is
  //   the one that checks the right to create it.
  const ticketLink = $('link-ticket');
  if (typeof customerId === 'string' && customerId.length > 0) {
    const params = new URLSearchParams({
      customer: customerId,
      conversation: String(conversation.ref ?? ''),
    });
    ticketLink.hidden = false;
    ticketLink.href = `/ui/tickets.html?${params.toString()}`;
  } else {
    ticketLink.hidden = true;
    ticketLink.href = '#';
  }

  // ⭐⭐⭐ M-125: ⭐⭐⭐ the small screen shows the conversation IN THE
  // ⭐⭐⭐ M-125 PLACE of the list ⇒ ⇒ ⇒ (the list is one scroll
  // ⭐⭐⭐ M-125 away ⇒ ⇒ ⇒ and «رجوع» brings it back).
  if (isSmallScreen()) {
    const scroller = $('conversation-list');
    state.listScroll = scroller ? scroller.scrollTop : 0;
    setThreadView(true);
    window.scrollTo(0, 0);
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

/**
 * ⭐⭐⭐ M-125: ⭐⭐⭐ the rights of the core on the screen ⇒ ⇒ ⇒ (the
 * ⭐⭐⭐ M-125 employee who may only READ sees a NOTE ⇒ ⇒ ⇒ and not a
 * ⭐⭐⭐ M-125 composer he may not use ⇒ ⇒ ⇒).
 */
function renderRights() {
  const composer = $('composer');
  const note = $('readonly-note');
  if (composer) composer.hidden = !state.mayReply;
  if (note) note.hidden = state.mayReply;
  // ⭐⭐⭐ M-130: ⭐⭐⭐ the quick replies are a part of the writing ⇒ ⇒ ⇒
  // ⭐⭐⭐ M-130 ⇒ ⇒ ⇒ the role that may only READ does not see them ⇒ ⇒ ⇒
  // ⭐⭐⭐ M-130 (the right of the core announces it ⇒ ⇒ ⇒ and the page
  // ⭐⭐⭐ M-130 never decides for itself).
  const quick = $('quick-replies');
  if (quick) quick.hidden = !state.mayReply;
  const stateField = $('state-select');
  if (stateField) {
    stateField.disabled = !state.mayChangeState;
    const label = stateField.closest('.field');
    if (label) label.hidden = !state.mayChangeState;
  }
  const assignField = $('assign-field');
  if (assignField) assignField.hidden = !state.mayAssign;
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
  // ⭐⭐⭐ M-125: ⭐⭐⭐ the right of the core decides ⇒ ⇒ ⇒ (not the
  // ⭐⭐⭐ M-125 fact that the list of the agents arrived).
  field.hidden = !state.mayAssign;
}

/**
 * ⭐⭐⭐ M-130: ⭐⭐⭐ the quick replies ⇒ ⇒ ⇒ (a small set of trial
 * ⭐⭐⭐ M-130 templates for the employee ⇒ ⇒ ⇒ ⇒ NO central management
 * ⭐⭐⭐ M-130 · NO storage of the templates · NO AI ⇒ ⇒ ⇒ ⇒ they live
 * ⭐⭐⭐ M-130 in the page itself ⇒ ⇒ ⇒ and the data is synthetic).
 */
const QUICK_REPLIES = [
  {
    id: 'welcome',
    label: 'ترحيب',
    text: 'أهلاً بيك! أنا هنا عشان أساعدك في طلبك — قولي بالظبط إيه اللي محتاجه.',
  },
  {
    id: 'more_details',
    label: 'طلب تفاصيل إضافية',
    text: 'عشان أقدر أساعدك صح، محتاج منك تفاصيل أكتر: رقم الطلب (لو موجود) · وقت الطلب · المشكلة اللي ظهرتلك بالظبط.',
  },
  {
    id: 'following_up',
    label: 'متابعة الطلب',
    text: 'طلبك اتسجّل عندنا وأنا بتابعه مع الفريق المسؤول — هرجعلك أول ما يتحدّث معاك.',
  },
  {
    id: 'closing',
    label: 'إغلاق الطلب',
    text: 'تمام، طلبك اتقفل وجاهز من عندنا. لو فيه أي حاجة تانية أنا موجود في أي وقت.',
  },
];

/**
 * ⭐⭐⭐ M-130 · M-132: ⭐⭐⭐ the template that waits for the confirmation
 * ⭐⭐⭐ M-132 is PER CONVERSATION ⇒ ⇒ ⇒ ⇒ (it is a map, like the drafts)
 * ⭐⭐⭐ M-132 ⇒ ⇒ ⇒ ⇒ a confirmation of conversation A can NEVER be
 * ⭐⭐⭐ M-132 pressed for conversation B ⇒ ⇒ ⇒ ⇒ and it is not lost
 * ⭐⭐⭐ M-132 ⇒ ⇒ ⇒ ⇒ (it waits for its own conversation).
 */
const pendingQuickReplies = new Map();

/** ⭐⭐⭐ M-130: the templates are drawn once (and they never send). */
function renderQuickReplies() {
  const list = $('quick-replies-list');
  if (!list) return;
  list.textContent = '';
  for (const template of QUICK_REPLIES) {
    const button = document.createElement('button');
    // ⭐⭐⭐ M-130: the button is NOT a submit ⇒ ⇒ ⇒ (choosing a
    // ⭐⭐⭐ M-130 template NEVER sends anything).
    button.type = 'button';
    button.className = 'ghost quick-reply';
    button.dataset.template = template.id;
    button.textContent = template.label;
    button.title = template.text;
    button.addEventListener('click', () => applyQuickReply(template));
    list.appendChild(button);
  }
}

/**
 * ⭐⭐⭐ M-130: ⭐⭐⭐ choosing a template puts its text in the composer
 * ⭐⭐⭐ M-130 ⇒ ⇒ ⇒ ⇒ it NEVER sends it by itself ⇒ ⇒ ⇒ ⇒ the employee
 * ⭐⭐⭐ M-130 edits it and sends it with his own hand.
 */
function applyQuickReply(template) {
  const ref = state.selected?.ref;
  // ⭐⭐⭐ M-130: the right of the core decides ⇒ ⇒ ⇒ (the page never
  // ⭐⭐⭐ M-130 decides for itself).
  if (!ref || !state.mayReply) return;
  const box = $('reply-body');
  if (!box) return;
  if (box.value.trim().length > 0) {
    // ⭐⭐⭐ M-130: ⭐⭐⭐ the text of the employee is NEVER replaced
    // ⭐⭐⭐ M-130 without a clear confirmation ⇒ ⇒ ⇒ ⇒ the question is
    // ⭐⭐⭐ M-130 asked and the answer is waited for.
    pendingQuickReplies.set(ref, { template });
    $('quick-replies-confirm').hidden = false;
    return;
  }
  writeQuickReply(ref, template);
}

/**
 * ⭐⭐⭐ M-130: ⭐⭐⭐ the text of the template goes into the composer
 * ⭐⭐⭐ M-130 ⇒ ⇒ ⇒ ⇒ and into the draft of THIS conversation ⇒ ⇒ ⇒
 * ⭐⭐⭐ M-130 ⇒ ⇒ ⇒ the reference of the reply is NOT touched ⇒ ⇒ ⇒
 * ⭐⭐⭐ M-130 (⇒ ⇒ ⇒ no repeated reference ⇒ ⇒ ⇒ ⇒ no lost reply).
 */
function writeQuickReply(ref, template) {
  const box = $('reply-body');
  if (!box) return;
  // ⭐⭐⭐ M-132: ⭐⭐⭐ the template belongs to ONE conversation ⇒ ⇒ ⇒ ⇒
  // ⭐⭐⭐ M-132 it is written in the composer ONLY when that very
  // ⭐⭐⭐ M-132 conversation is the one on the screen NOW ⇒ ⇒ ⇒ ⇒ ⇒ the
  // ⭐⭐⭐ M-132 template of conversation A NEVER replaces the draft of
  // ⭐⭐⭐ M-132 conversation B (the employee moved while the
  // ⭐⭐⭐ M-132 confirmation was on the screen).
  const open = state.selected?.ref === ref;
  draftOf(ref).text = template.text;
  pendingQuickReplies.delete(ref);
  const confirm = $('quick-replies-confirm');
  if (confirm) confirm.hidden = true;
  if (!open) {
    // ⭐⭐⭐ M-132: ⭐⭐⭐ the template is NOT lost ⇒ ⇒ ⇒ ⇒ it waits in
    // ⭐⭐⭐ M-132 the draft of ITS OWN conversation ⇒ ⇒ ⇒ ⇒ and the
    // ⭐⭐⭐ M-132 composer of the conversation on the screen is NOT
    // ⭐⭐⭐ M-132 touched at all.
    toast('القالب اتحفظ في مسودة محادثته هو — رجع ليها تشوفه.');
    return;
  }
  box.value = template.text;
  box.focus();
  toast('القالب اتكتب في المربع — عدّل اللي عايزه وابعت.');
}

/**
 * ⭐⭐⭐ M-132: ⭐⭐⭐ a pending confirmation belongs to the conversation
 * ⭐⭐⭐ M-132 that raised it ⇒ ⇒ ⇒ ⇒ it dies with that conversation ⇒
 * ⭐⭐⭐ M-132 ⇒ ⇒ ⇒ ⇒ and it can never be pressed for another one.
 */
function syncQuickReplyStrip() {
  const ref = state.selected?.ref;
  const waiting = ref ? pendingQuickReplies.get(ref) : null;
  const confirm = $('quick-replies-confirm');
  if (confirm) confirm.hidden = !waiting;
  return waiting;
}

/**
 * ⭐⭐⭐ M-126: ⭐⭐⭐ the state of the composer belongs to the
 * ⭐⭐⭐ M-126 conversation that is open ⇒ ⇒ ⇒ (the button of a reply
 * ⭐⭐⭐ M-126 that is in the air in ONE conversation does NOT lock the
 * ⭐⭐⭐ M-126 employee out of another one ⇒ ⇒ ⇒ ⇒ and it never stays
 * ⭐⭐⭐ M-126 locked after the answer of another conversation).
 */
function renderComposerState(ref) {
  if (!ref) return;
  if (state.selected?.ref !== ref) return; // ⭐⭐⭐ another conversation is open.
  const draft = draftOf(ref);
  const button = $('btn-send');
  if (!button) return;
  button.disabled = draft.sending;
  button.textContent = draft.sending ? 'جارٍ الإرسال…' : 'إرسال';
}

// ------------------------------------------------------------ the actions
/**
 * ⭐⭐⭐ M-126: ⭐⭐⭐ the reply belongs to the conversation it was
 * ⭐⭐⭐ M-126 written in ⇒ ⇒ ⇒ (the reference of the reply · the text
 * ⭐⭐⭐ M-126 of the composer · and the answer of the server ⇒ ⇒ ⇒
 * ⭐⭐⭐ M-126 ⇒ ⇒ ⇒ ALL of them belong to THAT conversation) ⇒ ⇒ ⇒
 * ⭐⭐⭐ M-126 ⇒ ⇒ ⇒ ⇒ the answer of one conversation NEVER clears
 * ⭐⭐⭐ M-126 the text of another one ⇒ ⇒ ⇒ nor reopens it ⇒ ⇒ ⇒
 * ⭐⭐⭐ M-126 nor reuses its reference (⇒ ⇒ ⇒ the server refuses the
 * ⭐⭐⭐ M-126 repeated reference ⇒ ⇒ ⇒ ⇒ the reply of the employee
 * ⭐⭐⭐ M-126 would be LOST).
 */
async function sendReply(event) {
  event.preventDefault();
  const ref = state.selected?.ref;
  if (!ref) {
    toast(ERROR_LABELS.body_required, true);
    return;
  }
  const draft = draftOf(ref);
  // ⭐⭐⭐ M-126: the guard is per conversation ⇒ ⇒ ⇒ (a reply that is
  // ⭐⭐⭐ M-126 in the air in one conversation does NOT block another).
  if (draft.sending) return;
  const body = $('reply-body').value.trim();
  if (!body) {
    toast(ERROR_LABELS.body_required, true);
    return;
  }
  // ⭐⭐ The reference is prepared once and kept until the answer
  //   arrives: a retry of the same reply is refused by the server, so
  //   the message can never be stored twice.
  // ⭐⭐⭐ M-126: ⭐⭐⭐ and it belongs to THIS conversation alone.
  if (!draft.messageRef) draft.messageRef = newDraftRef();
  const messageRef = draft.messageRef;
  const epoch = state.epoch;
  draft.sending = true;
  renderComposerState(ref);

  const answer = await api('POST', `/api/inbox/conversations/${encodeURIComponent(ref)}/replies`, {
    body,
    client_message_ref: messageRef,
  });

  draft.sending = false;
  // ⭐⭐⭐ M-126: ⭐⭐⭐ the button belongs to the conversation that is
  // ⭐⭐⭐ M-126 on the screen NOW ⇒ ⇒ ⇒ (the answer of a reply that
  // ⭐⭐⭐ M-126 is in the air does not touch the composer of another
  // ⭐⭐⭐ M-126 conversation).
  renderComposerState(ref);
  // ⭐⭐⭐ M-127: the session changed while the reply was in the air ⇒
  // ⭐⭐⭐ M-127 the answer belongs to a session that does not exist ⇒
  // ⭐⭐⭐ M-127 it is dropped (and nothing is painted).
  if (epoch !== state.epoch || answer.stale) return;

  // ⭐⭐⭐ M-126: ⭐⭐⭐ is THIS conversation still the one on the
  // ⭐⭐⭐ M-126 screen? ⇒ ⇒ ⇒ (if the employee moved to another one
  // ⭐⭐⭐ M-126 ⇒ ⇒ ⇒ the answer must NOT touch the screen).
  const stillOpen = state.selected?.ref === ref;

  if (!answer.ok) {
    // ⭐⭐⭐ M-80: the answer was LOST. ⭐ The failure is NOT declared
    //   before the result is verified in the database ⇒ ⭐ the employee
    //   is never told «it failed» while the message is stored.
    // ⭐⭐⭐ M-80: the outcome is UNKNOWN when the connection died (0)
    //   or when the server failed AFTER the write (5xx) ⇒ ⭐ the result
    //   is verified before any failure is declared.
    if (answer.status === 0 || answer.status >= 500) {
      const stored = await verifyStoredReply(ref, messageRef);
      // ⭐⭐⭐ M-133: ⭐⭐⭐ the verification takes TIME ⇒ ⇒ ⇒ ⇒ the
      // ⭐⭐⭐ M-133 employee may have moved to another conversation
      // ⭐⭐⭐ M-133 while it was in the air ⇒ ⇒ ⇒ ⇒ ⭐⭐⭐ the flag of
      // ⭐⭐⭐ M-133 the screen is READ AGAIN now ⇒ ⇒ ⇒ ⇒ (the old one
      // ⭐⭐⭐ M-133 was frozen before the wait ⇒ ⇒ ⇒ ⇒ and it lied).
      // ⭐⭐⭐ M-133: ⭐⭐⭐ a late answer NEVER touches a conversation
      // ⭐⭐⭐ M-133 that is not its own ⇒ ⇒ ⇒ ⇒ it does not clear the
      // ⭐⭐⭐ M-133 composer of another one ⇒ ⇒ ⇒ ⇒ and it does not
      // ⭐⭐⭐ M-133 pull the employee back to the old one.
      const stillOpenNow = state.selected?.ref === ref;
      const epochNow = state.epoch;
      // ⭐⭐⭐ M-133: ⭐⭐⭐ the session died while the verification was
      // ⭐⭐⭐ M-133 in the air ⇒ ⇒ ⇒ ⇒ nothing is painted at all.
      if (epochNow !== state.epoch) return;
      if (stored) {
        draft.messageRef = null;
        draft.text = '';
        if (stillOpenNow) $('reply-body').value = '';
        toast('الرد اتحفظ — الشبكة وقعت قبل ما يوصل التأكيد. مش محتاج تبعت تاني.');
        if (stillOpenNow) await openConversation(ref);
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
      draft.messageRef = null;
      draft.text = '';
      if (stillOpen) $('reply-body').value = '';
      toast('الرد كان متحفظ من قبل — مش تكرار.');
      if (stillOpen) await openConversation(ref);
      return;
    }
    toast(errorMessage(answer.body, 'تعذّر إرسال الرد.'), true);
    // ⭐ The reference is kept: a retry sends the SAME reply and the
    //   server refuses the duplicate instead of storing it twice.
    return;
  }
  // ⭐⭐⭐ M-126: ⭐⭐⭐ the reply of THIS conversation is done ⇒ ⇒ ⇒
  // ⭐⭐⭐ M-126 ⇒ ⇒ ⇒ its draft is cleared (and only its draft) ⇒ ⇒ ⇒
  // ⭐⭐⭐ M-126 ⇒ ⇒ ⇒ and the screen is refreshed ONLY if this
  // ⭐⭐⭐ M-126 conversation is still the one on the screen ⇒ ⇒ ⇒ ⇒
  // ⭐⭐⭐ M-126 the employee is never pulled back to another one.
  draft.messageRef = null;
  draft.text = '';
  if (stillOpen) $('reply-body').value = '';
  toast('تم إرسال الرد وحفظه.');
  if (stillOpen) await openConversation(ref);
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
  // ⭐⭐⭐ M-127: ⭐⭐⭐ the answer of an OLD session is dropped ⇒ ⇒ ⇒ ⇒
  // ⭐⭐⭐ M-127 the conversation of the old company is NEVER reopened
  // ⭐⭐⭐ M-127 after the session changed.
  if (answer.stale) return;
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
  // ⭐⭐⭐ M-127: the answer of an old session is dropped.
  if (answer.stale) return;
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
  // ⭐⭐⭐ M-127: ⭐⭐⭐ a new session ⇒ ⇒ ⇒ ⇒ every answer that is in
  // ⭐⭐⭐ M-127 the air of the OLD session is dropped ⇒ ⇒ ⇒ ⇒ the data
  // ⭐⭐⭐ M-127 of the old company NEVER lands under the new one.
  state.epoch += 1;
  state.drafts.clear();
  // ⭐⭐⭐ M-132: ⭐⭐⭐ the confirmations die with the session too.
  pendingQuickReplies.clear();
  state.retry = null;
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
  // ⭐⭐⭐ M-127: ⭐⭐⭐ the search that waits is cancelled ⇒ ⇒ ⇒ (it
  // ⭐⭐⭐ M-127 must not land on a session that is over) ⇒ ⇒ ⇒ and the
  // ⭐⭐⭐ M-127 answers that are in the air are dropped ⇒ ⇒ ⇒ ⇒ the
  // ⭐⭐⭐ M-127 data of the old company NEVER comes back.
  cancelPendingSearch();
  state.epoch += 1;
  state.retry = null;
  // ⭐⭐⭐ M-126: the drafts die with the session.
  state.drafts.clear();
  // ⭐⭐⭐ M-132: ⭐⭐⭐ the confirmations die with the session too.
  pendingQuickReplies.clear();
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
  // ⭐⭐⭐ M-127: ⭐⭐⭐ the page that changes CANCELS the search that
  // ⭐⭐⭐ M-127 waits ⇒ ⇒ ⇒ ⇒ the search of the old text never comes
  // ⭐⭐⭐ M-127 back and takes the employee to the first page.
  cancelPendingSearch();
  state.page -= 1;
  void loadConversations();
});
$('btn-next').addEventListener('click', () => {
  // ⭐⭐⭐ M-127: the page that changes cancels the waiting search.
  cancelPendingSearch();
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
// ⭐⭐⭐ M-130: ⭐⭐⭐ the confirmation of the replacement ⇒ ⇒ ⇒ (the
// ⭐⭐⭐ M-130 text of the employee is replaced ONLY when he says so).
$('btn-quick-replace').addEventListener('click', () => {
  // ⭐⭐⭐ M-132: ⭐⭐⭐ the button applies to the conversation that is on
  // ⭐⭐⭐ M-132 the screen NOW ⇒ ⇒ ⇒ ⇒ and it uses the template that
  // ⭐⭐⭐ M-132 waits for THAT conversation ⇒ ⇒ ⇒ ⇒ ⇒ a template of
  // ⭐⭐⭐ M-132 conversation A can never replace the text of
  // ⭐⭐⭐ M-132 conversation B (⇒ ⇒ ⇒ ⇒ even if the button is pressed
  // ⭐⭐⭐ M-132 by force).
  const ref = state.selected?.ref;
  const waiting = ref ? pendingQuickReplies.get(ref) : null;
  if (!waiting) {
    const confirm = $('quick-replies-confirm');
    if (confirm) confirm.hidden = true;
    return;
  }
  writeQuickReply(ref, waiting.template);
});
$('btn-quick-keep').addEventListener('click', () => {
  const ref = state.selected?.ref;
  if (ref) pendingQuickReplies.delete(ref);
  const confirm = $('quick-replies-confirm');
  if (confirm) confirm.hidden = true;
});
$('state-select').addEventListener('change', () => {
  void changeState();
});
$('assign-select').addEventListener('change', () => {
  void changeAssignee();
});
// ⭐⭐⭐ M-125: ⭐⭐⭐ «رجوع» brings the LIST back (with its search
// ⭐⭐⭐ M-125 and its place) ⇒ ⇒ ⇒ (and it is the same on the big
// ⭐⭐⭐ M-125 screen ⇒ ⇒ ⇒ the two screens behave the same).
$('btn-back').addEventListener('click', () => {
  closeThread();
});
/**
 * ⭐⭐⭐ M-127: ⭐⭐⭐ the browser's back button ⇒ ⇒ ⇒ ⇒ the conversation
 * ⭐⭐⭐ M-127 goes back to the list (and NOT out of the page) ⇒ ⇒ ⇒
 * ⭐⭐⭐ M-127 ⇒ ⇒ ⇒ and it comes back to the conversation that was
 * ⭐⭐⭐ M-127 open before it ⇒ ⇒ ⇒ ⇒ the address of the page and the
 * ⭐⭐⭐ M-127 screen always agree.
 */
window.addEventListener('popstate', () => {
  const wanted = conversationInUrl();
  if (wanted) {
    if (state.selected?.ref !== wanted) {
      void openConversation(wanted, { fromHistory: true });
    }
    return;
  }
  if (state.selected) closeThread({ fromHistory: true });
});
// ⭐⭐⭐ M-125: ⭐⭐⭐ the retry of the connection that is gone.
$('btn-retry-offline').addEventListener('click', () => {
  setOffline(false);
  const retry = state.retry;
  state.retry = null;
  if (retry) void retry();
  else void loadConversations();
});
// ⭐⭐⭐ M-125: ⭐⭐⭐ the browser says that the connection is gone (or
// ⭐⭐⭐ M-125 is back).
window.addEventListener('offline', () => {
  setOffline(true);
});
window.addEventListener('online', () => {
  setOffline(false);
  const retry = state.retry;
  state.retry = null;
  if (retry) void retry();
  else void loadConversations();
});
let searchTimer = null;
$('filter-query').addEventListener('input', () => {
  // ⭐⭐⭐ M-127: ⭐⭐⭐ the answer of the OLD search is dropped AT ONCE
  // ⭐⭐⭐ M-127 ⇒ ⇒ ⇒ ⇒ the old list never lands under the new text
  // ⭐⭐⭐ M-127 ⇒ ⇒ ⇒ (not even inside the waiting window before the
  // ⭐⭐⭐ M-127 new search is sent).
  invalidateChannel('list');
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    searchTimer = null;
    void loadConversations({ resetPage: true });
  }, 250);
});
$('filter-state').addEventListener('change', () => {
  // ⭐⭐⭐ M-125: ⭐⭐⭐ a filter that changes CANCELS the pending
  // ⭐⭐⭐ M-125 search ⇒ ⇒ ⇒ (the search of the old text never
  // ⭐⭐⭐ M-125 lands on the new filter).
  // ⭐⭐⭐ M-127: and the answer that is in the air is dropped too.
  cancelPendingSearch();
  void loadConversations({ resetPage: true });
});
$('filter-assignee').addEventListener('change', () => {
  // ⭐⭐⭐ M-127: a filter that changes cancels the waiting search.
  cancelPendingSearch();
  void loadConversations({ resetPage: true });
});
void bootSession();
/**
 * ⭐⭐⭐ M-130: ⭐⭐⭐ the templates of the quick replies are drawn once
 * ⭐⭐⭐ M-130 ⇒ ⇒ ⇒ (they never send anything by themselves).
 */
renderQuickReplies();
/**
 * ⭐⭐ D-071: the page comes back with the session of the tab.
 * ⭐ The token is checked by the SERVER (the first call decides) ⇒
 *   ⭐ a token that is over sends the employee back to the login.
 */
async function bootSession() {
  if (!restoreSession()) return;
  // ⭐⭐⭐ M-127: ⭐⭐⭐ the state of the list comes back as it was ⇒ ⇒ ⇒
  // ⭐⭐⭐ M-127 (the search · the filters · the page · the place).
  loadListViewFromStorage();
  restoreListView();
  $('login-row').hidden = true;
  $('who').hidden = false;
  $('who-name').textContent = state.userId;
  $('who-role').textContent = STATE_LABELS[state.role] ?? state.role;
  $('workspace').hidden = false;
  $('assignee-filter-field').hidden = state.role === 'agent';
  // ⭐⭐⭐ M-127: ⭐⭐⭐ the page of the list comes back as it was ⇒ ⇒ ⇒
  // ⭐⭐⭐ M-127 (the page is NOT reset ⇒ ⇒ ⇒ the employee comes back
  // ⭐⭐⭐ M-127 to the same place).
  await loadConversations();
  // ⭐⭐⭐ M-127: ⭐⭐⭐ the session is over ONLY when the SERVER says so
  // ⭐⭐⭐ M-127 (401 / 403) ⇒ ⇒ ⇒ ⇒ an EMPTY list (⇒ ⇒ ⇒ a search
  // ⭐⭐⭐ M-127 that matches nothing ⇒ ⇒ ⇒ ⇒ or a company without
  // ⭐⭐⭐ M-127 conversations) ⇒ ⇒ ⇒ ⇒ is NOT a logout ⇒ ⇒ ⇒ ⇒ ⇒ the
  // ⭐⭐⭐ M-127 employee is NEVER thrown out of his session by his own
  // ⭐⭐⭐ M-127 search.
  if (state.listStatus === 401 || state.listStatus === 403) {
    await logout();
    return;
  }
  // ⭐⭐⭐ M-131: ⭐⭐⭐ the session ends ONLY when the SERVER says so
  // ⭐⭐⭐ M-131 (401 / 403) ⇒ ⇒ ⇒ ⇒ an EMPTY list (⇒ ⇒ ⇒ a company that
  // ⭐⭐⭐ M-131 has no conversations ⇒ ⇒ ⇒ ⇒ or a search that matches
  // ⭐⭐⭐ M-131 nothing) ⇒ ⇒ ⇒ ⇒ is NOT a logout ⇒ ⇒ ⇒ ⇒ and a network
  // ⭐⭐⭐ M-131 that died (status 0) ⇒ ⇒ ⇒ ⇒ is NOT a logout either ⇒
  // ⭐⭐⭐ M-131 ⇒ ⇒ ⇒ ⇒ the employee is NEVER thrown out of a VALID
  // ⭐⭐⭐ M-131 session by an empty page.
  // ⭐⭐⭐ M-131: ⭐⭐⭐ the rule (general): ⭐⭐⭐ the DECISION comes from
  // ⭐⭐⭐ M-131 the state of the ANSWER ⇒ ⇒ ⇒ ⇒ never from the absence
  // ⭐⭐⭐ M-131 of data.
  // ⭐⭐ D-071: the CRM points at a conversation ⇒ the inbox opens it.
  const wanted = new URLSearchParams(window.location.search).get('conversation');
  if (wanted) {
    await openConversation(wanted, { fromHistory: true });
    // ⭐⭐⭐ M-127: ⭐⭐⭐ the address of the page comes back to the
    // ⭐⭐⭐ M-127 list ⇒ ⇒ ⇒ ⇒ the back button of the browser leaves
    // ⭐⭐⭐ M-127 the page (the employee came from another page) ⇒ ⇒ ⇒
    // ⭐⭐⭐ M-127 and it does NOT push an entry of its own.
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

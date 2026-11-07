// WASL AI - Foundation Build 01 - local journey console
// The console calls the REAL local API (127.0.0.1). It is not a preview:
// every button performs a request that reaches PostgreSQL.
'use strict';

// ⭐⭐ D-072 / M-82: the console may drive ANY company ⇐ ⭐⭐ a test
//   file that owns a namespaced company drives ITS company through the
//   real browser ⇐ ⭐⭐ the browser drill never touches the default one.
//   ⛔ Without a parameter the console behaves exactly as before.
const query = new URLSearchParams(window.location.search);
const param = (name, fallback) => {
  const value = query.get(name);
  return typeof value === 'string' && value.length > 0 ? value : fallback;
};

const state = {
  token: null,
  tenantId: param('tenant', 'tnt_alpha'),
  userId: param('user', 'usr_alpha_owner'),
  agentId: param('agent', 'usr_alpha_agent'),
  otherTenantId: param('otherTenant', 'tnt_beta'),
  otherUserId: param('otherUser', 'usr_beta_owner'),
  passcode: 'wasl-local-test',
  customerId: null,
  conversationRef: null,
};

const $ = (id) => document.getElementById(id);

function log(target, value) {
  const node = $(target);
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  node.textContent = `${text}\n`;
}

async function api(method, path, body, token) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }
  return { status: response.status, body: parsed };
}

function setLoggedIn(on) {
  for (const id of [
    'btn-logout',
    'btn-customer',
    'btn-conversation',
    'btn-message',
    'btn-open',
    'btn-assign',
    'btn-resolved',
    'btn-closed',
    'btn-illegal',
    'btn-changes',
    'btn-audit',
    'btn-export',
    'btn-retention',
    'btn-preview',
    'btn-cross',
  ]) {
    $(id).disabled = !on;
  }
  $('btn-login').disabled = on;
}

// ⭐⭐ The selects carry the fixed list of the default companies ⇐ ⭐⭐ the
//   option of the company under test is added ⇐ ⭐⭐ the page shows the
//   company it really drives.
function selectValue(selectId, value) {
  const select = $(selectId);
  if (!select) return;
  const known = Array.from(select.options).some((option) => option.value === value);
  if (!known) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  }
  select.value = value;
}
selectValue('tenant', state.tenantId);
selectValue('user', state.userId);

$('tenant').addEventListener('change', (event) => {
  state.tenantId = event.target.value;
});
$('user').addEventListener('change', (event) => {
  state.userId = event.target.value;
});
$('passcode').addEventListener('change', (event) => {
  state.passcode = event.target.value;
});

$('btn-login').addEventListener('click', async () => {
  const result = await api('POST', '/api/session', {
    tenant_id: state.tenantId,
    user_id: state.userId,
    passcode: state.passcode,
  });
  log('out-session', result);
  if (result.status === 200 && typeof result.body.token === 'string') {
    state.token = result.body.token;
    setLoggedIn(true);
  } else {
    setLoggedIn(false);
  }
});

$('btn-logout').addEventListener('click', async () => {
  const result = await api('DELETE', '/api/session', undefined, state.token);
  log('out-session', result);
  state.token = null;
  setLoggedIn(false);
});

$('btn-customer').addEventListener('click', async () => {
  state.customerId = `cus_ui_${Date.now().toString(36)}`;
  const result = await api(
    'POST',
    '/api/customers',
    { id: state.customerId, display_name: 'Console Customer', data_class: 'sensitive' },
    state.token,
  );
  log('out-journey', result);
});

$('btn-conversation').addEventListener('click', async () => {
  state.conversationRef = `conv_ui_${Date.now().toString(36)}`;
  const result = await api(
    'POST',
    '/api/conversations',
    {
      conversation_ref: state.conversationRef,
      customer_id: state.customerId,
      message: { body: 'My invoice is wrong, I was charged twice this month.' },
    },
    state.token,
  );
  log('out-journey', result);
});

$('btn-message').addEventListener('click', async () => {
  const result = await api(
    'POST',
    `/api/conversations/${encodeURIComponent(state.conversationRef ?? '')}/messages`,
    { body: 'Also, where is my order? It was due three days ago.' },
    state.token,
  );
  log('out-journey', result);
});

async function transition(to, reason) {
  const result = await api(
    'POST',
    `/api/conversations/${encodeURIComponent(state.conversationRef ?? '')}/state`,
    { to, reason },
    state.token,
  );
  log('out-journey', result);
}

$('btn-open').addEventListener('click', () => transition('open', 'triaged in the console'));
$('btn-resolved').addEventListener('click', () => transition('resolved', 'handled in the console'));
$('btn-closed').addEventListener('click', () => transition('closed', 'closed in the console'));

$('btn-illegal').addEventListener('click', async () => {
  const result = await api(
    'POST',
    `/api/conversations/${encodeURIComponent(state.conversationRef ?? '')}/state`,
    { to: 'closed' },
    state.token,
  );
  log('out-journey', result);
});

$('btn-assign').addEventListener('click', async () => {
  const result = await api(
    'POST',
    `/api/conversations/${encodeURIComponent(state.conversationRef ?? '')}/assign`,
    { actor_id: state.agentId, reason: 'assigned in the console' },
    state.token,
  );
  log('out-journey', result);
});

$('btn-changes').addEventListener('click', async () => {
  const result = await api(
    'GET',
    `/api/conversations/${encodeURIComponent(state.conversationRef ?? '')}/changes`,
    undefined,
    state.token,
  );
  log('out-evidence', result);
});

$('btn-audit').addEventListener('click', async () => {
  const result = await api('GET', '/api/audit', undefined, state.token);
  log('out-evidence', result);
});

$('btn-export').addEventListener('click', async () => {
  const result = await api('POST', '/api/privacy/export', {}, state.token);
  log('out-evidence', result);
});

$('btn-retention').addEventListener('click', async () => {
  const result = await api('GET', '/api/retention', undefined, state.token);
  log('out-evidence', result);
});

$('btn-preview').addEventListener('click', async () => {
  const result = await api('POST', '/api/privacy/deletion/preview', { scope: 'tenant_data' }, state.token);
  log('out-evidence', result);
});

$('btn-cross').addEventListener('click', async () => {
  const login = await api('POST', '/api/session', {
    tenant_id: state.otherTenantId,
    user_id: state.otherUserId,
    passcode: state.passcode,
  });
  if (login.status !== 200) {
    log('out-evidence', login);
    return;
  }
  const otherToken = login.body.token;
  const result = await api(
    'GET',
    `/api/conversations/${encodeURIComponent(state.conversationRef ?? '')}`,
    undefined,
    otherToken,
  );
  log('out-evidence', {
    note: 'another company tried to read this conversation',
    status: result.status,
    body: result.body,
  });
});

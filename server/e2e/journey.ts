// ============================================================
// WASL AI — FOUNDATION BUILD 01 — end to end journey
// ------------------------------------------------------------
// ⭐ The journey travels through the HTTP API and PostgreSQL:
//   no in-process shortcut, no mocked storage.
// ⭐ Each step records what happened, so a failure is visible.
// ⛔ Synthetic data only. No external service is contacted.
// ============================================================

import { LocalApiClient } from './http-client.ts';

export interface JourneyStep {
  readonly step: number;
  readonly title: string;
  readonly expected: string;
  readonly status: number;
  readonly ok: boolean;
  readonly detail: string;
}

export interface JourneyReport {
  readonly ok: boolean;
  readonly steps: readonly JourneyStep[];
  readonly failures: readonly string[];
  readonly tenantId: string;
  readonly conversationRef: string;
}

export interface JourneyOptions {
  readonly client: LocalApiClient;
  readonly tenantId?: string;
  readonly userId?: string;
  readonly passcode: string;
  readonly conversationRef?: string;
  // ⭐⭐ D-072 / M-82: the journey reaches three ids that used to be
  //   written in the code. ⭐ A test file that owns a NAMESPACED company
  //   needs ITS employee and ITS other company ⇒ ⭐⭐ the options below
  //   make the journey a fixture that follows the caller.
  //   ⛔ Without them the behaviour is exactly as before.
  readonly assigneeActorId?: string;
  readonly otherTenantId?: string;
  readonly otherUserId?: string;
  readonly customerIdPrefix?: string;
}

function errorCode(body: Record<string, unknown>): string {
  const error = body['error'];
  if (typeof error === 'object' && error !== null) {
    const code = (error as Record<string, unknown>)['code'];
    if (typeof code === 'string') return code;
  }
  return 'unknown_error';
}

export async function runJourney(options: JourneyOptions): Promise<JourneyReport> {
  const client = options.client;
  const tenantId = options.tenantId ?? 'tnt_alpha';
  const userId = options.userId ?? 'usr_alpha_owner';
  const passcode = options.passcode;
  const conversationRef = options.conversationRef ?? `conv_e2e_${Date.now().toString(36)}`;
  // ⭐⭐ The three ids the journey used to hardcode ⇒ they follow the caller.
  const assigneeActorId = options.assigneeActorId ?? 'usr_alpha_agent';
  const otherTenantId = options.otherTenantId ?? 'tnt_beta';
  const otherUserId = options.otherUserId ?? 'usr_beta_owner';
  const customerIdPrefix = options.customerIdPrefix ?? 'cus_e2e';
  const steps: JourneyStep[] = [];
  const failures: string[] = [];

  const record = (step: number, title: string, expected: string, status: number, ok: boolean, detail: string): void => {
    steps.push({ step, title, expected, status, ok, detail });
    if (!ok) failures.push(`${step}. ${title}: ${detail}`);
  };

  // 1) login
  const login = await client.request({
    method: 'POST',
    path: '/api/session',
    payload: { tenant_id: tenantId, user_id: userId, passcode },
  });
  const token = typeof login.body['token'] === 'string' ? (login.body['token'] as string) : null;
  record(1, 'login creates a session', '200 + token', login.status, login.status === 200 && token !== null,
    token ? 'session created' : errorCode(login.body));
  if (!token) {
    return { ok: false, steps, failures, tenantId, conversationRef };
  }

  // 2) who am I
  const who = await client.request({ path: '/api/session', token });
  const session = who.body['session'] as Record<string, unknown> | undefined;
  record(2, 'session resolves to a membership', '200 + role from the database', who.status,
    who.status === 200 && typeof session?.['role'] === 'string',
    session ? `role=${String(session['role'])}` : errorCode(who.body));

  // 3) create the customer
  const customerId = `${customerIdPrefix}_${Date.now().toString(36)}`;
  const customer = await client.request({
    method: 'POST',
    path: '/api/customers',
    token,
    payload: { id: customerId, display_name: 'E2E Customer', data_class: 'sensitive' },
  });
  record(3, 'create a synthetic customer', '201', customer.status, customer.status === 201,
    customer.status === 201 ? customerId : errorCode(customer.body));

  // 4) create the conversation with its first message
  const created = await client.request({
    method: 'POST',
    path: '/api/conversations',
    token,
    payload: {
      conversation_ref: conversationRef,
      customer_id: customerId,
      message: { body: 'My invoice is wrong, I was charged twice this month.' },
    },
  });
  record(4, 'create a conversation with a first message', '201', created.status, created.status === 201,
    created.status === 201 ? conversationRef : errorCode(created.body));

  // 5) send a message and get the local classification + the stored reply
  const appended = await client.request({
    method: 'POST',
    path: `/api/conversations/${encodeURIComponent(conversationRef)}/messages`,
    token,
    payload: { body: 'Also, where is my order? It was due three days ago.' },
  });
  const classification = appended.body['classification'] as Record<string, unknown> | undefined;
  const reply = appended.body['reply'] as Record<string, unknown> | undefined;
  record(5, 'message is classified by the local rules and the reply is stored but not sent',
    '201 + intent + reply + reply_sent=false', appended.status,
    appended.status === 201 && typeof classification?.['intent'] === 'string' && reply !== null && appended.body['reply_sent'] === false,
    appended.status === 201 ? `intent=${String(classification?.['intent'])} sent=${String(appended.body['reply_sent'])}` : errorCode(appended.body));

  // 6) open the conversation
  const opened = await client.request({
    method: 'POST',
    path: `/api/conversations/${encodeURIComponent(conversationRef)}/state`,
    token,
    payload: { to: 'open', reason: 'triaged by the local journey' },
  });
  record(6, 'transition new -> open', '200', opened.status, opened.status === 200, errorCode(opened.body));

  // 7) assign it to an employee
  const assigned = await client.request({
    method: 'POST',
    path: `/api/conversations/${encodeURIComponent(conversationRef)}/assign`,
    token,
    payload: { actor_id: assigneeActorId, reason: 'billing case' },
  });
  record(7, 'assign the conversation to an employee', '200', assigned.status, assigned.status === 200, errorCode(assigned.body));

  // 8) an illegal transition is refused
  const illegal = await client.request({
    method: 'POST',
    path: `/api/conversations/${encodeURIComponent(conversationRef)}/state`,
    token,
    payload: { to: 'closed' },
  });
  record(8, 'an illegal transition is refused', '409 + transition_not_allowed', illegal.status,
    illegal.status === 409 && errorCode(illegal.body).includes('transition_not_allowed'),
    errorCode(illegal.body));

  // 9) the legal path to closed
  await client.request({
    method: 'POST',
    path: `/api/conversations/${encodeURIComponent(conversationRef)}/state`,
    token,
    payload: { to: 'resolved', reason: 'handled' },
  });
  const closed = await client.request({
    method: 'POST',
    path: `/api/conversations/${encodeURIComponent(conversationRef)}/state`,
    token,
    payload: { to: 'closed', reason: 'resolved by the local journey' },
  });
  record(9, 'the legal path closes the conversation (resolved -> closed)', '200', closed.status,
    closed.status === 200, errorCode(closed.body));

  // 10) a closed conversation is terminal
  const afterClose = await client.request({
    method: 'POST',
    path: `/api/conversations/${encodeURIComponent(conversationRef)}/state`,
    token,
    payload: { to: 'open' },
  });
  record(10, 'a closed conversation refuses every further change', '409 + terminal', afterClose.status,
    afterClose.status === 409, errorCode(afterClose.body));

  // 11) the change log
  const changes = await client.request({
    path: `/api/conversations/${encodeURIComponent(conversationRef)}/changes`,
    token,
  });
  const changeRows = Array.isArray(changes.body['changes']) ? (changes.body['changes'] as unknown[]) : [];
  record(11, 'the change log records every transition', '200 + at least 3 entries', changes.status,
    changes.status === 200 && changeRows.length >= 3, `entries=${changeRows.length}`);

  // 12) the audit trail
  const audit = await client.request({ path: '/api/audit', token });
  const auditRows = Array.isArray(audit.body['audit']) ? (audit.body['audit'] as unknown[]) : [];
  record(12, 'the audit trail is readable and non empty', '200 + entries', audit.status,
    audit.status === 200 && auditRows.length > 0, `entries=${auditRows.length}`);

  // 13) another company cannot see the data
  const otherLogin = await client.request({
    method: 'POST',
    path: '/api/session',
    payload: { tenant_id: otherTenantId, user_id: otherUserId, passcode },
  });
  const otherToken = typeof otherLogin.body['token'] === 'string' ? (otherLogin.body['token'] as string) : null;
  let crossTenantDenied = false;
  let crossDetail = 'login failed';
  if (otherToken) {
    const cross = await client.request({
      path: `/api/conversations/${encodeURIComponent(conversationRef)}`,
      token: otherToken,
    });
    crossTenantDenied = cross.status === 404 || cross.status === 403;
    crossDetail = `status=${cross.status} ${errorCode(cross.body)}`;
    const crossList = await client.request({ path: '/api/conversations', token: otherToken });
    const list = Array.isArray(crossList.body['conversations']) ? (crossList.body['conversations'] as Array<Record<string, unknown>>) : [];
    const leaked = list.some((row) => row['ref'] === conversationRef);
    if (leaked) {
      crossTenantDenied = false;
      crossDetail = 'the conversation leaked into the other tenant list';
    }
  }
  record(13, 'another company cannot read the conversation', '404/403 and no leak', 0,
    crossTenantDenied, crossDetail);

  // 14) the export
  const exported = await client.request({ method: 'POST', path: '/api/privacy/export', token });
  const exportBundle = exported.body['export'] as Record<string, unknown> | undefined;
  const exportedMessages = Array.isArray(exportBundle?.['messages']) ? (exportBundle['messages'] as unknown[]) : [];
  record(14, 'the tenant can export its own data', '200 + messages', exported.status,
    exported.status === 200 && exportedMessages.length > 0, `messages=${exportedMessages.length}`);

  // 15) the deletion preview (no execution yet)
  const preview = await client.request({
    method: 'POST',
    path: '/api/privacy/deletion/preview',
    token,
    payload: { scope: 'tenant_data' },
  });
  const previewBody = preview.body['preview'] as Record<string, unknown> | undefined;
  const counts = previewBody?.['counts'] as Record<string, number> | undefined;
  record(15, 'the deletion preview shows the impact without deleting', '200 + counts', preview.status,
    preview.status === 200 && counts !== undefined && (counts['messages'] ?? 0) > 0,
    counts ? `messages=${counts['messages'] ?? 0}` : errorCode(preview.body));

  return { ok: failures.length === 0, steps, failures, tenantId, conversationRef };
}

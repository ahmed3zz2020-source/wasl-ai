// ============================================================
// WASL AI — FOUNDATION BUILD 03 / PHASE 01 (D-070)
// the read paths of the customer inbox
// ------------------------------------------------------------
// ⭐ WHAT THIS MODULE IS
//   The queries that fill the inbox: the list of the conversations of
//   a company with the name of the customer and the last message, the
//   detail of one conversation, and the list of the employees that a
//   conversation may be assigned to.
// ⭐ IT DOES NOT DECIDE ANYTHING
//   ⭐ The decision (who may read, who may write, who may assign) is
//     taken by the CORE, exactly like everywhere else in the server.
//   ⭐ This module only moves the rows of the tenant of the context.
// ⛔ It never accepts a tenant id from the client: the tenant comes
//   from the trusted context, and the row level security of the tables
//   is the second wall.
// ⛔ The scope of the ROLE is applied here, and it is the scope the
//   core already approved for the work queue (see `agent-queue.ts`):
//   ⭐ an AGENT sees the conversations that are assigned to them,
//   ⭐ the owner and the supervisor see the whole company,
//   ⭐ the viewer sees the company but may not change anything.
// ============================================================

import type { UnitOfWork } from '../db/unit-of-work.ts';

/** ⭐ The states the core knows (the closed list, never invented here). */
export const INBOX_STATES = [
  'new',
  'open',
  'assigned',
  'pending',
  'resolved',
  'closed',
] as const;

export type InboxState = (typeof INBOX_STATES)[number];

export function isInboxState(value: unknown): value is InboxState {
  return typeof value === 'string' && (INBOX_STATES as readonly string[]).includes(value);
}

/** ⭐ The filters of the list. Every one of them is optional. */
export interface InboxFilters {
  /** ⭐ A free text: the name of the customer, the reference, the body. */
  readonly query?: string;
  /** ⭐ One state of the core. */
  readonly state?: InboxState;
  /** ⭐ `me` · `unassigned` · the id of an employee. */
  readonly assignee?: string;
  /** ⭐ The employee that asks: the scope of an agent is applied. */
  readonly actorId: string;
  /** ⭐ The role of the employee that asks. */
  readonly role: string;
  readonly limit: number;
  readonly offset: number;
}

export interface InboxConversationRow {
  readonly ref: string;
  readonly customer_id: string | null;
  readonly customer_name: string | null;
  readonly state: string;
  readonly assignee_actor_id: string | null;
  readonly version: number;
  readonly updated_at: string;
  readonly last_message_body: string | null;
  readonly last_message_at: string | null;
  readonly last_message_direction: string | null;
  readonly message_count: number;
}

export interface InboxAgentRow {
  readonly actor_id: string;
  readonly display_name: string;
  readonly role: string;
}

/**
 * ⭐⭐⭐ The scope of the ROLE — the rule of the core work queue
 *   (`src/core/agent-queue.ts` · `scopeIsOwnOnly`): an AGENT reaches
 *   the conversations that are assigned to them, and nothing else.
 * ⭐⭐ M-76: the same rule is applied to EVERY path (the list, the
 *   detail and the reply) ⇒ ⭐ **a path can never be wider than the
 *   list** ⇒ ⭐ the agent cannot reach a conversation of another
 *   employee by its reference.
 * ⛔ It is a READ of the rule of the core, not a new rule: the owner
 *   and the supervisor still reach the whole company.
 */
export function roleScopeClause(
  role: string,
  actorId: string,
  column: string,
  add: (value: unknown) => string,
): string | null {
  if (role !== 'agent') return null;
  return `${column} = ${add(actorId)}`;
}

/**
 * ⭐⭐ The list of the inbox.
 * ⭐ The order is the order of the work: the most recent activity
 *   first, and the reference as the tie breaker (a stable order).
 */
export async function listInboxConversations(
  uow: UnitOfWork,
  tenantId: string,
  filters: InboxFilters,
): Promise<{ readonly rows: InboxConversationRow[]; readonly total: number }> {
  const conditions: string[] = ['c.tenant_id = $1'];
  const values: unknown[] = [tenantId];
  const add = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };

  // ⭐⭐ The scope of the ROLE (the rule of the core work queue).
  const scopeClause = roleScopeClause(filters.role, filters.actorId, 'c.assignee_actor_id', add);
  if (scopeClause) {
    conditions.push(scopeClause);
  }
  if (filters.state !== undefined) {
    conditions.push(`c.state = ${add(filters.state)}`);
  }
  if (filters.assignee !== undefined && filters.assignee !== '') {
    if (filters.assignee === 'me') {
      conditions.push(`c.assignee_actor_id = ${add(filters.actorId)}`);
    } else if (filters.assignee === 'unassigned') {
      conditions.push('c.assignee_actor_id is null');
    } else {
      conditions.push(`c.assignee_actor_id = ${add(filters.assignee)}`);
    }
  }
  if (filters.query !== undefined && filters.query.trim() !== '') {
    const needle = add(`%${filters.query.trim()}%`);
    conditions.push(`(
      c.ref ilike ${needle}
      or cu.display_name ilike ${needle}
      or exists (
        select 1 from messages q
         where q.tenant_id = c.tenant_id
           and q.conversation_ref = c.ref
           and q.body ilike ${needle}
      )
    )`);
  }

  const where = conditions.join(' and ');
  const limit = add(Math.max(1, Math.min(filters.limit, 200)));
  const offset = add(Math.max(0, filters.offset));

  const result = await uow.query<InboxConversationRow>(
    `select c.ref,
            c.customer_id,
            cu.display_name as customer_name,
            c.state,
            c.assignee_actor_id,
            c.version,
            c.updated_at,
            last.body as last_message_body,
            last.occurred_at as last_message_at,
            last.direction as last_message_direction,
            coalesce(cnt.message_count, 0)::int as message_count
       from conversations c
       left join customers cu
              on cu.id = c.customer_id and cu.tenant_id = c.tenant_id
       left join lateral (
         select m.body, m.occurred_at, m.direction
           from messages m
          where m.tenant_id = c.tenant_id and m.conversation_ref = c.ref
          order by m.occurred_at desc, m.message_ref desc
          limit 1
       ) last on true
       left join lateral (
         select count(*)::int as message_count
           from messages m
          where m.tenant_id = c.tenant_id and m.conversation_ref = c.ref
       ) cnt on true
      where ${where}
      order by c.updated_at desc, c.ref asc
      limit ${limit} offset ${offset}`,
    values,
  );

  const countResult = await uow.query<{ count: string }>(
    `select count(*)::text as count from conversations c
       left join customers cu on cu.id = c.customer_id and cu.tenant_id = c.tenant_id
      where ${where}`,
    values.slice(0, values.length - 2),
  );

  return {
    rows: result.rows,
    total: Number(countResult.rows[0]?.count ?? '0'),
  };
}

/**
 * ⭐ The detail of one conversation: the customer and the messages.
 * ⭐⭐ M-76: the scope of the role is applied HERE too ⇒ ⭐ a path
 *   that is not the list cannot be wider than the list.
 * ⭐ The messages are read only when the conversation is in scope ⇒
 *   the body of a conversation out of scope is never even loaded.
 */
export async function readInboxConversation(
  uow: UnitOfWork,
  tenantId: string,
  ref: string,
  scope?: { readonly role: string; readonly actorId: string },
  /** ⭐ M-77: only the messages that are NEWER than this instant. */
  since?: string,
): Promise<{
  readonly conversation: Record<string, unknown> | null;
  readonly messages: readonly Record<string, unknown>[];
  /** ⭐ M-77: the instant of the database ⇒ the client polls with it. */
  readonly server_time: string;
}> {
  const conditions: string[] = ['c.tenant_id = $1', 'c.ref = $2'];
  const values: unknown[] = [tenantId, ref];
  const add = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };
  if (scope) {
    const scopeClause = roleScopeClause(scope.role, scope.actorId, 'c.assignee_actor_id', add);
    if (scopeClause) {
      conditions.push(scopeClause);
    }
  }
  const where = conditions.join(' and ');
  const conversation = await uow.query(
    `select c.ref, c.customer_id, cu.display_name as customer_name, c.state,
            c.assignee_actor_id, c.version, c.updated_at
       from conversations c
       left join customers cu on cu.id = c.customer_id and cu.tenant_id = c.tenant_id
      where ${where}`,
    values,
  );
  const row = conversation.rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    // ⭐⭐ Out of scope ⇒ nothing is read, nothing is returned.
    return { conversation: null, messages: [], server_time: new Date().toISOString() };
  }
  // ⭐⭐ M-77: the refresh asks for the NEW messages only ⇒ ⭐ the
  //   thread is not sent again on every poll (no excessive requests).
  const messageValues: unknown[] = [tenantId, ref];
  let messageSince = '';
  if (since !== undefined && since !== '') {
    messageValues.push(since);
    messageSince = ` and occurred_at > $3`;
  }
  const messages = await uow.query(
    `select message_ref, channel, direction, sender, recipient, body, occurred_at, locale
       from messages
      where tenant_id = $1 and conversation_ref = $2${messageSince}
      order by occurred_at asc, message_ref asc`,
    messageValues,
  );
  const clock = await uow.query<{ now: string }>(`select now()::text as now`);
  return {
    conversation: row,
    messages: messages.rows as readonly Record<string, unknown>[],
    server_time: String(clock.rows[0]?.now ?? new Date().toISOString()),
  };
}

/**
 * ⭐ The employees of the company that a conversation may be assigned
 *   to. ⭐ The list comes from the memberships, so it is the database
 *   that decides who exists, not the client.
 */
export async function listInboxAgents(
  uow: UnitOfWork,
  tenantId: string,
): Promise<readonly InboxAgentRow[]> {
  const result = await uow.query<InboxAgentRow>(
    `select m.user_id as actor_id, u.display_name, m.role
       from memberships m
       join users u on u.id = m.user_id
      where m.tenant_id = $1 and m.status = 'active' and u.status = 'active'
      order by m.role asc, u.display_name asc`,
    [tenantId],
  );
  return result.rows;
}

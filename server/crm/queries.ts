// ============================================================
// WASL AI — FOUNDATION BUILD 03 / PHASE 02 (D-071)
// the read and the write paths of the customer CRM
// ------------------------------------------------------------
// ⭐ WHAT THIS MODULE IS
//   The queries that fill the CRM: the list of the customers of a
//   company with the number of their conversations and the date of
//   the last interaction, the profile of one customer, and the
//   update of the fields the owner approved.
// ⭐ IT DECIDES NOTHING
//   ⭐ The decision (who may read, who may edit) is taken by the CORE:
//     `conversation.list` and `conversation.read` to read, and
//     `customer.manage` to edit (the owner and the supervisor — the
//     core grants it to nobody else).
//   ⭐ The scope of the ROLE is applied here, and it is the scope the
//     core already approved for the work queue (see `agent-queue.ts`):
//     an AGENT reaches the customers of the conversations that are
//     assigned to them, and nothing else.
// ⛔ It never accepts a tenant id from the client: the tenant comes
//   from the trusted context, and the row level security of the tables
//   is the second wall.
// ⛔ It never invents a contact: a field that is empty stays empty.
// ============================================================

import type { UnitOfWork } from '../db/unit-of-work.ts';

/** ⭐ The scope of the employee that asks (the rule of the work queue). */
export interface CrmScope {
  readonly actorId: string;
  readonly role: string;
}

export interface CrmCustomerFilters {
  /** ⭐ A free text: the name of the customer, the contact, the reference. */
  readonly query?: string;
  /** ⭐ The employee that asks: the scope of an agent is applied. */
  readonly actorId: string;
  /** ⭐ The role of the employee that asks. */
  readonly role: string;
  /** ⭐ `true` when the employee may manage a customer (the core decides). */
  readonly mayManage: boolean;
  /** ⭐ `name` · `recent` · `conversations` (the order of the list). */
  readonly sort: string;
  readonly limit: number;
  readonly offset: number;
}

export interface CrmCustomerRow {
  readonly id: string;
  readonly display_name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly data_class: string;
  readonly conversation_count: number;
  readonly last_interaction_at: string | null;
  readonly last_message_body: string | null;
  readonly version: number;
  readonly updated_at: string;
}

/**
 * ⭐⭐ The scope of the ROLE (the rule of the core work queue).
 * ⭐ An AGENT reaches only the customers that have a conversation
 *   assigned to them ⇒ ⭐ the CRM of an agent never shows a customer
 *   that nobody gave them.
 * ⭐⭐ D-072 / M-83: the scope has TWO parts and BOTH are needed:
 *   ⭐ (١) WHICH customers the agent sees (`exists …`), and
 *   ⭐ (٢) WHICH conversations of those customers count for them
 *      (the derived numbers) ⇒ ⭐⭐ the same parameter is reused in
 *      the derived parts ⇒ ⭐ the count, the last message and the last
 *      interaction can NEVER come from a conversation of another
 *      employee.
 * ⭐⭐ The owner, the supervisor and the viewer keep the scope of the
 *   core: the whole company (no clause at all).
 */
interface CrmScopeSql {
  /** ⭐ The filter of the list of the customers. */
  readonly where: string | null;
  /** ⭐⭐ The parameter of the assignment (the filter of the DERIVED data). */
  readonly assignee: string | null;
}

function scopeClause(
  scope: { role: string; actorId: string },
  add: (value: unknown) => string,
): CrmScopeSql {
  if (scope.role !== 'agent') return { where: null, assignee: null };
  const assignee = add(scope.actorId);
  return {
    where: `exists (
      select 1 from conversations c
       where c.tenant_id = cu.tenant_id
         and c.customer_id = cu.id
         and c.assignee_actor_id = ${assignee}
    )`,
    assignee,
  };
}

/**
 * ⭐⭐ The list of the customers of a company.
 * ⭐ The count of the conversations and the date of the last
 *   interaction come from the messages themselves, so the list is a
 *   view of the REAL activity and not a field somebody forgets to
 *   maintain.
 */
export async function listCustomers(
  uow: UnitOfWork,
  tenantId: string,
  filters: CrmCustomerFilters,
): Promise<{ readonly rows: CrmCustomerRow[]; readonly total: number }> {
  const conditions: string[] = ['cu.tenant_id = $1'];
  const values: unknown[] = [tenantId];
  const add = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };

  const scope = scopeClause({ role: filters.role, actorId: filters.actorId }, add);
  if (scope.where) {
    conditions.push(scope.where);
  }
  // ⭐⭐ M-83: the derived data (the count, the last message, the last
  //   interaction) is computed over the conversations the employee may
  //   SEE ⇒ ⭐ for an agent that means the conversations assigned to
  //   them ⇒ ⭐⭐ otherwise the number of the conversations and the text
  //   of the last message would come from a conversation of another
  //   employee.
  const derivedScope = scope.assignee === null ? '' : ` and c.assignee_actor_id = ${scope.assignee}`;

  if (filters.query !== undefined && filters.query.trim() !== '') {
    const needle = add(`%${filters.query.trim()}%`);
    conditions.push(`(
      cu.id ilike ${needle}
      or cu.display_name ilike ${needle}
      or coalesce(cu.email, '') ilike ${needle}
      or coalesce(cu.phone, '') ilike ${needle}
    )`);
  }

  const where = conditions.join(' and ');
  const limit = add(Math.max(1, Math.min(filters.limit, 200)));
  const offset = add(Math.max(0, filters.offset));

  // ⭐⭐ The order the employee asked for (a closed list, never a
  //   value that reaches SQL from the client).
  const order =
    filters.sort === 'recent'
      ? 'last.occurred_at desc nulls last, cu.display_name asc, cu.id asc'
      : filters.sort === 'conversations'
        ? 'cnt.conversation_count desc, cu.display_name asc, cu.id asc'
        : 'cu.display_name asc, cu.id asc';

  const result = await uow.query<CrmCustomerRow>(
    `select cu.id,
            cu.display_name,
            cu.email,
            cu.phone,
            cu.data_class,
            cu.version,
            cu.updated_at,
            coalesce(cnt.conversation_count, 0)::int as conversation_count,
            last.occurred_at as last_interaction_at,
            last.body as last_message_body
       from customers cu
       left join lateral (
         select count(*)::int as conversation_count
           from conversations c
          where c.tenant_id = cu.tenant_id and c.customer_id = cu.id${derivedScope}
       ) cnt on true
       left join lateral (
         select m.occurred_at, m.body
           from messages m
           join conversations c
             on c.tenant_id = m.tenant_id and c.ref = m.conversation_ref
          where c.tenant_id = cu.tenant_id and c.customer_id = cu.id${derivedScope}
          order by m.occurred_at desc, m.message_ref desc
          limit 1
       ) last on true
      where ${where}
      order by ${order}
      limit ${limit} offset ${offset}`,
    values,
  );

  const countResult = await uow.query<{ count: string }>(
    `select count(*)::text as count from customers cu where ${where}`,
    values.slice(0, values.length - 2),
  );

  return {
    rows: result.rows,
    total: Number(countResult.rows[0]?.count ?? '0'),
  };
}

/**
 * ⭐⭐ The profile of one customer: the customer and its conversations.
 * ⭐ The conversations are read with the scope of the role: an agent
 *   sees only the conversations that are assigned to them.
 */
export async function readCustomer(
  uow: UnitOfWork,
  tenantId: string,
  customerId: string,
  scope: CrmScope,
): Promise<{
  readonly customer: Record<string, unknown> | null;
  readonly conversations: readonly Record<string, unknown>[];
}> {
  const conditions: string[] = ['cu.tenant_id = $1', 'cu.id = $2'];
  const values: unknown[] = [tenantId, customerId];
  const add = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };
  const scopeSql = scopeClause(scope, add);
  if (scopeSql.where) {
    conditions.push(scopeSql.where);
  }
  const customer = await uow.query(
    `select cu.id, cu.display_name, cu.email, cu.phone, cu.data_class,
            cu.version, cu.created_at, cu.updated_at
       from customers cu
      where ${conditions.join(' and ')}`,
    values,
  );
  const row = customer.rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    return { customer: null, conversations: [] };
  }

  // ⭐⭐ The conversations of the customer, with the scope of the role.
  const conversationConditions = ['c.tenant_id = $1', 'c.customer_id = $2'];
  const conversationValues: unknown[] = [tenantId, customerId];
  if (scope.role === 'agent') {
    conversationConditions.push(`c.assignee_actor_id = $${conversationValues.length + 1}`);
    conversationValues.push(scope.actorId);
  }
  const conversations = await uow.query(
    `select c.ref, c.state, c.assignee_actor_id, c.version, c.updated_at,
            last.occurred_at as last_message_at, last.body as last_message_body,
            coalesce(cnt.message_count, 0)::int as message_count
       from conversations c
       left join lateral (
         select m.occurred_at, m.body
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
      where ${conversationConditions.join(' and ')}
      order by c.updated_at desc, c.ref asc`,
    conversationValues,
  );
  return {
    customer: row,
    conversations: conversations.rows as readonly Record<string, unknown>[],
  };
}

/** ⭐⭐ The fields the owner approved to change. ⛔ Nothing else is written. */
export interface CustomerPatch {
  readonly display_name?: string;
  readonly email?: string;
  readonly phone?: string;
  /** ⭐⭐ The version the employee read: the lock of the concurrent edit. */
  readonly expected_version: number;
}

export type CustomerUpdateOutcome =
  | { readonly status: 'updated'; readonly customer: Record<string, unknown> }
  | { readonly status: 'not_found' }
  | { readonly status: 'conflict'; readonly current_version: number };

/**
 * ⭐⭐ The update of a customer.
 * ⭐⭐ The lock: the write lands only when the version did not move ⇒
 *   ⭐ a second employee gets a conflict instead of overwriting the
 *   first one silently (no lost update).
 * ⛔ The tenant comes from the context, never from the client.
 */
export async function updateCustomer(
  uow: UnitOfWork,
  tenantId: string,
  customerId: string,
  patch: CustomerPatch,
): Promise<CustomerUpdateOutcome> {
  const sets: string[] = [];
  const values: unknown[] = [tenantId, customerId];
  const add = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };
  if (patch.display_name !== undefined) {
    sets.push(`display_name = ${add(patch.display_name)}`);
  }
  if (patch.email !== undefined) {
    sets.push(`email = ${add(patch.email)}`);
  }
  if (patch.phone !== undefined) {
    sets.push(`phone = ${add(patch.phone)}`);
  }
  if (sets.length === 0) {
    return { status: 'not_found' };
  }
  sets.push(`version = version + 1`);
  sets.push(`updated_at = now()`);

  const result = await uow.query(
    `update customers
        set ${sets.join(', ')}
      where tenant_id = $1
        and id = $2
        and version = ${add(patch.expected_version)}
      returning id, display_name, email, phone, data_class, version, created_at, updated_at`,
    values,
  );
  if (result.rowCount === 0) {
    // ⭐⭐ The lock fired: either the customer is not there, or another
    //   employee moved the version. ⭐ The two are told apart.
    const current = await uow.query<{ version: number }>(
      `select version from customers where tenant_id = $1 and id = $2`,
      [tenantId, customerId],
    );
    if (current.rowCount === 0) {
      return { status: 'not_found' };
    }
    return { status: 'conflict', current_version: Number(current.rows[0]?.version ?? 0) };
  }
  return { status: 'updated', customer: result.rows[0] as Record<string, unknown> };
}

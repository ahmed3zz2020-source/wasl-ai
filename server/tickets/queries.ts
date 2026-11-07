// ============================================================
// WASL AI — FOUNDATION BUILD 03 / PHASE 04 (D-073)
// the queries of the support tickets
// ------------------------------------------------------------
// ⭐⭐ THE SCOPE HAS TWO PARTS (the lesson of M-83)
//   ⭐ (١) WHICH tickets the employee sees (`assignee_actor_id = …`)
//     ⇒ ⭐⭐ and
//   ⭐ (٢) WHICH tickets COUNT for them (the derived numbers: the open
//     count of a customer, the last activity) ⇒ ⭐⭐ the SAME parameter
//     is reused in the derived parts ⇒ ⭐⭐ the count of the open
//     tickets of a customer can NEVER include a ticket of another
//     employee ⇒ ⭐⭐ this is exactly the defect M-83 was.
// ⭐ The owner, the supervisor and the viewer keep the scope of the
//   core: the whole company.
// ⛔ The company is NEVER a parameter of the caller ⇐ it is the tenant
//   of the transaction ⇒ ⭐⭐ the isolation is the policy of the table.
// ============================================================

import type { UnitOfWork } from '../db/unit-of-work.ts';

export interface TicketScope {
  readonly role: string;
  readonly actorId: string;
}

export interface TicketFilters {
  readonly query?: string;
  readonly state?: string;
  readonly priority?: string;
  readonly assignee?: string;
  readonly customerId?: string;
  readonly conversationRef?: string;
  readonly sort: 'recent' | 'priority' | 'state';
  readonly limit: number;
  readonly offset: number;
}

export interface TicketRow {
  readonly ref: string;
  readonly customer_id: string;
  readonly customer_name: string | null;
  readonly conversation_ref: string | null;
  readonly subject: string;
  readonly description: string;
  readonly state: string;
  readonly priority: string;
  readonly assignee_actor_id: string | null;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
}

interface TicketScopeSql {
  readonly where: string | null;
  readonly assignee: string | null;
}

/**
 * ⭐⭐ The scope of the ROLE on the tickets.
 * ⭐ An AGENT reaches only the tickets that are assigned to them ⇒ ⭐
 *   the parameter of the assignment is returned as well ⇒ ⭐⭐ it is
 *   reused by the derived parts (the lesson of M-83).
 */
function scopeClause(scope: TicketScope, add: (value: unknown) => string): TicketScopeSql {
  if (scope.role !== 'agent') return { where: null, assignee: null };
  const assignee = add(scope.actorId);
  return {
    where: `t.assignee_actor_id = ${assignee}`,
    assignee,
  };
}

/** ⭐⭐ The list of the tickets of a company (a real pagination). */
export async function listTickets(
  uow: UnitOfWork,
  tenantId: string,
  scope: TicketScope,
  filters: TicketFilters,
): Promise<{ readonly rows: TicketRow[]; readonly total: number }> {
  const conditions: string[] = ['t.tenant_id = $1'];
  const values: unknown[] = [tenantId];
  const add = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };

  const scoped = scopeClause(scope, add);
  if (scoped.where) {
    conditions.push(scoped.where);
  }

  if (filters.query !== undefined && filters.query.trim() !== '') {
    const needle = add(`%${filters.query.trim()}%`);
    conditions.push(`(
      t.ref ilike ${needle}
      or t.subject ilike ${needle}
      or t.description ilike ${needle}
      or coalesce(t.customer_id, '') ilike ${needle}
    )`);
  }
  if (filters.state !== undefined && filters.state !== '') {
    conditions.push(`t.state = ${add(filters.state)}`);
  }
  if (filters.priority !== undefined && filters.priority !== '') {
    conditions.push(`t.priority = ${add(filters.priority)}`);
  }
  if (filters.customerId !== undefined && filters.customerId !== '') {
    conditions.push(`t.customer_id = ${add(filters.customerId)}`);
  }
  if (filters.conversationRef !== undefined && filters.conversationRef !== '') {
    conditions.push(`t.conversation_ref = ${add(filters.conversationRef)}`);
  }
  if (filters.assignee !== undefined && filters.assignee !== '') {
    // ⭐⭐ The filter of the assignee is ANDED with the scope ⇒ ⭐⭐ an
    //   agent cannot widen their scope with a filter.
    conditions.push(`t.assignee_actor_id = ${add(filters.assignee)}`);
  }

  const where = conditions.join(' and ');
  const limit = add(Math.max(1, Math.min(filters.limit, 200)));
  const offset = add(Math.max(0, filters.offset));

  // ⭐⭐ The order is a closed list ⇒ nothing of the client reaches SQL.
  const priorityRank = `case t.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end`;
  const stateRank = `case t.state when 'in_progress' then 0 when 'open' then 1 when 'resolved' then 2 else 3 end`;
  const order =
    filters.sort === 'priority'
      ? `${priorityRank} asc, t.updated_at desc, t.id desc`
      : filters.sort === 'state'
        ? `${stateRank} asc, t.updated_at desc, t.id desc`
        : 't.updated_at desc, t.id desc';

  const result = await uow.query<TicketRow>(
    `select t.ref,
            t.customer_id,
            cu.display_name as customer_name,
            t.conversation_ref,
            t.subject,
            t.description,
            t.state,
            t.priority,
            t.assignee_actor_id,
            t.version,
            t.created_at,
            t.updated_at
       from support_tickets t
       left join customers cu on cu.tenant_id = t.tenant_id and cu.id = t.customer_id
      where ${where}
      order by ${order}
      limit ${limit} offset ${offset}`,
    values,
  );

  const countResult = await uow.query<{ count: string }>(
    `select count(*)::text as count from support_tickets t where ${where}`,
    values.slice(0, values.length - 2),
  );

  return { rows: result.rows, total: Number(countResult.rows[0]?.count ?? '0') };
}

/** ⭐⭐ The detail of one ticket (with its scope). */
export async function readTicket(
  uow: UnitOfWork,
  tenantId: string,
  ref: string,
  scope: TicketScope,
): Promise<TicketRow | null> {
  const values: unknown[] = [tenantId, ref];
  const scopeFilter = scope.role === 'agent' ? ' and t.assignee_actor_id = $3' : '';
  if (scope.role === 'agent') {
    values.push(scope.actorId);
  }
  const result = await uow.query<TicketRow>(
    `select t.ref,
            t.customer_id,
            cu.display_name as customer_name,
            t.conversation_ref,
            t.subject,
            t.description,
            t.state,
            t.priority,
            t.assignee_actor_id,
            t.version,
            t.created_at,
            t.updated_at
       from support_tickets t
       left join customers cu on cu.tenant_id = t.tenant_id and cu.id = t.customer_id
      where t.tenant_id = $1 and t.ref = $2${scopeFilter}`,
    values,
  );
  return result.rows[0] ?? null;
}

/** ⭐⭐ The activity of a ticket (the change log). */
export async function readTicketChanges(
  uow: UnitOfWork,
  tenantId: string,
  ref: string,
): Promise<readonly Record<string, unknown>[]> {
  const result = await uow.query<Record<string, unknown>>(
    `select version, actor_id, operation, before_state, after_state, reason, changed_at
       from support_ticket_changes
      where tenant_id = $1 and ticket_ref = $2
      order by changed_at desc, id desc`,
    [tenantId, ref],
  );
  return result.rows;
}

/**
 * ⭐⭐ The tickets of ONE customer (for the CRM) ⇐ ⭐⭐ the derived
 *   count follows the SAME scope ⇒ ⭐⭐ the count of the open tickets
 *   of a customer can never include a ticket of another employee.
 */
export async function readCustomerTickets(
  uow: UnitOfWork,
  tenantId: string,
  customerId: string,
  scope: TicketScope,
): Promise<{ readonly tickets: TicketRow[]; readonly open_count: number }> {
  const values: unknown[] = [tenantId, customerId];
  let scopeFilter = '';
  if (scope.role === 'agent') {
    values.push(scope.actorId);
    scopeFilter = ' and t.assignee_actor_id = $3';
  }
  const tickets = await uow.query<TicketRow>(
    `select t.ref,
            t.customer_id,
            cu.display_name as customer_name,
            t.conversation_ref,
            t.subject,
            t.description,
            t.state,
            t.priority,
            t.assignee_actor_id,
            t.version,
            t.created_at,
            t.updated_at
       from support_tickets t
       left join customers cu on cu.tenant_id = t.tenant_id and cu.id = t.customer_id
      where t.tenant_id = $1 and t.customer_id = $2${scopeFilter}
      order by t.updated_at desc, t.id desc
      limit 50`,
    values,
  );
  const countValues = values.slice(0, scope.role === 'agent' ? 3 : 2);
  const count = await uow.query<{ count: string }>(
    `select count(*)::text as count
       from support_tickets t
      where t.tenant_id = $1 and t.customer_id = $2${scopeFilter}
        and t.state not in ('resolved', 'closed')`,
    countValues,
  );
  return {
    tickets: tickets.rows,
    open_count: Number(count.rows[0]?.count ?? '0'),
  };
}

/** ⭐⭐ The rows of a ticket that may be written (the caller owns them). */
export async function readTicketForUpdate(
  uow: UnitOfWork,
  tenantId: string,
  ref: string,
): Promise<{
  readonly ref: string;
  readonly state: string;
  readonly priority: string;
  readonly assignee_actor_id: string | null;
  readonly version: number;
  readonly customer_id: string;
} | null> {
  const result = await uow.query<{
    ref: string;
    state: string;
    priority: string;
    assignee_actor_id: string | null;
    version: number;
    customer_id: string;
  }>(
    `select ref, state, priority, assignee_actor_id, version, customer_id
       from support_tickets
      where tenant_id = $1 and ref = $2
      for update`,
    [tenantId, ref],
  );
  return result.rows[0] ?? null;
}

/** ⭐⭐ The ticket of a reference (for the idempotency of the creation). */
export async function readTicketByRef(
  uow: UnitOfWork,
  tenantId: string,
  ref: string,
): Promise<{ readonly ref: string; readonly version: number } | null> {
  const result = await uow.query<{ ref: string; version: number }>(
    `select ref, version from support_tickets where tenant_id = $1 and ref = $2`,
    [tenantId, ref],
  );
  return result.rows[0] ?? null;
}

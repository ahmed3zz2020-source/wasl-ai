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
import { UnitOfWork as Work } from '../db/unit-of-work.ts';
import type { PgPool } from '../db/pool.ts';

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
  /**
   * ⭐⭐⭐ M-119: the queue of the tickets that have NO assignee.
   *   ⭐⭐⭐ It is a FILTER of the list (not a scope) ⇒ ⭐⭐⭐ the
   *   ⭐⭐⭐ scope of the role is still applied on top of it ⇒ ⭐⭐⭐ so
   *   ⭐⭐⭐ an employee sees an empty queue (their scope is the
   *   ⭐⭐⭐ tickets that are assigned to THEM) ⇒ ⭐⭐⭐ and never the
   *   ⭐⭐⭐ tickets of another employee (the lesson of M-83).
   */
  readonly unassigned?: boolean;
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
  /**
   * ⭐⭐⭐ tk-16: ⭐⭐⭐ the MEASUREMENTS of the ticket ⇒ ⇒ ⇒ ⇒ they come
   * ⭐⭐⭐ tk-16 from the data that ALREADY EXISTS ⇒ ⇒ ⇒ ⇒ and nothing
   * ⭐⭐⭐ tk-16 is invented ⇒ ⇒ ⇒ ⇒ (⇒ ⇒ ⇒ ⇒ no target is declared in
   * ⭐⭐⭐ tk-16 the project ⇒ ⇒ ⇒ ⇒ ⇒ the page shows the measurement
   * ⭐⭐⭐ tk-16 and says that the target is a commercial decision).
   * ⭐⭐⭐ tk-16: ⭐⭐⭐ `first_response_at` is NULL when the ticket has
   * ⭐⭐⭐ tk-16 no conversation or no reply yet ⇒ ⇒ ⇒ ⇒ (⇒ ⇒ ⇒ ⇒ "غير
   * ⭐⭐⭐ tk-16 متاح" — NOT a zero and NOT a guess).
   */
  readonly first_response_at: string | null;
  readonly first_response_minutes: number | null;
  readonly age_minutes: number;
  readonly idle_minutes: number;
}

/**
 * ⭐⭐⭐ tk-16: ⭐⭐⭐ the measurement of the first reply.
 * ⭐⭐⭐ It is the FIRST outbound reply of the conversation of the ticket
 * ⭐⭐⭐ tk-16 that came AFTER the ticket was created ⇒ ⇒ ⇒ ⇒ (⇒ ⇒ ⇒ ⇒
 * ⭐⭐⭐ tk-16 a reply of an earlier moment does not count) ⇒ ⇒ ⇒ ⇒ and
 * ⭐⭐⭐ tk-16 it is ONE query for the whole page (no N+1).
 */
const FIRST_RESPONSE_SQL = `left join lateral (
          select m.occurred_at as first_response_at
            from messages m
           where m.tenant_id = t.tenant_id
             and m.conversation_ref = t.conversation_ref
             and m.direction = 'outbound'
             and m.occurred_at >= t.created_at
           order by m.occurred_at asc, m.message_ref asc
           limit 1
        ) fr on true`;

/**
 * ⭐⭐⭐ tk-16: ⭐⭐⭐ PostgreSQL gives the numbers of `extract(epoch …)`
 * ⭐⭐⭐ tk-16 as text ⇒ ⇒ ⇒ ⇒ they are turned into REAL numbers here ⇒
 * ⭐⭐⭐ tk-16 ⇒ ⇒ ⇒ ⇒ (and the interface of the page stays honest).
 */
interface TicketRowRaw extends TicketRow {
  readonly first_response_minutes: string | number | null;
  readonly age_minutes: string | number;
  readonly idle_minutes: string | number;
}

function withMeasurements(row: TicketRowRaw): TicketRow {
  const first = row.first_response_minutes;
  return {
    ...row,
    first_response_minutes: first === null || first === undefined ? null : Number(first),
    age_minutes: Number(row.age_minutes ?? 0),
    idle_minutes: Number(row.idle_minutes ?? 0),
  };
}

const FIRST_RESPONSE_COLUMNS = `fr.first_response_at as first_response_at,
            case when fr.first_response_at is null then null
                 else extract(epoch from (fr.first_response_at - t.created_at)) / 60
            end as first_response_minutes,
            extract(epoch from (now() - t.created_at)) / 60 as age_minutes,
            extract(epoch from (now() - t.updated_at)) / 60 as idle_minutes`;


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

/**
 * ⭐⭐⭐ M-119: ⭐⭐⭐ THE CONDITIONS OF THE TICKETS — ⭐⭐⭐ ONE builder
 *   ⭐⭐⭐ for the list AND for the counters ⇒ ⭐⭐⭐ the scope of the
 *   ⭐⭐⭐ role can NEVER differ between them ⇒ ⭐⭐⭐ (the lesson of
 *   ⭐⭐⭐ M-83: the count and the list are the SAME question).
 *   ⭐⭐⭐ The `add` pushes the value and returns its placeholder ⇒ ⭐⭐⭐
 *   ⭐⭐⭐ nothing of the client reaches SQL.
 */
function ticketConditions(
  scope: TicketScope,
  filters: TicketFilters,
  add: (value: unknown) => string,
): string[] {
  const conditions: string[] = ['t.tenant_id = $1'];

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
  // ⭐⭐⭐ M-119: the queue of the unassigned tickets.
  if (filters.unassigned === true) {
    conditions.push('t.assignee_actor_id is null');
  }

  return conditions;
}

/** ⭐⭐ The list of the tickets of a company (a real pagination). */
export async function listTickets(
  uow: UnitOfWork,
  tenantId: string,
  scope: TicketScope,
  filters: TicketFilters,
): Promise<{ readonly rows: TicketRow[]; readonly total: number }> {
  const values: unknown[] = [tenantId];
  const add = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };

  const where = ticketConditions(scope, filters, add).join(' and ');
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

  const result = await uow.query<TicketRowRaw>(
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
            t.updated_at,
            ${FIRST_RESPONSE_COLUMNS}
       from support_tickets t
       left join customers cu on cu.tenant_id = t.tenant_id and cu.id = t.customer_id
       ${FIRST_RESPONSE_SQL}
      where ${where}
      order by ${order}
      limit ${limit} offset ${offset}`,
    values,
  );

  const countResult = await uow.query<{ count: string }>(
    `select count(*)::text as count from support_tickets t where ${where}`,
    values.slice(0, values.length - 2),
  );

  return {
    rows: result.rows.map(withMeasurements),
    total: Number(countResult.rows[0]?.count ?? '0'),
  };
}

/**
 * ⭐⭐⭐ M-119: ⭐⭐⭐ HOW MANY TICKETS ARE WAITING FOR AN ASSIGNMENT.
 *   ⭐⭐⭐ The counter answers the SAME question as the list ⇒ ⭐⭐⭐ the
 *   ⭐⭐⭐ same scope of the role ⇒ ⭐⭐⭐ the same filters ⇒ ⭐⭐⭐ and
 *   ⭐⭐⭐ (only) the predicate of the assignment is added ⇒ ⭐⭐⭐ so
 *   ⭐⭐⭐ the badge and the queue always agree.
 */
export async function countUnassignedTickets(
  uow: UnitOfWork,
  tenantId: string,
  scope: TicketScope,
  filters: TicketFilters,
): Promise<number> {
  const values: unknown[] = [tenantId];
  const add = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };
  const conditions = ticketConditions(scope, { ...filters, unassigned: false }, add);
  conditions.push('t.assignee_actor_id is null');
  const where = conditions.join(' and ');
  const result = await uow.query<{ count: string }>(
    `select count(*)::text as count from support_tickets t where ${where}`,
    values,
  );
  return Number(result.rows[0]?.count ?? '0');
}

/**
 * ⭐⭐⭐ M-121: ⭐⭐⭐ THE PAGE AND THE COUNTER IN **ONE SNAPSHOT**.
 *   ⭐⭐⭐ The rows, their total and the counter of the queue are three
 *   ⭐⭐⭐ statements ⇒ ⇒ ⇒ in `read committed` every statement had its
 *   ⭐⭐⭐ own snapshot ⇒ ⇒ ⇒ and an assignment that lands between them
 *   ⭐⭐⭐ makes the badge and the queue DISAGREE ⇒ ⇒ ⇒ (the defect
 *   ⭐⭐⭐ that M-121 proves with a real concurrent writer).
 *   ⭐⭐⭐ ⇒ the read of the page runs in `repeatable read` ⇒ ⇒ ⇒ ONE
 *   ⭐⭐⭐ snapshot for the three statements ⇒ ⇒ ⇒ they always agree.
 *   ⭐⭐⭐ ⛔ No change of the rights · no change of the core · and the
 *   ⭐⭐⭐ ⛔ write path keeps `read committed`.
 *   ⭐⭐⭐ ⭐ And the API calls THIS function ⇒ ⇒ ⇒ so the proof of the
 *   ⭐⭐⭐ ⭐ test measures the real path of the product.
 */
export async function readTicketPage(
  pool: PgPool,
  tenantId: string,
  scope: TicketScope,
  filters: TicketFilters,
): Promise<{ readonly rows: TicketRow[]; readonly total: number; readonly unassignedCount: number }> {
  return Work.run(
    pool,
    tenantId,
    async (uow) => {
      const page = await listTickets(uow, tenantId, scope, filters);
      const unassignedCount = await countUnassignedTickets(uow, tenantId, scope, filters);
      return { rows: page.rows, total: page.total, unassignedCount };
    },
    { isolation: 'repeatable read' },
  );
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
  const result = await uow.query<TicketRowRaw>(
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
            t.updated_at,
            ${FIRST_RESPONSE_COLUMNS}
       from support_tickets t
       left join customers cu on cu.tenant_id = t.tenant_id and cu.id = t.customer_id
       ${FIRST_RESPONSE_SQL}
      where t.tenant_id = $1 and t.ref = $2${scopeFilter}`,
    values,
  );
  const row = result.rows[0];
  return row ? withMeasurements(row) : null;
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

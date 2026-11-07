// ============================================================
// WASL AI — FOUNDATION BUILD 01 — persistence bridge
// ------------------------------------------------------------
// ⭐ Two directions:
//   hydrate  : PostgreSQL -> in-memory bundle (the core needs the
//              conversation to exist before it may change it)
//   persist  : in-memory bundle -> PostgreSQL (what the core decided)
// ⭐ Both run inside the caller's transaction, so a failed write
//   leaves PostgreSQL untouched and the caller drops the bundle
//   (the next request re-hydrates from the database).
// ⛔ No business rule here: the rows written are exactly the rows the
//   core produced.
// ============================================================

import type { UnitOfWork } from '../unit-of-work.ts';
import type { TenantBundle } from './core-bundle.ts';

export class PersistConflictError extends Error {
  readonly code = 'state_conflict';
  constructor(message: string) {
    super(message);
    this.name = 'PersistConflictError';
  }
}

interface ConversationRow {
  ref: string;
  state: string;
  assignee_actor_id: string | null;
  version: number;
  updated_at: string;
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date(String(value)).toISOString();
}

interface MessageRow {
  message_ref: string;
  channel: string;
  direction: string;
  sender: string;
  recipient: string;
  body: string;
  occurred_at: string;
  locale: string;
  attributes: Record<string, string>;
  stored_at: string;
}

/** ⭐ Load the employee (actor) ids of a tenant into the bundle. */
export async function hydrateEmployees(uow: UnitOfWork, bundle: TenantBundle): Promise<void> {
  const result = await uow.query<{ user_id: string }>(
    `select user_id from memberships where tenant_id = $1 and status = 'active'`,
    [bundle.tenantId],
  );
  bundle.employeeIds.clear();
  for (const row of result.rows) bundle.employeeIds.add(row.user_id);
}

/**
 * ⭐ Load one conversation (messages + state row) into the bundle.
 * ⭐ The state row is restored with its exact version, so the core
 *   optimistic lock keeps working across a process restart.
 */
export async function hydrateConversation(
  uow: UnitOfWork,
  bundle: TenantBundle,
  context: { tenantId: string; actorId: string; sessionId: string; capabilities: readonly string[]; role: string; issuedAt: string },
  conversationRef: string,
): Promise<boolean> {
  if (bundle.hydrated.has(conversationRef)) return true;

  const messages = await uow.query<MessageRow>(
    `select message_ref, channel, direction, sender as "sender", recipient as "recipient",
            body, occurred_at, locale, attributes, stored_at
       from messages
      where tenant_id = $1 and conversation_ref = $2
      order by occurred_at asc, message_ref asc`,
    [bundle.tenantId, conversationRef],
  );
  if (messages.rows.length === 0) return false;

  for (const row of messages.rows) {
    // ⭐ PostgreSQL returns timestamptz as a Date: the core envelope
    //   contract expects ISO strings, so they are normalized here.
    bundle.store.append(context as never, {
      schema_version: '1',
      message_ref: row.message_ref,
      conversation_ref: conversationRef,
      declared_tenant_id: bundle.tenantId,
      channel: row.channel,
      direction: row.direction,
      from: row.sender,
      to: row.recipient,
      body: row.body,
      occurred_at: toIso(row.occurred_at),
      locale: row.locale,
      attributes: row.attributes ?? {},
    });
  }
  // The appends above are hydration, not new messages.
  bundle.store.appended.length = 0;

  const state = await uow.query<ConversationRow>(
    `select ref, state, assignee_actor_id, version, updated_at
       from conversations
      where tenant_id = $1 and ref = $2`,
    [bundle.tenantId, conversationRef],
  );
  if (state.rows.length > 0) {
    const row = state.rows[0]!;
    bundle.states.ensure(context as never, conversationRef);
    bundle.states.restore(context as never, conversationRef, {
      conversation_ref: conversationRef,
      state: row.state as never,
      assignee_actor_id: row.assignee_actor_id,
      updated_at: toIso(row.updated_at),
      version: row.version,
    });
  }
  bundle.hydrated.add(conversationRef);
  return true;
}

/**
 * ⭐⭐⭐ Lock the conversation row in PostgreSQL and refresh the state.
 * ------------------------------------------------------------
 * ⭐ WHY THIS EXISTS
 *   The in-memory bundle is per PROCESS. With two backend instances
 *   on the same database, the memory of one instance is stale as soon
 *   as the other instance commits a change. The in-process queue (the
 *   per tenant lock of the API server) cannot help here: it only
 *   serializes the requests of ONE process.
 * ⭐ WHAT THE DATABASE DOES
 *   1) `for update` takes a row lock on the conversation: a second
 *      writer (another instance, another process) waits until the
 *      first transaction commits. The writes of one conversation are
 *      therefore serialized across instances.
 *   2) the state row is re-read AFTER the lock, so the core works on
 *      the committed version and not on a stale memory value.
 * ⛔ Nothing is written by this function: it only reads and locks.
 * ⛔ The lock is released when the unit of work ends (commit or
 *   rollback), so a failure never leaves a conversation locked.
 */
export async function lockConversation(
  uow: UnitOfWork,
  bundle: TenantBundle,
  context: { tenantId: string; actorId: string; sessionId: string; capabilities: readonly string[]; role: string; issuedAt: string },
  conversationRef: string,
): Promise<boolean> {
  const locked = await uow.query<{ version: number }>(
    `select version from conversations where tenant_id = $1 and ref = $2 for update`,
    [bundle.tenantId, conversationRef],
  );
  if (locked.rows.length === 0) return false;

  // ⭐ The state is re-read after the lock: the row may have been
  //   committed by another instance while we were waiting for it.
  const state = await uow.query<ConversationRow>(
    `select ref, state, assignee_actor_id, version, updated_at
       from conversations
      where tenant_id = $1 and ref = $2`,
    [bundle.tenantId, conversationRef],
  );
  const row = state.rows[0];
  if (!row) return false;
  bundle.states.ensure(context as never, conversationRef);
  bundle.states.restore(context as never, conversationRef, {
    conversation_ref: conversationRef,
    state: row.state as never,
    assignee_actor_id: row.assignee_actor_id,
    updated_at: toIso(row.updated_at),
    version: row.version,
  });
  return true;
}

/**
 * ⭐ Persist everything the core produced in this operation.
 * ⛔ Throws PersistConflictError when the stored version moved on
 *   (optimistic lock enforced by PostgreSQL, not by memory).
 */
export async function persistBundle(uow: UnitOfWork, bundle: TenantBundle): Promise<void> {
  for (const message of bundle.store.appended) {
    await uow.query(
      `insert into messages
         (message_ref, tenant_id, conversation_ref, channel, direction, sender, recipient,
          body, occurred_at, locale, attributes, stored_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)
       on conflict (tenant_id, message_ref) do nothing`,
      [
        message.message_ref,
        message.tenant_id,
        message.conversation_ref,
        message.channel,
        message.direction,
        message.from,
        message.to,
        message.body,
        message.occurred_at,
        message.locale,
        JSON.stringify(message.attributes ?? {}),
        message.stored_at,
      ],
    );
  }

  for (const view of bundle.states.changed) {
    const previousVersion = view.version - 1;
    const result = await uow.query(
      `insert into conversations
         (tenant_id, ref, state, assignee_actor_id, version, updated_at)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (tenant_id, ref) do update
          set state = excluded.state,
              assignee_actor_id = excluded.assignee_actor_id,
              version = excluded.version,
              updated_at = excluded.updated_at
        where conversations.version = $7`,
      [
        bundle.tenantId,
        view.conversation_ref,
        view.state,
        view.assignee_actor_id,
        view.version,
        view.updated_at,
        previousVersion,
      ],
    );
    if (result.rowCount === 0) {
      throw new PersistConflictError(
        `conversation ${view.conversation_ref} changed elsewhere (version mismatch)`,
      );
    }
  }

  for (const entry of bundle.changes.recorded) {
    await uow.query(
      `insert into conversation_changes
         (tenant_id, conversation_ref, operation, from_state, to_state, actor_id, reason,
          assignee_from, assignee_to, occurred_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        bundle.tenantId,
        entry.conversation_ref,
        entry.operation,
        entry.from_state ?? null,
        entry.to_state ?? null,
        entry.actor_id,
        entry.reason ?? '',
        entry.assignee_from ?? null,
        entry.assignee_to ?? null,
        entry.ts,
      ],
    );
  }

  for (const event of bundle.readAudit.recorded) {
    await uow.query(
      `insert into read_audit_events
         (tenant_id, actor_id, operation, capability, result, target, row_count, occurred_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        bundle.tenantId,
        event.actor_id,
        event.operation,
        event.capability ?? '',
        event.result,
        event.target ?? null,
        event.count ?? null,
        event.ts,
      ],
    );
  }
}

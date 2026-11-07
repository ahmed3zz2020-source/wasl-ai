// ============================================================
// WASL AI — FOUNDATION BUILD 03 / PHASE 04 (D-073)
// the policy of the operations of a ticket
// ------------------------------------------------------------
// ⭐⭐ WHY THIS FILE EXISTS
//   ⭐ The core (`src/core/`) is FROZEN by the owner directive ⇒ ⭐⭐ it
//     carries no `ticket.*` capability ⇒ ⭐⭐ and a ticket operation
//     must still be checked by the SERVER (a button in the interface
//     is not an authorization).
//   ⭐⭐ The core resolves an OPERATION into a capability ⇒ ⭐⭐ so this
//     file does NOT invent a capability and does NOT keep a parallel
//     table of permissions ⇒ ⭐⭐ it maps every ticket operation to an
//     operation the CORE already declares ⇒ ⭐⭐ and the core decides.
//   ⭐⭐ The mapping is EXPLICIT (a named table) and CLOSED ⇒ ⭐⭐ an
//     operation that is not listed is REFUSED ⇒ ⭐⭐ the default is the
//     refusal, never an accidental permission.
//
// ⭐⭐ THE MAPPING AND ITS SOURCE (every line is a decision of the owner)
//   ⭐ `ticket.list`  → `conversation.list`  ⇒ ⭐ the support workspace
//     is read like the list of the conversations (the owner and the
//     supervisor see the company, the agent sees their own work, the
//     viewer reads).
//   ⭐ `ticket.read`  → `conversation.read`  ⇒ ⭐ the same rule for the
//     detail of one ticket.
//   ⭐ `ticket.create` → `customer.create`  ⇒ ⭐⭐ the DECISION OF D-071
//     (the CRM writes the customer record with `customer.manage` ⇒ the
//     owner and the supervisor) ⇒ ⭐⭐ a ticket is part of the customer
//     record ⇒ ⭐⭐ the same approved capability covers it.
//   ⭐ `ticket.update` → `customer.create`  ⇒ ⭐⭐ the same decision:
//     editing the ticket edits the customer record.
//   ⭐ `ticket.assign` → `conversation.assign` ⇒ ⭐⭐ the assignment is
//     the OWNER alone (the core grants `conversation.assign` to the
//     owner only — the fact M-84 corrected) ⇒ ⭐⭐ a ticket is assigned
//     by the same people and by nobody else.
//
// ⭐⭐ THE DECISION THAT IS STILL OPEN (and is raised to the owner)
//   ⭐⭐ The core has no `ticket.*` capability ⇒ ⭐⭐ the mapping above
//   is a BRIDGE for this phase ⇒ ⭐⭐ the owner may ratify it or add
//   the dedicated capabilities to the core (a separate approval) ⇒ ⭐⭐
//   the bridge is explicit, server-enforced and tested per role ⇒ ⭐⭐
//   it can never be a silent substitution.
// ============================================================

import type { LocalAuthorizationOperation } from '../../src/core/authorization.ts';

/**
 * ⭐⭐ The operations of a ticket ⇐ ⭐⭐ the operations of the core that
 *   the owner already approved for them.
 * ⛔ It is CLOSED ⇒ ⭐ an operation that is not here is refused.
 */
export const TICKET_OPERATIONS: Readonly<Record<string, LocalAuthorizationOperation>> = Object.freeze({
  'ticket.list': 'conversation.list',
  'ticket.read': 'conversation.read',
  'ticket.create': 'customer.create',
  'ticket.update': 'customer.create',
  'ticket.assign': 'conversation.assign',
});

export class TicketPolicyError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'TicketPolicyError';
    this.code = code;
  }
}

/**
 * ⭐⭐ The core operation that guards a ticket operation.
 * ⛔ An operation that is not declared ⇒ ⭐⭐ `ticket_operation_unknown`
 *   ⇒ ⭐⭐ the refusal is the default.
 */
export function coreOperationOf(ticketOperation: string): LocalAuthorizationOperation {
  const operation = TICKET_OPERATIONS[ticketOperation];
  if (!operation) {
    throw new TicketPolicyError(
      'ticket_operation_unknown',
      `the operation of the ticket is not declared: ${ticketOperation}`,
    );
  }
  return operation;
}

// ⭐⭐⭐ THE RIGHTS OF A TICKET ARE NOT DECIDED HERE ⇐
// ⭐⭐⭐ The server asks THE CORE ITSELF (the authorization of the core)
// ⭐⭐   and the answer is the decision of the core ⇒ ⭐⭐ a table of
// ⭐⭐   permissions that lives beside the core would be a PARALLEL
// ⭐⭐   TRUTH (the very thing this file refuses to create) ⇒ ⭐⭐ and
// ⭐⭐   the "may write / may assign" the interface receives comes from
// ⭐⭐   the authorization of the core, not from a list of roles.
// ⭐⭐⭐ THE MAPPING ABOVE IS THE WHOLE TABLE ⇐ ⭐⭐ the operations of a
// ⭐⭐   ticket are read through it, and the core decides the right.

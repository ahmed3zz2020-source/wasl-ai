// ============================================================
// WASL AI — FOUNDATION BUILD 03 / PHASE 04 (D-073)
// the states and the priorities of a support ticket
// ------------------------------------------------------------
// ⭐⭐ WHY THE STATES LIVE HERE AND NOT IN THE CORE
//   The states of the core (`src/core/conversation-state.ts`) belong to
//   the CONVERSATIONS ⇒ ⭐⭐ they were never approved for the tickets
//   ⇒ ⭐⭐ the tickets carry their OWN small set of operational states
//   here ⇒ ⭐⭐ and `src/core/` is NOT touched (the owner directive
//   forbids it without a separate approval).
// ⭐⭐ THE TWO ARE NOT COUPLED
//   ⭐ Closing a ticket does NOT close a conversation ⇒ ⭐⭐ and closing
//     a conversation does NOT close a ticket ⇒ ⭐⭐ that coupling was
//     never approved and is not introduced here.
// ⛔ THE SETS ARE CLOSED
//   ⭐ An unknown state or priority is refused ⇒ ⭐⭐ the default is
//   the refusal, never a silent fallback.
// ============================================================

/** ⭐ The states of a ticket (a closed set). */
export const TICKET_STATES = ['open', 'in_progress', 'resolved', 'closed'] as const;
export type TicketState = (typeof TICKET_STATES)[number];

/** ⭐ The priorities of a ticket (a closed set). */
export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

/**
 * ⭐⭐ The allowed transitions of a ticket.
 * ⭐ A closed ticket is TERMINAL (like a closed conversation) ⇒ ⭐⭐ the
 *   work that comes back is a NEW ticket, not a resurrection.
 */
export const TICKET_TRANSITIONS: Readonly<Record<TicketState, readonly TicketState[]>> = Object.freeze({
  open: Object.freeze(['in_progress', 'resolved', 'closed']),
  in_progress: Object.freeze(['open', 'resolved', 'closed']),
  resolved: Object.freeze(['in_progress', 'closed']),
  closed: Object.freeze([]),
});

export class TicketStateError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'TicketStateError';
    this.code = code;
  }
}

/** ⭐ Is this a declared state? (the default is the refusal) */
export function isTicketState(value: unknown): value is TicketState {
  return typeof value === 'string' && (TICKET_STATES as readonly string[]).includes(value);
}

/** ⭐ Is this a declared priority? (the default is the refusal) */
export function isTicketPriority(value: unknown): value is TicketPriority {
  return typeof value === 'string' && (TICKET_PRIORITIES as readonly string[]).includes(value);
}

/**
 * ⭐⭐ Check a transition ⇒ ⭐⭐ an unknown state is refused and an
 *   illegal transition is refused (the same two codes as the core:
 *   `state_invalid` and `transition_not_allowed`).
 */
export function assertTicketTransition(from: string, to: string): void {
  if (!isTicketState(to)) {
    throw new TicketStateError('state_invalid', `the state is not declared: ${to}`);
  }
  if (!isTicketState(from)) {
    throw new TicketStateError('state_invalid', `the current state is not declared: ${from}`);
  }
  if (!TICKET_TRANSITIONS[from].includes(to)) {
    throw new TicketStateError(
      'transition_not_allowed',
      `the transition is not allowed: ${from} -> ${to}`,
    );
  }
}

/** ⭐ The states that are still open (the closed ones are not). */
export function isOpenState(state: string): boolean {
  return state !== 'resolved' && state !== 'closed';
}

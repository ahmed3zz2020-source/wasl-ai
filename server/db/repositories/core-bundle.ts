// ============================================================
// WASL AI — FOUNDATION BUILD 01 — per tenant core bundle
// ------------------------------------------------------------
// ⭐ The core stays the decision engine: every state machine rule,
//   every capability check and every validation comes from src/core.
// ⭐ This file only ADDS three things on top of the core classes:
//   1) capture   -> what the core produced, so it can be persisted
//   2) hydration -> load a conversation from PostgreSQL into memory
//   3) recovery  -> drop the in-memory bundle when the write failed
// ⛔ No business rule is re-implemented here. The capture subclasses
//   call super and keep the core behaviour untouched.
// ============================================================

import {
  ConversationChangeLog,
  ConversationStateStore,
  MessageStore,
  ReadAuditLog,
  type AppendOutcome,
  type ConversationChangeEntry,
  type ConversationChangeInput,
  type ConversationState,
  type ConversationStateView,
  type EmployeeDirectory,
  type ReadAuditEvent,
  type ReadAuditInput,
  type StoredMessage,
  type TenantContext,
} from '../../../src/core/index.ts';

// ============================================================
// 1) Capture subclasses (core behaviour is preserved)
// ============================================================

export class CapturingMessageStore extends MessageStore {
  readonly appended: StoredMessage[] = [];

  override append(context: TenantContext | undefined, input: unknown): AppendOutcome {
    const outcome = super.append(context, input);
    if (outcome.status === 'accepted') this.appended.push(outcome.message);
    return outcome;
  }
}

export class CapturingStateStore extends ConversationStateStore {
  readonly changed: ConversationStateView[] = [];

  override setState(
    context: TenantContext,
    conversationRef: string,
    next: { state: ConversationState; assignee: string | null; expectedVersion?: number },
  ): ConversationStateView {
    const view = super.setState(context, conversationRef, next);
    this.changed.push(view);
    return view;
  }
}

export class CapturingChangeLog extends ConversationChangeLog {
  readonly recorded: ConversationChangeEntry[] = [];

  override record(context: TenantContext, input: ConversationChangeInput): ConversationChangeEntry {
    const entry = super.record(context, input);
    this.recorded.push(entry);
    return entry;
  }
}

export class CapturingReadAudit extends ReadAuditLog {
  readonly recorded: ReadAuditEvent[] = [];

  override record(input: ReadAuditInput): ReadAuditEvent {
    const event = super.record(input);
    this.recorded.push(event);
    return event;
  }
}

// ============================================================
// 2) The bundle
// ============================================================

export interface TenantBundle {
  readonly tenantId: string;
  readonly store: CapturingMessageStore;
  readonly states: CapturingStateStore;
  readonly changes: CapturingChangeLog;
  readonly readAudit: CapturingReadAudit;
  readonly employees: EmployeeDirectory;
  /** ⭐ employee actor ids known for this tenant (loaded from the database). */
  readonly employeeIds: Set<string>;
  /** ⭐ conversations already hydrated into memory. */
  readonly hydrated: Set<string>;
}

export function createBundle(tenantId: string, now: () => string = () => new Date().toISOString()): TenantBundle {
  const employeeIds = new Set<string>();
  const employees: EmployeeDirectory = {
    isEmployee(tenantId: string, actorId: string): boolean {
      return employeeIds.has(actorId);
    },
  };
  return {
    tenantId,
    store: new CapturingMessageStore({ now }),
    states: new CapturingStateStore({ now }),
    changes: new CapturingChangeLog({ now }),
    readAudit: new CapturingReadAudit({ now }),
    employees,
    employeeIds,
    hydrated: new Set<string>(),
  };
}

/** ⭐ Clear the capture buffers before a new operation (per request). */
export function resetCaptures(bundle: TenantBundle): void {
  bundle.store.appended.length = 0;
  bundle.states.changed.length = 0;
  bundle.changes.recorded.length = 0;
  bundle.readAudit.recorded.length = 0;
}

// ============================================================
// WASL AI — FOUNDATION BUILD 01 — privacy engine (experimental)
// ------------------------------------------------------------
// ⭐ This is a TESTABLE policy engine, not a legal policy.
// ⭐ The retention windows are synthetic configuration values used by
//   the tests. They are NOT approved retention periods.
// ⭐ Cancel / deactivate / delete are three different actions:
//   - cancel      : the subscription ends, data is retained or deleted
//                   according to the policy of the data class
//   - deactivate  : the tenant stops working, the data stays
//   - delete      : the data is removed after an explicit preview
// ⛔ Nothing here deletes real data: the engine only ever runs against
//   the synthetic local database.
// ============================================================

import type { UnitOfWork } from '../db/unit-of-work.ts';

export const DATA_CLASSES = ['standard', 'sensitive', 'regulated'] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

export const CANCEL_ACTIONS = ['retain', 'delete'] as const;
export type CancelAction = (typeof CANCEL_ACTIONS)[number];

export class PolicyError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'PolicyError';
    this.code = code;
  }
}

export interface RetentionPolicy {
  readonly dataClass: DataClass;
  readonly retentionDays: number;
  readonly onCancel: CancelAction;
}

export interface DeletionPreview {
  readonly requestId: string;
  readonly scope: string;
  readonly counts: Readonly<Record<string, number>>;
  readonly policies: readonly RetentionPolicy[];
  readonly notes: readonly string[];
}

export interface ExportBundle {
  readonly tenantId: string;
  readonly exportedAt: string;
  readonly customers: readonly Record<string, unknown>[];
  readonly conversations: readonly Record<string, unknown>[];
  readonly messages: readonly Record<string, unknown>[];
  readonly changes: readonly Record<string, unknown>[];
  readonly auditEvents: readonly Record<string, unknown>[];
  readonly retentionPolicies: readonly RetentionPolicy[];
}

function assertDataClass(value: unknown): DataClass {
  if (typeof value !== 'string' || !(DATA_CLASSES as readonly string[]).includes(value)) {
    throw new PolicyError('data_class_invalid', 'data class is outside the closed set');
  }
  return value as DataClass;
}

export async function listRetentionPolicies(
  uow: UnitOfWork,
): Promise<RetentionPolicy[]> {
  const result = await uow.query<{
    data_class: string;
    retention_days: number;
    on_cancel: string;
  }>(`select data_class, retention_days, on_cancel from retention_policies order by data_class asc`);
  return result.rows.map((row) => ({
    dataClass: row.data_class as DataClass,
    retentionDays: row.retention_days,
    onCancel: row.on_cancel === 'delete' ? 'delete' : 'retain',
  }));
}

export async function upsertRetentionPolicy(
  uow: UnitOfWork,
  tenantId: string,
  policy: RetentionPolicy,
): Promise<RetentionPolicy> {
  const dataClass = assertDataClass(policy.dataClass);
  if (!Number.isInteger(policy.retentionDays) || policy.retentionDays <= 0) {
    throw new PolicyError('retention_days_invalid', 'retention days must be a positive integer');
  }
  const onCancel: CancelAction = policy.onCancel === 'delete' ? 'delete' : 'retain';
  await uow.query(
    `insert into retention_policies (tenant_id, data_class, retention_days, on_cancel)
     values ($1,$2,$3,$4)
     on conflict (tenant_id, data_class) do update
        set retention_days = excluded.retention_days, on_cancel = excluded.on_cancel`,
    [tenantId, dataClass, policy.retentionDays, onCancel],
  );
  return { dataClass, retentionDays: policy.retentionDays, onCancel };
}

/** ⭐ Classify the tenant data and count the rows per table. */
export async function classifyTenantData(
  uow: UnitOfWork,
): Promise<Record<string, number>> {
  const tables = [
    'customers',
    'conversations',
    'messages',
    'conversation_changes',
    'read_audit_events',
    'audit_events',
    'sessions',
    'memberships',
  ] as const;
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const result = await uow.query<{ count: string }>(`select count(*)::text as count from ${table}`);
    counts[table] = Number(result.rows[0]?.count ?? '0');
  }
  return counts;
}

/** ⭐ Preview the effect of a deletion request. */
export async function previewDeletion(
  uow: UnitOfWork,
  tenantId: string,
  requestedBy: string,
  scope = 'tenant_data',
  requestId = `del_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
): Promise<DeletionPreview> {
  const counts = await classifyTenantData(uow);
  const policies = await listRetentionPolicies(uow);
  const notes: string[] = [
    'Backups are not touched by this operation: a restore can bring the rows back.',
    'Legal holds and statutory exceptions are NOT implemented and need a legal review before production.',
    'The audit trail survives a tenant_data deletion; a tenant_full deletion removes it with the tenant.',
  ];
  await uow.query(
    `insert into deletion_requests (id, tenant_id, requested_by, scope, status, preview)
     values ($1,$2,$3,$4,'previewed',$5::jsonb)`,
    [requestId, tenantId, requestedBy, scope, JSON.stringify({ counts, policies })],
  );
  return { requestId, scope, counts, policies, notes };
}

/**
 * ⭐ Execute a previously previewed deletion.
 * ⭐ The order respects the foreign keys.
 * ⛔ `tenant_full` removes the tenant row and with it the audit trail.
 */
export async function executeDeletion(
  uow: UnitOfWork,
  tenantId: string,
  requestId: string,
  executedBy: string,
): Promise<{ removed: Record<string, number> }> {
  const request = await uow.query<{ scope: string; status: string }>(
    `select scope, status from deletion_requests where id = $1`,
    [requestId],
  );
  const row = request.rows[0];
  if (!row) throw new PolicyError('deletion_request_unknown', 'deletion request is unknown');
  if (row.status === 'executed') {
    throw new PolicyError('deletion_already_executed', 'deletion request was already executed');
  }
  const scope = row.scope;

  const removed: Record<string, number> = {};
  const steps: readonly (readonly [string, string])[] = [
    ['sessions', 'delete from sessions where tenant_id = $1'],
    ['memberships', 'delete from memberships where tenant_id = $1'],
    ['messages', 'delete from messages where tenant_id = $1'],
    ['conversation_changes', 'delete from conversation_changes where tenant_id = $1'],
    ['read_audit_events', 'delete from read_audit_events where tenant_id = $1'],
    ['conversations', 'delete from conversations where tenant_id = $1'],
    ['customers', 'delete from customers where tenant_id = $1'],
  ];
  for (const [name, sql] of steps) {
    const result = await uow.query(sql, [tenantId]);
    removed[name] = result.rowCount;
  }

  if (scope === 'tenant_full') {
    const result = await uow.query(`delete from tenants where id = $1`, [tenantId]);
    removed['tenants'] = result.rowCount;
  } else {
    const result = await uow.query(`update tenants set status = 'deleted' where id = $1`, [tenantId]);
    removed['tenants'] = result.rowCount;
  }

  await uow.query(
    `update deletion_requests set status = 'executed', executed_at = now() where id = $1`,
    [requestId],
  );
  await uow.query(
    `insert into audit_events (tenant_id, actor_id, operation, result, detail)
     values ($1,$2,'privacy.delete','executed',$3::jsonb)`,
    [tenantId, executedBy, JSON.stringify({ requestId, scope, removed })],
  );
  return { removed };
}

/** ⭐ Export everything the tenant owns (synthetic data). */
export async function exportTenantData(uow: UnitOfWork, tenantId: string): Promise<ExportBundle> {
  const customers = await uow.query(`select * from customers order by id asc`);
  const conversations = await uow.query(`select * from conversations order by ref asc`);
  const messages = await uow.query(`select * from messages order by occurred_at asc`);
  const changes = await uow.query(`select * from conversation_changes order by id asc`);
  const auditEvents = await uow.query(`select * from audit_events order by id asc`);
  const policies = await listRetentionPolicies(uow);
  return {
    tenantId,
    exportedAt: new Date().toISOString(),
    customers: customers.rows,
    conversations: conversations.rows,
    messages: messages.rows,
    changes: changes.rows,
    auditEvents: auditEvents.rows,
    retentionPolicies: policies,
  };
}

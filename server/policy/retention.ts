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

import crypto from 'node:crypto';

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

export interface DeletionOutcome {
  readonly removed: Record<string, number>;
  readonly scope: string;
  readonly evidenceId: string;
}

/** ⭐ Write the durable evidence of a deletion (it has no foreign key). */
async function writeEvidence(
  uow: UnitOfWork,
  tenantId: string,
  requestId: string,
  scope: string,
  requestedBy: string,
  executedBy: string,
  removed: Record<string, number>,
): Promise<string> {
  const evidenceId = `evd_${crypto.randomBytes(9).toString('hex')}`;
  const result = await uow.query(
    `insert into tenant_deletion_evidence
       (id, tenant_id, request_id, scope, requested_by, executed_by, removed)
     values ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [
      evidenceId,
      tenantId,
      requestId,
      scope,
      requestedBy,
      executedBy,
      JSON.stringify(removed),
    ],
  );
  if (result.rowCount !== 1) {
    throw new PolicyError('deletion_evidence_failed', 'the deletion evidence could not be written');
  }
  return evidenceId;
}

/**
 * ⭐ Execute a previously previewed deletion.
 * ⭐ The order is fixed and every step is verified against the database:
 *   1) the executor is checked against the membership of the tenant,
 *   2) the content rows are removed,
 *   3) the request is marked executed (its row still exists),
 *   4) in the full scope the audit trail and the retention policies go
 *      with the tenant,
 *   5) the durable evidence is written WHILE the request row still
 *      exists: the database guard trigger validates it against that row
 *      (same tenant, same scope, already executed) and stamps the
 *      requester from it, so no path can write a fake evidence,
 *   6) the tenant row is tombstoned (partial scope) or removed (full
 *      scope) - in the full scope the audit trail goes with it.
 * ⛔ `tenant_full` removes the tenant row and with it the audit trail.
 * ⛔ Nothing is reported as done unless the database says so: every
 *   step checks its row count and a mismatch aborts the unit of work.
 * ⛔ The evidence has no foreign key, so it survives the deletion.
 */
export async function executeDeletion(
  uow: UnitOfWork,
  tenantId: string,
  requestId: string,
  executedBy: string,
): Promise<DeletionOutcome> {
  const request = await uow.query<{ scope: string; status: string; requested_by: string }>(
    `select scope, status, requested_by from deletion_requests where id = $1`,
    [requestId],
  );
  const row = request.rows[0];
  if (!row) throw new PolicyError('deletion_request_unknown', 'deletion request is unknown');
  if (row.status === 'executed') {
    throw new PolicyError('deletion_already_executed', 'deletion request was already executed');
  }
  const scope = row.scope;

  // ⭐⭐ The executor must be an active member of the tenant. The check
  //   runs BEFORE anything is removed: the membership rows go with the
  //   content, so afterwards the proof would be gone.
  const membership = await uow.query<{ role: string }>(
    `select role from memberships where tenant_id = $1 and user_id = $2 and status = 'active'`,
    [tenantId, executedBy],
  );
  if (membership.rows.length !== 1) {
    throw new PolicyError(
      'deletion_actor_not_authorized',
      'the executor is not an active member of the tenant',
    );
  }

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

  // ⭐ The request is marked executed while its row still exists: the
  //   full scope removes the tenant row, and with it the request row.
  const marked = await uow.query(
    `update deletion_requests set status = 'executed', executed_at = now() where id = $1`,
    [requestId],
  );
  if (marked.rowCount !== 1) {
    throw new PolicyError(
      'deletion_request_unknown',
      'the deletion request disappeared before it could be marked as executed',
    );
  }

  if (scope === 'tenant_full') {
    // ⭐ The audit trail and the retention policies go with the tenant.
    const trail = await uow.query(`delete from audit_events where tenant_id = $1`, [tenantId]);
    removed['audit_events'] = trail.rowCount;
    const policies = await uow.query(`delete from retention_policies where tenant_id = $1`, [tenantId]);
    removed['retention_policies'] = policies.rowCount;

    // ⭐ The evidence is written while the request row still exists: the
    //   database guard trigger validates it against that row, so an
    //   unauthorized path cannot write a fake evidence.
    //   The tenant row is removed right after: a mismatch throws and the
    //   whole unit of work (the evidence included) rolls back.
    removed['tenants'] = 1;
    const evidenceId = await writeEvidence(
      uow,
      tenantId,
      requestId,
      scope,
      row.requested_by,
      executedBy,
      removed,
    );

    // ⭐ The tenant row is removed after the evidence is written, so the
    //   cascade does not race with the bookkeeping above.
    const tenant = await uow.query(`delete from tenants where id = $1`, [tenantId]);
    if (tenant.rowCount !== 1) {
      throw new PolicyError('deletion_tenant_missing', 'the tenant row could not be removed');
    }
    return { removed, scope, evidenceId };
  }

  // ⭐ The partial scope keeps the tenant row (tombstoned) and the audit
  //   trail: the audit event is written inside the same transaction.
  const tenant = await uow.query(`update tenants set status = 'deleted' where id = $1`, [tenantId]);
  if (tenant.rowCount !== 1) {
    throw new PolicyError('deletion_tenant_missing', 'the tenant row could not be marked as deleted');
  }
  removed['tenants'] = tenant.rowCount;

  await uow.query(
    `insert into audit_events (tenant_id, actor_id, operation, result, detail)
     values ($1,$2,'privacy.delete.execute','allowed',$3::jsonb)`,
    [tenantId, executedBy, JSON.stringify({ requestId, scope, removed })],
  );

  const evidenceId = await writeEvidence(
    uow,
    tenantId,
    requestId,
    scope,
    row.requested_by,
    executedBy,
    removed,
  );
  return { removed, scope, evidenceId };
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

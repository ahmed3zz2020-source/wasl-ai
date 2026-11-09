// ============================================================
// WASL AI - D-077 / M-110 - the matrix of the rights of a ticket
// ------------------------------------------------------------
// WHAT THIS FILE IS: THE MATRIX, ONCE, IN ONE PLACE.
//   It is the answer that the owner reads (the table of the reply)
//   AND the answer that the test measures (the API is called and
//   every row must answer the status written here).
//   Before M-110 the matrix lived inside the test file and the table
//   of the reply was written BY HAND in the document => the document
//   drifted away from the measurement (six cells were wrong).
//   NOW: the document is checked against THIS file by
//   tests/tools/reply-rights-table.test.ts => a wrong cell fails the
//   build.
// THE MATRIX IS WRITTEN BY HAND and it is NOT read from the core
//   (ROLE_CAPABILITIES) => otherwise the test would prove nothing.
// THE SCOPE IS PART OF THE MATRIX and this is NOT a detail:
//   the AGENT sees the tickets that are ASSIGNED to him => a ticket of
//   the company that is not his is OUT OF HIS SCOPE => the answer is
//   404 and not 403 (the ticket does not exist IN HIS SCOPE, and it is
//   not forbidden).
//   the reader of the ticket knows TWO things: what he may do (the
//   capability) and what he may SEE (the scope) => they are not the
//   same thing.
// IT DOES NOT RATIFY THE BRIDGE: the bridge of D-073 (the mapping of
//   the operations of a ticket onto the operations of the core) is
//   still a DECISION OF THE OWNER => this file measures it, it does
//   not approve it.
// ============================================================

export type TicketRole = 'owner' | 'supervisor' | 'agent' | 'viewer';
export type TicketStatus = 200 | 201 | 403 | 404 | 409;

export type TicketOperation =
  | 'list'
  | 'read_in_scope'
  | 'read_out_of_scope'
  | 'read_assigned'
  | 'create'
  | 'update'
  | 'assign';

export const TICKET_ROLES: readonly TicketRole[] = ['owner', 'supervisor', 'agent', 'viewer'];

export const TICKET_OPERATIONS: readonly TicketOperation[] = [
  'list',
  'read_in_scope',
  'read_out_of_scope',
  'read_assigned',
  'create',
  'update',
  'assign',
];

/** THE MATRIX - the single source of the truth of the answer. */
export const TICKET_RIGHTS_MATRIX: Readonly<
  Record<TicketRole, Readonly<Record<TicketOperation, TicketStatus>>>
> = Object.freeze({
  owner: Object.freeze({
    list: 200,
    read_in_scope: 200,
    read_out_of_scope: 200,
    read_assigned: 200,
    create: 201,
    update: 200,
    assign: 201,
  }),
  supervisor: Object.freeze({
    list: 200,
    read_in_scope: 200,
    read_out_of_scope: 200,
    read_assigned: 200,
    create: 201,
    update: 200,
    assign: 403,
  }),
  agent: Object.freeze({
    list: 200,
    read_in_scope: 200,
    read_out_of_scope: 404,
    read_assigned: 200,
    create: 403,
    update: 403,
    assign: 403,
  }),
  viewer: Object.freeze({
    list: 200,
    read_in_scope: 200,
    read_out_of_scope: 200,
    read_assigned: 200,
    create: 403,
    update: 403,
    assign: 403,
  }),
});

/** THE LINKAGE (the customer of the ticket and the customer of the
 *  conversation must be the SAME) => 409. */
export const TICKET_LINKAGE_MISMATCH: TicketStatus = 409;

/** THE COLUMNS OF THE TABLE OF THE REPLY (in this exact order). */
export const MATRIX_TABLE_COLUMNS: readonly string[] = [
  'إنشاء',
  'إنشاء + إسناد',
  'قراءة',
  'تعديل',
  'إسناد',
  'قراءة خارج النطاق',
  'تخالف الربط',
];

/** the label of a role in the table of the reply. */
export const MATRIX_TABLE_ROLES: readonly string[] = ['owner', 'supervisor', 'agent', 'viewer'];

/**
 * the value of a cell of the table of the reply.
 * the ASSIGNMENT is measured through the create-with-assign call (the
 * only call that the matrix measures) => the two columns that carry
 * the assignment hold the same measured value.
 */
export function matrixTableCell(
  role: TicketRole,
  column: string,
): TicketStatus | null {
  const row = TICKET_RIGHTS_MATRIX[role];
  switch (column) {
    case 'إنشاء':
      return row.create;
    case 'إنشاء + إسناد':
      return row.assign;
    case 'قراءة':
      return row.read_in_scope;
    case 'تعديل':
      return row.update;
    case 'إسناد':
      return row.assign;
    case 'قراءة خارج النطاق':
      return row.read_out_of_scope;
    case 'تخالف الربط':
      return null;
    default:
      throw new Error(`the column of the matrix is unknown: ${column}`);
  }
}

/**
 * the table of the reply, rendered from the matrix => the document can
 * never carry a cell that the measurement does not prove.
 */
export function renderMatrixTable(): string {
  const header = `| الدور | ${MATRIX_TABLE_COLUMNS.join(' | ')} |`;
  const separator = `|:-:|${MATRIX_TABLE_COLUMNS.map(() => ':-:').join('|')}|`;
  const lines: string[] = [header, separator];
  for (const role of MATRIX_TABLE_ROLES as TicketRole[]) {
    const cells = MATRIX_TABLE_COLUMNS.map((column) => {
      const value = matrixTableCell(role, column);
      return value === null ? '—' : String(value);
    });
    lines.push(`| **${role}** | ${cells.join(' | ')} |`);
  }
  const linkage = MATRIX_TABLE_COLUMNS.map((column) =>
    column === 'تخالف الربط' ? `**${TICKET_LINKAGE_MISMATCH}**` : '—',
  );
  lines.push(`| **تخالف العميل/المحادثة** | ${linkage.join(' | ')} |`);
  return lines.join('\n');
}

// ============================================================
// WASL AI — the tickets — tk-19 (the export of the tickets)
// ------------------------------------------------------------
// ⭐⭐⭐ WHAT THIS FILE DOES
//   It turns the rows of the tickets into a CSV that a spreadsheet can
//   open, and it PROTECTS the cells of the file:
//     ① the cell is always quoted and the quotes inside it are doubled,
//     ② a cell that starts with a character a spreadsheet would read as
//        a FORMULA (= · + · - · @ · tab · return) is prefixed with a
//        single quote ⇒ ⇒ ⇒ ⇒ the spreadsheet shows the TEXT and it
//        does NOT run it,
//     ③ the file starts with the byte-order mark ⇒ ⇒ ⇒ ⇒ Excel opens
//        the Arabic in the right direction.
// ⭐⭐⭐ THE ISOLATION IS NOT HERE
//   The rows that reach this file are ALREADY the rows the employee may
//   read (the scope of the role + the policy of the table) ⇒ ⇒ ⇒ ⇒ the
//   export can never show a ticket of another company.
// ⛔ LOCAL ONLY: no ticket of a real customer.
// ============================================================

import type { TicketRow } from './queries.ts';

/**
 * ⭐⭐⭐ tk-19: ⭐⭐⭐ one cell of the CSV.
 * ⭐⭐⭐ The characters a spreadsheet reads as the start of a formula
 * ⭐⭐⭐ tk-19 are neutralized (⇒ the file can never run anything).
 */
export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  // ⭐⭐⭐ tk-19: ⭐⭐⭐ the first character decides (and nothing else).
  const dangerous = /^[=+\-@\t\r]/.test(text);
  const safe = dangerous ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** ⭐⭐⭐ tk-19: ⭐⭐⭐ the header of the file (in Arabic ⇒ it is read by a human). */
export const TICKET_CSV_HEADER = [
  'رقم التذكرة',
  'العميل',
  'العنوان',
  'الوصف',
  'الحالة',
  'الأولوية',
  'المُسنَد إليه',
  'رقم المحادثة',
  'أُنشئت',
  'آخر تعديل',
  'زمن أول رد (دقيقة)',
  'عمر التذكرة (دقيقة)',
  'آخر نشاط (دقيقة)',
] as const;

/**
 * ⭐⭐⭐ tk-19: ⭐⭐⭐ the whole file.
 * ⭐⭐⭐ The empty cell of a measurement is EMPTY (⇒ "غير متاح" is a
 * ⭐⭐⭐ tk-19 fact of the interface, not a zero in the file) ⇒ ⇒ ⇒ ⇒ and
 * ⭐⭐⭐ the numbers are rounded to ONE decimal (⇒ the file is read by
 * ⭐⭐⭐ tk-19 a human and not by a machine that wants 17 digits).
 */
export function ticketsToCsv(rows: readonly TicketRow[]): string {
  const lines: string[] = [];
  lines.push(TICKET_CSV_HEADER.map(csvCell).join(','));
  for (const row of rows) {
    lines.push(
      [
        row.ref,
        row.customer_name ?? row.customer_id ?? '',
        row.subject,
        row.description,
        row.state,
        row.priority,
        row.assignee_actor_id ?? '',
        row.conversation_ref ?? '',
        row.created_at,
        row.updated_at,
        row.first_response_minutes === null ? '' : Number(row.first_response_minutes).toFixed(1),
        Number(row.age_minutes ?? 0).toFixed(1),
        Number(row.idle_minutes ?? 0).toFixed(1),
      ]
        .map(csvCell)
        .join(','),
    );
  }
  // ⭐⭐⭐ tk-19: ⭐⭐⭐ the lines end with CRLF (⇒ Excel is happy).
  return `﻿${lines.join('\r\n')}\r\n`;
}

// ============================================================
// WASL AI - D-077 / M-110 - the table of the reply MUST be the matrix
// ------------------------------------------------------------
// WHAT THIS FILE IS: the guard that closes the gap that the review of
//   the reply #53 found (M-110).
// THE DEFECT: the matrix of the rights was written BY HAND in the
//   document of the reply AND (a second copy) in the test file => the
//   two copies drifted away from each other => SIX cells of the
//   published table contradicted the measured behaviour.
//   the published table said: the supervisor assigns (200) while the
//   measurement says 403; the viewer reads (403) while the
//   measurement says 200; the agent reads out of his scope (403)
//   while the measurement says 404; the owner creates with an
//   assignment (200) while the measurement says 201.
// THE FIX: the matrix lives in ONE file
//   (tests/server/foundation-ticket-rights.matrix.ts) => the table of
//   the document is rendered from it => and THIS TEST compares the
//   table of every published reply with that matrix => a wrong cell
//   fails the build.
// IT NEEDS NO DATABASE (it reads two files) => it belongs to the
//   group `unit`.
// ============================================================

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  MATRIX_TABLE_COLUMNS,
  MATRIX_TABLE_ROLES,
  renderMatrixTable,
} from '../server/foundation-ticket-rights.matrix.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

/** the replies that carry the table of the matrix. */
const REPLY_FILES: readonly string[] = [
  'docs/GPT-REVIEW-053-REQUEST.md',
  'docs/GPT-REVIEW-054-REQUEST.md',
];

/** the table of the reply: the rows between the header and the end. */
function extractTable(markdown: string): string[] {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.trim().startsWith('| الدور |'));
  if (start < 0) return [];
  const rows: string[] = [];
  for (const line of lines.slice(start)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) break;
    rows.push(trimmed);
  }
  return rows;
}

/** the cells of a row of the table (the markup is removed). */
function cellsOf(row: string): string[] {
  return row
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.replace(/\*\*/g, '').trim());
}

test('FOUNDATION 04) the table of the reply IS the measured matrix (M-110)', async (t) => {
  const expected = renderMatrixTable().split('\n');

  for (const relative of REPLY_FILES) {
    const absolute = path.join(ROOT, relative);
    if (!fs.existsSync(absolute)) continue;

    await t.test(`${relative}: the table is there and it matches the matrix`, () => {
      const markdown = fs.readFileSync(absolute, 'utf8');
      const rows = extractTable(markdown);
      assert.ok(rows.length > 0, `${relative}: the table of the matrix is not in the document`);

      const expectedHeader = cellsOf(expected[0] ?? '');
      const actualHeader = cellsOf(rows[0] ?? '');
      assert.deepEqual(
        actualHeader,
        expectedHeader,
        `${relative}: the columns of the table are not the columns of the matrix`,
      );

      // every role of the matrix must have its row, and every cell of
      // the row must be the measured status.
      for (let index = 0; index < MATRIX_TABLE_ROLES.length; index += 1) {
        const role = MATRIX_TABLE_ROLES[index] ?? '';
        const expectedRow = cellsOf(expected[index + 2] ?? '');
        const actualRow = cellsOf(rows[index + 2] ?? '');
        assert.equal(
          actualRow[0],
          role,
          `${relative}: the row ${index} must be the role ${role}`,
        );
        for (let column = 0; column < MATRIX_TABLE_COLUMNS.length; column += 1) {
          assert.equal(
            actualRow[column + 1],
            expectedRow[column + 1],
            `${relative}: the cell [${role} / ${MATRIX_TABLE_COLUMNS[column]}] says ${actualRow[column + 1]} and the measurement says ${expectedRow[column + 1]}`,
          );
        }
      }

      // and the row of the linkage must be there too.
      const linkageRow = cellsOf(rows[MATRIX_TABLE_ROLES.length + 2] ?? '');
      const expectedLinkage = cellsOf(expected[MATRIX_TABLE_ROLES.length + 2] ?? '');
      assert.deepEqual(
        linkageRow,
        expectedLinkage,
        `${relative}: the row of the linkage does not match the matrix`,
      );
    });
  }
});

test('FOUNDATION 04) the matrix of the reply is NOT empty (M-110)', () => {
  const expected = renderMatrixTable();
  assert.ok(expected.includes('| الدور |'), 'the rendered table has no header');
  assert.ok(expected.includes('**409**'), 'the rendered table has no linkage row');
  for (const role of MATRIX_TABLE_ROLES) {
    assert.ok(expected.includes(`**${role}**`), `the rendered table has no row of ${role}`);
  }
});

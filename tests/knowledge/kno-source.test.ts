// ============================================================
// WASL AI — الموجة الثالثة (W3) · اختبار القبول ③
// ⭐ `kno-source` — مصدر المعرفة.
// ------------------------------------------------------------
// ⭐⭐⭐ WHAT THIS FILE PROVES
//   ① EVERY hit carries its source ⇒ the file · the section · the
//      line ⇒ and there is no hit without one,
//   ② the line of the source is REAL ⇒ the test opens the file on the
//      disk and reads the lines of the source ⇒ ⇒ so the citation
//      points at the text it claims,
//   ③ the section of the source is a section of the document,
//   ④ the answer is QUOTED ⇒ the text of the answer is the text of the
//      file and nothing else ⇒ ⇒ so nobody can invent a sentence.
// ⛔ Local files only · ⛔ no database · ⛔ no network.
// ============================================================

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { answer, formatSource } from '../../server/knowledge/answer.ts';
import { buildKnowledgeIndex } from '../../server/knowledge/index.ts';
import { retrieve } from '../../server/knowledge/retriever.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KNOWLEDGE = join(REPO, 'knowledge');

const index = buildKnowledgeIndex(KNOWLEDGE);

/** ⭐ The lines of the file ⇒ and it is the real file on the disk. */
function linesOf(file: string): string[] {
  return readFileSync(join(KNOWLEDGE, file), 'utf8').split(/\r?\n/);
}

test('every hit carries a source and the source points at the real text', () => {
  const result = retrieve(index, 'كيف أردّ على العميل؟', { topK: 5 });
  assert.equal(result.status, 'answered');
  assert.ok(result.hits.length > 0);

  for (const hit of result.hits) {
    const source = hit.chunk.source;
    assert.ok(source.file.endsWith('.md'), 'the source must name the file');
    assert.ok(source.section.trim() !== '', 'the source must name the section');
    assert.ok(source.line >= 1 && source.endLine <= linesOf(source.file).length);

    // ⭐⭐⭐ the lines of the source really carry the text of the chunk.
    const fromTheDisk = linesOf(source.file)
      .slice(source.line - 1, source.endLine)
      .join('\n')
      .trim();
    assert.equal(
      fromTheDisk,
      hit.chunk.text,
      `the source of the chunk must point at its text in the file ${source.file}`,
    );
  }
});

test('the section of the source is a section of the document', () => {
  const result = retrieve(index, 'ما هي مدة الاحتفاظ بالبيانات؟');
  const best = result.hits[0]!;
  const document = index.documents.find((candidate) => candidate.file === best.chunk.source.file);
  assert.ok(document, 'the document of the source must exist in the index');
  const titles = document.sections.map((section) => section.title);
  assert.ok(titles.includes(best.chunk.source.section), 'the section of the source must be real');
  assert.equal(best.chunk.source.title, document.title);
});

test('the locator of the source names the file and the line', () => {
  const result = retrieve(index, 'كيف أصدّر التذاكر؟');
  const best = result.hits[0]!;
  const locator = best.chunk.source.locator;
  assert.ok(locator.includes(best.chunk.source.file), 'the locator must name the file');
  assert.ok(locator.endsWith(`:${best.chunk.source.line}`), 'the locator must carry the line');
  assert.ok(formatSource(best.chunk.source).includes(best.chunk.source.file));
});

test('the answer is quoted and every source of it is declared', () => {
  const result = answer(index, 'ما هي مدة الاحتفاظ بالبيانات؟');
  assert.equal(result.status, 'answered');
  assert.ok(result.sources.length > 0, 'the answer must carry its sources');
  assert.equal(result.sources.length, result.hits.length);

  for (const hit of result.hits) {
    assert.ok(
      result.text.includes(hit.chunk.text),
      'the answer must carry the text of the chunk verbatim',
    );
    assert.ok(
      result.text.includes(formatSource(hit.chunk.source)),
      'the answer must declare the source of the chunk',
    );
  }
});

test('the answer carries no sentence that is not in the index', () => {
  const result = answer(index, 'كيف أُسند محادثة إلى موظف؟');
  assert.equal(result.status, 'answered');
  // ⭐ every line of the answer is either a chunk text or a source line.
  for (const line of result.text.split('\n')) {
    if (line.trim() === '') continue;
    const isQuote = result.hits.some((hit) => hit.chunk.text.includes(line.trim()));
    const isSource = result.hits.some((hit) =>
      line.includes(formatSource(hit.chunk.source)),
    );
    assert.ok(isQuote || isSource, `the answer carries a line that is not in the index: ${line}`);
  }
});

test('the answer of a question without an answer carries no source at all', () => {
  const result = answer(index, 'ما هو ارتفاع برج في طور؟');
  assert.equal(result.status, 'refused');
  assert.equal(result.sources.length, 0);
  assert.equal(result.text, 'لا إجابة في الفهرس');
});

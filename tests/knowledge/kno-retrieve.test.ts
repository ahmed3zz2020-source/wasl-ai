// ============================================================
// WASL AI — الموجة الثالثة (W3) · اختبار القبول ②
// ⭐ `kno-retrieve` — استرجاع المعرفة.
// ------------------------------------------------------------
// ⭐⭐⭐ WHAT THIS FILE PROVES
//   ① a REAL Arabic question brings the RIGHT chunk ⇒ and the test
//      checks the section and the text of the chunk ⇒ not only that
//      something came back,
//   ② the hits are ordered by their score ⇒ and the score is between
//      0 and 1,
//   ③ the matched terms are really the terms of the question,
//   ④ the search is a SEARCH and not a scan of everything ⇒ the hits
//      carry only the chunks that carry the terms of the question.
// ⛔ Local files only · ⛔ no database · ⛔ no network · ⛔ no external
//    service · ⛔ no model of any kind.
// ============================================================

import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { normalizeArabicToken } from '../../server/knowledge/arabic.ts';
import { buildKnowledgeIndex } from '../../server/knowledge/index.ts';
import { retrieve } from '../../server/knowledge/retriever.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KNOWLEDGE = join(REPO, 'knowledge');

const index = buildKnowledgeIndex(KNOWLEDGE);

test('a real Arabic question brings the right chunk', () => {
  const result = retrieve(index, 'كيف أُسند محادثة إلى موظف؟');
  assert.equal(result.status, 'answered');
  assert.ok(result.hits.length > 0, 'the question must bring at least one chunk');

  const best = result.hits[0]!;
  assert.match(normalizeArabicToken(best.chunk.source.section), /اسناد|اسند/);
  assert.match(best.chunk.text, /الإسناد/);
  assert.match(best.chunk.source.file, /الأسئلة-الشائعة|دليل-المنتج/);
});

test('a question about the retention brings the section of the retention', () => {
  const result = retrieve(index, 'ما هي مدة الاحتفاظ بالبيانات؟');
  assert.equal(result.status, 'answered');
  const best = result.hits[0]!;
  assert.equal(best.chunk.source.file, 'سياسة-الخدمة.md');
  assert.equal(best.chunk.source.section, 'مدة الاحتفاظ بالبيانات');
  assert.match(best.chunk.text, /الاحتفاظ/);
});

test('a question about the export brings the section of the export', () => {
  const result = retrieve(index, 'كيف أصدّر التذاكر؟');
  assert.equal(result.status, 'answered');
  const best = result.hits[0]!;
  assert.equal(best.chunk.source.file, 'الأسئلة-الشائعة.md');
  assert.equal(best.chunk.source.section, 'كيف أصدّر التذاكر؟');
});

test('the hits are ordered by their score and the score is between 0 and 1', () => {
  const result = retrieve(index, 'كيف أردّ على العميل؟', { topK: 5 });
  assert.equal(result.status, 'answered');
  assert.ok(result.hits.length > 1, 'the question must bring more than one chunk');
  for (let index_ = 0; index_ < result.hits.length; index_ += 1) {
    const hit = result.hits[index_]!;
    assert.ok(hit.score > 0 && hit.score <= 1, `the score ${hit.score} must be inside (0, 1]`);
    if (index_ > 0) {
      assert.ok(
        result.hits[index_ - 1]!.score >= hit.score,
        'the hits must be ordered by their score',
      );
    }
  }
});

test('the matched terms are really the terms of the question', () => {
  const result = retrieve(index, 'ما هي مدة الاحتفاظ بالبيانات؟');
  assert.equal(result.status, 'answered');
  for (const term of result.matchedTerms) {
    assert.ok(result.queryTerms.includes(term), `the term ${term} must be a term of the question`);
  }
  const best = result.hits[0]!;
  assert.ok(best.matchedTerms.length > 0, 'the hit must declare the terms it matched');
  for (const term of best.matchedTerms) {
    assert.ok(result.queryTerms.includes(term), `the matched term ${term} must be a term of the question`);
  }
});

test('the search is a search and not a scan of everything', () => {
  const result = retrieve(index, 'كيف أُسند محادثة إلى موظف؟');
  assert.equal(result.status, 'answered');
  assert.ok(
    result.hits.length < index.chunkCount,
    'the hits must be fewer than the chunks of the index',
  );
  for (const hit of result.hits) {
    assert.ok(hit.coverage > 0, 'every hit must carry at least one term of the question');
    assert.ok(hit.coverage <= 1, 'the coverage must be a share and not more than one');
  }
});

test('the number of the hits follows the option of the caller', () => {
  const one = retrieve(index, 'كيف أردّ على العميل؟', { topK: 1 });
  const many = retrieve(index, 'كيف أردّ على العميل؟', { topK: 3 });
  assert.equal(one.hits.length, 1);
  assert.ok(many.hits.length >= one.hits.length);
  assert.equal(one.hits[0]!.chunk.id, many.hits[0]!.chunk.id);
});

// ============================================================
// WASL AI — الموجة الثالثة (W3) · اختبار القبول ④
// ⭐ الرفض الصريح — «لا إجابة في الفهرس».
// ------------------------------------------------------------
// ⭐⭐⭐ WHAT THIS FILE PROVES
//   ① a question that the index does not hold ⇒ the answer is EXACTLY
//      «لا إجابة في الفهرس» ⇒ and not the best fake result,
//   ② the refusal carries NO source and NO text ⇒ because there is
//      nothing to cite,
//   ③ the refusal explains WHY ⇒ so the person knows whether the
//      question is unknown or the index is empty,
//   ④ an empty question and a question of function words only are
//      refused too.
// ⛔ Local files only · ⛔ no database · ⛔ no network.
// ============================================================

import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { answer } from '../../server/knowledge/answer.ts';
import { buildKnowledgeIndex } from '../../server/knowledge/index.ts';
import { NO_ANSWER_TEXT, retrieve } from '../../server/knowledge/retriever.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KNOWLEDGE = join(REPO, 'knowledge');

const index = buildKnowledgeIndex(KNOWLEDGE);

test('a question that the index does not hold is refused', () => {
  const result = retrieve(index, 'ما هو ارتفاع برج في طور؟');
  assert.equal(result.status, 'refused');
  assert.equal(result.hits.length, 0);
  assert.ok(result.reason !== '', 'the refusal must say why');
});

test('the refusal is exactly «لا إجابة في الفهرس» and it carries no source', () => {
  const result = answer(index, 'ما هو ارتفاع برج في طور؟');
  assert.equal(result.status, 'refused');
  assert.equal(result.text, 'لا إجابة في الفهرس');
  assert.equal(result.text, NO_ANSWER_TEXT);
  assert.equal(result.sources.length, 0);
  assert.equal(result.hits.length, 0);
});

test('a question of another field is refused too', () => {
  for (const question of [
    'كيف أُصلح عطل الميكروويف الميتال؟',
    'ما هو سعر تأجير دراجة نارية في المدينة؟',
    'ما هي درجات الحرارة المتوقعة غداً؟',
  ]) {
    const result = answer(index, question);
    assert.equal(result.status, 'refused', `the question must be refused: ${question}`);
    assert.equal(result.text, NO_ANSWER_TEXT);
    assert.equal(result.sources.length, 0);
  }
});

test('an empty question is refused with a reason', () => {
  const result = retrieve(index, '');
  assert.equal(result.status, 'refused');
  assert.match(result.reason, /كلمات دالة/);
});

test('a question of function words only is refused', () => {
  const result = retrieve(index, 'ما هو هذا الذي في من على إلى؟');
  assert.equal(result.status, 'refused');
  assert.match(result.reason, /كلمات دالة|مفيش كلمة/);
});

test('the refusal never carries a chunk of the index', () => {
  const result = retrieve(index, 'ما هو ارتفاع برج في طور؟');
  assert.equal(result.hits.length, 0);
  assert.equal(result.matchedTerms.length, 0);
});

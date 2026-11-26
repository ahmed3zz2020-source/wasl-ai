// ============================================================
// WASL AI — الموجة الثالثة (W3) · اختبار القبول ⑥
// ⭐ التطبيع العربي — «العملاء» = «العميل».
// ------------------------------------------------------------
// ⭐⭐⭐ WHAT THIS FILE PROVES
//   ① the normalisation folds the word «العملاء» onto the word
//      «العميل» ⇒ ⇒ and the question that says «العملاء» gives the
//      SAME result as the question that says «العميل»,
//   ② the diacritics do not change the word,
//   ③ the variants of the alef and of the ya and of the ta marbuta do
//      not change the word,
//   ④ the definition article and the glued preposition do not change
//      the word,
//   ⑤ the function words are dropped from the question.
// ⛔ Local files only · ⛔ no database · ⛔ no network.
// ============================================================

import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { normalizeArabic, normalizeArabicToken, tokenizeArabic } from '../../server/knowledge/arabic.ts';
import { buildKnowledgeIndex } from '../../server/knowledge/index.ts';
import { retrieve } from '../../server/knowledge/retriever.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KNOWLEDGE = join(REPO, 'knowledge');

const index = buildKnowledgeIndex(KNOWLEDGE);

test('«العملاء» and «العميل» are one word', () => {
  assert.equal(normalizeArabicToken('العملاء'), normalizeArabicToken('العميل'));
  assert.equal(normalizeArabicToken('العملاء'), 'عميل');
});

test('the question that says «العملاء» gives the same result as «العميل»', () => {
  const plural = retrieve(index, 'ما هي بيانات العملاء؟');
  const singular = retrieve(index, 'ما هي بيانات العميل؟');
  assert.equal(plural.status, 'answered');
  assert.equal(singular.status, 'answered');
  assert.deepEqual(plural.queryTerms, singular.queryTerms);
  assert.deepEqual(plural.hits, singular.hits);
  assert.equal(plural.hits[0]!.chunk.id, singular.hits[0]!.chunk.id);
});

test('the diacritics do not change the word', () => {
  assert.equal(normalizeArabicToken('المُوظَّف'), normalizeArabicToken('الموظف'));
  assert.equal(normalizeArabicToken('العَميل'), normalizeArabicToken('العميل'));
  assert.equal(normalizeArabicToken('إسْنَاد'), normalizeArabicToken('إسناد'));
  assert.equal(normalizeArabic('محاسَبة'), 'محاسبه');
});

test('the variants of the alef and of the ya do not change the word', () => {
  assert.equal(normalizeArabicToken('إسناد'), normalizeArabicToken('اسناد'));
  assert.equal(normalizeArabicToken('أسناد'), normalizeArabicToken('إسناد'));
  assert.equal(normalizeArabicToken('مستوي'), normalizeArabicToken('مستوى'));
});

test('the ta marbuta does not change the word', () => {
  assert.equal(normalizeArabicToken('خدمة'), normalizeArabicToken('خدمه'));
  assert.equal(normalizeArabicToken('محادثة'), normalizeArabicToken('المحادثات'));
  assert.equal(normalizeArabicToken('رسالة'), normalizeArabicToken('الرسائل'));
});

test('the definition article and the glued preposition do not change the word', () => {
  assert.equal(normalizeArabicToken('الموظف'), normalizeArabicToken('موظف'));
  assert.equal(normalizeArabicToken('الموظفين'), normalizeArabicToken('موظف'));
  assert.equal(normalizeArabicToken('بالموظف'), normalizeArabicToken('الموظف'));
  assert.equal(normalizeArabicToken('لالموظف'), normalizeArabicToken('موظف'));
  assert.equal(normalizeArabicToken('بالبيانات'), normalizeArabicToken('البيانات'));
});

test('the function words are dropped from the question', () => {
  const tokens = tokenizeArabic('ما هو وقت الرد على العميل؟');
  assert.ok(tokens.includes('وقت'));
  assert.ok(tokens.includes('عميل'));
  assert.ok(!tokens.includes('ما'));
  assert.ok(!tokens.includes('هو'));
  assert.ok(!tokens.includes('في'));
  assert.ok(!tokens.includes('على'));
});

test('the normalisation keeps the numbers and drops the punctuation', () => {
  assert.equal(normalizeArabic('آخر ٣ أيام، من ١٠ إلى ١٢'), 'اخر 3 ايام من 10 الي 12');
});

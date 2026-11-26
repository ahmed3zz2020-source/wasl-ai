// ============================================================
// WASL AI — الموجة الثالثة (W3) · اختبار القبول ⑤
// ⭐ الحتمية — نفس السؤال ⇒ نفس النتيجة.
// ------------------------------------------------------------
// ⭐⭐⭐ WHAT THIS FILE PROVES
//   ① the same question on the same index ⇒ the SAME hits, with the
//      SAME scores and in the SAME order ⇒ always ⇒ so the answer of
//      the service never changes from one moment to the next,
//   ② building the index twice from the same folder ⇒ the same
//      documents, the same chunks and the same vocabulary,
//   ③ the order of the words of the question does not change the
//      winner ⇒ only the meaning matters.
// ⛔ Local files only · ⛔ no database · ⛔ no network.
// ============================================================

import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { buildKnowledgeIndex } from '../../server/knowledge/index.ts';
import { answer } from '../../server/knowledge/answer.ts';
import { retrieve } from '../../server/knowledge/retriever.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KNOWLEDGE = join(REPO, 'knowledge');

const index = buildKnowledgeIndex(KNOWLEDGE);

test('the same question gives the same result', () => {
  const question = 'كيف أُسند محادثة إلى موظف؟';
  const first = retrieve(index, question);
  const second = retrieve(index, question);
  assert.deepEqual(second, first);
  assert.equal(second.status, 'answered');
});

test('the same question gives the same answer, word for word', () => {
  const question = 'ما هي مدة الاحتفاظ بالبيانات؟';
  const first = answer(index, question);
  const second = answer(index, question);
  assert.equal(second.text, first.text);
  assert.deepEqual(second.sources, first.sources);
});

test('the same question gives the same result in a fresh index', () => {
  const question = 'كيف أردّ على العميل؟';
  const other = buildKnowledgeIndex(KNOWLEDGE);
  const first = retrieve(index, question);
  const second = retrieve(other, question);
  assert.deepEqual(second.hits, first.hits);
});

test('the index built twice from the same folder is the same index', () => {
  const first = buildKnowledgeIndex(KNOWLEDGE);
  const second = buildKnowledgeIndex(KNOWLEDGE);
  assert.equal(second.documentCount, first.documentCount);
  assert.equal(second.chunkCount, first.chunkCount);
  assert.deepEqual(
    second.chunks.map((chunk) => chunk.id),
    first.chunks.map((chunk) => chunk.id),
  );
  assert.deepEqual(
    [...second.vocabulary.entries()].sort(),
    [...first.vocabulary.entries()].sort(),
  );
  assert.deepEqual(
    second.documents.map((document) => document.file),
    first.documents.map((document) => document.file),
  );
});

test('the order of the words of the question does not change the winner', () => {
  const first = retrieve(index, 'كيف أُسند محادثة إلى موظف؟');
  const second = retrieve(index, 'موظف إلى محادثة أُسند كيف؟');
  assert.equal(second.status, 'answered');
  assert.equal(second.hits[0]!.chunk.id, first.hits[0]!.chunk.id);
  assert.deepEqual(second.hits, first.hits);
});

test('the two spellings of the same word give the same result', () => {
  const noun = retrieve(index, 'كيف أُسند محادثة إلى موظف؟');
  const verb = retrieve(index, 'موظف إلى محادثة إسناد كيف؟');
  assert.deepEqual(verb.hits, noun.hits);
});

test('the refusal of a question without an answer is the same every time', () => {
  const first = retrieve(index, 'ما هو ارتفاع برج في طور؟');
  const second = retrieve(index, 'ما هو ارتفاع برج في طور؟');
  assert.deepEqual(second, first);
  assert.equal(second.status, 'refused');
});

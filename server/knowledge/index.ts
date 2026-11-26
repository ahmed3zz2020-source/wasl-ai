// ============================================================
// WASL AI — الموجة الثالثة (W3) · وحدة المعرفة
// ------------------------------------------------------------
// ⭐⭐⭐ السطح العام لوحدة المعرفة.
// ------------------------------------------------------------
// ⭐ WHAT THIS SURFACE IS
//   three capabilities and nothing else:
//     ① `kno-index`    ⇒ the index of a directory of files,
//     ② `kno-retrieve` ⇒ the chunks that answer a question, with their
//        scores,
//     ③ `kno-source`   ⇒ the answer with its sources declared.
// ⭐⭐ THE CONTRACT (the caller keeps it)
//   - the caller gives a question and gets an answer OR a refusal,
//   - the answer is quoted and every source is declared,
//   - the same question on the same index always gives the same answer,
//   - nothing is written and nothing is called outside.
// ⛔ It does not import from `src/core/` · ⛔ no database · ⛔ no network.
// ============================================================

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildKnowledgeIndex } from './index-builder.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * ⭐⭐⭐ the default directory of the knowledge ⇒ the folder
 * `knowledge/` at the root of the project ⇒ ⇒ and it is the default
 * only ⇒ ⇒ a caller may build the index of another folder ⇒ ⇒ and
 * that is how the isolation between the companies is done (one folder
 * per company).
 */
export const KNOWLEDGE_DIRECTORY = resolve(HERE, '..', '..', 'knowledge');

/** ⭐⭐⭐ the index of the default directory ⇒ built when it is asked for. */
export function buildDefaultKnowledgeIndex(): ReturnType<typeof buildKnowledgeIndex> {
  return buildKnowledgeIndex(KNOWLEDGE_DIRECTORY);
}

export { buildKnowledgeIndex, describeIndex, listKnowledgeFiles } from './index-builder.ts';
export { parseKnowledgeFile } from './parser.ts';
export {
  ARABIC_STOPWORDS,
  countTerms,
  isStopword,
  normalizeArabic,
  normalizeArabicToken,
  tokenizeArabic,
} from './arabic.ts';
export { DEFAULT_RETRIEVAL, NO_ANSWER_TEXT, retrieve } from './retriever.ts';
export { answer, formatSource } from './answer.ts';
export { KnowledgeFileError, KnowledgeIndexError } from './errors.ts';
export type { RetrievalOptions } from './retriever.ts';
export type {
  KnowledgeAnswer,
  KnowledgeChunk,
  KnowledgeDocument,
  KnowledgeIndex,
  KnowledgeSection,
  KnowledgeSource,
  RetrievalHit,
  RetrievalResult,
} from './types.ts';

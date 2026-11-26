// ============================================================
// WASL AI — الموجة الثالثة (W3) · وحدة المعرفة
// ------------------------------------------------------------
// ⭐⭐⭐ الإجابة — **مقتبسة ومصدرها معلن**.
// ------------------------------------------------------------
// ⭐⭐⭐ THE RULE OF THIS FILE
//   ⭐ the text of the answer is the text of the chunks **verbatim** ⇒
//   ⇒ nothing is written here that the index does not carry ⇒ ⇒ and
//   every chunk that appears in the answer brings its source ⇒ ⇒ so
//   an answer without a source cannot be built.
// ⭐⭐⭐ THE REFUSAL
//   when the retrieval refuses ⇒ the answer is «لا إجابة في الفهرس» ⇒
//   ⇒ and it carries no source ⇒ ⇒ because there is no text to cite.
// ⛔ It does not import from `src/core/`.
// ============================================================

import { NO_ANSWER_TEXT, retrieve, type RetrievalOptions } from './retriever.ts';
import type { KnowledgeAnswer, KnowledgeIndex, KnowledgeSource } from './types.ts';

/**
 * ⭐⭐⭐ **the readable form of a source** ⇒ the file · the section ·
 * the line ⇒ ⇒ so the person can open the file and read the line.
 */
export function formatSource(source: KnowledgeSource): string {
  return `${source.file} · «${source.section}» · سطر ${source.line}`;
}

/**
 * ⭐⭐⭐ **the answer** ⇒ the quoted chunks and their sources ⇒ ⇒ or
 * the refusal ⇒ ⇒ and it never writes a sentence of its own.
 */
export function answer(
  index: KnowledgeIndex,
  question: string,
  options: RetrievalOptions = {},
): KnowledgeAnswer {
  const result = retrieve(index, question, options);

  if (result.status === 'refused') {
    return {
      status: 'refused',
      text: NO_ANSWER_TEXT,
      sources: [],
      hits: [],
      reason: result.reason,
      queryTerms: result.queryTerms,
      matchedTerms: result.matchedTerms,
    };
  }

  const sources: KnowledgeSource[] = [];
  const parts: string[] = [];
  for (const hit of result.hits) {
    sources.push(hit.chunk.source);
    parts.push(`${hit.chunk.text}\n[المصدر: ${formatSource(hit.chunk.source)}]`);
  }

  return {
    status: 'answered',
    text: parts.join('\n\n'),
    sources,
    hits: result.hits,
    reason: '',
    queryTerms: result.queryTerms,
    matchedTerms: result.matchedTerms,
  };
}

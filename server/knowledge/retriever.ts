// ============================================================
// WASL AI — الموجة الثالثة (W3) · وحدة المعرفة
// ------------------------------------------------------------
// ⭐⭐⭐ الاسترجاع — **حتمي ورياضي وبلا ذكاء**.
// ------------------------------------------------------------
// ⭐ THE SCORE (a simplified TF-IDF with the cosine)
//   ① the rarity of a term   ⇒ idf(t) = log(1 + N / (1 + df(t)))
//      ⇒ N = the number of the chunks · df(t) = the number of the
//      chunks that carry the term ⇒ ⇒ a rare term weighs more.
//   ② the frequency in the chunk ⇒ tf(t,c) = count(t,c) / length(c)
//      ⇒ the length of the chunk does not decide the winner.
//   ③ the heading is a field, not the body ⇒ the title of the section
//      and the title of the document add their terms with a smaller
//      weight ⇒ ⇒ and the body still wins.
//   ④ the cosine ⇒ the score is between 0 and 1 ⇒ and the terms of
//      the question that the chunk does NOT carry lower the score ⇒
//      ⇒ so a chunk that answers only half of the question is ranked
//      below a chunk that answers it.
// ⭐⭐ THE REFUSAL (the default is the refusal)
//   the result is «لا إجابة في الفهرس» when:
//     - the question has no informative term,
//     - or no chunk carries any term of the question,
//     - or no chunk reaches the score and the coverage.
// ⭐⭐ DETERMINISM
//   the same question on the same index ⇒ the same hits and the same
//   order ⇒ always ⇒ because the order of the ties is declared.
// ⛔ It does not import from `src/core/` · ⛔ no network · ⛔ no model.
// ============================================================

import { tokenizeArabic } from './arabic.ts';
import type {
  KnowledgeChunk,
  KnowledgeIndex,
  RetrievalHit,
  RetrievalResult,
} from './types.ts';

/** ⭐ The options of the retrieval ⇒ and their declared defaults. */
export interface RetrievalOptions {
  /** ⭐ How many chunks the result carries (one to ten). */
  readonly topK?: number;
  /** ⭐ The smallest score a chunk must reach (between 0 and 1). */
  readonly minScore?: number;
  /** ⭐ The smallest share of the terms of the question a chunk must carry. */
  readonly minCoverage?: number;
}

/** ⭐⭐⭐ the declared defaults of the retrieval. */
export const DEFAULT_RETRIEVAL: Required<RetrievalOptions> = Object.freeze({
  topK: 3,
  minScore: 0.12,
  minCoverage: 0.6,
});

/** ⭐ The weight of the heading against the body. */
const HEADING_WEIGHT = 0.6;

/** ⭐⭐⭐ the phrase of the refusal ⇒ it is the same everywhere. */
export const NO_ANSWER_TEXT = 'لا إجابة في الفهرس';

/** ⭐ The rarity of a term ⇒ zero when the term is unknown. */
function idfOf(index: KnowledgeIndex, term: string): number {
  const df = index.vocabulary.get(term) ?? 0;
  if (df === 0) return 0;
  return Math.log(1 + index.chunkCount / (1 + df));
}

/** ⭐⭐⭐ the weights of a chunk ⇒ the body and the heading. */
function chunkWeights(
  index: KnowledgeIndex,
  chunk: KnowledgeChunk,
): Map<string, number> {
  const weights = new Map<string, number>();
  const bodyLength = Math.max(1, chunk.tokenCount);
  for (const [term, count] of chunk.termCounts) {
    const idf = idfOf(index, term);
    if (idf === 0) continue;
    weights.set(term, (count / bodyLength) * idf);
  }
  let headingLength = 0;
  for (const count of chunk.headingCounts.values()) headingLength += count;
  if (headingLength > 0) {
    for (const [term, count] of chunk.headingCounts) {
      const idf = idfOf(index, term);
      if (idf === 0) continue;
      weights.set(term, (weights.get(term) ?? 0) + HEADING_WEIGHT * (count / headingLength) * idf);
    }
  }
  return weights;
}

/** ⭐⭐⭐ the comparison of the hits ⇒ the score first ⇒ then the order
 * of the file ⇒ then the line ⇒ ⇒ so the ties are never random. */
function compareHits(left: RetrievalHit, right: RetrievalHit): number {
  if (right.score !== left.score) return right.score - left.score;
  if (left.chunk.source.file !== right.chunk.source.file) {
    return left.chunk.source.file < right.chunk.source.file ? -1 : 1;
  }
  if (left.chunk.source.line !== right.chunk.source.line) {
    return left.chunk.source.line - right.chunk.source.line;
  }
  return left.chunk.id < right.chunk.id ? -1 : left.chunk.id > right.chunk.id ? 1 : 0;
}

/**
 * ⭐⭐⭐ **the retrieval** ⇒ the hits with their scores ⇒ ⇒ or the
 * refusal ⇒ ⇒ and it never returns a chunk that does not reach the
 * declared limits.
 */
export function retrieve(
  index: KnowledgeIndex,
  question: string,
  options: RetrievalOptions = {},
): RetrievalResult {
  const topK = Math.max(1, Math.min(10, options.topK ?? DEFAULT_RETRIEVAL.topK));
  const minScore = options.minScore ?? DEFAULT_RETRIEVAL.minScore;
  const minCoverage = options.minCoverage ?? DEFAULT_RETRIEVAL.minCoverage;

  const queryTerms = tokenizeArabic(question);
  const distinct = [...new Set(queryTerms)];

  if (distinct.length === 0) {
    return {
      status: 'refused',
      hits: [],
      reason: 'السؤال ما فيهوش كلمات دالة · مفيش حاجة نطابقها',
      queryTerms: [],
      matchedTerms: [],
    };
  }

  // ⭐ the weights of the question ⇒ and the terms that exist.
  const queryWeights = new Map<string, number>();
  const queryCounts = new Map<string, number>();
  for (const term of distinct) {
    const idf = idfOf(index, term);
    if (idf === 0) continue;
    const count = queryTerms.filter((candidate) => candidate === term).length;
    queryCounts.set(term, count);
    queryWeights.set(term, (1 + Math.log(count)) * idf);
  }

  const matchedInIndex = [...queryWeights.keys()].sort();
  if (matchedInIndex.length === 0) {
    return {
      status: 'refused',
      hits: [],
      reason: 'مفيش كلمة من السؤال موجودة في الفهرس',
      queryTerms: distinct,
      matchedTerms: [],
    };
  }

  // ⭐ the norm of the question ⇒ fixed for every chunk.
  let queryNorm = 0;
  for (const weight of queryWeights.values()) queryNorm += weight * weight;
  queryNorm = Math.sqrt(queryNorm);
  if (queryNorm === 0) {
    return {
      status: 'refused',
      hits: [],
      reason: 'كلمات السؤال موجودة في الفهرس بس بوزن صفر · مفيش نتيجة',
      queryTerms: distinct,
      matchedTerms: matchedInIndex,
    };
  }

  const hits: RetrievalHit[] = [];
  let bestRaw: { score: number; coverage: number } | null = null;

  for (const chunk of index.chunks) {
    const weights = chunkWeights(index, chunk);
    let dot = 0;
    let chunkNorm = 0;
    const matched: string[] = [];
    for (const [term, weight] of weights) {
      chunkNorm += weight * weight;
      const queryWeight = queryWeights.get(term);
      if (queryWeight === undefined) continue;
      dot += queryWeight * weight;
      matched.push(term);
    }
    chunkNorm = Math.sqrt(chunkNorm);
    if (chunkNorm === 0) continue;

    const score = dot / (chunkNorm * queryNorm);
    const coverage = matched.length / distinct.length;
    if (bestRaw === null || score > bestRaw.score) bestRaw = { score, coverage };

    if (score < minScore) continue;
    if (coverage < minCoverage) continue;
    hits.push({
      chunk,
      score,
      matchedTerms: matched.sort(),
      coverage,
    });
  }

  if (hits.length === 0) {
    const detail = bestRaw
      ? ` · أفضل نتيجة ${bestRaw.score.toFixed(3)} والتغطية ${bestRaw.coverage.toFixed(2)}`
      : '';
    return {
      status: 'refused',
      hits: [],
      reason: `مفيش مقطع وصل للحدّ المطلوب (الدرجة ${minScore} والتغطية ${minCoverage})${detail}`,
      queryTerms: distinct,
      matchedTerms: matchedInIndex,
    };
  }

  hits.sort(compareHits);
  return {
    status: 'answered',
    hits: hits.slice(0, topK),
    reason: '',
    queryTerms: distinct,
    matchedTerms: matchedInIndex,
  };
}

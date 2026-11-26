// ============================================================
// WASL AI — الموجة الثالثة (W3) · وحدة المعرفة
// ------------------------------------------------------------
// ⭐⭐⭐ العقد الوحيد لنتائج الفهرس والاسترجاع.
// ------------------------------------------------------------
// ⭐ WHAT THIS FILE IS
//   the types of the knowledge index (the documents, the sections, the
//   chunks) and the types of the retrieval and of the answer.
// ⭐⭐ WHY THE SOURCE IS PART OF EVERY CHUNK
//   an answer without a source is a claim without a proof ⇒ the source
//   (file + section + line) travels WITH the chunk ⇒ ⇒ so a caller can
//   never hold a text that does not say where it came from.
// ⛔ It does not import from `src/core/`.
// ⛔ No database · no network · no external service.
// ============================================================

/**
 * ⭐ The source of a chunk ⇒ **the answer is quoted and its source is
 * declared** ⇒ and the line numbers are REAL (they are checked against
 * the file on the disk by the acceptance test).
 */
export interface KnowledgeSource {
  /** ⭐ The name of the file (as it is on the disk). */
  readonly file: string;
  /** ⭐ The title of the document (from the front matter). */
  readonly title: string;
  /** ⭐ The title of the section the chunk belongs to. */
  readonly section: string;
  /** ⭐ The first line of the chunk (one-based). */
  readonly line: number;
  /** ⭐ The last line of the chunk (one-based, inclusive). */
  readonly endLine: number;
  /** ⭐ A machine-readable locator ⇒ `file#section:line`. */
  readonly locator: string;
}

/**
 * ⭐ A chunk ⇒ **the unit of the citation** ⇒ the unit of the search
 * too ⇒ and the unit that carries the weights.
 */
export interface KnowledgeChunk {
  /** ⭐ A stable identifier ⇒ `file::sectionIndex::chunkIndex`. */
  readonly id: string;
  /** ⭐ The text of the chunk ⇒ **verbatim** ⇒ never re-written. */
  readonly text: string;
  /** ⭐ The source of the chunk ⇒ always present. */
  readonly source: KnowledgeSource;
  /** ⭐ The number of the body tokens ⇒ the base of the term frequency. */
  readonly tokenCount: number;
  /** ⭐ The terms of the body ⇒ after the Arabic normalisation. */
  readonly termCounts: ReadonlyMap<string, number>;
  /** ⭐ The terms of the title and of the section title ⇒ weighted less. */
  readonly headingCounts: ReadonlyMap<string, number>;
}

/** ⭐ A section of a document ⇒ the title and its chunks. */
export interface KnowledgeSection {
  readonly title: string;
  /** ⭐ The line of the heading of the section (one-based). */
  readonly line: number;
  readonly chunks: readonly KnowledgeChunk[];
}

/** ⭐ A document ⇒ one file of the knowledge directory. */
export interface KnowledgeDocument {
  /** ⭐ The name of the file (as it is on the disk). */
  readonly file: string;
  /** ⭐ The title (from the front matter) ⇒ never empty. */
  readonly title: string;
  /** ⭐ The tags (from the front matter) ⇒ never empty. */
  readonly tags: readonly string[];
  /** ⭐ The declared update date ⇒ `null` when the file has none. */
  readonly updated: string | null;
  /** ⭐ The modification time on the disk ⇒ for the staleness. */
  readonly modifiedAt: string;
  readonly sections: readonly KnowledgeSection[];
  readonly chunkIds: readonly string[];
}

/** ⭐ The index ⇒ the whole knowledge of one directory. */
export interface KnowledgeIndex {
  /** ⭐ The directory the index was built from ⇒ the scope of it. */
  readonly directory: string;
  readonly documents: readonly KnowledgeDocument[];
  readonly chunks: readonly KnowledgeChunk[];
  /** ⭐ The vocabulary ⇒ the term and the number of the chunks that carry it. */
  readonly vocabulary: ReadonlyMap<string, number>;
  readonly documentCount: number;
  readonly chunkCount: number;
}

/** ⭐ One result of the retrieval ⇒ a chunk and its score. */
export interface RetrievalHit {
  readonly chunk: KnowledgeChunk;
  /** ⭐ The score ⇒ between 0 and 1 ⇒ the higher the closer. */
  readonly score: number;
  /** ⭐ The terms of the question that the chunk really carries. */
  readonly matchedTerms: readonly string[];
  /** ⭐ The share of the terms of the question that the chunk carries. */
  readonly coverage: number;
}

/** ⭐ The result of the retrieval ⇒ **answered or refused** ⇒ never in between. */
export interface RetrievalResult {
  readonly status: 'answered' | 'refused';
  readonly hits: readonly RetrievalHit[];
  /** ⭐ Why ⇒ empty when the status is `answered`. */
  readonly reason: string;
  /** ⭐ The informative terms of the question (after the normalisation). */
  readonly queryTerms: readonly string[];
  /** ⭐ The terms of the question that exist in the index. */
  readonly matchedTerms: readonly string[];
}

/** ⭐ The answer ⇒ **quoted** ⇒ and every source is declared. */
export interface KnowledgeAnswer {
  readonly status: 'answered' | 'refused';
  /** ⭐ The answer ⇒ the text of the chunks verbatim ⇒ never written by us. */
  readonly text: string;
  /** ⭐ The sources of the answer ⇒ never empty when the status is `answered`. */
  readonly sources: readonly KnowledgeSource[];
  readonly hits: readonly RetrievalHit[];
  /** ⭐ Why ⇒ empty when the status is `answered`. */
  readonly reason: string;
  readonly queryTerms: readonly string[];
  readonly matchedTerms: readonly string[];
}

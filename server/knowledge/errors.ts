// ============================================================
// WASL AI — الموجة الثالثة (W3) · وحدة المعرفة
// ------------------------------------------------------------
// ⭐⭐⭐ أخطاء وحدة المعرفة — **كل خطأ يقول مكانه وسببه**.
// ------------------------------------------------------------
// ⭐ WHY THE ERRORS CARRY A LINE
//   a broken knowledge file is a hole in the answer ⇒ the person who
//   fixes it must see WHERE the file is broken ⇒ ⇒ so every problem
//   carries the file, the line and a reason in Arabic.
// ⛔ It does not import from `src/core/`.
// ============================================================

/** ⭐ One problem in one knowledge file ⇒ with its place and its reason. */
export class KnowledgeFileError extends Error {
  /** ⭐ The machine-readable code of the problem. */
  readonly code: string;
  /** ⭐ The file the problem is in. */
  readonly file: string;
  /** ⭐ The line the problem is on (one-based) ⇒ zero when it is the file. */
  readonly line: number;

  constructor(code: string, file: string, line: number, message: string) {
    super(`${file}${line > 0 ? `:${line}` : ''} — ${message}`);
    this.name = 'KnowledgeFileError';
    this.code = code;
    this.file = file;
    this.line = line;
  }
}

/**
 * ⭐ The index could not be built ⇒ and it carries **every** problem of
 * every file ⇒ so the person sees the whole list and not the first one.
 */
export class KnowledgeIndexError extends Error {
  /** ⭐ Every problem that stopped the index. */
  readonly problems: readonly KnowledgeFileError[];
  /** ⭐ The directory the index was meant to be built from. */
  readonly directory: string;

  constructor(directory: string, problems: readonly KnowledgeFileError[]) {
    const lines = problems.map((problem) => `  - ${problem.message}`).join('\n');
    super(
      `تعذّر بناء فهرس المعرفة من ${directory} ⇒ ${problems.length} مشكلة:\n${lines}`,
    );
    this.name = 'KnowledgeIndexError';
    this.problems = problems;
    this.directory = directory;
  }
}

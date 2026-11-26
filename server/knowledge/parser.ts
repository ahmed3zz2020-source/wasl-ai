// ============================================================
// WASL AI — الموجة الثالثة (W3) · وحدة المعرفة
// ------------------------------------------------------------
// ⭐⭐⭐ قراءة ملف المعرفة والتحقّق منسلامته.
// ------------------------------------------------------------
// ⭐ THE SHAPE OF A KNOWLEDGE FILE (a strict and declared one)
//   ---
//   title: دليل المنتج
//   tags: [منتج, محادثات, تذاكر]
//   updated: 2026-11-26
//   ---
//
//   ## عنوان القسم
//   نصّ القسم.
//
// ⭐⭐ THE VALIDATION (the default is the refusal)
//   ① the front matter must be there and must close,
//   ② the title must not be empty,
//   ③ the tags must not be empty,
//   ④ the body must have at least one section (`##`),
//   ⑤ every section must have a body,
//   ⑥ nothing may be written before the first section.
// ⭐⭐ EVERY PROBLEM CARRIES THE FILE AND THE LINE
//   ⇒ so the person who fixes it sees WHERE it is broken.
// ⛔ It does not import from `src/core/`.
// ============================================================

import { countTerms, normalizeArabicToken, tokenizeArabic } from './arabic.ts';
import { KnowledgeFileError } from './errors.ts';
import type { KnowledgeChunk, KnowledgeDocument, KnowledgeSection } from './types.ts';

const FRONT_MATTER_FENCE = '---';
const SECTION_PREFIX = '## ';
const TOP_HEADING_PREFIX = '# ';
const ALLOWED_KEYS: ReadonlySet<string> = Object.freeze(new Set(['title', 'tags', 'updated']));
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/** ⭐ The heading of the file ⇒ the title of the document. */
interface FrontMatter {
  readonly title: string;
  readonly tags: readonly string[];
  readonly updated: string | null;
}

/** ⭐ One block of a section ⇒ one chunk. */
interface Block {
  readonly text: string;
  readonly line: number;
  readonly endLine: number;
}

/**
 * ⭐⭐⭐ **read the front matter** ⇒ and every problem is a
 * `KnowledgeFileError` with its place.
 */
function readFrontMatter(
  lines: readonly string[],
  file: string,
): { front: FrontMatter; bodyStart: number } {
  if (lines.length === 0) {
    throw new KnowledgeFileError('empty-file', file, 0, 'الملف فارغ · لا يوجد شيء يُفهرس');
  }
  if (lines[0].trim() !== FRONT_MATTER_FENCE) {
    throw new KnowledgeFileError(
      'front-matter-missing',
      file,
      1,
      'الملف بلا ترويسة · السطر الأول لازم يكون `---`',
    );
  }

  let close = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === FRONT_MATTER_FENCE) {
      close = index;
      break;
    }
  }
  if (close === -1) {
    throw new KnowledgeFileError(
      'front-matter-unclosed',
      file,
      1,
      'الترويسة ما اتقفلتش · ناقص `---` في السطر اللي بعدها',
    );
  }

  let title = '';
  const tags: string[] = [];
  let updated: string | null = null;
  const seen = new Set<string>();

  for (let index = 1; index < close; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;
    if (line.trim() === '') continue;
    const separator = line.indexOf(':');
    if (separator === -1) {
      throw new KnowledgeFileError(
        'front-matter-line',
        file,
        lineNumber,
        `سطر الترويسة مالوش ` + '`' + `اسم: قيمة` + '`' + ` ⇒ سطر: ${line.trim()}`,
      );
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!ALLOWED_KEYS.has(key)) {
      throw new KnowledgeFileError(
        'front-matter-key',
        file,
        lineNumber,
        `مفتاح مجهول في الترويسة: ` + '`' + `${key}` + '`' + ` · المسموح: title · tags · updated`,
      );
    }
    if (seen.has(key)) {
      throw new KnowledgeFileError(
        'front-matter-duplicate',
        file,
        lineNumber,
        `المفتاح اتكرر: ` + '`' + `${key}` + '`' + ``,
      );
    }
    seen.add(key);

    if (key === 'title') {
      if (value === '') {
        throw new KnowledgeFileError(
          'title-empty',
          file,
          lineNumber,
          'العنوان فاضي · لازم يكون فيه نص',
        );
      }
      title = value;
      continue;
    }
    if (key === 'tags') {
      if (!value.startsWith('[') || !value.endsWith(']')) {
        throw new KnowledgeFileError(
          'tags-shape',
          file,
          lineNumber,
          'الوسوم لازم تكون بين قوسين مربعين · مثل: ' + '`' + `tags: [منتج, تذاكر]` + '`',
        );
      }
      const inner = value.slice(1, -1);
      for (const piece of inner.split(',')) {
        const tag = piece.trim();
        if (tag !== '') tags.push(tag);
      }
      if (tags.length === 0) {
        throw new KnowledgeFileError(
          'tags-empty',
          file,
          lineNumber,
          'مفيش وسوم · لازم وسم واحد على الأقل',
        );
      }
      continue;
    }
    // ⭐ the date.
    if (!DATE_SHAPE.test(value)) {
      throw new KnowledgeFileError(
        'updated-shape',
        file,
        lineNumber,
        `تاريخ التحديث لازم يكون بالشكل ` + '`' + `YYYY-MM-DD` + '`' + ` · اللي مكتوب: ${value}`,
      );
    }
    updated = value;
  }

  if (!seen.has('title')) {
    throw new KnowledgeFileError(
      'title-missing',
      file,
      2,
      'مفيش عنوان · لازم `title:` في الترويسة',
    );
  }
  if (!seen.has('tags')) {
    throw new KnowledgeFileError(
      'tags-missing',
      file,
      2,
      'مفيش وسوم · لازم `tags:` في الترويسة',
    );
  }

  return { front: { title, tags, updated }, bodyStart: close + 1 };
}

/** ⭐⭐⭐ **the blocks of a section** ⇒ a block is what is between two
 * empty lines ⇒ ⇒ and it is one chunk of the index. */
function readBlocks(lines: readonly string[], start: number, end: number): Block[] {
  const blocks: Block[] = [];
  let buffer: string[] = [];
  let firstLine = 0;
  let lastLine = 0;

  const flush = (): void => {
    if (buffer.length === 0) return;
    const text = buffer.join('\n').trim();
    if (text !== '') {
      blocks.push({ text, line: firstLine, endLine: lastLine });
    }
    buffer = [];
    firstLine = 0;
    lastLine = 0;
  };

  for (let index = start; index < end; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;
    if (line.trim() === '') {
      flush();
      continue;
    }
    if (buffer.length === 0) firstLine = lineNumber;
    buffer.push(line);
    lastLine = lineNumber;
  }
  flush();
  return blocks;
}

/** ⭐ The slug of a section title ⇒ used in the identifier of the chunk. */
function slugOf(title: string, index: number): string {
  const cleaned = title
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return cleaned === '' ? `section-${index + 1}` : cleaned;
}

/**
 * ⭐⭐⭐ **parse one knowledge file** ⇒ and refuse it loudly when it is
 * broken ⇒ ⇒ the index never carries a half file.
 */
export function parseKnowledgeFile(content: string, file: string): KnowledgeDocument {
  const lines = content.split(/\r?\n/);
  const { front, bodyStart } = readFrontMatter(lines, file);

  // ⭐ the sections of the body.
  const headings: { title: string; line: number }[] = [];
  for (let index = bodyStart; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;
    if (line.startsWith(TOP_HEADING_PREFIX)) {
      throw new KnowledgeFileError(
        'unexpected-heading',
        file,
        lineNumber,
        'العنوان الأول `'
          + '# '
          + '` مش مسموح جوّه النصّ · الأقسام بتبدأ بـ `'
          + '## '
          + '`',
      );
    }
    if (line.startsWith(SECTION_PREFIX)) {
      const title = line.slice(SECTION_PREFIX.length).trim();
      if (title === '') {
        throw new KnowledgeFileError(
          'section-title-empty',
          file,
          lineNumber,
          'القسم بلا عنوان · لازم اسم القسم',
        );
      }
      headings.push({ title, line: lineNumber });
    }
  }

  if (headings.length === 0) {
    throw new KnowledgeFileError(
      'no-sections',
      file,
      bodyStart + 1,
      'مفيش أقسام · لازم قسم واحد على الأقل يبدأ بـ `'
        + '## '
        + '`',
    );
  }

  // ⭐ nothing may be written before the first section.
  const firstHeading = headings[0];
  for (let index = bodyStart; index < firstHeading.line - 1; index += 1) {
    if (lines[index].trim() !== '') {
      throw new KnowledgeFileError(
        'content-before-section',
        file,
        index + 1,
        'فيه نصّ قبل أول قسم · النصّ لازم يكون جوه الأقسام',
      );
    }
  }

  const sections: KnowledgeSection[] = [];
  const chunkIds: string[] = [];

  for (let order = 0; order < headings.length; order += 1) {
    const heading = headings[order];
    const nextLine = order + 1 < headings.length ? headings[order + 1].line - 1 : lines.length;
    const blocks = readBlocks(lines, heading.line, nextLine);
    if (blocks.length === 0) {
      throw new KnowledgeFileError(
        'empty-section',
        file,
        heading.line,
        `القسم «${heading.title}» فاضي · لازم فيه نصّ`,
      );
    }

    const chunks: KnowledgeChunk[] = [];
    for (let blockOrder = 0; blockOrder < blocks.length; blockOrder += 1) {
      const block = blocks[blockOrder];
      const id = `${file}::${slugOf(heading.title, order)}::${blockOrder + 1}`;
      const bodyTokens = tokenizeArabic(block.text);
      const headingTokens = [
        ...tokenizeArabic(front.title),
        ...tokenizeArabic(heading.title),
      ];
      chunks.push({
        id,
        text: block.text,
        source: {
          file,
          title: front.title,
          section: heading.title,
          line: block.line,
          endLine: block.endLine,
          locator: `${file}#${slugOf(heading.title, order)}:${block.line}`,
        },
        tokenCount: bodyTokens.length,
        termCounts: countTerms(bodyTokens),
        headingCounts: countTerms(headingTokens),
      });
      chunkIds.push(id);
    }

    sections.push({ title: heading.title, line: heading.line, chunks });
  }

  return {
    file,
    title: front.title,
    tags: front.tags,
    updated: front.updated,
    modifiedAt: '',
    sections,
    chunkIds,
  };
}

/**
 * ⭐⭐⭐ **the canonical form of a title** ⇒ used when the title of a
 * document is compared with the title of a question.
 */
export function canonicalTitle(title: string): string {
  return normalizeArabicToken(title);
}

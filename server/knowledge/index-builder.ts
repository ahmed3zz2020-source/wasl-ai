// ============================================================
// WASL AI — الموجة الثالثة (W3) · وحدة المعرفة
// ------------------------------------------------------------
// ⭐⭐⭐ بناء الفهرس **من الملفات على القرص وقت التشغيل**.
// ------------------------------------------------------------
// ⭐ WHY THE FILES AND NOT A TABLE
//   the knowledge is a set of files that a person writes and reviews ⇒
//   ⇒ it is read from the disk when the index is built ⇒ ⇒ and it is
//   NOT copied into the database ⇒ ⇒ so there is no second copy that
//   can drift from the first one.
// ⭐⭐ THE SCOPE IS THE DIRECTORY
//   the index of one directory knows only that directory ⇒ ⇒ so the
//   isolation between the companies is the isolation between the
//   folders ⇒ ⇒ and it needs no extra column and no extra rule.
// ⭐⭐ THE ORDER IS FIXED
//   the files are read in the alphabetical order and the chunks keep
//   the order of the file ⇒ ⇒ so the index of the same folder is
//   always the same index.
// ⛔ It does not import from `src/core/` · ⛔ no database · ⛔ no network.
// ============================================================

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { KnowledgeFileError, KnowledgeIndexError } from './errors.ts';
import { parseKnowledgeFile } from './parser.ts';
import type { KnowledgeChunk, KnowledgeDocument, KnowledgeIndex } from './types.ts';

/**
 * ⭐⭐⭐ **the files of the directory** ⇒ the Markdown files only ⇒ and
 * in a fixed order ⇒ ⇒ so the index never depends on the order of the
 * disk.
 */
export function listKnowledgeFiles(directory: string): string[] {
  const absolute = resolve(directory);
  let entries: string[];
  try {
    entries = readdirSync(absolute);
  } catch {
    throw new KnowledgeIndexError(absolute, [
      new KnowledgeFileError(
        'directory-missing',
        absolute,
        0,
        'مجلد المعرفة مش موجود · الفهرس ما ينبنيش',
      ),
    ]);
  }
  return entries
    .filter((name) => name.endsWith('.md'))
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

/** ⭐⭐⭐ **build the index of a directory** ⇒ and refuse it loudly when
 * one file is broken ⇒ ⇒ and it lists EVERY problem at once. */
export function buildKnowledgeIndex(directory: string): KnowledgeIndex {
  const absolute = resolve(directory);
  const files = listKnowledgeFiles(absolute);

  if (files.length === 0) {
    throw new KnowledgeIndexError(absolute, [
      new KnowledgeFileError(
        'directory-empty',
        absolute,
        0,
        'مجلد المعرفة فاضي · مفيش ملف `.md` واحد يُفهرس',
      ),
    ]);
  }

  const problems: KnowledgeFileError[] = [];
  const documents: KnowledgeDocument[] = [];
  const chunks: KnowledgeChunk[] = [];

  for (const name of files) {
    const path = join(absolute, name);
    let content = '';
    let modifiedAt = '';
    try {
      content = readFileSync(path, 'utf8');
      modifiedAt = statSync(path).mtime.toISOString();
    } catch (error) {
      problems.push(
        new KnowledgeFileError(
          'file-unreadable',
          name,
          0,
          `الملف ما اتقراش: ${(error as Error).message}`,
        ),
      );
      continue;
    }
    try {
      const document = parseKnowledgeFile(content, name);
      documents.push({ ...document, modifiedAt });
      for (const section of document.sections) {
        for (const chunk of section.chunks) chunks.push(chunk);
      }
    } catch (error) {
      if (error instanceof KnowledgeFileError) {
        problems.push(error);
        continue;
      }
      problems.push(
        new KnowledgeFileError(
          'file-broken',
          name,
          0,
          `الملف فيه خطأ غير متوقع: ${(error as Error).message}`,
        ),
      );
    }
  }

  if (problems.length > 0) {
    throw new KnowledgeIndexError(absolute, problems);
  }

  // ⭐⭐⭐ the vocabulary ⇒ the term and the number of the chunks that
  // carry it ⇒ ⇒ and it is the base of the rarity (the inverse of it).
  const vocabulary = new Map<string, number>();
  for (const chunk of chunks) {
    const terms = new Set<string>([
      ...chunk.termCounts.keys(),
      ...chunk.headingCounts.keys(),
    ]);
    for (const term of terms) {
      vocabulary.set(term, (vocabulary.get(term) ?? 0) + 1);
    }
  }

  return Object.freeze({
    directory: absolute,
    documents: Object.freeze(documents),
    chunks: Object.freeze(chunks),
    vocabulary,
    documentCount: documents.length,
    chunkCount: chunks.length,
  });
}

/**
 * ⭐⭐⭐ **a short description of the index** ⇒ for the logs and for the
 * operator ⇒ and it carries NO number of readiness ⇒ only what is
 * really on the disk.
 */
export function describeIndex(index: KnowledgeIndex): {
  directory: string;
  documents: number;
  chunks: number;
  terms: number;
  files: readonly { file: string; title: string; tags: readonly string[]; updated: string | null }[];
} {
  return {
    directory: index.directory,
    documents: index.documentCount,
    chunks: index.chunkCount,
    terms: index.vocabulary.size,
    files: index.documents.map((document) => ({
      file: document.file,
      title: document.title,
      tags: document.tags,
      updated: document.updated,
    })),
  };
}

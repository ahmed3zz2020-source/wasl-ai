// ============================================================
// WASL AI — الموجة الثالثة (W3) · اختبار القبول ①
// ⭐ `kno-index` — فهرس المعرفة.
// ------------------------------------------------------------
// ⭐⭐⭐ WHAT THIS FILE PROVES
//   ① the index is built from the files of the `knowledge/` folder at
//      runtime ⇒ with NO table and NO migration,
//   ② every file of the folder is validated ⇒ title + sections + tags,
//   ③ a broken file is REFUSED loudly ⇒ with the file, the line and
//      the reason ⇒ and the index is never built from a half file,
//   ④ every chunk of the index carries its source.
// ⛔ Local files only · ⛔ no database · ⛔ no network · ⛔ no external
//    service · ⛔ nothing is written outside the temporary folders of
//    the test.
// ============================================================

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  KnowledgeIndexError,
  buildKnowledgeIndex,
  describeIndex,
  listKnowledgeFiles,
} from '../../server/knowledge/index.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const KNOWLEDGE = join(REPO, 'knowledge');

/** ⭐ A folder with one file in it ⇒ and it is removed after the test. */
function withFolder(files: Record<string, string>, run: (folder: string) => void): void {
  const folder = mkdtempSync(join(tmpdir(), 'wasl-knowledge-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(folder, name), content, 'utf8');
    }
    run(folder);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------
// ① the index is built from the files of the folder
// ------------------------------------------------------------
test('the index is built from the files of the knowledge folder', () => {
  const files = listKnowledgeFiles(KNOWLEDGE);
  assert.ok(files.length >= 4, `the folder must carry at least four files · found ${files.length}`);
  for (const file of files) assert.ok(file.endsWith('.md'), `the file ${file} must be a Markdown file`);

  const index = buildKnowledgeIndex(KNOWLEDGE);
  assert.equal(index.documentCount, files.length);
  assert.ok(index.chunkCount > 0, 'the index must carry at least one chunk');
  assert.equal(index.documents.length, index.documentCount);
  assert.ok(index.vocabulary.size > 0, 'the vocabulary must not be empty');

  const described = describeIndex(index);
  assert.equal(described.documents, index.documentCount);
  assert.equal(described.chunks, index.chunkCount);
  assert.equal(described.files.length, index.documentCount);
});

// ------------------------------------------------------------
// ② every file is complete: title + sections + tags
// ------------------------------------------------------------
test('every document of the index carries a title, tags and sections', () => {
  const index = buildKnowledgeIndex(KNOWLEDGE);
  for (const document of index.documents) {
    assert.ok(document.title.trim() !== '', `the file ${document.file} has no title`);
    assert.ok(document.tags.length > 0, `the file ${document.file} has no tags`);
    assert.ok(document.sections.length > 0, `the file ${document.file} has no section`);
    for (const section of document.sections) {
      assert.ok(section.title.trim() !== '', `a section of ${document.file} has no title`);
      assert.ok(section.chunks.length > 0, `the section ${section.title} has no chunk`);
    }
  }
});

// ------------------------------------------------------------
// ③ every chunk carries its source
// ------------------------------------------------------------
test('every chunk of the index carries its source', () => {
  const index = buildKnowledgeIndex(KNOWLEDGE);
  for (const chunk of index.chunks) {
    assert.ok(chunk.source.file.endsWith('.md'), 'the source must name the file');
    assert.ok(chunk.source.title.trim() !== '', 'the source must name the document');
    assert.ok(chunk.source.section.trim() !== '', 'the source must name the section');
    assert.ok(chunk.source.line >= 1, 'the source must carry the line');
    assert.ok(chunk.source.endLine >= chunk.source.line, 'the source must carry a real range');
    assert.ok(chunk.source.locator.includes(chunk.source.file), 'the locator must name the file');
    assert.ok(chunk.text.trim() !== '', 'the chunk must carry its text');
    assert.ok(chunk.tokenCount > 0, 'the chunk must carry its terms');
  }
});

// ------------------------------------------------------------
// ④ a broken file is refused loudly (and every problem is listed)
// ------------------------------------------------------------
test('a file without a title is refused with its place and its reason', () => {
  withFolder(
    {
      'broken.md': '---\ntags: [تجربة]\n---\n\n## قسم\n\nنصّ.\n',
    },
    (folder) => {
      assert.throws(
        () => buildKnowledgeIndex(folder),
        (error: unknown) => {
          assert.ok(error instanceof KnowledgeIndexError, 'the error must be a knowledge index error');
          assert.equal(error.problems.length, 1);
          assert.equal(error.problems[0]!.code, 'title-missing');
          assert.equal(error.problems[0]!.file, 'broken.md');
          assert.match(error.message, /broken\.md/);
          assert.match(error.message, /عنوان/);
          return true;
        },
      );
    },
  );
});

test('a file without tags is refused', () => {
  withFolder(
    {
      'broken.md': '---\ntitle: ملف\n---\n\n## قسم\n\nنصّ.\n',
    },
    (folder) => {
      assert.throws(
        () => buildKnowledgeIndex(folder),
        (error: unknown) => {
          assert.ok(error instanceof KnowledgeIndexError);
          assert.equal(error.problems[0]!.code, 'tags-missing');
          return true;
        },
      );
    },
  );
});

test('a file without a section is refused', () => {
  withFolder(
    {
      'broken.md': '---\ntitle: ملف\ntags: [تجربة]\n---\n\nنصّ بلا قسم.\n',
    },
    (folder) => {
      assert.throws(
        () => buildKnowledgeIndex(folder),
        (error: unknown) => {
          assert.ok(error instanceof KnowledgeIndexError);
          assert.equal(error.problems[0]!.code, 'no-sections');
          return true;
        },
      );
    },
  );
});

test('an empty section is refused with the line of the section', () => {
  withFolder(
    {
      'broken.md': '---\ntitle: ملف\ntags: [تجربة]\n---\n\n## قسم فاضي\n\n## قسم فيه نصّ\n\nنصّ.\n',
    },
    (folder) => {
      assert.throws(
        () => buildKnowledgeIndex(folder),
        (error: unknown) => {
          assert.ok(error instanceof KnowledgeIndexError);
          assert.equal(error.problems[0]!.code, 'empty-section');
          assert.equal(error.problems[0]!.line, 6);
          return true;
        },
      );
    },
  );
});

test('every broken file is listed at once and the index is not built', () => {
  withFolder(
    {
      'first.md': '---\ntags: [تجربة]\n---\n\n## قسم\n\nنصّ.\n',
      'second.md': '---\ntitle: ملف\n---\n\n## قسم\n\nنصّ.\n',
    },
    (folder) => {
      assert.throws(
        () => buildKnowledgeIndex(folder),
        (error: unknown) => {
          assert.ok(error instanceof KnowledgeIndexError);
          assert.equal(error.problems.length, 2);
          const files = error.problems.map((problem) => problem.file).sort();
          assert.deepEqual(files, ['first.md', 'second.md']);
          return true;
        },
      );
    },
  );
});

test('a folder that does not exist is refused with a clear reason', () => {
  assert.throws(
    () => buildKnowledgeIndex(join(KNOWLEDGE, 'مجلد-مش-موجود')),
    (error: unknown) => {
      assert.ok(error instanceof KnowledgeIndexError);
      assert.equal(error.problems[0]!.code, 'directory-missing');
      assert.match(error.message, /مجلد المعرفة مش موجود/);
      return true;
    },
  );
});

test('an empty folder is refused with a clear reason', () => {
  const folder = mkdtempSync(join(tmpdir(), 'wasl-knowledge-empty-'));
  try {
    mkdirSync(join(folder, 'sub'), { recursive: true });
    assert.throws(
      () => buildKnowledgeIndex(folder),
      (error: unknown) => {
        assert.ok(error instanceof KnowledgeIndexError);
        assert.equal(error.problems[0]!.code, 'directory-empty');
        assert.match(error.message, /مجلد المعرفة فاضي/);
        return true;
      },
    );
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

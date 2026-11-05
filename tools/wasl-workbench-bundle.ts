// ============================================================
// WASL AI — مُجمِّع المعاينة (Slice 07 P0)
// ------------------------------------------------------------
// ⭐ الغرض: ⭐ **إعادة استخدام منطق النواة نفسه** داخل ملف HTML مستقل
//   يعمل من `file://` ⇒ ⇒ ⇒ **بلا خادم · بلا CDN · بلا `fetch`**.
// ⭐ الطريقة: ⭐ **تجميع الوحدات (bundling) وقت البناء** — كل وحدة
//   تصبح إغلاقاً (IIFE) يُعيد كائن تصديراتها ⇒ ⇒⇒ **بلا أي نسخة
//   مُكرَّرة من منطق النواة** ⇒ ⇒⇒ **بلا قائمة انتقالات موازية**.
// ⭐ آمن: ⭐ `stripTypeScriptTypes` (من Node نفسه) يُزيل الأنواع ⇒
//   والوحدات تُغلَّف كلٌّ في نطاق خاص ⇒ ⇒⇒ **بلا تصادم أسماء**.
// ⭐ ⛔ **لا يُعدَّل أي سطر في `src/core/`** — ⭐ هذا مُجمِّع قراءة فقط.
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';

/** ⭐ وحدة بعد التحليل. */
interface BundledModule {
  readonly file: string;
  readonly varName: string;
  readonly deps: string[];
  readonly body: string;
  readonly exported: string[];
}

/** ⭐ استخراج اسم المتغيّر الداخلي من اسم الملف. */
function toVarName(file: string): string {
  const base = path.basename(file).replace(/\.ts$/, '');
  return `__m_${base.replace(/[^A-Za-z0-9_]/g, '_')}`;
}

/**
 * ⭐ يحلّ مسار الاستيراد النسبي إلى مسار ملف داخل المشروع.
 * ⭐ الرجوع = `null` ⇒ ⭐ استيراد غير محلي (خطأ ⇒ يتوقف البناء).
 */
function resolveLocal(fromFile: string, specifier: string): string {
  if (!specifier.startsWith('.')) {
    throw new Error(`⭐ استيراد غير محلي غير مسموح في التجميع: ${specifier} (من ${fromFile})`);
  }
  const resolved = path.normalize(path.join(path.dirname(fromFile), specifier));
  return resolved.split(path.sep).join('/');
}

/** ⭐ يحوّل `A, B as C` إلى أزواج (محلي · مُصدَّر). */
function parseSpecifiers(raw: string): Array<{ local: string; exported: string }> {
  const out: Array<{ local: string; exported: string }> = [];
  for (const piece of raw.split(',')) {
    const trimmed = piece.trim();
    if (!trimmed) continue;
    const alias = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(trimmed);
    if (alias) {
      out.push({ local: alias[1], exported: alias[2] });
    } else {
      out.push({ local: trimmed, exported: trimmed });
    }
  }
  return out;
}

/** ⭐ يحلّل وحدة واحدة (بعد إزالة الأنواع) إلى اعتماديات + جسم + تصديرات. */
function analyzeModule(file: string): BundledModule {
  const source = fs.readFileSync(file, 'utf8');
  const stripped = stripTypeScriptTypes(source, { mode: 'strip' });

  const deps: string[] = [];
  const prelude: string[] = [];
  const exported: string[] = [];

  // ① الاستيرادات (قيمة فقط — `import type` مُزال أصلاً).
  let body = stripped.replace(
    /import\s*\{([\s\S]*?)\}\s*from\s*'(\.[^']+)'\s*;?/g,
    (_match, specifiers: string, specifier: string) => {
      const target = resolveLocal(file, specifier);
      const depVar = toVarName(target);
      if (!deps.includes(depVar)) deps.push(depVar);
      const names = parseSpecifiers(specifiers)
        .map((entry) => entry.local)
        .filter((name) => name !== '*');
      if (names.length === 0) return '';
      prelude.push(`const { ${names.join(', ')} } = ${depVar};`);
      return '';
    },
  );

  // ② تصدارات إعادة التصدير (`export { A } from './x.ts'`) ⇒ ⇒ تُقرأ من الوحدة الأصلية.
  body = body.replace(
    /export\s*\{([\s\S]*?)\}\s*from\s*'(\.[^']+)'\s*;?/g,
    (_match, specifiers: string, specifier: string) => {
      const target = resolveLocal(file, specifier);
      const depVar = toVarName(target);
      if (!deps.includes(depVar)) deps.push(depVar);
      const pairs = parseSpecifiers(specifiers);
      const names = pairs.map((entry) => entry.local).filter((name) => name !== '*');
      for (const entry of pairs) {
        exported.push(
          entry.local === entry.exported
            ? entry.local
            : `${entry.local}__as__${entry.exported}`,
        );
      }
      if (names.length === 0) return '';
      return `const { ${names.join(', ')} } = ${depVar};`;
    },
  );
  // ② تصديرات بالاسم (`export { A, B as C }`).
  body = body.replace(/export\s*\{([\s\S]*?)\}\s*;?/g, (_match, specifiers: string) => {
    for (const entry of parseSpecifiers(specifiers)) {
      if (entry.local === entry.exported) {
        exported.push(entry.local);
      } else {
        exported.push(`${entry.local}__as__${entry.exported}`);
      }
    }
    return '';
  });

  // ④ تصديرات بالشكل المباشر (`export const/let/var/function/class`).
  body = body.replace(
    /^([ \t]*)export\s+(const|let|var|async\s+function|function|class)\s+([A-Za-z_$][\w$]*)/gm,
    (_match, indent: string, kind: string, name: string) => {
      exported.push(name);
      return `${indent}${kind} ${name}`;
    },
  );

  // ⑤ ⭐ ** safety ** — لا يجوز بقاء `export` على سطر مستقل.
  const leftover = /^([ \t]*)export\s/gm.exec(body);
  if (leftover) {
    throw new Error(
      `⭐ تصدير غير مدعوم في ${file} عند الموضع ${leftover.index} — ⛔ أوقف البناء (لا نسخ صامت).`,
    );
  }

  // ⑥ ⭐ **الاعتماديات تُدرَج في أعلى الجسم** (بدل الاستيراد الأصلي).
  const finalBody = prelude.length > 0 ? `${prelude.join('\n')}\n${body.trim()}` : body.trim();

  return { file, varName: toVarName(file), deps, body: finalBody, exported };
}

/** ⭐ ترتيب طوبولوجي للاعتماديات (runtime فقط). */
function topoSort(modules: Map<string, BundledModule>): BundledModule[] {
  const ordered: BundledModule[] = [];
  const state = new Map<string, 'new' | 'busy' | 'done'>();

  const visit = (mod: BundledModule): void => {
    const current = state.get(mod.varName);
    if (current === 'done') return;
    if (current === 'busy') {
      throw new Error(`⭐ دورة runtime بين الوحدات — ⛔ أوقف البناء (${mod.file})`);
    }
    state.set(mod.varName, 'busy');
    for (const depVar of mod.deps) {
      const dep = [...modules.values()].find((m) => m.varName === depVar);
      if (!dep) throw new Error(`⭐ اعتماد غير معروف: ${depVar} (من ${mod.file})`);
      visit(dep);
    }
    state.set(mod.varName, 'done');
    ordered.push(mod);
  };

  for (const mod of modules.values()) visit(mod);
  return ordered;
}

/**
 * ⭐⭐ يُجمِّع الوحدات المعطاة في كود JavaScript واحد.
 * ⭐ كل وحدة = إغلاق مستقل ⇒ ⭐ **بلا تصادم أسماء** ⇒ ⭐ **بلا مساحة أسماء جديدة**.
 */
export function bundleModules(entries: string[]): { code: string; files: string[] } {
  const modules = new Map<string, BundledModule>();

  const load = (file: string): BundledModule => {
    const existing = modules.get(file);
    if (existing) return existing;
    const analyzed = analyzeModule(file);
    modules.set(file, analyzed);
    // ⭐ الاعتماديات تُحمَّل أولاً (لأن التحليل يحتاج أسماء ملفاتها فقط).
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/from\s+'(\.[^']+)'/g)) {
      const target = resolveLocal(file, match[1]);
      if (!modules.has(target)) load(target);
    }
    return analyzed;
  };

  for (const entry of entries) load(entry);

  const ordered = topoSort(modules);
  const chunks: string[] = [
    '/* ⭐ WASL AI — نواة مُجمَّعة (Slice 07 P0) — مولَّدة وقت البناء ⭐ */',
    "/* ⭐ المصدر: src/core/*.ts — بلا أي نسخة مُكرَّرة من المنطق ⭐ */",
    '/* ⭐ مُجمِّع: tools/wasl-workbench-bundle.ts ⭐ */',
  ];

  for (const mod of ordered) {
    const exportPairs = mod.exported.map((entry) => {
      const alias = entry.split('__as__');
      return alias.length === 2 ? `${alias[1]}: ${alias[0]}` : entry;
    });
    chunks.push(
      `const ${mod.varName} = (() => {\n${mod.body}\nreturn { ${exportPairs.join(', ')} };\n})();`,
    );
  }

  return {
    code: chunks.join('\n\n'),
    files: ordered.map((mod) => mod.file),
  };
}

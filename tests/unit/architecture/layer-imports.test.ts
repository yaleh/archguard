import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Layer direction guard.
 *
 * Layer order (CLAUDE.md): types/utils < core, parser < plugins, and
 * mermaid < analysis < cli. A lower layer must never import a higher one.
 *
 * This guard freezes the two crossings relocated by
 * gap-layer-violations-relocate-misplaced-types:
 *   - src/analysis/** must not import src/cli/**
 *   - src/core/**     must not import src/cli/** or src/mermaid/**
 *
 * The plugins/shared <-> core/parser mutual reference is deliberately out of
 * scope (see gap-layer-mutual-plugin-runtime-core-parser).
 *
 * Dependencies are read POSITIONALLY: only a line whose first non-whitespace
 * token begins an `import`/`export` statement counts, and comment lines are
 * skipped. A mere mention of a path inside a comment is not a dependency — a
 * keyword grep would report one, which is the false positive this guard exists
 * to avoid.
 */

interface LayerRule {
  /** Producer prefix (repo-relative POSIX). */
  from: string;
  /** Target prefixes the producer must not import. */
  forbidden: readonly string[];
}

const LAYER_RULES: readonly LayerRule[] = [
  { from: 'src/analysis/', forbidden: ['src/cli/'] },
  { from: 'src/core/', forbidden: ['src/cli/', 'src/mermaid/'] },
];

const isCommentLine = (line: string): boolean =>
  line.startsWith('//') || line.startsWith('/*') || line.startsWith('*');

const braceDepth = (text: string): number => {
  let depth = 0;
  for (const ch of text) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  return depth;
};

/** Extract the module specifiers from a single (possibly joined) statement. */
function specifiersIn(statement: string): string[] {
  const fromMatch = /\bfrom\s+['"]([^'"]+)['"]/.exec(statement);
  if (fromMatch) return [fromMatch[1]];
  const bare = /^import\s+['"]([^'"]+)['"]/.exec(statement);
  return bare ? [bare[1]] : [];
}

/**
 * Module specifiers of positional `import`/`export ... from` statements. A
 * brace-delimited specifier list may span lines; the statement is accumulated
 * until its braces close. Declaration exports (`export class ... {`) are not
 * accumulated (they do not match `export {`/`export *`/`export type {`), so a
 * `from` appearing later in a class body is never mistaken for an import.
 */
export function moduleSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const first = lines[i].trimStart();
    if (isCommentLine(first)) continue;
    const startsImport = /^import\b/.test(first);
    const startsExportFrom = /^export\s*(type\s*)?[{*]/.test(first);
    if (!startsImport && !startsExportFrom) continue;

    let statement = first;
    while (braceDepth(statement) > 0 && i + 1 < lines.length) {
      i++;
      const next = lines[i].trimStart();
      if (isCommentLine(next)) continue;
      statement += ' ' + next;
    }
    specifiers.push(...specifiersIn(statement));
  }
  return specifiers;
}

/**
 * Resolve an import/export specifier written in `fromRelPath` to a
 * repo-relative POSIX path prefix, or null when it cannot denote a project
 * source module (bare package specifiers, node builtins, absolute paths).
 */
export function resolveSpecifier(fromRelPath: string, specifier: string): string | null {
  if (specifier.startsWith('@/')) return `src/${specifier.slice(2)}`;
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    return path.posix.normalize(path.posix.join(path.posix.dirname(fromRelPath), specifier));
  }
  return null;
}

/** Layer violations for a single source file, given its repo-relative path. */
export function findLayerViolations(relPath: string, source: string): string[] {
  const violations: string[] = [];
  for (const rule of LAYER_RULES) {
    if (!relPath.startsWith(rule.from)) continue;
    for (const specifier of moduleSpecifiers(source)) {
      const target = resolveSpecifier(relPath, specifier);
      if (target === null) continue;
      for (const forbidden of rule.forbidden) {
        // `forbidden` ends with '/', so `src/cli/` matches `src/cli/x.ts` but not
        // a hypothetical sibling like `src/cli2/x.ts`.
        if (target.startsWith(forbidden)) {
          violations.push(`${relPath}: '${specifier}' crosses up into ${forbidden.slice(0, -1)}`);
        }
      }
    }
  }
  return violations;
}

function sourceFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(root, entry.name);
    return entry.isDirectory()
      ? sourceFiles(full)
      : entry.name.endsWith('.ts')
        ? [full]
        : [];
  });
}

function scanProject(): string[] {
  const repoRoot = path.resolve('.');
  const srcRoot = path.join(repoRoot, 'src');
  return sourceFiles(srcRoot).flatMap((file) => {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    return findLayerViolations(rel, fs.readFileSync(file, 'utf-8'));
  });
}

describe('layer import direction guard', () => {
  it('src/analysis and src/core never import a higher layer', () => {
    expect(scanProject()).toEqual([]);
  });

  it('flags a positional import that crosses up (core -> cli)', () => {
    const source = "import type { A } from '@/cli/y.js';\n";
    expect(findLayerViolations('src/core/x.ts', source)).toHaveLength(1);
  });

  it('flags a positional import that crosses up (analysis -> cli, relative form)', () => {
    const source = "import { helper } from '../../cli/z.js';\n";
    expect(findLayerViolations('src/analysis/deep/x.ts', source)).toHaveLength(1);
  });

  it('flags a positional import that crosses up (core -> mermaid)', () => {
    const source = "export type { MermaidOutputOptions } from '@/mermaid/diagram-generator.js';\n";
    expect(findLayerViolations('src/core/interfaces/x.ts', source)).toHaveLength(1);
  });

  it('does NOT flag a mere mention of the path inside a comment', () => {
    const source = "// counterpart lives in @/cli/y.js\nconst x = 1;\n";
    expect(findLayerViolations('src/core/x.ts', source)).toEqual([]);
  });

  it('does NOT flag a block-comment mention of the path', () => {
    const source = "/* moved to @/cli/query/query-manifest.js */\nexport const y = 2;\n";
    expect(findLayerViolations('src/core/x.ts', source)).toEqual([]);
  });

  it('does NOT flag an allowed lower-layer import', () => {
    const source = "import type { ArchJSON } from '@/types/index.js';\nimport { e } from '../core/e.js';\n";
    expect(findLayerViolations('src/analysis/x.ts', source)).toEqual([]);
  });

  it('does NOT conflate a sibling directory with the forbidden prefix', () => {
    const source = "import { q } from '@/cli2/not-cli.js';\n";
    expect(findLayerViolations('src/core/x.ts', source)).toEqual([]);
  });

  it('catches a multi-line brace-delimited import that crosses up', () => {
    const source = "import type {\n  A,\n  B,\n} from '@/cli/y.js';\n";
    expect(findLayerViolations('src/core/x.ts', source)).toHaveLength(1);
  });
});

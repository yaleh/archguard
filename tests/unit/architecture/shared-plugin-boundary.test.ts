/**
 * `src/plugins/shared` is the shared tree-sitter infrastructure layer. Concrete
 * language plugins depend on it; it must never depend back on them. When it
 * does, the package dependency graph gains a hub cycle (shared -> every
 * concrete plugin -> shared), which is what this assertion removes.
 *
 * The assertion is deliberately about the EDGE (shared -> concrete), not about
 * where the plugin factory happens to live: moving a factory out of `shared`
 * is only a fix if no other shared file starts importing a concrete plugin.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';

const SHARED_ROOT = path.resolve('src/plugins/shared');
const SRC_ROOT = path.resolve('src');
const CONCRETE_LANGUAGES = ['golang', 'java', 'python', 'cpp', 'kotlin'] as const;

type ImportForm = 'static import' | 're-export' | 'dynamic import' | 'require' | 'import type';

interface Violation {
  file: string;
  line: number;
  form: ImportForm;
  specifier: string;
}

const temporaryDirectories: string[] = [];

function sourceFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(root, entry.name);
    return entry.isDirectory()
      ? sourceFiles(filePath)
      : entry.name.endsWith('.ts')
        ? [filePath]
        : [];
  });
}

/** Resolve a module specifier to an absolute source path, or null when it is a package import. */
function resolveSpecifier(specifier: string, fromFile: string, srcRoot: string): string | null {
  if (specifier.startsWith('@/')) {
    return path.resolve(srcRoot, specifier.slice('@/'.length));
  }
  if (specifier.startsWith('.')) {
    return path.resolve(path.dirname(fromFile), specifier);
  }
  return null;
}

function concretePluginRoots(srcRoot: string): string[] {
  return CONCRETE_LANGUAGES.map((language) => path.join(srcRoot, 'plugins', language));
}

function isConcretePluginPath(resolved: string, concreteRoots: string[]): boolean {
  return concreteRoots.some(
    (root) => resolved === root || resolved.startsWith(root + path.sep)
  );
}

/**
 * Collect every import edge from `files` into a concrete language plugin
 * directory. Covers static imports, re-exports, dynamic `import()`,
 * `require()`, and `import('...')` types, with both `@/plugins/...` aliases
 * and relative specifiers.
 */
export function findConcretePluginImports(
  files: string[],
  srcRoot: string = SRC_ROOT
): Violation[] {
  const concreteRoots = concretePluginRoots(srcRoot);
  const violations: Violation[] = [];

  const record = (
    file: string,
    specifier: ts.StringLiteralLike,
    form: ImportForm,
    sourceFile: ts.SourceFile
  ): void => {
    const resolved = resolveSpecifier(specifier.text, file, srcRoot);
    if (resolved === null || !isConcretePluginPath(resolved, concreteRoots)) return;
    const position = sourceFile.getLineAndCharacterOfPosition(specifier.getStart(sourceFile));
    violations.push({
      file: path.relative(process.cwd(), file),
      line: position.line + 1,
      form,
      specifier: specifier.text,
    });
  };

  for (const file of files) {
    const sourceFile = ts.createSourceFile(
      file,
      fs.readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );

    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
        record(file, node.moduleSpecifier, 'static import', sourceFile);
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
        record(file, node.moduleSpecifier, 're-export', sourceFile);
      } else if (ts.isImportTypeNode(node)) {
        const argument = node.argument;
        if (ts.isLiteralTypeNode(argument) && ts.isStringLiteralLike(argument.literal)) {
          record(file, argument.literal, 'import type', sourceFile);
        }
      } else if (ts.isCallExpression(node)) {
        const [firstArgument] = node.arguments;
        if (firstArgument && ts.isStringLiteralLike(firstArgument)) {
          if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            record(file, firstArgument, 'dynamic import', sourceFile);
          } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
            record(file, firstArgument, 'require', sourceFile);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return violations;
}

function fixture(): { srcRoot: string; files: string[] } {
  const srcRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'archguard-shared-boundary-'));
  temporaryDirectories.push(srcRoot);
  const shared = path.join(srcRoot, 'plugins', 'shared');
  const golang = path.join(srcRoot, 'plugins', 'golang');
  fs.mkdirSync(shared, { recursive: true });
  fs.mkdirSync(golang, { recursive: true });
  fs.writeFileSync(path.join(golang, 'index.ts'), 'export class GoPlugin {}\n');
  return { srcRoot, files: [] };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('shared plugin infrastructure boundary', () => {
  it('has no import edges into concrete language plugin directories', () => {
    const sharedFiles = sourceFiles(SHARED_ROOT);
    expect(sharedFiles.length).toBeGreaterThan(0);
    expect(findConcretePluginImports(sharedFiles)).toEqual([]);
  });

  it('detects static, dynamic, relative, re-export, require and import-type edges', () => {
    const { srcRoot, files } = fixture();
    const shared = path.join(srcRoot, 'plugins', 'shared');

    const cases: Array<[string, string, ImportForm]> = [
      ['static.ts', `import { GoPlugin } from '@/plugins/golang/index.js';\n`, 'static import'],
      ['dynamic.ts', `export const load = () => import('@/plugins/golang/index.js');\n`, 'dynamic import'],
      ['relative.ts', `export * from '../golang/index.js';\n`, 're-export'],
      ['require.ts', `const go = require('@/plugins/golang/index.js');\n`, 'require'],
      ['type.ts', `export type X = import('@/plugins/golang/index.js').GoPlugin;\n`, 'import type'],
    ];

    for (const [name, source] of cases) {
      const file = path.join(shared, name);
      fs.writeFileSync(file, source);
      files.push(file);
    }

    const violations = findConcretePluginImports(files, srcRoot);
    expect(violations).toHaveLength(cases.length);
    expect(new Set(violations.map((violation) => violation.form))).toEqual(
      new Set(cases.map(([, , form]) => form))
    );
  });

  it('ignores edges to shared infrastructure and to unrelated packages', () => {
    const { srcRoot, files } = fixture();
    const file = path.join(srcRoot, 'plugins', 'shared', 'allowed.ts');
    fs.writeFileSync(
      file,
      [
        `import { selectParserBackendFor } from './parser-runtime.js';`,
        `import path from 'node:path';`,
        `export const load = () => import('@/plugins/shared/parser-backend.js');`,
        '',
      ].join('\n')
    );
    files.push(file);

    expect(findConcretePluginImports(files, srcRoot)).toEqual([]);
  });
});

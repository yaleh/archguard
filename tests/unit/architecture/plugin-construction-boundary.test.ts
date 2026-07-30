import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';

const PLUGIN_MODULE_FILES = new Set(
  ['golang', 'java', 'python', 'cpp', 'kotlin'].map((language) =>
    path.resolve(`src/plugins/${language}/index.ts`)
  )
);
const FACTORY = path.resolve('src/plugins/shared/plugin-factory.ts');
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

function constructionViolations(files: string[]): string[] {
  const config = ts.readConfigFile(path.resolve('tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
  const program = ts.createProgram(files, parsed.options);
  const checker = program.getTypeChecker();
  const violations: string[] = [];

  for (const sourceFile of program.getSourceFiles()) {
    const sourcePath = path.resolve(sourceFile.fileName);
    if (!files.includes(sourcePath) || sourcePath === FACTORY) continue;

    const visit = (node: ts.Node): void => {
      if (ts.isNewExpression(node)) {
        let symbol = checker.getSymbolAtLocation(node.expression);
        if (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0) {
          symbol = checker.getAliasedSymbol(symbol);
        }
        const declarationFiles = symbol?.declarations?.map((declaration) =>
          path.resolve(declaration.getSourceFile().fileName)
        );
        if (declarationFiles?.some((file) => PLUGIN_MODULE_FILES.has(file))) {
          const position = sourceFile.getLineAndCharacterOfPosition(node.getStart());
          violations.push(
            `${path.relative(process.cwd(), sourcePath)}:${position.line + 1}:${position.character + 1}`
          );
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return violations;
}

function fixture(source: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archguard-plugin-boundary-'));
  temporaryDirectories.push(directory);
  const file = path.join(directory, 'bypass.ts');
  fs.writeFileSync(file, source);
  return file;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('language plugin construction boundary', () => {
  it('allows plugin construction only in the resolver-mediated factory', () => {
    const files = sourceFiles(path.resolve('src')).map((file) => path.resolve(file));
    expect(constructionViolations(files)).toEqual([]);
  });

  it('detects aliased plugin imports', () => {
    const file = fixture(
      `import { JavaPlugin as J } from '${path.resolve('src/plugins/java/index.ts')}';\nnew J(undefined as any);\n`
    );
    expect(constructionViolations([file])).toHaveLength(1);
  });

  it('detects namespace-member plugin construction', () => {
    const file = fixture(
      `import * as java from '${path.resolve('src/plugins/java/index.ts')}';\nnew java.JavaPlugin(undefined as any);\n`
    );
    expect(constructionViolations([file])).toHaveLength(1);
  });
});

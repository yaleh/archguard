/**
 * Tests for ModuleGraphBuilder — relative import resolution fallback
 *
 * TDD: Covers the case where ts-morph getModuleSpecifierSourceFile() returns null
 * for relative imports, and we must fall back to manual path resolution using
 * the fileToModule map.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Project, SyntaxKind } from 'ts-morph';
import { ModuleGraphBuilder } from '@/plugins/typescript/builders/module-graph-builder.js';
import type { SourceFile, ImportDeclaration, ExportDeclaration } from 'ts-morph';

// ---------------------------------------------------------------------------
// Helpers to create minimal ts-morph mock objects
// ---------------------------------------------------------------------------

function makeImportDecl(
  specifier: string,
  resolvedFile: SourceFile | null = null,
  namedImports: string[] = [],
  defaultImport: string | null = null,
  typeOnly = false
): ImportDeclaration {
  return {
    getModuleSpecifierSourceFile: () => resolvedFile,
    getModuleSpecifierValue: () => specifier,
    getNamedImports: () =>
      namedImports.map((n) => ({ getName: () => n, isTypeOnly: () => typeOnly })),
    getDefaultImport: () => (defaultImport ? { getText: () => defaultImport } : undefined),
    getNamespaceImport: () => undefined,
    isTypeOnly: () => typeOnly,
  } as unknown as ImportDeclaration;
}

function makeSourceFile(filePath: string, imports: ImportDeclaration[] = []): SourceFile {
  return {
    getFilePath: () => filePath,
    getImportDeclarations: () => imports,
    // The builder also walks re-exports and dynamic imports; these mocks carry
    // neither, so the collections are empty (no behaviour change for the cases above).
    getExportDeclarations: () => [],
    getDescendantsOfKind: () => [],
  } as unknown as SourceFile;
}

function makeExportDecl(
  specifier: string,
  resolvedFile: SourceFile | null = null
): ExportDeclaration {
  return {
    getModuleSpecifierSourceFile: () => resolvedFile,
    getModuleSpecifierValue: () => specifier,
    getNamedExports: () => [],
    getNamespaceExport: () => undefined,
    isTypeOnly: () => false,
  } as unknown as ExportDeclaration;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('ModuleGraphBuilder — root-level entity stats', () => {
  const builder = new ModuleGraphBuilder();
  const projectRoot = '/project/src';

  it('counts a root-level class entity in the root module stats', () => {
    // index.ts lives at projectRoot — its module ID normalises to ''
    const rootFile = makeSourceFile('/project/src/index.ts');

    // Entity whose id encodes the root file: "index.ts.MyClass"
    const rootEntity: Entity = {
      id: 'index.ts.MyClass',
      name: 'MyClass',
      type: 'class',
      methods: [],
      fields: [],
      sourceLocation: { file: '/project/src/index.ts', line: 1 },
    } as unknown as Entity;

    const graph = builder.build(projectRoot, [rootFile], [rootEntity]);

    const rootNode = graph.nodes.find((n) => n.id === '');
    expect(rootNode).toBeDefined();
    expect(rootNode?.stats.classes).toBe(1);
  });
});

describe('ModuleGraphBuilder — relative import fallback resolution', () => {
  const builder = new ModuleGraphBuilder();
  const projectRoot = '/project/src';

  it('(a) emits edge when ./useMap resolves to ./useMap.ts in fileToModule', () => {
    // hooks/useHook.ts imports from './useMap' (no extension)
    // useMap.ts lives at /project/src/hooks/useMap.ts → same module "hooks"
    // But we want to test cross-module: put useMap in a sibling directory

    const targetFile = makeSourceFile('/project/src/utils/useMap.ts');
    const importDecl = makeImportDecl('../utils/useMap', null, ['useMap']);
    const callerFile = makeSourceFile('/project/src/hooks/useHook.ts', [importDecl]);

    const graph = builder.build(projectRoot, [callerFile, targetFile], []);

    // Should have exactly one internal edge: hooks → utils
    const _internalEdges = graph.edges.filter((e) =>
      e.from !== 'hooks' || e.to !== 'utils' ? false : true
    );
    expect(graph.edges.length).toBeGreaterThan(0);
    const edge = graph.edges.find((e) => e.from === 'hooks' && e.to === 'utils');
    expect(edge).toBeDefined();
    expect(edge?.importedNames).toContain('useMap');
  });

  it('(b) emits edge when ../types resolves to ../types/index.ts in fileToModule', () => {
    // components/Button.ts imports from '../types' (directory import → /index.ts)
    const typesIndexFile = makeSourceFile('/project/src/types/index.ts');
    const importDecl = makeImportDecl('../types', null, ['ButtonProps']);
    const buttonFile = makeSourceFile('/project/src/components/Button.ts', [importDecl]);

    const graph = builder.build(projectRoot, [buttonFile, typesIndexFile], []);

    expect(graph.edges.length).toBeGreaterThan(0);
    const edge = graph.edges.find((e) => e.from === 'components' && e.to === 'types');
    expect(edge).toBeDefined();
    expect(edge?.importedNames).toContain('ButtonProps');
  });

  it('(c) does NOT add an edge for an external package import (no leading dot)', () => {
    // utils/helper.ts imports from 'lodash' → external, not internal edge
    const importDecl = makeImportDecl('lodash', null, ['debounce']);
    const callerFile = makeSourceFile('/project/src/utils/helper.ts', [importDecl]);

    const graph = builder.build(projectRoot, [callerFile], []);

    // There should be no internal→internal edges
    const _internalEdges = graph.edges.filter(
      (e) => !graph.nodes.find((n) => n.id === e.to && n.type === 'node_modules')
    );
    // The 'lodash' module should be tracked as external, not as an internal edge
    const internalToInternal = graph.edges.filter((e) => {
      const toNode = graph.nodes.find((n) => n.id === e.to);
      return toNode?.type === 'internal';
    });
    expect(internalToInternal.length).toBe(0);
    // The external node should exist
    const externalNode = graph.nodes.find((n) => n.id === 'lodash');
    expect(externalNode).toBeDefined();
    expect(externalNode?.type).toBe('node_modules');
  });

  it('(d) does NOT add an edge for a broken relative import not in the project', () => {
    // api/client.ts imports from './missing-module' which does NOT exist in sourceFiles
    const importDecl = makeImportDecl('./missing-module', null, ['something']);
    const callerFile = makeSourceFile('/project/src/api/client.ts', [importDecl]);

    const graph = builder.build(projectRoot, [callerFile], []);

    // No edges should be emitted (the target file is not in fileToModule)
    expect(graph.edges.length).toBe(0);
  });

  it('resolves .tsx extension as fallback candidate', () => {
    // pages/Home.ts imports from '../components/Button' where Button.tsx exists
    const buttonFile = makeSourceFile('/project/src/components/Button.tsx');
    const importDecl = makeImportDecl('../components/Button', null, ['Button']);
    const homePage = makeSourceFile('/project/src/pages/Home.ts', [importDecl]);

    const graph = builder.build(projectRoot, [homePage, buttonFile], []);

    expect(graph.edges.length).toBeGreaterThan(0);
    const edge = graph.edges.find((e) => e.from === 'pages' && e.to === 'components');
    expect(edge).toBeDefined();
  });

  it('skips self-imports (from and to resolve to same module)', () => {
    // hooks/useA.ts imports from './useB' where useB.ts is in the same hooks/ directory
    const useBFile = makeSourceFile('/project/src/hooks/useB.ts');
    const importDecl = makeImportDecl('./useB', null, ['useB']);
    const useAFile = makeSourceFile('/project/src/hooks/useA.ts', [importDecl]);

    const graph = builder.build(projectRoot, [useAFile, useBFile], []);

    // Both files are in 'hooks' module — self-import should be skipped
    const selfEdges = graph.edges.filter((e) => e.from === 'hooks' && e.to === 'hooks');
    expect(selfEdges.length).toBe(0);
  });

  it('emits edge when resolved file already in fileToModule (happy path unchanged)', () => {
    // Verify existing happy path still works when getModuleSpecifierSourceFile() succeeds
    const targetFile = makeSourceFile('/project/src/utils/helper.ts');
    const importDecl = makeImportDecl('../utils/helper', targetFile, ['helper']);
    const callerFile = makeSourceFile('/project/src/api/client.ts', [importDecl]);

    const graph = builder.build(projectRoot, [callerFile, targetFile], []);

    const edge = graph.edges.find((e) => e.from === 'api' && e.to === 'utils');
    expect(edge).toBeDefined();
    expect(edge?.importedNames).toContain('helper');
  });
});

// ---------------------------------------------------------------------------
// Re-exports, dynamic imports and bare-alias resolution (real ts-morph project)
// ---------------------------------------------------------------------------

describe('ModuleGraphBuilder — export ... from re-exports', () => {
  let project: Project;

  beforeEach(() => {
    project = new Project({ useInMemoryFileSystem: true, compilerOptions: { target: 99 } });
  });

  it('emits a -> b when a/x.ts re-exports from ../b/y.js', () => {
    project.createSourceFile('/root/src/b/y.ts', `export const Y = 1;`);
    project.createSourceFile('/root/src/a/x.ts', `export { Y } from '../b/y.js';`);

    const graph = new ModuleGraphBuilder().build('/root', project.getSourceFiles(), []);

    const edge = graph.edges.find((e) => e.from === 'src/a' && e.to === 'src/b');
    expect(edge).toBeDefined();
  });

  it('does NOT emit the edge when the export-from text only appears in a comment', () => {
    // Paired negative control: the specifier is present as text, but there is no
    // ExportDeclaration, so no edge must be produced.
    project.createSourceFile('/root/src/b/y.ts', `export const Y = 1;`);
    project.createSourceFile('/root/src/a/x.ts', `// export { Y } from '../b/y.js';`);

    const graph = new ModuleGraphBuilder().build('/root', project.getSourceFiles(), []);

    const edge = graph.edges.find((e) => e.from === 'src/a' && e.to === 'src/b');
    expect(edge).toBeUndefined();
  });
});

describe('ModuleGraphBuilder — literal dynamic import', () => {
  let project: Project;

  beforeEach(() => {
    project = new Project({ useInMemoryFileSystem: true, compilerOptions: { target: 99 } });
  });

  it('emits a -> b for a literal import() and counts a non-literal one as unevaluated', () => {
    project.createSourceFile('/root/src/b/y.ts', `export const Y = 1;`);
    project.createSourceFile(
      '/root/src/a/x.ts',
      `const someVar = 'whatever';
export async function load() {
  await import('../b/y.js');
  const mod = await import(someVar);
  return mod;
}`
    );

    const graph = new ModuleGraphBuilder().build('/root', project.getSourceFiles(), []);

    const edge = graph.edges.find((e) => e.from === 'src/a' && e.to === 'src/b');
    expect(edge).toBeDefined();
    expect(graph.unevaluatedDynamicImports).toBe(1);
  });
});

describe('ModuleGraphBuilder — type-position import() (ImportTypeNode)', () => {
  const MODULE_B = `export interface X {}
export interface Y {}
export interface Z {}
export interface W {}
export interface U {}`;

  /** Build a graph from a single `src/a/x.ts` source against `src/b/index.ts`. */
  const buildWith = (aSource: string) => {
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { target: 99 } });
    project.createSourceFile('/root/src/b/index.ts', MODULE_B);
    project.createSourceFile('/root/src/a/x.ts', aSource);
    return new ModuleGraphBuilder().build('/root', project.getSourceFiles(), []);
  };

  // `import('...')` in a type position is a TSImportType / ts-morph ImportTypeNode,
  // NOT a CallExpression — the builder must find it in every wrapping form.
  const typePositionForms: Array<[label: string, source: string]> = [
    ['type alias', `type T = import('../b/index').X;`],
    ['interface property type', `interface I { p: import('../b/index').Y }`],
    ['Promise<> type argument', `type P = Promise<import('../b/index').Z>;`],
    ['readonly array element', `type R = readonly import('../b/index').W[];`],
    ['union member', `type U2 = string | import('../b/index').U;`],
    ['typeof import()', `type V = typeof import('../b/index').X;`],
  ];

  it.each(typePositionForms)(
    '%s → strength=1, typeOnlyStrength=1, valueStrength=0',
    (_label, src) => {
      const graph = buildWith(src);
      const edge = graph.edges.find((e) => e.from === 'src/a' && e.to === 'src/b');
      expect(edge).toBeDefined();
      expect(edge?.strength).toBe(1);
      expect(edge?.typeOnlyStrength).toBe(1);
      expect(edge?.valueStrength).toBe(0);
    }
  );

  it('does NOT emit an edge when the import() type argument is not a string literal', () => {
    const graph = buildWith(`type F = import(someSpecifier).X;`);
    expect(graph.edges.find((e) => e.from === 'src/a' && e.to === 'src/b')).toBeUndefined();
    // A type-position non-literal is not a runtime dynamic import: not counted here.
    expect(graph.unevaluatedDynamicImports ?? 0).toBe(0);
  });

  it('does NOT treat import( inside comments or string literals as a reference (negative control)', () => {
    const graph = buildWith(
      `// type T = import('../b/index').X
/* interface I { p: import('../b/index').Y } */
const s = "type T = import('../b/index').X";
const t = 'type U = import("../b/index").Y';
type Real = import('../b/index').U;`
    );
    // Three decoys (line comment, block comment, two string literals) must not
    // produce edges — only the one genuine type-position reference counts.
    expect(graph.edges.length).toBe(1);
    const edge = graph.edges[0];
    expect(edge.from).toBe('src/a');
    expect(edge.to).toBe('src/b');
    expect(edge.typeOnlyStrength).toBe(1);
    expect(edge.valueStrength).toBe(0);
  });

  it('splits a directory pair carrying both a value import and a type-position import', () => {
    const graph = buildWith(
      `import { X } from '../b/index';
type T = import('../b/index').Y;`
    );
    const edge = graph.edges.find((e) => e.from === 'src/a' && e.to === 'src/b');
    expect(edge).toBeDefined();
    expect(edge?.strength).toBe(2);
    expect(edge?.typeOnlyStrength).toBe(1);
    expect(edge?.valueStrength).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Type-only vs value dependency split (typeOnlyStrength / valueStrength)
// ---------------------------------------------------------------------------

describe('ModuleGraphBuilder — type-only vs value edge strength', () => {
  const MODULE_B = `export const A = 1;
export const B = 2;
export default 1;
export interface T {}
export type U = number;`;

  /** Build a graph from a single `src/a/x.ts` source against `src/b/index.ts`. */
  const buildWith = (aSource: string) => {
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { target: 99 } });
    project.createSourceFile('/root/src/b/index.ts', MODULE_B);
    project.createSourceFile('/root/src/a/x.ts', aSource);
    const graph = new ModuleGraphBuilder().build('/root', project.getSourceFiles(), []);
    return graph.edges.find((e) => e.from === 'src/a' && e.to === 'src/b');
  };

  const typeOnlyForms: Array<[label: string, source: string]> = [
    ['import type { A }', `import type { A } from '../b/index';`],
    ['import type X (type default import)', `import type X from '../b/index';`],
    ['import type * as X (type namespace import)', `import type * as X from '../b/index';`],
    [
      'import { type A, type B } (all named type-only)',
      `import { type A, type B } from '../b/index';`,
    ],
    ['export type { A }', `export type { A } from '../b/index';`],
    ['export type *', `export type * from '../b/index';`],
  ];

  it.each(typeOnlyForms)('%s → strength=1, typeOnlyStrength=1, valueStrength=0', (_label, src) => {
    const edge = buildWith(src);
    expect(edge).toBeDefined();
    expect(edge?.strength).toBe(1);
    expect(edge?.typeOnlyStrength).toBe(1);
    expect(edge?.valueStrength).toBe(0);
  });

  const valueForms: Array<[label: string, source: string]> = [
    ['import { type A, B } (mixed named)', `import { type A, B } from '../b/index';`],
    ['import { A } (plain named)', `import { A } from '../b/index';`],
    ['import X (default)', `import X from '../b/index';`],
    ['import * as X (namespace)', `import * as X from '../b/index';`],
    ['import (side-effect only)', `import '../b/index';`],
    ['export { A }', `export { A } from '../b/index';`],
    ['export *', `export * from '../b/index';`],
    ['export * as ns', `export * as ns from '../b/index';`],
    [
      'literal dynamic import()',
      `export async function load() {\n  return import('../b/index');\n}`,
    ],
  ];

  it.each(valueForms)('%s → strength=1, typeOnlyStrength=0, valueStrength=1', (_label, src) => {
    const edge = buildWith(src);
    expect(edge).toBeDefined();
    expect(edge?.strength).toBe(1);
    expect(edge?.typeOnlyStrength).toBe(0);
    expect(edge?.valueStrength).toBe(1);
  });

  it('splits a mixed directory pair into 3 type-only + 2 value (strength=5)', () => {
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { target: 99 } });
    project.createSourceFile('/root/src/b/index.ts', MODULE_B);
    // 3 type-only statements + 2 value statements, all targeting src/b.
    project.createSourceFile(
      '/root/src/a/x.ts',
      `import type { A } from '../b/index';
import type { B } from '../b/index';
import { type T, type U } from '../b/index';
import { A as valueA } from '../b/index';
import '../b/index';`
    );
    // A second directory pair so the invariant is asserted over more than one edge.
    project.createSourceFile('/root/src/c/y.ts', `export { A as reA } from '../b/index';`);

    const graph = new ModuleGraphBuilder().build('/root', project.getSourceFiles(), []);
    const edge = graph.edges.find((e) => e.from === 'src/a' && e.to === 'src/b');
    expect(edge).toBeDefined();
    expect(edge?.strength).toBe(5);
    expect(edge?.typeOnlyStrength).toBe(3);
    expect(edge?.valueStrength).toBe(2);

    // Invariant holds for every edge in the graph.
    expect(graph.edges.length).toBeGreaterThanOrEqual(2);
    for (const e of graph.edges) {
      expect(e.strength).toBe((e.typeOnlyStrength ?? 0) + (e.valueStrength ?? 0));
    }
  });
});

describe('ModuleGraphBuilder — bare alias resolution from tsconfig paths', () => {
  const makeProject = (): Project =>
    new Project({
      useInMemoryFileSystem: true,
      compilerOptions: { target: 99, baseUrl: '/root', paths: { '@/*': ['src/*'] } },
    });

  it('resolves bare @/types to src/types and produces no @/ external node', () => {
    const project = makeProject();
    project.createSourceFile('/root/src/types/index.ts', `export interface T {}`);
    project.createSourceFile(
      '/root/src/a/x.ts',
      `import type { T } from '@/types';\nexport type U = T;`
    );

    const graph = new ModuleGraphBuilder().build('/root', project.getSourceFiles(), []);

    const edge = graph.edges.find((e) => e.from === 'src/a' && e.to === 'src/types');
    expect(edge).toBeDefined();
    expect(graph.nodes.find((n) => n.id === '@/types')).toBeUndefined();
    expect(graph.nodes.some((n) => n.id.startsWith('@/'))).toBe(false);
  });

  it('records an unresolvable alias specifier in unresolved instead of an external node', () => {
    const project = makeProject();
    project.createSourceFile('/root/src/a/x.ts', `import { Missing } from '@/does/not/exist';`);

    const graph = new ModuleGraphBuilder().build('/root', project.getSourceFiles(), []);

    expect(graph.nodes.some((n) => n.id.startsWith('@/'))).toBe(false);
    expect(
      graph.unresolved?.some((u) => u.from === 'src/a' && u.specifier === '@/does/not/exist')
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// External edges are decided by the specifier, not by resolver success
// ---------------------------------------------------------------------------

describe('ModuleGraphBuilder — external edges are resolution-independent', () => {
  const builder = new ModuleGraphBuilder();
  const projectRoot = '/project/src';

  /** A ts-morph SourceFile living in node_modules: reachable, but not our module. */
  const nodeModulesFile = (pkg: string) =>
    makeSourceFile(`/project/node_modules/${pkg}/lib/index.d.ts`);

  /** A minimal `import('...')` CallExpression mock (SyntaxKind.ImportKeyword). */
  const dynamicImport = (specifier: string) => ({
    getExpression: () => ({ getKind: () => SyntaxKind.ImportKeyword }),
    getArguments: () => [
      { getKind: () => SyntaxKind.StringLiteral, getLiteralText: () => specifier },
    ],
  });

  /** Source file mock carrying static imports, re-exports and dynamic imports. */
  const callerFile = (
    filePath: string,
    parts: { imports?: ImportDeclaration[]; exports?: ExportDeclaration[]; dynamic?: unknown[] }
  ) =>
    ({
      getFilePath: () => filePath,
      getImportDeclarations: () => parts.imports ?? [],
      getExportDeclarations: () => parts.exports ?? [],
      // The builder asks for two different SyntaxKinds; only CallExpression is
      // the dynamic-import collection (ImportType has no nodes in these mocks).
      getDescendantsOfKind: (kind: SyntaxKind) =>
        kind === SyntaxKind.CallExpression ? (parts.dynamic ?? []) : [],
    }) as unknown as SourceFile;

  it('does not drop the edge when ts-morph resolves the package into node_modules', () => {
    // `fs-extra` resolves to a real .d.ts under node_modules (hence a non-null
    // resolvedFile) but that file is not in fileToModule — the edge must survive.
    const caller = callerFile('/project/src/a/x.ts', {
      imports: [makeImportDecl('fs-extra', nodeModulesFile('fs-extra'), ['ensureDir'])],
    });

    const graph = builder.build(projectRoot, [caller], []);

    const edge = graph.edges.find((e) => e.from === 'a' && e.to === 'fs-extra');
    expect(edge).toBeDefined();
    expect(edge?.strength).toBe(1);
    expect(edge?.valueStrength).toBe(1);
    expect(graph.nodes.find((n) => n.id === 'fs-extra')?.type).toBe('node_modules');
  });

  it('emits an external edge for `export ... from` a resolvable package', () => {
    const caller = callerFile('/project/src/a/x.ts', {
      exports: [makeExportDecl('micromatch', nodeModulesFile('micromatch'))],
    });

    const graph = builder.build(projectRoot, [caller], []);

    expect(graph.edges.find((e) => e.from === 'a' && e.to === 'micromatch')).toBeDefined();
  });

  it('gives a resolvable and an unresolvable package the same static+dynamic edge', () => {
    const caller = callerFile('/project/src/a/x.ts', {
      imports: [
        makeImportDecl('fs-extra', nodeModulesFile('fs-extra'), ['ensureDir']),
        makeImportDecl('ghost-pkg', null, ['ghost']),
      ],
      dynamic: [dynamicImport('fs-extra'), dynamicImport('ghost-pkg')],
    });

    const graph = builder.build(projectRoot, [caller], []);

    // Both packages get one static + one dynamic contribution (strength 2):
    // resolver success must not decide whether the edge exists.
    const resolved = graph.edges.find((e) => e.from === 'a' && e.to === 'fs-extra');
    const unresolved = graph.edges.find((e) => e.from === 'a' && e.to === 'ghost-pkg');
    expect(resolved?.strength).toBe(2);
    expect(unresolved?.strength).toBe(2);
    expect(graph.nodes.find((n) => n.id === 'ghost-pkg')?.type).toBe('node_modules');
  });

  it('still skips a relative specifier that resolves outside the source root', () => {
    // Negative control: a relative import resolving to a file we do not own is
    // NOT a package — it must not create a phantom external node.
    const outsideFile = makeSourceFile('/project/outside/util.ts');
    const caller = makeSourceFile('/project/src/a/x.ts', [
      makeImportDecl('../../outside/util', outsideFile, ['util']),
    ]);

    const graph = builder.build(projectRoot, [caller], []);

    expect(graph.edges.length).toBe(0);
    expect(graph.nodes.some((n) => n.type === 'node_modules')).toBe(false);
  });
});

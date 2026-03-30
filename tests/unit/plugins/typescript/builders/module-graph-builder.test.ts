/**
 * Tests for ModuleGraphBuilder — relative import resolution fallback
 *
 * TDD: Covers the case where ts-morph getModuleSpecifierSourceFile() returns null
 * for relative imports, and we must fall back to manual path resolution using
 * the fileToModule map.
 */

import { describe, it, expect } from 'vitest';
import { ModuleGraphBuilder } from '@/plugins/typescript/builders/module-graph-builder.js';
import type { SourceFile, ImportDeclaration } from 'ts-morph';

// ---------------------------------------------------------------------------
// Helpers to create minimal ts-morph mock objects
// ---------------------------------------------------------------------------

function makeImportDecl(
  specifier: string,
  resolvedFile: SourceFile | null = null,
  namedImports: string[] = [],
  defaultImport: string | null = null,
): ImportDeclaration {
  return {
    getModuleSpecifierSourceFile: () => resolvedFile,
    getModuleSpecifierValue: () => specifier,
    getNamedImports: () => namedImports.map((n) => ({ getName: () => n })),
    getDefaultImport: () => (defaultImport ? { getText: () => defaultImport } : undefined),
  } as unknown as ImportDeclaration;
}

function makeSourceFile(filePath: string, imports: ImportDeclaration[] = []): SourceFile {
  return {
    getFilePath: () => filePath,
    getImportDeclarations: () => imports,
  } as unknown as SourceFile;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

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
    const internalEdges = graph.edges.filter(
      (e) => e.from !== 'hooks' || e.to !== 'utils' ? false : true,
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
    const internalEdges = graph.edges.filter(
      (e) => !graph.nodes.find((n) => n.id === e.to && n.type === 'node_modules'),
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

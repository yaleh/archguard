/**
 * TypeScriptAnalyzer integration tests
 *
 * Tests must FAIL before implementation exists.
 */

import { describe, it, expect } from 'vitest';
import { Project } from 'ts-morph';
import { TypeScriptAnalyzer } from '@/plugins/typescript/typescript-analyzer.js';

describe('TypeScriptAnalyzer', () => {
  it('returns TsAnalysis with a non-empty moduleGraph when files have import relationships', async () => {
    const project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: { target: 99 },
    });
    project.createSourceFile('/root/src/cli/index.ts', `import { parse } from '../parser/index';`);
    project.createSourceFile('/root/src/parser/index.ts', `export function parse() {}`);

    const analyzer = new TypeScriptAnalyzer();
    const result = analyzer.analyze('/root', project.getSourceFiles(), []);

    expect(result.version).toBe('1.0');
    expect(result.moduleGraph).toBeDefined();
    expect(result.moduleGraph.nodes.length).toBeGreaterThan(0);
    expect(result.moduleGraph.edges.length).toBeGreaterThan(0);
  });

  it('returns TsAnalysis with empty moduleGraph when no imports', async () => {
    const project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: { target: 99 },
    });
    project.createSourceFile('/root/src/standalone/index.ts', `export function standalone() {}`);

    const analyzer = new TypeScriptAnalyzer();
    const result = analyzer.analyze('/root', project.getSourceFiles(), []);

    expect(result.moduleGraph).toBeDefined();
    expect(result.moduleGraph.edges).toHaveLength(0);
    expect(result.moduleGraph.cycles).toHaveLength(0);
  });
});

/**
 * ModuleGraphBuilder unit tests
 *
 * Uses ts-morph Project with in-memory source files to test module graph construction.
 * All tests must FAIL before implementation exists.
 */

import { describe, it, expect } from 'vitest';
import { Project } from 'ts-morph';
import type { Entity } from '@/types/index.js';
import { ModuleGraphBuilder } from '@/plugins/typescript/builders/module-graph-builder.js';

function makeProject(): Project {
  return new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { target: 99 },
  });
}

describe('ModuleGraphBuilder', () => {
  describe('basic graph construction', () => {
    it('creates two module nodes and one edge when one file imports from another directory', () => {
      const project = makeProject();
      project.createSourceFile(
        '/root/src/cli/index.ts',
        `import { parseProject } from '../parser/index';`
      );
      project.createSourceFile('/root/src/parser/index.ts', `export function parseProject() {}`);

      const builder = new ModuleGraphBuilder();
      const graph = builder.build('/root', project.getSourceFiles(), []);

      const nodeIds = graph.nodes.map((n) => n.id).sort();
      expect(nodeIds).toContain('src/cli');
      expect(nodeIds).toContain('src/parser');

      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0].from).toBe('src/cli');
      expect(graph.edges[0].to).toBe('src/parser');
      expect(graph.edges[0].strength).toBe(1);
    });

    it('accumulates strength=2 when two files in the same module both import from another module', () => {
      const project = makeProject();
      project.createSourceFile(
        '/root/src/cli/cmd-a.ts',
        `import { ConfigType } from '../types/index';`
      );
      project.createSourceFile(
        '/root/src/cli/cmd-b.ts',
        `import { ParseConfig } from '../types/index';`
      );
      project.createSourceFile(
        '/root/src/types/index.ts',
        `export interface ConfigType {}
export interface ParseConfig {}`
      );

      const builder = new ModuleGraphBuilder();
      const graph = builder.build('/root', project.getSourceFiles(), []);

      const edge = graph.edges.find((e) => e.from === 'src/cli' && e.to === 'src/types');
      expect(edge).toBeDefined();
      expect(edge.strength).toBe(2);
      expect(edge.importedNames).toContain('ConfigType');
      expect(edge.importedNames).toContain('ParseConfig');
    });

    it('creates node_modules type node for external package imports', () => {
      const project = makeProject();
      project.createSourceFile('/root/src/cli/index.ts', `import path from 'path';`);

      const builder = new ModuleGraphBuilder();
      const graph = builder.build('/root', project.getSourceFiles(), []);

      const pathNode = graph.nodes.find((n) => n.id === 'path');
      expect(pathNode).toBeDefined();
      expect(pathNode.type).toBe('node_modules');

      const edge = graph.edges.find((e) => e.to === 'path');
      expect(edge).toBeDefined();
    });

    it('returns only nodes and empty edges/cycles when no imports exist', () => {
      const project = makeProject();
      project.createSourceFile('/root/src/parser/index.ts', `export function parse() {}`);

      const builder = new ModuleGraphBuilder();
      const graph = builder.build('/root', project.getSourceFiles(), []);

      expect(graph.nodes).toHaveLength(1);
      expect(graph.edges).toHaveLength(0);
      expect(graph.cycles).toHaveLength(0);
    });
  });

  describe('cycle detection', () => {
    it('detects a 2-module cycle and reports severity: warning', () => {
      const project = makeProject();
      project.createSourceFile(
        '/root/src/a/index.ts',
        `import { B } from '../b/index';
export class A {}`
      );
      project.createSourceFile(
        '/root/src/b/index.ts',
        `import { A } from '../a/index';
export class B {}`
      );

      const builder = new ModuleGraphBuilder();
      const graph = builder.build('/root', project.getSourceFiles(), []);

      expect(graph.cycles).toHaveLength(1);
      expect(graph.cycles[0].modules).toContain('src/a');
      expect(graph.cycles[0].modules).toContain('src/b');
      expect(graph.cycles[0].severity).toBe('warning');
    });
  });

  describe('stats computation', () => {
    it('counts stats.classes from entities whose id starts with module path prefix', () => {
      const project = makeProject();
      project.createSourceFile('/root/src/cli/index.ts', `export class CliRunner {}`);

      const entities: Entity[] = [
        {
          id: 'src/cli/index.ts.CliRunner',
          name: 'CliRunner',
          type: 'class',
          methods: [],
          properties: [],
        },
        {
          id: 'src/cli/index.ts.CliOptions',
          name: 'CliOptions',
          type: 'interface',
          methods: [],
          properties: [],
        },
        {
          id: 'src/parser/index.ts.Parser',
          name: 'Parser',
          type: 'class',
          methods: [],
          properties: [],
        },
      ];

      const builder = new ModuleGraphBuilder();
      const graph = builder.build('/root', project.getSourceFiles(), entities);

      const cliNode = graph.nodes.find((n) => n.id === 'src/cli');
      expect(cliNode).toBeDefined();
      expect(cliNode.stats.classes).toBe(1);
      expect(cliNode.stats.interfaces).toBe(1);
    });
  });

  describe('edge deduplication', () => {
    it('deduplicates importedNames across multiple imports from the same module', () => {
      const project = makeProject();
      project.createSourceFile(
        '/root/src/cli/cmd.ts',
        `import { ConfigType, ConfigType } from '../types/index';`
      );
      project.createSourceFile('/root/src/types/index.ts', `export interface ConfigType {}`);

      const builder = new ModuleGraphBuilder();
      const graph = builder.build('/root', project.getSourceFiles(), []);

      const edge = graph.edges.find((e) => e.from === 'src/cli' && e.to === 'src/types');
      expect(edge).toBeDefined();
      // importedNames should not contain duplicates
      const names = edge.importedNames;
      const uniqueNames = [...new Set(names)];
      expect(names).toEqual(uniqueNames);
    });
  });

  describe('module ID assignment', () => {
    it('assigns root-level files to root module id', () => {
      const project = makeProject();
      project.createSourceFile('/root/index.ts', `export function main() {}`);

      const builder = new ModuleGraphBuilder();
      const graph = builder.build('/root', project.getSourceFiles(), []);

      // Root-level file → module id is empty string or '.'
      expect(graph.nodes).toHaveLength(1);
      // The node should exist
      expect(graph.nodes[0].fileCount).toBe(1);
    });

    it('assigns files in the same directory to the same module node', () => {
      const project = makeProject();
      project.createSourceFile('/root/src/cli/a.ts', `export class A {}`);
      project.createSourceFile('/root/src/cli/b.ts', `export class B {}`);

      const builder = new ModuleGraphBuilder();
      const graph = builder.build('/root', project.getSourceFiles(), []);

      // Both files belong to src/cli — only one node
      const cliNodes = graph.nodes.filter((n) => n.id === 'src/cli');
      expect(cliNodes).toHaveLength(1);
      expect(cliNodes[0].fileCount).toBe(2);
    });
  });
});

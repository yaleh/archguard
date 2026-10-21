import { Project } from 'ts-morph';
import { CallEdgeExtractor } from '@/parser/call-edge-extractor.js';
import type { Entity } from '@/types/index.js';
import { describe, it, expect, beforeEach, vi } from 'vitest';

function makeEntity(id: string, name: string, type: Entity['type'] = 'class'): Entity {
  return {
    id,
    name,
    type,
    visibility: 'public',
    members: [],
    sourceLocation: { file: id.slice(0, id.lastIndexOf('.')), startLine: 1, endLine: 1 },
  };
}

function fnEntity(id: string, name: string): Entity {
  return makeEntity(id, name, 'function');
}

describe('CallEdgeExtractor', () => {
  const workspaceRoot = '/workspace';
  let project: Project;

  beforeEach(() => {
    project = new Project({ useInMemoryFileSystem: true });
  });

  it('extracts call edge when method calls another project class method', () => {
    project.createSourceFile(
      '/workspace/types.ts',
      `
      export class Service {
        save(): void {}
      }
    `
    );
    project.createSourceFile(
      '/workspace/handler.ts',
      `
      import { Service } from './types.js';
      export class Handler {
        private svc: Service;
        constructor(svc: Service) { this.svc = svc; }
        handle(): void {
          this.svc.save();
        }
      }
    `
    );
    const entities = [
      { id: 'types.ts.Service', name: 'Service' } as any,
      { id: 'handler.ts.Handler', name: 'Handler' } as any,
    ];
    const extractor = new CallEdgeExtractor(project, entities, workspaceRoot);
    const relations = extractor.extractAll();
    const callEdge = relations.find((r) => r.type === 'call' && r.sourceMethod === 'handle');
    expect(callEdge).toBeDefined();
    expect(callEdge.targetMethod).toBe('save');
    expect(callEdge.callType).toBe('direct');
  });

  it('does NOT extract call edge to non-project entity (e.g. console.log)', () => {
    project.createSourceFile(
      '/workspace/foo.ts',
      `
      export class Foo {
        run(): void {
          console.log('hello');
        }
      }
    `
    );
    const entities = [{ id: 'foo.ts.Foo', name: 'Foo' } as any];
    const extractor = new CallEdgeExtractor(project, entities, workspaceRoot);
    const relations = extractor.extractAll();
    expect(relations.filter((r) => r.type === 'call')).toHaveLength(0);
  });

  it('produces inferenceSource=explicit on call edges', () => {
    project.createSourceFile(
      '/workspace/a.ts',
      `
      export class A { doThing(): void {} }
    `
    );
    project.createSourceFile(
      '/workspace/b.ts',
      `
      import { A } from './a.js';
      export class B {
        private a: A;
        constructor(a: A) { this.a = a; }
        run(): void { this.a.doThing(); }
      }
    `
    );
    const entities = [{ id: 'a.ts.A', name: 'A' } as any, { id: 'b.ts.B', name: 'B' } as any];
    const extractor = new CallEdgeExtractor(project, entities, workspaceRoot);
    const relations = extractor.extractAll();
    const callEdge = relations.find((r) => r.type === 'call');
    expect(callEdge?.inferenceSource).toBe('explicit');
  });

  it('deduplicates same source+target+method call appearing multiple times', () => {
    project.createSourceFile(
      '/workspace/c.ts',
      `
      export class C { save(): void {} }
    `
    );
    project.createSourceFile(
      '/workspace/d.ts',
      `
      import { C } from './c.js';
      export class D {
        private c: C;
        constructor(c: C) { this.c = c; }
        run(): void {
          this.c.save();
          this.c.save(); // duplicate
        }
      }
    `
    );
    const entities = [{ id: 'c.ts.C', name: 'C' } as any, { id: 'd.ts.D', name: 'D' } as any];
    const extractor = new CallEdgeExtractor(project, entities, workspaceRoot);
    const relations = extractor.extractAll();
    const callEdges = relations.filter((r) => r.type === 'call' && r.sourceMethod === 'run');
    expect(callEdges).toHaveLength(1);
  });

  it('classifies calls on interface-typed receivers as interface', () => {
    project.createSourceFile(
      '/workspace/types.ts',
      `
      export interface Repository {
        find(): void;
      }
    `
    );
    project.createSourceFile(
      '/workspace/service.ts',
      `
      export class Repo implements Repository {
        find(): void {}
      }
    `
    );
    project.createSourceFile(
      '/workspace/controller.ts',
      `
      import { Repository } from './types.js';
      export class Controller {
        constructor(private repo: Repository) {}
        get(): void { this.repo.find(); }
      }
    `
    );
    const entities = [
      { id: 'types.ts.Repository', name: 'Repository' } as any,
      { id: 'service.ts.Repo', name: 'Repo' } as any,
      { id: 'controller.ts.Controller', name: 'Controller' } as any,
    ];
    const extractor = new CallEdgeExtractor(project, entities, workspaceRoot);
    const relations = extractor.extractAll();
    const callEdge = relations.find((r) => r.type === 'call' && r.sourceMethod === 'get');
    expect(callEdge).toBeDefined();
    expect(callEdge.callType).toBe('interface');
    expect(callEdge.confidence).toBe(0.6);
  });

  it('skips methods without a body (abstract/overload)', () => {
    project.createSourceFile(
      '/workspace/a.ts',
      `
      export abstract class Base {
        abstract run(): void;
      }
    `
    );
    const entities = [{ id: 'a.ts.Base', name: 'Base' } as any];
    const extractor = new CallEdgeExtractor(project, entities, workspaceRoot);
    const relations = extractor.extractAll();
    expect(relations.filter((r) => r.type === 'call')).toHaveLength(0);
  });

  it('does not emit an edge for an unresolved bare identifier call', () => {
    project.createSourceFile(
      '/workspace/a.ts',
      `
      export class A {
        run(): void {
          helper();
        }
      }
    `
    );
    const entities = [{ id: 'a.ts.A', name: 'A' } as any];
    const extractor = new CallEdgeExtractor(project, entities, workspaceRoot);
    const relations = extractor.extractAll();
    expect(relations.filter((r) => r.type === 'call')).toHaveLength(0);
  });

  it('skips anonymous classes (no name)', () => {
    project.createSourceFile(
      '/workspace/a.ts',
      `
      export const instance = class {
        run(): void {
          console.log('x');
        }
      };
    `
    );
    const extractor = new CallEdgeExtractor(project, [], workspaceRoot);
    const relations = extractor.extractAll();
    expect(relations.filter((r) => r.type === 'call')).toHaveLength(0);
  });

  it('sets source entity ID to relPath.ClassName format', () => {
    project.createSourceFile(
      '/workspace/src/service.ts',
      `
      export class Repo { find(): void {} }
    `
    );
    project.createSourceFile(
      '/workspace/src/controller.ts',
      `
      import { Repo } from './service.js';
      export class Controller {
        private repo: Repo;
        constructor(repo: Repo) { this.repo = repo; }
        get(): void { this.repo.find(); }
      }
    `
    );
    const entities = [
      { id: 'src/service.ts.Repo', name: 'Repo' } as any,
      { id: 'src/controller.ts.Controller', name: 'Controller' } as any,
    ];
    const extractor = new CallEdgeExtractor(project, entities, workspaceRoot);
    const relations = extractor.extractAll();
    const callEdge = relations.find((r) => r.type === 'call');
    expect(callEdge).toBeDefined();
    expect(callEdge.source).toBe('src/controller.ts.Controller');
    expect(callEdge.target).toBe('src/service.ts.Repo');
  });
});

describe('CallEdgeExtractor - function-level coverage matrix', () => {
  const workspaceRoot = '/workspace';
  let project: Project;

  beforeEach(() => {
    project = new Project({ useInMemoryFileSystem: true });
  });

  it('extracts a cross-file bare-identifier call between top-level functions', () => {
    project.createSourceFile('/workspace/util.ts', 'export function helper(): void {}');
    project.createSourceFile(
      '/workspace/main.ts',
      `
      import { helper } from './util.js';
      export function run(): void { helper(); }
      `
    );
    const extractor = new CallEdgeExtractor(
      project,
      [fnEntity('util.ts.helper', 'helper'), fnEntity('main.ts.run', 'run')],
      workspaceRoot
    );
    const edges = extractor.extractAll().filter((r) => r.type === 'call');

    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      source: 'main.ts.run',
      sourceMethod: 'run',
      target: 'util.ts.helper',
      targetMethod: 'helper',
      callType: 'direct',
    });
  });

  it('extracts a call from an exported arrow const to another exported arrow const', () => {
    project.createSourceFile('/workspace/lib.ts', 'export const arrowTarget = (): void => {};');
    project.createSourceFile(
      '/workspace/main.ts',
      `
      import { arrowTarget } from './lib.js';
      export const runArrow = (): void => { arrowTarget(); };
      `
    );
    const extractor = new CallEdgeExtractor(
      project,
      [fnEntity('lib.ts.arrowTarget', 'arrowTarget'), fnEntity('main.ts.runArrow', 'runArrow')],
      workspaceRoot
    );
    const edge = extractor.extractAll().find((r) => r.type === 'call');

    expect(edge).toMatchObject({
      source: 'main.ts.runArrow',
      sourceMethod: 'runArrow',
      target: 'lib.ts.arrowTarget',
      targetMethod: 'arrowTarget',
    });
  });

  it('extracts a bare-identifier call from inside a class method', () => {
    project.createSourceFile('/workspace/util.ts', 'export function helper(): void {}');
    project.createSourceFile(
      '/workspace/service.ts',
      `
      import { helper } from './util.js';
      export class Service {
        run(): void { helper(); }
      }
      `
    );
    const extractor = new CallEdgeExtractor(
      project,
      [fnEntity('util.ts.helper', 'helper'), makeEntity('service.ts.Service', 'Service')],
      workspaceRoot
    );
    const edge = extractor.extractAll().find((r) => r.type === 'call');

    expect(edge).toMatchObject({
      source: 'service.ts.Service',
      sourceMethod: 'run',
      target: 'util.ts.helper',
      targetMethod: 'helper',
    });
  });

  it('extracts a cross-file function-to-function call chain', () => {
    project.createSourceFile(
      '/workspace/steps.ts',
      'export function stepTwo(): void {}\nexport function stepOne(): void { stepTwo(); }'
    );
    project.createSourceFile(
      '/workspace/entry.ts',
      `
      import { stepOne } from './steps.js';
      export function entry(): void { stepOne(); }
      `
    );
    const extractor = new CallEdgeExtractor(
      project,
      [
        fnEntity('steps.ts.stepTwo', 'stepTwo'),
        fnEntity('steps.ts.stepOne', 'stepOne'),
        fnEntity('entry.ts.entry', 'entry'),
      ],
      workspaceRoot
    );
    const edges = extractor.extractAll().filter((r) => r.type === 'call');

    expect(edges).toHaveLength(2);
    expect(edges.map((e) => `${e.source}->${e.target}`).sort()).toEqual([
      'entry.ts.entry->steps.ts.stepOne',
      'steps.ts.stepOne->steps.ts.stepTwo',
    ]);
  });

  it('resolves same-named functions by declaration instead of cross-linking them', () => {
    project.createSourceFile('/workspace/a.ts', 'export function main(): void {}');
    project.createSourceFile('/workspace/b.ts', 'export function main(): void {}');
    project.createSourceFile(
      '/workspace/caller.ts',
      `
      import { main } from './a.js';
      export function callA(): void { main(); }
      `
    );
    project.createSourceFile(
      '/workspace/local.ts',
      'export function main(): void {}\nexport function runLocal(): void { main(); }'
    );
    const extractor = new CallEdgeExtractor(
      project,
      [
        fnEntity('a.ts.main', 'main'),
        fnEntity('b.ts.main', 'main'),
        fnEntity('caller.ts.callA', 'callA'),
        fnEntity('local.ts.main', 'main'),
        fnEntity('local.ts.runLocal', 'runLocal'),
      ],
      workspaceRoot
    );
    const edges = extractor.extractAll().filter((r) => r.type === 'call');

    expect(edges.map((e) => e.target).sort()).toEqual(['a.ts.main', 'local.ts.main']);
    expect(edges.some((e) => e.target === 'b.ts.main')).toBe(false);
  });

  it('does not emit an edge when the called method does not exist on the target', () => {
    project.createSourceFile('/workspace/a.ts', 'export class A { ok(): void {} }');
    project.createSourceFile(
      '/workspace/b.ts',
      `
      import { A } from './a.js';
      export function run(): void {
        const a = new A();
        a.ok();
        a.s();
      }
      `
    );
    const extractor = new CallEdgeExtractor(
      project,
      [makeEntity('a.ts.A', 'A'), fnEntity('b.ts.run', 'run')],
      workspaceRoot
    );
    const edges = extractor.extractAll().filter((r) => r.type === 'call');

    expect(edges).toHaveLength(1);
    expect(edges[0].targetMethod).toBe('ok');
    expect(extractor.getStats().skippedMissingTargetMethod).toBe(1);
  });

  it('does not emit edges for external APIs (fs.readFile / console.log)', () => {
    project.createSourceFile(
      '/workspace/main.ts',
      `
      import * as fs from 'fs';
      export function run(): void {
        fs.readFile('x', () => {});
        console.log('hello');
      }
      `
    );
    const extractor = new CallEdgeExtractor(
      project,
      [fnEntity('main.ts.run', 'run')],
      workspaceRoot
    );

    expect(extractor.extractAll().filter((r) => r.type === 'call')).toHaveLength(0);
  });
});

describe('CallEdgeExtractor - explicit boundaries and diagnostics', () => {
  const workspaceRoot = '/workspace';
  let project: Project;

  beforeEach(() => {
    project = new Project({ useInMemoryFileSystem: true });
  });

  it('counts call sites inside non-exported top-level functions instead of silently dropping them', () => {
    project.createSourceFile(
      '/workspace/main.ts',
      `
      function hidden(): void { helper(); }
      function helper(): void {}
      export function run(): void {}
      `
    );
    const extractor = new CallEdgeExtractor(
      project,
      [fnEntity('main.ts.run', 'run')],
      workspaceRoot
    );
    expect(extractor.extractAll().filter((r) => r.type === 'call')).toHaveLength(0);
    expect(extractor.getStats().skippedNonExportedFunction).toBe(1);
  });

  it('counts constructor, object-literal method, and class-property arrow call sites', () => {
    project.createSourceFile(
      '/workspace/shapes.ts',
      `
      export class A {
        field = (): void => { arrowBody(); };
        constructor() { ctorCall(); }
      }
      const obj = { m(): void { objectCall(); } };
      `
    );
    const extractor = new CallEdgeExtractor(
      project,
      [makeEntity('shapes.ts.A', 'A')],
      workspaceRoot
    );
    expect(extractor.extractAll().filter((r) => r.type === 'call')).toHaveLength(0);

    const stats = extractor.getStats();
    expect(stats.skippedConstructor).toBe(1);
    expect(stats.skippedObjectLiteralMethod).toBe(1);
    expect(stats.skippedClassPropertyArrow).toBe(1);
    expect(stats.skippedUnsupportedContext).toBeGreaterThanOrEqual(3);
  });

  it('catches TypeChecker exceptions per call site instead of aborting extraction', () => {
    project.createSourceFile('/workspace/a.ts', 'export class A { ok(): void {} }');
    project.createSourceFile(
      '/workspace/b.ts',
      `
      import { A } from './a.js';
      export function run(): void {
        const a = new A();
        a.ok();
      }
      `
    );
    const checker = project.getTypeChecker();
    vi.spyOn(checker, 'getTypeAtLocation').mockImplementation(() => {
      throw new Error('ts-morph internal TypeError');
    });

    const extractor = new CallEdgeExtractor(
      project,
      [makeEntity('a.ts.A', 'A'), fnEntity('b.ts.run', 'run')],
      workspaceRoot
    );

    expect(() => extractor.extractAll()).not.toThrow();
    expect(extractor.getStats().checkerErrors).toBeGreaterThan(0);
  });

  it('prints skipped call-site counts when verbose', () => {
    project.createSourceFile(
      '/workspace/main.ts',
      `
      function hidden(): void { helper(); }
      function helper(): void {}
      export function run(): void {}
      `
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const extractor = new CallEdgeExtractor(
        project,
        [fnEntity('main.ts.run', 'run')],
        workspaceRoot,
        { verbose: true }
      );
      extractor.extractAll();

      const output = warn.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(output).toContain('non-exported function call sites=1');
      expect(output).toContain('TypeChecker errors caught per call site=0');
    } finally {
      warn.mockRestore();
    }
  });
});

describe('CallEdgeExtractor - multiple calling methods', () => {
  it('emits one edge per calling method when both call the same target method', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile('/workspace/b.ts', 'export class B { x(): void {} }');
    project.createSourceFile(
      '/workspace/a.ts',
      `
      import { B } from './b.js';
      export class A {
        private b: B;
        constructor(b: B) { this.b = b; }
        m1(): void { this.b.x(); }
        m2(): void { this.b.x(); }
      }
    `
    );
    const entities = [{ id: 'b.ts.B', name: 'B' } as any, { id: 'a.ts.A', name: 'A' } as any];
    const extractor = new CallEdgeExtractor(project, entities, '/workspace');
    const callEdges = extractor.extractAll().filter((r) => r.type === 'call');

    expect(callEdges).toHaveLength(2);
    expect(callEdges.map((r) => r.sourceMethod).sort()).toEqual(['m1', 'm2']);
  });
});

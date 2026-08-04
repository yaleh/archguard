import { Project } from 'ts-morph';
import { CallEdgeExtractor } from '@/parser/call-edge-extractor.js';
import { describe, it, expect, beforeEach } from 'vitest';

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

  it('skips call expressions that are not property access (plain function call)', () => {
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

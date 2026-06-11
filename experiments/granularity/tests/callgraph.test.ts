/**
 * Stage 60.1 / 60.2 tests — call edge criteria (i)–(iv) from proposal §1 R1.
 *
 * Fixture project: tests/fixtures/callgraph/{a,b,iface}.ts.
 * Each criterion has at least one positive and one negative case.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { buildCallGraph, selectView, type CallGraphOutput, type CallEdge } from '../callgraph';

const FIXTURE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'callgraph'
);

let out: CallGraphOutput;

beforeAll(() => {
  out = buildCallGraph({ sourcePaths: [FIXTURE_DIR], basePath: FIXTURE_DIR });
});

function edgesTo(target: string, edges: readonly CallEdge[] = out.edges): CallEdge[] {
  return edges.filter((e) => e.target === target);
}

describe('criterion (i): declaration self / import / type-only positions are filtered', () => {
  it('positive control: a real call edge exists at all', () => {
    expect(out.edges.length).toBeGreaterThan(0);
  });

  it('declaration sites produce no edge (helper has exactly one incoming edge: the greet() call)', () => {
    const edges = edgesTo('a.ts#Greeter.helper');
    expect(edges).toHaveLength(1);
    expect(edges[0]!.kind).toBe('call');
    expect(edges[0]!.source).toBe('a.ts#Greeter.greet');
  });

  it('import statements produce no edge (b.ts line 2 import of Greeter/topFn/arrowTop)', () => {
    const importLineEdges = out.edges.filter(
      (e) => e.location.file === 'b.ts' && e.location.line === 2
    );
    expect(importLineEdges).toHaveLength(0);
  });

  it('pure type positions produce no edge (typeof Greeter in type alias, b.ts line 26)', () => {
    const typeAliasEdges = out.edges.filter(
      (e) => e.location.file === 'b.ts' && e.location.line === 26
    );
    expect(typeAliasEdges).toHaveLength(0);
  });

  it('type annotation positions produce no edge (private g: Greeter, b.ts line 5)', () => {
    const annotationEdges = out.edges.filter(
      (e) => e.location.file === 'b.ts' && e.location.line === 5
    );
    expect(annotationEdges).toHaveLength(0);
  });
});

describe('criterion (ii): callee position => call edge; value position => reference edge', () => {
  it('obj.m() is a call edge (Caller.run -> Greeter.greet)', () => {
    const edges = edgesTo('a.ts#Greeter.greet');
    expect(edges).toHaveLength(1);
    expect(edges[0]!.kind).toBe('call');
    expect(edges[0]!.source).toBe('b.ts#Caller.run');
  });

  it('new C() is a call edge to the constructor (Caller.constructor -> Greeter.constructor)', () => {
    const edges = edgesTo('a.ts#Greeter.constructor');
    expect(edges).toHaveLength(1);
    expect(edges[0]!.kind).toBe('call');
    expect(edges[0]!.source).toBe('b.ts#Caller.constructor');
  });

  it('method passed as value (arr.map(this.m)) is a reference edge, not a call', () => {
    const edges = edgesTo('b.ts#Caller.callback');
    expect(edges).toHaveLength(1);
    expect(edges[0]!.kind).toBe('reference');
    expect(edges[0]!.source).toBe('b.ts#Caller.run');
  });

  it('reference edges are excluded from the B-class main view (call kind only)', () => {
    const mainGt = out.edges.filter((e) => e.kind === 'call');
    expect(mainGt.some((e) => e.target === 'b.ts#Caller.callback')).toBe(false);
    expect(mainGt.some((e) => e.target === 'a.ts#Greeter.greet')).toBe(true);
  });
});

describe('criterion (iii): source attribution to nearest enclosing function / <module-top>', () => {
  it('a call inside a nested function is attributed to the innermost function', () => {
    const edges = edgesTo('a.ts#topFn');
    const nested = edges.filter((e) => e.source === 'b.ts#Caller.run.inner');
    expect(nested).toHaveLength(1);
    expect(nested[0]!.kind).toBe('call');
  });

  it('a module top-level call is attributed to <module-top>', () => {
    const edges = edgesTo('a.ts#topFn');
    const top = edges.filter((e) => e.source === 'b.ts#<module-top>');
    expect(top).toHaveLength(1);
    expect(top[0]!.kind).toBe('call');
  });

  it('top-level call to an arrow-function const targets the variable name', () => {
    const edges = edgesTo('a.ts#arrowTop');
    expect(edges).toHaveLength(1);
    expect(edges[0]!.kind).toBe('call');
    expect(edges[0]!.source).toBe('b.ts#<module-top>');
  });

  it('negative: nested call is NOT attributed to the outer method or module top', () => {
    const edges = edgesTo('a.ts#topFn');
    expect(edges.some((e) => e.source === 'b.ts#Caller.run')).toBe(false);
  });
});

describe('criterion (iv): interface dispatch — dual views', () => {
  it('interface-member view has exactly 1 edge to the interface member, viaInterface=true', () => {
    const view = selectView(out, 'interface-member');
    const edges = edgesTo('iface.ts#Runner.run', view).filter((e) => e.kind === 'call');
    expect(edges).toHaveLength(1);
    expect(edges[0]!.source).toBe('iface.ts#drive');
    expect(edges[0]!.viaInterface).toBe(true);
  });

  it('expanded view has 2 edges (one per implementation), both viaInterface=true', () => {
    const view = selectView(out, 'expanded');
    const expanded = view.filter(
      (e) => e.source === 'iface.ts#drive' && e.kind === 'call' && e.viaInterface
    );
    expect(expanded).toHaveLength(2);
    const targets = expanded.map((e) => e.target).sort();
    expect(targets).toEqual(['iface.ts#FastRunner.run', 'iface.ts#SlowRunner.run']);
  });

  it('expanded view does not contain the interface-member edge (and vice versa)', () => {
    const expandedView = selectView(out, 'expanded');
    expect(edgesTo('iface.ts#Runner.run', expandedView)).toHaveLength(0);
    const ifaceView = selectView(out, 'interface-member');
    expect(
      ifaceView.filter((e) => e.source === 'iface.ts#drive' && e.target.endsWith('Runner.run'))
    ).toHaveLength(1);
  });

  it('negative: concrete dispatch (new FastRunner().run()) is unaffected — present in both views with viaInterface=false', () => {
    for (const viewName of ['interface-member', 'expanded'] as const) {
      const view = selectView(out, viewName);
      const direct = view.filter(
        (e) => e.source === 'iface.ts#direct' && e.target === 'iface.ts#FastRunner.run'
      );
      expect(direct).toHaveLength(1);
      expect(direct[0]!.kind).toBe('call');
      expect(direct[0]!.viaInterface).toBe(false);
    }
  });

  it('non-interface calls appear in both views (Greeter.greet edge)', () => {
    for (const viewName of ['interface-member', 'expanded'] as const) {
      const view = selectView(out, viewName);
      expect(edgesTo('a.ts#Greeter.greet', view)).toHaveLength(1);
    }
  });
});

describe('output shape', () => {
  it('every edge carries kind, fully-qualified source/target and a location', () => {
    for (const e of out.edges) {
      expect(['call', 'reference']).toContain(e.kind);
      expect(e.source).toMatch(/#/);
      expect(e.target).toMatch(/#/);
      expect(e.location.file.length).toBeGreaterThan(0);
      expect(e.location.line).toBeGreaterThan(0);
      expect(e.location.column).toBeGreaterThan(0);
    }
  });

  it('stats match the edge list', () => {
    expect(out.stats.call).toBe(out.edges.filter((e) => e.kind === 'call').length);
    expect(out.stats.reference).toBe(out.edges.filter((e) => e.kind === 'reference').length);
    expect(out.stats.viaInterface).toBe(out.edges.filter((e) => e.viaInterface).length);
  });

  it('scope lists the analyzed source paths', () => {
    expect(out.scope).toEqual([FIXTURE_DIR]);
  });
});

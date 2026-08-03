/**
 * Unit tests for atlas-metrics-analysis: computePackageFanMetrics / enrichPackageNodes.
 */

import { describe, it, expect } from 'vitest';
import {
  computePackageFanMetrics,
  enrichPackageNodes,
} from '@/analysis/atlas-metrics-analysis.js';
import type { PackageGraph, PackageNode } from '@/types/extensions/go-atlas.js';

function makeGraph(edges: Array<[string, string]>): PackageGraph {
  return {
    nodes: [],
    edges: edges.map(([source, target]) => ({ source, target, strength: 1 })),
    cycles: [],
  };
}

describe('computePackageFanMetrics', () => {
  it('returns empty maps for an empty graph', () => {
    const { fanIn, fanOut } = computePackageFanMetrics(makeGraph([]));
    expect(fanIn.size).toBe(0);
    expect(fanOut.size).toBe(0);
  });

  it('counts fan-in per target package', () => {
    const { fanIn } = computePackageFanMetrics(
      makeGraph([
        ['a', 'c'],
        ['b', 'c'],
        ['a', 'd'],
      ])
    );
    expect(fanIn.get('c')).toBe(2);
    expect(fanIn.get('d')).toBe(1);
    expect(fanIn.get('a')).toBeUndefined();
  });

  it('counts fan-out per source package', () => {
    const { fanOut } = computePackageFanMetrics(
      makeGraph([
        ['a', 'c'],
        ['a', 'd'],
        ['b', 'c'],
      ])
    );
    expect(fanOut.get('a')).toBe(2);
    expect(fanOut.get('b')).toBe(1);
    expect(fanOut.get('c')).toBeUndefined();
  });

  it('handles a self-loop by counting it once for both fan-in and fan-out', () => {
    const { fanIn, fanOut } = computePackageFanMetrics(makeGraph([['a', 'a']]));
    expect(fanIn.get('a')).toBe(1);
    expect(fanOut.get('a')).toBe(1);
  });

  it('handles duplicate edges (multi-imports) by counting each edge', () => {
    const { fanIn } = computePackageFanMetrics(
      makeGraph([
        ['a', 'b'],
        ['a', 'b'],
      ])
    );
    expect(fanIn.get('b')).toBe(2);
  });
});

describe('enrichPackageNodes', () => {
  const node = (id: string): PackageNode => ({
    id,
    name: id,
    type: 'internal',
    fileCount: 1,
  });

  it('enriches nodes with computed fan metrics', () => {
    const fanIn = new Map([['a', 3]]);
    const fanOut = new Map([['a', 1], ['b', 2]]);
    const result = enrichPackageNodes([node('a'), node('b')], fanIn, fanOut);
    expect(result[0]).toMatchObject({ id: 'a', fanIn: 3, fanOut: 1 });
    expect(result[1]).toMatchObject({ id: 'b', fanIn: 0, fanOut: 2 });
  });

  it('defaults missing entries to 0', () => {
    const result = enrichPackageNodes([node('x')], new Map(), new Map());
    expect(result[0]).toMatchObject({ id: 'x', fanIn: 0, fanOut: 0 });
  });

  it('preserves existing node fields', () => {
    const n: PackageNode = { ...node('a'), fileCount: 7, stats: { structs: 1, interfaces: 2, functions: 3 } };
    const result = enrichPackageNodes([n], new Map(), new Map());
    expect(result[0].fileCount).toBe(7);
    expect(result[0].stats).toEqual({ structs: 1, interfaces: 2, functions: 3 });
  });
});

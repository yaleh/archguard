/**
 * Unit tests for PackageGraphBuilder.
 *
 * Covers branch-dense paths: node building with package-type classification
 * (tests/examples/testutil/cmd/vendor/internal), edge building with std
 * import skipping and duplicate count aggregation, and DFS cycle detection
 * (self-loop, multi-package cycle, no cycle).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PackageGraphBuilder } from '@/plugins/golang/atlas/builders/package-graph-builder.js';
import { GoModResolver } from '@/plugins/golang/atlas/go-mod-resolver.js';
import type { GoRawData, GoRawPackage, GoImport } from '@/plugins/golang/types.js';

function makePackage(overrides: Partial<GoRawPackage>): GoRawPackage {
  return {
    id: 'svc',
    name: 'svc',
    fullName: 'pkg/svc',
    dirPath: '/proj/pkg/svc',
    imports: [],
    structs: [],
    interfaces: [],
    functions: [],
    sourceFiles: ['a.go'],
    ...overrides,
  };
}

function makeRawData(overrides: Partial<GoRawData> = {}): GoRawData {
  return {
    moduleRoot: '/proj',
    moduleName: 'example.com/proj',
    packages: [],
    ...overrides,
  };
}

function makeResolver(classification: 'std' | 'internal' | 'external' | 'vendor'): GoModResolver {
  const resolver = new GoModResolver();
  vi.spyOn(resolver, 'classifyImport').mockReturnValue(classification);
  return resolver;
}

describe('PackageGraphBuilder.build', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('builds nodes with module-prefixed ids and stats', async () => {
    const builder = new PackageGraphBuilder(makeResolver('internal'));
    const raw = makeRawData({
      packages: [
        makePackage({
          fullName: 'pkg/svc',
          structs: [{ name: 'A', fields: [], methods: [], embeddedTypes: [], exported: true } as never],
          interfaces: [{ name: 'I', methods: [], embeddedInterfaces: [], exported: true } as never],
          functions: [{ name: 'f', packageName: 'svc', parameters: [], returnTypes: [], exported: false } as never],
        }),
      ],
    });
    const graph = await builder.build(raw);
    expect(graph.nodes[0]).toMatchObject({
      id: 'example.com/proj/pkg/svc',
      name: 'pkg/svc',
      stats: { structs: 1, interfaces: 1, functions: 1 },
    });
  });

  it('classifies package types by path segment', async () => {
    const builder = new PackageGraphBuilder(makeResolver('internal'));
    const raw = makeRawData({
      packages: [
        makePackage({ fullName: 'tests/foo', id: 't', name: 'foo' }),
        makePackage({ fullName: 'examples/bar', id: 'e', name: 'bar' }),
        makePackage({ fullName: 'testutil/x', id: 'u', name: 'x' }),
        makePackage({ fullName: 'cmd/app', id: 'm', name: 'main' }),
        makePackage({ fullName: 'pkg/vendor/dep', id: 'v', name: 'dep' }),
        makePackage({ fullName: 'pkg/normal', id: 'n', name: 'normal' }),
      ],
    });
    const graph = await builder.build(raw);
    const typeById = new Map(graph.nodes.map((n) => [n.id.split('/').at(-1), n.type]));
    expect(typeById.get('foo')).toBe('tests');
    expect(typeById.get('bar')).toBe('examples');
    expect(typeById.get('x')).toBe('testutil');
    expect(typeById.get('app')).toBe('cmd');
    expect(typeById.get('dep')).toBe('vendor');
    expect(typeById.get('normal')).toBe('internal');
  });

  it('builds edges skipping std imports and aggregating duplicate counts', async () => {
    const resolver = makeResolver('internal');
    vi.spyOn(resolver, 'classifyImport').mockImplementation((p) => (p === 'fmt' ? 'std' : 'internal'));
    const builder = new PackageGraphBuilder(resolver);
    const raw = makeRawData({
      packages: [
        makePackage({
          fullName: 'pkg/svc',
          imports: [
            { path: 'fmt', location: { file: 'a.go', startLine: 1 } },
            { path: 'example.com/proj/pkg/dep', location: { file: 'a.go', startLine: 2 } },
            { path: 'example.com/proj/pkg/dep', location: { file: 'b.go', startLine: 1 } },
          ] as GoImport[],
        }),
        makePackage({ fullName: 'pkg/dep', id: 'dep', name: 'dep' }),
      ],
    });
    const graph = await builder.build(raw);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toEqual({
      source: 'example.com/proj/pkg/svc',
      target: 'example.com/proj/pkg/dep',
      strength: 2, // aggregated across two imports
    });
  });

  it('drops edges to packages outside the node set', async () => {
    const builder = new PackageGraphBuilder(makeResolver('internal'));
    const raw = makeRawData({
      packages: [
        makePackage({
          fullName: 'pkg/svc',
          imports: [{ path: 'github.com/external/lib', location: { file: 'a.go', startLine: 1 } }],
        }),
      ],
    });
    const graph = await builder.build(raw);
    expect(graph.edges).toEqual([]);
  });

  it('detects a two-package cycle', async () => {
    const builder = new PackageGraphBuilder(makeResolver('internal'));
    const raw = makeRawData({
      packages: [
        makePackage({
          fullName: 'pkg/a',
          imports: [{ path: 'example.com/proj/pkg/b', location: { file: 'a.go', startLine: 1 } }],
        }),
        makePackage({
          id: 'b',
          name: 'b',
          fullName: 'pkg/b',
          imports: [{ path: 'example.com/proj/pkg/a', location: { file: 'b.go', startLine: 1 } }],
        }),
      ],
    });
    const graph = await builder.build(raw);
    expect(graph.cycles).toHaveLength(1);
    expect(graph.cycles[0].severity).toBe('warning');
    expect(graph.cycles[0].packages).toContain('example.com/proj/pkg/a');
    expect(graph.cycles[0].packages).toContain('example.com/proj/pkg/b');
  });

  it('detects a self-loop cycle', async () => {
    const builder = new PackageGraphBuilder(makeResolver('internal'));
    const raw = makeRawData({
      packages: [
        makePackage({
          fullName: 'pkg/a',
          imports: [{ path: 'example.com/proj/pkg/a', location: { file: 'a.go', startLine: 1 } }],
        }),
      ],
    });
    const graph = await builder.build(raw);
    expect(graph.cycles).toHaveLength(1);
    expect(graph.cycles[0].packages).toEqual(['example.com/proj/pkg/a']);
  });

  it('returns no cycles for an acyclic graph', async () => {
    const builder = new PackageGraphBuilder(makeResolver('internal'));
    const raw = makeRawData({
      packages: [
        makePackage({
          fullName: 'pkg/a',
          imports: [{ path: 'example.com/proj/pkg/b', location: { file: 'a.go', startLine: 1 } }],
        }),
        makePackage({ id: 'b', name: 'b', fullName: 'pkg/b', imports: [] }),
      ],
    });
    const graph = await builder.build(raw);
    expect(graph.cycles).toEqual([]);
  });
});

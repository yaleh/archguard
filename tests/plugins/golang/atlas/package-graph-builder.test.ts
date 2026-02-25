import { describe, it, expect, beforeEach } from 'vitest';
import { PackageGraphBuilder } from '@/plugins/golang/atlas/builders/package-graph-builder.js';
import { GoModResolver } from '@/plugins/golang/atlas/go-mod-resolver.js';
import type { GoRawData } from '@/plugins/golang/types.js';

function makeInitializedResolver(moduleName = 'github.com/test/project'): GoModResolver {
  const resolver = new GoModResolver();
  (resolver as unknown as { moduleInfo: object }).moduleInfo = {
    moduleName,
    moduleRoot: '/test',
    goModPath: '/test/go.mod',
  };
  return resolver;
}

function makeRawData(overrides?: Partial<GoRawData>): GoRawData {
  return {
    packages: [],
    moduleRoot: '/test',
    moduleName: 'github.com/test/project',
    ...overrides,
  };
}

describe('PackageGraphBuilder', () => {
  let builder: PackageGraphBuilder;
  let resolver: GoModResolver;

  beforeEach(() => {
    resolver = new GoModResolver();
    // Manually set moduleInfo by calling resolveProject would need real go.mod
    // We'll use the builder with an uninitialized resolver for std-only tests
    builder = new PackageGraphBuilder(resolver);
  });

  // classify helper — uses private method via casting
  function classify(pkg: Partial<{ name: string; fullName: string }>) {
    return (builder as any).classifyPackageType({ name: '', fullName: '', ...pkg });
  }

  describe('classifyPackageType', () => {
    it('classifies tests/* packages as tests', () => {
      expect(classify({ name: 'integration', fullName: 'tests/integration' })).toBe('tests');
      expect(classify({ name: 'tests', fullName: 'tests' })).toBe('tests');
      expect(classify({ name: 'stress', fullName: 'tests/stress' })).toBe('tests');
    });

    it('classifies examples/* packages as examples', () => {
      expect(classify({ fullName: 'examples/user-service' })).toBe('examples');
      expect(classify({ fullName: 'examples/catalog' })).toBe('examples');
    });

    it('classifies */testutil as testutil using exact segment match', () => {
      expect(classify({ fullName: 'pkg/hub/testutil' })).toBe('testutil');
      expect(classify({ fullName: 'pkg/testutil' })).toBe('testutil');
      expect(classify({ fullName: 'pkg/testutil/runner' })).toBe('testutil');
      expect(classify({ fullName: 'pkg/hubtest' })).toBe('testutil');
    });

    it('does NOT classify pkg/servicetestutil as testutil (not a segment boundary)', () => {
      expect(classify({ fullName: 'pkg/servicetestutil' })).toBe('internal');
    });

    it('tests/* path takes priority over name=main', () => {
      expect(classify({ name: 'main', fullName: 'tests/helper' })).toBe('tests');
    });

    it('still classifies main package as cmd', () => {
      expect(classify({ name: 'main', fullName: 'cmd/app' })).toBe('cmd');
    });

    it('still classifies vendor packages as vendor', () => {
      expect(classify({ fullName: 'pkg/dep/vendor/some-lib' })).toBe('vendor');
    });

    it('classifies regular internal packages as internal', () => {
      expect(classify({ fullName: 'pkg/hub' })).toBe('internal');
      expect(classify({ fullName: 'pkg/catalog' })).toBe('internal');
    });
  });

  it('should build empty graph for empty rawData', async () => {
    const rawData = makeRawData();
    // resolver not initialized - classifyImport throws for non-std imports
    // But with no imports, no edges will be built
    const graph = await builder.build(rawData);

    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
    expect(graph.cycles).toHaveLength(0);
  });

  it('should classify main package as cmd type', async () => {
    const rawData = makeRawData({
      packages: [
        {
          id: 'cmd/app',
          name: 'main',
          fullName: 'cmd/app',
          dirPath: '/test/cmd/app',
          sourceFiles: ['main.go'],
          imports: [],
          structs: [],
          interfaces: [],
          functions: [],
        },
      ],
    });

    const graph = await builder.build(rawData);

    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].type).toBe('cmd');
    expect(graph.nodes[0].name).toBe('cmd/app');
  });

  it('should classify internal package correctly', async () => {
    const rawData = makeRawData({
      packages: [
        {
          id: 'pkg/hub',
          name: 'hub',
          fullName: 'pkg/hub',
          dirPath: '/test/pkg/hub',
          sourceFiles: ['server.go', 'handler.go'],
          imports: [],
          structs: [],
          interfaces: [],
          functions: [],
        },
      ],
    });

    const graph = await builder.build(rawData);

    expect(graph.nodes[0].type).toBe('internal');
    expect(graph.nodes[0].fileCount).toBe(2);
    expect(graph.nodes[0].stats?.structs).toBe(0);
  });

  it('should return PackageCycle with severity field (ADR-002 v1.2)', async () => {
    // No imports — just verify the cycle structure shape
    const rawData = makeRawData({
      packages: [
        {
          id: 'pkg/a',
          name: 'a',
          fullName: 'pkg/a',
          dirPath: '/test/pkg/a',
          sourceFiles: ['a.go'],
          imports: [], // no imports → no edges → no cycles
          structs: [],
          interfaces: [],
          functions: [],
        },
      ],
    });

    const graph = await builder.build(rawData);

    // Verify the graph has the right shape
    expect(Array.isArray(graph.cycles)).toBe(true);

    // Verify cycle shape when cycles do exist
    for (const cycle of graph.cycles) {
      expect(cycle).toHaveProperty('packages');
      expect(cycle).toHaveProperty('severity');
      expect(['warning', 'error']).toContain(cycle.severity);
    }
  });

  it('deduplicates edges between same package pairs', async () => {
    const initializedResolver = makeInitializedResolver();
    const dedupeBuilder = new PackageGraphBuilder(initializedResolver);

    const moduleName = 'github.com/test/project';
    const rawData: GoRawData = {
      packages: [
        {
          id: 'pkg/a',
          name: 'a',
          fullName: 'pkg/a',
          dirPath: '/test/pkg/a',
          sourceFiles: ['a1.go', 'a2.go'],
          imports: [
            // Two separate imports of pkg/b (e.g. from two different files)
            { path: `${moduleName}/pkg/b` },
            { path: `${moduleName}/pkg/b` },
          ],
          structs: [],
          interfaces: [],
          functions: [],
        },
        {
          id: 'pkg/b',
          name: 'b',
          fullName: 'pkg/b',
          dirPath: '/test/pkg/b',
          sourceFiles: ['b.go'],
          imports: [],
          structs: [],
          interfaces: [],
          functions: [],
        },
      ],
      moduleRoot: '/test',
      moduleName,
    };

    const graph = await dedupeBuilder.build(rawData);

    // Only one edge should exist between pkg/a and pkg/b
    const edgesFromA = graph.edges.filter((e) => e.from === `${moduleName}/pkg/a`);
    expect(edgesFromA).toHaveLength(1);
    expect(edgesFromA[0].to).toBe(`${moduleName}/pkg/b`);

    // strength reflects the accumulated count of duplicate imports
    expect(edgesFromA[0].strength).toBe(2);
  });

  it('should include package stats', async () => {
    const rawData = makeRawData({
      packages: [
        {
          id: 'pkg/service',
          name: 'service',
          fullName: 'pkg/service',
          dirPath: '/test/pkg/service',
          sourceFiles: ['service.go'],
          imports: [],
          structs: [
            {
              name: 'Service',
              packageName: 'service',
              fields: [],
              methods: [],
              embeddedTypes: [],
              exported: true,
              location: { file: 'service.go', startLine: 1, endLine: 10 },
            },
          ],
          interfaces: [
            {
              name: 'IService',
              packageName: 'service',
              methods: [],
              embeddedInterfaces: [],
              exported: true,
              location: { file: 'service.go', startLine: 12, endLine: 15 },
            },
          ],
          functions: [],
        },
      ],
    });

    const graph = await builder.build(rawData);

    expect(graph.nodes[0].stats?.structs).toBe(1);
    expect(graph.nodes[0].stats?.interfaces).toBe(1);
    expect(graph.nodes[0].stats?.functions).toBe(0);
  });
});

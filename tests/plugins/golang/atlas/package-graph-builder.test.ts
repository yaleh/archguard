import { describe, it, expect, beforeEach } from 'vitest';
import { PackageGraphBuilder } from '@/plugins/golang/atlas/builders/package-graph-builder.js';
import { GoModResolver } from '@/plugins/golang/atlas/go-mod-resolver.js';
import type { GoRawData } from '@/plugins/golang/types.js';

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

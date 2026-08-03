/**
 * Unit tests for CapabilityGraphBuilder.
 *
 * Covers branch-dense paths in build(): node construction (interface/struct),
 * impl/uses edge resolution (qualified, unqualified, import-map fallbacks),
 * edge dedup, interface-centric node filtering, full-mode hotspot and
 * complex-package passes, fanIn/fanOut computation, and concrete-usage risks.
 */

import { describe, it, expect } from 'vitest';
import { CapabilityGraphBuilder } from '@/plugins/golang/atlas/builders/capability-graph-builder.js';
import type { GoRawData, GoRawPackage } from '@/plugins/golang/types.js';

function makePackage(overrides: Partial<GoRawPackage>): GoRawPackage {
  return {
    id: 'svc',
    name: 'svc', // Go package short name = last path segment
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

describe('CapabilityGraphBuilder.build', () => {
  it('returns empty graph for empty raw data', async () => {
    const builder = new CapabilityGraphBuilder();
    const graph = await builder.build(makeRawData());
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graph.concreteUsageRisks).toBeUndefined();
  });

  it('builds interface and struct nodes with counts when referenced', async () => {
    const builder = new CapabilityGraphBuilder();
    const raw = makeRawData({
      packages: [
        makePackage({
          interfaces: [
            {
              name: 'API',
              packageName: 'svc',
              methods: [{ name: 'Get' }],
              embeddedInterfaces: [],
              exported: true,
            } as never,
          ],
          structs: [
            {
              name: 'Impl',
              packageName: 'svc',
              fields: [
                { name: 'pub', type: 'string', exported: true } as never,
                { name: 'hidden', type: 'string', exported: false } as never,
              ],
              methods: [{ name: 'Get' } as never, { name: 'Put' } as never],
              embeddedTypes: [],
              exported: true,
            } as never,
          ],
        }),
      ],
      implementations: [
        {
          structName: 'Impl',
          structPackageId: 'svc',
          interfaceName: 'API',
          interfacePackageId: 'svc',
          confidence: 1,
          matchedMethods: ['Get'],
          source: 'inferred',
        },
      ],
    });

    const graph = await builder.build(raw);
    const iface = graph.nodes.find((n) => n.id === 'pkg/svc.API');
    const impl = graph.nodes.find((n) => n.id === 'pkg/svc.Impl');

    expect(iface).toMatchObject({
      type: 'interface',
      package: 'pkg/svc',
      exported: true,
      methodCount: 1,
    });
    expect(impl).toMatchObject({
      type: 'struct',
      methodCount: 2,
      fieldCount: 1, // only exported fields counted
    });
  });

  it('adds implements edges from precomputed implementations', async () => {
    const builder = new CapabilityGraphBuilder();
    const raw = makeRawData({
      packages: [
        makePackage({
          interfaces: [
            { name: 'API', methods: [], embeddedInterfaces: [], exported: true } as never,
          ],
          structs: [
            { name: 'Impl', fields: [], methods: [], embeddedTypes: [], exported: true } as never,
          ],
        }),
      ],
      implementations: [
        {
          structName: 'Impl',
          structPackageId: 'svc',
          interfaceName: 'API',
          interfacePackageId: 'svc',
          confidence: 1,
          matchedMethods: ['Get'],
          source: 'inferred',
        },
      ],
    });

    const graph = await builder.build(raw);
    const implEdge = graph.edges.find((e) => e.type === 'implements');
    expect(implEdge).toEqual(
      expect.objectContaining({
        source: 'pkg/svc.Impl',
        target: 'pkg/svc.API',
        confidence: 1,
      })
    );
  });

  it('resolves impl edges via last path segment when packageId is a full path', async () => {
    const builder = new CapabilityGraphBuilder();
    const raw = makeRawData({
      packages: [
        makePackage({
          name: 'store',
          fullName: 'pkg/hub/store',
          interfaces: [
            { name: 'SQLiteStore', methods: [], embeddedInterfaces: [], exported: true } as never,
          ],
          structs: [
            {
              name: 'StoreImpl',
              fields: [],
              methods: [],
              embeddedTypes: [],
              exported: true,
            } as never,
          ],
        }),
      ],
      implementations: [
        {
          structName: 'StoreImpl',
          structPackageId: 'pkg/hub/store',
          interfaceName: 'SQLiteStore',
          interfacePackageId: 'pkg/hub/store',
          confidence: 0.9,
          matchedMethods: [],
          source: 'explicit',
        },
      ],
    });

    const graph = await builder.build(raw);
    expect(graph.edges.some((e) => e.type === 'implements')).toBe(true);
    expect(graph.edges[0].source).toBe('pkg/hub/store.StoreImpl');
  });

  it('drops unreferenced struct nodes (interface-centric filter)', async () => {
    const builder = new CapabilityGraphBuilder();
    const raw = makeRawData({
      packages: [
        makePackage({
          interfaces: [
            { name: 'API', methods: [], embeddedInterfaces: [], exported: true } as never,
          ],
          structs: [
            { name: 'Impl', fields: [], methods: [], embeddedTypes: [], exported: true } as never,
            { name: 'Orphan', fields: [], methods: [], embeddedTypes: [], exported: true } as never,
          ],
        }),
      ],
      implementations: [
        {
          structName: 'Impl',
          structPackageId: 'svc',
          interfaceName: 'API',
          interfacePackageId: 'svc',
          confidence: 1,
          matchedMethods: [],
          source: 'inferred',
        },
      ],
    });

    const graph = await builder.build(raw);
    const ids = graph.nodes.map((n) => n.id);
    expect(ids).toContain('pkg/svc.API');
    expect(ids).toContain('pkg/svc.Impl');
    expect(ids).not.toContain('pkg/svc.Orphan');
  });

  describe('uses edge resolution', () => {
    it('creates a uses edge for unqualified same-package field type', async () => {
      const builder = new CapabilityGraphBuilder();
      const raw = makeRawData({
        packages: [
          makePackage({
            structs: [
              {
                name: 'Holder',
                fields: [
                  {
                    name: 'dep',
                    type: 'Dependency',
                    exported: true,
                    location: { file: 'a.go', startLine: 5 },
                  } as never,
                ],
                methods: [],
                embeddedTypes: [],
                exported: true,
              } as never,
              {
                name: 'Dependency',
                fields: [],
                methods: [],
                embeddedTypes: [],
                exported: true,
              } as never,
            ],
          }),
        ],
      });

      const graph = await builder.build(raw);
      const uses = graph.edges.find((e) => e.type === 'uses');
      expect(uses).toMatchObject({
        source: 'pkg/svc.Holder',
        target: 'pkg/svc.Dependency',
        confidence: 0.9,
        concreteUsage: true,
      });
    });

    it('resolves qualified type via import map (module-relative path)', async () => {
      const builder = new CapabilityGraphBuilder();
      const raw = makeRawData({
        packages: [
          makePackage({
            imports: [
              {
                path: 'example.com/proj/pkg/hub/engine',
                location: { file: 'a.go', startLine: 1 },
              } as never,
            ],
            structs: [
              {
                name: 'Holder',
                fields: [
                  {
                    name: 'e',
                    type: 'engine.Engine',
                    exported: true,
                    location: { file: 'a.go', startLine: 5 },
                  } as never,
                ],
                methods: [],
                embeddedTypes: [],
                exported: true,
              } as never,
            ],
          }),
          makePackage({
            name: 'engine',
            fullName: 'pkg/hub/engine',
            structs: [
              {
                name: 'Engine',
                fields: [],
                methods: [],
                embeddedTypes: [],
                exported: true,
              } as never,
            ],
          }),
        ],
      });

      const graph = await builder.build(raw);
      const uses = graph.edges.find((e) => e.type === 'uses');
      expect(uses?.target).toBe('pkg/hub/engine.Engine');
    });

    it('skips qualified types not present in imports (external/stdlib)', async () => {
      const builder = new CapabilityGraphBuilder();
      const raw = makeRawData({
        packages: [
          makePackage({
            imports: [
              {
                path: 'example.com/proj/pkg/hub/engine',
                location: { file: 'a.go', startLine: 1 },
              } as never,
            ],
            structs: [
              {
                name: 'Holder',
                fields: [
                  {
                    name: 'e',
                    type: 'external.Thing',
                    exported: true,
                    location: { file: 'a.go', startLine: 5 },
                  } as never,
                ],
                methods: [],
                embeddedTypes: [],
                exported: true,
              } as never,
            ],
          }),
          makePackage({
            name: 'engine',
            fullName: 'pkg/hub/engine',
            structs: [
              {
                name: 'Engine',
                fields: [],
                methods: [],
                embeddedTypes: [],
                exported: true,
              } as never,
            ],
          }),
        ],
      });

      const graph = await builder.build(raw);
      expect(graph.edges.filter((e) => e.type === 'uses')).toHaveLength(0);
    });

    it('falls back to qualifier:bareType lookup when no import data', async () => {
      const builder = new CapabilityGraphBuilder();
      const raw = makeRawData({
        packages: [
          makePackage({
            imports: [], // no import data → best-effort fallback
            structs: [
              {
                name: 'Holder',
                fields: [
                  {
                    name: 'e',
                    type: 'engine.Engine',
                    exported: true,
                    location: { file: 'a.go', startLine: 5 },
                  } as never,
                ],
                methods: [],
                embeddedTypes: [],
                exported: true,
              } as never,
            ],
          }),
          makePackage({
            name: 'engine',
            fullName: 'pkg/hub/engine',
            structs: [
              {
                name: 'Engine',
                fields: [],
                methods: [],
                embeddedTypes: [],
                exported: true,
              } as never,
            ],
          }),
        ],
      });

      const graph = await builder.build(raw);
      const uses = graph.edges.find((e) => e.type === 'uses');
      expect(uses?.target).toBe('pkg/hub/engine.Engine');
    });

    it('normalizes pointer/slice/map/qualified field types for lookup', async () => {
      const builder = new CapabilityGraphBuilder();
      const raw = makeRawData({
        packages: [
          makePackage({
            imports: [],
            structs: [
              {
                name: 'Holder',
                fields: [
                  {
                    name: 'a',
                    type: '*DepA',
                    exported: true,
                    location: { file: 'a.go', startLine: 5 },
                  } as never,
                  {
                    name: 'b',
                    type: '[]DepB',
                    exported: true,
                    location: { file: 'a.go', startLine: 6 },
                  } as never,
                  {
                    name: 'c',
                    type: 'map[string]DepC',
                    exported: true,
                    location: { file: 'a.go', startLine: 7 },
                  } as never,
                  {
                    name: 'd',
                    type: 'svc.DepD',
                    exported: true,
                    location: { file: 'a.go', startLine: 8 },
                  } as never,
                ],
                methods: [],
                embeddedTypes: [],
                exported: true,
              } as never,
              { name: 'DepA', fields: [], methods: [], embeddedTypes: [], exported: true } as never,
              { name: 'DepB', fields: [], methods: [], embeddedTypes: [], exported: true } as never,
              { name: 'DepC', fields: [], methods: [], embeddedTypes: [], exported: true } as never,
              { name: 'DepD', fields: [], methods: [], embeddedTypes: [], exported: true } as never,
            ],
          }),
        ],
      });

      const graph = await builder.build(raw);
      const targets = graph.edges
        .filter((e) => e.type === 'uses')
        .map((e) => e.target)
        .sort();
      expect(targets).toEqual(
        ['pkg/svc.DepA', 'pkg/svc.DepB', 'pkg/svc.DepC', 'pkg/svc.DepD'].sort()
      );
    });

    it('deduplicates edges with identical (source, target, type)', async () => {
      const builder = new CapabilityGraphBuilder();
      const raw = makeRawData({
        packages: [
          makePackage({
            structs: [
              {
                name: 'Holder',
                fields: [
                  {
                    name: 'a',
                    type: 'Dep',
                    exported: true,
                    location: { file: 'a.go', startLine: 5 },
                  } as never,
                  {
                    name: 'b',
                    type: 'Dep',
                    exported: true,
                    location: { file: 'a.go', startLine: 6 },
                  } as never,
                ],
                methods: [],
                embeddedTypes: [],
                exported: true,
              } as never,
              { name: 'Dep', fields: [], methods: [], embeddedTypes: [], exported: true } as never,
            ],
          }),
        ],
      });

      const graph = await builder.build(raw);
      const uses = graph.edges.filter((e) => e.type === 'uses');
      expect(uses).toHaveLength(1);
    });
  });

  describe('full-mode hotspot passes', () => {
    it('adds unreferenced structs with methodCount >= 11 as hotspots', async () => {
      const builder = new CapabilityGraphBuilder();
      const methods = Array.from({ length: 11 }, (_, i) => ({
        name: `M${i}`,
        parameters: [],
        returnTypes: [],
        exported: true,
      }));
      const raw = makeRawData({
        packages: [
          makePackage({
            interfaces: [
              { name: 'API', methods: [], embeddedInterfaces: [], exported: true } as never,
            ],
            structs: [
              { name: 'Big', fields: [], methods, embeddedTypes: [], exported: true } as never,
              {
                name: 'Small',
                fields: [],
                methods: [],
                embeddedTypes: [],
                exported: true,
              } as never,
            ],
          }),
        ],
      });

      const graph = await builder.build(raw, { mode: 'full' });
      const big = graph.nodes.find((n) => n.id === 'pkg/svc.Big');
      const small = graph.nodes.find((n) => n.id === 'pkg/svc.Small');
      expect(big?.isHotspotAdded).toBe(true);
      expect(small?.isHotspotAdded).toBeUndefined();
    });

    it('keeps already-referenced high-fanIn structs (no re-flag needed)', async () => {
      const builder = new CapabilityGraphBuilder();
      const structs: any[] = [
        { name: 'Target', fields: [], methods: [], embeddedTypes: [], exported: true },
      ];
      for (let i = 0; i < 6; i++) {
        structs.push({
          name: `Src${i}`,
          fields: [
            { name: 't', type: 'Target', exported: true, location: { file: 'a.go', startLine: i } },
          ],
          methods: [],
          embeddedTypes: [],
          exported: true,
        });
      }
      const raw = makeRawData({
        packages: [
          makePackage({
            interfaces: [
              { name: 'API', methods: [], embeddedInterfaces: [], exported: true } as never,
            ],
            structs,
          }),
        ],
      });

      const graph = await builder.build(raw, { mode: 'full' });
      const target = graph.nodes.find((n) => n.id === 'pkg/svc.Target');
      // Already referenced → retained by interface-centric filter, fanIn counted
      expect(target?.fanIn).toBe(6);
      expect(target?.isHotspotAdded).toBeUndefined();
      expect(graph.nodes.some((n) => n.id === 'pkg/svc.Src0')).toBe(true);
    });

    it('adds complex packages via package-hotspot pass when below hotspot thresholds', async () => {
      const builder = new CapabilityGraphBuilder();
      const structs = Array.from({ length: 8 }, (_, i) => ({
        name: `S${i}`,
        fields: [],
        methods: [],
        embeddedTypes: [],
        exported: true,
      }));
      const raw = makeRawData({
        packages: [
          // Interface lives in a different package so pkg/hub/complex has NO included nodes
          makePackage({
            fullName: 'pkg/api',
            interfaces: [
              { name: 'API', methods: [], embeddedInterfaces: [], exported: true } as never,
            ],
            structs: [],
          }),
          makePackage({
            name: 'complex',
            fullName: 'pkg/hub/complex',
            interfaces: [],
            structs,
          }),
        ],
      });

      const graph = await builder.build(raw, { mode: 'full', minPackageStructs: 8 });
      const added = graph.nodes.filter((n) => n.isPackageHotspot);
      expect(added.length).toBeGreaterThanOrEqual(8);
      const orphan = graph.nodes.find((n) => n.id === 'pkg/hub/complex.S0');
      expect(orphan?.isPackageHotspot).toBe(true);
    });

    it('does not run hotspot passes in interface mode', async () => {
      const builder = new CapabilityGraphBuilder();
      const methods = Array.from({ length: 12 }, (_, i) => ({
        name: `M${i}`,
        parameters: [],
        returnTypes: [],
        exported: true,
      }));
      const raw = makeRawData({
        packages: [
          makePackage({
            interfaces: [
              { name: 'API', methods: [], embeddedInterfaces: [], exported: true } as never,
            ],
            structs: [
              { name: 'Big', fields: [], methods, embeddedTypes: [], exported: true } as never,
            ],
          }),
        ],
      });

      const graph = await builder.build(raw); // default interface mode
      expect(graph.nodes.filter((n) => n.isHotspotAdded).length).toBe(0);
    });
  });

  describe('concrete usage risks', () => {
    it('collects cross-package concrete field dependencies', async () => {
      const builder = new CapabilityGraphBuilder();
      const raw = makeRawData({
        packages: [
          makePackage({
            imports: [
              {
                path: 'example.com/proj/pkg/hub/engine',
                location: { file: 'a.go', startLine: 1 },
              } as never,
            ],
            structs: [
              {
                name: 'Holder',
                fields: [
                  {
                    name: 'e',
                    type: '*engine.Engine',
                    exported: true,
                    location: { file: 'a.go', startLine: 5 },
                  } as never,
                ],
                methods: [],
                embeddedTypes: [],
                exported: true,
              } as never,
            ],
          }),
          makePackage({
            name: 'engine',
            fullName: 'pkg/hub/engine',
            imports: [],
            structs: [
              {
                name: 'Engine',
                fields: [],
                methods: [],
                embeddedTypes: [],
                exported: true,
              } as never,
            ],
          }),
        ],
      });

      const graph = await builder.build(raw);
      expect(graph.concreteUsageRisks).toEqual([
        {
          owner: 'pkg/svc.Holder',
          fieldType: '*engine.Engine',
          concreteType: 'pkg/hub/engine.Engine',
          location: 'a.go:5',
        },
      ]);
    });

    it('does not report same-package concrete usage as risk', async () => {
      const builder = new CapabilityGraphBuilder();
      const raw = makeRawData({
        packages: [
          makePackage({
            structs: [
              {
                name: 'Holder',
                fields: [
                  {
                    name: 'd',
                    type: 'Dep',
                    exported: true,
                    location: { file: 'a.go', startLine: 5 },
                  } as never,
                ],
                methods: [],
                embeddedTypes: [],
                exported: true,
              } as never,
              { name: 'Dep', fields: [], methods: [], embeddedTypes: [], exported: true } as never,
            ],
          }),
        ],
      });

      const graph = await builder.build(raw);
      expect(graph.concreteUsageRisks).toBeUndefined();
    });
  });
});

import { describe, it, expect } from 'vitest';
import { CapabilityGraphBuilder } from '@/plugins/golang/atlas/builders/capability-graph-builder.js';
import { BehaviorAnalyzer } from '@/plugins/golang/atlas/behavior-analyzer.js';
import type { GoRawData, GoRawPackage, InferredImplementation } from '@/plugins/golang/types.js';

function makeRawData(overrides?: Partial<GoRawData>): GoRawData {
  return {
    packages: [],
    moduleRoot: '/test',
    moduleName: 'github.com/test/project',
    ...overrides,
  };
}

function makePackage(overrides?: Partial<GoRawPackage>): GoRawPackage {
  return {
    id: 'pkg/api',
    name: 'api',
    fullName: 'pkg/api',
    dirPath: '/test/pkg/api',
    sourceFiles: ['api.go'],
    imports: [],
    structs: [],
    interfaces: [],
    functions: [],
    ...overrides,
  };
}

describe('CapabilityGraphBuilder', () => {
  const builder = new CapabilityGraphBuilder();

  // Test 1: Empty rawData
  it('should return empty graph for empty rawData', async () => {
    const rawData = makeRawData();
    const graph = await builder.build(rawData);

    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });

  // Test 2: Interface node
  it('should build interface node with correct fields', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          id: 'pkg/api',
          name: 'api',
          fullName: 'pkg/api',
          interfaces: [
            {
              name: 'Handler',
              packageName: 'api',
              methods: [],
              embeddedInterfaces: [],
              exported: true,
              location: { file: 'api.go', startLine: 1, endLine: 5 },
            },
          ],
        }),
      ],
    });

    const graph = await builder.build(rawData);

    expect(graph.nodes).toHaveLength(1);
    const node = graph.nodes[0];
    expect(node.id).toBe('pkg/api.Handler');
    expect(node.name).toBe('Handler');
    expect(node.type).toBe('interface');
    expect(node.package).toBe('pkg/api');
    expect(node.exported).toBe(true);
  });

  // Test 3: Struct node — struct connected via implements edge is retained and has correct fields
  it('should build struct node with correct fields', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          id: 'pkg/api',
          name: 'api',
          fullName: 'pkg/api',
          structs: [
            {
              name: 'Server',
              packageName: 'api',
              fields: [],
              methods: [],
              embeddedTypes: [],
              exported: true,
              location: { file: 'api.go', startLine: 10, endLine: 15 },
            },
          ],
          interfaces: [
            {
              name: 'Handler',
              packageName: 'api',
              methods: [],
              embeddedInterfaces: [],
              exported: true,
              location: { file: 'api.go', startLine: 1, endLine: 5 },
            },
          ],
        }),
      ],
      implementations: [
        {
          structName: 'Server',
          structPackageId: 'api',
          interfaceName: 'Handler',
          interfacePackageId: 'api',
          confidence: 1.0,
          matchedMethods: [],
        },
      ],
    });

    const graph = await builder.build(rawData);

    const node = graph.nodes.find((n) => n.name === 'Server');
    expect(node).toBeDefined();
    expect(node?.id).toBe('pkg/api.Server');
    expect(node?.name).toBe('Server');
    expect(node?.type).toBe('struct');
    expect(node?.package).toBe('pkg/api');
    expect(node?.exported).toBe(true);
  });

  // Test 4: Unexported struct — connected via implements edge so it passes interface-centric filter
  it('should build unexported struct node with exported=false', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          structs: [
            {
              name: 'internalServer',
              packageName: 'api',
              fields: [],
              methods: [],
              embeddedTypes: [],
              exported: false,
              location: { file: 'api.go', startLine: 1, endLine: 5 },
            },
          ],
          interfaces: [
            {
              name: 'Handler',
              packageName: 'api',
              methods: [],
              embeddedInterfaces: [],
              exported: true,
              location: { file: 'api.go', startLine: 7, endLine: 10 },
            },
          ],
        }),
      ],
      implementations: [
        {
          structName: 'internalServer',
          structPackageId: 'api',
          interfaceName: 'Handler',
          interfacePackageId: 'api',
          confidence: 1.0,
          matchedMethods: [],
        },
      ],
    });

    const graph = await builder.build(rawData);

    const structNode = graph.nodes.find((n) => n.name === 'internalServer');
    expect(structNode).toBeDefined();
    expect(structNode?.exported).toBe(false);
  });

  // Test 5: Implements edge from rawData.implementations
  it('should build implements edge from rawData.implementations with correct fields', async () => {
    const impl: InferredImplementation = {
      structName: 'Server',
      structPackageId: 'pkg/api',
      interfaceName: 'Handler',
      interfacePackageId: 'pkg/api',
      confidence: 0.95,
      matchedMethods: ['ServeHTTP'],
    };

    const rawData = makeRawData({
      packages: [
        makePackage({
          structs: [
            {
              name: 'Server',
              packageName: 'api',
              fields: [],
              methods: [],
              embeddedTypes: [],
              exported: true,
              location: { file: 'api.go', startLine: 1, endLine: 5 },
            },
          ],
          interfaces: [
            {
              name: 'Handler',
              packageName: 'api',
              methods: [],
              embeddedInterfaces: [],
              exported: true,
              location: { file: 'api.go', startLine: 7, endLine: 10 },
            },
          ],
        }),
      ],
      implementations: [impl],
    });

    const graph = await builder.build(rawData);

    const implEdge = graph.edges.find((e) => e.type === 'implements');
    expect(implEdge).toBeDefined();
    expect(implEdge?.id).toBe('impl-pkg/api.Server-pkg/api.Handler');
    expect(implEdge?.type).toBe('implements');
    expect(implEdge?.source).toBe('pkg/api.Server');
    expect(implEdge?.target).toBe('pkg/api.Handler');
    expect(implEdge?.confidence).toBe(0.95);
  });

  // Test 6: Uses edge when struct field type matches an interface name
  it('should build uses edge when struct field type matches an interface name', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          fullName: 'pkg/api',
          structs: [
            {
              name: 'Server',
              packageName: 'api',
              fields: [
                {
                  name: 'handler',
                  type: 'Handler',
                  exported: false,
                  embedded: false,
                  location: { file: 'server.go', startLine: 5, endLine: 5 },
                },
              ],
              methods: [],
              embeddedTypes: [],
              exported: true,
              location: { file: 'server.go', startLine: 1, endLine: 10 },
            },
          ],
          interfaces: [
            {
              name: 'Handler',
              packageName: 'api',
              methods: [],
              embeddedInterfaces: [],
              exported: true,
              location: { file: 'handler.go', startLine: 1, endLine: 5 },
            },
          ],
        }),
      ],
    });

    const graph = await builder.build(rawData);

    const usesEdge = graph.edges.find((e) => e.type === 'uses');
    expect(usesEdge).toBeDefined();
    expect(usesEdge?.type).toBe('uses');
    expect(usesEdge?.source).toBe('pkg/api.Server');
    expect(usesEdge?.target).toBe('pkg/api.Handler');
    expect(usesEdge?.confidence).toBe(0.9);
    expect(usesEdge?.context?.fieldType).toBe(true);
    expect(usesEdge?.context?.usageLocations).toContain('server.go:5');
  });

  // Test 7: No uses edge when struct field type does NOT match any interface name
  it('should not build uses edge when struct field type does not match any interface name', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          structs: [
            {
              name: 'Server',
              packageName: 'api',
              fields: [
                {
                  name: 'timeout',
                  type: 'time.Duration',
                  exported: false,
                  embedded: false,
                  location: { file: 'server.go', startLine: 5, endLine: 5 },
                },
              ],
              methods: [],
              embeddedTypes: [],
              exported: true,
              location: { file: 'server.go', startLine: 1, endLine: 10 },
            },
          ],
          interfaces: [
            {
              name: 'Handler',
              packageName: 'api',
              methods: [],
              embeddedInterfaces: [],
              exported: true,
              location: { file: 'handler.go', startLine: 1, endLine: 5 },
            },
          ],
        }),
      ],
    });

    const graph = await builder.build(rawData);

    const usesEdges = graph.edges.filter((e) => e.type === 'uses');
    expect(usesEdges).toHaveLength(0);
  });

  // Test 8: Multiple packages — nodes from both included (structs retained via implements edges)
  it('should include nodes from all packages', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          id: 'pkg/api',
          name: 'api',
          fullName: 'pkg/api',
          interfaces: [
            {
              name: 'Handler',
              packageName: 'api',
              methods: [],
              embeddedInterfaces: [],
              exported: true,
              location: { file: 'api.go', startLine: 1, endLine: 5 },
            },
          ],
          structs: [],
        }),
        makePackage({
          id: 'pkg/server',
          name: 'server',
          fullName: 'pkg/server',
          interfaces: [],
          structs: [
            {
              name: 'HTTPServer',
              packageName: 'server',
              fields: [],
              methods: [],
              embeddedTypes: [],
              exported: true,
              location: { file: 'server.go', startLine: 1, endLine: 10 },
            },
            {
              name: 'GRPCServer',
              packageName: 'server',
              fields: [],
              methods: [],
              embeddedTypes: [],
              exported: true,
              location: { file: 'grpc.go', startLine: 1, endLine: 10 },
            },
          ],
        }),
      ],
      implementations: [
        {
          structName: 'HTTPServer',
          structPackageId: 'server',
          interfaceName: 'Handler',
          interfacePackageId: 'api',
          confidence: 1.0,
          matchedMethods: [],
        },
        {
          structName: 'GRPCServer',
          structPackageId: 'server',
          interfaceName: 'Handler',
          interfacePackageId: 'api',
          confidence: 1.0,
          matchedMethods: [],
        },
      ],
    });

    const graph = await builder.build(rawData);

    expect(graph.nodes).toHaveLength(3);

    const pkgApiNode = graph.nodes.find((n) => n.id === 'pkg/api.Handler');
    expect(pkgApiNode).toBeDefined();
    expect(pkgApiNode?.package).toBe('pkg/api');

    const httpServerNode = graph.nodes.find((n) => n.id === 'pkg/server.HTTPServer');
    expect(httpServerNode).toBeDefined();
    expect(httpServerNode?.package).toBe('pkg/server');

    const grpcServerNode = graph.nodes.find((n) => n.id === 'pkg/server.GRPCServer');
    expect(grpcServerNode).toBeDefined();
  });

  // Test 9: No implementations in rawData (undefined) — no implements edges, no crash
  it('should produce no implements edges and not crash when implementations is undefined', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          structs: [
            {
              name: 'Server',
              packageName: 'api',
              fields: [],
              methods: [],
              embeddedTypes: [],
              exported: true,
              location: { file: 'api.go', startLine: 1, endLine: 5 },
            },
          ],
          interfaces: [
            {
              name: 'Handler',
              packageName: 'api',
              methods: [],
              embeddedInterfaces: [],
              exported: true,
              location: { file: 'api.go', startLine: 7, endLine: 10 },
            },
          ],
        }),
      ],
      // implementations intentionally omitted (undefined)
    });

    expect(rawData.implementations).toBeUndefined();

    const graph = await builder.build(rawData);

    const implEdges = graph.edges.filter((e) => e.type === 'implements');
    expect(implEdges).toHaveLength(0);
  });

  // Test 10: ID format verification — id is `${pkg.fullName}.${typeName}` exactly
  // struct is retained via implements edge so both nodes appear in the filtered graph
  it('should format node id as pkg.fullName.TypeName exactly', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          name: 'service',
          fullName: 'github.com/myorg/myproject/internal/service',
          interfaces: [
            {
              name: 'UserService',
              packageName: 'service',
              methods: [],
              embeddedInterfaces: [],
              exported: true,
              location: { file: 'service.go', startLine: 1, endLine: 5 },
            },
          ],
          structs: [
            {
              name: 'userServiceImpl',
              packageName: 'service',
              fields: [],
              methods: [],
              embeddedTypes: [],
              exported: false,
              location: { file: 'service.go', startLine: 7, endLine: 15 },
            },
          ],
        }),
      ],
      implementations: [
        {
          structName: 'userServiceImpl',
          structPackageId: 'service',
          interfaceName: 'UserService',
          interfacePackageId: 'service',
          confidence: 1.0,
          matchedMethods: [],
        },
      ],
    });

    const graph = await builder.build(rawData);

    expect(graph.nodes).toHaveLength(2);

    const interfaceNode = graph.nodes.find((n) => n.type === 'interface');
    expect(interfaceNode?.id).toBe('github.com/myorg/myproject/internal/service.UserService');

    const structNode = graph.nodes.find((n) => n.type === 'struct');
    expect(structNode?.id).toBe('github.com/myorg/myproject/internal/service.userServiceImpl');
  });

  // Additional: implements edge id format verification
  it('should format implements edge id as impl-structPkg.structName-ifacePkg.ifaceName', async () => {
    const impl: InferredImplementation = {
      structName: 'ConcreteWorker',
      structPackageId: 'pkg/worker',
      interfaceName: 'Worker',
      interfacePackageId: 'pkg/contracts',
      confidence: 0.8,
      matchedMethods: ['Work', 'Stop'],
    };

    const rawData = makeRawData({ implementations: [impl] });
    const graph = await builder.build(rawData);

    expect(graph.edges).toHaveLength(1);
    const edge = graph.edges[0];
    expect(edge.id).toBe('impl-pkg/worker.ConcreteWorker-pkg/contracts.Worker');
    expect(edge.source).toBe('pkg/worker.ConcreteWorker');
    expect(edge.target).toBe('pkg/contracts.Worker');
    expect(edge.confidence).toBe(0.8);
  });

  // Additional: uses edge id format verification
  it('should format uses edge id as uses-pkg.structName-fieldType', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          fullName: 'pkg/app',
          structs: [
            {
              name: 'App',
              packageName: 'app',
              fields: [
                {
                  name: 'repo',
                  type: 'Repository',
                  exported: false,
                  embedded: false,
                  location: { file: 'app.go', startLine: 3, endLine: 3 },
                },
              ],
              methods: [],
              embeddedTypes: [],
              exported: true,
              location: { file: 'app.go', startLine: 1, endLine: 10 },
            },
          ],
          interfaces: [
            {
              name: 'Repository',
              packageName: 'app',
              methods: [],
              embeddedInterfaces: [],
              exported: true,
              location: { file: 'repo.go', startLine: 1, endLine: 5 },
            },
          ],
        }),
      ],
    });

    const graph = await builder.build(rawData);

    const usesEdge = graph.edges.find((e) => e.type === 'uses');
    expect(usesEdge?.id).toBe('uses-pkg/app.App-Repository');
  });

  // Bug 1 fix: resolve impl edge source/target using Go package name → full node ID
  it('should resolve impl edge source/target when structPackageId is a Go package name', async () => {
    const impl: InferredImplementation = {
      structName: 'SQLiteStore',
      structPackageId: 'store', // Go package name, not full path
      interfaceName: 'Store',
      interfacePackageId: 'hub', // Go package name, not full path
      confidence: 0.95,
      matchedMethods: ['Get', 'Set'],
      source: 'inferred',
    };

    const rawData = makeRawData({
      packages: [
        makePackage({
          id: 'pkg/hub/store',
          name: 'store',
          fullName: 'pkg/hub/store',
          structs: [
            {
              name: 'SQLiteStore',
              packageName: 'store',
              fields: [],
              methods: [],
              embeddedTypes: [],
              exported: true,
              location: { file: 'store.go', startLine: 1, endLine: 10 },
            },
          ],
          interfaces: [],
        }),
        makePackage({
          id: 'pkg/hub',
          name: 'hub',
          fullName: 'pkg/hub',
          structs: [],
          interfaces: [
            {
              name: 'Store',
              packageName: 'hub',
              methods: [],
              embeddedInterfaces: [],
              exported: true,
              location: { file: 'hub.go', startLine: 1, endLine: 5 },
            },
          ],
        }),
      ],
      implementations: [impl],
    });

    const graph = await builder.build(rawData);

    const implEdge = graph.edges.find((e) => e.type === 'implements');
    expect(implEdge).toBeDefined();
    expect(implEdge?.source).toBe('pkg/hub/store.SQLiteStore');
    expect(implEdge?.target).toBe('pkg/hub.Store');
    expect(implEdge?.id).toBe('impl-pkg/hub/store.SQLiteStore-pkg/hub.Store');
  });

  // Bug 2 fix: uses edge target resolves to full node ID (not bare type name)
  it('should resolve uses edge target to full node ID', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          fullName: 'pkg/api',
          structs: [
            {
              name: 'Server',
              packageName: 'api',
              fields: [
                {
                  name: 'handler',
                  type: 'Handler',
                  exported: false,
                  embedded: false,
                  location: { file: 'server.go', startLine: 5, endLine: 5 },
                },
              ],
              methods: [],
              embeddedTypes: [],
              exported: true,
              location: { file: 'server.go', startLine: 1, endLine: 10 },
            },
          ],
          interfaces: [
            {
              name: 'Handler',
              packageName: 'api',
              methods: [],
              embeddedInterfaces: [],
              exported: true,
              location: { file: 'handler.go', startLine: 1, endLine: 5 },
            },
          ],
        }),
      ],
    });

    const graph = await builder.build(rawData);

    const usesEdge = graph.edges.find((e) => e.type === 'uses');
    expect(usesEdge).toBeDefined();
    expect(usesEdge?.source).toBe('pkg/api.Server');
    expect(usesEdge?.target).toBe('pkg/api.Handler'); // resolved full node ID
  });

  // Bug 2 fix: cross-package uses edge target resolves to declaring package
  it('should resolve cross-package uses edge target to declaring package node ID', async () => {
    // In real Go source, cross-package refs carry a qualifier: "contracts.Repository".
    // The parser preserves the raw source text, so field.type = "contracts.Repository".
    const rawData = makeRawData({
      packages: [
        makePackage({
          id: 'pkg/contracts',
          name: 'contracts',
          fullName: 'pkg/contracts',
          interfaces: [
            {
              name: 'Repository',
              packageName: 'contracts',
              methods: [],
              embeddedInterfaces: [],
              exported: true,
              location: { file: 'contracts.go', startLine: 1, endLine: 5 },
            },
          ],
          structs: [],
        }),
        makePackage({
          id: 'pkg/service',
          name: 'service',
          fullName: 'pkg/service',
          interfaces: [],
          structs: [
            {
              name: 'UserService',
              packageName: 'service',
              fields: [
                {
                  name: 'repo',
                  type: 'contracts.Repository', // qualified, as Go source requires
                  exported: false,
                  embedded: false,
                  location: { file: 'service.go', startLine: 4, endLine: 4 },
                },
              ],
              methods: [],
              embeddedTypes: [],
              exported: true,
              location: { file: 'service.go', startLine: 1, endLine: 10 },
            },
          ],
        }),
      ],
    });

    const graph = await builder.build(rawData);

    const usesEdge = graph.edges.find((e) => e.type === 'uses');
    expect(usesEdge).toBeDefined();
    expect(usesEdge?.source).toBe('pkg/service.UserService');
    expect(usesEdge?.target).toBe('pkg/contracts.Repository'); // resolved to declaring package
  });

  // Iter 7: generates uses edges for struct field types (not just interfaces)
  it('generates uses edges for struct field types', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          fullName: 'pkg/hub',
          structs: [
            {
              name: 'Router',
              packageName: 'hub',
              fields: [
                {
                  name: 'engine',
                  type: 'Engine',
                  exported: false,
                  embedded: false,
                  location: { file: 'router.go', startLine: 5, endLine: 5 },
                },
              ],
              methods: [],
              embeddedTypes: [],
              exported: true,
              location: { file: 'router.go', startLine: 1, endLine: 10 },
            },
            {
              name: 'Engine',
              packageName: 'hub',
              fields: [],
              methods: [],
              embeddedTypes: [],
              exported: true,
              location: { file: 'engine.go', startLine: 1, endLine: 5 },
            },
          ],
          interfaces: [],
        }),
      ],
    });

    const graph = await builder.build(rawData);

    const usesEdges = graph.edges.filter((e) => e.type === 'uses');
    expect(usesEdges).toHaveLength(1);
    expect(usesEdges[0].source).toBe('pkg/hub.Router');
    expect(usesEdges[0].target).toBe('pkg/hub.Engine');
    expect(usesEdges[0].confidence).toBe(0.9);
    expect(usesEdges[0].context?.fieldType).toBe(true);
  });

  // Additional: interface names collected across all packages for uses detection
  it('should detect uses edges when field type matches interface from a different package', async () => {
    // Go requires a qualifier for cross-package refs; the parser preserves it verbatim.
    const rawData = makeRawData({
      packages: [
        makePackage({
          id: 'pkg/contracts',
          name: 'contracts',
          fullName: 'pkg/contracts',
          interfaces: [
            {
              name: 'Repository',
              packageName: 'contracts',
              methods: [],
              embeddedInterfaces: [],
              exported: true,
              location: { file: 'contracts.go', startLine: 1, endLine: 5 },
            },
          ],
          structs: [],
        }),
        makePackage({
          id: 'pkg/service',
          name: 'service',
          fullName: 'pkg/service',
          interfaces: [],
          structs: [
            {
              name: 'UserService',
              packageName: 'service',
              fields: [
                {
                  name: 'repo',
                  type: 'contracts.Repository', // qualified, as Go source requires
                  exported: false,
                  embedded: false,
                  location: { file: 'service.go', startLine: 4, endLine: 4 },
                },
              ],
              methods: [],
              embeddedTypes: [],
              exported: true,
              location: { file: 'service.go', startLine: 1, endLine: 10 },
            },
          ],
        }),
      ],
    });

    const graph = await builder.build(rawData);

    const usesEdges = graph.edges.filter((e) => e.type === 'uses');
    expect(usesEdges).toHaveLength(1);
    expect(usesEdges[0].source).toBe('pkg/service.UserService');
    expect(usesEdges[0].target).toBe('pkg/contracts.Repository');
  });

  // normalizeFieldType: pointer field type generates uses edge
  it('should generate uses edge for pointer field type (*Config)', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          fullName: 'pkg/hub',
          structs: [
            {
              name: 'Server',
              packageName: 'hub',
              fields: [
                {
                  name: 'config',
                  type: '*Config',
                  exported: false,
                  embedded: false,
                  location: { file: 'server.go', startLine: 5, endLine: 5 },
                },
              ],
              methods: [],
              embeddedTypes: [],
              exported: true,
              location: { file: 'server.go', startLine: 1, endLine: 10 },
            },
            {
              name: 'Config',
              packageName: 'hub',
              fields: [],
              methods: [],
              embeddedTypes: [],
              exported: true,
              location: { file: 'config.go', startLine: 1, endLine: 5 },
            },
          ],
          interfaces: [],
        }),
      ],
    });

    const graph = await builder.build(rawData);

    const usesEdges = graph.edges.filter((e) => e.type === 'uses');
    expect(usesEdges).toHaveLength(1);
    expect(usesEdges[0].source).toBe('pkg/hub.Server');
    expect(usesEdges[0].target).toBe('pkg/hub.Config');
  });

  // normalizeFieldType: package-qualified field type generates uses edge
  it('should generate uses edge for package-qualified field type (engine.Engine)', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          id: 'pkg/hub',
          name: 'hub',
          fullName: 'pkg/hub',
          structs: [
            {
              name: 'Server',
              packageName: 'hub',
              fields: [
                {
                  name: 'engine',
                  type: '*engine.Engine',
                  exported: false,
                  embedded: false,
                  location: { file: 'server.go', startLine: 5, endLine: 5 },
                },
              ],
              methods: [],
              embeddedTypes: [],
              exported: true,
              location: { file: 'server.go', startLine: 1, endLine: 10 },
            },
          ],
          interfaces: [],
        }),
        makePackage({
          id: 'pkg/hub/engine',
          name: 'engine',
          fullName: 'pkg/hub/engine',
          structs: [
            {
              name: 'Engine',
              packageName: 'engine',
              fields: [],
              methods: [],
              embeddedTypes: [],
              exported: true,
              location: { file: 'engine.go', startLine: 1, endLine: 10 },
            },
          ],
          interfaces: [],
        }),
      ],
    });

    const graph = await builder.build(rawData);

    const usesEdges = graph.edges.filter((e) => e.type === 'uses');
    expect(usesEdges).toHaveLength(1);
    expect(usesEdges[0].source).toBe('pkg/hub.Server');
    expect(usesEdges[0].target).toBe('pkg/hub/engine.Engine');
  });

  // normalizeFieldType: slice field type generates uses edge
  it('should generate uses edge for slice field type ([]Worker)', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          fullName: 'pkg/pool',
          structs: [
            {
              name: 'Pool',
              packageName: 'pool',
              fields: [
                {
                  name: 'workers',
                  type: '[]Worker',
                  exported: false,
                  embedded: false,
                  location: { file: 'pool.go', startLine: 3, endLine: 3 },
                },
              ],
              methods: [],
              embeddedTypes: [],
              exported: true,
              location: { file: 'pool.go', startLine: 1, endLine: 10 },
            },
            {
              name: 'Worker',
              packageName: 'pool',
              fields: [],
              methods: [],
              embeddedTypes: [],
              exported: true,
              location: { file: 'worker.go', startLine: 1, endLine: 5 },
            },
          ],
          interfaces: [],
        }),
      ],
    });

    const graph = await builder.build(rawData);

    const usesEdges = graph.edges.filter((e) => e.type === 'uses');
    expect(usesEdges).toHaveLength(1);
    expect(usesEdges[0].source).toBe('pkg/pool.Pool');
    expect(usesEdges[0].target).toBe('pkg/pool.Worker');
  });

  // Interface-centric filter: isolated struct is excluded
  it('should exclude isolated struct with no edges', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          id: 'pkg/hub',
          name: 'hub',
          fullName: 'pkg/hub',
          structs: [
            {
              name: 'IsolatedDTO',
              packageName: 'hub',
              fields: [],
              methods: [],
              embeddedTypes: [],
              exported: true,
              location: { file: 'dto.go', startLine: 1, endLine: 5 },
            },
            {
              name: 'UsedStruct',
              packageName: 'hub',
              fields: [],
              methods: [],
              embeddedTypes: [],
              exported: true,
              location: { file: 'used.go', startLine: 1, endLine: 5 },
            },
          ],
          interfaces: [
            {
              name: 'MyInterface',
              packageName: 'hub',
              methods: [],
              embeddedInterfaces: [],
              exported: true,
              location: { file: 'iface.go', startLine: 1, endLine: 5 },
            },
          ],
        }),
      ],
      implementations: [
        {
          structName: 'UsedStruct',
          structPackageId: 'hub',
          interfaceName: 'MyInterface',
          interfacePackageId: 'hub',
          confidence: 1.0,
          matchedMethods: [],
          source: 'inferred',
        },
      ],
    });

    const graph = await builder.build(rawData);

    // IsolatedDTO should NOT be in nodes (no edges)
    expect(graph.nodes.find((n) => n.name === 'IsolatedDTO')).toBeUndefined();
    // UsedStruct and MyInterface should be in nodes
    expect(graph.nodes.find((n) => n.name === 'UsedStruct')).toBeDefined();
    expect(graph.nodes.find((n) => n.name === 'MyInterface')).toBeDefined();
  });

  // Interface-centric filter: interface with no edges is still kept
  it('should keep interface node even when it has no edges', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          fullName: 'pkg/api',
          interfaces: [
            {
              name: 'UnimplementedInterface',
              packageName: 'api',
              methods: [],
              embeddedInterfaces: [],
              exported: true,
              location: { file: 'api.go', startLine: 1, endLine: 5 },
            },
          ],
          structs: [],
        }),
      ],
    });

    const graph = await builder.build(rawData);

    // Interface always kept even with no edges
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].name).toBe('UnimplementedInterface');
    expect(graph.nodes[0].type).toBe('interface');
  });

  // Interface-centric filter: struct referenced as edge TARGET is kept
  it('should keep struct node that appears as edge target (uses dependency)', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          fullName: 'pkg/hub',
          structs: [
            {
              name: 'Consumer',
              packageName: 'hub',
              fields: [
                {
                  name: 'dep',
                  type: 'Dependency',
                  exported: false,
                  embedded: false,
                  location: { file: 'hub.go', startLine: 3, endLine: 3 },
                },
              ],
              methods: [],
              embeddedTypes: [],
              exported: true,
              location: { file: 'hub.go', startLine: 1, endLine: 10 },
            },
            {
              name: 'Dependency',
              packageName: 'hub',
              fields: [],
              methods: [],
              embeddedTypes: [],
              exported: true,
              location: { file: 'dep.go', startLine: 1, endLine: 5 },
            },
          ],
          interfaces: [],
        }),
      ],
    });

    const graph = await builder.build(rawData);

    // Consumer has uses edge → kept; Dependency is target → kept
    expect(graph.nodes.find((n) => n.name === 'Consumer')).toBeDefined();
    expect(graph.nodes.find((n) => n.name === 'Dependency')).toBeDefined();
  });

  describe('impl edge resolution - cross-package same short name', () => {
    it('correctly attributes impl edges when two packages share the same short package name', async () => {
      // Two packages both named 'store' (short) but different fullNames
      // pkg/hub/store has SQLiteStore implementing hub/store.Store (CreateSession, GetSession)
      // pkg/catalog/store has SQLiteStore implementing catalog/store.Store (CreateProduct, GetProduct)
      // Result: NO cross-contamination
      const rawData: GoRawData = {
        packages: [
          {
            id: 'pkg/hub/store',
            name: 'store',
            fullName: 'pkg/hub/store',
            dirPath: '/x/pkg/hub/store',
            sourceFiles: ['sqlite.go'],
            files: [],
            imports: [],
            functions: [],
            structs: [
              {
                name: 'SQLiteStore',
                packageName: 'store', // short name (as parser sets it)
                exported: true,
                fields: [],
                embeddedTypes: [],
                location: {
                  file: '/x/pkg/hub/store/sqlite.go',
                  startLine: 1,
                  endLine: 100,
                },
                methods: [
                  {
                    name: 'CreateSession',
                    exported: true,
                    parameters: [],
                    returnTypes: [],
                    location: {
                      file: '/x/pkg/hub/store/sqlite.go',
                      startLine: 10,
                      endLine: 15,
                    },
                  },
                  {
                    name: 'GetSession',
                    exported: true,
                    parameters: [],
                    returnTypes: [],
                    location: {
                      file: '/x/pkg/hub/store/sqlite.go',
                      startLine: 16,
                      endLine: 20,
                    },
                  },
                ],
              },
            ],
            interfaces: [
              {
                name: 'Store',
                packageName: 'store',
                exported: true,
                methods: [
                  {
                    name: 'CreateSession',
                    exported: true,
                    parameters: [],
                    returnTypes: [],
                    location: {
                      file: '/x/pkg/hub/store/store.go',
                      startLine: 5,
                      endLine: 6,
                    },
                  },
                  {
                    name: 'GetSession',
                    exported: true,
                    parameters: [],
                    returnTypes: [],
                    location: {
                      file: '/x/pkg/hub/store/store.go',
                      startLine: 7,
                      endLine: 8,
                    },
                  },
                ],
                embeddedInterfaces: [],
                location: {
                  file: '/x/pkg/hub/store/store.go',
                  startLine: 1,
                  endLine: 10,
                },
              },
            ],
          },
          {
            id: 'pkg/catalog/store',
            name: 'store',
            fullName: 'pkg/catalog/store',
            dirPath: '/x/pkg/catalog/store',
            sourceFiles: ['sqlite.go'],
            files: [],
            imports: [],
            functions: [],
            structs: [
              {
                name: 'SQLiteStore',
                packageName: 'store', // SAME short name!
                exported: true,
                fields: [],
                embeddedTypes: [],
                location: {
                  file: '/x/pkg/catalog/store/sqlite.go',
                  startLine: 1,
                  endLine: 100,
                },
                methods: [
                  {
                    name: 'CreateProduct',
                    exported: true,
                    parameters: [],
                    returnTypes: [],
                    location: {
                      file: '/x/pkg/catalog/store/sqlite.go',
                      startLine: 10,
                      endLine: 15,
                    },
                  },
                  {
                    name: 'GetProduct',
                    exported: true,
                    parameters: [],
                    returnTypes: [],
                    location: {
                      file: '/x/pkg/catalog/store/sqlite.go',
                      startLine: 16,
                      endLine: 20,
                    },
                  },
                ],
              },
            ],
            interfaces: [
              {
                name: 'Store',
                packageName: 'store',
                exported: true,
                methods: [
                  {
                    name: 'CreateProduct',
                    exported: true,
                    parameters: [],
                    returnTypes: [],
                    location: {
                      file: '/x/pkg/catalog/store/catalog_store.go',
                      startLine: 5,
                      endLine: 6,
                    },
                  },
                  {
                    name: 'GetProduct',
                    exported: true,
                    parameters: [],
                    returnTypes: [],
                    location: {
                      file: '/x/pkg/catalog/store/catalog_store.go',
                      startLine: 7,
                      endLine: 8,
                    },
                  },
                ],
                embeddedInterfaces: [],
                location: {
                  file: '/x/pkg/catalog/store/catalog_store.go',
                  startLine: 1,
                  endLine: 10,
                },
              },
            ],
          },
        ],
        implementations: [], // empty so BehaviorAnalyzer runs the matcher
      };

      const behaviorAnalyzer = new BehaviorAnalyzer(null as any);
      const graph = await behaviorAnalyzer.buildCapabilityGraph(rawData);

      // hub/store.SQLiteStore should implement hub/store.Store
      const hubImplEdge = graph.edges.find(
        (e) =>
          e.type === 'implements' &&
          e.source === 'pkg/hub/store.SQLiteStore' &&
          e.target === 'pkg/hub/store.Store'
      );
      expect(hubImplEdge).toBeDefined();

      // catalog/store.SQLiteStore should implement catalog/store.Store
      const catalogImplEdge = graph.edges.find(
        (e) =>
          e.type === 'implements' &&
          e.source === 'pkg/catalog/store.SQLiteStore' &&
          e.target === 'pkg/catalog/store.Store'
      );
      expect(catalogImplEdge).toBeDefined();

      // CRITICAL: catalog/store.SQLiteStore must NOT implement hub/store.Store
      const falseEdge = graph.edges.find(
        (e) =>
          e.type === 'implements' &&
          e.source === 'pkg/catalog/store.SQLiteStore' &&
          e.target === 'pkg/hub/store.Store'
      );
      expect(falseEdge).toBeUndefined();
    });
  });

  // Edge deduplication: duplicate impl edges are removed
  it('should deduplicate edges with same source, target, and type', async () => {
    const impl = {
      structName: 'Server',
      structPackageId: 'api',
      interfaceName: 'Handler',
      interfacePackageId: 'api',
      confidence: 1.0,
      matchedMethods: [],
      source: 'inferred' as const,
    };

    const rawData = makeRawData({
      packages: [
        makePackage({
          id: 'pkg/api',
          name: 'api',
          fullName: 'pkg/api',
          structs: [
            {
              name: 'Server',
              packageName: 'api',
              fields: [],
              methods: [],
              embeddedTypes: [],
              exported: true,
              location: { file: 'server.go', startLine: 1, endLine: 5 },
            },
          ],
          interfaces: [
            {
              name: 'Handler',
              packageName: 'api',
              methods: [],
              embeddedInterfaces: [],
              exported: true,
              location: { file: 'handler.go', startLine: 1, endLine: 5 },
            },
          ],
        }),
      ],
      // Same impl twice (can happen when InterfaceMatcher processes multiple packages)
      implementations: [impl, impl],
    });

    const graph = await builder.build(rawData);

    const implEdges = graph.edges.filter((e) => e.type === 'implements');
    expect(implEdges).toHaveLength(1);
  });

  describe('uses edge - same-name type disambiguation via package qualifier', () => {
    it('resolves models.Event to pkg/hub/models.Event, not cmd/swarm-mcp.Event', async () => {
      const rawData = makeRawData({
        packages: [
          makePackage({
            // Package with the WRONG Event (should NOT be picked)
            id: 'cmd/swarm-mcp',
            name: 'swarm_mcp',
            fullName: 'cmd/swarm-mcp',
            structs: [
              {
                name: 'Event',
                packageName: 'swarm_mcp',
                exported: true,
                fields: [],
                methods: [],
                embeddedTypes: [],
                location: { file: '/x/cmd/swarm-mcp/event.go', startLine: 1, endLine: 5 },
              },
            ],
            interfaces: [],
          }),
          makePackage({
            // Package with the CORRECT Event
            id: 'pkg/hub/models',
            name: 'models',
            fullName: 'pkg/hub/models',
            structs: [
              {
                name: 'Event',
                packageName: 'models',
                exported: true,
                fields: [],
                methods: [],
                embeddedTypes: [],
                location: { file: '/x/pkg/hub/models/models.go', startLine: 1, endLine: 5 },
              },
            ],
            interfaces: [],
          }),
          makePackage({
            // Package with the struct that uses models.Event
            id: 'pkg/hub',
            name: 'hub',
            fullName: 'pkg/hub',
            structs: [
              {
                name: 'sessionSubscriber',
                packageName: 'hub',
                exported: false,
                fields: [
                  {
                    name: 'ch',
                    type: 'chan *models.Event', // qualifier: 'models'
                    exported: false,
                    location: { file: '/x/pkg/hub/session.go', startLine: 10, endLine: 10 },
                  },
                ],
                methods: [],
                embeddedTypes: [],
                location: { file: '/x/pkg/hub/session.go', startLine: 5, endLine: 20 },
              },
            ],
            interfaces: [],
          }),
        ],
        implementations: [],
      });

      const graph = await builder.build(rawData);

      // Should have a uses edge to pkg/hub/models.Event
      const correctEdge = graph.edges.find(
        (e) =>
          e.type === 'uses' &&
          e.source === 'pkg/hub.sessionSubscriber' &&
          e.target === 'pkg/hub/models.Event'
      );
      expect(correctEdge).toBeDefined();

      // Must NOT have a uses edge to cmd/swarm-mcp.Event
      const wrongEdge = graph.edges.find(
        (e) =>
          e.type === 'uses' &&
          e.source === 'pkg/hub.sessionSubscriber' &&
          e.target === 'cmd/swarm-mcp.Event'
      );
      expect(wrongEdge).toBeUndefined();
    });

    it('does not create cross-package edge for unqualified field type (Go requires qualifier)', async () => {
      // In Go, cross-package type references MUST use a qualifier (e.g. "config.Config").
      // A bare "Config" field in pkg/hub can only refer to a type defined in the same package.
      // If pkg/hub has no "Config" struct/interface, no uses-edge should be created —
      // even if another package (pkg/config) defines a "Config" type.
      // This prevents false-positive edges from same-package func-types or parser artefacts.
      const rawData = makeRawData({
        packages: [
          makePackage({
            id: 'pkg/config',
            name: 'config',
            fullName: 'pkg/config',
            structs: [
              {
                name: 'Config',
                packageName: 'config',
                exported: true,
                fields: [],
                methods: [],
                embeddedTypes: [],
                location: { file: '/x/pkg/config/config.go', startLine: 1, endLine: 5 },
              },
            ],
            interfaces: [],
          }),
          makePackage({
            id: 'pkg/hub',
            name: 'hub',
            fullName: 'pkg/hub',
            structs: [
              {
                name: 'Server',
                packageName: 'hub',
                exported: true,
                fields: [
                  {
                    name: 'cfg',
                    type: 'Config', // No qualifier — cross-package ref impossible in valid Go
                    exported: false,
                    location: { file: '/x/pkg/hub/server.go', startLine: 5, endLine: 5 },
                  },
                ],
                methods: [],
                embeddedTypes: [],
                location: { file: '/x/pkg/hub/server.go', startLine: 1, endLine: 20 },
              },
            ],
            interfaces: [],
          }),
        ],
        implementations: [],
      });

      const graph = await builder.build(rawData);

      // No uses-edge should be created: "Config" has no same-package match in pkg/hub,
      // and cross-package bare-name resolution is disabled to prevent false positives.
      const edge = graph.edges.find((e) => e.type === 'uses' && e.source === 'pkg/hub.Server');
      expect(edge).toBeUndefined();
    });

    it('prefers same-package resolution over first-match-wins for unqualified field types', async () => {
      // Reproduces the codex-swarm false positive:
      // examples/user-service/internal/catalog.Handler.store has type "Store" (no qualifier).
      // pkg/hub/store also defines a "Store" interface and is registered first.
      // Without same-package preference, Handler would incorrectly point to pkg/hub/store.Store.
      const rawData = makeRawData({
        packages: [
          // pkg/hub/store is registered FIRST → first-match-wins would pick this
          makePackage({
            id: 'pkg/hub/store',
            name: 'store',
            fullName: 'pkg/hub/store',
            interfaces: [
              {
                name: 'Store',
                packageName: 'store',
                methods: [],
                embeddedInterfaces: [],
                exported: true,
                location: { file: '/x/pkg/hub/store/store.go', startLine: 1, endLine: 5 },
              },
            ],
            structs: [],
          }),
          // catalog package defines its own Store interface and Handler struct
          makePackage({
            id: 'examples/user-service/internal/catalog',
            name: 'catalog',
            fullName: 'examples/user-service/internal/catalog',
            interfaces: [
              {
                name: 'Store',
                packageName: 'catalog',
                methods: [],
                embeddedInterfaces: [],
                exported: true,
                location: { file: '/x/examples/user-service/internal/catalog/store.go', startLine: 1, endLine: 5 },
              },
            ],
            structs: [
              {
                name: 'Handler',
                packageName: 'catalog',
                exported: true,
                fields: [
                  {
                    name: 'store',
                    type: 'Store', // no package qualifier — same-package reference
                    exported: false,
                    location: { file: '/x/examples/user-service/internal/catalog/handler.go', startLine: 10, endLine: 10 },
                  },
                ],
                methods: [],
                embeddedTypes: [],
                location: { file: '/x/examples/user-service/internal/catalog/handler.go', startLine: 5, endLine: 20 },
              },
            ],
          }),
        ],
        implementations: [],
      });

      const graph = await builder.build(rawData);

      const edge = graph.edges.find(
        (e) => e.type === 'uses' && e.source === 'examples/user-service/internal/catalog.Handler'
      );
      expect(edge).toBeDefined();
      // Must resolve to the local catalog.Store, NOT to pkg/hub/store.Store
      expect(edge?.target).toBe('examples/user-service/internal/catalog.Store');
    });
  });

  // -------------------------------------------------------------------------
  // Cross-package same-name type collision tests (Phase A)
  // -------------------------------------------------------------------------
  describe('cross-package same-name type collision resolution', () => {
    // Two packages both named "engine" (different fullName).
    // pkg/engine contains Engine struct.
    // pkg/adapter/engine also contains Engine struct.
    // A consumer package imports pkg/engine under the "engine" qualifier.
    // A second consumer package imports pkg/adapter/engine under the "engine" qualifier.

    function makeCollisionFixture() {
      // Package 1: pkg/engine
      const pkgEngine = makePackage({
        id: 'pkg/engine',
        name: 'engine',
        fullName: 'pkg/engine',
        dirPath: '/test/pkg/engine',
        sourceFiles: ['engine.go'],
        imports: [],
        structs: [
          {
            name: 'Engine',
            packageName: 'engine',
            fields: [],
            methods: [],
            embeddedTypes: [],
            exported: true,
            location: { file: 'engine.go', startLine: 5, endLine: 20 },
          },
        ],
        interfaces: [],
        functions: [],
      });

      // Package 2: pkg/adapter/engine — same short name "engine", different fullName
      const pkgAdapterEngine = makePackage({
        id: 'pkg/adapter/engine',
        name: 'engine',
        fullName: 'pkg/adapter/engine',
        dirPath: '/test/pkg/adapter/engine',
        sourceFiles: ['engine.go'],
        imports: [],
        structs: [
          {
            name: 'Engine',
            packageName: 'engine',
            fields: [],
            methods: [],
            embeddedTypes: [],
            exported: true,
            location: { file: 'engine.go', startLine: 5, endLine: 20 },
          },
        ],
        interfaces: [],
        functions: [],
      });

      return { pkgEngine, pkgAdapterEngine };
    }

    // Test A-1: Struct importing pkg/engine resolves *engine.Engine → pkg/engine.Engine
    it('resolves field qualifier to pkg/engine.Engine when pkg/engine is imported', async () => {
      const { pkgEngine, pkgAdapterEngine } = makeCollisionFixture();

      // Consumer imports pkg/engine
      const pkgConsumer = makePackage({
        id: 'pkg/consumer',
        name: 'consumer',
        fullName: 'pkg/consumer',
        dirPath: '/test/pkg/consumer',
        sourceFiles: ['consumer.go'],
        imports: [
          {
            path: 'github.com/test/project/pkg/engine',
            location: { file: 'consumer.go', startLine: 3, endLine: 3 },
          },
        ],
        structs: [
          {
            name: 'Service',
            packageName: 'consumer',
            fields: [
              {
                name: 'eng',
                type: '*engine.Engine',
                exported: false,
                location: { file: 'consumer.go', startLine: 10, endLine: 10 },
              },
            ],
            methods: [],
            embeddedTypes: [],
            exported: true,
            location: { file: 'consumer.go', startLine: 8, endLine: 20 },
          },
        ],
        interfaces: [],
        functions: [],
      });

      const rawData = makeRawData({
        packages: [pkgEngine, pkgAdapterEngine, pkgConsumer],
      });

      const graph = await builder.build(rawData);

      const edge = graph.edges.find(
        (e) => e.type === 'uses' && e.source === 'pkg/consumer.Service'
      );
      expect(edge).toBeDefined();
      // Must resolve to pkg/engine.Engine, NOT pkg/adapter/engine.Engine
      expect(edge?.target).toBe('pkg/engine.Engine');
    });

    // Test A-2: Struct importing pkg/adapter/engine resolves *engine.Engine → pkg/adapter/engine.Engine
    it('resolves field qualifier to pkg/adapter/engine.Engine when pkg/adapter/engine is imported', async () => {
      const { pkgEngine, pkgAdapterEngine } = makeCollisionFixture();

      // Consumer imports pkg/adapter/engine
      const pkgConsumer2 = makePackage({
        id: 'pkg/consumer2',
        name: 'consumer2',
        fullName: 'pkg/consumer2',
        dirPath: '/test/pkg/consumer2',
        sourceFiles: ['consumer2.go'],
        imports: [
          {
            path: 'github.com/test/project/pkg/adapter/engine',
            location: { file: 'consumer2.go', startLine: 3, endLine: 3 },
          },
        ],
        structs: [
          {
            name: 'Adapter',
            packageName: 'consumer2',
            fields: [
              {
                name: 'eng',
                type: '*engine.Engine',
                exported: false,
                location: { file: 'consumer2.go', startLine: 10, endLine: 10 },
              },
            ],
            methods: [],
            embeddedTypes: [],
            exported: true,
            location: { file: 'consumer2.go', startLine: 8, endLine: 20 },
          },
        ],
        interfaces: [],
        functions: [],
      });

      const rawData = makeRawData({
        packages: [pkgEngine, pkgAdapterEngine, pkgConsumer2],
      });

      const graph = await builder.build(rawData);

      const edge = graph.edges.find(
        (e) => e.type === 'uses' && e.source === 'pkg/consumer2.Adapter'
      );
      expect(edge).toBeDefined();
      // Must resolve to pkg/adapter/engine.Engine, NOT pkg/engine.Engine
      expect(edge?.target).toBe('pkg/adapter/engine.Engine');
    });

    // Test A-3: Struct with NO import matching a qualifier → no false-positive edge
    it('produces no uses edge when qualifier has no matching import', async () => {
      const { pkgEngine, pkgAdapterEngine } = makeCollisionFixture();

      // Consumer with engine.Engine field but NO import for either engine package.
      // The imports array is non-empty (has an unrelated import) to signal that import
      // data IS available — so a missing "engine" qualifier entry means no import was
      // declared for it, and the edge should be suppressed (not a false positive).
      const pkgConsumerNoImport = makePackage({
        id: 'pkg/noImport',
        name: 'noImport',
        fullName: 'pkg/noImport',
        dirPath: '/test/pkg/noImport',
        sourceFiles: ['noimport.go'],
        imports: [
          // Has an unrelated import — import data is present but "engine" is not listed
          {
            path: 'fmt',
            location: { file: 'noimport.go', startLine: 2, endLine: 2 },
          },
        ],
        structs: [
          {
            name: 'Worker',
            packageName: 'noImport',
            fields: [
              {
                name: 'eng',
                type: '*engine.Engine',
                exported: false,
                location: { file: 'noimport.go', startLine: 10, endLine: 10 },
              },
            ],
            methods: [],
            embeddedTypes: [],
            exported: true,
            location: { file: 'noimport.go', startLine: 8, endLine: 20 },
          },
        ],
        interfaces: [],
        functions: [],
      });

      const rawData = makeRawData({
        packages: [pkgEngine, pkgAdapterEngine, pkgConsumerNoImport],
      });

      const graph = await builder.build(rawData);

      const edge = graph.edges.find(
        (e) => e.type === 'uses' && e.source === 'pkg/noImport.Worker'
      );
      // Must NOT produce a false-positive edge when no import disambiguates the qualifier
      expect(edge).toBeUndefined();
    });

    // Test A-4: Import alias is used as qualifier instead of package short name
    it('resolves aliased import qualifier to correct package', async () => {
      const { pkgEngine } = makeCollisionFixture();

      // Consumer imports pkg/engine with an alias "eng"
      const pkgConsumerAliased = makePackage({
        id: 'pkg/aliased',
        name: 'aliased',
        fullName: 'pkg/aliased',
        dirPath: '/test/pkg/aliased',
        sourceFiles: ['aliased.go'],
        imports: [
          {
            path: 'github.com/test/project/pkg/engine',
            alias: 'eng',
            location: { file: 'aliased.go', startLine: 3, endLine: 3 },
          },
        ],
        structs: [
          {
            name: 'Runner',
            packageName: 'aliased',
            fields: [
              {
                name: 'e',
                type: '*eng.Engine', // uses alias "eng" as qualifier
                exported: false,
                location: { file: 'aliased.go', startLine: 10, endLine: 10 },
              },
            ],
            methods: [],
            embeddedTypes: [],
            exported: true,
            location: { file: 'aliased.go', startLine: 8, endLine: 20 },
          },
        ],
        interfaces: [],
        functions: [],
      });

      const rawData = makeRawData({
        packages: [pkgEngine, pkgConsumerAliased],
      });

      const graph = await builder.build(rawData);

      const edge = graph.edges.find(
        (e) => e.type === 'uses' && e.source === 'pkg/aliased.Runner'
      );
      expect(edge).toBeDefined();
      // Must resolve via alias "eng" → import path "github.com/test/project/pkg/engine" → pkg/engine.Engine
      expect(edge?.target).toBe('pkg/engine.Engine');
    });
  });
});

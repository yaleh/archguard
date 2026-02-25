import { describe, it, expect } from 'vitest';
import { GoroutineTopologyBuilder } from '@/plugins/golang/atlas/builders/goroutine-topology-builder.js';
import type { GoRawData } from '@/plugins/golang/types.js';

function makeRawData(overrides?: Partial<GoRawData>): GoRawData {
  return {
    packages: [],
    moduleRoot: '/test',
    moduleName: 'github.com/test/project',
    ...overrides,
  };
}

describe('GoroutineTopologyBuilder', () => {
  const builder = new GoroutineTopologyBuilder();

  it('should build empty topology for project with no goroutines', async () => {
    const rawData = makeRawData();
    const topology = await builder.build(rawData);

    expect(topology.nodes).toHaveLength(0);
    expect(topology.edges).toHaveLength(0);
    expect(topology.channels).toHaveLength(0);
  });

  it('should detect main goroutine node', async () => {
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
          functions: [
            {
              name: 'main',
              packageName: 'main',
              parameters: [],
              returnTypes: [],
              exported: false,
              location: { file: 'main.go', startLine: 1, endLine: 10 },
              body: {
                calls: [],
                goSpawns: [],
                channelOps: [],
              },
            },
          ],
        },
      ],
    });

    const topology = await builder.build(rawData);

    const mainNode = topology.nodes.find((n) => n.id === 'cmd/app.main');
    expect(mainNode).toBeDefined();
    expect(mainNode?.type).toBe('main');
  });

  it('should detect goroutine spawned from function body', async () => {
    const rawData = makeRawData({
      packages: [
        {
          id: 'pkg/worker',
          name: 'worker',
          fullName: 'pkg/worker',
          dirPath: '/test/pkg/worker',
          sourceFiles: ['worker.go'],
          imports: [],
          structs: [],
          interfaces: [],
          functions: [
            {
              name: 'StartWorkers',
              packageName: 'worker',
              parameters: [],
              returnTypes: [],
              exported: true,
              location: { file: 'worker.go', startLine: 1, endLine: 15 },
              body: {
                calls: [],
                goSpawns: [
                  {
                    call: {
                      functionName: 'doWork',
                      location: { file: 'worker.go', startLine: 5, endLine: 5 },
                    },
                    location: { file: 'worker.go', startLine: 5, endLine: 5 },
                  },
                ],
                channelOps: [],
              },
            },
          ],
        },
      ],
    });

    const topology = await builder.build(rawData);

    expect(topology.nodes).toHaveLength(1);
    expect(topology.nodes[0].type).toBe('spawned');
    expect(topology.nodes[0].spawnType).toBe('named_func');
    expect(topology.edges).toHaveLength(1);
  });

  it('should scan struct methods for goroutine spawns (ADR-002 requirement)', async () => {
    const rawData = makeRawData({
      packages: [
        {
          id: 'pkg/server',
          name: 'server',
          fullName: 'pkg/server',
          dirPath: '/test/pkg/server',
          sourceFiles: ['server.go'],
          imports: [],
          structs: [
            {
              name: 'Server',
              packageName: 'server',
              fields: [],
              embeddedTypes: [],
              exported: true,
              location: { file: 'server.go', startLine: 1, endLine: 5 },
              methods: [
                {
                  name: 'Start',
                  parameters: [],
                  returnTypes: [],
                  exported: true,
                  location: { file: 'server.go', startLine: 7, endLine: 20 },
                  body: {
                    calls: [],
                    goSpawns: [
                      {
                        call: {
                          functionName: '<anonymous>',
                          location: { file: 'server.go', startLine: 10, endLine: 10 },
                        },
                        location: { file: 'server.go', startLine: 10, endLine: 10 },
                      },
                    ],
                    channelOps: [],
                  },
                },
              ],
            },
          ],
          interfaces: [],
          functions: [],
        },
      ],
    });

    const topology = await builder.build(rawData);

    expect(topology.nodes).toHaveLength(1);
    expect(topology.nodes[0].spawnType).toBe('anonymous_func');
    expect(topology.edges).toHaveLength(1);
  });

  it('should set spawnType on GoroutineNode (ADR-002 v1.2)', async () => {
    const rawData = makeRawData({
      packages: [
        {
          id: 'pkg/app',
          name: 'app',
          fullName: 'pkg/app',
          dirPath: '/test/pkg/app',
          sourceFiles: ['app.go'],
          imports: [],
          structs: [],
          interfaces: [],
          functions: [
            {
              name: 'Run',
              packageName: 'app',
              parameters: [],
              returnTypes: [],
              exported: true,
              location: { file: 'app.go', startLine: 1, endLine: 10 },
              body: {
                calls: [],
                goSpawns: [
                  {
                    call: {
                      functionName: 'namedWorker',
                      location: { file: 'app.go', startLine: 5, endLine: 5 },
                    },
                    location: { file: 'app.go', startLine: 5, endLine: 5 },
                  },
                  {
                    call: {
                      functionName: '<anonymous>',
                      location: { file: 'app.go', startLine: 7, endLine: 7 },
                    },
                    location: { file: 'app.go', startLine: 7, endLine: 7 },
                  },
                ],
                channelOps: [],
              },
            },
          ],
        },
      ],
    });

    const topology = await builder.build(rawData);

    expect(topology.nodes).toHaveLength(2);
    const namedNode = topology.nodes.find((n) => n.name === 'namedWorker');
    const anonNode = topology.nodes.find((n) => n.name === '<anonymous>');

    expect(namedNode?.spawnType).toBe('named_func');
    expect(anonNode?.spawnType).toBe('anonymous_func');
  });

  it('should produce distinct node IDs for multiple cmd packages with main', async () => {
    function makeMainPkg(fullName: string) {
      return {
        id: fullName,
        name: 'main',
        fullName,
        dirPath: `/test/${fullName}`,
        sourceFiles: ['main.go'],
        imports: [],
        structs: [],
        interfaces: [],
        functions: [
          {
            name: 'main',
            packageName: 'main',
            parameters: [],
            returnTypes: [],
            exported: false,
            location: { file: 'main.go', startLine: 1, endLine: 5 },
            body: { calls: [], goSpawns: [], channelOps: [] },
          },
        ],
      };
    }

    const rawData = makeRawData({
      packages: [makeMainPkg('cmd/app-a'), makeMainPkg('cmd/app-b')],
    });

    const topology = await builder.build(rawData);
    const mainNodes = topology.nodes.filter((n) => n.type === 'main');

    expect(mainNodes).toHaveLength(2);
    const ids = mainNodes.map((n) => n.id);
    expect(ids).toContain('cmd/app-a.main');
    expect(ids).toContain('cmd/app-b.main');
    // IDs must be distinct
    expect(new Set(ids).size).toBe(2);
  });

  it('should use package-qualified fromId for main goroutine spawn relations', async () => {
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
          functions: [
            {
              name: 'main',
              packageName: 'main',
              parameters: [],
              returnTypes: [],
              exported: false,
              location: { file: 'main.go', startLine: 1, endLine: 10 },
              body: {
                calls: [],
                goSpawns: [
                  {
                    call: { functionName: 'worker', location: { file: 'main.go', startLine: 5, endLine: 5 } },
                    location: { file: 'main.go', startLine: 5, endLine: 5 },
                  },
                ],
                channelOps: [],
              },
            },
          ],
        },
      ],
    });

    const topology = await builder.build(rawData);
    expect(topology.edges).toHaveLength(1);
    expect(topology.edges[0].from).toBe('cmd/app.main');
  });

  // ==================== ChannelEdge tests ====================

  it('should return empty channelEdges when no channels exist', async () => {
    const rawData = makeRawData();
    const topology = await builder.build(rawData);

    expect(topology.channelEdges).toBeDefined();
    expect(topology.channelEdges).toHaveLength(0);
  });

  it('should set channel name from make op channelName field', async () => {
    const rawData = makeRawData({
      packages: [
        {
          id: 'pkg/worker',
          name: 'worker',
          fullName: 'pkg/worker',
          dirPath: '/test/pkg/worker',
          sourceFiles: ['worker.go'],
          imports: [],
          structs: [],
          interfaces: [],
          functions: [
            {
              name: 'StartWorkers',
              packageName: 'worker',
              parameters: [],
              returnTypes: [],
              exported: true,
              location: { file: 'worker.go', startLine: 1, endLine: 20 },
              body: {
                calls: [],
                goSpawns: [],
                channelOps: [
                  {
                    channelName: 'jobs',
                    operation: 'make',
                    location: { file: 'worker.go', startLine: 3, endLine: 3 },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const topology = await builder.build(rawData);

    expect(topology.channels).toHaveLength(1);
    expect(topology.channels[0].name).toBe('jobs');
  });

  it('should emit make edge from spawner to channel', async () => {
    const rawData = makeRawData({
      packages: [
        {
          id: 'pkg/worker',
          name: 'worker',
          fullName: 'pkg/worker',
          dirPath: '/test/pkg/worker',
          sourceFiles: ['worker.go'],
          imports: [],
          structs: [],
          interfaces: [],
          functions: [
            {
              name: 'StartWorkers',
              packageName: 'worker',
              parameters: [],
              returnTypes: [],
              exported: true,
              location: { file: 'worker.go', startLine: 1, endLine: 20 },
              body: {
                calls: [],
                goSpawns: [],
                channelOps: [
                  {
                    channelName: 'jobs',
                    operation: 'make',
                    location: { file: 'worker.go', startLine: 3, endLine: 3 },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const topology = await builder.build(rawData);

    expect(topology.channelEdges).toHaveLength(1);
    const makeEdge = topology.channelEdges[0];
    expect(makeEdge.from).toBe('pkg/worker.StartWorkers');
    expect(makeEdge.to).toBe('chan-pkg/worker-3');
    expect(makeEdge.edgeType).toBe('make');
  });

  it('should emit recv edge from channel to spawned goroutine when channel var is in spawn args', async () => {
    const rawData = makeRawData({
      packages: [
        {
          id: 'pkg/worker',
          name: 'worker',
          fullName: 'pkg/worker',
          dirPath: '/test/pkg/worker',
          sourceFiles: ['worker.go'],
          imports: [],
          structs: [],
          interfaces: [],
          functions: [
            {
              name: 'StartWorkers',
              packageName: 'worker',
              parameters: [],
              returnTypes: [],
              exported: true,
              location: { file: 'worker.go', startLine: 1, endLine: 20 },
              body: {
                calls: [],
                goSpawns: [
                  {
                    call: {
                      functionName: 'doWork',
                      args: ['jobs'],
                      location: { file: 'worker.go', startLine: 7, endLine: 7 },
                    },
                    location: { file: 'worker.go', startLine: 7, endLine: 7 },
                  },
                ],
                channelOps: [
                  {
                    channelName: 'jobs',
                    operation: 'make',
                    location: { file: 'worker.go', startLine: 3, endLine: 3 },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const topology = await builder.build(rawData);

    // Should have: 1 make edge + 1 recv edge
    expect(topology.channelEdges).toHaveLength(2);

    const recvEdge = topology.channelEdges.find((e) => e.edgeType === 'recv');
    expect(recvEdge).toBeDefined();
    expect(recvEdge?.from).toBe('chan-pkg/worker-3');
    expect(recvEdge?.to).toBe('pkg/worker.StartWorkers.spawn-7');
    expect(recvEdge?.edgeType).toBe('recv');
  });

  it('should emit make and recv edges for method bodies', async () => {
    const rawData = makeRawData({
      packages: [
        {
          id: 'pkg/server',
          name: 'server',
          fullName: 'pkg/server',
          dirPath: '/test/pkg/server',
          sourceFiles: ['server.go'],
          imports: [],
          structs: [
            {
              name: 'Server',
              packageName: 'server',
              fields: [],
              embeddedTypes: [],
              exported: true,
              location: { file: 'server.go', startLine: 1, endLine: 5 },
              methods: [
                {
                  name: 'Start',
                  parameters: [],
                  returnTypes: [],
                  exported: true,
                  location: { file: 'server.go', startLine: 7, endLine: 30 },
                  body: {
                    calls: [],
                    goSpawns: [
                      {
                        call: {
                          functionName: 'handleConn',
                          args: ['done'],
                          location: { file: 'server.go', startLine: 12, endLine: 12 },
                        },
                        location: { file: 'server.go', startLine: 12, endLine: 12 },
                      },
                    ],
                    channelOps: [
                      {
                        channelName: 'done',
                        operation: 'make',
                        location: { file: 'server.go', startLine: 9, endLine: 9 },
                      },
                    ],
                  },
                },
              ],
            },
          ],
          interfaces: [],
          functions: [],
        },
      ],
    });

    const topology = await builder.build(rawData);

    const makeEdge = topology.channelEdges.find((e) => e.edgeType === 'make');
    expect(makeEdge).toBeDefined();
    expect(makeEdge?.from).toBe('pkg/server.Server.Start');
    expect(makeEdge?.to).toBe('chan-pkg/server-9');

    const recvEdge = topology.channelEdges.find((e) => e.edgeType === 'recv');
    expect(recvEdge).toBeDefined();
    expect(recvEdge?.from).toBe('chan-pkg/server-9');
    expect(recvEdge?.to).toBe('pkg/server.Server.Start.spawn-12');
  });

  it('should not emit recv edge when spawn args do not match any channel var', async () => {
    const rawData = makeRawData({
      packages: [
        {
          id: 'pkg/worker',
          name: 'worker',
          fullName: 'pkg/worker',
          dirPath: '/test/pkg/worker',
          sourceFiles: ['worker.go'],
          imports: [],
          structs: [],
          interfaces: [],
          functions: [
            {
              name: 'StartWorkers',
              packageName: 'worker',
              parameters: [],
              returnTypes: [],
              exported: true,
              location: { file: 'worker.go', startLine: 1, endLine: 20 },
              body: {
                calls: [],
                goSpawns: [
                  {
                    call: {
                      functionName: 'doWork',
                      args: ['someOtherVar'],
                      location: { file: 'worker.go', startLine: 7, endLine: 7 },
                    },
                    location: { file: 'worker.go', startLine: 7, endLine: 7 },
                  },
                ],
                channelOps: [
                  {
                    channelName: 'jobs',
                    operation: 'make',
                    location: { file: 'worker.go', startLine: 3, endLine: 3 },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const topology = await builder.build(rawData);

    // Only make edge, no recv edge
    const recvEdges = topology.channelEdges.filter((e) => e.edgeType === 'recv');
    expect(recvEdges).toHaveLength(0);
    const makeEdges = topology.channelEdges.filter((e) => e.edgeType === 'make');
    expect(makeEdges).toHaveLength(1);
  });
});

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
                    call: {
                      functionName: 'worker',
                      location: { file: 'main.go', startLine: 5, endLine: 5 },
                    },
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

// ========== Phase C-1: goroutine lifecycle detection ==========

describe('Phase C-1: goroutine lifecycle detection', () => {
  const builder = new GoroutineTopologyBuilder();

  /**
   * Helper: build a minimal package with one standalone function that spawns a goroutine.
   * The spawned goroutine calls `targetFuncName`.
   * `targetFunc` (if provided) is added to the package functions list so the builder
   * can resolve its parameters and body.
   */
  function makePackageWithSpawn({
    pkgFullName = 'github.com/test/srv',
    parentFuncName = 'Serve',
    spawnLine = 10,
    spawnTargetName = 'handleConn',
    targetFunc,
  }: {
    pkgFullName?: string;
    parentFuncName?: string;
    spawnLine?: number;
    spawnTargetName?: string;
    targetFunc?: {
      name: string;
      parameters?: Array<{ name: string; type: string }>;
      body?: {
        calls?: Array<{ functionName: string; packageName?: string }>;
        channelOps?: Array<{
          channelName: string;
          operation: 'send' | 'receive' | 'close' | 'make';
        }>;
      };
    };
  }): GoRawData {
    const parentFunction = {
      name: parentFuncName,
      packageName: pkgFullName,
      parameters: [] as Array<{
        name: string;
        type: string;
        exported: boolean;
        location: { file: string; startLine: number; endLine: number };
      }>,
      returnTypes: [] as string[],
      exported: true,
      location: { file: 'server.go', startLine: 1, endLine: 50 },
      body: {
        calls: [] as Array<{
          functionName: string;
          location: { file: string; startLine: number; endLine: number };
        }>,
        goSpawns: [
          {
            call: {
              functionName: spawnTargetName,
              location: { file: 'server.go', startLine: spawnLine, endLine: spawnLine },
            },
            location: { file: 'server.go', startLine: spawnLine, endLine: spawnLine },
          },
        ],
        channelOps: [] as Array<{
          channelName: string;
          operation: 'send' | 'receive' | 'close' | 'make';
          location: { file: string; startLine: number; endLine: number };
        }>,
      },
    };

    const functions: GoRawData['packages'][0]['functions'] = [parentFunction];

    if (targetFunc) {
      functions.push({
        name: targetFunc.name,
        packageName: pkgFullName,
        parameters: (targetFunc.parameters ?? []).map((p) => ({
          name: p.name,
          type: p.type,
          exported: false,
          location: { file: 'server.go', startLine: 0, endLine: 0 },
        })),
        returnTypes: [],
        exported: false,
        location: { file: 'server.go', startLine: 20, endLine: 40 },
        body: targetFunc.body
          ? {
              calls: (targetFunc.body.calls ?? []).map((c) => ({
                functionName: c.functionName,
                packageName: c.packageName,
                location: { file: 'server.go', startLine: 25, endLine: 25 },
              })),
              goSpawns: [],
              channelOps: (targetFunc.body.channelOps ?? []).map((op) => ({
                channelName: op.channelName,
                operation: op.operation,
                location: { file: 'server.go', startLine: 26, endLine: 26 },
              })),
            }
          : undefined,
      });
    }

    return {
      packages: [
        {
          id: pkgFullName,
          name: 'server',
          fullName: pkgFullName,
          dirPath: '/test/server',
          sourceFiles: ['server.go'],
          imports: [],
          structs: [],
          interfaces: [],
          functions,
        },
      ],
      moduleRoot: '/test',
      moduleName: 'github.com/test',
    };
  }

  it('test 1: named function with context param, body extracted, ctx.Done() present', async () => {
    const rawData = makePackageWithSpawn({
      spawnTargetName: 'handleConn',
      targetFunc: {
        name: 'handleConn',
        parameters: [{ name: 'ctx', type: 'context.Context' }],
        body: {
          calls: [{ functionName: 'Done', packageName: 'ctx' }],
        },
      },
    });

    const topology = await builder.build(rawData);

    expect(topology.lifecycle).toBeDefined();
    expect(topology.lifecycle.length).toBeGreaterThan(0);

    const summary = topology.lifecycle[0];
    expect(summary.spawnTargetName).toBe('handleConn');
    expect(summary.receivesContext).toBe(true);
    expect(summary.cancellationCheckAvailable).toBe(true);
    expect(summary.hasCancellationCheck).toBe(true);
    expect(summary.cancellationMechanism).toBe('context');
    expect(summary.orphan).toBe(false);

    // nodeId must match the corresponding GoroutineNode.id
    const spawnedNode = topology.nodes.find((n) => n.type === 'spawned');
    expect(spawnedNode).toBeDefined();
    expect(summary.nodeId).toBe(spawnedNode.id);
  });

  it('test 2: named function with context param, body extracted, no cancellation check', async () => {
    const rawData = makePackageWithSpawn({
      spawnTargetName: 'handleConn',
      targetFunc: {
        name: 'handleConn',
        parameters: [{ name: 'ctx', type: 'context.Context' }],
        body: {
          calls: [{ functionName: 'someOtherCall' }],
        },
      },
    });

    const topology = await builder.build(rawData);

    expect(topology.lifecycle).toBeDefined();
    const summary = topology.lifecycle[0];
    expect(summary.receivesContext).toBe(true);
    expect(summary.cancellationCheckAvailable).toBe(true);
    expect(summary.hasCancellationCheck).toBe(false);
    expect(summary.orphan).toBe(false);
  });

  it('test 3: named function, no context param, body extracted, no cancellation check → orphan', async () => {
    const rawData = makePackageWithSpawn({
      spawnTargetName: 'handleConn',
      targetFunc: {
        name: 'handleConn',
        parameters: [{ name: 'conn', type: 'net.Conn' }],
        body: {
          calls: [],
        },
      },
    });

    const topology = await builder.build(rawData);

    expect(topology.lifecycle).toBeDefined();
    const summary = topology.lifecycle[0];
    expect(summary.receivesContext).toBe(false);
    expect(summary.cancellationCheckAvailable).toBe(true);
    expect(summary.hasCancellationCheck).toBe(false);
    expect(summary.orphan).toBe(true);
  });

  it('test 4: named function with context param, body NOT extracted (selective mode)', async () => {
    const rawData = makePackageWithSpawn({
      spawnTargetName: 'handleConn',
      targetFunc: {
        name: 'handleConn',
        parameters: [{ name: 'ctx', type: 'context.Context' }],
        // no body property → body not extracted
      },
    });

    const topology = await builder.build(rawData);

    expect(topology.lifecycle).toBeDefined();
    const summary = topology.lifecycle[0];
    expect(summary.receivesContext).toBe(true);
    expect(summary.cancellationCheckAvailable).toBe(false);
    expect(summary.hasCancellationCheck).toBeUndefined();
    expect(summary.orphan).toBe(false);
  });

  it('test 5: named function, no context param, body NOT extracted → orphan', async () => {
    const rawData = makePackageWithSpawn({
      spawnTargetName: 'handleConn',
      targetFunc: {
        name: 'handleConn',
        parameters: [],
        // no body
      },
    });

    const topology = await builder.build(rawData);

    expect(topology.lifecycle).toBeDefined();
    const summary = topology.lifecycle[0];
    expect(summary.receivesContext).toBe(false);
    expect(summary.cancellationCheckAvailable).toBe(false);
    expect(summary.orphan).toBe(true);
  });

  it('test 6: anonymous goroutine → orphan, spawnTargetName is <anonymous>', async () => {
    const rawData: GoRawData = {
      packages: [
        {
          id: 'github.com/test/srv',
          name: 'server',
          fullName: 'github.com/test/srv',
          dirPath: '/test/server',
          sourceFiles: ['server.go'],
          imports: [],
          structs: [],
          interfaces: [],
          functions: [
            {
              name: 'Serve',
              packageName: 'server',
              parameters: [],
              returnTypes: [],
              exported: true,
              location: { file: 'server.go', startLine: 1, endLine: 30 },
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
      moduleRoot: '/test',
      moduleName: 'github.com/test',
    };

    const topology = await builder.build(rawData);

    expect(topology.lifecycle).toBeDefined();
    const summary = topology.lifecycle[0];
    expect(summary.spawnTargetName).toBe('<anonymous>');
    expect(summary.receivesContext).toBe(false);
    expect(summary.cancellationCheckAvailable).toBe(false);
    expect(summary.orphan).toBe(true);
  });

  it('test 7: channel-based cancellation (stop channel receive)', async () => {
    const rawData = makePackageWithSpawn({
      spawnTargetName: 'worker',
      targetFunc: {
        name: 'worker',
        parameters: [{ name: 'done', type: 'chan struct{}' }],
        body: {
          channelOps: [{ channelName: 'done', operation: 'receive' }],
        },
      },
    });

    const topology = await builder.build(rawData);

    expect(topology.lifecycle).toBeDefined();
    const summary = topology.lifecycle[0];
    expect(summary.hasCancellationCheck).toBe(true);
    expect(summary.cancellationMechanism).toBe('channel');
    expect(summary.orphan).toBe(false);
  });

  it('test 8: spawn target not found in package → orphan, cancellationCheckAvailable false', async () => {
    // Spawn calls 'handleRemote' but no function named 'handleRemote' exists in this package
    const rawData = makePackageWithSpawn({
      spawnTargetName: 'handleRemote',
      // no targetFunc: handleRemote is in another package
    });

    const topology = await builder.build(rawData);

    expect(topology.lifecycle).toBeDefined();
    const summary = topology.lifecycle[0];
    expect(summary.spawnTargetName).toBe('handleRemote');
    expect(summary.receivesContext).toBe(false);
    expect(summary.cancellationCheckAvailable).toBe(false);
    expect(summary.orphan).toBe(true);
  });

  it('test 9: no spawns → lifecycle is undefined or empty', async () => {
    const rawData: GoRawData = {
      packages: [
        {
          id: 'github.com/test/srv',
          name: 'server',
          fullName: 'github.com/test/srv',
          dirPath: '/test/server',
          sourceFiles: ['server.go'],
          imports: [],
          structs: [],
          interfaces: [],
          functions: [
            {
              name: 'doWork',
              packageName: 'server',
              parameters: [],
              returnTypes: [],
              exported: true,
              location: { file: 'server.go', startLine: 1, endLine: 10 },
              body: {
                calls: [],
                goSpawns: [],
                channelOps: [],
              },
            },
          ],
        },
      ],
      moduleRoot: '/test',
      moduleName: 'github.com/test',
    };

    const topology = await builder.build(rawData);

    // lifecycle should be undefined or empty (no spawns)
    expect(topology.lifecycle === undefined || topology.lifecycle.length === 0).toBe(true);
  });
});

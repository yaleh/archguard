/**
 * Unit tests for GoroutineTopologyBuilder.
 *
 * Covers branch-dense paths: goroutine node extraction (main + spawned, from
 * functions and methods, anonymous vs named), spawn relations, channel
 * info/edges (make → send/recv), and lifecycle summaries (anonymous → orphan,
 * cross-package not-found → orphan, context param detection, ctx.Done and
 * stop-channel cancellation detection).
 */

import { describe, it, expect } from 'vitest';
import { GoroutineTopologyBuilder } from '@/plugins/golang/atlas/builders/goroutine-topology-builder.js';
import type { GoRawData, GoRawPackage, GoSpawnStmt } from '@/plugins/golang/types.js';

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

function spawn(overrides: Partial<GoSpawnStmt>): GoSpawnStmt {
  return {
    call: { functionName: 'handleConn', args: [], location: { file: 'a.go', startLine: 15 } },
    location: { file: 'a.go', startLine: 15 },
    ...overrides,
  };
}

describe('GoroutineTopologyBuilder.build', () => {
  it('returns empty topology for empty raw data', async () => {
    const builder = new GoroutineTopologyBuilder();
    const t = await builder.build(makeRawData());
    expect(t.nodes).toEqual([]);
    expect(t.edges).toEqual([]);
    expect(t.channels).toEqual([]);
    expect(t.channelEdges).toEqual([]);
    expect(t.lifecycle).toBeUndefined();
  });

  it('extracts main node for main package main() function', async () => {
    const builder = new GoroutineTopologyBuilder();
    const raw = makeRawData({
      packages: [
        makePackage({
          name: 'main',
          fullName: 'cmd/app',
          functions: [
            {
              name: 'main',
              packageName: 'main',
              parameters: [],
              returnTypes: [],
              exported: false,
              location: { file: 'main.go', startLine: 3 },
              body: { calls: [], goSpawns: [], channelOps: [] },
            } as never,
          ],
        }),
      ],
    });
    const t = await builder.build(raw);
    const main = t.nodes.find((n) => n.type === 'main');
    expect(main?.id).toBe('cmd/app.main');
  });

  it('extracts named spawned goroutine from function body', async () => {
    const builder = new GoroutineTopologyBuilder();
    const raw = makeRawData({
      packages: [
        makePackage({
          functions: [
            {
              name: 'serve',
              packageName: 'svc',
              parameters: [],
              returnTypes: [],
              exported: false,
              body: {
                calls: [],
                goSpawns: [spawn({})],
                channelOps: [],
              },
            } as never,
          ],
        }),
      ],
    });
    const t = await builder.build(raw);
    const spawned = t.nodes.find((n) => n.type === 'spawned');
    expect(spawned).toMatchObject({
      name: 'handleConn',
      spawnType: 'named_func',
      package: 'pkg/svc',
    });
    expect(t.edges).toContainEqual(
      expect.objectContaining({
        from: 'pkg/svc.serve',
        spawnType: 'go-stmt',
      })
    );
  });

  it('extracts anonymous spawned goroutine with go-func edge', async () => {
    const builder = new GoroutineTopologyBuilder();
    const raw = makeRawData({
      packages: [
        makePackage({
          functions: [
            {
              name: 'serve',
              packageName: 'svc',
              parameters: [],
              returnTypes: [],
              exported: false,
              body: {
                calls: [],
                goSpawns: [spawn({ call: { functionName: '<anonymous>', args: [], location: { file: 'a.go', startLine: 20 } } })],
                channelOps: [],
              },
            } as never,
          ],
        }),
      ],
    });
    const t = await builder.build(raw);
    const spawned = t.nodes.find((n) => n.type === 'spawned');
    expect(spawned?.name).toBe('<anonymous@15>');
    expect(spawned?.spawnType).toBe('anonymous_func');
    expect(t.edges[0].spawnType).toBe('go-func');
  });

  it('extracts goroutines from struct method bodies', async () => {
    const builder = new GoroutineTopologyBuilder();
    const raw = makeRawData({
      packages: [
        makePackage({
          structs: [
            {
              name: 'Server',
              packageName: 'svc',
              fields: [],
              methods: [
                {
                  name: 'Start',
                  receiverType: 'Server',
                  parameters: [],
                  returnTypes: [],
                  exported: true,
                  body: {
                    calls: [],
                    goSpawns: [spawn({ call: { functionName: 'worker', args: [], location: { file: 'a.go', startLine: 25 } } })],
                    channelOps: [],
                  },
                } as never,
              ],
              embeddedTypes: [],
              exported: true,
            } as never,
          ],
        }),
      ],
    });
    const t = await builder.build(raw);
    const spawned = t.nodes.find((n) => n.type === 'spawned');
    expect(spawned?.name).toBe('worker');
    expect(t.edges[0].from).toBe('pkg/svc.Server.Start');
  });

  it('extracts channel info from make operations', async () => {
    const builder = new GoroutineTopologyBuilder();
    const raw = makeRawData({
      packages: [
        makePackage({
          functions: [
            {
              name: 'serve',
              packageName: 'svc',
              parameters: [],
              returnTypes: [],
              exported: false,
              body: {
                calls: [],
                goSpawns: [],
                channelOps: [
                  { channelName: 'jobs', operation: 'make', location: { file: 'a.go', startLine: 5 } },
                ],
              },
            } as never,
          ],
        }),
      ],
    });
    const t = await builder.build(raw);
    expect(t.channels).toContainEqual(
      expect.objectContaining({
        id: 'chan-pkg/svc-5',
        name: 'jobs',
        direction: 'bidirectional',
      })
    );
  });

  it('emits make edge and recv edge when spawn arg references a channel', async () => {
    const builder = new GoroutineTopologyBuilder();
    const raw = makeRawData({
      packages: [
        makePackage({
          functions: [
            {
              name: 'serve',
              packageName: 'svc',
              parameters: [],
              returnTypes: [],
              exported: false,
              body: {
                calls: [],
                goSpawns: [
                  spawn({
                    call: { functionName: 'worker', args: ['jobs'], location: { file: 'a.go', startLine: 15 } },
                  }),
                ],
                channelOps: [
                  { channelName: 'jobs', operation: 'make', location: { file: 'a.go', startLine: 5 } },
                ],
              },
            } as never,
          ],
        }),
      ],
    });
    const t = await builder.build(raw);
    const edgeTypes = t.channelEdges.map((e) => e.edgeType).sort();
    expect(edgeTypes).toContain('make');
    expect(edgeTypes).toContain('recv');
  });

  describe('lifecycle summaries', () => {
    it('marks anonymous goroutines as orphan', async () => {
      const builder = new GoroutineTopologyBuilder();
      const raw = makeRawData({
        packages: [
          makePackage({
            functions: [
              {
                name: 'serve',
                packageName: 'svc',
                parameters: [],
                returnTypes: [],
                exported: false,
                body: {
                  calls: [],
                  goSpawns: [spawn({ call: { functionName: '', args: [], location: { file: 'a.go', startLine: 15 } } })],
                  channelOps: [],
                },
              } as never,
            ],
          }),
        ],
      });
      const t = await builder.build(raw);
      expect(t.lifecycle).toContainEqual(
        expect.objectContaining({
          spawnTargetName: '<anonymous>',
          orphan: true,
          cancellationCheckAvailable: false,
        })
      );
    });

    it('marks unknown (cross-package) spawn targets as orphan', async () => {
      const builder = new GoroutineTopologyBuilder();
      const raw = makeRawData({
        packages: [
          makePackage({
            functions: [
              {
                name: 'serve',
                packageName: 'svc',
                parameters: [],
                returnTypes: [],
                exported: false,
                body: {
                  calls: [],
                  goSpawns: [spawn({ call: { functionName: 'remoteFn', args: [], location: { file: 'a.go', startLine: 15 } } })],
                  channelOps: [],
                },
              } as never,
            ],
          }),
        ],
      });
      const t = await builder.build(raw);
      const life = t.lifecycle?.find((l) => l.spawnTargetName === 'remoteFn');
      expect(life).toMatchObject({ orphan: true, cancellationCheckAvailable: false });
    });

    it('detects context.Context parameter and ctx.Done() check', async () => {
      const builder = new GoroutineTopologyBuilder();
      const raw = makeRawData({
        packages: [
          makePackage({
            functions: [
              {
                name: 'serve',
                packageName: 'svc',
                parameters: [],
                returnTypes: [],
                exported: false,
                body: {
                  calls: [],
                  goSpawns: [spawn({ call: { functionName: 'worker', args: [], location: { file: 'a.go', startLine: 15 } } })],
                  channelOps: [],
                },
              } as never,
              {
                name: 'worker',
                packageName: 'svc',
                parameters: [{ name: 'ctx', type: 'context.Context', exported: false } as never],
                returnTypes: [],
                exported: false,
                body: {
                  calls: [{ functionName: 'Done', packageName: 'ctx', args: [], location: { file: 'a.go', startLine: 30 } }],
                  goSpawns: [],
                  channelOps: [],
                },
              } as never,
            ],
          }),
        ],
      });
      const t = await builder.build(raw);
      const life = t.lifecycle?.find((l) => l.spawnTargetName === 'worker');
      expect(life).toMatchObject({
        receivesContext: true,
        cancellationCheckAvailable: true,
        hasCancellationCheck: true,
        cancellationMechanism: 'context',
        orphan: false,
      });
    });

    it('detects stop-channel receive as channel cancellation', async () => {
      const builder = new GoroutineTopologyBuilder();
      const raw = makeRawData({
        packages: [
          makePackage({
            functions: [
              {
                name: 'serve',
                packageName: 'svc',
                parameters: [],
                returnTypes: [],
                exported: false,
                body: {
                  calls: [],
                  goSpawns: [spawn({ call: { functionName: 'worker', args: [], location: { file: 'a.go', startLine: 15 } } })],
                  channelOps: [],
                },
              } as never,
              {
                name: 'worker',
                packageName: 'svc',
                parameters: [],
                returnTypes: [],
                exported: false,
                body: {
                  calls: [],
                  goSpawns: [],
                  channelOps: [{ channelName: 'stop', operation: 'receive', location: { file: 'a.go', startLine: 40 } }],
                },
              } as never,
            ],
          }),
        ],
      });
      const t = await builder.build(raw);
      const life = t.lifecycle?.find((l) => l.spawnTargetName === 'worker');
      expect(life).toMatchObject({
        receivesContext: false,
        cancellationCheckAvailable: true,
        hasCancellationCheck: true,
        cancellationMechanism: 'channel',
        orphan: false,
      });
    });

    it('marks goroutine without context or cancellation as orphan', async () => {
      const builder = new GoroutineTopologyBuilder();
      const raw = makeRawData({
        packages: [
          makePackage({
            functions: [
              {
                name: 'serve',
                packageName: 'svc',
                parameters: [],
                returnTypes: [],
                exported: false,
                body: {
                  calls: [],
                  goSpawns: [spawn({ call: { functionName: 'worker', args: [], location: { file: 'a.go', startLine: 15 } } })],
                  channelOps: [],
                },
              } as never,
              {
                name: 'worker',
                packageName: 'svc',
                parameters: [],
                returnTypes: [],
                exported: false,
                body: { calls: [], goSpawns: [], channelOps: [] },
              } as never,
            ],
          }),
        ],
      });
      const t = await builder.build(raw);
      const life = t.lifecycle?.find((l) => l.spawnTargetName === 'worker');
      expect(life).toMatchObject({
        cancellationCheckAvailable: true,
        hasCancellationCheck: false,
        orphan: true,
      });
    });

    it('reports unavailable tier-2 when target body not extracted', async () => {
      const builder = new GoroutineTopologyBuilder();
      const raw = makeRawData({
        packages: [
          makePackage({
            functions: [
              {
                name: 'serve',
                packageName: 'svc',
                parameters: [],
                returnTypes: [],
                exported: false,
                body: {
                  calls: [],
                  goSpawns: [spawn({ call: { functionName: 'worker', args: [], location: { file: 'a.go', startLine: 15 } } })],
                  channelOps: [],
                },
              } as never,
              {
                name: 'worker',
                packageName: 'svc',
                parameters: [],
                returnTypes: [],
                exported: false,
                // no body → selective mode
              } as never,
            ],
          }),
        ],
      });
      const t = await builder.build(raw);
      const life = t.lifecycle?.find((l) => l.spawnTargetName === 'worker');
      expect(life).toMatchObject({
        cancellationCheckAvailable: false,
        orphan: true,
      });
    });
  });
});

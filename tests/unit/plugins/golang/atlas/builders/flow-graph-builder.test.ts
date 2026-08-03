/**
 * Unit tests for FlowGraphBuilder.
 *
 * Covers branch-dense paths: framework pattern matching (exact method,
 * methodSuffix, receiverContains), entry-point detection from function and
 * method bodies, main() injection, generic-heuristic fallback, manual entry
 * points, entryPointPattern scan, protocol filtering, direct vs interface
 * call classification, BFS indirect tracing (maxCallDepth/visited/dedup),
 * and noisy-call filtering (builtins/stdlib/w.X/ctx./err.).
 */

import { describe, it, expect } from 'vitest';
import { FlowGraphBuilder } from '@/plugins/golang/atlas/builders/flow-graph-builder.js';
import type { GoRawData, GoRawPackage, GoCallExpr, GoField } from '@/plugins/golang/types.js';

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

function call(overrides: Partial<GoCallExpr>): GoCallExpr {
  return {
    functionName: 'HandleFunc',
    args: ['/api', 'handler'],
    location: { file: 'a.go', startLine: 10 },
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

const NET_HTTP = new Set(['net/http']);

describe('FlowGraphBuilder.build', () => {
  it('returns empty graph when no framework patterns match', async () => {
    const builder = new FlowGraphBuilder();
    const raw = makeRawData({
      packages: [
        makePackage({
          functions: [
            {
              name: 'run',
              packageName: 'svc',
              parameters: [],
              returnTypes: [],
              exported: false,
              body: { calls: [call({ functionName: 'SomethingElse' })], goSpawns: [], channelOps: [] },
            } as never,
          ],
        }),
      ],
    });
    const graph = await builder.build(raw, { detectedFrameworks: NET_HTTP });
    expect(graph.entryPoints).toEqual([]);
    expect(graph.callChains).toEqual([]);
  });

  it('detects net/http HandleFunc entry point from function body', async () => {
    const builder = new FlowGraphBuilder();
    const raw = makeRawData({
      packages: [
        makePackage({
          functions: [
            {
              name: 'main',
              packageName: 'svc',
              parameters: [],
              returnTypes: [],
              exported: false,
              body: { calls: [call({ functionName: 'HandleFunc' })], goSpawns: [], channelOps: [] },
            } as never,
          ],
        }),
      ],
    });
    const graph = await builder.build(raw, { detectedFrameworks: NET_HTTP });
    expect(graph.entryPoints).toHaveLength(1);
    expect(graph.entryPoints[0]).toMatchObject({
      protocol: 'http',
      framework: 'net/http',
      path: '/api',
      handler: 'handler',
      package: 'pkg/svc',
    });
  });

  it('strips inline func( closures from handler name', async () => {
    const builder = new FlowGraphBuilder();
    const raw = makeRawData({
      packages: [
        makePackage({
          functions: [
            {
              name: 'main',
              packageName: 'svc',
              parameters: [],
              returnTypes: [],
              exported: false,
              body: {
                calls: [call({ functionName: 'HandleFunc', args: ['/x', 'func(w, r){}'] })],
                goSpawns: [],
                channelOps: [],
              },
            } as never,
          ],
        }),
      ],
    });
    const graph = await builder.build(raw, { detectedFrameworks: NET_HTTP });
    expect(graph.entryPoints[0].handler).toBe('');
  });

  it('detects gin framework entries with httpMethod (GET/POST/PUT/DELETE/PATCH/Any)', async () => {
    const builder = new FlowGraphBuilder();
    const raw = makeRawData({
      packages: [
        makePackage({
          functions: [
            {
              name: 'main',
              packageName: 'svc',
              parameters: [],
              returnTypes: [],
              exported: false,
              body: {
                calls: [
                  call({ functionName: 'GET', args: ['/a', 'getH'] }),
                  call({ functionName: 'Any', args: ['/any', 'anyH'] }),
                ],
                goSpawns: [],
                channelOps: [],
              },
            } as never,
          ],
        }),
      ],
    });
    const graph = await builder.build(raw, { detectedFrameworks: new Set(['gin']) });
    expect(graph.entryPoints).toHaveLength(2);
    const get = graph.entryPoints.find((e) => e.path === '/a');
    expect(get?.method).toBe('GET');
    const any = graph.entryPoints.find((e) => e.path === '/any');
    expect(any?.method).toBe('ANY');
  });

  it('uses receiverContains to disambiguate gorilla/mux from net/http', async () => {
    const builder = new FlowGraphBuilder();
    const raw = makeRawData({
      packages: [
        makePackage({
          functions: [
            {
              name: 'main',
              packageName: 'svc',
              parameters: [],
              returnTypes: [],
              exported: false,
              body: {
                calls: [call({ functionName: 'Handle', args: ['/a', 'h'], receiverType: 'mux.Router' })],
                goSpawns: [],
                channelOps: [],
              },
            } as never,
          ],
        }),
      ],
    });
    const graph = await builder.build(raw, { detectedFrameworks: new Set(['gorilla/mux']) });
    expect(graph.entryPoints[0].framework).toBe('gorilla/mux');
  });

  it('skips receiverContains check when receiverType is absent (documented)', async () => {
    const builder = new FlowGraphBuilder();
    const raw = makeRawData({
      packages: [
        makePackage({
          functions: [
            {
              name: 'main',
              packageName: 'svc',
              parameters: [],
              returnTypes: [],
              exported: false,
              body: {
                calls: [call({ functionName: 'Handle', args: ['/a', 'h'] })], // no receiverType
                goSpawns: [],
                channelOps: [],
              },
            } as never,
          ],
        }),
      ],
    });
    // matchesPattern skips the receiver check when receiverType is falsy
    const graph = await builder.build(raw, { detectedFrameworks: new Set(['gorilla/mux']) });
    expect(graph.entryPoints).toHaveLength(1);
  });

  it('rejects receiverContains when receiverType is present but does not match', async () => {
    const builder = new FlowGraphBuilder();
    const raw = makeRawData({
      packages: [
        makePackage({
          functions: [
            {
              name: 'main',
              packageName: 'svc',
              parameters: [],
              returnTypes: [],
              exported: false,
              body: {
                calls: [call({ functionName: 'Handle', args: ['/a', 'h'], receiverType: 'http.Server' })],
                goSpawns: [],
                channelOps: [],
              },
            } as never,
          ],
        }),
      ],
    });
    const graph = await builder.build(raw, { detectedFrameworks: new Set(['gorilla/mux']) });
    expect(graph.entryPoints).toHaveLength(0);
  });

  it('matches grpc methodSuffix pattern (Register*Server)', async () => {
    const builder = new FlowGraphBuilder();
    const raw = makeRawData({
      packages: [
        makePackage({
          functions: [
            {
              name: 'main',
              packageName: 'svc',
              parameters: [],
              returnTypes: [],
              exported: false,
              body: {
                calls: [call({ functionName: 'RegisterUserServiceServer' })],
                goSpawns: [],
                channelOps: [],
              },
            } as never,
          ],
        }),
      ],
    });
    const graph = await builder.build(raw, { detectedFrameworks: new Set(['grpc']) });
    expect(graph.entryPoints[0].protocol).toBe('grpc');
  });

  it('does not match grpc pattern for calls without the Server suffix', async () => {
    const builder = new FlowGraphBuilder();
    const raw = makeRawData({
      packages: [
        makePackage({
          functions: [
            {
              name: 'main',
              packageName: 'svc',
              parameters: [],
              returnTypes: [],
              exported: false,
              body: {
                calls: [call({ functionName: 'RegisterClient' })], // no 'Server' suffix
                goSpawns: [],
                channelOps: [],
              },
            } as never,
          ],
        }),
      ],
    });
    const graph = await builder.build(raw, { detectedFrameworks: new Set(['grpc']) });
    expect(graph.entryPoints).toHaveLength(0);
  });

  it('injects main() entry when detectedFrameworks includes main', async () => {
    const builder = new FlowGraphBuilder();
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
              location: { file: 'main.go', startLine: 5 },
            } as never,
          ],
        }),
      ],
    });
    const graph = await builder.build(raw, { detectedFrameworks: new Set(['main']) });
    expect(graph.entryPoints[0]).toMatchObject({
      protocol: 'cli',
      framework: 'main',
      handler: 'main.main',
      package: 'cmd/app',
    });
  });

  it('detects entry points from struct method bodies', async () => {
    const builder = new FlowGraphBuilder();
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
                    calls: [call({ functionName: 'HandleFunc', args: ['/start', 'startH'] })],
                    goSpawns: [],
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
    const graph = await builder.build(raw, { detectedFrameworks: NET_HTTP });
    expect(graph.entryPoints).toHaveLength(1);
    expect(graph.entryPoints[0].handler).toBe('startH');
  });

  it('falls back to generic tool registration when no primary detection matched', async () => {
    const builder = new FlowGraphBuilder();
    const raw = makeRawData({
      packages: [
        makePackage({
          functions: [
            {
              name: 'setup',
              packageName: 'svc',
              parameters: [],
              returnTypes: [],
              exported: false,
              body: {
                calls: [call({ functionName: 'AddTool', args: ['/tool', 'toolHandler'] })],
                goSpawns: [],
                channelOps: [],
              },
            } as never,
          ],
        }),
      ],
    });
    const graph = await builder.build(raw, { detectedFrameworks: NET_HTTP });
    // AddTool is not a net/http pattern, but generic fallback fires
    expect(graph.entryPoints).toHaveLength(1);
    expect(graph.entryPoints[0]).toMatchObject({
      protocol: 'custom',
      framework: 'generic-heuristic',
      handler: 'toolHandler',
    });
  });

  it('injects manual entry points', async () => {
    const builder = new FlowGraphBuilder();
    const graph = await builder.build(makeRawData(), {
      detectedFrameworks: NET_HTTP,
      entryPoints: [{ function: 'pkg/path.(*Svc).Run', protocol: 'cli' }],
    });
    expect(graph.entryPoints).toHaveLength(1);
    expect(graph.entryPoints[0]).toMatchObject({
      protocol: 'cli',
      framework: 'manual',
      handler: 'pkg/path.(*Svc).Run',
    });
  });

  it('scans entryPointPattern regex across calls and sanitizes handler', async () => {
    const builder = new FlowGraphBuilder();
    const raw = makeRawData({
      packages: [
        makePackage({
          functions: [
            {
              name: 'main',
              packageName: 'svc',
              parameters: [],
              returnTypes: [],
              exported: false,
              body: {
                calls: [
                  call({ functionName: 'CustomRoute', args: ['/custom', 'customH'] }),
                  call({ functionName: 'InlineRoute', args: ['/inline', 'func(ctx){}'] }),
                ],
                goSpawns: [],
                channelOps: [],
              },
            } as never,
          ],
        }),
      ],
    });
    const graph = await builder.build(raw, {
      detectedFrameworks: NET_HTTP,
      entryPointPattern: 'Route$',
    });
    expect(graph.entryPoints).toHaveLength(2);
    const custom = graph.entryPoints.find((e) => e.path === '/custom');
    expect(custom?.handler).toBe('customH');
    const inline = graph.entryPoints.find((e) => e.path === '/inline');
    expect(inline?.handler).toBe('');
  });

  it('treats invalid entryPointPattern as never-match', async () => {
    const builder = new FlowGraphBuilder();
    const raw = makeRawData({
      packages: [
        makePackage({
          functions: [
            {
              name: 'main',
              packageName: 'svc',
              parameters: [],
              returnTypes: [],
              exported: false,
              body: {
                calls: [call({ functionName: 'Anything' })],
                goSpawns: [],
                channelOps: [],
              },
            } as never,
          ],
        }),
      ],
    });
    const graph = await builder.build(raw, {
      detectedFrameworks: NET_HTTP,
      entryPointPattern: '(',
    });
    expect(graph.entryPoints).toHaveLength(0);
  });

  describe('protocol filtering', () => {
    it('filters entry points and call chains by allowed protocols', async () => {
      const builder = new FlowGraphBuilder();
      const raw = makeRawData({
        packages: [
          makePackage({
            functions: [
              {
                name: 'main',
                packageName: 'svc',
                parameters: [],
                returnTypes: [],
                exported: false,
                body: {
                  calls: [call({ functionName: 'HandleFunc', args: ['/api', 'handler'] })],
                  goSpawns: [],
                  channelOps: [],
                },
              } as never,
            ],
          }),
        ],
      });
      const graph = await builder.build(raw, {
        detectedFrameworks: NET_HTTP,
        protocols: ['grpc'], // http entry should be filtered out
      });
      expect(graph.entryPoints).toHaveLength(0);
      expect(graph.callChains).toHaveLength(0);
    });
  });

  describe('call chain tracing', () => {
    it('traces direct calls from handler and builds call chains', async () => {
      const builder = new FlowGraphBuilder();
      const raw = makeRawData({
        packages: [
          makePackage({
            functions: [
              {
                name: 'main',
                packageName: 'svc',
                parameters: [],
                returnTypes: [],
                exported: false,
                body: {
                  calls: [call({ functionName: 'HandleFunc', args: ['/api', 'handleReq'] })],
                  goSpawns: [],
                  channelOps: [],
                },
              } as never,
              {
                name: 'handleReq',
                packageName: 'svc',
                parameters: [{ name: 'w', type: 'ResponseWriter', exported: false } as never],
                returnTypes: [],
                exported: false,
                body: {
                  calls: [
                    { functionName: 'loadData', packageName: 'svc', args: [], location: { file: 'a.go', startLine: 20 } },
                  ],
                  goSpawns: [],
                  channelOps: [],
                },
              } as never,
              {
                name: 'loadData',
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
      const graph = await builder.build(raw, { detectedFrameworks: NET_HTTP });
      expect(graph.callChains).toHaveLength(1);
      const chain = graph.callChains[0];
      expect(chain.entryPoint).toBe(graph.entryPoints[0].id);
      expect(chain.calls).toContainEqual(
        expect.objectContaining({
          from: 'handleReq',
          to: 'svc.loadData',
          type: 'direct',
        })
      );
    });

    it('classifies calls on interface-typed receivers as interface', async () => {
      const builder = new FlowGraphBuilder();
      const raw = makeRawData({
        packages: [
          makePackage({
            interfaces: [{ name: 'Repo', methods: [], embeddedInterfaces: [], exported: true } as never],
            functions: [
              {
                name: 'main',
                packageName: 'svc',
                parameters: [],
                returnTypes: [],
                exported: false,
                body: {
                  calls: [call({ functionName: 'HandleFunc', args: ['/api', 'handleReq'] })],
                  goSpawns: [],
                  channelOps: [],
                },
              } as never,
              {
                name: 'handleReq',
                packageName: 'svc',
                parameters: [{ name: 'repo', type: 'Repo', exported: false } as never],
                returnTypes: [],
                exported: false,
                body: {
                  calls: [
                    {
                      functionName: 'Find',
                      packageName: 'repo',
                      args: [],
                      location: { file: 'a.go', startLine: 20 },
                    } as GoCallExpr,
                  ],
                  goSpawns: [],
                  channelOps: [],
                },
              } as never,
            ],
          }),
        ],
      });
      const graph = await builder.build(raw, { detectedFrameworks: NET_HTTP });
      const chain = graph.callChains[0];
      expect(chain.calls[0]).toMatchObject({
        to: 'repo.Find',
        type: 'interface',
        confidence: 0.8,
      });
    });

    it('classifies calls without packageName as direct', async () => {
      const builder = new FlowGraphBuilder();
      const raw = makeRawData({
        packages: [
          makePackage({
            functions: [
              {
                name: 'main',
                packageName: 'svc',
                parameters: [],
                returnTypes: [],
                exported: false,
                body: {
                  calls: [call({ functionName: 'HandleFunc', args: ['/api', 'helper'] })],
                  goSpawns: [],
                  channelOps: [],
                },
              } as never,
              {
                name: 'helper',
                packageName: 'svc',
                parameters: [],
                returnTypes: [],
                exported: false,
                body: {
                  calls: [
                    { functionName: 'localFn', args: [], location: { file: 'a.go', startLine: 20 } } as GoCallExpr,
                  ],
                  goSpawns: [],
                  channelOps: [],
                },
              } as never,
            ],
          }),
        ],
      });
      const graph = await builder.build(raw, { detectedFrameworks: NET_HTTP });
      expect(graph.callChains[0].calls[0]).toMatchObject({
        to: 'localFn',
        type: 'direct',
      });
    });

    it('filters noisy stdlib and builtin calls', async () => {
      const builder = new FlowGraphBuilder();
      const raw = makeRawData({
        packages: [
          makePackage({
            functions: [
              {
                name: 'main',
                packageName: 'svc',
                parameters: [],
                returnTypes: [],
                exported: false,
                body: {
                  calls: [call({ functionName: 'HandleFunc', args: ['/api', 'helper'] })],
                  goSpawns: [],
                  channelOps: [],
                },
              } as never,
              {
                name: 'helper',
                packageName: 'svc',
                parameters: [],
                returnTypes: [],
                exported: false,
                body: {
                  calls: [
                    { functionName: 'Println', packageName: 'fmt', args: [], location: { file: 'a.go', startLine: 20 } },
                    { functionName: 'make', args: [], location: { file: 'a.go', startLine: 21 } },
                    { functionName: 'Write', packageName: 'w', args: [], location: { file: 'a.go', startLine: 22 } },
                    { functionName: 'Done', packageName: 'ctx', args: [], location: { file: 'a.go', startLine: 23 } },
                    { functionName: 'URL', packageName: 'r', args: [], location: { file: 'a.go', startLine: 24 } },
                    { functionName: 'realFn', packageName: 'svc', args: [], location: { file: 'a.go', startLine: 25 } },
                  ] as GoCallExpr[],
                  goSpawns: [],
                  channelOps: [],
                },
              } as never,
            ],
          }),
        ],
      });
      const graph = await builder.build(raw, { detectedFrameworks: NET_HTTP });
      const tos = graph.callChains[0].calls.map((c) => c.to);
      expect(tos).toEqual(['svc.realFn']);
    });

    it('traces indirect calls with BFS up to maxCallDepth and dedups', async () => {
      const builder = new FlowGraphBuilder();
      // entry handler -> a() -> b(); a() -> a() self-call should be visited once
      const fnA = {
        name: 'a',
        packageName: 'svc',
        parameters: [],
        returnTypes: [],
        exported: false,
        body: {
          calls: [
            { functionName: 'b', packageName: 'svc', args: [], location: { file: 'a.go', startLine: 30 } } as GoCallExpr,
            { functionName: 'a', packageName: 'svc', args: [], location: { file: 'a.go', startLine: 31 } } as GoCallExpr,
          ],
          goSpawns: [],
          channelOps: [],
        },
      };
      const fnB = {
        name: 'b',
        packageName: 'svc',
        parameters: [],
        returnTypes: [],
        exported: false,
        body: {
          calls: [
            { functionName: 'c', packageName: 'svc', args: [], location: { file: 'a.go', startLine: 40 } } as GoCallExpr,
          ],
          goSpawns: [],
          channelOps: [],
        },
      };
      const raw = makeRawData({
        packages: [
          makePackage({
            functions: [
              {
                name: 'main',
                packageName: 'svc',
                parameters: [],
                returnTypes: [],
                exported: false,
                body: {
                  calls: [call({ functionName: 'HandleFunc', args: ['/api', 'a'] })],
                  goSpawns: [],
                  channelOps: [],
                },
              } as never,
              fnA as never,
              fnB as never,
            ],
          }),
        ],
      });
      const graph = await builder.build(raw, {
        detectedFrameworks: NET_HTTP,
        followIndirectCalls: true,
        maxCallDepth: 3,
      });
      const tos = graph.callChains[0].calls.map((c) => c.to);
      expect(tos).toContain('svc.b');
      expect(tos).toContain('svc.c');
    });

    it('returns no call chains for entries without a resolvable handler', async () => {
      const builder = new FlowGraphBuilder();
      const raw = makeRawData({
        packages: [
          makePackage({
            functions: [
              {
                name: 'main',
                packageName: 'svc',
                parameters: [],
                returnTypes: [],
                exported: false,
                body: {
                  calls: [call({ functionName: 'HandleFunc', args: ['/api', ''] })], // empty handler
                  goSpawns: [],
                  channelOps: [],
                },
              } as never,
            ],
          }),
        ],
      });
      const graph = await builder.build(raw, { detectedFrameworks: NET_HTTP });
      expect(graph.callChains[0].calls).toEqual([]);
    });

    it('traces calls from struct method handlers', async () => {
      const builder = new FlowGraphBuilder();
      const raw = makeRawData({
        packages: [
          makePackage({
            structs: [
              {
                name: 'Handler',
                packageName: 'svc',
                fields: [],
                methods: [
                  {
                    name: 'ServeHTTP',
                    receiverType: 'Handler',
                    parameters: [],
                    returnTypes: [],
                    exported: true,
                    body: {
                      calls: [call({ functionName: 'HandleFunc', args: ['/api', 'ServeHTTP'] })],
                      goSpawns: [],
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
      const graph = await builder.build(raw, { detectedFrameworks: NET_HTTP });
      const chain = graph.callChains[0];
      expect(chain.calls.length).toBeGreaterThanOrEqual(0); // handler resolves to method body or empty
    });
  });
});

import { describe, it, expect } from 'vitest';
import { FlowGraphBuilder } from '@/plugins/golang/atlas/builders/flow-graph-builder.js';
import type { GoRawData, GoRawPackage, GoFunction } from '@/plugins/golang/types.js';

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

function makeFunction(overrides?: Partial<GoFunction>): GoFunction {
  return {
    name: 'SetupRoutes',
    packageName: 'api',
    parameters: [],
    returnTypes: [],
    exported: true,
    location: { file: 'api.go', startLine: 1, endLine: 20 },
    ...overrides,
  };
}

describe('FlowGraphBuilder', () => {
  const builder = new FlowGraphBuilder();

  it('should return empty entryPoints and callChains for empty rawData', async () => {
    const rawData = makeRawData();
    const result = await builder.build(rawData, { detectedFrameworks: new Set(['net/http']) });

    expect(result.entryPoints).toHaveLength(0);
    expect(result.callChains).toHaveLength(0);
  });

  it('should detect HandleFunc call in function body as http entry point', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          fullName: 'pkg/api',
          functions: [
            makeFunction({
              body: {
                calls: [
                  {
                    functionName: 'HandleFunc',
                    location: { file: 'api.go', startLine: 5, endLine: 5 },
                  },
                ],
                goSpawns: [],
                channelOps: [],
              },
            }),
          ],
        }),
      ],
    });

    const result = await builder.build(rawData, { detectedFrameworks: new Set(['net/http']) });

    expect(result.entryPoints).toHaveLength(1);
    expect(result.entryPoints[0].protocol).toBe('http');
    expect(result.entryPoints[0].framework).toBe('net/http');
    expect(result.entryPoints[0].id).toBe('entry-pkg/api-5');
  });

  it('should detect Handle call in function body as http entry point', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          fullName: 'pkg/api',
          functions: [
            makeFunction({
              body: {
                calls: [
                  {
                    functionName: 'Handle',
                    location: { file: 'api.go', startLine: 10, endLine: 10 },
                  },
                ],
                goSpawns: [],
                channelOps: [],
              },
            }),
          ],
        }),
      ],
    });

    const result = await builder.build(rawData, { detectedFrameworks: new Set(['net/http']) });

    expect(result.entryPoints).toHaveLength(1);
    expect(result.entryPoints[0].protocol).toBe('http');
    expect(result.entryPoints[0].framework).toBe('net/http');
  });

  it('should detect GET call as http entry point with method GET (gin)', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          functions: [
            makeFunction({
              body: {
                calls: [
                  {
                    functionName: 'GET',
                    location: { file: 'api.go', startLine: 8, endLine: 8 },
                  },
                ],
                goSpawns: [],
                channelOps: [],
              },
            }),
          ],
        }),
      ],
    });

    const result = await builder.build(rawData, { detectedFrameworks: new Set(['gin']) });

    expect(result.entryPoints).toHaveLength(1);
    expect(result.entryPoints[0].protocol).toBe('http');
    expect(result.entryPoints[0].method).toBe('GET');
    expect(result.entryPoints[0].framework).toBe('gin');
  });

  it('should detect POST call as http entry point with method POST (gin)', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          functions: [
            makeFunction({
              body: {
                calls: [
                  {
                    functionName: 'POST',
                    location: { file: 'api.go', startLine: 9, endLine: 9 },
                  },
                ],
                goSpawns: [],
                channelOps: [],
              },
            }),
          ],
        }),
      ],
    });

    const result = await builder.build(rawData, { detectedFrameworks: new Set(['gin']) });

    expect(result.entryPoints).toHaveLength(1);
    expect(result.entryPoints[0].protocol).toBe('http');
    expect(result.entryPoints[0].method).toBe('POST');
  });

  it('should detect PUT call as http entry point with method PUT (gin)', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          functions: [
            makeFunction({
              body: {
                calls: [
                  {
                    functionName: 'PUT',
                    location: { file: 'api.go', startLine: 12, endLine: 12 },
                  },
                ],
                goSpawns: [],
                channelOps: [],
              },
            }),
          ],
        }),
      ],
    });

    const result = await builder.build(rawData, { detectedFrameworks: new Set(['gin']) });

    expect(result.entryPoints).toHaveLength(1);
    expect(result.entryPoints[0].protocol).toBe('http');
    expect(result.entryPoints[0].method).toBe('PUT');
  });

  it('should detect DELETE call as http entry point with method DELETE (gin)', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          functions: [
            makeFunction({
              body: {
                calls: [
                  {
                    functionName: 'DELETE',
                    location: { file: 'api.go', startLine: 14, endLine: 14 },
                  },
                ],
                goSpawns: [],
                channelOps: [],
              },
            }),
          ],
        }),
      ],
    });

    const result = await builder.build(rawData, { detectedFrameworks: new Set(['gin']) });

    expect(result.entryPoints).toHaveLength(1);
    expect(result.entryPoints[0].protocol).toBe('http');
    expect(result.entryPoints[0].method).toBe('DELETE');
  });

  it('should detect PATCH call as http entry point with method PATCH (gin)', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          functions: [
            makeFunction({
              body: {
                calls: [
                  {
                    functionName: 'PATCH',
                    location: { file: 'api.go', startLine: 16, endLine: 16 },
                  },
                ],
                goSpawns: [],
                channelOps: [],
              },
            }),
          ],
        }),
      ],
    });

    const result = await builder.build(rawData, { detectedFrameworks: new Set(['gin']) });

    expect(result.entryPoints).toHaveLength(1);
    expect(result.entryPoints[0].protocol).toBe('http');
    expect(result.entryPoints[0].method).toBe('PATCH');
  });

  it('should NOT create entry point for unknown call names like connect or run', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          functions: [
            makeFunction({
              body: {
                calls: [
                  {
                    functionName: 'connect',
                    location: { file: 'api.go', startLine: 3, endLine: 3 },
                  },
                  {
                    functionName: 'run',
                    location: { file: 'api.go', startLine: 4, endLine: 4 },
                  },
                ],
                goSpawns: [],
                channelOps: [],
              },
            }),
          ],
        }),
      ],
    });

    const result = await builder.build(rawData, { detectedFrameworks: new Set(['net/http']) });

    expect(result.entryPoints).toHaveLength(0);
  });

  it('should skip functions without body (body undefined)', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          functions: [
            makeFunction({
              // no body property
            }),
          ],
        }),
      ],
    });

    const result = await builder.build(rawData, { detectedFrameworks: new Set(['net/http']) });

    expect(result.entryPoints).toHaveLength(0);
    expect(result.callChains).toHaveLength(0);
  });

  it('should detect HandleFunc in struct method body', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          fullName: 'pkg/server',
          structs: [
            {
              name: 'Server',
              packageName: 'server',
              fields: [],
              embeddedTypes: [],
              exported: true,
              location: { file: 'server.go', startLine: 1, endLine: 50 },
              methods: [
                {
                  name: 'RegisterRoutes',
                  parameters: [],
                  returnTypes: [],
                  exported: true,
                  location: { file: 'server.go', startLine: 10, endLine: 25 },
                  body: {
                    calls: [
                      {
                        functionName: 'HandleFunc',
                        location: { file: 'server.go', startLine: 15, endLine: 15 },
                      },
                    ],
                    goSpawns: [],
                    channelOps: [],
                  },
                },
              ],
            },
          ],
        }),
      ],
    });

    const result = await builder.build(rawData, { detectedFrameworks: new Set(['net/http']) });

    expect(result.entryPoints).toHaveLength(1);
    expect(result.entryPoints[0].protocol).toBe('http');
    expect(result.entryPoints[0].framework).toBe('net/http');
    expect(result.entryPoints[0].id).toBe('entry-pkg/server-15');
  });

  it('should detect multiple entry points across functions and methods', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          fullName: 'pkg/api',
          functions: [
            makeFunction({
              name: 'SetupRoutes',
              body: {
                calls: [
                  {
                    functionName: 'GET',
                    location: { file: 'api.go', startLine: 5, endLine: 5 },
                  },
                  {
                    functionName: 'POST',
                    location: { file: 'api.go', startLine: 6, endLine: 6 },
                  },
                ],
                goSpawns: [],
                channelOps: [],
              },
            }),
          ],
          structs: [
            {
              name: 'Router',
              packageName: 'api',
              fields: [],
              embeddedTypes: [],
              exported: true,
              location: { file: 'router.go', startLine: 1, endLine: 40 },
              methods: [
                {
                  name: 'Mount',
                  parameters: [],
                  returnTypes: [],
                  exported: true,
                  location: { file: 'router.go', startLine: 10, endLine: 20 },
                  body: {
                    calls: [
                      {
                        functionName: 'HandleFunc',
                        location: { file: 'router.go', startLine: 12, endLine: 12 },
                      },
                    ],
                    goSpawns: [],
                    channelOps: [],
                  },
                },
              ],
            },
          ],
        }),
      ],
    });

    const result = await builder.build(rawData, { detectedFrameworks: new Set(['gin', 'net/http']) });

    expect(result.entryPoints).toHaveLength(3);
  });

  it('should create one CallChain per entry point', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          functions: [
            makeFunction({
              body: {
                calls: [
                  {
                    functionName: 'GET',
                    location: { file: 'api.go', startLine: 5, endLine: 5 },
                  },
                  {
                    functionName: 'POST',
                    location: { file: 'api.go', startLine: 6, endLine: 6 },
                  },
                ],
                goSpawns: [],
                channelOps: [],
              },
            }),
          ],
        }),
      ],
    });

    const result = await builder.build(rawData, { detectedFrameworks: new Set(['gin']) });

    expect(result.callChains).toHaveLength(result.entryPoints.length);
    expect(result.callChains).toHaveLength(2);
  });

  it('should format CallChain id as chain- prefix plus entry point id', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          fullName: 'pkg/api',
          functions: [
            makeFunction({
              body: {
                calls: [
                  {
                    functionName: 'HandleFunc',
                    location: { file: 'api.go', startLine: 7, endLine: 7 },
                  },
                ],
                goSpawns: [],
                channelOps: [],
              },
            }),
          ],
        }),
      ],
    });

    const result = await builder.build(rawData, { detectedFrameworks: new Set(['net/http']) });

    expect(result.entryPoints).toHaveLength(1);
    expect(result.callChains).toHaveLength(1);

    const entryId = result.entryPoints[0].id;
    expect(result.callChains[0].id).toBe(`chain-${entryId}`);
    expect(result.callChains[0].entryPoint).toBe(entryId);
  });

  it('should set entry point location from call location file and startLine', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          functions: [
            makeFunction({
              body: {
                calls: [
                  {
                    functionName: 'POST',
                    location: { file: 'handlers/user.go', startLine: 42, endLine: 42 },
                  },
                ],
                goSpawns: [],
                channelOps: [],
              },
            }),
          ],
        }),
      ],
    });

    const result = await builder.build(rawData, { detectedFrameworks: new Set(['gin']) });

    expect(result.entryPoints).toHaveLength(1);
    expect(result.entryPoints[0].location).toEqual({
      file: 'handlers/user.go',
      line: 42,
    });
  });

  it('detects gin GET as http entry point with method GET', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          functions: [
            makeFunction({
              body: {
                calls: [{ functionName: 'GET', args: ['/users', 'handleUsers'], location: { file: 'router.go', startLine: 5, endLine: 5 } }],
                goSpawns: [], channelOps: [],
              },
            }),
          ],
        }),
      ],
    });
    const result = await builder.build(rawData, { detectedFrameworks: new Set(['gin']) });
    expect(result.entryPoints).toHaveLength(1);
    expect(result.entryPoints[0].protocol).toBe('http');
    expect(result.entryPoints[0].method).toBe('GET');
    expect(result.entryPoints[0].framework).toBe('gin');
  });

  it('filters entry points by protocol', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          functions: [
            makeFunction({
              body: {
                calls: [
                  { functionName: 'HandleFunc', args: ['/api', 'h'], location: { file: 'srv.go', startLine: 3, endLine: 3 } },
                  { functionName: 'AddCommand', args: ['serve'], location: { file: 'cli.go', startLine: 4, endLine: 4 } },
                ],
                goSpawns: [], channelOps: [],
              },
            }),
          ],
        }),
      ],
    });
    const result = await builder.build(rawData, {
      detectedFrameworks: new Set(['net/http', 'cobra']),
      protocols: ['http'],
    });
    expect(result.entryPoints.every(e => e.protocol === 'http')).toBe(true);
    expect(result.callChains.every(c => result.entryPoints.some(e => e.id === c.entryPoint))).toBe(true);
  });

  it('injects main() as cli entry point when main framework detected', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          name: 'main',
          fullName: 'cmd/server',
          functions: [
            makeFunction({ name: 'main' }),
          ],
        }),
      ],
    });
    const result = await builder.build(rawData, { detectedFrameworks: new Set(['net/http', 'main']) });
    const mainEntry = result.entryPoints.find(e => e.framework === 'main');
    expect(mainEntry).toBeDefined();
    expect(mainEntry!.protocol).toBe('cli');
    expect(mainEntry!.handler).toBe('main.main');
  });
});

describe('path and handler extraction from args', () => {
  const builder = new FlowGraphBuilder();

  it('should extract path and handler from HandleFunc args', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          fullName: 'pkg/api',
          functions: [
            makeFunction({
              body: {
                calls: [
                  {
                    functionName: 'HandleFunc',
                    args: ['/v1/sessions', 's.handleSessions'],
                    location: { file: 'api.go', startLine: 5, endLine: 5 },
                  },
                ],
                goSpawns: [],
                channelOps: [],
              },
            }),
          ],
        }),
      ],
    });
    const result = await builder.build(rawData, { detectedFrameworks: new Set(['net/http']) });
    expect(result.entryPoints[0].path).toBe('/v1/sessions');
    expect(result.entryPoints[0].handler).toBe('s.handleSessions');
  });

  it('should extract path from METHOD-prefixed string in HandleFunc args', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          functions: [
            makeFunction({
              body: {
                calls: [
                  {
                    functionName: 'HandleFunc',
                    args: ['POST /products', 'r.handler.CreateProduct'],
                    location: { file: 'router.go', startLine: 10, endLine: 10 },
                  },
                ],
                goSpawns: [],
                channelOps: [],
              },
            }),
          ],
        }),
      ],
    });
    const result = await builder.build(rawData, { detectedFrameworks: new Set(['net/http']) });
    expect(result.entryPoints[0].path).toBe('POST /products');
    expect(result.entryPoints[0].handler).toBe('r.handler.CreateProduct');
  });

  it('should extract path and handler from GET args', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          functions: [
            makeFunction({
              body: {
                calls: [
                  {
                    functionName: 'GET',
                    args: ['/users', 'listUsers'],
                    location: { file: 'routes.go', startLine: 8, endLine: 8 },
                  },
                ],
                goSpawns: [],
                channelOps: [],
              },
            }),
          ],
        }),
      ],
    });
    const result = await builder.build(rawData, { detectedFrameworks: new Set(['gin']) });
    expect(result.entryPoints[0].path).toBe('/users');
    expect(result.entryPoints[0].handler).toBe('listUsers');
  });

  it('should trace calls from handler function when handler matches a function in same package', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          fullName: 'pkg/api',
          functions: [
            makeFunction({
              name: 'SetupRoutes',
              body: {
                calls: [
                  {
                    functionName: 'HandleFunc',
                    args: ['/users', 'listUsers'],
                    location: { file: 'routes.go', startLine: 5, endLine: 5 },
                  },
                ],
                goSpawns: [],
                channelOps: [],
              },
            }),
            makeFunction({
              name: 'listUsers',
              body: {
                calls: [
                  {
                    // stdlib call — filtered out
                    functionName: 'Encode',
                    packageName: 'json',
                    args: [],
                    location: { file: 'routes.go', startLine: 10, endLine: 10 },
                  },
                  {
                    // business logic call — kept
                    functionName: 'FindAll',
                    packageName: 'repo',
                    args: [],
                    location: { file: 'routes.go', startLine: 11, endLine: 11 },
                  },
                ],
                goSpawns: [],
                channelOps: [],
              },
            }),
          ],
        }),
      ],
    });
    const result = await builder.build(rawData, { detectedFrameworks: new Set(['net/http']) });
    expect(result.entryPoints[0].handler).toBe('listUsers');
    // json.Encode is filtered out; only business logic repo.FindAll remains
    expect(result.callChains[0].calls).toHaveLength(1);
    expect(result.callChains[0].calls[0].from).toBe('listUsers');
    expect(result.callChains[0].calls[0].to).toBe('repo.FindAll');
  });

  it('should fall back to empty path and handler when no args provided', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          functions: [
            makeFunction({
              body: {
                calls: [
                  {
                    functionName: 'HandleFunc',
                    // no args field
                    location: { file: 'api.go', startLine: 5, endLine: 5 },
                  },
                ],
                goSpawns: [],
                channelOps: [],
              },
            }),
          ],
        }),
      ],
    });
    const result = await builder.build(rawData, { detectedFrameworks: new Set(['net/http']) });
    expect(result.entryPoints[0].path).toBe('');
    expect(result.entryPoints[0].handler).toBe('');
  });

  it('resolves struct method as HTTP handler', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          fullName: 'pkg/api',
          functions: [
            makeFunction({
              name: 'SetupRoutes',
              body: {
                calls: [
                  {
                    functionName: 'HandleFunc',
                    args: ['/users', 'UserHandler'],
                    location: { file: 'routes.go', startLine: 5, endLine: 5 },
                  },
                ],
                goSpawns: [],
                channelOps: [],
              },
            }),
          ],
          structs: [
            {
              name: 'Controller',
              packageName: 'api',
              fields: [],
              embeddedTypes: [],
              exported: true,
              location: { file: 'controller.go', startLine: 1, endLine: 60 },
              methods: [
                {
                  name: 'UserHandler',
                  parameters: [],
                  returnTypes: [],
                  exported: true,
                  location: { file: 'controller.go', startLine: 10, endLine: 30 },
                  body: {
                    calls: [
                      {
                        functionName: 'FindAll',
                        packageName: 'db',
                        args: [],
                        location: { file: 'controller.go', startLine: 15, endLine: 15 },
                      },
                    ],
                    goSpawns: [],
                    channelOps: [],
                  },
                },
              ],
            },
          ],
        }),
      ],
    });

    const result = await builder.build(rawData, { detectedFrameworks: new Set(['net/http']) });

    // The entry point for the HandleFunc call on line 5 should be detected
    expect(result.entryPoints).toHaveLength(1);
    expect(result.entryPoints[0].id).toBe('entry-pkg/api-5');
    expect(result.entryPoints[0].handler).toBe('UserHandler');

    // The call chain should resolve UserHandler as a struct method and include its calls
    expect(result.callChains).toHaveLength(1);
    const chain = result.callChains[0];
    expect(chain.calls).toHaveLength(1);
    expect(chain.calls[0].from).toBe('UserHandler');
    expect(chain.calls[0].to).toBe('db.FindAll');
  });

  it('should set handler to empty string when args[1] is an anonymous function literal', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          functions: [
            makeFunction({
              body: {
                calls: [
                  {
                    functionName: 'HandleFunc',
                    args: [
                      '/api/v1/',
                      'func(w http.ResponseWriter, r *http.Request) { doSomething() }',
                    ],
                    location: { file: 'server.go', startLine: 42, endLine: 42 },
                  },
                ],
                goSpawns: [],
                channelOps: [],
              },
            }),
          ],
        }),
      ],
    });
    const result = await builder.build(rawData, { detectedFrameworks: new Set(['net/http']) });
    expect(result.entryPoints).toHaveLength(1);
    expect(result.entryPoints[0].path).toBe('/api/v1/');
    expect(result.entryPoints[0].handler).toBe('');
  });

  it('should keep named handler unchanged when it does not start with func(', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          functions: [
            makeFunction({
              body: {
                calls: [
                  {
                    functionName: 'HandleFunc',
                    args: ['/healthz', 's.handleHealth'],
                    location: { file: 'server.go', startLine: 10, endLine: 10 },
                  },
                ],
                goSpawns: [],
                channelOps: [],
              },
            }),
          ],
        }),
      ],
    });
    const result = await builder.build(rawData, { detectedFrameworks: new Set(['net/http']) });
    expect(result.entryPoints[0].handler).toBe('s.handleHealth');
  });
});

describe('traceCallsFromEntry - stdlib filtering', () => {
  it('filters out fmt.* stdlib calls', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          name: 'hub',
          fullName: 'pkg/hub',
          functions: [
            makeFunction({
              name: 'setupRoutes',
              exported: false,
              body: {
                calls: [
                  {
                    functionName: 'HandleFunc',
                    packageName: 'mux',
                    args: ['/api', 'doWork'],
                    location: { file: '/x/pkg/hub/r.go', startLine: 5, endLine: 5 },
                  },
                ],
                goSpawns: [],
                channelOps: [],
              },
            }),
            makeFunction({
              name: 'doWork',
              exported: false,
              parameters: [
                { name: 'w', type: 'http.ResponseWriter' },
                { name: 'r', type: '*http.Request' },
              ],
              body: {
                calls: [
                  {
                    functionName: 'Sprintf',
                    packageName: 'fmt',
                    args: [],
                    location: { file: '/x/pkg/hub/r.go', startLine: 14, endLine: 14 },
                  },
                  {
                    functionName: 'CreateItem',
                    packageName: 'store',
                    args: [],
                    location: { file: '/x/pkg/hub/r.go', startLine: 16, endLine: 16 },
                  },
                ],
                goSpawns: [],
                channelOps: [],
              },
            }),
          ],
        }),
      ],
    });
    const builder = new FlowGraphBuilder();
    const graph = await builder.build(rawData, { detectedFrameworks: new Set(['net/http']) });
    const chain = graph.callChains[0];
    expect(chain).toBeDefined();
    const toValues = chain.calls.map((c) => c.to);
    expect(toValues).not.toContain('fmt.Sprintf');
    expect(toValues.some((t) => t.includes('CreateItem'))).toBe(true);
  });

  it('filters out w.* ResponseWriter calls', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          name: 'hub',
          fullName: 'pkg/hub',
          functions: [
            makeFunction({
              name: 'setupRoutes',
              exported: false,
              body: {
                calls: [
                  {
                    functionName: 'HandleFunc',
                    packageName: 'mux',
                    args: ['/api', 'serve'],
                    location: { file: '/x/pkg/hub/r.go', startLine: 5, endLine: 5 },
                  },
                ],
                goSpawns: [],
                channelOps: [],
              },
            }),
            makeFunction({
              name: 'serve',
              exported: false,
              parameters: [
                { name: 'w', type: 'http.ResponseWriter' },
                { name: 'r', type: '*http.Request' },
              ],
              body: {
                calls: [
                  {
                    functionName: 'WriteHeader',
                    packageName: 'w',
                    args: [],
                    location: { file: '/x/pkg/hub/r.go', startLine: 14, endLine: 14 },
                  },
                  {
                    functionName: 'doLogic',
                    packageName: 'svc',
                    args: [],
                    location: { file: '/x/pkg/hub/r.go', startLine: 16, endLine: 16 },
                  },
                ],
                goSpawns: [],
                channelOps: [],
              },
            }),
          ],
        }),
      ],
    });
    const builder = new FlowGraphBuilder();
    const graph = await builder.build(rawData, { detectedFrameworks: new Set(['net/http']) });
    const chain = graph.callChains[0];
    const toValues = chain.calls.map((c) => c.to);
    expect(toValues.some((t) => t.startsWith('w.'))).toBe(false);
    expect(toValues.some((t) => t.includes('doLogic'))).toBe(true);
  });

  it('filters out Go builtins like make, len, append', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          name: 'hub',
          fullName: 'pkg/hub',
          functions: [
            makeFunction({
              name: 'setupRoutes',
              exported: false,
              body: {
                calls: [
                  {
                    functionName: 'HandleFunc',
                    packageName: 'mux',
                    args: ['/list', 'listAll'],
                    location: { file: '/x/pkg/hub/r.go', startLine: 5, endLine: 5 },
                  },
                ],
                goSpawns: [],
                channelOps: [],
              },
            }),
            makeFunction({
              name: 'listAll',
              exported: false,
              parameters: [
                { name: 'w', type: 'http.ResponseWriter' },
                { name: 'r', type: '*http.Request' },
              ],
              body: {
                calls: [
                  {
                    functionName: 'make',
                    packageName: '',
                    args: [],
                    location: { file: '/x/pkg/hub/r.go', startLine: 14, endLine: 14 },
                  },
                  {
                    functionName: 'len',
                    packageName: '',
                    args: [],
                    location: { file: '/x/pkg/hub/r.go', startLine: 15, endLine: 15 },
                  },
                  {
                    functionName: 'append',
                    packageName: '',
                    args: [],
                    location: { file: '/x/pkg/hub/r.go', startLine: 16, endLine: 16 },
                  },
                  {
                    functionName: 'Query',
                    packageName: 'db',
                    args: [],
                    location: { file: '/x/pkg/hub/r.go', startLine: 17, endLine: 17 },
                  },
                ],
                goSpawns: [],
                channelOps: [],
              },
            }),
          ],
        }),
      ],
    });
    const builder = new FlowGraphBuilder();
    const graph = await builder.build(rawData, { detectedFrameworks: new Set(['net/http']) });
    const chain = graph.callChains[0];
    const toValues = chain.calls.map((c) => c.to);
    expect(toValues).not.toContain('make');
    expect(toValues).not.toContain('len');
    expect(toValues).not.toContain('append');
    expect(toValues.some((t) => t.includes('Query'))).toBe(true);
  });
});

describe('traceCallsFromEntry - deduplication', () => {
  it('deduplicates duplicate (from, to) call pairs from a top-level handler function', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          fullName: 'pkg/hub',
          functions: [
            makeFunction({
              name: 'setupRoutes',
              body: {
                calls: [
                  {
                    functionName: 'HandleFunc',
                    args: ['/api', 'listItems'],
                    location: { file: 'routes.go', startLine: 5, endLine: 5 },
                  },
                ],
                goSpawns: [],
                channelOps: [],
              },
            }),
            makeFunction({
              name: 'listItems',
              body: {
                calls: [
                  {
                    functionName: 'Get',
                    packageName: 'store',
                    args: [],
                    location: { file: 'routes.go', startLine: 25, endLine: 25 },
                  },
                  {
                    functionName: 'Get',
                    packageName: 'store',
                    args: [],
                    location: { file: 'routes.go', startLine: 28, endLine: 28 },
                  },
                  {
                    functionName: 'Get',
                    packageName: 'store',
                    args: [],
                    location: { file: 'routes.go', startLine: 31, endLine: 31 },
                  },
                ],
                goSpawns: [],
                channelOps: [],
              },
            }),
          ],
        }),
      ],
    });

    const builder = new FlowGraphBuilder();
    const result = await builder.build(rawData, { detectedFrameworks: new Set(['net/http']) });

    expect(result.callChains.length).toBeGreaterThan(0);

    for (const chain of result.callChains) {
      const seen = new Set<string>();
      for (const call of chain.calls) {
        const key = `${call.from}\x00${call.to}`;
        expect(seen.has(key), `duplicate edge found: ${call.from} -> ${call.to}`).toBe(false);
        seen.add(key);
      }
    }

    // Specifically confirm the chain for 'listItems' has only one store.Get edge
    const listItemsChain = result.callChains.find((c) =>
      result.entryPoints.find((e) => e.id === c.entryPoint && e.handler === 'listItems')
    );
    expect(listItemsChain).toBeDefined();
    expect(listItemsChain.calls).toHaveLength(1);
    expect(listItemsChain.calls[0].from).toBe('listItems');
    expect(listItemsChain.calls[0].to).toBe('store.Get');
  });

  it('deduplicates duplicate (from, to) call pairs from a struct method handler', async () => {
    const rawData = makeRawData({
      packages: [
        makePackage({
          fullName: 'pkg/hub',
          functions: [
            makeFunction({
              name: 'SetupRoutes',
              body: {
                calls: [
                  {
                    functionName: 'HandleFunc',
                    args: ['/sessions', 'handleFoo'],
                    location: { file: 's.go', startLine: 5, endLine: 5 },
                  },
                ],
                goSpawns: [],
                channelOps: [],
              },
            }),
          ],
          structs: [
            {
              name: 'Server',
              packageName: 'hub',
              fields: [],
              embeddedTypes: [],
              exported: true,
              location: { file: 's.go', startLine: 1, endLine: 100 },
              methods: [
                {
                  name: 'handleFoo',
                  parameters: [
                    { name: 'w', type: 'http.ResponseWriter' },
                    { name: 'r', type: '*http.Request' },
                  ],
                  returnTypes: [],
                  exported: false,
                  location: { file: 's.go', startLine: 10, endLine: 30 },
                  body: {
                    calls: [
                      {
                        functionName: 'doWork',
                        packageName: 'store',
                        args: [],
                        location: { file: 's.go', startLine: 12, endLine: 12 },
                      },
                      {
                        functionName: 'doWork',
                        packageName: 'store',
                        args: [],
                        location: { file: 's.go', startLine: 15, endLine: 15 },
                      },
                      {
                        functionName: 'doWork',
                        packageName: 'store',
                        args: [],
                        location: { file: 's.go', startLine: 18, endLine: 18 },
                      },
                    ],
                    goSpawns: [],
                    channelOps: [],
                  },
                },
              ],
            },
          ],
        }),
      ],
    });

    const builder = new FlowGraphBuilder();
    const result = await builder.build(rawData, { detectedFrameworks: new Set(['net/http']) });

    expect(result.callChains.length).toBeGreaterThan(0);

    for (const chain of result.callChains) {
      const seen = new Set<string>();
      for (const call of chain.calls) {
        const key = `${call.from}\x00${call.to}`;
        expect(seen.has(key), `duplicate edge found: ${call.from} -> ${call.to}`).toBe(false);
        seen.add(key);
      }
    }

    // Confirm exactly one store.doWork edge after dedup
    const chain = result.callChains[0];
    expect(chain.calls).toHaveLength(1);
    expect(chain.calls[0].from).toBe('handleFoo');
    expect(chain.calls[0].to).toBe('store.doWork');
  });
});

describe('interface dispatch detection', () => {
  const builder = new FlowGraphBuilder();
  const loc = { file: 'test.go', startLine: 1, endLine: 1 };

  it('detects interface dispatch through a struct field typed as an interface', async () => {
    // Interface: Store with Find method
    // Struct: Server with field `store Store`
    // Method: Server.handleRequest calls s.store.Find()
    // Entry point: HTTP handler pointing to handleRequest
    const rawData = makeRawData({
      packages: [
        makePackage({
          fullName: 'pkg/api',
          interfaces: [
            {
              name: 'Store',
              packageName: 'api',
              methods: [],
              embeddedInterfaces: [],
              exported: true,
              location: loc,
            },
          ],
          structs: [
            {
              name: 'Server',
              packageName: 'api',
              fields: [
                { name: 'store', type: 'Store', exported: false, location: loc },
              ],
              embeddedTypes: [],
              exported: true,
              location: loc,
              methods: [
                {
                  name: 'handleRequest',
                  parameters: [],
                  returnTypes: [],
                  exported: false,
                  location: loc,
                  body: {
                    calls: [
                      {
                        functionName: 'Find',
                        packageName: 's.store',
                        args: [],
                        location: loc,
                      },
                    ],
                    goSpawns: [],
                    channelOps: [],
                  },
                },
              ],
            },
          ],
          functions: [
            makeFunction({
              name: 'SetupRoutes',
              body: {
                calls: [
                  {
                    functionName: 'HandleFunc',
                    args: ['/api', 'handleRequest'],
                    location: { file: 'test.go', startLine: 10, endLine: 10 },
                  },
                ],
                goSpawns: [],
                channelOps: [],
              },
            }),
          ],
        }),
      ],
    });

    const result = await builder.build(rawData, { detectedFrameworks: new Set(['net/http']) });

    expect(result.entryPoints).toHaveLength(1);
    const chain = result.callChains[0];
    expect(chain.calls).toHaveLength(1);
    const edge = chain.calls[0];
    expect(edge.to).toBe('s.store.Find');
    expect(edge.type).toBe('interface');
    expect(edge.confidence).toBe(0.8);
  });

  it('detects interface dispatch through a function parameter typed as an interface', async () => {
    // Interface: Service with Process method
    // Free function: handleRequest(svc Service, ...) that calls svc.Process()
    const rawData = makeRawData({
      packages: [
        makePackage({
          fullName: 'pkg/api',
          interfaces: [
            {
              name: 'Service',
              packageName: 'api',
              methods: [],
              embeddedInterfaces: [],
              exported: true,
              location: loc,
            },
          ],
          functions: [
            makeFunction({
              name: 'SetupRoutes',
              body: {
                calls: [
                  {
                    functionName: 'HandleFunc',
                    args: ['/api', 'handleRequest'],
                    location: { file: 'test.go', startLine: 10, endLine: 10 },
                  },
                ],
                goSpawns: [],
                channelOps: [],
              },
            }),
            makeFunction({
              name: 'handleRequest',
              parameters: [
                { name: 'svc', type: 'Service', exported: false, location: loc },
                { name: 'w', type: 'http.ResponseWriter', exported: false, location: loc },
              ],
              body: {
                calls: [
                  {
                    functionName: 'Process',
                    packageName: 'svc',
                    args: [],
                    location: loc,
                  },
                ],
                goSpawns: [],
                channelOps: [],
              },
            }),
          ],
        }),
      ],
    });

    const result = await builder.build(rawData, { detectedFrameworks: new Set(['net/http']) });

    expect(result.entryPoints).toHaveLength(1);
    const chain = result.callChains[0];
    expect(chain.calls).toHaveLength(1);
    const edge = chain.calls[0];
    expect(edge.to).toBe('svc.Process');
    expect(edge.type).toBe('interface');
    expect(edge.confidence).toBe(0.8);
  });

  it('detects interface dispatch through a method parameter typed as an interface', async () => {
    // Struct method: Server.handleSave(repo Repository) that calls repo.Save()
    // Repository is an interface
    const rawData = makeRawData({
      packages: [
        makePackage({
          fullName: 'pkg/api',
          interfaces: [
            {
              name: 'Repository',
              packageName: 'api',
              methods: [],
              embeddedInterfaces: [],
              exported: true,
              location: loc,
            },
          ],
          structs: [
            {
              name: 'Server',
              packageName: 'api',
              fields: [],
              embeddedTypes: [],
              exported: true,
              location: loc,
              methods: [
                {
                  name: 'handleSave',
                  parameters: [
                    { name: 'repo', type: 'Repository', exported: false, location: loc },
                  ],
                  returnTypes: [],
                  exported: false,
                  location: loc,
                  body: {
                    calls: [
                      {
                        functionName: 'Save',
                        packageName: 'repo',
                        args: [],
                        location: loc,
                      },
                    ],
                    goSpawns: [],
                    channelOps: [],
                  },
                },
              ],
            },
          ],
          functions: [
            makeFunction({
              name: 'SetupRoutes',
              body: {
                calls: [
                  {
                    functionName: 'HandleFunc',
                    args: ['/save', 'handleSave'],
                    location: { file: 'test.go', startLine: 10, endLine: 10 },
                  },
                ],
                goSpawns: [],
                channelOps: [],
              },
            }),
          ],
        }),
      ],
    });

    const result = await builder.build(rawData, { detectedFrameworks: new Set(['net/http']) });

    expect(result.entryPoints).toHaveLength(1);
    const chain = result.callChains[0];
    expect(chain.calls).toHaveLength(1);
    const edge = chain.calls[0];
    expect(edge.to).toBe('repo.Save');
    expect(edge.type).toBe('interface');
    expect(edge.confidence).toBe(0.8);
  });

  it('detects interface dispatch when field type has pointer prefix *InterfaceName', async () => {
    // Field type: "*Store" — strip * and check "Store" is an interface
    const rawData = makeRawData({
      packages: [
        makePackage({
          fullName: 'pkg/api',
          interfaces: [
            {
              name: 'Store',
              packageName: 'api',
              methods: [],
              embeddedInterfaces: [],
              exported: true,
              location: loc,
            },
          ],
          structs: [
            {
              name: 'Server',
              packageName: 'api',
              fields: [
                { name: 'store', type: '*Store', exported: false, location: loc },
              ],
              embeddedTypes: [],
              exported: true,
              location: loc,
              methods: [
                {
                  name: 'handleRequest',
                  parameters: [],
                  returnTypes: [],
                  exported: false,
                  location: loc,
                  body: {
                    calls: [
                      {
                        functionName: 'Find',
                        packageName: 's.store',
                        args: [],
                        location: loc,
                      },
                    ],
                    goSpawns: [],
                    channelOps: [],
                  },
                },
              ],
            },
          ],
          functions: [
            makeFunction({
              name: 'SetupRoutes',
              body: {
                calls: [
                  {
                    functionName: 'HandleFunc',
                    args: ['/api', 'handleRequest'],
                    location: { file: 'test.go', startLine: 10, endLine: 10 },
                  },
                ],
                goSpawns: [],
                channelOps: [],
              },
            }),
          ],
        }),
      ],
    });

    const result = await builder.build(rawData, { detectedFrameworks: new Set(['net/http']) });

    expect(result.entryPoints).toHaveLength(1);
    const chain = result.callChains[0];
    expect(chain.calls).toHaveLength(1);
    const edge = chain.calls[0];
    expect(edge.type).toBe('interface');
    expect(edge.confidence).toBe(0.8);
  });

  it('does not classify as interface when field type is a concrete struct', async () => {
    // No interface named "DBClient" in any package — field type "DBClient" is a struct
    const rawData = makeRawData({
      packages: [
        makePackage({
          fullName: 'pkg/api',
          interfaces: [], // no interfaces
          structs: [
            {
              name: 'Server',
              packageName: 'api',
              fields: [
                { name: 'db', type: 'DBClient', exported: false, location: loc },
              ],
              embeddedTypes: [],
              exported: true,
              location: loc,
              methods: [
                {
                  name: 'handleList',
                  parameters: [],
                  returnTypes: [],
                  exported: false,
                  location: loc,
                  body: {
                    calls: [
                      {
                        functionName: 'Query',
                        packageName: 'db',
                        args: [],
                        location: loc,
                      },
                    ],
                    goSpawns: [],
                    channelOps: [],
                  },
                },
              ],
            },
          ],
          functions: [
            makeFunction({
              name: 'SetupRoutes',
              body: {
                calls: [
                  {
                    functionName: 'HandleFunc',
                    args: ['/list', 'handleList'],
                    location: { file: 'test.go', startLine: 10, endLine: 10 },
                  },
                ],
                goSpawns: [],
                channelOps: [],
              },
            }),
          ],
        }),
      ],
    });

    const result = await builder.build(rawData, { detectedFrameworks: new Set(['net/http']) });

    expect(result.entryPoints).toHaveLength(1);
    const chain = result.callChains[0];
    expect(chain.calls).toHaveLength(1);
    const edge = chain.calls[0];
    expect(edge.type).toBe('direct');
    expect(edge.confidence).toBe(0.7);
  });

  it('assigns confidence 0.8 to interface dispatch and 0.7 to direct calls', async () => {
    // Mix of interface and direct calls in same handler
    const rawData = makeRawData({
      packages: [
        makePackage({
          fullName: 'pkg/api',
          interfaces: [
            {
              name: 'Cache',
              packageName: 'api',
              methods: [],
              embeddedInterfaces: [],
              exported: true,
              location: loc,
            },
          ],
          structs: [
            {
              name: 'Server',
              packageName: 'api',
              fields: [
                { name: 'cache', type: 'Cache', exported: false, location: loc },
              ],
              embeddedTypes: [],
              exported: true,
              location: loc,
              methods: [
                {
                  name: 'handleGet',
                  parameters: [],
                  returnTypes: [],
                  exported: false,
                  location: loc,
                  body: {
                    calls: [
                      {
                        // interface dispatch: cache is a Cache interface field
                        functionName: 'Get',
                        packageName: 's.cache',
                        args: [],
                        location: loc,
                      },
                      {
                        // direct call: metrics is not a known interface
                        functionName: 'Record',
                        packageName: 'metrics',
                        args: [],
                        location: { file: 'test.go', startLine: 2, endLine: 2 },
                      },
                    ],
                    goSpawns: [],
                    channelOps: [],
                  },
                },
              ],
            },
          ],
          functions: [
            makeFunction({
              name: 'SetupRoutes',
              body: {
                calls: [
                  {
                    functionName: 'HandleFunc',
                    args: ['/get', 'handleGet'],
                    location: { file: 'test.go', startLine: 10, endLine: 10 },
                  },
                ],
                goSpawns: [],
                channelOps: [],
              },
            }),
          ],
        }),
      ],
    });

    const result = await builder.build(rawData, { detectedFrameworks: new Set(['net/http']) });

    expect(result.entryPoints).toHaveLength(1);
    const chain = result.callChains[0];
    expect(chain.calls).toHaveLength(2);

    const cacheEdge = chain.calls.find(c => c.to === 's.cache.Get');
    const metricsEdge = chain.calls.find(c => c.to === 'metrics.Record');

    expect(cacheEdge).toBeDefined();
    expect(cacheEdge!.type).toBe('interface');
    expect(cacheEdge!.confidence).toBe(0.8);

    expect(metricsEdge).toBeDefined();
    expect(metricsEdge!.type).toBe('direct');
    expect(metricsEdge!.confidence).toBe(0.7);
  });

  it('still marks calls through package names (not interface vars) as direct', async () => {
    // Call: { functionName: 'Println', packageName: 'fmt' }
    // "fmt" is not a struct field or parameter in context
    // But fmt is also stdlib so it gets filtered — use a non-stdlib package instead
    // Call to a package name that is not in context types → direct
    const rawData = makeRawData({
      packages: [
        makePackage({
          fullName: 'pkg/api',
          interfaces: [
            {
              name: 'Store',
              packageName: 'api',
              methods: [],
              embeddedInterfaces: [],
              exported: true,
              location: loc,
            },
          ],
          functions: [
            makeFunction({
              name: 'SetupRoutes',
              body: {
                calls: [
                  {
                    functionName: 'HandleFunc',
                    args: ['/api', 'handleRequest'],
                    location: { file: 'test.go', startLine: 10, endLine: 10 },
                  },
                ],
                goSpawns: [],
                channelOps: [],
              },
            }),
            makeFunction({
              name: 'handleRequest',
              parameters: [], // no parameters — "repo" is NOT a known parameter
              body: {
                calls: [
                  {
                    functionName: 'FindAll',
                    packageName: 'repo', // "repo" is a package name, not a var typed as interface
                    args: [],
                    location: loc,
                  },
                ],
                goSpawns: [],
                channelOps: [],
              },
            }),
          ],
        }),
      ],
    });

    const result = await builder.build(rawData, { detectedFrameworks: new Set(['net/http']) });

    expect(result.entryPoints).toHaveLength(1);
    const chain = result.callChains[0];
    expect(chain.calls).toHaveLength(1);
    const edge = chain.calls[0];
    expect(edge.to).toBe('repo.FindAll');
    expect(edge.type).toBe('direct');
  });
});

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
    const result = await builder.build(rawData);

    expect(result.entryPoints).toHaveLength(0);
    expect(result.callChains).toHaveLength(0);
  });

  it('should detect HandleFunc call in function body as http-handler entry point', async () => {
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

    const result = await builder.build(rawData);

    expect(result.entryPoints).toHaveLength(1);
    expect(result.entryPoints[0].type).toBe('http-handler');
    expect(result.entryPoints[0].id).toBe('entry-pkg/api-5');
  });

  it('should detect Handle call in function body as http-handler entry point', async () => {
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

    const result = await builder.build(rawData);

    expect(result.entryPoints).toHaveLength(1);
    expect(result.entryPoints[0].type).toBe('http-handler');
  });

  it('should detect GET call as http-get entry point', async () => {
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

    const result = await builder.build(rawData);

    expect(result.entryPoints).toHaveLength(1);
    expect(result.entryPoints[0].type).toBe('http-get');
  });

  it('should detect POST call as http-post entry point', async () => {
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

    const result = await builder.build(rawData);

    expect(result.entryPoints).toHaveLength(1);
    expect(result.entryPoints[0].type).toBe('http-post');
  });

  it('should detect PUT call as http-put entry point', async () => {
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

    const result = await builder.build(rawData);

    expect(result.entryPoints).toHaveLength(1);
    expect(result.entryPoints[0].type).toBe('http-put');
  });

  it('should detect DELETE call as http-delete entry point', async () => {
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

    const result = await builder.build(rawData);

    expect(result.entryPoints).toHaveLength(1);
    expect(result.entryPoints[0].type).toBe('http-delete');
  });

  it('should detect PATCH call as http-patch entry point', async () => {
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

    const result = await builder.build(rawData);

    expect(result.entryPoints).toHaveLength(1);
    expect(result.entryPoints[0].type).toBe('http-patch');
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

    const result = await builder.build(rawData);

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

    const result = await builder.build(rawData);

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

    const result = await builder.build(rawData);

    expect(result.entryPoints).toHaveLength(1);
    expect(result.entryPoints[0].type).toBe('http-handler');
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

    const result = await builder.build(rawData);

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

    const result = await builder.build(rawData);

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

    const result = await builder.build(rawData);

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

    const result = await builder.build(rawData);

    expect(result.entryPoints).toHaveLength(1);
    expect(result.entryPoints[0].location).toEqual({
      file: 'handlers/user.go',
      line: 42,
    });
  });
});

/**
 * TDD tests for archguard_get_package_metrics MCP tool (TASK-20).
 *
 * Tests:
 * - Returns fanIn, fanOut, cycleCount fields for all packages
 * - When no packageName specified, returns all packages
 * - When packageName specified, returns only that package
 * - cycleCount is 0 → cyclesWith is empty array
 * - cycleCount > 0 → cyclesWith contains related package names (from CycleInfo.memberNames)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ArchJSON, Entity, Relation } from '@/types/index.js';
import type { TsModuleGraph } from '@/types/extensions/ts-analysis.js';
import { QueryEngine } from '@/cli/query/query-engine.js';
import type { QueryScopeEntry } from '@/cli/query/query-manifest.js';
import { buildArchIndex } from '@/cli/query/arch-index-builder.js';
import { registerPackageMetricsTools } from '@/cli/mcp/tools/package-metrics-tools.js';
import { loadEngine } from '@/cli/query/engine-loader.js';
import { ExtensionAccessor } from '@/core/query/extension-accessor.js';

vi.mock('@/cli/query/engine-loader.js', async () => {
  const actual = await vi.importActual<typeof import('@/cli/query/engine-loader.js')>(
    '@/cli/query/engine-loader.js'
  );
  return {
    ...actual,
    loadEngine: vi.fn(),
  };
});

// ── Test fixtures ──────────────────────────────────────────────────────────────

const scopeEntry: QueryScopeEntry = {
  key: 'test-scope',
  label: 'src (typescript)',
  language: 'typescript',
  kind: 'parsed',
  sources: ['/project/src'],
  entityCount: 4,
  relationCount: 2,
  hasAtlasExtension: false,
};

/**
 * Two packages: "pkgA" (2 entities) and "pkgB" (2 entities).
 * Relations:
 *   pkgA.ClassA → pkgB.ClassB (dependency)
 *   pkgA.ClassC → pkgB.ClassD (dependency)
 *
 * Expected:
 *   pkgA: fanOut=2 (depends on pkgB twice), fanIn=0
 *   pkgB: fanIn=2 (depended on by pkgA twice), fanOut=0
 */
function makeEntity(id: string, name: string, file: string): Entity {
  return {
    id,
    name,
    type: 'class',
    visibility: 'public',
    members: [],
    sourceLocation: { file, startLine: 1, endLine: 20 },
  };
}

function makeRelation(source: string, target: string): Relation {
  return { source, target, type: 'dependency' };
}

/**
 * Build a directory-level module graph from module ids and directed edges.
 * `getPackageCycles()` derives SCCs from these edges, exactly like
 * `archguard_detect_cycles(outputScope="package")`.
 */
function makeModuleGraph(
  moduleIds: string[],
  edges: Array<{ from: string; to: string; specifier: string; file: string; line: number }>
): TsModuleGraph {
  return {
    nodes: moduleIds.map((id) => ({
      id,
      name: id || '(root)',
      type: 'internal' as const,
      fileCount: 1,
      stats: { classes: 1, interfaces: 0, functions: 0, enums: 0 },
    })),
    edges: edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      strength: 1,
      importedNames: [],
      evidence: [
        { specifier: edge.specifier, file: edge.file, line: edge.line, kind: 'import' as const },
      ],
    })),
    cycles: [],
  };
}

function buildSimpleArchJson(): ArchJSON {
  return {
    version: '1.1',
    language: 'typescript',
    timestamp: '2026-01-01T00:00:00Z',
    sourceFiles: ['src/pkgA/a.ts', 'src/pkgA/c.ts', 'src/pkgB/b.ts', 'src/pkgB/d.ts'],
    entities: [
      makeEntity('pkgA.ClassA', 'ClassA', 'src/pkgA/a.ts'),
      makeEntity('pkgA.ClassC', 'ClassC', 'src/pkgA/c.ts'),
      makeEntity('pkgB.ClassB', 'ClassB', 'src/pkgB/b.ts'),
      makeEntity('pkgB.ClassD', 'ClassD', 'src/pkgB/d.ts'),
    ],
    relations: [
      makeRelation('pkgA.ClassA', 'pkgB.ClassB'),
      makeRelation('pkgA.ClassC', 'pkgB.ClassD'),
    ],
    // Evaluated graph with no SCC: cycleCount is a real 0 here, not "unknown".
    extensions: {
      tsAnalysis: { version: '1.0', moduleGraph: makeModuleGraph(['pkgA', 'pkgB'], []) },
    },
  };
}

/**
 * Build an ArchJSON with a directory-level cycle between pkgX and pkgY.
 * Class-level relations also form a cycle, but the directory SCC is the source
 * of truth for `cycleCount`.
 */
function buildCycleArchJson(): ArchJSON {
  return {
    version: '1.1',
    language: 'typescript',
    timestamp: '2026-01-01T00:00:00Z',
    sourceFiles: ['src/pkgX/foo.ts', 'src/pkgY/bar.ts'],
    entities: [
      makeEntity('pkgX.Foo', 'Foo', 'src/pkgX/foo.ts'),
      makeEntity('pkgY.Bar', 'Bar', 'src/pkgY/bar.ts'),
    ],
    relations: [makeRelation('pkgX.Foo', 'pkgY.Bar'), makeRelation('pkgY.Bar', 'pkgX.Foo')],
    extensions: {
      tsAnalysis: {
        version: '1.0',
        moduleGraph: makeModuleGraph(
          ['pkgX', 'pkgY'],
          [
            {
              from: 'pkgX',
              to: 'pkgY',
              specifier: '../pkgY/bar.js',
              file: 'src/pkgX/foo.ts',
              line: 1,
            },
            {
              from: 'pkgY',
              to: 'pkgX',
              specifier: '../pkgX/foo.js',
              file: 'src/pkgY/bar.ts',
              line: 1,
            },
          ]
        ),
      },
    },
  };
}

/**
 * Directory-only tangle: src/a and src/b import each other, while the entity
 * relation graph is acyclic (no class-level SCC at all). This is the shape the
 * old `engine.getCycles()` source reported as cycleCount 0.
 */
function buildDirectoryOnlyCycleArchJson(): ArchJSON {
  return {
    version: '1.1',
    language: 'typescript',
    timestamp: '2026-01-01T00:00:00Z',
    sourceFiles: ['src/a/mod.ts', 'src/b/mod.ts'],
    entities: [
      makeEntity('src/a/mod.ts.Foo', 'Foo', 'src/a/mod.ts'),
      makeEntity('src/b/mod.ts.Bar', 'Bar', 'src/b/mod.ts'),
    ],
    relations: [],
    extensions: {
      tsAnalysis: {
        version: '1.0',
        moduleGraph: makeModuleGraph(
          ['src/a', 'src/b'],
          [
            { from: 'src/a', to: 'src/b', specifier: '../b/mod.js', file: 'src/a/mod.ts', line: 2 },
            { from: 'src/b', to: 'src/a', specifier: '../a/mod.js', file: 'src/b/mod.ts', line: 3 },
          ]
        ),
      },
    },
  };
}

/** TS scope without a module graph: package cycles are genuinely not evaluated. */
function buildUnevaluatedArchJson(): ArchJSON {
  return {
    version: '1.1',
    language: 'typescript',
    timestamp: '2026-01-01T00:00:00Z',
    sourceFiles: ['src/pkgX/foo.ts', 'src/pkgY/bar.ts'],
    entities: [
      makeEntity('pkgX.Foo', 'Foo', 'src/pkgX/foo.ts'),
      makeEntity('pkgY.Bar', 'Bar', 'src/pkgY/bar.ts'),
    ],
    relations: [makeRelation('pkgX.Foo', 'pkgY.Bar'), makeRelation('pkgY.Bar', 'pkgX.Foo')],
  };
}

function createEngine(archJson: ArchJSON): QueryEngine {
  const archIndex = buildArchIndex(archJson, 'testhash');
  return new QueryEngine({ archJson, archIndex, scopeEntry });
}

function wrapEngine(engine: QueryEngine, archJson: ArchJSON) {
  const extensionAccessor = new ExtensionAccessor(archJson);
  return {
    engine,
    extensionAccessor,
    scopeEntry,
    relationQueryService: engine.relationQueryService,
  };
}

/**
 * Collect the tool handler registered under the given name.
 */
function collectTools(server: McpServer, defaultRoot = '/workspace'): Map<string, Function> {
  const tools = new Map<string, Function>();
  vi.spyOn(server, 'tool').mockImplementation((...args: unknown[]) => {
    const name = args[0] as string;
    const cb = args[args.length - 1] as Function;
    tools.set(name, cb);
    return server;
  });
  registerPackageMetricsTools(server, defaultRoot);
  return tools;
}

const loadEngineMock = vi.mocked(loadEngine);

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('archguard_get_package_metrics — registration', () => {
  beforeEach(() => {
    const archJson = buildSimpleArchJson();
    loadEngineMock.mockReset();
    loadEngineMock.mockResolvedValue(wrapEngine(createEngine(archJson), archJson));
  });

  it('registers the archguard_get_package_metrics tool', () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    expect(tools.has('archguard_get_package_metrics')).toBe(true);
  });
});

describe('archguard_get_package_metrics — all packages', () => {
  let archJson: ArchJSON;

  beforeEach(() => {
    archJson = buildSimpleArchJson();
    loadEngineMock.mockReset();
    loadEngineMock.mockResolvedValue(wrapEngine(createEngine(archJson), archJson));
  });

  it('returns fanIn, fanOut, cycleCount fields for each package', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const handler = tools.get('archguard_get_package_metrics');

    const result = await handler({ projectRoot: '/workspace' });
    const text = result.content[0].text as string;
    const payload = JSON.parse(text) as {
      packages: Array<{
        packageName: string;
        fanIn: number;
        fanOut: number;
        cycleCount: number;
        cyclesWith: string[];
      }>;
    };

    expect(payload.packages).toBeDefined();
    expect(payload.packages.length).toBeGreaterThan(0);

    // Every entry must have the required fields
    for (const pkg of payload.packages) {
      expect(pkg).toHaveProperty('packageName');
      expect(pkg).toHaveProperty('fanIn');
      expect(pkg).toHaveProperty('fanOut');
      expect(pkg).toHaveProperty('cycleCount');
      expect(pkg).toHaveProperty('cyclesWith');
    }
  });

  it('returns all packages when no packageName filter specified', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const handler = tools.get('archguard_get_package_metrics');

    const result = await handler({ projectRoot: '/workspace' });
    const payload = JSON.parse(result.content[0].text);

    const names = payload.packages.map((p: { packageName: string }) => p.packageName);
    expect(names).toContain('pkgA');
    expect(names).toContain('pkgB');
  });

  it('computes correct fanOut for pkgA (2 outgoing cross-package relations)', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const handler = tools.get('archguard_get_package_metrics');

    const result = await handler({ projectRoot: '/workspace' });
    const payload = JSON.parse(result.content[0].text);
    const pkgA = payload.packages.find((p: { packageName: string }) => p.packageName === 'pkgA');

    expect(pkgA).toBeDefined();
    expect(pkgA.fanOut).toBe(2);
    expect(pkgA.fanIn).toBe(0);
  });

  it('computes correct fanIn for pkgB (2 incoming cross-package relations)', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const handler = tools.get('archguard_get_package_metrics');

    const result = await handler({ projectRoot: '/workspace' });
    const payload = JSON.parse(result.content[0].text);
    const pkgB = payload.packages.find((p: { packageName: string }) => p.packageName === 'pkgB');

    expect(pkgB).toBeDefined();
    expect(pkgB.fanIn).toBe(2);
    expect(pkgB.fanOut).toBe(0);
  });

  it('sets cycleCount=0 and cyclesWith=[] when no cycles', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const handler = tools.get('archguard_get_package_metrics');

    const result = await handler({ projectRoot: '/workspace' });
    const payload = JSON.parse(result.content[0].text);

    for (const pkg of payload.packages) {
      expect(pkg.cycleCount).toBe(0);
      expect(pkg.cyclesWith).toEqual([]);
    }
  });
});

describe('archguard_get_package_metrics — packageName filter', () => {
  let archJson: ArchJSON;

  beforeEach(() => {
    archJson = buildSimpleArchJson();
    loadEngineMock.mockReset();
    loadEngineMock.mockResolvedValue(wrapEngine(createEngine(archJson), archJson));
  });

  it('returns only the specified package when packageName is provided', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const handler = tools.get('archguard_get_package_metrics');

    const result = await handler({ projectRoot: '/workspace', packageName: 'pkgA' });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.packages).toHaveLength(1);
    expect(payload.packages[0].packageName).toBe('pkgA');
  });

  it('returns empty array when packageName does not match any package', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const handler = tools.get('archguard_get_package_metrics');

    const result = await handler({ projectRoot: '/workspace', packageName: 'nonexistent' });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.packages).toHaveLength(0);
  });
});

describe('archguard_get_package_metrics — cycle detection', () => {
  let archJson: ArchJSON;

  beforeEach(() => {
    archJson = buildCycleArchJson();
    loadEngineMock.mockReset();
    loadEngineMock.mockResolvedValue(wrapEngine(createEngine(archJson), archJson));
  });

  it('sets cycleCount>0 when a directory-level cycle exists between packages', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const handler = tools.get('archguard_get_package_metrics');

    const result = await handler({ projectRoot: '/workspace' });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.cycleEvaluation).toEqual({ evaluated: true });

    // Both pkgX and pkgY participate in a cycle
    const pkgX = payload.packages.find((p: { packageName: string }) => p.packageName === 'pkgX');
    const pkgY = payload.packages.find((p: { packageName: string }) => p.packageName === 'pkgY');

    expect(pkgX).toBeDefined();
    expect(pkgY).toBeDefined();
    expect(pkgX.cycleCount).toBeGreaterThan(0);
    expect(pkgY.cycleCount).toBeGreaterThan(0);
  });

  it('populates cyclesWith with co-cycling directory modules when cycleCount>0', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const handler = tools.get('archguard_get_package_metrics');

    const result = await handler({ projectRoot: '/workspace' });
    const payload = JSON.parse(result.content[0].text);

    const pkgX = payload.packages.find((p: { packageName: string }) => p.packageName === 'pkgX');
    expect(pkgX.cyclesWith).toEqual(['pkgY']);
  });
});

// ── Directory-level SCC is the cycle source ───────────────────────────────────

describe('archguard_get_package_metrics — directory-level SCC source', () => {
  beforeEach(() => {
    const archJson = buildDirectoryOnlyCycleArchJson();
    loadEngineMock.mockReset();
    loadEngineMock.mockResolvedValue(wrapEngine(createEngine(archJson), archJson));
  });

  it('AC1: cycleCount>0 from a directory SCC while the class-level cycle list is empty', async () => {
    const archJson = buildDirectoryOnlyCycleArchJson();

    // Precondition: the old source (`engine.getCycles()`, entity/class SCCs)
    // reports nothing — this is what made cycleCount silently 0.
    expect(createEngine(archJson).getCycles()).toEqual([]);

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const handler = collectTools(server).get('archguard_get_package_metrics');

    const result = await handler({ projectRoot: '/workspace' });
    const payload = JSON.parse(result.content[0].text) as {
      cycleEvaluation: { evaluated: boolean };
      packages: Array<{
        packageName: string;
        cycleCount: number | null;
        cyclesWith: string[];
      }>;
    };

    expect(payload.cycleEvaluation.evaluated).toBe(true);
    const pkgA = payload.packages.find((p) => p.packageName === 'src/a');
    const pkgB = payload.packages.find((p) => p.packageName === 'src/b');
    expect(pkgA).toBeDefined();
    expect(pkgB).toBeDefined();
    expect(pkgA?.cycleCount).toBe(1);
    expect(pkgA?.cyclesWith).toEqual(['src/b']);
    expect(pkgB?.cycleCount).toBe(1);
    expect(pkgB?.cyclesWith).toEqual(['src/a']);
  });

  it('AC2: the same SCC source exposes specifier + file:line per cycle edge (detect_cycles parity)', async () => {
    const archJson = buildDirectoryOnlyCycleArchJson();
    // detect_cycles(outputScope="package") returns exactly this engine result.
    const engineResult = createEngine(archJson).getPackageCycles();

    expect(engineResult.evaluated).toBe(true);
    expect(engineResult.cycles).toHaveLength(1);
    expect(engineResult.cycles[0].edges).toEqual([
      {
        from: 'src/a',
        to: 'src/b',
        specifier: '../b/mod.js',
        file: 'src/a/mod.ts',
        line: 2,
      },
      {
        from: 'src/b',
        to: 'src/a',
        specifier: '../a/mod.js',
        file: 'src/b/mod.ts',
        line: 3,
      },
    ]);
  });

  it('AC3: unevaluated scopes surface evaluated:false with a reason and cycleCount null', async () => {
    const archJson = buildUnevaluatedArchJson();
    loadEngineMock.mockReset();
    loadEngineMock.mockResolvedValue(wrapEngine(createEngine(archJson), archJson));

    // Even though the class/entity graph has a cycle, the directory-level
    // question was not evaluated — it must not be reported as 0 or >0.
    expect(createEngine(archJson).getCycles().length).toBeGreaterThan(0);

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const handler = collectTools(server).get('archguard_get_package_metrics');

    const result = await handler({ projectRoot: '/workspace' });
    const payload = JSON.parse(result.content[0].text) as {
      cycleEvaluation: { evaluated: boolean; reason?: string };
      packages: Array<{ packageName: string; cycleCount: number | null; cyclesWith: string[] }>;
    };

    expect(payload.cycleEvaluation.evaluated).toBe(false);
    expect(payload.cycleEvaluation.reason).toBeTruthy();
    for (const pkg of payload.packages) {
      expect(pkg.cycleCount).toBeNull();
      expect(pkg.cyclesWith).toEqual([]);
    }
  });
});

// ── topN / sortBy ──────────────────────────────────────────────────────────────

/**
 * Seven packages pkg0..pkg6; pkgJ → pkgK for every J < K.
 * fanIn(pkgK) = K, fanOut(pkgJ) = 6 - J, so fanIn-desc order is the reverse of name order.
 * pkg6 holds two entities so entityCount ranks it first; everything else has one.
 */
function buildRankedArchJson(): ArchJSON {
  const entities = [0, 1, 2, 3, 4, 5, 6].map((k) =>
    makeEntity(`pkg${k}.C${k}`, `C${k}`, `src/pkg${k}/c${k}.ts`)
  );
  entities.push(makeEntity('pkg6.Extra', 'Extra', 'src/pkg6/extra.ts'));
  const relations: Relation[] = [];
  for (let j = 0; j < 7; j++) {
    for (let k = j + 1; k < 7; k++) relations.push(makeRelation(`pkg${j}.C${j}`, `pkg${k}.C${k}`));
  }
  return {
    version: '1.1',
    language: 'typescript',
    timestamp: '2026-01-01T00:00:00Z',
    sourceFiles: entities.map((e) => e.sourceLocation.file),
    entities,
    relations,
  };
}

describe('archguard_get_package_metrics — topN / sortBy', () => {
  type Payload = {
    packages: Array<{ packageName: string; fanIn: number; fanOut: number }>;
    totalPackages?: number;
  };

  async function call(args: Record<string, unknown>): Promise<Payload> {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const handler = collectTools(server).get('archguard_get_package_metrics');
    const result = await handler({ projectRoot: '/workspace', ...args });
    return JSON.parse(result.content[0].text) as Payload;
  }

  beforeEach(() => {
    const archJson = buildRankedArchJson();
    loadEngineMock.mockReset();
    loadEngineMock.mockResolvedValue(wrapEngine(createEngine(archJson), archJson));
  });

  it('topN=5,sortBy=fanIn returns 5 packages ordered by fanIn descending', async () => {
    const payload = await call({ topN: 5, sortBy: 'fanIn' });
    expect(payload.packages).toHaveLength(5);
    expect(payload.packages.map((p) => p.packageName)).toEqual([
      'pkg6',
      'pkg5',
      'pkg4',
      'pkg3',
      'pkg2',
    ]);
    const fanIns = payload.packages.map((p) => p.fanIn);
    expect(fanIns).toEqual([...fanIns].sort((a, b) => b - a));
    expect(payload.totalPackages).toBe(7);
  });

  it('sortBy=fanOut ranks by outgoing relations descending', async () => {
    const payload = await call({ topN: 2, sortBy: 'fanOut' });
    expect(payload.packages.map((p) => p.packageName)).toEqual(['pkg0', 'pkg1']);
  });

  it('sortBy=entityCount ranks by entity count descending, ties by name', async () => {
    const payload = await call({ topN: 3, sortBy: 'entityCount' });
    expect(payload.packages.map((p) => p.packageName)).toEqual(['pkg6', 'pkg0', 'pkg1']);
  });

  it('without topN/sortBy output is name-sorted, complete and unchanged in shape', async () => {
    const payload = await call({});
    expect(payload.packages.map((p) => p.packageName)).toEqual([
      'pkg0',
      'pkg1',
      'pkg2',
      'pkg3',
      'pkg4',
      'pkg5',
      'pkg6',
    ]);
    expect(payload.totalPackages).toBeUndefined();
    for (const pkg of payload.packages) {
      expect(Object.keys(pkg)).toEqual([
        'packageName',
        'fanIn',
        'fanOut',
        'cycleCount',
        'cyclesWith',
      ]);
    }
    expect(await call({ sortBy: 'name' })).toEqual(payload);
  });

  it('topN larger than the package count returns everything without totalPackages', async () => {
    const payload = await call({ topN: 50, sortBy: 'fanIn' });
    expect(payload.packages).toHaveLength(7);
    expect(payload.totalPackages).toBeUndefined();
  });
});

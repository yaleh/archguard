/**
 * Phase 117-120 TDD tests for Atlas Package Analytics MCP tools.
 *
 * Tests:
 * - computePackageFanMetrics: pure function, no MCP
 * - enrichPackageNodes: pure function, no MCP
 * - archguard_get_package_fanin: MCP tool
 * - archguard_get_package_fanout: MCP tool
 * - archguard_detect_god_packages: MCP tool
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ArchJSON, Entity, Relation } from '@/types/index.js';
import { QueryEngine } from '@/cli/query/query-engine.js';
import type { QueryScopeEntry } from '@/cli/query/query-manifest.js';
import type { ArchJSONExtensions } from '@/types/extensions/index.js';
import type { PackageGraph, PackageNode } from '@/types/extensions/go-atlas.js';
import { buildArchIndex } from '@/cli/query/arch-index-builder.js';
import {
  computePackageFanMetrics,
  enrichPackageNodes,
  registerAtlasAnalyticsTools,
} from '@/cli/mcp/tools/atlas-analytics-tools.js';
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

const goAtlasScopeEntry: QueryScopeEntry = {
  key: 'gotest-atlas',
  label: 'src (go)',
  language: 'go',
  kind: 'parsed',
  sources: ['/project/src'],
  entityCount: 0,
  relationCount: 0,
  hasAtlasExtension: true,
};

/**
 * 3 nodes, 4 edges:
 *   A→B (strength 2)
 *   A→C (strength 1)
 *   B→C (strength 3)
 *   C→A (strength 1)
 *
 * Expected fan metrics:
 *   fanIn:  A=1, B=1, C=2
 *   fanOut: A=2, B=1, C=1
 */
const NODE_A: PackageNode = {
  id: 'pkg/a',
  name: 'a',
  type: 'internal',
  fileCount: 5,
  stats: { structs: 3, interfaces: 1, functions: 10 },
};
const NODE_B: PackageNode = {
  id: 'pkg/b',
  name: 'b',
  type: 'internal',
  fileCount: 2,
  stats: { structs: 1, interfaces: 0, functions: 4 },
};
const NODE_C: PackageNode = {
  id: 'pkg/c',
  name: 'c',
  type: 'internal',
  fileCount: 8,
  stats: { structs: 5, interfaces: 2, functions: 20 },
};

const PACKAGE_GRAPH: PackageGraph = {
  nodes: [NODE_A, NODE_B, NODE_C],
  edges: [
    { source: 'pkg/a', target: 'pkg/b', strength: 2 },
    { source: 'pkg/a', target: 'pkg/c', strength: 1 },
    { source: 'pkg/b', target: 'pkg/c', strength: 3 },
    { source: 'pkg/c', target: 'pkg/a', strength: 1 },
  ],
  cycles: [],
};

function makeAtlasArchJson(graph: PackageGraph = PACKAGE_GRAPH): ArchJSON {
  const extensions: ArchJSONExtensions = {
    goAtlas: {
      version: '2.0',
      layers: { package: graph },
      metadata: {
        generatedAt: '2026-01-01T00:00:00Z',
        generationStrategy: {
          functionBodyStrategy: 'none',
          detectedFrameworks: [],
          followIndirectCalls: false,
          goplsEnabled: false,
        },
        completeness: { package: 1.0, capability: 0, goroutine: 0, flow: 0 },
        performance: { fileCount: 15, parseTime: 100, totalTime: 200, memoryUsage: 1024 },
      },
    },
  };
  return {
    version: '1.1',
    language: 'go',
    timestamp: '2026-01-01T00:00:00Z',
    sourceFiles: [],
    entities: [],
    relations: [],
    extensions,
  };
}

function makeAtlasEngine(graph: PackageGraph = PACKAGE_GRAPH): {
  engine: QueryEngine;
  archJson: ArchJSON;
} {
  const archJson = makeAtlasArchJson(graph);
  const archIndex = buildArchIndex(archJson, 'atlas-hash');
  const engine = new QueryEngine({ archJson, archIndex, scopeEntry: goAtlasScopeEntry });
  return { engine, archJson };
}

function makeNoAtlasEngine(language = 'typescript'): {
  engine: QueryEngine;
  archJson: ArchJSON;
  scopeEntry: QueryScopeEntry;
} {
  const archJson: ArchJSON = {
    version: '1.1',
    language,
    timestamp: '2026-01-01T00:00:00Z',
    sourceFiles: [],
    entities: [],
    relations: [],
  };
  const scopeEntry: QueryScopeEntry = {
    key: `${language}-scope`,
    label: `src (${language})`,
    language,
    kind: 'parsed',
    sources: ['/project/src'],
    entityCount: 0,
    relationCount: 0,
    hasAtlasExtension: false,
  };
  const archIndex = buildArchIndex(archJson, `${language}-hash`);
  const engine = new QueryEngine({ archJson, archIndex, scopeEntry });
  return { engine, archJson, scopeEntry };
}

// ── TypeScript god-package fixture ──────────────────────────────────────────
//
// Directory-level packages, matching what StructureMetrics' TS path reports:
//   modules/mcp-gateway → 41 files, 1 entity, 25 outgoing cross-package relations
//   modules/core        →  5 files, 1 entity
//
// Entity IDs are `<dir>/<file>.ts.<Entity>` so extractPackageName yields the
// same directory the module graph uses.
const tsGodScopeEntry: QueryScopeEntry = {
  key: 'ts-god',
  label: 'src (typescript)',
  language: 'typescript',
  kind: 'parsed',
  sources: ['/project/src'],
  entityCount: 0,
  relationCount: 0,
  hasAtlasExtension: false,
};

function makeTsGodArchJson(gatewayFanOutRelations = 25): ArchJSON {
  const entities: Entity[] = [
    {
      id: 'modules/mcp-gateway/gateway.ts.Gateway',
      name: 'Gateway',
      type: 'class',
      visibility: 'public',
      members: [],
      sourceLocation: { file: 'modules/mcp-gateway/gateway.ts', startLine: 1, endLine: 10 },
    },
    {
      id: 'modules/core/core.ts.Core',
      name: 'Core',
      type: 'class',
      visibility: 'public',
      members: [],
      sourceLocation: { file: 'modules/core/core.ts', startLine: 1, endLine: 10 },
    },
  ];

  const relations: Relation[] = [];
  for (let i = 0; i < gatewayFanOutRelations; i++) {
    relations.push({
      id: `rel-${i}`,
      type: 'dependency',
      source: 'modules/mcp-gateway/gateway.ts.Gateway',
      target: 'modules/core/core.ts.Core',
    });
  }

  return {
    version: '1.1',
    language: 'typescript',
    timestamp: '2026-01-01T00:00:00Z',
    sourceFiles: ['modules/mcp-gateway/gateway.ts', 'modules/core/core.ts'],
    entities,
    relations,
    extensions: {
      tsAnalysis: {
        version: '1.0',
        moduleGraph: {
          nodes: [
            {
              id: 'modules/mcp-gateway',
              name: 'modules/mcp-gateway',
              type: 'internal',
              fileCount: 41,
              stats: { classes: 1, interfaces: 0, functions: 0, enums: 0 },
            },
            {
              id: 'modules/core',
              name: 'modules/core',
              type: 'internal',
              fileCount: 5,
              stats: { classes: 1, interfaces: 0, functions: 0, enums: 0 },
            },
          ],
          edges: [],
          cycles: [],
        },
      },
    },
  };
}

function makeTsGodEngine(gatewayFanOutRelations = 25): {
  engine: QueryEngine;
  archJson: ArchJSON;
} {
  const archJson = makeTsGodArchJson(gatewayFanOutRelations);
  const archIndex = buildArchIndex(archJson, 'ts-god-hash');
  const engine = new QueryEngine({ archJson, archIndex, scopeEntry: tsGodScopeEntry });
  return { engine, archJson };
}

function wrapEngine({ engine, archJson }: { engine: QueryEngine; archJson: ArchJSON }) {
  return {
    engine,
    extensionAccessor: new ExtensionAccessor(archJson),
    scopeEntry: goAtlasScopeEntry,
  };
}

// Reusable collectTools helper that accepts a register function
function collectTools(
  server: McpServer,
  defaultRoot: string,
  registerFn: (server: McpServer, root: string) => void
): Map<string, Function> {
  const tools = new Map<string, Function>();
  const originalTool = server.tool.bind(server);

  vi.spyOn(server, 'tool').mockImplementation((...args: unknown[]) => {
    const name = args[0] as string;
    const cb = args[args.length - 1] as Function;
    tools.set(name, cb);
    return (originalTool as Function)(...args);
  });

  registerFn(server, defaultRoot);
  return tools;
}

const loadEngineMock = vi.mocked(loadEngine);

beforeEach(() => {
  loadEngineMock.mockReset();
  loadEngineMock.mockResolvedValue(wrapEngine(makeAtlasEngine()));
});

// ── Phase 117: Pure utility functions ─────────────────────────────────────────

describe('computePackageFanMetrics', () => {
  it('returns empty maps for graph with no edges', () => {
    const graph: PackageGraph = { nodes: [NODE_A], edges: [], cycles: [] };
    const { fanIn, fanOut } = computePackageFanMetrics(graph);
    expect(fanIn.size).toBe(0);
    expect(fanOut.size).toBe(0);
  });

  it('counts incoming edges as fanIn per target node', () => {
    const { fanIn } = computePackageFanMetrics(PACKAGE_GRAPH);
    // B receives from A → fanIn=1
    expect(fanIn.get('pkg/b')).toBe(1);
    // C receives from A and B → fanIn=2
    expect(fanIn.get('pkg/c')).toBe(2);
    // A receives from C → fanIn=1
    expect(fanIn.get('pkg/a')).toBe(1);
  });

  it('counts outgoing edges as fanOut per source node', () => {
    const { fanOut } = computePackageFanMetrics(PACKAGE_GRAPH);
    // A sends to B and C → fanOut=2
    expect(fanOut.get('pkg/a')).toBe(2);
    // B sends to C → fanOut=1
    expect(fanOut.get('pkg/b')).toBe(1);
    // C sends to A → fanOut=1
    expect(fanOut.get('pkg/c')).toBe(1);
  });

  it('handles a node that is both source and target', () => {
    const { fanIn, fanOut } = computePackageFanMetrics(PACKAGE_GRAPH);
    // A is both a source (A→B, A→C) and target (C→A)
    expect(fanIn.get('pkg/a')).toBe(1);
    expect(fanOut.get('pkg/a')).toBe(2);
  });

  it('ignores nodes with no edges — fanIn=0 fanOut=0 (checked via enrichPackageNodes)', () => {
    const isolated: PackageNode = { id: 'pkg/z', name: 'z', type: 'external', fileCount: 1 };
    const graph: PackageGraph = {
      nodes: [NODE_A, isolated],
      edges: [{ source: 'pkg/a', target: 'pkg/b', strength: 1 }],
      cycles: [],
    };
    const { fanIn, fanOut } = computePackageFanMetrics(graph);
    const enriched = enrichPackageNodes([isolated], fanIn, fanOut);
    expect(enriched[0].fanIn).toBe(0);
    expect(enriched[0].fanOut).toBe(0);
  });
});

describe('enrichPackageNodes', () => {
  it('enriches each node with fanIn and fanOut from maps', () => {
    const { fanIn, fanOut } = computePackageFanMetrics(PACKAGE_GRAPH);
    const enriched = enrichPackageNodes([NODE_B], fanIn, fanOut);
    expect(enriched[0].fanIn).toBe(1);
    expect(enriched[0].fanOut).toBe(1);
  });

  it('defaults to 0 for nodes not present in either map', () => {
    const emptyFanIn = new Map<string, number>();
    const emptyFanOut = new Map<string, number>();
    const enriched = enrichPackageNodes([NODE_A, NODE_B], emptyFanIn, emptyFanOut);
    expect(enriched[0].fanIn).toBe(0);
    expect(enriched[0].fanOut).toBe(0);
    expect(enriched[1].fanIn).toBe(0);
    expect(enriched[1].fanOut).toBe(0);
  });

  it('preserves original node fields (id, name, type, fileCount, stats)', () => {
    const { fanIn, fanOut } = computePackageFanMetrics(PACKAGE_GRAPH);
    const enriched = enrichPackageNodes([NODE_A], fanIn, fanOut);
    const n = enriched[0];
    expect(n.id).toBe(NODE_A.id);
    expect(n.name).toBe(NODE_A.name);
    expect(n.type).toBe(NODE_A.type);
    expect(n.fileCount).toBe(NODE_A.fileCount);
    expect(n.stats).toEqual(NODE_A.stats);
  });
});

// ── Phase 118: fanin and fanout tools ─────────────────────────────────────────

describe('archguard_get_package_fanin — tool schema', () => {
  it('registers archguard_get_package_fanin tool', () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, '/workspace', registerAtlasAnalyticsTools);
    expect(tools.has('archguard_get_package_fanin')).toBe(true);
  });

  it('registers archguard_get_package_fanout tool', () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, '/workspace', registerAtlasAnalyticsTools);
    expect(tools.has('archguard_get_package_fanout')).toBe(true);
  });
});

describe('archguard_get_package_fanin — handler', () => {
  it('returns No Atlas data message when hasAtlasExtension returns false', async () => {
    loadEngineMock.mockResolvedValueOnce(wrapEngine(makeNoAtlasEngine()));
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, '/workspace', registerAtlasAnalyticsTools);
    const cb = tools.get('archguard_get_package_fanin');
    const result = await cb({});
    expect(result.content[0].text).toMatch(/No Atlas data/i);
  });

  it('returns No package data message when packageGraph has no nodes', async () => {
    const emptyGraph: PackageGraph = { nodes: [], edges: [], cycles: [] };
    loadEngineMock.mockResolvedValueOnce(wrapEngine(makeAtlasEngine(emptyGraph)));
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, '/workspace', registerAtlasAnalyticsTools);
    const cb = tools.get('archguard_get_package_fanin');
    const result = await cb({});
    expect(result.content[0].text).toMatch(/No package data/i);
  });

  it('returns packages sorted descending by fanIn', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, '/workspace', registerAtlasAnalyticsTools);
    const cb = tools.get('archguard_get_package_fanin');
    const result = await cb({});
    const parsed = JSON.parse(result.content[0].text);
    const fanIns = parsed.packages.map((p: { fanIn: number }) => p.fanIn);
    for (let i = 1; i < fanIns.length; i++) {
      expect(fanIns[i]).toBeLessThanOrEqual(fanIns[i - 1]);
    }
  });

  it('applies minFanIn filter before sorting', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, '/workspace', registerAtlasAnalyticsTools);
    const cb = tools.get('archguard_get_package_fanin');
    // minFanIn=2 should keep only node C (fanIn=2)
    const result = await cb({ minFanIn: 2 });
    const parsed = JSON.parse(result.content[0].text);
    for (const pkg of parsed.packages) {
      expect(pkg.fanIn).toBeGreaterThanOrEqual(2);
    }
  });

  it('limits results to requested limit (default 20)', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, '/workspace', registerAtlasAnalyticsTools);
    const cb = tools.get('archguard_get_package_fanin');
    const result = await cb({ limit: 1 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.packages.length).toBeLessThanOrEqual(1);
  });

  it('response includes fanIn and fanOut fields in each entry', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, '/workspace', registerAtlasAnalyticsTools);
    const cb = tools.get('archguard_get_package_fanin');
    const result = await cb({});
    const parsed = JSON.parse(result.content[0].text);
    for (const pkg of parsed.packages) {
      expect(pkg).toHaveProperty('fanIn');
      expect(pkg).toHaveProperty('fanOut');
    }
  });

  it('response includes id, name, type, fileCount in each entry', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, '/workspace', registerAtlasAnalyticsTools);
    const cb = tools.get('archguard_get_package_fanin');
    const result = await cb({});
    const parsed = JSON.parse(result.content[0].text);
    for (const pkg of parsed.packages) {
      expect(pkg).toHaveProperty('id');
      expect(pkg).toHaveProperty('name');
      expect(pkg).toHaveProperty('type');
      expect(pkg).toHaveProperty('fileCount');
    }
  });

  it('stats field included when node carries stats', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, '/workspace', registerAtlasAnalyticsTools);
    const cb = tools.get('archguard_get_package_fanin');
    const result = await cb({});
    const parsed = JSON.parse(result.content[0].text);
    // NODE_A, B, C all have stats
    const withStats = parsed.packages.filter((p: { stats?: unknown }) => p.stats !== undefined);
    expect(withStats.length).toBeGreaterThan(0);
  });
});

describe('archguard_get_package_fanout — handler', () => {
  it('returns packages sorted descending by fanOut', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, '/workspace', registerAtlasAnalyticsTools);
    const cb = tools.get('archguard_get_package_fanout');
    const result = await cb({});
    const parsed = JSON.parse(result.content[0].text);
    const fanOuts = parsed.packages.map((p: { fanOut: number }) => p.fanOut);
    for (let i = 1; i < fanOuts.length; i++) {
      expect(fanOuts[i]).toBeLessThanOrEqual(fanOuts[i - 1]);
    }
  });

  it('applies minFanOut filter before sorting', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, '/workspace', registerAtlasAnalyticsTools);
    const cb = tools.get('archguard_get_package_fanout');
    // minFanOut=2 should keep only node A (fanOut=2)
    const result = await cb({ minFanOut: 2 });
    const parsed = JSON.parse(result.content[0].text);
    for (const pkg of parsed.packages) {
      expect(pkg.fanOut).toBeGreaterThanOrEqual(2);
    }
  });

  it('response includes both fanIn and fanOut for cross-reference', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, '/workspace', registerAtlasAnalyticsTools);
    const cb = tools.get('archguard_get_package_fanout');
    const result = await cb({});
    const parsed = JSON.parse(result.content[0].text);
    for (const pkg of parsed.packages) {
      expect(pkg).toHaveProperty('fanIn');
      expect(pkg).toHaveProperty('fanOut');
    }
  });
});

// ── Phase 119: god packages tool ──────────────────────────────────────────────

describe('archguard_detect_god_packages — tool schema', () => {
  it('registers archguard_detect_god_packages tool', () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, '/workspace', registerAtlasAnalyticsTools);
    expect(tools.has('archguard_detect_god_packages')).toBe(true);
  });
});

describe('archguard_detect_god_packages — handler', () => {
  it('returns applicable:false when the scope is neither Atlas nor TypeScript', async () => {
    const { engine, archJson, scopeEntry } = makeNoAtlasEngine('python');
    loadEngineMock.mockResolvedValueOnce({
      engine,
      extensionAccessor: new ExtensionAccessor(archJson),
      scopeEntry,
    } as unknown as Awaited<ReturnType<typeof loadEngine>>);
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, '/workspace', registerAtlasAnalyticsTools);
    const cb = tools.get('archguard_detect_god_packages');
    const result = await cb({});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.applicable).toBe(false);
    expect(parsed.reason).toMatch(/No Atlas data/i);
    expect(parsed.alternative).toContain('archguard_get_package_metrics');
    expect(parsed.alternative).toContain('archguard_get_package_stats');
  });

  it('returns No package data message when packageGraph has no nodes', async () => {
    const emptyGraph: PackageGraph = { nodes: [], edges: [], cycles: [] };
    loadEngineMock.mockResolvedValueOnce(wrapEngine(makeAtlasEngine(emptyGraph)));
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, '/workspace', registerAtlasAnalyticsTools);
    const cb = tools.get('archguard_detect_god_packages');
    const result = await cb({});
    expect(result.content[0].text).toMatch(/No package data/i);
  });

  it('returns godPackages: [] when no packages exceed any threshold', async () => {
    // Use defaults: minFanIn=5, minStructs=20, minFunctions=50, minFiles=20
    // Our fixture nodes: fanIn max=2, structs max=5, functions max=20, files max=8 — all well below
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, '/workspace', registerAtlasAnalyticsTools);
    const cb = tools.get('archguard_detect_god_packages');
    const result = await cb({});
    const parsed = JSON.parse(result.content[0].text);
    expect(Array.isArray(parsed.godPackages)).toBe(true);
    expect(parsed.godPackages).toHaveLength(0);
  });

  it('flags package exceeding minFanIn threshold', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, '/workspace', registerAtlasAnalyticsTools);
    const cb = tools.get('archguard_detect_god_packages');
    // minFanIn=2 → node C (fanIn=2) gets flagged
    const result = await cb({ minFanIn: 2 });
    const parsed = JSON.parse(result.content[0].text);
    const flagged = parsed.godPackages.find((p: { id: string }) => p.id === 'pkg/c');
    expect(flagged).toBeDefined();
    expect(flagged.reasons).toContain('highFanIn');
  });

  it('flags package exceeding minStructs threshold', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, '/workspace', registerAtlasAnalyticsTools);
    const cb = tools.get('archguard_detect_god_packages');
    // minStructs=4 → node C (structs=5) gets flagged
    const result = await cb({ minStructs: 4 });
    const parsed = JSON.parse(result.content[0].text);
    const flagged = parsed.godPackages.find((p: { id: string }) => p.id === 'pkg/c');
    expect(flagged).toBeDefined();
    expect(flagged.reasons).toContain('tooManyStructs');
  });

  it('flags package exceeding minFunctions threshold', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, '/workspace', registerAtlasAnalyticsTools);
    const cb = tools.get('archguard_detect_god_packages');
    // minFunctions=15 → node C (functions=20) gets flagged
    const result = await cb({ minFunctions: 15 });
    const parsed = JSON.parse(result.content[0].text);
    const flagged = parsed.godPackages.find((p: { id: string }) => p.id === 'pkg/c');
    expect(flagged).toBeDefined();
    expect(flagged.reasons).toContain('tooManyFunctions');
  });

  it('flags package exceeding minFiles threshold', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, '/workspace', registerAtlasAnalyticsTools);
    const cb = tools.get('archguard_detect_god_packages');
    // minFiles=7 → node C (fileCount=8) gets flagged
    const result = await cb({ minFiles: 7 });
    const parsed = JSON.parse(result.content[0].text);
    const flagged = parsed.godPackages.find((p: { id: string }) => p.id === 'pkg/c');
    expect(flagged).toBeDefined();
    expect(flagged.reasons).toContain('tooManyFiles');
  });

  it('flags package with multiple threshold violations; reasons lists all', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, '/workspace', registerAtlasAnalyticsTools);
    const cb = tools.get('archguard_detect_god_packages');
    // Node C: fanIn=2, structs=5, functions=20, fileCount=8
    // Set all thresholds low enough to catch C
    const result = await cb({ minFanIn: 2, minStructs: 4, minFunctions: 15, minFiles: 7 });
    const parsed = JSON.parse(result.content[0].text);
    const flagged = parsed.godPackages.find((p: { id: string }) => p.id === 'pkg/c');
    expect(flagged).toBeDefined();
    expect(flagged.reasons).toContain('highFanIn');
    expect(flagged.reasons).toContain('tooManyStructs');
    expect(flagged.reasons).toContain('tooManyFunctions');
    expect(flagged.reasons).toContain('tooManyFiles');
    expect(flagged.reasons.length).toBe(4);
  });

  it('does not flag package with stats=undefined for struct/function thresholds', async () => {
    const nodeNoStats: PackageNode = {
      id: 'pkg/no-stats',
      name: 'no-stats',
      type: 'internal',
      fileCount: 10,
    };
    const graph: PackageGraph = {
      nodes: [nodeNoStats],
      edges: [],
      cycles: [],
    };
    loadEngineMock.mockResolvedValueOnce(wrapEngine(makeAtlasEngine(graph)));
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, '/workspace', registerAtlasAnalyticsTools);
    const cb = tools.get('archguard_detect_god_packages');
    // minStructs=1, minFunctions=1 — would flag if stats present; stats=undefined → no flag for structs/functions
    const result = await cb({ minStructs: 1, minFunctions: 1 });
    const parsed = JSON.parse(result.content[0].text);
    const flagged = parsed.godPackages.find((p: { id: string }) => p.id === 'pkg/no-stats');
    if (flagged) {
      expect(flagged.reasons).not.toContain('tooManyStructs');
      expect(flagged.reasons).not.toContain('tooManyFunctions');
    }
  });

  it('applies custom threshold overrides from params', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, '/workspace', registerAtlasAnalyticsTools);
    const cb = tools.get('archguard_detect_god_packages');
    // very high thresholds → nothing flagged
    const result = await cb({ minFanIn: 100, minStructs: 100, minFunctions: 100, minFiles: 100 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.godPackages).toHaveLength(0);
  });

  it('response includes fanIn, fanOut, fileCount in each god package entry', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, '/workspace', registerAtlasAnalyticsTools);
    const cb = tools.get('archguard_detect_god_packages');
    // minFanIn=2 → flags node C
    const result = await cb({ minFanIn: 2 });
    const parsed = JSON.parse(result.content[0].text);
    const flagged = parsed.godPackages[0];
    expect(flagged).toHaveProperty('fanIn');
    expect(flagged).toHaveProperty('fanOut');
    expect(flagged).toHaveProperty('fileCount');
  });
});

// ── TypeScript god packages (relations fan metrics + package stats) ──────────

describe('archguard_detect_god_packages — TypeScript scope', () => {
  function mockTsGodScope(gatewayFanOutRelations = 25): void {
    const { engine, archJson } = makeTsGodEngine(gatewayFanOutRelations);
    loadEngineMock.mockResolvedValueOnce({
      engine,
      extensionAccessor: new ExtensionAccessor(archJson),
      scopeEntry: tsGodScopeEntry,
    } as unknown as Awaited<ReturnType<typeof loadEngine>>);
  }

  async function call(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, '/workspace', registerAtlasAnalyticsTools);
    const result = await tools.get('archguard_detect_god_packages')(args);
    return JSON.parse(result.content[0].text);
  }

  it('returns applicable:true instead of the not-applicable payload', async () => {
    mockTsGodScope();
    const parsed = await call({});
    expect(parsed.applicable).toBe(true);
    expect(Array.isArray(parsed.godPackages)).toBe(true);
    expect(parsed).not.toHaveProperty('alternative');
  });

  it('flags a TS package exceeding both fanOut and fileCount thresholds with correct reasons', async () => {
    mockTsGodScope(25);
    const parsed = await call({});
    const godPackages = parsed.godPackages as Array<Record<string, unknown>>;
    const gateway = godPackages.find((p) => p.packageName === 'modules/mcp-gateway');

    expect(gateway).toBeDefined();
    expect(gateway).toMatchObject({
      packageName: 'modules/mcp-gateway',
      fanIn: 0,
      fanOut: 25,
      fileCount: 41,
      entityCount: 1,
    });
    expect(gateway?.reasons).toContain('highFanOut');
    expect(gateway?.reasons).toContain('tooManyFiles');
    expect(gateway?.reasons).not.toContain('highFanIn');
    // loc is unavailable for TypeScript — the field must be omitted, not null.
    expect(gateway).not.toHaveProperty('loc');
  });

  it('does not flag packages below the TS thresholds', async () => {
    mockTsGodScope(25);
    const parsed = await call({
      minFanIn: 100,
      minFanOut: 100,
      minFiles: 100,
      minEntities: 100,
    });
    expect(parsed.godPackages).toHaveLength(0);
  });

  it('flags a TS package exceeding the entityCount volume threshold', async () => {
    mockTsGodScope(1);
    const parsed = await call({ minFanIn: 0, minFanOut: 0, minFiles: 0, minEntities: 1 });
    const godPackages = parsed.godPackages as Array<{ reasons: string[] }>;
    expect(godPackages.length).toBeGreaterThan(0);
    expect(godPackages[0].reasons).toContain('tooManyEntities');
  });
});

// ── Applicability marker for non-Atlas scopes ────────────────────────────────

describe('Atlas analytics tools — applicability on non-Atlas scopes', () => {
  const tsScopeEntry: QueryScopeEntry = {
    key: 'ts-scope',
    label: 'src (typescript)',
    language: 'typescript',
    kind: 'parsed',
    sources: ['/project/src'],
    entityCount: 0,
    relationCount: 0,
    hasAtlasExtension: false,
  };

  function mockTypeScriptScope(): void {
    const { engine, archJson } = makeNoAtlasEngine();
    loadEngineMock.mockResolvedValueOnce({
      engine,
      extensionAccessor: new ExtensionAccessor(archJson),
      scopeEntry: tsScopeEntry,
    } as unknown as Awaited<ReturnType<typeof loadEngine>>);
  }

  async function call(toolName: string): Promise<{ text: string }> {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, '/workspace', registerAtlasAnalyticsTools);
    const result = await tools.get(toolName)({});
    return { text: result.content[0].text as string };
  }

  it.each(['archguard_get_package_fanin', 'archguard_get_package_fanout'])(
    '%s returns applicable:false with reason and alternative on a TS scope',
    async (toolName) => {
      mockTypeScriptScope();
      const payload = JSON.parse((await call(toolName)).text);
      expect(payload.applicable).toBe(false);
      expect(payload.reason).toMatch(/No Atlas data/);
      expect(payload.reason).toContain('typescript');
      expect(payload.alternative).toContain('archguard_get_package_metrics');
    }
  );

  it('archguard_detect_god_packages is now applicable on a TS scope', async () => {
    mockTypeScriptScope();
    const payload = JSON.parse((await call('archguard_detect_god_packages')).text);
    expect(payload.applicable).toBe(true);
    expect(Array.isArray(payload.godPackages)).toBe(true);
  });

  it('Go Atlas scope behaviour is unchanged (no applicable marker)', async () => {
    const godText = (await call('archguard_detect_god_packages')).text;
    const god = JSON.parse(godText);
    expect(god).not.toHaveProperty('applicable');
    expect(god).toHaveProperty('godPackages');

    const fanin = JSON.parse((await call('archguard_get_package_fanin')).text);
    expect(fanin).not.toHaveProperty('applicable');
    expect(Array.isArray(fanin.packages)).toBe(true);

    const fanout = JSON.parse((await call('archguard_get_package_fanout')).text);
    expect(fanout).not.toHaveProperty('applicable');
    expect(Array.isArray(fanout.packages)).toBe(true);
  });
});

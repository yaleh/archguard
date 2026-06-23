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
  };
}

/**
 * Build an ArchJSON with a cycle between pkgX and pkgY.
 * pkgX.Foo → pkgY.Bar AND pkgY.Bar → pkgX.Foo creates a cycle.
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
    relations: [
      makeRelation('pkgX.Foo', 'pkgY.Bar'),
      makeRelation('pkgY.Bar', 'pkgX.Foo'),
    ],
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
    const handler = tools.get('archguard_get_package_metrics')!;

    const result = await handler({ projectRoot: '/workspace' });
    const text = result.content[0].text as string;
    const payload = JSON.parse(text) as { packages: Array<{ packageName: string; fanIn: number; fanOut: number; cycleCount: number; cyclesWith: string[] }> };

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
    const handler = tools.get('archguard_get_package_metrics')!;

    const result = await handler({ projectRoot: '/workspace' });
    const payload = JSON.parse(result.content[0].text);

    const names = payload.packages.map((p: { packageName: string }) => p.packageName);
    expect(names).toContain('pkgA');
    expect(names).toContain('pkgB');
  });

  it('computes correct fanOut for pkgA (2 outgoing cross-package relations)', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const handler = tools.get('archguard_get_package_metrics')!;

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
    const handler = tools.get('archguard_get_package_metrics')!;

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
    const handler = tools.get('archguard_get_package_metrics')!;

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
    const handler = tools.get('archguard_get_package_metrics')!;

    const result = await handler({ projectRoot: '/workspace', packageName: 'pkgA' });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.packages).toHaveLength(1);
    expect(payload.packages[0].packageName).toBe('pkgA');
  });

  it('returns empty array when packageName does not match any package', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const handler = tools.get('archguard_get_package_metrics')!;

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

  it('sets cycleCount>0 when a cycle exists between packages', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const handler = tools.get('archguard_get_package_metrics')!;

    const result = await handler({ projectRoot: '/workspace' });
    const payload = JSON.parse(result.content[0].text);

    // Both pkgX and pkgY participate in a cycle
    const pkgX = payload.packages.find((p: { packageName: string }) => p.packageName === 'pkgX');
    const pkgY = payload.packages.find((p: { packageName: string }) => p.packageName === 'pkgY');

    expect(pkgX).toBeDefined();
    expect(pkgY).toBeDefined();
    expect(pkgX.cycleCount).toBeGreaterThan(0);
    expect(pkgY.cycleCount).toBeGreaterThan(0);
  });

  it('populates cyclesWith with names of co-cycling entities when cycleCount>0', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const handler = tools.get('archguard_get_package_metrics')!;

    const result = await handler({ projectRoot: '/workspace' });
    const payload = JSON.parse(result.content[0].text);

    const pkgX = payload.packages.find((p: { packageName: string }) => p.packageName === 'pkgX');
    expect(pkgX.cyclesWith.length).toBeGreaterThan(0);
  });
});

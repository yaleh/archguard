/**
 * Unit tests for the MCP server tool registration.
 *
 * Tests that all 8 tools are registered and each tool resolves its engine
 * per call from projectRoot/scope instead of using session state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Entity, ArchJSON } from '@/types/index.js';
import { QueryEngine } from '@/cli/query/query-engine.js';
import type { QueryScopeEntry } from '@/cli/query/query-manifest.js';
import type { ArchJSONExtensions } from '@/types/extensions.js';
import { buildArchIndex } from '@/cli/query/arch-index-builder.js';
import { registerTools } from '@/cli/mcp/mcp-server.js';
import { loadEngine } from '@/cli/query/engine-loader.js';

vi.mock('@/cli/query/engine-loader.js', async () => {
  const actual = await vi.importActual<typeof import('@/cli/query/engine-loader.js')>(
    '@/cli/query/engine-loader.js'
  );
  return {
    ...actual,
    loadEngine: vi.fn(),
  };
});

// -- Test fixtures --

function makeEntity(
  id: string,
  name: string,
  type: string = 'class',
  file: string = 'src/foo.ts'
): Entity {
  return {
    id,
    name,
    type: type as Entity['type'],
    visibility: 'public',
    members: [],
    sourceLocation: { file, startLine: 1, endLine: 10 },
  };
}

const entities: Entity[] = [
  makeEntity('cm', 'CacheManager', 'class', 'src/cache.ts'),
  makeEntity('dp', 'DiagramProcessor', 'class', 'src/processor.ts'),
  makeEntity('ilp', 'ILanguagePlugin', 'interface', 'src/plugin.ts'),
  makeEntity('tsp', 'TypeScriptPlugin', 'class', 'src/ts-plugin.ts'),
  makeEntity('orphan', 'OrphanClass', 'class', 'src/orphan.ts'),
];

const relations = [
  { id: 'dp->cm', source: 'dp', target: 'cm', type: 'dependency' as const },
  { id: 'dp->ilp', source: 'dp', target: 'ilp', type: 'dependency' as const },
  { id: 'tsp->ilp', source: 'tsp', target: 'ilp', type: 'implementation' as const },
  { id: 'cm->dp', source: 'cm', target: 'dp', type: 'dependency' as const },
];

const scopeEntry: QueryScopeEntry = {
  key: 'test123',
  label: 'src (typescript)',
  language: 'typescript',
  kind: 'parsed',
  sources: ['/project/src'],
  entityCount: 5,
  relationCount: 4,
  hasAtlasExtension: false,
};

function makeArchJson(): ArchJSON {
  return {
    version: '1.0',
    language: 'typescript',
    timestamp: '2026-01-01T00:00:00Z',
    sourceFiles: [],
    entities,
    relations,
  };
}

function createTestEngine(): QueryEngine {
  const archJson = makeArchJson();
  const archIndex = buildArchIndex(archJson, 'testhash');
  return new QueryEngine({ archJson, archIndex, scopeEntry });
}

// -- Helper to call tools via McpServer --

/**
 * We capture tool registrations by spying on server.tool() and
 * then call the callbacks directly.
 */
function collectTools(
  server: McpServer,
  defaultRoot: string = '/workspace'
): Map<string, Function> {
  const tools = new Map<string, Function>();
  const originalTool = server.tool.bind(server);

  vi.spyOn(server, 'tool').mockImplementation((...args: unknown[]) => {
    // Find the callback (last argument that is a function)
    const name = args[0] as string;
    const cb = args[args.length - 1] as Function;
    tools.set(name, cb);
    // Still register for real
    return (originalTool as Function)(...args);
  });

  registerTools(server, defaultRoot);
  return tools;
}

const loadEngineMock = vi.mocked(loadEngine);

beforeEach(() => {
  loadEngineMock.mockReset();
  loadEngineMock.mockResolvedValue(createTestEngine());
});

describe('MCP server tool registration', () => {
  it('registers all 10 tools', () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);

    expect(tools.size).toBe(10);
    expect(tools.has('archguard_find_entity')).toBe(true);
    expect(tools.has('archguard_get_dependencies')).toBe(true);
    expect(tools.has('archguard_get_dependents')).toBe(true);
    expect(tools.has('archguard_find_implementers')).toBe(true);
    expect(tools.has('archguard_find_subclasses')).toBe(true);
    expect(tools.has('archguard_get_file_entities')).toBe(true);
    expect(tools.has('archguard_detect_cycles')).toBe(true);
    expect(tools.has('archguard_summary')).toBe(true);
    expect(tools.has('archguard_get_atlas_layer')).toBe(true);
    expect(tools.has('archguard_get_package_stats')).toBe(true);
  });
});

describe('archguard_find_entity', () => {
  it('finds entity by name as summary by default', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);

    const cb = tools.get('archguard_find_entity');
    const result = await cb({ name: 'CacheManager' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('CacheManager');
    expect(parsed[0].members).toBeUndefined();
    expect(parsed[0].methodCount).toBeDefined();
  });

  it('returns empty array when not found', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);

    const cb = tools.get('archguard_find_entity');
    const result = await cb({ name: 'NonExistent' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(0);
  });

  it('returns full entities when verbose=true', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);

    const cb = tools.get('archguard_find_entity');
    const result = await cb({ name: 'CacheManager', verbose: true });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed[0].name).toBe('CacheManager');
    expect(parsed[0].members).toBeDefined();
  });

  it('loads the engine per call using defaultRoot when projectRoot is omitted', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, '/workspace/default');

    const cb = tools.get('archguard_find_entity');
    await cb({ name: 'CacheManager' });

    expect(loadEngineMock).toHaveBeenCalledWith('/workspace/default/.archguard', undefined);
  });

  it('passes resolved projectRoot and scope through to loadEngine', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, '/workspace/default');

    const cb = tools.get('archguard_find_entity');
    await cb({ projectRoot: '../other-project', scope: 'frontend', name: 'CacheManager' });

    expect(loadEngineMock).toHaveBeenCalledWith('/workspace/other-project/.archguard', 'frontend');
  });

  it('adds projectRoot context when no query data exists', async () => {
    loadEngineMock.mockRejectedValueOnce(
      new Error('No query data found. Run `archguard analyze` first.')
    );
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, '/workspace/default');

    const cb = tools.get('archguard_find_entity');
    const result = await cb({ projectRoot: '/tmp/project', name: 'CacheManager' });

    expect(result.content[0].text).toContain(
      'No query data found at /tmp/project/.archguard/query.'
    );
    expect(result.content[0].text).toContain('archguard_analyze({ projectRoot: "/tmp/project" })');
  });
});

describe('archguard_get_dependencies', () => {
  it('returns dependencies as summary by default', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);

    const cb = tools.get('archguard_get_dependencies');
    const result = await cb({ name: 'DiagramProcessor', depth: 1 });
    const parsed = JSON.parse(result.content[0].text);
    const names = parsed.map((e: { name: string }) => e.name);
    expect(names).toContain('CacheManager');
    expect(names).toContain('ILanguagePlugin');
    // summary: no members array
    expect('members' in parsed[0]).toBe(false);
    // summary: has summary fields
    expect('methodCount' in parsed[0]).toBe(true);
    expect('fieldCount' in parsed[0]).toBe(true);
    expect('file' in parsed[0]).toBe(true);
  });

  it('returns full entities when verbose=true', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);

    const cb = tools.get('archguard_get_dependencies');
    const result = await cb({ name: 'DiagramProcessor', depth: 1, verbose: true });
    const parsed = JSON.parse(result.content[0].text);
    expect('members' in parsed[0]).toBe(true);
    expect('methodCount' in parsed[0]).toBe(false);
  });

  it('accepts depth as string (MCP protocol coercion)', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);

    const cb = tools.get('archguard_get_dependencies');
    const result = await cb({ name: 'DiagramProcessor', depth: '1' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.map((e: { name: string }) => e.name)).toContain('CacheManager');
  });

  it('accepts verbose as string "true" (MCP stdio string coercion)', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);

    const cb = tools.get('archguard_get_dependencies');
    const result = await cb({ name: 'DiagramProcessor', depth: 1, verbose: 'true' });
    const parsed = JSON.parse(result.content[0].text);
    expect('members' in parsed[0]).toBe(true);
    expect('methodCount' in parsed[0]).toBe(false);
  });
});

describe('archguard_get_dependents', () => {
  it('returns dependents as summary by default', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);

    const cb = tools.get('archguard_get_dependents');
    const result = await cb({ name: 'CacheManager', depth: 1 });
    const parsed = JSON.parse(result.content[0].text);
    const names = parsed.map((e: { name: string }) => e.name);
    expect(names).toContain('DiagramProcessor');
    // summary: no members array
    expect('members' in parsed[0]).toBe(false);
    expect('methodCount' in parsed[0]).toBe(true);
  });

  it('returns full entities when verbose=true', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);

    const cb = tools.get('archguard_get_dependents');
    const result = await cb({ name: 'CacheManager', depth: 1, verbose: true });
    const parsed = JSON.parse(result.content[0].text);
    expect('members' in parsed[0]).toBe(true);
    expect('methodCount' in parsed[0]).toBe(false);
  });

  it('accepts depth as string (MCP protocol coercion)', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);

    const cb = tools.get('archguard_get_dependents');
    const result = await cb({ name: 'CacheManager', depth: '1' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.map((e: { name: string }) => e.name)).toContain('DiagramProcessor');
  });

  it('accepts verbose as string "true" (MCP stdio string coercion)', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);

    const cb = tools.get('archguard_get_dependents');
    const result = await cb({ name: 'CacheManager', depth: 1, verbose: 'true' });
    const parsed = JSON.parse(result.content[0].text);
    expect('members' in parsed[0]).toBe(true);
    expect('methodCount' in parsed[0]).toBe(false);
  });
});

describe('archguard_find_implementers', () => {
  it('returns implementers as summary by default', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);

    const cb = tools.get('archguard_find_implementers');
    const result = await cb({ name: 'ILanguagePlugin' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('TypeScriptPlugin');
    expect('members' in parsed[0]).toBe(false);
    expect('methodCount' in parsed[0]).toBe(true);
  });

  it('returns full entities when verbose=true', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);

    const cb = tools.get('archguard_find_implementers');
    const result = await cb({ name: 'ILanguagePlugin', verbose: true });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed[0].name).toBe('TypeScriptPlugin');
    expect('members' in parsed[0]).toBe(true);
  });

  it('accepts verbose as string "true" (MCP stdio string coercion)', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);

    const cb = tools.get('archguard_find_implementers');
    const result = await cb({ name: 'ILanguagePlugin', verbose: 'true' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed[0].name).toBe('TypeScriptPlugin');
    expect('members' in parsed[0]).toBe(true);
    expect('methodCount' in parsed[0]).toBe(false);
  });
});

describe('archguard_find_subclasses', () => {
  it('returns empty when no subclasses', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);

    const cb = tools.get('archguard_find_subclasses');
    const result = await cb({ name: 'CacheManager' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(0);
  });

  it('returns summary by default when subclasses exist', async () => {
    const subEntities: Entity[] = [
      makeEntity('base', 'BaseProcessor', 'class', 'src/base.ts'),
      makeEntity('sub', 'SubProcessor', 'class', 'src/sub.ts'),
    ];
    const subArchJson: ArchJSON = {
      version: '1.0',
      language: 'typescript',
      timestamp: '2026-01-01T00:00:00Z',
      sourceFiles: [],
      entities: subEntities,
      relations: [{ id: 'r1', source: 'sub', target: 'base', type: 'inheritance' }],
    };
    const { buildArchIndex } = await import('@/cli/query/arch-index-builder.js');
    const archIndex = buildArchIndex(subArchJson, 'h');
    const subEngine = new QueryEngine({ archJson: subArchJson, archIndex, scopeEntry });
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    loadEngineMock.mockResolvedValueOnce(subEngine);
    const tools = collectTools(server);

    const cb = tools.get('archguard_find_subclasses');
    const result = await cb({ name: 'BaseProcessor' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('SubProcessor');
    expect('members' in parsed[0]).toBe(false);
    expect('methodCount' in parsed[0]).toBe(true);
  });
});

describe('archguard_get_file_entities', () => {
  it('finds entities in file', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);

    const cb = tools.get('archguard_get_file_entities');
    const result = await cb({ filePath: 'src/cache.ts' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('CacheManager');
    expect(parsed[0].members).toBeUndefined();
  });

  it('returns full file entities when verbose=true', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);

    const cb = tools.get('archguard_get_file_entities');
    const result = await cb({ filePath: 'src/cache.ts', verbose: true });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed[0].name).toBe('CacheManager');
    expect(parsed[0].members).toBeDefined();
  });
});

describe('archguard_detect_cycles', () => {
  it('detects cycles', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);

    const cb = tools.get('archguard_detect_cycles');
    const result = await cb({});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.length).toBeGreaterThan(0);
    const memberNames = parsed[0].memberNames;
    expect(memberNames).toContain('CacheManager');
    expect(memberNames).toContain('DiagramProcessor');
  });
});

describe('archguard_summary', () => {
  it('returns scope summary', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);

    const cb = tools.get('archguard_summary');
    const result = await cb({});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.entityCount).toBe(5);
    expect(parsed.relationCount).toBe(4);
    expect(parsed.language).toBe('typescript');
    expect(parsed.kind).toBe('parsed');
  });
});

// -- Go Atlas fixtures --

const goAtlasScopeEntry: QueryScopeEntry = {
  key: 'gotest456',
  label: 'src (go)',
  language: 'go',
  kind: 'parsed',
  sources: ['/project/src'],
  entityCount: 0,
  relationCount: 0,
  hasAtlasExtension: true,
};

function makeGoAtlasArchJson(): ArchJSON {
  const extensions: ArchJSONExtensions = {
    goAtlas: {
      version: '2.0',
      layers: {
        package: {
          nodes: [
            {
              id: 'github.com/org/repo/internal/query',
              name: 'internal/query',
              type: 'internal',
              fileCount: 3,
            },
            {
              id: 'github.com/org/repo/internal/store',
              name: 'internal/store',
              type: 'internal',
              fileCount: 2,
            },
          ],
          edges: [
            {
              from: 'github.com/org/repo/internal/query',
              to: 'github.com/org/repo/internal/store',
              strength: 3,
            },
          ],
          cycles: [],
        },
        capability: {
          nodes: [
            {
              id: 'internal/query.Querier',
              name: 'Querier',
              type: 'interface',
              package: 'internal/query',
              exported: true,
            },
            {
              id: 'internal/store.StoreImpl',
              name: 'StoreImpl',
              type: 'struct',
              package: 'internal/store',
              exported: true,
            },
          ],
          edges: [
            {
              id: 'e1',
              type: 'implements',
              source: 'internal/store.StoreImpl',
              target: 'internal/query.Querier',
              confidence: 1.0,
            },
          ],
        },
        goroutine: {
          nodes: [
            {
              id: 'spawn-1',
              name: 'handleConn',
              type: 'spawned',
              package: 'internal/query',
              location: { file: 'query.go', line: 42 },
            },
            {
              id: 'spawn-2',
              name: 'worker',
              type: 'spawned',
              package: 'internal/query',
              location: { file: 'query.go', line: 55 },
            },
          ],
          edges: [{ from: 'spawn-1', to: 'spawn-2', spawnType: 'go-stmt' }],
          channels: [],
          channelEdges: [],
        },
        // No flow layer intentionally
      },
      metadata: {
        generatedAt: '2026-01-01T00:00:00Z',
        generationStrategy: {
          functionBodyStrategy: 'none',
          detectedFrameworks: [],
          followIndirectCalls: false,
          goplsEnabled: false,
        },
        completeness: { package: 1.0, capability: 1.0, goroutine: 1.0, flow: 0 },
        performance: { fileCount: 5, parseTime: 100, totalTime: 200, memoryUsage: 1024 },
      },
    },
  };

  return {
    version: '1.0',
    language: 'go',
    timestamp: '2026-01-01T00:00:00Z',
    sourceFiles: [],
    entities: [],
    relations: [],
    extensions,
  };
}

function createGoAtlasEngine(): QueryEngine {
  const archJson = makeGoAtlasArchJson();
  const archIndex = buildArchIndex(archJson, 'goatlashash');
  return new QueryEngine({ archJson, archIndex, scopeEntry: goAtlasScopeEntry });
}

describe('archguard_get_atlas_layer', () => {
  it('format=full + layer=package returns the raw PackageGraph JSON', async () => {
    loadEngineMock.mockResolvedValueOnce(createGoAtlasEngine());
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);

    const cb = tools.get('archguard_get_atlas_layer');
    const result = await cb({ layer: 'package', format: 'full' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.nodes).toBeDefined();
    expect(parsed.edges).toBeDefined();
    expect(Array.isArray(parsed.nodes)).toBe(true);
    expect(Array.isArray(parsed.edges)).toBe(true);
    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.edges).toHaveLength(1);
  });

  it('format=adjacency + layer=package returns [{from, to, label}] with short names', async () => {
    loadEngineMock.mockResolvedValueOnce(createGoAtlasEngine());
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);

    const cb = tools.get('archguard_get_atlas_layer');
    const result = await cb({ layer: 'package', format: 'adjacency' });
    const parsed = JSON.parse(result.content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].from).toBe('internal/query');
    expect(parsed[0].to).toBe('internal/store');
    expect(parsed[0].label).toBe('3 refs');
  });

  it('format=adjacency + layer=capability returns [{from, to, label}] with node names', async () => {
    loadEngineMock.mockResolvedValueOnce(createGoAtlasEngine());
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);

    const cb = tools.get('archguard_get_atlas_layer');
    const result = await cb({ layer: 'capability', format: 'adjacency' });
    const parsed = JSON.parse(result.content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].from).toBe('StoreImpl');
    expect(parsed[0].to).toBe('Querier');
    expect(parsed[0].label).toBe('implements');
  });

  it('format=adjacency + layer=goroutine returns [{from, to}] without label', async () => {
    loadEngineMock.mockResolvedValueOnce(createGoAtlasEngine());
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);

    const cb = tools.get('archguard_get_atlas_layer');
    const result = await cb({ layer: 'goroutine', format: 'adjacency' });
    const parsed = JSON.parse(result.content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].from).toBe('handleConn');
    expect(parsed[0].to).toBe('worker');
    expect(parsed[0].label).toBeUndefined();
  });

  it('format=adjacency + layer=flow returns error message', async () => {
    loadEngineMock.mockResolvedValueOnce(createGoAtlasEngine());
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);

    const cb = tools.get('archguard_get_atlas_layer');
    const result = await cb({ layer: 'flow', format: 'adjacency' });
    const text = result.content[0].text;
    expect(text).toMatch(/does not support adjacency|use format="full"/i);
  });

  it('no Atlas extension returns error message containing "No Atlas data"', async () => {
    // Use default TypeScript engine (no Atlas extension)
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);

    const cb = tools.get('archguard_get_atlas_layer');
    const result = await cb({ layer: 'package', format: 'full' });
    const text = result.content[0].text;
    expect(text).toMatch(/No Atlas data/i);
  });

  it('layer absent in Atlas fixture returns message containing "empty"', async () => {
    // The fixture has no flow layer
    loadEngineMock.mockResolvedValueOnce(createGoAtlasEngine());
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);

    const cb = tools.get('archguard_get_atlas_layer');
    const result = await cb({ layer: 'flow', format: 'full' });
    const text = result.content[0].text;
    expect(text).toMatch(/empty/i);
  });

  it('default format is full — omitting format gives same result as format=full', async () => {
    loadEngineMock
      .mockResolvedValueOnce(createGoAtlasEngine())
      .mockResolvedValueOnce(createGoAtlasEngine());
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);

    const cb = tools.get('archguard_get_atlas_layer');
    const withFull = await cb({ layer: 'package', format: 'full' });
    const withoutFormat = await cb({ layer: 'package' });
    expect(withoutFormat.content[0].text).toBe(withFull.content[0].text);
  });
});

describe('archguard_get_package_stats', () => {
  function makePackageStatsEngine(result: import('@/cli/query/query-engine.js').PackageStatsResult) {
    const engine = createTestEngine();
    vi.spyOn(engine, 'getPackageStats').mockReturnValue(result);
    return engine;
  }

  const goAtlasResult: import('@/cli/query/query-engine.js').PackageStatsResult = {
    meta: { dataPath: 'go-atlas', locAvailable: false },
    packages: [
      { package: 'internal/query', fileCount: 5, entityCount: 10, methodCount: 15, fieldCount: 3 },
      { package: 'internal/store', fileCount: 3, entityCount: 6, methodCount: 8, fieldCount: 2 },
      { package: 'cmd', fileCount: 1, entityCount: 2, methodCount: 3, fieldCount: 0 },
    ],
  };

  const ooResult: import('@/cli/query/query-engine.js').PackageStatsResult = {
    meta: { dataPath: 'oo-derived', locAvailable: true, locBasis: 'maxEndLine' },
    packages: [
      { package: 'com/example/service', fileCount: 5, entityCount: 8, methodCount: 12, fieldCount: 4, loc: 800 },
      { package: 'com/example/model', fileCount: 2, entityCount: 3, methodCount: 0, fieldCount: 6, loc: 200 },
    ],
  };

  it('default call returns JSON with meta.dataPath and packages array', async () => {
    loadEngineMock.mockResolvedValueOnce(makePackageStatsEngine(goAtlasResult));
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);

    const cb = tools.get('archguard_get_package_stats');
    const result = await cb({ depth: 2, sortBy: 'loc' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.meta.dataPath).toBe('go-atlas');
    expect(Array.isArray(parsed.packages)).toBe(true);
    expect(parsed.packages.length).toBeGreaterThan(0);
  });

  it('sortBy=fileCount returns packages sorted by fileCount DESC', async () => {
    loadEngineMock.mockResolvedValueOnce(makePackageStatsEngine(goAtlasResult));
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);

    const cb = tools.get('archguard_get_package_stats');
    const result = await cb({ depth: 2, sortBy: 'fileCount' });
    const parsed = JSON.parse(result.content[0].text);
    const fileCounts = parsed.packages.map((p: { fileCount: number }) => p.fileCount);
    for (let i = 1; i < fileCounts.length; i++) {
      expect(fileCounts[i]).toBeLessThanOrEqual(fileCounts[i - 1]);
    }
  });

  it('sortBy=entityCount returns packages sorted by entityCount DESC', async () => {
    loadEngineMock.mockResolvedValueOnce(makePackageStatsEngine(goAtlasResult));
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);

    const cb = tools.get('archguard_get_package_stats');
    const result = await cb({ depth: 2, sortBy: 'entityCount' });
    const parsed = JSON.parse(result.content[0].text);
    const counts = parsed.packages.map((p: { entityCount: number }) => p.entityCount);
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
    }
  });

  it('topN=2 limits output to 2 packages', async () => {
    loadEngineMock.mockResolvedValueOnce(makePackageStatsEngine(goAtlasResult));
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);

    const cb = tools.get('archguard_get_package_stats');
    const result = await cb({ depth: 2, sortBy: 'loc', topN: 2 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.packages.length).toBeLessThanOrEqual(2);
  });

  it('minFileCount=3 filters out packages with fewer than 3 files', async () => {
    loadEngineMock.mockResolvedValueOnce(makePackageStatsEngine(goAtlasResult));
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);

    const cb = tools.get('archguard_get_package_stats');
    const result = await cb({ depth: 2, sortBy: 'loc', minFileCount: 3 });
    const parsed = JSON.parse(result.content[0].text);
    for (const pkg of parsed.packages) {
      expect(pkg.fileCount).toBeGreaterThanOrEqual(3);
    }
  });

  it('minLoc=500 with locAvailable=true filters packages below threshold', async () => {
    loadEngineMock.mockResolvedValueOnce(makePackageStatsEngine(ooResult));
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);

    const cb = tools.get('archguard_get_package_stats');
    const result = await cb({ depth: 3, sortBy: 'loc', minLoc: 500 });
    const parsed = JSON.parse(result.content[0].text);
    // Only com/example/service (loc=800) should pass; com/example/model (loc=200) is filtered
    expect(parsed.packages.length).toBe(1);
    expect(parsed.packages[0].package).toBe('com/example/service');
  });

  it('minLoc=500 with locAvailable=false (Go) does not filter any entry', async () => {
    loadEngineMock.mockResolvedValueOnce(makePackageStatsEngine(goAtlasResult));
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);

    const cb = tools.get('archguard_get_package_stats');
    const result = await cb({ depth: 2, sortBy: 'loc', minLoc: 500 });
    const parsed = JSON.parse(result.content[0].text);
    // goAtlasResult has locAvailable=false, so minLoc is ignored
    expect(parsed.packages.length).toBe(goAtlasResult.packages.length);
  });

  it('empty packages returns "No package statistics available for this scope."', async () => {
    const emptyResult: import('@/cli/query/query-engine.js').PackageStatsResult = {
      meta: { dataPath: 'go-atlas', locAvailable: false },
      packages: [],
    };
    loadEngineMock.mockResolvedValueOnce(makePackageStatsEngine(emptyResult));
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);

    const cb = tools.get('archguard_get_package_stats');
    const result = await cb({ depth: 2, sortBy: 'loc' });
    expect(result.content[0].text).toBe('No package statistics available for this scope.');
  });

  it('no query data returns standard "No query data found" error', async () => {
    loadEngineMock.mockRejectedValueOnce(
      new Error('No query data found. Run `archguard analyze` first.')
    );
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, '/workspace/default');

    const cb = tools.get('archguard_get_package_stats');
    const result = await cb({ projectRoot: '/tmp/project', depth: 2, sortBy: 'loc' });
    expect(result.content[0].text).toContain('No query data found');
  });
});

describe('createMcpCommand', () => {
  it('registers with correct name', async () => {
    const { createMcpCommand } = await import('@/cli/commands/mcp.js');
    const cmd = createMcpCommand();
    expect(cmd.name()).toBe('mcp');
    expect(cmd.description()).toContain('MCP');
  });

  it('does not expose --arch-dir and --scope options', async () => {
    const { createMcpCommand } = await import('@/cli/commands/mcp.js');
    const cmd = createMcpCommand();
    const optionNames = cmd.options.map((o) => o.long);
    expect(optionNames).not.toContain('--arch-dir');
    expect(optionNames).not.toContain('--scope');
  });
});

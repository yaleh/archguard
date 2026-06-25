/**
 * Phase 93 TDD tests for call-graph MCP tools (archguard_find_callers).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Entity, ArchJSON } from '@/types/index.js';
import { QueryEngine } from '@/cli/query/query-engine.js';
import type { QueryScopeEntry } from '@/cli/query/query-manifest.js';
import { buildArchIndex } from '@/cli/query/arch-index-builder.js';
import { registerCallGraphTools } from '@/cli/mcp/tools/call-graph-tools.js';
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

const scopeEntry: QueryScopeEntry = {
  key: 'test-scope',
  label: 'src (typescript)',
  language: 'typescript',
  kind: 'parsed',
  sources: ['/project/src'],
  entityCount: 1,
  relationCount: 0,
  hasAtlasExtension: false,
};

function makeEntity(id: string, name: string): Entity {
  return {
    id,
    name,
    type: 'class',
    visibility: 'public',
    members: [],
    sourceLocation: { file: 'src/foo.ts', startLine: 1, endLine: 10 },
  };
}

function createEngine(): QueryEngine {
  const archJson: ArchJSON = {
    version: '1.1',
    language: 'typescript',
    timestamp: '2026-01-01T00:00:00Z',
    sourceFiles: [],
    entities: [makeEntity('pkg.A', 'A'), makeEntity('pkg.B', 'B')],
    relations: [
      {
        source: 'pkg.A',
        target: 'pkg.B',
        type: 'call',
        sourceMethod: 'callB',
        targetMethod: 'run',
        callType: 'direct',
      },
    ],
  };
  const archIndex = buildArchIndex(archJson, 'hash');
  return new QueryEngine({ archJson, archIndex, scopeEntry });
}

function wrapEngine(engine: QueryEngine) {
  return {
    engine,
    extensionAccessor: {} as any,
    scopeEntry,
    relationQueryService: engine.relationQueryService,
  };
}

function collectTools(server: McpServer, defaultRoot = '/workspace'): Map<string, Function> {
  const tools = new Map<string, Function>();
  const originalTool = server.tool.bind(server);

  vi.spyOn(server, 'tool').mockImplementation((...args: unknown[]) => {
    const name = args[0] as string;
    const cb = args[args.length - 1] as Function;
    tools.set(name, cb);
    return (originalTool as Function)(...args);
  });

  registerCallGraphTools(server, defaultRoot);
  return tools;
}

const loadEngineMock = vi.mocked(loadEngine);

beforeEach(() => {
  loadEngineMock.mockReset();
  loadEngineMock.mockResolvedValue(wrapEngine(createEngine()));
});

describe('archguard_find_callers — tool schema', () => {
  it('registers the archguard_find_callers tool', () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    expect(tools.has('archguard_find_callers')).toBe(true);
  });
});

describe('archguard_find_callers — handler', () => {
  it('calls engine.findCallers with correct entityName and depth=1', async () => {
    const engine = createEngine();
    const spy = vi.spyOn(engine.relationQueryService, 'findCallers');
    loadEngineMock.mockResolvedValue(wrapEngine(engine));

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_find_callers');

    await cb({ entityName: 'B', depth: 1 });

    expect(spy).toHaveBeenCalledWith('B', 1);
  });

  it('uses depth=1 as default when depth not provided', async () => {
    const engine = createEngine();
    const spy = vi.spyOn(engine.relationQueryService, 'findCallers');
    loadEngineMock.mockResolvedValue(wrapEngine(engine));

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_find_callers');

    await cb({ entityName: 'B' });

    expect(spy).toHaveBeenCalledWith('B', 1);
  });

  it('response JSON contains entityName, depth, and callers fields', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_find_callers');

    const result = await cb({ entityName: 'B', depth: 1 });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed).toHaveProperty('entityName', 'B');
    expect(parsed).toHaveProperty('depth', 1);
    expect(parsed).toHaveProperty('callers');
    expect(Array.isArray(parsed.callers)).toBe(true);
  });

  it('callers array contains expected caller data', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_find_callers');

    const result = await cb({ entityName: 'B', depth: 1 });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.callers).toHaveLength(1);
    expect(parsed.callers[0]).toMatchObject({
      callerEntity: 'pkg.A',
      callerMethod: 'callB',
      callType: 'direct',
      depth: 1,
    });
  });

  it('passes projectRoot to resolveRoot for path resolution', async () => {
    const engine = createEngine();
    loadEngineMock.mockResolvedValue(wrapEngine(engine));

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server, '/default');
    const cb = tools.get('archguard_find_callers');

    await cb({ entityName: 'B', projectRoot: '/custom-root' });

    // loadEngine should be called with the custom root's .archguard dir
    expect(loadEngineMock).toHaveBeenCalledWith(expect.stringContaining('/custom-root'));
  });

  it('returns error text when engine load fails', async () => {
    loadEngineMock.mockRejectedValue(new Error('No query data found'));

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const cb = tools.get('archguard_find_callers');

    const result = await cb({ entityName: 'B', depth: 1 });
    expect(result.content[0].text).toContain('archguard_analyze');
  });
});

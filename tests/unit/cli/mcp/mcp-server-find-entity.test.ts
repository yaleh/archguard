/**
 * Unit tests for the updated archguard_find_entity MCP tool.
 *
 * Tests name-based lookup (existing path), entityType filtering,
 * attrFilter routing, AND composition, and error handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Entity, ArchJSON } from '@/types/index.js';
import { QueryEngine } from '@/cli/query/query-engine.js';
import type { QueryScopeEntry } from '@/cli/query/query-manifest.js';
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
  file: string = 'src/foo.ts',
  attrs?: Record<string, string | number | boolean>
): Entity {
  return {
    id,
    name,
    type: type as Entity['type'],
    visibility: 'public',
    members: [],
    sourceLocation: { file, startLine: 1, endLine: 10 },
    ...(attrs ? { attributes: attrs } : {}),
  };
}

const scopeEntry: QueryScopeEntry = {
  key: 'test123',
  label: 'src (typescript)',
  language: 'typescript',
  kind: 'parsed',
  sources: ['/project/src'],
  entityCount: 5,
  relationCount: 0,
  hasAtlasExtension: false,
};

const entities: Entity[] = [
  makeEntity('cm', 'CacheManager', 'class', 'src/cache.ts'),
  makeEntity('ld1', 'LockA', 'lock_domain', 'src/lock.ts', { irq_safe: true, priority: 1 }),
  makeEntity('ld2', 'LockB', 'lock_domain', 'src/lock2.ts', { irq_safe: false, priority: 2 }),
  makeEntity('ld3', 'LockC', 'lock_domain', 'src/lock3.ts', { irq_safe: true, priority: 2 }),
  makeEntity('w1', 'Worker', 'class', 'src/worker.ts', { execution_context: 'irq' }),
];

function createTestEngine(): QueryEngine {
  const archJson: ArchJSON = {
    version: '1.1',
    language: 'typescript',
    timestamp: '2026-01-01T00:00:00Z',
    sourceFiles: [],
    entities,
    relations: [],
  };
  const archIndex = buildArchIndex(archJson, 'testhash');
  return new QueryEngine({ archJson, archIndex, scopeEntry });
}

function wrapEngine(engine: QueryEngine) {
  return { engine, extensionAccessor: {} as any, scopeEntry };
}

// -- Helper to call tools via McpServer --

function collectTools(
  server: McpServer,
  defaultRoot: string = '/workspace'
): Map<string, Function> {
  const tools = new Map<string, Function>();
  const originalTool = server.tool.bind(server);

  vi.spyOn(server, 'tool').mockImplementation((...args: unknown[]) => {
    const name = args[0] as string;
    const cb = args[args.length - 1] as Function;
    tools.set(name, cb);
    return (originalTool as Function)(...args);
  });

  registerTools(server, defaultRoot);
  return tools;
}

const loadEngineMock = vi.mocked(loadEngine);

beforeEach(() => {
  loadEngineMock.mockReset();
  loadEngineMock.mockResolvedValue(wrapEngine(createTestEngine()));
});

// -- Tests --

describe('archguard_find_entity MCP tool', () => {
  it('name-based lookup still calls findEntity (existing path unchanged)', async () => {
    const engine = createTestEngine();
    const findEntitySpy = vi.spyOn(engine, 'findEntity');
    loadEngineMock.mockResolvedValue(wrapEngine(engine));

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const tool = tools.get('archguard_find_entity')!;

    await tool({ name: 'CacheManager' });

    expect(findEntitySpy).toHaveBeenCalledWith('CacheManager', expect.objectContaining({ outputScope: expect.any(String) }));
  });

  it('entityType filter calls findByType', async () => {
    const engine = createTestEngine();
    const findByTypeSpy = vi.spyOn(engine, 'findByType');
    const findEntitySpy = vi.spyOn(engine, 'findEntity');
    loadEngineMock.mockResolvedValue(wrapEngine(engine));

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const tool = tools.get('archguard_find_entity')!;

    const result = await tool({ entityType: 'lock_domain' });

    expect(findEntitySpy).not.toHaveBeenCalled();
    expect(findByTypeSpy).toHaveBeenCalledWith('lock_domain', expect.objectContaining({ outputScope: expect.any(String) }));
    const text = result.content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed).toHaveLength(3); // ld1, ld2, ld3
  });

  it('entityType + attrFilter calls findByTypeAndAttr', async () => {
    const engine = createTestEngine();
    const findByTypeAndAttrSpy = vi.spyOn(engine, 'findByTypeAndAttr');
    loadEngineMock.mockResolvedValue(wrapEngine(engine));

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const tool = tools.get('archguard_find_entity')!;

    const result = await tool({ entityType: 'lock_domain', attrFilter: { irq_safe: true } });

    expect(findByTypeAndAttrSpy).toHaveBeenCalledWith('lock_domain', 'irq_safe', true, expect.objectContaining({ outputScope: expect.any(String) }));
    const text = result.content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed).toHaveLength(2); // ld1 and ld3 have irq_safe=true
  });

  it('attrFilter without entityType calls findByAttr', async () => {
    const engine = createTestEngine();
    const findByAttrSpy = vi.spyOn(engine, 'findByAttr');
    loadEngineMock.mockResolvedValue(wrapEngine(engine));

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const tool = tools.get('archguard_find_entity')!;

    const result = await tool({ attrFilter: { execution_context: 'irq' } });

    expect(findByAttrSpy).toHaveBeenCalledWith('execution_context', 'irq', expect.objectContaining({ outputScope: expect.any(String) }));
    const text = result.content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed).toHaveLength(1); // only w1
    expect(parsed[0].name).toBe('Worker');
  });

  it('attrFilter with two keys applies AND semantics', async () => {
    const engine = createTestEngine();
    loadEngineMock.mockResolvedValue(wrapEngine(engine));

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const tool = tools.get('archguard_find_entity')!;

    // irq_safe=true AND priority=1 → only ld1
    const result = await tool({ entityType: 'lock_domain', attrFilter: { irq_safe: true, priority: 1 } });

    const text = result.content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('LockA');
  });

  it('empty attrFilter with entityType behaves as plain findByType', async () => {
    const engine = createTestEngine();
    const findByTypeSpy = vi.spyOn(engine, 'findByType');
    loadEngineMock.mockResolvedValue(wrapEngine(engine));

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const tool = tools.get('archguard_find_entity')!;

    const result = await tool({ entityType: 'lock_domain', attrFilter: {} });

    expect(findByTypeSpy).toHaveBeenCalledWith('lock_domain', expect.objectContaining({ outputScope: expect.any(String) }));
    const text = result.content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed).toHaveLength(3); // all lock_domain entities
  });

  it('no name, entityType, or attrFilter returns empty array or error without crashing', async () => {
    const engine = createTestEngine();
    loadEngineMock.mockResolvedValue(wrapEngine(engine));

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tools = collectTools(server);
    const tool = tools.get('archguard_find_entity')!;

    // Should not throw; returns a valid MCP content response
    const result = await tool({});

    // Response must be a valid MCP content response
    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.content[0]).toBeDefined();
    // Either an empty array result or an error message — both are valid
    expect(typeof result.content[0].text).toBe('string');
  });
});

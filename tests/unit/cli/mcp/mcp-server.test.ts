/**
 * Unit tests for the MCP server tool registration.
 *
 * Tests that all 8 tools are registered and produce correct output
 * by calling the tool handlers directly via McpServer internals.
 */

import { describe, it, expect, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Entity, ArchJSON } from '@/types/index.js';
import { QueryEngine } from '@/cli/query/query-engine.js';
import type { QueryScopeEntry } from '@/cli/query/query-manifest.js';
import { buildArchIndex } from '@/cli/query/arch-index-builder.js';
import { registerTools } from '@/cli/mcp/mcp-server.js';

// -- Test fixtures --

function makeEntity(id: string, name: string, type: string = 'class', file: string = 'src/foo.ts'): Entity {
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
function collectTools(server: McpServer, engine: QueryEngine): Map<string, Function> {
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

  registerTools(server, engine);
  return tools;
}

describe('MCP server tool registration', () => {
  it('registers all 8 tools', () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const engine = createTestEngine();
    const tools = collectTools(server, engine);

    expect(tools.size).toBe(8);
    expect(tools.has('archguard_find_entity')).toBe(true);
    expect(tools.has('archguard_get_dependencies')).toBe(true);
    expect(tools.has('archguard_get_dependents')).toBe(true);
    expect(tools.has('archguard_find_implementers')).toBe(true);
    expect(tools.has('archguard_find_subclasses')).toBe(true);
    expect(tools.has('archguard_get_file_entities')).toBe(true);
    expect(tools.has('archguard_detect_cycles')).toBe(true);
    expect(tools.has('archguard_summary')).toBe(true);
  });
});

describe('archguard_find_entity', () => {
  it('finds entity by name', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const engine = createTestEngine();
    const tools = collectTools(server, engine);

    const cb = tools.get('archguard_find_entity')!;
    const result = await cb({ name: 'CacheManager' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('CacheManager');
  });

  it('returns empty array when not found', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const engine = createTestEngine();
    const tools = collectTools(server, engine);

    const cb = tools.get('archguard_find_entity')!;
    const result = await cb({ name: 'NonExistent' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(0);
  });
});

describe('archguard_get_dependencies', () => {
  it('returns dependencies', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const engine = createTestEngine();
    const tools = collectTools(server, engine);

    const cb = tools.get('archguard_get_dependencies')!;
    const result = await cb({ name: 'DiagramProcessor', depth: 1 });
    const parsed = JSON.parse(result.content[0].text);
    const names = parsed.map((e: Entity) => e.name);
    expect(names).toContain('CacheManager');
    expect(names).toContain('ILanguagePlugin');
  });

  it('accepts depth as string (MCP protocol coercion)', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const engine = createTestEngine();
    const tools = collectTools(server, engine);

    const cb = tools.get('archguard_get_dependencies')!;
    const result = await cb({ name: 'DiagramProcessor', depth: '1' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.map((e: Entity) => e.name)).toContain('CacheManager');
  });
});

describe('archguard_get_dependents', () => {
  it('returns dependents', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const engine = createTestEngine();
    const tools = collectTools(server, engine);

    const cb = tools.get('archguard_get_dependents')!;
    const result = await cb({ name: 'CacheManager', depth: 1 });
    const parsed = JSON.parse(result.content[0].text);
    const names = parsed.map((e: Entity) => e.name);
    expect(names).toContain('DiagramProcessor');
  });

  it('accepts depth as string (MCP protocol coercion)', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const engine = createTestEngine();
    const tools = collectTools(server, engine);

    const cb = tools.get('archguard_get_dependents')!;
    const result = await cb({ name: 'CacheManager', depth: '1' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.map((e: Entity) => e.name)).toContain('DiagramProcessor');
  });
});

describe('archguard_find_implementers', () => {
  it('finds implementers of interface', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const engine = createTestEngine();
    const tools = collectTools(server, engine);

    const cb = tools.get('archguard_find_implementers')!;
    const result = await cb({ name: 'ILanguagePlugin' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('TypeScriptPlugin');
  });
});

describe('archguard_find_subclasses', () => {
  it('returns empty when no subclasses', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const engine = createTestEngine();
    const tools = collectTools(server, engine);

    const cb = tools.get('archguard_find_subclasses')!;
    const result = await cb({ name: 'CacheManager' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(0);
  });
});

describe('archguard_get_file_entities', () => {
  it('finds entities in file', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const engine = createTestEngine();
    const tools = collectTools(server, engine);

    const cb = tools.get('archguard_get_file_entities')!;
    const result = await cb({ path: 'src/cache.ts' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('CacheManager');
  });
});

describe('archguard_detect_cycles', () => {
  it('detects cycles', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const engine = createTestEngine();
    const tools = collectTools(server, engine);

    const cb = tools.get('archguard_detect_cycles')!;
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
    const engine = createTestEngine();
    const tools = collectTools(server, engine);

    const cb = tools.get('archguard_summary')!;
    const result = await cb({});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.entityCount).toBe(5);
    expect(parsed.relationCount).toBe(4);
    expect(parsed.language).toBe('typescript');
    expect(parsed.kind).toBe('parsed');
  });
});

describe('createMcpCommand', () => {
  it('registers with correct name', async () => {
    const { createMcpCommand } = await import('@/cli/commands/mcp.js');
    const cmd = createMcpCommand();
    expect(cmd.name()).toBe('mcp');
    expect(cmd.description()).toContain('MCP');
  });

  it('has --arch-dir and --scope options', async () => {
    const { createMcpCommand } = await import('@/cli/commands/mcp.js');
    const cmd = createMcpCommand();
    const optionNames = cmd.options.map(o => o.long);
    expect(optionNames).toContain('--arch-dir');
    expect(optionNames).toContain('--scope');
  });
});

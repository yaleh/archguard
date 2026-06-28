/**
 * TASK-22.5 Phase A — backend routing for query-style MCP tools.
 *
 * Covers the optional `backend` / `projectRoot` / `codebaseMemoryProject`
 * params added to archguard_find_entity, archguard_get_file_entities, and
 * archguard_summary. Two invariants:
 *
 *   1. Without `backend` (or backend="archguard"), behavior is byte-for-byte
 *      unchanged — the ArchGuard engine path runs and the adapter is never
 *      touched.
 *   2. With backend="codebase-memory", the tool returns a BackendResult
 *      envelope produced by the (mocked) adapter, and an adapter throw is
 *      normalized into a diagnostic envelope rather than crashing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Entity, ArchJSON } from '@/types/index.js';
import { QueryEngine } from '@/cli/query/query-engine.js';
import type { QueryScopeEntry } from '@/cli/query/query-manifest.js';
import { buildArchIndex } from '@/cli/query/arch-index-builder.js';
import { registerTools } from '@/cli/mcp/mcp-server.js';
import { loadEngine } from '@/cli/query/engine-loader.js';
import {
  setBackendAdapterFactory,
  resetBackendAdapterFactory,
} from '@/cli/mcp/codebase-memory-backend.js';
import { createBackendResult } from '@/integrations/codebase-memory/types.js';

vi.mock('@/cli/query/engine-loader.js', async () => {
  const actual = await vi.importActual<typeof import('@/cli/query/engine-loader.js')>(
    '@/cli/query/engine-loader.js'
  );
  return { ...actual, loadEngine: vi.fn() };
});

function makeEntity(id: string, name: string, file = 'src/foo.ts'): Entity {
  return {
    id,
    name,
    type: 'class',
    visibility: 'public',
    members: [],
    sourceLocation: { file, startLine: 1, endLine: 10 },
  };
}

const scopeEntry: QueryScopeEntry = {
  key: 'test-scope',
  label: 'src (typescript)',
  language: 'typescript',
  kind: 'parsed',
  sources: ['/project/src'],
  entityCount: 2,
  relationCount: 0,
  hasAtlasExtension: false,
};

function createEngine(): QueryEngine {
  const archJson: ArchJSON = {
    version: '1.1',
    language: 'typescript',
    timestamp: '2026-01-01T00:00:00Z',
    sourceFiles: [],
    entities: [makeEntity('pkg.A', 'A'), makeEntity('pkg.B', 'B')],
    relations: [],
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
  registerTools(server, defaultRoot);
  return tools;
}

const loadEngineMock = vi.mocked(loadEngine);

beforeEach(() => {
  loadEngineMock.mockReset();
  loadEngineMock.mockResolvedValue(wrapEngine(createEngine()));
});

afterEach(() => {
  resetBackendAdapterFactory();
});

describe('archguard_find_entity — backend routing', () => {
  it('default (no backend) runs the ArchGuard engine path unchanged', async () => {
    const engine = createEngine();
    const findEntitySpy = vi.spyOn(engine, 'findEntity');
    loadEngineMock.mockResolvedValue(wrapEngine(engine));

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tool = collectTools(server).get('archguard_find_entity');
    const result = await tool({ name: 'A' });

    expect(findEntitySpy).toHaveBeenCalled();
    // Output is the bare engine payload, not a backend envelope.
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).not.toHaveProperty('backend');
  });

  it('backend="archguard" is also the unchanged engine path', async () => {
    const engine = createEngine();
    const findEntitySpy = vi.spyOn(engine, 'findEntity');
    loadEngineMock.mockResolvedValue(wrapEngine(engine));

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tool = collectTools(server).get('archguard_find_entity');
    await tool({ name: 'A', backend: 'archguard' });

    expect(findEntitySpy).toHaveBeenCalled();
  });

  it('backend="codebase-memory" returns the adapter BackendResult envelope', async () => {
    const findEntity = vi.fn().mockResolvedValue(
      createBackendResult(
        'codebase-memory',
        '/custom',
        { results: [{ name: 'A', raw: {} }] },
        {
          codebaseMemoryProject: 'proj-x',
        }
      )
    );
    setBackendAdapterFactory(() => ({ findEntity }) as any);

    const engine = createEngine();
    const findEntitySpy = vi.spyOn(engine, 'findEntity');
    loadEngineMock.mockResolvedValue(wrapEngine(engine));

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tool = collectTools(server).get('archguard_find_entity');
    const result = await tool({
      name: 'A',
      backend: 'codebase-memory',
      projectRoot: '/custom',
      codebaseMemoryProject: 'proj-x',
    });

    // ArchGuard engine must NOT be consulted for the codebase-memory path.
    expect(findEntitySpy).not.toHaveBeenCalled();
    expect(findEntity).toHaveBeenCalledWith('A');

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.backend).toBe('codebase-memory');
    expect(parsed.codebaseMemoryProject).toBe('proj-x');
    expect(parsed.data.results[0].name).toBe('A');
  });

  it('adapter throw is normalized to a diagnostic envelope (no crash)', async () => {
    setBackendAdapterFactory(
      () =>
        ({
          findEntity: vi.fn().mockRejectedValue(new Error('boom')),
        }) as any
    );

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tool = collectTools(server).get('archguard_find_entity');
    const result = await tool({ name: 'A', backend: 'codebase-memory' });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.backend).toBe('codebase-memory');
    expect(parsed.diagnostics?.[0]?.code).toBe('backend-error');
    expect(parsed.diagnostics?.[0]?.message).toContain('boom');
  });
});

describe('archguard_get_file_entities — backend routing', () => {
  it('default path runs the engine unchanged', async () => {
    const engine = createEngine();
    const spy = vi.spyOn(engine, 'getFileEntities');
    loadEngineMock.mockResolvedValue(wrapEngine(engine));

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tool = collectTools(server).get('archguard_get_file_entities');
    const result = await tool({ filePath: 'src/foo.ts' });

    expect(spy).toHaveBeenCalled();
    expect(JSON.parse(result.content[0].text)).not.toHaveProperty('backend');
  });

  it('backend="codebase-memory" delegates to adapter.getFileEntities', async () => {
    const getFileEntities = vi
      .fn()
      .mockResolvedValue(
        createBackendResult('codebase-memory', '/r', { file: 'src/foo.ts', results: [] })
      );
    setBackendAdapterFactory(() => ({ getFileEntities }) as any);

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tool = collectTools(server).get('archguard_get_file_entities');
    const result = await tool({ filePath: 'src/foo.ts', backend: 'codebase-memory' });

    expect(getFileEntities).toHaveBeenCalledWith('src/foo.ts');
    expect(JSON.parse(result.content[0].text).backend).toBe('codebase-memory');
  });
});

describe('archguard_summary — backend routing', () => {
  it('default path returns the engine summary unchanged', async () => {
    const engine = createEngine();
    const spy = vi.spyOn(engine, 'getSummary');
    loadEngineMock.mockResolvedValue(wrapEngine(engine));

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tool = collectTools(server).get('archguard_summary');
    const result = await tool({});

    expect(spy).toHaveBeenCalled();
    expect(JSON.parse(result.content[0].text)).not.toHaveProperty('backend');
  });

  it('backend="codebase-memory" delegates to adapter.getArchitecture', async () => {
    const getArchitecture = vi
      .fn()
      .mockResolvedValue(createBackendResult('codebase-memory', '/r', { raw: { packages: 3 } }));
    setBackendAdapterFactory(() => ({ getArchitecture }) as any);

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tool = collectTools(server).get('archguard_summary');
    const result = await tool({ backend: 'codebase-memory' });

    expect(getArchitecture).toHaveBeenCalled();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.backend).toBe('codebase-memory');
    expect(parsed.data.raw.packages).toBe(3);
  });
});

/**
 * TASK-22.5 Phase B — backend routing for archguard_find_callers.
 *
 * Adds the optional `backend` / `projectRoot` / `codebaseMemoryProject` params.
 * Invariants:
 *   1. Without backend (or backend="archguard"), the engine path is unchanged.
 *   2. backend="codebase-memory" returns the adapter's BackendResult envelope.
 *   3. An adapter throw is normalized to a diagnostic envelope — the MCP
 *      server never crashes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Entity, ArchJSON } from '@/types/index.js';
import { QueryEngine } from '@/cli/query/query-engine.js';
import type { QueryScopeEntry } from '@/cli/query/query-manifest.js';
import { buildArchIndex } from '@/cli/query/arch-index-builder.js';
import { registerCallGraphTools } from '@/cli/mcp/tools/call-graph-tools.js';
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

afterEach(() => {
  resetBackendAdapterFactory();
});

describe('archguard_find_callers — backend routing', () => {
  it('default path calls engine.findCallers unchanged', async () => {
    const engine = createEngine();
    const spy = vi.spyOn(engine.relationQueryService, 'findCallers');
    loadEngineMock.mockResolvedValue(wrapEngine(engine));

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tool = collectTools(server).get('archguard_find_callers');
    const result = await tool({ entityName: 'B', depth: 1 });

    expect(spy).toHaveBeenCalledWith('B', 1);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveProperty('entityName', 'B');
    expect(parsed).not.toHaveProperty('backend');
  });

  it('backend="codebase-memory" returns the adapter BackendResult envelope', async () => {
    const findCallers = vi
      .fn()
      .mockResolvedValue(
        createBackendResult('codebase-memory', '/r', { callers: [{ from: 'A', to: 'B', raw: {} }] })
      );
    setBackendAdapterFactory(() => ({ findCallers }) as any);

    const engine = createEngine();
    const spy = vi.spyOn(engine.relationQueryService, 'findCallers');
    loadEngineMock.mockResolvedValue(wrapEngine(engine));

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tool = collectTools(server).get('archguard_find_callers');
    const result = await tool({
      entityName: 'B',
      backend: 'codebase-memory',
      projectRoot: '/custom',
      codebaseMemoryProject: 'proj-x',
    });

    expect(spy).not.toHaveBeenCalled();
    expect(findCallers).toHaveBeenCalledWith('B', { depth: 1 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.backend).toBe('codebase-memory');
    expect(parsed.data.callers[0].from).toBe('A');
  });

  it('adapter throw is normalized to a diagnostic envelope (no crash)', async () => {
    setBackendAdapterFactory(
      () => ({ findCallers: vi.fn().mockRejectedValue(new Error('kaboom')) }) as any
    );

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const tool = collectTools(server).get('archguard_find_callers');
    const result = await tool({ entityName: 'B', backend: 'codebase-memory' });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.backend).toBe('codebase-memory');
    expect(parsed.diagnostics?.[0]?.code).toBe('backend-error');
    expect(parsed.diagnostics?.[0]?.message).toContain('kaboom');
  });
});
